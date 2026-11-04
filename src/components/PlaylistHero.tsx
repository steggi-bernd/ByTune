/**
 * A playlist page's header: its picture full-bleed, melting into the page,
 * the name and the "PLAYLIST • N SONGS • ABOUT 3:2X" line over its lower edge,
 * round glass controls under them. Shared by the playlists and an artist's
 * liked songs. The page's panel shows no wash behind it (TintWash in App).
 */
import type { ReactNode } from "react";
import { MoreHorizontal, Pause, Play, Shuffle } from "lucide-react";
import { T } from "../lib/i18n";

const ROUND = "w-11 h-11 grid place-items-center rounded-full bg-black/45 border border-white/10 text-white backdrop-blur-sm hover:bg-black/60 transition-all active:scale-[0.98]";

export function PlaylistHero({
  art,
  title,
  meta,
  onShuffle,
  onPlay,
  onMore,
  playing = false,
}: {
  art: ReactNode;
  title: string;
  meta: string;
  onShuffle: () => void;
  onPlay: () => void;
  onMore: (x: number, y: number) => void;
  /** the page's songs are playing: the button says Pause */
  playing?: boolean;
}) {
  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0">
        {art}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to bottom,
              rgb(var(--page-bg) / 0.20) 0%,
              rgb(var(--page-bg) / 0.45) 50%,
              rgb(var(--page-bg) / 0.90) 80%,
              rgb(var(--page-bg)) 100%)`,
          }}
        />
      </div>

      <div className="relative flex flex-col items-center text-center px-8 pt-[244px] pb-5">
        {/* leading-[1.35]: Segoe UI's ascent+descent needs ~1.33em — any
            tighter and line-clamp's overflow:hidden slices the descenders. */}
        <h1 className="font-display text-[34px] leading-[1.35] font-extrabold tracking-[-0.03em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)] break-words max-w-3xl line-clamp-2">
          {title}
        </h1>
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-white/70 mt-1.5 drop-shadow-[0_1px_6px_rgba(0,0,0,0.5)]">
          {meta}
        </div>

        <div className="flex items-center justify-center gap-2.5 mt-4">
          {/* No `disabled` dimming when empty — playing no songs does nothing,
              and grayed-out buttons made fresh playlists look broken. */}
          <button onClick={onShuffle} title={T("Shuffle")} aria-label={T("Shuffle")} className={ROUND}>
            <Shuffle className="w-[18px] h-[18px]" />
          </button>
          <button
            onClick={onPlay}
            className="inline-flex items-center gap-2 h-11 px-6 rounded-full bg-black/45 border border-white/10 text-[14.5px] font-semibold text-white backdrop-blur-sm hover:bg-black/60 transition-all active:scale-[0.98]"
          >
            {playing ? <Pause className="w-[18px] h-[18px] fill-current" /> : <Play className="w-[18px] h-[18px] fill-current" />}
            {playing ? T("Pause") : T("Play")}
          </button>
          <button onClick={(e) => onMore(e.clientX, e.clientY)} title={T("More options")} aria-label={T("More options")} className={ROUND}>
            <MoreHorizontal className="w-[18px] h-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );
}
