import assert from "node:assert/strict";
import { test } from "node:test";
import { nextFavoriteBase, planFavoriteSync, playCreditSeconds } from "../.test-build/favoriteSync.mjs";

const set = (...ids) => new Set(ids);
const everythingKnown = () => true;

test("the first sync only adds, both ways", () => {
  const plan = planFavoriteSync(set("jf:a", "jf:b"), set("jf:b", "jf:c"), set(), everythingKnown);
  assert.deepEqual(plan, { favorite: ["jf:a"], unfavorite: [], like: ["jf:c"], unlike: [] });
  const base = nextFavoriteBase(set("jf:a", "jf:b"), set("jf:b", "jf:c"), set(), plan, set());
  assert.deepEqual([...base].sort(), ["jf:a", "jf:b", "jf:c"]);
});

test("a like taken back here is taken back there, and the other way round", () => {
  const base = set("jf:a", "jf:b", "jf:c");
  // a: un-liked here; b: unfavorited in Finamp; c: still agreed
  const plan = planFavoriteSync(set("jf:b", "jf:c"), set("jf:a", "jf:c"), base, everythingKnown);
  assert.deepEqual(plan, { favorite: [], unfavorite: ["jf:a"], like: [], unlike: ["jf:b"] });
  assert.deepEqual([...nextFavoriteBase(set("jf:b", "jf:c"), set("jf:a", "jf:c"), base, plan, set())], ["jf:c"]);
});

test("a favorite the library doesn't list yet is never taken back for that", () => {
  const plan = planFavoriteSync(set(), set("jf:new"), set("jf:new"), (id) => id !== "jf:new");
  assert.deepEqual(plan, { favorite: [], unfavorite: [], like: [], unlike: [] });
  assert.deepEqual([...nextFavoriteBase(set(), set("jf:new"), set("jf:new"), plan, set())], ["jf:new"], "still agreed");
});

test("a server call that failed is tried again next round", () => {
  const liked = set("jf:a");
  const plan = planFavoriteSync(liked, set(), set(), everythingKnown);
  const base = nextFavoriteBase(liked, set(), set(), plan, set("jf:a"));
  assert.equal(base.size, 0, "not agreed yet");
  assert.deepEqual(planFavoriteSync(liked, set(), base, everythingKnown).favorite, ["jf:a"], "so it is favorited again");
  // An unfavorite that failed stays agreed, so the next round sends it again.
  const old = set("jf:b");
  const unplan = planFavoriteSync(set(), set("jf:b"), old, everythingKnown);
  const after = nextFavoriteBase(set(), set("jf:b"), old, unplan, set("jf:b"));
  assert.deepEqual(planFavoriteSync(set(), set("jf:b"), after, everythingKnown).unfavorite, ["jf:b"]);
});

test("gone on both sides is simply forgotten", () => {
  const plan = planFavoriteSync(set(), set(), set("jf:x"), everythingKnown);
  assert.deepEqual(plan, { favorite: [], unfavorite: [], like: [], unlike: [] });
  assert.equal(nextFavoriteBase(set(), set(), set("jf:x"), plan, set()).size, 0);
});

test("a play counts after half the song, at least 30 s and at most 4 minutes", () => {
  assert.equal(playCreditSeconds(200), 100);
  assert.equal(playCreditSeconds(40), 30);
  assert.equal(playCreditSeconds(1200), 240);
  assert.equal(playCreditSeconds(0), 30, "unknown length");
});
