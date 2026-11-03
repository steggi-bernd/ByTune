// The phone's two addresses for one server (mobile/src/addresses.ts): the direct way at home, the
// way around anywhere else, and what was made from one of them works at the other.
import assert from "node:assert/strict";
import { test } from "node:test";
import { atAddress, pickAddress, withoutServer } from "../.test-build/phone-addresses.mjs";

const both = { home: "http://192.168.1.20:8096", away: "https://music.example.org" };

test("a cover or a song made at one address works at the other", () => {
  const cover = "http://192.168.1.20:8096/Items/1/Images/Primary?tag=a";
  assert.equal(atAddress(cover, both, both.away), "https://music.example.org/Items/1/Images/Primary?tag=a");
  assert.equal(atAddress("https://music.example.org/Audio/1/stream", both, both.home), "http://192.168.1.20:8096/Audio/1/stream");
  assert.equal(atAddress(cover, both, both.home), cover);
});

test("what comes from somewhere else stays as it is", () => {
  assert.equal(atAddress("file:///songs/1.flac", both, both.away), "file:///songs/1.flac");
  assert.equal(atAddress("http://192.168.1.20:80960/x", both, both.away), "http://192.168.1.20:80960/x");
  assert.equal(atAddress("https://other.example.org/x", { home: both.home }, both.home), "https://other.example.org/x");
});

test("a picture is the same one at both addresses", () => {
  assert.equal(withoutServer("http://192.168.1.20:8096/Items/1?tag=a"), "/Items/1?tag=a");
  assert.equal(withoutServer("https://music.example.org/Items/1?tag=a"), "/Items/1?tag=a");
});

test("at home the direct way, anywhere else the way around", () => {
  assert.deepEqual(pickAddress(both, "id", "id", "id"), { reach: "home", server: both.home, serverId: "id" });
  assert.deepEqual(pickAddress(both, "id", null, "id"), { reach: "away", server: both.away, serverId: "id" });
  assert.deepEqual(pickAddress(both, "id", null, null), { reach: "offline", server: null });
  assert.deepEqual(pickAddress({ home: both.home }, "id", null, null), { reach: "offline", server: null });
});

test("another server at the same address in somebody else's home doesn't count", () => {
  assert.deepEqual(pickAddress(both, "id", "theirs", "id"), { reach: "away", server: both.away, serverId: "id" });
  assert.deepEqual(pickAddress(both, "id", "theirs", null), { reach: "offline", server: null });
});

test("a login from before the server's id was kept learns it at its own address", () => {
  assert.deepEqual(pickAddress({ home: both.home }, undefined, "id", null), { reach: "home", server: both.home, serverId: "id" });
});
