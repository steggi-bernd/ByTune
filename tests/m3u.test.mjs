import assert from "node:assert/strict";
import { test } from "node:test";
import { guessFromPath, parseM3u, writeM3u } from "../.test-build/m3u.mjs";
import { matchM3u } from "../.test-build/m3uMatch.mjs";

test("an extended M3U: names, lengths, paths; directives and comments skipped", () => {
  const text = [
    "\uFEFF#EXTM3U",
    "#PLAYLIST:Road trip",
    "#EXTINF:252,Lumen Harbor - Night Ferry",
    "C:\\Music\\Lumen Harbor\\Night Ferry\\02 Night Ferry.flac",
    "# a comment",
    "#EXTINF:-1,Just A Title",
    "../Other/song.mp3",
    "D:\\Rips\\05 - Black Pumas - Colors.flac",
    "",
  ].join("\r\n");
  assert.deepEqual(parseM3u(text), [
    { path: "C:\\Music\\Lumen Harbor\\Night Ferry\\02 Night Ferry.flac", artist: "Lumen Harbor", title: "Night Ferry", durationSec: 252 },
    { path: "../Other/song.mp3", title: "Just A Title", durationSec: undefined },
    { path: "D:\\Rips\\05 - Black Pumas - Colors.flac", artist: "Black Pumas", title: "Colors" },
  ]);
});

test("file names stand in for a missing #EXTINF", () => {
  assert.deepEqual(guessFromPath("C:/x/01 - Vela Moss - Weightless.flac"), { artist: "Vela Moss", title: "Weightless" });
  assert.deepEqual(guessFromPath("/music/1-07 Morning Port.mp3"), { title: "Morning Port" });
});

test("export writes files as paths and server songs as notes only ByTune reads back", () => {
  const { text, files, notes } = writeM3u([
    { id: "local:1", title: "Night Ferry", artist: "Lumen Harbor", duration: 252, localPath: "C:\\Music\\02 Night Ferry.flac" },
    { id: "jf:abc", title: "Colors", artist: "Black Pumas", duration: 241 },
  ]);
  assert.deepEqual([files, notes], [1, 1]);
  assert.ok(!/stream|api_key|token|http/i.test(text), "no stream address, no token");
  const back = parseM3u(text);
  assert.deepEqual(back, [
    { path: "C:\\Music\\02 Night Ferry.flac", artist: "Lumen Harbor", title: "Night Ferry", durationSec: 252 },
    { path: "", id: "jf:abc", title: "Colors", artist: "Black Pumas", durationSec: 241 },
  ]);
});

const song = (id, title, artist, extra = {}) => ({ id, title, artist, album: "A", duration: 200, thumb: "", ...extra });

test("import finds songs by id, path, artist + title, and a title only one song has", () => {
  const library = [
    song("local:a", "Night Ferry", "Lumen Harbor", { localPath: "C:\\Music\\Night Ferry.flac" }),
    song("jf:b", "Colors", "Black Pumas"),
    song("jf:c", "Weightless", "Vela Moss, Lumen Harbor"),
    song("jf:d", "Morning Port", "Lumen Harbor", { duration: 303 }),
    song("jf:e", "Intro", "Band One"),
    song("jf:f", "Intro", "Band Two", { duration: 95 }),
  ];
  const byId = new Map(library.map((t) => [t.id, t]));
  const found = matchM3u(
    [
      { path: "c:/music/NIGHT FERRY.flac" }, // path, any case and separator
      { path: "", id: "jf:b", title: "Colors" }, // ByTune's own note
      { path: "x.flac", title: "Weightless", artist: "Vela Moss" }, // artist + title
      { path: "y.flac", title: "Morning Port" }, // the one song with that title
      { path: "z.flac", title: "Intro", durationSec: 96 }, // two "Intro"s: the length decides
      { path: "w.flac", title: "Intro" }, // two and no length: no guess
      { path: "v.flac", title: "Nowhere", artist: "Nobody" },
    ],
    library,
    byId,
    (t) => t
  );
  assert.deepEqual(found.map((t) => t?.id ?? null), ["local:a", "jf:b", "jf:c", "jf:d", "jf:f", null, null]);
});
