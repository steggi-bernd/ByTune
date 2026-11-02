/**
 * The user's album corrections (lib/albumEdits.ts), persisted. The catalogue
 * re-applies them on every change, so an edit shows everywhere at once —
 * album and artist pages, the discography, the library panel, search.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "../lib/persist";
import { withMerge, withSplit, type AlbumEdits, type SongEdit } from "../lib/albumEdits";

interface AlbumEditsState extends AlbumEdits {
  /** an album's artist credit line; null goes back to its tags */
  setArtists(key: string, credit: string | null): void;
  merge(from: string, into: string): void;
  split(from: string): void;
  /** show an artist name as another spelling; null shows it as tagged again */
  setAlias(name: string, as: string | null): void;
  /** put songs on an album by hand, by song id (every copy's) */
  setSongs(edits: Record<string, SongEdit>): void;
  /** take songs off the album they were put on by hand */
  clearSongs(ids: string[]): void;
}

export const useAlbumEdits = create<AlbumEditsState>()(
  persist(
    (set) => ({
      artists: {},
      mergedInto: {},
      aliases: {},
      songs: {},

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

      setAlias(name, as) {
        set((s) => {
          const aliases = { ...s.aliases };
          if (as && as !== name) aliases[name] = as;
          else delete aliases[name];
          // A name others pointed at now points on: no chains.
          for (const [from, to] of Object.entries(aliases)) if (to === name && as && as !== name) aliases[from] = as;
          return { aliases };
        });
      },

      setSongs(edits) {
        set((s) => ({ songs: { ...(s.songs ?? {}), ...edits } }));
      },

      clearSongs(ids) {
        set((s) => {
          const songs = { ...(s.songs ?? {}) };
          for (const id of ids) delete songs[id];
          return { songs };
        });
      },
    }),
    {
      name: "album-edits",
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({ artists: s.artists, mergedInto: s.mergedInto, aliases: s.aliases, songs: s.songs }) as unknown as AlbumEditsState,
    }
  )
);
