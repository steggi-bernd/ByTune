/**
 * The Spotify import in progress: the parsed export and the user's verdicts
 * on uncertain matches. Session-only. The matches themselves are worked out
 * live from the catalogue (lib/spotifyImport.ts), so songs added to the
 * library meanwhile move from "missing" to "in your library" by themselves.
 */
import { create } from "zustand";
import { parseSpotifyExport, type SpotifyEntry } from "../lib/spotifyImport";

/** Far more than any Liked Songs export — guards the renderer against a wrong pick. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

interface SpotifyImportState {
  fileName: string | null;
  entries: SpotifyEntry[];
  /** the export carries like dates, so the order is Spotify's own */
  dated: boolean;
  error: string | null;
  /** uncertain matches the user called the same song (true) or a different one (false), by entry index */
  verdicts: Record<number, boolean>;
  load(file: File): Promise<void>;
  setVerdict(index: number, same: boolean): void;
  setVerdicts(indices: number[], same: boolean): void;
  reset(): void;
}

export const useSpotifyImport = create<SpotifyImportState>((set) => ({
  fileName: null,
  entries: [],
  dated: false,
  error: null,
  verdicts: {},

  async load(file) {
    if (file.size > MAX_FILE_BYTES) {
      set({ error: "That file is far too large for a Liked Songs export." });
      return;
    }
    try {
      const { entries, dated } = parseSpotifyExport(await file.text(), file.name);
      set({ fileName: file.name, entries, dated, error: null, verdicts: {} });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Couldn't read that file." });
    }
  },

  setVerdict(index, same) {
    set((s) => ({ verdicts: { ...s.verdicts, [index]: same } }));
  },

  setVerdicts(indices, same) {
    set((s) => {
      const verdicts = { ...s.verdicts };
      for (const i of indices) verdicts[i] = same;
      return { verdicts };
    });
  },

  reset() {
    set({ fileName: null, entries: [], dated: false, error: null, verdicts: {} });
  },
}));
