/**
 * This moment's songs from the listening history (listens.ts scoreMoments),
 * for the time-of-day mix on the home page: asked once, then again every 20
 * minutes while a page that shows it is open — the history only lives in the
 * main process.
 */
import { useEffect } from "react";
import { create } from "zustand";
import type { MomentScore } from "../../electron/listens";

const FRESH_MS = 20 * 60_000;

interface MomentState {
  scores: MomentScore[];
  /** when they were asked for, ms (0: not yet) */
  at: number;
  load(): void;
}

let loading = false;

export const useMoments = create<MomentState>((set, get) => ({
  scores: [],
  at: 0,
  load() {
    if (loading || Date.now() - get().at < FRESH_MS) return;
    const ask = window.bytune?.listensMoment;
    if (!ask) return;
    loading = true;
    void ask()
      .then((scores) => set({ scores: Array.isArray(scores) ? scores : [], at: Date.now() }))
      .catch(() => set({ at: Date.now() }))
      .finally(() => {
        loading = false;
      });
  },
}));

/** The scores and when they were taken, kept fresh while the caller is shown. */
export function useMomentScores(): { scores: MomentScore[]; at: number } {
  const scores = useMoments((s) => s.scores);
  const at = useMoments((s) => s.at);
  useEffect(() => {
    useMoments.getState().load();
    const timer = window.setInterval(() => useMoments.getState().load(), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return { scores, at };
}
