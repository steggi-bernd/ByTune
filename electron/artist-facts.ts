/**
 * Who an artist is, from the open databases: MusicBrainz for identity and facts,
 * Wikidata for the links, Wikipedia for the bio and the photo. Pure code: the
 * desktop and the phone share it, each with its own way of asking and keeping
 * the answers.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** MusicBrainz asks every client to say who it is. */
export const OPEN_DATA_AGENT = "Songsta/1.0 (https://github.com/steggi-bernd/Songsta)";

export interface ArtistMeta {
  /** MusicBrainz artist id */
  mbid: string;
  name: string;
  /** "Group · Germany · since 1994" — built from the MusicBrainz record */
  facts: string | null;
  /** Wikipedia lead section, plain text */
  description: string | null;
  /** artist photo (Wikimedia Commons / Wikipedia lead image) */
  image: string | null;
  /** the Wikipedia article the bio came from */
  wikiUrl: string | null;
  genres: string[];
  /** the Wikidata item ("Q1234") — answers cached before it was kept lack it */
  wikidata?: string | null;
}

export interface OpenDataAsk {
  /** A MusicBrainz path and query, paced by the caller to one request a second. */
  mb(pathAndQuery: string): Promise<any>;
  json(url: string): Promise<unknown>;
}

/* ------------------------------------------------------------- matching */

const PLACEHOLDERS = new Set(["", "unknown artist", "unknown album", "unknown", "various artists"]);

export function isPlaceholder(s: string | undefined | null): boolean {
  return PLACEHOLDERS.has((s ?? "").trim().toLowerCase());
}

/** Lowercase, accents and punctuation stripped, edition noise removed. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\((?:[^)]*(?:remaster|deluxe|edition|version|expanded|anniversary|bonus)[^)]*)\)/g, "")
    .replace(/\[(?:[^\]]*(?:remaster|deluxe|edition|version|expanded|anniversary|bonus)[^\]]*)\]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function sameName(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x)));
}

/** First credited artist — "A feat. B", "A, B" and "A & B" all key on A. */
export function leadArtist(artist: string): string {
  return artist.split(/,|;| feat\.? | ft\.? | featuring | x | & /i)[0].trim();
}

/** Lucene-safe phrase for MusicBrainz's search syntax. */
export function phrase(s: string): string {
  return `"${s.replace(/["\\]/g, " ").trim()}"`;
}

/* ------------------------------------------------------------- the artist */

const TYPE_LABEL: Record<string, string> = {
  Person: "Artist",
  Group: "Band",
  Orchestra: "Orchestra",
  Choir: "Choir",
  Character: "Character",
};

function artistFacts(a: any): string | null {
  const parts: string[] = [];
  if (a.type && TYPE_LABEL[a.type]) parts.push(TYPE_LABEL[a.type]);
  const area = a.area?.name ?? a.country;
  if (area) parts.push(String(area));
  const begin = typeof a["life-span"]?.begin === "string" ? a["life-span"].begin.slice(0, 4) : "";
  const end = typeof a["life-span"]?.end === "string" ? a["life-span"].end.slice(0, 4) : "";
  if (begin && end) parts.push(`${begin}–${end}`);
  else if (begin) parts.push(`since ${begin}`);
  return parts.length ? parts.join(" · ") : null;
}

export async function wikidataEntity(qid: string, json: OpenDataAsk["json"]): Promise<any | null> {
  const res = (await json(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`)) as any;
  return res?.entities?.[qid] ?? null;
}

export async function wikipediaSummary(langCode: string, title: string, json: OpenDataAsk["json"]): Promise<any | null> {
  const url = `https://${langCode}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const res = (await json(url)) as any;
  if (!res || res.type === "disambiguation" || !res.extract) return null;
  return res;
}

/** Artist photos are stored at this width: sharp in the 328 px card on 2× screens, ~30–80 KB each. */
const PHOTO_WIDTH = 600;

/** The first of `languages` with an article gives the bio. Nothing found is null; no answer at all throws. */
export async function artistFromOpenData(lead: string, languages: string[], ask: OpenDataAsk): Promise<ArtistMeta | null> {
  const search = await ask.mb(`artist?query=${encodeURIComponent(`artist:${phrase(lead)}`)}&limit=5`);
  const hits: any[] = Array.isArray(search?.artists) ? search.artists : [];
  const hit = hits.find((a) => (a.score ?? 0) >= 90 && (sameName(a.name ?? "", lead) || (a.aliases ?? []).some((al: any) => sameName(al.name ?? "", lead))));
  if (!hit?.id) return null;
  const full = await ask.mb(`artist/${hit.id}?inc=url-rels+genres`);
  const rels: any[] = Array.isArray(full?.relations) ? full.relations : [];
  const wikidataUrl: string | undefined = rels.find((r) => r.type === "wikidata")?.url?.resource;
  const qid = wikidataUrl?.match(/(Q\d+)$/)?.[1];

  let description: string | null = null;
  let image: string | null = null;
  let wikiUrl: string | null = null;
  if (qid) {
    const entity = await wikidataEntity(qid, ask.json).catch(() => null);
    const p18 = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (typeof p18 === "string") {
      image = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p18)}?width=${PHOTO_WIDTH}`;
    }
    for (const code of new Set(languages)) {
      const title = entity?.sitelinks?.[`${code}wiki`]?.title;
      if (!title) continue;
      const summary = await wikipediaSummary(code, title, ask.json).catch(() => null);
      if (!summary) continue;
      description = String(summary.extract);
      wikiUrl = summary.content_urls?.desktop?.page ?? null;
      // The lead image's thumbnail, resized — the original can be a multi-MB scan.
      const thumb: string | undefined = summary.thumbnail?.source;
      image = image ?? (thumb ? thumb.replace(/\/\d+px-/, `/${PHOTO_WIDTH}px-`) : summary.originalimage?.source) ?? null;
      break;
    }
  }
  const genres = (Array.isArray(full?.genres) ? full.genres : [])
    .sort((a: any, b: any) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 4)
    .map((g: any) => String(g.name));
  return {
    mbid: hit.id,
    name: full?.name ?? hit.name ?? lead,
    facts: artistFacts(full ?? hit),
    description,
    image,
    wikiUrl,
    genres,
    wikidata: qid ?? null,
  };
}
