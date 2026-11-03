/**
 * The playing song's lyrics: from the server, else from LRCLIB, as on the computer.
 * Remembered: what was found once is there without a connection.
 */
import { useEffect, useState } from "react";
import { fetchLyrics, type LyricLine } from "./jellyfin";
import { primaryArtist, queryTitle, type Track } from "./shared";
import { readJson, writeJson } from "./storage";
import { useSession } from "./stores/session";

const known = new Map<string, LyricLine[]>();

const fileOf = (id: string): string => `lyrics-${id.replace(/[^a-zA-Z0-9]/g, "_")}.json`;

const LRCLIB_AGENT = "Songsta (https://github.com/steggi-bernd/Songsta)";
const LRCLIB_MS = 7000;

/** Its answer; null for nothing there. No answer at all throws. */
async function askLrclib(path: string): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LRCLIB_MS);
  try {
    const res = await fetch(`https://lrclib.net/api${path}`, { headers: { "User-Agent": LRCLIB_AGENT }, signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function fromLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const m = /^\[(\d{1,3}):(\d{2})[.:](\d{2,3})](.*)$/.exec(raw.trim());
    if (m) lines.push({ at: (Number(m[1]) * 60 + Number(m[2])) * 1000 + Number(m[3].padEnd(3, "0")), text: m[4].replace(/<\d{1,3}:\d{2}[.:]\d{2,3}>/g, "").trim() });
  }
  return lines.sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
}

function linesOf(record: any): LyricLine[] {
  const timed = typeof record?.syncedLyrics === "string" ? fromLrc(record.syncedLyrics) : [];
  if (timed.length) return timed;
  return typeof record?.plainLyrics === "string" && record.plainLyrics.trim() ? record.plainLyrics.split(/\r?\n/).map((text: string) => ({ text: text.trim() })) : [];
}

/** First the record of exactly this song; else, of those by that name, the closest in length: not a live cut of it. */
async function fromLrclib(track: Track): Promise<LyricLine[]> {
  const artist = primaryArtist(track.artist);
  const title = queryTitle(track.title);
  if (!artist || !title) return [];
  const asked = `artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
  const album = track.album ? `&album_name=${encodeURIComponent(track.album)}` : "";
  const exact = linesOf(track.duration > 0 ? await askLrclib(`/get?${asked}${album}&duration=${Math.round(track.duration)}`) : null);
  if (exact.length) return exact;
  const found: any[] = (await askLrclib(`/search?${asked}`)) ?? [];
  const off = (record: any): number => Math.abs((record?.duration ?? 0) - track.duration);
  const best = (Array.isArray(found) ? found : [])
    .filter((record) => linesOf(record).length && off(record) <= Math.max(12, track.duration * 0.08))
    .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) || off(a) - off(b))[0];
  return linesOf(best);
}

async function load(track: Track): Promise<LyricLine[]> {
  const seen = known.get(track.id) ?? (await readJson<LyricLine[]>(fileOf(track.id)));
  if (seen) {
    known.set(track.id, seen);
    return seen;
  }
  const session = useSession.getState().session;
  if (!session) return [];
  let got = await fetchLyrics(session, track);
  if (!got.length) {
    try {
      got = await fromLrclib(track);
      // Asked once while the app runs, when it could answer.
      known.set(track.id, got);
    } catch {
      /* no way out to it right now: asked again next time */
    }
  }
  // None today can be some tomorrow: only what was found stays.
  if (got.length) {
    known.set(track.id, got);
    writeJson(fileOf(track.id), got);
  }
  return got;
}

/** A song kept on the phone keeps its lyrics too. */
export function keepLyrics(track: Track): void {
  void load(track);
}

export function useLyrics(track: Track | undefined): LyricLine[] {
  const session = useSession((s) => s.session);
  const id = track?.id;
  const [lines, setLines] = useState<LyricLine[]>(() => (id ? known.get(id) ?? [] : []));
  useEffect(() => {
    let alive = true;
    if (!id || !track || !session) {
      setLines([]);
      return;
    }
    const seen = known.get(id);
    if (seen) {
      setLines(seen);
      return;
    }
    setLines([]);
    void load(track).then((got) => {
      if (alive) setLines(got);
    });
    return () => {
      alive = false;
    };
    // The song is what counts, not the object carrying it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, session]);
  return lines;
}

/** The line at this moment; -1 before the first and on lyrics that aren't timed. */
export function currentLine(lines: LyricLine[], positionMs: number): number {
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].at;
    if (start === undefined) return -1;
    if (start <= positionMs) at = i;
    else break;
  }
  return at;
}
