/**
 * The user's album corrections (lib/albumEdits.ts), persisted. The catalogue
 * re-applies them on every change, so an edit shows everywhere at once —
 * album and artist pages, the discography, the library panel, search.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "../lib/persist";
import { withMerge, withSplit, type AlbumEdits } from "../lib/albumEdits";

interface AlbumEditsState extends AlbumEdits {
  /** an album's artist credit line; null goes back to its tags */
  setArtists(key: string, credit: string | null): void;
  merge(from: string, into: string): void;
  split(from: string): void;
}

export const useAlbumEdits = create<AlbumEditsState>()(
  persist(
    (set) => ({
      artists: {},
      mergedInto: {},

      setArtists(key, credit) {
        set((s) => {
          const artists = { ...s.artists };
          const clean = credit?.trim();
          if (clean) artists[key] = clean;
          else delete artists[key];
          return { artists };
        });
      },

      merge(from, into) {
        set((s) => ({ mergedInto: withMerge(s.mergedInto, from, into) }));
      },

      split(from) {
        set((s) => ({ mergedInto: withSplit(s.mergedInto, from) }));
      },
    }),
    {
      name: "album-edits",
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({ artists: s.artists, mergedInto: s.mergedInto }) as unknown as AlbumEditsState,
    }
  )
);
