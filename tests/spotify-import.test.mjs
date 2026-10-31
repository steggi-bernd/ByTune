import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDecisions,
  entryKey,
  matchEntries,
  parseCsv,
  parseSpotifyExport,
  shoppingListCsv,
  shoppingListText,
  spotifyLink,
} from "../.test-build/spotifyImport.mjs";

const EXPORTIFY = [
  '"Track URI","Track Name","Album Name","Artist Name(s)","Release Date","Duration (ms)","Popularity","Explicit","Added By","Added At"',
  '"spotify:track:1111111111aaaaaaaaaaaa","Song A","Album X","Artist One,Artist Two","2020-01-01","200000","50","false","","2024-03-01T10:00:00Z"',
  '"spotify:track:2222222222bbbbbbbbbbbb","Song B - Remastered 2011","Album Y","The Band","1975","180000","40","false","","2025-06-01T10:00:00Z"',
  '"spotify:track:3333333333cccccccccccc","Song ""Quoted"", Live","Album Z","Solo","2019","90000","10","false","","2023-01-01T10:00:00Z"',
].join("\r\n");

/* ------------------------------------------------------------ reading */

test("CSV: quotes, commas and line breaks inside fields, a BOM and a semicolon separator", () => {
  assert.deepEqual(parseCsv('a,b\n"x, y","he said ""hi"""\n'), [["a", "b"], ["x, y", 'he said "hi"']]);
  assert.deepEqual(parseCsv('﻿a;b\r\n"one\ntwo";3'), [["a", "b"], ["one\ntwo", "3"]]);
});

test("an Exportify export comes out newest like first, artists split", () => {
  const { entries, dated } = parseSpotifyExport(EXPORTIFY, "liked_songs.csv");
  assert.equal(dated, true);
  assert.deepEqual(entries.map((e) => e.title), ["Song B - Remastered 2011", "Song A", 'Song "Quoted", Live']);
  assert.deepEqual(entries[1].artists, ["Artist One", "Artist Two"]);
  assert.equal(entries[1].durationMs, 200000);
  assert.equal(entries[1].album, "Album X");
});

test("Spotify's YourLibrary.json keeps the file's order and has no dates", () => {
  const json = JSON.stringify({
    tracks: [
      { artist: "Alpha", album: "First", track: "One", uri: "spotify:track:aaaaaaaaaaaaaaaaaaaaaa" },
      { artist: "Beta", album: "Second", track: "Two", uri: "spotify:track:bbbbbbbbbbbbbbbbbbbbbb" },
    ],
    albums: [],
  });
  const { entries, dated } = parseSpotifyExport(json, "YourLibrary.json");
  assert.equal(dated, false);
  assert.deepEqual(entries.map((e) => e.title), ["One", "Two"]);
  assert.deepEqual(entries[0].artists, ["Alpha"]);
});

test("a file that isn't a Liked Songs export says so", () => {
  assert.throws(() => parseSpotifyExport("name,size\nfoo,1\n", "other.csv"), /track name and artist/);
  assert.throws(() => parseSpotifyExport("{}", "x.json"), /No songs/);
});

test("the same song listed twice under one URI counts once", () => {
  const csv = `${EXPORTIFY}\r\n"spotify:track:1111111111aaaaaaaaaaaa","Song A","Album X","Artist One","2020","200000","1","false","","2022-01-01T00:00:00Z"`;
  assert.equal(parseSpotifyExport(csv, "l.csv").entries.length, 3);
});

/* ------------------------------------------------------------ matching */

const lib = (over) => ({ id: `local:${over.title}`, artist: "The Band", album: "Album Y", duration: 180, thumb: "", source: "local", ...over });
const entry = (over) => ({ title: "Song", artists: ["The Band"], album: "Album Y", durationMs: 180000, ...over });

test("same title and artist is a match — Spotify's \"- Remastered\" and a leading \"The\" don't matter", () => {
  const [row] = matchEntries([entry({ title: "Song B - Remastered 2011", artists: ["Band"] })], [lib({ title: "Song B" })]);
  assert.equal(row.kind, "match");
  assert.equal(row.track.title, "Song B");
});

test("a differing title suffix, length or artist spelling asks the user", () => {
  const library = [
    lib({ title: "Song C", album: "Album Z", duration: 240 }),
    lib({ title: "Song D", album: "Other", duration: 200 }),
    lib({ title: "Song E", artist: "THE FINALS", album: "OST" }),
  ];
  const rows = matchEntries(
    [
      entry({ title: "Song C - Radio Edit", durationMs: 200000 }),
      entry({ title: "Song D", album: "Album Y", durationMs: 300000 }),
      entry({ title: "Song E", artists: ["Embark Studios"], album: "OST" }),
    ],
    library
  );
  assert.deepEqual(rows.map((r) => [r.kind, r.reason]), [
    ["check", "title"],
    ["check", "length"],
    ["check", "artist"],
  ]);
});

test("among several copies the one on the same album wins", () => {
  const [row] = matchEntries(
    [entry({ title: "Hit", album: "Greatest Hits" })],
    [lib({ title: "Hit", album: "Debut", id: "local:debut" }), lib({ title: "Hit", album: "Greatest Hits", id: "local:best" })]
  );
  assert.equal(row.kind, "match");
  assert.equal(row.track.id, "local:best");
});

test("a song nowhere in the library is missing", () => {
  const [row] = matchEntries([entry({ title: "Unknown Gem", artists: ["Nobody"] })], [lib({ title: "Song" })]);
  assert.equal(row.kind, "missing");
  assert.equal(row.track, undefined);
});

/* ------------------------------------------------------------ the user's word */

test("decisions settle uncertain rows and follow the song into a fresh export", () => {
  const library = [lib({ title: "Song C", album: "Album Z", duration: 240 }), lib({ title: "Elsewhere", id: "local:else" })];
  const entries = [
    entry({ title: "Song C - Radio Edit", uri: "spotify:track:cccccccccccccccccccccc" }),
    entry({ title: "Song C - Live", uri: "spotify:track:dddddddddddddddddddddd" }),
    entry({ title: "Renamed In My Files", artists: ["Nobody"], uri: "spotify:track:eeeeeeeeeeeeeeeeeeeeee" }),
  ];
  const rows = matchEntries(entries, library);
  assert.deepEqual(rows.map((r) => r.kind), ["check", "check", "missing"]);
  const decisions = {
    verdicts: { [entryKey(entries[0])]: "same", [entryKey(entries[1])]: "different" },
    picks: { [entryKey(entries[2])]: "local:else" },
  };
  const byId = (id) => library.find((t) => t.id === id);
  const settled = applyDecisions(rows, decisions, byId);
  assert.deepEqual(settled.map((r) => [r.kind, r.decided]), [
    ["match", "same"],
    ["missing", "different"],
    ["match", "picked"],
  ]);
  assert.equal(settled[2].track.id, "local:else");
  // A fresh export of the same songs (new row order) keeps the decisions — they follow the Spotify URI.
  const fresh = matchEntries([entries[2], entries[0]], library);
  assert.deepEqual(applyDecisions(fresh, decisions, byId).map((r) => r.decided), ["picked", "same"]);
});

test("a song without a URI is known by its title and artists", () => {
  assert.equal(entryKey({ title: "Déjà Vu", artists: ["Alpha", "Beta"], album: "" }), "deja vu|alpha,beta");
});

/* ------------------------------------------------------------ the shopping list */

test("the shopping list opens in Excel: BOM, semicolons, quoted fields, Spotify links", () => {
  const csv = shoppingListCsv([
    { title: "A; B", artists: ["X", "Y"], album: 'The "Best"', addedAt: Date.parse("2024-03-01T10:00:00Z"), uri: "spotify:track:1111111111aaaaaaaaaaaa" },
  ]);
  assert.ok(csv.startsWith("﻿Title;Artist;Album;Liked on Spotify;Spotify link\r\n"));
  assert.ok(csv.includes('"A; B";X, Y;"The ""Best""";2024-03-01;https://open.spotify.com/track/1111111111aaaaaaaaaaaa'));
  assert.equal(shoppingListText([{ title: "Song", artists: ["Band"], album: "LP" }]), "Band – Song (LP)");
  assert.equal(spotifyLink("spotify:local:x:y:z:1"), "");
});
