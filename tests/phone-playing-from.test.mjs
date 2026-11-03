// The player's "Playing from …" on the phone (mobile/src/playingFrom.ts): a queue only knows the
// name it was started under, so the name finds its page; what has no page leads to the song's album.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const out = await build({
  entryPoints: [fileURLToPath(new URL("../mobile/src/playingFrom.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { albumKeyOf, branched, playingFrom } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const song = { album: "Discovery", albumId: `lib:album:${encodeURIComponent("daft punk|discovery")}` };
const known = {
  albums: [{ key: "air|moon safari", title: "Moon Safari" }],
  artists: [{ name: "Daft Punk" }],
  mixes: [{ id: "mix:1", title: "On repeat" }],
  genres: [{ key: "house", name: "House" }],
  playlists: [{ id: "p1", name: "Road trip" }],
};

test("a song's album key comes from its library address, and only from there", () => {
  assert.equal(albumKeyOf(song), "daft punk|discovery");
  assert.equal(albumKeyOf({}), null);
  assert.equal(albumKeyOf({ albumId: "jellyfin:123" }), null);
});

test("the song's own album, also when a queue from the computer names nothing", () => {
  const page = { screen: "Album", params: { albumKey: "daft punk|discovery" } };
  assert.deepEqual(playingFrom("Discovery", song, known), { label: "Playing from album", name: "Discovery", page });
  assert.deepEqual(playingFrom("", song, known), { label: "Playing from album", name: "Discovery", page });
});

test("each list has its own page", () => {
  const list = (context) => playingFrom(context, song, known).page;
  assert.deepEqual(list("Liked Songs"), { screen: "Collection", params: { kind: "liked" } });
  assert.deepEqual(list("Downloads"), { screen: "Collection", params: { kind: "downloads" } });
  assert.deepEqual(list("Road trip"), { screen: "Collection", params: { kind: "playlist", id: "p1" } });
  assert.deepEqual(list("On repeat"), { screen: "Collection", params: { kind: "mix", id: "mix:1" } });
  assert.deepEqual(list("House"), { screen: "Collection", params: { kind: "genre", key: "house" } });
  assert.deepEqual(list("Liked songs by Daft Punk"), { screen: "Collection", params: { kind: "artistLiked", name: "Daft Punk" } });
});

test("an album or artist the queue started from, while another song plays", () => {
  assert.deepEqual(playingFrom("Moon Safari", song, known).page, { screen: "Album", params: { albumKey: "air|moon safari" } });
  assert.deepEqual(playingFrom("Daft Punk", song, known).page, { screen: "Artist", params: { name: "Daft Punk" } });
});

test("branching off: the rest of the list first, then what was coming, without playing a song twice", () => {
  const ids = (list) => list.map((t) => t.id);
  const [a, b, c, d, e] = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  assert.deepEqual(ids(branched([a, b, c], [d, e])), ["d", "e", "a", "b", "c"]);
  assert.deepEqual(ids(branched([a, b, c], [b, d])), ["b", "d", "a", "c"]);
  assert.deepEqual(ids(branched([], [d])), ["d"]);
});

test("what has no page of its own leads to the song's album, and says what it was", () => {
  const search = playingFrom("Search", song, known);
  assert.equal(search.name, "Search");
  assert.deepEqual(search.page, { screen: "Album", params: { albumKey: "daft punk|discovery" } });
  assert.equal(playingFrom("Search", {}, known).page, null);
});
