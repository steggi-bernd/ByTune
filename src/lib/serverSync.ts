/**
 * Server sync (Settings → Server sync): Liked Songs ↔ the Jellyfin and
 * Navidrome favorites, both ways, and plays counted on the servers too.
 *
 *  - favorites: a like here is a favorite there, and a favorite set in
 *    another app (Finamp, Jellyfin Web, a Subsonic app) arrives here; taking
 *    one back on either side carries over (lib/favoriteSync.ts decides). A
 *    merged song (local file + server copy) counts for every server copy
 *  - when: at start, a few seconds after Liked Songs change, every ten
 *    minutes, and when the window comes back (at most once a minute)
 *  - plays: once a song has been heard long enough to count (the rule the
 *    own statistics use), each of its server copies gets one play; Navidrome
 *    also learns what's playing now
 *
 * A server that can't be reached is left out of a round entirely: nothing of
 * its favorites is taken back for not answering.
 */
import type { Track } from "../types";
import { nextFavoriteBase, planFavoriteSync, playCreditSeconds } from "./favoriteSync";
import { jellyfinToTrack, subsonicToTrack } from "./libraryTracks";
import { onPlayEvent } from "./playEvents";
import { useCatalog, versionsOf } from "../stores/catalog";
import { useLibrary } from "../stores/library";
import { useServerSync } from "../stores/serverSync";
import { useSettings } from "../stores/settings";

const SERVER_ID = /^(jf|ss):/;
const AFTER_CHANGE_MS = 3000;
const EVERY_MS = 10 * 60 * 1000;
const FOCUS_GAP_MS = 60 * 1000;

/** Every server copy of a song ("jf:…", "ss:…"). */
function serverIdsOf(track: Track): string[] {
  const ids = new Set([track.id, ...versionsOf(track).map((v) => v.id)]);
  return [...ids].filter((id) => SERVER_ID.test(id));
}

let running: Promise<void> | null = null;
let again = false;
let lastRun = 0;
/** set while this module changes Liked Songs itself — that change needs no sync of its own */
let ownChange = false;

/** One sync round; a request while one runs queues exactly one more. */
export function syncFavorites(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        again = false;
        await syncOnce();
      } while (again);
    } finally {
      running = null;
      lastRun = Date.now();
    }
  })();
  return running;
}

async function syncOnce(): Promise<void> {
  const bridge = window.bytune;
  if (!bridge?.serverFavorites || !useSettings.getState().serverSync || !useCatalog.getState().loaded) return;
  const answer = await bridge.serverFavorites();
  const servers: { prefix: string; tracks: Track[] }[] = [];
  if (answer.jellyfin?.ok) servers.push({ prefix: "jf:", tracks: answer.jellyfin.tracks.map(jellyfinToTrack) });
  if (answer.subsonic?.ok) servers.push({ prefix: "ss:", tracks: answer.subsonic.tracks.map(subsonicToTrack) });
  if (!servers.length) return;
  const stored = useServerSync.getState().base;
  const inRound = (id: string): boolean => servers.some((s) => id.startsWith(s.prefix));
  /** this server's first sync: nothing agreed with it yet */
  const firstRound = (id: string): boolean => !stored.some((b) => b.startsWith(id.slice(0, 3)));

  const liked = useLibrary.getState().liked;
  const likedIds = new Set(liked.flatMap(serverIdsOf).filter(inRound));
  const remoteTracks = new Map(servers.flatMap((s) => s.tracks.map((t) => [t.id, t] as const)));
  const remote = new Set(remoteTracks.keys());
  const base = new Set(stored.filter(inRound));
  const byId = useCatalog.getState().byId;
  const plan = planFavoriteSync(likedIds, remote, base, (id) => byId.has(id));

  // The servers, one call per song; a failed call is tried again next round.
  const failed = new Set<string>();
  for (const id of plan.favorite) await bridge.serverSetFavorite(id, true).catch(() => failed.add(id));
  for (const id of plan.unfavorite) await bridge.serverSetFavorite(id, false).catch(() => failed.add(id));

  // This side: the library's own copy of a song where it has one (it may merge with a local file).
  if (plan.like.length || plan.unlike.length) {
    const songOf = (id: string): Track => {
      const t = byId.get(id) ?? remoteTracks.get(id)!;
      return versionsOf(t)[0] ?? t;
    };
    const taken = new Set(plan.unlike);
    const remove = liked.filter((t) => serverIdsOf(t).some((id) => taken.has(id))).map((t) => t.id);
    ownChange = true;
    try {
      useLibrary.getState().applyServerLikes(
        plan.like.filter((id) => !firstRound(id)).map(songOf),
        plan.like.filter(firstRound).map(songOf),
        remove
      );
    } finally {
      ownChange = false;
    }
  }

  const next = nextFavoriteBase(likedIds, remote, base, plan, failed);
  useServerSync.getState().setBase([...stored.filter((id) => !inRound(id)), ...next]);
}

/** Plays: one per listen that crosses the statistics' threshold, for each server copy of the song. */
function watchServerPlays(): () => void {
  let listen: { id: string; counted: boolean } | null = null;
  return onPlayEvent((event) => {
    const bridge = window.bytune;
    const track = event.track;
    if (!bridge?.serverPlayed || !track || !useSettings.getState().serverPlays) return;
    if (event.type === "start") {
      listen = { id: track.id, counted: false };
      for (const id of serverIdsOf(track)) if (id.startsWith("ss:")) void bridge.serverNowPlaying(id).catch(() => undefined);
      return;
    }
    if (!listen || listen.id !== track.id || listen.counted) return;
    if (event.playedSec >= playCreditSeconds(track.duration)) {
      listen.counted = true;
      const at = Date.now();
      for (const id of serverIdsOf(track)) void bridge.serverPlayed(id, at).catch(() => undefined);
    }
  });
}

export function watchServerSync(): () => void {
  if (!window.bytune?.serverFavorites) return () => undefined;
  let timer: number | null = null;
  const soon = (ms = AFTER_CHANGE_MS): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void syncFavorites().catch(() => undefined);
    }, ms);
  };
  const offLiked = useLibrary.subscribe((s, prev) => {
    if (s.liked !== prev.liked && !ownChange) soon();
  });
  const offCatalog = useCatalog.subscribe((s, prev) => {
    if (s.loaded && !prev.loaded) soon(1500);
  });
  const offSettings = useSettings.subscribe((s, prev) => {
    if (s.serverSync && !prev.serverSync) soon(200);
  });
  const onFocus = (): void => {
    if (Date.now() - lastRun > FOCUS_GAP_MS) soon(1000);
  };
  window.addEventListener("focus", onFocus);
  const interval = window.setInterval(() => soon(0), EVERY_MS);
  if (useCatalog.getState().loaded) soon(1500);
  const offPlays = watchServerPlays();
  return () => {
    offLiked();
    offCatalog();
    offSettings();
    offPlays();
    window.removeEventListener("focus", onFocus);
    window.clearInterval(interval);
    if (timer !== null) window.clearTimeout(timer);
  };
}
