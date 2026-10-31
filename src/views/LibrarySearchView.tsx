/**
 * Search — the top bar's query run against the user's own library: local
 * files, Jellyfin and Navidrome, matched on title, artist and album. Matching
 * artists and albums come first as shelves (they open their pages), then the
 * songs. A source filter appears once more than one source has songs.
 */
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { AlbumTile, ArtistTile } from "../components/LibraryCards";
import { TrackList } from "../components/TrackList";
import { EmptyState, Pills, ShelfScroller } from "../components/primitives";
import { useLibraryIndex } from "../lib/catalogIndex";
import { matchesQuery } from "../lib/libraryTracks";
import { useUI } from "../stores/ui";

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
            {songs.length > MAX_RESULTS ? `${MAX_RESULTS} of ${songs.length} songs` : `${songs.length} song${songs.length === 1 ? "" : "s"}`} in your library
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

      {songs.length > 0 ? (
        <section>
          <h2 className="section-title text-[21px] mb-3">Songs</h2>
          <TrackList tracks={songs.slice(0, MAX_RESULTS)} showAlbum emptyLabel="No songs." />
        </section>
      ) : (
        <EmptyState
          icon={Search}
          title={q ? "Nothing in your library matches" : "Search your library"}
          body={
            q
              ? "Search looks through titles, artists and albums of your local files and your servers."
              : "Type a song, artist or album in the search field above."
          }
        />
      )}
    </div>
  );
}
