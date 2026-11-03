/**
 * Songs kept on the phone. Android's download service fetches them
 * (SongDownloads.kt); this store knows which song lies where, hands over the
 * next ones and follows how they stand. A kept song brings its cover and lyrics
 * along, so it has them without any connection.
 */
import { Directory, File, Paths } from "expo-file-system";
import { create } from "zustand";
import Player from "../../modules/media3-player";
import { withoutServer } from "../addresses";
import { authHeader, downloadPlan, type DownloadQuality } from "../jellyfin";
import { keepLyrics } from "../lyrics";
import type { Track } from "../shared";
import { readJson, writeJson } from "../storage";
import { useConnection } from "./connection";
import { useLibrary } from "./library";
import { here, useSession } from "./session";

const FILE = "downloads.json";
/** Handed to the download service at a time: it goes on with those while the app is closed. */
const AT_ONCE = 12;
const FOLLOW_EVERY_MS = 2000;
const TRIES = 3;

export interface KeptSong {
  file: string;
  bytes: number;
  /** the smaller copy, not the server's file */
  compact: boolean;
}

export interface LoadingSong {
  /** the download service's number; null while it waits for its turn */
  job: number | null;
  fileName: string;
  compact: boolean;
  tries: number;
  /** waits for Wi-Fi because mobile data isn't allowed */
  wantsWifi: boolean;
  failed: boolean;
}

interface Saved {
  kept?: Record<string, KeptSong>;
  loading?: Record<string, LoadingSong>;
  covers?: Record<string, string>;
  quality?: DownloadQuality;
  overMobile?: boolean;
}

interface DownloadsState {
  /** by song */
  kept: Record<string, KeptSong>;
  /** by song, in the order they were asked for */
  loading: Record<string, LoadingSong>;
  /** a cover's file by what identifies the picture */
  covers: Record<string, string>;
  quality: DownloadQuality;
  overMobile: boolean;
  restore(): Promise<void>;
  add(tracks: Track[]): void;
  remove(tracks: Track[]): void;
  removeAll(): void;
  setQuality(quality: DownloadQuality): void;
  setOverMobile(on: boolean): void;
}

export const useDownloads = create<DownloadsState>((set, get) => ({
  kept: {},
  loading: {},
  covers: {},
  quality: "original",
  overMobile: false,

  async restore() {
    const saved = await readJson<Saved>(FILE);
    if (!saved) return;
    const kept = saved.kept ?? {};
    // Files cleared from outside are gone.
    const found = new Set(await Player.downloadExisting(Object.values(kept).map((k) => k.file)).catch(() => Object.values(kept).map((k) => k.file)));
    set({
      kept: Object.fromEntries(Object.entries(kept).filter(([, k]) => found.has(k.file))),
      loading: saved.loading ?? {},
      covers: saved.covers ?? {},
      quality: saved.quality ?? "original",
      overMobile: saved.overMobile ?? false,
    });
    followSoon();
  },

  add(tracks) {
    const { kept, loading } = get();
    const next = { ...loading };
    for (const t of tracks) {
      if (kept[t.id] || (next[t.id] && !next[t.id].failed)) continue;
      next[t.id] = { job: null, fileName: "", compact: false, tries: 0, wantsWifi: false, failed: false };
    }
    set({ loading: next });
    save();
    followSoon();
  },

  remove(tracks) {
    const kept = { ...get().kept };
    const loading = { ...get().loading };
    for (const t of tracks) {
      const job = loading[t.id]?.job;
      if (job != null) void Player.downloadCancel(job);
      delete loading[t.id];
      if (kept[t.id]) void Player.downloadDelete(kept[t.id].file);
      delete kept[t.id];
    }
    set({ kept, loading });
    dropUnusedCovers();
    save();
  },

  removeAll() {
    const { kept, loading } = get();
    for (const song of Object.values(loading)) if (song.job !== null) void Player.downloadCancel(song.job);
    for (const song of Object.values(kept)) void Player.downloadDelete(song.file);
    set({ kept: {}, loading: {} });
    dropUnusedCovers();
    save();
  },

  setQuality(quality) {
    set({ quality });
    save();
  },

  setOverMobile(overMobile) {
    // What already waits for Wi-Fi was handed over under the old rule.
    const loading = Object.fromEntries(
      Object.entries(get().loading).map(([id, song]) => {
        if (song.job !== null) void Player.downloadCancel(song.job);
        return [id, { ...song, job: null, wantsWifi: false }];
      })
    );
    set({ overMobile, loading });
    save();
    followSoon();
  },
}));

function save(): void {
  const { kept, loading, covers, quality, overMobile } = useDownloads.getState();
  writeJson(FILE, { kept, loading, covers, quality, overMobile });
}

function patch(id: string, change: Partial<LoadingSong>): void {
  const { loading } = useDownloads.getState();
  const song = loading[id];
  if (song) useDownloads.setState({ loading: { ...loading, [id]: { ...song, ...change } } });
}

function retry(id: string, song: LoadingSong): void {
  patch(id, song.tries + 1 < TRIES ? { job: null, tries: song.tries + 1, wantsWifi: false } : { job: null, failed: true, wantsWifi: false });
}

async function keepCover(track: Track): Promise<void> {
  if (!track.thumb) return;
  const key = withoutServer(track.thumb);
  if (useDownloads.getState().covers[key]) return;
  try {
    const folder = new Directory(Paths.document, "covers");
    if (!folder.exists) folder.create();
    const file = new File(folder, `${key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 120)}.jpg`);
    if (!file.exists) await File.downloadFileAsync(here(track.thumb), file);
    useDownloads.setState({ covers: { ...useDownloads.getState().covers, [key]: file.uri } });
    save();
  } catch {
    /* the song plays without its picture */
  }
}

/** A cover stays as long as a kept song shows it. */
function dropUnusedCovers(): void {
  const { kept, covers } = useDownloads.getState();
  const { byId } = useLibrary.getState();
  const used = new Set(Object.keys(kept).map((id) => withoutServer(byId.get(id)?.thumb ?? "")));
  const next: Record<string, string> = {};
  for (const [key, uri] of Object.entries(covers)) {
    if (used.has(key)) next[key] = uri;
    else {
      try {
        new File(uri).delete();
      } catch {
        /* gone either way */
      }
    }
  }
  useDownloads.setState({ covers: next });
}

async function finished(id: string, song: LoadingSong): Promise<void> {
  const done = await Player.downloadFinish(song.job as number, song.fileName).catch(() => null);
  if (!done) {
    retry(id, song);
    return;
  }
  const { kept, loading } = useDownloads.getState();
  const rest = { ...loading };
  delete rest[id];
  useDownloads.setState({ kept: { ...kept, [id]: { file: done.file, bytes: done.bytes, compact: song.compact } }, loading: rest });
  save();
  const track = useLibrary.getState().byId.get(id);
  if (track) {
    void keepCover(track);
    keepLyrics(track);
  }
}

/** Hands over the next ones, as many as are allowed at a time. */
async function handOver(): Promise<void> {
  const session = useSession.getState().session;
  if (!session || useConnection.getState().reach === "offline") return;
  const { loading, quality, overMobile } = useDownloads.getState();
  let running = Object.values(loading).filter((song) => song.job !== null).length;
  for (const [id, song] of Object.entries(loading)) {
    if (running >= AT_ONCE) break;
    if (song.job !== null || song.failed) continue;
    const track = useLibrary.getState().byId.get(id);
    if (!track) {
      patch(id, { failed: true });
      continue;
    }
    const plan = downloadPlan(session, track, quality);
    try {
      const job = await Player.downloadStart(plan.url, { Authorization: authHeader(session.deviceId, session.token) }, plan.fileName, track.title, track.artist, !overMobile);
      patch(id, { job, fileName: plan.fileName, compact: plan.compact });
      running += 1;
    } catch {
      retry(id, song);
    }
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let following = false;

async function follow(): Promise<void> {
  if (following) return;
  following = true;
  try {
    const before = useDownloads.getState().loading;
    const jobs = Object.values(before)
      .map((song) => song.job)
      .filter((job): job is number => job !== null);
    const report = new Map((await Player.downloadQuery(jobs).catch(() => [])).map((row) => [row.job, row]));
    for (const [id, song] of Object.entries(before)) {
      if (song.job === null) continue;
      const row = report.get(song.job);
      if (!row || row.status === "failed") retry(id, song);
      else if (row.status === "done") await finished(id, song);
      else if ((row.status === "wifi") !== song.wantsWifi) patch(id, { wantsWifi: row.status === "wifi" });
    }
    await handOver();
    if (useDownloads.getState().loading !== before) save();
  } finally {
    following = false;
    if (Object.values(useDownloads.getState().loading).some((song) => !song.failed)) followSoon();
  }
}

function followSoon(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void follow();
  }, FOLLOW_EVERY_MS);
}

useConnection.subscribe((s, prev) => {
  if (prev.reach === "offline" && s.reach !== "offline") followSoon();
});

/** "480 MB", "1.2 GB" */
export function sizeLine(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export type SongDownload = "kept" | "loading" | "failed" | null;

export function downloadOf(s: DownloadsState, id: string): SongDownload {
  if (s.kept[id]) return "kept";
  const song = s.loading[id];
  return song ? (song.failed ? "failed" : "loading") : null;
}
