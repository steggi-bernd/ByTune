// Sound analysis (electron/sound-analysis.ts) on made-up signals whose answers are known:
// click tracks at a set tempo, chords of a set key, silence at the ends, calm against busy.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const out = await build({
  entryPoints: [fileURLToPath(new URL("../electron/sound-analysis.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const { analyseSamples, keyName, keyOfChroma } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`);

const RATE = 11025;
let seed = 42;
const noise = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647 - 0.5;
};

/** A drum-like click (a short noise burst over a low thump) every beat. */
function clicks(bpm, seconds, level = 0.6) {
  const s = new Float32Array(Math.round(seconds * RATE));
  const every = (60 / bpm) * RATE;
  for (let beat = 0; beat * every < s.length; beat++) {
    const at = Math.round(beat * every);
    for (let i = 0; i < 900 && at + i < s.length; i++) {
      const decay = Math.exp(-i / 160);
      s[at + i] += level * decay * (noise() * 0.8 + 0.6 * Math.sin((2 * Math.PI * 70 * i) / RATE));
    }
  }
  for (let i = 0; i < s.length; i++) s[i] += noise() * 0.004;
  return s;
}

/** Sustained tones of the given frequencies, each chord held `hold` seconds. */
function chords(progression, hold, level = 0.15) {
  const s = new Float32Array(Math.round(progression.length * hold * RATE));
  progression.forEach((freqs, c) => {
    const from = Math.round(c * hold * RATE);
    for (let i = 0; i < hold * RATE; i++) {
      let v = 0;
      for (const f of freqs) for (const h of [1, 2, 3]) v += Math.sin((2 * Math.PI * f * h * i) / RATE) / (h * h);
      s[from + i] = level * v;
    }
  });
  return s;
}

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const triad = (root, minor) => [hz(root), hz(root + (minor ? 3 : 4)), hz(root + 7)];

test("tempo of steady beats, at their real speed and not double or half", async () => {
  for (const bpm of [90, 120, 128, 150]) {
    const facts = await analyseSamples(clicks(bpm, 40), RATE);
    assert.ok(Math.abs(facts.bpm - bpm) < 1.5, `${bpm} BPM measured as ${facts.bpm}`);
  }
});

test("no steady beat, no tempo", async () => {
  const s = new Float32Array(30 * RATE);
  for (let i = 0; i < s.length; i++) s[i] = noise() * 0.3;
  assert.equal((await analyseSamples(s, RATE)).bpm, 0);
});

test("held chords without a beat have no tempo and little energy", async () => {
  const facts = await analyseSamples(chords([triad(60, false), triad(65, false), triad(67, false)], 8, 0.05), RATE);
  assert.equal(facts.bpm, 0);
  assert.ok(facts.energy < 0.2, `energy ${facts.energy}`);
});

test("the key of a chord progression, major and minor", async () => {
  // C major: C – F – G – C;  A minor: Am – Dm – E – Am (C, G = 60, 67; A = 57)
  const cMajor = await analyseSamples(chords([triad(60, false), triad(65, false), triad(67, false), triad(60, false)], 4), RATE);
  assert.equal(keyName(cMajor.key, cMajor.minor), "C major");
  const aMinor = await analyseSamples(chords([triad(57, true), triad(62, true), triad(64, false), triad(57, true)], 4), RATE);
  assert.equal(keyName(aMinor.key, aMinor.minor), "A minor");
  assert.equal(keyName(-1, false), "");
});

test("an even chroma has no clear key", () => {
  assert.ok(keyOfChroma(new Array(12).fill(1)).strength < 0.5);
});

test("silence at the ends is measured, and how loud the song starts and ends", async () => {
  const body = clicks(120, 20);
  const s = new Float32Array(body.length + 3 * RATE + 2 * RATE);
  s.set(body, 3 * RATE);
  const facts = await analyseSamples(s, RATE);
  assert.ok(Math.abs(facts.introSilence - 3) < 0.2, `intro ${facts.introSilence}`);
  assert.ok(Math.abs(facts.outroSilence - 2) < 0.2, `outro ${facts.outroSilence}`);
  assert.ok(facts.headDb < -60 && facts.tailDb < -60);
  const runsOn = await analyseSamples(clicks(120, 20), RATE);
  assert.ok(runsOn.headDb > -30 && runsOn.introSilence < 0.1);
});

test("busy and loud is more energetic than quiet and sparse", async () => {
  const busy = await analyseSamples(clicks(170, 30, 0.9), RATE);
  const calm = await analyseSamples(chords([triad(60, false), triad(65, false)], 15, 0.02), RATE);
  assert.ok(busy.energy > calm.energy + 0.3, `busy ${busy.energy}, calm ${calm.energy}`);
  assert.ok(busy.energy <= 1 && calm.energy >= 0);
});

test("a silent file has no facts to speak of", async () => {
  const facts = await analyseSamples(new Float32Array(5 * RATE), RATE);
  assert.equal(facts.bpm, 0);
  assert.equal(facts.key, -1);
  assert.equal(facts.energy, 0);
});

test("long work lets others in between", async () => {
  let breaths = 0;
  await analyseSamples(clicks(120, 30), RATE, async () => {
    breaths++;
  });
  assert.ok(breaths > 10);
});
