/**
 * An artist's Wikimedia picture at banner size, with its real size — the
 * artist page weighs it against Genius's banner, which is at most 1000 px
 * wide (src/lib/artistBanner.ts). The helpers here only build and read the
 * Commons/Wikipedia image-info requests; electron/metadata.ts asks them.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A picture with its pixel size. */
export interface ArtistPicture {
  url: string;
  width: number;
  height: number;
}

/** The banner's picture is asked this wide: sharp across a maximized window on a 1.25× screen. */
export const BANNER_WIDTH = 1920;

/**
 * The wiki and file name of an upload.wikimedia.org address — the original
 * (".../wikipedia/commons/a/ab/Name.jpg") or a thumbnail of it
 * (".../wikipedia/en/thumb/a/ab/Name.jpg/320px-Name.jpg"). Files on Commons
 * are asked of Commons, files a Wikipedia keeps itself of that Wikipedia.
 */
export function wikimediaFile(url: string): { host: string; file: string } | null {
  const m = /^https:\/\/upload\.wikimedia\.org\/wikipedia\/([a-z-]+)\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i.exec(url);
  if (!m) return null;
  let file: string;
  try {
    file = decodeURIComponent(m[2]);
  } catch {
    return null;
  }
  const wiki = m[1].toLowerCase();
  return { host: wiki === "commons" ? "commons.wikimedia.org" : `${wiki}.wikipedia.org`, file };
}

/** The image-info request for a file, scaled to the banner's width (never up: a smaller original comes as it is). */
export function imageInfoUrl(host: string, file: string, width = BANNER_WIDTH): string {
  const title = `File:${file.replace(/^File:/i, "")}`;
  return `https://${host}/w/api.php?action=query&format=json&formatversion=2&prop=imageinfo&iiprop=size%7Curl&iiurlwidth=${width}&titles=${encodeURIComponent(title)}`;
}

/** The picture an image-info answer describes: the scaled copy where there is one, else the original. */
export function pictureFromImageInfo(json: unknown): ArtistPicture | null {
  const pages = (json as any)?.query?.pages;
  const page = Array.isArray(pages) ? pages[0] : pages && typeof pages === "object" ? Object.values(pages)[0] : null;
  const ii = (page as any)?.imageinfo?.[0];
  if (!ii) return null;
  const scaled = typeof ii.thumburl === "string" && Number(ii.thumbwidth) > 0 && Number(ii.thumbheight) > 0;
  const url = scaled ? ii.thumburl : ii.url;
  const width = Number(scaled ? ii.thumbwidth : ii.width);
  const height = Number(scaled ? ii.thumbheight : ii.height);
  if (typeof url !== "string" || !/^https:\/\//.test(url) || !(width > 0) || !(height > 0)) return null;
  return { url, width: Math.round(width), height: Math.round(height) };
}
