/**
 * About a song and its artist, from Genius — the source the lyrics already
 * ask (lyrics.ts): the song's story, its credits (written, produced, played
 * by), when and on what it came out and what it samples; for an artist, the
 * photo and the wide header image the artist page shows as its banner.
 * Genius's web API answers without a key.
 *
 * Answers — misses too — stay on disk (an answer for a month, a miss for a
 * week), so each song and artist is asked once.
 */
import * as persist from "./persist";
import { GENIUS_HEADERS, geniusFindSong, getText } from "./lyrics";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SongCredit {
  label: string;
  names: string[];
}

export interface SongInfo {
  source: "Genius";
  /** the song's Genius page — the credit and "read more" link */
  url: string;
  title: string;
  /** the story behind the song, plain text */
  description: string | null;
  /** "April 19, 2013" */
  released: string | null;
  album: string | null;
  /** "Written by" and "Produced by" first, then the detailed credits (guitar, mixing …) */
  credits: SongCredit[];
  /** songs this one samples or interpolates */
  samples: { title: string; artist: string }[];
  recordedAt: string | null;
}

export interface ArtistImages {
  name: string;
  /** square photo */
  photo: string | null;
  /** wide header image (about 16:9) — only when it isn't the photo again */
  banner: string | null;
  url: string | null;
}

const STORE = "song-info";
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 3000;
const MAX_CREDITS = 14;

/* ------------------------------------------------------------- cache */

interface Entry {
  at: number;
  value: unknown;
}
let cache: Record<string, Entry> | null = null;
let saveTimer: NodeJS.Timeout | null = null;
const inflight = new Map<string, Promise<unknown>>();

function entries(): Record<string, Entry> {
  if (!cache) {
    const raw = persist.readData(STORE);
    cache = raw && typeof raw === "object" ? (raw as Record<string, Entry>) : {};
  }
  return cache;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const all = entries();
    const keys = Object.keys(all);
    // Oldest out first once the cache is full.
    if (keys.length > MAX_ENTRIES) {
      for (const k of keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - MAX_ENTRIES)) delete all[k];
    }
    void persist.writeData(STORE, all);
  }, 2000);
}

async function cached<T>(key: string, work: () => Promise<T | null>): Promise<T | null> {
  const hit = entries()[key];
  if (hit && Date.now() - hit.at < (hit.value ? HIT_TTL_MS : MISS_TTL_MS)) return hit.value as T | null;
  const running = inflight.get(key);
  if (running) return running as Promise<T | null>;
  const job = (async () => {
    try {
      const value = await work();
      entries()[key] = { at: Date.now(), value };
      scheduleSave();
      return value;
    } catch {
      return null; // offline or refused: not remembered, asked again next time
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, job);
  return job;
}

/* ------------------------------------------------------------- answers */

/** Case, accents and punctuation aside — any script, not only Latin. */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string): string =>
    s
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const x = norm(a);
  return !!x && x === norm(b);
}

/** Genius's stand-in pictures ("default_avatar", "default_cover", "default_banner") are no picture. */
function picture(url: unknown): string | null {
  return typeof url === "string" && /^https:\/\//.test(url) && !/default_(avatar|cover|banner)/i.test(url) ? url : null;
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function names(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((a: any) => text(a?.name, 80))
    .filter((n): n is string => !!n)
    .slice(0, 12);
}

/** A song object from /api/songs/:id as the panel shows it. */
export function songFromGenius(s: any, fallbackUrl: string): SongInfo | null {
  if (!s || typeof s !== "object") return null;
  const credits: SongCredit[] = [];
  const writers = names(s.writer_artists);
  if (writers.length) credits.push({ label: "Written by", names: writers });
  const producers = names(s.producer_artists);
  if (producers.length) credits.push({ label: "Produced by", names: producers });
  for (const p of Array.isArray(s.custom_performances) ? s.custom_performances : []) {
    if (credits.length >= MAX_CREDITS) break;
    const label = text(p?.label, 60);
    const who = names(p?.artists);
    if (label && who.length) credits.push({ label, names: who });
  }
  const samples = (Array.isArray(s.song_relationships) ? s.song_relationships : [])
    .filter((r: any) => r?.relationship_type === "samples" || r?.relationship_type === "interpolates")
    .flatMap((r: any) => (Array.isArray(r.songs) ? r.songs : []))
    .map((x: any) => ({ title: text(x?.title, 120) ?? "", artist: text(x?.artist_names, 120) ?? text(x?.primary_artist?.name, 120) ?? "" }))
    .filter((x: { title: string }) => x.title)
    .slice(0, 6);
  // A song without a story reads "?" on Genius.
  const description = text(s.description?.plain, 4000);
  return {
    source: "Genius",
    url: text(s.url, 400) ?? fallbackUrl,
    title: text(s.title, 200) ?? "",
    description: description && description !== "?" ? description : null,
    released: text(s.release_date_for_display, 60),
    album: text(s.album?.name, 200),
    credits,
    samples,
    recordedAt: text(s.recording_location, 200),
  };
}

async function getJson(url: string): Promise<any> {
  const body = await getText(url, 8000, GENIUS_HEADERS);
  if (!body) throw new Error("no answer");
  return JSON.parse(body);
}

export function songInfo(title: string, artist: string): Promise<SongInfo | null> {
  const key = `song|${artist.trim().toLowerCase()}|${title.trim().toLowerCase()}`;
  return cached(key, async () => {
    const hit = await geniusFindSong(title, artist);
    if (hit === undefined) throw new Error("Genius didn't answer"); // offline: ask again next time
    if (!hit?.id) return null;
    const data = await getJson(`https://genius.com/api/songs/${hit.id}?text_format=plain`);
    return songFromGenius(data?.response?.song, hit.url);
  });
}

/** The artist search's hit of exactly this name, as photo and banner. */
export function artistFromGenius(sections: unknown, name: string): ArtistImages | null {
  const section = Array.isArray(sections) ? sections.find((s: any) => s?.type === "artist") : null;
  const hit = (Array.isArray(section?.hits) ? section.hits : []).map((h: any) => h?.result).find((r: any) => r && sameName(String(r.name ?? ""), name));
  if (!hit) return null;
  const photo = picture(hit.image_url);
  const banner = picture(hit.header_image_url);
  if (!photo && !banner) return null;
  return { name: text(hit.name, 200) ?? name, photo, banner: banner && banner !== photo ? banner : null, url: text(hit.url, 400) };
}

export function artistImages(name: string): Promise<ArtistImages | null> {
  const key = `artist|${name.trim().toLowerCase()}`;
  return cached(key, async () => {
    const data = await getJson(`https://genius.com/api/search/multi?q=${encodeURIComponent(name)}`);
    return artistFromGenius(data?.response?.sections, name);
  }).then(withoutStandIns);
}

/** Answers kept before a stand-in picture was recognized as one lose it here. */
function withoutStandIns(found: ArtistImages | null): ArtistImages | null {
  if (!found) return null;
  const photo = picture(found.photo);
  const banner = picture(found.banner);
  return photo || banner ? { ...found, photo, banner } : null;
}
