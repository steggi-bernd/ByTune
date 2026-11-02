/**
 * The library panel's own order (components/Sidebar.tsx): when each album,
 * playlist and Liked Songs last played — the "Recently played" sort, kept by
 * lib/recentlyPlayed.ts — the albums and smart playlists pinned to the top
 * (playlists and Liked Songs keep their pins in the library), and the order
 * the pinned rows were dragged into.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lazyJSONStorage } from "../lib/persist";

/** The panel needs the latest few hundred played times, not every album ever. */
const MAX_PLAYED = 400;

interface LibraryOrderState {
  /** row id → when it last played, ms */
  played: Record<string, number>;
  /** albums and smart playlists pinned to the top, by row id */
  pins: string[];
  /** the pinned rows' order, top first, by row id */
  pinOrder: string[];
  /** the played times were started from the listening history (once) */
  seeded: boolean;
  touch(id: string, at?: number): void;
  /** the history's played times, under any kept since */
  seed(played: Record<string, number>): void;
  togglePin(id: string): void;
  setPinOrder(ids: string[]): void;
}

function newest(played: Record<string, number>): Record<string, number> {
  const ids = Object.keys(played);
  if (ids.length <= MAX_PLAYED) return played;
  return Object.fromEntries(ids.sort((a, b) => played[b] - played[a]).slice(0, MAX_PLAYED).map((id) => [id, played[id]]));
}

export const useLibraryOrder = create<LibraryOrderState>()(
  persist(
    (set, get) => ({
      played: {},
      pins: [],
      pinOrder: [],
      seeded: false,
      touch(id, at = Date.now()) {
        set({ played: newest({ ...get().played, [id]: at }) });
      },
      seed(played) {
        set({ played: newest({ ...played, ...get().played }), seeded: true });
      },
      togglePin(id) {
        const { pins, pinOrder } = get();
        set(
          pins.includes(id)
            ? { pins: pins.filter((x) => x !== id), pinOrder: pinOrder.filter((x) => x !== id) }
            : { pins: [...pins, id] }
        );
      },
      setPinOrder(pinOrder) {
        set({ pinOrder });
      },
    }),
    {
      name: "library-order",
      storage: lazyJSONStorage(),
      partialize: (s) => ({ played: s.played, pins: s.pins, pinOrder: s.pinOrder, seeded: s.seeded }),
    }
  )
);
