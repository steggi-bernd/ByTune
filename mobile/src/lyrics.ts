/** The playing song's lyrics from the server, remembered for the app's lifetime. */
import { useEffect, useState } from "react";
import { fetchLyrics, type LyricLine } from "./jellyfin";
import type { Track } from "./shared";
import { useSession } from "./stores/session";

const known = new Map<string, LyricLine[]>();

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
    void fetchLyrics(session, track).then((got) => {
      known.set(id, got);
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
