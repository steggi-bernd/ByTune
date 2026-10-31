/**
 * Lyrics for the local player, in this order:
 *
 *  1. what the music already carries — a sidecar .lrc next to the file, the
 *     file's own lyrics tag, or the lyrics a Jellyfin/Navidrome server has
 *  2. an earlier online answer from the disk cache
 *  3. the open lyric providers (lyrics.ts); a hit is then cached on disk
 *
 * So a song with its own lyrics never goes online, and a song that needed the
 * providers asks them once. Misses are only remembered for the session: the
 * providers swallow network errors, so a miss can't be told apart from being
 * offline, and caching it would hide lyrics that do exist.
 */
import { app } from "electron";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { fetchLyrics as fetchJellyfinLyrics } from "./jellyfin";
import { fetchLyrics as fetchSubsonicLyrics } from "./subsonic";
import { localTrackById } from "./local-library";
import { fetchLyrics as fetchProviderLyrics, lyricsFromText, type FetchedLyrics } from "./lyrics";

export interface LyricsRequest {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}

const MAX_SIDECAR_BYTES = 512 * 1024;

function lrcStamp(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${String(m).padStart(2, "0")}:${(sec - m * 60).toFixed(2).padStart(5, "0")}`;
}

/** `Song.lrc` next to `Song.flac`. */
async function sidecarLyrics(audioPath: string): Promise<FetchedLyrics | null> {
  const stem = path.join(path.dirname(audioPath), path.basename(audioPath, path.extname(audioPath)));
  for (const candidate of [`${stem}.lrc`, `${stem}.LRC`]) {
    try {
      const stat = await fs.promises.stat(candidate);
      if (!stat.isFile() || stat.size > MAX_SIDECAR_BYTES) continue;
      const found = lyricsFromText("Lyrics file (.lrc)", await fs.promises.readFile(candidate, "utf-8"));
      if (found) return found;
    } catch {
      /* no such file */
    }
  }
  return null;
}

/** USLT/SYLT (MP3), LYRICS (FLAC/Ogg), ©lyr (M4A) — whatever the tags carry. */
async function embeddedLyrics(audioPath: string): Promise<FetchedLyrics | null> {
  try {
    const { parseFile } = await import("music-metadata");
    const meta = await parseFile(audioPath, { duration: false, skipCovers: true });
    for (const tag of meta.common.lyrics ?? []) {
      // Synchronized frames carry their own stamps; only millisecond stamps are usable.
      const timed = (tag.syncText ?? []).filter((s) => typeof s.timestamp === "number");
      if (timed.length && Number(tag.timeStampFormat) === 2) {
        const found = lyricsFromText(
          "Embedded lyrics",
          timed.map((s) => `[${lrcStamp((s.timestamp as number) / 1000)}]${s.text}`).join("\n")
        );
        if (found) return found;
      }
      if (tag.text) {
        const found = lyricsFromText("Embedded lyrics", tag.text);
        if (found) return found;
      }
    }
  } catch {
    /* unreadable tags */
  }
  return null;
}

/* ------------------------------------------------------------- disk cache */

function cacheFile(id: string): string {
  const name = crypto.createHash("sha1").update(id).digest("hex").slice(0, 24);
  return path.join(app.getPath("userData"), "lyrics-cache", `${name}.json`);
}

async function readCached(id: string): Promise<FetchedLyrics | null> {
  try {
    const raw = JSON.parse(await fs.promises.readFile(cacheFile(id), "utf-8")) as { lyrics?: FetchedLyrics };
    return raw.lyrics ?? null;
  } catch {
    return null;
  }
}

async function writeCached(id: string, lyrics: FetchedLyrics): Promise<void> {
  try {
    const file = cacheFile(id);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, JSON.stringify({ at: Date.now(), lyrics }));
  } catch (err) {
    console.warn("[bytune] lyrics cache write failed:", err instanceof Error ? err.message : err);
  }
}

/* ------------------------------------------------------------- lookup */

/** Online answers (and misses) already fetched this session. */
const sessionMemo = new Map<string, FetchedLyrics | null>();

/** The music's own lyrics, if it has any. */
async function ownLyrics(id: string): Promise<FetchedLyrics | null> {
  if (id.startsWith("local:")) {
    const track = localTrackById(id);
    if (!track) return null;
    return (await sidecarLyrics(track.path)) ?? (await embeddedLyrics(track.path));
  }
  if (id.startsWith("jf:")) {
    const text = await fetchJellyfinLyrics(id.slice(3));
    return text ? lyricsFromText("Jellyfin", text) : null;
  }
  if (id.startsWith("ss:")) {
    const text = await fetchSubsonicLyrics(id.slice(3));
    return text ? lyricsFromText("Navidrome", text) : null;
  }
  return null;
}

export async function libraryLyrics(q: LyricsRequest): Promise<FetchedLyrics | null> {
  if (!q?.id) return null;
  // Read fresh every time: editing a .lrc while ByTune runs shows up on the next play.
  const own = await ownLyrics(q.id);
  if (own) return own;
  if (sessionMemo.has(q.id)) return sessionMemo.get(q.id) ?? null;
  const cached = await readCached(q.id);
  if (cached) {
    sessionMemo.set(q.id, cached);
    return cached;
  }
  const duration = typeof q.duration === "number" && Number.isFinite(q.duration) ? Math.round(q.duration) : 0;
  const found = await fetchProviderLyrics(
    { id: q.id, title: q.title || "", artist: q.artist || "", album: q.album, duration },
    { prioritizeWordSync: true },
    {} // no YouTube sources: local files and Jellyfin items have no video behind them
  ).catch(() => null);
  sessionMemo.set(q.id, found);
  if (sessionMemo.size > 500) sessionMemo.delete(sessionMemo.keys().next().value as string);
  if (found) await writeCached(q.id, found);
  return found;
}
