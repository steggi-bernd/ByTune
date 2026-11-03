/**
 * What the computer's side panel knows about the playing song and its artist:
 * Genius for the song's story and credits, MusicBrainz, Wikidata and Wikipedia
 * for the artist. The phone asks them itself, and only for a player that's open.
 * Answers, misses too, stay on disk (an answer for a month, a miss for a week),
 * so each is asked once and the cards are there without a connection.
 */
import { useEffect, useState } from "react";
import { I18nManager } from "react-native";
import { artistFromOpenData, GENIUS_HEADERS, geniusFindWith, leadArtist, OPEN_DATA_AGENT, songFromGenius, songIsBy, type ArtistMeta, type SongInfo, type Track } from "./shared";
import { readJson, writeJson } from "./storage";

const HIT_KEEPS_MS = 30 * 24 * 60 * 60 * 1000;
const MISS_KEEPS_MS = 7 * 24 * 60 * 60 * 1000;
const ASK_MS = 8000;
/** A song skipped right away isn't worth asking about. */
const SETTLE_MS = 700;
/** MusicBrainz allows one request a second. */
const MB_SPACING_MS = 1100;

interface Kept<T> {
  at: number;
  value: T | null;
}

/** By what it's about; the name stays out of the file's name, whatever its script. */
function fileOf(key: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193);
  return `about-${(hash >>> 0).toString(16)}-${key.length}.json`;
}

async function freshOnDisk<T>(key: string): Promise<Kept<T> | null> {
  const kept = await readJson<Kept<T>>(fileOf(key));
  return kept && Date.now() - kept.at < (kept.value ? HIT_KEEPS_MS : MISS_KEEPS_MS) ? kept : null;
}

const asking = new Map<string, Promise<unknown>>();

/** No answer at all is not remembered: asked again next time, and an old answer is better than none until then. */
function askOnce<T>(key: string, ask: () => Promise<T | null>): Promise<T | null> {
  const going = asking.get(key) as Promise<T | null> | undefined;
  if (going) return going;
  const job = ask()
    .then((value) => {
      writeJson(fileOf(key), { at: Date.now(), value });
      return value;
    })
    .catch(async () => (await readJson<Kept<T>>(fileOf(key)))?.value ?? null)
    .finally(() => asking.delete(key));
  asking.set(key, job);
  return job;
}

async function getText(url: string, headers: Record<string, string>): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ASK_MS);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function songAbout(title: string, artist: string): Promise<SongInfo | null> {
  const hit = await geniusFindWith(title, artist, (url) => getText(url, GENIUS_HEADERS));
  if (hit === undefined) throw new Error("Genius didn't answer");
  if (!hit?.id) return null;
  const body = await getText(`https://genius.com/api/songs/${hit.id}?text_format=plain`, GENIUS_HEADERS);
  if (!body) throw new Error("Genius didn't answer");
  const song = JSON.parse(body)?.response?.song;
  return songIsBy(song, artist) ? songFromGenius(song, hit.url) : null;
}

async function getJson(url: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ASK_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": OPEN_DATA_AGENT, Accept: "application/json" }, signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

let mbQueue: Promise<unknown> = Promise.resolve();
let mbLast = 0;

function mb(pathAndQuery: string): Promise<any> {
  const next = mbQueue
    .catch(() => undefined)
    .then(async () => {
      const wait = mbLast + MB_SPACING_MS - Date.now();
      if (wait > 0) await new Promise((done) => setTimeout(done, wait));
      mbLast = Date.now();
      return getJson(`https://musicbrainz.org/ws/2/${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}fmt=json`);
    });
  mbQueue = next;
  return next;
}

/** The article in the phone's language, else in English. */
function languages(): string[] {
  const base = (I18nManager.getConstants().localeIdentifier ?? "en").split(/[-_]/)[0].toLowerCase();
  return [/^[a-z]{2,3}$/.test(base) ? base : "en", "en"];
}

function useAnswer<T>(key: string, active: boolean, ask: () => Promise<T | null>): T | null {
  const [answer, setAnswer] = useState<{ key: string; value: T | null } | null>(null);
  useEffect(() => {
    if (!active || !key) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void freshOnDisk<T>(key).then((kept) => {
      if (!alive) return;
      if (kept) setAnswer({ key, value: kept.value });
      else {
        timer = setTimeout(() => {
          void askOnce(key, ask).then((value) => {
            if (alive) setAnswer({ key, value });
          });
        }, SETTLE_MS);
      }
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // The key says what's asked; the function only says how.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active]);
  return answer?.key === key ? answer.value : null;
}

export function useSongAbout(track: Track, active: boolean): SongInfo | null {
  const artist = leadArtist(track.artist);
  return useAnswer(track.title ? `song|${artist.toLowerCase()}|${track.title.toLowerCase()}` : "", active, () => songAbout(track.title, artist));
}

export function useArtistAbout(track: Track, active: boolean): ArtistMeta | null {
  const lead = leadArtist(track.artist);
  return useAnswer(lead && lead.toLowerCase() !== "unknown artist" ? `artist|${lead.toLowerCase()}` : "", active, () => artistFromOpenData(lead, languages(), { mb, json: getJson }));
}
