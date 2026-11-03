/**
 * Which copy of a song to ask the server for: the file itself, or a smaller
 * transcode. Original always takes the file, Compact a small one, and Automatic
 * the best the connection carries right now.
 */
export type QualityMode = "auto" | "original" | "compact";

export type StreamChoice = { kind: "original" } | { kind: "transcode"; kbps: number };

export const ORIGINAL: StreamChoice = { kind: "original" };
export const COMPACT_KBPS = 128;

const AUTO_KBPS = [320, 192, 128, 64];
/** A connection's estimate comes from bursts; music has to keep flowing through its dips. */
const HEADROOM = 1.5;
/** Songs listed without a bitrate: roughly what a FLAC needs. */
const UNKNOWN_BITRATE_KBPS = 1500;

const ownKbps = (track: { bitrate?: number }): number => (track.bitrate ? track.bitrate / 1000 : UNKNOWN_BITRATE_KBPS);

/** A transcode bigger than the file would only be worse: then it's the file. */
const transcodeOr = (track: { bitrate?: number }, kbps: number): StreamChoice => (ownKbps(track) <= kbps ? ORIGINAL : { kind: "transcode", kbps });

/**
 * `bandwidthBps` is the player's estimate (0 before it has one). `capKbps` is
 * what a connection recently failed to carry, whatever its estimate says.
 */
export function chooseStream(track: { bitrate?: number }, mode: QualityMode, bandwidthBps: number, capKbps: number | null): StreamChoice {
  if (mode === "original") return ORIGINAL;
  if (mode === "compact") return transcodeOr(track, COMPACT_KBPS);
  const usable = bandwidthBps > 0 ? bandwidthBps / 1000 / HEADROOM : Infinity;
  const limit = capKbps === null ? usable : Math.min(usable, capKbps);
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
