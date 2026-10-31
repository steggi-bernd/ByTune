/**
 * M3U / M3U8 playlists — the one format every player reads (foobar2000,
 * VLC, Winamp, Jellyfin, phone players).
 *
 * Writing: "#EXTINF:<seconds>,<artist> - <title>" and the file's path for
 * every song that has a file on this computer. A song that lives only on a
 * server gets a "#BYTUNE:{…}" note instead — other players skip it as a
 * comment, ByTune reads it back — so no stream address (and no server
 * token) ever ends up in the file.
 *
 * Reading: paths, file:// URLs and the #EXTINF names; an entry without one
 * falls back to its file name ("01 - Artist - Title.flac").
 */

export interface M3uEntry {
  /** absolute path or URL; "" for a ByTune note */
  path: string;
  title?: string;
  artist?: string;
  durationSec?: number;
  /** a ByTune note's song id (a server song) */
  id?: string;
}

export interface M3uSong {
  id: string;
  title: string;
  artist: string;
  duration: number;
  localPath?: string;
}

const NOTE = "#BYTUNE:";
/** Far more than any playlist: guards against reading something that isn't one. */
export const MAX_M3U_ENTRIES = 20_000;

function nameParts(display: string): { title?: string; artist?: string } {
  const text = display.trim();
  const at = text.indexOf(" - ");
  if (at > 0) return { artist: text.slice(0, at).trim(), title: text.slice(at + 3).trim() || undefined };
  return text ? { title: text } : {};
}

/** "C:\Music\01 - Black Pumas - Colors.flac" → artist "Black Pumas", title "Colors". */
export function guessFromPath(p: string): { title?: string; artist?: string } {
  const base = (p.split(/[\\/]/).pop() ?? "").replace(/\.[a-z0-9]{1,5}$/i, "");
  return nameParts(base.replace(/^\d{1,3}(-\d{1,3})?[\s.\-_]+/, ""));
}

export function parseM3u(text: string): M3uEntry[] {
  const out: M3uEntry[] = [];
  let info: Omit<M3uEntry, "path"> | null = null;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (out.length >= MAX_M3U_ENTRIES) break;
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith(NOTE)) {
      try {
        const n = JSON.parse(line.slice(NOTE.length));
        if (typeof n?.title === "string" && n.title) {
          out.push({
            path: "",
            id: typeof n.id === "string" ? n.id : undefined,
            title: n.title,
            artist: typeof n.artist === "string" ? n.artist : undefined,
            durationSec: Number(n.duration) > 0 ? Number(n.duration) : undefined,
          });
        }
      } catch {
        /* not one of ours after all */
      }
      info = null;
      continue;
    }
    const ext = /^#EXTINF:\s*(-?[\d.]+)[^,]*,(.*)$/i.exec(line);
    if (ext) {
      const secs = Number(ext[1]);
      info = { ...nameParts(ext[2]), durationSec: secs > 0 ? Math.round(secs) : undefined };
      continue;
    }
    if (line.startsWith("#")) continue; // #EXTM3U, #PLAYLIST and every other directive or comment
    out.push({ path: line, ...(info ?? guessFromPath(line)) });
    info = null;
  }
  return out;
}

export function writeM3u(songs: M3uSong[]): { text: string; files: number; notes: number } {
  const lines = ["#EXTM3U"];
  let files = 0;
  let notes = 0;
  for (const s of songs) {
    const display = `${s.artist} - ${s.title}`.replace(/[\r\n]+/g, " ");
    if (s.localPath) {
      lines.push(`#EXTINF:${Math.round(s.duration) || -1},${display}`, s.localPath);
      files++;
    } else {
      lines.push(`${NOTE}${JSON.stringify({ id: s.id, title: s.title, artist: s.artist, duration: Math.round(s.duration) })}`);
      notes++;
    }
  }
  return { text: `${lines.join("\n")}\n`, files, notes };
}
