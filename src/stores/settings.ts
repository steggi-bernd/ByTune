/** User settings (persisted). Dark theme only — no theme switching. */
import { FLAT_PEQ, type ParametricEq } from "../lib/peq";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "../lib/persist";
import { DEFAULT_EXPLORE_SORTS, type ExploreSort, type ExploreTab } from "../lib/exploreRows";
import { T } from "../lib/i18n";
export type { ExploreSort, ExploreTab };

export type StreamQuality = "low" | "medium" | "high" | "lossless";
export type LibraryOrder = "played" | "added" | "alpha" | "artist";
export type DownloadQuality = "standard" | "high" | "lossless";

export const STREAM_QUALITY_LABEL: Record<StreamQuality, string> = {
  low: T("Low"),
  medium: T("Medium"),
  high: T("High"),
  lossless: T("Lossless"),
};

export const DOWNLOAD_QUALITY_LABEL: Record<DownloadQuality, string> = {
  standard: T("Standard"),
  high: T("High"),
  lossless: T("Lossless"),
};

interface SettingsState {
  /* Downloads */
  downloadDir: string | null;
  downloadQuality: DownloadQuality;
  exportDownloads: boolean;

  /* Playback */
  streamingQuality: StreamQuality;
  crossfadeSeconds: number;
  smartFade: boolean;
  skipSilence: boolean;
  autoplay: boolean;
  /** 0.5..2 — persisted playback speed (pitch-preserving) */
  playbackSpeed: number;
  /** Audio output device (setSinkId). "" follows the system default. */
  audioSinkId: string;
  /** 10-band graphic EQ; gains in dB (−12..+12), one per EQ_BANDS entry */
  eqEnabled: boolean;
  eqGains: number[];
  /** which EQ runs while enabled: the 10-band sliders or the parametric/AutoEQ profile */
  eqMode: "graphic" | "parametric";
  peq: ParametricEq;
  /** ReplayGain leveling for library songs (tags, Jellyfin/Navidrome gains) */
  replayGainMode: "off" | "track" | "album";
  /** loudness the leveling aims for, LUFS (ReplayGain itself is referenced to −18) */
  replayGainTarget: number;

  /* Appearance */
  /** Left library panel folded down to an icon rail */
  sidebarCollapsed: boolean;
  /** the library panel's order: everything by when it last played (the pinned
      rows aside), or the albums by when added, title or artist */
  libraryOrder: LibraryOrder;
  /** Rescan imported folders automatically when files change */
  watchFolders: boolean;
  reduceAnimation: boolean;
  reduceDynamicBlur: boolean;
  liquidGlass: boolean;
  fullBleedArtwork: boolean;
  legacyMeshGradient: boolean;
  animatedCanvas: boolean;
  syncedLyrics: boolean;
  blurUnfocusedLyrics: boolean;

  /* Local music */
  localMusicFolder: string | null;
  filterNonMusicAudio: boolean;

  /* Miscellaneous */
  dontRepeatSuggestions: boolean;
  hideVolumeBar: boolean;
  /** the song playing now as the Discord status (needs the user's own Discord application) */
  discordPresence: boolean;
  /** that application's ID, from the Discord Developer Portal */
  discordClientId: string;
  /** Liked Songs ↔ the Jellyfin/Navidrome favorites, both ways (lib/serverSync.ts) */
  serverSync: boolean;
  /** playlists and where playback stopped through the sync service (lib/homeSync.ts) */
  syncPlaylists: boolean;
  /** count plays on the servers too */
  serverPlays: boolean;
  /** shop links next to the songs a Spotify import misses */
  storeLinks: boolean;
  /** Cyrillic lyrics get a Latin line under each line */
  lyricsLatin: boolean;
  /** with crossfade off, the next song starts the moment this one ends */
  gapless: boolean;
  /** songs that run on (live albums, DJ mixes, pairs that meet sounding) never crossfade or pause (lib/continuity.ts) */
  seamlessAlbums: boolean;
  /** tempo, key and energy of every local song, measured once in the background (electron/sound-library.ts) */
  soundAnalysis: boolean;
  /** Milkdrop behind the full-screen Now Playing */
  milkdrop: boolean;
  /** Explore: the open tab, list or tiles, and each tab's column order */
  exploreTab: ExploreTab;
  exploreLayout: "list" | "grid";
  exploreSort: Record<ExploreTab, ExploreSort>;
  /** the right panel's width, px (dragged at its left edge) */
  rightRailWidth: number;
  /** corner style of every rounded surface: half the old radius by default */
  corners: Corners;
  /** the shell's one colour: what plays, what's on, likes and the main buttons */
  accent: Accent;

  setDownloadDir(dir: string | null): void;
  setDownloadQuality(q: DownloadQuality): void;
  setExportDownloads(v: boolean): void;
  setStreamingQuality(q: StreamQuality): void;
  setCrossfadeSeconds(v: number): void;
  setSmartFade(v: boolean): void;
  setSkipSilence(v: boolean): void;
  setAutoplay(v: boolean): void;
  setPlaybackSpeed(v: number): void;
  setAudioSinkId(sinkId: string): void;
  setEqEnabled(v: boolean): void;
  setEqGains(gains: number[]): void;
  setEqMode(mode: "graphic" | "parametric"): void;
  setPeq(peq: ParametricEq): void;
  setReplayGainMode(mode: "off" | "track" | "album"): void;
  setReplayGainTarget(lufs: number): void;
  setSidebarCollapsed(v: boolean): void;
  setLibraryOrder(v: LibraryOrder): void;
  setWatchFolders(v: boolean): void;
  setReduceAnimation(v: boolean): void;
  setReduceDynamicBlur(v: boolean): void;
  setLiquidGlass(v: boolean): void;
  setFullBleedArtwork(v: boolean): void;
  setLegacyMeshGradient(v: boolean): void;
  setAnimatedCanvas(v: boolean): void;
  setSyncedLyrics(v: boolean): void;
  setBlurUnfocusedLyrics(v: boolean): void;
  setLocalMusicFolder(v: string | null): void;
  setFilterNonMusicAudio(v: boolean): void;
  setDontRepeatSuggestions(v: boolean): void;
  setHideVolumeBar(v: boolean): void;
  setDiscordPresence(v: boolean): void;
  setDiscordClientId(id: string): void;
  setServerSync(v: boolean): void;
  setSyncPlaylists(v: boolean): void;
  setServerPlays(v: boolean): void;
  setStoreLinks(v: boolean): void;
  setLyricsLatin(v: boolean): void;
  setGapless(v: boolean): void;
  setSeamlessAlbums(v: boolean): void;
  setSoundAnalysis(v: boolean): void;
  setMilkdrop(v: boolean): void;
  setExploreTab(v: ExploreTab): void;
  setExploreLayout(v: "list" | "grid"): void;
  setExploreSort(tab: ExploreTab, sort: ExploreSort): void;
  setRightRailWidth(px: number): void;
  setCorners(v: Corners): void;
  setAccent(v: Accent): void;
}

export type Corners = "round" | "soft" | "square";
export type Accent = "violet" | "blue" | "teal" | "green" | "amber" | "coral" | "pink" | "white";

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      downloadDir: null,
      downloadQuality: "lossless",
      exportDownloads: false,

      streamingQuality: "high",
      crossfadeSeconds: 0,
      smartFade: false,
      skipSilence: false,
      autoplay: false,
      playbackSpeed: 1,
      audioSinkId: "",
      eqEnabled: false,
      eqMode: "graphic",
      peq: FLAT_PEQ,
      replayGainMode: "track",
      replayGainTarget: -14,
      eqGains: Array(10).fill(0),

      sidebarCollapsed: false,
      libraryOrder: "played",
      watchFolders: true,
      reduceAnimation: false,
      reduceDynamicBlur: false,
      liquidGlass: true,
      fullBleedArtwork: false,
      legacyMeshGradient: false,
      animatedCanvas: false,
      syncedLyrics: true,
      blurUnfocusedLyrics: true,

      localMusicFolder: null,
      filterNonMusicAudio: true,

      dontRepeatSuggestions: false,
      hideVolumeBar: false,
      discordPresence: false,
      discordClientId: "",
      serverSync: true,
      syncPlaylists: true,
      serverPlays: true,
      storeLinks: false,
      lyricsLatin: true,
      gapless: true,
      seamlessAlbums: true,
      soundAnalysis: true,
      milkdrop: false,
      exploreTab: "albums",
      exploreLayout: "list",
      exploreSort: DEFAULT_EXPLORE_SORTS,
      rightRailWidth: 328,
      corners: "soft",
      accent: "violet",

      setDownloadDir: (downloadDir) => set({ downloadDir }),
      setDownloadQuality: (downloadQuality) => set({ downloadQuality }),
      setExportDownloads: (exportDownloads) => set({ exportDownloads }),
      setStreamingQuality: (streamingQuality) => set({ streamingQuality }),
      setCrossfadeSeconds: (crossfadeSeconds) => set({ crossfadeSeconds }),
      setSmartFade: (smartFade) => set({ smartFade }),
      setSkipSilence: (skipSilence) => set({ skipSilence }),
      setAutoplay: (autoplay) => set({ autoplay }),
      setPlaybackSpeed: (playbackSpeed) => set({ playbackSpeed: Math.min(2, Math.max(0.5, playbackSpeed)) }),
      setAudioSinkId: (audioSinkId) => set({ audioSinkId }),
      setEqEnabled: (eqEnabled) => set({ eqEnabled }),
      setEqGains: (eqGains) => set({ eqGains: eqGains.map((g) => Math.min(12, Math.max(-12, g))) }),
      setEqMode: (eqMode) => set({ eqMode }),
      setPeq: (peq) => set({ peq }),
      setReplayGainMode: (replayGainMode) => set({ replayGainMode }),
      setReplayGainTarget: (replayGainTarget) => set({ replayGainTarget }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setLibraryOrder: (libraryOrder) => set({ libraryOrder }),
      setWatchFolders: (watchFolders) => set({ watchFolders }),
      setReduceAnimation: (reduceAnimation) => set({ reduceAnimation }),
      setReduceDynamicBlur: (reduceDynamicBlur) => set({ reduceDynamicBlur }),
      setLiquidGlass: (liquidGlass) => set({ liquidGlass }),
      setFullBleedArtwork: (fullBleedArtwork) => set({ fullBleedArtwork }),
      setLegacyMeshGradient: (legacyMeshGradient) => set({ legacyMeshGradient }),
      setAnimatedCanvas: (animatedCanvas) => set({ animatedCanvas }),
      setSyncedLyrics: (syncedLyrics) => set({ syncedLyrics }),
      setBlurUnfocusedLyrics: (blurUnfocusedLyrics) => set({ blurUnfocusedLyrics }),
      setLocalMusicFolder: (localMusicFolder) => set({ localMusicFolder }),
      setFilterNonMusicAudio: (filterNonMusicAudio) => set({ filterNonMusicAudio }),
      setDontRepeatSuggestions: (dontRepeatSuggestions) => set({ dontRepeatSuggestions }),
      setHideVolumeBar: (hideVolumeBar) => set({ hideVolumeBar }),
      setDiscordPresence: (discordPresence) => set({ discordPresence }),
      // Only the digits survive a paste ("ID: 1234…", spaces, a trailing newline).
      setDiscordClientId: (id) => set({ discordClientId: id.replace(/\D/g, "").slice(0, 22) }),
      setServerSync: (serverSync) => set({ serverSync }),
      setSyncPlaylists: (syncPlaylists) => set({ syncPlaylists }),
      setServerPlays: (serverPlays) => set({ serverPlays }),
      setStoreLinks: (storeLinks) => set({ storeLinks }),
      setLyricsLatin: (lyricsLatin) => set({ lyricsLatin }),
      setGapless: (gapless) => set({ gapless }),
      setSeamlessAlbums: (seamlessAlbums) => set({ seamlessAlbums }),
      setSoundAnalysis: (soundAnalysis) => set({ soundAnalysis }),
      setMilkdrop: (milkdrop) => set({ milkdrop }),
      setExploreTab: (exploreTab) => set({ exploreTab }),
      setExploreLayout: (exploreLayout) => set({ exploreLayout }),
      setExploreSort: (tab, sort) => set((st) => ({ exploreSort: { ...st.exploreSort, [tab]: sort } })),
      setRightRailWidth: (px) => set({ rightRailWidth: Math.round(px) }),
      setCorners: (corners) => set({ corners }),
      setAccent: (accent) => set({ accent }),
    }),
    {
      name: "settings",
      storage: createJSONStorage(() => storage),
      // The panel used to sort only its albums ("librarySort"): a title or
      // artist order chosen there stays; the old default gives way to
      // Recently played.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SettingsState> & { librarySort?: string };
        const libraryOrder: LibraryOrder =
          saved.libraryOrder ?? (saved.librarySort === "alpha" || saved.librarySort === "artist" ? saved.librarySort : "played");
        return { ...current, ...saved, libraryOrder };
      },
    }
  )
);