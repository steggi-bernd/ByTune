/**
 * What an untagged file's name says: "Artist - Title", after a leading track
 * number — "01 Title", "01 - Title", "3. Artist - Title" — which becomes the
 * song's number. A number with neither a leading zero nor a separator after
 * it is part of the title ("7 Rings", "99 Luftballons", "1999").
 */
export function titleFromFile(fileName: string): { title: string; artist?: string; trackNo?: number } {
  let stem = fileName.replace(/\.[^.]+$/, "").replace(/_/g, " ").trim();
  let trackNo: number | undefined;
  const numbered = /^(?:(\d{1,3})\s*[-–.)]\s*|(0\d{1,2})\s+)(?=\S)/.exec(stem);
  if (numbered) {
    trackNo = Number(numbered[1] ?? numbered[2]) || undefined;
    stem = stem.slice(numbered[0].length);
  }
  const dash = /^(.*?)\s*[-–]\s*(.+)$/.exec(stem);
  if (dash && dash[1] && dash[2]) {
    return { artist: dash[1].trim(), title: dash[2].trim(), trackNo };
  }
  return { title: stem, trackNo };
}
