// The phone's quality choice (mobile/src/quality.ts): Original is always the file, Compact a small
// transcode, Automatic the best the connection carries, and never a transcode bigger than the file.
import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseStream, COMPACT_KBPS, levelGain, ORIGINAL, sameChoice, stepDown } from "../.test-build/phone-quality.mjs";

const flac = { bitrate: 1_000_000 };
const hiRes = { bitrate: 3_000_000 };
const smallMp3 = { bitrate: 96_000 };
const mp3 = { bitrate: 320_000 };
const unknown = {};
const mbit = (n) => n * 1_000_000;

test("Original is the file, whatever the connection", () => {
  assert.deepEqual(chooseStream(hiRes, "original", 50_000, 64), ORIGINAL);
});

test("Compact is small, but never bigger than the file", () => {
  assert.deepEqual(chooseStream(flac, "compact", mbit(100), null), { kind: "transcode", kbps: COMPACT_KBPS });
  assert.deepEqual(chooseStream(smallMp3, "compact", mbit(100), null), ORIGINAL);
});

test("Automatic plays the file when the connection carries it, with room to spare", () => {
  assert.deepEqual(chooseStream(flac, "auto", mbit(20), null), ORIGINAL);
  assert.deepEqual(chooseStream(flac, "auto", mbit(1.6), null), ORIGINAL);
  // Enough for the song on paper, not with its dips.
  assert.deepEqual(chooseStream(flac, "auto", mbit(1.2), null), { kind: "transcode", kbps: 320 });
});

test("Automatic takes the best transcode the connection carries", () => {
  assert.deepEqual(chooseStream(hiRes, "auto", mbit(1), null), { kind: "transcode", kbps: 320 });
  assert.deepEqual(chooseStream(flac, "auto", 400_000, null), { kind: "transcode", kbps: 192 });
  assert.deepEqual(chooseStream(flac, "auto", 250_000, null), { kind: "transcode", kbps: 128 });
  assert.deepEqual(chooseStream(flac, "auto", 120_000, null), { kind: "transcode", kbps: 64 });
  // Worse than anything that works: still the smallest there is.
  assert.deepEqual(chooseStream(flac, "auto", 20_000, null), { kind: "transcode", kbps: 64 });
});

test("Automatic never turns a small file into a bigger transcode", () => {
  assert.deepEqual(chooseStream(smallMp3, "auto", 200_000, null), ORIGINAL);
  assert.deepEqual(chooseStream(mp3, "auto", 300_000, null), { kind: "transcode", kbps: 192 });
});

test("before any measurement the file is tried", () => {
  assert.deepEqual(chooseStream(flac, "auto", 0, null), ORIGINAL);
  assert.deepEqual(chooseStream(unknown, "auto", 0, null), ORIGINAL);
});

test("over mobile data Automatic stops at 320 kbps, whatever the connection carries", () => {
  assert.deepEqual(chooseStream(flac, "auto", mbit(50), null, true), { kind: "transcode", kbps: 320 });
  assert.deepEqual(chooseStream(flac, "auto", 0, null, true), { kind: "transcode", kbps: 320 });
  assert.deepEqual(chooseStream(flac, "auto", 250_000, null, true), { kind: "transcode", kbps: 128 });
  assert.deepEqual(chooseStream(smallMp3, "auto", mbit(50), null, true), ORIGINAL);
  assert.deepEqual(chooseStream(mp3, "auto", mbit(50), null, true), ORIGINAL);
});

test("over mobile data Original still means the file", () => {
  assert.deepEqual(chooseStream(flac, "original", mbit(50), null, true), ORIGINAL);
});

test("a song without a bitrate counts as a big file", () => {
  assert.deepEqual(chooseStream(unknown, "auto", mbit(1), null), { kind: "transcode", kbps: 320 });
});

test("what failed to play smoothly limits it, whatever the estimate says", () => {
  assert.deepEqual(chooseStream(flac, "auto", mbit(50), 192), { kind: "transcode", kbps: 192 });
  assert.deepEqual(chooseStream(smallMp3, "auto", mbit(50), 192), ORIGINAL);
});

test("each stall steps down one level, until there is none left", () => {
  assert.equal(stepDown(flac, ORIGINAL), 320);
  assert.equal(stepDown(mp3, ORIGINAL), 192);
  assert.equal(stepDown(flac, { kind: "transcode", kbps: 320 }), 192);
  assert.equal(stepDown(flac, { kind: "transcode", kbps: 128 }), 64);
  assert.equal(stepDown(flac, { kind: "transcode", kbps: 64 }), null);
  assert.equal(stepDown({ bitrate: 48_000 }, ORIGINAL), null);
});

test("choices compare by what they fetch", () => {
  assert.ok(sameChoice(ORIGINAL, { kind: "original" }));
  assert.ok(sameChoice({ kind: "transcode", kbps: 192 }, { kind: "transcode", kbps: 192 }));
  assert.ok(!sameChoice({ kind: "transcode", kbps: 192 }, { kind: "transcode", kbps: 128 }));
  assert.ok(!sameChoice(ORIGINAL, { kind: "transcode", kbps: 128 }));
  assert.ok(!sameChoice(undefined, ORIGINAL));
});

test("volume leveling goes to Spotify's level: a song at -7 LUFS comes down to -14, not to -18", () => {
  // Jellyfin's gain for -7 LUFS is -11 dB: down to its own -18.
  assert.equal(levelGain(-11, "quiet"), -11);
  assert.equal(levelGain(-11, "normal"), -7);
  assert.equal(levelGain(-11, "loud"), -4);
});

test("volume leveling only turns down", () => {
  // A quiet song, at -15 LUFS.
  assert.equal(levelGain(-3, "normal"), 0);
  assert.equal(levelGain(2, "loud"), 0);
});

test("without leveling or a measurement the song stays as it is", () => {
  assert.equal(levelGain(-11, "off"), undefined);
  assert.equal(levelGain(undefined, "normal"), undefined);
});
