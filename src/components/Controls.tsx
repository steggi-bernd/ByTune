import { useCallback, useState } from "react";
import { Volume1, Volume2 } from "lucide-react";
import { getPlaybackPosition } from "../lib/audio";
import { useVolumeTarget } from "../lib/cast";
import { fmtTime } from "../lib/format";
import { usePlayer } from "../stores/player";
import { Slider } from "./Slider";
import { T } from "../lib/i18n";

interface SeekBarProps {
  large?: boolean;
  showRemaining?: boolean;
  /** the player-bar variant (kept for callers; every seek bar is the slim line now) */
  thin?: boolean;
}

export function SeekBar({ large = false, showRemaining = false }: SeekBarProps) {
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const buffered = usePlayer((s) => s.buffered);
  const playing = usePlayer((s) => s.playing);
  const seek = usePlayer((s) => s.seek);
  // While the handle is held the drag is purely visual — the audio keeps
  // playing untouched; the real seek happens once, on release.
  const [scrub, setScrub] = useState<number | null>(null);
  const max = duration > 0 ? duration : 0;
  const shown = scrub !== null ? scrub * max : max > 0 ? Math.min(position, max) : position;
  // While playing, the fill follows the element's clock every frame instead
  // of ticking with the store's ~4 Hz position updates.
  const live = useCallback(() => (max > 0 ? getPlaybackPosition() / max : 0), [max]);
  const label = large ? "text-ink-faint w-12 text-[13px]" : "w-[50px] text-[12px] leading-[17px] text-[#b3b3b3]";

  return (
    <div className={`flex items-center ${large ? "gap-3 w-full" : "gap-2 w-full"}`}>
      <span className={`shrink-0 text-right tabular-nums ${label}`}>{fmtTime(shown)}</span>
      <Slider
        className="flex-1"
        label={T("Seek")}
        value={max > 0 ? position / max : 0}
        buffered={max > 0 ? Math.max(buffered, position / max) : 0}
        live={playing && max > 0 ? live : undefined}
        onScrub={setScrub}
        onCommit={(v) => {
          if (max > 0) seek(v * max);
        }}
        step={max > 0 ? 5 / max : 0.01}
        valueText={`${fmtTime(shown)} of ${fmtTime(duration)}`}
        disabled={max <= 0}
      />
      <span className={`shrink-0 tabular-nums ${label}`}>
        {showRemaining ? `-${fmtTime(Math.max(0, duration - shown))}` : fmtTime(duration)}
      </span>
    </div>
  );
}

export function VolumeControl({ VolIcon }: { VolIcon: (p: { className?: string }) => React.ReactElement }) {
  // While a network player has the music, its volume (lib/cast.ts).
  const { value: volume, muted, fixed, setVolume, toggleMute } = useVolumeTarget();
  const shown = muted ? 0 : volume;

  return (
    <div className="flex items-center" title={fixed ? T("This player's volume is set on the player") : undefined}>
      <button
        onClick={toggleMute}
        disabled={fixed}
        className="grid h-8 w-8 place-items-center text-[#b3b3b3] transition-colors hover:text-white disabled:opacity-40"
        title={muted ? T("Unmute") : T("Mute")}
        aria-label={muted ? T("Unmute") : T("Mute")}
      >
        <span key={muted ? "muted" : "on"} className="icon-swap">
          <VolIcon className="w-4 h-4" />
        </span>
      </button>
      <Slider
        className="w-[93px]"
        label={T("Volume")}
        value={shown}
        onChange={setVolume}
        step={0.05}
        valueText={`${Math.round(shown * 100)}%`}
        disabled={fixed}
      />
    </div>
  );
}

/**
 * Full-width volume row — the mobile player's volume treatment:
 * quiet speaker at the left end, loud speaker at the right, one long slider
 * between them. Used on the full-screen NowPlaying overlay.
 */
export function VolumeRow() {
  const { value: volume, muted, fixed, setVolume, toggleMute } = useVolumeTarget();
  const shown = muted ? 0 : volume;

  return (
    <div className="w-full flex items-center gap-3">
      <button
        onClick={toggleMute}
        className="text-ink-hi/60 hover:text-ink-hi transition-all active:scale-90 shrink-0"
        title={muted ? T("Unmute") : T("Mute")}
        aria-label={muted ? T("Unmute") : T("Mute")}
      >
        <Volume1 className="w-5 h-5" />
      </button>
      <Slider
        className="flex-1"
        label={T("Volume")}
        value={shown}
        onChange={setVolume}
        step={0.05}
        valueText={`${Math.round(shown * 100)}%`}
        disabled={fixed}
      />
      <button
        onClick={toggleMute}
        className="text-ink-hi/60 hover:text-ink-hi transition-all active:scale-90 shrink-0"
        title={T("Volume up")}
        aria-label={T("Volume up")}
      >
        <Volume2 className="w-5 h-5" />
      </button>
    </div>
  );
}
