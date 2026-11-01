// The listening history (electron/listens.ts): one line per listen, written when the listen
// counts as a play (electron/stats.ts), stamped with when it began — read newest first a page
// at a time, exported as a spreadsheet, kept on this computer.
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const require = createRequire(import.meta.url);

async function load(entry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bytune-listens-"));
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL(`../electron/${entry}.ts`, import.meta.url))],
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    write: false,
  });
  const module = { exports: {} };
  vm.runInNewContext(outputFiles[0].text, {
    module, exports: module.exports, console, Buffer, setTimeout, clearTimeout,
    require: (name) => (name === "electron" ? { app: { getPath: () => root } } : require(name)),
  });
  return { api: module.exports, root, file: path.join(root, "data", "listens.jsonl"), close: () => fs.rmSync(root, { recursive: true, force: true }) };
}
// Arrays made inside the module's sandbox carry its own prototype: compare plain copies.
const ids = (page) => Array.from(page.listens, (l) => l.id);
const track = (id, extra = {}) => ({ id, title: `Song ${id}`, artist: "Band", album: "LP", duration: 200, thumb: "", ...extra });

test("listens read back newest first, a page at a time", async () => {
  const h = await load("listens");
  try {
    h.api.noteListen(track("a"), 1_000);
    h.api.noteListen(track("b"), 3_000);
    h.api.noteListen(track("c"), 2_000);
    const first = await h.api.readListens(undefined, 2);
    assert.deepEqual(ids(first), ["b", "c"]);
    assert.equal(first.more, true);
    assert.equal(first.total, 3);
    const next = await h.api.readListens(first.listens[1].at, 2);
    assert.deepEqual(ids(next), ["a"]);
    assert.equal(next.more, false);
    // A line cut by a crash costs only that line.
    fs.appendFileSync(h.file, '{"at":4000,"id":"broken","tit\n');
    h.api.noteListen(track("d"), 5_000);
    assert.deepEqual(ids(await h.api.readListens()), ["d", "b", "c", "a"]);
  } finally {
    h.close();
  }
});

test("the spreadsheet: oldest first, quoted where needed, no formula ever runs", async () => {
  const h = await load("listens");
  try {
    h.api.noteListen(track("x", { title: 'Hello, "World"', artist: "=HYPERLINK(1)", album: "" }), Date.UTC(2026, 9, 31, 12, 0, 0));
    h.api.noteListen(track("y", { title: "First" }), Date.UTC(2026, 9, 30, 8, 0, 0));
    const { csv, count } = await h.api.listensCsv();
    assert.equal(count, 2);
    assert.ok(csv.startsWith("\ufeffListened at (UTC),Title,Artist,Album,Length (s)\r\n"));
    const rows = csv.slice(1).trim().split("\r\n");
    assert.equal(rows[1], "2026-10-30T08:00:00.000Z,First,Band,LP,200");
    assert.equal(rows[2], `2026-10-31T12:00:00.000Z,"Hello, ""World""",'=HYPERLINK(1),,200`);
  } finally {
    h.close();
  }
});

test("clearing forgets every listen, written or waiting", async () => {
  const h = await load("listens");
  try {
    h.api.noteListen(track("a"), 1_000);
    await h.api.flushListens();
    h.api.noteListen(track("b"), 2_000);
    await h.api.clearListens();
    assert.equal(fs.existsSync(h.file), false);
    assert.equal((await h.api.readListens()).total, 0);
  } finally {
    h.close();
  }
});

test("a listen is written once, when it counts as a play, stamped with its start", async () => {
  const h = await load("stats");
  try {
    h.api.initStats();
    const t = track("song", { duration: 60 }); // counts at 30 s
    const before = Date.now();
    h.api.recordListening(t, 20_000);
    h.api.flushSync();
    assert.equal(fs.existsSync(h.file), false, "20 s is not a play yet");
    h.api.recordListening(t, 15_000);
    h.api.recordListening(t, 20_000); // more of the same listen: still one play
    h.api.flushSync();
    let lines = fs.readFileSync(h.file, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].id, "song");
    assert.equal(lines[0].title, "Song song");
    assert.equal(lines[0].duration, 60);
    // It began 35 s before it counted.
    assert.ok(Math.abs(lines[0].at - (before - 35_000)) < 2_000, `start ${lines[0].at - before}`);
    // Played again from the start: a second listen.
    h.api.noteTrackStart("song");
    h.api.recordListening(t, 31_000);
    h.api.flushSync();
    lines = fs.readFileSync(h.file, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    // A reset drops what hasn't been written.
    h.api.noteTrackStart("song");
    h.api.recordListening(t, 31_000);
    h.api.resetStats();
    h.api.flushSync();
    assert.equal(fs.readFileSync(h.file, "utf8").trim().split("\n").length, 2);
  } finally {
    h.api.resetStats();
    h.close();
  }
});
