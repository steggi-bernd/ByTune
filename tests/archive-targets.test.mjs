// Where a bought album is unpacked (src/lib/archiveImport.ts importTargets): only the folders
// the user picked. A picked folder also lists its music-bearing subfolders as collections of
// their own (electron/local-library.ts) — those are no place for a new album, and neither is
// the offline downloads folder while there is another.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const lib = fileURLToPath(new URL("../src/lib/", import.meta.url));
const out = await build({
  entryPoints: [`${lib}archiveImport.ts`],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "stores",
      setup(b) {
        b.onLoad({ filter: /[\\/]stores[\\/](settings|ui)\.ts$/ }, () => ({
          contents: "export const useSettings = { getState: () => ({}) }; export const useUI = { getState: () => ({}) };",
          loader: "js",
        }));
      },
    },
  ],
});
const { importTargets } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
const names = (list) => importTargets(list.map((path) => ({ path, name: path }))).map((f) => f.path);

test("a picked folder and the artist folders it lists: the album goes into the picked one, unasked", () => {
  assert.deepEqual(
    names(["D:\\Musik", "D:\\Musik\\Lumen Harbor", "D:\\Musik\\Mira Kestrel", "d:\\musik\\VELA MOSS\\"]),
    ["D:\\Musik"]
  );
});

test("two picked folders: both are offered", () => {
  assert.deepEqual(names(["D:\\Musik", "D:\\Musik\\A", "E:\\Hörbücher", "E:\\Hörbücher\\B"]), ["D:\\Musik", "E:\\Hörbücher"]);
  // A name that only begins like another folder is not inside it.
  assert.deepEqual(names(["D:\\Musik", "D:\\Musik2"]), ["D:\\Musik", "D:\\Musik2"]);
  assert.deepEqual(names(["/home/a/Music", "/home/a/Music/X", "/home/a/music"]), ["/home/a/Music", "/home/a/music"]);
});

test("the offline downloads folder only when it's the only one", () => {
  assert.deepEqual(names(["D:\\Musik", "C:\\Users\\a\\Music\\ByTune Offline", "C:\\Users\\a\\Music\\ByTune Offline\\Band"]), ["D:\\Musik"]);
  assert.deepEqual(names(["C:\\Users\\a\\Music\\ByTune Offline", "C:\\Users\\a\\Music\\ByTune Offline\\Band"]), ["C:\\Users\\a\\Music\\ByTune Offline"]);
  // Inside the picked music folder it is one of its collections anyway.
  assert.deepEqual(names(["C:\\Users\\a\\Music", "C:\\Users\\a\\Music\\ByTune Offline"]), ["C:\\Users\\a\\Music"]);
  assert.deepEqual(names([]), []);
});
