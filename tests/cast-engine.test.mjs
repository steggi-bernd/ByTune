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
