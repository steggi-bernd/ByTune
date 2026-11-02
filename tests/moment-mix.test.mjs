// The time-of-day mix: which listens make a song belong to this moment (electron/listens.ts
// scoreMoments) and how the mix is named and filled (src/lib/mixes.ts momentMix).
import assert from "node:assert/strict";
import { test } from "node:test";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function bundle(file, stubs = {}) {
  const out = await build({
    entryPoints: [fileURLToPath(new URL(`../${file}`, import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [
      {
        name: "stubs",
        setup(b) {
          b.onResolve({ filter: /^electron$/ }, () => ({ path: "electron", namespace: "stub" }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ loader: "js", contents: `export const app = { getPath: () => ${JSON.stringify(os.tmpdir())} };` }));
        },
      },
    ],
    ...stubs,
  });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}

const { scoreMoments } = await bundle("electron/listens.ts");
const { momentMix, momentTitle } = await bundle("src/lib/mixes.ts");

const DAY = 86_400_000;
// A Sunday, 20:00 local time.
const now = new Date(2026, 10, 1, 20, 0).getTime();
const listen = (id, at) => ({ id, at, title: id, artist: "", album: "", duration: 200 });

test("listens near this time of day count, the nearer the more; far ones don't", () => {
  const scores = scoreMoments(
    [
      listen("same-time", now - 7 * DAY),
      listen("an-hour-off", now - 7 * DAY + 3600_000),
      listen("morning", now - 7 * DAY - 11 * 3600_000),
    ],
    now
  );
  assert.deepEqual(scores.map((s) => s.id), ["same-time", "an-hour-off"]);
});

test("the same weekday counts most, the same kind of day less, the other kind least", () => {
  const scores = scoreMoments(
    [
      listen("sunday", now - 7 * DAY),
      listen("saturday", now - 8 * DAY),
      listen("wednesday", now - 4 * DAY),
    ],
    now
  );
  assert.deepEqual(scores.map((s) => s.id), ["sunday", "saturday", "wednesday"]);
});

test("recent habits outweigh old ones; the current session and anything past two years don't count", () => {
  const scores = scoreMoments(
    [
      listen("last-week", now - 7 * DAY),
      listen("half-a-year-ago", now - 182 * DAY),
      listen("playing-now", now - 3600_000),
      listen("ancient", now - 800 * DAY),
    ],
    now
  );
  assert.deepEqual(scores.map((s) => s.id), ["last-week", "half-a-year-ago"]);
  assert.ok(scores[0].score > scores[1].score * 3);
});

test("the mix is named by weekday and part of the day; after midnight it is still the night before", () => {
  assert.equal(momentTitle(now), "Sunday Evening");
  assert.equal(momentTitle(new Date(2026, 10, 2, 1, 30).getTime()), "Sunday Night");
  assert.equal(momentTitle(new Date(2026, 10, 2, 7, 0).getTime()), "Monday Morning");
  assert.equal(momentTitle(new Date(2026, 10, 2, 12, 0).getTime()), "Monday Midday");
});

test("the mix needs eight songs, maps played copies to their songs and drops what's gone", () => {
  const tracks = Array.from({ length: 10 }, (_, i) => ({ id: `song${i}`, title: `Song ${i}`, artist: "A", duration: 200, thumb: "" }));
  const scores = tracks.slice(0, 8).map((t, i) => ({ id: i === 0 ? "copy-of-song0" : t.id, score: 10 - i }));
  const keyOf = (id) => (id === "copy-of-song0" ? "song0" : id);
  const mix = momentMix(tracks, [...scores, { id: "deleted", score: 1 }], keyOf, now);
  assert.equal(mix.id, "moment");
  assert.equal(mix.title, "Sunday Evening");
  assert.deepEqual(mix.tracks.map((t) => t.id).sort(), tracks.slice(0, 8).map((t) => t.id).sort());
  assert.equal(momentMix(tracks, scores.slice(0, 7), keyOf, now), null);
});
