/**
 * Mixes built from the user's own library (Symfonium's "mixes", Spotify's
 * "Made for you"): one per big genre and decade, "On repeat" (most played)
 * and "Rediscover" (never played yet). Each mix is shuffled with a seed of
 * its id + today's date, so it stays put through the day and changes daily.
 */
import type { PlayCounts } from "../stores/catalog";
import type { Track } from "../types";
import { decadeOf, genresOf } from "./catalogIndex";

export interface Mix {
  id: string;
  title: string;
  subtitle: string;
  tracks: Track[];
}

const MIX_SIZE = 50;
const MIN_TRACKS = 8;

function seededShuffle<T>(items: T[], seedText: string): T[] {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i++) seed = Math.imul(seed ^ seedText.charCodeAt(i), 16777619);
  const rand = (): number => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const today = (): string => new Date().toISOString().slice(0, 10);

function make(id: string, title: string, subtitle: string, pool: Track[]): Mix {
  return { id, title, subtitle, tracks: seededShuffle(pool, `${id}|${today()}`).slice(0, MIX_SIZE) };
}

export function genreMixes(tracks: Track[], limit = 8): Mix[] {
  const byGenre = new Map<string, { name: string; tracks: Track[] }>();
  for (const t of tracks) {
    for (const g of genresOf(t)) {
      const key = g.toLowerCase();
      const cur = byGenre.get(key) ?? { name: g, tracks: [] };
      cur.tracks.push(t);
      byGenre.set(key, cur);
    }
  }
  return [...byGenre.entries()]
    .filter(([, v]) => v.tracks.length >= MIN_TRACKS)
    .sort((a, b) => b[1].tracks.length - a[1].tracks.length)
    .slice(0, limit)
    .map(([key, v]) => make(`genre:${key}`, `${v.name} Mix`, `${v.tracks.length} songs`, v.tracks));
}

export function decadeMixes(tracks: Track[]): Mix[] {
  const byDecade = new Map<string, Track[]>();
  for (const t of tracks) {
    const d = decadeOf(t.year);
    if (!d) continue;
    byDecade.set(d, [...(byDecade.get(d) ?? []), t]);
  }
  return [...byDecade.entries()]
    .filter(([, list]) => list.length >= MIN_TRACKS)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([d, list]) => make(`decade:${d}`, `${d} Mix`, `${list.length} songs from the ${d}`, list));
}

export function onRepeatMix(tracks: Track[], counts: PlayCounts): Mix | null {
  const played = tracks.filter((t) => (counts[t.id]?.plays ?? 0) >= 2);
  if (played.length < MIN_TRACKS) return null;
  const top = [...played].sort((a, b) => (counts[b.id]?.plays ?? 0) - (counts[a.id]?.plays ?? 0)).slice(0, MIX_SIZE);
  // Ranked, not shuffled: this one is literally your most played songs.
  return { id: "onrepeat", title: "On Repeat", subtitle: "Your most played songs", tracks: top };
}

export function rediscoverMix(tracks: Track[], counts: PlayCounts): Mix | null {
  const unplayed = tracks.filter((t) => !counts[t.id]?.plays);
  if (unplayed.length < MIN_TRACKS) return null;
  return make("rediscover", "Rediscover", "Songs you haven't played yet", unplayed);
}

/** Every mix for the home page, personal ones first. */
export function allMixes(tracks: Track[], counts: PlayCounts): Mix[] {
  return [
    onRepeatMix(tracks, counts),
    rediscoverMix(tracks, counts),
    ...genreMixes(tracks),
    ...decadeMixes(tracks),
  ].filter((m): m is Mix => !!m);
}

/** Rebuild one mix by id (the mix page). */
export function mixById(id: string, tracks: Track[], counts: PlayCounts): Mix | null {
  if (id === "onrepeat") return onRepeatMix(tracks, counts);
  if (id === "rediscover") return rediscoverMix(tracks, counts);
  if (id.startsWith("genre:")) return genreMixes(tracks, Infinity).find((m) => m.id === id) ?? null;
  if (id.startsWith("decade:")) return decadeMixes(tracks).find((m) => m.id === id) ?? null;
  return null;
}
