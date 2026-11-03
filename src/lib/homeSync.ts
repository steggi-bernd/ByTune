/**
 * The desktop's side of the sync service: playlists and where playback stopped,
 * the same on all devices. The conversation itself is lib/syncEngine.ts, one
 * copy with the phone; here is what it reads and changes on this computer. The
 * requests go through the main process, which holds the login.
 */
import { create } from "zustand";
import { useCatalog } from "../stores/catalog";
import { useLibrary, type LibraryFolder, type Playlist } from "../stores/library";
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { useUI } from "../stores/ui";
import type { Track } from "../types";
import { songFinder, toPlaylistDoc, toWireTrack, withSyncedDeletions, type PlaylistDoc, type WireTrack } from "./playlistSync";
import { createSyncEngine, type PlaybackNote, type QueueDoc, type SyncEngine, type SyncStatus } from "./syncEngine";

/** A pause a moment ago is a person between songs, not somebody done here. */
const IDLE_BEFORE_TAKING_OVER_MS = 60_000;
/** While the other device plays on in the same song, this one looks up only now and then. */
const FOLLOW_EVERY_MS = 120_000;
const QUEUE_NOTE_BEHIND = 200;
const QUEUE_NOTE_AHEAD = 800;
const AT_KEY = "songsta.sync.at";
const QUEUE_KEY = "songsta.sync.queueId";

interface HomeSyncState {
  status: SyncStatus;
  address: string | null;
  customAddress: string;
  needsUser: boolean;
}

export const useHomeSync = create<HomeSyncState>(() => ({ status: "off", address: null, customAddress: "", needsUser: false }));

/** Looks again at the login and the address: after a change in Settings. */
let refreshNow: () => void = () => undefined;
export const refreshHomeSync = (): void => refreshNow();

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* a convenience: without it another device's note just counts as newer */
  }
}

let finder: { byId: Map<string, Track>; find: (wire: WireTrack) => Track | undefined } | null = null;

/** The song of this library a description from another device means. */
function findSong(wire: WireTrack): Track | undefined {
  const { byId } = useCatalog.getState();
  if (finder?.byId !== byId) finder = { byId, find: songFinder([...byId.values()]) };
  return finder.find(wire);
}

/**
 * A playlist's song as this computer keeps it: what it already has, the
 * library's own copy, or the description until a library has it. Its id stays:
 * that is what the playlist's versions know it by.
 */
function ownTrack(wire: WireTrack, own: Map<string, Track>): Track {
  const mine = own.get(wire.id) ?? useCatalog.getState().byId.get(wire.id);
  if (mine) return mine;
  return { ...wire, thumb: findSong(wire)?.thumb ?? "" };
}

function applyPlaylists(doc: PlaylistDoc): void {
  const library = useLibrary.getState();
  const own = new Map<string, Track>();
  for (const p of library.playlists) for (const t of p.tracks) own.set(t.id, t);
  const playlists: Playlist[] = doc.playlists.map((p) => ({ ...p, tracks: p.tracks.map((t) => ownTrack(t, own)) }));
  useLibrary.setState({
    playlists,
    folders: doc.folders as LibraryFolder[],
    deletionSync: withSyncedDeletions(library.deletionSync, doc.deletionSync),
  });
}

export function watchHomeSync(): () => void {
  const bridge = window.bytune;
  if (!bridge?.homeSyncInfo) return () => undefined;

  let engine: SyncEngine | null = null;
  let closed = false;
  /** a change made by the sync itself isn't news for the sync */
  let applying = false;
  /** the note this computer stands on: its own or one it took over */
  let activityAt = Number(readStored(AT_KEY)) || 0;
  /** when somebody last did something here */
  let ownActivityAt = 0;
  let queueId = readStored(QUEUE_KEY);
  let adoptedAt = 0;
  let device = { id: "", name: "" };

  function inSameSong(note: PlaybackNote): boolean {
    const { queue, index } = usePlayer.getState();
    return note.queueId === queueId && !!queue[index] && findSong(note.track)?.id === queue[index].id;
  }

  const activity = (): void => {
    activityAt = ownActivityAt = Date.now();
    store(AT_KEY, String(activityAt));
    engine?.playbackChanged();
  };

  function readPlayback(): { note: PlaybackNote; queue: () => QueueDoc } | null {
    const { queue, index, position, playing } = usePlayer.getState();
    const track = queue[index];
    if (!track || !activityAt) return null;
    if (!queueId) queueId = String(activityAt);
    const id = queueId;
    store(AT_KEY, String(activityAt));
    return {
      note: { device, at: activityAt, playing, positionMs: position * 1000, track: toWireTrack(track), queueId: id },
      queue: () => ({ id, tracks: queue.slice(Math.max(0, index - QUEUE_NOTE_BEHIND), index + QUEUE_NOTE_AHEAD).map(toWireTrack) }),
    };
  }

  function wantsPlayback(note: PlaybackNote): boolean {
    if (usePlayer.getState().playing || !useCatalog.getState().loaded) return false;
    if (note.playing && inSameSong(note) && Date.now() - adoptedAt < FOLLOW_EVERY_MS) return false;
    return note.at > activityAt && Date.now() - ownActivityAt > IDLE_BEFORE_TAKING_OVER_MS;
  }

  /** Continues from another device: its queue, its song, its position, paused until somebody presses play. */
  function adoptPlayback(note: PlaybackNote, queue: QueueDoc | null): void {
    const current = findSong(note.track);
    if (!current) return;
    adoptedAt = Date.now();
    // The same song a little further on: no need to load it again, nor to say so.
    if (inSameSong(note)) {
      applying = true;
      activityAt = note.at;
      store(AT_KEY, String(activityAt));
      usePlayer.setState({ position: note.positionMs / 1000, seekNonce: usePlayer.getState().seekNonce + 1 });
      applying = false;
      return;
    }
    const found = (queue?.tracks ?? []).map(findSong).filter((t): t is Track => !!t);
    const list = found.some((t) => t.id === current.id) ? found : [current];
    const newQueue = note.queueId !== queueId;
    applying = true;
    activityAt = note.at;
    queueId = note.queueId;
    store(AT_KEY, String(activityAt));
    store(QUEUE_KEY, queueId);
    usePlayer.setState({
      queue: list,
      index: list.findIndex((t) => t.id === current.id),
      position: note.positionMs / 1000,
      duration: current.duration,
      playing: false,
      error: null,
      seekNonce: usePlayer.getState().seekNonce + 1,
    });
    applying = false;
    // A new song within a queue this one already follows needs no word.
    if (newQueue) useUI.getState().toast(`Picked up from ${note.device.name}`, "info");
  }

  async function refresh(): Promise<void> {
    const info = await bridge!.homeSyncInfo();
    if (closed) return;
    useHomeSync.setState({ address: info.address, customAddress: info.customAddress, needsUser: info.needsUser });
    device = { id: info.deviceId, name: info.deviceName };
    const wanted =
      info.ready &&
      useSettings.getState().syncPlaylists &&
      useCatalog.getState().loaded &&
      useLibrary.persist.hasHydrated() &&
      usePlayer.persist.hasHydrated();
    if (!wanted) {
      engine?.stop();
      engine = null;
      useHomeSync.setState({ status: "off" });
      return;
    }
    if (engine) {
      engine.retryNow();
      return;
    }
    engine = createSyncEngine({
      deviceId: info.deviceId,
      request: (method, path, body, timeoutMs) => bridge!.homeSyncRequest(method, path, body, timeoutMs),
      readPlaylists: () => toPlaylistDoc(useLibrary.getState()),
      applyPlaylists(doc) {
        applying = true;
        applyPlaylists(doc);
        applying = false;
      },
      readPlayback,
      wantsPlayback,
      adoptPlayback,
      readLikes: () => useLibrary.getState().liked.map(toWireTrack),
      onStatus: (status) => useHomeSync.setState({ status }),
    });
    engine.start();
  }

  const refreshQuietly = (): void => void refresh().catch(() => undefined);
  refreshNow = refreshQuietly;

  // What the stores read from disk at the start isn't anything somebody just did.
  const offLibrary = useLibrary.subscribe((s, prev) => {
    if (s.liked !== prev.liked && useLibrary.persist.hasHydrated()) engine?.likesChanged();
    if (!applying && useLibrary.persist.hasHydrated() && (s.playlists !== prev.playlists || s.folders !== prev.folders)) engine?.playlistsChanged();
  });
  let playerRead = usePlayer.persist.hasHydrated();
  const offPlayer = usePlayer.subscribe((s, prev) => {
    if (applying || !playerRead) return;
    if (s.queue !== prev.queue) {
      queueId = String(Date.now());
      store(QUEUE_KEY, queueId);
      activity();
    } else if (s.playing !== prev.playing || s.index !== prev.index || s.seekNonce !== prev.seekNonce) {
      activity();
    } else if (s.playing && s.position !== prev.position) {
      activityAt = ownActivityAt = Date.now();
      engine?.playbackChanged(true);
    }
  });
  const offCatalog = useCatalog.subscribe((s, prev) => {
    if (s.loaded && !prev.loaded) refreshQuietly();
  });
  const offSettings = useSettings.subscribe((s, prev) => {
    if (s.syncPlaylists !== prev.syncPlaylists) refreshQuietly();
  });
  const offHydrations = [
    useLibrary.persist.onFinishHydration(refreshQuietly),
    usePlayer.persist.onFinishHydration(() => {
      playerRead = true;
      refreshQuietly();
    }),
  ];
  const onFocus = (): void => void engine?.checkPlayback();
  const onLeave = (): void => void engine?.flushPlayback();
  window.addEventListener("bytune:remote-library-updated", refreshQuietly);
  window.addEventListener("focus", onFocus);
  window.addEventListener("pagehide", onLeave);
  refreshQuietly();

  return () => {
    closed = true;
    refreshNow = () => undefined;
    engine?.stop();
    offLibrary();
    offPlayer();
    offCatalog();
    offSettings();
    for (const off of offHydrations) off();
    window.removeEventListener("bytune:remote-library-updated", refreshQuietly);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("pagehide", onLeave);
  };
}
