/**
 * The player's whole catalogue: local files plus the connected servers
 * (Jellyfin, Navidrome/Subsonic), as playable Tracks. Search, AutoPlay, the
 * album/artist pages, home mixes and smart playlists all read through here,
 * so every source looks the same everywhere.
 *
 * Library tracks carry route keys instead of catalogue ids: `albumId` opens
 * the library album page, `artistId` the library artist page.
 */
import type { JellyfinLibrary } from "../../electron/jellyfin";
import type { LocalTrack } from "../../electron/local-library";
import type { SubsonicLibrary, SubsonicTrack } from "../../electron/subsonic";
import type { Track } from "../types";
import { jellyfinToTrack } from "./jellyfinItem";
import { withRoutes } from "./libraryCore";

export * from "./libraryCore";
export { jellyfinToTrack };

/* ------------------------------------------------------------- sources */

export function localToTrack(t: LocalTrack): Track {
  return withRoutes({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    thumb: t.art ?? "",
    localPath: t.path,
    source: "local",
    year: t.year,
    genre: t.genre,
    albumArtist: t.albumArtist,
    trackNo: t.trackNo,
    discNo: t.discNo,
    trackTotal: t.trackTotal,
    releaseType: t.releaseType,
    originalYear: t.originalYear,
    date: t.date,
    originalDate: t.originalDate,
    addedAt: t.addedAt ?? t.mtime,
    rg: t.rg,
    codec: t.codec,
    sampleRate: t.sampleRate,
    bitsPerSample: t.bitsPerSample,
    bitrate: t.bitrate,
    lossless: t.lossless,
  });
}

export function subsonicToTrack(t: SubsonicTrack): Track {
  return withRoutes({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    thumb: t.art ?? "",
    source: "subsonic",
    year: t.year,
    genre: t.genre,
    albumArtist: t.albumArtist,
    trackNo: t.trackNo,
    discNo: t.discNo,
    trackTotal: t.trackTotal,
    releaseType: t.releaseType,
    originalYear: t.originalYear,
    date: t.date,
    originalDate: t.originalDate,
    addedAt: t.addedAt,
    rg: t.rg,
    container: t.suffix,
    codec: t.codec,
    sampleRate: t.sampleRate,
    bitsPerSample: t.bitsPerSample,
    bitrate: t.bitrate,
  });
}

/** Local files and server items all play through library:trackurl. */
export function isLibraryTrack(track: Track): boolean {
  return (
    !!track.localPath ||
    track.id.startsWith("local:") ||
    track.id.startsWith("jf:") ||
    track.id.startsWith("ss:")
  );
}

export async function loadLocalTracks(): Promise<Track[]> {
  const lib = (await window.bytune?.localLibrary().catch(() => null)) as { tracks?: LocalTrack[] } | null;
  return (lib?.tracks ?? []).map(localToTrack);
}

export async function loadJellyfinTracks(): Promise<Track[]> {
  const lib = (await window.bytune?.jellyfinLibrary().catch(() => null)) as JellyfinLibrary | null;
  return (lib?.tracks ?? []).map(jellyfinToTrack);
}

export async function loadSubsonicTracks(): Promise<Track[]> {
  const lib = (await window.bytune?.subsonicLibrary().catch(() => null)) as SubsonicLibrary | null;
  return (lib?.tracks ?? []).map(subsonicToTrack);
}

export async function loadAllLibraryTracks(): Promise<Track[]> {
  const [local, jf, ss] = await Promise.all([loadLocalTracks(), loadJellyfinTracks(), loadSubsonicTracks()]);
  return [...local, ...jf, ...ss];
}
