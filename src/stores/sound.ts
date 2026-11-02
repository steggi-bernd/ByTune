/**
 * The sound analysis' results (electron/sound-library.ts) on this side:
 * loaded at start, and again — a few seconds after the main process says
 * more songs are measured. The mood mixes, the song details, Automix and the
 * seamless transitions (lib/continuity.ts) read them.
 */
import { create } from "zustand";
import type { SoundFacts } from "../../electron/sound-analysis";
import type { Track } from "../types";
import { versionsOf } from "./catalog";

interface SoundState {
  facts: Record<string, SoundFacts>;
  load(): Promise<void>;
}

export const useSound = create<SoundState>((set) => ({
  facts: {},
  async load() {
    const facts = await window.bytune?.soundFacts().catch(() => null);
    if (facts && typeof facts === "object") set({ facts });
  },
}));

/** Loads now and follows the main process' word of new results; the returned function stops. */
export function watchSound(): () => void {
  void useSound.getState().load();
  let timer: number | null = null;
  const off = window.bytune?.onSoundUpdated(() => {
    timer ??= window.setTimeout(() => {
      timer = null;
      void useSound.getState().load();
    }, 3000);
  });
  return () => {
    off?.();
    if (timer !== null) window.clearTimeout(timer);
  };
}

/** A song's energy for the mood mixes — none for one that wasn't measured or measured silent (an empty file). */
export function energyOf(track: Track, facts: Record<string, SoundFacts> = useSound.getState().facts): number | undefined {
  const f = soundOf(track, facts);
  return f && f.loudness > -70 ? f.energy : undefined;
}

/** A song's facts, from whichever of its copies was measured (the local file of a merged song). */
export function soundOf(track: Track | null | undefined, facts: Record<string, SoundFacts> = useSound.getState().facts): SoundFacts | undefined {
  if (!track) return undefined;
  return facts[track.id] ?? versionsOf(track).map((v) => facts[v.id]).find(Boolean);
}
