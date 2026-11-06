/**
 * LRC files and what a lyrics view shows of them, for the computer and the phone alike.
 *
 * One line can carry several stamps, `[00:10.00][01:20.50]Chorus`, for a chorus that comes back;
 * stamps come with or without a fraction; and an `[offset:…]` header moves the whole file.
 */

export interface LrcRow {
  /** ms from the song's start */
  at: number;
  /** what follows the stamps, word stamps included */
  rest: string;
}

const STAMP = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?]/;
const OFFSET = /^\[offset:\s*([+-]?\d+)\s*]/i;

export function lrcRows(text: string): LrcRow[] {
  let offset = 0;
  const rows: LrcRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    const moved = OFFSET.exec(line);
    if (moved) {
      offset = Number(moved[1]);
      continue;
    }
    const stamps: number[] = [];
    for (let m = STAMP.exec(line); m; m = STAMP.exec(line)) {
      stamps.push((Number(m[1]) * 60 + Number(m[2])) * 1000 + Number((m[3] ?? "").padEnd(3, "0")));
      line = line.slice(m[0].length);
    }
    for (const at of stamps) rows.push({ at, rest: line.trim() });
  }
  // A positive offset means the words come sooner. Sort keeps equal stamps in file order.
  return rows.map((r) => ({ at: Math.max(0, r.at - offset), rest: r.rest })).sort((a, b) => a.at - b.at);
}

/** "[Chorus]": says where the song is, nobody sings it. */
const SECTION_MARK = /^\[[^\]]*]$/;
/** "(Written by someone)": a whole line in parentheses before anybody sings. */
const WRAPPED = /^\([^)]*\)$/;
/** "Artist - Title" or "Lyrics: someone", the way catalogues start a file at 0:00. */
const CREDIT_AT_ZERO = /\s[-–—]\s|[:：]/;

/**
 * What a view shows, in the song's order. Only what nobody sings goes: section marks anywhere,
 * credits at the very top. A line in parentheses in the middle of a song is a backing vocal, and a
 * line at 0:00 can be the song's real first line.
 */
export function sungLines<L extends { text: string; gap?: boolean }>(lines: readonly L[], timeOf: (line: L) => number | undefined): L[] {
  // Without stamps it's text to read, stanza breaks and all.
  if (!lines.every((l) => timeOf(l) !== undefined)) return [...lines];
  const inOrder = [...lines].sort((a, b) => (timeOf(a) as number) - (timeOf(b) as number));
  let sung = false;
  return inOrder.filter((line) => {
    if (line.gap) return true;
    const text = line.text.trim();
    if (!text || SECTION_MARK.test(text)) return false;
    if (!sung && (WRAPPED.test(text) || (timeOf(line) === 0 && CREDIT_AT_ZERO.test(text)))) return false;
    sung = true;
    return true;
  });
}

/**
 * Lyrics kept from before a line's further stamps were read: "[01:20.00]Chorus" sits in the text.
 * `make` builds a line at that many ms.
 */
export function unfoldStamps<L extends { text: string }>(lines: readonly L[], timeOf: (line: L) => number | undefined, make: (at: number, text: string, from: L) => L): L[] {
  if (!lines.some((l) => STAMP.test(l.text))) return [...lines];
  const out: L[] = [];
  for (const line of lines) {
    const rows = STAMP.test(line.text) ? lrcRows(line.text) : [];
    const at = timeOf(line);
    if (!rows.length || at === undefined) {
      out.push(line);
      continue;
    }
    out.push(make(at, rows[0].rest, line), ...rows.map((r) => make(r.at, r.rest, line)));
  }
  return out.sort((a, b) => (timeOf(a) ?? 0) - (timeOf(b) ?? 0));
}
