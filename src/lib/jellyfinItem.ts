/**
 * A Jellyfin item as a library song, shared by the desktop's main process and
 * the phone app: pure, no bridge and no store. `artUrl` says how this app
 * reaches a cover.
 */
import { isoDate } from "../../electron/release-date";
import type { Track } from "../types";
import { withRoutes } from "./libraryCore";
import { T } from "./i18n";

export interface JellyfinTrack {
  /** "jf:<itemId>" — the id prefix routes playback to this module */
  id: string;
  itemId: string;
  title: string;
  artist: string;
  album: string;
  albumId?: string;
  duration: number;
  trackNo?: number;
  discNo?: number;
  year?: number;
  /** the item's PremiereDate: "YYYY-MM-DD" */
  date?: string;
  genre?: string;
  /** the URL of the item's (or its album's) cover, from `artUrl` */
  art?: string;
  addedAt?: number;
  albumArtist?: string;
  /** Jellyfin's own loudness gain (dB to −18 LUFS), used like a ReplayGain track gain */
  gain?: number;
  /** the file's container and audio stream, from the server's media info */
  container?: string;
  codec?: string;
  sampleRate?: number;
  bitsPerSample?: number;
  /** bits per second */
  bitrate?: number;
}

export function jellyfinItemToTrack(item: any, artUrl: (itemId: string, tag: string) => string): JellyfinTrack | null {
  if (!item?.Id) return null;
  const artists: string[] = Array.isArray(item.Artists) ? item.Artists.filter((a: unknown) => typeof a === "string") : [];
  const ticks = Number(item.RunTimeTicks) || 0;
  let art: string | undefined;
  if (typeof item.ImageTags?.Primary === "string") art = artUrl(item.Id, item.ImageTags.Primary);
  else if (item.AlbumId && typeof item.AlbumPrimaryImageTag === "string") art = artUrl(item.AlbumId, item.AlbumPrimaryImageTag);
  const bounded = (v: unknown): string => (typeof v === "string" ? v.slice(0, 200) : "");
  const positive = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
  const audio = Array.isArray(item.MediaStreams) ? item.MediaStreams.find((s: any) => s?.Type === "Audio") : undefined;
  return {
    id: `jf:${item.Id}`,
    itemId: String(item.Id),
    title: bounded(item.Name) || T("Unknown title"),
    artist: bounded(artists.join(", ")) || bounded(item.AlbumArtist) || "Unknown artist",
    album: bounded(item.Album) || "Unknown album",
    albumId: item.AlbumId ? String(item.AlbumId) : undefined,
    duration: Math.round(ticks / 10_000_000),
    trackNo: typeof item.IndexNumber === "number" ? item.IndexNumber : undefined,
    discNo: typeof item.ParentIndexNumber === "number" ? item.ParentIndexNumber : undefined,
    year: typeof item.ProductionYear === "number" ? item.ProductionYear : undefined,
    date: isoDate(item.PremiereDate),
    genre: Array.isArray(item.Genres) && typeof item.Genres[0] === "string" ? item.Genres[0] : undefined,
    art,
    addedAt: item.DateCreated ? Date.parse(item.DateCreated) || undefined : undefined,
    albumArtist: bounded(item.AlbumArtist) || undefined,
    gain: typeof item.NormalizationGain === "number" && Number.isFinite(item.NormalizationGain) ? item.NormalizationGain : undefined,
    container: bounded(item.Container).toLowerCase() || undefined,
    codec: bounded(audio?.Codec).toLowerCase() || undefined,
    sampleRate: positive(audio?.SampleRate),
    bitsPerSample: positive(audio?.BitDepth),
    bitrate: positive(audio?.BitRate),
  };
}

export function jellyfinToTrack(t: JellyfinTrack): Track {
  return withRoutes({
    id: t.id,
    title: t.title,
    artist: t.artist,
    album: t.album,
    duration: t.duration,
    thumb: t.art ?? "",
    source: "jellyfin",
    year: t.year,
    date: t.date,
    genre: t.genre,
    albumArtist: t.albumArtist,
    trackNo: t.trackNo,
    discNo: t.discNo,
    addedAt: t.addedAt,
    rg: t.gain !== undefined ? { trackGain: t.gain } : undefined,
    container: t.container,
    codec: t.codec,
    sampleRate: t.sampleRate,
    bitsPerSample: t.bitsPerSample,
    bitrate: t.bitrate,
  });
}
