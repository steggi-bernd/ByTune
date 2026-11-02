/**
 * Spotify Liked Songs and playlists → ByTune: read an export, find each song
 * in the library, and list what is still missing.
 *
 * The exports understood:
 *  - Exportify's CSV (exportify.net) — titles, artists, album, length and the
 *    date each song was liked, so Spotify's order (newest first) is exact.
 *    Columns are found by name, comma or semicolon separated. A playlist's
 *    CSV keeps the playlist's own order.
 *  - YourLibrary.json from Spotify's own data download — titles, artists and
 *    album, in the file's order (it carries no dates).
 *  - Playlist1.json from the same download — every playlist, each in its
 *    order, the local files in it too (parsePlaylistExport).
 *
 * Matching works on the merged catalogue (one entry per song), with the same
 * folding as the duplicate detection: case, accents, punctuation and
 * "(feat. …)" never matter, nor does a "- Remastered 2011" Spotify appends.
 *  - "match": same title, a shared artist, and the same album or a length
 *    within 10 s
 *  - "check": probably the same song — the title differs beyond that
 *    ("Radio Edit"), the length is off, or the artist is spelled differently
 *    on the same album. The user decides
 *  - "missing": nothing like it in the library — the shopping list
 */
import type { Track } from "../types";
import { foldTag, titleKey } from "./duplicates";
import { splitCredits } from "./libraryTracks";

export interface SpotifyEntry {
  title: string;
  artists: string[];
  album: string;
  durationMs?: number;
  /** when the song was liked (ms) */
  addedAt?: number;
  /** spotify:track:… */
  uri?: string;
}

export interface SpotifyExport {
  entries: SpotifyEntry[];
  /** the export carries like dates, so the order is Spotify's own */
  dated: boolean;
}

export type MatchKind = "match" | "check" | "missing";

export interface ImportRow {
  entry: SpotifyEntry;
  kind: MatchKind;
  /** the library song it matched (match/check) */
  track?: Track;
  /** why a "check" row isn't certain */
  reason?: "title" | "length" | "artist";
  /** the user settled it: confirmed or rejected a check, or picked the song by hand */
  decided?: "same" | "different" | "picked";
}

/** What the user said about one Spotify song — kept by entryKey, so it survives a fresh export. */
export interface ImportDecisions {
  verdicts: Record<string, "same" | "different">;
  /** entryKey → the library song id the user picked by hand */
  picks: Record<string, string>;
}

/** A Spotify song's identity across exports: its URI, else title + artists. */
export function entryKey(e: SpotifyEntry): string {
  return e.uri || `${foldTag(e.title)}|${e.artists.map((a) => foldTag(a)).join(",")}`;
}

/**
 * The matches with the user's word applied: a hand-picked song is a match,
 * "same song" turns a check into a match, "different" makes it missing.
 * Undecided checks stay checks.
 */
export function applyDecisions(rows: ImportRow[], d: ImportDecisions, byId: (id: string) => Track | undefined): ImportRow[] {
  return rows.map((row) => {
    const key = entryKey(row.entry);
    const picked = d.picks[key] ? byId(d.picks[key]) : undefined;
    if (picked) return { ...row, kind: "match", track: picked, decided: "picked" };
    if (row.kind !== "check") return row;
    const verdict = d.verdicts[key];
    if (verdict === "same") return { ...row, kind: "match", decided: "same" };
    if (verdict === "different") return { ...row, kind: "missing", decided: "different" };
    return row;
  });
}

/**
 * What "Add to Liked Songs" lays out, in the export's order (newest like
 * first): every match, plus each song still to check that is liked already —
 * an earlier import or an earlier decision liked it, and while it waits for
 * the user's word it keeps its Spotify place instead of passing for a like
 * made here, which would put it on top. A song still to check that isn't
 * liked stays out until the user decides; a song a match also leads to
 * takes the match's place.
 */
export function importOrder(rows: ImportRow[], likedSongs: ReadonlySet<string>, keyOf: (id: string) => string): Track[] {
  const matched = new Set(rows.filter((r) => r.kind === "match" && r.track).map((r) => keyOf(r.track!.id)));
  return rows
    .filter((r) => {
      if (!r.track) return false;
      if (r.kind === "match") return true;
      const key = keyOf(r.track.id);
      return r.kind === "check" && likedSongs.has(key) && !matched.has(key);
    })
    .map((r) => r.track!);
}

/** More than this many songs is not a Liked Songs export. */
const MAX_ENTRIES = 100_000;

/* ------------------------------------------------------------- parsing */

/** RFC 4180 CSV: quoted fields with commas, quotes ("") and line breaks; "," or ";" separated. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const header = src.slice(0, src.search(/\r?\n/) === -1 ? src.length : src.search(/\r?\n/));
  const sep = (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const endRow = (): void => {
    row.push(field);
    field = "";
    if (row.some((f) => f.trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  endRow();
  return rows;
}

const COLUMN: Record<keyof SpotifyEntry, RegExp> = {
  title: /^(track name|name|title|song|track)$/,
  artists: /^(artist name\(s\)|artist names?|artists?|artist\(s\))$/,
  album: /^(album name|album|album title)$/,
  durationMs: /^(track duration \(ms\)|duration \(ms\)|duration_ms|duration|length)$/,
  addedAt: /^(added at|added|date added|added_at)$/,
  uri: /^(track uri|uri|spotify uri)$/,
};

/** "245000" (ms), "245" (s) or "4:05" → ms. */
function durationMs(v: string | undefined): number | undefined {
  const s = (v ?? "").trim();
  if (/^\d+(:\d{1,2}){1,2}$/.test(s)) {
    return s.split(":").reduce((acc, part) => acc * 60 + Number(part), 0) * 1000;
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n >= 1000 ? n : n * 1000;
}

function fromCsv(text: string): SpotifyEntry[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error("The file is empty.");
  const names = header.map((h) => h.trim().toLowerCase());
  const col = (key: keyof SpotifyEntry): number => names.findIndex((n) => COLUMN[key].test(n));
  const title = col("title");
  const artists = col("artists");
  if (title === -1 || artists === -1) {
    throw new Error("This CSV has no track name and artist columns — export it with Exportify.");
  }
  const album = col("album");
  const duration = col("durationMs");
  const added = col("addedAt");
  const uri = col("uri");
  return rows.slice(0, MAX_ENTRIES).map((r) => {
    const addedAt = added === -1 ? NaN : Date.parse(r[added] ?? "");
    return {
      title: (r[title] ?? "").trim(),
      artists: splitCredits(r[artists] ?? ""),
      album: album === -1 ? "" : (r[album] ?? "").trim(),
      durationMs: duration === -1 ? undefined : durationMs(r[duration]),
      addedAt: Number.isFinite(addedAt) ? addedAt : undefined,
      uri: uri === -1 ? undefined : (r[uri] ?? "").trim() || undefined,
    };
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function fromJson(text: string): SpotifyEntry[] {
  let data: any;
  try {
    data = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new Error("The file is not valid JSON.");
  }
  const items: any[] = Array.isArray(data) ? data : Array.isArray(data?.tracks) ? data.tracks : [];
  if (!items.length) throw new Error("No songs in this file — use YourLibrary.json from Spotify's data download.");
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  return items.slice(0, MAX_ENTRIES).map((it) => ({
    title: str(it?.track) || str(it?.trackName) || str(it?.name),
    artists: splitCredits(str(it?.artist) || str(it?.artistName)),
    album: str(it?.album) || str(it?.albumName),
    durationMs: typeof it?.duration_ms === "number" ? it.duration_ms : undefined,
    uri: str(it?.uri) || undefined,
  }));
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * The songs of an export, newest like first where the export has dates (the
 * file's own order otherwise, and always with `keepOrder` — a playlist's).
 * A song listed twice under one URI counts once.
 */
export function parseSpotifyExport(text: string, fileName: string, opts: { keepOrder?: boolean } = {}): SpotifyExport {
  const json = /\.json$/i.test(fileName) || /^\s*[[{]/.test(text.replace(/^﻿/, ""));
  const seen = new Set<string>();
  const entries = (json ? fromJson(text) : fromCsv(text)).filter((e) => {
    if (!e.title) return false;
    if (!e.uri) return true;
    if (seen.has(e.uri)) return false;
    seen.add(e.uri);
    return true;
  });
  if (!entries.length) throw new Error("No songs found in this file.");
  const dated = !opts.keepOrder && entries.some((e) => e.addedAt);
  if (dated) {
    // Stable: songs without a date keep their place among themselves, after the dated ones.
    entries.sort((a, b) => (b.addedAt ?? -Infinity) - (a.addedAt ?? -Infinity) || 0);
  }
  return { entries, dated };
}

/** A playlist in an export: its name and songs, in its own order. */
export interface SpotifyPlaylist {
  name: string;
  entries: SpotifyEntry[];
}

/** "road_trip_2019.csv" → "Road trip 2019": Exportify names its files after the playlist. */
export function playlistNameOf(fileName: string): string {
  const base = fileName
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/_+/g, " ")
    .trim();
  return base ? base[0].toUpperCase() + base.slice(1) : "Spotify playlist";
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** "spotify:local:Artist:Album:Title:245" — "+" for spaces, the rest URL-encoded. */
function fromLocalUri(uri: string): SpotifyEntry | null {
  const m = /^spotify:local:([^:]*):([^:]*):([^:]*):(\d*)$/.exec(uri);
  if (!m) return null;
  const part = (s: string): string => {
    try {
      return decodeURIComponent(s.replace(/\+/g, " ")).trim();
    } catch {
      return s.trim();
    }
  };
  const title = part(m[3]);
  if (!title) return null;
  return { title, artists: splitCredits(part(m[1])), album: part(m[2]), durationMs: m[4] ? Number(m[4]) * 1000 : undefined, uri };
}

/** One item of a data-download playlist: a song, a local file — a podcast episode is none. */
function fromPlaylistItem(it: any): SpotifyEntry | null {
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const t = it?.track;
  if (t && typeof t === "object") {
    const title = str(t.trackName) || str(t.name);
    if (!title) return null;
    const addedAt = Date.parse(str(it?.addedDate));
    return {
      title,
      artists: splitCredits(str(t.artistName) || str(t.artist)),
      album: str(t.albumName) || str(t.album),
      uri: str(t.trackUri) || str(t.uri) || undefined,
      addedAt: Number.isFinite(addedAt) ? addedAt : undefined,
    };
  }
  return fromLocalUri(str(it?.localTrack?.uri));
}

/**
 * The playlists of an export, each in its own order: every one of Spotify's
 * data download (Playlist1.json), or the one of an Exportify CSV — named
 * after its file. A song listed twice under one URI counts once.
 */
export function parsePlaylistExport(text: string, fileName: string): SpotifyPlaylist[] {
  const clean = text.replace(/^\uFEFF/, "");
  if (/\.json$/i.test(fileName) || /^\s*[[{]/.test(clean)) {
    let data: any;
    try {
      data = JSON.parse(clean);
    } catch {
      throw new Error("The file is not valid JSON.");
    }
    if (Array.isArray(data?.playlists)) {
      const lists = data.playlists
        .slice(0, 10_000)
        .map((p: any): SpotifyPlaylist => {
          const seen = new Set<string>();
          const entries = (Array.isArray(p?.items) ? p.items : [])
            .slice(0, MAX_ENTRIES)
            .map(fromPlaylistItem)
            .filter((e: SpotifyEntry | null): e is SpotifyEntry => !!e && (!e.uri || (!seen.has(e.uri) && !!seen.add(e.uri))));
          return { name: (typeof p?.name === "string" && p.name.trim()) || "Untitled playlist", entries };
        })
        .filter((p: SpotifyPlaylist) => p.entries.length > 0);
      if (!lists.length) throw new Error("No playlist with songs in this file.");
      return lists;
    }
  }
  return [{ name: playlistNameOf(fileName), entries: parseSpotifyExport(text, fileName, { keepOrder: true }).entries }];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * A playlist's songs after an import: what it brings, in Spotify's order,
 * then the songs added in ByTune, after them — one copy of each song
 * (`keyOf` gives a song's key across its copies).
 */
export function mergeImportedPlaylist(current: Track[], incoming: Track[], keyOf: (id: string) => string): Track[] {
  const seen = new Set<string>();
  return [...incoming, ...current].filter((t) => {
    const key = keyOf(t.id);
    return !seen.has(key) && !!seen.add(key);
  });
}

/* ------------------------------------------------------------- matching */

/** "- Remastered 2011", "(2009 Remaster)", "- Digital Remaster" … — Spotify's additions, same recording. */
const REMASTER =
  /\s*(?:-\s*|[([]\s*)(?:\d{4}\s+)?(?:digital(?:ly)?\s+)?remaster(?:ed)?(?:\s+(?:version|edition))?(?:\s+\d{4})?\s*[)\]]?\s*$/i;

const exactTitle = (title: string): string => titleKey(title.replace(REMASTER, ""));

/** The title without any " - …" tail or (…)/[…] part: "Song - Radio Edit" → "song". */
function looseTitle(title: string): string {
  const bare = foldTag(title.replace(/\s+-\s+.*$/, "").replace(/\s*[([][^)\]]*[)\]]/g, ""));
  return bare || exactTitle(title);
}

const artistKey = (name: string): string => foldTag(name).replace(/^the /, "");

export function matchEntries(entries: SpotifyEntry[], library: Track[]): ImportRow[] {
  const byTitle = new Map<string, Track[]>();
  const byLoose = new Map<string, Track[]>();
  const put = (map: Map<string, Track[]>, key: string, t: Track): void => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(t);
    else map.set(key, [t]);
  };
  for (const t of library) {
    put(byTitle, exactTitle(t.title), t);
    put(byLoose, looseTitle(t.title), t);
  }
  const artistsOf = new Map<Track, Set<string>>();
  const libraryArtists = (t: Track): Set<string> => {
    let set = artistsOf.get(t);
    if (!set) {
      set = new Set([...splitCredits(t.artist), ...splitCredits(t.albumArtist ?? "")].map(artistKey).filter(Boolean));
      artistsOf.set(t, set);
    }
    return set;
  };

  return entries.map((entry): ImportRow => {
    const wanted = new Set(entry.artists.map(artistKey).filter(Boolean));
    const sharesArtist = (t: Track): boolean => [...libraryArtists(t)].some((a) => wanted.has(a));
    const album = foldTag(entry.album);
    const sameAlbum = (t: Track): boolean => !!album && foldTag(t.album) === album;
    const secs = entry.durationMs ? entry.durationMs / 1000 : 0;
    const lengthGap = (t: Track): number => (secs && t.duration ? Math.abs(t.duration - secs) : 0);
    const best = (list: Track[]): Track =>
      [...list].sort((a, b) => Number(sameAlbum(b)) - Number(sameAlbum(a)) || lengthGap(a) - lengthGap(b))[0];

    const sameTitle = byTitle.get(exactTitle(entry.title)) ?? [];
    const exact = sameTitle.filter(sharesArtist);
    if (exact.length) {
      const track = best(exact);
      return sameAlbum(track) || lengthGap(track) <= 10
        ? { entry, kind: "match", track }
        : { entry, kind: "check", track, reason: "length" };
    }
    const loose = (byLoose.get(looseTitle(entry.title)) ?? []).filter(sharesArtist);
    if (loose.length) return { entry, kind: "check", track: best(loose), reason: "title" };
    const sameRelease = sameTitle.filter(sameAlbum);
    if (sameRelease.length) return { entry, kind: "check", track: best(sameRelease), reason: "artist" };
    return { entry, kind: "missing" };
  });
}

/* ------------------------------------------------------------- the shopping list */

/** spotify:track:<id> → its open.spotify.com page. */
export function spotifyLink(uri: string | undefined): string {
  const m = /^spotify:track:([A-Za-z0-9]{10,40})$/.exec(uri ?? "");
  return m ? `https://open.spotify.com/track/${m[1]}` : "";
}

const day = (ms: number | undefined): string => (ms ? new Date(ms).toISOString().slice(0, 10) : "");

/**
 * The missing songs as a spreadsheet: ";"-separated with a UTF-8 BOM, which
 * is what Excel opens correctly in German (and most European) settings.
 */
export function shoppingListCsv(entries: SpotifyEntry[]): string {
  const cell = (v: string): string => (/[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [["Title", "Artist", "Album", "Liked on Spotify", "Spotify link"].join(";")];
  for (const e of entries) {
    lines.push([e.title, e.artists.join(", "), e.album, day(e.addedAt), spotifyLink(e.uri)].map(cell).join(";"));
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** The missing songs as plain lines for the clipboard: "Artist – Title (Album)". */
export function shoppingListText(entries: SpotifyEntry[]): string {
  return entries.map((e) => `${e.artists.join(", ")} – ${e.title}${e.album ? ` (${e.album})` : ""}`).join("\n");
}
