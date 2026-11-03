/**
 * The conversation with the sync service, one copy for the desktop and the
 * phone; each brings how it reaches the service and how to read and change its
 * own state.
 *
 *  - playlists: fetched, merged with what's here, sent back if that differs.
 *    The service refuses a write built on an old revision; then it starts over.
 *  - playback: a device says where it stands when something happens and every
 *    half minute while it plays. A device that isn't playing takes over a
 *    newer note from another one, paused, so it picks up where that stopped.
 *  - changes: a long poll, so other devices hear within moments.
 */
import { mergePlaylistDocs, sameDoc, toPlaylistDoc, type PlaylistDoc, type WireTrack } from "./playlistSync";

export interface SyncReply {
  status: number;
  body: any;
}

/** A request to the service; rejects when it can't be reached. */
export type SyncRequest = (method: "GET" | "PUT", path: string, body?: unknown, timeoutMs?: number) => Promise<SyncReply>;

export interface PlaybackNote {
  device: { id: string; name: string };
  /** when this device last did something worth continuing from (ms) */
  at: number;
  playing: boolean;
  positionMs: number;
  track: WireTrack;
  queueId: string;
  context?: string;
}

export interface QueueDoc {
  id: string;
  context?: string;
  tracks: WireTrack[];
}

export type SyncStatus = "off" | "connecting" | "connected" | "unreachable" | "rejected";

export interface SyncHost {
  deviceId: string;
  request: SyncRequest;
  readPlaylists(): PlaylistDoc;
  /** The merged playlists, when they differ from what's here. */
  applyPlaylists(doc: PlaylistDoc): void;
  /** Where this device stands; null with nothing in the queue. */
  readPlayback(): { note: PlaybackNote; queue: () => QueueDoc } | null;
  /** Whether to take over another device's note now: not while playing, not when this one is newer. */
  wantsPlayback(note: PlaybackNote): boolean;
  /** Take it over, paused. `queue` is null when the note's queue is no longer there. */
  adoptPlayback(note: PlaybackNote, queue: QueueDoc | null): void;
  onStatus?(status: SyncStatus): void;
}

const LONG_POLL_SEC = 25;
const LONG_POLL_TIMEOUT_MS = (LONG_POLL_SEC + 10) * 1000;
const REQUEST_TIMEOUT_MS = 20_000;
const FIRST_RETRY_MS = 5000;
const LAST_RETRY_MS = 60_000;
const REJECTED_RETRY_MS = 5 * 60_000;
const PLAYLISTS_AFTER_CHANGE_MS = 1500;
const PLAYBACK_AFTER_CHANGE_MS = 800;
const PLAYBACK_WHILE_PLAYING_MS = 30_000;
const MERGE_ATTEMPTS = 4;

function readNote(doc: unknown): PlaybackNote | null {
  const n = doc as PlaybackNote | null;
  return n && typeof n === "object" && typeof n.device?.id === "string" && typeof n.at === "number" && typeof n.track?.id === "string" ? n : null;
}

export function createSyncEngine(host: SyncHost) {
  /** on at all: what happens here goes out */
  let enabled = false;
  /** listening for what happens elsewhere; not while a phone app is in the background */
  let running = false;
  /** bumped at every stop, so a poll still under way knows it is over */
  let session = 0;
  let status: SyncStatus = "off";
  let seq = -1;
  const known = { playlists: -1, position: -1 };
  let sentQueueId: string | null = null;
  /** the note last sent or taken over: nothing newer, nothing to say */
  let sentAt = 0;
  let playlistsBusy = false;
  let playlistsAgain = false;
  let playlistsTimer: ReturnType<typeof setTimeout> | null = null;
  let playbackTimer: ReturnType<typeof setTimeout> | null = null;
  let lastPlaybackAt = 0;
  let wakeSleep: (() => void) | null = null;

  const setStatus = (next: SyncStatus): void => {
    if (next === status) return;
    status = next;
    host.onStatus?.(next);
  };

  /** A reply that isn't what it should be counts like no reply. */
  function refused(reply: SyncReply): Error {
    return Object.assign(new Error(`The sync service answered ${reply.status}`), { status: reply.status });
  }

  async function syncPlaylists(): Promise<void> {
    if (playlistsBusy) {
      playlistsAgain = true;
      return;
    }
    playlistsBusy = true;
    try {
      for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt++) {
        const got = await host.request("GET", "/v1/docs/playlists", undefined, REQUEST_TIMEOUT_MS);
        if (got.status !== 200) throw refused(got);
        const remote = toPlaylistDoc(got.body.doc);
        // No await from reading to applying: an edit can't slip in between.
        const here = host.readPlaylists();
        const merged = mergePlaylistDocs(here, remote);
        if (!sameDoc(merged, here)) host.applyPlaylists(merged);
        known.playlists = got.body.rev;
        const nothingYet = !got.body.doc && !merged.playlists.length && !merged.folders.length;
        if (nothingYet || (got.body.doc && sameDoc(merged, remote))) return;
        const put = await host.request("PUT", "/v1/docs/playlists", { rev: got.body.rev, doc: merged }, REQUEST_TIMEOUT_MS);
        if (put.status === 200) {
          known.playlists = put.body.rev;
          return;
        }
        if (put.status !== 409) throw refused(put);
      }
    } finally {
      playlistsBusy = false;
      if (playlistsAgain && running) {
        playlistsAgain = false;
        playlistsSoon();
      }
    }
  }

  function playlistsSoon(): void {
    if (playlistsTimer) clearTimeout(playlistsTimer);
    playlistsTimer = setTimeout(() => {
      playlistsTimer = null;
      if (running) void syncPlaylists().catch(() => undefined);
    }, PLAYLISTS_AFTER_CHANGE_MS);
  }

  async function pushPlayback(): Promise<void> {
    const state = host.readPlayback();
    if (!state || state.note.at <= sentAt) return;
    lastPlaybackAt = Date.now();
    if (state.note.queueId !== sentQueueId) {
      const put = await host.request("PUT", "/v1/docs/queue", { doc: state.queue() }, REQUEST_TIMEOUT_MS);
      if (put.status !== 200) throw refused(put);
      sentQueueId = state.note.queueId;
    }
    const put = await host.request("PUT", "/v1/docs/position", { doc: state.note }, REQUEST_TIMEOUT_MS);
    if (put.status !== 200) throw refused(put);
    known.position = put.body.rev;
    sentAt = state.note.at;
  }

  async function checkPlayback(): Promise<void> {
    const got = await host.request("GET", "/v1/docs/position", undefined, REQUEST_TIMEOUT_MS);
    if (got.status !== 200) throw refused(got);
    known.position = got.body.rev;
    const note = readNote(got.body.doc);
    if (!note || note.device.id === host.deviceId || !host.wantsPlayback(note)) return;
    const queue = await host.request("GET", "/v1/docs/queue", undefined, REQUEST_TIMEOUT_MS);
    const doc = queue.status === 200 ? (queue.body.doc as QueueDoc | null) : null;
    // The wait for the queue may have changed things here.
    if (!host.wantsPlayback(note)) return;
    const matching = doc?.id === note.queueId && Array.isArray(doc.tracks) ? doc : null;
    sentQueueId = note.queueId;
    sentAt = note.at;
    host.adoptPlayback(note, matching);
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, ms);
      function done(): void {
        clearTimeout(timer);
        wakeSleep = null;
        resolve();
      }
      wakeSleep = done;
    });
  }

  async function run(mine: number): Promise<void> {
    let retry = FIRST_RETRY_MS;
    let synced = false;
    while (running && mine === session) {
      try {
        // Asked for at once the first time round; from then on it waits for news.
        const wait = seq < 0 ? 0 : LONG_POLL_SEC;
        const reply = await host.request("GET", `/v1/changes?since=${seq}&wait=${wait}`, undefined, LONG_POLL_TIMEOUT_MS);
        if (!running || mine !== session) return;
        if (reply.status !== 200) throw refused(reply);
        setStatus("connected");
        retry = FIRST_RETRY_MS;
        seq = reply.body.seq;
        const revs = reply.body.revs ?? {};
        if (!synced || revs.playlists !== known.playlists) await syncPlaylists();
        if (!synced || revs.position !== known.position) await checkPlayback();
        synced = true;
      } catch (err) {
        if (!running || mine !== session) return;
        const code = (err as { status?: number }).status;
        const rejected = code === 400 || code === 401 || code === 403;
        setStatus(rejected ? "rejected" : "unreachable");
        await sleep(rejected ? REJECTED_RETRY_MS : retry);
        retry = Math.min(retry * 2, LAST_RETRY_MS);
      }
    }
  }

  return {
    start(): void {
      enabled = true;
      if (running) return;
      running = true;
      session += 1;
      seq = -1;
      known.playlists = -1;
      known.position = -1;
      setStatus("connecting");
      void run(session);
    },

    /** Stops listening; what happens here still goes out. Back with start(). */
    rest(): void {
      running = false;
      session += 1;
      wakeSleep?.();
    },

    stop(): void {
      enabled = false;
      running = false;
      session += 1;
      if (playlistsTimer) clearTimeout(playlistsTimer);
      if (playbackTimer) clearTimeout(playbackTimer);
      playlistsTimer = playbackTimer = null;
      wakeSleep?.();
      setStatus("off");
    },

    /** Something changed in the playlists here. */
    playlistsChanged: playlistsSoon,

    /**
     * Something happened in playback here. `routine` is the tick while a song
     * plays: it goes out only every half minute.
     */
    playbackChanged(routine = false): void {
      if (!enabled) return;
      if (routine && Date.now() - lastPlaybackAt < PLAYBACK_WHILE_PLAYING_MS) return;
      if (playbackTimer) clearTimeout(playbackTimer);
      playbackTimer = setTimeout(() => {
        playbackTimer = null;
        void pushPlayback().catch(() => undefined);
      }, routine ? 0 : PLAYBACK_AFTER_CHANGE_MS);
    },

    /** The app is about to go quiet: where it stands goes out now. */
    flushPlayback(): Promise<void> {
      if (playbackTimer) clearTimeout(playbackTimer);
      playbackTimer = null;
      return pushPlayback().catch(() => undefined);
    },

    /** Look again whether another device has something to continue from, say when this one comes back to the front. */
    checkPlayback(): Promise<void> {
      return running ? checkPlayback().catch(() => undefined) : Promise.resolve();
    },

    /** A retry now instead of at the end of the wait, say after a new address was entered. */
    retryNow(): void {
      wakeSleep?.();
    },

    status: (): SyncStatus => status,
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;

/** Where the service is unless told otherwise: on Jellyfin's host, port 8196. */
export function defaultSyncAddress(server: string): string | null {
  const match = /^(https?:\/\/)(\[[^\]]+\]|[^/:]+)/i.exec(server);
  return match ? `${match[1]}${match[2]}:8196` : null;
}
