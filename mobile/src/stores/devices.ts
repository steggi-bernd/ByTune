/**
 * The other Songsta devices of this account, as the sync service tells of them:
 * whether they are around and what they play.
 */
import { create } from "zustand";
import { DEVICE_ONLINE_MS, type RemoteDevice } from "../shared";

interface DevicesState {
  others: RemoteDevice[];
}

export const useDevices = create<DevicesState>(() => ({ others: [] }));

export const isAround = (device: RemoteDevice): boolean => device.ageMs < DEVICE_ONLINE_MS;
