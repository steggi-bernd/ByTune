/**
 * A cover's colour without decoding its image: Jellyfin lists a BlurHash for
 * each cover, and the hash's first component is the picture's average colour.
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

export type Rgb = [number, number, number];

export function blurhashColor(hash: string | undefined): Rgb | null {
  if (!hash || hash.length < 6) return null;
  let value = 0;
  for (const ch of hash.slice(2, 6)) {
    const digit = DIGITS.indexOf(ch);
    if (digit < 0) return null;
    value = value * 83 + digit;
  }
  return [value >> 16, (value >> 8) & 255, value & 255];
}

const NEUTRAL: Rgb = [58, 58, 64];

/** The colour no brighter than `luma` (0–1), so white text stays readable on it. */
export function tinted(rgb: Rgb | null, luma: number): string {
  const [r, g, b] = rgb ?? NEUTRAL;
  const own = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const k = own > luma ? luma / own : 1;
  return `rgb(${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)})`;
}

/** The same colour with nothing of it showing: what a fade ends in without passing through grey. */
export const seeThrough = (rgb: string): string => rgb.replace("rgb(", "rgba(").replace(")", ", 0)");
