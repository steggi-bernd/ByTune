/**
 * The player's whole catalogue: local files plus the connected Jellyfin
 * server, as playable Tracks. Search, AutoPlay and the Jellyfin view all
 * read through here, so both sources look the same everywhere.
 */
import type { JellyfinLibrary, JellyfinTrack } from "../../electron/jellyfin";
import type { LocalTrack } from "../../electron/local-library";
import type { Track } from "../types";

export function localToTrack(t: LocalTrack): Track {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    thumb: t.art ?? "",
    localPath: t.path,
  };
}

export function jellyfinToTrack(t: JellyfinTrack): Track {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    thumb: t.art ?? "",
  };
}

/** Local files and Jellyfin items both play through library:trackurl. */
export function isLibraryTrack(track: Track): boolean {
  return !!track.localPath || track.id.startsWith("local:") || track.id.startsWith("jf:");
}

export async function loadLocalTracks(): Promise<Track[]> {
  const lib = (await window.bytune?.localLibrary().catch(() => null)) as { tracks?: LocalTrack[] } | null;
  return (lib?.tracks ?? []).map(localToTrack);
}

export async function loadJellyfinTracks(): Promise<Track[]> {
  const lib = (await window.bytune?.jellyfinLibrary().catch(() => null)) as JellyfinLibrary | null;
  return (lib?.tracks ?? []).map(jellyfinToTrack);
}

export async function loadAllLibraryTracks(): Promise<Track[]> {
  const [local, jf] = await Promise.all([loadLocalTracks(), loadJellyfinTracks()]);
  return [...local, ...jf];
}

/** Case/accent-insensitive match of every query word against title, artist or album. */
export function matchesQuery(track: Track, query: string): boolean {
  const fold = (s: string): string =>
    s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const hay = fold(`${track.title} ${track.artist} ${track.album ?? ""}`);
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
