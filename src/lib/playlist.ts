/** Playlist helpers (fetch + play). */
import { requireBridge } from "./bridge";
import { usePlayer } from "../stores/player";
import { useUI } from "../stores/ui";
import type { Track } from "../types";
import { T } from "./i18n";

export async function playPlaylist(playlistId: string): Promise<void> {
  const ui = useUI.getState();
  try {
    ui.toast(T("Loading playlist…"));
    const { tracks } = await requireBridge().getPlaylist(playlistId);
    if (!tracks.length) throw new Error("No playable songs");
    usePlayer.getState().playAll(tracks);
  } catch {
    useUI.getState().toast(T("Couldn't load that playlist"), "error");
  }
}
