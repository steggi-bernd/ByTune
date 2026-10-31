/**
 * Gapless playback: with no crossfade, the next song takes over where this
 * one ends — armed on the standby deck seconds ahead, started on the playing
 * element's own clock, promoted (never reloaded). Runs the shipped engine on
 * the virtual clock of the automix harness.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { boot, endedAt, firstSoundAt, mediaEvents, play, read, restartedFrom, sounding, track } from "./automix-harness.mjs";

test("gapless: the next song starts right as this one ends — no silence between, no restart", async (t) => {
  // A 5 ms media clock: Chromium reads currentTime continuously, not in 20 ms timeupdate steps.
  const h = await boot({ fadeSeconds: 0, gapless: true, tickMs: 5 });
  t.after(() => h.restore());
  h.setDuration("A", 3.0);
  h.setDuration("B", 4.0);
  await play(h, [track("A", 3.0), track("B", 4.0)]);
  await h.advance(4000);

  const s = read(h);
  assert.equal(s.id, "B", "song B is playing");
  const lead = endedAt(h, "A") - mediaEvents(h, "B", "playing")[0].t;
  assert.ok(lead >= 0 && lead <= 40, `song B must start within the last 40 ms of song A (started ${lead.toFixed(1)} ms before its end)`);
  assert.equal(mediaEvents(h, "B", "playing").length, 1, "song B is started exactly once");
  assert.equal(restartedFrom(h, "B"), false, "and never jumps back to 0:00");
  assert.equal(sounding(h).length, 1, "one deck sounds once the handover is done");
  assert.ok(s.position > 0.5, `the store follows the promoted deck (${s.position}s)`);
});

test("gapless off: the next song only starts once this one has ended", async (t) => {
  const h = await boot({ fadeSeconds: 0, gapless: false });
  t.after(() => h.restore());
  h.setDuration("A", 3.0);
  h.setDuration("B", 4.0);
  await play(h, [track("A", 3.0), track("B", 4.0)]);
  await h.advance(4000);
  assert.ok(firstSoundAt(h, "B") >= endedAt(h, "A"));
  assert.equal(read(h).id, "B");
});

test("gapless sits out where songs don't run on: skip silence, the last song", async (t) => {
  const quiet = await boot({ fadeSeconds: 0, gapless: true, skipSilence: true });
  t.after(() => quiet.restore());
  quiet.setDuration("A", 3.0);
  quiet.setDuration("B", 4.0);
  await play(quiet, [track("A", 3.0), track("B", 4.0)]);
  await quiet.advance(4000);
  assert.ok(firstSoundAt(quiet, "B") >= endedAt(quiet, "A"), "skip silence plays to its own trimmed end");

  const last = await boot({ fadeSeconds: 0, gapless: true });
  t.after(() => last.restore());
  last.setDuration("A", 3.0);
  await play(last, [track("A", 3.0)]);
  await last.advance(4000);
  assert.equal(sounding(last).length, 0, "nothing after the last song");
});
