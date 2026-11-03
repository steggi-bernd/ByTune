/**
 * Derived views of the catalogue — albums, artists, genres, decades — from a
 * list of songs, shared by the desktop renderer and the phone app: pure, no
 * bridge and no store. The desktop's shared, memoized hooks: catalogIndex.ts.
 */
import type { Track } from "../types";
import { albumKeyOf, albumRoute, artistRoute, creditedArtists, leadArtist, parseRoute, splitCredits } from "./libraryCore";
import { classifyRelease, compareReleases, releaseDate, releaseOrder, releaseYear, type ReleaseKind } from "./releases";

export type PlayCounts = Record<string, { plays: number; lastAt: number }>;

export interface LibAlbum {
  key: string;
  route: string;
  title: string;
  artist: string;
  /** album, EP, single or compilation (lib/releases.ts) */
  kind: ReleaseKind;
  /** the year it first came out (original year where tagged) */
  year?: number;
  /** the day within that year, where the sources know it ("YYYY-MM-DD" or "YYYY-MM") */
  date?: string;
  /** its place in "newest first" — the day, or the year alone, with series parts kept in order (releaseOrder) */
  order?: string;
  thumb: string;
  tracks: Track[];
  /** newest addedAt among its tracks */
  addedAt: number;
  duration: number;
}

export interface LibArtist {
  name: string;
  route: string;
  trackCount: number;
  albumCount: number;
  /** an album cover as stand-in until the artist photo resolves */
  thumb: string;
}

const discTrack = (a: Track, b: Track): number =>
  (a.discNo ?? 1) - (b.discNo ?? 1) || (a.trackNo ?? 9999) - (b.trackNo ?? 9999) || a.title.localeCompare(b.title);

/**
 * The albums of a song list. A song belongs to the album its page link names
 * — the album edits (lib/albumEdits.ts) already point songs of a merged album
 * at the one it's shown in — and `artistEdits` replace an album's tagged
 * artist line.
 */
export function buildAlbums(tracks: Track[], artistEdits: Record<string, string> = {}): LibAlbum[] {
  const groups = new Map<string, Track[]>();
  for (const t of tracks) {
    const key = (t.albumId ? parseRoute(t.albumId, "album") : null) ?? albumKeyOf(t);
    if (!key) continue;
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }
  const albums: LibAlbum[] = [];
  for (const [key, list] of groups) {
    // Parts merged into this album follow its own songs ("Disc 2" after
    // "Disc 1"), each part in disc/track order.
    const part = (t: Track): string => (albumKeyOf(t) === key ? "" : albumKeyOf(t) ?? "");
    list.sort((a, b) => part(a).localeCompare(part(b), undefined, { numeric: true }) || discTrack(a, b));
    const first = list[0];
    // The user's artist line, else the album artist when tagged, else the most common lead artist.
    const counts = new Map<string, number>();
    for (const t of list) {
      const a = t.albumArtist || leadArtist(t.artist);
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    const artist = artistEdits[key] ?? [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? first.artist;
    const title = first.album ?? "";
    const year = releaseYear(list);
    albums.push({
      key,
      route: albumRoute(key),
      title,
      artist,
      kind: classifyRelease(title, artist, list),
      year,
      date: releaseDate(list, year),
      thumb: list.find((t) => t.thumb)?.thumb ?? "",
      tracks: list,
      addedAt: Math.max(0, ...list.map((t) => t.addedAt ?? 0)),
      duration: list.reduce((sum, t) => sum + (t.duration || 0), 0),
    });
  }
  // Places in time are set across the whole library: a series' parts know each other.
  const order = releaseOrder(albums);
  albums.forEach((a, i) => (a.order = order[i]));
  return albums.sort((a, b) => a.title.localeCompare(b.title));
}

export function buildArtists(tracks: Track[], albums: LibAlbum[]): LibArtist[] {
  const byName = new Map<string, { name: string; tracks: number; thumb: string }>();
  for (const t of tracks) {
    // Every credited artist counts on their own — "A, B" is two artists, not one.
    for (const name of splitCredits(t.artist)) {
      if (name.toLowerCase() === "unknown artist") continue;
      const key = name.toLowerCase();
      const cur = byName.get(key) ?? { name, tracks: 0, thumb: "" };
      cur.tracks += 1;
      if (!cur.thumb && t.thumb) cur.thumb = t.thumb;
      byName.set(key, cur);
    }
  }
  const albumCount = new Map<string, number>();
  for (const a of albums) {
    for (const name of splitCredits(a.artist)) albumCount.set(name.toLowerCase(), (albumCount.get(name.toLowerCase()) ?? 0) + 1);
  }
  return [...byName.entries()]
    .map(([key, v]) => ({
      name: v.name,
      route: artistRoute(v.name),
      trackCount: v.tracks,
      albumCount: albumCount.get(key) ?? 0,
      thumb: v.thumb,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Every track crediting this artist (lead, album artist or featured). */
export function artistTracks(tracks: Track[], name: string): Track[] {
  const key = name.trim().toLowerCase();
  return tracks.filter((t) => creditedArtists(t).includes(key));
}

/**
 * Newest first — the latest release on top: by year, then by day within it,
 * then series parts highest first (lib/releases.ts); releases without a
 * year go last.
 */
export const newestFirst = (a: LibAlbum, b: LibAlbum): number => compareReleases(a, b);

/**
 * Releases owned by the artist (an album by "A, B" belongs to both), then
 * releases they only appear on — each newest first.
 */
export function artistAlbums(albums: LibAlbum[], name: string): { own: LibAlbum[]; appearsOn: LibAlbum[] } {
  const key = name.trim().toLowerCase();
  const own: LibAlbum[] = [];
  const appearsOn: LibAlbum[] = [];
  for (const a of albums) {
    if (splitCredits(a.artist).some((n) => n.toLowerCase() === key)) own.push(a);
    else if (a.tracks.some((t) => creditedArtists(t).includes(key))) appearsOn.push(a);
  }
  return { own: own.sort(newestFirst), appearsOn: appearsOn.sort(newestFirst) };
}

export interface LibGenre {
  /** the name lower-cased — one genre however its tags spell it */
  key: string;
  name: string;
  /** the genre page's address */
  route: string;
  tracks: Track[];
  albumCount: number;
  artistCount: number;
  /** newest addedAt among its songs */
  addedAt: number;
}

/** The library's genres — a song tagged "Rock; Indie" counts in both — most songs first. */
export function buildGenres(tracks: Track[]): LibGenre[] {
  const byKey = new Map<string, { name: string; tracks: Track[]; albums: Set<string>; artists: Set<string>; addedAt: number }>();
  for (const t of tracks) {
    for (const g of genresOf(t)) {
      const key = g.toLowerCase();
      let cur = byKey.get(key);
      if (!cur) byKey.set(key, (cur = { name: g, tracks: [], albums: new Set(), artists: new Set(), addedAt: 0 }));
      cur.tracks.push(t);
      const album = albumKeyOf(t);
      if (album) cur.albums.add(album);
      for (const a of splitCredits(t.artist)) cur.artists.add(a.toLowerCase());
      cur.addedAt = Math.max(cur.addedAt, t.addedAt ?? 0);
    }
  }
  return [...byKey.entries()]
    .map(([key, v]) => ({
      key,
      name: v.name,
      route: encodeURIComponent(key),
      tracks: v.tracks,
      albumCount: v.albums.size,
      artistCount: v.artists.size,
      addedAt: v.addedAt,
    }))
    .sort((a, b) => b.tracks.length - a.tracks.length || a.name.localeCompare(b.name));
}

/** Genre names of a track: "Rock; Indie" / "Rock/Indie" / "Rock, Indie" → two genres. */
export function genresOf(t: Track): string[] {
  if (!t.genre) return [];
  return t.genre
    .split(/\s*[;/,]\s*/)
    .map((g) => g.trim())
    .filter(Boolean);
}

export function decadeOf(year: number | undefined): string | null {
  if (!year || year < 1900 || year > 2100) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

/** Most played first; never-played tracks keep their relative order behind them. */
export function byPlays(tracks: Track[], counts: PlayCounts): Track[] {
  return [...tracks].sort((a, b) => (counts[b.id]?.plays ?? 0) - (counts[a.id]?.plays ?? 0));
}

/**
 * Which of these songs are liked, the latest like first (Liked Songs holds the
 * latest on top). `keyOf` folds the copies of one song together: a like on any
 * copy counts.
 */
export function likedAmong(songs: Track[], liked: Track[], keyOf: (id: string) => string): Track[] {
  const at = new Map<string, number>();
  liked.forEach((t, i) => {
    const k = keyOf(t.id);
    if (!at.has(k)) at.set(k, i);
  });
  const order = (t: Track): number => at.get(keyOf(t.id)) ?? -1;
  return songs.filter((t) => order(t) >= 0).sort((a, b) => order(a) - order(b));
}
