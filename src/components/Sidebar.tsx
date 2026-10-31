/**
 * Sidebar — the whole left panel is "Your Library", Spotify-style.
 *
 * One glass pill: a "Your Library" header (create button), filter chips
 * (Playlists / Albums / Artists) and a scrollable list of the user's
 * library — Liked Songs, playlists, folders, artists and the library's
 * albums. Main navigation lives in the top bar (home beside the search
 * field; the library sources — Local Music, Jellyfin, Navidrome — beside the
 * settings gear).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Disc3,
  Download,
  Folder,
  Heart,
  Library,
  ListEnd,
  ListPlus,
  Music2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Play,
  Shuffle,
  Sparkles,
  User,
} from "lucide-react";
import { newestFirst, useLibraryIndex, type LibAlbum } from "../lib/catalogIndex";
import { useAlbumEditorRequest } from "./AlbumEditor";
import { artistRoute, splitCredits } from "../lib/libraryTracks";
import { RELEASE_LABEL } from "../lib/releases";
import { useAvailabilityCheck } from "../stores/availability";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { useSmartPlaylists } from "../stores/smartPlaylists";
import { useSmartEditor } from "./SmartPlaylistEditor";
import { useUI } from "../stores/ui";
import { EqBars } from "./primitives";
import { upgradeArtwork } from "../lib/artwork";
import { CreateMenu } from "./CreateMenu";
import { playlistFolderItems, playlistHeaderItems } from "../lib/trackActions";
import { dragHasAlbum, dragHasArtist, dragHasPlaylist, dragHasTrack, readAlbum, readArtist, readPlaylist, readTrack, type AlbumPayload, type ArtistPayload, type PlaylistPayload } from "../lib/dnd";
import { requireBridge } from "../lib/bridge";
import { startDownload } from "../lib/downloads";
import type { Track } from "../types";

/* ============================================================ nav */

type LibFilter = "playlists" | "albums" | "artists";
const FILTER_LABEL: Record<LibFilter, string> = { playlists: "Playlists", albums: "Albums", artists: "Artists" };
type AlbumSort = "recent" | "alpha" | "artist";
const SORT_LABEL: Record<AlbumSort, string> = { recent: "Recently added", alpha: "Alphabetical", artist: "Artist" };

interface LibRow {
  id: string;
  title: string;
  subtitle: string;
  thumb?: string;
  kind: "playlist" | "artist" | "folder" | "album" | "smart" | "downloads";
  /** album rows: the library album */
  release?: LibAlbum;
  /** album rows: false while none of its songs can be reached */
  available?: boolean;
  /** artist-imported playlists open the artist page instead of the list */
  artistId?: string;
  /** playlists: the folder they're filed in; folders: their own id */
  folderId?: string;
  /** Liked / Downloads shortcut rows carry their pin state */
  pinned?: boolean;
  /** which shortcut pin this row toggles (liked / downloads) */
  singleKey?: "liked" | "downloads" | "local";
}

/**
 * The library panel. Collapsed, it folds down to an icon rail: every row keeps
 * its artwork/icon (title as tooltip), clicks, drops and context menus work as
 * before, and the header button folds it back out.
 */
function LibraryPill({ collapsed }: { collapsed: boolean }) {
  const setCollapsed = useSettings((s) => s.setSidebarCollapsed);
  const liked = useLibrary((s) => s.liked);
  const playlists = useLibrary((s) => s.playlists);
  const folders = useLibrary((s) => s.folders);
  const followedArtists = useLibrary((s) => s.followedArtists);
  const pinnedSingles = useLibrary((s) => s.pinnedSingles);
  const smartPlaylists = useSmartPlaylists((s) => s.playlists);
  const navigate = useUI((s) => s.navigate);
  const openDialog = useUI((s) => s.openDialog);
  const openContextMenu = useUI((s) => s.openContextMenu);
  const current = usePlayer((s) => s.queue[s.index] ?? null);
  const playing = usePlayer((s) => s.playing);
  const { albums } = useLibraryIndex();
  const albumSort = useSettings((s) => s.librarySort);
  const available = useAvailabilityCheck();

  /** Spotify's filter chips: one category at a time, a second click shows everything again. */
  const [filter, setFilter] = useState<LibFilter | null>(null);
  const sortedAlbums = useMemo(() => {
    const list = [...albums];
    if (albumSort === "alpha") return list.sort((a, b) => a.title.localeCompare(b.title));
    if (albumSort === "artist") return list.sort((a, b) => a.artist.localeCompare(b.artist) || newestFirst(a, b));
    return list.sort((a, b) => b.addedAt - a.addedAt || a.title.localeCompare(b.title));
  }, [albums, albumSort]);
  // Per album, not per render: the panel re-renders on every track change and play/pause.
  const albumAvailable = useMemo(
    () => new Map(sortedAlbums.map((a) => [a.route, a.tracks.some((t) => available(t))])),
    [sortedAlbums, available]
  );
  const sortButtonRef = useRef<HTMLButtonElement | null>(null);
  const openSortMenu = (): void => {
    const rect = sortButtonRef.current?.getBoundingClientRect();
    openContextMenu(
      rect?.right ?? 0,
      rect?.bottom ?? 0,
      [
        { header: true, label: "Sort albums by" },
        ...(Object.keys(SORT_LABEL) as AlbumSort[]).map((k) => ({
          label: SORT_LABEL[k],
          icon: albumSort === k ? Check : undefined,
          action: () => useSettings.getState().setLibrarySort(k),
        })),
      ],
      { alignRight: true }
    );
  };

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** the row a drag is currently hovering — drives the drop highlight */
  const [dropHover, setDropHover] = useState<string | null>(null);
  /** a playlist drag is over the library panel — import-anywhere affordance */
  const [libHover, setLibHover] = useState(false);
  /** the row a drop just landed on — drives the pulse */
  const [pulse, setPulse] = useState<string | null>(null);
  /**
   * The panel glow runs on a dragover-driven TTL: every dragover over the
   * panel (they fire continuously under the cursor) refreshes a 600ms
   * window; no events ⇒ it expires. Counters can drift — Chromium fires
   * dragleave without a matching dragenter — but dragover cannot lie.
   */
  const glowTimer = useRef<number | null>(null);
  const refreshGlow = (): void => {
    setLibHover(true);
    if (glowTimer.current !== null) window.clearTimeout(glowTimer.current);
    glowTimer.current = window.setTimeout(() => setLibHover(false), 600);
  };
  const clearGlow = (): void => {
    if (glowTimer.current !== null) {
      window.clearTimeout(glowTimer.current);
      glowTimer.current = null;
    }
    setLibHover(false);
  };

  // A drag that ends anywhere (dropped outside a target) clears hover state.
  useEffect(() => {
    const clear = (): void => {
      clearGlow();
      setDropHover(null);
    };
    window.addEventListener("dragend", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      clearGlow();
    };
  }, []);

  // Spotify's library contents: Liked Songs, the user's playlists, folders
  // (collapsible), followed artists and the library's albums. The library
  // sources (Local Music, Jellyfin, Navidrome) live in the top bar.
  // Recently-played history is NOT library material — it lives in the queue
  // panel's "Recently played" tab.
  // Liked Songs is pinned by default; unpinning sends the row to the bottom
  // of the list (re-pin from its right-click menu).
  const singlePinned = (k: "liked" | "downloads" | "local"): boolean =>
    pinnedSingles?.[k] ?? true;

  const likedRow: LibRow = {
    id: "__liked__",
    title: "Liked Songs",
    subtitle: `Playlist · ${liked.length} ${liked.length === 1 ? "track" : "tracks"}`,
    thumb: liked[0]?.thumb,
    kind: "playlist",
    pinned: singlePinned("liked"),
    singleKey: "liked",
  };
  // Local player: no Downloads row — there is no catalogue to download from.
  const singles: LibRow[] = [likedRow];

  const show = (k: LibFilter): boolean => filter === null || filter === k;
  const rows: LibRow[] = [];
  if (show("playlists")) for (const r of singles.filter((r) => r.pinned)) rows.push(r);
  if (show("artists")) {
    for (const a of followedArtists) {
      rows.push({ id: a.id, title: a.name, subtitle: "Artist", thumb: a.thumb, kind: "artist" });
    }
  }
  if (show("playlists")) {
    for (const sp of smartPlaylists) {
      rows.push({ id: sp.id, title: sp.name, subtitle: "Smart playlist", kind: "smart" });
    }
    const unfiled = playlists.filter((p) => !p.folderId);
    for (const p of [...unfiled.filter((x) => x.pinned), ...unfiled.filter((x) => !x.pinned)]) {
      rows.push({
        id: p.id,
        title: p.name,
        subtitle: `Playlist · ${p.tracks.length} ${p.tracks.length === 1 ? "track" : "tracks"}`,
        thumb: p.artistThumb ?? p.tracks[0]?.thumb,
        kind: "playlist",
        artistId: p.artistId,
      });
    }
    for (const f of folders) {
      rows.push({ id: f.id, title: f.name, subtitle: "Folder", kind: "folder", folderId: f.id });
      if (expanded.has(f.id)) {
        for (const p of playlists.filter((pl) => pl.folderId === f.id)) {
          rows.push({
            id: p.id,
            title: p.name,
            subtitle: `Playlist · ${p.tracks.length} ${p.tracks.length === 1 ? "track" : "tracks"}`,
            thumb: p.artistThumb ?? p.tracks[0]?.thumb,
            kind: "playlist",
            folderId: f.id,
            artistId: p.artistId,
          });
        }
      }
    }
  }
  if (show("albums")) {
    for (const a of sortedAlbums) {
      rows.push({
        id: a.route,
        title: a.title,
        subtitle: `${RELEASE_LABEL[a.kind]} · ${a.artist}`,
        thumb: a.thumb,
        kind: "album",
        release: a,
        available: albumAvailable.get(a.route) ?? true,
      });
    }
  }
  if (show("playlists")) for (const r of singles.filter((r) => !r.pinned)) rows.push(r);

  const toggleFolder = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ---------------------------------------------------------- drag & drop */

  /**
   * Write an imported track list into the library. A playlist with the same
   * name is UPDATED in place (tracks + identity re-stamped) rather than
   * duplicated — re-dragging an artist refreshes their entry.
   * One write for the whole list — addToPlaylist would persist per song.
   */
  const upsertImported = (
    name: string,
    tracks: Track[],
    extra: { artistId?: string; artistThumb?: string } | undefined,
    folderId?: string
  ): { updated: boolean } => {
    const lib = useLibrary.getState();
    const existing = lib.playlists.find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      useLibrary.setState((s) => ({
        playlists: s.playlists.map((p) =>
          p.id === existing.id ? { ...p, tracks, ...extra } : p
        ),
      }));
      if (folderId) lib.setPlaylistFolder(existing.id, folderId);
      return { updated: true };
    }
    const created = lib.createPlaylist(name);
    useLibrary.setState((s) => ({
      playlists: s.playlists.map((p) => (p.id === created.id ? { ...p, tracks, ...extra } : p)),
    }));
    if (folderId) lib.setPlaylistFolder(created.id, folderId);
    return { updated: false };
  };

  /** Import a YouTube playlist as a real library playlist (same name). */
  const importPlaylist = async (pl: PlaylistPayload, folderId?: string): Promise<void> => {
    const ui = useUI.getState();
    ui.toast(`Importing “${pl.title}”…`);
    try {
      const page = await requireBridge().getPlaylist(pl.id);
      const name = (page.title || pl.title).trim() || "Imported playlist";
      const seen = new Set<string>();
      const tracks = (page.tracks ?? []).filter((t: Track) =>
        seen.has(t.id) ? false : (seen.add(t.id), true)
      );
      if (!tracks.length) throw new Error("no tracks");
      const n = tracks.length;
      const { updated } = upsertImported(name, tracks, undefined, folderId);
      ui.toast(
        updated
          ? `“${name}” · ${n} ${n === 1 ? "song" : "songs"} updated in your library`
          : `“${name}” · ${n} ${n === 1 ? "song" : "songs"} added to your library`,
        "success"
      );
    } catch {
      ui.toast(`Couldn't import “${pl.title}”`, "error");
    }
  };

  /** A dropped artist is FOLLOWED — the library shows their photo and the
      row opens their profile page (it never becomes a playlist). */
  const followDroppedArtist = (ar: ArtistPayload): void => {
    const added = useLibrary.getState().followArtist({ id: ar.id, name: ar.name, thumb: ar.thumb });
    const toast = useUI.getState().toast;
    if (added) toast(`Added “${ar.name}” to your library`, "success");
    else toast(`“${ar.name}” is already in your library`);
  };

  /** Import a YouTube album as a real library playlist (same name). */
  const importAlbum = async (al: AlbumPayload, folderId?: string): Promise<void> => {
    const ui = useUI.getState();
    ui.toast(`Importing “${al.title}”…`);
    try {
      const page = await requireBridge().getAlbum(al.id);
      const name = (page.album?.title || al.title).trim() || "Imported album";
      const seen = new Set<string>();
      const tracks = (page.tracks ?? []).filter((t: Track) =>
        seen.has(t.id) ? false : (seen.add(t.id), true)
      );
      if (!tracks.length) throw new Error("no tracks");
      const n = tracks.length;
      const { updated } = upsertImported(name, tracks, undefined, folderId);
      ui.toast(
        updated
          ? `“${name}” · ${n} ${n === 1 ? "song" : "songs"} updated in your library`
          : `“${name}” · ${n} ${n === 1 ? "song" : "songs"} added to your library`,
        "success"
      );
    } catch {
      ui.toast(`Couldn't import “${al.title}”`, "error");
    }
  };

  /** A dropped playlist payload that matches a local playlist is a FILING
      gesture (sidebar/library card → folder), not a YouTube import. */
  const localPlaylistName = (id: string): string | null =>
    useLibrary.getState().playlists.find((p) => p.id === id)?.name ?? null;

  const fileLocalPlaylist = (id: string, folderId: string): void => {
    const lib = useLibrary.getState();
    const toast = useUI.getState().toast;
    const name = localPlaylistName(id);
    if (!name) return;
    lib.setPlaylistFolder(id, folderId);
    setExpanded((prev) => new Set(prev).add(folderId));
    toast(`Moved “${name}” into the folder`, "success");
    setPulse(folderId);
    window.setTimeout(() => setPulse((cur) => (cur === folderId ? null : cur)), 650);
  };

  /** A dropped track lands on Liked Songs or one of the user's playlists. */
  const dropTrackOn = (r: LibRow, track: Track): void => {
    const lib = useLibrary.getState();
    const toast = useUI.getState().toast;
    if (r.id === "__liked__") {
      if (lib.isLiked(track.id)) {
        toast(`“${track.title}” is already in your Liked Songs`);
      } else {
        lib.toggleLike(track);
        toast(`Added “${track.title}” to Liked Songs`, "success");
      }
    } else {
      const p = lib.playlists.find((pl) => pl.id === r.id);
      if (!p) return;
      const added = lib.addToPlaylist(r.id, track);
      toast(
        added
          ? `Added “${track.title}” to “${p.name}”`
          : `“${track.title}” is already in “${p.name}”`
      );
    }
    setPulse(r.id);
    window.setTimeout(() => setPulse((cur) => (cur === r.id ? null : cur)), 650);
  };

  /** A dropped track on the Downloads row starts a download — same gesture
      as dropping on Liked Songs, but for offline saves. */
  const dropTrackOnDownloads = (track: Track): void => {
    void startDownload(track);
    setPulse("__downloads__");
    window.setTimeout(() => setPulse((cur) => (cur === "__downloads__" ? null : cur)), 650);
  };

  /** A dropped album on a playlist row appends the whole release. */
  const dropAlbumOn = async (r: LibRow, al: AlbumPayload): Promise<void> => {
    const lib = useLibrary.getState();
    const toast = useUI.getState().toast;
    try {
      const page = await requireBridge().getAlbum(al.id);
      const tracks = page.tracks ?? [];
      if (!tracks.length) throw new Error("no tracks");
      if (r.id === "__liked__") {
        let added = 0;
        for (const t of tracks) {
          if (!lib.isLiked(t.id)) {
            lib.toggleLike(t);
            added += 1;
          }
        }
        toast(
          added > 0
            ? `Added ${added} ${added === 1 ? "song" : "songs"} from “${al.title}” to Liked Songs`
            : `“${al.title}” is already in your Liked Songs`,
          added > 0 ? "success" : undefined
        );
      } else {
        const p = lib.playlists.find((pl) => pl.id === r.id);
        if (!p) return;
        let added = 0;
        for (const t of tracks) {
          if (lib.addToPlaylist(r.id, t)) added += 1;
        }
        toast(
          added > 0
            ? `Added ${added} ${added === 1 ? "song" : "songs"} from “${al.title}” to “${p.name}”`
            : `“${al.title}” is already in “${p.name}”`,
          added > 0 ? "success" : undefined
        );
      }
    } catch {
      toast(`Couldn't add “${al.title}” here`, "error");
    }
    setPulse(r.id);
    window.setTimeout(() => setPulse((cur) => (cur === r.id ? null : cur)), 650);
  };

  /**
   * Hovering a collapsed folder mid-drag opens it after a beat so the drag
   * can continue onto the playlists inside — one gesture, no re-drag. The
   * highlight itself is immediate (set in onRowDragOver); only the expansion
   * waits, the way file managers do.
   */
  const expandTimer = useRef<number | null>(null);
  const cancelPendingExpand = (): void => {
    if (expandTimer.current !== null) {
      window.clearTimeout(expandTimer.current);
      expandTimer.current = null;
    }
  };
  const scheduleExpand = (folderId: string): void => {
    if (expanded.has(folderId)) return;
    if (expandTimer.current !== null) return;
    expandTimer.current = window.setTimeout(() => {
      expandTimer.current = null;
      setExpanded((prev) => new Set(prev).add(folderId));
    }, 650);
  };
  useEffect(() => {
    const clear = (): void => {
      cancelPendingExpand();
      setDropHover(null);
    };
    window.addEventListener("dragend", clear);
    return () => window.removeEventListener("dragend", clear);
  }, []);

  const onRowDragOver = (e: React.DragEvent, r: LibRow): void => {
    const isTrack = dragHasTrack(e);
    const isAlbum = dragHasAlbum(e);
    const isPlaylist = dragHasPlaylist(e);
    // Playlist rows (+ Downloads) take tracks and whole albums. __liked__
    // carries kind "playlist".
    const acceptsTracks =
      (r.kind === "playlist" || r.kind === "downloads") && (isTrack || isAlbum);
    // Folders take playlists and albums (file/import into the folder). A
    // track hovering a folder previews the folder and opens it so the drag
    // can land on a playlist inside — the same gesture, no second attempt.
    const acceptsCollections = r.kind === "folder" && (isPlaylist || isAlbum);
    const previewsFolder = r.kind === "folder" && isTrack && !isPlaylist && !isAlbum;
    if (!acceptsTracks && !acceptsCollections && !previewsFolder) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
    setDropHover(r.id);
    if (r.kind === "folder") scheduleExpand(r.id);
  };

  const onRowDragLeave = (e: React.DragEvent, r: LibRow): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDropHover((cur) => (cur === r.id ? null : cur));
      cancelPendingExpand();
    }
  };

  const onRowDrop = (e: React.DragEvent, r: LibRow): void => {
    cancelPendingExpand();
    if ((r.kind === "playlist" || r.kind === "downloads") && (dragHasTrack(e) || dragHasAlbum(e))) {
      e.preventDefault();
      e.stopPropagation();
      setDropHover(null);
      if (dragHasAlbum(e)) {
        const al = readAlbum(e);
        if (!al) return;
        if (r.kind === "downloads") {
          useUI.getState().toast("Albums can't be downloaded whole — drop a song instead", "info");
          return;
        }
        void dropAlbumOn(r, al);
        return;
      }
      const track = readTrack(e);
      if (!track) return;
      if (r.kind === "downloads") dropTrackOnDownloads(track);
      else dropTrackOn(r, track);
      return;
    }
    if (r.kind === "folder" && (dragHasPlaylist(e) || dragHasAlbum(e))) {
      e.preventDefault();
      e.stopPropagation();
      setDropHover(null);
      if (dragHasAlbum(e)) {
        const al = readAlbum(e);
        if (al) void importAlbum(al, r.id);
        return;
      }
      const pl = readPlaylist(e);
      if (!pl) return;
      // Local playlists are filed; YouTube playlists are imported.
      if (localPlaylistName(pl.id)) fileLocalPlaylist(pl.id, r.id);
      else void importPlaylist(pl, r.id);
      return;
    }
    if (r.kind === "folder" && dragHasTrack(e)) {
      // Folders hold playlists, not songs: open the folder so the drag can
      // finish on a playlist inside, and say so once.
      e.preventDefault();
      e.stopPropagation();
      setDropHover(null);
      setExpanded((prev) => new Set(prev).add(r.id));
      setPulse(r.id);
      window.setTimeout(() => setPulse((cur) => (cur === r.id ? null : cur)), 650);
      useUI.getState().toast(`“${r.title}” holds playlists — drop onto one of them`, "info");
    }
  };

  const onClickRow = (r: LibRow): void => {
    switch (r.kind) {
      case "artist":
        navigate({ name: "artist", param: r.id });
        break;
      case "playlist":
        if (r.id === "__liked__") navigate({ name: "library", param: "liked" });
        else if (r.artistId) navigate({ name: "artist", param: r.artistId });
        else navigate({ name: "playlist", param: r.id });
        break;
      case "downloads":
        navigate({ name: "downloads" });
        break;
      case "folder":
        toggleFolder(r.id);
        break;
      case "album":
        navigate({ name: "album", param: r.id });
        break;
      case "smart":
        navigate({ name: "smart", param: r.id });
        break;
    }
  };

  /** Right-click a row: pin/unpin shortcuts, album, playlist and folder options. */
  const onRowContextMenu = (e: React.MouseEvent, r: LibRow): void => {
    if (r.kind === "album" && r.release) {
      const album = r.release;
      e.preventDefault();
      e.stopPropagation();
      // Only songs that can play right now go into the queue.
      const playable = album.tracks.filter((t) => available(t));
      const none = playable.length === 0;
      openContextMenu(e.clientX, e.clientY, [
        { label: "Play", icon: Play, disabled: none, action: () => usePlayer.getState().playQueue(playable, 0) },
        {
          label: "Shuffle",
          icon: Shuffle,
          disabled: none,
          action: () => usePlayer.getState().playQueue([...playable].sort(() => Math.random() - 0.5), 0),
        },
        {
          label: "Add to queue",
          icon: ListEnd,
          disabled: none,
          action: () => {
            usePlayer.getState().addToQueue(playable);
            useUI.getState().toast(`Added “${album.title}” to the queue`);
          },
        },
        {
          label: "Edit album…",
          icon: Pencil,
          action: () => {
            useAlbumEditorRequest.setState({ key: album.key });
            navigate({ name: "album", param: album.route });
          },
        },
        // One entry per credited artist — "A, B" are two artists, two pages.
        ...splitCredits(album.artist).map((name, i, all) => ({
          label: all.length === 1 ? "Go to artist" : `Go to ${name}`,
          icon: User,
          separatorBefore: i === 0,
          action: () => navigate({ name: "artist", param: artistRoute(name) }),
        })),
      ]);
      return;
    }
    if (r.singleKey) {
      e.preventDefault();
      e.stopPropagation();
      const pinned = singlePinned(r.singleKey);
      openContextMenu(e.clientX, e.clientY, [
        {
          label: pinned ? "Unpin" : "Pin to top",
          icon: pinned ? PinOff : Pin,
          action: () => useLibrary.getState().togglePinSingle(r.singleKey!),
        },
      ]);
      return;
    }
    if (r.kind === "smart") {
      const sp = smartPlaylists.find((p) => p.id === r.id);
      if (!sp) return;
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e.clientX, e.clientY, [
        { label: "Edit rules", icon: Sparkles, action: () => useSmartEditor.getState().open(sp, false) },
        {
          label: "Delete smart playlist",
          danger: true,
          action: () => useSmartPlaylists.getState().remove(sp.id),
        },
      ]);
      return;
    }
    if (r.kind === "artist") {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e.clientX, e.clientY, [
        {
          label: "Remove from your library",
          danger: true,
          action: () => {
            useLibrary.getState().unfollowArtist(r.id);
            useUI.getState().toast(`Removed “${r.title}” from your library`);
          },
        },
      ]);
      return;
    }
    if (r.kind === "playlist" && r.id !== "__liked__") {
      const playlist = playlists.find((p) => p.id === r.id);
      if (!playlist) return;
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e.clientX, e.clientY, [
        {
          label: playlist.pinned ? "Unpin playlist" : "Pin playlist",
          // slashed pin = "currently pinned, click to undo" (Spotify's model)
          icon: playlist.pinned ? PinOff : Pin,
          action: () => useLibrary.getState().togglePinPlaylist(playlist.id),
        },
        ...playlistHeaderItems(playlist),
        ...playlistFolderItems(playlist),
      ]);
      return;
    }
    if (r.kind === "folder") {
      e.preventDefault();
      e.stopPropagation();
      openContextMenu(e.clientX, e.clientY, [
        {
          label: "Rename folder",
          action: () =>
            openDialog({
              title: "Rename folder",
              initialValue: r.title,
              placeholder: "Folder name",
              confirmLabel: "Save",
              onConfirm: (value) => useLibrary.getState().renameFolder(r.id, value),
            }),
        },
        {
          label: "Delete folder",
          danger: true,
          action: () => useLibrary.getState().deleteFolder(r.id),
        },
      ]);
    }
  };

  /** Right-click the library panel itself — Spotify's create menu. Rows stop
      propagation so they keep their own menus; everywhere else (header, empty
      space) offers playlist/folder creation, each asking for a name first so
      nothing empty lands in the library. */
  const onLibraryContextMenu = (e: React.MouseEvent): void => {
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY, [
      {
        label: "Create playlist",
        icon: ListPlus,
        action: () => {
          const suggested = `My Playlist #${useLibrary.getState().playlists.length + 1}`;
          openDialog({
            title: "New playlist",
            body: "Give your playlist a name.",
            initialValue: suggested,
            placeholder: "Playlist name",
            confirmLabel: "Create",
            onConfirm: (value) => {
              const p = useLibrary.getState().createPlaylist(value.trim() || suggested);
              navigate({ name: "playlist", param: p.id });
            },
          });
        },
      },
      {
        label: "Create folder",
        icon: Folder,
        action: () => {
          const suggested = `New Folder ${useLibrary.getState().folders.length + 1}`;
          openDialog({
            title: "New folder",
            body: "Give your folder a name.",
            initialValue: suggested,
            placeholder: "Folder name",
            confirmLabel: "Create",
            onConfirm: (value) => {
              const f = useLibrary.getState().createFolder(value.trim() || suggested);
              setExpanded((prev) => new Set(prev).add(f.id));
            },
          });
        },
      },
    ]);
  };

  return (
    <div
      className={`relative flex-1 min-h-0 flex flex-col glass-pill rounded-2xl overflow-hidden shadow-pill transition-shadow ${
        libHover ? "shadow-[0_0_44px_rgb(var(--accent)/0.14)]" : ""
      }`}
      onContextMenu={onLibraryContextMenu}
      onDragOver={(e) => {
        if (!dragHasPlaylist(e) && !dragHasArtist(e) && !dragHasAlbum(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        refreshGlow();
      }}
      onDragLeave={refreshGlow}
      onDrop={(e) => {
        clearGlow();
        const isPlaylist = dragHasPlaylist(e);
        const isArtist = !isPlaylist && dragHasArtist(e);
        const isAlbum = !isPlaylist && !isArtist && dragHasAlbum(e);
        if (!isPlaylist && !isArtist && !isAlbum) return;
        e.preventDefault();
        if (isPlaylist) {
          const pl = readPlaylist(e);
          if (!pl) return;
          // Local playlists dropped on the panel background are already
          // home — filing happens on folders, not here.
          const name = localPlaylistName(pl.id);
          if (name) {
            useUI.getState().toast(`“${name}” is already in your library`);
            return;
          }
          void importPlaylist(pl);
        } else if (isAlbum) {
          const al = readAlbum(e);
          if (al) void importAlbum(al);
        } else {
          const ar = readArtist(e);
          if (ar) followDroppedArtist(ar);
        }
      }}
    >
      {/* The whole-panel glow while a playlist/artist hovers over the panel. */}
      {libHover && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 rounded-2xl ring-2 ring-inset ring-accent/50 bg-accent/[0.05]"
        />
      )}
      {/* Header */}
      {collapsed ? (
        <div className="flex justify-center pt-4 pb-2">
          <button
            onClick={() => setCollapsed(false)}
            title="Expand Your Library"
            aria-label="Expand Your Library"
            className="w-10 h-10 grid place-items-center rounded-full text-ink-hi/70 hover:text-ink-hi hover:bg-ink-hi/[0.08] transition-colors"
          >
            <PanelLeftOpen className="w-5 h-5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-5 pt-4 pb-2">
          <button
            onClick={() => navigate({ name: "library" })}
            className="flex items-center gap-2 text-[14px] font-semibold text-ink-hi/75 hover:text-ink-hi transition-colors"
          >
            <Library className="w-4 h-4" />
            Your Library
          </button>
          <div className="ml-auto flex items-center gap-1">
            {/* + opens Spotify's create dropdown — Playlist / Folder, no modal. */}
            <CreateMenu onFolderCreated={(f) => setExpanded((prev) => new Set(prev).add(f.id))} />
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse Your Library"
              aria-label="Collapse Your Library"
              className="w-8 h-8 grid place-items-center rounded-full text-ink-hi/60 hover:text-ink-hi hover:bg-ink-hi/[0.08] transition-colors"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Filter chips, Spotify's: one category at a time (a second click shows
          everything again); the sort button orders the albums. */}
      {!collapsed && (
        <div className="flex items-center gap-2 px-4 pb-2">
          {(Object.keys(FILTER_LABEL) as LibFilter[])
            .filter((k) => k !== "artists" || followedArtists.length > 0)
            .map((k) => (
              <button
                key={k}
                onClick={() => setFilter((f) => (f === k ? null : k))}
                aria-pressed={filter === k}
                className={`h-8 px-3 rounded-full text-[13px] font-medium transition-colors ${
                  filter === k ? "bg-ink-hi text-black" : "bg-ink-hi/[0.07] text-ink-hi hover:bg-ink-hi/[0.12]"
                }`}
              >
                {FILTER_LABEL[k]}
              </button>
            ))}
          {show("albums") && albums.length > 1 && (
            <button
              ref={sortButtonRef}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                openSortMenu();
              }}
              title={`Sort albums: ${SORT_LABEL[albumSort]}`}
              aria-label={`Sort albums: ${SORT_LABEL[albumSort]}`}
              className="ml-auto w-8 h-8 grid place-items-center rounded-full text-ink-hi/60 hover:text-ink-hi hover:bg-ink-hi/[0.08] transition-colors"
            >
              <ArrowUpDown className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {/* Rows — drops bubble to the panel root, which imports playlists and
          artists anywhere they land; specific rows handle their own targets. */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2 pt-1 space-y-0.5">
        {rows.length === 0 && !collapsed ? (
          <div className="px-3 py-8 text-center text-[13px] text-ink-hi/55">
            Nothing here yet — play a track to fill your library.
          </div>
        ) : (
          rows.map((r) => {
            const isCurrent = r.kind === "album" ? current?.albumId === r.id : current?.id === r.id;
            return (
              <button
                key={`${r.kind}-${r.id}`}
                onClick={() => onClickRow(r)}
                onContextMenu={(e) => onRowContextMenu(e, r)}
                onDragOver={(e) => onRowDragOver(e, r)}
                onDragLeave={(e) => onRowDragLeave(e, r)}
                onDrop={(e) => onRowDrop(e, r)}
                title={
                  r.available === false
                    ? `${r.title} · not available right now`
                    : collapsed
                      ? `${r.title} · ${r.subtitle}`
                      : undefined
                }
                aria-label={collapsed ? r.title : undefined}
                // Hundreds of album rows: only the ones on screen are laid out and painted.
                style={r.kind === "album" ? { contentVisibility: "auto", containIntrinsicSize: "auto 64px" } : undefined}
                className={`group w-full flex items-center gap-3 p-2 rounded-lg text-left hover:bg-ink-hi/[0.05] active:bg-ink-hi/[0.09] transition-[background-color,transform,opacity] duration-150 ${
                  collapsed ? "justify-center" : r.kind === "playlist" && r.folderId ? "pl-6" : ""
                } ${dropHover === r.id ? "ring-2 ring-inset ring-accent/60 bg-ink-hi/[0.08] scale-[1.02]" : ""} ${
                  pulse === r.id ? "animate-drop-pulse" : ""
                } ${r.available === false ? "opacity-40" : ""}`}
              >
                {/* max-w-none on the artwork: the base styles cap images at
                    their row's width, and in the icon rail (narrower still
                    once the list scrolls) that squeezed covers into
                    portrait rectangles. */}
                {r.kind === "artist" ? (
                  r.thumb ? (
                    <img
                      src={upgradeArtwork(r.thumb)}
                      alt=""
                      className="w-12 h-12 max-w-none rounded-full object-cover art-hairline shrink-0"
                    />
                  ) : (
                    <span className="w-12 h-12 rounded-full bg-ink-hi/[0.06] art-hairline shrink-0 grid place-items-center">
                      <User className="w-5 h-5 text-ink-hi/55" />
                    </span>
                  )
                ) : r.kind === "folder" ? (
                  <span className="w-12 h-12 rounded-md bg-ink-hi/[0.06] art-hairline shrink-0 grid place-items-center">
                    <Folder className="w-5 h-5 text-ink-hi/55" />
                  </span>
                ) : r.kind === "album" ? (
                  r.thumb ? (
                    <img
                      src={upgradeArtwork(r.thumb)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-12 h-12 max-w-none rounded-md object-cover art-hairline shrink-0"
                    />
                  ) : (
                    <span className="w-12 h-12 rounded-md bg-ink-hi/[0.06] art-hairline shrink-0 grid place-items-center">
                      <Disc3 className="w-5 h-5 text-ink-hi/55" />
                    </span>
                  )
                ) : r.kind === "smart" ? (
                  <span className="w-12 h-12 rounded-md bg-accent/15 art-hairline shrink-0 grid place-items-center">
                    <Sparkles className="w-5 h-5 text-accent" />
                  </span>
                ) : r.thumb ? (
                  <img src={upgradeArtwork(r.thumb)} alt="" className="w-12 h-12 max-w-none rounded-md object-cover art-hairline shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-md bg-ink-hi/[0.06] art-hairline shrink-0 grid place-items-center">
                    {r.kind === "downloads" ? (
                      <Download className="w-4 h-4 text-ink-hi/35" />
                    ) : r.kind === "playlist" ? (
                      <Music2 className="w-4 h-4 text-ink-hi/35" />
                    ) : (
                      <Heart className="w-4 h-4 text-ink-hi/35" />
                    )}
                  </div>
                )}
                {!collapsed && (
                  <>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-[14px] font-semibold truncate ${
                          isCurrent ? "text-ink-hi" : "text-ink-hi"
                        }`}
                      >
                        {r.title}
                      </div>
                      <div className="text-[12.5px] text-ink-hi/55 truncate mt-0.5">{r.subtitle}</div>
                    </div>
                    {isCurrent && playing && <EqBars />}
                    {((r.singleKey && r.pinned) ||
                      (r.kind === "playlist" &&
                        !r.singleKey &&
                        playlists.find((p) => p.id === r.id)?.pinned)) && (
                      <Pin className="w-3.5 h-3.5 text-accent shrink-0 fill-accent/20" aria-label="Pinned" />
                    )}
                    {r.kind === "folder" &&
                      (expanded.has(r.id) ? (
                        <ChevronDown className="w-4 h-4 text-ink-hi/45 shrink-0" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-ink-hi/45 shrink-0" />
                      ))}
                  </>
                )}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ============================================================ root */

export function Sidebar() {
  const collapsed = useSettings((s) => s.sidebarCollapsed);
  return (
    <aside
      className={`${collapsed ? "w-[80px]" : "w-[328px]"} shrink-0 flex flex-col min-h-0 transition-[width] duration-200 ease-out`}
    >
      <LibraryPill collapsed={collapsed} />
    </aside>
  );
}
