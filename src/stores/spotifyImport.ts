/**
 * The Spotify import: the parsed export, what the user decided about
 * uncertain matches, and which songs "Add to Liked Songs" brought over. Persisted, so the import survives a restart — buy songs over a few
 * days, come back, add again. The matches themselves are worked out live
 * from the catalogue (lib/spotifyImport.ts), so songs added to the library
 * meanwhile move from "Missing" to "In your library" by themselves.
 *
 * Decisions are kept by the song's Spotify identity (entryKey), not by its
 * row: they still apply to a fresh export of the same Liked Songs, and
 * "Start over" keeps them.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "../lib/persist";
import { parseSpotifyExport, type SpotifyEntry } from "../lib/spotifyImport";

/** Far more than any Liked Songs export — guards the renderer against a wrong pick. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

interface SpotifyImportState {
  fileName: string | null;
  entries: SpotifyEntry[];
  /** the export carries like dates, so the order is Spotify's own */
  dated: boolean;
  error: string | null;
  /** entryKey → the user's verdict on an uncertain match */
  verdicts: Record<string, "same" | "different">;
  /** entryKey → the library song id the user picked by hand */
  picks: Record<string, string>;
  /** library song ids every "Add to Liked Songs" so far laid out */
  likedIds: string[];
  load(file: File): Promise<void>;
  setVerdict(key: string, verdict: "same" | "different" | null): void;
  setVerdicts(keys: string[], verdict: "same" | "different"): void;
  pick(key: string, trackId: string | null): void;
  noteLiked(ids: string[]): void;
  /** forget the file; the decisions stay for the next export */
  reset(): void;
}

export const useSpotifyImport = create<SpotifyImportState>()(
  persist(
    (set) => ({
      fileName: null,
      entries: [],
      dated: false,
      error: null,
      verdicts: {},
      picks: {},
      likedIds: [],

      async load(file) {
        if (file.size > MAX_FILE_BYTES) {
          set({ error: "That file is far too large for a Liked Songs export." });
          return;
        }
        try {
          const { entries, dated } = parseSpotifyExport(await file.text(), file.name);
          set({ fileName: file.name, entries, dated, error: null });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : "Couldn't read that file." });
        }
      },

      setVerdict(key, verdict) {
        set((s) => {
          const verdicts = { ...s.verdicts };
          if (verdict) verdicts[key] = verdict;
          else delete verdicts[key];
          return { verdicts };
        });
      },

      setVerdicts(keys, verdict) {
        set((s) => {
          const verdicts = { ...s.verdicts };
          for (const k of keys) verdicts[k] = verdict;
          return { verdicts };
        });
      },

      pick(key, trackId) {
        set((s) => {
          const picks = { ...s.picks };
          if (trackId) picks[key] = trackId;
          else delete picks[key];
          return { picks };
        });
      },

      noteLiked(ids) {
        // All of them, not just the last add's: a song an import brought that
        // later drops out of the export goes below the import, never on top as
        // a like made here — however many adds later that happens.
        set((s) => ({ likedIds: [...new Set([...s.likedIds, ...ids])] }));
      },

      reset() {
        set({ fileName: null, entries: [], dated: false, error: null });
      },
    }),
    {
      name: "spotify-import",
      storage: createJSONStorage(() => storage),
      partialize: (s) =>
        ({
          fileName: s.fileName,
          entries: s.entries,
          dated: s.dated,
          verdicts: s.verdicts,
          picks: s.picks,
          likedIds: s.likedIds,
        }) as unknown as SpotifyImportState,
    }
  )
);
