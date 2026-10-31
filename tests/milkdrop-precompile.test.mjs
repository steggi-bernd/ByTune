// Milkdrop without eval (scripts/vite-milkdrop.ts): butterchurn's `new Function` sites become
// a lookup into equations compiled at build time, so the app's CSP never needs 'unsafe-eval'.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { createRequire } from "node:module";
import { milkdropModule, rewriteButterchurn } from "../.test-build/vite-milkdrop.mjs";

const require = createRequire(import.meta.url);

test("every equation site in butterchurn is rewritten to the compiled lookup", () => {
  const source = fs.readFileSync(require.resolve("butterchurn"), "utf8");
  const out = rewriteButterchurn(source);
  assert.equal((out.match(/new Function\(/g) ?? []).length, 0, "no eval left");
  assert.equal((out.match(/globalThis\.__bytuneMilkdropEq\(/g) ?? []).length, 8);
});

test("a butterchurn that changed its equation sites fails the build instead of shipping eval", () => {
  assert.throws(() => rewriteButterchurn("var x = new Function('a', 'return a');"), /equation sites/);
});

test("the presets' equations are compiled into the module, each guarded", () => {
  const code = milkdropModule();
  assert.match(code, /^import pack from "butterchurn-presets";/);
  assert.match(code, /export function equation\(source\)/);
  assert.match(code, /export const presets = pack\.getPresets\(\);/);
  const compiled = (code.match(/, function \(a\) \{\ntry \{/g) ?? []).length;
  assert.ok(compiled >= 470, `expected the pack's ~477 equations, found ${compiled}`);
  assert.doesNotMatch(code, /new Function|eval\(/, "the module itself evaluates nothing");
});
