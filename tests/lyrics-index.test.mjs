// Search by a line of the lyrics (electron/lyrics-index.ts): what counts as the same text, which
// lines are kept, how matches rank, and that the index outlives a restart.
import assert from "node:assert/strict";
import { after, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "bytune-lyrics-index-"));
globalThis.__lyricsIndexUserData = userData;
after(() => fs.rmSync(userData, { recursive: true, force: true }));

async function load() {
  const out = await build({
    entryPoints: [fileURLToPath(new URL("../electron/lyrics-index.ts", import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [
      {
        name: "electron-stub",
        setup(b) {
          b.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js", contents: "export const app = { getPath: () => globalThis.__lyricsIndexUserData };" }));
        },
      },
    ],
  });
  // A fresh module each time: the second load stands for the next start of the app.
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text + `\n// ${Math.random()}`).toString("base64")}`);
}

const synced = (lines) => ({ source: "test", wordSynced: false, plain: null, synced: lines.map(([time, text, gap]) => ({ time, text, ...(gap ? { gap: true } : {}) })) });

test("case, accents, apostrophes and punctuation don't count", async () => {
  const { foldText } = await load();
  assert.equal(foldText("Don't Stop — Café!"), "dont stop cafe");
  assert.equal(foldText("  Ünter   den  Linden "), "unter den linden");
});

test("lines keep their times; gaps and blank lines are dropped", async () => {
  const { linesOf } = await load();
  const { lines, times } = linesOf(synced([[0, "", true], [12.04, "The harbor hums"], [20, "  "], [21.5, "We trade the city"]]));
  assert.deepEqual(Array.from(lines), ["The harbor hums", "We trade the city"]);
  assert.deepEqual(Array.from(times), [12, 21.5]);
  assert.deepEqual(Array.from(linesOf({ source: "t", wordSynced: false, synced: null, plain: "One\r\n\r\nTwo\n" }).lines), ["One", "Two"]);
  assert.deepEqual(Array.from(linesOf(null).lines), []);
});

test("matches rank a line start first, then a word start, then the rest", async () => {
  const { findInLyrics } = await load();
  const entries = new Map([
    ["a", { sig: "x", lines: ["We sing of harbors", "Far away"] }],
    ["b", { sig: "x", lines: ["Harbor lights"] }],
    ["c", { sig: "x", lines: ["Shipharbor"] }],
    ["d", { sig: "x", lines: [] }],
  ]);
  const hits = findInLyrics(entries, "harbor");
  assert.deepEqual(hits.map((h) => h.id), ["b", "a", "c"]);
  assert.equal(hits[1].line, "We sing of harbors");
  assert.deepEqual(findInLyrics(entries, "ha"), [], "two letters are too few");
});

test("noted lyrics are found, with the time of their line, and survive a restart", async () => {
  const first = await load();
  first.noteLyrics("local:abc", synced([[12, "The harbor hums a quiet tune"], [20, "We trade the city for the moon"]]));
  first.noteLyrics("jf:xyz", { source: "Jellyfin", wordSynced: false, synced: null, plain: "Lanterns sway on the upper deck" });
  const hit = first.searchLyrics("city for the")[0];
  assert.equal(hit.id, "local:abc");
  assert.equal(hit.time, 20);
  assert.equal(first.searchLyrics("upper deck")[0].id, "jf:xyz");
  await first.saveLyricsIndex();

  const next = await load();
  assert.equal(next.searchLyrics("quiet tune")[0]?.id, "local:abc");
  next.keepLyricsIndexOf(new Set(["jf:xyz"]));
  assert.equal(next.searchLyrics("quiet tune").length, 0, "a song gone from the library leaves the index");
  assert.equal(next.searchLyrics("upper deck").length, 1);
});

test("the index lives beside the lyrics cache, not among the data that backups carry", async () => {
  assert.ok(fs.existsSync(path.join(userData, "lyrics-cache", "index.json")));
  assert.ok(!fs.existsSync(path.join(userData, "data")));
});
