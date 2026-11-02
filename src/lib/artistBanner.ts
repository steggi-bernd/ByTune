/**
 * Which picture the artist page's banner shows: the one blown up least to
 * cover it. Genius's banners are made wide but come at most 1000 px across,
 * some only a strip (1000 × 165); the Wikimedia picture comes at banner size
 * (electron/wikimedia.ts), so on a wide window it is usually the sharp one.
 * The photo stored on this computer (600 px) competes too and stands in when
 * the web pictures can't be reached; the covers come last.
 */
import type { ArtistPicture } from "../../electron/wikimedia";

/** The banner's box, about: the main panel's width and the header's 340 px. */
const BOX = { width: 1400, height: 340 };

/** Genius writes a picture's size into its name: "….1000x562x1.jpg". */
export function geniusSize(url: string): { width: number; height: number } | null {
  const m = /\.(\d{2,5})x(\d{2,5})x\d+\.[a-z]+(?:[?#].*)?$/i.exec(url);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/** How many times a picture is blown up to cover the banner — 1 or less is sharp. */
const blowUp = (p: { width: number; height: number }): number => Math.max(BOX.width / p.width, BOX.height / p.height);

/** Genius's banner is made for the purpose; on a near tie it wins over a cropped photo. */
const MADE_WIDE = 0.85;

export interface BannerSources {
  /** the Wikimedia picture at banner size */
  picture: ArtistPicture | null;
  /** Genius's photo and wide banner */
  genius: { photo: string | null; banner: string | null } | null;
  /** the artist photo stored on this computer (600 px) */
  photo: string | null;
  /** the artist's covers, last */
  covers: (string | null | undefined)[];
}

/** The banner's pictures, best first — the artist's own by sharpness, the covers last; the page shows the first that loads. */
export function bannerCandidates({ picture, genius, photo, covers }: BannerSources): string[] {
  const own: { url: string; score: number }[] = [];
  if (genius?.banner) own.push({ url: genius.banner, score: blowUp(geniusSize(genius.banner) ?? { width: 1000, height: 333 }) * MADE_WIDE });
  if (picture) own.push({ url: picture.url, score: blowUp(picture) });
  if (genius?.photo) own.push({ url: genius.photo, score: blowUp(geniusSize(genius.photo) ?? { width: 1000, height: 1000 }) });
  // Stored 600 px wide; most artist photos stand upright.
  if (photo) own.push({ url: photo, score: blowUp({ width: 600, height: 800 }) });
  own.sort((a, b) => a.score - b.score);
  const all = [...own.map((p) => p.url), ...covers];
  return [...new Set(all.filter((u): u is string => !!u))];
}
