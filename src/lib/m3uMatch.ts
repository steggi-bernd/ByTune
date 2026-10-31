/**
 * Which library song each entry of an M3U file means (lib/playlistFiles.ts):
 * ByTune's own note (the song's id), the file's path, artist and title the
 * way the Spotify import matches them, and last a title only one song has —
 * the closest length deciding when several share it.
 */
import type { Track } from "../types";
import { foldTag } from "./duplicates";
import { splitCredits } from "./libraryTracks";
import type { M3uEntry } from "../../electron/m3u";
import { matchEntries } from "./spotifyImport";

/** Windows paths: one separator, any case. */
const pathKey = (p: string): string => p.replace(/\//g, "\\").toLowerCase();

/** The song for each entry, in order; null where nothing fits. */
export function matchM3u(
  entries: M3uEntry[],
  library: Track[],
  byId: ReadonlyMap<string, Track>,
  primaryOf: (t: Track) => Track
): (Track | null)[] {
  const byPath = new Map<string, Track>();
  for (const t of byId.values()) if (t.localPath) byPath.set(pathKey(t.localPath), t);
  const out = entries.map((e): Track | null => {
    const t = (e.id ? byId.get(e.id) : undefined) ?? (e.path ? byPath.get(pathKey(e.path)) : undefined);
    return t ? primaryOf(t) : null;
  });

  const named = out.map((t, i) => (!t && entries[i].artist && entries[i].title ? i : -1)).filter((i) => i >= 0);
  const rows = matchEntries(
    named.map((i) => ({
      title: entries[i].title ?? "",
      artists: splitCredits(entries[i].artist ?? ""),
      album: "",
      durationMs: entries[i].durationSec ? entries[i].durationSec! * 1000 : undefined,
    })),
    library
  );
  rows.forEach((r, k) => {
    if (r.track && (r.kind === "match" || r.kind === "check")) out[named[k]] = primaryOf(r.track);
  });

  const byTitle = new Map<string, Track[]>();
  for (const t of library) {
    const key = foldTag(t.title);
    byTitle.set(key, [...(byTitle.get(key) ?? []), t]);
  }
  out.forEach((t, i) => {
    const { title, durationSec } = entries[i];
    if (t || !title) return;
    const same = byTitle.get(foldTag(title)) ?? [];
    const pick =
      same.length === 1
        ? same[0]
        : durationSec
          ? same
              .filter((s) => Math.abs(s.duration - durationSec) <= 3)
              .sort((a, b) => Math.abs(a.duration - durationSec) - Math.abs(b.duration - durationSec))[0]
          : undefined;
    if (pick) out[i] = primaryOf(pick);
  });
  return out;
}
