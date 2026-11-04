/**
 * Explore's three lists: albums, artists and genres with their plays, and the
 * orders each can be put in. Pure, shared by the desktop's table and the
 * phone's rows; how an order looks as a column or a line is theirs.
 */
import type { Track } from "../types";
import type { LibAlbum, LibArtist, LibGenre, PlayCounts } from "./catalogBuild";
import { splitCredits } from "./libraryCore";
import { compareReleases, type ReleaseKind } from "./releases";
import { T } from "./i18n";

export type ExploreTab = "albums" | "artists" | "genres";
/** an order's key on that tab's list, and whether it runs from the most / Z */
export interface ExploreSort {
  by: string;
  desc: boolean;
}

export const DEFAULT_EXPLORE_SORTS: Record<ExploreTab, ExploreSort> = {
  albums: { by: "title", desc: false },
  artists: { by: "name", desc: false },
  genres: { by: "songs", desc: true },
};

export interface ExploreOrder<T> {
  key: string;
  label: string;
  /** counts and dates start from the most / the newest; text from A */
  numeric?: boolean;
  /** ascending */
  compare: (a: T, b: T) => number;
  /** rows without a value stay at the end, whichever way the column runs */
  missing?: (row: T) => boolean;
}

export interface AlbumRow {
  album: LibAlbum;
  plays: number;
}
export interface ArtistRow {
  artist: LibArtist;
  plays: number;
  addedAt: number;
}
export interface GenreRow {
  genre: LibGenre;
  plays: number;
}

const text = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;
const playsOf = (list: Track[], counts: PlayCounts): number => list.reduce((n, t) => n + (counts[t.id]?.plays ?? 0), 0);
const KIND_ORDER: ReleaseKind[] = ["album", "ep", "single", "compilation"];

export const albumRowsOf = (albums: LibAlbum[], counts: PlayCounts): AlbumRow[] =>
  albums.map((album) => ({ album, plays: playsOf(album.tracks, counts) }));

export function artistRowsOf(artists: LibArtist[], tracks: Track[], counts: PlayCounts): ArtistRow[] {
  // One pass over the songs: each credited artist's plays and newest song.
  const stats = new Map<string, { plays: number; addedAt: number }>();
  for (const t of tracks) {
    for (const name of splitCredits(t.artist)) {
      const cur = stats.get(name.toLowerCase()) ?? { plays: 0, addedAt: 0 };
      cur.plays += counts[t.id]?.plays ?? 0;
      cur.addedAt = Math.max(cur.addedAt, t.addedAt ?? 0);
      stats.set(name.toLowerCase(), cur);
    }
  }
  return artists.map((artist) => ({ artist, plays: stats.get(artist.name.toLowerCase())?.plays ?? 0, addedAt: stats.get(artist.name.toLowerCase())?.addedAt ?? 0 }));
}

export const genreRowsOf = (genres: LibGenre[], counts: PlayCounts): GenreRow[] =>
  genres.map((genre) => ({ genre, plays: playsOf(genre.tracks, counts) }));

export const albumOrders: ExploreOrder<AlbumRow>[] = [
  { key: "title", label: T("Title"), compare: (a, b) => text(a.album.title, b.album.title) },
  { key: "artist", label: T("Artist"), compare: (a, b) => text(a.album.artist, b.album.artist) },
  {
    key: "released",
    label: T("Released"),
    numeric: true,
    // Ascending is oldest first; the same order as the discography, turned round.
    compare: (a, b) => compareReleases(b.album, a.album),
    missing: (r) => !r.album.year,
  },
  { key: "type", label: T("Type"), compare: (a, b) => KIND_ORDER.indexOf(a.album.kind) - KIND_ORDER.indexOf(b.album.kind) },
  { key: "songs", label: T("Songs"), numeric: true, compare: (a, b) => a.album.tracks.length - b.album.tracks.length },
  { key: "length", label: T("Length"), numeric: true, compare: (a, b) => a.album.duration - b.album.duration },
  { key: "added", label: T("Added"), numeric: true, compare: (a, b) => a.album.addedAt - b.album.addedAt, missing: (r) => !r.album.addedAt },
  { key: "plays", label: T("Plays"), numeric: true, compare: (a, b) => a.plays - b.plays },
];
export const artistOrders: ExploreOrder<ArtistRow>[] = [
  { key: "name", label: T("Name"), compare: (a, b) => text(a.artist.name, b.artist.name) },
  { key: "albums", label: T("Albums"), numeric: true, compare: (a, b) => a.artist.albumCount - b.artist.albumCount },
  { key: "songs", label: T("Songs"), numeric: true, compare: (a, b) => a.artist.trackCount - b.artist.trackCount },
  { key: "plays", label: T("Plays"), numeric: true, compare: (a, b) => a.plays - b.plays },
  { key: "added", label: T("Added"), numeric: true, compare: (a, b) => a.addedAt - b.addedAt, missing: (r) => !r.addedAt },
];
export const genreOrders: ExploreOrder<GenreRow>[] = [
  { key: "name", label: T("Name"), compare: (a, b) => text(a.genre.name, b.genre.name) },
  { key: "artists", label: T("Artists"), numeric: true, compare: (a, b) => a.genre.artistCount - b.genre.artistCount },
  { key: "albums", label: T("Albums"), numeric: true, compare: (a, b) => a.genre.albumCount - b.genre.albumCount },
  { key: "songs", label: T("Songs"), numeric: true, compare: (a, b) => a.genre.tracks.length - b.genre.tracks.length },
  { key: "plays", label: T("Plays"), numeric: true, compare: (a, b) => a.plays - b.plays },
];

export function sortRows<T>(rows: T[], orders: ExploreOrder<T>[], sort: ExploreSort): T[] {
  const order = orders.find((o) => o.key === sort.by) ?? orders[0];
  const first = orders[0];
  return [...rows].sort((a, b) => {
    const ma = order.missing?.(a) ?? false;
    const mb = order.missing?.(b) ?? false;
    if (ma !== mb) return ma ? 1 : -1;
    const c = order.compare(a, b);
    return (sort.desc ? -c : c) || first.compare(a, b);
  });
}

/** A new order starts from the most (counts, dates) or from A (text); the same one again turns round. */
export const nextSort = (sort: ExploreSort, order: { key: string; numeric?: boolean }): ExploreSort =>
  sort.by === order.key ? { by: order.key, desc: !sort.desc } : { by: order.key, desc: !!order.numeric };

/** A local calendar day — new Date("2019-05-03") would be UTC midnight, the day before west of Greenwich. */
export function dayLabel(date: string | undefined, year: number | undefined): string {
  const [y, m, d] = (date ?? "").split("-").map(Number);
  if (y && m && d) return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (y && m) return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return year ? String(year) : "—";
}
export const addedLabel = (ms: number): string =>
  ms > 0 ? new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
