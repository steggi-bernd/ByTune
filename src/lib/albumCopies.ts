/**
 * An album renamed or given another cover shows everywhere at once. The
 * catalogue re-applies those edits by itself, but Liked Songs, playlists, the
 * history and the queue keep their own copies of songs: those of that album
 * take over what the catalogue now shows, and back again when the edit goes.
 */
import { useAlbumEdits } from "../stores/albumEdits";
import { songKey, useCatalog } from "../stores/catalog";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import type { Track } from "../types";
import { albumKeyOf, parseRoute } from "./libraryTracks";

const keysThatChanged = (a: Record<string, string>, b: Record<string, string>): string[] =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((key) => a[key] !== b[key]);

/** Mount once (App). */
export function watchAlbumCopies(): () => void {
  return useAlbumEdits.subscribe((s, prev) => {
    if (s.titles === prev.titles && s.covers === prev.covers) return;
    const changed = new Set([...keysThatChanged(s.titles, prev.titles), ...keysThatChanged(s.covers, prev.covers)]);
    if (!changed.size) return;
    const shown = new Map(useCatalog.getState().tracks.map((t) => [t.id, t]));
    const rawCopy = useCatalog.getState().byId;

    const refreshed = (list: Track[]): Track[] => {
      let touched = false;
      const next = list.map((t) => {
        const key = (t.albumId ? parseRoute(t.albumId, "album") : null) ?? albumKeyOf(t);
        if (!key || !changed.has(key)) return t;
        const fresh = shown.get(songKey(t.id));
        if (!fresh) return t;
        touched = true;
        // Without an edit left, a song's picture is its own copy's again.
        const thumb = s.covers[key] ?? rawCopy.get(t.id)?.thumb ?? fresh.thumb;
        return { ...t, album: fresh.album, albumTag: fresh.albumTag, thumb: thumb || t.thumb };
      });
      return touched ? next : list;
    };

    const lib = useLibrary.getState();
    const liked = refreshed(lib.liked);
    const history = refreshed(lib.history);
    let playlistsTouched = false;
    const playlists = lib.playlists.map((p) => {
      const tracks = refreshed(p.tracks);
      if (tracks === p.tracks) return p;
      playlistsTouched = true;
      return { ...p, tracks };
    });
    if (liked !== lib.liked || history !== lib.history || playlistsTouched) {
      useLibrary.setState({ liked, history, playlists });
    }
    const player = usePlayer.getState();
    const queue = refreshed(player.queue);
    if (queue !== player.queue) usePlayer.setState({ queue });
  });
}
