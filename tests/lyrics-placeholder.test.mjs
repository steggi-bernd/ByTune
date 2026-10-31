import assert from "node:assert/strict";
import { test } from "node:test";
import { isPlaceholderFetched, isPlaceholderLyrics, lyricsFromText } from "../.test-build/lyrics.mjs";

test("an instrumental's \"no lyrics\" line counts as no lyrics, in every spelling the providers use", () => {
  for (const said of [
    ["纯音乐，请欣赏"], // KuGou
    ["此歌曲为没有填词的纯音乐，请您欣赏"], // NetEase, via Portato
    ["純音樂，請欣賞"], // traditional characters
    ["纯音乐"],
    ["暂无歌词"],
    ["[Instrumental]"],
    ["♪ Instrumental ♪"],
    ["作曲 : 某人", "纯音乐，请欣赏"], // with the credit some catalogues put on top
    ["", "纯音乐，请欣赏", ""], // gap markers around it
  ]) {
    assert.equal(isPlaceholderLyrics(said), true, JSON.stringify(said));
  }
});

test("real lyrics are never taken for the placeholder", () => {
  for (const said of [
    [],
    ["我爱你"],
    ["这不是纯音乐，是一首歌"],
    ["作曲 : 某人"],
    ["Instrumental", "Verse one", "Chorus", "Verse two", "Outro"],
    ["Instrumental break"],
  ]) {
    assert.equal(isPlaceholderLyrics(said), false, JSON.stringify(said));
  }
});

test("lyrics a file or a server carries are skipped when they only say there are none", () => {
  assert.equal(lyricsFromText("Embedded lyrics", "[00:01.58]纯音乐，请欣赏"), null);
  assert.equal(lyricsFromText("Jellyfin", "此歌曲为没有填词的纯音乐，请您欣赏"), null);
  const real = lyricsFromText("Song.lrc", "[00:01.00]First line\n[00:05.00]Second line");
  assert.deepEqual(real.synced.filter((l) => l.text).map((l) => l.text), ["First line", "Second line"]);
});

test("what older versions cached for an instrumental is recognised", () => {
  const kugou = { source: "KuGou", wordSynced: false, synced: [{ time: 1.58, text: "纯音乐，请欣赏" }], plain: null };
  const portato = { source: "Portato", wordSynced: false, synced: [{ time: 0, text: "此歌曲为没有填词的纯音乐，请您欣赏" }], plain: null };
  const genius = { source: "Genius", wordSynced: false, synced: null, plain: "Game on, Throw down\nCash out, Rockstar" };
  assert.equal(isPlaceholderFetched(kugou), true);
  assert.equal(isPlaceholderFetched(portato), true);
  assert.equal(isPlaceholderFetched(genius), false);
});
