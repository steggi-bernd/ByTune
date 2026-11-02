// About a song and its artist from Genius (electron/song-info.ts): what the panel takes from a
// song object, which artist hit counts, and what is remembered — an answer, a miss, but never
// an offline moment. Genius itself is a stub here.
import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const out = await build({
  entryPoints: [fileURLToPath(new URL("../electron/song-info.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "stubs",
      setup(b) {
        b.onResolve({ filter: /^\.\/(persist|lyrics)$/ }, (a) => ({ path: a.path.slice(2), namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
          loader: "js",
          contents: {
            persist: "export const readData = () => globalThis.__disk ?? null; export const writeData = async (n, v) => { globalThis.__disk = v; };",
            lyrics: `export const GENIUS_HEADERS = {};
              export const geniusFindSong = async (title, artist) => { globalThis.__asked.push(["find", title, artist]); return globalThis.__find(title, artist); };
              export const getText = async (url) => { globalThis.__asked.push(["get", url]); return globalThis.__get(url); };`,
          }[a.path],
        }));
      },
    },
  ],
});
const info = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const SONG = {
  title: "Get Lucky",
  url: "https://genius.com/Daft-punk-get-lucky-lyrics",
  description: { plain: "The lead single from Random Access Memories." },
  release_date_for_display: "April 19, 2013",
  album: { name: "Random Access Memories" },
  writer_artists: [{ name: "Thomas Bangalter" }, { name: "Pharrell Williams" }],
  producer_artists: [{ name: "Daft Punk" }],
  custom_performances: [
    { label: "Guitar", artists: [{ name: "Nile Rodgers" }] },
    { label: "Empty", artists: [] },
  ],
  song_relationships: [
    { relationship_type: "samples", songs: [{ title: "Old Tune", artist_names: "Someone" }] },
    { relationship_type: "covered_by", songs: [{ title: "Get Lucky (Cover)", artist_names: "Band" }] },
  ],
  recording_location: "Electric Lady Studios",
};

beforeEach(() => {
  globalThis.__asked = [];
  globalThis.__disk = null;
});

test("a Genius song as the panel shows it: credits written, produced, then the rest; samples, not covers", () => {
  const s = info.songFromGenius(SONG, "https://fallback");
  assert.equal(s.description, "The lead single from Random Access Memories.");
  assert.equal(s.released, "April 19, 2013");
  assert.equal(s.album, "Random Access Memories");
  assert.deepEqual(s.credits, [
    { label: "Written by", names: ["Thomas Bangalter", "Pharrell Williams"] },
    { label: "Produced by", names: ["Daft Punk"] },
    { label: "Guitar", names: ["Nile Rodgers"] },
  ]);
  assert.deepEqual(s.samples, [{ title: "Old Tune", artist: "Someone" }]);
  assert.equal(s.recordedAt, "Electric Lady Studios");
  assert.equal(s.url, SONG.url);
  // A song without a story reads "?" on Genius; text is bounded.
  const bare = info.songFromGenius({ description: { plain: "?" }, title: "x".repeat(500) }, "https://fallback");
  assert.equal(bare.description, null);
  assert.equal(bare.title.length, 200);
  assert.equal(bare.url, "https://fallback");
  assert.equal(info.songFromGenius(null, "x"), null);
});

test("only an artist of exactly that name counts; Genius's stand-in pictures are no picture", () => {
  const sections = [
    { type: "song", hits: [] },
    {
      type: "artist",
      hits: [
        { result: { name: "Daft Punk Tribute", image_url: "https://images.genius.com/a.png", header_image_url: "https://images.genius.com/b.jpg" } },
        { result: { name: "Daft  Punk", image_url: "https://images.genius.com/p.png", header_image_url: "https://images.genius.com/h.jpg", url: "https://genius.com/artists/Daft-punk" } },
      ],
    },
  ];
  assert.deepEqual(info.artistFromGenius(sections, "daft punk"), {
    name: "Daft  Punk",
    photo: "https://images.genius.com/p.png",
    banner: "https://images.genius.com/h.jpg",
    url: "https://genius.com/artists/Daft-punk",
  });
  assert.equal(info.artistFromGenius(sections, "Daft"), null);
  const defaults = [{ type: "artist", hits: [{ result: { name: "Nobody", image_url: "https://assets.genius.com/images/default_avatar_300.png", header_image_url: "https://assets.genius.com/images/default_cover_image.png" } }] }];
  assert.equal(info.artistFromGenius(defaults, "Nobody"), null);
  const standInBanner = [{ type: "artist", hits: [{ result: { name: "Plain", image_url: "https://images.genius.com/p.png", header_image_url: "https://assets.genius.com/images/default_banner.png" } }] }];
  assert.equal(info.artistFromGenius(standInBanner, "Plain").banner, null);
  // A header that is the photo again is no banner.
  const same = [{ type: "artist", hits: [{ result: { name: "Solo", image_url: "https://images.genius.com/s.png", header_image_url: "https://images.genius.com/s.png" } }] }];
  assert.equal(info.artistFromGenius(same, "Solo").banner, null);
  assert.equal(info.artistFromGenius(undefined, "Solo"), null);
});

test("names match across case, accents, '&' and any script", () => {
  assert.equal(info.sameName("Beyoncé", "BEYONCE"), true);
  assert.equal(info.sameName("Simon & Garfunkel", "Simon and Garfunkel"), true);
  assert.equal(info.sameName("Кино", "кино"), true);
  assert.equal(info.sameName("Кино", "Кин"), false);
  assert.equal(info.sameName("", ""), false);
});

test("answers and misses are remembered, an offline moment is not", async () => {
  // Offline: Genius didn't answer — asked again next time.
  globalThis.__find = async () => undefined;
  assert.equal(await info.songInfo("Song A", "Band"), null);
  assert.equal(await info.songInfo("Song A", "Band"), null);
  assert.equal(globalThis.__asked.filter((a) => a[0] === "find").length, 2);

  // Answered without a match: remembered.
  globalThis.__asked = [];
  globalThis.__find = async () => null;
  assert.equal(await info.songInfo("Song B", "Band"), null);
  assert.equal(await info.songInfo("Song B", "Band"), null);
  assert.equal(globalThis.__asked.length, 1);

  // A match: its details asked once, then from memory.
  globalThis.__asked = [];
  globalThis.__find = async () => ({ id: 139968, url: "https://genius.com/x" });
  globalThis.__get = async (url) => (url.includes("/api/songs/139968") ? JSON.stringify({ response: { song: SONG } }) : null);
  const first = await info.songInfo("Get Lucky", "Daft Punk");
  const again = await info.songInfo("get lucky", "daft punk");
  assert.equal(first.album, "Random Access Memories");
  assert.deepEqual(again, first);
  assert.deepEqual(globalThis.__asked.map((a) => a[0]), ["find", "get"]);

  // Artist images: an unanswered search isn't remembered either.
  globalThis.__asked = [];
  globalThis.__get = async () => null;
  assert.equal(await info.artistImages("Daft Punk"), null);
  globalThis.__get = async () => JSON.stringify({ response: { sections: [{ type: "artist", hits: [{ result: { name: "Daft Punk", image_url: "https://images.genius.com/p.png" } }] }] } });
  assert.equal((await info.artistImages("Daft Punk")).photo, "https://images.genius.com/p.png");
  assert.equal(globalThis.__asked.length, 2);
});
