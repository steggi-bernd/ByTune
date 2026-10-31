/**
 * The user's corrections to how songs group into albums. Tags are often wrong
 * or split one release in two — "Album (Disc 1)" and "Album (Disc 2)", a song
 * tagged with a different album artist. These edits never touch the files or
 * the servers: the catalogue applies them whenever it builds its albums.
 *
 *  - artists: an album's artist credit line, replacing what its tags say
 *  - mergedInto: an album (by its tag key, see albumKeyOf) shown as part of
 *    another one
 *
 * Pure, so the grouping rules are testable on their own.
 */
import type { Track } from "../types";
import { albumKeyOf, albumRoute } from "./libraryTracks";

export interface AlbumEdits {
  /** album key → artist credit line ("A, B") */
  artists: Record<string, string>;
  /** album key → the album it is shown as part of */
  mergedInto: Record<string, string>;
}

/** The album a key ends up in, following chained merges (a cycle stops where it started). */
export function resolveAlbumKey(key: string, mergedInto: Record<string, string>): string {
  let at = key;
  for (let hops = 0; hops < 32; hops++) {
    const next = mergedInto[at];
    if (!next || next === key) return at;
    at = next;
  }
  return at;
}

/** Merge `from` into `into` (wherever that one already went); albums merged into `from` follow it. */
export function withMerge(mergedInto: Record<string, string>, from: string, into: string): Record<string, string> {
  const target = resolveAlbumKey(into, mergedInto);
  if (!from || target === from) return mergedInto;
  const next: Record<string, string> = { ...mergedInto, [from]: target };
  for (const [k, v] of Object.entries(next)) if (v === from) next[k] = target;
  return next;
}

/** Show `from` as its own album again — albums merged into it stay with it. */
export function withSplit(mergedInto: Record<string, string>, from: string): Record<string, string> {
  if (!(from in mergedInto)) return mergedInto;
  const next = { ...mergedInto };
  delete next[from];
  return next;
}

/** Songs of merged albums point at the album they're shown in (their album page link follows). */
export function applyAlbumMerges(tracks: Track[], mergedInto: Record<string, string>): Track[] {
  if (!Object.keys(mergedInto).length) return tracks;
  return tracks.map((t) => {
    const key = albumKeyOf(t);
    if (!key) return t;
    const target = resolveAlbumKey(key, mergedInto);
    return target === key ? t : { ...t, albumId: albumRoute(target) };
  });
}
