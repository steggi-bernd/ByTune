/**
 * The queue and what the native player is doing. This store owns the queue's
 * order and tells the player every change; shuffling reorders what comes
 * next, so the list on screen is what actually plays.
 *
 * Where playback stopped is kept on the phone and restored paused at the next
 * start, and the sync service carries the same note between devices: a phone
 * that isn't playing continues from where another device stopped.
 */
import { Platform, ToastAndroid } from "react-native";
import { create } from "zustand";
import Player, { type PlaybackState, type QueueItem, type RepeatMode } from "../../modules/media3-player";
import { streamUrl, type Session } from "../jellyfin";
import { withoutServer } from "../addresses";
import { branched } from "../playingFrom";
import { chooseStream, levelGain, ORIGINAL, sameChoice, stepDown, type Leveling, type QualityMode, type StreamChoice } from "../quality";
import { playCreditSeconds, toWireTrack, type DeviceCommand, type DevicePresence, type PlaybackNote, type QueueDoc, type RemoteDevice, type Track, type WireTrack } from "../shared";
import { readJson, writeJson } from "../storage";
import { useConnection } from "./connection";
import { isAround, useDevices } from "./devices";
import { downloadsLine, useDownloads } from "./downloads";
import { useLibrary } from "./library";
import { findSong } from "./playlists";
import { here, useSession } from "./session";

const FILE = "player.json";
const QUALITY_FILE = "quality.json";
const SAVE_EVERY_MS = 5000;

interface Saved {
  context: string;
  ids: string[];
  index: number;
  positionMs: number;
  repeat: RepeatMode;
  /** when this was last worth continuing from */
  at?: number;
  queueId?: string;
}

/** What the queue asks of whatever plays it: this phone's own player, or a device on the network (stores/zones.ts). */
export type PlayerOutput = Pick<
  typeof Player,
  "setQueue" | "replaceUpcoming" | "replaceCurrent" | "addItems" | "insertItems" | "removeItem" | "moveItem" | "play" | "pause" | "seekTo" | "skipTo" | "next" | "previous" | "setRepeat" | "setGain"
>;

/** The device on the network that plays the queue instead of this phone. */
export interface OutputDevice {
  id: string;
  name: string;
  tv: boolean;
}

let output: PlayerOutput = Player;

/** While somebody chooses music for another device, what's asked for goes there. Answers whether it took it. */
let playHook: ((tracks: Track[], start: number, shuffle: boolean) => boolean) | null = null;
export function setPlayHook(hook: typeof playHook): void {
  playHook = hook;
}

/** Another device whose music this one shows and steers, itself silent. */
export interface FollowedDevice {
  id: string;
  name: string;
  kind: DevicePresence["kind"];
  playing: boolean;
  positionMs: number;
  durationMs: number;
  /** when that position was heard (this phone's clock) */
  heardAt: number;
}

interface PlayerState {
  /** the device this one is showing; null while it plays or rests by itself */
  remote: FollowedDevice | null;
  /** the device on the network that plays the queue; null for this phone */
  device: OutputDevice | null;
  queue: Track[];
  index: number;
  /** what the queue was started from: an album's name, a playlist's */
  context: string;
  isPlaying: boolean;
  playWhenReady: boolean;
  isBuffering: boolean;
  positionMs: number;
  durationMs: number;
  repeat: RepeatMode;
  shuffle: boolean;
  /** the order to go back to when shuffle is turned off */
  unshuffled: Track[] | null;
  /** when the sleep timer pauses the music */
  sleepAt: number | null;
  error: string | null;
  quality: QualityMode;
  /** the copy the playing song comes from */
  stream: StreamChoice;
  /** what the sound goes through: decoder, output, speed */
  audio: string;
  /** 24-bit files keep their resolution up to the system's mixer */
  keep24Bit: boolean;
  setKeep24Bit(on: boolean): void;
  leveling: Leveling;
  setLeveling(leveling: Leveling): void;
  setQuality(mode: QualityMode): void;
  /** A song asked for, with its list after it. Muted ones in the list stay out; the asked-for one plays anyway. */
  playTracks(tracks: Track[], start: number, context: string, shuffle?: boolean): void;
  /** A whole list from its Play or Shuffle button: nothing in it is asked for by name, so nothing muted plays. */
  playAll(tracks: Track[], context: string, shuffle?: boolean): void;
  /** The music of the device being followed comes here and plays on. */
  takeHere(): void;
  /** This device's music goes to another one and plays on there. */
  sendTo(deviceId: string): Promise<boolean>;
  toggle(): void;
  next(): void;
  previous(): void;
  seek(ms: number): void;
  skipTo(index: number): void;
  /** To the song a swipe brought in, -1 or 1 along the queue and round its ends. */
  skipBy(delta: number): void;
  cycleRepeat(): void;
  toggleShuffle(): void;
  addToQueue(tracks: Track[]): void;
  /** Right after the playing song. */
  playNext(tracks: Track[]): void;
  /** A song of a list next and the rest of that list after it, what was coming behind them. Answers how many songs that is. */
  branchOff(list: Track[], from: number, name: string): number;
  removeAt(index: number): void;
  moveItem(from: number, to: number): void;
  clearUpcoming(): void;
  cycleSleepTimer(): number | null;
  restore(): Promise<void>;
  stop(): void;
  clearError(): void;
}

function urlOf(s: Session | null, t: Track, choice: StreamChoice): string {
  const kept = useDownloads.getState().kept[t.id];
  if (kept) return `file://${kept.file}`;
  return s ? streamUrl(s, t, choice) : "";
}

function toItem(t: Track): QueueItem {
  const s = useSession.getState().session;
  const choice = choiceFor(t);
  chosen.set(t.id, choice);
  return {
    id: t.id,
    url: urlOf(s, t, choice),
    title: t.title,
    artist: t.artist,
    album: t.album ?? "",
    artworkUrl: t.thumb ? useDownloads.getState().covers[withoutServer(t.thumb)] ?? here(t.thumb) : undefined,
    gainDb: levelGain(t.rg?.trackGain, usePlayer.getState().leveling),
  };
}

export function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const SLEEP_STEPS = [15, 30, 60];

export const usePlayer = create<PlayerState>((set, get) => ({
  remote: null,
  device: null,
  queue: [],
  index: 0,
  context: "",
  isPlaying: false,
  playWhenReady: false,
  isBuffering: false,
  positionMs: 0,
  durationMs: 0,
  repeat: "off",
  shuffle: false,
  unshuffled: null,
  sleepAt: null,
  error: null,
  quality: "auto",
  stream: ORIGINAL,
  audio: "",
  keep24Bit: false,
  leveling: "normal",

  setQuality(mode) {
    capKbps = null;
    jumpedAt = Date.now();
    set({ quality: mode });
    writeJson(QUALITY_FILE, { mode, keep24Bit: get().keep24Bit, leveling: get().leveling });
    refreshStreams(true);
  },

  setKeep24Bit(keep24Bit) {
    set({ keep24Bit });
    writeJson(QUALITY_FILE, { mode: get().quality, keep24Bit, leveling: get().leveling });
    jumpedAt = Date.now();
    void Player.setKeep24Bit(keep24Bit, true);
  },

  setLeveling(leveling) {
    set({ leveling });
    writeJson(QUALITY_FILE, { mode: get().quality, keep24Bit: get().keep24Bit, leveling });
    const { queue, index } = get();
    const current = queue[index];
    if (!current) return;
    void output.setGain(levelGain(current.rg?.trackGain, leveling) ?? 0);
    void output.replaceUpcoming(queue.slice(index + 1).map(toItem));
  },

  playTracks(all, start, context, shuffle = get().shuffle) {
    if (playHook?.(all, start, shuffle)) return;
    // Without a way to the server only what's on the phone can play.
    const { kept } = useDownloads.getState();
    const offline = useConnection.getState().reach === "offline";
    const { muted } = useLibrary.getState();
    const asked = all[Math.max(0, Math.min(start, all.length - 1))];
    const tracks = all.filter((t) => (!offline || kept[t.id]) && (t === asked || !muted.has(t.id)));
    if (!tracks.length) {
      if (offline && all.length) ToastAndroid.show("Your server is out of reach, and this isn't downloaded", ToastAndroid.SHORT);
      return;
    }
    if (get().remote) stopFollowing(false, false);
    let queue = tracks;
    let index = Math.max(0, tracks.indexOf(asked));
    if (shuffle) {
      queue = [tracks[index], ...shuffled(tracks.filter((_, i) => i !== index))];
      index = 0;
    }
    branchAhead = null;
    set({ queue, index, context, shuffle, unshuffled: shuffle ? tracks : null, positionMs: 0, error: null });
    void output.setQueue(queue.map(toItem), index, 0, true);
    showStream();
    queueChanged();
    save(true);
  },

  playAll(all, context, shuffle = false) {
    const { muted } = useLibrary.getState();
    const open = all.filter((t) => !muted.has(t.id));
    if (!open.length) {
      if (all.length) ToastAndroid.show("Everything here is muted", ToastAndroid.SHORT);
      return;
    }
    get().playTracks(open, shuffle ? Math.floor(Math.random() * open.length) : 0, context, shuffle);
  },

  takeHere() {
    const { remote } = get();
    if (!remote) return;
    void deviceLink?.send(remote.id, { action: "pause" });
    stopFollowing(true);
  },

  async sendTo(deviceId) {
    if (!deviceLink) return false;
    const sent = await deviceLink.handOver(deviceId);
    if (!sent) return false;
    followNext = deviceId;
    void output.pause();
    return true;
  },

  toggle() {
    const { remote } = get();
    if (remote) {
      void deviceLink?.send(remote.id, { action: remote.playing ? "pause" : "play" });
      hold(remote.positionMs + (remote.playing ? Date.now() - remote.heardAt : 0), !remote.playing);
      return;
    }
    if (get().playWhenReady) void output.pause();
    else if (get().queue.length) void output.play();
  },
  next() {
    const { remote } = get();
    if (remote) {
      void deviceLink?.send(remote.id, { action: "next" });
      return;
    }
    jumpedAt = Date.now();
    void output.next();
    activity();
  },
  previous() {
    const { remote } = get();
    if (remote) {
      void deviceLink?.send(remote.id, { action: "previous" });
      return;
    }
    jumpedAt = Date.now();
    void output.previous();
    activity();
  },
  seek(ms) {
    const { remote } = get();
    if (remote) {
      void deviceLink?.send(remote.id, { action: "seek", positionMs: ms });
      hold(ms, remote.playing);
      return;
    }
    jumpedAt = Date.now();
    set({ positionMs: ms });
    void output.seekTo(ms);
    activity();
  },
  skipTo(index) {
    const { remote, queue } = get();
    if (remote) {
      if (queue[index]) void deviceLink?.send(remote.id, { action: "jump", trackId: queue[index].id });
      return;
    }
    jumpedAt = Date.now();
    void output.skipTo(index, true);
    activity();
  },
  skipBy(delta) {
    const { queue, index, playWhenReady, remote } = get();
    if (!queue.length) return;
    if (remote) {
      void deviceLink?.send(remote.id, { action: delta > 0 ? "next" : "previous" });
      return;
    }
    const target = (index + delta + queue.length) % queue.length;
    skipTarget = target;
    skipUntil = Date.now() + SKIP_PATIENCE_MS;
    jumpedAt = Date.now();
    set({ index: target, positionMs: 0, durationMs: queue[target].duration * 1000, error: null });
    void output.skipTo(target, playWhenReady);
    activity();
    save(true);
  },

  cycleRepeat() {
    const order: RepeatMode[] = ["off", "all", "one"];
    const repeat = order[(order.indexOf(get().repeat) + 1) % order.length];
    set({ repeat });
    void output.setRepeat(repeat);
  },

  toggleShuffle() {
    const { shuffle, queue, index, unshuffled } = get();
    const current = queue[index];
    if (!current) {
      set({ shuffle: !shuffle });
      return;
    }
    if (!shuffle) {
      const upcoming = shuffled(queue.slice(index + 1));
      set({ shuffle: true, unshuffled: queue, queue: [...queue.slice(0, index + 1), ...upcoming] });
      void output.replaceUpcoming(upcoming.map(toItem));
    } else {
      // The list's own order again, from the song playing on.
      const list = unshuffled ?? queue;
      const at = list.findIndex((t) => t.id === current.id);
      const upcoming = at >= 0 ? list.slice(at + 1) : [];
      set({ shuffle: false, unshuffled: null, queue: [...queue.slice(0, index + 1), ...upcoming] });
      void output.replaceUpcoming(upcoming.map(toItem));
    }
    queueChanged();
    save(true);
  },

  addToQueue(tracks) {
    const { remote } = get();
    if (remote) {
      void deviceLink?.send(remote.id, { action: "enqueue", tracks: tracks.map(toWireTrack) });
      return;
    }
    if (!get().queue.length) {
      get().playTracks(tracks, 0, "Queue");
      return;
    }
    const { queue, unshuffled } = get();
    set({ queue: [...queue, ...tracks], unshuffled: unshuffled && [...unshuffled, ...tracks] });
    void output.addItems(tracks.map(toItem));
    queueChanged();
    save(true);
  },

  playNext(tracks) {
    const { queue, index, unshuffled, remote } = get();
    if (remote) {
      void deviceLink?.send(remote.id, { action: "enqueue", tracks: tracks.map(toWireTrack), next: true });
      return;
    }
    const current = queue[index];
    if (!current) {
      get().playTracks(tracks, 0, "Queue");
      return;
    }
    const at = index + 1;
    // Shuffle turned off later keeps them where they were asked for.
    const inOrder = unshuffled ? unshuffled.findIndex((t) => t.id === current.id) + 1 : 0;
    set({
      queue: [...queue.slice(0, at), ...tracks, ...queue.slice(at)],
      unshuffled: unshuffled && [...unshuffled.slice(0, inOrder), ...tracks, ...unshuffled.slice(inOrder)],
    });
    void output.insertItems(at, tracks.map(toItem));
    queueChanged();
    save(true);
  },

  branchOff(list, from, name) {
    // Without a way to the server only what's on the phone can play.
    const { kept } = useDownloads.getState();
    const offline = useConnection.getState().reach === "offline";
    const { muted } = useLibrary.getState();
    const rest = list.slice(from).filter((t, i) => (!offline || kept[t.id]) && (i === 0 || !muted.has(t.id)));
    if (!rest.length) return 0;
    const { queue, index, unshuffled, remote } = get();
    if (remote) {
      void deviceLink?.send(remote.id, { action: "enqueue", tracks: rest.map(toWireTrack), next: true });
      return rest.length;
    }
    const current = queue[index];
    if (!current) {
      get().playTracks(rest, 0, name, false);
      return rest.length;
    }
    // From the very song that's playing: it just plays on, with its list behind it.
    const next = rest[0].id === current.id ? rest.slice(1) : rest;
    const upcoming = branched(queue.slice(index + 1), next);
    const inOrder = unshuffled ? unshuffled.findIndex((t) => t.id === current.id) + 1 : 0;
    branchAhead = { id: rest[0].id, context: name };
    set({
      queue: [...queue.slice(0, index + 1), ...upcoming],
      unshuffled: unshuffled && [...unshuffled.slice(0, inOrder), ...branched(unshuffled.slice(inOrder), next)],
    });
    void output.replaceUpcoming(upcoming.map(toItem));
    queueChanged();
    save(true);
    return rest.length;
  },

  removeAt(index) {
    const { queue, index: current } = get();
    if (index === current) return;
    set({ queue: queue.filter((_, i) => i !== index), index: index < current ? current - 1 : current });
    void output.removeItem(index);
    queueChanged();
    save(true);
  },

  moveItem(from, to) {
    const { queue, index: current } = get();
    if (from === to || from === current || to < 0 || to >= queue.length) return;
    const next = [...queue];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    const shift = from < current && to >= current ? -1 : from > current && to <= current ? 1 : 0;
    set({ queue: next, index: current + shift });
    void output.moveItem(from, to);
    queueChanged();
    save(true);
  },

  clearUpcoming() {
    const { queue, index } = get();
    set({ queue: queue.slice(0, index + 1) });
    void output.replaceUpcoming([]);
    queueChanged();
    save(true);
  },

  /** Off → 15 → 30 → 60 minutes → off; answers the minutes now set. */
  cycleSleepTimer() {
    const { sleepAt } = get();
    const left = sleepAt ? Math.round((sleepAt - Date.now()) / 60000) : 0;
    const step = SLEEP_STEPS.find((m) => m > left + 1) ?? null;
    set({ sleepAt: step ? Date.now() + step * 60000 : null });
    return step;
  },

  async restore() {
    const savedQuality = await readJson<{ mode?: QualityMode; keep24Bit?: boolean; leveling?: Leveling }>(QUALITY_FILE);
    if (savedQuality?.mode) set({ quality: savedQuality.mode });
    if (savedQuality?.leveling) set({ leveling: savedQuality.leveling });
    if (savedQuality?.keep24Bit) {
      set({ keep24Bit: true });
      await Player.setKeep24Bit(true, false);
    }
    const saved = await readJson<Saved>(FILE);
    activityAt = saved?.at ?? 0;
    queueId = saved?.queueId ?? "";
    const byId = useLibrary.getState().byId;
    const queue = (saved?.ids ?? []).map((id) => byId.get(id)).filter((t): t is Track => !!t);
    const state = await Player.getState().catch(() => null);
    if (state && state.count > 0) {
      // The service played on while the app was away: the list is the saved one.
      if (queue.length === state.count) set({ queue, context: saved?.context ?? "" });
      onState(state);
      return;
    }
    if (!saved || !queue.length) return;
    const index = Math.min(saved.index, queue.length - 1);
    set({ queue, index, context: saved.context, positionMs: saved.positionMs, repeat: saved.repeat ?? "off" });
    await output.setQueue(queue.map(toItem), index, saved.positionMs, false);
    showStream();
    await output.setRepeat(saved.repeat ?? "off");
  },

  stop() {
    void output.pause();
    void output.setQueue([], 0, 0, false);
    branchAhead = null;
    set({ queue: [], index: 0, context: "", positionMs: 0, durationMs: 0, unshuffled: null, sleepAt: null });
    activityAt = 0;
    queueId = "";
    writeJson(FILE, null);
  },

  clearError: () => set({ error: null }),
}));

/* ------------------------------------------------------------- the native player's news */

let lastSave = 0;
function save(now = false): void {
  if (!now && Date.now() - lastSave < SAVE_EVERY_MS) return;
  lastSave = Date.now();
  const { queue, index, context, positionMs, repeat } = usePlayer.getState();
  const saved: Saved = { context, ids: queue.map((t) => t.id), index, positionMs, repeat, at: activityAt, queueId };
  writeJson(FILE, saved);
}

/** One play per listen, by the rule the desktop's statistics use: time heard, not where the scrubber went. */
let counted = false;
let heardMs = 0;
let lastIndex = -1;
let lastPosition = 0;
const LONGEST_TICK_MS = 2000;

/** A swipe moves the page at once: what the player said before it heard of the swipe must not move it back. */
let skipTarget: number | null = null;
let skipUntil = 0;
const SKIP_PATIENCE_MS = 1500;

/** A branch's list takes over "Playing from" when its first song comes on. */
let branchAhead: { id: string; context: string } | null = null;

function onState(s: PlaybackState): void {
  // While another device is followed this one has nothing to say, unless somebody starts it here all the same.
  if (usePlayer.getState().remote) {
    if (!s.isPlaying) return;
    stopFollowing(false, false);
  }
  if (skipTarget !== null) {
    if (s.index !== skipTarget && Date.now() < skipUntil) return;
    skipTarget = null;
  }
  const prev = usePlayer.getState();
  if (output === Player) {
    bandwidthBps = s.bandwidthBps ?? 0;
    watchStalls(s);
    watchRate(s);
  }
  if (prev.isPlaying !== s.isPlaying || (s.isPlaying && prev.index !== s.index)) activity();
  else if (s.isPlaying) routineActivity();
  usePlayer.setState({
    index: s.index,
    isPlaying: s.isPlaying,
    // At the queue's end nothing plays on, whatever was asked for.
    playWhenReady: s.playWhenReady && !s.isEnded,
    isBuffering: s.isBuffering,
    positionMs: s.positionMs,
    durationMs: s.durationMs,
    repeat: s.repeat,
    audio: s.audio,
  });
  if (branchAhead && prev.queue[s.index]?.id === branchAhead.id) {
    usePlayer.setState({ context: branchAhead.context });
    branchAhead = null;
  }
  const step = s.positionMs - lastPosition;
  // A new song, or this one over from its start (repeat, or scrubbed back there): a new listen.
  if (s.index !== lastIndex || (step < 0 && s.positionMs < LONGEST_TICK_MS)) {
    counted = false;
    heardMs = 0;
  } else if (s.isPlaying && step > 0 && step < LONGEST_TICK_MS) {
    heardMs += step;
  }
  if (s.index !== lastIndex) {
    showStream();
    // Long enough ago that the connection may have recovered: the next song tries again.
    if (capKbps !== null && Date.now() - capSetAt > CAP_LASTS_MS) capKbps = null;
    refreshStreams(false);
  }
  lastIndex = s.index;
  lastPosition = s.positionMs;
  const track = prev.queue[s.index];
  if (track && !counted && heardMs / 1000 >= playCreditSeconds(track.duration)) {
    counted = true;
    useLibrary.getState().notePlayed(track);
  }
  if (prev.sleepAt && Date.now() >= prev.sleepAt) {
    usePlayer.setState({ sleepAt: null });
    void output.pause();
  }
  save(prev.isPlaying !== s.isPlaying || prev.index !== s.index);
}

/* ------------------------------------------------------------- which copy of a song plays */

/** Buffering this long with somebody waiting, or running dry again this soon: the connection doesn't carry what's playing. */
const STALL_MS = 6000;
const STALLS_AGAIN_WITHIN_MS = 45_000;
/** A jump to another place loads for a moment; that says nothing about the connection. */
const LOADING_AFTER_JUMP_MS = 3000;
const CAP_LASTS_MS = 5 * 60_000;

let bandwidthBps = 0;
/** what the connection recently failed to carry */
let capKbps: number | null = null;
let capSetAt = 0;
let transcodesWork = true;
/** the copy asked for, by song */
const chosen = new Map<string, StreamChoice>();
let stallTimer: ReturnType<typeof setTimeout> | null = null;
let waitingNow = false;
let lastStallAt = 0;
let jumpedAt = 0;

function choiceFor(t: Track): StreamChoice {
  // A device fetches the file itself, whatever this phone's connection or downloads are like.
  if (output !== Player) return ORIGINAL;
  const kept = useDownloads.getState().kept[t.id];
  if (kept) return { kind: "download", compact: kept.compact };
  if (!transcodesWork) return ORIGINAL;
  return chooseStream(t, usePlayer.getState().quality, bandwidthBps, capKbps, useConnection.getState().metered);
}

function showStream(): void {
  const { queue, index } = usePlayer.getState();
  const current = queue[index];
  usePlayer.setState({ stream: (current && chosen.get(current.id)) || ORIGINAL });
}

/** Brings what's asked of the server in line with the mode and the connection. The playing song only when told. */
function refreshStreams(currentToo: boolean): void {
  const { queue, index, positionMs } = usePlayer.getState();
  const current = queue[index];
  if (!current) return;
  if (currentToo && !sameChoice(chosen.get(current.id), choiceFor(current))) {
    void output.replaceCurrent(toItem(current), positionMs);
    showStream();
  }
  const upcoming = queue.slice(index + 1);
  if (upcoming.some((t) => !sameChoice(chosen.get(t.id), choiceFor(t)))) void output.replaceUpcoming(upcoming.map(toItem));
}

function smallerCopy(): void {
  const { quality, queue, index } = usePlayer.getState();
  const current = queue[index];
  if (quality !== "auto" || !current || chosen.get(current.id)?.kind === "download") return;
  const cap = stepDown(current, chosen.get(current.id) ?? ORIGINAL);
  if (cap === null) return;
  capKbps = cap;
  capSetAt = Date.now();
  jumpedAt = capSetAt;
  lastStallAt = 0;
  refreshStreams(true);
}

/** Only when the server still answers where it did: moved or gone says nothing about how much the connection carries. */
function smallerCopyIfStillThere(): void {
  const before = useSession.getState().session?.server;
  void useConnection.getState().check().then((reach) => {
    if (reach !== "offline" && useSession.getState().session?.server === before) smallerCopy();
  });
}

function watchStalls(s: PlaybackState): void {
  const waiting = s.isBuffering && s.playWhenReady;
  if (!waiting) {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = null;
    waitingNow = false;
    return;
  }
  if (!waitingNow) {
    waitingNow = true;
    const now = Date.now();
    // A song under way that ran dry. The first time can be a bump in the road; soon again it isn't.
    if (s.positionMs > 0 && now - jumpedAt > LOADING_AFTER_JUMP_MS) {
      if (now - lastStallAt < STALLS_AGAIN_WITHIN_MS) smallerCopyIfStillThere();
      else lastStallAt = now;
    }
  }
  if (stallTimer) return;
  stallTimer = setTimeout(() => {
    stallTimer = null;
    smallerCopyIfStillThere();
  }, STALL_MS);
}

/* ------------------------------------------------------------- how fast it really runs */

/** A stretch of plain playing against the clock: 1 is right. Goes out with the note, for when something sounds off. */
const RATE_STRETCH_MS = 10_000;
let rateFrom: { at: number; position: number; index: number } | null = null;
let rateOff = "";

function watchRate(s: PlaybackState): void {
  const now = Date.now();
  if (!s.isPlaying || s.isBuffering || now - jumpedAt < RATE_STRETCH_MS) {
    rateFrom = null;
    return;
  }
  if (!rateFrom || rateFrom.index !== s.index) {
    rateFrom = { at: now, position: s.positionMs, index: s.index };
    return;
  }
  if (now - rateFrom.at < RATE_STRETCH_MS) return;
  const rate = (s.positionMs - rateFrom.position) / (now - rateFrom.at);
  rateFrom = { at: now, position: s.positionMs, index: s.index };
  if (rate > 1.15 || rate < 0.85) rateOff = `ran at ${rate.toFixed(2)}x, ${new Date(now).toISOString()}`;
}

/* ------------------------------------------------------------- where it plays */

/** A zone's news, in the player's own words. */
export function zoneReport(s: PlaybackState): void {
  if (output !== Player) onState(s);
}

export function outputChanged(device: OutputDevice): void {
  const now = usePlayer.getState().device;
  if (now?.id !== device.id || now.name !== device.name || now.tv !== device.tv) usePlayer.setState({ device });
}

/**
 * The queue plays somewhere else from here on: a device on the network, or this
 * phone with null. It goes on from the place it had reached, playing if it was
 * unless told otherwise. What's followed is left behind, paused.
 */
export function switchOutput(next: { output: PlayerOutput; device: OutputDevice } | null, play?: boolean): void {
  const { queue, index, positionMs, playWhenReady, remote } = usePlayer.getState();
  const wanted = play ?? (remote ? remote.playing : playWhenReady);
  if (remote) {
    void deviceLink?.send(remote.id, { action: "pause" });
    stopFollowing(false, false);
  }
  const before = output;
  output = next?.output ?? Player;
  usePlayer.setState({ device: next?.device ?? null, error: null, stream: ORIGINAL });
  jumpedAt = Date.now();
  skipTarget = null;
  // Nothing may be left here that starts by itself, or shows in the notification.
  if (before === Player && output !== Player) void Player.setQueue([], 0, 0, false);
  if (!queue.length) {
    usePlayer.setState({ isPlaying: false, playWhenReady: false, isBuffering: false });
    return;
  }
  void output.setQueue(queue.map(toItem), index, positionMs, wanted);
  showStream();
  activity();
}

/* ------------------------------------------------------------- following another device */

/** A device that was only paused stays on screen for this long; then this phone is by itself again. */
const FOLLOW_PAUSED_MS = 5 * 60_000;
const FOLLOW_TICK_MS = 500;

interface DeviceLink {
  send(deviceId: string, command: DeviceCommand): Promise<boolean>;
  handOver(deviceId: string): Promise<boolean>;
  /** Look at the position and queue documents again. */
  look(): void;
}

let deviceLink: DeviceLink | null = null;
/** the device this phone just handed its music to: followed at once */
let followNext: string | null = null;
let followTick: ReturnType<typeof setInterval> | null = null;
let followPausedSince = 0;

export function linkDevices(link: DeviceLink | null): void {
  deviceLink = link;
}

function tickFollow(): void {
  const { remote } = usePlayer.getState();
  if (!remote?.playing) return;
  const running = remote.positionMs + (Date.now() - remote.heardAt);
  usePlayer.setState({ positionMs: remote.durationMs > 0 ? Math.min(remote.durationMs, running) : running });
}

/** What the screen shows right after a command, until the device's own word comes. */
function hold(positionMs: number, playing: boolean): void {
  const { remote } = usePlayer.getState();
  if (!remote) return;
  usePlayer.setState({ remote: { ...remote, positionMs, playing, heardAt: Date.now() }, positionMs, playWhenReady: playing, isPlaying: playing });
}

/** This phone is by itself again: the queue goes to its own player, from the place the other device had reached. */
function stopFollowing(play: boolean, loadHere = true): void {
  const { queue, index, positionMs } = usePlayer.getState();
  if (followTick) clearInterval(followTick);
  followTick = null;
  usePlayer.setState({ remote: null, playWhenReady: play, isPlaying: play });
  if (loadHere && queue.length) {
    jumpedAt = Date.now();
    void output.setQueue(queue.map(toItem), index, positionMs, play);
    showStream();
  }
  activity();
}

function follow(device: RemoteDevice): void {
  const p = device.presence;
  if (!p.track) return;
  const before = usePlayer.getState();
  if (!before.remote) {
    // Nothing of its own may start under the other device's music.
    void output.setQueue([], 0, 0, false);
    followTick = setInterval(tickFollow, FOLLOW_TICK_MS);
    followPausedSince = 0;
  }
  if (p.playing) followPausedSince = 0;
  else if (!followPausedSince) followPausedSince = Date.now();
  const song = findSong(p.track) ?? ({ thumb: "", ...p.track } as Track);
  const { queue, index } = before;
  const changes: Partial<PlayerState> = {
    remote: { id: device.id, name: p.name, kind: p.kind, playing: p.playing, positionMs: p.positionMs + (p.playing ? device.ageMs : 0), durationMs: p.durationMs, heardAt: Date.now() },
    positionMs: p.positionMs + (p.playing ? device.ageMs : 0),
    durationMs: p.durationMs,
    playWhenReady: p.playing,
    isPlaying: p.playing,
    isBuffering: false,
    error: null,
  };
  if (queue[index]?.id !== song.id) {
    const at = queue.findIndex((t) => t.id === song.id);
    if (at >= 0 && p.queueId === queueId) changes.index = at;
    else {
      // The queue itself comes with the look below.
      changes.queue = [song];
      changes.index = 0;
      changes.context = p.context ?? "";
      queueId = "";
      deviceLink?.look();
    }
  }
  usePlayer.setState(changes);
}

/** The other devices said something: who, if anybody, this phone shows. */
export function hearDevices(others: RemoteDevice[]): void {
  useDevices.setState({ others });
  // Music on a device of the network is this phone's own, playing or not.
  if (output !== Player) return;
  const { remote, isPlaying, playWhenReady } = usePlayer.getState();
  if (!remote && (isPlaying || playWhenReady)) return;
  const around = others.filter(isAround);
  const followed = remote ? around.find((d) => d.id === remote.id && d.presence.track) : undefined;
  const handedTo = followNext ? around.find((d) => d.id === followNext && d.presence.playing && d.presence.track) : undefined;
  if (handedTo) followNext = null;
  const playing = around.find((d) => d.presence.playing && d.presence.track);
  const stillWanted = followed && (followed.presence.playing || !followPausedSince || Date.now() - followPausedSince < FOLLOW_PAUSED_MS);
  // A pause a moment ago is a person between songs: their own queue stays until then.
  const idleHere = Date.now() - ownActivityAt > IDLE_BEFORE_TAKING_OVER_MS;
  const target = handedTo ?? (stillWanted ? followed : undefined) ?? (idleHere ? playing : undefined);
  if (target) follow(target);
  else if (remote) stopFollowing(false);
}

/** What another device asks of this one. */
export function runCommand(command: DeviceCommand): void {
  const player = usePlayer.getState();
  // Asked to play here: whatever this phone was showing, it's this phone's music now.
  if (player.remote && command.action !== "syncLikes" && command.action !== "enqueue") stopFollowing(false);
  switch (command.action) {
    case "play":
      if (!usePlayer.getState().playWhenReady) usePlayer.getState().toggle();
      break;
    case "pause":
      if (usePlayer.getState().playWhenReady) usePlayer.getState().toggle();
      break;
    case "next":
      usePlayer.getState().next();
      break;
    case "previous":
      usePlayer.getState().previous();
      break;
    case "seek":
      usePlayer.getState().seek(command.positionMs);
      break;
    case "jump": {
      const at = usePlayer.getState().queue.findIndex((t) => t.id === command.trackId);
      if (at >= 0) usePlayer.getState().skipTo(at);
      break;
    }
    case "enqueue": {
      const songs = command.tracks.map(findSong).filter((t): t is Track => !!t);
      if (songs.length) {
        if (command.next) usePlayer.getState().playNext(songs);
        else usePlayer.getState().addToQueue(songs);
      }
      break;
    }
    case "takeOver":
      void output.play();
      break;
    default:
      break;
  }
}

/** This phone as the other devices see it. */
export function phonePresence(): DevicePresence {
  const { queue, index, positionMs, durationMs, isPlaying, playWhenReady, context, remote, device } = usePlayer.getState();
  const track = queue[index];
  const model = String((Platform.constants as { Model?: string }).Model ?? "Phone");
  const name = device ? `${model} · ${device.name}` : model;
  if (remote || !track) return { name, kind: "phone", playing: false, positionMs: 0, durationMs: 0, track: null };
  return { name, kind: "phone", playing: isPlaying || playWhenReady, positionMs, durationMs, track: toWireTrack(track), queueId, context };
}

/* ------------------------------------------------------------- what other devices get to know */

/** A pause a moment ago is a person between songs, not somebody done here. */
const IDLE_BEFORE_TAKING_OVER_MS = 60_000;
/** While the other device plays on in the same song, this one looks up only now and then. */
const FOLLOW_EVERY_MS = 120_000;
const QUEUE_NOTE_BEHIND = 200;
const QUEUE_NOTE_AHEAD = 800;

/** the note this phone stands on: its own or one it took over */
let activityAt = 0;
/** when somebody last did something here */
let ownActivityAt = 0;
let adoptedAt = 0;
let queueId = "";
let tellSync: ((routine: boolean) => void) | null = null;

/** The sync's ear: `routine` is the tick while a song plays. */
export function onPlaybackActivity(listener: ((routine: boolean) => void) | null): void {
  tellSync = listener;
}

function activity(): void {
  activityAt = ownActivityAt = Date.now();
  tellSync?.(false);
}
function routineActivity(): void {
  activityAt = ownActivityAt = Date.now();
  tellSync?.(true);
}
function queueChanged(): void {
  queueId = String(Date.now());
  activity();
}

/** Where this phone stands, for the others. Nothing until it has done something itself. */
export function playbackNote(device: PlaybackNote["device"]): { note: PlaybackNote; queue: () => QueueDoc } | null {
  const { queue, index, positionMs, isPlaying, context, remote } = usePlayer.getState();
  const track = queue[index];
  // What another device plays is that device's to tell.
  if (!track || !activityAt || remote) return null;
  if (!queueId) queueId = String(activityAt);
  const id = queueId;
  return {
    note: { device, at: activityAt, playing: isPlaying, positionMs, track: toWireTrack(track), queueId: id, context, audio: [usePlayer.getState().audio, rateOff, downloadsLine()].filter(Boolean).join(" · ") },
    queue: () => ({
      id,
      context,
      tracks: queue.slice(Math.max(0, index - QUEUE_NOTE_BEHIND), index + QUEUE_NOTE_AHEAD).map(toWireTrack),
    }),
  };
}

export function wantsPlayback(note: PlaybackNote): boolean {
  const { playWhenReady, isPlaying, remote } = usePlayer.getState();
  if (output !== Player) return false;
  // The device being followed: every new song or queue of it, and nothing else of anybody.
  if (remote) return remote.id === note.device.id && note.queueId !== queueId;
  if (playWhenReady || isPlaying || !useLibrary.getState().loaded) return false;
  if (note.playing && inSameSong(note) && Date.now() - adoptedAt < FOLLOW_EVERY_MS) return false;
  return note.at > activityAt && Date.now() - ownActivityAt > IDLE_BEFORE_TAKING_OVER_MS;
}

function inSameSong(note: PlaybackNote): boolean {
  const { queue, index } = usePlayer.getState();
  return note.queueId === queueId && !!queue[index] && findSong(note.track)?.id === queue[index].id;
}

/** Continues from another device: its queue, its song, its position, paused until somebody presses play. */
export function adoptPlayback(note: PlaybackNote, queue: QueueDoc | null): void {
  const current = findSong(note.track);
  if (!current) return;
  adoptedAt = Date.now();
  branchAhead = null;
  // The same song a little further on: no need to load it again.
  if (inSameSong(note)) {
    activityAt = note.at;
    usePlayer.setState({ positionMs: note.positionMs });
    void output.seekTo(note.positionMs);
    save(true);
    return;
  }
  const { muted } = useLibrary.getState();
  const found = (queue?.tracks ?? [])
    .map(findSong)
    .filter((t): t is Track => !!t)
    .filter((t) => t.id === current.id || !muted.has(t.id));
  const list = found.some((t) => t.id === current.id) ? found : [current];
  const index = list.findIndex((t) => t.id === current.id);
  activityAt = note.at;
  queueId = note.queueId;
  usePlayer.setState({
    queue: list,
    index,
    context: queue?.context ?? note.context ?? "",
    positionMs: note.positionMs,
    durationMs: current.duration * 1000,
    shuffle: false,
    unshuffled: null,
    error: null,
  });
  // A device being followed keeps the sound: this phone only needs to know the list.
  if (!usePlayer.getState().remote) {
    void output.setQueue(list.map(toItem), index, note.positionMs, false);
    showStream();
  }
  save(true);
}

/** A dropped connection: the server may answer at its other address, then the song goes on from there. */
const RETRY_AFTER_MS = 8000;
let lastRetryAt = 0;

function afterDroppedConnection(message: string): void {
  void useConnection.getState().check().then((reach) => {
    if (reach === "offline" || Date.now() - lastRetryAt < RETRY_AFTER_MS) {
      usePlayer.setState({ error: reach === "offline" ? "Can't reach your server. Only downloaded music plays." : message });
      return;
    }
    lastRetryAt = Date.now();
    // Paused it stays paused: the next press of play loads it from where the server answers now.
    if (usePlayer.getState().playWhenReady) void output.play();
  });
}

/** Listens for the app's lifetime. */
export function watchPlayer(): void {
  Player.addListener("onState", (s) => {
    if (output === Player) onState(s);
  });
  // A song that just arrived on the phone, or one taken off it, changes what's coming up.
  useDownloads.subscribe((s, prev) => {
    if (s.kept === prev.kept) return;
    const { queue, index } = usePlayer.getState();
    const current = queue[index]?.id;
    // The file under the playing song is gone, and the next seek would miss it: on from the server, where one answers.
    const fileGone = !!current && !!prev.kept[current] && !s.kept[current] && useConnection.getState().reach !== "offline";
    refreshStreams(fileGone);
  });
  useConnection.subscribe((s, prev) => {
    if (s.metered !== prev.metered) refreshStreams(false);
  });
  // Muted just now, here or on another device: it's not coming up any more, and if it's on, it goes.
  useLibrary.subscribe((s, prev) => {
    if (s.muted === prev.muted) return;
    const newly = new Set([...s.muted].filter((id) => !prev.muted.has(id)));
    if (!newly.size) return;
    const { queue, index, remote } = usePlayer.getState();
    if (remote) return;
    const upcoming = queue.slice(index + 1);
    const left = upcoming.filter((t) => !newly.has(t.id));
    if (left.length !== upcoming.length) {
      usePlayer.setState({ queue: [...queue.slice(0, index + 1), ...left] });
      void output.replaceUpcoming(left.map(toItem));
      queueChanged();
      save(true);
    }
    if (queue[index] && newly.has(queue[index].id)) {
      if (left.length) usePlayer.getState().next();
      else void output.pause();
    }
  });
  Player.addListener("onError", ({ message, code }) => {
    if (output !== Player) return;
    // A server that can't make the smaller copy: the file itself, for as long as the app runs.
    // A connection that dropped says nothing about the server.
    const { queue, index, positionMs } = usePlayer.getState();
    const current = queue[index];
    if (/NETWORK|TIMEOUT/.test(code ?? "")) {
      afterDroppedConnection(message);
      return;
    }
    if (current && chosen.get(current.id)?.kind === "transcode") {
      transcodesWork = false;
      void output.replaceCurrent(toItem(current), positionMs);
      void output.play();
      refreshStreams(false);
      showStream();
      return;
    }
    usePlayer.setState({ error: message });
  });
}
