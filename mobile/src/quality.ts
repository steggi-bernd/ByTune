import { T } from "./shared";
/**
 * Which copy of a song to ask the server for: the file itself, or a smaller
 * transcode. Original always takes the file, Compact a small one, and Automatic
 * the best the connection carries right now.
 */
export type QualityMode = "auto" | "original" | "compact";

export type StreamChoice = { kind: "original" } | { kind: "transcode"; kbps: number } | { kind: "download"; compact: boolean };

export const ORIGINAL: StreamChoice = { kind: "original" };
export const COMPACT_KBPS = 128;

/** Jellyfin makes no AAC above 256 kbps, whatever it's asked for. */
const AUTO_KBPS = [256, 192, 128, 64];
/** A connection's estimate comes from bursts; music has to keep flowing through its dips. */
const HEADROOM = 1.5;
/** Over mobile data the file itself would buy nothing you can hear, at five times the data. */
const MOBILE_DATA_KBPS = 320;
/** Songs listed without a bitrate: roughly what a FLAC needs. */
const UNKNOWN_BITRATE_KBPS = 1500;

const ownKbps = (track: { bitrate?: number }): number => (track.bitrate ? track.bitrate / 1000 : UNKNOWN_BITRATE_KBPS);

/** A transcode bigger than the file would only be worse: then it's the file. */
const transcodeOr = (track: { bitrate?: number }, kbps: number): StreamChoice => (ownKbps(track) <= kbps ? ORIGINAL : { kind: "transcode", kbps });

/**
 * `bandwidthBps` is the player's estimate (0 before it has one). `capKbps` is
 * what a connection recently failed to carry, whatever its estimate says.
 * `metered`: the network costs by the byte.
 */
export function chooseStream(track: { bitrate?: number }, mode: QualityMode, bandwidthBps: number, capKbps: number | null, metered = false): StreamChoice {
  if (mode === "original") return ORIGINAL;
  if (mode === "compact") return transcodeOr(track, COMPACT_KBPS);
  let limit = bandwidthBps > 0 ? bandwidthBps / 1000 / HEADROOM : Infinity;
  if (capKbps !== null) limit = Math.min(limit, capKbps);
  if (metered) limit = Math.min(limit, MOBILE_DATA_KBPS);
  if (ownKbps(track) <= limit) return ORIGINAL;
  return transcodeOr(track, AUTO_KBPS.find((kbps) => kbps <= limit) ?? AUTO_KBPS[AUTO_KBPS.length - 1]);
}

/** The limit one step below what just failed to play smoothly; null at the bottom already. */
export function stepDown(track: { bitrate?: number }, current: StreamChoice): number | null {
  const now = current.kind === "transcode" ? current.kbps : ownKbps(track);
  return AUTO_KBPS.find((kbps) => kbps < now) ?? null;
}

export const sameChoice = (a: StreamChoice | undefined, b: StreamChoice): boolean =>
  !!a && a.kind === b.kind && (a.kind !== "transcode" || b.kind !== "transcode" || a.kbps === b.kbps);

/** How good what's playing is: lossless on top, then by the bitrate. */
export type QualityTier = "lossless" | "high" | "good" | "low" | "poor";

export function tierOf(lossless: boolean, kbps: number | undefined): QualityTier {
  if (lossless) return "lossless";
  // Nobody said how big: no alarm.
  if (!kbps) return "good";
  if (kbps >= 256) return "high";
  if (kbps >= 160) return "good";
  return kbps >= 96 ? "low" : "poor";
}

/** What plays right now, short enough for the player's bottom row: "FLAC 24/96", "AAC 256 kbps". */
export function playingNow(
  stream: StreamChoice,
  format: { codec: string; lossless: boolean; bits?: number; rate?: number; kbps?: number } | null
): { text: string; tier: QualityTier } | null {
  if (stream.kind === "transcode") return { text: T("AAC {kbps} kbps", { kbps: stream.kbps }), tier: tierOf(false, stream.kbps) };
  if (stream.kind === "download" && stream.compact) return { text: T("MP3 192 kbps"), tier: tierOf(false, 192) };
  if (!format) return null;
  if (format.lossless) {
    const resolution = format.bits && format.rate ? ` ${format.bits}/${format.rate / 1000}` : "";
    return { text: `${format.codec}${resolution}`, tier: "lossless" };
  }
  return { text: format.kbps ? `${format.codec} ${format.kbps} kbps` : format.codec, tier: tierOf(false, format.kbps) };
}

/** Volume leveling, as on Spotify. Jellyfin's gains bring songs to −18 LUFS; Spotify's usual level is −14. */
export type Leveling = "off" | "quiet" | "normal" | "loud";
const LEVEL_LUFS: Record<Exclude<Leveling, "off">, number> = { quiet: -18, normal: -14, loud: -11 };

/** The gain in dB for a song the server measured. It only ever turns down, so nothing clips; undefined leaves the song as it is. */
export function levelGain(trackGainDb: number | undefined, leveling: Leveling): number | undefined {
  if (leveling === "off" || trackGainDb === undefined) return undefined;
  return Math.min(0, trackGainDb + LEVEL_LUFS[leveling] + 18);
}
