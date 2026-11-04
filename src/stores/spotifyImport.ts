/**
 * The Spotify import: the parsed export, what the user decided about
 * uncertain matches, and which songs "Add to Liked Songs" brought over —
 * and beside it a playlist being recovered (its own file, the ByTune
 * playlist it goes into). Persisted, so the import survives a restart — buy
 * songs over a few days, come back, add again. The matches themselves are worked out live
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
import { parsePlaylistExport, parseSpotifyExport, type SpotifyEntry, type SpotifyPlaylist } from "../lib/spotifyImport";
import { T } from "../lib/i18n";

/** Far more than any Liked Songs export — guards the renderer against a wrong pick. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** A Spotify playlist being recovered. */
export interface PlaylistImport {
  fileName: string;
  /** its name in Spotify — the ByTune playlist's, when the import makes one */
  name: string;
  entries: SpotifyEntry[];
  /** the ByTune playlist its songs go into; none yet: the first add makes one */
  playlistId?: string;
}

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
  /** the playlist being recovered */
  playlist: PlaylistImport | null;
  /** a data download holds every playlist: the ones to pick from (not kept) */
  playlistChoices: { fileName: string; lists: SpotifyPlaylist[]; into?: string } | null;
  playlistError: string | null;
  load(file: File): Promise<void>;
  /** a playlist export, to go into `into` (a ByTune playlist) or a new one */
  loadPlaylist(file: File, into?: string): Promise<void>;
  /** of a data download's playlists, recover this one */
  choosePlaylist(index: number): void;
  /** the ByTune playlist the import made */
  notePlaylist(playlistId: string): void;
  /** forget the playlist file */
  resetPlaylist(): void;
  setVerdict(key: string, verdict: "same" | "different" | null): void;
  setVerdicts(keys: string[], verdict: "same" | "different"): void;
  pick(key: string, trackId: string | null): void;
  noteLiked(ids: string[]): void;
  /** forget the file; the decisions stay for the next export */
  reset(): void;
}

export const useSpotifyImport = create<SpotifyImportState>()(
  persist(
    (set, get) => ({
      fileName: null,
      entries: [],
      dated: false,
      error: null,
      verdicts: {},
      picks: {},
      likedIds: [],
      playlist: null,
      playlistChoices: null,
      playlistError: null,

      async load(file) {
        if (file.size > MAX_FILE_BYTES) {
          set({ error: T("That file is far too large for a Liked Songs export.") });
          return;
        }
        try {
          const { entries, dated } = parseSpotifyExport(await file.text(), file.name);
          set({ fileName: file.name, entries, dated, error: null });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : T("Couldn't read that file.") });
        }
      },

      async loadPlaylist(file, into) {
        if (file.size > MAX_FILE_BYTES) {
          set({ playlistError: T("That file is far too large for a playlist export.") });
          return;
        }
        try {
          const lists = parsePlaylistExport(await file.text(), file.name);
          if (lists.length === 1) {
            set({ playlist: { fileName: file.name, ...lists[0], playlistId: into }, playlistChoices: null, playlistError: null });
          } else {
            set({ playlistChoices: { fileName: file.name, lists, into }, playlistError: null });
          }
        } catch (err) {
          set({ playlistError: err instanceof Error ? err.message : T("Couldn't read that file.") });
        }
      },

      choosePlaylist(index) {
        const choices = get().playlistChoices;
        const list = choices?.lists[index];
        if (!choices || !list) return;
        set({ playlist: { fileName: choices.fileName, name: list.name, entries: list.entries, playlistId: choices.into }, playlistChoices: null });
      },

      notePlaylist(playlistId) {
        const current = get().playlist;
        if (current) set({ playlist: { ...current, playlistId } });
      },

      resetPlaylist() {
        set({ playlist: null, playlistChoices: null, playlistError: null });
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
          playlist: s.playlist,
        }) as unknown as SpotifyImportState,
    }
  )
);
