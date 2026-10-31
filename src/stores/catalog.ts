/**
 * The library catalogue as one renderer-side index: local files, Jellyfin and
 * Navidrome songs plus all-time play counts. The album/artist pages, the home
 * page, mixes and smart playlists all read from here. Scans, enrichment
 * batches, folder-watch rescans and server refreshes announce themselves with
 * window events; the catalogue reloads (debounced) on each.
 *
 * A song found in more than one place (a local file that is also on the
 * Jellyfin server, a FLAC next to an MP3 copy) is listed once — see
 * lib/duplicates.ts. Its versions stay in `versions`, in the order playback
 * tries them, and its play counts are summed across all of them.
 */
import { useEffect } from "react";
import { create } from "zustand";
import type { JellyfinStatus } from "../../electron/jellyfin";
import type { SubsonicStatus } from "../../electron/subsonic";
import { mergeDuplicates } from "../lib/duplicates";
import { loadAllLibraryTracks } from "../lib/libraryTracks";
import { useSettings } from "./settings";
import type { Track } from "../types";

export type PlayCounts = Record<string, { plays: number; lastAt: number }>;

interface CatalogState {
  tracks: Track[];
  /** every version id of a merged song → its versions, in playback order */
  versions: Map<string, Track[]>;
  /** every copy by its own id — fresher than queue entries saved by an older version */
  byId: Map<string, Track>;
  playCounts: PlayCounts;
  loaded: boolean;
  /** bumped on every reload and play-count refresh */
  version: number;
  load(): Promise<void>;
  refreshPlayCounts(): Promise<void>;
}

/** A merged song's plays are the sum over its versions, readable under any of their ids. */
function mergeCounts(counts: PlayCounts, versions: Map<string, Track[]>): PlayCounts {
  if (!versions.size) return counts;
  const out: PlayCounts = { ...counts };
  const seen = new Set<Track[]>();
  for (const group of versions.values()) {
    if (seen.has(group)) continue;
    seen.add(group);
    let plays = 0;
    let lastAt = 0;
    for (const v of group) {
      const c = counts[v.id];
      if (!c) continue;
      plays += c.plays;
      lastAt = Math.max(lastAt, c.lastAt);
    }
    if (plays) for (const v of group) out[v.id] = { plays, lastAt };
  }
  return out;
}

let inflight: Promise<void> | null = null;
let again = false;

export const useCatalog = create<CatalogState>((set, get) => ({
  tracks: [],
  versions: new Map(),
  byId: new Map(),
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
        const [all, playCounts] = await Promise.all([
          loadAllLibraryTracks(),
          (window.bytune?.statsPlayCounts().catch(() => ({})) ?? Promise.resolve({})) as Promise<PlayCounts>,
        ]);
        const { tracks, versions } = mergeDuplicates(all);
        set((s) => ({
          tracks,
          versions,
          byId: new Map(all.map((t) => [t.id, t])),
          playCounts: mergeCounts(playCounts ?? {}, versions),
          loaded: true,
          version: s.version + 1,
        }));
      } while (again);
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  },
  async refreshPlayCounts() {
    const playCounts = (await window.bytune?.statsPlayCounts().catch(() => null)) as PlayCounts | null;
    if (playCounts) {
      set((s) => ({ playCounts: mergeCounts(playCounts, s.versions), version: get().loaded ? s.version + 1 : s.version }));
    }
  },
}));

/**
 * A song's versions in playback order — just the track itself when it exists
 * only once (the catalogue's copy of it, when listed: a queue entry saved by
 * an older version lacks the newer fields).
 */
export function versionsOf(track: Track): Track[] {
  const s = useCatalog.getState();
  return s.versions.get(track.id) ?? [s.byId.get(track.id) ?? track];
}

/** One key per song: every copy of a merged song answers with the same key. */
export function songKey(id: string): string {
  return useCatalog.getState().versions.get(id)?.[0]?.id ?? id;
}

/** Two ids name the same song: identical, or versions of one merged song. */
export function sameSong(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return useCatalog.getState().versions.get(a)?.some((v) => v.id === b) ?? false;
}

/** Library sources announce changes with these window events. */
export const CATALOG_EVENTS = ["bytune:local-library-updated", "bytune:remote-library-updated"] as const;

/**
 * Libraries read by an older version lack fields this one uses (release
 * types, track totals, the servers' media info): bring them up to date once,
 * in the background — the cached libraries keep working meanwhile.
 */
async function upgradeStaleSources(): Promise<void> {
  const bridge = window.bytune;
  if (!bridge) return;
  try {
    const [jf, ss] = (await Promise.all([bridge.jellyfinStatus(), bridge.subsonicStatus()])) as [
      JellyfinStatus | null,
      SubsonicStatus | null,
    ];
    await Promise.all([
      jf?.stale ? bridge.jellyfinRefresh().then(announceRemoteLibraryChange) : null,
      ss?.stale ? bridge.subsonicRefresh().then(announceRemoteLibraryChange) : null,
    ]);
  } catch {
    /* an unreachable server keeps its cached library */
  }
  try {
    if (await bridge.libraryNeedsRescan()) {
      const lib = await bridge.scanLibrary(useSettings.getState().filterNonMusicAudio);
      window.dispatchEvent(new CustomEvent("bytune:local-library-updated", { detail: lib }));
    }
  } catch {
    /* the next scan fills the fields in */
  }
}

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
  const upgrade = window.setTimeout(() => void upgradeStaleSources(), 3000);
  return () => {
    for (const e of CATALOG_EVENTS) window.removeEventListener(e, reload);
    if (timer !== null) window.clearTimeout(timer);
    window.clearTimeout(upgrade);
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
