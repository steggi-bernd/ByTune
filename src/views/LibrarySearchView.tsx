/**
 * Search — the top bar's query run against the user's own library: local
 * files, Jellyfin and Navidrome, matched on title, artist and album. Matching
 * artists and albums come first as shelves (they open their pages), then the
 * songs, then the songs whose lyrics hold the query ("In lyrics", from the
 * lyrics already on this computer — electron/lyrics-index.ts). A source
 * filter appears once more than one source has songs.
 */
import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AlbumTile, ArtistTile } from "../components/LibraryCards";
import { TrackList } from "../components/TrackList";
import { Artwork, EmptyState, Pills, ShelfScroller } from "../components/primitives";
import { useLibraryIndex } from "../lib/catalogIndex";
import { fmtTime } from "../lib/format";
import { matchesQuery } from "../lib/libraryTracks";
import { songKey } from "../stores/catalog";
import { usePlayer } from "../stores/player";
import { useUI } from "../stores/ui";
import type { Track } from "../types";
import type { LyricMatch } from "../../electron/lyrics-index";

type Scope = "all" | "local" | "jellyfin" | "subsonic";

const MAX_RESULTS = 300;
const fold = (s: string): string => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");

export function LibrarySearchView() {
  const query = useUI((s) => s.searchQuery);
  const { tracks, albums, artists, loaded } = useLibraryIndex();
  const [scope, setScope] = useState<Scope>("all");
  const q = query.trim();

  const sources = useMemo(() => new Set(tracks.map((t) => t.source ?? "local")), [tracks]);
  const pool = useMemo(() => (scope === "all" ? tracks : tracks.filter((t) => (t.source ?? "local") === scope)), [scope, tracks]);
  const songs = useMemo(() => (q ? pool.filter((t) => matchesQuery(t, q)) : []), [pool, q]);
  const matchingArtists = useMemo(
    () => (q ? artists.filter((a) => fold(a.name).includes(fold(q))).slice(0, 12) : []),
    [artists, q]
  );
  const matchingAlbums = useMemo(
    () => (q ? albums.filter((a) => fold(`${a.title} ${a.artist}`).includes(fold(q))).slice(0, 18) : []),
    [albums, q]
  );

  // Lyrics are searched in the main process, a moment after typing stops.
  const [lyricHits, setLyricHits] = useState<LyricMatch[]>([]);
  useEffect(() => {
    const search = window.bytune?.searchLyrics;
    if (q.length < 3 || !search) {
      setLyricHits([]);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      void search(q)
        .then((hits) => {
          if (live) setLyricHits(hits);
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [q]);
  const lyricSongs = useMemo(() => {
    const byId = new Map(pool.map((t) => [t.id, t]));
    const out: { track: Track; hit: LyricMatch }[] = [];
    for (const hit of lyricHits) {
      const track = byId.get(songKey(hit.id)) ?? byId.get(hit.id);
      if (track && !out.some((o) => o.track.id === track.id)) out.push({ track, hit });
    }
    return out;
  }, [lyricHits, pool]);
  const playQueue = usePlayer((s) => s.playQueue);

  if (!loaded) return null;

  const scopeOptions: { key: Scope; label: string }[] = [
    { key: "all", label: "Everything" },
    ...(sources.has("local") ? [{ key: "local" as const, label: "On this device" }] : []),
    ...(sources.has("jellyfin") ? [{ key: "jellyfin" as const, label: "Jellyfin" }] : []),
    ...(sources.has("subsonic") ? [{ key: "subsonic" as const, label: "Navidrome" }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap animate-slide-up">
        <div className="min-w-0">
          <h1 className="font-display text-[30px] font-bold tracking-[-0.03em] text-ink-hi truncate">
            {q ? `“${q}”` : "Search"}
          </h1>
          <p className="text-[13px] text-ink-faint mt-1">
            {resultsLine(songs.length, lyricSongs.length)}
          </p>
        </div>
        {scopeOptions.length > 2 && <Pills<Scope> options={scopeOptions} value={scope} onChange={setScope} />}
      </div>

      {matchingArtists.length > 0 && (
        <section>
          <h2 className="section-title text-[21px] mb-4">Artists</h2>
          <ShelfScroller>
            {matchingArtists.map((a) => (
              <ArtistTile key={a.name} name={a.name} route={a.route} fallbackThumb={a.thumb} subtitle={`${a.trackCount} song${a.trackCount === 1 ? "" : "s"}`} />
            ))}
          </ShelfScroller>
        </section>
      )}

      {matchingAlbums.length > 0 && (
        <section>
          <h2 className="section-title text-[21px] mb-4">Albums</h2>
          <ShelfScroller>
            {matchingAlbums.map((a) => (
              <AlbumTile key={a.key} album={a} />
            ))}
          </ShelfScroller>
        </section>
      )}

      {songs.length > 0 && (
        <section>
          <h2 className="section-title text-[21px] mb-3">Songs</h2>
          <TrackList tracks={songs.slice(0, MAX_RESULTS)} showAlbum emptyLabel="No songs." />
        </section>
      )}

      {lyricSongs.length > 0 && (
        <section>
          <h2 className="section-title text-[21px] mb-3">In lyrics</h2>
          <div className="space-y-0.5">
            {lyricSongs.map(({ track, hit }, i) => (
              <LyricHitRow
                key={track.id}
                track={track}
                hit={hit}
                query={q}
                onPlay={() => playQueue(lyricSongs.map((o) => o.track), i)}
              />
            ))}
          </div>
        </section>
      )}

      {songs.length === 0 && lyricSongs.length === 0 && (
        <EmptyState
          icon={Search}
          title={q ? "Nothing in your library matches" : "Search your library"}
          body={
            q
              ? "Search looks through titles, artists and albums of your local files and your servers, and through the lyrics already on this computer."
              : "Type a song, artist or album in the search field above."
          }
        />
      )}
    </div>
  );
}

/** "12 songs in your library · 3 by their lyrics" — only what was found. */
function resultsLine(songs: number, byLyrics: number): string {
  const plural = (n: number): string => `${n} song${n === 1 ? "" : "s"}`;
  const found = songs > MAX_RESULTS ? `${MAX_RESULTS} of ${plural(songs)}` : plural(songs);
  if (!byLyrics) return `${found} in your library`;
  if (!songs) return `${plural(byLyrics)} by their lyrics`;
  return `${found} in your library · ${byLyrics} by their lyrics`;
}

/** The query marked in a line, wherever it reads the same ignoring case. */
function marked(line: string, query: string): React.ReactNode {
  const at = line.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return line;
  return (
    <>
      {line.slice(0, at)}
      <mark className="bg-transparent text-ink-hi font-semibold">{line.slice(at, at + query.length)}</mark>
      {line.slice(at + query.length)}
    </>
  );
}

/** A song found by its lyrics: the line with the query in it, and where in the song it is sung. */
function LyricHitRow({ track, hit, query, onPlay }: { track: Track; hit: LyricMatch; query: string; onPlay: () => void }) {
  return (
    <button
      onClick={onPlay}
      title={`Play ${track.title}`}
      className="w-full flex items-center gap-3.5 h-[64px] px-3 rounded-lg text-left hover:bg-ink-hi/[0.05] transition-colors"
    >
      <Artwork src={track.thumb} className="w-[48px] h-[48px] rounded-lg shrink-0" iconClassName="w-4 h-4" alt="" />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold text-ink-hi truncate">
          {track.title}
          <span className="font-normal text-ink-dim"> · {track.artist}</span>
        </div>
        <div className="text-[13.5px] text-ink-dim truncate mt-0.5">“{marked(hit.line, query)}”</div>
      </div>
      {typeof hit.time === "number" && <span className="text-xs text-ink-faint tabular-nums shrink-0">{fmtTime(hit.time)}</span>}
    </button>
  );
}
