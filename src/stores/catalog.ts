/**
 * The library catalogue as one renderer-side index: local files, Jellyfin and
 * Navidrome songs plus all-time play counts. The album/artist pages, the home
 * page, mixes and smart playlists all read from here. Scans, enrichment
 * batches, folder-watch rescans and server refreshes announce themselves with
 * window events; the catalogue reloads (debounced) on each.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { loadAllLibraryTracks } from "../lib/libraryTracks";
import type { Track } from "../types";

export type PlayCounts = Record<string, { plays: number; lastAt: number }>;

interface CatalogState {
  tracks: Track[];
  playCounts: PlayCounts;
  loaded: boolean;
  /** bumped on every reload and play-count refresh */
  version: number;
  load(): Promise<void>;
  refreshPlayCounts(): Promise<void>;
}

let inflight: Promise<void> | null = null;
let again = false;

export const useCatalog = create<CatalogState>((set, get) => ({
  tracks: [],
  playCounts: {},
  loaded: false,
  version: 0,
  load() {
    // A reload asked for mid-load runs once more afterwards — never a stale index.
    if (inflight) {
      again = true;
      return inflight;
    }
    inflight = (async () => {
      do {
        again = false;
        const [tracks, playCounts] = await Promise.all([
          loadAllLibraryTracks(),
          (window.bytune?.statsPlayCounts().catch(() => ({})) ?? Promise.resolve({})) as Promise<PlayCounts>,
        ]);
        set((s) => ({ tracks, playCounts: playCounts ?? {}, loaded: true, version: s.version + 1 }));
      } while (again);
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  },
  async refreshPlayCounts() {
    const playCounts = (await window.bytune?.statsPlayCounts().catch(() => null)) as PlayCounts | null;
    if (playCounts) set((s) => ({ playCounts, version: get().loaded ? s.version + 1 : s.version }));
  },
}));

/** Library sources announce changes with these window events. */
export const CATALOG_EVENTS = ["bytune:local-library-updated", "bytune:remote-library-updated"] as const;

/** Mount once (App): first load, then a debounced reload on every library change. */
export function watchCatalog(): () => void {
  let timer: number | null = null;
  const reload = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      void useCatalog.getState().load();
    }, 400);
  };
  void useCatalog.getState().load();
  for (const e of CATALOG_EVENTS) window.addEventListener(e, reload);
  return () => {
    for (const e of CATALOG_EVENTS) window.removeEventListener(e, reload);
    if (timer !== null) window.clearTimeout(timer);
  };
}

/** Pages that rank by plays refresh the counts when they open. */
export function useFreshPlayCounts(): void {
  useEffect(() => {
    void useCatalog.getState().refreshPlayCounts();
  }, []);
}

/** Tell the catalogue (and the Local Music view) that a server library changed. */
export function announceRemoteLibraryChange(): void {
  window.dispatchEvent(new CustomEvent("bytune:remote-library-updated"));
}
