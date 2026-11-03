/**
 * The playlists as they travel between one person's devices: the document the
 * sync service stores, and how two copies of it become one. Pure, one copy for
 * the desktop and the phone.
 *
 * What gets deleted or added follows the membership versions of
 * deletion-sync.ts, the same rules as the cloud backup. The order is kept: a
 * playlist is a list somebody arranged, so it stays as on the side that last
 * edited it, and what only the other side has follows behind.
 */
import {
  canonical,
  compactDeletionSync,
  deletionKey,
  joinDeletionSync,
  membershipSurvives,
  mergeDeletionRecords,
  readDeletionSync,
  type DeletionSync,
} from "./deletion-sync";
import { sameSong, songIdentity } from "./duplicates";
import type { Track } from "../types";

/** A song as it is on any device: no covers or paths, those belong to one machine. */
export type WireTrack = Pick<Track, "id" | "title" | "artist" | "duration"> &
  Partial<Pick<Track, "album" | "albumId" | "albumArtist" | "source" | "year" | "trackNo" | "discNo" | "genre">>;

export interface WirePlaylist {
  id: string;
  name: string;
  tracks: WireTrack[];
  createdAt: number;
  pinned?: boolean;
  folderId?: string;
  artistId?: string;
  artistThumb?: string;
}

export interface WireFolder {
  id: string;
  name: string;
  createdAt: number;
}

export interface PlaylistDoc {
  playlists: WirePlaylist[];
  folders: WireFolder[];
  deletionSync: DeletionSync;
}

const TRACK_FIELDS = ["album", "albumId", "albumArtist", "source", "year", "trackNo", "discNo", "genre"] as const;

export function toWireTrack(t: WireTrack): WireTrack {
  const wire: WireTrack = { id: t.id, title: t.title, artist: t.artist, duration: t.duration };
  for (const field of TRACK_FIELDS) if (t[field] !== undefined) (wire as any)[field] = t[field];
  return wire;
}

const object = (value: unknown): Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
const records = (value: unknown): Record<string, any>[] =>
  (Array.isArray(value) ? value : []).filter((item) => typeof object(item).id === "string" && object(item).id);

/** Only what concerns playlists travels: the desktop's versions cover its likes and history too. */
const SYNCED_GROUPS = new Set(["playlists", "tracks", "folders"]);
function onlySynced(times: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(times).filter(([key]) => SYNCED_GROUPS.has(JSON.parse(key)[0])));
}

/** A device's state, or an untrusted document, as a clean document. */
export function toPlaylistDoc(state: unknown): PlaylistDoc {
  const s = object(state);
  const meta = readDeletionSync(s.deletionSync);
  return {
    playlists: records(s.playlists).map((p) => {
      const { tracks, ...rest } = p;
      return { name: "", createdAt: 0, ...rest, tracks: records(tracks).map((t) => toWireTrack(t as WireTrack)) } as WirePlaylist;
    }),
    folders: records(s.folders) as WireFolder[],
    deletionSync: { ...meta, adds: onlySynced(meta.adds), deletes: onlySynced(meta.deletes), edits: onlySynced(meta.edits), clears: {} },
  };
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byId = <T extends { id: string }>(list: T[]): T[] => [...list].sort((a, b) => compare(a.id, b.id));

/** The same content, whatever order the device keeps its playlists in. The clock alone isn't a change. */
export function sameDoc(a: PlaylistDoc, b: PlaylistDoc): boolean {
  const form = (doc: PlaylistDoc): string =>
    canonical({ playlists: byId(doc.playlists), folders: byId(doc.folders), deletionSync: { ...doc.deletionSync, clock: 0 } });
  return form(a) === form(b);
}

/** What survives, in the first list's order, then what only the second has. */
function inOrder<T extends { id: string }>(first: T[], second: T[], survivors: T[]): T[] {
  const alive = new Map(survivors.map((item) => [item.id, item]));
  const out: T[] = [];
  for (const item of [...first, ...second]) {
    const survivor = alive.get(item.id);
    if (survivor) {
      out.push(survivor);
      alive.delete(item.id);
    }
  }
  return out;
}

export function mergePlaylistDocs(local: PlaylistDoc, remote: PlaylistDoc): PlaylistDoc {
  const am = readDeletionSync(local.deletionSync);
  const bm = readDeletionSync(remote.deletionSync);
  const joined = joinDeletionSync(am, bm);
  const idOf = (item: { id: string }): string => item.id;

  const folders = inOrder(
    local.folders,
    remote.folders,
    mergeDeletionRecords<WireFolder>(local.folders, remote.folders, am, bm, joined, "folders", idOf)
  );

  // Track lists are merged on their own: unioned children must not decide which name wins the next merge.
  const metadata = (list: WirePlaylist[]) => list.map(({ tracks: _tracks, ...rest }) => rest);
  const survivors = mergeDeletionRecords<Omit<WirePlaylist, "tracks">>(
    metadata(local.playlists),
    metadata(remote.playlists),
    am,
    bm,
    joined,
    "playlists",
    idOf
  ).map((p): WirePlaylist => {
    const mine = local.playlists.find((item) => item.id === p.id)?.tracks ?? [];
    const theirs = remote.playlists.find((item) => item.id === p.id)?.tracks ?? [];
    const alive = (list: WireTrack[], meta: DeletionSync): WireTrack[] => (membershipSurvives(meta, joined, "playlists", p.id) ? list : []);
    const a = alive(mine, am);
    const b = alive(theirs, bm);
    const key = deletionKey("playlists", p.id);
    // Whoever edited the list last decides its order; on a tie the shared copy does, so devices agree.
    const [first, second] = (am.edits[key] ?? 0) > (bm.edits[key] ?? 0) ? [a, b] : [b, a];
    const next: WirePlaylist = {
      ...p,
      tracks: inOrder(first, second, mergeDeletionRecords<WireTrack>(a, b, am, bm, joined, "tracks", idOf, p.id)),
    };
    // Deleted folders unfile their playlists, never delete them.
    if (next.folderId && !folders.some((f) => f.id === next.folderId)) delete next.folderId;
    return next;
  });

  // The device's own order of its playlists stays; a new one from elsewhere goes on top, as a new one does.
  const known = new Set(local.playlists.map((p) => p.id));
  const fresh = remote.playlists.map((p) => p.id).filter((id) => !known.has(id));
  const rank = new Map([...fresh, ...local.playlists.map((p) => p.id)].map((id, i) => [id, i]));
  const playlists = [...survivors].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));

  return { playlists, folders, deletionSync: compactDeletionSync(joined, { playlists, folders }) };
}

/**
 * The desktop's versions hold more than playlists: the merged ones replace
 * theirs, its likes and history stay. Compacting is left to the library's
 * next change, which sees all of it.
 */
export function withSyncedDeletions(own: unknown, merged: DeletionSync): DeletionSync {
  const meta = readDeletionSync(own);
  const others = (times: Record<string, number>): Record<string, number> =>
    Object.fromEntries(Object.entries(times).filter(([key]) => !SYNCED_GROUPS.has(JSON.parse(key)[0])));
  return {
    ...meta,
    clock: Math.max(meta.clock, merged.clock),
    floor: Math.max(meta.floor, merged.floor),
    adds: { ...others(meta.adds), ...merged.adds },
    deletes: { ...others(meta.deletes), ...merged.deletes },
    edits: { ...others(meta.edits), ...merged.edits },
  };
}

/**
 * Finds a song from another device in this one's library: by id where both
 * read the same server, else the way the library merges copies of a song, so a
 * local file in a desktop playlist finds its Jellyfin copy on the phone.
 */
export function songFinder<T extends Track>(tracks: T[]): (wire: WireTrack) => T | undefined {
  const ids = new Map<string, T>();
  const identities = new Map<string, T[]>();
  for (const t of tracks) {
    ids.set(t.id, t);
    const key = songIdentity(t);
    const list = identities.get(key);
    if (list) list.push(t);
    else identities.set(key, [t]);
  }
  return (wire) => {
    const exact = ids.get(wire.id);
    if (exact) return exact;
    const asTrack = { thumb: "", ...wire } as Track;
    return identities.get(songIdentity(asTrack))?.find((t) => sameSong(t, asTrack));
  };
}
