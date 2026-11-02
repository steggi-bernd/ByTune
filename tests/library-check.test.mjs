// The library check (src/lib/libraryCheck.ts) and artist spellings (src/lib/albumEdits.ts
// applyArtistAliases): what counts as one artist, which album parts belong together, which copy
// plays, what's missing — and that a spelling only changes the names it is about.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function bundle(file) {
  const out = await build({ entryPoints: [fileURLToPath(new URL(`../${file}`, import.meta.url))], bundle: true, platform: "node", format: "esm", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}
const { artistSpellings, missingDetails, spareCopies, spellingKey, splitAlbums } = await bundle("src/lib/libraryCheck.ts");
const { applyArtistAliases } = await bundle("src/lib/albumEdits.ts");

let n = 0;
const song = (artist, extra = {}) => ({ id: `t${n++}`, title: `Song ${n}`, artist, duration: 200, thumb: "", ...extra });
const album = (title, artist, tracks, extra = {}) => ({ key: `${artist}|${title}`.toLowerCase(), route: title, title, artist, kind: "album", thumb: "cover.jpg", year: 2020, tracks, addedAt: 0, duration: 0, ...extra });

test("case, accents, a leading 'The', '&' and punctuation don't make another artist", () => {
  assert.equal(spellingKey("The Beatles"), spellingKey("Beatles"));
  assert.equal(spellingKey("Beyoncé"), spellingKey("beyonce"));
  assert.equal(spellingKey("Simon & Garfunkel"), spellingKey("Simon and Garfunkel"));
  assert.equal(spellingKey("AC/DC"), spellingKey("ACDC"));
  assert.notEqual(spellingKey("Bono"), spellingKey("Bo"));
});

test("an artist under two spellings is found, the most used one suggested", () => {
  const tracks = [song("Beyoncé"), song("Beyoncé"), song("Beyoncé, Jay-Z"), song("Beyonce"), song("Jay-Z")];
  const groups = artistSpellings(tracks);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].suggested, "Beyoncé");
  assert.deepEqual(groups[0].names.map((s) => [s.name, s.songs]), [["Beyoncé", 3], ["Beyonce", 1]]);
});

test("equally used, the spelling with accents is suggested", () => {
  const groups = artistSpellings([song("Sigur Ros"), song("Sigur Rós")]);
  assert.equal(groups[0].suggested, "Sigur Rós");
});

test("album parts by the same artist belong together, into the part with the most songs", () => {
  const main = album("Neon Tidewater", "The Quiet Arcades", [song("a"), song("a"), song("a")]);
  const bonus = album("Neon Tidewater (Bonus Tracks)", "The Quiet Arcades", [song("a")]);
  const disc2 = album("Neon Tidewater - Disc 2", "Quiet Arcades", [song("a")]);
  const other = album("Neon Tidewater", "Someone Else", [song("b")]);
  const [split, ...rest] = splitAlbums([bonus, main, other, disc2]);
  assert.equal(rest.length, 0);
  assert.equal(split.into, main);
  assert.deepEqual(split.parts.map((p) => p.title).sort(), ["Neon Tidewater (Bonus Tracks)", "Neon Tidewater - Disc 2"]);
});

test("a song on this computer twice: the first file plays, the others are spare; a server copy doesn't count", () => {
  const flac = song("A", { localPath: "D:/Music/a.flac" });
  const mp3 = song("A", { localPath: "D:/Music/old/a.mp3" });
  const stream = song("A", { id: "jf:1" });
  const lone = song("B", { localPath: "D:/Music/b.flac" });
  const versions = new Map([[flac.id, [flac, mp3, stream]], [lone.id, [lone, stream]]]);
  const spares = spareCopies([flac, lone], (t) => versions.get(t.id) ?? [t]);
  assert.equal(spares.length, 1);
  assert.equal(spares[0].keep, flac);
  assert.deepEqual(spares[0].spare, [mp3]);
});

test("albums without a cover, a year or a genre", () => {
  const ok = album("Fine", "A", [song("A", { genre: "Pop" })]);
  const bare = album("Bare", "A", [song("A")], { thumb: "", year: undefined });
  const missing = missingDetails([ok, bare]);
  assert.deepEqual([missing.cover, missing.year, missing.genre].map((l) => l.map((a) => a.title)), [["Bare"], ["Bare"], ["Bare"]]);
});

test("a spelling changes only the names it is about, in artist and album artist", () => {
  const featured = song("Beyonce feat. Jay-Z", { albumArtist: "Beyonce" });
  const bono = song("Bono");
  const plain = song("Jay-Z");
  const [a, b, c] = applyArtistAliases([featured, bono, plain], { Beyonce: "Beyoncé", Bo: "Bo Diddley" });
  assert.equal(a.artist, "Beyoncé feat. Jay-Z");
  assert.equal(a.albumArtist, "Beyoncé");
  assert.equal(b, bono, "'Bo' is not part of 'Bono'");
  assert.equal(c, plain);
  assert.deepEqual(applyArtistAliases([featured], {}), [featured]);
  const [dollar] = applyArtistAliases([song("ASAP Rocky")], { "ASAP Rocky": "A$AP Rocky" });
  assert.equal(dollar.artist, "A$AP Rocky");
});
