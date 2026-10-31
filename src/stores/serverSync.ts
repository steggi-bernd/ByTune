/**
 * What Liked Songs and the servers' favorites agreed on after the last sync
 * (lib/serverSync.ts) — the base that tells a new like from a taken-back one.
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { storage } from "../lib/persist";

interface ServerSyncState {
  /** server song ids ("jf:…", "ss:…") both sides held */
  base: string[];
  setBase(ids: string[]): void;
}

export const useServerSync = create<ServerSyncState>()(
  persist(
    (set) => ({
      base: [],
      setBase: (base) => set({ base }),
    }),
    {
      name: "server-sync",
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({ base: s.base }) as unknown as ServerSyncState,
    }
  )
);
