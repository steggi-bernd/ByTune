import { T } from "./i18n";
/**
 * Parametric EQ profiles: the shape the player runs (audio.ts) and the
 * Equalizer APO text format AutoEQ publishes ("ParametricEQ.txt"), which is
 * also what people export from other EQ tools:
 *
 *   Preamp: -6.1 dB
 *   Filter 1: ON LSC Fc 105 Hz Gain 6.4 dB Q 0.70
 *   Filter 2: ON PK Fc 8800 Hz Gain 5.1 dB Q 1.42
 */

export type PeqType = "peaking" | "lowshelf" | "highshelf" | "lowpass" | "highpass";

export interface PeqBand {
  type: PeqType;
  /** Hz */
  freq: number;
  /** dB (ignored by low/high-pass) */
  gain: number;
  q: number;
}

export interface ParametricEq {
  name: string;
  /** dB, applied before the bands — AutoEQ sets it to keep boosts from clipping */
  preamp: number;
  bands: PeqBand[];
}

export const FLAT_PEQ: ParametricEq = { name: T("Flat"), preamp: 0, bands: [] };

export const PEQ_TYPE_LABEL: Record<PeqType, string> = {
  peaking: T("Peak"),
  lowshelf: T("Low shelf"),
  highshelf: T("High shelf"),
  lowpass: "Low-pass",
  highpass: "High-pass",
};

const APO_TYPES: Record<string, PeqType> = {
  PK: "peaking",
  PEQ: "peaking",
  LS: "lowshelf",
  LSC: "lowshelf",
  HS: "highshelf",
  HSC: "highshelf",
  LP: "lowpass",
  LPQ: "lowpass",
  HP: "highpass",
  HPQ: "highpass",
};

const clampNum = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Equalizer APO / AutoEQ text → profile (unknown or switched-off filters are skipped). */
export function parseParametricEq(text: string, name: string): ParametricEq | null {
  let preamp = 0;
  const bands: PeqBand[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const pre = /^Preamp:\s*(-?[\d.]+)\s*dB/i.exec(line);
    if (pre) {
      preamp = clampNum(Number(pre[1]), -30, 30);
      continue;
    }
    const f = /^Filter\s*\d*:\s*(ON|OFF)\s+([A-Z]+)\s+Fc\s+([\d.]+)\s*Hz(?:\s+Gain\s+(-?[\d.]+)\s*dB)?(?:\s+Q\s+([\d.]+))?/i.exec(line);
    if (!f || f[1].toUpperCase() !== "ON") continue;
    const type = APO_TYPES[f[2].toUpperCase()];
    if (!type) continue;
    bands.push({
      type,
      freq: clampNum(Number(f[3]), 10, 22000),
      gain: clampNum(Number(f[4] ?? 0), -30, 30),
      q: clampNum(Number(f[5] ?? 0.707), 0.1, 30),
    });
  }
  return bands.length ? { name, preamp, bands } : null;
}
