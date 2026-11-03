/**
 * The desktop's side of the sync service: playlists and where playback stopped,
 * the same on all devices. The conversation itself is lib/syncEngine.ts, one
 * copy with the phone; here is what it reads and changes on this computer. The
 * requests go through the main process, which holds the login.
 */
import { create } from "zustand";
import { useCatalog } from "../stores/catalog";
import { useLibrary, type LibraryFolder, type Playlist } from "../stores/library";
import { useMuted } from "../stores/muted";
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { useUI } from "../stores/ui";
import type { Track } from "../types";
import { songFinder, toPlaylistDoc, toWireTrack, withSyncedDeletions, type PlaylistDoc, type WireTrack } from "./playlistSync";
import { handOverToCast, takeBackFromCast } from "./audio";
import { useCast } from "./cast";
import { syncFavorites } from "./serverSync";
import { createSyncEngine, DEVICE_ONLINE_MS, type DeviceCommand, type DevicePresence, type PlaybackNote, type QueueDoc, type RemoteDevice, type SyncEngine, type SyncStatus } from "./syncEngine";

/** A pause a moment ago is a person between songs, not somebody done here. */
const IDLE_BEFORE_TAKING_OVER_MS = 60_000;
/** While the other device plays on in the same song, this one looks up only now and then. */
const FOLLOW_EVERY_MS = 120_000;
const QUEUE_NOTE_BEHIND = 200;
const QUEUE_NOTE_AHEAD = 800;
/** A device that was only paused stays on screen for this long; then this computer is by itself again. */
const FOLLOW_PAUSED_MS = 5 * 60_000;
const FOLLOW_TICK_MS = 1000;
const AT_KEY = "songsta.sync.at";
const QUEUE_KEY = "songsta.sync.queueId";

/** Another device whose music this computer shows and steers, itself silent. */
export interface FollowedDevice {
  id: string;
  name: string;
  kind: DevicePresence["kind"];
}

interface HomeSyncState {
  status: SyncStatus;
  address: string | null;
  customAddress: string;
  needsUser: boolean;
  /** the other Songsta devices of this account */
  others: RemoteDevice[];
  followed: FollowedDevice | null;
}

export const useHomeSync = create<HomeSyncState>(() => ({ status: "off", address: null, customAddress: "", needsUser: false, others: [], followed: null }));

export const isAround = (device: RemoteDevice): boolean => device.ageMs < DEVICE_ONLINE_MS;

/** What the devices area can ask of the other Songsta devices; set while the sync runs. */
export const otherDevices = {
  /** This computer's music goes to that device and plays on there. */
  sendTo: async (_id: string): Promise<boolean> => false,
  /** The music of the device being followed comes here and plays on. */
  takeHere: (): void => undefined,
  /** A word for that device. */
  send: async (_id: string, _command: DeviceCommand): Promise<boolean> => false,
};

/** Looks again at the login and the address: after a change in Settings. */
let refreshNow: () => void = () => undefined;
export const refreshHomeSync = (): void => refreshNow();

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a convenience: without it another device's note just counts as newer */
  }
}

let finder: { byId: Map<string, Track>; find: (wire: WireTrack) => Track | undefined } | null = null;

/** The song of this library a description from another device means. */
function findSong(wire: WireTrack): Track | undefined {
  const { byId } = useCatalog.getState();
  if (finder?.byId !== byId) finder = { byId, find: songFinder([...byId.values()]) };
  return finder.find(wire);
}

/**
 * A playlist's song as this computer keeps it: what it already has, the
 * library's own copy, or the description until a library has it. Its id stays:
 * that is what the playlist's versions know it by.
 */
function ownTrack(wire: WireTrack, own: Map<string, Track>): Track {
  const mine = own.get(wire.id) ?? useCatalog.getState().byId.get(wire.id);
  if (mine) return mine;
  return { ...wire, thumb: findSong(wire)?.thumb ?? "" };
}

function applyPlaylists(doc: PlaylistDoc): void {
  const library = useLibrary.getState();
  const own = new Map<string, Track>();
  for (const p of library.playlists) for (const t of p.tracks) own.set(t.id, t);
  const playlists: Playlist[] = doc.playlists.map((p) => ({ ...p, tracks: p.tracks.map((t) => ownTrack(t, own)) }));
  useLibrary.setState({
    playlists,
    folders: doc.folders as LibraryFolder[],
    deletionSync: withSyncedDeletions(library.deletionSync, doc.deletionSync),
  });
}

export function watchHomeSync(): () => void {
  const bridge = window.bytune;
  if (!bridge?.homeSyncInfo) return () => undefined;

  let engine: SyncEngine | null = null;
  let closed = false;
  /** a change made by the sync itself isn't news for the sync */
  let applying = false;
  /** the note this computer stands on: its own or one it took over */
  let activityAt = Number(readStored(AT_KEY)) || 0;
  /** when somebody last did something here */
  let ownActivityAt = 0;
  let queueId = readStored(QUEUE_KEY);
  let adoptedAt = 0;
  let device = { id: "", name: "" };
  /** the device being followed and where it stood when last heard */
  let followed: (FollowedDevice & { playing: boolean; positionMs: number; heardAt: number; pausedSince: number }) | null = null;
  let followTimer: number | null = null;
  /** the device this computer just handed its music to: followed at once */
  let followNext: string | null = null;

  function inSameSong(note: PlaybackNote): boolean {
    const { queue, index } = usePlayer.getState();
    return note.queueId === queueId && !!queue[index] && findSong(note.track)?.id === queue[index].id;
  }

  const activity = (): void => {
    activityAt = ownActivityAt = Date.now();
    store(AT_KEY, String(activityAt));
    engine?.playbackChanged();
  };

  function readPlayback(): { note: PlaybackNote; queue: () => QueueDoc } | null {
    const { queue, index, position, playing } = usePlayer.getState();
    const track = queue[index];
    // What another device plays is that device's to tell.
    if (!track || !activityAt || followed) return null;
    if (!queueId) queueId = String(activityAt);
    const id = queueId;
    store(AT_KEY, String(activityAt));
    return {
      note: { device, at: activityAt, playing, positionMs: position * 1000, track: toWireTrack(track), queueId: id },
      queue: () => ({ id, tracks: queue.slice(Math.max(0, index - QUEUE_NOTE_BEHIND), index + QUEUE_NOTE_AHEAD).map(toWireTrack) }),
    };
  }

  function wantsPlayback(note: PlaybackNote): boolean {
    // The device being followed: every new queue of it, and nothing else of anybody.
    if (followed) return followed.id === note.device.id && note.queueId !== queueId;
    if (useCast.getState().active) return false;
    if (usePlayer.getState().playing || !useCatalog.getState().loaded) return false;
    if (note.playing && inSameSong(note) && Date.now() - adoptedAt < FOLLOW_EVERY_MS) return false;
    return note.at > activityAt && Date.now() - ownActivityAt > IDLE_BEFORE_TAKING_OVER_MS;
  }

  /** Continues from another device: its queue, its song, its position, paused until somebody presses play. */
  function adoptPlayback(note: PlaybackNote, queue: QueueDoc | null): void {
    const current = findSong(note.track);
    if (!current) return;
    adoptedAt = Date.now();
    // The same song a little further on: no need to load it again, nor to say so.
    if (inSameSong(note)) {
      applying = true;
      activityAt = note.at;
      store(AT_KEY, String(activityAt));
      usePlayer.setState({ position: note.positionMs / 1000, seekNonce: usePlayer.getState().seekNonce + 1 });
      applying = false;
      return;
    }
    const found = (queue?.tracks ?? []).map(findSong).filter((t): t is Track => !!t);
    const list = found.some((t) => t.id === current.id) ? found : [current];
    const newQueue = note.queueId !== queueId;
    applying = true;
    activityAt = note.at;
    queueId = note.queueId;
    store(AT_KEY, String(activityAt));
    store(QUEUE_KEY, queueId);
    usePlayer.setState({
      queue: list,
      index: list.findIndex((t) => t.id === current.id),
      position: note.positionMs / 1000,
      duration: current.duration,
      playing: followed?.playing ?? false,
      error: null,
      seekNonce: usePlayer.getState().seekNonce + 1,
    });
    applying = false;
    // A new song within a queue this one already follows needs no word; a device being followed shows by itself.
    if (newQueue && !followed) useUI.getState().toast(`Picked up from ${note.device.name}`, "info");
  }

  /** While a device is followed, what happens to the store here is a wish for that device. */
  function steer(state: ReturnType<typeof usePlayer.getState>, prev: ReturnType<typeof usePlayer.getState>): void {
    if (applying || !followed) return;
    const cur = state.queue[state.index];
    const before = prev.queue[prev.index];
    if (state.queue !== prev.queue && cur?.id !== before?.id) {
      // Something else started here: this computer plays it, and the other device goes on with its own.
      stopFollowing(state.playing);
      return;
    }
    if (cur && cur.id !== before?.id) void engine?.sendCommand(followed.id, { action: "jump", trackId: cur.id });
    else if (state.seekNonce !== prev.seekNonce) {
      followed = { ...followed, positionMs: state.position * 1000, heardAt: Date.now() };
      void engine?.sendCommand(followed.id, { action: "seek", positionMs: state.position * 1000 });
    }
    if (state.playing !== prev.playing) {
      followed = { ...followed, playing: state.playing, positionMs: state.position * 1000, heardAt: Date.now() };
      void engine?.sendCommand(followed.id, { action: state.playing ? "play" : "pause" });
    }
  }

  function tickFollow(): void {
    if (!followed?.playing) return;
    const { duration } = usePlayer.getState();
    const running = (followed.positionMs + (Date.now() - followed.heardAt)) / 1000;
    usePlayer.getState()._setTime(duration > 0 ? Math.min(duration, running) : running);
  }

  /** This computer is by itself again, from the place the other device had reached. */
  function stopFollowing(play: boolean): void {
    if (!followed) return;
    followed = null;
    if (followTimer !== null) window.clearInterval(followTimer);
    followTimer = null;
    useHomeSync.setState({ followed: null });
    applying = true;
    usePlayer.getState().setPlaying(play);
    applying = false;
    takeBackFromCast();
    activity();
  }

  function follow(other: RemoteDevice): void {
    const p = other.presence;
    if (!p.track) return;
    if (!followed) {
      handOverToCast(steer);
      followTimer = window.setInterval(tickFollow, FOLLOW_TICK_MS);
    }
    const positionMs = p.positionMs + (p.playing ? other.ageMs : 0);
    const pausedSince = p.playing ? 0 : followed?.pausedSince || Date.now();
    followed = { id: other.id, name: p.name, kind: p.kind, playing: p.playing, positionMs, heardAt: Date.now(), pausedSince };
    if (useHomeSync.getState().followed?.id !== other.id || useHomeSync.getState().followed?.name !== p.name) {
      useHomeSync.setState({ followed: { id: other.id, name: p.name, kind: p.kind } });
    }
    const song = findSong(p.track) ?? ({ thumb: "", ...p.track } as Track);
    const { queue, index } = usePlayer.getState();
    applying = true;
    if (queue[index]?.id !== song.id) {
      const at = queue.findIndex((t) => t.id === song.id);
      if (at >= 0 && p.queueId === queueId) usePlayer.setState({ index: at });
      else {
        // The queue itself comes with the look below.
        usePlayer.setState({ queue: [song], index: 0 });
        queueId = "";
        void engine?.checkPlayback();
      }
    }
    usePlayer.setState({ playing: p.playing, position: positionMs / 1000, duration: p.durationMs / 1000, error: null });
    applying = false;
  }

  /** The other devices said something: who, if anybody, this computer shows. */
  function hearDevices(others: RemoteDevice[]): void {
    useHomeSync.setState({ others });
    if (!followed && usePlayer.getState().playing) return;
    // A network player has this computer's music: it isn't idle.
    if (useCast.getState().active) return;
    const around = others.filter(isAround);
    const current = followed ? around.find((d) => d.id === followed?.id && d.presence.track) : undefined;
    const handedTo = followNext ? around.find((d) => d.id === followNext && d.presence.playing && d.presence.track) : undefined;
    if (handedTo) followNext = null;
    const playing = around.find((d) => d.presence.playing && d.presence.track);
    const stillWanted = current && (current.presence.playing || !followed?.pausedSince || Date.now() - followed.pausedSince < FOLLOW_PAUSED_MS);
    const idleHere = Date.now() - ownActivityAt > IDLE_BEFORE_TAKING_OVER_MS;
    const target = handedTo ?? (stillWanted ? current : undefined) ?? (idleHere ? playing : undefined);
    if (target) follow(target);
    else if (followed) stopFollowing(false);
  }

  function runCommand(command: DeviceCommand): void {
    if (command.action === "syncLikes") {
      void syncFavorites().catch(() => undefined);
      return;
    }
    if (command.action === "enqueue") {
      const songs = command.tracks.map(findSong).filter((t): t is Track => !!t);
      if (songs.length) usePlayer.getState().addToQueue(songs, !!command.next);
      return;
    }
    // Asked to play here: whatever this computer was showing, it's this computer's music now.
    if (followed) stopFollowing(false);
    const player = usePlayer.getState();
    switch (command.action) {
      case "play":
      case "takeOver":
        player.setPlaying(true);
        break;
      case "pause":
        player.setPlaying(false);
        break;
      case "next":
        player.next(true);
        break;
      case "previous":
        player.prev();
        break;
      case "seek":
        player.seek(command.positionMs / 1000);
        break;
      case "jump": {
        const at = player.queue.findIndex((t) => t.id === command.trackId);
        if (at >= 0) usePlayer.setState({ index: at, playing: true, position: 0, error: null });
        break;
      }
      default:
        break;
    }
  }

  function readPresence(): DevicePresence {
    const { queue, index, position, duration, playing } = usePlayer.getState();
    const track = queue[index];
    const base = { name: device.name, kind: "computer" as const };
    if (followed || !track) return { ...base, playing: false, positionMs: 0, durationMs: 0, track: null };
    return { ...base, playing, positionMs: position * 1000, durationMs: duration * 1000, track: toWireTrack(track), queueId };
  }

  async function refresh(): Promise<void> {
    const info = await bridge!.homeSyncInfo();
    if (closed) return;
    useHomeSync.setState({ address: info.address, customAddress: info.customAddress, needsUser: info.needsUser });
    device = { id: info.deviceId, name: info.deviceName };
    const wanted =
      info.ready &&
      useSettings.getState().syncPlaylists &&
      useCatalog.getState().loaded &&
      useLibrary.persist.hasHydrated() &&
      usePlayer.persist.hasHydrated();
    if (!wanted) {
      engine?.stop();
      engine = null;
      useHomeSync.setState({ status: "off" });
      return;
    }
    if (engine) {
      engine.retryNow();
      return;
    }
    engine = createSyncEngine({
      deviceId: info.deviceId,
      request: (method, path, body, timeoutMs) => bridge!.homeSyncRequest(method, path, body, timeoutMs),
      readPlaylists: () => toPlaylistDoc(useLibrary.getState()),
      applyPlaylists(doc) {
        applying = true;
        applyPlaylists(doc);
        applying = false;
      },
      readPlayback,
      wantsPlayback,
      adoptPlayback,
      readLikes: () => useLibrary.getState().liked.map(toWireTrack),
      readPresence,
      applyDevices: hearDevices,
      onCommand: runCommand,
      readMuted: () => ({ at: useMuted.getState().at, tracks: useMuted.getState().tracks.map(toWireTrack) }),
      applyMuted(doc) {
        applying = true;
        useMuted.getState().apply(doc.tracks.map((wire) => findSong(wire) ?? ({ thumb: "", ...wire } as Track)), doc.at);
        applying = false;
      },
      onStatus: (status) => useHomeSync.setState({ status }),
    });
    otherDevices.send = (id, command) => engine?.sendCommand(id, command) ?? Promise.resolve(false);
    otherDevices.sendTo = async (id) => {
      const sent = (await engine?.handOver(id)) ?? false;
      if (sent) {
        followNext = id;
        usePlayer.getState().setPlaying(false);
      }
      return sent;
    };
    otherDevices.takeHere = () => {
      if (!followed) return;
      void engine?.sendCommand(followed.id, { action: "pause" });
      stopFollowing(true);
    };
    engine.start();
  }

  const refreshQuietly = (): void => void refresh().catch(() => undefined);
  refreshNow = refreshQuietly;

  // What the stores read from disk at the start isn't anything somebody just did.
  const offLibrary = useLibrary.subscribe((s, prev) => {
    if (s.liked !== prev.liked && useLibrary.persist.hasHydrated()) engine?.likesChanged();
    if (!applying && useLibrary.persist.hasHydrated() && (s.playlists !== prev.playlists || s.folders !== prev.folders)) engine?.playlistsChanged();
  });
  let playerRead = usePlayer.persist.hasHydrated();
  const offPlayer = usePlayer.subscribe((s, prev) => {
    if (applying || !playerRead) return;
    if (s.queue !== prev.queue) {
      queueId = String(Date.now());
      store(QUEUE_KEY, queueId);
      activity();
    } else if (s.playing !== prev.playing || s.index !== prev.index || s.seekNonce !== prev.seekNonce) {
      activity();
    } else if (s.playing && s.position !== prev.position) {
      activityAt = ownActivityAt = Date.now();
      engine?.playbackChanged(true);
    }
  });
  const offMuted = useMuted.subscribe((s, prev) => {
    if (!applying && s.at !== prev.at) engine?.mutedChanged();
  });
  const offCatalog = useCatalog.subscribe((s, prev) => {
    if (s.loaded && !prev.loaded) refreshQuietly();
  });
  const offSettings = useSettings.subscribe((s, prev) => {
    if (s.syncPlaylists !== prev.syncPlaylists) refreshQuietly();
  });
  const offHydrations = [
    useLibrary.persist.onFinishHydration(refreshQuietly),
    usePlayer.persist.onFinishHydration(() => {
      playerRead = true;
      refreshQuietly();
    }),
  ];
  const onFocus = (): void => void engine?.checkPlayback();
  const onLeave = (): void => void engine?.flushPlayback();
  window.addEventListener("bytune:remote-library-updated", refreshQuietly);
  window.addEventListener("focus", onFocus);
  window.addEventListener("pagehide", onLeave);
  refreshQuietly();

  return () => {
    closed = true;
    refreshNow = () => undefined;
    engine?.stop();
    if (followTimer !== null) window.clearInterval(followTimer);
    offMuted();
    offLibrary();
    offPlayer();
    offCatalog();
    offSettings();
    for (const off of offHydrations) off();
    window.removeEventListener("bytune:remote-library-updated", refreshQuietly);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("pagehide", onLeave);
  };
}
