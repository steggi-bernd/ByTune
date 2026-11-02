// What an untagged file's name says (electron/file-title.ts): "Artist - Title" after a leading
// track number, which becomes the song's number — never its artist.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const out = await build({
  entryPoints: [fileURLToPath(new URL("../electron/file-title.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { titleFromFile } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

test("a leading track number leaves the title and becomes the song's number", () => {
  assert.deepEqual(titleFromFile("01 Morning Draft.flac"), { title: "Morning Draft", trackNo: 1 });
  assert.deepEqual(titleFromFile("01 - Morning Draft.mp3"), { title: "Morning Draft", trackNo: 1 });
  assert.deepEqual(titleFromFile("12. Last Light.m4a"), { title: "Last Light", trackNo: 12 });
  assert.deepEqual(titleFromFile("3) Side Door.ogg"), { title: "Side Door", trackNo: 3 });
});

test("after the number, \"Artist - Title\" names both", () => {
  assert.deepEqual(titleFromFile("03. Wren - Field Notes.flac"), { artist: "Wren", title: "Field Notes", trackNo: 3 });
  assert.deepEqual(titleFromFile("01-the_band-kitchen_rain.mp3"), { artist: "the band", title: "kitchen rain", trackNo: 1 });
  assert.deepEqual(titleFromFile("Wren - Field Notes.flac"), { artist: "Wren", title: "Field Notes", trackNo: undefined });
});

test("a number that is part of the title stays", () => {
  assert.deepEqual(titleFromFile("7 Rings.mp3"), { title: "7 Rings", trackNo: undefined });
  assert.deepEqual(titleFromFile("99 Luftballons.mp3"), { title: "99 Luftballons", trackNo: undefined });
  assert.deepEqual(titleFromFile("1999.flac"), { title: "1999", trackNo: undefined });
  assert.deepEqual(titleFromFile("05 100 Years.flac"), { title: "100 Years", trackNo: 5 });
});
