/**
 * Casting, the renderer half: handing the music to a network player (DLNA /
 * UPnP — receivers, network speakers, TVs) and taking it back.
 * electron/cast.ts runs the session.
 *
 * While a player has the music this computer's decks stay silent and the
 * player follows the queue: a new song, play/pause and seeking go to it, the
 * volume slider sets the player's volume (this computer's stays as it was),
 * and the player's own reports drive the seek bar, lyrics and listening
 * history. Pausing or stopping on the player itself is followed here too.
 */
import { create } from "zustand";
import type { CastStatus } from "../../electron/cast";
import { usePlayer } from "../stores/player";
import { useUI } from "../stores/ui";
import type { Track } from "../types";
import { castHeard, castTrackEnded, handOverToCast, takeBackFromCast } from "./audio";
import { requireBridge } from "./bridge";
import { ipcErrorText } from "./ipcError";
import { playableVersions } from "./librarySource";

export interface CastDevice {
  id: string;
  name: string;
  model: string;
}

interface CastState {
  /** players found by the last search */
  devices: CastDevice[];
  searching: boolean;
  /** the player that has the music; null while this computer plays */
  active: { id: string; name: string } | null;
  /** the player being connected to */
  connecting: string | null;
  /** the player's volume 0–1; null when it can't be set from here */
  volume: number | null;
  muted: boolean;
}

export const useCast = create<CastState>(() => ({
  devices: [],
  searching: false,
  active: null,
  connecting: null,
  volume: null,
  muted: false,
}));

/** Copies a player can be handed: files here and songs on Jellyfin/Navidrome (cast.ts streams them). */
const CASTABLE = /^(local|jf|ss):/;
/** After a command of ours, the player's reports may still show the state before it. */
const SETTLE_MS = 4000;
/** Reports in a row without an answer before the player counts as gone. */
const LOST_AFTER = 10;
/** How long a player may take to start a song it was handed. */
const START_MS = 12000;

let deviceState: CastStatus["state"] = "idle";
let lastCommandAt = 0;
let lastSeekAt = 0;
/** store changes that mirror the player itself — not sent back to it */
let adopting = false;
let loadSeq = 0;
let unanswered = 0;
/** a song handed over to play that the player hasn't reported playing yet: since when */
let startingSince: number | null = null;
/** the queue entry on the player and the copy of it that plays there */
let sent: { queueId: string; versionId: string } | null = null;
let offStatus: (() => void) | null = null;

const toast = (message: string, kind: "info" | "error" = "info"): void => useUI.getState().toast(message, kind);
const playerName = (): string => useCast.getState().active?.name ?? "the player";

function adopt(change: () => void): void {
  adopting = true;
  try {
    change();
  } finally {
    adopting = false;
  }
}

function command(action: "play" | "pause" | "seek", value = 0): void {
  lastCommandAt = Date.now();
  if (action === "seek") lastSeekAt = lastCommandAt;
  requireBridge()
    .castControl(action, value)
    .catch((err: unknown) => toast(ipcErrorText(err, `${playerName()} didn't take that`), "error"));
}

/** Puts `track` on the player at `position`, its local file first, then a server's copy. */
async function send(track: Track, position: number, play: boolean): Promise<void> {
  const seq = ++loadSeq;
  lastCommandAt = Date.now();
  usePlayer.getState()._setBuffering(true);
  // The seek bar and lyrics start the new song from where it starts, not from the last one's clock.
  castHeard(track.id, position, false);
  let failure: unknown = null;
  for (const version of playableVersions(track)) {
    if (!CASTABLE.test(version.id)) continue;
    sent = { queueId: track.id, versionId: version.id };
    try {
      await requireBridge().castLoad(
        { id: version.id, title: track.title, artist: track.artist, album: track.album ?? "", duration: track.duration },
        position,
        play
      );
      if (seq !== loadSeq) return;
      lastCommandAt = Date.now();
      startingSince = play ? lastCommandAt : null;
      deviceState = play ? "playing" : "paused";
      usePlayer.getState()._setSource(track.id, version);
      usePlayer.getState()._setBuffering(false);
      return;
    } catch (err) {
      if (seq !== loadSeq) return;
      failure = err;
    }
  }
  sent = null;
  startingSince = null;
  usePlayer.getState()._setBuffering(false);
  toast(ipcErrorText(failure, `"${track.title}" can't play on ${playerName()}`), "error");
  adopt(() => usePlayer.getState().setPlaying(false));
}

/** The store changed while the player has the music (audio.ts hands every change here). */
function follow(state: ReturnType<typeof usePlayer.getState>, prev: ReturnType<typeof usePlayer.getState>): void {
  if (!useCast.getState().active) return;
  const cur = state.queue[state.index] ?? null;
  const before = prev.queue[prev.index] ?? null;
  if (cur?.id !== before?.id) {
    if (cur) void send(cur, state.position, state.playing);
    else {
      sent = null;
      lastCommandAt = Date.now();
      void requireBridge().castControl("pause").catch(() => undefined);
    }
    return;
  }
  if (!cur || adopting) return;
  if (state.seekNonce !== prev.seekNonce) command("seek", state.position);
  // The same song queued afresh (its album played again): from the top there too, as here.
  else if (state.queue !== prev.queue && state.position === 0 && prev.position > 3) command("seek", 0);
  if (state.playing !== prev.playing) {
    // A stopped player has let go of the song: start it again where the queue is.
    if (state.playing && (deviceState === "stopped" || deviceState === "idle" || !sent)) void send(cur, state.position, true);
    else if (state.playing) command("play");
    else if (deviceState !== "stopped") command("pause");
  }
}

function onStatus(st: CastStatus): void {
  const cast = useCast.getState();
  if (!cast.active || !st.device || st.device.id !== cast.active.id) return;
  if (st.volume !== cast.volume || st.muted !== cast.muted) useCast.setState({ volume: st.volume, muted: st.muted });
  if (st.message) {
    if (++unanswered === LOST_AFTER) {
      toast(`${cast.active.name} stopped answering — the music is back on this computer, paused`, "error");
      void stopCasting(false);
    }
    return;
  }
  unanswered = 0;
  const player = usePlayer.getState();
  const cur = player.queue[player.index];
  if (!cur || !sent || sent.queueId !== cur.id || st.trackId !== sent.versionId) return;
  deviceState = st.state;
  player._setBuffering(st.state === "loading");
  if (st.state === "playing") startingSince = null;
  else if (startingSince != null && Date.now() - startingSince > START_MS) {
    // Handed over, never started: say why, as far as it can be told.
    startingSince = null;
    player._setBuffering(false);
    toast(
      st.fetched
        ? `${cast.active.name} doesn't start "${cur.title}" — it may not play this kind of file`
        : `${cast.active.name} can't reach this computer — let Songsta through the firewall for private networks`,
      "error"
    );
    adopt(() => usePlayer.getState().setPlaying(false));
    return;
  }
  if (st.state === "loading") return;
  // A report sent off before a seek still has the old position.
  if (Date.now() - lastSeekAt > 1500) {
    player._setTime(st.position, st.duration);
    castHeard(cur.id, st.position, st.state === "playing");
  }
  if (st.ended) {
    if (player.repeat === "one") void send(cur, 0, true);
    else castTrackEnded();
    return;
  }
  // Paused, resumed or stopped on the player itself (its remote, its app): follow it —
  // but not while it starts a song (its stops on the way there are not the listener's).
  if (startingSince != null || Date.now() - lastCommandAt < SETTLE_MS) return;
  const playing = st.state === "playing";
  if ((playing || st.state === "paused" || st.state === "stopped") && player.playing !== playing) {
    adopt(() => usePlayer.getState().setPlaying(playing));
  }
}

/** Players on this network (a search takes a few seconds). */
export async function searchCastDevices(): Promise<CastDevice[]> {
  if (useCast.getState().searching) return useCast.getState().devices;
  useCast.setState({ searching: true });
  try {
    const devices = await requireBridge().castFind();
    useCast.setState({ devices });
    return devices;
  } catch (err) {
    toast(ipcErrorText(err, "Couldn't look for players on the network"), "error");
    return useCast.getState().devices;
  } finally {
    useCast.setState({ searching: false });
  }
}

/** Hands the music to `device`, from where it is now. */
export async function castTo(device: CastDevice): Promise<void> {
  const bridge = requireBridge();
  if (useCast.getState().active?.id === device.id) return;
  useCast.setState({ connecting: device.id });
  try {
    offStatus?.();
    offStatus = bridge.onCastStatus(onStatus);
    const status = await bridge.castStart(device.id);
    deviceState = "idle";
    unanswered = 0;
    sent = null;
    useCast.setState({ active: status.device, volume: status.volume, muted: status.muted, connecting: null });
    handOverToCast(follow);
    const s = usePlayer.getState();
    const cur = s.queue[s.index];
    if (cur) await send(cur, s.position, s.playing);
    toast(`Playing on ${device.name}`);
  } catch (err) {
    offStatus?.();
    offStatus = null;
    useCast.setState({ connecting: null });
    toast(ipcErrorText(err, `Couldn't connect to ${device.name}`), "error");
  }
}

/** Takes the music back: this computer plays on from where the player was (paused when `keepPlaying` is false). */
export async function stopCasting(keepPlaying = true): Promise<void> {
  if (!useCast.getState().active) return;
  offStatus?.();
  offStatus = null;
  sent = null;
  loadSeq += 1;
  startingSince = null;
  useCast.setState({ active: null, volume: null, muted: false });
  await requireBridge()
    .castStop()
    .catch(() => undefined);
  if (!keepPlaying) usePlayer.getState().setPlaying(false);
  takeBackFromCast();
}

let volumeBusy = false;
let volumeNext: number | null = null;

/** The player's volume, from the slider: sent one at a time, the latest value winning. */
export function setCastVolume(v: number): void {
  const value = Math.min(1, Math.max(0, v));
  useCast.setState({ volume: value, muted: false });
  volumeNext = value;
  if (volumeBusy) return;
  volumeBusy = true;
  void (async () => {
    const bridge = requireBridge();
    try {
      if (useCast.getState().muted) await bridge.castControl("mute", 0).catch(() => undefined);
      while (volumeNext != null) {
        const next = volumeNext;
        volumeNext = null;
        await bridge.castControl("volume", next).catch(() => undefined);
      }
    } finally {
      volumeBusy = false;
    }
  })();
}

export function toggleCastMute(): void {
  const muted = !useCast.getState().muted;
  useCast.setState({ muted });
  void requireBridge()
    .castControl("mute", muted ? 1 : 0)
    .catch((err: unknown) => toast(ipcErrorText(err, `${playerName()} didn't take that`), "error"));
}

/**
 * The volume that sliders, keys and the miniplayer show and move: the
 * player's while one has the music, this computer's otherwise. `fixed` — a
 * player whose volume can't be set from here.
 */
export interface VolumeTarget {
  value: number;
  muted: boolean;
  fixed: boolean;
  setVolume(v: number): void;
  toggleMute(): void;
}

function targetFor(casting: boolean, castVolume: number | null, castMuted: boolean, volume: number, muted: boolean): VolumeTarget {
  const p = usePlayer.getState();
  if (!casting) return { value: volume, muted, fixed: false, setVolume: p.setVolume, toggleMute: p.toggleMute };
  if (castVolume == null) return { value: volume, muted: false, fixed: true, setVolume: () => undefined, toggleMute: () => undefined };
  return { value: castVolume, muted: castMuted, fixed: false, setVolume: setCastVolume, toggleMute: toggleCastMute };
}

export function volumeTarget(): VolumeTarget {
  const c = useCast.getState();
  const p = usePlayer.getState();
  return targetFor(c.active !== null, c.volume, c.muted, p.volume, p.muted);
}

export function useVolumeTarget(): VolumeTarget {
  const casting = useCast((s) => s.active !== null);
  const castVolume = useCast((s) => s.volume);
  const castMuted = useCast((s) => s.muted);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  return targetFor(casting, castVolume, castMuted, volume, muted);
}
