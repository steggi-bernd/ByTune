/**
 * The queue and what the native player is doing. This store owns the queue's
 * order and tells the player every change; shuffling reorders what comes
 * next, so the list on screen is what actually plays.
 *
 * Where playback stopped is kept on the phone and restored paused at the next
 * start, and the sync service carries the same note between devices: a phone
 * that isn't playing continues from where another device stopped.
 */
import { ToastAndroid } from "react-native";
import { create } from "zustand";
import Player, { type PlaybackState, type QueueItem, type RepeatMode } from "../../modules/media3-player";
import { streamUrl, type Session } from "../jellyfin";
import { withoutServer } from "../addresses";
import { chooseStream, levelGain, ORIGINAL, sameChoice, stepDown, type Leveling, type QualityMode, type StreamChoice } from "../quality";
import { playCreditSeconds, toWireTrack, type PlaybackNote, type QueueDoc, type Track } from "../shared";
import { readJson, writeJson } from "../storage";
import { useConnection } from "./connection";
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

interface PlayerState {
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
  playTracks(tracks: Track[], start: number, context: string, shuffle?: boolean): void;
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

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const SLEEP_STEPS = [15, 30, 60];

export const usePlayer = create<PlayerState>((set, get) => ({
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
    void Player.setGain(levelGain(current.rg?.trackGain, leveling) ?? 0);
    void Player.replaceUpcoming(queue.slice(index + 1).map(toItem));
  },

  playTracks(all, start, context, shuffle = get().shuffle) {
    // Without a way to the server only what's on the phone can play.
    const { kept } = useDownloads.getState();
    const offline = useConnection.getState().reach === "offline";
    const tracks = offline ? all.filter((t) => kept[t.id]) : all;
    if (!tracks.length) {
      if (offline && all.length) ToastAndroid.show("Your server is out of reach, and this isn't downloaded", ToastAndroid.SHORT);
      return;
    }
    let queue = tracks;
    let index = offline ? Math.max(0, tracks.indexOf(all[start])) : Math.max(0, Math.min(start, tracks.length - 1));
    if (shuffle) {
      queue = [tracks[index], ...shuffled(tracks.filter((_, i) => i !== index))];
      index = 0;
    }
    set({ queue, index, context, shuffle, unshuffled: shuffle ? tracks : null, positionMs: 0, error: null });
    void Player.setQueue(queue.map(toItem), index, 0, true);
    showStream();
    queueChanged();
    save(true);
  },

  toggle() {
    if (get().playWhenReady) void Player.pause();
    else if (get().queue.length) void Player.play();
  },
  next() {
    jumpedAt = Date.now();
    void Player.next();
    activity();
  },
  previous() {
    jumpedAt = Date.now();
    void Player.previous();
    activity();
  },
  seek(ms) {
    jumpedAt = Date.now();
    set({ positionMs: ms });
    void Player.seekTo(ms);
    activity();
  },
  skipTo(index) {
    jumpedAt = Date.now();
    void Player.skipTo(index, true);
    activity();
  },
  skipBy(delta) {
    const { queue, index, playWhenReady } = get();
    if (!queue.length) return;
    const target = (index + delta + queue.length) % queue.length;
    skipTarget = target;
    skipUntil = Date.now() + SKIP_PATIENCE_MS;
    jumpedAt = Date.now();
    set({ index: target, positionMs: 0, durationMs: queue[target].duration * 1000, error: null });
    void Player.skipTo(target, playWhenReady);
    activity();
    save(true);
  },

  cycleRepeat() {
    const order: RepeatMode[] = ["off", "all", "one"];
    const repeat = order[(order.indexOf(get().repeat) + 1) % order.length];
    set({ repeat });
    void Player.setRepeat(repeat);
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
      void Player.replaceUpcoming(upcoming.map(toItem));
    } else {
      // The list's own order again, from the song playing on.
      const list = unshuffled ?? queue;
      const at = list.findIndex((t) => t.id === current.id);
      const upcoming = at >= 0 ? list.slice(at + 1) : [];
      set({ shuffle: false, unshuffled: null, queue: [...queue.slice(0, index + 1), ...upcoming] });
      void Player.replaceUpcoming(upcoming.map(toItem));
    }
    queueChanged();
    save(true);
  },

  addToQueue(tracks) {
    if (!get().queue.length) {
      get().playTracks(tracks, 0, "Queue");
      return;
    }
    set({ queue: [...get().queue, ...tracks] });
    void Player.addItems(tracks.map(toItem));
    queueChanged();
    save(true);
  },

  removeAt(index) {
    const { queue, index: current } = get();
    if (index === current) return;
    set({ queue: queue.filter((_, i) => i !== index), index: index < current ? current - 1 : current });
    void Player.removeItem(index);
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
    void Player.moveItem(from, to);
    queueChanged();
    save(true);
  },

  clearUpcoming() {
    const { queue, index } = get();
    set({ queue: queue.slice(0, index + 1) });
    void Player.replaceUpcoming([]);
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
    await Player.setQueue(queue.map(toItem), index, saved.positionMs, false);
    showStream();
    await Player.setRepeat(saved.repeat ?? "off");
  },

  stop() {
    void Player.pause();
    void Player.setQueue([], 0, 0, false);
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

function onState(s: PlaybackState): void {
  if (skipTarget !== null) {
    if (s.index !== skipTarget && Date.now() < skipUntil) return;
    skipTarget = null;
  }
  const prev = usePlayer.getState();
  bandwidthBps = s.bandwidthBps ?? 0;
  watchStalls(s);
  watchRate(s);
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
    void Player.pause();
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
    void Player.replaceCurrent(toItem(current), positionMs);
    showStream();
  }
  const upcoming = queue.slice(index + 1);
  if (upcoming.some((t) => !sameChoice(chosen.get(t.id), choiceFor(t)))) void Player.replaceUpcoming(upcoming.map(toItem));
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
  const { queue, index, positionMs, isPlaying, context } = usePlayer.getState();
  const track = queue[index];
  if (!track || !activityAt) return null;
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
  const { playWhenReady, isPlaying } = usePlayer.getState();
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
  // The same song a little further on: no need to load it again.
  if (inSameSong(note)) {
    activityAt = note.at;
    usePlayer.setState({ positionMs: note.positionMs });
    void Player.seekTo(note.positionMs);
    save(true);
    return;
  }
  const found = (queue?.tracks ?? []).map(findSong).filter((t): t is Track => !!t);
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
  void Player.setQueue(list.map(toItem), index, note.positionMs, false);
  showStream();
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
    if (usePlayer.getState().playWhenReady) void Player.play();
  });
}

/** Listens for the app's lifetime. */
export function watchPlayer(): void {
  Player.addListener("onState", onState);
  // A song that just arrived on the phone, or one taken off it, changes what's coming up.
  useDownloads.subscribe((s, prev) => {
    if (s.kept !== prev.kept) refreshStreams(false);
  });
  useConnection.subscribe((s, prev) => {
    if (s.metered !== prev.metered) refreshStreams(false);
  });
  Player.addListener("onError", ({ message, code }) => {
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
      void Player.replaceCurrent(toItem(current), positionMs);
      void Player.play();
      refreshStreams(false);
      showStream();
      return;
    }
    usePlayer.setState({ error: message });
  });
}
