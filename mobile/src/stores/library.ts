/**
 * The library on this phone: a copy of the server's song list, so the app
 * opens at once and works without the server, refreshed in the background;
 * and what the desktop's own builders make of it (albums, artists, mixes).
 */
import { create } from "zustand";
import { blurhashColor, type Rgb } from "../color";
import { artistPhotoUrl, fetchLibrary, isNoAnswer, markPlayed, setFavorite, type ServerLibrary, type Session } from "../jellyfin";
import { allMixes, buildAlbums, buildArtists, buildGenres, likedInOrder, oneCopyEach, sameSong, songFinder, songIdentity, toWireTrack, type LibAlbum, type LibArtist, type LibGenre, type Mix, type Track, type WireTrack } from "../shared";
import { readJson, removeJson, writeJson } from "../storage";
import { useConnection } from "./connection";
import { useSession } from "./session";

const FILE = "library.json";
const LIKED_ORDER_FILE = "liked-order.json";
const OUTBOX_FILE = "outbox.json";
const MUTED_FILE = "muted.json";

/** Likes and plays from while the server was out of reach, for when it's back. */
interface Outbox {
  likes: Record<string, boolean>;
  plays: { id: string; at: number }[];
}

let outbox: Outbox = { likes: {}, plays: [] };

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
  /** songs that are skipped unless asked for by name: every copy's id */
  muted: Set<string>;
  /** the same as a list for other devices, one entry per song */
  mutedTracks: WireTrack[];
  /** when that list last changed; the newest list wins */
  mutedAt: number;
  /** Mutes the song or takes that back; answers whether it's muted now. */
  toggleMuted(track: Track): boolean;
  /** A newer list from another device. */
  applyMuted(tracks: WireTrack[], at: number): void;
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

/** What the server hears next time; its list until then doesn't know yet. */
function withOutbox(favorites: string[]): string[] {
  const liked = Object.keys(outbox.likes).filter((id) => outbox.likes[id] && !favorites.includes(id));
  return [...liked, ...favorites.filter((id) => outbox.likes[id] !== false)];
}

/** Whatever the server refuses is dropped: only no answer at all keeps a thing for later. */
async function sendOutbox(s: Session, byId: Map<string, Track>): Promise<void> {
  if (!Object.keys(outbox.likes).length && !outbox.plays.length) return;
  try {
    for (const [id, liked] of Object.entries(outbox.likes)) {
      const track = byId.get(id);
      if (track) await setFavorite(s, track, liked).catch((err) => { if (isNoAnswer(err)) throw err; });
      delete outbox.likes[id];
    }
    while (outbox.plays.length) {
      const { id, at } = outbox.plays[0];
      const track = byId.get(id);
      if (track) await markPlayed(s, track, new Date(at)).catch((err) => { if (isNoAnswer(err)) throw err; });
      outbox.plays.shift();
    }
  } catch {
    /* gone again: the rest next time */
  }
  writeJson(OUTBOX_FILE, outbox);
}

/** The server lists its favorites by artist and album: what stood here keeps its place, what's new comes on top. */
function keepPlaces(before: string[], listed: string[]): string[] {
  const known = new Set(before);
  const still = new Set(listed);
  return [...listed.filter((id) => !known.has(id)), ...before.filter((id) => still.has(id))];
}

function arranged(data: ServerLibrary, order: WireTrack[]): ServerLibrary {
  if (!order.length) return data;
  const byId = new Map(data.tracks.map((t) => [t.id, t]));
  return { ...data, favorites: likedInOrder(data.favorites, order, songFinder(data.tracks), (id) => byId.get(id)) };
}

/** Every copy of a song on the server: what the computer counts as one song counts as one here too. */
function copiesOf(track: Track, tracks: Track[]): Track[] {
  const key = songIdentity(track);
  const copies = tracks.filter((t) => t.id === track.id || (songIdentity(t) === key && sameSong(t, track)));
  return copies.length ? copies : [track];
}

/** Liked Songs as a list: two copies of one song show once. */
export const likedSongIds = (favorites: string[], byId: Map<string, Track>): string[] => oneCopyEach(favorites, (id) => byId.get(id));

function mutedIds(wires: WireTrack[], tracks: Track[]): Set<string> {
  const find = songFinder(tracks);
  const ids = new Set<string>();
  for (const wire of wires) {
    const song = find(wire);
    if (song) for (const copy of copiesOf(song, tracks)) ids.add(copy.id);
    else ids.add(wire.id);
  }
  return ids;
}

export const useLibrary = create<LibraryState>((set, get) => ({
  loaded: false,
  refreshing: false,
  error: null,
  likedOrder: [],
  muted: new Set<string>(),
  mutedTracks: [],
  mutedAt: 0,
  ...derive(EMPTY),

  async restore() {
    const [saved, likedOrder, savedOutbox, savedMuted] = await Promise.all([
      readJson<ServerLibrary>(FILE),
      readJson<WireTrack[]>(LIKED_ORDER_FILE),
      readJson<Outbox>(OUTBOX_FILE),
      readJson<{ at: number; tracks: WireTrack[] }>(MUTED_FILE),
    ]);
    if (likedOrder) set({ likedOrder });
    if (savedOutbox) outbox = savedOutbox;
    if (saved?.tracks) set({ ...derive(saved), loaded: true });
    if (savedMuted) set({ mutedTracks: savedMuted.tracks, mutedAt: savedMuted.at, muted: mutedIds(savedMuted.tracks, saved?.tracks ?? []) });
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
      await sendOutbox(s, get().byId);
      const listed = await fetchLibrary(s);
      const data = arranged({ ...listed, favorites: withOutbox(keepPlaces(get().data.favorites, listed.favorites)) }, get().likedOrder);
      writeJson(FILE, data);
      set({ ...derive(data), loaded: true, refreshing: false, muted: mutedIds(get().mutedTracks, data.tracks) });
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
    // Every copy on the server: the computer counts them as one song.
    const copies = copiesOf(track, data.tracks);
    const copyIds = new Set(copies.map((t) => t.id));
    const others = data.favorites.filter((id) => !copyIds.has(id));
    // The latest like comes first, as in Liked Songs on the desktop.
    const favorites = liked ? [...copyIds, ...others] : others;
    const next = { ...data, favorites };
    writeJson(FILE, next);
    set({ data: next, favorites: new Set(favorites) });
    // Changed again before the server heard: the older wish must not come back after a restart.
    if (copies.some((t) => t.id in outbox.likes)) {
      for (const t of copies) delete outbox.likes[t.id];
      writeJson(OUTBOX_FILE, outbox);
    }
    for (const copy of copies) {
      void setFavorite(s, copy, liked)
        .then(() => tellLikes?.())
        .catch((err) => {
          if (isNoAnswer(err)) {
            outbox.likes[copy.id] = liked;
            writeJson(OUTBOX_FILE, outbox);
            return;
          }
          // The server said no: back to what it holds.
          const now = get().data;
          const restored = liked ? now.favorites.filter((id) => id !== copy.id) : [copy.id, ...now.favorites];
          set({ data: { ...now, favorites: restored }, favorites: new Set(restored) });
        });
    }
  },

  toggleMuted(track) {
    const { muted, mutedTracks, data } = get();
    const nowMuted = !muted.has(track.id);
    const copies = copiesOf(track, data.tracks);
    const copyIds = new Set(copies.map((t) => t.id));
    const next = new Set(muted);
    for (const id of copyIds) {
      if (nowMuted) next.add(id);
      else next.delete(id);
    }
    const others = mutedTracks.filter((wire) => !copyIds.has(wire.id));
    const tracks = nowMuted ? [toWireTrack(track), ...others] : others;
    const at = Date.now();
    writeJson(MUTED_FILE, { at, tracks });
    set({ muted: next, mutedTracks: tracks, mutedAt: at });
    return nowMuted;
  },

  applyMuted(tracks, at) {
    writeJson(MUTED_FILE, { at, tracks });
    set({ mutedTracks: tracks, mutedAt: at, muted: mutedIds(tracks, get().data.tracks) });
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
    void markPlayed(s, track, new Date(at)).catch((err) => {
      if (!isNoAnswer(err)) return;
      outbox.plays.push({ id: track.id, at });
      writeJson(OUTBOX_FILE, outbox);
    });
  },

  clear() {
    removeJson(FILE);
    removeJson(LIKED_ORDER_FILE);
    removeJson(OUTBOX_FILE);
    removeJson(MUTED_FILE);
    outbox = { likes: {}, plays: [] };
    set({ muted: new Set<string>(), mutedTracks: [], mutedAt: 0 });
    set({ ...derive(EMPTY), likedOrder: [], loaded: false, error: null });
  },
}));

/** A like went to the server: the computer may want to look at once rather than in ten minutes. */
let tellLikes: (() => void) | null = null;
export function onLikesSent(listener: (() => void) | null): void {
  tellLikes = listener;
}

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
