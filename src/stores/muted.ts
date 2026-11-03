/**
 * Muted songs: skipped wherever they come up, in an album, a playlist, a mix.
 * Only asked for by name (clicked, or put in the queue) they still play. The list
 * is the same on all devices (lib/homeSync.ts); a song counts with all its copies.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lazyJSONStorage } from "../lib/persist";
import type { Track } from "../types";
import { songKey } from "./catalog";

interface MutedState {
  tracks: Track[];
  /** when the list last changed; among devices the newest list wins */
  at: number;
  /** Mutes the song or takes that back; answers whether it's muted now. */
  toggle(track: Track): boolean;
  /** A newer list from another device. */
  apply(tracks: Track[], at: number): void;
}

export const useMuted = create<MutedState>()(
  persist(
    (set, get) => ({
      tracks: [],
      at: 0,
      toggle(track) {
        const key = songKey(track.id);
        const others = get().tracks.filter((t) => songKey(t.id) !== key);
        const nowMuted = others.length === get().tracks.length;
        set({ tracks: nowMuted ? [track, ...others] : others, at: Date.now() });
        return nowMuted;
      },
      apply: (tracks, at) => set({ tracks, at }),
    }),
    {
      name: "muted",
      storage: lazyJSONStorage<MutedState>(),
      partialize: (s) => ({ tracks: s.tracks, at: s.at }) as unknown as MutedState,
    }
  )
);

let keysFor: Track[] | null = null;
let keys = new Set<string>();

/** Rows ask for every song they show: rebuilt only when the list changes. */
function mutedKeys(tracks: Track[]): Set<string> {
  if (keysFor !== tracks) {
    keysFor = tracks;
    keys = new Set(tracks.map((t) => songKey(t.id)));
  }
  return keys;
}

export const isMuted = (id: string): boolean => mutedKeys(useMuted.getState().tracks).has(songKey(id));

export const useIsMuted = (id: string): boolean => useMuted((s) => mutedKeys(s.tracks).has(songKey(id)));
