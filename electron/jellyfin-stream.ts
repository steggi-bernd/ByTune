/**
 * How Jellyfin hands one item to the player — shared by the main process
 * (which builds the stream request) and the renderer's format line (which
 * says what is playing). Pure, no `electron` imports, like local-paths.ts.
 *
 *  - "static": the original file, untouched — full quality and seekable. For
 *    everything Chromium decodes itself: FLAC, MP3, AAC, Opus, Vorbis, WAV.
 *  - "flac": a server transcode to FLAC for lossless sources Chromium can't
 *    open (ALAC, AIFF, APE, WavPack, DSD, WMA Lossless) — still lossless.
 *  - "mp3": a 320 kbps server transcode for the remaining lossy formats (WMA).
 *
 * Not the universal endpoint: it needs a user, and API-key logins have none —
 * the server answers HTTP 400 for every song.
 */

export type JellyfinStreamPlan = "static" | "flac" | "mp3";

/** Containers Chromium's media stack plays as they are. */
const DIRECT_CONTAINERS = new Set(["flac", "mp3", "m4a", "mp4", "m4b", "aac", "ogg", "oga", "opus", "webm", "webma", "wav"]);
/** Codecs Chromium can't decode, whatever the container says. */
const UNDECODABLE_CODEC = /alac|wma|ape|wavpack|dsd|dst|tta|mlp|truehd|pcm_s\d+be/;
const LOSSLESS_CODEC = /flac|alac|pcm|wavpack|ape|dsd|dst|tta|mlp|truehd|lossless/;
const LOSSLESS_CONTAINER = /aif|ape|wv|dsf|dff|tta/;

export function jellyfinStreamPlan(t: { container?: string; codec?: string } | null | undefined): JellyfinStreamPlan {
  const containers = (t?.container ?? "")
    .toLowerCase()
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const codec = (t?.codec ?? "").toLowerCase();
  // Not listed with media info yet: the original file (most libraries are FLAC/MP3).
  const directContainer = !containers.length || containers.some((c) => DIRECT_CONTAINERS.has(c));
  if (directContainer && !UNDECODABLE_CODEC.test(codec)) return "static";
  return LOSSLESS_CODEC.test(codec) || LOSSLESS_CONTAINER.test(containers.join(" ")) ? "flac" : "mp3";
}
