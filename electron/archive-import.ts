/**
 * Bought music, straight into the library: a store's ZIP (Bandcamp, Qobuz,
 * 7digital …) is unpacked into one of the library folders, as one album
 * folder, and the rescan that follows picks it up.
 *
 *  - only music and what belongs with it comes out (covers, booklets, cue
 *    sheets, lyrics); anything else stays in the archive
 *  - every path must stay inside the album folder (no "..", no absolute or
 *    drive paths), names are made safe for Windows, nothing is overwritten:
 *    a second import of the same album gets its own " (2)" folder
 *  - the archive is read as a stream, so a multi-gigabyte Hi-Res album never
 *    sits in memory; its file count and unpacked size are capped up front
 *  - an import that fails halfway leaves nothing behind
 */
import * as fs from "fs";
import * as path from "path";
import yauzl from "yauzl";

const AUDIO = [".flac", ".mp3", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".wav", ".aif", ".aiff", ".aifc", ".alac", ".wv", ".ape", ".dsf", ".dff", ".wma", ".mka"];
const EXTRAS = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".pdf", ".txt", ".cue", ".log", ".m3u", ".m3u8", ".lrc", ".nfo"];
const KEEP = new Set([...AUDIO, ...EXTRAS]);
const MAX_ENTRIES = 5000;
const MAX_BYTES = 20 * 1024 ** 3;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

export interface ArchiveImport {
  /** the album folder the files went into */
  folder: string;
  files: number;
  songs: number;
  /** entries left in the archive: other file types, encrypted ones */
  skipped: number;
}

/** A path segment Windows accepts: no reserved characters or names, no trailing dot or space. */
export function safeSegment(name: string): string {
  // eslint-disable-next-line no-control-regex
  let s = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim();
  if (RESERVED.test(s)) s = `_${s}`;
  return s.slice(0, 120) || "_";
}

/** The entry's path inside the album folder, or null when it would leave it. */
export function innerPath(fileName: string): string[] | null {
  if (yauzl.validateFileName(fileName) !== null) return null;
  const parts = fileName.split("/").filter((p) => p !== "" && p !== ".");
  if (!parts.length || parts.some((p) => p === "..") || /^[a-z]:/i.test(parts[0])) return null;
  return parts.map(safeSegment);
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: false }, (err, zip) =>
      err || !zip ? reject(err ?? new Error("Couldn't open the archive")) : resolve(zip)
    )
  );
}

/** Every entry, read from the archive's directory (nothing unpacked yet). */
function listEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: yauzl.Entry[] = [];
    zip.on("entry", (e: yauzl.Entry) => {
      entries.push(e);
      if (entries.length > MAX_ENTRIES) {
        zip.close();
        reject(new Error(`That archive holds more than ${MAX_ENTRIES} files — not an album`));
        return;
      }
      zip.readEntry();
    });
    zip.once("end", () => resolve(entries));
    zip.once("error", reject);
    zip.readEntry();
  });
}

function writeEntry(zip: yauzl.ZipFile, entry: yauzl.Entry, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error("Couldn't read the archive"));
        return;
      }
      const part = `${target}.part`;
      const out = fs.createWriteStream(part, { flags: "wx" });
      stream.once("error", (e) => out.destroy(e));
      out.once("error", (e) => {
        stream.destroy();
        fs.rm(part, { force: true }, () => reject(e));
      });
      out.once("finish", () => fs.rename(part, target, (e) => (e ? reject(e) : resolve())));
      stream.pipe(out);
    });
  });
}

/** A folder name under `root` that doesn't exist yet: "Album", "Album (2)" … */
function freshFolder(root: string, name: string): string {
  for (let n = 1; n < 1000; n++) {
    const dir = path.join(root, n === 1 ? name : `${name} (${n})`);
    if (!fs.existsSync(dir)) return dir;
  }
  throw new Error("Too many folders with that name");
}

export async function importArchive(zipPath: string, root: string): Promise<ArchiveImport> {
  if (!/\.zip$/i.test(zipPath)) throw new Error("Choose a .zip file");
  if (!fs.statSync(zipPath, { throwIfNoEntry: false })?.isFile()) throw new Error("That archive isn't there anymore");
  if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) throw new Error("The library folder can't be reached");

  const zip = await openZip(zipPath);
  try {
    let entries: yauzl.Entry[];
    try {
      entries = await listEntries(zip);
    } catch (err) {
      // yauzl refuses a name that climbs out ("../") or starts at a root: so does the import, whole.
      if (err instanceof Error && /relative path|absolute path|invalid characters/i.test(err.message)) {
        throw new Error("That archive points outside its own folder — it wasn't unpacked");
      }
      throw err;
    }
    const files = entries
      .filter((e) => !e.fileName.endsWith("/"))
      .map((e) => ({ entry: e, parts: innerPath(e.fileName) }));
    const wanted = files.filter(
      (f): f is { entry: yauzl.Entry; parts: string[] } =>
        !!f.parts && KEEP.has(path.extname(f.parts[f.parts.length - 1]).toLowerCase()) && !f.entry.isEncrypted()
    );
    if (!wanted.some((f) => AUDIO.includes(path.extname(f.parts[f.parts.length - 1]).toLowerCase()))) {
      throw new Error("There is no music in that archive");
    }
    const total = wanted.reduce((sum, f) => sum + f.entry.uncompressedSize, 0);
    if (total > MAX_BYTES) throw new Error("That archive unpacks to more than 20 GB — not an album");

    // An archive holding one folder ("Artist - Album/…") becomes that folder;
    // a flat one (Bandcamp) takes the archive's name.
    const tops = new Set(wanted.map((f) => (f.parts.length > 1 ? f.parts[0] : "")));
    const single = tops.size === 1 && !tops.has("") ? [...tops][0] : null;
    const album = single ?? safeSegment(path.basename(zipPath).replace(/\.zip$/i, ""));
    const folder = freshFolder(root, album);
    const rel = (parts: string[]): string[] => (single ? parts.slice(1) : parts);

    fs.mkdirSync(folder, { recursive: true });
    try {
      for (const f of wanted) {
        const target = path.join(folder, ...rel(f.parts));
        if (!target.startsWith(folder + path.sep)) throw new Error("Unsafe path in the archive");
        fs.mkdirSync(path.dirname(target), { recursive: true });
        await writeEntry(zip, f.entry, target);
      }
    } catch (err) {
      fs.rmSync(folder, { recursive: true, force: true });
      throw err;
    }
    return {
      folder,
      files: wanted.length,
      songs: wanted.filter((f) => AUDIO.includes(path.extname(f.parts[f.parts.length - 1]).toLowerCase())).length,
      skipped: entries.filter((e) => !e.fileName.endsWith("/")).length - wanted.length,
    };
  } finally {
    zip.close();
  }
}
