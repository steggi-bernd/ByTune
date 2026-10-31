import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeDuplicates, withoutOtherCopies } from "../.test-build/duplicates.mjs";
import { classifyRelease, releaseYear } from "../.test-build/releases.mjs";
import { describePlayback, fmtRate, formatLine } from "../.test-build/playbackFormat.mjs";
import { jellyfinStreamPlan } from "../.test-build/jellyfin-stream.mjs";
import { creditParts, creditedArtists, leadArtist, splitCredits } from "../.test-build/libraryTracks.mjs";

const local = (over = {}) => ({
  id: "local:a",
  title: "Song",
  artist: "Artist",
  album: "Album",
  duration: 200,
  thumb: "localart://a.jpg",
  source: "local",
  localPath: "D:\\Music\\Artist\\Album\\01 Song.flac",
  codec: "FLAC",
  lossless: true,
  sampleRate: 44100,
  bitsPerSample: 16,
  ...over,
});

const jf = (over = {}) => ({
  id: "jf:1",
  title: "Song",
  artist: "Artist",
  album: "Album",
  duration: 201,
  thumb: "jfart://1/tag",
  source: "jellyfin",
  container: "flac",
  codec: "flac",
  sampleRate: 96000,
  bitsPerSample: 24,
  ...over,
});

/* ------------------------------------------------------------ duplicates */

test("a local file and its Jellyfin copy become one song that plays the local file first", () => {
  const { tracks, versions } = mergeDuplicates([local(), jf()]);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].id, "local:a");
  assert.deepEqual(versions.get("jf:1").map((v) => v.id), ["local:a", "jf:1"]);
  assert.equal(versions.get("local:a"), versions.get("jf:1"), "every version id finds the same group");
});

test("case, accents, punctuation and feat. credits don't split a song", () => {
  const { tracks } = mergeDuplicates([
    local({ title: "Déjà Vu (feat. Guest)", artist: "Artist feat. Guest" }),
    jf({ title: "deja vu", artist: "Artist, Guest" }),
  ]);
  assert.equal(tracks.length, 1);
});

test("lengths more than a few seconds apart are different recordings", () => {
  assert.equal(mergeDuplicates([local(), jf({ duration: 260 })]).tracks.length, 2);
});

test("the same title on different albums stays two songs (studio vs live)", () => {
  assert.equal(mergeDuplicates([local(), jf({ album: "Live at Wembley" })]).tracks.length, 2);
});

test("two tracks of one album with the same title are not duplicates", () => {
  const a = local({ id: "local:1", title: "Intro", trackNo: 1 });
  const b = local({ id: "local:9", title: "Intro", trackNo: 9 });
  assert.equal(mergeDuplicates([a, b]).tracks.length, 2);
});

test("without an album on one side, only a matching length ties two copies", () => {
  assert.equal(mergeDuplicates([local(), jf({ album: "Unknown album", duration: 200 })]).tracks.length, 1);
  assert.equal(mergeDuplicates([local({ duration: 0 }), jf({ album: "Unknown album", duration: 0 })]).tracks.length, 2);
});

test("among local copies the lossless one plays first; every local copy plays before a stream", () => {
  const mp3 = local({ id: "local:mp3", codec: "MPEG 1 Layer 3", lossless: false, bitrate: 320000, bitsPerSample: undefined, localPath: "E:\\a.mp3" });
  const flac = local({ id: "local:flac" });
  const { versions } = mergeDuplicates([mp3, jf(), flac]);
  assert.deepEqual(versions.get("jf:1").map((v) => v.id), ["local:flac", "local:mp3", "jf:1"]);
});

test("the merged song keeps its first version's album identity and fills other gaps", () => {
  const { tracks } = mergeDuplicates([local({ year: undefined }), jf({ albumArtist: "Someone Else", year: 1999 })]);
  assert.equal(tracks[0].albumArtist, undefined, "album grouping never borrows from another copy");
  assert.equal(tracks[0].year, 1999);
});

test("songs without duplicates pass through untouched, in order", () => {
  const a = local({ id: "local:x", title: "A" });
  const b = jf({ id: "jf:y", title: "B" });
  const c = local({ id: "local:z", title: "C" });
  const merged = mergeDuplicates([a, b, c, jf({ id: "jf:x", title: "A", duration: 200 })]);
  assert.deepEqual(merged.tracks.map((t) => t.id), ["local:x", "jf:y", "local:z"]);
});

/* ------------------------------------------------------------ queues */

/** Song keys as the catalogue gives them: a Jellyfin copy answers with its local file's id. */
const keyOf = (id) => ({ "jf:a": "local:a", "jf:b": "local:b" })[id] ?? id;
const ids = (list) => list.map((t) => t.id);

test("a queue holds one copy of each song — a song is never played twice in a row", () => {
  // How the old album page listed a merged album: every song twice, side by side.
  const old = [{ id: "local:a" }, { id: "jf:a" }, { id: "local:b" }, { id: "jf:b" }, { id: "local:c" }];
  assert.deepEqual(ids(withoutOtherCopies(old, keyOf).list), ["local:a", "local:b", "local:c"]);
});

test("the clicked copy is the one that stays", () => {
  const list = [{ id: "local:a" }, { id: "jf:a" }, { id: "local:b" }];
  const r = withoutOtherCopies(list, keyOf, 1);
  assert.deepEqual(ids(r.list), ["jf:a", "local:b"]);
  assert.equal(r.list[r.keep].id, "jf:a");
});

test("collapsing a saved queue keeps the playing entry and its place", () => {
  const old = [{ id: "local:a" }, { id: "jf:a" }, { id: "local:b" }, { id: "jf:b" }, { id: "local:c" }];
  const r = withoutOtherCopies(old, keyOf, 3);
  assert.deepEqual(ids(r.list), ["local:a", "jf:b", "local:c"]);
  assert.equal(r.list[r.keep].id, "jf:b");
});

test("the same copy queued twice is a deliberate repeat and stays", () => {
  const list = [{ id: "local:a" }, { id: "local:c" }, { id: "local:a" }];
  assert.deepEqual(ids(withoutOtherCopies(list, keyOf).list), ["local:a", "local:c", "local:a"]);
});

/* ------------------------------------------------------------ releases */

const songs = (n, minutes = 4, over = {}) =>
  Array.from({ length: n }, (_, i) => local({ id: `local:${i}`, trackNo: i + 1, duration: minutes * 60, ...over }));

test("release type tags decide first", () => {
  assert.equal(classifyRelease("X", "A", songs(12, 4, { releaseType: "ep" })), "ep");
  assert.equal(classifyRelease("X", "A", songs(2, 4, { releaseType: "album compilation" })), "compilation");
  assert.equal(classifyRelease("X", "A", songs(3, 4, { releaseType: "single" })), "single");
  assert.equal(classifyRelease("X", "A", songs(3, 4, { releaseType: "album" })), "album");
});

test("titles mark EPs and singles", () => {
  assert.equal(classifyRelease("Night Drive EP", "A", songs(10)), "ep");
  assert.equal(classifyRelease("Night Drive - EP", "A", songs(10)), "ep");
  assert.equal(classifyRelease("Night Drive (EP)", "A", songs(10)), "ep");
  assert.equal(classifyRelease("Night Drive - Single", "A", songs(10)), "single");
  assert.equal(classifyRelease("Deep", "A", songs(10)), "album");
});

test("size rule: up to 3 short songs is a single, up to 6 an EP, more an album", () => {
  assert.equal(classifyRelease("X", "A", songs(2)), "single");
  assert.equal(classifyRelease("X", "A", songs(5)), "ep");
  assert.equal(classifyRelease("X", "A", songs(10)), "album");
  assert.equal(classifyRelease("X", "A", songs(4, 9)), "album", "over 30 minutes is an album");
});

test("half an album stays an album when its track numbers or total say so", () => {
  assert.equal(classifyRelease("X", "A", songs(2, 4, { trackTotal: 12 })), "album");
  const late = [local({ id: "local:8", trackNo: 8 }), local({ id: "local:9", trackNo: 9 })];
  assert.equal(classifyRelease("X", "A", late), "album");
});

test("various artists releases are compilations", () => {
  assert.equal(classifyRelease("Hits", "Various Artists", songs(20)), "compilation");
});

test("the release year is the original year where tagged", () => {
  assert.equal(releaseYear([local({ year: 2011, originalYear: 1973 })]), 1973);
  assert.equal(releaseYear([local({ year: 2004 }), local({ year: 2003 })]), 2003);
  assert.equal(releaseYear([local()]), undefined);
});

/* ------------------------------------------------------------ playback format */

test("24-bit / 96 kHz FLAC is hi-res lossless", () => {
  const f = describePlayback(local({ bitsPerSample: 24, sampleRate: 96000 }));
  assert.equal(f.lossless, true);
  assert.equal(f.hiRes, true);
  assert.equal(formatLine(f), "FLAC 24-bit / 96 kHz");
});

test("CD-quality FLAC is lossless but not hi-res", () => {
  const f = describePlayback(local());
  assert.equal(f.hiRes, false);
  assert.equal(formatLine(f), "FLAC 16-bit / 44.1 kHz");
});

test("an MP3 is lossy and shows its bit rate", () => {
  const f = describePlayback(local({ codec: "MPEG 1 Layer 3", lossless: false, bitrate: 320000, localPath: "D:\\a.mp3" }));
  assert.equal(f.codec, "MP3");
  assert.equal(f.lossless, false);
  assert.equal(formatLine(f), "MP3 320 kbps");
});

test("a local ALAC file is converted to FLAC without loss", () => {
  const f = describePlayback(local({ codec: "ALAC", localPath: "D:\\a.m4a" }));
  assert.equal(f.codec, "ALAC");
  assert.equal(f.lossless, true);
  assert.match(f.note, /converted to FLAC/);
});

test("local DSD plays as 24-bit / 176.4 kHz PCM", () => {
  const f = describePlayback(local({ codec: "DSD", sampleRate: 2822400, bitsPerSample: 1, localPath: "D:\\a.dsf" }));
  assert.equal(f.codec, "DSD64");
  assert.equal(f.rate, 176400);
  assert.equal(f.hiRes, true);
});

test("Jellyfin FLAC plays as the original file", () => {
  const f = describePlayback(jf());
  assert.equal(f.lossless, true);
  assert.equal(f.hiRes, true);
  assert.equal(f.note, undefined);
});

test("Jellyfin ALAC is transcoded to FLAC and stays lossless; WMA arrives as 320 kbps MP3", () => {
  const alac = describePlayback(jf({ container: "m4a", codec: "alac", bitsPerSample: 16, sampleRate: 44100 }));
  assert.equal(alac.lossless, true);
  assert.match(alac.note, /converted to FLAC by Jellyfin/);
  const wma = describePlayback(jf({ container: "asf", codec: "wmav2", bitsPerSample: undefined }));
  assert.equal(wma.codec, "MP3");
  assert.equal(wma.lossless, false);
  assert.equal(wma.kbps, 320);
});

test("Navidrome transcodes AIFF to 320 kbps MP3", () => {
  const f = describePlayback({ ...jf({ id: "ss:1", source: "subsonic" }), container: "aiff", codec: "AIFF" });
  assert.equal(formatLine(f), "MP3 320 kbps");
});

test("sample rates read like the stores write them", () => {
  assert.equal(fmtRate(44100), "44.1 kHz");
  assert.equal(fmtRate(48000), "48 kHz");
  assert.equal(fmtRate(176400), "176.4 kHz");
});

/* ------------------------------------------------------------ Jellyfin stream plan */

test("Jellyfin sends the original file for everything the player decodes", () => {
  for (const [container, codec] of [["flac", "flac"], ["mp3", "mp3"], ["m4a", "aac"], ["ogg", "vorbis"], ["opus", "opus"], ["wav", "pcm_s16le"], ["mov,mp4,m4a,3gp,3g2,mj2", "aac"]]) {
    assert.equal(jellyfinStreamPlan({ container, codec }), "static", `${container}/${codec}`);
  }
  assert.equal(jellyfinStreamPlan(undefined), "static", "not listed yet");
});

test("Jellyfin transcodes the rest: lossless to FLAC, lossy to MP3", () => {
  for (const [container, codec] of [["m4a", "alac"], ["aiff", "pcm_s16be"], ["ape", "ape"], ["wv", "wavpack"], ["dsf", "dsd_lsbf"], ["asf", "wmalossless"]]) {
    assert.equal(jellyfinStreamPlan({ container, codec }), "flac", `${container}/${codec}`);
  }
  assert.equal(jellyfinStreamPlan({ container: "asf", codec: "wmav2" }), "mp3");
});

/* ------------------------------------------------------------ credits */

test("a credit line splits into linkable artists, keeping band names whole", () => {
  assert.deepEqual(creditParts("Alpha feat. Beta"), [
    { name: "Alpha", sep: " feat. " },
    { name: "Beta", sep: "" },
  ]);
  assert.deepEqual(creditParts("Simon & Garfunkel"), [{ name: "Simon & Garfunkel", sep: "" }]);
  assert.deepEqual(creditParts("Alpha; Beta").map((p) => p.name), ["Alpha", "Beta"]);
  assert.deepEqual(creditParts("Alpha / Beta").map((p) => p.sep), [" / ", ""]);
});

test("comma-separated artists are separate artists, never one long one", () => {
  assert.deepEqual(splitCredits("Carl Strandberg, Olof Strömqvist"), ["Carl Strandberg", "Olof Strömqvist"]);
  assert.deepEqual(splitCredits("Embark Studios, Sailor & I"), ["Embark Studios", "Sailor & I"]);
  assert.deepEqual(splitCredits("Alpha, Beta feat. Gamma"), ["Alpha", "Beta", "Gamma"]);
  assert.equal(leadArtist("Alpha, Beta"), "Alpha");
  assert.deepEqual(
    creditParts("Alpha, Beta feat. Gamma").map((p) => [p.name, p.sep]),
    [["Alpha", ", "], ["Beta", " feat. "], ["Gamma", ""]]
  );
});

test("artists whose name holds a comma stay whole", () => {
  assert.deepEqual(splitCredits("Earth, Wind & Fire"), ["Earth, Wind & Fire"]);
  assert.deepEqual(splitCredits("Tyler, The Creator, Alpha"), ["Tyler, The Creator", "Alpha"]);
  assert.deepEqual(creditParts("Earth, Wind & Fire").map((p) => p.name), ["Earth, Wind & Fire"]);
});

test("an album artist line credits each of its artists", () => {
  const names = creditedArtists({ artist: "Olof Strömqvist", albumArtist: "Carl Strandberg, Olof Strömqvist" });
  assert.ok(names.includes("carl strandberg"));
  assert.ok(names.includes("olof strömqvist"));
});
