/** A song muted just now, here or on another device, isn't coming up any more; and if it's on, it goes. */
import { songKey } from "../stores/catalog";
import { useMuted } from "../stores/muted";
import { usePlayer } from "../stores/player";

export function watchMutedSongs(): () => void {
  return useMuted.subscribe((s, prev) => {
    if (s.tracks === prev.tracks) return;
    const before = new Set(prev.tracks.map((t) => songKey(t.id)));
    const newly = new Set(s.tracks.map((t) => songKey(t.id)).filter((key) => !before.has(key)));
    if (!newly.size) return;
    const { queue, index } = usePlayer.getState();
    const upcoming = queue.slice(index + 1);
    const left = upcoming.filter((t) => !newly.has(songKey(t.id)));
    if (left.length !== upcoming.length) usePlayer.setState({ queue: [...queue.slice(0, index + 1), ...left] });
    const current = queue[index];
    if (current && newly.has(songKey(current.id))) {
      if (left.length) usePlayer.getState().next();
      else usePlayer.getState().setPlaying(false);
    }
  });
}
