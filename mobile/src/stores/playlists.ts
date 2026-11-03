/**
 * The playlists on this phone: the same ones as on the desktop, in the form
 * the sync service carries them (lib/playlistSync.ts). A song in a playlist is
 * only a description; which song of this library it means is worked out when
 * it is shown, and one the server doesn't have stays in the list, greyed out,
 * so the playlist stays whole on the desktop.
 */
import { create } from "zustand";
import {
  recordDeletionChanges,
  songFinder,
  toPlaylistDoc,
  toWireTrack,
  type DeletionChange,
  type PlaylistDoc,
  type Track,
  type WirePlaylist,
  type WireTrack,
} from "../shared";
import { readJson, removeJson, writeJson } from "../storage";
import { useLibrary } from "./library";

const FILE = "playlists.json";

/**
 * A song of a playlist as shown here: this library's song, which plays under
 * its own id. `entryId` is the id the playlist knows it by; `missing` when this
 * library doesn't have it.
 */
export type PlaylistTrack = Track & { entryId?: string; missing?: boolean };

interface PlaylistsState extends PlaylistDoc {
  /** the song the "Add to playlist" sheet is open for */
  picking: Track | null;
  setPicking(track: Track | null): void;
  restore(): Promise<void>;
  create(name: string): string;
  rename(id: string, name: string): void;
  remove(id: string): void;
  addTrack(id: string, track: Track): void;
  removeTrack(id: string, trackId: string): void;
  /** What the sync worked out; not a change of its own. */
  applyDoc(doc: PlaylistDoc): void;
  clear(): void;
}

const EMPTY = toPlaylistDoc(null);

let restored: Promise<void> | null = null;

const uid = (): string => `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export const usePlaylists = create<PlaylistsState>((set, get) => {
  /** A change made here: membership and its version go together, as in the desktop's store. */
  const change = (next: Partial<PlaylistDoc>, changes: DeletionChange[]): void => {
    set({ ...next, deletionSync: recordDeletionChanges(get(), next, changes) });
    save();
  };
  const save = (): void => {
    const { playlists, folders, deletionSync } = get();
    writeJson(FILE, { playlists, folders, deletionSync });
  };
  const edit = (id: string, fn: (p: WirePlaylist) => WirePlaylist): WirePlaylist[] => get().playlists.map((p) => (p.id === id ? fn(p) : p));

  return {
    ...EMPTY,
    picking: null,
    setPicking: (picking) => set({ picking }),

    restore() {
      restored ??= readJson<PlaylistDoc>(FILE).then((saved) => {
        if (saved) set(toPlaylistDoc(saved));
      });
      return restored;
    },

    create(name) {
      const id = uid();
      change({ playlists: [{ id, name: name.trim() || "New Playlist", tracks: [], createdAt: Date.now() }, ...get().playlists] }, [{ kind: "add", group: "playlists", id }]);
      return id;
    },

    rename(id, name) {
      change({ playlists: edit(id, (p) => ({ ...p, name: name.trim() || p.name })) }, [{ kind: "edit", group: "playlists", id }]);
    },

    remove(id) {
      const gone = get().playlists.find((p) => p.id === id);
      change({ playlists: get().playlists.filter((p) => p.id !== id) }, [
        { kind: "delete", group: "playlists", id },
        // Its songs too, in case the same id ever comes back.
        ...(gone?.tracks ?? []).map((t): DeletionChange => ({ kind: "delete", group: "tracks", id: t.id, parent: id })),
      ]);
    },

    addTrack(id, track) {
      const target = get().playlists.find((p) => p.id === id);
      if (!target || target.tracks.some((t) => t.id === track.id)) return;
      change({ playlists: edit(id, (p) => ({ ...p, tracks: [...p.tracks, toWireTrack(track)] })) }, [{ kind: "add", group: "tracks", id: track.id, parent: id }]);
    },

    removeTrack(id, trackId) {
      change({ playlists: edit(id, (p) => ({ ...p, tracks: p.tracks.filter((t) => t.id !== trackId) })) }, [{ kind: "delete", group: "tracks", id: trackId, parent: id }]);
    },

    applyDoc(doc) {
      set(doc);
      save();
    },

    clear() {
      removeJson(FILE);
      restored = null;
      set({ ...EMPTY, picking: null });
    },
  };
});

let finder: { tracks: Track[]; find: (wire: WireTrack) => Track | undefined } | null = null;

/** The song of this library a description from another device means. */
export function findSong(wire: WireTrack): Track | undefined {
  const tracks = useLibrary.getState().data.tracks;
  if (finder?.tracks !== tracks) finder = { tracks, find: songFinder(tracks) };
  return finder.find(wire);
}

export function playlistTracks(p: WirePlaylist): PlaylistTrack[] {
  return p.tracks.map((wire): PlaylistTrack => {
    const song = findSong(wire);
    return song ? { ...song, entryId: wire.id } : { thumb: "", ...wire, entryId: wire.id, missing: true };
  });
}

/** This song's entry in a playlist, under whichever id the playlist knows it. */
export const entryOf = (p: WirePlaylist, track: Track): WireTrack | undefined =>
  p.tracks.find((t) => t.id === track.id || findSong(t)?.id === track.id);
