/**
 * The library check (Settings → Library check): what looks off in the
 * library, found from the songs themselves —
 *
 *  - an artist credited under several spellings ("Beyoncé" and "Beyonce",
 *    "The Beatles" and "Beatles"), to show under one (an alias, lib/albumEdits)
 *  - an album in several parts (a disc, a bonus or deluxe part), to merge
 *  - songs on this computer more than once: the copy that plays and the rest,
 *    to clear away by hand
 *  - albums without a cover, a year or a genre
 *
 * It only suggests; ByTune never touches the files. Pure, so the rules are
 * testable on their own.
 */
import type { Track } from "../types";
import type { LibAlbum } from "./catalogIndex";
import { baseTitle } from "./albumEdits";
import { leadArtist, splitCredits } from "./libraryTracks";

export interface Spelling {
  name: string;
  songs: number;
}

export interface SpellingGroup {
  /** most used first */
  names: Spelling[];
  suggested: string;
}

export interface SplitAlbum {
  /** the parts to fold into `into` */
  parts: LibAlbum[];
  into: LibAlbum;
}

export interface SpareCopies {
  song: Track;
  /** the copy that plays (the best one, see lib/duplicates.ts) */
  keep: Track;
  spare: Track[];
}

export interface MissingDetails {
  cover: LibAlbum[];
  year: LibAlbum[];
  genre: LibAlbum[];
}

/** What makes two artist names one: case, accents, a leading "The", "&" for "and", punctuation and spaces don't count. */
export function spellingKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^the\s+/, "")
    .replace(/\s*&\s*|\s+\+\s+/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/** How many accents a name carries — between two equally used spellings, the one with them is likely the proper one. */
const accents = (name: string): number => name.normalize("NFKD").length - name.normalize("NFC").length;
const songsIn = (g: SpellingGroup): number => g.names.reduce((n, s) => n + s.songs, 0);

/** Artists credited under more than one spelling, the most used one suggested; biggest first. */
export function artistSpellings(tracks: readonly Track[]): SpellingGroup[] {
  const counts = new Map<string, number>();
  for (const t of tracks) {
    const names = new Set([...splitCredits(t.artist ?? ""), ...(t.albumArtist ? splitCredits(t.albumArtist) : [])]);
    for (const raw of names) {
      const name = raw.trim();
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  const groups = new Map<string, Spelling[]>();
  for (const [name, songs] of counts) {
    const key = spellingKey(name);
    if (key.length < 2) continue;
    groups.set(key, [...(groups.get(key) ?? []), { name, songs }]);
  }
  return [...groups.values()]
    .filter((names) => names.length > 1)
    .map((names) => {
      const sorted = [...names].sort((a, b) => b.songs - a.songs || accents(b.name) - accents(a.name) || a.name.localeCompare(b.name));
      return { names: sorted, suggested: sorted[0].name };
    })
    .sort((a, b) => songsIn(b) - songsIn(a));
}

/** Albums that look like parts of one release — the same title without disc or edition markers, by the same lead artist — and the part with the most songs to hold them. */
export function splitAlbums(albums: readonly LibAlbum[]): SplitAlbum[] {
  const groups = new Map<string, LibAlbum[]>();
  for (const album of albums) {
    const title = baseTitle(album.title);
    if (!title) continue;
    const key = `${spellingKey(leadArtist(album.artist))}|${title}`;
    groups.set(key, [...(groups.get(key) ?? []), album]);
  }
  return [...groups.values()]
    .filter((parts) => parts.length > 1)
    .map((parts) => {
      const into = [...parts].sort((a, b) => b.tracks.length - a.tracks.length || a.title.length - b.title.length)[0];
      return { parts: parts.filter((p) => p !== into), into };
    });
}

/** Songs on this computer more than once: their versions come in playback order, so the first file is the one that plays. */
export function spareCopies(tracks: readonly Track[], versionsOf: (t: Track) => Track[]): SpareCopies[] {
  const out: SpareCopies[] = [];
  for (const song of tracks) {
    const files = versionsOf(song).filter((v) => !!v.localPath);
    if (files.length > 1) out.push({ song, keep: files[0], spare: files.slice(1) });
  }
  return out;
}

export function missingDetails(albums: readonly LibAlbum[]): MissingDetails {
  return {
    cover: albums.filter((a) => !a.thumb),
    year: albums.filter((a) => !a.year),
    genre: albums.filter((a) => !a.tracks.some((t) => t.genre?.trim())),
  };
}
