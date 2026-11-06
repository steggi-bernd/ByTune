// Which lines a lyrics view gets: the way a file is written must not cost lines, and the lines must
// come in the song's order, or the sung line jumps around.
import test from "node:test";
import assert from "node:assert/strict";
import { lrcRows, sungLines, unfoldStamps } from "../.test-build/lrc.mjs";
import { lyricsFromText } from "../.test-build/lyrics.mjs";

test("a line with several stamps comes back at each of them", () => {
  const rows = lrcRows("[00:10.00][01:20.50]Chorus\n[00:30.00]Verse");
  assert.deepEqual(rows, [
    { at: 10000, rest: "Chorus" },
    { at: 30000, rest: "Verse" },
    { at: 80500, rest: "Chorus" },
  ]);
});

test("stamps come with two or three digits, one, or none at all", () => {
  assert.deepEqual(
    lrcRows("[00:01]a\n[00:02.5]b\n[00:03.25]c\n[00:04.125]d\n[00:05:50]e").map((r) => r.at),
    [1000, 2500, 3250, 4125, 5500]
  );
});

test("an [offset] header moves the whole file, positive means sooner", () => {
  assert.deepEqual(lrcRows("[ar:Someone]\n[offset:+500]\n[00:10.00]a").map((r) => r.at), [9500]);
  assert.deepEqual(lrcRows("[00:10.00]a\n[offset:-250]").map((r) => r.at), [10250]);
  assert.deepEqual(lrcRows("[offset:2000]\n[00:01.00]a").map((r) => r.at), [0]);
});

test("the desktop's reader takes the same files", () => {
  const found = lyricsFromText("Lyrics file (.lrc)", "[00:10.00][01:20.00]Chorus\n[00:30]Verse");
  assert.deepEqual(found.synced.filter((l) => !l.gap).map((l) => [l.time, l.text]), [
    [10, "Chorus"],
    [30, "Verse"],
    [80, "Chorus"],
  ]);
});

const at = (l) => l.time;
const line = (time, text, extra = {}) => ({ time, text, ...extra });

test("a line in parentheses in the middle of a song is sung", () => {
  const lines = [line(5, "First"), line(9, "(Ooh, baby)"), line(12, "(Yeah) that's the one"), line(15, "Last")];
  assert.deepEqual(sungLines(lines, at).map((l) => l.text), ["First", "(Ooh, baby)", "(Yeah) that's the one", "Last"]);
});

test("only what nobody sings goes: section marks, and credits before the first sung line", () => {
  const lines = [
    line(0, "Lumen Harbor - Night Ferry"),
    line(1, "(Written by Lumen Harbor)"),
    line(3, "[Verse 1]"),
    line(4, "First"),
    line(8, ""),
    line(9, "[Chorus]"),
    line(10, "Second"),
  ];
  assert.deepEqual(sungLines(lines, at).map((l) => l.text), ["First", "Second"]);
});

test("a song that really starts at 0:00 keeps its first line", () => {
  assert.deepEqual(sungLines([line(0, "Right from the start"), line(3, "Next")], at).map((l) => l.text), ["Right from the start", "Next"]);
});

test("the lines come in the song's order, gaps included", () => {
  const lines = [line(20, "Later"), line(5, "Sooner"), line(12, "", { gap: true })];
  assert.deepEqual(sungLines(lines, at).map((l) => l.time), [5, 12, 20]);
});

test("untimed lyrics stay as they are", () => {
  const lines = [{ text: "(One)" }, { text: "" }, { text: "[Two]" }, { text: "Three" }];
  assert.deepEqual(sungLines(lines, (l) => l.at), lines);
});

test("lines kept with a further stamp in their text get it back", () => {
  const kept = [line(10, "[01:20.00]Chorus"), line(30, "Verse")];
  const unfolded = unfoldStamps(kept, (l) => l.time * 1000, (ms, text, from) => ({ ...from, time: ms / 1000, text }));
  assert.deepEqual(unfolded.map((l) => [l.time, l.text]), [
    [10, "Chorus"],
    [30, "Verse"],
    [80, "Chorus"],
  ]);
  const clean = [line(10, "Chorus")];
  assert.deepEqual(unfoldStamps(clean, (l) => l.time * 1000, () => null), clean);
});
