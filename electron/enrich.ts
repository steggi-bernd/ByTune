/**
 * Background enrichment of the local library: files whose tags carry no
 * cover (or no album) get one from the open databases (see metadata.ts).
 *
 * Work is grouped per album — one MusicBrainz lookup and one cover download
 * serve every track on it — and runs one album at a time, so the paced
 * MusicBrainz queue is never flooded. Fills are written in small batches and
 * each batch is pushed to the renderer, so covers appear while the pass runs.
 */
import * as locallib from "./local-library";
import { downloadCover, lookupRecording, lookupRelease, type ReleaseMeta } from "./metadata";
import type { LocalLibrary, LocalTrack } from "./local-library";

type Fill = { art?: string; album?: string };

let running: Promise<void> | null = null;
let rerun = false;

function needsWork(t: LocalTrack): boolean {
  return !t.art || !t.album || t.album === "Unknown album";
}

async function coverFor(rel: ReleaseMeta, key: string): Promise<string | undefined> {
  if (!rel.coverUrl) return undefined;
  const pic = await downloadCover(rel.coverUrl);
  return pic ? locallib.storeFetchedArt(key, pic) : undefined;
}

async function pass(onUpdate: (lib: LocalLibrary) => void): Promise<void> {
  const tracks = locallib.readLocalLibrary().tracks.filter(needsWork);
  if (!tracks.length) return;

  // Tracks with a known album share one lookup; album-less tracks are
  // resolved one by one through their recording.
  const byAlbum = new Map<string, LocalTrack[]>();
  const loose: LocalTrack[] = [];
  for (const t of tracks) {
    if (t.album && t.album !== "Unknown album") {
      const key = `${t.artist.toLowerCase()}|${t.album.toLowerCase()}`;
      byAlbum.set(key, [...(byAlbum.get(key) ?? []), t]);
    } else {
      loose.push(t);
    }
  }

  let fills = new Map<string, Fill>();
  const flush = async (): Promise<void> => {
    if (!fills.size) return;
    const batch = fills;
    fills = new Map();
    onUpdate(await locallib.applyTrackFills(batch));
  };

  for (const [key, group] of byAlbum) {
    const first = group[0];
    const rel = await lookupRelease(first.artist, first.album).catch(() => null);
    if (!rel) continue;
    const art = group.some((t) => !t.art) ? await coverFor(rel, rel.releaseGroupId || key) : undefined;
    if (!art) continue;
    for (const t of group) fills.set(t.id, { art });
    if (fills.size >= 25) await flush();
  }

  for (const t of loose) {
    const rel = await lookupRecording(t.title, t.artist, t.duration).catch(() => null);
    if (!rel) continue;
    const art = !t.art ? await coverFor(rel, rel.releaseGroupId || `${t.artist}|${rel.title}`.toLowerCase()) : undefined;
    fills.set(t.id, { album: rel.title, art });
    if (fills.size >= 25) await flush();
  }
  await flush();
}

/**
 * Start (or queue) an enrichment pass. A call while one is running marks a
 * follow-up pass, so a rescan mid-pass is picked up once the current one ends.
 */
export function enrichLocalLibrary(onUpdate: (lib: LocalLibrary) => void): void {
  if (running) {
    rerun = true;
    return;
  }
  running = (async () => {
    do {
      rerun = false;
      try {
        await pass(onUpdate);
      } catch (err) {
        console.warn("[bytune] library enrichment stopped:", err instanceof Error ? err.message : err);
      }
    } while (rerun);
  })().finally(() => {
    running = null;
  });
}
