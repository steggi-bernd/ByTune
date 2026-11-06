/**
 * What a library song's credits and addresses mean, shared by the desktop
 * renderer and the phone app: pure, no bridge and no store.
 */
import type { Track } from "../types";

/* ------------------------------------------------------------- credits */

/**
 * Separators that always mean "more than one artist": a comma (Jellyfin
 * itself joins several artists with ", "), a semicolon, " / " and
 * feat./ft./featuring. "&" stays inside a name ("Simon & Garfunkel",
 * "Sailor & I" are one artist each).
 */
const CREDIT_SPLIT = /\s*(?:,|;|\s\/\s| feat\.? | ft\.? | featuring )\s*/i;

/**
 * Artists whose comma is part of the name, not a list — splitting them would
 * invent artists that don't exist.
 */
const COMMA_NAMES = [
  "earth, wind & fire",
  "crosby, stills & nash",
  "crosby, stills, nash & young",
  "emerson, lake & palmer",
  "tyler, the creator",
  "peter, paul and mary",
  "blood, sweat & tears",
  "the good, the bad & the queen",
];

/** Hides the commas inside COMMA_NAMES (same length, so offsets hold) until the parts are split. */
const KEPT_COMMA = "\u0000";
function protectNames(artist: string): string {
  let out = artist;
  const lower = artist.toLowerCase();
  for (const name of COMMA_NAMES) {
    for (let at = lower.indexOf(name); at !== -1; at = lower.indexOf(name, at + name.length)) {
      out = out.slice(0, at) + out.slice(at, at + name.length).replace(/,/g, KEPT_COMMA) + out.slice(at + name.length);
    }
  }
  return out;
}
const restoreNames = (part: string): string => part.split(KEPT_COMMA).join(",");

/** The credited artists of a credit line, in order: "A, B feat. C" → A, B, C. */
export function splitCredits(artist: string): string[] {
  return protectNames(artist)
    .split(CREDIT_SPLIT)
    .map((p) => restoreNames(p).trim())
    .filter(Boolean);
}

/** The first credited artist: "A, B" / "A feat. B" / "A; B" / "A / B" → "A". */
export function leadArtist(artist: string): string {
  return splitCredits(artist)[0] || artist.trim();
}

/**
 * A credit line split like splitCredits(), separators kept for display:
 * "A, B feat. C" → A ", " B " feat. " C — each name links to its own page.
 */
export function creditParts(artist: string): { name: string; sep: string }[] {
  const pieces = protectNames(artist).split(new RegExp(`(${CREDIT_SPLIT.source})`, "i"));
  const parts: { name: string; sep: string }[] = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const name = restoreNames(pieces[i] ?? "").trim();
    const raw = pieces[i + 1] ?? "";
    const sep = !raw ? "" : /[,;]/.test(raw) ? ", " : /\//.test(raw) ? " / " : ` ${raw.trim()} `;
    if (name) parts.push({ name, sep });
    else if (parts.length) parts[parts.length - 1].sep = sep || parts[parts.length - 1].sep;
  }
  if (parts.length) parts[parts.length - 1].sep = "";
  return parts.length ? parts : [{ name: artist.trim(), sep: "" }];
}

/** Every name a track can be found under on an artist page (its artists and album artists, "&" pairs too). */
export function creditedArtists(t: Pick<Track, "artist" | "albumArtist">): string[] {
  const names = new Set<string>();
  const add = (n: string | undefined): void => {
    const v = n?.trim();
    if (v && v.toLowerCase() !== "unknown artist") names.add(v.toLowerCase());
  };
  for (const line of [t.artist, t.albumArtist ?? ""]) {
    add(line);
    for (const name of splitCredits(line)) add(name);
    for (const part of protectNames(line).split(/\s*(?:,|;|\s\/\s|&| feat\.? | ft\.? | featuring | x )\s*/i)) {
      add(restoreNames(part));
    }
  }
  return [...names];
}

/* ------------------------------------------------------------- routes */

const PLACEHOLDER_ALBUM = "unknown album";

/** Album identity: album artist (or lead artist) + album title. */
export function albumKeyOf(t: Pick<Track, "album" | "albumArtist" | "artist" | "albumTag">): string | null {
  const album = (t.albumTag ?? t.album ?? "").trim();
  if (!album || album.toLowerCase() === PLACEHOLDER_ALBUM) return null;
  const owner = (t.albumArtist || leadArtist(t.artist)).trim().toLowerCase();
  return `${owner}|${album.toLowerCase()}`;
}

export const albumRoute = (key: string): string => `lib:album:${encodeURIComponent(key)}`;
export const artistRoute = (name: string): string => `lib:artist:${encodeURIComponent(name)}`;

export function parseRoute(param: string | undefined, kind: "album" | "artist"): string | null {
  const prefix = `lib:${kind}:`;
  if (!param?.startsWith(prefix)) return null;
  try {
    return decodeURIComponent(param.slice(prefix.length));
  } catch {
    return null;
  }
}

/** Route keys for a freshly built library track. */
export function withRoutes(t: Track): Track {
  const key = albumKeyOf(t);
  const lead = leadArtist(t.artist);
  return {
    ...t,
    albumId: key ? albumRoute(key) : undefined,
    artistId: lead && lead.toLowerCase() !== "unknown artist" ? artistRoute(lead) : undefined,
  };
}

/** Case/accent-insensitive match of every query word against title, artist or album. */
export function matchesQuery(track: Track, query: string): boolean {
  const fold = (s: string): string =>
    s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const hay = fold(`${track.title} ${track.artist} ${track.album ?? ""} ${track.albumArtist ?? ""}`);
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
