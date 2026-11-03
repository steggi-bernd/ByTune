/** The playing song's lyrics from the server, remembered: what was found once is there without a connection. */
import { useEffect, useState } from "react";
import { fetchLyrics, type LyricLine } from "./jellyfin";
import type { Track } from "./shared";
import { readJson, writeJson } from "./storage";
import { useSession } from "./stores/session";

const known = new Map<string, LyricLine[]>();

const fileOf = (id: string): string => `lyrics-${id.replace(/[^a-zA-Z0-9]/g, "_")}.json`;

async function load(track: Track): Promise<LyricLine[]> {
  const seen = known.get(track.id) ?? (await readJson<LyricLine[]>(fileOf(track.id)));
  if (seen) {
    known.set(track.id, seen);
    return seen;
  }
  const session = useSession.getState().session;
  if (!session) return [];
  const got = await fetchLyrics(session, track);
  // None today can be some tomorrow: only what was found stays.
  if (got.length) {
    known.set(track.id, got);
    writeJson(fileOf(track.id), got);
  }
  return got;
}

/** A song kept on the phone keeps its lyrics too. */
export function keepLyrics(track: Track): void {
  void load(track);
}

export function useLyrics(track: Track | undefined): LyricLine[] {
  const session = useSession((s) => s.session);
  const id = track?.id;
  const [lines, setLines] = useState<LyricLine[]>(() => (id ? known.get(id) ?? [] : []));
  useEffect(() => {
    let alive = true;
    if (!id || !track || !session) {
      setLines([]);
      return;
    }
    const seen = known.get(id);
    if (seen) {
      setLines(seen);
      return;
    }
    setLines([]);
    void load(track).then((got) => {
      if (alive) setLines(got);
    });
    return () => {
      alive = false;
    };
    // The song is what counts, not the object carrying it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, session]);
  return lines;
}

/** The line at this moment; -1 before the first and on lyrics that aren't timed. */
export function currentLine(lines: LyricLine[], positionMs: number): number {
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].at;
    if (start === undefined) return -1;
    if (start <= positionMs) at = i;
    else break;
  }
  return at;
}
