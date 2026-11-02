/**
 * Mixes built from the user's own library (Symfonium's "mixes", Spotify's
 * "Made for you"): one per big genre and decade, "On repeat" (most played),
 * "Rediscover" (never played yet) and one for this time of day and week
 * ("Sunday Evening", from the listening history). Each mix is shuffled with a
 * seed of its id + today's date, so it stays put through the day and changes
 * daily.
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

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Sunday Evening": the weekday and the part of the day; past midnight it is still the night before. */
export function momentTitle(now: number): string {
  const d = new Date(now);
  const h = d.getHours();
  const part = h < 5 || h >= 22 ? "Night" : h >= 18 ? "Evening" : h >= 14 ? "Afternoon" : h >= 11 ? "Midday" : "Morning";
  return `${WEEKDAYS[h < 5 ? (d.getDay() + 6) % 7 : d.getDay()]} ${part}`;
}

/**
 * What you usually play around now: the songs the listening history ties to
 * this time of day and week (scores from listens.ts scoreMoments), best
 * first, in an order that holds through this part of the day. `keyOf` turns
 * a played copy's id into its song's (merged duplicates).
 */
export function momentMix(
  tracks: Track[],
  scores: readonly { id: string; score: number }[],
  keyOf: (id: string) => string = (id) => id,
  now = Date.now()
): Mix | null {
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const picked: Track[] = [];
  const seen = new Set<string>();
  for (const s of scores) {
    const t = byId.get(keyOf(s.id)) ?? byId.get(s.id);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    picked.push(t);
    if (picked.length >= MIX_SIZE) break;
  }
  if (picked.length < MIN_TRACKS) return null;
  const title = momentTitle(now);
  return { id: "moment", title, subtitle: "What you usually play around now", tracks: seededShuffle(picked, `moment|${title}|${today()}`) };
}

/**
 * Two mixes by sound (the sound analysis' energy): the calmest and the most
 * energetic fifth of the measured songs — relative to this library, so a
 * loud collection still gets its calm mix. Both need eight songs each.
 */
export function moodMixes(tracks: Track[], energyOf: (t: Track) => number | undefined): Mix[] {
  const measured = tracks
    .map((t) => ({ t, e: energyOf(t) }))
    .filter((x): x is { t: Track; e: number } => typeof x.e === "number")
    .sort((a, b) => a.e - b.e);
  if (measured.length < MIN_TRACKS * 2) return [];
  const fifth = Math.max(MIN_TRACKS, Math.floor(measured.length / 5));
  return [
    make("mood:calm", "Calm Mix", "Quiet, gentle songs from your library", measured.slice(0, fifth).map((x) => x.t)),
    make("mood:upbeat", "Upbeat Mix", "Your most energetic songs", measured.slice(-fifth).map((x) => x.t)),
  ];
}

const noEnergy = (): undefined => undefined;

/** Every mix for the home page, personal ones first. */
export function allMixes(tracks: Track[], counts: PlayCounts, energyOf: (t: Track) => number | undefined = noEnergy): Mix[] {
  return [
    onRepeatMix(tracks, counts),
    rediscoverMix(tracks, counts),
    ...moodMixes(tracks, energyOf),
    ...genreMixes(tracks),
    ...decadeMixes(tracks),
  ].filter((m): m is Mix => !!m);
}

/** Rebuild one mix by id (the mix page). */
export function mixById(id: string, tracks: Track[], counts: PlayCounts, energyOf: (t: Track) => number | undefined = noEnergy): Mix | null {
  if (id === "onrepeat") return onRepeatMix(tracks, counts);
  if (id === "rediscover") return rediscoverMix(tracks, counts);
  if (id.startsWith("mood:")) return moodMixes(tracks, energyOf).find((m) => m.id === id) ?? null;
  if (id.startsWith("genre:")) return genreMixes(tracks, Infinity).find((m) => m.id === id) ?? null;
  if (id.startsWith("decade:")) return decadeMixes(tracks).find((m) => m.id === id) ?? null;
  return null;
}
