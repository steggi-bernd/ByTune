import { Fragment, memo, useCallback } from "react";
import { AlertCircle, Check, Download, Heart, Loader2, MoreHorizontal, Pause, Play } from "lucide-react";
import { useAvailabilityCheck } from "../stores/availability";
import { sameSong } from "../stores/catalog";
import { likedIdSet, useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { tintHoverHandlers, useUI, type MenuItem } from "../stores/ui";
import { trackMenuItems } from "../lib/trackActions";
import { useDrag } from "../lib/dnd";
import { fmtTime } from "../lib/format";
import { Artwork, EqBars, EmptyState, ExplicitBadge } from "./primitives";
import { ArtistLinks } from "./ArtistLinks";
import type { Track } from "../types";

/** Download state glyph for a track row — spinner / green check / red fail. */
export function DownloadBadge({ id }: { id: string }) {
  const dl = useLibrary((s) => s.downloads[id]);
  if (!dl) return null;
  if (dl.status === "downloading") {
    return (
      <span className="p-1.5 rounded-md text-ink-hi" title="Downloading…">
        <Loader2 className="w-4 h-4 animate-spin" />
      </span>
    );
  }
  if (dl.status === "done") {
    return (
      <span className="p-1.5 rounded-md text-emerald-400" title="Downloaded">
        <Check className="w-4 h-4" />
      </span>
    );
  }
  return (
    <span className="p-1.5 rounded-md text-red-400" title="Download failed">
      <AlertCircle className="w-4 h-4" />
    </span>
  );
}

interface TrackRowProps {
  track: Track;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  /** false while none of the song's copies can be reached (drive or server away) */
  available: boolean;
  onPlay: (index: number) => void;
  menuFor: (track: Track) => MenuItem[];
  showAlbum: boolean;
}

/**
 * One song row. Memoized: a list re-renders on every track change or
 * play/pause, but only the rows whose props actually change (the old and the
 * new current row) do work — the rest are skipped.
 */
const TrackRow = memo(function TrackRow({ track, index, isCurrent, isPlaying, available, onPlay, menuFor, showAlbum }: TrackRowProps) {
  const liked = useLibrary((s) => likedIdSet(s.liked).has(track.id));
  const toggleLike = useLibrary((s) => s.toggleLike);
  const openContextMenu = useUI((s) => s.openContextMenu);
  const navigate = useUI((s) => s.navigate);
  const drag = useDrag({ track });

  const openMenu = (x: number, y: number): void => {
    openContextMenu(x, y, menuFor(track));
  };

  /** The row's own spot plays it — and pauses/resumes it once it's the current song. */
  const activate = (): void => {
    if (isCurrent) usePlayer.getState().toggle();
    else if (available) onPlay(index);
    else useUI.getState().toast(`"${track.title}" can't be reached right now — its drive or server is away`, "warning");
  };

  return (
    <div
      {...tintHoverHandlers(track.thumb)}
      {...drag.props}
      onClick={activate}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(e.clientX, e.clientY);
      }}
      title={available ? undefined : "Not available right now — its drive or server can't be reached"}
      aria-disabled={!available || undefined}
      // Long lists: rows off screen are neither laid out nor painted.
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 60px" }}
      className={`group flex items-center gap-3.5 h-[60px] px-3 rounded-lg select-none ${available ? "cursor-pointer" : "cursor-default"} ${
        isCurrent ? "bg-ink-hi/[0.14]" : "hover:bg-ink-hi/[0.05]"
      } ${drag.dragging || !available ? "opacity-40" : ""}`}
    >
      {/* index (EQ bars while playing); on hover, play/pause at the same spot */}
      <div className="w-7 shrink-0 grid place-items-center text-[13px] text-ink-faint tabular-nums">
        <span className={available || isCurrent ? "group-hover:hidden" : ""}>
          {isCurrent && isPlaying ? <EqBars /> : <span className={isCurrent ? "text-accent font-medium" : ""}>{index + 1}</span>}
        </span>
        {(available || isCurrent) && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              activate();
            }}
            className="hidden group-hover:block text-ink-hi hover:text-ink-hi transition-colors"
            title={isCurrent && isPlaying ? "Pause" : "Play"}
            aria-label={isCurrent && isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
          >
            {isCurrent && isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
          </button>
        )}
      </div>

      <Artwork
        src={track.thumb}
        className="w-[52px] h-[52px] rounded-lg shrink-0"
        iconClassName="w-4 h-4"
        alt=""
      />

      {/* min-w floor: with showAlbum the fixed columns (index · artwork · album ·
          controls · time) can exceed a narrow list and, because the title's flex
          basis is 0, it would collapse to zero width before anything else gives.
          The floor keeps the title visible; the album column shrinks instead. */}
      <div className="flex-1 min-w-[120px]">
        <div className={`flex items-center gap-1.5 text-[16px] font-semibold tracking-[-0.2px] ${isCurrent ? "text-ink-hi" : "text-ink-hi"}`}>
          {track.explicit && <ExplicitBadge />}
          <span className="truncate">{track.title}</span>
        </div>
        <div className="text-[14px] truncate text-ink-dim mt-0.5">
          {track.artistId?.startsWith("lib:artist:") ? (
            <ArtistLinks artist={track.artist} className="hover:text-ink transition-colors" />
          ) : (
            track.artist
          )}
        </div>
      </div>

      {showAlbum && (
        <div className="w-52 hidden xl:block text-xs text-ink-faint truncate">
          {track.albumId ? (
            <button
              className="hover:text-ink hover:underline text-left transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                navigate({ name: "album", param: track.albumId });
              }}
            >
              {track.album ?? "Single"}
            </button>
          ) : (
            track.album ?? ""
          )}
        </div>
      )}

      <div className="w-[88px] shrink-0 flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(track);
          }}
          title={liked ? "Remove from Liked" : "Add to Liked"}
          aria-label={liked ? "Remove from Liked" : "Add to Liked"}
          className="p-1.5 rounded-md text-ink-faint hover:text-ink-hi hover:bg-ink-hi/[0.07] transition-colors"
        >
          <Heart key={liked ? "liked" : "unliked"} className={`w-4 h-4 animate-icon-pop ${liked ? "fill-ink-hi text-ink-hi" : ""}`} />
        </button>
        <span className="opacity-80">
          <DownloadBadge id={track.id} />
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e.clientX, e.clientY);
          }}
          title="More options"
          aria-label="More options"
          className="p-1.5 rounded-md text-ink-faint hover:text-ink-hi hover:bg-ink-hi/[0.07] transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      <div className="w-11 shrink-0 text-right text-xs text-ink-faint tabular-nums">
        {track.duration > 0 ? fmtTime(track.duration) : "—"}
      </div>
    </div>
  );
});

interface TrackListProps {
  tracks: Track[];
  onPlay?: (index: number) => void;
  showAlbum?: boolean;
  showHeader?: boolean;
  menuFor?: (track: Track) => MenuItem[];
  emptyLabel?: string;
  emptyTitle?: string;
}

export function TrackList({
  tracks,
  onPlay,
  showAlbum = true,
  showHeader = true,
  menuFor = trackMenuItems,
  emptyLabel,
  emptyTitle = "Nothing here yet",
}: TrackListProps) {
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const playing = usePlayer((s) => s.playing);
  const playQueue = usePlayer((s) => s.playQueue);
  const available = useAvailabilityCheck();
  // Songs that can't play right now stay out of the queue (the clicked one can).
  // Stable across renders, so the memoized rows don't all re-render with it.
  const playFromList = useCallback(
    (i: number) => {
      const queue: Track[] = [];
      let start = 0;
      tracks.forEach((t, j) => {
        if (j === i) start = queue.length;
        if (j === i || available(t)) queue.push(t);
      });
      playQueue(queue, start);
    },
    [tracks, available, playQueue]
  );
  const play = onPlay ?? playFromList;

  if (!tracks.length) {
    return <EmptyState icon={Play} title={emptyTitle} body={emptyLabel ?? "Tracks will appear here."} />;
  }

  return (
    <div>
      {showHeader && (
        <div className="flex items-center gap-3 px-3 pb-2.5 mb-1 border-b border-ink-hi/[0.06] text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-ghost">
          <div className="w-7 shrink-0">#</div>
          <div className="w-[52px] shrink-0" />
          <div className="flex-1 min-w-0">Title</div>
          {showAlbum && <div className="w-52 shrink-0 hidden xl:block">Album</div>}
          <div className="w-[88px] shrink-0" />
          <div className="w-11 shrink-0 text-right">Time</div>
        </div>
      )}
      <div>
        {tracks.map((track, i) => {
          const isCurrent = sameSong(track.id, currentId);
          return (
            <Fragment key={`${track.id}-${i}`}>
              <TrackRow
                track={track}
                index={i}
                isCurrent={isCurrent}
                // Only the current row cares whether playback runs — the others keep equal props.
                isPlaying={isCurrent && playing}
                available={available(track)}
                onPlay={play}
                menuFor={menuFor}
                showAlbum={showAlbum}
              />
              {/* Hairline divider, inset to the title column — mobile's
                  ROW_DIVIDER_INSET clears the 52dp artwork the same way. */}
              {i < tracks.length - 1 && <div className="h-px bg-ink-hi/[0.05] ml-[120px] mr-3" />}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
