// Songs that run on (src/lib/continuity.ts) and the mood mixes (src/lib/mixes.ts moodMixes).
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function bundle(file) {
  const out = await build({ entryPoints: [fileURLToPath(new URL(`../${file}`, import.meta.url))], bundle: true, platform: "node", format: "esm", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}
const { followsOnAlbum, runsOn, runsOnByNature } = await bundle("src/lib/continuity.ts");
const { moodMixes } = await bundle("src/lib/mixes.ts");

const song = (trackNo, extra = {}) => ({ id: `s${trackNo}`, title: `Song ${trackNo}`, artist: "Band", album: "Record", trackNo, duration: 200, thumb: "", ...extra });
const loudEnds = { introSilence: 0, outroSilence: 0, headDb: -14, tailDb: -12 };
const quietEnds = { introSilence: 1.2, outroSilence: 2.5, headDb: -70, tailDb: -75 };

test("the next track of the same album follows on, the next disc's first too", () => {
  assert.ok(followsOnAlbum(song(3), song(4)));
  assert.ok(!followsOnAlbum(song(3), song(5)), "a skipped track");
  assert.ok(!followsOnAlbum(song(4), song(3)), "backwards");
  assert.ok(!followsOnAlbum(song(3), song(4, { album: "Other" })), "another album");
  assert.ok(followsOnAlbum(song(12, { discNo: 1 }), song(1, { discNo: 2 })));
  assert.ok(!followsOnAlbum(song(3, { trackNo: undefined }), song(4)), "no track numbers");
});

test("live albums and DJ mixes run on by nature; 'Alive' isn't live", () => {
  assert.ok(runsOnByNature(song(1, { releaseType: "album live" })));
  assert.ok(runsOnByNature(song(1, { album: "Live at the Harbour" })));
  assert.ok(runsOnByNature(song(1, { album: "Night Shift (Mixed by Vela)" })));
  assert.ok(runsOnByNature(song(1, { releaseType: "compilation dj-mix" })));
  assert.ok(!runsOnByNature(song(1, { album: "Alive and Well" })));
  assert.ok(!runsOnByNature(song(1)));
});

test("a studio album runs on only where two songs measurably meet sounding", () => {
  assert.ok(runsOn(song(3), song(4), { cur: loudEnds, next: loudEnds }));
  assert.ok(!runsOn(song(3), song(4), { cur: loudEnds, next: quietEnds }), "the next one starts in silence");
  assert.ok(!runsOn(song(3), song(4), { cur: quietEnds, next: loudEnds }), "this one fades out");
  assert.ok(!runsOn(song(3), song(4)), "not measured yet");
  assert.ok(!runsOn(song(3), song(6), { cur: loudEnds, next: loudEnds }), "not the next track");
});

test("a live album runs on even before it is measured", () => {
  const live = { album: "Live at the Harbour" };
  assert.ok(runsOn(song(3, live), song(4, live)));
  assert.ok(!runsOn(song(3, live), song(7, live)));
});

test("mood mixes take the calmest and the most energetic fifth of the measured songs", () => {
  const tracks = Array.from({ length: 50 }, (_, i) => song(i + 1, { id: `t${i}` }));
  const energy = new Map(tracks.map((t, i) => [t.id, (i + 1) / 50]));
  const [calm, upbeat] = moodMixes(tracks, (t) => energy.get(t.id));
  assert.equal(calm.id, "mood:calm");
  assert.equal(upbeat.id, "mood:upbeat");
  assert.equal(calm.tracks.length, 10);
  assert.ok(calm.tracks.every((t) => energy.get(t.id) <= 0.2));
  assert.ok(upbeat.tracks.every((t) => energy.get(t.id) > 0.8));
});

test("a calm song may measure 0 energy and still count", () => {
  const tracks = Array.from({ length: 20 }, (_, i) => song(i + 1, { id: "z" + i }));
  const [calm] = moodMixes(tracks, (t) => (Number(t.id.slice(1)) < 8 ? 0 : 0.5));
  assert.ok(calm.tracks.length >= 8 && calm.tracks.every((t) => Number(t.id.slice(1)) < 8));
});

test("too few measured songs, no mood mixes; unmeasured songs don't count", () => {
  const tracks = Array.from({ length: 30 }, (_, i) => song(i + 1, { id: `t${i}` }));
  assert.deepEqual(moodMixes(tracks, (t) => (Number(t.id.slice(1)) < 10 ? 0.5 : undefined)), []);
  assert.deepEqual(moodMixes(tracks, () => undefined), []);
});
