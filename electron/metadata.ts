/**
 * Open metadata — every "extra" the player shows about a song, album or
 * artist comes from public databases instead of a streaming catalogue:
 *
 *  - MusicBrainz: release-group / recording / artist identity. Their API
 *    asks for a descriptive User-Agent and at most one request per second,
 *    so every call funnels through one paced queue.
 *  - Cover Art Archive: album covers for MusicBrainz release groups.
 *  - iTunes Search: cover + album fallback when MusicBrainz has no match.
 *  - Wikidata + Wikipedia: the artist's bio, photo (Wikimedia Commons) and
 *    article link, in the app's language with English as the fallback.
 *
 * Answers — misses included — are cached on disk, so a library is looked up
 * once and the panels paint instantly on the next launch.
 */
import { app } from "electron";
import { storeFetchedArt } from "./local-library";
import * as persist from "./persist";
import { BANNER_WIDTH, imageInfoUrl, pictureFromImageInfo, wikimediaFile, type ArtistPicture } from "./wikimedia";

/* eslint-disable @typescript-eslint/no-explicit-any */

const UA = "ByTune-Local/1.0 (https://github.com/rishiteja21/ByTune)";
const CACHE_STORE = "open-metadata";
/** A miss is retried after a week — databases grow, tags get fixed. */
const MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000;

export interface ReleaseMeta {
  /** MusicBrainz release-group id ("" when the answer came from iTunes) */
  releaseGroupId: string;
  title: string;
  artist: string;
  year: string | null;
  /** remote cover URL (Cover Art Archive or iTunes), when one exists */
  coverUrl: string | null;
}

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

/* ------------------------------------------------------------- cache */

interface CacheEntry {
  at: number;
  value: unknown;
}

let cache: Record<string, CacheEntry> | null = null;
let saveTimer: NodeJS.Timeout | null = null;

function cacheMap(): Record<string, CacheEntry> {
  if (!cache) {
    const raw = persist.readData(CACHE_STORE);
    cache = raw && typeof raw === "object" ? (raw as Record<string, CacheEntry>) : {};
  }
  return cache;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const map = cacheMap();
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      keys
        .sort((a, b) => map[a].at - map[b].at)
        .slice(0, keys.length - MAX_ENTRIES)
        .forEach((k) => delete map[k]);
    }
    void persist.writeData(CACHE_STORE, map).catch((err) => console.warn("[bytune] metadata cache save failed:", err));
  }, 2000);
}

/** In-flight lookups are shared, so a burst of renders costs one request. */
const inflight = new Map<string, Promise<unknown>>();

async function cached<T>(key: string, work: () => Promise<T | null>): Promise<T | null> {
  const hit = cacheMap()[key];
  if (hit && (hit.value !== null || Date.now() - hit.at < MISS_TTL_MS)) return hit.value as T | null;
  const running = inflight.get(key);
  if (running) return running as Promise<T | null>;
  // A thrown lookup (rate limit, offline, timeout) is NOT a miss: it answers
  // null for now but is never cached, so the next play asks again.
  const job = work()
    .then((value) => {
      cacheMap()[key] = { at: Date.now(), value };
      scheduleSave();
      return value;
    })
    .catch((err) => {
      console.log(`[bytune][meta] ${key} failed: ${err instanceof Error ? err.message : err}`);
      return null;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/* ------------------------------------------------------------- http */

async function getJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** MusicBrainz allows one request per second per client — keep a margin. */
const MB_SPACING_MS = 1100;
let mbQueue: Promise<unknown> = Promise.resolve();
let mbLast = 0;

function mb(pathAndQuery: string): Promise<any> {
  const run = async (): Promise<unknown> => {
    const wait = mbLast + MB_SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    mbLast = Date.now();
    const sep = pathAndQuery.includes("?") ? "&" : "?";
    const url = `https://musicbrainz.org/ws/2/${pathAndQuery}${sep}fmt=json`;
    try {
      return await getJson(url);
    } catch (err) {
      // 503 = rate limited: back off once, then give up on this lookup.
      if (err instanceof Error && err.message === "HTTP 503") {
        await new Promise((r) => setTimeout(r, 2500));
        mbLast = Date.now();
        return getJson(url);
      }
      throw err;
    }
  };
  const next = mbQueue.catch(() => undefined).then(run);
  mbQueue = next;
  return next as Promise<any>;
}

/* ------------------------------------------------------------- matching */

const PLACEHOLDERS = new Set(["", "unknown artist", "unknown album", "unknown", "various artists"]);

function isPlaceholder(s: string | undefined | null): boolean {
  return PLACEHOLDERS.has((s ?? "").trim().toLowerCase());
}

/** Lowercase, accents and punctuation stripped, edition noise removed. */
function norm(s: string): string {
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

function sameName(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x)));
}

/** First credited artist — "A feat. B", "A, B" and "A & B" all key on A. */
function leadArtist(artist: string): string {
  return artist.split(/,|;| feat\.? | ft\.? | featuring | x | & /i)[0].trim();
}

/** Lucene-safe phrase for MusicBrainz's search syntax. */
function phrase(s: string): string {
  return `"${s.replace(/["\\]/g, " ").trim()}"`;
}

function lang(): string {
  const base = (app.getLocale() || "en").split("-")[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(base) ? base : "en";
}

/* ------------------------------------------------------------- releases */

async function releaseFromMusicBrainz(artist: string, album: string): Promise<ReleaseMeta | null> {
  const q = `releasegroup:${phrase(album)} AND artist:${phrase(leadArtist(artist))}`;
  const res = await mb(`release-group?query=${encodeURIComponent(q)}&limit=5`);
  const groups: any[] = Array.isArray(res?.["release-groups"]) ? res["release-groups"] : [];
  const pick = groups.find((g) => (g.score ?? 0) >= 85 && sameName(g.title ?? "", album));
  if (!pick?.id) return null;
  const credit = Array.isArray(pick["artist-credit"]) ? pick["artist-credit"].map((c: any) => `${c.name ?? ""}${c.joinphrase ?? ""}`).join("") : "";
  // CAA answers 404 when the group has no front cover — check before
  // handing the URL out, so the UI never shows a broken image.
  const coverUrl = `https://coverartarchive.org/release-group/${pick.id}/front-500`;
  const hasCover = await fetch(coverUrl, {
    method: "HEAD",
    headers: { "User-Agent": UA },
    redirect: "follow",
    signal: AbortSignal.timeout(10000),
  })
    .then((r) => r.ok)
    .catch(() => false);
  return {
    releaseGroupId: pick.id,
    title: pick.title ?? album,
    artist: credit || artist,
    year: typeof pick["first-release-date"] === "string" ? pick["first-release-date"].slice(0, 4) || null : null,
    coverUrl: hasCover ? coverUrl : null,
  };
}

async function releaseFromItunes(artist: string, album: string): Promise<ReleaseMeta | null> {
  const term = encodeURIComponent(`${leadArtist(artist)} ${album}`);
  const res = (await getJson(`https://itunes.apple.com/search?term=${term}&entity=album&limit=8`)) as any;
  const results: any[] = Array.isArray(res?.results) ? res.results : [];
  const pick = results.find(
    (r) => sameName(r.collectionName ?? "", album) && sameName(r.artistName ?? "", leadArtist(artist))
  );
  if (!pick) return null;
  const art = typeof pick.artworkUrl100 === "string" ? pick.artworkUrl100.replace(/100x100bb/, "600x600bb") : null;
  return {
    releaseGroupId: "",
    title: pick.collectionName ?? album,
    artist: pick.artistName ?? artist,
    year: typeof pick.releaseDate === "string" ? pick.releaseDate.slice(0, 4) : null,
    coverUrl: art,
  };
}

/** The album a local file belongs to, with a cover when any database has one. */
export function lookupRelease(artist: string, album: string): Promise<ReleaseMeta | null> {
  if (isPlaceholder(artist) || isPlaceholder(album)) return Promise.resolve(null);
  const key = `rel:${norm(leadArtist(artist))}|${norm(album)}`;
  return cached(key, async () => {
    let failure: unknown = null;
    const fromMb = await releaseFromMusicBrainz(artist, album).catch((err) => ((failure = err), null));
    if (fromMb?.coverUrl) return fromMb;
    const fromItunes = await releaseFromItunes(artist, album).catch((err) => ((failure ??= err), null));
    if (fromMb) return { ...fromMb, coverUrl: fromItunes?.coverUrl ?? null };
    // Nothing found while a database was unreachable — retry later, don't cache a miss.
    if (!fromItunes && failure) throw failure;
    return fromItunes;
  });
}

interface ReleaseCandidate {
  title: string;
  rgId: string;
  date: string;
  /** an official studio album (no compilation / live / DJ-mix / remix tag) */
  studio: boolean;
  /** 2 = recording length matches the file, 1 = unknown, 0 = differs */
  length: number;
}

/** Album + cover for a song whose tags carry no album at all. */
export function lookupRecording(title: string, artist: string, durationSec = 0): Promise<ReleaseMeta | null> {
  if (!title.trim() || isPlaceholder(artist)) return Promise.resolve(null);
  const key = `rec:${norm(leadArtist(artist))}|${norm(title)}`;
  return cached(key, async () => {
    // A famous song exists as dozens of recordings, most of them on DJ mixes
    // and "Various Artists" compilations. Ask for official album releases in
    // one wide page, keep only releases credited to the artist themself, and
    // rank: studio album first, then a recording as long as the file, then
    // the earliest date — the album the song "belongs" to.
    const lead = leadArtist(artist);
    const q = `recording:${phrase(title)} AND artist:${phrase(lead)} AND primarytype:album AND status:official`;
    let failure: unknown = null;
    const res = await mb(`recording?query=${encodeURIComponent(q)}&limit=100`).catch((err) => ((failure = err), null));
    const recs: any[] = Array.isArray(res?.recordings) ? res.recordings : [];
    const candidates: ReleaseCandidate[] = [];
    for (const rec of recs) {
      if ((rec.score ?? 0) < 85 || !sameName(rec.title ?? "", title)) continue;
      const length =
        !durationSec || !rec.length ? 1 : Math.abs(rec.length / 1000 - durationSec) <= 5 ? 2 : 0;
      for (const rel of Array.isArray(rec.releases) ? rec.releases : []) {
        if (!rel?.title || (rel.status && rel.status !== "Official")) continue;
        // Releases only carry their own credit when it differs from the
        // recording's — a present credit naming someone else is a compilation.
        const credit = Array.isArray(rel["artist-credit"]) ? rel["artist-credit"].map((c: any) => c.name ?? "").join(" ") : "";
        if (credit && !sameName(credit, lead)) continue;
        const rg = rel["release-group"] ?? {};
        candidates.push({
          title: String(rel.title),
          rgId: String(rg.id ?? ""),
          date: typeof rel.date === "string" && rel.date ? rel.date : "9999",
          studio: rg["primary-type"] === "Album" && !(rg["secondary-types"]?.length > 0),
          length,
        });
      }
    }
    candidates.sort(
      (a, b) => Number(b.studio) - Number(a.studio) || b.length - a.length || a.date.localeCompare(b.date)
    );
    const best = candidates[0];
    if (best) {
      const full = await lookupRelease(artist, best.title);
      return (
        full ?? {
          releaseGroupId: best.rgId,
          title: best.title,
          artist,
          year: best.date !== "9999" ? best.date.slice(0, 4) : null,
          coverUrl: null,
        }
      );
    }
    const term = encodeURIComponent(`${leadArtist(artist)} ${title}`);
    const it = (await getJson(`https://itunes.apple.com/search?term=${term}&entity=song&limit=8`).catch(
      (err) => ((failure ??= err), null)
    )) as any;
    const song = (Array.isArray(it?.results) ? it.results : []).find(
      (r: any) => sameName(r.trackName ?? "", title) && sameName(r.artistName ?? "", lead)
    );
    if (!song?.collectionName) {
      // Nothing found while a database was unreachable — retry later.
      if (failure) throw failure;
      return null;
    }
    return {
      releaseGroupId: "",
      title: String(song.collectionName),
      artist: song.artistName ?? artist,
      year: typeof song.releaseDate === "string" ? song.releaseDate.slice(0, 4) : null,
      coverUrl: typeof song.artworkUrl100 === "string" ? song.artworkUrl100.replace(/100x100bb/, "600x600bb") : null,
    };
  });
}

/** Cover image bytes, size-capped — the caller stores them in the art cache. */
export async function downloadCover(url: string): Promise<{ data: Uint8Array; format: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal, redirect: "follow" });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!buf.length || buf.length > 8 * 1024 * 1024) return null;
    return { data: buf, format: type };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------- artists */

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

async function wikidataEntity(qid: string): Promise<any | null> {
  const res = (await getJson(`https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`)) as any;
  return res?.entities?.[qid] ?? null;
}

async function wikipediaSummary(langCode: string, title: string): Promise<any | null> {
  const url = `https://${langCode}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const res = (await getJson(url)) as any;
  if (!res || res.type === "disambiguation" || !res.extract) return null;
  return res;
}

/** Artist photos are stored at this width: sharp in the 328 px card on 2× screens, ~30–80 KB each. */
const PHOTO_WIDTH = 600;

/**
 * Keep the artist photo on disk (in the cover cache, served as localart://),
 * so the card paints offline and Wikimedia is asked once per artist. A failed
 * download keeps the web URL and is retried on the next lookup.
 */
async function localizeArtistPhoto(key: string, meta: ArtistMeta): Promise<ArtistMeta> {
  if (!meta.image || !/^https?:/i.test(meta.image)) return meta;
  const pic = await downloadCover(meta.image);
  const local = pic ? storeFetchedArt(`artist:${meta.mbid}`, pic) : undefined;
  if (!local) return meta;
  const updated = { ...meta, image: local };
  cacheMap()[key] = { at: Date.now(), value: updated };
  scheduleSave();
  return updated;
}

export async function lookupArtist(name: string): Promise<ArtistMeta | null> {
  const lead = leadArtist(name);
  if (isPlaceholder(lead)) return null;
  const key = `art:${lang()}:${norm(lead)}`;
  const meta = await cached<ArtistMeta>(key, async () => {
    const search = await mb(`artist?query=${encodeURIComponent(`artist:${phrase(lead)}`)}&limit=5`);
    const hits: any[] = Array.isArray(search?.artists) ? search.artists : [];
    const hit = hits.find((a) => (a.score ?? 0) >= 90 && (sameName(a.name ?? "", lead) || (a.aliases ?? []).some((al: any) => sameName(al.name ?? "", lead))));
    if (!hit?.id) return null;
    const full = await mb(`artist/${hit.id}?inc=url-rels+genres`);
    const rels: any[] = Array.isArray(full?.relations) ? full.relations : [];
    const wikidataUrl: string | undefined = rels.find((r) => r.type === "wikidata")?.url?.resource;
    const qid = wikidataUrl?.match(/(Q\d+)$/)?.[1];

    let description: string | null = null;
    let image: string | null = null;
    let wikiUrl: string | null = null;
    if (qid) {
      const entity = await wikidataEntity(qid).catch(() => null);
      const p18 = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (typeof p18 === "string") {
        image = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(p18)}?width=${PHOTO_WIDTH}`;
      }
      for (const code of [...new Set([lang(), "en"])]) {
        const title = entity?.sitelinks?.[`${code}wiki`]?.title;
        if (!title) continue;
        const summary = await wikipediaSummary(code, title).catch(() => null);
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
  });
  // Also upgrades entries cached before photos were stored locally.
  return meta ? localizeArtistPhoto(key, meta) : null;
}

/**
 * The artist's Wikimedia picture at banner size, with its real size
 * (electron/wikimedia.ts): the Wikidata image, else the Wikipedia article's
 * lead image. Kept as a web address, asked only by the artist page — offline
 * it shows the stored 600 px photo instead.
 */
export async function lookupArtistPicture(name: string): Promise<ArtistPicture | null> {
  const meta = await lookupArtist(name);
  if (!meta?.mbid) return null;
  return cached<ArtistPicture>(`pic:${meta.mbid}:${BANNER_WIDTH}`, async () => {
    let qid = meta.wikidata ?? null;
    if (!qid) {
      // Answers cached before the Wikidata item was kept: MusicBrainz names it again.
      const full = await mb(`artist/${meta.mbid}?inc=url-rels`);
      const rels: any[] = Array.isArray(full?.relations) ? full.relations : [];
      const wikidataUrl: string | undefined = rels.find((r) => r.type === "wikidata")?.url?.resource;
      qid = wikidataUrl?.match(/(Q\d+)$/)?.[1] ?? null;
    }
    if (!qid) return null;
    const entity = await wikidataEntity(qid);
    const p18 = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    let source: { host: string; file: string } | null = typeof p18 === "string" ? { host: "commons.wikimedia.org", file: p18 } : null;
    for (const code of source ? [] : [...new Set([lang(), "en"])]) {
      const title = entity?.sitelinks?.[`${code}wiki`]?.title;
      if (!title) continue;
      const summary = await wikipediaSummary(code, title).catch(() => null);
      const lead: unknown = summary?.originalimage?.source ?? summary?.thumbnail?.source;
      source = typeof lead === "string" ? wikimediaFile(lead) : null;
      if (source) break;
    }
    if (!source) return null;
    return pictureFromImageInfo(await getJson(imageInfoUrl(source.host, source.file)));
  });
}
