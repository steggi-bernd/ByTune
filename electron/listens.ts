/**
 * The listening history, one line per listen — scrobbling that stays on this
 * computer. A listen is written the moment it counts as a play (half the
 * song, at least 30 s, at most 4 minutes in — the rule in stats.ts), stamped
 * with when it began, as Last.fm and ListenBrainz stamp theirs.
 *
 * It lives in data/listens.jsonl, is never synced to an account, and Replay
 * shows it and exports it as a spreadsheet (CSV). The songs' plays reach a
 * Jellyfin or Navidrome server only through the separate "Count plays on the
 * server" switch (src/lib/serverSync.ts).
 */
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import type { Track } from "../src/types";

export interface Listen {
  /** when the listen began, ms */
  at: number;
  id: string;
  title: string;
  artist: string;
  album: string;
  /** the song's length, seconds */
  duration: number;
}

const FILE = "listens.jsonl";
const MAX_PAGE = 500;
let pending: string[] = [];
let timer: NodeJS.Timeout | null = null;
let writing: Promise<void> = Promise.resolve();

function file(): string {
  const dir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, FILE);
}

/** One listen that just counted as a play. */
export function noteListen(track: Track, startedAt: number): void {
  if (!track?.id) return;
  const entry: Listen = {
    at: Math.round(startedAt),
    id: String(track.id).slice(0, 160),
    title: String(track.title ?? "").slice(0, 200),
    artist: String(track.artist ?? "").slice(0, 200),
    album: String(track.album ?? "").slice(0, 200),
    duration: Math.max(0, Math.round(Number(track.duration) || 0)),
  };
  pending.push(JSON.stringify(entry));
  timer ??= setTimeout(() => void flushListens(), 2000);
}

/** Written in order, one append at a time. */
export function flushListens(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!pending.length) return writing;
  const lines = `${pending.join("\n")}\n`;
  pending = [];
  writing = writing.then(() => fs.promises.appendFile(file(), lines, "utf8")).catch(() => undefined);
  return writing;
}

/** At quit: whatever is still waiting goes to disk now. */
export function flushListensSync(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!pending.length) return;
  try {
    fs.appendFileSync(file(), `${pending.join("\n")}\n`, "utf8");
  } catch {
    /* a read-only profile keeps nothing */
  }
  pending = [];
}

function readAll(): Listen[] {
  let text = "";
  try {
    text = fs.readFileSync(file(), "utf8");
  } catch {
    return [];
  }
  const out: Listen[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const l = JSON.parse(line) as Partial<Listen>;
      if (typeof l.at === "number" && typeof l.title === "string" && typeof l.id === "string") {
        out.push({ at: l.at, id: l.id, title: l.title, artist: String(l.artist ?? ""), album: String(l.album ?? ""), duration: Number(l.duration) || 0 });
      }
    } catch {
      /* a line cut by a crash — the rest stands */
    }
  }
  return out;
}

/** Newest first, a page at a time: the listens before `before` (ms), and whether older ones exist. */
export async function readListens(before?: number, limit = 100): Promise<{ listens: Listen[]; more: boolean; total: number }> {
  await flushListens();
  const all = readAll().sort((a, b) => b.at - a.at);
  const from = typeof before === "number" && Number.isFinite(before) ? all.filter((l) => l.at < before) : all;
  const n = Math.max(1, Math.min(MAX_PAGE, Math.floor(limit) || 100));
  return { listens: from.slice(0, n), more: from.length > n, total: all.length };
}

/** The whole history as a spreadsheet: one row per listen, oldest first. */
export async function listensCsv(): Promise<{ csv: string; count: number }> {
  await flushListens();
  const cell = (v: string | number): string => {
    const s = String(v);
    // Quote what needs it; a leading =, +, - or @ is defused so a spreadsheet never runs it as a formula.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = readAll().sort((a, b) => a.at - b.at);
  const lines = ["Listened at (UTC),Title,Artist,Album,Length (s)"];
  for (const l of rows) lines.push([new Date(l.at).toISOString(), l.title, l.artist, l.album, l.duration].map(cell).join(","));
  return { csv: `\ufeff${lines.join("\r\n")}\r\n`, count: rows.length };
}

/** Listens not yet on disk are forgotten (a stats reset: nothing written after it). */
export function dropPendingListens(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = [];
}

/** Forget every listen (Replay's reset, a data reset). */
export async function clearListens(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  pending = [];
  await writing;
  await fs.promises.rm(file(), { force: true });
}
