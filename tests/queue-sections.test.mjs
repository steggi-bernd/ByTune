// What the queue shows of the songs asked for by hand (src/lib/queueSections.ts), on both apps:
// one by one, a branch with a line of its own and its long tail folded; and what's left of the
// branches as the queue moves on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const out = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/queueSections.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { handRows, jumpTarget, lineInList, listAround, placeOf, putBack, tendedBranches, withoutSongs } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const songs = (...ids) => ids.map((id) => ({ id }));
const branch = (name, ...ids) => ({ name, trackId: ids[0], started: false, ids });
const shape = (rows) => rows.map((r) => (r.kind === "song" ? r.track.id : r.kind === "branch" ? `[${r.branch} ${r.count}]` : `+${r.count}`));

test("nothing asked for: nothing to show", () => {
  assert.deepEqual(handRows(songs("a", "b", "c"), 0, 0, []), []);
  assert.deepEqual(handRows(songs("a", "b", "c"), 1, 1, []), []);
});

test("the songs asked for, in the order they were asked for, and nothing of the list behind them", () => {
  const rows = handRows(songs("a", "q", "r", "b"), 0, 3, []);
  assert.deepEqual(shape(rows), ["q", "r"]);
  assert.deepEqual(rows.map((r) => r.at), [1, 2]);
});

test("a short branch shows whole, under a line that names it", () => {
  const rows = handRows(songs("a", "x", "y", "b"), 0, 3, [branch("Mix", "x", "y")]);
  assert.deepEqual(shape(rows), ["[Mix 2]", "x", "y"]);
  assert.equal(rows[0].folds, false);
});

test("a long branch folds behind its first three songs until it's opened", () => {
  const queue = songs("a", "1", "2", "3", "4", "5", "q", "b");
  const list = [branch("Mix", "1", "2", "3", "4", "5")];
  assert.deepEqual(shape(handRows(queue, 0, 7, list)), ["[Mix 5]", "1", "2", "3", "+2", "q"]);
  const opened = handRows(queue, 0, 7, list, new Set(["Mix"]));
  assert.deepEqual(shape(opened), ["[Mix 5]", "1", "2", "3", "4", "5", "q"]);
  assert.equal(opened[0].folds, true, "it can be closed again");
});

test("while a branch plays, only what's left of it counts", () => {
  const queue = songs("a", "1", "2", "3", "4", "5", "b");
  assert.deepEqual(shape(handRows(queue, 3, 6, [branch("Mix", "1", "2", "3", "4", "5")])), ["[Mix 2]", "4", "5"]);
});

test("the places in the queue stay right past what's folded", () => {
  const rows = handRows(songs("a", "1", "2", "3", "4", "5", "q", "b"), 0, 7, [branch("Mix", "1", "2", "3", "4", "5")]);
  assert.equal(rows.find((r) => r.kind === "song" && r.track.id === "q").at, 6);
});

test("branches one after the other, with a song between them", () => {
  const rows = handRows(songs("a", "x", "q", "r", "b"), 0, 4, [branch("One", "x"), branch("Two", "r")]);
  assert.deepEqual(shape(rows), ["[One 1]", "x", "q", "[Two 1]", "r"]);
});

test("a branch stays until all its songs are behind", () => {
  const b = branch("Mix", "x", "y");
  const queue = songs("a", "x", "y", "b");
  assert.deepEqual(tendedBranches([b], queue, 0), [b], "nothing changed: the very same list");
  assert.equal(tendedBranches([b], queue, 0)[0], b);
  assert.equal(tendedBranches([b], queue, 1)[0].started, true);
  assert.equal(tendedBranches([b], queue, 2).length, 1, "its last song is on");
  assert.deepEqual(tendedBranches([b], queue, 3), []);
});

test("back before its first song, it's chosen again", () => {
  const b = { ...branch("Mix", "x", "y"), started: true };
  assert.equal(tendedBranches([b], songs("a", "x", "y", "b"), 0)[0].started, false);
});

test("its first song gone or jumped over: the next one takes the mark", () => {
  const b = branch("Mix", "x", "y", "z");
  assert.deepEqual(tendedBranches([b], songs("a", "y", "z"), 0)[0].trackId, "y");
  const jumped = tendedBranches([b], songs("a", "x", "y", "z"), 2)[0];
  assert.equal(jumped.trackId, "y");
  assert.equal(jumped.started, true);
});

test("songs leave a branch; one left with none goes", () => {
  const list = [branch("One", "x", "y"), branch("Two", "r")];
  assert.equal(withoutSongs(list, new Set(["q"])), list, "nothing of theirs: the very same list");
  assert.deepEqual(withoutSongs(list, new Set(["x"]))[0], { name: "One", trackId: "y", started: false, ids: ["y"] });
  assert.deepEqual(withoutSongs(list, new Set(["r"])).map((b) => b.name), ["One"]);
});

test("a branch's songs go back behind the song they came after; what's there now keeps its order", () => {
  const key = (s) => s.id;
  const only = (...ids) => (s) => ids.includes(s.id);
  const names = (list) => list.map(key);
  assert.deepEqual(names(putBack(songs("b", "c", "d"), songs("c", "d"), only("b"), key)), ["b", "c", "d"], "first of all");
  assert.deepEqual(names(putBack(songs("b", "c", "d"), songs("b", "d"), only("c"), key)), ["b", "c", "d"], "in the middle");
  assert.deepEqual(names(putBack(songs("b", "c", "d"), songs("b"), only("c", "d"), key)), ["b", "c", "d"], "at the end, in order");
  assert.deepEqual(names(putBack(songs("c"), songs("b", "c"), only(), key)), ["b", "c"], "came back meanwhile by another branch going");
  assert.deepEqual(names(putBack(songs("b", "c"), songs("c", "q"), only(), key)), ["c", "q"], "taken out by hand, or heard: it stays out");
  assert.deepEqual(names(putBack(songs("b", "c", "d"), songs("d", "c"), only("b"), key)), ["b", "d", "c"], "turned around meanwhile");
});

test("a song in the queue twice: where it was seen settles it, else the nearest copy, ahead rather than behind", () => {
  const queue = songs("a", "b", "a", "c", "a");
  assert.equal(placeOf(queue, "a", 1, 1), 2, "right behind");
  assert.equal(placeOf(queue, "a", 1, -1), 0, "right before");
  assert.equal(placeOf(queue, "a", 1), 2, "as near either way: ahead");
  assert.equal(placeOf(queue, "a", 3), 4);
  assert.equal(placeOf(queue, "c", 0, 1), 3, "not where it was said to be: it's looked for");
  assert.equal(placeOf(queue, "z", 0), -1);
  const upper = (s) => s.id.toUpperCase();
  assert.equal(placeOf(queue, "C", 0, undefined, upper), 3);
});

test("where the hand-made part ends, in a list that starts further on", () => {
  assert.equal(lineInList(25, 10), 15);
  assert.equal(lineInList(5, 10), 0);
});

test("where a device is told to go: the song, or one step along the list when it isn't known there", () => {
  const q = [{ id: "a" }, { id: "b" }, { id: "a" }, { id: "c" }];
  assert.equal(jumpTarget(q, "a", 1, 1), 2, "the copy that was meant");
  assert.equal(jumpTarget(q, "a", 1, -1), 0);
  assert.equal(jumpTarget(q, "c", 0), 3);
  assert.equal(jumpTarget(q, "nope", 1, 1), 2, "next is next");
  assert.equal(jumpTarget(q, "nope", 1, -1), 0);
  assert.equal(jumpTarget(q, "nope", 1, 2), -1, "further than that, it could be anything");
  assert.equal(jumpTarget(q, "nope", 3, 1), -1, "there's nothing after the last");
  assert.equal(jumpTarget(q, "nope", 1), -1);
});

test("the part of a list that goes along: around the song, within what's there", () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ id: String(i) }));
  assert.deepEqual(listAround(list, "5", 2, 3).map((t) => t.id), ["3", "4", "5", "6", "7"]);
  assert.deepEqual(listAround(list, "0", 2, 3).map((t) => t.id), ["0", "1", "2"]);
  assert.deepEqual(listAround(list, "nope", 2, 3).map((t) => t.id), ["0", "1", "2"]);
});
