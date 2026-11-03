/**
 * Playlists to and from M3U files (electron/m3u.ts). Import makes a playlist of
 * the entries it finds in the library (lib/m3uMatch.ts), in the file's
 * order. Export writes each song's local file where it has one (a merged
 * song's local copy counts), and a ByTune note for a song only on a server.
 */
import type { Track } from "../types";
import { ipcErrorText } from "./ipcError";
import { writeM3u } from "../../electron/m3u";
import { matchM3u } from "./m3uMatch";
import { useCatalog, versionsOf } from "../stores/catalog";
import { useLibrary } from "../stores/library";
import { useUI } from "../stores/ui";

export async function importM3uPlaylist(): Promise<void> {
  const bridge = window.bytune;
  if (!bridge) return;
  const ui = useUI.getState();
  let file: Awaited<ReturnType<typeof bridge.openM3u>>;
  try {
    file = await bridge.openM3u();
  } catch (err) {
    ui.toast(ipcErrorText(err, "Couldn't read that playlist"), "error");
    return;
  }
  if (!file) return;
  if (!file.entries.length) {
    ui.toast("That playlist has no songs in it", "info");
    return;
  }
  const catalog = useCatalog.getState();
  const songs = matchM3u(file.entries, catalog.tracks, catalog.byId, (t) => versionsOf(t)[0] ?? t).filter((t): t is Track => !!t);
  if (!songs.length) {
    ui.toast(`None of the ${file.entries.length} songs in "${file.name}" are in your library`, "info");
    return;
  }
  const playlist = useLibrary.getState().createPlaylist(file.name);
  for (const t of songs) useLibrary.getState().addToPlaylist(playlist.id, t);
  ui.navigate({ name: "playlist", param: playlist.id });
  const missed = file.entries.length - songs.length;
  ui.toast(
    missed > 0 ? `Imported ${songs.length} of ${file.entries.length} songs — ${missed} aren't in your library` : `Imported ${songs.length} songs`,
    "success"
  );
}

export async function exportM3uPlaylist(name: string, tracks: Track[]): Promise<void> {
  const bridge = window.bytune;
  if (!bridge || !tracks.length) return;
  const ui = useUI.getState();
  const { text, files, notes } = writeM3u(
    tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      duration: t.duration,
      localPath: t.localPath ?? versionsOf(t).find((v) => v.localPath)?.localPath,
    }))
  );
  try {
    const saved = await bridge.saveM3u(name, text);
    if (!saved) return;
    ui.toast(
      notes > 0
        ? `Saved ${files + notes} songs — ${notes} only on your server come back in Songsta; other players skip those`
        : `Saved "${name}" with ${files} songs`,
      "success"
    );
  } catch (err) {
    ui.toast(ipcErrorText(err, "Couldn't save the playlist"), "error");
  }
}
