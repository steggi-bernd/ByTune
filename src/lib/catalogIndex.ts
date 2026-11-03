/**
 * The catalogue's derived views for the desktop's pages — built once per
 * catalogue version and shared by every page that needs them. The builders
 * themselves: catalogBuild.ts.
 */
import { useMemo } from "react";
import { useAlbumEdits } from "../stores/albumEdits";
import { songKey, useCatalog } from "../stores/catalog";
import { useLibrary } from "../stores/library";
import type { Track } from "../types";
import { buildAlbums, buildArtists, buildGenres, likedAmong, type LibAlbum, type LibArtist, type LibGenre } from "./catalogBuild";

export * from "./catalogBuild";


/** likedAmong for a page's songs: rebuilt when the likes or the catalogue's copies change. */
export function useLikedAmong(songs: Track[]): Track[] {
  const liked = useLibrary((s) => s.liked);
  const versions = useCatalog((s) => s.versions);
  return useMemo(
    () => likedAmong(songs, liked, songKey),
    // songKey reads the catalogue's versions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [songs, liked, versions]
  );
}

let albumsMemo: { tracks: Track[]; edits: Record<string, string>; albums: LibAlbum[]; artists: LibArtist[] } | null = null;

/**
 * Albums and artists for the current song list — built once per catalogue
 * load (or album edit) and shared by all pages.
 */
export function useLibraryIndex(): { albums: LibAlbum[]; artists: LibArtist[]; tracks: Track[]; loaded: boolean } {
  const tracks = useCatalog((s) => s.tracks);
  const loaded = useCatalog((s) => s.loaded);
  const artistEdits = useAlbumEdits((s) => s.artists);
  return useMemo(() => {
    // Play-count refreshes keep the same track list, so they never rebuild the index.
    if (!albumsMemo || albumsMemo.tracks !== tracks || albumsMemo.edits !== artistEdits) {
      const albums = buildAlbums(tracks, artistEdits);
      albumsMemo = { tracks, edits: artistEdits, albums, artists: buildArtists(tracks, albums) };
    }
    return { albums: albumsMemo.albums, artists: albumsMemo.artists, tracks, loaded };
  }, [tracks, loaded, artistEdits]);
}

let genresMemo: { tracks: Track[]; genres: LibGenre[] } | null = null;

/** The library's genres, built once per catalogue load and shared (Explore, genre pages). */
export function useLibraryGenres(): LibGenre[] {
  const tracks = useCatalog((s) => s.tracks);
  return useMemo(() => {
    if (!genresMemo || genresMemo.tracks !== tracks) genresMemo = { tracks, genres: buildGenres(tracks) };
    return genresMemo.genres;
  }, [tracks]);
}
