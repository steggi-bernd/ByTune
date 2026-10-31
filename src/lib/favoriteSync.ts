/**
 * Two-way sync between Liked Songs and the servers' favorites, worked out as
 * a plan the caller carries out (lib/serverSync.ts). Three sets of server
 * song ids ("jf:…", "ss:…"):
 *
 *  - liked:  every server copy of every song in Liked Songs
 *  - remote: the servers' favorites right now
 *  - base:   what both sides agreed on after the last sync
 *
 * A difference from the base tells who changed what since: a new like here
 * is favorited there, a favorite made there (Finamp, Jellyfin Web, a Subsonic
 * app) is liked here, and taking one back on either side is carried to the
 * other. The first sync has no base, so it only adds, both ways.
 */

export interface FavoritePlan {
  /** favorite on the server */
  favorite: string[];
  /** take the favorite back on the server */
  unfavorite: string[];
  /** like here */
  like: string[];
  /** take the like back here */
  unlike: string[];
}

/**
 * `known(id)`: the song is in the library listing. Only then can this side
 * tell it isn't liked — a favorite the listing doesn't know yet (added on
 * the server since the last refresh) is never taken back for that.
 */
export function planFavoriteSync(
  liked: ReadonlySet<string>,
  remote: ReadonlySet<string>,
  base: ReadonlySet<string>,
  known: (id: string) => boolean
): FavoritePlan {
  const plan: FavoritePlan = { favorite: [], unfavorite: [], like: [], unlike: [] };
  for (const id of liked) {
    if (remote.has(id)) continue;
    if (base.has(id)) plan.unlike.push(id); // agreed before: the server let it go
    else plan.favorite.push(id); // a new like here
  }
  for (const id of remote) {
    if (liked.has(id)) continue;
    if (!base.has(id)) plan.like.push(id); // a new favorite there
    else if (known(id)) plan.unfavorite.push(id); // agreed before: un-liked here
  }
  return plan;
}

/**
 * The base for next time, once the plan has run. A server call that failed
 * (`failed`) leaves its song where it was, so the next sync tries again; a
 * favorite this side couldn't decide about stays agreed.
 */
export function nextFavoriteBase(
  liked: ReadonlySet<string>,
  remote: ReadonlySet<string>,
  base: ReadonlySet<string>,
  plan: FavoritePlan,
  failed: ReadonlySet<string>
): Set<string> {
  const likedAfter = new Set(liked);
  plan.like.forEach((id) => likedAfter.add(id));
  plan.unlike.forEach((id) => likedAfter.delete(id));
  const remoteAfter = new Set(remote);
  plan.favorite.filter((id) => !failed.has(id)).forEach((id) => remoteAfter.add(id));
  plan.unfavorite.filter((id) => !failed.has(id)).forEach((id) => remoteAfter.delete(id));
  const next = new Set<string>();
  for (const id of remoteAfter) if (likedAfter.has(id) || base.has(id)) next.add(id);
  return next;
}

/** When a play counts — the rule ByTune's own statistics use: half the song, at least 30 s, at most 4 minutes. */
export function playCreditSeconds(durationSec: number): number {
  const half = durationSec > 0 ? durationSec / 2 : 30;
  return Math.min(Math.max(half, 30), 240);
}
