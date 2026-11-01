/**
 * About the playing song (its story and credits) and an artist's photo and
 * banner — from Genius through the main process (electron/song-info.ts),
 * which keeps the answers on disk; this module only memoizes them for the
 * session.
 */
import { useEffect, useState } from "react";
import type { ArtistImages, SongInfo } from "../../electron/song-info";
import type { Track } from "../types";
import { leadArtist } from "./libraryTracks";

const songs = new Map<string, Promise<SongInfo | null>>();
const artists = new Map<string, Promise<ArtistImages | null>>();

function remember<T>(memo: Map<string, Promise<T | null>>, key: string, ask: () => Promise<T | null>): Promise<T | null> {
  let job = memo.get(key);
  if (!job) {
    job = ask().catch(() => {
      memo.delete(key); // a failed ask is tried again next time
      return null;
    });
    memo.set(key, job);
  }
  return job;
}

export function resolveSongInfo(title: string, artist: string): Promise<SongInfo | null> {
  const bridge = window.bytune;
  if (!bridge?.metaSong || !title.trim()) return Promise.resolve(null);
  return remember(songs, `${artist.toLowerCase()}|${title.toLowerCase()}`, () => bridge.metaSong(title, artist));
}

export function resolveArtistImages(name: string): Promise<ArtistImages | null> {
  const bridge = window.bytune;
  const key = name.trim().toLowerCase();
  if (!bridge?.metaArtistImages || !key || key === "unknown artist") return Promise.resolve(null);
  return remember(artists, key, () => bridge.metaArtistImages(name));
}

/** The song's story and credits, once known; null while asking or when Genius has none. */
export function useSongInfo(track: Track | null): SongInfo | null {
  const title = track?.title ?? "";
  // The lead artist finds the song: "A, B" searches as A.
  const artist = track ? leadArtist(track.artist) : "";
  const [info, setInfo] = useState<SongInfo | null>(null);
  useEffect(() => {
    let alive = true;
    setInfo(null);
    if (title) void resolveSongInfo(title, artist).then((i) => alive && setInfo(i));
    return () => {
      alive = false;
    };
  }, [title, artist]);
  return info;
}

/** An artist's photo and wide banner; null while asking or when none is known. */
export function useArtistImages(name: string): ArtistImages | null {
  const [images, setImages] = useState<ArtistImages | null>(null);
  useEffect(() => {
    let alive = true;
    setImages(null);
    void resolveArtistImages(name).then((i) => alive && setImages(i));
    return () => {
      alive = false;
    };
  }, [name]);
  return images;
}
