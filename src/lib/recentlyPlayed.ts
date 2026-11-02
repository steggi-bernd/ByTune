/**
 * When each album, playlist and Liked Songs last played — the library
 * panel's "Recently played" order. A new queue is matched against them
 * (lib/libraryOrder.ts collectionOf) and its match is touched whenever one
 * of its songs starts; a queue that plays none of them touches nothing. The
 * times start out once from the listening history (seedPlayed).
 */
import { songKey, useCatalog } from "../stores/catalog";
import { useLibrary } from "../stores/library";
import { useLibraryOrder } from "../stores/libraryOrder";
import { usePlayer } from "../stores/player";
import type { Track } from "../types";
import { collectionOf, seedPlayed, type Collection, type Shelves } from "./libraryOrder";

const albumOf = (t: Track): string | null => (t.albumId?.startsWith("lib:album:") ? t.albumId : null);

let sizes: { tracks: Track[]; byAlbum: Map<string, number> } | null = null;
function albumSize(album: string): number {
  const tracks = useCatalog.getState().tracks;
  if (sizes?.tracks !== tracks) {
    const byAlbum = new Map<string, number>();
    for (const t of tracks) {
      const a = albumOf(t);
      if (a) byAlbum.set(a, (byAlbum.get(a) ?? 0) + 1);
    }
    sizes = { tracks, byAlbum };
  }
  return sizes.byAlbum.get(album) ?? 0;
}

/** Each list's song keys, until the catalog's versions change what a key is. */
let keySets = new WeakMap<Track[], Set<string>>();
let keyedWith: unknown = null;
function keysOf(list: Track[]): Set<string> {
  const versions = useCatalog.getState().versions;
  if (keyedWith !== versions) {
    keySets = new WeakMap();
    keyedWith = versions;
  }
  let keys = keySets.get(list);
  if (!keys) {
    keys = new Set(list.map((t) => songKey(t.id)));
    keySets.set(list, keys);
  }
  return keys;
}

function shelves(): Shelves {
  const { playlists, liked } = useLibrary.getState();
  const collections: Collection[] = [
    ...playlists.map((p) => ({ id: p.id, keys: keysOf(p.tracks) })),
    { id: "__liked__", keys: keysOf(liked) },
  ];
  return { keyOf: (t) => songKey(t.id), albumOf, albumSize, collections };
}

/** Subscribe once from App — returns an unsubscribe fn. */
export function watchRecentlyPlayed(): () => void {
  let seen: Track[] | null = null;
  // What the queue plays, worked out when its first song starts (by then the
  // library and the catalog are loaded); undefined until then.
  let plays: string | null | undefined;
  const offPlayer = usePlayer.subscribe((s, prev) => {
    if (s.queue !== seen) {
      seen = s.queue;
      plays = undefined;
    }
    const started = s.playing && (!prev.playing || s.index !== prev.index || s.queue !== prev.queue || s.seekNonce !== prev.seekNonce);
    if (!started) return;
    if (plays === undefined) plays = collectionOf(s.queue, shelves());
    if (plays) useLibraryOrder.getState().touch(plays);
  });

  // Once, when the library, the catalog and these times are all loaded.
  const seed = (): void => {
    const order = useLibraryOrder.getState();
    if (order.seeded || !useLibraryOrder.persist.hasHydrated() || !useLibrary.persist.hasHydrated() || !useCatalog.getState().loaded) return;
    order.seed(seedPlayed(useLibrary.getState().history, shelves(), Date.now()));
  };
  const offCatalog = useCatalog.subscribe(seed);
  const offOrder = useLibraryOrder.persist.onFinishHydration(seed);
  const offLibrary = useLibrary.persist.onFinishHydration(seed);
  seed();
  return () => {
    offPlayer();
    offCatalog();
    offOrder();
    offLibrary();
  };
}
