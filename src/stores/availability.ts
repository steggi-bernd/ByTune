/**
 * What can play right now. Local songs need their folder's drive (an
 * unplugged USB disk or a NAS share that is away takes its folders offline);
 * server songs need the server to answer. Lists grey out what can't play and
 * light it up again once it is back.
 *
 * Checked in the background — every 15 s while something is away, every
 * minute otherwise — and again whenever the window regains focus, the
 * network changes, a library changes or a song fails to play.
 */
import { useMemo } from "react";
import { create } from "zustand";
import { isUnderPath } from "../../electron/local-paths";
import { CATALOG_EVENTS, useCatalog } from "./catalog";
import type { Track } from "../types";

interface AvailabilityState {
  /** imported folders whose directory can't be reached right now */
  offlineFolders: string[];
  /** a server is set up (known at once — the reachability check can take seconds) */
  jellyfinConnected: boolean;
  subsonicConnected: boolean;
  /** whether the server answers; null = no server connected, or not checked yet */
  jellyfin: boolean | null;
  subsonic: boolean | null;
  /** bumped on every change, for memoised checks */
  version: number;
  refresh(): Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useAvailability = create<AvailabilityState>((set, get) => ({
  offlineFolders: [],
  jellyfinConnected: false,
  subsonicConnected: false,
  jellyfin: null,
  subsonic: null,
  version: 0,
  refresh() {
    if (inflight) return inflight;
    inflight = (async () => {
      const bridge = window.bytune;
      if (!bridge) return;
      const [jf, ss] = (await Promise.all([
        bridge.jellyfinStatus().catch(() => null),
        bridge.subsonicStatus().catch(() => null),
      ])) as [{ connected?: boolean } | null, { connected?: boolean } | null];
      if (!!jf?.connected !== get().jellyfinConnected || !!ss?.connected !== get().subsonicConnected) {
        set({ jellyfinConnected: !!jf?.connected, subsonicConnected: !!ss?.connected });
      }
      const res = await bridge.libraryAvailability().catch(() => null);
      if (!res) return;
      const offlineFolders = res.folders.filter((f) => !f.exists).map((f) => f.path);
      const s = get();
      const unchanged =
        s.jellyfin === res.jellyfin &&
        s.subsonic === res.subsonic &&
        s.offlineFolders.join("\n") === offlineFolders.join("\n");
      if (!unchanged) set({ offlineFolders, jellyfin: res.jellyfin, subsonic: res.subsonic, version: s.version + 1 });
    })().finally(() => {
      inflight = null;
    });
    return inflight;
  },
}));

/** Where a version lives — tracks saved by older versions may lack `source`. */
export function sourceOf(t: Track): Track["source"] {
  if (t.source) return t.source;
  if (t.localPath || t.id.startsWith("local:")) return "local";
  if (t.id.startsWith("jf:")) return "jellyfin";
  if (t.id.startsWith("ss:")) return "subsonic";
  return undefined;
}

/** One version: its folder is reachable / its server answers (unknown counts as reachable). */
export function versionAvailable(v: Track, s: Pick<AvailabilityState, "offlineFolders" | "jellyfin" | "subsonic"> = useAvailability.getState()): boolean {
  switch (sourceOf(v)) {
    case "local":
      return !v.localPath || !s.offlineFolders.some((f) => isUnderPath(v.localPath!, f));
    case "jellyfin":
      return s.jellyfin !== false;
    case "subsonic":
      return s.subsonic !== false;
    default:
      return true;
  }
}

/** A song can play when any of its versions can. */
export function trackAvailable(track: Track, s = useAvailability.getState()): boolean {
  const versions = useCatalog.getState().versions.get(track.id) ?? [track];
  return versions.some((v) => versionAvailable(v, s));
}

/** For track lists: a checker that changes whenever availability or the catalogue does. */
export function useAvailabilityCheck(): (track: Track) => boolean {
  const version = useAvailability((s) => s.version);
  const catalogVersion = useCatalog((s) => s.version);
  return useMemo(() => {
    const s = useAvailability.getState();
    return (track: Track) => trackAvailable(track, s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, catalogVersion]);
}

/** Mount once (App): check now, then keep checking in the background. */
export function watchAvailability(): () => void {
  let timer: number | null = null;
  const schedule = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    const s = useAvailability.getState();
    const away = s.offlineFolders.length > 0 || s.jellyfin === false || s.subsonic === false;
    timer = window.setTimeout(check, away ? 15_000 : 60_000);
  };
  const check = (): void => {
    void useAvailability.getState().refresh().finally(schedule);
  };
  const events = ["focus", "online", "offline", ...CATALOG_EVENTS];
  check();
  for (const e of events) window.addEventListener(e, check);
  return () => {
    for (const e of events) window.removeEventListener(e, check);
    if (timer !== null) window.clearTimeout(timer);
  };
}
