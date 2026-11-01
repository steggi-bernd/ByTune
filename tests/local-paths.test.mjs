import assert from "node:assert/strict";
import { test } from "node:test";
import { foldPathCase, isUnderPath, pathRules, samePath } from "../.test-build/local-paths.mjs";

const win = pathRules("win32");
const mac = pathRules("darwin");
const linux = pathRules("linux");

test("a child folder is under its root at any depth", () => {
  assert.equal(win.isUnderPath("D:\\Music\\English\\Pop", "D:\\Music"), true);
  assert.equal(win.isUnderPath("D:\\Music\\English", "D:\\Music"), true);
  assert.equal(linux.isUnderPath("/home/user/Music/English/Pop", "/home/user/Music"), true);
});

test("the root itself counts as under (a folder entry covers its own path)", () => {
  assert.equal(win.isUnderPath("D:\\Music", "D:\\Music"), true);
  assert.equal(linux.isUnderPath("/home/user/Music", "/home/user/Music/"), true);
});

test("siblings and unrelated drives are not under", () => {
  assert.equal(win.isUnderPath("D:\\Music\\English", "D:\\Music\\Hindi"), false);
  assert.equal(win.isUnderPath("E:\\Music\\English", "D:\\Music"), false);
  assert.equal(win.isUnderPath("D:\\MusicX\\a.mp3", "D:\\Music"), false);
});

test("prefix sharing must not pass without a separator", () => {
  assert.equal(win.isUnderPath("D:\\Music2\\a.mp3", "D:\\Music"), false);
  assert.equal(linux.isUnderPath("/home/user/Music2/a.mp3", "/home/user/Music"), false);
});

test("matching is case-insensitive on Windows and macOS (same as track-id hashing)", () => {
  assert.equal(win.isUnderPath("d:\\music\\english\\song.mp3", "D:\\MUSIC"), true);
  assert.equal(mac.isUnderPath("/Users/me/music/song.mp3", "/Users/me/Music"), true);
});

test("on Linux case tells folders apart", () => {
  assert.equal(linux.isUnderPath("/home/user/musik/song.mp3", "/home/user/Musik"), false);
  assert.equal(linux.isUnderPath("/home/user/Musik/song.mp3", "/home/user/Musik"), true);
  assert.equal(linux.samePath("/home/user/Musik", "/home/user/musik"), false);
});

test("posix separators work everywhere", () => {
  for (const rules of [win, mac, linux]) {
    assert.equal(rules.isUnderPath("/home/user/Music/english/song.mp3", "/home/user/Music"), true);
    assert.equal(rules.isUnderPath("/home/user/MusicX/song.mp3", "/home/user/Music"), false);
  }
});

test("mixed separators (forward-slash root stored by an old version)", () => {
  assert.equal(win.isUnderPath("D:\\Music\\english\\song.mp3", "D:/Music"), true);
});

test("on Linux a backslash is part of a name, not a separator", () => {
  assert.equal(linux.isUnderPath("/home/user/Music\\Live/song.mp3", "/home/user/Music"), false);
  assert.equal(win.isUnderPath("/home/user/Music\\Live/song.mp3", "/home/user/Music"), true);
});

test("empty inputs are never under anything", () => {
  for (const rules of [win, linux]) {
    assert.equal(rules.isUnderPath("", "D:\\Music"), false);
    assert.equal(rules.isUnderPath("D:\\Music", ""), false);
    assert.equal(rules.isUnderPath(undefined, "D:\\Music"), false);
    assert.equal(rules.isUnderPath("D:\\Music", undefined), false);
    assert.equal(rules.samePath("", ""), false);
  }
});

test("samePath ignores the slash style and a trailing slash, and case where it doesn't count", () => {
  assert.equal(win.samePath("D:\\Music\\", "d:/music"), true);
  assert.equal(win.samePath("D:\\Music", "D:\\Music2"), false);
  assert.equal(linux.samePath("/home/user/Music/", "/home/user/Music"), true);
});

test("off Linux the folded form is exactly the lower-cased path, so no track id changes", () => {
  for (const p of ["D:\\Música\\ÄÖÜ\\Track.FLAC", "/Users/Me/Music/Song.mp3", "C:/Mixed\\Slashes/A.m4a"]) {
    assert.equal(win.foldPathCase(p), p.toLowerCase());
    assert.equal(mac.foldPathCase(p), p.toLowerCase());
    assert.equal(linux.foldPathCase(p), p);
  }
});

test("the exported helpers follow the system they run on", () => {
  const here = pathRules(process.platform);
  assert.equal(foldPathCase("/A/b"), here.foldPathCase("/A/b"));
  assert.equal(isUnderPath("/A/b/c", "/a/B"), here.isUnderPath("/A/b/c", "/a/B"));
  assert.equal(samePath("/A/b", "/a/B"), here.samePath("/A/b", "/a/B"));
});
