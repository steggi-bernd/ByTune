// The artist page's banner (src/lib/artistBanner.ts): the artist's picture blown up least wins —
// Genius's banners come at most 1000 px wide, some only a strip — and the covers come last; and
// the Wikimedia picture's request and answer (electron/wikimedia.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function bundle(file) {
  const out = await build({ entryPoints: [fileURLToPath(new URL(`../${file}`, import.meta.url))], bundle: true, platform: "node", format: "esm", write: false });
  return import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);
}
const { bannerCandidates, geniusSize } = await bundle("src/lib/artistBanner.ts");
const { wikimediaFile, imageInfoUrl, pictureFromImageInfo, BANNER_WIDTH } = await bundle("electron/wikimedia.ts");

const wiki = (width, height) => ({ url: `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/${width}px-A.jpg`, width, height });

test("Genius writes a picture's size into its name", () => {
  assert.deepEqual(geniusSize("https://images.genius.com/0123abcd.1000x562x1.jpg"), { width: 1000, height: 562 });
  assert.deepEqual(geniusSize("https://images.genius.com/0123abcd.1000x165x1.png?x=1"), { width: 1000, height: 165 });
  assert.equal(geniusSize("https://images.genius.com/0123abcd.jpg"), null);
});

test("the Wikimedia picture at banner size beats Genius's 1000 px banner; the stored photo, then the covers last", () => {
  const list = bannerCandidates({
    picture: wiki(1920, 1280),
    genius: { banner: "https://images.genius.com/b.1000x562x1.jpg", photo: "https://images.genius.com/p.1000x1000x1.jpg" },
    photo: "localart://artist-a",
    covers: ["localart://cover-1", undefined, "localart://cover-1"],
  });
  assert.deepEqual(list, [
    wiki(1920, 1280).url,
    "https://images.genius.com/b.1000x562x1.jpg",
    "https://images.genius.com/p.1000x1000x1.jpg",
    "localart://artist-a",
    "localart://cover-1",
  ]);
});

test("a small Wikimedia original loses to Genius's banner; a strip of a banner loses to a photo", () => {
  const banner = "https://images.genius.com/b.1000x562x1.jpg";
  assert.equal(bannerCandidates({ picture: wiki(800, 600), genius: { banner, photo: null }, photo: null, covers: [] })[0], banner);
  const strip = "https://images.genius.com/s.1000x165x1.jpg";
  const photo = "https://images.genius.com/p.1000x1000x1.jpg";
  assert.deepEqual(bannerCandidates({ picture: null, genius: { banner: strip, photo }, photo: null, covers: [] }), [photo, strip]);
});

test("without web pictures the stored photo leads, the cover after it; nothing at all, nothing", () => {
  assert.deepEqual(bannerCandidates({ picture: null, genius: null, photo: "localart://p", covers: ["localart://c"] }), ["localart://p", "localart://c"]);
  assert.deepEqual(bannerCandidates({ picture: null, genius: null, photo: null, covers: [null, ""] }), []);
});

test("a Wikimedia address names its wiki and file — Commons, or a Wikipedia's own", () => {
  assert.deepEqual(wikimediaFile("https://upload.wikimedia.org/wikipedia/commons/a/ab/Daft_Punk_in_2013.jpg"), {
    host: "commons.wikimedia.org",
    file: "Daft_Punk_in_2013.jpg",
  });
  assert.deepEqual(wikimediaFile("https://upload.wikimedia.org/wikipedia/en/thumb/1/1d/Band%C3%A9.jpg/320px-Band%C3%A9.jpg"), {
    host: "en.wikipedia.org",
    file: "Bandé.jpg",
  });
  assert.equal(wikimediaFile("https://images.genius.com/x.jpg"), null);
  const url = imageInfoUrl("commons.wikimedia.org", "A b.jpg");
  assert.ok(url.startsWith("https://commons.wikimedia.org/w/api.php?"));
  assert.ok(url.includes(`iiurlwidth=${BANNER_WIDTH}`));
  assert.ok(url.includes("titles=File%3AA%20b.jpg"));
});

test("the image-info answer: the scaled copy where there is one, else the original; nothing usable, nothing", () => {
  const big = { query: { pages: [{ imageinfo: [{ width: 4000, height: 3000, url: "https://upload.wikimedia.org/o.jpg", thumburl: "https://upload.wikimedia.org/1920px-o.jpg", thumbwidth: 1920, thumbheight: 1440 }] }] } };
  assert.deepEqual(pictureFromImageInfo(big), { url: "https://upload.wikimedia.org/1920px-o.jpg", width: 1920, height: 1440 });
  // The older answer shape keys its pages by id; a small original comes as it is.
  const small = { query: { pages: { 123: { imageinfo: [{ width: 640, height: 480, url: "https://upload.wikimedia.org/s.jpg" }] } } } };
  assert.deepEqual(pictureFromImageInfo(small), { url: "https://upload.wikimedia.org/s.jpg", width: 640, height: 480 });
  assert.equal(pictureFromImageInfo({ query: { pages: [{ missing: true }] } }), null);
  assert.equal(pictureFromImageInfo({ query: { pages: [{ imageinfo: [{ width: 9, height: 9, url: "http://insecure/x.jpg" }] }] } }), null);
  assert.equal(pictureFromImageInfo(null), null);
});
