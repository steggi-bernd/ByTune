import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAlbumMerges, applySongEdits, isLoose, resolveAlbumKey, withMerge, withSplit } from "../.test-build/albumEdits.mjs";
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

/* Songs whose tags name no album, put on one by hand (src/views/LooseSongsView.tsx). */
const loose = (n, over = {}) => ({ id: `local:loose:${n}`, title: `Track ${n}`, artist: "Unknown artist", album: "Unknown album", duration: 200, thumb: "", source: "local", ...over });

test("a song whose tags name no album is loose; one with an album isn't", () => {
  assert.equal(isLoose(loose(1)), true);
  assert.equal(isLoose(loose(1, { album: "" })), true);
  assert.equal(isLoose(song("Album", 1)), false);
});

test("loose songs put on an album by hand are that album, in their order, with its artist where they had none", () => {
  const tracks = [loose(2), loose(1), loose(3, { artist: "Guest" })];
  const edit = (trackNo, artist) => ({ album: "Field Notes", albumArtist: "Wren", artist, trackNo, year: 2021 });
  const shown = applySongEdits(tracks, { "local:loose:1": edit(1, "Wren"), "local:loose:2": edit(2, "Wren"), "local:loose:3": edit(3) });
  const albums = buildAlbums(shown);
  assert.equal(albums.length, 1);
  assert.equal(albums[0].title, "Field Notes");
  assert.equal(albums[0].artist, "Wren");
  assert.equal(albums[0].year, 2021);
  assert.deepEqual(albums[0].tracks.map((t) => t.title), ["Track 1", "Track 2", "Track 3"]);
  assert.deepEqual(albums[0].tracks.map((t) => t.artist), ["Wren", "Wren", "Guest"], "a song's own artist stays");
  assert.equal(shown[1].artistId, "lib:artist:Wren");
  assert.equal(shown.some(isLoose), false);
});

test("an edit kept under another copy's id holds when that copy no longer leads; no edits, the same list", () => {
  const lead = loose(1);
  const versions = new Map([[lead.id, [lead, { ...lead, id: "jf:copy" }]]]);
  const [shown] = applySongEdits([lead], { "jf:copy": { album: "Field Notes", trackNo: 1 } }, versions);
  assert.equal(shown.album, "Field Notes");
  assert.equal(shown.albumId, `lib:album:${encodeURIComponent("unknown artist|field notes")}`);
  const tracks = [loose(1)];
  assert.equal(applySongEdits(tracks, {}), tracks);
});

test("loose songs put on an album you have join it", () => {
  const tracks = [song("Album", 1), song("Album", 2), loose(3)];
  const shown = applySongEdits(tracks, { "local:loose:3": { album: "Album", albumArtist: "Band", artist: "Band", trackNo: 3 } });
  const albums = buildAlbums(shown);
  assert.equal(albums.length, 1);
  assert.equal(albums[0].tracks.length, 3);
});
