/**
 * What kind of release a library album is — album, EP, single or
 * compilation — for the artist page's discography.
 *
 * In order of trust: the release type tags (MusicBrainz RELEASETYPE in the
 * files, OpenSubsonic releaseTypes from Navidrome), the title ("… EP",
 * "… - Single"), then the size rule the stores use: up to 3 songs under
 * 30 minutes is a single, up to 6 under 30 minutes an EP, anything else an
 * album. The size counts the release's songs (track total, or the highest
 * track number), not just the ones in the library, so half an album never
 * passes for an EP.
 */
import type { Track } from "../types";

export type ReleaseKind = "album" | "ep" | "single" | "compilation";

export const RELEASE_LABEL: Record<ReleaseKind, string> = {
  album: "Album",
  ep: "EP",
  single: "Single",
  compilation: "Compilation",
};

const VARIOUS_ARTISTS = /^(various( artists)?|va|verschiedene( interpreten)?|diverse)$/i;

function fromTags(tracks: Track[]): ReleaseKind | null {
  const votes = new Map<ReleaseKind, number>();
  for (const t of tracks) {
    const tags = (t.releaseType ?? "").toLowerCase();
    if (!tags) continue;
    const kind: ReleaseKind | null = /compilation/.test(tags)
      ? "compilation"
      : /\bep\b/.test(tags)
        ? "ep"
        : /single/.test(tags)
          ? "single"
          : /album|broadcast|other/.test(tags)
            ? "album"
            : null;
    if (kind) votes.set(kind, (votes.get(kind) ?? 0) + 1);
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function fromTitle(title: string): ReleaseKind | null {
  if (/(?:^|[\s([-])E\.?P\.?\s*[)\]]?$/i.test(title.trim())) return "ep";
  if (/(?:\s-\s*|[([]\s*)single\s*[)\]]?$/i.test(title.trim())) return "single";
  return null;
}

export function classifyRelease(title: string, artist: string, tracks: Track[]): ReleaseKind {
  const tagged = fromTags(tracks);
  if (tagged) return tagged;
  if (VARIOUS_ARTISTS.test(artist.trim())) return "compilation";
  const titled = fromTitle(title);
  if (titled) return titled;
  if (tracks.some((t) => (t.discNo ?? 1) > 1)) return "album";

  const size = Math.max(
    tracks.length,
    ...tracks.map((t) => t.trackTotal ?? 0),
    ...tracks.map((t) => t.trackNo ?? 0)
  );
  const known = tracks.filter((t) => t.duration > 0);
  const avg = known.length ? known.reduce((sum, t) => sum + t.duration, 0) / known.length : 0;
  // Songs missing from the library count at the average length of the ones present.
  const length = known.reduce((sum, t) => sum + t.duration, 0) + Math.max(0, size - tracks.length) * avg;
  if (length >= 30 * 60) return "album";
  if (size <= 3 && tracks.every((t) => t.duration < 10 * 60)) return "single";
  if (size <= 6) return "ep";
  return "album";
}

/** The year a release first came out: the original year where tagged, else the earliest year. */
export function releaseYear(tracks: Track[]): number | undefined {
  const years = tracks
    .map((t) => (t.originalYear && t.year ? Math.min(t.originalYear, t.year) : t.originalYear ?? t.year))
    .filter((y): y is number => typeof y === "number" && y > 0);
  return years.length ? Math.min(...years) : undefined;
}

/**
 * The day a release came out, as precisely as its songs say ("2019-05-03",
 * else "2019-05"). Only a date in the release's own year counts, so a
 * reissue's day never moves an old album; and 1 January says nothing — it
 * is what Jellyfin fills in for a release whose tags only know the year.
 */
export function releaseDate(tracks: Track[], year: number | undefined): string | undefined {
  if (!year) return undefined;
  let best: string | undefined;
  for (const t of tracks) {
    for (const d of [t.originalDate, t.date]) {
      if (!d || d.length < 7 || !d.startsWith(`${year}-`) || d.endsWith("-01-01")) continue;
      // The more precise date wins, then the earlier one.
      if (!best || d.length > best.length || (d.length === best.length && d < best)) best = d;
    }
  }
  return best;
}

/** A title with its numbers blanked: "Season 9" and "Season 12" are parts of one series. */
const seriesStem = (title: string): string => title.toLowerCase().replace(/\d+/g, "#");
const seriesNumbers = (title: string): number[] => (title.match(/\d+/g) ?? []).map(Number);

interface Placed {
  artist?: string;
  title: string;
  year?: number;
  date?: string;
  /** its place from releaseOrder; without one, its own day or year */
  order?: string;
}

/** A sortable place in time: the day, or the year alone ("2025-00-00", before every day of it); none without a year. */
const ownPlace = (a: Placed): string => (a.year ? (a.date ?? `${a.year}-00-00`) : "");

/**
 * Every release's place in time, for a whole list at once (compareReleases
 * sorts by it). Its own day, or its year alone — except that the parts of a
 * series keep their numbers' order: Season 9 comes after Season 8 even when
 * only Season 8's day is known, since a later part never came out first. A
 * part that would land before the one it follows is placed just after it.
 */
export function releaseOrder(albums: Placed[]): string[] {
  const places = albums.map(ownPlace);
  const series = new Map<string, number[]>();
  albums.forEach((a, i) => {
    if (!places[i] || !/\d/.test(a.title)) return;
    const key = `${(a.artist ?? "").toLowerCase()}|${seriesStem(a.title)}`;
    series.set(key, [...(series.get(key) ?? []), i]);
  });
  for (const parts of series.values()) {
    if (parts.length < 2) continue;
    parts.sort((x, y) => {
      const nx = seriesNumbers(albums[x].title);
      const ny = seriesNumbers(albums[y].title);
      for (let k = 0; k < Math.min(nx.length, ny.length); k++) if (nx[k] !== ny[k]) return nx[k] - ny[k];
      return 0;
    });
    let previous = "";
    for (const i of parts) {
      // "+" sorts right after the place it extends, before any later day.
      if (places[i] <= previous) places[i] = `${previous}+`;
      previous = places[i];
    }
  }
  return places;
}

/**
 * Newest first: by place in time (releaseOrder, else the release's own day
 * or year; a known day before the year alone), then by title — the parts of
 * a series highest first ("Season 12, 11 … 1"), the rest alphabetically.
 * Releases without a year go last.
 */
export function compareReleases(a: Placed, b: Placed): number {
  const pa = a.order ?? ownPlace(a);
  const pb = b.order ?? ownPlace(b);
  if (pa !== pb) {
    if (!pa || !pb) return pa ? -1 : 1;
    return pa < pb ? 1 : -1;
  }
  const stem = seriesStem(a.title).localeCompare(seriesStem(b.title));
  if (stem) return stem;
  const na = seriesNumbers(a.title);
  const nb = seriesNumbers(b.title);
  for (let i = 0; i < Math.min(na.length, nb.length); i++) if (na[i] !== nb[i]) return nb[i] - na[i];
  return a.title.localeCompare(b.title);
}
