/**
 * The library on this phone: a copy of the server's song list, so the app
 * opens at once and works without the server, refreshed in the background;
 * and what the desktop's own builders make of it (albums, artists, mixes).
 */
import { create } from "zustand";
import { blurhashColor, type Rgb } from "../color";
import { artistPhotoUrl, fetchLibrary, markPlayed, setFavorite, type ServerLibrary, type Session } from "../jellyfin";
import { allMixes, buildAlbums, buildArtists, buildGenres, likedInOrder, songFinder, type LibAlbum, type LibArtist, type LibGenre, type Mix, type Track, type WireTrack } from "../shared";
import { readJson, removeJson, writeJson } from "../storage";
import { useConnection } from "./connection";
import { useSession } from "./session";

const FILE = "library.json";
const LIKED_ORDER_FILE = "liked-order.json";

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
  /** Liked Songs as the computer arranged them; the server's favorites have no order */
  likedOrder: WireTrack[];
  restore(): Promise<void>;
  refresh(): Promise<void>;
  setLikedOrder(order: WireTrack[]): void;
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

/** The server lists its favorites by artist and album: what stood here keeps its place, what's new comes on top. */
function keepPlaces(before: string[], listed: string[]): string[] {
  const known = new Set(before);
  const still = new Set(listed);
  return [...listed.filter((id) => !known.has(id)), ...before.filter((id) => still.has(id))];
}

function arranged(data: ServerLibrary, order: WireTrack[]): ServerLibrary {
  return order.length ? { ...data, favorites: likedInOrder(data.favorites, order, songFinder(data.tracks)) } : data;
}

export const useLibrary = create<LibraryState>((set, get) => ({
  loaded: false,
  refreshing: false,
  error: null,
  likedOrder: [],
  ...derive(EMPTY),

  async restore() {
    const [saved, likedOrder] = await Promise.all([readJson<ServerLibrary>(FILE), readJson<WireTrack[]>(LIKED_ORDER_FILE)]);
    if (likedOrder) set({ likedOrder });
    if (saved?.tracks) set({ ...derive(saved), loaded: true });
    void get().refresh();
  },

  async refresh() {
    if (!session() || get().refreshing) return;
    set({ refreshing: true, error: null });
    try {
      // The address may have moved, or there may be no way to the server at all.
      const reach = await useConnection.getState().check();
      const s = session();
      if (!s || reach === "offline") {
        set({ refreshing: false, loaded: true, error: "Can't reach your server" });
        return;
      }
      const listed = await fetchLibrary(s);
      const data = arranged({ ...listed, favorites: keepPlaces(get().data.favorites, listed.favorites) }, get().likedOrder);
      writeJson(FILE, data);
      set({ ...derive(data), loaded: true, refreshing: false });
    } catch (err) {
      set({ refreshing: false, loaded: true, error: err instanceof Error ? err.message : "The library did not load" });
    }
  },

  setLikedOrder(likedOrder) {
    writeJson(LIKED_ORDER_FILE, likedOrder);
    const data = arranged(get().data, likedOrder);
    writeJson(FILE, data);
    set({ likedOrder, data });
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
    removeJson(LIKED_ORDER_FILE);
    set({ ...derive(EMPTY), likedOrder: [], loaded: false, error: null });
  },
}));

// Back within reach: what changed in the meantime.
useConnection.subscribe((s, prev) => {
  if (prev.reach === "offline" && s.reach !== "offline") void useLibrary.getState().refresh();
});

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
