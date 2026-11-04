/** A song muted just now, here or on another device, isn't coming up any more; and if it's on, it goes. */
import { songKey } from "../stores/catalog";
import { useMuted } from "../stores/muted";
import { usePlayer } from "../stores/player";
import { withoutSongs } from "./queueSections";

export function watchMutedSongs(): () => void {
  return useMuted.subscribe((s, prev) => {
    if (s.tracks === prev.tracks) return;
    const before = new Set(prev.tracks.map((t) => songKey(t.id)));
    const newly = new Set(s.tracks.map((t) => songKey(t.id)).filter((key) => !before.has(key)));
    if (!newly.size) return;
    const { queue, index, lineEnd, branches } = usePlayer.getState();
    const upcoming = queue.slice(index + 1);
    const left = upcoming.filter((t) => !newly.has(songKey(t.id)));
    if (left.length !== upcoming.length) {
      // What goes from the songs asked for by hand makes that part shorter too.
      const goes = upcoming.filter((t) => newly.has(songKey(t.id)));
      const inLine = upcoming.slice(0, Math.max(0, lineEnd - index - 1)).filter((t) => newly.has(songKey(t.id))).length;
      usePlayer.setState({
        queue: [...queue.slice(0, index + 1), ...left],
        lineEnd: Math.max(0, lineEnd - inLine),
        branches: withoutSongs(branches, new Set(goes.map((t) => t.id))),
      });
    }
    const current = queue[index];
    if (current && newly.has(songKey(current.id))) {
      if (left.length) usePlayer.getState().next();
      else usePlayer.getState().setPlaying(false);
    }
  });
}
