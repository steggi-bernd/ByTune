/**
 * Casting: the session with one network player (upnp.ts speaks to it).
 *
 *  - a small media server, listening only on the address that reaches the
 *    player, serves only the song being cast — under a random path that
 *    changes with every song — and closes when casting stops
 *  - local files are read with byte ranges (seeking works); songs on
 *    Jellyfin/Navidrome stream through it, so the player never sees a
 *    server's token
 *  - the player's state and position are read once a second; a song that
 *    played to its end is reported once, so the queue can move on
 */
import * as fs from "fs";
import * as http from "http";
import * as os from "os";
import * as path from "path";
import { Readable } from "stream";
import { randomBytes } from "crypto";
import type { AddressInfo } from "net";
import * as jellyfin from "./jellyfin";
import { jellyfinStreamPlan } from "./jellyfin-stream";
import * as subsonic from "./subsonic";
import * as locallib from "./local-library";
import { discover, transport, type Renderer } from "./upnp";

export interface CastSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
}

export interface CastStatus {
  device: { id: string; name: string } | null;
  state: "idle" | "loading" | "playing" | "paused" | "stopped";
  trackId: string | null;
  position: number;
  duration: number;
  /** the player has asked this computer for the song (false: it may not reach it — a firewall) */
  fetched: boolean;
  /** the player's volume 0–1, null when it can't be set from here */
  volume: number | null;
  muted: boolean;
  /** the song played to its end (set on the one status that says so) */
  ended?: boolean;
  message?: string;
}

const MIME: Record<string, string> = {
  ".flac": "audio/flac", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".aac": "audio/aac",
  ".wav": "audio/wav", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".aif": "audio/aiff", ".aiff": "audio/aiff",
  ".m4b": "audio/mp4", ".webm": "audio/webm", ".webma": "audio/webm",
};
const SONG_ID = /^(local|jf|ss):[\w.:-]{1,128}$/;

let known = new Map<string, Renderer>();
let renderer: Renderer | null = null;
let server: http.Server | null = null;
let base = "";
let current: { song: CastSong; token: string; file: string | null } | null = null;
const IDLE: CastStatus = { device: null, state: "idle", trackId: null, position: 0, duration: 0, fetched: false, volume: null, muted: false };
let status: CastStatus = IDLE;
let poll: NodeJS.Timeout | null = null;
let ticking = false;
let emit: (s: CastStatus) => void = () => undefined;
/** the furthest position seen while playing this song, and whether it was reported as ended */
let reached = 0;
let endedReported = false;

export async function findDevices(): Promise<{ id: string; name: string; model: string }[]> {
  const list = await discover();
  known = new Map(list.map((r) => [r.id, r]));
  return list.map((r) => ({ id: r.id, name: r.name, model: r.model }));
}

/** This computer's IPv4 address on the player's network. */
export function addressFor(playerHost: string, nets: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): string | null {
  const num = (ip: string): number => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
  if (playerHost.startsWith("127.")) return "127.0.0.1";
  let fallback: string | null = null;
  for (const list of Object.values(nets)) {
    for (const a of list ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      fallback ??= a.address;
      const mask = num(a.netmask);
      const net = (ip: string): number => Number(BigInt(num(ip)) & BigInt(mask));
      if (net(a.address) === net(playerHost)) return a.address;
    }
  }
  return fallback;
}

/** A song from the renderer, checked; anything else is refused. */
export function songFrom(input: unknown): CastSong {
  const s = (input ?? {}) as Record<string, unknown>;
  const text = (v: unknown, fallback: string): string => (typeof v === "string" && v.trim() ? v.slice(0, 200) : fallback);
  if (typeof s.id !== "string" || !SONG_ID.test(s.id)) throw new Error("That song can't be cast");
  const duration = Number(s.duration);
  return {
    id: s.id,
    title: text(s.title, "Unknown title"),
    artist: text(s.artist, "Unknown artist"),
    album: text(s.album, ""),
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
  };
}

/** Byte ranges the way players ask for them; null for a range outside the file. */
export function byteRange(header: string | undefined, size: number): { start: number; end: number; partial: boolean } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header ?? "");
  if (!m || (!m[1] && !m[2])) return { start: 0, end: size - 1, partial: false };
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end, partial: true } : null;
}

const DLNA_HEADERS = {
  "transferMode.dlna.org": "Streaming",
  "contentFeatures.dlna.org": "DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000",
};

async function serve(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const token = /^\/cast\/([a-f0-9]{32})\//.exec(req.url ?? "")?.[1];
  if (!current || token !== current.token || (req.method !== "GET" && req.method !== "HEAD")) {
    res.writeHead(404).end();
    return;
  }
  const { song, file } = current;
  if (!status.fetched) set({ fetched: true });
  if (file) {
    const size = (await fs.promises.stat(file)).size;
    const range = byteRange(req.headers.range, size);
    if (!range) {
      res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      return;
    }
    res.writeHead(range.partial ? 206 : 200, {
      "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(range.end - range.start + 1),
      "Accept-Ranges": "bytes",
      ...(range.partial ? { "Content-Range": `bytes ${range.start}-${range.end}/${size}` } : {}),
      ...DLNA_HEADERS,
    });
    if (req.method === "HEAD") res.end();
    else fs.createReadStream(file, { start: range.start, end: range.end }).pipe(res);
    return;
  }
  // A server song: its stream, passed through with the player's range.
  const raw = song.id.slice(3);
  const upstream = song.id.startsWith("jf:") ? await jellyfin.fetchStream(raw, req.headers.range) : await subsonic.fetchStream(raw, req.headers.range);
  const headers: Record<string, string> = { ...DLNA_HEADERS };
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const v = upstream.headers.get(h);
    if (v) headers[h] = v;
  }
  res.writeHead(upstream.status, headers);
  if (req.method === "HEAD" || !upstream.body) res.end();
  else Readable.fromWeb(upstream.body as import("stream/web").ReadableStream).pipe(res);
}

function set(next: Partial<CastStatus>): void {
  status = { ...status, ...next };
  emit(status);
  if (status.ended) status = { ...status, ended: false };
}

async function tick(): Promise<void> {
  if (!renderer || !current || ticking) return;
  ticking = true;
  try {
    const playing = current;
    const [state, at] = await Promise.all([transport.state(renderer), transport.position(renderer)]);
    // A report about the song before (players switch over in their own time) says nothing about this one.
    if (current !== playing || (at.uri && !at.uri.includes(playing.token))) return;
    const s: CastStatus["state"] =
      state === "PLAYING" ? "playing" : state === "PAUSED_PLAYBACK" ? "paused" : state === "TRANSITIONING" ? "loading" : state === "STOPPED" || state === "NO_MEDIA_PRESENT" ? "stopped" : status.state;
    const duration = at.duration || current.song.duration;
    if (s === "playing") reached = Math.max(reached, at.position);
    // Played to its end: stopped after getting within a few seconds of it (players reset the position on stop).
    const ended = s === "stopped" && !endedReported && duration > 0 && reached >= duration - 4;
    if (ended) endedReported = true;
    set({ state: s, position: s === "stopped" && ended ? duration : at.position, duration, ended, message: undefined });
  } catch (err) {
    set({ message: err instanceof Error ? err.message : "The player doesn't answer" });
  } finally {
    ticking = false;
  }
}

export async function start(deviceId: string, onStatus: (s: CastStatus) => void): Promise<CastStatus> {
  const r = known.get(deviceId);
  if (!r) throw new Error("That player isn't on the network anymore — search again");
  await stop();
  const address = addressFor(new URL(r.avTransport.url).hostname);
  if (!address) throw new Error("This computer isn't on the player's network");
  const srv = http.createServer((req, res) => {
    serve(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, address, () => resolve());
  });
  server = srv;
  base = `http://${address}:${(srv.address() as AddressInfo).port}`;
  renderer = r;
  emit = onStatus;
  poll = setInterval(() => void tick(), 1000);
  // Its volume stays where it is: the slider shows it, and only moving the slider changes it.
  const [volume, muted] = await Promise.all([transport.getVolume(r).catch(() => null), transport.getMute(r).catch(() => false)]);
  set({ ...IDLE, device: { id: r.id, name: r.name }, volume: volume == null ? null : volume / 100, muted });
  return status;
}

/** The format a server song streams in — its own, or what the server converts it to (as it plays here). */
export function serverStreamExt(song: { id: string }): string {
  if (song.id.startsWith("jf:")) {
    const t = jellyfin.readLibrary().tracks.find((x) => x.id === song.id);
    const plan = jellyfinStreamPlan(t);
    if (plan !== "static") return `.${plan}`;
    const container = (t?.container ?? "").split(",")[0].trim().toLowerCase();
    return container ? `.${container}` : ".flac";
  }
  const suffix = (subsonic.readLibrary().tracks.find((x) => x.id === song.id)?.suffix ?? "").toLowerCase();
  return subsonic.SERVER_TRANSCODE.has(suffix) ? ".mp3" : suffix ? `.${suffix}` : ".mp3";
}

export async function load(song: CastSong, positionSec: number, play: boolean): Promise<void> {
  if (!renderer || !server) throw new Error("Not casting");
  const file = song.id.startsWith("local:") ? locallib.localStreamPath(song.id) : null;
  if (song.id.startsWith("local:") && !file) throw new Error("That file can't be reached right now");
  const ext = file ? path.extname(file).toLowerCase() : serverStreamExt(song);
  current = { song, token: randomBytes(16).toString("hex"), file };
  reached = positionSec;
  endedReported = false;
  set({ state: "loading", trackId: song.id, position: positionSec, duration: song.duration, fetched: false, ended: false });
  const url = `${base}/cast/${current.token}/song${ext}`;
  await transport.load(renderer, url, { ...song, mime: MIME[ext] ?? "audio/mpeg" });
  // Many players seek only once playing: start, seek, then pause when asked to wait.
  if (play || positionSec > 1) await transport.play(renderer);
  if (positionSec > 1) await transport.seek(renderer, positionSec).catch(() => undefined);
  if (!play) await transport.pause(renderer).catch(() => undefined);
  set({ state: play ? "playing" : "paused" });
}

export async function control(action: string, value: number): Promise<void> {
  if (!renderer) throw new Error("Not casting");
  if (action === "play") await transport.play(renderer);
  else if (action === "pause") await transport.pause(renderer);
  else if (action === "seek" && Number.isFinite(value) && value >= 0) {
    reached = value;
    await transport.seek(renderer, value);
  } else if (action === "volume" && Number.isFinite(value) && status.volume != null) {
    const v = Math.min(1, Math.max(0, value));
    await transport.volume(renderer, v * 100);
    set({ volume: v });
  } else if (action === "mute" && status.volume != null) {
    await transport.mute(renderer, value > 0);
    set({ muted: value > 0 });
  } else throw new Error("Unknown cast command");
  void tick();
}

export async function stop(): Promise<void> {
  if (poll) clearInterval(poll);
  poll = null;
  const r = renderer;
  renderer = null;
  current = null;
  if (r) await transport.stop(r).catch(() => undefined);
  if (server) {
    const srv = server;
    // A player keeps its stream open: drop it, or close() waits for it forever.
    srv.closeAllConnections();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  }
  server = null;
  set(IDLE);
  emit = () => undefined;
}

export function castStatus(): CastStatus {
  return status;
}
