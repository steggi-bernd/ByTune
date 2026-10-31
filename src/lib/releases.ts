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
