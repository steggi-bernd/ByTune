/** Builds right-click / "more" menu items for tracks and playlists. */
import {
  Disc3,
  Download,
  FolderOpen,
  Heart,
  ListMusic,
  ListPlus,
  ListStart,
  Pencil,
  Play,
  RotateCcw,
  Search,
  Split,
  Trash2,
  User,
} from "lucide-react";
import { downloadForOffline, SERVER_SONG, startDownload } from "./downloads";
import type { TrackSource } from "./dnd";
import { versionsOf } from "../stores/catalog";
import { useLibrary, type Playlist } from "../stores/library";
import { usePlayer } from "../stores/player";
import { useUI, type MenuItem } from "../stores/ui";
import type { Track } from "../types";

/**
 * Branch off: the song — next, or where it was dropped — and after it the rest
 * of the list it came from, in that list's order. What was coming in the
 * queue goes on afterwards, minus the songs the branch already plays.
 */
export function branchOff(from: TrackSource, at?: number): void {
  const rest = from.tracks.slice(from.index);
  if (!rest.length) return;
  const player = usePlayer.getState();
  if (!player.queue.length) {
    player.playQueue(rest, 0);
    return;
  }
  player.insertInQueue(rest, at ?? player.index + 1, true);
  useUI.getState().toast(`Branching off into “${from.name}” — ${rest.length} ${rest.length === 1 ? "song" : "songs"}`);
}

/** After a song dropped into the queue: the rest of its list behind it, wherever the song is now. */
export function branchOffAfterDrop(from: TrackSource): void {
  const { queue, index } = usePlayer.getState();
  const song = from.tracks[from.index];
  const at = queue.findIndex((t, i) => i > index && t.id === song?.id);
  const rest = from.tracks.slice(from.index + 1);
  if (at < 0 || !rest.length) return;
  usePlayer.getState().insertInQueue(rest, at + 1, true);
  useUI.getState().toast(`Then the rest of “${from.name}” — ${rest.length} ${rest.length === 1 ? "song" : "songs"}`);
}

export function trackMenuItems(track: Track, from?: TrackSource): MenuItem[] {
  const lib = useLibrary.getState();
  const ui = useUI.getState();
  const liked = lib.isLiked(track.id);

  const items: MenuItem[] = [
    {
      label: "Play now",
      icon: Play,
      action: () => usePlayer.getState().playTrack(track),
    },
    {
      label: "Play next",
      icon: ListStart,
      action: () => {
        usePlayer.getState().addToQueue(track, true);
        useUI.getState().toast("Playing next");
      },
    },
    // Under "Play next": the same, then the rest of the list the song is in.
    ...(from && from.index < from.tracks.length - 1
      ? [{ label: `Branch off into “${from.name}”`, icon: Split, action: () => branchOff(from) }]
      : []),
    {
      label: "Add to queue",
      icon: ListPlus,
      action: () => {
        usePlayer.getState().addToQueue(track);
        useUI.getState().toast("Added to queue");
      },
    },
    {
      separatorBefore: true,
      label: liked ? "Remove from Liked" : "Add to Liked",
      icon: Heart,
      action: () => useLibrary.getState().toggleLike(track),
    },
  ];

  const playlists = lib.playlists.slice(0, 6);
  for (const p of playlists) {
    items.push({
      label: `Add to "${p.name}"`,
      action: () => {
        const added = useLibrary.getState().addToPlaylist(p.id, track);
        useUI.getState().toast(added ? `Added to "${p.name}"` : "Already in this playlist");
      },
    });
  }
  items.push({
    label: "New playlist…",
    icon: ListMusic,
    action: () => {
      // Name it before it exists — cancel creates nothing and the track
      // stays where it was. Blank confirm keeps the numbered default.
      const suggested = `Playlist ${useLibrary.getState().playlists.length + 1}`;
      useUI.getState().openDialog({
        title: "New playlist",
        body: `Add "${track.title}" to a new playlist.`,
        initialValue: suggested,
        placeholder: "Playlist name",
        confirmLabel: "Create",
        onConfirm: (value) => {
          const lib = useLibrary.getState();
          const playlist = lib.createPlaylist(value.trim() || suggested);
          lib.addToPlaylist(playlist.id, track);
          useUI.getState().navigate({ name: "playlist", param: playlist.id });
        },
      });
    },
  });

  // Local player: no share links — a song's home is a file on this device or
  // an item on the user's server, which can get an offline copy.
  if (track.localPath) {
    items.push({
      separatorBefore: true,
      label: "Show in folder",
      icon: FolderOpen,
      action: () => requireReveal(track.localPath as string),
    });
  } else if (SERVER_SONG.test(track.id) && !versionsOf(track).some((v) => v.localPath)) {
    items.push({
      separatorBefore: true,
      label: "Download for offline",
      icon: Download,
      action: () => void downloadForOffline([track]),
    });
  }

  if (track.albumId?.startsWith("lib:album:")) {
    items.push({
      separatorBefore: true,
      label: "Go to album",
      icon: Disc3,
      action: () => useUI.getState().navigate({ name: "album", param: track.albumId }),
    });
  }
  if (track.artistId?.startsWith("lib:artist:")) {
    items.push({
      separatorBefore: !track.albumId,
      label: "Go to artist",
      icon: User,
      action: () => useUI.getState().navigate({ name: "artist", param: track.artistId }),
    });
  } else if (track.artist && track.artist.toLowerCase() !== "unknown artist") {
    items.push({
      separatorBefore: !track.localPath,
      label: `More by ${track.artist}`,
      icon: Search,
      action: () => {
        useUI.getState().setSearchQuery(track.artist);
        useUI.getState().navigate({ name: "search" });
      },
    });
  }

  return items;
}

function requireReveal(path: string): void {
  if (window.bytune) window.bytune.revealPath(path);
}

export function playlistMenuItems(playlist: Playlist, track: Track, from?: TrackSource): MenuItem[] {
  return [
    {
      label: "Remove from this playlist",
      icon: Trash2,
      danger: true,
      action: () => {
        useLibrary.getState().removeFromPlaylist(playlist.id, track.id);
        useUI.getState().toast("Removed from playlist");
      },
    },
    ...trackMenuItems(track, from),
  ];
}

export function playlistHeaderItems(playlist: Playlist): MenuItem[] {
  return [
    {
      label: "Rename",
      icon: Pencil,
      action: () => {
        useUI.getState().openDialog({
          title: "Rename playlist",
          initialValue: playlist.name,
          placeholder: "Playlist name",
          confirmLabel: "Rename",
          onConfirm: (value) => {
            if (value.trim()) useLibrary.getState().renamePlaylist(playlist.id, value);
          },
        });
      },
    },
    {
      label: "Delete playlist",
      icon: Trash2,
      danger: true,
      action: () => {
        useUI.getState().openDialog({
          title: `Delete "${playlist.name}"?`,
          body: "This can't be undone. The tracks themselves aren't affected.",
          confirmLabel: "Delete",
          danger: true,
          onConfirm: () => {
            useLibrary.getState().deletePlaylist(playlist.id);
            useUI.getState().navigate({ name: "playlists" });
            useUI.getState().toast("Playlist deleted", "info");
          },
        });
      },
    },
  ];
}

/** File a playlist into a library folder (or back out to the top level). */
export function playlistFolderItems(playlist: Playlist): MenuItem[] {
  const folders = useLibrary.getState().folders;
  const items: MenuItem[] = folders.map((f, i) => ({
    label: f.id === playlist.folderId ? `✓ ${f.name}` : `Move to “${f.name}”`,
    icon: FolderOpen,
    separatorBefore: i === 0,
    action: () => useLibrary.getState().setPlaylistFolder(playlist.id, f.id),
  }));
  if (playlist.folderId) {
    items.push({
      label: "Remove from folder",
      icon: FolderOpen,
      separatorBefore: true,
      action: () => useLibrary.getState().setPlaylistFolder(playlist.id, null),
    });
  }
  return items;
}

export function historyMenuItems(track: Track): MenuItem[] {
  return [
    {
      label: "Remove from history",
      icon: Trash2,
      danger: true,
      action: () => {
        const lib = useLibrary.getState();
        lib.clearHistory();
        // Re-add everything except this track.
        lib.history
          .filter((t) => t.id !== track.id)
          .slice()
          .reverse()
          .forEach((t) => lib.pushHistory(t));
      },
    },
    ...trackMenuItems(track),
  ];
}

export function downloadMenuItems(track: Track, path: string | null): MenuItem[] {
  return [
    {
      label: "Show in folder",
      icon: FolderOpen,
      action: () => {
        if (path) requireReveal(path);
      },
    },
    {
      label: "Retry download",
      icon: RotateCcw,
      action: () => void startDownload(track),
    },
  ];
}
