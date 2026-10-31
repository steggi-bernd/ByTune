/**
 * Milkdrop without eval. butterchurn turns every preset's equations — the JS
 * source butterchurn-presets ships — into functions with `new Function`,
 * which the app's Content-Security-Policy (script-src 'self', no
 * 'unsafe-eval') rightly forbids. This compiles those equations at build
 * time instead:
 *
 *  - "virtual:milkdrop" exports the presets and `equation(source)`, a lookup
 *    from an equation's source to a real, build-time function
 *  - butterchurn's eight `new Function` sites are rewritten to that lookup
 *    (the build fails if an update ever changes how many there are)
 *
 * Nothing is evaluated at run time and the CSP stays as strict as it was.
 * Modules are strict code, so each equation is checked in strict mode first;
 * one that only works sloppily (none in the shipped pack) keeps its preset's
 * defaults rather than breaking the chunk.
 */
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import type { Plugin } from "vite";

const VIRTUAL = "virtual:milkdrop";
const SITE = /new Function\('a', ""\.concat\(([^,()]+), " return a;"\)\)/g;
const SITES = 8;
const BUTTERCHURN = /[\\/]butterchurn[\\/]lib[\\/]butterchurn\.js$/;

export function rewriteButterchurn(code: string): string {
  let found = 0;
  const out = code.replace(SITE, (_site, source: string) => {
    found += 1;
    return `globalThis.__bytuneMilkdropEq(${source})`;
  });
  if (found !== SITES) {
    throw new Error(`butterchurn has ${found} equation sites, not ${SITES} — check scripts/vite-milkdrop.ts after an update`);
  }
  return out;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function milkdropModule(): string {
  const require = createRequire(import.meta.url);
  const presets = require("butterchurn-presets").getPresets() as Record<string, any>;
  const sources = new Set<string>();
  const add = (s: unknown): void => {
    if (typeof s === "string" && s.trim()) sources.add(s);
  };
  for (const p of Object.values(presets)) {
    add(p.init_eqs_str);
    add(p.frame_eqs_str);
    add(p.pixel_eqs_str);
    for (const s of p.shapes ?? []) [s.init_eqs_str, s.frame_eqs_str].forEach(add);
    for (const w of p.waves ?? []) [w.init_eqs_str, w.frame_eqs_str, w.point_eqs_str].forEach(add);
  }
  const strict = (source: string): boolean => {
    try {
      // Build time only: the pack's own code, checked for strict-mode syntax.
      new Function("a", `"use strict";\n${source}\nreturn a;`);
      return true;
    } catch {
      return false;
    }
  };
  const entries = [...sources]
    .filter(strict)
    .map((source) => `[${JSON.stringify(source)}, function (a) {\ntry {\n${source}\n} catch (_) { /* the preset keeps its defaults */ }\nreturn a;\n}]`);
  return [
    `import pack from "butterchurn-presets";`,
    `const equations = new Map([\n${entries.join(",\n")}\n]);`,
    `const unchanged = (a) => a;`,
    `export function equation(source) { return equations.get(source) ?? unchanged; }`,
    `export const presets = pack.getPresets();`,
  ].join("\n");
}

export function milkdropPrecompile(): Plugin {
  return {
    name: "bytune-milkdrop-precompile",
    enforce: "pre",
    resolveId: (id) => (id === VIRTUAL ? `\0${VIRTUAL}` : null),
    load: (id) => (id === `\0${VIRTUAL}` ? milkdropModule() : null),
    transform: (code, id) => (BUTTERCHURN.test(id) ? rewriteButterchurn(code) : null),
  };
}

/** The same rewrite for Vite's dev pre-bundling, which skips plugin transforms. */
export const milkdropDevRewrite = {
  name: "bytune-milkdrop-precompile-dev",
  setup(build: { onLoad: (o: { filter: RegExp }, cb: (a: { path: string }) => Promise<{ contents: string; loader: "js" }>) => void }) {
    build.onLoad({ filter: BUTTERCHURN }, async (args) => ({ contents: rewriteButterchurn(await fs.readFile(args.path, "utf8")), loader: "js" }));
  },
};
