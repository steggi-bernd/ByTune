/**
 * Parametric EQ editor: AutoEQ headphone search (pick a model, its correction
 * curve loads), import of Equalizer APO "ParametricEQ.txt" files, the summed
 * frequency response as a curve, and a band table for fine-tuning.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Headphones, Plus, RotateCcw, X } from "lucide-react";
import { FLAT_PEQ, PEQ_TYPE_LABEL, parseParametricEq, type ParametricEq, type PeqBand, type PeqType } from "../lib/peq";
import { useSettings } from "../stores/settings";
import { useUI } from "../stores/ui";
import { T } from "../lib/i18n";

interface AutoEqEntry {
  name: string;
  source: string;
  rig?: string;
  path: string;
}

const INPUT =
  "h-8 px-2 rounded-md bg-ink-hi/[0.06] border border-ink-hi/10 text-[12.5px] text-ink-hi outline-none focus:border-accent/60 transition-colors tabular-nums";

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return msg.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") || T("Something went wrong");
}

/** Number input that commits on blur/Enter, so "-" or "1." can be typed. */
function NumField({ value, onCommit, step = 0.1, className = "" }: { value: number; onCommit: (n: number) => void; step?: number; className?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = (): void => {
    const n = Number(text.replace(",", "."));
    if (Number.isFinite(n)) onCommit(n);
    else setText(String(value));
  };
  return (
    <input
      value={text}
      inputMode="decimal"
      step={step}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className={`${INPUT} ${className}`}
    />
  );
}

const CURVE_W = 560;
const CURVE_H = 150;
const N_POINTS = 160;
const F_MIN = 20;
const F_MAX = 20000;

/** Summed response (dB) of preamp + bands at log-spaced frequencies, via Web Audio's own filter math. */
function useResponse(peq: ParametricEq): { freqs: Float32Array; db: Float32Array } {
  return useMemo(() => {
    const freqs = new Float32Array(N_POINTS);
    for (let i = 0; i < N_POINTS; i++) freqs[i] = F_MIN * Math.pow(F_MAX / F_MIN, i / (N_POINTS - 1));
    const db = new Float32Array(N_POINTS).fill(peq.preamp);
    try {
      const ctx = new OfflineAudioContext(1, 128, 48000);
      const mag = new Float32Array(N_POINTS);
      const phase = new Float32Array(N_POINTS);
      for (const b of peq.bands) {
        const f = ctx.createBiquadFilter();
        f.type = b.type;
        f.frequency.value = b.freq;
        f.Q.value = b.q;
        f.gain.value = b.gain;
        f.getFrequencyResponse(freqs, mag, phase);
        for (let i = 0; i < N_POINTS; i++) db[i] += 20 * Math.log10(Math.max(mag[i], 1e-6));
      }
    } catch {
      /* no audio engine (tests) — flat line */
    }
    return { freqs, db };
  }, [peq]);
}

function ResponseCurve({ peq }: { peq: ParametricEq }) {
  const { freqs, db } = useResponse(peq);
  const range = Math.max(6, Math.ceil(Math.max(...Array.from(db, (v) => Math.abs(v))) / 3) * 3);
  const x = (f: number): number => (Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN)) * CURVE_W;
  const y = (v: number): number => CURVE_H / 2 - (v / range) * (CURVE_H / 2 - 6);
  const d = Array.from(freqs, (f, i) => `${i ? "L" : "M"}${x(f).toFixed(1)},${y(db[i]).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${CURVE_W} ${CURVE_H}`} className="w-full max-w-[560px] h-[150px] rounded-lg bg-ink-hi/[0.03]" role="img" aria-label={T("Frequency response")}>
      {[100, 1000, 10000].map((f) => (
        <g key={f}>
          <line x1={x(f)} x2={x(f)} y1={0} y2={CURVE_H} stroke="currentColor" className="text-ink-hi/10" />
          <text x={x(f) + 4} y={CURVE_H - 6} className="fill-ink-dim text-[10px]">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        </g>
      ))}
      <line x1={0} x2={CURVE_W} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-ink-hi/20" strokeDasharray="4 4" />
      <text x={4} y={12} className="fill-ink-dim text-[10px]">{T("+{range} dB", { range })}</text>
      <text x={4} y={CURVE_H - 6} className="fill-ink-dim text-[10px]">{T("−{range} dB", { range })}</text>
      <path d={d} fill="none" stroke="rgb(var(--primary))" strokeWidth={2} strokeLinejoin="round" />
    </svg>
  );
}

export function ParametricEqEditor() {
  const peq = useSettings((s) => s.peq);
  const setPeq = useSettings((s) => s.setPeq);
  const toast = useUI((s) => s.toast);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AutoEqEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      window.bytune
        ?.autoEqSearch(q)
        .then((r) => {
          setResults(r);
          setError(null);
        })
        .catch((err) => setError(errorText(err)));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const apply = async (entry: AutoEqEntry): Promise<void> => {
    if (!window.bytune) return;
    setBusy(true);
    setError(null);
    try {
      const profile = (await window.bytune.autoEqFetch(entry.path)) as ParametricEq;
      setPeq(profile);
      setQuery("");
      setResults([]);
      toast(T("AutoEQ profile loaded: {name}", { name: profile.name }), "success");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File): Promise<void> => {
    const profile = parseParametricEq(await file.text(), file.name.replace(/\.txt$/i, ""));
    if (profile) {
      setPeq(profile);
      toast(T("Imported {count} filters", { count: profile.bands.length }), "success");
    } else {
      toast(T("No parametric filters found in that file"), "error");
    }
  };

  const setBand = (i: number, patch: Partial<PeqBand>): void =>
    setPeq({ ...peq, name: peq.name.endsWith(" (edited)") || peq.name === T("Flat") ? peq.name : T("{name} (edited)", { name: peq.name }), bands: peq.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  return (
    <div className="space-y-4">
      {/* AutoEQ search */}
      <div className="relative max-w-[560px]">
        <Headphones className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={T("Your headphones — e.g. Sennheiser HD 650 (AutoEQ)")}
          className="w-full h-10 pl-9 pr-3 rounded-lg bg-ink-hi/[0.06] border border-ink-hi/10 text-[13.5px] text-ink-hi placeholder:text-ink-faint outline-none focus:border-accent/60"
        />
        {results.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 max-h-[280px] overflow-y-auto rounded-xl glass-strong p-1.5 shadow-float">
            {results.map((r) => (
              <button
                key={r.path}
                disabled={busy}
                onClick={() => void apply(r)}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-ink-hi/[0.08] transition-colors disabled:opacity-50"
              >
                <span className="block text-[13.5px] font-semibold text-ink-hi truncate">{r.name}</span>
                <span className="block text-[12px] text-ink-dim truncate">{T("measured by {source}{value}", { source: r.source, value: r.rig ? ` on ${r.rig}` : "" })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p className="text-[12.5px] text-red-400">{error}</p>}

      {/* Profile line */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-ink-hi truncate max-w-[320px]" title={peq.name}>
          {peq.name}
        </span>
        <span className="text-[12px] text-ink-dim">{T("· {count} bands", { count: peq.bands.length })}</span>
        <button
          onClick={() => fileRef.current?.click()}
          className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-ink-hi/[0.08] text-[12px] font-semibold text-ink-hi hover:bg-ink-hi/[0.14] transition-colors"
        >
          <FileUp className="w-3.5 h-3.5" />{" "}{T("Import file")}</button>
        <button
          onClick={() => setPeq(FLAT_PEQ)}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-ink-hi/[0.08] text-[12px] font-semibold text-ink-hi hover:bg-ink-hi/[0.14] transition-colors"
        >
          <RotateCcw className="w-3.5 h-3.5" />{" "}{T("Reset")}</button>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = "";
          }}
        />
      </div>

      <ResponseCurve peq={peq} />

      {/* Preamp + bands */}
      <div className="space-y-1.5 max-w-[560px]">
        <div className="flex items-center gap-2 text-[12.5px] text-ink-dim">
          <span className="w-[112px]">{T("Preamp")}</span>
          <NumField value={peq.preamp} onCommit={(n) => setPeq({ ...peq, preamp: Math.min(30, Math.max(-30, n)) })} className="w-[72px]" />
          <span>{T("dB")}</span>
        </div>
        {peq.bands.map((b, i) => (
          <div key={i} className="flex items-center gap-2 text-[12.5px] text-ink-dim">
            <select value={b.type} onChange={(e) => setBand(i, { type: e.target.value as PeqType })} className={`${INPUT} w-[112px]`}>
              {(Object.keys(PEQ_TYPE_LABEL) as PeqType[]).map((t) => (
                <option key={t} value={t}>
                  {PEQ_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <NumField value={b.freq} step={1} onCommit={(n) => setBand(i, { freq: Math.min(22000, Math.max(10, n)) })} className="w-[72px]" />
            <span>{T("Hz")}</span>
            <NumField value={b.gain} onCommit={(n) => setBand(i, { gain: Math.min(30, Math.max(-30, n)) })} className="w-[60px]" />
            <span>{T("dB")}</span>
            <span className="ml-1">Q</span>
            <NumField value={b.q} onCommit={(n) => setBand(i, { q: Math.min(30, Math.max(0.1, n)) })} className="w-[60px]" />
            <button
              onClick={() => setPeq({ ...peq, bands: peq.bands.filter((_, j) => j !== i) })}
              title={T("Remove band")}
              aria-label={T("Remove band")}
              className="ml-auto w-7 h-7 grid place-items-center rounded-full hover:text-ink-hi hover:bg-ink-hi/[0.08]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        <button
          onClick={() => setPeq({ ...peq, bands: [...peq.bands, { type: "peaking", freq: 1000, gain: 0, q: 1 }] })}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-dim hover:text-ink-hi transition-colors pt-1"
        >
          <Plus className="w-3.5 h-3.5" />{" "}{T("Add band")}</button>
      </div>
      <p className="text-[11.5px] text-ink-faint max-w-[560px]">{T("Headphone corrections from AutoEQ by Jaakko Pasanen (github.com/jaakkopasanen/AutoEq). The preamp keeps boosts from clipping; a limiter catches anything that still would.")}</p>
    </div>
  );
}
