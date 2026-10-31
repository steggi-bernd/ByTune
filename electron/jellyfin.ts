/**
 * Jellyfin — the user's own media server as a second library source.
 *
 *  - connect with username + password (the password is sent once to
 *    /Users/AuthenticateByName and never stored) or with an API key from the
 *    server dashboard; only the resulting token is kept, sealed with the OS
 *    keychain (secrets.ts)
 *  - the server's audio items are listed page by page and cached on disk, so
 *    the view renders instantly and only refreshes on request
 *  - audio streams through the local stream proxy and covers through the
 *    jfart:// scheme: the token stays in the main process, and plain-http
 *    LAN servers work without loosening the renderer's CSP
 *
 * Streams use Jellyfin's universal endpoint: the server direct-plays files
 * the player can decode and transcodes the rest (WMA, APE, ALAC …) to MP3.
 */
import { app } from "electron";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as persist from "./persist";
import { openSecret, sealSecret } from "./secrets";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONFIG_STORE = "jellyfin";
const LIBRARY_STORE = "jellyfin-library";
const PAGE_SIZE = 500;
const MAX_ITEMS = 100_000;
const CLIENT = "ByTune";
const VERSION = "1.0.2";

export interface JellyfinTrack {
  /** "jf:<itemId>" — the id prefix routes playback to this module */
  id: string;
  itemId: string;
  title: string;
  artist: string;
  album: string;
  albumId?: string;
  duration: number;
  trackNo?: number;
  discNo?: number;
  year?: number;
  genre?: string;
  /** jfart:// URL for the item's (or its album's) cover */
  art?: string;
  addedAt?: number;
  albumArtist?: string;
  /** Jellyfin's own loudness gain (dB to −18 LUFS), used like a ReplayGain track gain */
  gain?: number;
}

export interface JellyfinLibrary {
  fetchedAt: number;
  tracks: JellyfinTrack[];
}

export interface JellyfinStatus {
  connected: boolean;
  server: string | null;
  serverName: string | null;
  userName: string | null;
  trackCount: number;
  fetchedAt: number;
}

interface Config {
  server: string;
  serverName: string;
  userId: string | null;
  userName: string | null;
  token: string; // sealed
  deviceId: string;
}

function readConfig(): Config | null {
  const raw = persist.readData(CONFIG_STORE) as Config | null;
  return raw && typeof raw.server === "string" && raw.token ? raw : null;
}

function deviceId(): string {
  return readConfig()?.deviceId ?? crypto.randomUUID();
}

function authHeader(token?: string, device = deviceId()): string {
  const parts = [`Client="${CLIENT}"`, `Device="Desktop"`, `DeviceId="${device}"`, `Version="${VERSION}"`];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(", ")}`;
}

/** "nas:8096" → "http://nas:8096"; anything that is not http(s) is refused. */
export function normalizeServer(input: string): string {
  let s = String(input ?? "").trim();
  if (!s) throw new Error("Enter your Jellyfin server address");
  if (!/^[a-z]+:\/\//i.test(s)) s = `http://${s}`;
  const url = new URL(s);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The server address must start with http:// or https://");
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

async function request(
  server: string,
  pathAndQuery: string,
  init: { method?: string; token?: string; body?: unknown; device?: string } = {}
): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(`${server}${pathAndQuery}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: authHeader(init.token, init.device),
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal,
    });
    if (res.status === 401) throw new Error("Jellyfin rejected the login — check the user name and password");
    if (!res.ok) throw new Error(`Jellyfin answered HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("The Jellyfin server did not answer in time");
    if (err instanceof TypeError) throw new Error("Can't reach the Jellyfin server — check the address");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function status(): JellyfinStatus {
  const cfg = readConfig();
  const lib = readLibrary();
  return {
    connected: !!cfg,
    server: cfg?.server ?? null,
    serverName: cfg?.serverName ?? null,
    userName: cfg?.userName ?? null,
    trackCount: lib.tracks.length,
    fetchedAt: lib.fetchedAt,
  };
}

export async function connect(input: {
  server: string;
  username?: string;
  password?: string;
  apiKey?: string;
}): Promise<JellyfinStatus> {
  const server = normalizeServer(input.server);
  const device = deviceId();
  const info = await request(server, "/System/Info/Public", { device });
  if (!info?.Id) throw new Error("That address is not a Jellyfin server");

  let token: string;
  let userId: string | null = null;
  let userName: string | null = null;
  const apiKey = String(input.apiKey ?? "").trim();
  if (apiKey) {
    token = apiKey;
    // Validate the key with a call that needs authentication.
    await request(server, "/System/Info", { token, device });
  } else {
    const username = String(input.username ?? "").trim();
    if (!username) throw new Error("Enter your Jellyfin user name");
    const auth = await request(server, "/Users/AuthenticateByName", {
      method: "POST",
      body: { Username: username, Pw: String(input.password ?? "") },
      device,
    });
    if (!auth?.AccessToken) throw new Error("Jellyfin did not return a session");
    token = String(auth.AccessToken);
    userId = auth.User?.Id ?? null;
    userName = auth.User?.Name ?? username;
  }

  await persist.writeData(CONFIG_STORE, {
    server,
    serverName: String(info.ServerName ?? "Jellyfin"),
    userId,
    userName,
    token: sealSecret(token),
    deviceId: device,
  } satisfies Config);
  await persist.writeData(LIBRARY_STORE, { fetchedAt: 0, tracks: [] });
  return status();
}

export async function disconnect(): Promise<JellyfinStatus> {
  const cfg = readConfig();
  const token = openSecret(cfg?.token);
  // Log the session out server-side too; API keys are left alone.
  if (cfg && token && cfg.userId) {
    await request(cfg.server, "/Sessions/Logout", { method: "POST", token, device: cfg.deviceId }).catch(() => undefined);
  }
  await persist.writeData(CONFIG_STORE, null);
  await persist.writeData(LIBRARY_STORE, { fetchedAt: 0, tracks: [] });
  return status();
}

export function readLibrary(): JellyfinLibrary {
  const raw = persist.readData(LIBRARY_STORE) as JellyfinLibrary | null;
  return raw && Array.isArray(raw.tracks) ? raw : { fetchedAt: 0, tracks: [] };
}

function artUrl(itemId: string, tag: string): string {
  return `jfart://${itemId.toLowerCase()}/${encodeURIComponent(tag)}`;
}

function toTrack(item: any): JellyfinTrack | null {
  if (!item?.Id) return null;
  const artists: string[] = Array.isArray(item.Artists) ? item.Artists.filter((a: unknown) => typeof a === "string") : [];
  const ticks = Number(item.RunTimeTicks) || 0;
  let art: string | undefined;
  if (typeof item.ImageTags?.Primary === "string") art = artUrl(item.Id, item.ImageTags.Primary);
  else if (item.AlbumId && typeof item.AlbumPrimaryImageTag === "string") art = artUrl(item.AlbumId, item.AlbumPrimaryImageTag);
  const bounded = (v: unknown): string => (typeof v === "string" ? v.slice(0, 200) : "");
  return {
    id: `jf:${item.Id}`,
    itemId: String(item.Id),
    title: bounded(item.Name) || "Unknown title",
    artist: bounded(artists.join(", ")) || bounded(item.AlbumArtist) || "Unknown artist",
    album: bounded(item.Album) || "Unknown album",
    albumId: item.AlbumId ? String(item.AlbumId) : undefined,
    duration: Math.round(ticks / 10_000_000),
    trackNo: typeof item.IndexNumber === "number" ? item.IndexNumber : undefined,
    discNo: typeof item.ParentIndexNumber === "number" ? item.ParentIndexNumber : undefined,
    year: typeof item.ProductionYear === "number" ? item.ProductionYear : undefined,
    genre: Array.isArray(item.Genres) && typeof item.Genres[0] === "string" ? item.Genres[0] : undefined,
    art,
    addedAt: item.DateCreated ? Date.parse(item.DateCreated) || undefined : undefined,
    albumArtist: bounded(item.AlbumArtist) || undefined,
    gain: typeof item.NormalizationGain === "number" && Number.isFinite(item.NormalizationGain) ? item.NormalizationGain : undefined,
  };
}

/** Re-list every audio item on the server and replace the cached library. */
export async function refreshLibrary(): Promise<JellyfinLibrary> {
  const cfg = readConfig();
  const token = openSecret(cfg?.token);
  if (!cfg || !token) throw new Error("Not connected to a Jellyfin server");
  const tracks: JellyfinTrack[] = [];
  for (let start = 0; start < MAX_ITEMS; start += PAGE_SIZE) {
    const params = new URLSearchParams({
      IncludeItemTypes: "Audio",
      Recursive: "true",
      SortBy: "AlbumArtist,Album,ParentIndexNumber,IndexNumber,SortName",
      SortOrder: "Ascending",
      Fields: "Genres,DateCreated",
      EnableImageTypes: "Primary",
      StartIndex: String(start),
      Limit: String(PAGE_SIZE),
    });
    if (cfg.userId) params.set("UserId", cfg.userId);
    const page = await request(cfg.server, `/Items?${params}`, { token, device: cfg.deviceId });
    const items: any[] = Array.isArray(page?.Items) ? page.Items : [];
    for (const item of items) {
      const t = toTrack(item);
      if (t) tracks.push(t);
    }
    const total = Number(page?.TotalRecordCount) || 0;
    if (items.length < PAGE_SIZE || tracks.length >= total) break;
  }
  const lib = { fetchedAt: Date.now(), tracks };
  await persist.writeData(LIBRARY_STORE, lib);
  return lib;
}

/** Upstream audio for one item, honouring the media element's Range header. */
export async function fetchStream(itemId: string, range: string | undefined): Promise<Response> {
  const cfg = readConfig();
  const token = openSecret(cfg?.token);
  if (!cfg || !token || !/^[a-f0-9-]{32,36}$/i.test(itemId)) return new Response(null, { status: 404 });
  const params = new URLSearchParams({
    DeviceId: cfg.deviceId,
    MaxStreamingBitrate: "140000000",
    Container: "opus,webm|opus,mp3,aac,m4a|aac,m4b|aac,flac,webma,webm|webma,wav,ogg",
    TranscodingContainer: "mp3",
    TranscodingProtocol: "http",
    AudioCodec: "mp3",
  });
  if (cfg.userId) params.set("UserId", cfg.userId);
  const headers: Record<string, string> = { Authorization: authHeader(token, cfg.deviceId) };
  if (range) headers.Range = range;
  return fetch(`${cfg.server}/Audio/${itemId}/universal?${params}`, { headers });
}

/**
 * Lyrics the server already has for an item (Jellyfin 10.9+ serves the
 * .lrc files and embedded lyrics of its library), rebuilt as LRC text so
 * the shared parser handles timed and untimed answers alike.
 */
export async function fetchLyrics(itemId: string): Promise<string | null> {
  const cfg = readConfig();
  const token = openSecret(cfg?.token);
  if (!cfg || !token || !/^[a-f0-9-]{32,36}$/i.test(itemId)) return null;
  try {
    const res = await request(cfg.server, `/Audio/${itemId}/Lyrics`, { token, device: cfg.deviceId });
    const lines: any[] = Array.isArray(res?.Lyrics) ? res.Lyrics : [];
    if (!lines.length) return null;
    const timed = lines.every((l) => typeof l.Start === "number");
    const stamp = (ticks: number): string => {
      const sec = ticks / 10_000_000;
      const m = Math.floor(sec / 60);
      return `${String(m).padStart(2, "0")}:${(sec - m * 60).toFixed(2).padStart(5, "0")}`;
    };
    return lines.map((l) => (timed ? `[${stamp(l.Start)}]${l.Text ?? ""}` : String(l.Text ?? ""))).join("\n");
  } catch {
    return null; // 404 = the server has none
  }
}

/* ------------------------------------------------------------- covers */

const ART_RE = /^jfart:\/\/([a-f0-9]{32})\/([A-Za-z0-9%._-]{1,80})$/i;
let artDirReady = false;

function artDir(): string {
  const dir = path.join(app.getPath("userData"), "jellyfin-art");
  if (!artDirReady) {
    fs.mkdirSync(dir, { recursive: true });
    artDirReady = true;
  }
  return dir;
}

/**
 * Cover bytes for a jfart:// URL — from the disk cache, else from the
 * server. The tag is part of the cache name, so a changed cover on the
 * server is a new file, never a stale one.
 */
export async function artBytes(url: string): Promise<{ data: Buffer; mime: string } | null> {
  const m = ART_RE.exec(String(url ?? "").trim());
  if (!m) return null;
  const itemId = m[1].toLowerCase();
  const tag = decodeURIComponent(m[2]).replace(/[^A-Za-z0-9_-]/g, "");
  const file = path.join(artDir(), `${itemId}-${tag}.jpg`);
  try {
    return { data: fs.readFileSync(file), mime: "image/jpeg" };
  } catch {
    /* not cached yet */
  }
  const cfg = readConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(
      `${cfg.server}/Items/${itemId}/Images/Primary?tag=${encodeURIComponent(tag)}&maxWidth=800&quality=90&format=Jpg`,
      { headers: { Authorization: authHeader(openSecret(cfg.token), cfg.deviceId) } }
    );
    if (!res.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (!data.length || data.length > 8 * 1024 * 1024) return null;
    fs.writeFileSync(file, data);
    return { data, mime: res.headers.get("content-type") ?? "image/jpeg" };
  } catch {
    return null;
  }
}
