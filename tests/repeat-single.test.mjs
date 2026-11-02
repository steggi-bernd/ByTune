// Repeat over a queue of one (src/stores/player.ts next/prev): coming round to the very same song
// starts it over — a fresh seek to 0 the engine acts on — instead of "moving" to the index it is
// already at, which left a finished single standing silent.
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const lib = fileURLToPath(new URL("../src/lib/", import.meta.url));
const stub = (contents) => ({ contents, resolveDir: lib, loader: "ts" });
const out = await build({
  stdin: { contents: `export { usePlayer } from "../stores/player";`, resolveDir: lib, loader: "ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "stubs",
      setup(b) {
        b.onLoad({ filter: /[\\/]lib[\\/]persist\.ts$/ }, () =>
          stub(`export const lazyJSONStorage = () => ({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined });`)
        );
        b.onLoad({ filter: /[\\/]stores[\\/]catalog\.ts$/ }, () => stub(`export const songKey = (id) => id; export const versionsOf = (t) => [t];`));
        b.onLoad({ filter: /[\\/]stores[\\/]ui\.ts$/ }, () => stub(`export const useUI = { getState: () => ({ toast() {}, openDialog() {}, navigate() {} }) };`));
        b.onLoad({ filter: /[\\/]stores[\\/]library\.ts$/ }, () => stub(`export const useLibrary = { getState: () => ({ isLiked: () => false, playlists: [] }) };`));
      },
    },
  ],
});
const { usePlayer } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const song = (id) => ({ id, title: id, artist: "A", duration: 200, thumb: "" });

beforeEach(() => {
  usePlayer.setState({ queue: [], index: 0, playing: false, position: 0, seekNonce: 0, repeat: "off", shuffle: false });
});

test("a single on repeat-all starts over at its end instead of standing still", () => {
  usePlayer.setState({ queue: [song("single")], index: 0, playing: true, position: 200, repeat: "all" });
  const before = usePlayer.getState().seekNonce;
  usePlayer.getState().next(false);
  const s = usePlayer.getState();
  assert.equal(s.index, 0);
  assert.equal(s.playing, true);
  assert.equal(s.position, 0);
  assert.equal(s.seekNonce, before + 1, "a fresh seek the engine acts on");
});

test("an EP on repeat-all goes from its last song back to its first", () => {
  usePlayer.setState({ queue: [song("a"), song("b"), song("c")], index: 2, playing: true, repeat: "all" });
  usePlayer.getState().next(false);
  assert.equal(usePlayer.getState().index, 0);
  assert.equal(usePlayer.getState().playing, true);
});

test("without repeat a single ends there", () => {
  usePlayer.setState({ queue: [song("single")], index: 0, playing: true, repeat: "off" });
  usePlayer.getState().next(false);
  assert.equal(usePlayer.getState().playing, false);
});

test("Next on a single starts it over; Previous early in it too", () => {
  usePlayer.setState({ queue: [song("single")], index: 0, playing: true, position: 40 });
  usePlayer.getState().next(true);
  assert.equal(usePlayer.getState().position, 0);
  assert.equal(usePlayer.getState().seekNonce, 1);
  usePlayer.setState({ position: 1 });
  usePlayer.getState().prev();
  assert.equal(usePlayer.getState().index, 0);
  assert.equal(usePlayer.getState().seekNonce, 2);
});
