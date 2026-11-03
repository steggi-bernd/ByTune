/**
 * Player state — pure data; playback side effects live in lib/audio.ts.
 *
 * A song found in several places (a local file and its Jellyfin copy) is ONE
 * song here too: the queue never holds two copies of it, and "play this
 * song" finds it whichever copy it is handed. Which copy sounds is the
 * engine's business at play time (local first) — invisible to the queue.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { withoutOtherCopies } from "../lib/duplicates";
// Coalescing, lazily serialized storage: the engine bumps `position` ~4Hz and
// persist saves on every change — that would stringify the whole queue and
// hit disk/IPC several times a second.
import { lazyJSONStorage } from "../lib/persist";
import type { Track } from "../types";
import { songKey } from "./catalog";
import { isMuted } from "./muted";

export type RepeatMode = "off" | "all" | "one";

/** While somebody is choosing music for another device, what's asked for goes there (lib/zones.ts). */
let playHook: ((tracks: Track[], start: number) => boolean) | null = null;
export function setPlayHook(hook: typeof playHook): void {
  playHook = hook;
}

interface PlayerState {
  queue: Track[];
  index: number;
  playing: boolean;
  buffering: boolean;
  position: number;
  duration: number;
  /** 0..1 — how much of the current track the audio element has buffered */
  buffered: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** bumped whenever the engine should hard-seek to `position` */
  seekNonce: number;
  error: string | null;
  /** the copy each loaded track plays from (a local file or a server stream) — written by the engine */
  sources: Record<string, Track>;

  current(): Track | null;
  /** A song asked for, with its list after it. Muted ones in the list stay out; the asked-for one plays anyway. */
  playQueue(tracks: Track[], startIndex?: number): void;
  /** A whole list from its Play or Shuffle button: nothing in it is asked for by name, so nothing muted plays. */
  playAll(tracks: Track[], random?: boolean): void;
  playTrack(track: Track): void;
  addToQueue(tracks: Track | Track[], playNext?: boolean): void;
  /**
   * Songs into the queue at `at` (after the playing song at the earliest).
   * `dropCopies`: songs coming up that they already bring are dropped — each plays once.
   */
  insertInQueue(tracks: Track[], at: number, dropCopies?: boolean): void;
  removeAt(i: number): void;
  moveInQueue(from: number, to: number): void;
  clearUpcoming(): void;
  /** drop second copies of a song from the queue (e.g. one saved before the copies were merged) */
  collapseCopies(): void;
  next(manual?: boolean): void;
  prev(): void;
  toggle(): void;
  setPlaying(playing: boolean): void;
  seek(sec: number): void;
  setVolume(v: number): void;
  toggleMute(): void;
  toggleShuffle(): void;
  cycleRepeat(): void;

  /* internal setters used by the audio engine */
  _setTime(position: number, duration?: number): void;
  _setBuffered(ratio: number): void;
  _setBuffering(buffering: boolean): void;
  _setError(error: string | null): void;
  _setSource(trackId: string, version: Track): void;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
      queue: [],
      index: 0,
      playing: false,
      buffering: false,
      position: 0,
      duration: 0,
      buffered: 0,
      volume: 0.8,
      muted: false,
      shuffle: false,
      repeat: "off",
      seekNonce: 0,
      error: null,
      sources: {},

      current() {
        const { queue, index } = get();
        return queue[index] ?? null;
      },

      playQueue(tracks, startIndex = 0) {
        if (!tracks.length) return;
        if (playHook?.(tracks, startIndex)) return;
        const asked = tracks[clamp(startIndex, 0, tracks.length - 1)];
        const open = tracks.filter((t) => t === asked || !isMuted(t.id));
        // A list holding two copies of a song (a playlist with the local file
        // and its server copy) still queues it once — the clicked one stays.
        const { list, keep } = withoutOtherCopies(open, songKey, open.indexOf(asked));
        set({
          queue: list,
          index: Math.max(0, keep),
          playing: true,
          position: 0,
          error: null,
        });
      },

      playAll(tracks, random = false) {
        const open = tracks.filter((t) => !isMuted(t.id));
        if (open.length) get().playQueue(open, random ? Math.floor(Math.random() * open.length) : 0);
      },

      playTrack(track) {
        const { queue, index } = get();
        const key = songKey(track.id);
        const at = queue.findIndex((t) => songKey(t.id) === key);
        if (at >= 0) {
          set({ index: at, playing: true, position: 0, error: null });
        } else {
          const q = [...queue.slice(0, index + 1), track, ...queue.slice(index + 1)];
          set({ queue: q, index: index + 1, playing: true, position: 0, error: null });
        }
      },

      addToQueue(tracks, playNext = false) {
        const list = withoutOtherCopies(Array.isArray(tracks) ? tracks : [tracks], songKey).list;
        if (!list.length) return;
        const { queue, index } = get();
        if (!queue.length) {
          set({ queue: list, index: 0, playing: false, position: 0 });
          return;
        }
        if (playNext) {
          set({ queue: [...queue.slice(0, index + 1), ...list, ...queue.slice(index + 1)] });
        } else {
          set({ queue: [...queue, ...list] });
        }
      },

      insertInQueue(tracks, at, dropCopies = false) {
        const list = withoutOtherCopies(tracks, songKey).list;
        if (!list.length) return;
        const { queue, index } = get();
        if (!queue.length) {
          set({ queue: list, index: 0, playing: false, position: 0 });
          return;
        }
        const pos = clamp(Math.round(at), index + 1, queue.length);
        // What is coming up, either side of the new songs (the playing one stays as it is).
        const keys = new Set(list.map((t) => songKey(t.id)));
        const keep = (t: Track): boolean => !dropCopies || !keys.has(songKey(t.id));
        set({
          queue: [...queue.slice(0, index + 1), ...queue.slice(index + 1, pos).filter(keep), ...list, ...queue.slice(pos).filter(keep)],
        });
      },

      removeAt(i) {
        const { queue, index } = get();
        if (i < 0 || i >= queue.length) return;
        const q = queue.filter((_, j) => j !== i);
        let ni = index;
        if (i < index) ni = index - 1;
        else if (i === index) ni = Math.min(index, Math.max(q.length - 1, 0));
        set({ queue: q, index: ni });
      },

      moveInQueue(from, to) {
        const { queue, index } = get();
        if (from === to || from < 0 || to < 0 || from >= queue.length || to >= queue.length) return;
        const q = [...queue];
        const [moved] = q.splice(from, 1);
        q.splice(to, 0, moved);
        let ni = index;
        if (from === index) ni = to;
        else if (from > index && to <= index) ni = index + 1;
        else if (from < index && to >= index) ni = index - 1;
        set({ queue: q, index: ni });
      },

      clearUpcoming() {
        const { index } = get();
        set({ queue: get().queue.slice(0, index + 1) });
      },

      collapseCopies() {
        // The playing entry stays put (same object, same index offset), so
        // the engine never reloads it — only other copies of songs go.
        const { queue, index } = get();
        const { list, keep } = withoutOtherCopies(queue, songKey, index);
        if (list.length !== queue.length) set({ queue: list, index: Math.max(0, keep) });
      },

      next(manual = false) {
        const { queue, index, shuffle, repeat } = get();
        if (!queue.length) {
          set({ playing: false });
          return;
        }
        let ni: number;
        if (shuffle && queue.length > 1) {
          do {
            ni = Math.floor(Math.random() * queue.length);
          } while (ni === index);
        } else {
          ni = index + 1;
          if (ni >= queue.length) {
            if (manual || repeat === "all") {
              ni = 0;
            } else {
              set({ playing: false, position: 0 });
              return;
            }
          }
        }
        if (ni === index) {
          // Round to the very same song (a queue of one): it starts over — the
          // same index alone changes nothing the engine would act on.
          set({ playing: true, position: 0, error: null, seekNonce: get().seekNonce + 1 });
          return;
        }
        set({ index: ni, playing: true, position: 0, error: null });
      },

      prev() {
        if (get().position > 3) {
          set({ position: 0, seekNonce: get().seekNonce + 1 });
          return;
        }
        const { queue, index } = get();
        if (!queue.length) return;
        const ni = index > 0 ? index - 1 : queue.length - 1;
        if (ni === index) {
          set({ position: 0, seekNonce: get().seekNonce + 1 });
          return;
        }
        set({ index: ni, playing: true, position: 0, error: null });
      },

      toggle() {
        // Nothing to play or pause: flipping `playing` against an empty queue
        // left the play button reading "Pause" with no audio behind it.
        if (!get().queue.length) return;
        set({ playing: !get().playing });
      },

      setPlaying(playing) {
        // Mirrors toggle(): a media-key "play" with an empty queue (e.g.
        // after removing every queued track) must not flip the store into a
        // playing state nothing can back.
        if (playing && !get().queue.length) return;
        set({ playing });
      },

      seek(sec) {
        const { duration } = get();
        set({
          position: clamp(sec, 0, duration > 0 ? duration : sec),
          seekNonce: get().seekNonce + 1,
        });
      },

      setVolume(v) {
        set({ volume: clamp(v, 0, 1), muted: false });
      },

      toggleMute() {
        set({ muted: !get().muted });
      },

      toggleShuffle() {
        set({ shuffle: !get().shuffle });
      },

      cycleRepeat() {
        const order: RepeatMode[] = ["off", "all", "one"];
        set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
      },

      _setTime(position, duration) {
        const d = Number.isFinite(duration) && (duration ?? 0) > 0 ? (duration as number) : get().duration;
        set({ position, duration: d });
      },

      _setBuffered(buffered) {
        if (Math.abs(get().buffered - buffered) > 0.005) set({ buffered });
      },

      _setBuffering(buffering) {
        set({ buffering });
      },

      _setError(error) {
        set({ error });
      },

      _setSource(trackId, version) {
        // Only the decks' tracks matter: the current one and the one fading in.
        const { queue, index, sources } = get();
        const keep = new Set([trackId, queue[index]?.id, queue[index + 1]?.id]);
        const next: Record<string, Track> = {};
        for (const [id, v] of Object.entries(sources)) if (keep.has(id)) next[id] = v;
        next[trackId] = version;
        set({ sources: next });
      },
    }),
    {
      name: "player",
      // v1: the volume slider is perceptual (output gain = slider³, see
      // lib/audio.ts). The stored value used to BE the gain — move the slider
      // to the position that produces it, so nothing sounds different.
      version: 1,
      migrate: (persisted, version) => {
        const s = persisted as Partial<PlayerState> | null;
        if (s && version < 1 && typeof s.volume === "number" && Number.isFinite(s.volume)) {
          s.volume = Math.cbrt(clamp(s.volume, 0, 1));
        }
        return s as PlayerState;
      },
      storage: lazyJSONStorage<PlayerState>(),
      partialize: (s) =>
        ({
          queue: s.queue,
          index: s.index,
          position: s.position,
          volume: s.volume,
          muted: s.muted,
          shuffle: s.shuffle,
          repeat: s.repeat,
        }) as unknown as PlayerState,
    }
  )
);
