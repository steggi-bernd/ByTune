/** Album helpers (load + play / queue). */
import { requireBridge } from "./bridge";
import { usePlayer } from "../stores/player";
import { useUI } from "../stores/ui";
import type { Track } from "../types";
import { T } from "./i18n";

export async function fetchAlbum(albumId: string): Promise<{ title: string; artist: string; year?: string; thumb: string; tracks: Track[] }> {
  const { album, tracks } = await requireBridge().getAlbum(albumId);
  return { title: album.title, artist: album.artist, year: album.year, thumb: album.thumb, tracks };
}

export async function playAlbum(albumId: string): Promise<void> {
  try {
    const { tracks } = await requireBridge().getAlbum(albumId);
    if (!tracks.length) throw new Error("No playable songs");
    usePlayer.getState().playAll(tracks);
  } catch {
    useUI.getState().toast(T("Couldn't load that album"), "error");
  }
}

export async function queueAlbum(albumId: string): Promise<void> {
  try {
    const { tracks } = await requireBridge().getAlbum(albumId);
    usePlayer.getState().addToQueue(tracks);
    useUI.getState().toast(T("Album added to queue"));
  } catch {
    useUI.getState().toast(T("Couldn't load that album"), "error");
  }
}
