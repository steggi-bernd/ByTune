import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

// Built as CommonJS, like the app's main process: yauzl inside is a CommonJS package.
const { importArchive, innerPath, safeSegment } = createRequire(import.meta.url)("../.test-build/archive-import.cjs");

/* A minimal ZIP writer (stored entries, UTF-8 names) — enough to build store-like archives. */
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zip(file, entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name, "utf8");
    const data = Buffer.from(text ?? "");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    parts.push(local, n, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, cd, end]));
  return file;
}
const sandbox = () => fs.mkdtempSync(path.join(os.tmpdir(), "bytune-zip-"));
const tree = (dir) =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath ?? e.path, e.name)).replace(/\\/g, "/"))
    .sort();

test("a flat Bandcamp archive becomes one album folder named after it; only music and its extras come out", async () => {
  const dir = sandbox();
  const library = fs.mkdirSync(path.join(dir, "Music"), { recursive: true }) ?? path.join(dir, "Music");
  const file = zip(path.join(dir, "Lumen Harbor - Night Ferry.zip"), [
    ["Lumen Harbor - Night Ferry - 01 Departure Bell.flac", "flac"],
    ["Lumen Harbor - Night Ferry - 02 Night Ferry.flac", "flac"],
    ["cover.jpg", "jpg"],
    ["setup.exe", "MZ"],
  ]);
  const res = await importArchive(file, library);
  assert.equal(path.basename(res.folder), "Lumen Harbor - Night Ferry");
  assert.deepEqual([res.files, res.songs, res.skipped], [3, 2, 1]);
  assert.deepEqual(tree(res.folder), ["Lumen Harbor - Night Ferry - 01 Departure Bell.flac", "Lumen Harbor - Night Ferry - 02 Night Ferry.flac", "cover.jpg"]);
  assert.ok(!fs.readdirSync(res.folder).some((f) => f.endsWith(".part")), "no half-written files");
  // The same purchase again never overwrites: it gets its own folder.
  const again = await importArchive(file, library);
  assert.equal(path.basename(again.folder), "Lumen Harbor - Night Ferry (2)");
});

test("an archive holding one album folder (Qobuz) unpacks as that folder, subfolders kept", async () => {
  const dir = sandbox();
  const file = zip(path.join(dir, "download.zip"), [
    ["Vela Moss - Low Orbit (24bit-96kHz)/", ""],
    ["Vela Moss - Low Orbit (24bit-96kHz)/CD1/01. Low Orbit.flac", "flac"],
    ["Vela Moss - Low Orbit (24bit-96kHz)/booklet.pdf", "pdf"],
  ]);
  const res = await importArchive(file, dir);
  assert.equal(path.basename(res.folder), "Vela Moss - Low Orbit (24bit-96kHz)");
  assert.deepEqual(tree(res.folder), ["CD1/01. Low Orbit.flac", "booklet.pdf"]);
});

test("an archive that climbs out of its folder is refused whole, and nothing is written", async () => {
  const dir = sandbox();
  const library = path.join(dir, "Music");
  fs.mkdirSync(library);
  for (const evil of ["../evil.flac", "/abs.flac", "C:/Windows/evil.flac"]) {
    const file = zip(path.join(dir, "evil.zip"), [["01 Fine.flac", "flac"], [evil, "x"]]);
    await assert.rejects(importArchive(file, library), /outside its own folder|invalid/i, evil);
  }
  assert.deepEqual(fs.readdirSync(library), []);
  assert.ok(!fs.existsSync(path.join(dir, "evil.flac")));
});

test("names Windows can't hold are made safe; archives without music or not ZIPs are refused", async () => {
  assert.equal(safeSegment("What? Why*.flac"), "What_ Why_.flac");
  assert.equal(safeSegment("CON.flac"), "_CON.flac");
  assert.equal(safeSegment("Trailing dot. "), "Trailing dot");
  assert.deepEqual(innerPath("a/./b/c.flac"), ["a", "b", "c.flac"]);
  const dir = sandbox();
  await assert.rejects(importArchive(zip(path.join(dir, "art.zip"), [["cover.jpg", "jpg"]]), dir), /no music/);
  fs.writeFileSync(path.join(dir, "album.rar"), "rar");
  await assert.rejects(importArchive(path.join(dir, "album.rar"), dir), /\.zip/);
});
