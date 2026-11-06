import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDecisions,
  completePlaylist,
  entryKey,
  importOrder,
  matchEntries,
  mergeImportedPlaylist,
  parseCsv,
  parsePlaylistExport,
  parseSpotifyExport,
  playlistNameOf,
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

test("Add lays out the matches, plus liked songs still to check in their Spotify place", () => {
  const library = [lib({ title: "New" }), lib({ title: "Liked Before", duration: 300 }), lib({ title: "Unsure", duration: 300 }), lib({ title: "Old" })];
  const entries = [
    entry({ title: "New" }),
    entry({ title: "Liked Before", album: "Single" }), // two minutes off, another album: to check
    entry({ title: "Unsure", album: "Single" }),
    entry({ title: "Old" }),
    entry({ title: "Old - Live" }), // to check, but "Old" itself is a match further up
  ];
  const rows = matchEntries(entries, library);
  assert.deepEqual(rows.map((r) => r.kind), ["match", "check", "check", "match", "check"]);
  const liked = new Set(["local:Liked Before", "local:Old"]);
  assert.deepEqual(importOrder(rows, liked, (id) => id).map((t) => t.title), ["New", "Liked Before", "Old"]);
  assert.deepEqual(importOrder(rows, new Set(), (id) => id).map((t) => t.title), ["New", "Old"], "nothing unliked is added unchecked");
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

/* ------------------------------------------------------------ playlists */

test("a playlist's Exportify CSV keeps the playlist's order and is named after its file", () => {
  const [list, ...more] = parsePlaylistExport(EXPORTIFY, "road_trip_2019.csv");
  assert.equal(more.length, 0);
  assert.equal(list.name, "Road trip 2019");
  assert.deepEqual(list.entries.map((e) => e.title), ["Song A", "Song B - Remastered 2011", 'Song "Quoted", Live']);
  assert.equal(playlistNameOf("C:\\Downloads\\chill.csv"), "Chill");
  assert.equal(playlistNameOf(".csv"), "Spotify playlist");
});

test("Spotify's Playlist1.json: every playlist with songs, in order — local files too, episodes not", () => {
  const json = JSON.stringify({
    playlists: [
      {
        name: "Road Trip",
        items: [
          { track: { trackName: "One", artistName: "Alpha", albumName: "First", trackUri: "spotify:track:aaaaaaaaaaaaaaaaaaaaaa" }, addedDate: "2021-02-01" },
          { track: null, episode: { episodeName: "Talk", showName: "Show" }, localTrack: null },
          { track: null, localTrack: { uri: "spotify:local:The+Band:Home+Tapes:Kitchen+%26+Rain:245" } },
          { track: { trackName: "One", artistName: "Alpha", albumName: "First", trackUri: "spotify:track:aaaaaaaaaaaaaaaaaaaaaa" } },
          { track: { trackName: "Two", artistName: "Beta, Gamma", albumName: "Second", trackUri: "spotify:track:bbbbbbbbbbbbbbbbbbbbbb" } },
        ],
      },
      { name: "Podcasts only", items: [{ track: null, episode: { episodeName: "Talk" } }] },
      { name: "  ", items: [{ track: { trackName: "Three", artistName: "Delta" } }] },
    ],
  });
  const lists = parsePlaylistExport(json, "Playlist1.json");
  assert.deepEqual(lists.map((l) => l.name), ["Road Trip", "Untitled playlist"]);
  const [road] = lists;
  assert.deepEqual(road.entries.map((e) => e.title), ["One", "Kitchen & Rain", "Two"], "a song listed twice counts once");
  assert.deepEqual(road.entries[1], { title: "Kitchen & Rain", artists: ["The Band"], album: "Home Tapes", durationMs: 245000, uri: "spotify:local:The+Band:Home+Tapes:Kitchen+%26+Rain:245" });
  assert.deepEqual(road.entries[2].artists, ["Beta", "Gamma"]);
  assert.equal(road.entries[0].addedAt, Date.parse("2021-02-01"));
  assert.throws(() => parsePlaylistExport(JSON.stringify({ playlists: [] }), "Playlist1.json"), /No playlist with songs/);
});

test("a playlist after an import: Spotify's order first, songs added in ByTune after, each song once", () => {
  const t = (id) => ({ id, title: id, artist: "A", duration: 1, thumb: "" });
  const keyOf = (id) => (id === "b-flac" ? "b" : id);
  const merged = mergeImportedPlaylist([t("x"), t("b"), t("y")], [t("a"), t("b-flac"), t("c")], keyOf);
  assert.deepEqual(merged.map((x) => x.id), ["a", "b-flac", "c", "x", "y"]);
});

/* ------------------------------------------------------------ a recovered playlist finishes itself */

const songOf = (id) => ({ id, title: id, artist: "Band", duration: 200, thumb: "" });
const rowOf = (id, kind = "match") => ({ entry: { title: id, artists: ["Band"], album: "", uri: `spotify:track:${id}` }, kind, track: kind === "missing" ? undefined : songOf(id) });
const key = (id) => `spotify:track:${id}`;
const same = (id) => id;

test("a song found later goes to its place in the export", () => {
  const current = [songOf("a"), songOf("c")];
  const { tracks, done, added } = completePlaylist(current, [rowOf("a"), rowOf("b"), rowOf("c")], new Set([key("a"), key("c")]), same);
  assert.deepEqual(tracks.map((t) => t.id), ["a", "b", "c"]);
  assert.deepEqual(done, [key("b")]);
  assert.equal(added, 1);
});

test("the first songs of an export go on top; songs added here stay where they are", () => {
  const current = [songOf("b"), songOf("mine")];
  const { tracks } = completePlaylist(current, [rowOf("a"), rowOf("b"), rowOf("c")], new Set([key("b")]), same);
  assert.deepEqual(tracks.map((t) => t.id), ["a", "b", "c", "mine"]);
});

test("a song taken out by hand stays out", () => {
  const current = [songOf("a")];
  const { tracks, added } = completePlaylist(current, [rowOf("a"), rowOf("b")], new Set([key("a"), key("b")]), same);
  assert.equal(added, 0);
  assert.equal(tracks, current);
});

test("songs to check and songs still missing wait", () => {
  const current = [songOf("a")];
  const { tracks, done, added } = completePlaylist(current, [rowOf("a"), rowOf("b", "check"), rowOf("c", "missing")], new Set([key("a")]), same);
  assert.equal(added, 0);
  assert.equal(tracks, current);
  assert.deepEqual(done, []);
});

test("an arrangement made since stays: the new song follows the song before it, wherever that went", () => {
  const current = [songOf("c"), songOf("a")];
  const { tracks } = completePlaylist(current, [rowOf("a"), rowOf("b"), rowOf("c")], new Set([key("a"), key("c")]), same);
  assert.deepEqual(tracks.map((t) => t.id), ["c", "a", "b"]);
});

test("a song already there under another copy counts as there", () => {
  const copies = { "local:b": "b", "jf:b": "b" };
  const keyOf = (id) => copies[id] ?? id;
  const row = { entry: { title: "b", artists: ["Band"], album: "", uri: key("b") }, kind: "match", track: songOf("local:b") };
  const current = [songOf("jf:b")];
  const { added, done } = completePlaylist(current, [row], new Set(), keyOf);
  assert.equal(added, 0);
  assert.deepEqual(done, [key("b")]);
});
