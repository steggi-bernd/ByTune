/**
 * Lyrics you can search (Search → "In lyrics"): the lyrics ByTune has seen,
 * as plain lines — a song's own (a .lrc beside the file, its lyrics tag, what
 * a Jellyfin or Navidrome server sent) and the online answers already in the
 * lyrics cache. library-lyrics.ts fills it, in the background a few files at
 * a time and whenever a song's lyrics show up. A search only looks through
 * what is here and never goes online.
 *
 * Kept beside the lyrics cache (lyrics-cache/index.json): it is derived
 * data, rebuilt when lost, and stays out of the backups of data/.
 */
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { FetchedLyrics } from "./lyrics";

export interface IndexEntry {
  /** what the lines were read from: a file's "<mtime>:<size>:<.lrc mtime>", "cache:<mtime>", or "seen" (noted while playing) */
  sig: string;
  lines: string[];
  /** seconds per line, when the lyrics are synced */
  times?: number[];
}

export interface LyricMatch {
  id: string;
  /** the matching line as written */
  line: string;
  /** seconds into the song, when the lyrics are synced */
  time?: number;
}

const MAX_LINES = 400;
const MAX_MATCHES = 40;

/** Case, accents, apostrophes and punctuation don't count: "dont" finds "Don't", "cafe" finds "Café". */
export function foldText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** A song's lyrics as plain lines (with their times when synced); instrumental gaps and blank lines dropped. */
export function linesOf(lyrics: FetchedLyrics | null): { lines: string[]; times?: number[] } {
  if (!lyrics) return { lines: [] };
  if (lyrics.synced?.length) {
    const sung = lyrics.synced.filter((l) => !l.gap && l.text.trim()).slice(0, MAX_LINES);
    return { lines: sung.map((l) => l.text.trim()), times: sung.map((l) => Math.round(l.time * 10) / 10) };
  }
  const lines = (lyrics.plain ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_LINES);
  return { lines };
}

/**
 * The songs whose lyrics hold the query, each with the first line it's in:
 * a line starting with it ranks first, then one where a word starts with it,
 * then the rest. `foldedOf` lets the caller keep the folded lines between
 * searches.
 */
export function findInLyrics(
  entries: Iterable<[string, IndexEntry]>,
  query: string,
  limit = MAX_MATCHES,
  foldedOf: (id: string, entry: IndexEntry) => string[] = (_id, e) => e.lines.map(foldText)
): LyricMatch[] {
  const q = foldText(query);
  if (q.length < 3) return [];
  const ranked: { match: LyricMatch; rank: number }[] = [];
  for (const [id, entry] of entries) {
    if (!entry.lines.length) continue;
    const folded = foldedOf(id, entry);
    for (let i = 0; i < folded.length; i++) {
      const at = folded[i].indexOf(q);
      if (at < 0) continue;
      const rank = at === 0 ? 0 : folded[i][at - 1] === " " ? 1 : 2;
      const time = entry.times?.[i];
      ranked.push({ match: { id, line: entry.lines[i], ...(typeof time === "number" ? { time } : {}) }, rank });
      break;
    }
  }
  return ranked
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((r) => r.match);
}

/* ------------------------------------------------------------- the index on disk */

let entries: Map<string, IndexEntry> | null = null;
const foldedCache = new Map<string, string[]>();
let dirty = false;
let saveTimer: NodeJS.Timeout | null = null;

function indexFile(): string {
  return path.join(app.getPath("userData"), "lyrics-cache", "index.json");
}

function load(): Map<string, IndexEntry> {
  if (entries) return entries;
  entries = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(indexFile(), "utf8")) as { v?: number; songs?: Record<string, IndexEntry> };
    if (raw?.v === 1 && raw.songs && typeof raw.songs === "object") {
      for (const [id, e] of Object.entries(raw.songs)) {
        if (e && typeof e.sig === "string" && Array.isArray(e.lines)) entries.set(id, e);
      }
    }
  } catch {
    /* none yet, or unreadable: it is rebuilt */
  }
  return entries;
}

export function lyricsIndexEntry(id: string): IndexEntry | undefined {
  return load().get(id);
}

export function setLyricsIndexEntry(id: string, entry: IndexEntry): void {
  load().set(id, entry);
  foldedCache.delete(id);
  dirty = true;
  saveTimer ??= setTimeout(() => {
    saveTimer = null;
    void saveLyricsIndex();
  }, 10_000);
}

/** Songs gone from the library leave the index. */
export function keepLyricsIndexOf(ids: ReadonlySet<string>): void {
  for (const id of [...load().keys()]) {
    if (ids.has(id)) continue;
    load().delete(id);
    foldedCache.delete(id);
    dirty = true;
  }
}

export async function saveLyricsIndex(): Promise<void> {
  if (!dirty || !entries) return;
  dirty = false;
  const target = indexFile();
  const tmp = `${target}.tmp`;
  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(tmp, JSON.stringify({ v: 1, songs: Object.fromEntries(entries) }));
    await fs.promises.rename(tmp, target);
  } catch (err) {
    dirty = true;
    console.warn("[bytune] lyrics index write failed:", err instanceof Error ? err.message : err);
  }
}

/** At quit: what is still waiting goes to disk now. */
export function saveLyricsIndexSync(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (!dirty || !entries) return;
  try {
    const target = indexFile();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, JSON.stringify({ v: 1, songs: Object.fromEntries(entries) }));
    fs.renameSync(`${target}.tmp`, target);
    dirty = false;
  } catch {
    /* rebuilt next time */
  }
}

/** Lyrics that just showed up for a song (it played, or its lyrics opened): searchable from now on. */
export function noteLyrics(id: string, lyrics: FetchedLyrics | null): void {
  if (!id) return;
  const { lines, times } = linesOf(lyrics);
  if (!lines.length) return;
  const cur = load().get(id);
  if (cur && cur.lines.length === lines.length && cur.lines.every((l, i) => l === lines[i])) return;
  setLyricsIndexEntry(id, { sig: "seen", lines, ...(times ? { times } : {}) });
}

export function searchLyrics(query: string): LyricMatch[] {
  return findInLyrics(load(), String(query ?? "").slice(0, 200), MAX_MATCHES, (id, entry) => {
    let folded = foldedCache.get(id);
    if (!folded) {
      folded = entry.lines.map(foldText);
      foldedCache.set(id, folded);
    }
    return folded;
  });
}
