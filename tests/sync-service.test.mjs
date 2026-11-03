// The sync service (sync-server/server.mjs) and the apps' side of the conversation
// (lib/syncEngine.ts), run against each other with a stand-in for Jellyfin.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { createSyncServer } from "../sync-server/server.mjs";
import { recordDeletionChanges } from "../.test-build/deletion-sync.mjs";
import { toPlaylistDoc, toWireTrack } from "../.test-build/playlistSync.mjs";
import { createSyncEngine, defaultSyncAddress } from "../.test-build/syncEngine.mjs";

const ANNA = "a".repeat(32);
const BEN = "b".repeat(32);
const TOKENS = { anna: ANNA, ben: BEN };
const API_KEY = "server-key";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}
const header = (token) => `MediaBrowser Client="Test", Device="T", DeviceId="t", Version="1", Token="${token}"`;

let jellyfinCalls = 0;
const jellyfin = http.createServer((req, res) => {
  jellyfinCalls += 1;
  const token = /Token="([^"]+)"/.exec(req.headers.authorization ?? "")?.[1];
  const reply = (status, body) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.url === "/Users/Me") {
    if (token === API_KEY) return reply(400, { error: "no user behind an API key" });
    return TOKENS[token] ? reply(200, { Id: TOKENS[token] }) : reply(401, {});
  }
  if (req.url === "/Users") return token === API_KEY ? reply(200, [{ Id: ANNA }, { Id: BEN }]) : reply(403, {});
  reply(404, {});
});

let dataDir;
let service;
let base;

before(async () => {
  const jellyfinPort = await listen(jellyfin);
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "songsta-sync-"));
  process.env.SYNC_TEST_JELLYFIN = `http://127.0.0.1:${jellyfinPort}`;
  service = createSyncServer({ dataDir, jellyfinUrl: process.env.SYNC_TEST_JELLYFIN });
  base = `http://127.0.0.1:${await listen(service)}`;
});
after(() => {
  service.closeAllConnections();
  service.close();
  jellyfin.closeAllConnections();
  jellyfin.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function call(method, url, { token = "anna", user, body, at = base } = {}) {
  const res = await fetch(`${at}${url}`, {
    method,
    headers: {
      ...(token ? { Authorization: header(token) } : {}),
      ...(user ? { "X-Songsta-User": user } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function until(check, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(`waited in vain for ${what}`);
}

/* ------------------------------------------------------------ the service */

test("anyone may ask whether it's there, nothing else without a login", async () => {
  assert.equal((await call("GET", "/health", { token: null })).body.service, "songsta-sync");
  assert.equal((await call("GET", "/v1/docs/playlists", { token: null })).status, 401);
  assert.equal((await call("GET", "/v1/docs/playlists", { token: "wrong" })).status, 401);
});

test("each Jellyfin user has their own documents", async () => {
  const empty = await call("GET", "/v1/docs/queue", { token: "ben" });
  assert.deepEqual(empty.body, { rev: 0, updatedAt: 0, doc: null });
  assert.equal((await call("PUT", "/v1/docs/queue", { token: "anna", body: { doc: { id: "annas" } } })).status, 200);
  assert.equal((await call("GET", "/v1/docs/queue", { token: "ben" })).body.doc, null);
  assert.equal((await call("GET", "/v1/docs/queue", { token: "anna" })).body.doc.id, "annas");
});

test("a login asks Jellyfin once in a while, not at every request", async () => {
  await call("GET", "/v1/docs/queue", { token: "ben" });
  const calls = jellyfinCalls;
  await call("GET", "/v1/docs/queue", { token: "ben" });
  await call("GET", "/v1/docs/position", { token: "ben" });
  assert.equal(jellyfinCalls, calls);
});

test("an API key names its user, and that user must exist", async () => {
  assert.equal((await call("GET", "/v1/docs/queue", { token: API_KEY })).status, 400);
  assert.equal((await call("GET", "/v1/docs/queue", { token: API_KEY, user: "c".repeat(32) })).status, 403);
  const got = await call("GET", "/v1/docs/queue", { token: API_KEY, user: ANNA });
  assert.equal(got.status, 200);
  assert.equal(got.body.doc.id, "annas");
  // A real user can't speak for another.
  assert.equal((await call("GET", "/v1/docs/queue", { token: "ben", user: ANNA })).body.doc, null);
});

test("Jellyfin being away isn't a rejected login", async () => {
  const away = createSyncServer({ dataDir, jellyfinUrl: "http://127.0.0.1:9" });
  const at = `http://127.0.0.1:${await listen(away)}`;
  assert.equal((await call("GET", "/v1/docs/queue", { at })).status, 503);
  away.closeAllConnections();
  away.close();
});

test("a playlists write must be built on the current revision", async () => {
  const token = "ben";
  const first = await call("PUT", "/v1/docs/playlists", { token, body: { rev: 0, doc: { n: 1 } } });
  assert.equal(first.body.rev, 1);
  const stale = await call("PUT", "/v1/docs/playlists", { token, body: { rev: 0, doc: { n: 2 } } });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body.doc, { n: 1 });
  assert.equal((await call("PUT", "/v1/docs/playlists", { token, body: { rev: 1, doc: { n: 2 } } })).body.rev, 2);
});

test("what isn't a document or isn't known is refused", async () => {
  assert.equal((await call("GET", "/v1/docs/secrets")).status, 404);
  assert.equal((await call("GET", "/v1/docs/..%2f..%2fetc")).status, 404);
  assert.equal((await call("PUT", "/v1/docs/queue", { body: { doc: [1] } })).status, 400);
  assert.equal((await call("PUT", "/v1/docs/queue", { body: {} })).status, 400);
  const res = await fetch(`${base}/v1/docs/queue`, { method: "PUT", headers: { Authorization: header("anna") }, body: "{not json" });
  assert.equal(res.status, 400);
  const tooBig = await call("PUT", "/v1/docs/queue", { body: { doc: { padding: "x".repeat(17 * 1024 * 1024) } } });
  assert.equal(tooBig.status, 413);
});

test("a long poll answers at once when behind, and the moment something changes", async () => {
  const now = (await call("GET", "/v1/changes?since=-1&wait=0")).body;
  assert.equal((await call("GET", "/v1/changes?since=-1&wait=25")).body.seq, now.seq, "behind: no waiting");

  const started = Date.now();
  const waiting = call("GET", `/v1/changes?since=${now.seq}&wait=25`);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await call("PUT", "/v1/docs/position", { body: { doc: { x: 1 } } });
  const woke = (await waiting).body;
  assert.ok(Date.now() - started < 5000, "woke before the wait ran out");
  assert.equal(woke.seq, now.seq + 1);
  assert.equal(woke.revs.position, now.revs.position + 1);
});

test("a long poll ends when its wait runs out", async () => {
  const now = (await call("GET", "/v1/changes?since=-1&wait=0")).body;
  assert.equal((await call("GET", `/v1/changes?since=${now.seq}&wait=1`)).body.seq, now.seq);
});

test("everything is still there after a restart", async () => {
  const before = (await call("GET", "/v1/docs/queue")).body;
  const seq = (await call("GET", "/v1/changes?since=-1&wait=0")).body.seq;
  const again = createSyncServer({ dataDir, jellyfinUrl: process.env.SYNC_TEST_JELLYFIN });
  const at = `http://127.0.0.1:${await listen(again)}`;
  assert.deepEqual((await call("GET", "/v1/docs/queue", { at })).body, before);
  assert.equal((await call("GET", "/v1/changes?since=-1&wait=0", { at })).body.seq, seq);
  again.closeAllConnections();
  again.close();
});

test("the last versions of the playlists stay on disk, not more", async () => {
  let rev = (await call("GET", "/v1/docs/playlists", { token: "anna" })).body.rev;
  for (let i = 0; i < 25; i++) rev = (await call("PUT", "/v1/docs/playlists", { token: "anna", body: { rev, doc: { i } } })).body.rev;
  const dir = path.join(dataDir, "users", ANNA, "versions");
  const kept = fs.readdirSync(dir);
  assert.equal(kept.length, 20);
  const oldest = Math.min(...kept.map((f) => Number(f.split(".")[1])));
  assert.equal(oldest, rev - 20);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, `playlists.${rev - 1}.json`), "utf8")).doc, { i: 23 });
});

/* ------------------------------------------------------------ the apps' side */

const song = (id) => ({ id, title: `Song ${id}`, artist: "Band", album: "Album", duration: 200, thumb: "x" });

function fakeDevice(id, token) {
  const state = { playlists: [], folders: [], deletionSync: undefined };
  const change = (next, changes) => {
    state.deletionSync = recordDeletionChanges(state, next, changes);
    Object.assign(state, next);
    device.engine.playlistsChanged();
  };
  const device = {
    state,
    playing: false,
    at: 0,
    queue: [],
    current: null,
    positionMs: 0,
    adopted: [],
    ids: (name) => state.playlists.find((p) => p.name === name)?.tracks.map((t) => t.id),
    create(name, tracks = []) {
      const pid = `pl_${id}_${name}`;
      change({ playlists: [{ id: pid, name, tracks, createdAt: 1 }, ...state.playlists] }, [
        { kind: "add", group: "playlists", id: pid },
        ...tracks.map((t) => ({ kind: "add", group: "tracks", id: t.id, parent: pid })),
      ]);
    },
    add(name, track) {
      const p = state.playlists.find((x) => x.name === name);
      change({ playlists: state.playlists.map((x) => (x === p ? { ...x, tracks: [...x.tracks, track] } : x)) }, [{ kind: "add", group: "tracks", id: track.id, parent: p.id }]);
    },
    drop(name) {
      const p = state.playlists.find((x) => x.name === name);
      change({ playlists: state.playlists.filter((x) => x !== p) }, [{ kind: "delete", group: "playlists", id: p.id }]);
    },
    play(tracks, index, positionMs) {
      device.queue = tracks;
      device.current = tracks[index];
      device.positionMs = positionMs;
      device.playing = true;
      device.at = Date.now();
      device.queueId = `${id}-${device.at}`;
      device.engine.playbackChanged();
    },
    pause() {
      device.playing = false;
      device.at = Date.now();
      device.engine.playbackChanged();
    },
  };
  device.engine = createSyncEngine({
    deviceId: id,
    async request(method, url, body) {
      return call(method, url, { token, body });
    },
    readPlaylists: () => toPlaylistDoc(state),
    applyPlaylists: (doc) => Object.assign(state, doc),
    readPlayback() {
      if (!device.current) return null;
      return {
        note: { device: { id, name: id }, at: device.at, playing: device.playing, positionMs: device.positionMs, track: toWireTrack(device.current), queueId: device.queueId },
        queue: () => ({ id: device.queueId, tracks: device.queue.map(toWireTrack) }),
      };
    },
    wantsPlayback: (note) => !device.playing && note.at > device.at,
    adoptPlayback(note, queue) {
      device.adopted.push({ note, queue });
      device.at = note.at;
    },
  });
  return device;
}

/** A pair of a person's devices with the service to themselves. */
async function pair(t) {
  const token = "pair-" + Math.random().toString(36).slice(2);
  TOKENS[token] = Math.random().toString(16).slice(2).padEnd(32, "0").slice(0, 32);
  const pc = fakeDevice("pc", token);
  const phone = fakeDevice("phone", token);
  t.after(() => {
    pc.engine.stop();
    phone.engine.stop();
  });
  return { pc, phone };
}

test("a playlist made on one device arrives on the other, in its order, without being asked", async (t) => {
  const { pc, phone } = await pair(t);
  pc.create("Road", [song("z"), song("a"), song("m")]);
  pc.engine.start();
  phone.engine.start();
  await until(() => phone.ids("Road")?.length === 3, "the playlist on the phone");
  assert.deepEqual(phone.ids("Road"), ["z", "a", "m"]);
  // No covers or paths came along.
  assert.equal(phone.state.playlists[0].tracks[0].thumb, undefined);
});

test("changes go both ways while both are running", async (t) => {
  const { pc, phone } = await pair(t);
  pc.create("Road", [song("a")]);
  pc.engine.start();
  phone.engine.start();
  await until(() => phone.ids("Road"), "the first sync");
  phone.add("Road", song("from-phone"));
  await until(() => pc.ids("Road")?.includes("from-phone"), "the phone's song on the pc");
  pc.add("Road", song("from-pc"));
  await until(() => phone.ids("Road")?.includes("from-pc"), "the pc's song on the phone");
  assert.deepEqual(pc.ids("Road"), phone.ids("Road"));
});

test("edits made apart meet when both are back", async (t) => {
  const { pc, phone } = await pair(t);
  pc.create("Road", [song("a")]);
  pc.engine.start();
  phone.engine.start();
  await until(() => phone.ids("Road"), "the first sync");
  pc.engine.stop();
  phone.engine.stop();
  await new Promise((resolve) => setTimeout(resolve, 5));
  pc.add("Road", song("pc-offline"));
  phone.add("Road", song("phone-offline"));
  pc.engine.start();
  phone.engine.start();
  await until(() => pc.ids("Road")?.length === 3 && phone.ids("Road")?.length === 3, "both songs on both devices");
  assert.deepEqual(new Set(pc.ids("Road")), new Set(["a", "pc-offline", "phone-offline"]));
});

test("a playlist deleted on one device goes on the other and doesn't come back", async (t) => {
  const { pc, phone } = await pair(t);
  pc.create("Road", [song("a")]);
  pc.engine.start();
  phone.engine.start();
  await until(() => phone.ids("Road"), "the first sync");
  phone.drop("Road");
  await until(() => !pc.ids("Road"), "the playlist gone from the pc");
  // Restarted with the document as it is now.
  pc.engine.stop();
  pc.engine.start();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(pc.ids("Road"), undefined);
  assert.equal(phone.ids("Road"), undefined);
});

test("a device that isn't playing continues from where the other stopped", async (t) => {
  const { pc, phone } = await pair(t);
  pc.engine.start();
  phone.engine.start();
  await until(() => pc.engine.status() === "connected" && phone.engine.status() === "connected", "both connected");
  const songs = [song("a"), song("b"), song("c")];
  pc.play(songs, 1, 42_000);
  await until(() => phone.adopted.length === 1, "the note on the phone");
  const { note, queue } = phone.adopted[0];
  assert.equal(note.track.id, "b");
  assert.equal(note.positionMs, 42_000);
  assert.deepEqual(queue.tracks.map((x) => x.id), ["a", "b", "c"]);
  assert.equal(note.device.id, "pc");
  // Its own notes mean nothing to a device.
  assert.equal(pc.adopted.length, 0);
});

test("a device that is playing isn't interrupted, and looks again when it comes to the front", async (t) => {
  const { pc, phone } = await pair(t);
  pc.engine.start();
  phone.engine.start();
  await until(() => pc.engine.status() === "connected" && phone.engine.status() === "connected", "both connected");
  phone.play([song("own")], 0, 1000);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  pc.play([song("other")], 0, 5000);
  await new Promise((resolve) => setTimeout(resolve, 1400));
  assert.equal(phone.adopted.length, 0);
  phone.playing = false;
  phone.at = 0;
  await phone.engine.checkPlayback();
  assert.equal(phone.adopted.length, 1);
  assert.equal(phone.adopted[0].note.track.id, "other");
});

test("without the service the engine says so and keeps trying", async (t) => {
  const statuses = [];
  let tries = 0;
  const engine = createSyncEngine({
    deviceId: "d",
    async request() {
      tries += 1;
      throw new TypeError("Network request failed");
    },
    readPlaylists: () => toPlaylistDoc(null),
    applyPlaylists: () => assert.fail("nothing to apply"),
    readPlayback: () => null,
    wantsPlayback: () => false,
    adoptPlayback: () => assert.fail("nothing to adopt"),
    onStatus: (s) => statuses.push(s),
  });
  t.after(() => engine.stop());
  engine.start();
  await until(() => statuses.includes("unreachable"), "the status");
  engine.retryNow();
  await until(() => tries >= 2, "another try");
});

test("a refused login isn't asked again at once", async (t) => {
  const statuses = [];
  const engine = createSyncEngine({
    deviceId: "d",
    request: (method, url, body) => call(method, url, { token: "wrong", body }),
    readPlaylists: () => toPlaylistDoc(null),
    applyPlaylists: () => undefined,
    readPlayback: () => null,
    wantsPlayback: () => false,
    adoptPlayback: () => undefined,
    onStatus: (s) => statuses.push(s),
  });
  t.after(() => engine.stop());
  engine.start();
  await until(() => statuses.includes("rejected"), "the status");
  assert.deepEqual(statuses, ["connecting", "rejected"]);
});

test("the service is looked for on Jellyfin's host", () => {
  assert.equal(defaultSyncAddress("http://192.168.1.20:8096"), "http://192.168.1.20:8196");
  assert.equal(defaultSyncAddress("https://music.example.org/jellyfin"), "https://music.example.org:8196");
  assert.equal(defaultSyncAddress("http://[fe80::1]:8096"), "http://[fe80::1]:8196");
  assert.equal(defaultSyncAddress("nonsense"), null);
});
