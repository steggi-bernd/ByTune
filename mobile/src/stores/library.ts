/**
 * The library on this phone: a copy of the server's song list, so the app
 * opens at once and works without the server, refreshed in the background;
 * and what the desktop's own builders make of it (albums, artists, mixes).
 */
import { create } from "zustand";
import { blurhashColor, type Rgb } from "../color";
import { artistPhotoUrl, fetchLibrary, markPlayed, setFavorite, type ServerLibrary, type Session } from "../jellyfin";
import { allMixes, buildAlbums, buildArtists, buildGenres, type LibAlbum, type LibArtist, type LibGenre, type Mix, type Track } from "../shared";
import { readJson, removeJson, writeJson } from "../storage";
import { useSession } from "./session";

const FILE = "library.json";

interface LibraryState {
  loaded: boolean;
  refreshing: boolean;
  error: string | null;
  data: ServerLibrary;
  byId: Map<string, Track>;
  albums: LibAlbum[];
  artists: LibArtist[];
  genres: LibGenre[];
  mixes: Mix[];
  favorites: Set<string>;
  restore(): Promise<void>;
  refresh(): Promise<void>;
  toggleFavorite(track: Track): void;
  notePlayed(track: Track): void;
  clear(): void;
}

const EMPTY: ServerLibrary = { tracks: [], hashes: {}, favorites: [], counts: {}, artistIds: {} };

function derive(data: ServerLibrary) {
  const albums = buildAlbums(data.tracks);
  return {
    data,
    byId: new Map(data.tracks.map((t) => [t.id, t])),
    albums,
    artists: buildArtists(data.tracks, albums),
    genres: buildGenres(data.tracks),
    // The sound analysis lives on the desktop: no Calm and Upbeat mixes here yet.
    mixes: allMixes(data.tracks, data.counts, () => undefined),
    favorites: new Set(data.favorites),
  };
}

const session = (): Session | null => useSession.getState().session;

export const useLibrary = create<LibraryState>((set, get) => ({
  loaded: false,
  refreshing: false,
  error: null,
  ...derive(EMPTY),

  async restore() {
    const saved = await readJson<ServerLibrary>(FILE);
    if (saved?.tracks) set({ ...derive(saved), loaded: true });
    void get().refresh();
  },

  async refresh() {
    const s = session();
    if (!s || get().refreshing) return;
    set({ refreshing: true, error: null });
    try {
      const data = await fetchLibrary(s);
      writeJson(FILE, data);
      set({ ...derive(data), loaded: true, refreshing: false });
    } catch (err) {
      set({ refreshing: false, loaded: true, error: err instanceof Error ? err.message : "The library did not load" });
    }
  },

  toggleFavorite(track) {
    const s = session();
    if (!s) return;
    const { data } = get();
    const liked = !data.favorites.includes(track.id);
    // The latest like comes first, as in Liked Songs on the desktop.
    const favorites = liked ? [track.id, ...data.favorites] : data.favorites.filter((id) => id !== track.id);
    const next = { ...data, favorites };
    writeJson(FILE, next);
    set({ data: next, favorites: new Set(favorites) });
    void setFavorite(s, track, liked).catch(() => {
      // The server said no: back to what it holds.
      const now = get().data;
      const restored = liked ? now.favorites.filter((id) => id !== track.id) : [track.id, ...now.favorites];
      set({ data: { ...now, favorites: restored }, favorites: new Set(restored) });
    });
  },

  notePlayed(track) {
    const s = session();
    if (!s) return;
    const { data } = get();
    const plays = (data.counts[track.id]?.plays ?? 0) + 1;
    const at = Date.now();
    const next = { ...data, counts: { ...data.counts, [track.id]: { plays, lastAt: at } } };
    set({ data: next });
    writeJson(FILE, next);
    void markPlayed(s, track, new Date(at)).catch(() => undefined);
  },

  clear() {
    removeJson(FILE);
    set({ ...derive(EMPTY), loaded: false, error: null });
  },
}));

/** The cover's colour for tints, when the server listed one. */
export function useCoverColor(thumb: string | undefined): Rgb | null {
  const hash = useLibrary((s) => (thumb ? s.data.hashes[thumb] : undefined));
  return blurhashColor(hash);
}

/** The artist's photo on the server, when it knows the artist. */
export function useArtistPhoto(name: string): string | null {
  const id = useLibrary((s) => s.data.artistIds[name.toLowerCase()]);
  const current = useSession((s) => s.session);
  return id && current ? artistPhotoUrl(current, id) : null;
}
