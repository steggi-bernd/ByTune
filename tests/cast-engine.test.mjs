/**
 * The audio engine's side of casting (src/lib/audio.ts): while a network
 * player has the music the decks are silent and every store change goes to
 * the player's follower; what the player reports feeds the clock, history
 * and stats; taking the music back plays on here from where it was. Runs the
 * shipped engine on the automix harness's virtual clock.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { boot, decksOf, flushMicrotasks, play, read, sounding, track } from "./automix-harness.mjs";

test("casting: the decks fall silent, the follower gets the queue, the player's reports count, the music comes back", async (t) => {
  const h = await boot({ fadeSeconds: 0 });
  t.after(() => h.restore());
  const { engine } = h;
  const { usePlayer, useLibrary } = engine;
  for (const id of ["A", "B", "C"]) h.setDuration(id, 10);
  await play(h, [track("A", 10), track("B", 10), track("C", 10)]);
  await h.advance(2000);
  assert.equal(sounding(h).length, 1, "A plays here");

  const seen = [];
  engine.handOverToCast((state, prev) => seen.push({ id: state.queue[state.index]?.id, prevId: prev.queue[prev.index]?.id, playing: state.playing }));
  await flushMicrotasks();
  assert.equal(sounding(h).length, 0, "the decks are silent while the player has the music");

  // The queue moves on: the follower hears of it, the decks load nothing.
  usePlayer.getState().next(true);
  await h.advance(500);
  assert.deepEqual(seen.at(-1), { id: "B", prevId: "A", playing: true });
  assert.equal(decksOf(h, "B").length, 0, "B is not loaded here");
  assert.equal(sounding(h).length, 0);

  // The player's reports: the clock runs on between them; the song is heard (history, stats).
  h.events.length = 0;
  engine.castHeard("B", 1, true);
  assert.equal(useLibrary.getState().history[0]?.id, "B");
  assert.deepEqual(h.events.map((e) => [e.type, e.id]), [["start", "B"]]);
  await h.advance(500);
  assert.ok(Math.abs(engine.getPlaybackPosition() - 1.5) < 0.01, `the clock runs on (${engine.getPlaybackPosition()})`);
  for (let pos = 2; pos <= 7; pos++) engine.castHeard("B", pos, true);
  assert.ok(h.events.some((e) => e.type === "progress" && e.id === "B"), "five seconds heard there count as listening");
  engine.castHeard("B", 7.6, false);
  assert.equal(h.events.at(-1).type, "pause");
  await h.advance(1000);
  assert.ok(Math.abs(engine.getPlaybackPosition() - 7.6) < 0.01, "paused, the clock stands");
  engine.castHeard("A", 3, true);
  assert.ok(Math.abs(engine.getPlaybackPosition() - 7.6) < 0.01, "a report about another song changes nothing");

  // The player finished B: the queue moves on as at a local end.
  engine.castTrackEnded();
  assert.equal(read(h).id, "C");
  engine.castHeard("C", 0.5, true);
  usePlayer.getState()._setTime(4, 10);

  // Taken back: this computer plays C on from 0:04 — the same listening, not a new one.
  h.events.length = 0;
  seen.length = 0;
  engine.takeBackFromCast();
  await h.advance(1500);
  const deck = decksOf(h, "C").find((d) => !d.paused);
  assert.ok(deck, "C plays here again");
  assert.ok(deck.currentTime >= 4 && deck.currentTime < 6.5, `from where the player was (${deck.currentTime})`);
  assert.equal(h.events.filter((e) => e.type === "start").length, 0, "not counted as a new play");
  assert.ok(h.events.some((e) => e.type === "resume" && e.id === "C"));
  usePlayer.getState().toggle();
  await h.advance(300);
  assert.equal(seen.length, 0, "the follower hears nothing more");
  assert.ok(engine.getPlaybackPosition() >= 4, "the clock is the deck's again");
});

/** Plays A, B and C here and hands them to a device being followed, with A a good way in. */
async function following(t) {
  const h = await boot({ fadeSeconds: 0 });
  t.after(() => h.restore());
  for (const id of ["A", "B", "C"]) h.setDuration(id, 100);
  await play(h, [track("A", 100), track("B", 100), track("C", 100)]);
  await h.advance(1000);
  h.engine.handOverToCast(() => undefined);
  await flushMicrotasks();
  // What the other device reports, as lib/homeSync.ts shows it.
  h.engine.usePlayer.setState({ position: 42, seekNonce: h.engine.usePlayer.getState().seekNonce + 1 });
  // A real song takes a moment to start: a new source or a pause cuts its play() off until then.
  globalThis.__playTakesMs = 300;
  return h;
}

/** What the sync does when asked to play here: stops following, paused, then starts. */
function askedToPlayHere(h) {
  h.engine.usePlayer.getState().setPlaying(false);
  h.engine.takeBackFromCast();
  h.engine.usePlayer.getState().setPlaying(true);
}

test("the music handed back from another device goes on with the same song, from the same place", async (t) => {
  const h = await following(t);
  const { engine } = h;
  const srcBefore = h.elements.map((e) => e.plays);
  askedToPlayHere(h);
  await h.advance(1500);
  assert.equal(read(h).id, "A", "still the song that was handed over, not the next one");
  const deck = decksOf(h, "A").find((d) => !d.paused);
  assert.ok(deck, "it plays here");
  assert.ok(deck.currentTime >= 42 && deck.currentTime < 45, `from where it was (${deck.currentTime})`);
  assert.equal(h.elements.reduce((sum, e, i) => sum + e.plays - srcBefore[i], 0), 1, "started once");
  assert.equal(h.events.filter((e) => e.type === "start" && e.id === "A").length, 1, "one listening, not a new one for moving it");
  assert.equal(engine.usePlayer.getState().buffering, false);
});

test("a play() cut off by a pause is no broken song", async (t) => {
  const h = await following(t);
  h.engine.takeBackFromCast();
  h.engine.usePlayer.getState().setPlaying(true);
  await h.advance(100);
  h.engine.usePlayer.getState().setPlaying(false);
  await h.advance(1500);
  assert.equal(read(h).id, "A");
  assert.equal(h.engine.usePlayer.getState().playing, false, "it stays paused");
  assert.equal(sounding(h).length, 0);
  assert.equal(h.engine.usePlayer.getState().error, null);
});

test("while a load is on its way a new song wins, and a seek goes along with it", async (t) => {
  const h = await following(t);
  const { usePlayer } = h.engine;
  askedToPlayHere(h);
  usePlayer.getState().seek(60);
  await h.advance(1000);
  let deck = decksOf(h, "A").find((d) => !d.paused);
  assert.ok(deck && deck.currentTime >= 60 && deck.currentTime < 62, `the seek made while it loaded counts (${deck?.currentTime})`);

  usePlayer.getState().next(true);
  usePlayer.getState().next(true);
  usePlayer.getState().prev();
  await h.advance(1000);
  assert.equal(read(h).id, "B", "the last one asked for");
  deck = decksOf(h, "B").find((d) => !d.paused);
  assert.ok(deck, "and it plays");
  assert.equal(sounding(h).length, 1, "alone");
});

test("what a silent deck does while another device plays changes nothing here", async (t) => {
  const h = await following(t);
  const { usePlayer } = h.engine;
  const before = usePlayer.getState();
  const deck = h.elements.find((e) => e.src === "fake:A");
  deck.emit("timeupdate");
  assert.equal(usePlayer.getState().position, 42, "the deck's clock isn't the other device's");
  deck.emit("error");
  deck.emit("ended");
  await h.advance(500);
  assert.equal(read(h).id, "A", "no song moves on because of it");
  assert.equal(usePlayer.getState().playing, before.playing);
  assert.ok(Math.abs(h.engine.getPlaybackPosition() - 42) < 0.01, "the words on screen go by what that device says, not by the deck");
  assert.equal(sounding(h).length, 0);
});

test("a load on its way when another device takes over never sounds here", async (t) => {
  const h = await boot({ fadeSeconds: 0 });
  t.after(() => h.restore());
  h.setDuration("A", 100);
  const { usePlayer, handOverToCast } = h.engine;
  usePlayer.getState().playQueue([track("A", 100)], 0);
  handOverToCast(() => undefined);
  await h.advance(1000);
  assert.equal(sounding(h).length, 0);
});
