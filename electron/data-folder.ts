/** An app data folder's move to a new name: pure file work, no Electron. */
import * as fs from "fs";
import * as path from "path";

const holdsData = (dir: string): boolean => fs.existsSync(path.join(dir, "data"));

/**
 * Moves the old folder to the new name, unless the new one holds data of its
 * own. Answers the folder to use: the old one when it can't move, because the
 * old app is still running and holds its files; the next start tries again.
 */
export function carryOverData(from: string, to: string): string {
  if (holdsData(to) || !holdsData(from)) return to;
  try {
    // Without data the new folder has at most what Chromium just set up.
    fs.rmSync(to, { recursive: true, force: true });
    fs.renameSync(from, to);
    return to;
  } catch (err) {
    console.warn("[bytune] data folder not moved yet:", err instanceof Error ? err.message : err);
    return from;
  }
}
