// The phone's queue and what it does while it shows another device (mobile/src/stores/player.ts):
// first come, first played, branches included; and a skip shows at once, without what that device
// says before it got there moving the screen back and forth.
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const stores = fileURLToPath(new URL("../mobile/src/stores/", import.meta.url));
const stubs = {
  "stores/connection": `export const useConnection = { getState: () => ({ reach: "online", metered: false, check: async () => "online" }), subscribe() {} };`,
  "stores/devices": `export const useDevices = { getState: () => ({ others: [] }), setState() {} }; export const isAround = () => true;`,
  "stores/localMusic": `export const fileOfSong = () => null;`,
  "stores/downloads": `export const useDownloads = { getState: () => ({ kept: {}, covers: {} }), subscribe() {} }; export const downloadsLine = () => "";`,
  "stores/library": `export const useLibrary = { getState: () => ({ muted: new Set(), byId: new Map(), loaded: true, data: { tracks: [], counts: {} }, notePlayed() {} }), subscribe() {} };`,
  "stores/playlists": `export const findSong = (wire) => ({ thumb: "", ...wire });`,
  "stores/session": `export const useSession = { getState: () => ({ session: null }) }; export const here = (x) => x;`,
  "stores/settings": `export const useSettings = { getState: () => ({ autoplay: false, dontRepeat: false, speed: 1 }) };`,
  "stores/popups": `export const toast = () => undefined;`,
  storage: `export const readJson = async () => null; export const writeJson = () => undefined;`,
  jellyfin: `export const streamUrl = () => "http://test/song";`,
  addresses: `export const withoutServer = (x) => x;`,
  quality: `export const ORIGINAL = { kind: "original" }; export const chooseStream = () => ORIGINAL; export const levelGain = () => 0; export const sameChoice = () => true; export const stepDown = () => null;`,
};
const out = await build({
  stdin: { contents: `export { usePlayer, adoptPlayback, hearDevices, linkDevices, playbackNote, runCommand, watchPlayer } from "./player";`, resolveDir: stores, loader: "ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "stubs",
      setup(b) {
        b.onResolve({ filter: /^react-native$/ }, () => ({ path: "react-native", namespace: "stub" }));
        b.onResolve({ filter: /media3-player$/ }, () => ({ path: "media3", namespace: "stub" }));
        b.onLoad({ filter: /^react-native$/, namespace: "stub" }, () => ({ contents: `export const Platform = { constants: { Model: "Test" } };`, loader: "js" }));
        b.onLoad({ filter: /^media3$/, namespace: "stub" }, () => ({
          contents: `const calls = (globalThis.__native = []);
            const say = (name) => async (...args) => { globalThis.__native.push([name, ...args]); };
            export default new Proxy({}, { get: (_, name) => name === "addListener" ? (event, fn) => { globalThis.__listeners ??= {}; globalThis.__listeners[event] = fn; } : name === "getMediaVolume" ? async () => 50 : say(name) });`,
          loader: "js",
        }));
        for (const [name, contents] of Object.entries(stubs)) {
          const filter = new RegExp(`[\\\\/]mobile[\\\\/]src[\\\\/]${name.replace("/", "[\\\\/]")}\\.ts$`);
          b.onLoad({ filter }, () => ({ contents, resolveDir: stores, loader: "ts" }));
        }
      },
    },
  ],
});
const m = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
const { usePlayer, adoptPlayback, hearDevices, linkDevices, watchPlayer } = m;
watchPlayer();

const t = (id) => ({ id, title: id.toUpperCase(), artist: "Band", duration: 100 });
const songs = (...names) => names.map(t);
const ids = () => usePlayer.getState().queue.map((x) => x.id);
const now = () => usePlayer.getState().queue[usePlayer.getState().index]?.id;
const player = () => usePlayer.getState();

/** The native player's word: this song is on. */
function nativeSays(index, more = {}) {
  globalThis.__listeners.onState({ index, isPlaying: true, playWhenReady: true, isBuffering: false, isEnded: false, positionMs: 0, durationMs: 100000, repeat: "off", audio: "", count: player().queue.length, ...more });
}

/** What the PC says about itself. */
const pc = (id, more = {}) => ({ id: "pc", ageMs: 0, lastSeen: Date.now(), presence: { name: "PC", kind: "desktop", playing: true, positionMs: 40000, durationMs: 100000, track: t(id), queueId: "q1", ...more } });

let sent;
const LIST = songs("a", "b", "c", "d");

/** Following the PC, with its list known here. */
function followPc(at = "b", list = LIST, doc = {}) {
  // The PC took the music over from here.
  m.runCommand({ action: "yield", to: "pc" });
  hearDevices([pc(at)]);
  adoptPlayback({ device: { id: "pc", name: "PC" }, at: 1, playing: true, positionMs: 40000, track: t(at), queueId: "q1" }, { id: "q1", tracks: list, ...doc });
}

beforeEach(() => {
  sent = [];
  linkDevices({
    self: "phone",
    send: async (id, command) => {
      sent.push(command);
      return true;
    },
    sendList: async (id, tracks, context, command) => {
      sent.push({ ...command, tracks });
      return true;
    },
    handOver: async () => true,
    look: () => undefined,
    presence: () => undefined,
  });
  hearDevices([]);
  player().stop();
  usePlayer.setState({ isPlaying: false, playWhenReady: false });
  globalThis.__native.length = 0;
});

/* ------------------------------------------------------------- the queue */

test("first come, first played: a song, a branch, a song, another branch", () => {
  player().playTracks(songs("a", "b", "c"), 0, "Album");
  assert.equal(player().addToQueue(songs("q")), 1);
  player().branchOff(songs("w", "x", "y"), 1, "Mix");
  assert.deepEqual(ids(), ["a", "q", "x", "y", "b", "c"]);
  assert.equal(player().addToQueue(songs("n")), 4);
  player().branchOff(songs("r", "s"), 0, "Other");
  assert.deepEqual(ids(), ["a", "q", "x", "y", "n", "r", "s", "b", "c"]);
  assert.equal(player().lineEnd, 7);
  assert.deepEqual(player().branches.map((b) => b.name), ["Mix", "Other"]);
  const native = globalThis.__native.filter((c) => c[0] === "replaceUpcoming").at(-1)[1].map((item) => item.id);
  assert.deepEqual(native, ["q", "x", "y", "n", "r", "s", "b", "c"], "the player has the same order");
});

test("each branch goes back by itself, and what it took out of the list comes back where it was", () => {
  player().playTracks(songs("a", "b", "c"), 0, "Album");
  player().branchOff(songs("x", "b"), 0, "Mix");
  player().addToQueue(songs("q"));
  player().branchOff(songs("r"), 0, "Other");
  assert.deepEqual(ids(), ["a", "x", "b", "q", "r", "c"]);
  player().cancelBranch("Mix");
  assert.deepEqual(ids(), ["a", "q", "r", "b", "c"]);
  player().cancelBranch("Other");
  assert.deepEqual(ids(), ["a", "q", "b", "c"]);
  assert.equal(player().lineEnd, 2);
  assert.deepEqual(globalThis.__native.at(-1)[1].map((item) => item.id), ["q", "b", "c"]);
});

test("the same list again: the branch starts at the other song, and only goes once", () => {
  player().playTracks(songs("a", "b"), 0, "Album");
  player().branchOff(songs("x", "y", "z"), 0, "Mix");
  player().branchOff(songs("x", "y", "z"), 1, "Mix");
  assert.deepEqual(ids(), ["a", "y", "z", "b"]);
  assert.equal(player().branches.length, 1);
  assert.ok(player().branchFrom("y", "Mix"));
  assert.equal(player().branchFrom("x", "Mix"), undefined);
});

test("taken out, a song stays out, and what's asked for by hand leaves a branch", () => {
  player().playTracks(songs("a", "b", "c"), 0, "Album");
  player().branchOff(songs("x", "y"), 0, "Mix");
  player().removeAt(1);
  assert.deepEqual(ids(), ["a", "y", "b", "c"]);
  assert.equal(player().lineEnd, 2);
  assert.equal(player().branches[0].trackId, "y");
  player().removeAt(2);
  player().cancelBranch("Mix");
  assert.deepEqual(ids(), ["a", "c"]);
});

test("only what was asked for by hand goes", () => {
  player().playTracks(songs("a", "b", "c"), 0, "Album");
  player().addToQueue(songs("q"));
  player().branchOff(songs("x", "b"), 0, "Mix");
  player().clearLine();
  assert.deepEqual(ids(), ["a", "b", "c"]);
  assert.deepEqual(player().branches, []);
  assert.deepEqual(globalThis.__native.at(-1)[1].map((item) => item.id), ["b", "c"]);
});

test("moving a song across the end of the line takes it out of the line or into it", () => {
  player().playTracks(songs("a", "b", "c"), 0, "Album");
  player().addToQueue(songs("q", "r"));
  assert.equal(player().lineEnd, 3);
  player().moveItem(2, 3);
  assert.deepEqual(ids(), ["a", "q", "b", "r", "c"]);
  assert.equal(player().lineEnd, 2, "r is one of the list's now");
  player().moveItem(4, 1);
  assert.deepEqual(ids(), ["a", "c", "q", "b", "r"]);
  assert.equal(player().lineEnd, 3, "c was moved up among the songs asked for");
});

test("Playing from: the branch's list while its songs play, then back", () => {
  player().playTracks(songs("a", "b"), 0, "Album");
  player().branchOff(songs("x", "y"), 0, "Mix");
  nativeSays(0);
  assert.equal(player().context, "Album");
  nativeSays(1);
  assert.equal(player().context, "Mix");
  assert.equal(player().homeContext, "Album");
  assert.equal(player().branches[0].started, true);
  nativeSays(2);
  assert.equal(player().context, "Mix");
  nativeSays(3);
  assert.equal(player().context, "Album");
  assert.equal(player().homeContext, null);
  assert.deepEqual(player().branches, []);
});

test("Previous before a branch's first song: chosen again, and the list's name is back", () => {
  player().playTracks(songs("a", "b"), 0, "Album");
  player().branchOff(songs("x", "y"), 0, "Mix");
  nativeSays(1);
  nativeSays(0);
  assert.equal(player().branches[0].started, false);
  assert.equal(player().context, "Album");
});

test("from the very song that's playing: the list plays on behind it", () => {
  player().playTracks(songs("a", "b"), 0, "Album");
  player().branchOff(songs("a", "y"), 0, "Mix");
  assert.deepEqual(ids(), ["a", "y", "b"]);
  assert.equal(player().branches[0].started, true);
  assert.equal(player().context, "Mix");
  player().cancelBranch("Mix");
  assert.deepEqual(ids(), ["a", "b"]);
  assert.equal(player().context, "Album");
});

/* ------------------------------------------------------------- showing another device */

/** Every song the screen stood on from here on. */
function watchSongs() {
  const stood = [];
  const off = usePlayer.subscribe((s, prev) => {
    const song = s.queue[s.index]?.id;
    if (song !== prev.queue[prev.index]?.id) stood.push(song);
  });
  return { stood, off };
}

test("Next shows at once, and what the device says before it got there doesn't move it back", () => {
  followPc();
  assert.equal(now(), "b");
  const { stood, off } = watchSongs();
  player().next();
  assert.equal(now(), "c", "at once");
  assert.equal(player().positionMs, 0);
  assert.deepEqual(sent.at(-1), { action: "jump", trackId: "c", by: 1 });
  // The PC hasn't heard yet: still the song before, further on.
  hearDevices([pc("b", { positionMs: 41000 })]);
  assert.equal(now(), "c");
  assert.equal(player().positionMs, 0, "nor its place in the song");
  hearDevices([pc("c", { positionMs: 300 })]);
  assert.equal(now(), "c");
  assert.equal(player().positionMs, 300, "from here on it's what the device says");
  off();
  assert.deepEqual(stood, ["c"], "one step, never back");
});

test("a swipe back goes one way only", () => {
  followPc();
  const { stood, off } = watchSongs();
  player().skipBy(-1);
  assert.equal(now(), "a");
  assert.deepEqual(sent.at(-1), { action: "jump", trackId: "a", by: -1 });
  hearDevices([pc("b")]);
  hearDevices([pc("b", { positionMs: 42000 })]);
  hearDevices([pc("a", { positionMs: 100 })]);
  off();
  assert.deepEqual(stood, ["a"]);
});

test("Previous goes back near a song's start; well into it, it starts over", () => {
  followPc();
  usePlayer.setState({ positionMs: 40000 });
  player().previous();
  assert.equal(now(), "b");
  assert.deepEqual(sent.at(-1), { action: "seek", positionMs: 0 });
  usePlayer.setState({ positionMs: 1000 });
  player().previous();
  assert.equal(now(), "a");
  assert.deepEqual(sent.at(-1), { action: "jump", trackId: "a", by: -1 });
});

test("two skips in a row wait for the last one", () => {
  followPc();
  const { stood, off } = watchSongs();
  player().next();
  player().next();
  assert.equal(now(), "d");
  hearDevices([pc("b")]);
  hearDevices([pc("c", { positionMs: 200 })]);
  assert.equal(now(), "d", "the first one arrived on the way");
  hearDevices([pc("d", { positionMs: 200 })]);
  off();
  assert.deepEqual(stood, ["c", "d"]);
});

test("a device that doesn't get there: after a while, what it says counts again", () => {
  followPc();
  const real = Date.now;
  try {
    player().next();
    const later = real() + 6000;
    Date.now = () => later;
    hearDevices([pc("b", { positionMs: 45000 })]);
    assert.equal(now(), "b");
    assert.equal(player().positionMs, 45000);
  } finally {
    Date.now = real;
  }
});

test("a list arriving while a skip is under way keeps the screen on the skip", () => {
  followPc();
  player().next();
  adoptPlayback({ device: { id: "pc", name: "PC" }, at: 2, playing: true, positionMs: 41000, track: t("b"), queueId: "q2" }, { id: "q2", tracks: songs("a", "b", "z", "c", "d") });
  assert.equal(now(), "c");
  assert.equal(player().positionMs, 0);
  assert.deepEqual(ids(), ["a", "b", "z", "c", "d"]);
});

test("Pause shows at once; a moment later the old word doesn't flip it back", () => {
  followPc();
  player().toggle();
  assert.equal(player().isPlaying, false);
  assert.deepEqual(sent.at(-1), { action: "pause" });
  hearDevices([pc("b", { playing: true })]);
  assert.equal(player().isPlaying, false);
  const real = Date.now;
  try {
    const later = real() + 3000;
    Date.now = () => later;
    hearDevices([pc("b", { playing: true })]);
    assert.equal(player().isPlaying, true, "somebody pressed play there");
  } finally {
    Date.now = real;
  }
});

test("a new list started from here: it stays on screen until the device has it", () => {
  followPc();
  player().playTracks(songs("m", "n"), 1, "Mix");
  assert.equal(now(), "n");
  assert.equal(sent.at(-1).action, "playList");
  hearDevices([pc("b", { positionMs: 41000 })]);
  assert.equal(now(), "n", "not back to the old album");
  assert.equal(player().context, "Mix");
  hearDevices([pc("n", { positionMs: 100, queueId: "q9" })]);
  assert.equal(now(), "n");
});

test("a song in the queue twice, heard and asked for again: every word finds the right copy", () => {
  // Heard a, on b, a asked for again.
  followPc("b", songs("a", "b", "a", "c"));
  assert.equal(player().index, 1);
  player().next();
  assert.equal(player().index, 2);
  assert.deepEqual(sent.at(-1), { action: "jump", trackId: "a", by: 1 });
  hearDevices([pc("a", { positionMs: 100 })]);
  assert.equal(player().index, 2, "not the copy that was heard");
  player().next();
  hearDevices([pc("c", { positionMs: 100 })]);
  assert.equal(player().index, 3);
  // Moved on by itself, seen from here.
  usePlayer.setState({ index: 1 });
  hearDevices([pc("a", { positionMs: 100 })]);
  assert.equal(player().index, 2, "ahead rather than behind");
});

test("adopted while it stands on the later copy of a song: that one", () => {
  m.runCommand({ action: "yield", to: "pc" });
  hearDevices([pc("a")]);
  adoptPlayback({ device: { id: "pc", name: "PC" }, at: 1, playing: true, positionMs: 5000, track: t("a"), queueId: "q5", place: 12 }, { id: "q5", from: 10, tracks: songs("a", "b", "a", "c") });
  assert.equal(player().index, 2);
});

test("told to go to a song that's there twice, this phone takes the copy that was meant", () => {
  player().playTracks(songs("a", "b", "c"), 1, "Album");
  player().addToQueue(songs("a"));
  assert.deepEqual(ids(), ["a", "b", "a", "c"]);
  m.runCommand({ action: "jump", trackId: "a", by: 1 });
  assert.deepEqual(globalThis.__native.at(-1), ["skipTo", 2, true]);
  m.runCommand({ action: "jump", trackId: "a", by: -1 });
  assert.deepEqual(globalThis.__native.at(-1), ["skipTo", 0, true]);
});

test("what's asked for shows at once and goes to the device: a song, a branch, taking it back", () => {
  followPc("a");
  assert.equal(player().addToQueue(songs("q")), 1);
  assert.deepEqual(ids(), ["a", "q", "b", "c", "d"]);
  assert.equal(sent.at(-1).action, "enqueue");
  player().branchOff(songs("x", "y"), 0, "Mix");
  assert.deepEqual(ids(), ["a", "q", "x", "y", "b", "c", "d"]);
  assert.equal(sent.at(-1).action, "branchOff");
  assert.equal(sent.at(-1).name, "Mix");
  player().cancelBranch("Mix");
  assert.deepEqual(ids(), ["a", "q", "b", "c", "d"]);
  assert.deepEqual(sent.at(-1), { action: "cancelBranch", name: "Mix" });
  player().removeAt(1);
  assert.equal(sent.at(-1).action, "setUpcoming");
  assert.equal(sent.at(-1).line, 0);
  assert.deepEqual(sent.at(-1).tracks.map((s) => s.id), ["b", "c", "d"]);
  assert.equal(globalThis.__native.filter((c) => c[0] === "insertItems" || c[0] === "replaceUpcoming").length, 0, "nothing plays here");
});

test("the device's list brings the hand-made part and the branches with it", () => {
  followPc("a", LIST, { lineEnd: 3, branches: [{ name: "Mix", trackId: "b", started: false, ids: ["b", "c"] }] });
  assert.equal(player().lineEnd, 3);
  assert.equal(player().branches[0].name, "Mix");
  // The device moves on: the first song of the branch comes on.
  hearDevices([pc("b", { positionMs: 100 })]);
  assert.equal(now(), "b");
  assert.equal(player().branches[0].started, true);
});

test("what another device changes: the list, the line and the branches go together", () => {
  player().playTracks(songs("a", "b", "c"), 0, "Album");
  m.runCommand({ action: "setUpcoming", line: 1, tracks: songs("q", "c") });
  assert.deepEqual(ids(), ["a", "q", "c"]);
  assert.equal(player().lineEnd, 2);
  m.runCommand({ action: "branchOff", name: "Mix", tracks: songs("x", "y") });
  assert.deepEqual(ids(), ["a", "q", "x", "y", "c"]);
  m.runCommand({ action: "cancelBranch", name: "Mix" });
  assert.deepEqual(ids(), ["a", "q", "c"]);
});

test("what this phone tells the others holds the line and the branches", () => {
  player().playTracks(songs("a", "b"), 0, "Album");
  player().branchOff(songs("x", "y"), 0, "Mix");
  nativeSays(1);
  const doc = m.playbackNote({ id: "phone", name: "Phone" }).queue();
  assert.equal(doc.lineEnd, 3);
  assert.equal(doc.branches[0].name, "Mix");
  assert.equal(doc.context, "Mix");
  assert.equal(doc.home, "Album");
});
