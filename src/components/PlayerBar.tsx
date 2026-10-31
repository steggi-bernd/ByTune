/**
 * PlayerBar — point-for-point clone of the Spotify web player's
 * now-playing bar. All values below were extracted from Spotify's live
 * computed styles (DevTools), and every icon is Spotify's own SVG
 * geometry extracted verbatim from the page (SpotifyIcons.tsx):
 *
 *  - black 88px bar (measured off the desktop app), 56px content row
 *    centred → 16px inset top/bottom; 16px to the cover on the left, 8px
 *    footer padding + 8px button padding = 16px to the last glyph on the right
 *  - left: 56px cover (4px radius, #282828 placeholder; opens Now
 *    Playing), 10px gap, title 14/19 white (opens the album) + artists
 *    12/17 #b3b3b3 (each opens its artist page), hover underline, then the
 *    playback format line; like button 16×32 with a 16px icon (#b3b3b3 →
 *    white), 16px after the text
 *  - centre: [shuffle, prev] —16px— play disc —16px— [next, repeat], the
 *    groups flex-1 so the disc sits dead centre; buttons 32×32 (8px pad,
 *    full radius), icons 16×16 #b3b3b3 → white on hover; disc 32px white
 *    with the black 16px glyph; active modes keep their colour with a
 *    white dot beneath (Spotify's treatment)
 *  - seek row (8px below transport): fixed 50px time boxes (12/17
 *    #b3b3b3) flanking a flexible bar — 12px hit area, 4px track (2px
 *    radius, white @30%), white fill, 12px white handle on hover
 *  - right: lyrics / queue / cast / volume (speaker 32px + 67px track)
 *    / miniplayer / fullscreen — 16px icons white @70% → white on hover
 *  - while a network player has the music: a 24px "Playing on …" strip
 *    beneath the bar (Spotify's Connect treatment, in the primary colour)
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Cast, Check, Heart, Laptop, ListMusic, ListPlus, Loader2, RefreshCw, Speaker } from "lucide-react";
import {
  SpCheck,
  SpCoverNote,
  SpExitFullscreen,
  SpFullscreen,
  SpLyrics,
  SpMiniplayer,
  SpNext,
  SpPause,
  SpPlay,
  SpPlus,
  SpPrev,
  SpQueue,
  SpRepeat,
  SpRepeatOne,
  SpShuffle,
  SpVolumeHigh,
  SpVolumeOff,
} from "./SpotifyIcons";
import { SeekBar, VolumeControl } from "./Controls";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { useUI, type MenuItem } from "../stores/ui";
import { sourceOf } from "../stores/availability";
import { useCatalog } from "../stores/catalog";
import { upgradeArtwork } from "../lib/artwork";
import { useDrag } from "../lib/dnd";
import { isLibraryTrack } from "../lib/libraryTracks";
import { ArtistLinks } from "./ArtistLinks";
import { describePlayback, formatLine } from "../lib/playbackFormat";
import { castTo, searchCastDevices, stopCasting, useCast, useVolumeTarget, type CastDevice } from "../lib/cast";
import type { Track } from "../types";

const SOURCE_NAME = { local: "a file on this device", jellyfin: "Jellyfin", subsonic: "Navidrome" } as const;

/**
 * What is playing, after any conversion on the way: a Hi-Res / Lossless /
 * Lossy tag and the format line ("FLAC 24-bit / 96 kHz", "MP3 320 kbps").
 * A song found in several places shows the copy it actually plays from.
 */
function PlaybackFormatLine({ track }: { track: Track }) {
  const playingFrom = usePlayer((s) => s.sources[track.id]) ?? track;
  // The catalogue's copy carries the media info a queue entry saved by an older version may lack.
  const listed = useCatalog((s) => s.byId.get(playingFrom.id));
  const version = listed ?? playingFrom;
  const format = describePlayback(version);
  if (!format) return null;
  const tier = format.hiRes ? "Hi-Res" : format.lossless ? "Lossless" : "Lossy";
  const line = formatLine(format);
  const from = SOURCE_NAME[sourceOf(version) ?? "local"];
  const details = [
    `${format.hiRes ? "Hi-Res lossless" : format.lossless ? "Lossless" : "Lossy"} · ${line}`,
    `Playing from ${from}`,
    format.note ? `${format.note.charAt(0).toUpperCase()}${format.note.slice(1)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span className="mt-[3px] flex min-w-0 items-center gap-1.5 text-[11px] leading-[14px] text-[#b3b3b3]" title={details}>
      <span
        className={`shrink-0 rounded-[3px] px-1 text-[9px] font-bold uppercase leading-[14px] tracking-[0.06em] ${
          format.hiRes
            ? "bg-[#e6c35c]/[0.16] text-[#e6c35c]"
            : format.lossless
              ? "bg-white/[0.12] text-white"
              : "bg-white/[0.06] text-[#8f8f8f]"
        }`}
      >
        {tier}
      </span>
      <span className="truncate tabular-nums">{line}</span>
    </span>
  );
}

/** A span that acts as a link — inline, so a long credit line still truncates with an ellipsis. */
function linkProps(go: () => void) {
  return {
    role: "link",
    tabIndex: 0,
    onClick: go,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter") go();
    },
  };
}

/**
 * Title and artists, Spotify's way: the title opens the album, each credited
 * artist their own page (the cover opens the Now Playing view).
 */
function TrackMeta({ track }: { track: Track | null }) {
  const navigate = useUI((s) => s.navigate);
  if (!track) {
    return (
      <div className="ml-2.5 min-w-0">
        <span className="block truncate text-[14px] leading-[19px] text-white">Nothing playing</span>
        <span className="block truncate text-[12px] leading-[17px] text-[#b3b3b3]">Search for something to play</span>
      </div>
    );
  }
  const library = isLibraryTrack(track);
  const album = track.albumId?.startsWith("lib:album:") ? track.albumId : null;
  return (
    <div className="ml-2.5 min-w-0" key={`meta-${track.id}`}>
      <span className="block truncate text-[14px] leading-[19px] text-white">
        {album ? (
          <span
            {...linkProps(() => navigate({ name: "album", param: album }))}
            title={track.album ? `Go to ${track.album}` : undefined}
            className="cursor-pointer hover:underline"
          >
            {track.title}
          </span>
        ) : (
          track.title
        )}
      </span>
      <span className="block truncate text-[12px] leading-[17px] text-[#b3b3b3]">
        {library ? <ArtistLinks artist={track.artist} className="hover:text-white" /> : track.artist}
      </span>
      <PlaybackFormatLine track={track} />
    </div>
  );
}

/* Transport button — 32×32, 16px glyph, colour-only hover (Spotify). */
function TransportButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`relative grid h-8 w-8 place-items-center rounded-full transition-colors ${
        active ? "text-white" : "text-[#b3b3b3] hover:text-white"
      }`}
    >
      {children}
      {active && (
        <span className="absolute bottom-[2px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white" />
      )}
    </button>
  );
}

/* Right-cluster button — 32×32, 16px icon white @70% → white. */
function BarButton({
  onClick,
  active,
  title,
  className: extra = "",
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`relative grid h-8 w-8 place-items-center rounded-full transition-colors ${extra} ${
        active ? "text-white" : "text-white/70 hover:text-white"
      }`}
    >
      {children}
      {/* Spotify's selected treatment for the right-cluster toggles: full
          white icon plus a small dot beneath — no highlight circle. */}
      {active && (
        <span className="absolute bottom-[2px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white" />
      )}
    </button>
  );
}

/** Each player's name; two of the same name carry their model too. */
function castLabel(device: CastDevice, all: CastDevice[]): string {
  const twin = all.some((d) => d !== device && d.name === device.name);
  return twin && device.model ? `${device.name} (${device.model})` : device.name;
}

/**
 * Play on a network player (DLNA / UPnP — lib/cast.ts): the menu lists this
 * computer and the players the search finds; it searches again on every
 * open and fills in as answers arrive.
 */
function CastButton() {
  const active = useCast((s) => s.active);
  const connecting = useCast((s) => s.connecting);
  const anchor = useRef<DOMRect | null>(null);
  const shown = useRef<MenuItem[] | null>(null);

  const items = (): MenuItem[] => {
    const { devices, searching, active: on, connecting: pending } = useCast.getState();
    const list: MenuItem[] = [
      { label: "Play on", header: true },
      { label: "This computer", icon: on ? Laptop : Check, action: () => void stopCasting() },
      ...devices.map(
        (d): MenuItem => ({
          label: castLabel(d, devices),
          icon: on?.id === d.id ? Check : pending === d.id ? Loader2 : Speaker,
          iconClassName: pending === d.id ? "animate-spin" : undefined,
          action: () => void castTo(d),
        })
      ),
    ];
    if (searching) {
      list.push({ label: "Looking for players…", icon: Loader2, iconClassName: "animate-spin opacity-80", disabled: true });
    } else {
      if (!devices.length) list.push({ label: "No players found on this network", disabled: true });
      list.push({
        label: "Search again",
        icon: RefreshCw,
        separatorBefore: true,
        // After the menu has closed from this click: open it again, searching.
        action: () => window.setTimeout(open, 0),
      });
    }
    return list;
  };

  const show = (): void => {
    const rect = anchor.current;
    if (!rect) return;
    shown.current = items();
    useUI.getState().openContextMenu(rect.right, rect.top, shown.current, { above: true, alignRight: true });
  };

  function open(): void {
    if (!useCast.getState().searching) {
      void searchCastDevices().then(() => {
        // Still open (not closed or replaced by another menu): show what the search found.
        if (shown.current && useUI.getState().contextMenu?.items === shown.current) show();
      });
    }
    show();
  }

  return (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        // Its own menu toggles closed; any other open menu gives way to it.
        const menu = useUI.getState().contextMenu;
        if (menu && menu.items === shown.current) {
          useUI.getState().closeContextMenu();
          return;
        }
        anchor.current = e.currentTarget.getBoundingClientRect();
        open();
      }}
      title={active ? `Playing on ${active.name}` : "Play on a network player"}
      aria-label={active ? `Playing on ${active.name}` : "Play on a network player"}
      aria-haspopup="menu"
      aria-pressed={!!active}
      className={`relative grid h-8 w-8 place-items-center rounded-full transition-colors ${
        active ? "text-white" : "text-white/70 hover:text-white"
      }`}
    >
      {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cast className="h-4 w-4" />}
      {active && <span className="absolute bottom-[2px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white" />}
    </button>
  );
}

export function PlayerBar() {
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const playing = usePlayer((s) => s.playing);
  const buffering = usePlayer((s) => s.buffering);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const toggleShuffle = usePlayer((s) => s.toggleShuffle);
  const cycleRepeat = usePlayer((s) => s.cycleRepeat);
  // While a network player has the music, its volume (lib/cast.ts).
  const { value: volume, muted } = useVolumeTarget();
  const castingTo = useCast((s) => s.active);

  const liked = useLibrary((s) => (track ? s.liked.some((t) => t.id === track.id) : false));
  const hideVolumeBar = useSettings((s) => s.hideVolumeBar);
  const coverDrag = useDrag({ track: track ?? { id: "", title: "", artist: "", duration: 0, thumb: "" } });

  /** The "+" beside the track — two top-level options: liked, and the
      playlists flyout (hover → every playlist + "New playlist"), so a big
      playlist library never floods the first click. */
  const addToPlaylistRef = useRef<HTMLButtonElement | null>(null);
  const openAddToPlaylist = (): void => {
    if (!track) return;
    // Real toggle: when the picker is already open, this click closes it.
    // (The pointerdown handler on the button below keeps the open menu alive
    // until the click arrives — otherwise the menu's outside-press dismissal
    // fired first and every press on "+" re-opened it, never closing it.)
    if (useUI.getState().contextMenu) {
      useUI.getState().closeContextMenu();
      return;
    }
    const lib = useLibrary.getState();
    const items: MenuItem[] = [
      {
        label: liked ? "Remove from Liked Songs" : "Add to Liked Songs",
        icon: Heart,
        action: () => lib.toggleLike(track),
      },
      {
        label: "Add to playlist",
        icon: ListMusic,
        children: [
          ...lib.playlists.map((p) => {
            const inList = p.tracks.some((t) => t.id === track.id);
            return {
              icon: inList ? Check : undefined,
              label: inList ? `Remove from "${p.name}"` : `Add to "${p.name}"`,
              action: () => {
                if (inList) {
                  useLibrary.getState().removeFromPlaylist(p.id, track.id);
                  useUI.getState().toast(`Removed from "${p.name}"`);
                } else {
                  const added = useLibrary.getState().addToPlaylist(p.id, track);
                  useUI.getState().toast(added ? `Added to "${p.name}"` : "Already in this playlist");
                }
              },
            };
          }),
          {
            separatorBefore: lib.playlists.length > 0,
            label: "New playlist",
            icon: ListPlus,
            action: () => {
              // Name it before it exists — cancel adds nothing. Blank
              // confirm keeps the numbered default.
              const suggested = `Playlist ${useLibrary.getState().playlists.length + 1}`;
              useUI.getState().openDialog({
                title: "New playlist",
                body: `Add "${track.title}" to a new playlist.`,
                initialValue: suggested,
                placeholder: "Playlist name",
                confirmLabel: "Create",
                onConfirm: (value) => {
                  const fresh = useLibrary.getState();
                  const playlist = fresh.createPlaylist(value.trim() || suggested);
                  fresh.addToPlaylist(playlist.id, track);
                  useUI.getState().navigate({ name: "playlist", param: playlist.id });
                },
              });
            },
          },
        ],
      },
    ];
    const rect = addToPlaylistRef.current?.getBoundingClientRect();
    // The playbar hugs the window bottom — the menu hangs ABOVE the button.
    useUI
      .getState()
      .openContextMenu(rect?.left ?? window.innerWidth / 2, rect?.top ?? window.innerHeight / 2, items, {
        above: true,
      });
  };

  const lyricsCenter = useUI((s) => s.lyricsCenter);
  const rightPanel = useUI((s) => s.rightPanel);
  const nowPlayingOpen = useUI((s) => s.nowPlayingOpen);
  const toggleLyrics = useUI((s) => s.toggleLyrics);
  const toggleQueue = useUI((s) => s.toggleQueue);
  const toggleNowPlaying = useUI((s) => s.toggleNowPlaying);

  // The miniplayer is a separate native always-on-top window (see
  // electron/pip.ts); this button just toggles it and mirrors its state.
  const [pipOpen, setPipOpen] = useState(false);
  useEffect(() => {
    const bridge = window.bytune;
    if (!bridge?.pipToggle) return;
    void bridge.pipIsOpen?.().then((open) => setPipOpen(!!open));
    const off = bridge.onPipOpenChange?.((open) => setPipOpen(open));
    return off;
  }, []);
  const toggleMiniPlayer = (): void => void window.bytune?.pipToggle();

  const VolIcon = muted || volume === 0 ? SpVolumeOff : SpVolumeHigh;

  return (
    <footer className="shrink-0 z-30 bg-black px-2">
      <div
        className="h-[88px] grid grid-cols-[3fr_4fr_3fr] items-center"
        role="contentinfo"
        aria-label="Now playing bar"
      >
        {/* Track info — click opens the Now Playing view. */}
        <div className="flex items-center min-w-0 pl-2">
          <button
            onClick={toggleNowPlaying}
            {...(track ? coverDrag.props : {})}
            title="Now playing view — drag to a playlist to add this song"
            aria-label="Now playing view"
            className={`h-14 w-14 shrink-0 overflow-hidden rounded-[4px] bg-[#282828] focus:outline-none ${
              track && coverDrag.dragging ? "opacity-50" : ""
            }`}
          >
            {track?.thumb ? (
              <img
                key={track.id}
                src={upgradeArtwork(track.thumb)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="grid h-full w-full place-items-center">
                <SpCoverNote />
              </div>
            )}
          </button>
          <TrackMeta track={track} />
          {track && (
            <button
              ref={addToPlaylistRef}
              onPointerDown={(e) => {
                // Keep the context menu's outside-press dismissal from
                // closing an open picker on this press — the click handler
                // then sees the open menu and toggles it closed instead.
                e.stopPropagation();
              }}
              onClick={(e) => {
                // The opening click must not bubble to the ContextMenu's
                // click-outside listener, or it closes itself immediately.
                e.stopPropagation();
                openAddToPlaylist();
              }}
              title="Add to playlist"
              aria-label="Add to playlist"
              aria-haspopup="menu"
              className="ml-4 flex h-8 w-4 shrink-0 items-center justify-center text-[#b3b3b3] transition-all hover:scale-105 hover:text-white active:scale-95"
            >
              {/* Spotify's model: the glyph reflects Liked state, the click
                  always opens the add-to-playlist picker. */}
              {liked ? <SpCheck /> : <SpPlus />}
            </button>
          )}
        </div>

        {/* Centre — [shuffle prev] play [next repeat], disc dead centre. */}
        <div className="flex h-14 flex-col justify-center gap-2">
          <div className="flex w-full items-center gap-4">
            <div className="flex flex-1 items-center justify-end gap-2">
              <TransportButton onClick={toggleShuffle} active={shuffle} title={shuffle ? "Disable Shuffle" : "Enable Shuffle"}>
                <SpShuffle />
              </TransportButton>
              <TransportButton onClick={() => prev()} title="Previous">
                <SpPrev />
              </TransportButton>
            </div>
            <button
              onClick={toggle}
              title={playing ? "Pause" : "Play"}
              aria-label={playing ? "Pause" : "Play"}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-black transition-transform hover:scale-[1.06] active:scale-95"
            >
              {buffering ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : playing ? (
                <SpPause />
              ) : (
                <SpPlay />
              )}
            </button>
            <div className="flex flex-1 items-center gap-2">
              <TransportButton onClick={() => next(true)} title="Next">
                <SpNext />
              </TransportButton>
              <TransportButton
                onClick={cycleRepeat}
                active={repeat !== "off"}
                title={repeat === "off" ? "Enable repeat" : repeat === "all" ? "Disable repeat" : "Enable repeat one"}
              >
                {repeat === "one" ? <SpRepeatOne /> : <SpRepeat />}
              </TransportButton>
            </div>
          </div>
          <SeekBar thin />
        </div>

        {/* Right — lyrics, queue, volume, miniplayer, fullscreen. */}
        <div className="flex items-center justify-end">
          <BarButton onClick={toggleLyrics} title="Lyrics" active={lyricsCenter}>
            <SpLyrics />
          </BarButton>
          <BarButton onClick={toggleQueue} title="Queue" active={rightPanel === "queue"}>
            <SpQueue />
          </BarButton>
          <CastButton />
          {!hideVolumeBar && <VolumeControl VolIcon={VolIcon} />}
          <BarButton
            onClick={toggleMiniPlayer}
            active={pipOpen}
            title={pipOpen ? "Close Miniplayer" : "Open Miniplayer"}
            className="ml-2"
          >
            <SpMiniplayer />
          </BarButton>
          <BarButton
            onClick={toggleNowPlaying}
            title={nowPlayingOpen ? "Exit Full screen" : "Enter Full screen"}
          >
            {nowPlayingOpen ? <SpExitFullscreen /> : <SpFullscreen />}
          </BarButton>
        </div>
      </div>
      {castingTo && (
        <div className="-mx-2 flex h-6 items-center justify-end gap-1.5 bg-primary px-4 text-[12px] font-semibold text-on-primary">
          <Cast className="h-3.5 w-3.5" />
          Playing on {castingTo.name}
        </div>
      )}
    </footer>
  );
}
