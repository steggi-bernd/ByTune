/**
 * Milkdrop behind the full-screen Now Playing — butterchurn (Milkdrop's
 * presets on WebGL 2, MIT), its preset equations compiled at build time so
 * no eval runs (scripts/vite-milkdrop.ts). It listens to what plays
 * (lib/audio.ts visualizerTap) and drifts through the preset pack: a new one
 * every 25 seconds, blended over 2.7 s, or on demand (the "next" control
 * calls `next` through the handle).
 *
 * Loaded only when switched on (the presets are a chunk of their own),
 * drawn at most at 1.5× device pixels to keep the GPU calm, and torn down
 * — the audio tap disconnected — when the view closes.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Visualizer } from "butterchurn";
import { visualizerTap } from "../lib/audio";

export interface MilkdropHandle {
  next(): void;
}

const EVERY_MS = 25_000;
const BLEND_SEC = 2.7;

export const MilkdropVisualizer = forwardRef<MilkdropHandle, { className?: string }>(function MilkdropVisualizer({ className }, ref) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nextRef = useRef<(blendSec?: number) => void>(() => undefined);
  useImperativeHandle(ref, () => ({ next: () => nextRef.current() }), []);

  useEffect(() => {
    let alive = true;
    let raf = 0;
    let timer = 0;
    let viz: Visualizer | null = null;
    let tap: ReturnType<typeof visualizerTap> = null;
    let resize: ResizeObserver | null = null;
    void (async () => {
      const [{ default: butterchurn }, milkdrop] = await Promise.all([import("butterchurn"), import("virtual:milkdrop")]);
      // butterchurn's equation sites call this instead of `new Function` (scripts/vite-milkdrop.ts).
      (globalThis as { __bytuneMilkdropEq?: (source: string) => (a: object) => object }).__bytuneMilkdropEq = milkdrop.equation;
      const canvas = canvasRef.current;
      tap = visualizerTap();
      if (!alive || !canvas || !tap) return;
      const fit = (): void => {
        const r = canvas.getBoundingClientRect();
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        canvas.width = Math.max(1, Math.round(r.width * dpr));
        canvas.height = Math.max(1, Math.round(r.height * dpr));
        viz?.setRendererSize(canvas.width, canvas.height);
      };
      fit();
      viz = butterchurn.createVisualizer(tap.context, canvas, { width: canvas.width, height: canvas.height, pixelRatio: 1 });
      viz.connectAudio(tap.node);
      const presets = Object.values(milkdrop.presets);
      let last = -1;
      nextRef.current = (blend = BLEND_SEC) => {
        if (!viz || !presets.length) return;
        let i = Math.floor(Math.random() * presets.length);
        if (i === last && presets.length > 1) i = (i + 1) % presets.length;
        last = i;
        viz.loadPreset(presets[i], blend);
      };
      nextRef.current(0);
      timer = window.setInterval(() => nextRef.current(), EVERY_MS);
      resize = new ResizeObserver(fit);
      resize.observe(canvas);
      const draw = (): void => {
        viz?.render();
        raf = window.requestAnimationFrame(draw);
      };
      draw();
    })().catch(() => undefined);
    return () => {
      alive = false;
      window.cancelAnimationFrame(raf);
      window.clearInterval(timer);
      resize?.disconnect();
      if (viz && tap) {
        try {
          viz.disconnectAudio(tap.node);
        } catch {
          /* already gone */
        }
      }
      nextRef.current = () => undefined;
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
});
