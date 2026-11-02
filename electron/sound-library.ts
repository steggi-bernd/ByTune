/**
 * The library's sound analysis (sound-analysis.ts) in the background: every
 * local song decoded once by FFmpeg into a mono 11 025 Hz stream and
 * measured, one song at a time with a pause in between, and measured again
 * only when its file changes. The results live beside the other caches
 * (analysis-cache/sound.json) — derived data, rebuilt when lost, outside the
 * backups — and reach the renderer as a map (sound:facts) and an event when
 * more are ready (sound:updated). Without FFmpeg nothing is measured;
 * Settings says so.
 */
import { app } from "electron";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { readLocalLibrary, type LocalTrack } from "./local-library";
import { ffmpegStatus } from "./transcode";
import { analyseSamples, type SoundFacts } from "./sound-analysis";

const RATE = 11025;
/** Decoded at most; a longer file's end is read on its own. */
const MAX_SECONDS = 720;
/** Bump when the measurements change: every song is measured again. */
const VERSION = 1;
const PAUSE_MS = 250;
const DECODE_TIMEOUT_MS = 120_000;

interface Entry extends SoundFacts {
  sig: string;
}

export interface SoundStatus {
  enabled: boolean;
  ffmpeg: boolean;
  /** songs measured (of the local songs) */
  done: number;
  total: number;
  running: boolean;
}

let entries: Map<string, Entry> | null = null;
let dirty = false;
let enabled = true;
let running: Promise<void> | null = null;
let again = false;
let status = { done: 0, total: 0, running: false };
/** Files FFmpeg couldn't read this session (a drive away): not retried until the next start. */
const failed = new Set<string>();
let onUpdate: () => void = () => undefined;

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const breathe = (): Promise<void> => new Promise((r) => setImmediate(r));
const sigOf = (t: LocalTrack): string => `${Math.floor(t.mtime)}:${t.size}`;

function cacheFile(): string {
  return path.join(app.getPath("userData"), "analysis-cache", "sound.json");
}

function load(): Map<string, Entry> {
  if (entries) return entries;
  entries = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as { v?: number; songs?: Record<string, Entry> };
    if (raw?.v === VERSION && raw.songs && typeof raw.songs === "object") {
      for (const [id, e] of Object.entries(raw.songs)) if (e && typeof e.sig === "string") entries.set(id, e);
    }
  } catch {
    /* none yet, or unreadable: measured again */
  }
  return entries;
}

function serialized(): string {
  return JSON.stringify({ v: VERSION, songs: Object.fromEntries(load()) });
}

async function save(): Promise<void> {
  if (!dirty) return;
  dirty = false;
  const target = cacheFile();
  try {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(`${target}.tmp`, serialized());
    await fs.promises.rename(`${target}.tmp`, target);
  } catch (err) {
    dirty = true;
    console.warn("[bytune] sound analysis write failed:", err instanceof Error ? err.message : err);
  }
}

/** At quit: what is still waiting goes to disk now. */
export function saveSoundIndexSync(): void {
  if (!dirty) return;
  try {
    const target = cacheFile();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(`${target}.tmp`, serialized());
    fs.renameSync(`${target}.tmp`, target);
    dirty = false;
  } catch {
    /* measured again next time */
  }
}

/** Every measured song's facts, by id (the renderer's mixes, details and transitions). */
export function soundFacts(): Record<string, SoundFacts> {
  const out: Record<string, SoundFacts> = {};
  for (const [id, { sig: _sig, ...facts }] of load()) out[id] = facts;
  return out;
}

export function soundStatus(): SoundStatus {
  return { enabled, ffmpeg: !!ffmpegStatus().path, ...status };
}

export function configureSoundAnalysis(opts: { onUpdate: () => void }): void {
  onUpdate = opts.onUpdate;
}

/**
 * The Settings switch: off stops after the song being measured; switching it
 * on starts at once. (The renderer reports the setting at every start —
 * that alone starts nothing: the first pass waits until the start is over.)
 */
export function setSoundAnalysisEnabled(on: boolean): void {
  const was = enabled;
  enabled = on !== false;
  if (enabled && !was) void analyseLibrarySound();
}

/** A file — or, with `-sseof`, its last seconds — as mono samples at RATE. */
function decode(ffmpeg: string, file: string, before: string[] = []): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin", ...before, "-i", file, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", String(RATE), "-t", String(MAX_SECONDS), "-f", "f32le", "-"];
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      chunks.push(d);
      size += d.length;
    });
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 1000) stderr += d.toString();
    });
    const timer = setTimeout(() => child.kill(), DECODE_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(stderr.trim().split(/\r?\n/).pop() || `ffmpeg exited with ${code}`));
      // Copied into a fresh buffer: Float32Array needs 4-byte alignment.
      const bytes = Buffer.concat(chunks, size);
      const aligned = new Uint8Array(bytes.length - (bytes.length % 4));
      aligned.set(bytes.subarray(0, aligned.length));
      resolve(new Float32Array(aligned.buffer));
    });
  });
}

async function measure(ffmpeg: string, track: LocalTrack): Promise<SoundFacts> {
  const facts = await analyseSamples(await decode(ffmpeg, track.path), RATE, breathe);
  if (track.duration <= MAX_SECONDS - 5) return facts;
  // Only the first twelve minutes were decoded: the real end comes from the last seconds.
  const end = await analyseSamples(await decode(ffmpeg, track.path, ["-sseof", "-3"]), RATE);
  return { ...facts, tailDb: end.tailDb, outroSilence: Math.min(end.outroSilence, 3) };
}

/**
 * Measures what isn't measured yet (or changed since), one pass at a time;
 * a call during a pass makes it go round once more.
 */
export function analyseLibrarySound(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await pass();
    } while (again);
  })()
    .catch((err) => console.warn("[bytune] sound analysis:", err instanceof Error ? err.message : err))
    .finally(() => {
      running = null;
      status.running = false;
    });
  return running;
}

async function pass(): Promise<void> {
  const ffmpeg = ffmpegStatus().path;
  const tracks = readLocalLibrary().tracks;
  const index = load();
  const present = new Set(tracks.map((t) => t.id));
  for (const id of [...index.keys()]) {
    if (present.has(id)) continue;
    index.delete(id);
    dirty = true;
  }
  const todo = tracks.filter((t) => index.get(t.id)?.sig !== sigOf(t) && !failed.has(t.id));
  status = { done: tracks.length - todo.length, total: tracks.length, running: enabled && !!ffmpeg && todo.length > 0 };
  if (!status.running || !ffmpeg) {
    await save();
    return;
  }
  let sinceSave = 0;
  for (const track of todo) {
    if (!enabled) break;
    try {
      index.set(track.id, { sig: sigOf(track), ...(await measure(ffmpeg, track)) });
      dirty = true;
    } catch {
      failed.add(track.id);
    }
    status.done++;
    if (++sinceSave >= 20) {
      sinceSave = 0;
      await save();
      onUpdate();
    }
    await pause(PAUSE_MS);
  }
  status.running = false;
  await save();
  onUpdate();
}
