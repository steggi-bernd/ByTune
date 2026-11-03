// The rename to Songsta (electron/data-folder.ts): the old data folder moves once, whole, and
// nothing is ever overwritten; while the old app still holds it, the app uses it where it is.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { carryOverData } from "../.test-build/data-folder.mjs";

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "songsta-data-"));
  return { root, from: path.join(root, "ByTune Local"), to: path.join(root, "Songsta") };
}
function put(dir, name, text) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

test("the old folder moves whole to the new name", () => {
  const { from, to } = setup();
  put(from, "data/library.json", "mine");
  put(from, "local-art/cover.jpg", "art");
  put(from, "Local State", "key");

  assert.equal(carryOverData(from, to), to);
  assert.equal(fs.readFileSync(path.join(to, "data/library.json"), "utf8"), "mine");
  assert.equal(fs.readFileSync(path.join(to, "local-art/cover.jpg"), "utf8"), "art");
  assert.equal(fs.readFileSync(path.join(to, "Local State"), "utf8"), "key");
  assert.equal(fs.existsSync(from), false);
});

test("what Chromium already set up in the new folder doesn't stop the move", () => {
  const { from, to } = setup();
  put(from, "data/library.json", "mine");
  put(to, "GPUCache/index", "empty");

  assert.equal(carryOverData(from, to), to);
  assert.equal(fs.readFileSync(path.join(to, "data/library.json"), "utf8"), "mine");
  assert.equal(fs.existsSync(path.join(to, "GPUCache")), false);
});

test("data in the new folder is never overwritten", () => {
  const { from, to } = setup();
  put(from, "data/library.json", "old");
  put(to, "data/library.json", "new");

  assert.equal(carryOverData(from, to), to);
  assert.equal(fs.readFileSync(path.join(to, "data/library.json"), "utf8"), "new");
  assert.equal(fs.readFileSync(path.join(from, "data/library.json"), "utf8"), "old");
});

test("a fresh install has nothing to move", () => {
  const { from, to } = setup();
  assert.equal(carryOverData(from, to), to);
  assert.equal(fs.existsSync(to), false);
});

test("a folder that can't move stays in use where it is", () => {
  const { root, from } = setup();
  put(from, "data/library.json", "mine");
  // No rename can work into a path below a file: stands in for the old app's locks.
  put(root, "blocker", "file");
  const to = path.join(root, "blocker", "Songsta");

  assert.equal(carryOverData(from, to), from);
  assert.equal(fs.readFileSync(path.join(from, "data/library.json"), "utf8"), "mine");
});
