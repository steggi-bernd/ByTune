/**
 * Artist imagery + album fill for the Now Playing panel.
 *
 *  - the artist photo comes from the same open-database lookup as the
 *    about card (Wikimedia Commons / Wikipedia, see artistAbout.ts);
 *  - when a track's tags carry no album, MusicBrainz (iTunes as fallback)
 *    names the release the recording appeared on.
 */
import { useEffect, useState } from "react";
import type { ReleaseMeta } from "../../electron/metadata";
import type { Track } from "../types";
import { resolveArtistAbout } from "./artistAbout";
import { leadArtist } from "./libraryTracks";

export interface ArtistPanelData {
  /** artist photo, distinct from the track's artwork */
  artistImage: string | null;
  /** album name recovered from open metadata, when the track itself lacks one */
  albumFill: string | null;
}

const cache = new Map<string, ArtistPanelData>();

async function resolve(track: Track): Promise<ArtistPanelData> {
  const needsAlbum = !track.album || track.album === "Unknown album";
  const [about, release] = await Promise.all([
    // The first credited artist's photo — "A, B" is two artists, not one.
    resolveArtistAbout(leadArtist(track.artist)),
    needsAlbum && window.bytune?.metaRecording
      ? (window.bytune.metaRecording(track.title, track.artist, track.duration) as Promise<ReleaseMeta | null>).catch(() => null)
      : Promise.resolve(null),
  ]);
  return { artistImage: about?.thumb ?? null, albumFill: release?.title ?? null };
}

export function useArtistImage(track: Track | null): ArtistPanelData {
  const key = track ? `${track.artist}|${track.title}` : "";
  const [data, setData] = useState<ArtistPanelData>(() =>
    key && cache.has(key) ? cache.get(key)! : { artistImage: null, albumFill: null }
  );

  useEffect(() => {
    if (!track || track.artistImage || !key) return;
    const cached = cache.get(key);
    if (cached) {
      setData(cached);
      return;
    }
    let cancelled = false;
    setData({ artistImage: null, albumFill: null });
    void resolve(track).then((res) => {
      cache.set(key, res);
      if (!cancelled) setData(res);
    });
    return () => {
      cancelled = true;
    };
  }, [track, key]);

  return track?.artistImage ? { artistImage: track.artistImage, albumFill: null } : data;
}
