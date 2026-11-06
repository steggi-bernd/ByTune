// How two copies of the playlists become one (lib/playlistSync.ts): what was deleted stays deleted,
// what was added on either side arrives, and a playlist keeps the order somebody gave it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { recordDeletionChanges } from "../.test-build/deletion-sync.mjs";
import { likedInOrder, oneCopyEach, mergePlaylistDocs, sameDoc, sameLikes, songFinder, toPlaylistDoc, toWireTrack, withSyncedDeletions } from "../.test-build/playlistSync.mjs";

const song = (id, extra = {}) => ({ id, title: `Song ${id}`, artist: "Band", album: "Album", duration: 200, thumb: "jfart://x", ...extra });
const ids = (doc, playlist = "p") => doc.playlists.find((p) => p.id === playlist)?.tracks.map((t) => t.id);

/** A device, the way the stores change: every change records its version. */
function device(playlists = [], at) {
  const state = { playlists, folders: [], deletionSync: undefined };
  const change = (next, changes) => {
    state.deletionSync = recordDeletionChanges(state, next, changes);
    Object.assign(state, next);
  };
  return {
    state,
    create(id, tracks = [], name = id) {
      change({ playlists: [{ id, name, tracks, createdAt: 1 }, ...state.playlists] }, [
        { kind: "add", group: "playlists", id },
        ...tracks.map((t) => ({ kind: "add", group: "tracks", id: t.id, parent: id })),
      ]);
    },
    add(id, track) {
      change({ playlists: state.playlists.map((p) => (p.id === id ? { ...p, tracks: [...p.tracks, track] } : p)) }, [{ kind: "add", group: "tracks", id: track.id, parent: id }]);
    },
    remove(id, trackId) {
      change({ playlists: state.playlists.map((p) => (p.id === id ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) } : p)) }, [{ kind: "delete", group: "tracks", id: trackId, parent: id }]);
    },
    reorder(id, order) {
      change({ playlists: state.playlists.map((p) => (p.id === id ? { ...p, tracks: order.map((tid) => p.tracks.find((t) => t.id === tid)) } : p)) }, [{ kind: "edit", group: "playlists", id }]);
    },
    rename(id, name) {
      change({ playlists: state.playlists.map((p) => (p.id === id ? { ...p, name } : p)) }, [{ kind: "edit", group: "playlists", id }]);
    },
    drop(id) {
      change({ playlists: state.playlists.filter((p) => p.id !== id) }, [{ kind: "delete", group: "playlists", id }]);
    },
    doc: () => toPlaylistDoc(state),
    take(doc) {
      Object.assign(state, doc);
    },
  };
}

/** Waits past a millisecond, so the next change has a later version. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

test("a song travels without what belongs to one machine", () => {
  const wire = toWireTrack(song("a", { localPath: "C:\\Music\\a.flac", thumb: "localart://a", rg: { trackGain: -3 }, trackNo: 2 }));
  assert.deepEqual(Object.keys(wire).sort(), ["album", "artist", "duration", "id", "title", "trackNo"]);
});

test("a playlist from the other side arrives in its order, not sorted", async () => {
  const pc = device();
  pc.create("p", [song("z"), song("a"), song("m")]);
  const merged = mergePlaylistDocs(toPlaylistDoc({ playlists: [], folders: [] }), pc.doc());
  assert.deepEqual(ids(merged), ["z", "a", "m"]);
});

test("the order survives a merge in both directions", async () => {
  const pc = device();
  pc.create("p", [song("z"), song("a"), song("m")]);
  const phone = device();
  phone.take(mergePlaylistDocs(phone.doc(), pc.doc()));
  await tick();
  phone.add("p", song("q"));
  assert.deepEqual(ids(mergePlaylistDocs(pc.doc(), phone.doc())), ["z", "a", "m", "q"]);
  assert.deepEqual(ids(mergePlaylistDocs(phone.doc(), pc.doc())), ["z", "a", "m", "q"]);
});

test("rearranging on one device wins over the old order elsewhere", async () => {
  const pc = device();
  pc.create("p", [song("a"), song("b"), song("c")]);
  const phone = device();
  phone.take(mergePlaylistDocs(phone.doc(), pc.doc()));
  await tick();
  pc.reorder("p", ["c", "a", "b"]);
  assert.deepEqual(ids(mergePlaylistDocs(phone.doc(), pc.doc())), ["c", "a", "b"]);
  assert.deepEqual(ids(mergePlaylistDocs(pc.doc(), phone.doc())), ["c", "a", "b"]);
});

test("edits made apart both arrive", async () => {
  const pc = device();
  pc.create("p", [song("a"), song("b")]);
  const phone = device();
  phone.take(mergePlaylistDocs(phone.doc(), pc.doc()));
  await tick();
  pc.add("p", song("from-pc"));
  phone.add("p", song("from-phone"));
  phone.remove("p", "a");
  const merged = mergePlaylistDocs(pc.doc(), phone.doc());
  assert.deepEqual(new Set(ids(merged)), new Set(["b", "from-pc", "from-phone"]));
});

test("a deleted playlist stays deleted, and its songs don't come back with it", async () => {
  const pc = device();
  pc.create("p", [song("a")]);
  const phone = device();
  phone.take(mergePlaylistDocs(phone.doc(), pc.doc()));
  await tick();
  phone.drop("p");
  const merged = mergePlaylistDocs(pc.doc(), phone.doc());
  assert.equal(merged.playlists.length, 0);
  // Merged once more with a stale copy: still gone.
  assert.equal(mergePlaylistDocs(pc.doc(), merged).playlists.length, 0);
});

test("the later rename wins", async () => {
  const pc = device();
  pc.create("p", [], "first");
  const phone = device();
  phone.take(mergePlaylistDocs(phone.doc(), pc.doc()));
  await tick();
  pc.rename("p", "on the pc");
  await tick();
  phone.rename("p", "on the phone");
  assert.equal(mergePlaylistDocs(pc.doc(), phone.doc()).playlists[0].name, "on the phone");
  assert.equal(mergePlaylistDocs(phone.doc(), pc.doc()).playlists[0].name, "on the phone");
});

test("a merge of the same content is no change, whatever order the device keeps", async () => {
  const pc = device();
  pc.create("a");
  await tick();
  pc.create("b");
  const phone = device();
  phone.take(mergePlaylistDocs(phone.doc(), pc.doc()));
  const again = mergePlaylistDocs(phone.doc(), pc.doc());
  assert.ok(sameDoc(again, pc.doc()));
  assert.ok(sameDoc({ ...again, playlists: [...again.playlists].reverse() }, pc.doc()));
});

test("a device keeps its own order of playlists; a new one goes on top", async () => {
  const pc = device();
  pc.create("old");
  await tick();
  pc.create("older-looking");
  const before = pc.doc().playlists.map((p) => p.id);
  const phone = device();
  phone.take(mergePlaylistDocs(phone.doc(), pc.doc()));
  await tick();
  phone.create("new");
  assert.deepEqual(mergePlaylistDocs(pc.doc(), phone.doc()).playlists.map((p) => p.id), ["new", ...before]);
});

test("the desktop's versions of likes and history aren't touched by a merge of playlists", async () => {
  const lists = { liked: [{ id: "liked-song" }], playlists: [{ id: "gone", name: "Gone", tracks: [], createdAt: 1 }] };
  const own = recordDeletionChanges({}, lists, [
    { kind: "add", group: "liked", id: "liked-song" },
    { kind: "add", group: "playlists", id: "gone" },
  ]);
  const doc = toPlaylistDoc({ ...lists, folders: [], deletionSync: own });
  assert.deepEqual(Object.keys(doc.deletionSync.adds), [JSON.stringify(["playlists", "gone"])]);
  const merged = withSyncedDeletions(own, { ...doc.deletionSync, adds: {}, clock: own.clock + 5 });
  assert.deepEqual(Object.keys(merged.adds), [JSON.stringify(["liked", "liked-song"])]);
  assert.equal(merged.clock, own.clock + 5);
});

test("a document that isn't one counts as empty", () => {
  for (const junk of [null, 5, "x", { playlists: "no" }, { playlists: [null, 3, {}] }]) {
    const doc = toPlaylistDoc(junk);
    assert.deepEqual(doc.playlists, []);
    assert.deepEqual(doc.folders, []);
  }
});

test("a local file in a desktop playlist finds its server copy on the phone", () => {
  const library = [
    song("jf:1", { title: "Night Ferry (feat. Someone)", album: "Night Ferry", duration: 201 }),
    song("jf:2", { title: "Other", album: "Night Ferry", duration: 180 }),
  ];
  const find = songFinder(library);
  assert.equal(find({ id: "jf:2", title: "renamed", artist: "x", duration: 0 })?.id, "jf:2", "the same id needs nothing else");
  assert.equal(find({ id: "local:abc", title: "Night Ferry", artist: "band", album: "night ferry", duration: 200 })?.id, "jf:1");
  assert.equal(find({ id: "local:abc", title: "Night Ferry", artist: "band", album: "night ferry", duration: 260 }), undefined, "another recording");
  assert.equal(find({ id: "local:zzz", title: "Unknown", artist: "band", duration: 200 }), undefined);
});

test("Liked Songs stand in the order the computer arranged", () => {
  const library = [song("jf:1"), song("jf:2"), song("jf:3"), song("jf:4")];
  const find = songFinder(library);
  // The server lists its favorites by artist and album; the order says otherwise.
  const order = [song("jf:3"), song("jf:1"), song("jf:2")].map(toWireTrack);
  assert.deepEqual(likedInOrder(["jf:1", "jf:2", "jf:3"], order, find), ["jf:3", "jf:1", "jf:2"]);
  // Liked a moment ago: on top. Taken back here: gone, whatever the order remembers.
  assert.deepEqual(likedInOrder(["jf:1", "jf:3", "jf:4"], order, find), ["jf:4", "jf:3", "jf:1"]);
  assert.deepEqual(likedInOrder(["jf:2", "jf:1"], [], find), ["jf:2", "jf:1"]);
});

test("a song liked on the computer as its own file is the same like here", () => {
  const library = [{ ...song("jf:1"), title: "Night Ferry", album: "Night" }, song("jf:2")];
  const local = { id: "local:abc", title: "Night Ferry", artist: "Band", album: "Night", duration: 200 };
  assert.deepEqual(likedInOrder(["jf:2", "jf:1"], [local, toWireTrack(song("jf:2"))], songFinder(library)), ["jf:1", "jf:2"]);
});

test("two orders are the same when their songs stand the same", () => {
  const a = [song("1"), song("2")].map(toWireTrack);
  assert.ok(sameLikes(a, [song("1"), song("2")].map(toWireTrack)));
  assert.ok(!sameLikes(a, [song("2"), song("1")].map(toWireTrack)));
  assert.ok(!sameLikes(a, a.slice(0, 1)));
});

test("a second copy of a song in the arranged order is no new like: it stands with its song and shows once", () => {
  const a = { id: "jf:a", title: "Phantom Liberty", artist: "Dawid Podsiadło", album: "Score", duration: 347, thumb: "" };
  const b = { id: "jf:b", title: "Phantom Liberty", artist: "Dawid Podsiadło, P.T. Adamczyk", album: "Score", duration: 347, thumb: "" };
  const other = { id: "jf:c", title: "Quiet Dive", artist: "Øneheart", album: "Atomic Heart", duration: 195, thumb: "" };
  const first = { id: "jf:d", title: "First", artist: "Someone", album: "One", duration: 100, thumb: "" };
  const library = [a, b, other, first];
  const byId = new Map(library.map((t) => [t.id, t]));
  const order = [first, a].map(toWireTrack);
  const list = likedInOrder(["jf:b", "jf:c", "jf:d", "jf:a"], order, songFinder(library), (id) => byId.get(id));
  // What the order doesn't know stays on top; the other copy doesn't count as such.
  assert.deepEqual(list, ["jf:c", "jf:d", "jf:a", "jf:b"]);
  assert.deepEqual(oneCopyEach(list, (id) => byId.get(id)), ["jf:c", "jf:d", "jf:a"]);
});

test("a playlist's picture goes where the playlist goes, and only a picture does", () => {
  const cover = "data:image/jpeg;base64,/9j/AAAA";
  const doc = toPlaylistDoc({ playlists: [{ id: "p", name: "With picture", tracks: [], cover }, { id: "q", name: "Odd", tracks: [], cover: "file:///etc/passwd" }, { id: "r", name: "Too big", tracks: [], cover: "data:image/jpeg;base64," + "A".repeat(500_000) }] });
  assert.equal(doc.playlists[0].cover, cover);
  assert.equal("cover" in doc.playlists[1], false);
  assert.equal("cover" in doc.playlists[2], false);
});

test("a song travels with what its tags say, whatever name its album goes by here", () => {
  assert.equal(toWireTrack(song("a", { album: "Better Name", albumTag: "Album" })).album, "Album");
  assert.equal("albumTag" in toWireTrack(song("a", { album: "Better Name", albumTag: "Album" })), false);
});
