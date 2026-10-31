/**
 * The Discord status follows playback while it is turned on in Settings: the
 * song, its artist and how far into it we are. An update goes out on a song
 * change, play/pause, and whenever the clock Discord counts with drifts off
 * by more than 2 s (a seek, a stall, a speed change) — not per position tick.
 * Paused or stopped, the status is cleared, as Spotify's is. The main
 * process holds the connection to Discord and spaces the updates out.
 */
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";

const DRIFT_MS = 2000;

/** Mount once (App). */
export function watchDiscordPresence(): () => void {
  const bridge = window.bytune;
  if (!bridge?.discordConfigure) return () => undefined;

  /** what was sent last: song + length, "" = cleared, null = nothing yet */
  let shown: string | null = null;
  let shownStart = 0;

  const push = (): void => {
    const settings = useSettings.getState();
    const p = usePlayer.getState();
    const track = p.queue[p.index];
    if (!settings.discordPresence || !track || !p.playing) {
      if (shown !== "") {
        shown = "";
        bridge.discordActivity(null);
      }
      return;
    }
    // Discord counts in wall-clock time: at another speed a song takes longer or shorter.
    const rate = settings.playbackSpeed > 0 ? settings.playbackSpeed : 1;
    const length = p.duration > 0 ? p.duration : track.duration;
    const startedAt = Math.round(Date.now() - (p.position * 1000) / rate);
    const key = `${track.id}|${length > 0 ? Math.round(length) : 0}`;
    if (key === shown && Math.abs(startedAt - shownStart) < DRIFT_MS) return;
    shown = key;
    shownStart = startedAt;
    bridge.discordActivity({
      title: track.title,
      artist: track.artist,
      startedAt,
      endsAt: length > 0 ? Math.round(startedAt + (length * 1000) / rate) : 0,
    });
  };

  const configure = (): void => {
    const s = useSettings.getState();
    void bridge.discordConfigure(s.discordPresence, s.discordClientId).catch(() => undefined);
    shown = null;
    push();
  };

  configure();
  const offSettings = useSettings.subscribe((s, prev) => {
    if (s.discordPresence !== prev.discordPresence || s.discordClientId !== prev.discordClientId) configure();
    else if (s.playbackSpeed !== prev.playbackSpeed) push();
  });
  const offPlayer = usePlayer.subscribe((s, prev) => {
    if (
      s.playing !== prev.playing ||
      s.index !== prev.index ||
      s.queue[s.index]?.id !== prev.queue[prev.index]?.id ||
      s.position !== prev.position ||
      s.duration !== prev.duration
    ) {
      push();
    }
  });
  return () => {
    offSettings();
    offPlayer();
  };
}
