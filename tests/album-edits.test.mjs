import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAlbumMerges, resolveAlbumKey, withMerge, withSplit } from "../.test-build/albumEdits.mjs";
import { artistAlbums, buildAlbums } from "../.test-build/catalogIndex.mjs";

const key = (artist, album) => `${artist.toLowerCase()}|${album.toLowerCase()}`;
const song = (album, trackNo, over = {}) => {
  const artist = over.artist ?? "Band";
  return {
    id: `local:${album}:${trackNo}`,
    title: `${album} ${trackNo}`,
    artist,
    album,
    trackNo,
    duration: 200,
    thumb: "",
    source: "local",
    albumId: `lib:album:${encodeURIComponent(key(over.albumArtist ?? artist, album))}`,
    ...over,
  };
};

test("merges chain and never loop", () => {
  assert.equal(resolveAlbumKey("a", { a: "b", b: "c" }), "c");
  assert.equal(resolveAlbumKey("a", { a: "b", b: "a" }), "b");
  assert.equal(resolveAlbumKey("x", {}), "x");
});

test("merging an album that has parts takes its parts along; separating undoes one step", () => {
  let m = withMerge({}, "disc2", "disc1");
  m = withMerge(m, "disc1", "box");
  assert.deepEqual(m, { disc2: "box", disc1: "box" });
  assert.deepEqual(withMerge(m, "box", "disc1"), m, "an album can't be merged into its own part");
  assert.deepEqual(withSplit(m, "disc1"), { disc2: "box" });
});

test("songs of a merged album link to the album they're shown in", () => {
  const tracks = [song("Album (Disc 1)", 1), song("Album (Disc 2)", 1)];
  const merged = applyAlbumMerges(tracks, { [key("Band", "Album (Disc 2)")]: key("Band", "Album (Disc 1)") });
  assert.equal(merged[0], tracks[0], "untouched songs stay the same objects");
  assert.equal(merged[1].albumId, tracks[0].albumId);
});

test("a merged album is one album: its own songs first, then the merged disc in order", () => {
  const tracks = [song("Album (Disc 2)", 2), song("Album (Disc 1)", 2), song("Album (Disc 2)", 1), song("Album (Disc 1)", 1)];
  const merged = applyAlbumMerges(tracks, { [key("Band", "Album (Disc 2)")]: key("Band", "Album (Disc 1)") });
  const albums = buildAlbums(merged);
  assert.equal(albums.length, 1);
  assert.equal(albums[0].title, "Album (Disc 1)");
  assert.deepEqual(
    albums[0].tracks.map((t) => t.title),
    ["Album (Disc 1) 1", "Album (Disc 1) 2", "Album (Disc 2) 1", "Album (Disc 2) 2"]
  );
});

test("an edited artist line owns the album for every artist in it", () => {
  const tracks = [song("Duets", 1), song("Duets", 2)];
  const albums = buildAlbums(tracks, { [key("Band", "Duets")]: "Band, Guest Singer" });
  assert.equal(albums[0].artist, "Band, Guest Singer");
  assert.equal(artistAlbums(albums, "Guest Singer").own.length, 1);
  assert.equal(artistAlbums(albums, "Band").own.length, 1);
});
