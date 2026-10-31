import assert from "node:assert/strict";
import { test } from "node:test";
import { storeLinks } from "../.test-build/storeLinks.mjs";

const song = { title: "Colors", artists: ["Black Pumas", "Someone Else"] };

test("store searches use the lead artist and title, in the user's country", () => {
  const links = Object.fromEntries(storeLinks(song, "de-DE").map((l) => [l.store, l.url]));
  assert.deepEqual(Object.keys(links), ["Qobuz", "Bandcamp", "7digital", "Amazon"]);
  assert.equal(links.Qobuz, "https://www.qobuz.com/de-de/search/tracks/Black%20Pumas%20Colors");
  assert.equal(links.Bandcamp, "https://bandcamp.com/search?q=Black%20Pumas%20Colors&item_type=t");
  assert.equal(links["7digital"], "https://de.7digital.com/search?q=Black%20Pumas%20Colors");
  assert.equal(links.Amazon, "https://www.amazon.de/s?k=Black%20Pumas%20Colors&i=digital-music");
});

test("other countries, a bare language and an unknown place", () => {
  assert.match(storeLinks(song, "de-AT")[0].url, /qobuz\.com\/at-de\//);
  assert.match(storeLinks(song, "en-GB")[2].url, /^https:\/\/uk\.7digital\.com\//);
  assert.match(storeLinks(song, "en")[3].url, /amazon\.com\//);
  assert.match(storeLinks(song, "pt-BR")[0].url, /qobuz\.com\/us-en\//);
});

test("a title with characters of its own stays one search", () => {
  const url = storeLinks({ title: "Fern & Stone #2?", artists: ["Mira Kestrel"] }, "de-DE")[1].url;
  assert.equal(url, "https://bandcamp.com/search?q=Mira%20Kestrel%20Fern%20%26%20Stone%20%232%3F&item_type=t");
});
