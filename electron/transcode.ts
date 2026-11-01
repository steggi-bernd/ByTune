/**
 * Playback for formats Chromium cannot decode: AIFF, ALAC, WMA, WavPack,
 * APE and DSD (DSF/DFF). Like Aideo, ByTune hands those to FFmpeg — but
 * instead of a live pipe, the result is a lossless FLAC in a disk cache, so
 * the player gets an ordinary file with full seeking (range requests).
 *
 *  - PCM sources keep their sample rate and channels; samples are stored as
 *    24-bit FLAC, which is lossless for every 16/24-bit source
 *  - DSD becomes 24-bit PCM at 176.4 kHz (the target Aideo's "hires" mode uses)
 *  - FFmpeg is looked up in ByTune's data folder, next to the app, then on PATH
 *  - the cache is size-capped; the least recently played files go first
 */
import { app } from "electron";
import { spawn, spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { foldPathCase } from "./local-paths";

/** Extensions Chromium's media stack cannot open at all. */
const ALWAYS_TRANSCODE = new Set([".aiff", ".aif", ".aifc", ".wma", ".wv", ".ape", ".dsf", ".dff"]);
/** MP4-family containers: AAC plays natively, ALAC inside them does not. */
const MP4_FAMILY = new Set([".m4a", ".mp4", ".alac", ".caf"]);
const DSD = new Set([".dsf", ".dff"]);

const CACHE_LIMIT_BYTES = 3 * 1024 * 1024 * 1024;
const TRANSCODE_TIMEOUT_MS = 5 * 60 * 1000;

export type TranscodeFailure = "ffmpeg-missing" | "transcode-failed";

export class TranscodeError extends Error {
  constructor(readonly reason: TranscodeFailure, message: string) {
    super(message);
  }
}

/* ------------------------------------------------------------- FFmpeg */

let ffmpegCache: { path: string | null; version: string | null } | null = null;

function probeFfmpeg(candidate: string): string | null {
  try {
    const res = spawnSync(candidate, ["-hide_banner", "-version"], { encoding: "utf-8", timeout: 5000, windowsHide: true });
    if (res.status !== 0) return null;
    return /ffmpeg version (\S+)/.exec(res.stdout ?? "")?.[1] ?? "unknown";
  } catch {
    return null;
  }
}

/** Where FFmpeg is (or null), and its version. `recheck` drops the cached answer. */
export function ffmpegStatus(recheck = false): { path: string | null; version: string | null } {
  if (ffmpegCache && !recheck) return ffmpegCache;
  const exe = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = [
    path.join(app.getPath("userData"), exe),
    path.join(path.dirname(process.execPath), exe),
    "ffmpeg", // PATH
  ];
  for (const candidate of candidates) {
    if (candidate !== "ffmpeg" && !fs.existsSync(candidate)) continue;
    const version = probeFfmpeg(candidate);
    if (version) return (ffmpegCache = { path: candidate, version });
  }
  return (ffmpegCache = { path: null, version: null });
}

/* ------------------------------------------------------------- decisions */

const codecMemo = new Map<string, string | null>();

async function probeCodec(filePath: string): Promise<string | null> {
  if (codecMemo.has(filePath)) return codecMemo.get(filePath) ?? null;
  let codec: string | null = null;
  try {
    const { parseFile } = await import("music-metadata");
    const meta = await parseFile(filePath, { duration: false, skipCovers: true });
    codec = meta.format.codec ?? null;
  } catch {
    codec = null;
  }
  codecMemo.set(filePath, codec);
  return codec;
}

/** Whether Chromium needs this file converted first. `codec` is the scan's codec, when known. */
export async function needsTranscode(filePath: string, codec?: string): Promise<boolean> {
  const ext = path.extname(filePath).toLowerCase();
  if (ALWAYS_TRANSCODE.has(ext)) return true;
  if (!MP4_FAMILY.has(ext)) return false;
  return /alac/i.test(codec ?? (await probeCodec(filePath)) ?? "");
}

/* ------------------------------------------------------------- cache */

let cacheDirReady = false;
function cacheDir(): string {
  const dir = path.join(app.getPath("userData"), "transcode-cache");
  if (!cacheDirReady) {
    fs.mkdirSync(dir, { recursive: true });
    cacheDirReady = true;
  }
  return dir;
}

function cachePathFor(filePath: string, stat: fs.Stats): string {
  const key = `${foldPathCase(filePath)}|${Math.floor(stat.mtimeMs)}|${stat.size}`;
  return path.join(cacheDir(), `${crypto.createHash("sha1").update(key).digest("hex").slice(0, 24)}.flac`);
}

function pruneCache(keep: string): void {
  try {
    const dir = cacheDir();
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".flac"))
      .map((f) => {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        return { p, size: st.size, used: st.mtimeMs };
      })
      .sort((a, b) => a.used - b.used);
    let total = files.reduce((sum, f) => sum + f.size, 0);
    for (const f of files) {
      if (total <= CACHE_LIMIT_BYTES) break;
      if (f.p === keep) continue;
      fs.unlinkSync(f.p);
      total -= f.size;
    }
  } catch {
    /* pruning is best effort */
  }
}

function runFfmpeg(ffmpeg: string, input: string, output: string, dsd: boolean): Promise<void> {
  const args = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", input, "-map", "0:a:0", "-vn"];
  if (dsd) args.push("-af", "aresample=176400");
  args.push("-c:a", "flac", "-compression_level", "2", "-sample_fmt", "s32", "-bits_per_raw_sample", "24", "-f", "flac", output);
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => {
      if (stderr.length < 2000) stderr += d.toString();
    });
    const timer = setTimeout(() => child.kill(), TRANSCODE_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().split(/\r?\n/).pop() || `ffmpeg exited with ${code}`));
    });
  });
}

/** Original path → the converted file the proxy serves instead. */
const served = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

/**
 * The file the player should stream for `filePath`: the original when
 * Chromium can decode it, otherwise a cached lossless FLAC (converted on the
 * first play; later plays reuse it).
 */
export async function ensurePlayable(filePath: string, codec?: string): Promise<string> {
  if (!(await needsTranscode(filePath, codec))) return filePath;
  const running = inflight.get(filePath);
  if (running) return running;
  const job = (async () => {
    const stat = fs.statSync(filePath);
    const target = cachePathFor(filePath, stat);
    if (fs.existsSync(target)) {
      const now = new Date();
      fs.utimesSync(target, now, now); // mark as recently played for pruning
      served.set(filePath, target);
      return target;
    }
    const ffmpeg = ffmpegStatus().path;
    if (!ffmpeg) {
      throw new TranscodeError("ffmpeg-missing", `${path.extname(filePath)} needs FFmpeg`);
    }
    const tmp = `${target}.${process.pid}.part`;
    const started = Date.now();
    try {
      await runFfmpeg(ffmpeg, filePath, tmp, DSD.has(path.extname(filePath).toLowerCase()));
      fs.renameSync(tmp, target);
    } catch (err) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* nothing written */
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[bytune] transcode failed (${path.basename(filePath)}): ${msg}`);
      throw new TranscodeError("transcode-failed", msg);
    }
    console.log(`[bytune] transcoded ${path.extname(filePath)} → FLAC in ${Date.now() - started} ms`);
    served.set(filePath, target);
    pruneCache(target);
    return target;
  })().finally(() => inflight.delete(filePath));
  inflight.set(filePath, job);
  return job;
}

/** The converted file for an original path, when one was prepared this session. */
export function servedPathFor(filePath: string): string {
  const target = served.get(filePath);
  return target && fs.existsSync(target) ? target : filePath;
}
