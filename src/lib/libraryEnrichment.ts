/**
 * Covers and album names the main process fills in from the open databases
 * (electron/enrich.ts) arrive here batch by batch. The Local Music view
 * re-renders from the event; copies of those tracks already sitting in the
 * queue, Liked Songs or playlists get the new cover too, so the player bar
 * and sidebar don't keep showing a blank square.
 */
import type { LocalLibrary } from "../../electron/local-library";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import type { Track } from "../types";

export function watchLibraryEnrichment(): () => void {
  const off = window.bytune?.onLibraryEnriched((raw) => {
    const lib = raw as LocalLibrary;
    window.dispatchEvent(new CustomEvent("bytune:local-library-updated", { detail: lib }));

    const fills = new Map<string, { thumb: string; album: string }>();
    for (const t of lib.tracks ?? []) if (t.art) fills.set(t.id, { thumb: t.art, album: t.album });
    if (!fills.size) return;
    const patch = (list: Track[]): Track[] | null => {
      let changed = false;
      const next = list.map((t) => {
        const f = fills.get(t.id);
        if (!f || t.thumb) return t;
        changed = true;
        return { ...t, thumb: f.thumb, album: t.album && t.album !== "Unknown album" ? t.album : f.album };
      });
      return changed ? next : null;
    };

    const queue = patch(usePlayer.getState().queue);
    if (queue) usePlayer.setState({ queue });
    const libState = useLibrary.getState();
    const liked = patch(libState.liked);
    let playlistsChanged = false;
    const playlists = libState.playlists.map((p) => {
      const tracks = patch(p.tracks);
      if (!tracks) return p;
      playlistsChanged = true;
      return { ...p, tracks };
    });
    if (liked || playlistsChanged) {
      useLibrary.setState({ ...(liked ? { liked } : {}), ...(playlistsChanged ? { playlists } : {}) });
    }
  });
  return off ?? (() => undefined);
}
