/** Preload — exposes a minimal, typed API to the renderer via contextBridge. */
import { contextBridge, ipcRenderer } from "electron";
import type { DownloadProgress, Track } from "../src/types";

// The PiP window loads this same preload but its scope requests are rejected
// by design (main-window-only handler) — an eager invoke there would leave an
// unhandled rejection on every PiP open. The scope is captured lazily on the
// first read/write instead, and reads resolve to null if it can't be had.
let documentScopePromise: Promise<string> | null = null;
const documentScope = (): Promise<string> => {
  if (documentScopePromise === null) {
    documentScopePromise = ipcRenderer.invoke("data:scope") as Promise<string>;
    documentScopePromise.catch(() => {
      // Leave the cached promise rejected-free: retry on the next call (a
      // transient failure shouldn't poison the scope for the page lifetime).
      documentScopePromise = null;
    });
  }
  return documentScopePromise;
};

const api = {
  platform: process.platform,
  versions: {
    app: "1.0.3",
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    node: process.versions.node ?? "",
  },

  // Music (main process runs youtubei.js)
  search: (query: string, light = false) => ipcRenderer.invoke("music:search", query, light),
  searchPage: (query: string, filter: string) => ipcRenderer.invoke("music:searchPage", query, filter),
  searchMore: (token: string, filter: string) => ipcRenderer.invoke("music:searchMore", token, filter),
  suggestions: (query: string) => ipcRenderer.invoke("music:suggestions", query),
  getAlbum: (id: string) => ipcRenderer.invoke("music:album", id),
  getArtist: (id: string) => ipcRenderer.invoke("music:artist", id),
  getPlaylist: (id: string) => ipcRenderer.invoke("music:playlist", id),
  getPlaylistPage: (id: string) => ipcRenderer.invoke("music:playlistPage", id),
  getHome: () => ipcRenderer.invoke("music:home"),
/** YTM Charts for the device market (regional popularity — cold-start feed). */
  getCharts: () => ipcRenderer.invoke("music:charts"),
  /** Per-market moods & genres from the provider's Explore page. */
  getMoods: () => ipcRenderer.invoke("music:moods"),
  /** The resolved device market + the signal it came from (diagnostics). */
  marketInfo: () => ipcRenderer.invoke("market:current"),
  getLyrics: (track: { id: string; title: string; artist: string; album?: string; duration?: number }) =>
    ipcRenderer.invoke("music:lyrics", track),
  enrichDurations: (ids: string[]) => ipcRenderer.invoke("music:enrich", ids),
  playbackEvent: (event: { type: string; track?: unknown; positionSec: number; playedSec: number; deltaMs: number }) =>
    ipcRenderer.send("playback:event", event),
  statsSummary: (period: string) => ipcRenderer.invoke("stats:summary", period),
  /** all-time plays + last played per track id */
  statsPlayCounts: () =>
    ipcRenderer.invoke("stats:playcounts") as Promise<Record<string, { plays: number; lastAt: number }>>,
  getStreamUrl: (id: string, forceRotate = false, quality?: string) =>
    ipcRenderer.invoke("music:stream", id, forceRotate, quality),
  localLibrary: () => ipcRenderer.invoke("library:get"),
  scanLibrary: (filterNonMusic = true) => ipcRenderer.invoke("library:scan", filterNonMusic),
  /** Folder watching on/off (new, changed and deleted files appear without a rescan). */
  setFolderWatch: (enabled: boolean) => ipcRenderer.invoke("library:watch", enabled),
  setLibraryFolders: (folders: string[]) => ipcRenderer.invoke("library:setFolders", folders),
  /** Import folders: a parent expands into itself + its music-bearing subfolders. */
  addLibraryFolders: (paths: string[]) => ipcRenderer.invoke("library:addFolders", paths),
  renameLibraryFolder: (folderPath: string, displayName: string) =>
    ipcRenderer.invoke("library:renameFolder", folderPath, displayName),
  removeLibraryFolder: (folderPath: string) => ipcRenderer.invoke("library:removeFolder", folderPath),
  libraryFolderStatuses: () => ipcRenderer.invoke("library:folderStatuses"),
  /** What can play right now: each imported folder's existence, and whether the servers answer (null = none connected). */
  libraryAvailability: () =>
    ipcRenderer.invoke("library:availability") as Promise<{
      folders: { path: string; exists: boolean }[];
      jellyfin: boolean | null;
      subsonic: boolean | null;
    }>,
  /** True when songs were read with an older scan schema — one rescan fills the new fields. */
  libraryNeedsRescan: () => ipcRenderer.invoke("library:needsRescan") as Promise<boolean>,
  localTrackUrl: (id: string) => ipcRenderer.invoke("library:trackurl", id),
  /** Why localTrackUrl answered null: "missing" | "ffmpeg-missing" | "transcode-failed". */
  localTrackError: (id: string) => ipcRenderer.invoke("library:trackerror", id) as Promise<string | null>,
  /** FFmpeg (needed for AIFF, ALAC, WMA, WavPack, APE, DSD): where it is and which version. */
  ffmpegStatus: (recheck = false) =>
    ipcRenderer.invoke("ffmpeg:status", recheck) as Promise<{ path: string | null; version: string | null }>,
  localArtBytes: (thumb: string) => ipcRenderer.invoke("library:artbytes", thumb),
  /** Background cover/album fills for the local library land here, batch by batch. */
  onLibraryEnriched: (cb: (lib: unknown) => void): (() => void) => {
    const listener = (_e: unknown, lib: unknown): void => cb(lib);
    ipcRenderer.on("library:enriched", listener as never);
    return () => ipcRenderer.removeListener("library:enriched", listener as never);
  },
  getCanvas: (q: { title: string; artist: string; album?: string }) =>
    ipcRenderer.invoke("canvas:get", q),

  // Open metadata (MusicBrainz · Cover Art Archive · iTunes · Wikidata/Wikipedia)
  metaArtist: (name: string) => ipcRenderer.invoke("meta:artist", name),
  metaRecording: (title: string, artist: string, durationSec = 0) =>
    ipcRenderer.invoke("meta:recording", title, artist, durationSec),

  // Jellyfin server (token stays in the main process)
  jellyfinStatus: () => ipcRenderer.invoke("jellyfin:status"),
  jellyfinConnect: (input: { server: string; username?: string; password?: string; apiKey?: string }) =>
    ipcRenderer.invoke("jellyfin:connect", input),
  jellyfinDisconnect: () => ipcRenderer.invoke("jellyfin:disconnect"),
  jellyfinLibrary: () => ipcRenderer.invoke("jellyfin:library"),
  jellyfinRefresh: () => ipcRenderer.invoke("jellyfin:refresh"),

  // AutoEQ headphone profiles (index cached for a week in the main process)
  autoEqSearch: (q: string) =>
    ipcRenderer.invoke("autoeq:search", q) as Promise<{ name: string; source: string; rig?: string; path: string }[]>,
  autoEqFetch: (p: string) => ipcRenderer.invoke("autoeq:fetch", p),

  // Navidrome / Subsonic server (only a hashed token is kept, in the main process)
  subsonicStatus: () => ipcRenderer.invoke("subsonic:status"),
  subsonicConnect: (input: { server: string; username: string; password: string }) =>
    ipcRenderer.invoke("subsonic:connect", input),
  subsonicDisconnect: () => ipcRenderer.invoke("subsonic:disconnect"),
  subsonicLibrary: () => ipcRenderer.invoke("subsonic:library"),
  subsonicRefresh: () => ipcRenderer.invoke("subsonic:refresh"),

  // Window controls (frameless window — chrome drawn by the renderer)
  windowMinimize: () => ipcRenderer.send("window:minimize"),
  windowMaximizeToggle: () => ipcRenderer.send("window:maximizeToggle"),
  windowClose: () => ipcRenderer.send("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  setOverlayChrome: (visible: boolean) => ipcRenderer.invoke("window:setOverlayChrome", visible),
  setFullScreen: (fs: boolean) => ipcRenderer.invoke("window:setFullScreen", fs),
  onMaximizeChange: (cb: (maximized: boolean) => void): (() => void) => {
    const listener = (_e: unknown, maximized: boolean): void => cb(maximized);
    ipcRenderer.on("window:maximized", listener as never);
    return () => ipcRenderer.removeListener("window:maximized", listener as never);
  },
  onFullScreenChange: (cb: (fullscreen: boolean) => void): (() => void) => {
    const listener = (_e: unknown, fullscreen: boolean): void => cb(fullscreen);
    ipcRenderer.on("window:fullscreen", listener as never);
    return () => ipcRenderer.removeListener("window:fullscreen", listener as never);
  },

  // Native miniplayer (PiP) window — a separate always-on-top BrowserWindow.
  // The main window broadcasts playback snapshots and executes transport
  // commands; the PiP window renders them. Closing the PiP never touches
  // playback.
  pipToggle: () => ipcRenderer.invoke("pip:toggle"),
  pipIsOpen: () => ipcRenderer.invoke("pip:isOpen"),
  pipClose: () => ipcRenderer.send("pip:close"),
  // Real native minimize (the window stays alive and restorable from the
  // Windows taskbar) — playback and the main window are untouched.
  pipMinimize: () => ipcRenderer.send("pip:minimize"),
  pipShowMain: () => ipcRenderer.send("pip:show-main"),
  pipSendState: (snapshot: unknown) => ipcRenderer.send("pip:state", snapshot),
  pipSendCommand: (command: unknown) => ipcRenderer.send("pip:command", command),
  onPipState: (cb: (snapshot: unknown) => void): (() => void) => {
    const listener = (_e: unknown, snapshot: unknown): void => cb(snapshot);
    ipcRenderer.on("pip:state", listener as never);
    return () => ipcRenderer.removeListener("pip:state", listener as never);
  },
  onPipCommand: (cb: (command: unknown) => void): (() => void) => {
    const listener = (_e: unknown, command: unknown): void => cb(command);
    ipcRenderer.on("pip:command", listener as never);
    return () => ipcRenderer.removeListener("pip:command", listener as never);
  },
  onPipOpenChange: (cb: (open: boolean) => void): (() => void) => {
    const listener = (_e: unknown, open: boolean): void => cb(open);
    ipcRenderer.on("pip:open-changed", listener as never);
    return () => ipcRenderer.removeListener("pip:open-changed", listener as never);
  },
  onPipNeedState: (cb: () => void): (() => void) => {
    const listener = (): void => cb();
    ipcRenderer.on("pip:need-state", listener as never);
    return () => ipcRenderer.removeListener("pip:need-state", listener as never);
  },
  // Native cursor watch: the main process polls the OS pointer against the
  // PiP bounds — the one reliable inside/outside signal, because renderer
  // pointer events stop over the window's app-region drag pad.
  onPipCursorInside: (cb: (inside: boolean) => void): (() => void) => {
    const listener = (_e: unknown, inside: boolean): void => cb(inside);
    ipcRenderer.on("pip:cursor-inside", listener as never);
    return () => ipcRenderer.removeListener("pip:cursor-inside", listener as never);
  },

  // Persistence (JSON files in userData)
  readData: async (name: string) => {
    try {
      return await ipcRenderer.invoke("data:read", name, await documentScope());
    } catch {
      return null;
    }
  },
  writeData: async (name: string, data: unknown) => {
    const scope = await documentScope();
    return ipcRenderer.invoke("data:write", name, data, scope);
  },
  resetData: () => ipcRenderer.invoke("app:resetData"),

  // Backup export / import (native save/open pickers in main)
  backupExport: () => ipcRenderer.invoke("backup:export"),
  backupImport: () => ipcRenderer.invoke("backup:import"),

  // Accounts (Supabase) + cloud backup
  authGetSession: () => ipcRenderer.invoke("auth:getSession"),
  authSignUp: (username: string, password: string) => ipcRenderer.invoke("auth:signUp", username, password),
  authSignIn: (username: string, password: string) => ipcRenderer.invoke("auth:signIn", username, password),
  authSignInGoogle: () => ipcRenderer.invoke("auth:signInGoogle"),
  authContinueGuest: () => ipcRenderer.invoke("auth:continueGuest"),
  authClearGuestProfile: () => ipcRenderer.invoke("auth:clearGuestProfile"),
  authUsernameAvailable: (username: string) => ipcRenderer.invoke("auth:usernameAvailable", username),
  authSetUsername: (username: string) => ipcRenderer.invoke("auth:setUsername", username),
  authSkipUsername: () => ipcRenderer.invoke("auth:skipUsername"),
  authSignOut: () => ipcRenderer.invoke("auth:signOut"),
  onAuthChanged: (cb: (info: { mode: string | null; userId: string | null; username: string | null; freshInstall?: boolean }) => void): (() => void) => {
    const listener = (_e: unknown, info: { mode: string | null; userId: string | null; username: string | null; freshInstall?: boolean }): void => cb(info);
    ipcRenderer.on("auth:changed", listener as never);
    return () => ipcRenderer.removeListener("auth:changed", listener as never);
  },
  syncStatus: () => ipcRenderer.invoke("sync:status"),
  syncNow: () => ipcRenderer.invoke("sync:now"),
  syncBackupNow: () => ipcRenderer.invoke("sync:backupNow"),
  syncRestoreNow: () => ipcRenderer.invoke("sync:restoreNow"),
  onSyncRestored: (cb: (info: { stores: string[]; seq: number }) => void): (() => void) => {
    const listener = (_e: unknown, info: { stores: string[]; seq: number }): void => cb(info);
    ipcRenderer.on("sync:restored", listener as never);
    return () => ipcRenderer.removeListener("sync:restored", listener as never);
  },

  // macOS application menu: commands flow menu → renderer, playback state
  // flows renderer → menu (checkmarks). No-ops on other platforms.
  onMenuCommand: (cb: (command: string) => void): (() => void) => {
    const listener = (_e: unknown, command: string): void => cb(command);
    ipcRenderer.on("menu:command", listener as never);
    return () => ipcRenderer.removeListener("menu:command", listener as never);
  },
  menuPushState: (state: { playing: boolean; shuffle: boolean; repeat: "off" | "all" | "one" }) =>
    ipcRenderer.send("menu:push-state", state),

  // Filesystem helpers
  defaultDownloadDir: () => ipcRenderer.invoke("app:defaultDownloadDir"),
  pickFolder: () => ipcRenderer.invoke("app:pickFolder"),
  /** Save text the app composed (e.g. a CSV list) where the user picks; resolves to the path, or null if cancelled. */
  saveTextFile: (suggestedName: string, content: string) =>
    ipcRenderer.invoke("file:saveText", suggestedName, content) as Promise<string | null>,
  revealPath: (p: string) => ipcRenderer.invoke("app:revealPath", p),
  openPath: (p: string) => ipcRenderer.invoke("app:openPath", p),

  // Downloads
  startDownload: (track: Track, dir?: string, quality?: string, exportCompat?: boolean) => ipcRenderer.invoke("download:start", track, dir, quality, exportCompat),
  cancelDownload: (id: string) => ipcRenderer.invoke("download:cancel", id),
  downloadQueue: () => ipcRenderer.invoke("download:queue"),
  onDownloadEvent: (cb: (e: { type: string; id: string; downloaded?: number; total?: number; path?: string; reason?: string }) => void): (() => void) => {
    const listener = (_e: unknown, ev: { type: string; id: string }): void => cb(ev);
    ipcRenderer.on("download:event", listener as never);
    return () => ipcRenderer.removeListener("download:event", listener as never);
  },
  onDownloadProgress: (cb: (p: DownloadProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: DownloadProgress): void => cb(p);
    ipcRenderer.on("download:progress", listener as never);
    return () => ipcRenderer.removeListener("download:progress", listener as never);
  },
};

contextBridge.exposeInMainWorld("bytune", api);

export type ByTuneApi = typeof api;
