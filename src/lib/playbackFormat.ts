/**
 * What the player is actually playing, for the player bar's format line:
 * codec, lossless or not, bit depth and sample rate, hi-res or not — after
 * whatever conversion stands between the file and the speakers:
 *
 *  - local AIFF, ALAC, WMA, WavPack and APE files are converted by FFmpeg to
 *    FLAC, which keeps the music's own resolution; DSD becomes 24-bit PCM at
 *    176.4 kHz (electron/transcode.ts)
 *  - Jellyfin sends the original file where Chromium decodes it, a FLAC
 *    transcode for other lossless formats and 320 kbps MP3 for other lossy
 *    ones (electron/jellyfin-stream.ts)
 *  - Navidrome sends the original file, except AIFF, ALAC, WMA, WavPack, APE
 *    and DSD, which it transcodes to 320 kbps MP3 (electron/subsonic.ts)
 *
 * Hi-Res is lossless above CD resolution: 24 bits, or more than 48 kHz.
 */
import { jellyfinStreamPlan } from "../../electron/jellyfin-stream";
import type { Track } from "../types";

export interface PlaybackFormat {
  /** "FLAC", "MP3", "AAC", "ALAC", "DSD64" … */
  codec: string;
  lossless: boolean;
  hiRes: boolean;
  bits?: number;
  /** Hz */
  rate?: number;
  /** lossy streams: kbps */
  kbps?: number;
  /** a conversion on the way, in words */
  note?: string;
}

type Kind = "flac" | "alac" | "pcm" | "dsd" | "wavpack" | "ape" | "wmalossless" | "opus" | "vorbis" | "aac" | "mp3" | "wma" | "ac3";

const KINDS: [Kind, RegExp, string, boolean][] = [
  ["wmalossless", /wma ?lossless|wmalossless|windows media audio.*lossless/, "WMA Lossless", true],
  ["flac", /flac/, "FLAC", true],
  ["alac", /alac|apple lossless/, "ALAC", true],
  ["dsd", /dsd|\bdsf\b|\bdff\b/, "DSD", true],
  ["wavpack", /wavpack|\bwv\b/, "WavPack", true],
  ["ape", /monkey|\bape\b/, "APE", true],
  ["pcm", /pcm|\bwave?\b|\baiff?\b|\baifc\b/, "PCM", true],
  ["opus", /opus/, "Opus", false],
  ["vorbis", /vorbis|\bogg\b|\boga\b/, "Vorbis", false],
  ["aac", /aac|mp4a|\bm4a\b|\bm4b\b|\bmp4\b/, "AAC", false],
  ["mp3", /mp3|layer ?3|mpeg[ -]?[12]\b/, "MP3", false],
  ["wma", /wma|windows media audio/, "WMA", false],
  ["ac3", /\be?-?ac-?3\b|eac3/, "AC-3", false],
];

function extOf(t: Track): string {
  const name = t.localPath?.split(/[\\/]/).pop() ?? "";
  return name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
}

function identify(t: Track): { kind: Kind; name: string; lossless: boolean } | null {
  const ext = extOf(t);
  const hay = `${t.codec ?? ""} ${t.container ?? ""} ${ext}`.toLowerCase().trim();
  if (!hay) return null;
  for (const [kind, re, name, lossless] of KINDS) {
    if (!re.test(hay)) continue;
    // An .m4a without a named codec that reports a bit depth is ALAC (Navidrome lists only the suffix).
    if (kind === "aac" && !t.codec?.match(/aac/i) && (t.bitsPerSample ?? 0) > 0) return { kind: "alac", name: "ALAC", lossless: true };
    if (kind === "pcm") {
      const container = `${t.container ?? ""} ${ext}`;
      return { kind, name: /aif/i.test(container) ? "AIFF" : /wav/i.test(container) ? "WAV" : "PCM", lossless };
    }
    return { kind, name, lossless };
  }
  return null;
}

/** File types the local player hands to FFmpeg first (electron/transcode.ts). */
const LOCAL_CONVERTED = new Set(["aiff", "aif", "aifc", "wma", "wv", "ape", "dsf", "dff"]);
/** Navidrome suffixes the server transcodes to MP3 (electron/subsonic.ts). */
const SUBSONIC_TRANSCODED = new Set(["aif", "aiff", "aifc", "wma", "wv", "ape", "dsf", "dff", "alac"]);

const isHiRes = (lossless: boolean, bits?: number, rate?: number): boolean =>
  lossless && ((bits ?? 0) >= 24 || (rate ?? 0) > 48000);

export function describePlayback(t: Track): PlaybackFormat | null {
  const id = identify(t);
  if (!id) return null;
  const source = t.source ?? (t.localPath ? "local" : null);
  if (!source) return null;

  if (source === "jellyfin") {
    const plan = jellyfinStreamPlan(t);
    if (plan === "mp3") {
      return { codec: "MP3", lossless: false, hiRes: false, kbps: 320, note: `${id.name} transcoded to MP3 by Jellyfin` };
    }
    if (plan === "flac") {
      if (id.kind === "dsd") return { codec: "DSD", lossless: true, hiRes: true, note: "DSD converted to FLAC by Jellyfin" };
      const bits = t.bitsPerSample;
      return {
        codec: id.name,
        lossless: true,
        hiRes: isHiRes(true, bits, t.sampleRate),
        bits,
        rate: t.sampleRate,
        note: `${id.name} converted to FLAC by Jellyfin — nothing is lost`,
      };
    }
  }
  if (source === "subsonic" && SUBSONIC_TRANSCODED.has((t.container ?? "").toLowerCase())) {
    return { codec: "MP3", lossless: false, hiRes: false, kbps: 320, note: `${id.name} transcoded to MP3 by Navidrome` };
  }

  if (id.kind === "dsd") {
    // DSD64 = 64 × 44.1 kHz at 1 bit; played as 24-bit PCM at 176.4 kHz.
    const multiple = t.sampleRate ? Math.round(t.sampleRate / 44100) : 0;
    const name = multiple >= 64 ? `DSD${multiple}` : "DSD";
    if (source === "local") {
      return { codec: name, lossless: true, hiRes: true, bits: 24, rate: 176400, note: `${name} converted to 24-bit / 176.4 kHz PCM` };
    }
    return { codec: name, lossless: true, hiRes: true };
  }

  const lossless = t.lossless ?? id.lossless;
  const bits = lossless ? t.bitsPerSample : undefined;
  const rate = t.sampleRate;
  const kbps = !lossless && t.bitrate ? Math.round(t.bitrate / 1000) : undefined;
  const ext = extOf(t);
  const converted = source === "local" && (LOCAL_CONVERTED.has(ext) || id.kind === "alac");
  return {
    codec: id.name,
    lossless,
    hiRes: isHiRes(lossless, bits, rate),
    bits,
    rate,
    kbps,
    note: converted ? `converted to FLAC for playback${lossless ? " — nothing is lost" : ""}` : undefined,
  };
}

/** 44100 → "44.1 kHz", 96000 → "96 kHz". */
export function fmtRate(hz: number): string {
  const k = Math.round(hz / 100) / 10;
  return `${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)} kHz`;
}

/** "FLAC 24-bit / 96 kHz", "MP3 320 kbps", "AAC 44.1 kHz". */
export function formatLine(f: PlaybackFormat): string {
  if (f.lossless) {
    const parts = [f.bits ? `${f.bits}-bit` : null, f.rate ? fmtRate(f.rate) : null].filter(Boolean);
    return parts.length ? `${f.codec} ${parts.join(" / ")}` : f.codec;
  }
  if (f.kbps) return `${f.codec} ${f.kbps} kbps`;
  return f.rate ? `${f.codec} ${fmtRate(f.rate)}` : f.codec;
}
