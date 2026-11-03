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
import { artistFromGenius, picture, songFromGenius, songIsBy, type ArtistImages, type SongInfo } from "./genius";
import { GENIUS_HEADERS, geniusFindSong, getText } from "./lyrics";

export { artistFromGenius, sameName, songFromGenius, songIsBy, type ArtistImages, type SongCredit, type SongInfo } from "./genius";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STORE = "song-info";
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 3000;

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
    const song = data?.response?.song;
    return songIsBy(song, artist) ? songFromGenius(song, hit.url) : null;
  });
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
