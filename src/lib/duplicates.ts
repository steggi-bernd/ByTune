/**
 * Duplicate songs across the library sources: the same recording found as a
 * local file and on Jellyfin/Navidrome — or twice in one source, like a FLAC
 * and an MP3 copy — becomes ONE catalogue song. Its versions stay known, in
 * the order playback tries them: local files first (best quality first),
 * then the servers' streams (best quality first).
 *
 * Two tracks are the same song when title and lead artist match after
 * folding (case, accents, punctuation, "feat." credits), the albums agree
 * (or one side has none) and the lengths are within a few seconds. Two
 * different track numbers on the same album are never merged — that's an
 * album with two "Intro"s, not a duplicate.
 */
import type { Track } from "../types";

/** Lengths further apart than this are different recordings (edit, live take). */
const DURATION_TOLERANCE_SEC = 3;

const PLACEHOLDER_ALBUM = "unknown album";

/** Case-, accent- and punctuation-free form of a tag value. */
export function foldTag(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Title without "(feat. X)" / " ft. X" credits — sources disagree on where those go. */
export function titleKey(title: string): string {
  return foldTag(
    title
      .replace(/\s*[([]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, "")
      .replace(/\s+(?:feat\.?|ft\.?|featuring)\s.*$/i, "")
  );
}

/** First credited name: "A feat. B", "A, B" (Jellyfin joins with commas), "A; B", "A / B" → "A". */
function artistKey(t: Pick<Track, "artist" | "albumArtist">): string {
  const lead = t.artist.split(/\s*(?:,|;|\s\/\s| feat\.? | ft\.? | featuring )\s*/i)[0] ?? "";
  return foldTag(lead || t.albumArtist);
}

function albumKey(t: Pick<Track, "album">): string {
  const album = foldTag(t.album);
  return album === PLACEHOLDER_ALBUM ? "" : album;
}

function sameRecording(a: Track, b: Track): boolean {
  const albumA = albumKey(a);
  const albumB = albumKey(b);
  if (albumA && albumB && albumA !== albumB) return false;
  const lengthsKnown = a.duration > 0 && b.duration > 0;
  if (lengthsKnown && Math.abs(a.duration - b.duration) > DURATION_TOLERANCE_SEC) return false;
  // Without an album on one side, only a matching length ties them together.
  if ((!albumA || !albumB) && !lengthsKnown) return false;
  if (albumA && albumA === albumB && a.trackNo && b.trackNo) {
    if (a.trackNo !== b.trackNo || (a.discNo ?? 1) !== (b.discNo ?? 1)) return false;
  }
  return true;
}

/** Songs that could be the same one have this in common. */
export function songIdentity(t: Pick<Track, "title" | "artist" | "albumArtist">): string {
  return `${titleKey(t.title)}|${artistKey(t)}`;
}

/** Two tracks with the same identity: the same recording? */
export const sameSong = sameRecording;

const SOURCE_RANK: Record<NonNullable<Track["source"]>, number> = { local: 0, jellyfin: 1, subsonic: 2 };

const LOSSLESS_CODEC = /flac|alac|wav|pcm|aiff?|dsd|dsf|dff|wavpack|^wv$|monkey|^ape$|lossless/i;

/** Rough quality score: lossless first, then bit depth, sample rate, bit rate. */
export function qualityScore(t: Track): number {
  const lossless = t.lossless ?? LOSSLESS_CODEC.test(`${t.codec ?? ""} ${t.container ?? ""}`.trim() || "-");
  return (
    (lossless ? 1e9 : 0) +
    (t.bitsPerSample ?? 0) * 1e7 +
    Math.min(t.sampleRate ?? 0, 1e7) +
    Math.min((t.bitrate ?? 0) / 1000, 9999) / 1e4
  );
}

/** Playback order of a song's versions: local before streams, better before worse. */
export function compareVersions(a: Track, b: Track): number {
  const rank = (t: Track): number => SOURCE_RANK[t.source ?? "local"] ?? 3;
  const localA = rank(a) === 0 ? 0 : 1;
  const localB = rank(b) === 0 ? 0 : 1;
  return localA - localB || qualityScore(b) - qualityScore(a) || rank(a) - rank(b);
}

/**
 * One song for the catalogue: the first version's identity, gaps filled from
 * the others. Album, album artist and artist stay the first version's own —
 * they decide which album page a song lands on, and filling them from another
 * copy could split one album into two.
 */
function mergeVersions(versions: Track[]): Track {
  const [primary, ...rest] = versions;
  const pick = <K extends keyof Track>(key: K): Track[K] | undefined =>
    primary[key] ?? rest.find((v) => v[key] !== undefined && v[key] !== "")?.[key];
  const defined = (values: (number | undefined)[]): number[] => values.filter((v): v is number => typeof v === "number" && v > 0);
  const added = defined(versions.map((v) => v.addedAt));
  const original = defined(versions.map((v) => v.originalYear));
  const totals = defined(versions.map((v) => v.trackTotal));
  return {
    ...primary,
    thumb: primary.thumb || rest.find((v) => v.thumb)?.thumb || "",
    duration: primary.duration || Math.max(0, ...versions.map((v) => v.duration || 0)),
    year: pick("year"),
    genre: pick("genre"),
    trackNo: pick("trackNo"),
    discNo: pick("discNo"),
    releaseType: pick("releaseType"),
    trackTotal: totals.length ? Math.max(...totals) : undefined,
    originalYear: original.length ? Math.min(...original) : undefined,
    addedAt: added.length ? Math.min(...added) : primary.addedAt,
  };
}

/**
 * A play order without second copies of a song: of a song's copies (a local
 * file and its Jellyfin copy, say) the first stays and later ones go — except
 * `keep`, the entry that must stay (the one clicked, or the one playing),
 * whose other copies go instead. The same copy listed twice is a deliberate
 * repeat and stays. Which copy actually sounds is decided at play time
 * (local first), so the order never needs more than one.
 */
export function withoutOtherCopies<T extends { id: string }>(
  list: T[],
  keyOf: (id: string) => string,
  keep = -1
): { list: T[]; keep: number } {
  /** song key → the copy that stays */
  const chosen = new Map<string, string>();
  if (list[keep]) chosen.set(keyOf(list[keep].id), list[keep].id);
  const out: T[] = [];
  let kept = -1;
  list.forEach((t, i) => {
    const key = keyOf(t.id);
    const stays = chosen.get(key);
    if (stays !== undefined && stays !== t.id) return;
    chosen.set(key, t.id);
    if (i === keep) kept = out.length;
    out.push(t);
  });
  return { list: out, keep: kept };
}

export interface MergedLibrary {
  /** one entry per song, in first-seen order */
  tracks: Track[];
  /** every version id of a merged song → its versions, in playback order (only songs with 2+ versions) */
  versions: Map<string, Track[]>;
}

export function mergeDuplicates(all: Track[]): MergedLibrary {
  const buckets = new Map<string, Track[]>();
  const order: string[] = [];
  for (const t of all) {
    const title = titleKey(t.title);
    if (!title) continue;
    const key = songIdentity(t);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(t);
    else {
      buckets.set(key, [t]);
      order.push(key);
    }
  }

  /** first member's id → merged song, so the output keeps the input order */
  const songOf = new Map<string, Track>();
  const versions = new Map<string, Track[]>();
  for (const key of order) {
    const bucket = buckets.get(key)!;
    if (bucket.length === 1) continue;
    const groups: Track[][] = [];
    for (const t of bucket) {
      const group = groups.find((g) => g.every((member) => member.id !== t.id && sameRecording(member, t)));
      if (group) group.push(t);
      else groups.push([t]);
    }
    for (const group of groups) {
      if (group.length < 2) continue;
      const ordered = [...group].sort(compareVersions);
      const song = mergeVersions(ordered);
      for (const v of group) versions.set(v.id, ordered);
      songOf.set(group[0].id, song);
    }
  }

  if (!versions.size) return { tracks: all, versions };
  const tracks: Track[] = [];
  for (const t of all) {
    const merged = songOf.get(t.id);
    if (merged) tracks.push(merged);
    else if (!versions.has(t.id)) tracks.push(t);
  }
  return { tracks, versions };
}
