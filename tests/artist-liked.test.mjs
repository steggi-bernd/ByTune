// An artist's liked songs (lib/catalogIndex.ts): the strip on the artist page counts them, their
// small playlist (ArtistLikedView) lists them — the latest like first, a like on any copy counting.
import assert from "node:assert/strict";
import { test } from "node:test";
import { likedAmong } from "../.test-build/catalogIndex.mjs";

const song = (id) => ({ id, title: id, artist: "Band", album: "A", duration: 200 });
const ids = (list) => list.map((t) => t.id);
const same = (id) => id;

test("only the liked ones, the latest like first", () => {
  const songs = ["a", "b", "c", "d"].map(song);
  // Liked Songs holds the latest like on top; other artists' likes don't count.
  const liked = ["other", "c", "a"].map(song);
  assert.deepEqual(ids(likedAmong(songs, liked, same)), ["c", "a"]);
});

test("nothing liked: an empty list, so the page shows no strip", () => {
  assert.deepEqual(likedAmong(["a", "b"].map(song), [], same), []);
  assert.deepEqual(likedAmong([], ["a"].map(song), same), []);
});

test("a like on another copy of the song counts, in the place of its latest like", () => {
  // The local file and the Jellyfin copy are one song; the artist page lists the merged one.
  const keyOf = (id) => id.replace(/^(local|jf):/, "");
  const songs = ["local:a", "local:b"].map(song);
  const liked = ["jf:b", "jf:a", "local:b"].map(song);
  assert.deepEqual(ids(likedAmong(songs, liked, keyOf)), ["local:b", "local:a"]);
});
