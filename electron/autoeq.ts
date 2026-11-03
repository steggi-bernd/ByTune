/**
 * AutoEQ (github.com/jaakkopasanen/AutoEq): headphone correction curves for
 * thousands of models, published as Equalizer APO "ParametricEQ.txt" files.
 * The index (~850 KB, ~9,000 profiles) is fetched once and cached on disk for
 * a week; a search runs locally, and only the chosen profile is downloaded.
 */
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import { parseParametricEq, type ParametricEq } from "../src/lib/peq";

const RAW = "https://raw.githubusercontent.com/jaakkopasanen/AutoEq/master/results";
const INDEX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AutoEqEntry {
  name: string;
  /** measurement source, e.g. "oratory1990" */
  source: string;
  /** measurement rig, when the source used several */
  rig?: string;
  /** results-relative folder, URL-encoded as in the index */
  path: string;
}

let index: AutoEqEntry[] | null = null;

function indexFile(): string {
  return path.join(app.getPath("userData"), "autoeq-index.md");
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { "User-Agent": "Songsta" } });
  if (!res.ok) throw new Error(`AutoEQ answered HTTP ${res.status}`);
  return res.text();
}

async function loadIndex(): Promise<AutoEqEntry[]> {
  if (index) return index;
  let text: string | null = null;
  try {
    const st = fs.statSync(indexFile());
    if (Date.now() - st.mtimeMs < INDEX_TTL_MS) text = fs.readFileSync(indexFile(), "utf-8");
  } catch {
    /* no cached index */
  }
  if (!text) {
    try {
      text = await fetchText(`${RAW}/INDEX.md`);
      fs.writeFileSync(indexFile(), text);
    } catch (err) {
      // Offline: an expired cache is better than nothing.
      try {
        text = fs.readFileSync(indexFile(), "utf-8");
      } catch {
        throw err;
      }
    }
  }
  const entries: AutoEqEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^- \[(.+?)\]\(\.\/(.+?)\) by (.+?)(?: on (.+))?$/.exec(line.trim());
    if (m) entries.push({ name: m[1], path: m[2], source: m[3], rig: m[4] });
  }
  index = entries;
  return entries;
}

/** Models matching every word of the query, names starting with it first. */
export async function searchAutoEq(query: string): Promise<AutoEqEntry[]> {
  const words = String(query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const all = await loadIndex();
  const q = words.join(" ");
  return all
    .filter((e) => words.every((w) => e.name.toLowerCase().includes(w)))
    .sort((a, b) => Number(b.name.toLowerCase().startsWith(q)) - Number(a.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
    .slice(0, 30);
}

/** Download and parse one profile ("Sennheiser HD 650 · oratory1990"). */
export async function fetchAutoEq(entryPath: string): Promise<ParametricEq> {
  const p = String(entryPath ?? "");
  // Only index paths: relative, no traversal, no scheme.
  if (!p || p.includes("..") || /^[a-z]+:/i.test(p) || p.startsWith("/")) throw new Error("Not an AutoEQ profile");
  const all = await loadIndex();
  const entry = all.find((e) => e.path === p);
  if (!entry) throw new Error("Not an AutoEQ profile");
  const folderName = decodeURIComponent(p.split("/").pop() ?? "");
  const text = await fetchText(`${RAW}/${p}/${encodeURIComponent(`${folderName} ParametricEQ.txt`)}`);
  const profile = parseParametricEq(text, `${entry.name} · ${entry.source}`);
  if (!profile) throw new Error("This AutoEQ profile has no parametric filters");
  return profile;
}
