/**
 * This phone's side of the sync service: how it reaches the service and what
 * the conversation (lib/syncEngine.ts) reads and changes here. It listens while
 * the app is in front; what the phone plays in the background still goes out.
 */
import { AppState, type NativeEventSubscription } from "react-native";
import { create } from "zustand";
import { authHeader } from "./jellyfin";
import { createSyncEngine, defaultSyncAddress, toPlaylistDoc, type SyncEngine, type SyncStatus } from "./shared";
import { readJson, writeJson } from "./storage";
import { useConnection } from "./stores/connection";
import { useLibrary } from "./stores/library";
import { adoptPlayback, onPlaybackActivity, playbackNote, wantsPlayback } from "./stores/player";
import { usePlaylists } from "./stores/playlists";
import { useSession } from "./stores/session";

const FILE = "sync-settings.json";

interface SyncState {
  status: SyncStatus;
  /** an address entered by hand; otherwise the service is looked for on Jellyfin's host */
  customAddress: string;
  setCustomAddress(address: string): void;
}

export const useSync = create<SyncState>((set) => ({
  status: "off",
  customAddress: "",
  setCustomAddress(address) {
    const customAddress = address.trim().replace(/\/+$/, "");
    set({ customAddress });
    writeJson(FILE, { customAddress });
    engine?.retryNow();
  },
}));

/** Where the service is looked for right now. */
export function syncAddress(): string | null {
  const custom = useSync.getState().customAddress;
  if (custom) return /^https?:\/\//i.test(custom) ? custom : `http://${custom}`;
  const session = useSession.getState().session;
  return session ? defaultSyncAddress(session.server) : null;
}

let engine: SyncEngine | null = null;
let appState: NativeEventSubscription | null = null;
let offPlaylists: (() => void) | null = null;
let offReach: (() => void) | null = null;
let applying = false;

export async function startSync(): Promise<void> {
  if (engine) return;
  const session = useSession.getState().session;
  if (!session) return;
  const saved = await readJson<{ customAddress?: string }>(FILE);
  if (saved?.customAddress) useSync.setState({ customAddress: saved.customAddress });
  await usePlaylists.getState().restore();
  if (engine || !useSession.getState().session) return;

  const device = { id: session.deviceId, name: "Phone" };
  const created = createSyncEngine({
    deviceId: session.deviceId,
    async request(method, path, body, timeoutMs = 20_000) {
      const current = useSession.getState().session;
      const base = syncAddress();
      if (!current || !base) throw new Error("No server");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(`${base}${path}`, {
          method,
          headers: {
            Authorization: authHeader(current.deviceId, current.token),
            Accept: "application/json",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: ctrl.signal,
        });
        const text = await res.text();
        return { status: res.status, body: text ? JSON.parse(text) : null };
      } finally {
        clearTimeout(timer);
      }
    },
    readPlaylists: () => toPlaylistDoc(usePlaylists.getState()),
    applyPlaylists(doc) {
      applying = true;
      usePlaylists.getState().applyDoc(doc);
      applying = false;
    },
    readPlayback: () => playbackNote(device),
    wantsPlayback,
    adoptPlayback,
    applyLikes: (tracks) => useLibrary.getState().setLikedOrder(tracks),
    onStatus: (status) => useSync.setState({ status }),
  });
  engine = created;

  offPlaylists = usePlaylists.subscribe((s, prev) => {
    if (!applying && (s.playlists !== prev.playlists || s.folders !== prev.folders)) created.playlistsChanged();
  });
  onPlaybackActivity((routine) => created.playbackChanged(routine));
  // The server moved or came back: the service is worth looking for at once.
  offReach = useConnection.subscribe((s, prev) => {
    if (s.reach !== prev.reach) created.retryNow();
  });
  appState = AppState.addEventListener("change", (state) => {
    if (state === "active") created.start();
    else if (state === "background") {
      void created.flushPlayback();
      created.rest();
    }
  });
  created.start();
}

export function stopSync(): void {
  offReach?.();
  offReach = null;
  engine?.stop();
  engine = null;
  appState?.remove();
  appState = null;
  offPlaylists?.();
  offPlaylists = null;
  onPlaybackActivity(null);
}

