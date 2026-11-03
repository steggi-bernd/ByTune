/** The names you gave your devices: an Echo doesn't tell its own. */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { lazyJSONStorage } from "../lib/persist";

interface DeviceNamesState {
  names: Record<string, string>;
  rename(id: string, name: string): void;
}

export const useDeviceNames = create<DeviceNamesState>()(
  persist(
    (set, get) => ({
      names: {},
      rename(id, name) {
        const names = { ...get().names };
        if (name.trim()) names[id] = name.trim();
        else delete names[id];
        set({ names });
      },
    }),
    { name: "device-names", storage: lazyJSONStorage<DeviceNamesState>() }
  )
);
