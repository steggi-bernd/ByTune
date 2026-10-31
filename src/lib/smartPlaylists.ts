/**
 * Smart playlist rules: what each field means, which comparisons it offers,
 * how a rule is checked against a song, and how the matches are ordered.
 */
import type { PlayCounts } from "../stores/catalog";
import type { RuleField, RuleOp, SmartPlaylist, SmartRule, SmartSort } from "../stores/smartPlaylists";
import type { Track } from "../types";
import { genresOf } from "./catalogIndex";

type Kind = "text" | "number" | "days" | "choice";

interface FieldDef {
  label: string;
  kind: Kind;
  ops: RuleOp[];
  /** unit shown after the value input */
  unit?: string;
  choices?: { value: string; label: string }[];
}

export const FIELDS: Record<RuleField, FieldDef> = {
  genre: { label: "Genre", kind: "text", ops: ["contains", "notContains", "is", "isNot"] },
  artist: { label: "Artist", kind: "text", ops: ["contains", "notContains", "is", "isNot"] },
  album: { label: "Album", kind: "text", ops: ["contains", "notContains", "is", "isNot"] },
  title: { label: "Title", kind: "text", ops: ["contains", "notContains", "is", "isNot"] },
  year: { label: "Year", kind: "number", ops: ["is", "gt", "lt", "between"] },
  added: { label: "Added", kind: "days", ops: ["inLast", "notInLast"], unit: "days" },
  plays: { label: "Plays", kind: "number", ops: ["gt", "lt", "is"] },
  lastPlayed: { label: "Last played", kind: "days", ops: ["inLast", "notInLast"], unit: "days" },
  duration: { label: "Length", kind: "number", ops: ["gt", "lt"], unit: "min" },
  format: {
    label: "Format",
    kind: "choice",
    ops: ["is", "isNot"],
    choices: ["FLAC", "MP3", "AAC", "ALAC", "Opus", "Vorbis", "WAV", "AIFF", "WMA", "WavPack", "APE", "DSD"].map((f) => ({ value: f, label: f })),
  },
  sampleRate: { label: "Sample rate", kind: "number", ops: ["gt", "lt", "is"], unit: "kHz" },
  bitDepth: { label: "Bit depth", kind: "number", ops: ["gt", "lt", "is"], unit: "bit" },
  source: {
    label: "Source",
    kind: "choice",
    ops: ["is", "isNot"],
    choices: [
      { value: "local", label: "On this device" },
      { value: "jellyfin", label: "Jellyfin" },
      { value: "subsonic", label: "Navidrome" },
    ],
  },
  liked: {
    label: "Liked",
    kind: "choice",
    ops: ["is"],
    choices: [
      { value: "yes", label: "Yes" },
      { value: "no", label: "No" },
    ],
  },
};

export const OP_LABEL: Record<RuleOp, string> = {
  contains: "contains",
  notContains: "doesn't contain",
  is: "is",
  isNot: "is not",
  gt: "is more than",
  lt: "is less than",
  between: "is between",
  inLast: "in the last",
  notInLast: "not in the last",
};

export const SORT_LABEL: Record<SmartSort, string> = {
  random: "Random",
  added: "Recently added",
  plays: "Most played",
  lastPlayed: "Recently played",
  title: "Title",
  artist: "Artist",
  year: "Newest first",
};

/** Format family of a track's codec — "MPEG 1 Layer 3" → MP3, "MPEG-4/AAC" → AAC … */
function formatOf(t: Track): string {
  const c = `${t.codec ?? ""} ${t.localPath?.split(".").pop() ?? ""}`.toUpperCase();
  if (/FLAC/.test(c)) return "FLAC";
  if (/ALAC/.test(c)) return "ALAC";
  if (/LAYER 3|MP3/.test(c)) return "MP3";
  if (/AAC|M4A|MP4/.test(c)) return "AAC";
  if (/OPUS/.test(c)) return "Opus";
  if (/VORBIS|OGG/.test(c)) return "Vorbis";
  if (/PCM|WAV/.test(c)) return /AIF/.test(c) ? "AIFF" : "WAV";
  if (/AIF/.test(c)) return "AIFF";
  if (/WMA|WINDOWS MEDIA/.test(c)) return "WMA";
  if (/WAVPACK|\bWV\b/.test(c)) return "WavPack";
  if (/APE|MONKEY/.test(c)) return "APE";
  if (/DSD|DSF|DFF/.test(c)) return "DSD";
  return "";
}

const DAY = 24 * 60 * 60 * 1000;

interface Ctx {
  counts: PlayCounts;
  liked: Set<string>;
  now: number;
}

function textMatch(op: RuleOp, hay: string[], needle: string): boolean {
  const n = needle.trim().toLowerCase();
  const values = hay.map((h) => h.toLowerCase());
  switch (op) {
    case "contains":
      return values.some((v) => v.includes(n));
    case "notContains":
      return !values.some((v) => v.includes(n));
    case "is":
      return values.some((v) => v === n);
    case "isNot":
      return !values.some((v) => v === n);
    default:
      return false;
  }
}

function numberMatch(op: RuleOp, value: number | undefined, a: number, b?: number): boolean {
  if (value === undefined || !Number.isFinite(value)) return false;
  switch (op) {
    case "is":
      return Math.abs(value - a) < 1e-6;
    case "gt":
      return value > a;
    case "lt":
      return value < a;
    case "between":
      return b !== undefined && value >= Math.min(a, b) && value <= Math.max(a, b);
    default:
      return false;
  }
}

function daysMatch(op: RuleOp, at: number | undefined, days: number, now: number): boolean {
  const within = !!at && now - at <= days * DAY;
  return op === "inLast" ? within : !within;
}

export function ruleMatches(rule: SmartRule, t: Track, ctx: Ctx): boolean {
  const a = Number(rule.value);
  const b = rule.value2 !== undefined && rule.value2 !== "" ? Number(rule.value2) : undefined;
  switch (rule.field) {
    case "genre":
      return textMatch(rule.op, genresOf(t).length ? genresOf(t) : [""], rule.value);
    case "artist":
      return textMatch(rule.op, [t.artist, t.albumArtist ?? ""], rule.value);
    case "album":
      return textMatch(rule.op, [t.album ?? ""], rule.value);
    case "title":
      return textMatch(rule.op, [t.title], rule.value);
    case "year":
      return numberMatch(rule.op, t.year, a, b);
    case "added":
      return daysMatch(rule.op, t.addedAt, a, ctx.now);
    case "plays":
      return numberMatch(rule.op, ctx.counts[t.id]?.plays ?? 0, a, b);
    case "lastPlayed":
      return daysMatch(rule.op, ctx.counts[t.id]?.lastAt, a, ctx.now);
    case "duration":
      return numberMatch(rule.op, t.duration / 60, a, b);
    case "format": {
      const f = formatOf(t);
      return rule.op === "is" ? f === rule.value : f !== rule.value;
    }
    case "sampleRate":
      return numberMatch(rule.op, t.sampleRate ? t.sampleRate / 1000 : undefined, a, b);
    case "bitDepth":
      return numberMatch(rule.op, t.bitsPerSample, a, b);
    case "source": {
      const s = t.source ?? "local";
      return rule.op === "is" ? s === rule.value : s !== rule.value;
    }
    case "liked":
      return ctx.liked.has(t.id) === (rule.value === "yes");
    default:
      return false;
  }
}

/** A rule with an empty value is ignored (the editor shows it, the filter skips it). */
function ruleIsSet(r: SmartRule): boolean {
  if (FIELDS[r.field].kind === "text") return r.value.trim() !== "";
  if (FIELDS[r.field].kind === "choice") return r.value !== "";
  return r.value !== "" && Number.isFinite(Number(r.value));
}

export function evaluateSmartPlaylist(sp: SmartPlaylist, tracks: Track[], counts: PlayCounts, likedIds: Set<string>): Track[] {
  const ctx: Ctx = { counts, liked: likedIds, now: Date.now() };
  const rules = sp.rules.filter(ruleIsSet);
  let out = rules.length
    ? tracks.filter((t) => (sp.match === "all" ? rules.every((r) => ruleMatches(r, t, ctx)) : rules.some((r) => ruleMatches(r, t, ctx))))
    : [...tracks];
  const plays = (t: Track): number => counts[t.id]?.plays ?? 0;
  const last = (t: Track): number => counts[t.id]?.lastAt ?? 0;
  switch (sp.sort) {
    case "random":
      out = out.map((t) => ({ t, k: Math.random() })).sort((x, y) => x.k - y.k).map((x) => x.t);
      break;
    case "added":
      out.sort((x, y) => (y.addedAt ?? 0) - (x.addedAt ?? 0));
      break;
    case "plays":
      out.sort((x, y) => plays(y) - plays(x));
      break;
    case "lastPlayed":
      out.sort((x, y) => last(y) - last(x));
      break;
    case "title":
      out.sort((x, y) => x.title.localeCompare(y.title));
      break;
    case "artist":
      out.sort((x, y) => x.artist.localeCompare(y.artist) || (x.album ?? "").localeCompare(y.album ?? ""));
      break;
    case "year":
      out.sort((x, y) => (y.year ?? 0) - (x.year ?? 0));
      break;
  }
  return sp.limit && sp.limit > 0 ? out.slice(0, sp.limit) : out;
}

/** "Genre contains rock · Year is between 1990 and 1999" */
export function describeRules(sp: SmartPlaylist): string {
  const parts = sp.rules.filter(ruleIsSet).map((r) => {
    const f = FIELDS[r.field];
    const value = f.choices?.find((c) => c.value === r.value)?.label ?? r.value;
    const range = r.op === "between" ? `${value} and ${r.value2 ?? ""}` : value;
    return `${f.label} ${OP_LABEL[r.op]} ${range}${f.unit ? ` ${f.unit}` : ""}`;
  });
  return parts.join(sp.match === "all" ? " · " : " or ") || "All songs";
}

/** Starting points offered when a new smart playlist is created. */
export const SMART_PRESETS: { name: string; rules: SmartRule[]; sort: SmartSort; limit: number | null }[] = [
  { name: "Hi-Res", rules: [{ field: "sampleRate", op: "gt", value: "48" }], sort: "artist", limit: null },
  { name: "Recently added", rules: [{ field: "added", op: "inLast", value: "30" }], sort: "added", limit: null },
  { name: "Never played", rules: [{ field: "plays", op: "is", value: "0" }], sort: "random", limit: 100 },
  { name: "Most played", rules: [{ field: "plays", op: "gt", value: "2" }], sort: "plays", limit: 50 },
  { name: "Not played in a while", rules: [{ field: "plays", op: "gt", value: "0" }, { field: "lastPlayed", op: "notInLast", value: "90" }], sort: "random", limit: 100 },
];
