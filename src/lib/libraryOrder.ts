/**
 * The library panel's order (components/Sidebar.tsx), kept pure for the
 * tests: the pinned rows on top in the order they were dragged into, then —
 * sorted by "Recently played" — the rest by when they last played; and which
 * album, playlist or Liked Songs a queue plays, so that time can be kept
 * (lib/recentlyPlayed.ts).
 */
import type { Track } from "../types";

/**
 * Rows in the panel's order: the pinned ones first, as they were placed (any
 * not placed yet after them, in their own order), then the rest — the latest
 * played first where `playedAt` is given, the never played in their own
 * order below.
 */
export function orderRows<R extends { id: string }>(
  rows: readonly R[],
  o: { isPinned(r: R): boolean; pinOrder: readonly string[]; playedAt?: (r: R) => number }
): R[] {
  const place = new Map(o.pinOrder.map((id, i) => [id, i] as const));
  const placeOf = (r: R): number => place.get(r.id) ?? Number.MAX_SAFE_INTEGER;
  const pinned = rows.filter((r) => o.isPinned(r)).sort((a, b) => placeOf(a) - placeOf(b));
  const rest = rows.filter((r) => !o.isPinned(r));
  if (o.playedAt) {
    const at = new Map(rest.map((r) => [r, o.playedAt!(r)] as const));
    rest.sort((a, b) => (at.get(b) ?? 0) - (at.get(a) ?? 0));
  }
  return [...pinned, ...rest];
}

/** The pinned rows' order after one was dragged onto another — above it, or below. */
export function movePinned(order: readonly string[], id: string, target: string, below: boolean): string[] {
  if (id === target || !order.includes(id)) return [...order];
  const rest = order.filter((x) => x !== id);
  const at = rest.indexOf(target);
  if (at < 0) return [...order];
  rest.splice(below ? at + 1 : at, 0, id);
  return rest;
}

/** A collection a queue may play: a playlist or Liked Songs, by its songs' keys. */
export interface Collection {
  id: string;
  keys: ReadonlySet<string>;
}

export interface Shelves {
  /** a song's key — one for all versions of it */
  keyOf(t: Track): string;
  /** a song's album, as the panel's album row names it */
  albumOf(t: Track): string | null;
  /** how many songs an album has */
  albumSize(album: string): number;
  /** the playlists, then Liked Songs */
  collections: readonly Collection[];
}

/**
 * Which album, playlist or Liked Songs a queue plays: the album when every
 * song is of one and it plays at least half of it (a single by itself
 * counts); else the collection holding every song of it that it covers best,
 * at least half. A song from elsewhere — a search, a mix — plays none.
 */
export function collectionOf(queue: readonly Track[], s: Shelves): string | null {
  if (!queue.length) return null;
  const keys = new Set(queue.map((t) => s.keyOf(t)));
  const album = s.albumOf(queue[0]);
  if (album && queue.every((t) => s.albumOf(t) === album)) {
    const size = s.albumSize(album);
    if (size === 1 || (size > 1 && keys.size >= 2 && keys.size * 2 >= size)) return album;
  }
  let best: { id: string; cover: number } | null = null;
  for (const c of s.collections) {
    if (!c.keys.size || keys.size * 2 < c.keys.size || (keys.size < 2 && c.keys.size > 1)) continue;
    let all = true;
    for (const k of keys) {
      if (!c.keys.has(k)) {
        all = false;
        break;
      }
    }
    const cover = keys.size / c.keys.size;
    if (all && (!best || cover > best.cover)) best = { id: c.id, cover };
  }
  return best?.id ?? null;
}

/**
 * Played times to start from, out of the listening history (newest first) —
 * it keeps no times, so its order stands in: the n-th song back counts n
 * minutes ago. An album counts where two of its songs ran back to back (a
 * single by itself); a playlist or Liked Songs where three songs, not all of
 * one album, ran back to back in it — the smallest holding all three.
 */
export function seedPlayed(history: readonly Track[], s: Shelves, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  history.forEach((t, i) => {
    const next = history[i + 1];
    const at = now - (i + 1) * 60_000;
    const album = s.albumOf(t);
    if (album && !(album in out) && (s.albumSize(album) === 1 || (next && s.albumOf(next) === album))) out[album] = at;
    const run = history.slice(i, i + 3);
    if (run.length < 3 || (album && run.every((r) => s.albumOf(r) === album))) return;
    const keys = run.map((r) => s.keyOf(r));
    let best: Collection | null = null;
    for (const c of s.collections) if (keys.every((k) => c.keys.has(k)) && (!best || c.keys.size < best.keys.size)) best = c;
    if (best && !(best.id in out)) out[best.id] = at;
  });
  return out;
}
