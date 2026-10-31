/**
 * Derived views of the catalogue — albums, artists, genres, decades — built
 * once per catalogue version and shared by every page that needs them.
 */
import { useMemo } from "react";
import { useCatalog, type PlayCounts } from "../stores/catalog";
import type { Track } from "../types";
import { albumKeyOf, albumRoute, artistRoute, creditedArtists, leadArtist, splitCredits } from "./libraryTracks";
import { classifyRelease, releaseYear, type ReleaseKind } from "./releases";

export interface LibAlbum {
  key: string;
  route: string;
  title: string;
  artist: string;
  /** album, EP, single or compilation (lib/releases.ts) */
  kind: ReleaseKind;
  /** the year it first came out (original year where tagged) */
  year?: number;
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

export function buildAlbums(tracks: Track[]): LibAlbum[] {
  const groups = new Map<string, Track[]>();
  for (const t of tracks) {
    const key = albumKeyOf(t);
    if (!key) continue;
    const g = groups.get(key);
    if (g) g.push(t);
    else groups.set(key, [t]);
  }
  const albums: LibAlbum[] = [];
  for (const [key, list] of groups) {
    list.sort(discTrack);
    const first = list[0];
    // The album artist when tagged, else the most common lead artist.
    const counts = new Map<string, number>();
    for (const t of list) {
      const a = t.albumArtist || leadArtist(t.artist);
      counts.set(a, (counts.get(a) ?? 0) + 1);
    }
    const artist = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? first.artist;
    const title = first.album ?? "";
    albums.push({
      key,
      route: albumRoute(key),
      title,
      artist,
      kind: classifyRelease(title, artist, list),
      year: releaseYear(list),
      thumb: list.find((t) => t.thumb)?.thumb ?? "",
      tracks: list,
      addedAt: Math.max(0, ...list.map((t) => t.addedAt ?? 0)),
      duration: list.reduce((sum, t) => sum + (t.duration || 0), 0),
    });
  }
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

/** Newest first — the latest release on top; releases without a year go last. */
export const newestFirst = (a: LibAlbum, b: LibAlbum): number =>
  (b.year ?? -Infinity) - (a.year ?? -Infinity) || a.title.localeCompare(b.title);

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

/* ------------------------------------------------------------- hooks */

let albumsMemo: { tracks: Track[]; albums: LibAlbum[]; artists: LibArtist[] } | null = null;

/** Albums and artists for the current song list (built once per catalogue load, shared by all pages). */
export function useLibraryIndex(): { albums: LibAlbum[]; artists: LibArtist[]; tracks: Track[]; loaded: boolean } {
  const tracks = useCatalog((s) => s.tracks);
  const loaded = useCatalog((s) => s.loaded);
  return useMemo(() => {
    // Play-count refreshes keep the same track list, so they never rebuild the index.
    if (!albumsMemo || albumsMemo.tracks !== tracks) {
      const albums = buildAlbums(tracks);
      albumsMemo = { tracks, albums, artists: buildArtists(tracks, albums) };
    }
    return { albums: albumsMemo.albums, artists: albumsMemo.artists, tracks, loaded };
  }, [tracks, loaded]);
}
