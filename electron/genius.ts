/**
 * What Genius answers, as the song panels show it: which song a search found, its
 * story and credits, an artist's pictures. Pure code: the desktop and the phone
 * share it, each with its own way of asking and keeping the answers.
 */
import { primaryArtist, queryTitle } from "./song-names";

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface SongCredit {
  label: string;
  names: string[];
}

export interface SongInfo {
  source: "Genius";
  /** the song's Genius page — the credit and "read more" link */
  url: string;
  title: string;
  /** the story behind the song, plain text */
  description: string | null;
  /** "April 19, 2013" */
  released: string | null;
  album: string | null;
  /** "Written by" and "Produced by" first, then the detailed credits (guitar, mixing …) */
  credits: SongCredit[];
  /** songs this one samples or interpolates */
  samples: { title: string; artist: string }[];
  recordedAt: string | null;
}

export interface ArtistImages {
  name: string;
  /** square photo */
  photo: string | null;
  /** wide header image (about 16:9) — only when it isn't the photo again */
  banner: string | null;
  url: string | null;
}

const MAX_CREDITS = 14;

/**
 * The User-Agent deliberately claims nothing: Genius sits behind Cloudflare,
 * which challenges a browser-claiming agent whose TLS fingerprint does not
 * back the claim. A plain one is answered; a Chrome one gets a 403 that
 * reads, one layer up, as "no lyrics for this track".
 */
const GENIUS_AGENT = "Songsta";

export function geniusCleanQuery(text: string): string {
  const cleaned = text
    .replace(/[♪♫★☆【】《》「」~_]/g, " ")
    .replace(
      /\s*[(\[]\s*(?:from|feat\.?|ft\.?|featuring|with|prod\.?|produced by|official|lyrical|video|audio|remix|music video|visualizer|mv|hd|4k|hq|full song)[^)\]]*[)\]]/gi,
      " "
    )
    .replace(
      /\s*\b(?:official\s+(?:music\s+)?(?:video|audio)|lyrical(?:\s+video)?|full\s+song|4k\s+video|hd\s+video|music\s+video)\b/gi,
      " "
    )
    .replace(/\b(?:prod(?:uced)?\.?(?:\s+by)?)\s+.*$/i, "")
    .split(" | ")[0]
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || text.trim();
}

export function geniusBestMatch(
  candidates: { id?: unknown; url?: unknown; path?: unknown; title?: unknown; artistNames?: unknown }[],
  title: string,
  artist: string
): { id: number; url: string } | null {
  const normTitle = title.toLowerCase();
  const normArtist = artist.toLowerCase();
  let best: { id: number; url: string } | null = null;
  let bestScore = 0;
  for (const item of candidates) {
    const t = String(item.title ?? "").toLowerCase();
    const a = String(item.artistNames ?? "").toLowerCase();
    const titleMatches = !!normTitle && (t === normTitle || t.includes(normTitle) || normTitle.includes(t));
    const artistMatches = !!normArtist && (a === normArtist || a.includes(normArtist) || normArtist.includes(a));
    if (!titleMatches && !artistMatches) continue;
    let score = 0;
    if (t === normTitle) score += 50;
    else if (titleMatches) score += 25;
    if (artistMatches) score += a === normArtist ? 40 : 20;
    // Penalize translations, instrumentals and album pages unless asked for.
    const path = String(item.path ?? "").toLowerCase();
    if (path.includes("translation") && !normTitle.includes("translation")) score -= 30;
    if (path.includes("türkçe") || path.includes("polskie-tlumaczenie")) score -= 40;
    if (path.includes("tracklist") || path.includes("album-art")) score -= 50;
    if (score > bestScore && typeof item.url === "string") {
      bestScore = score;
      best = { id: Number(item.id) || 0, url: item.url };
    }
  }
  return bestScore > 0 ? best : null;
}

export const GENIUS_HEADERS = {
  "User-Agent": GENIUS_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/**
 * The song's Genius page (id + url) — the search's best hit; null when Genius
 * answered without one, undefined when it didn't answer at all (offline).
 */
export async function geniusFindWith(
  songTitle: string,
  songArtist: string,
  getBody: (url: string) => Promise<string | null>
): Promise<{ id: number; url: string } | null | undefined> {
  const artist = primaryArtist(songArtist || "");
  const title = queryTitle(songTitle);
  if (!title) return null;
  const cleanTitle2 = geniusCleanQuery(title);
  const attempts: { query: string; title: string; artist: string }[] = [];
  const push = (query: string, t: string, a: string): void => {
    query = query.trim();
    if (query && !attempts.some((x) => x.query === query)) attempts.push({ query, title: t, artist: a });
  };
  if (artist) {
    push(`${artist} ${title}`, title, artist);
    if (cleanTitle2.toLowerCase() !== title.toLowerCase()) {
      push(`${artist} ${cleanTitle2}`, cleanTitle2, artist);
    }
  }
  push(cleanTitle2 || title, cleanTitle2 || title, artist);

  let answered = false;
  for (const attempt of attempts) {
    const body = await getBody(`https://genius.com/api/search/multi?q=${encodeURIComponent(attempt.query)}`);
    if (!body) continue;
    answered = true;
    try {
      const sections = JSON.parse(body)?.response?.sections;
      if (!Array.isArray(sections)) continue;
      const songSection = sections.find((s: any) => s?.type === "song");
      const hits: any[] = songSection?.hits ?? [];
      const candidates = hits
        .map((h) => h?.result)
        .filter(Boolean)
        .map((r) => ({ id: r.id, url: r.url, path: r.path, title: r.title, artistNames: r.artist_names }));
      const best = geniusBestMatch(candidates, attempt.title, attempt.artist);
      if (best) return best;
    } catch {
      /* next attempt */
    }
  }
  return answered ? null : undefined;
}

/** Case, accents and punctuation aside — any script, not only Latin. */
const nameKey = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export function sameName(a: string, b: string): boolean {
  const x = nameKey(a);
  return !!x && x === nameKey(b);
}

/**
 * A search's best hit may only share the title. What the panels tell about a song
 * has to be about this artist's song: a feature counts, another band doesn't.
 */
export function songIsBy(s: any, artist: string): boolean {
  const credited = nameKey(String(s?.artist_names ?? s?.primary_artist?.name ?? ""));
  const asked = nameKey(artist);
  return !credited || !asked || credited.includes(asked) || asked.includes(credited);
}

/** Genius's stand-in pictures ("default_avatar", "default_cover", "default_banner") are no picture. */
export function picture(url: unknown): string | null {
  return typeof url === "string" && /^https:\/\//.test(url) && !/default_(avatar|cover|banner)/i.test(url) ? url : null;
}

const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

function names(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map((a: any) => text(a?.name, 80))
    .filter((n): n is string => !!n)
    .slice(0, 12);
}

/** A song object from /api/songs/:id as the panel shows it. */
export function songFromGenius(s: any, fallbackUrl: string): SongInfo | null {
  if (!s || typeof s !== "object") return null;
  const credits: SongCredit[] = [];
  const writers = names(s.writer_artists);
  if (writers.length) credits.push({ label: "Written by", names: writers });
  const producers = names(s.producer_artists);
  if (producers.length) credits.push({ label: "Produced by", names: producers });
  for (const p of Array.isArray(s.custom_performances) ? s.custom_performances : []) {
    if (credits.length >= MAX_CREDITS) break;
    const label = text(p?.label, 60);
    const who = names(p?.artists);
    if (label && who.length) credits.push({ label, names: who });
  }
  const samples = (Array.isArray(s.song_relationships) ? s.song_relationships : [])
    .filter((r: any) => r?.relationship_type === "samples" || r?.relationship_type === "interpolates")
    .flatMap((r: any) => (Array.isArray(r.songs) ? r.songs : []))
    .map((x: any) => ({ title: text(x?.title, 120) ?? "", artist: text(x?.artist_names, 120) ?? text(x?.primary_artist?.name, 120) ?? "" }))
    .filter((x: { title: string }) => x.title)
    .slice(0, 6);
  // A song without a story reads "?" on Genius.
  const description = text(s.description?.plain, 4000);
  return {
    source: "Genius",
    url: text(s.url, 400) ?? fallbackUrl,
    title: text(s.title, 200) ?? "",
    description: description && description !== "?" ? description : null,
    released: text(s.release_date_for_display, 60),
    album: text(s.album?.name, 200),
    credits,
    samples,
    recordedAt: text(s.recording_location, 200),
  };
}

/** The artist search's hit of exactly this name, as photo and banner. */
export function artistFromGenius(sections: unknown, name: string): ArtistImages | null {
  const section = Array.isArray(sections) ? sections.find((s: any) => s?.type === "artist") : null;
  const hit = (Array.isArray(section?.hits) ? section.hits : []).map((h: any) => h?.result).find((r: any) => r && sameName(String(r.name ?? ""), name));
  if (!hit) return null;
  const photo = picture(hit.image_url);
  const banner = picture(hit.header_image_url);
  if (!photo && !banner) return null;
  return { name: text(hit.name, 200) ?? name, photo, banner: banner && banner !== photo ? banner : null, url: text(hit.url, 400) };
}
