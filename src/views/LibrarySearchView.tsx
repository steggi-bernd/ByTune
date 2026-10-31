/**
 * Search — the top bar's query run against the user's own library: local
 * files and the connected Jellyfin server, matched on title, artist and
 * album. Artists that match get a row of chips that narrow the search to
 * that artist.
 */
import { useEffect, useMemo, useState } from "react";
import { Search, User } from "lucide-react";
import { TrackList } from "../components/TrackList";
import { EmptyState, Pills } from "../components/primitives";
import { loadJellyfinTracks, loadLocalTracks, matchesQuery } from "../lib/libraryTracks";
import { useUI } from "../stores/ui";
import type { Track } from "../types";

type Scope = "all" | "local" | "jellyfin";

const MAX_RESULTS = 300;

export function LibrarySearchView() {
  const query = useUI((s) => s.searchQuery);
  const setQuery = useUI((s) => s.setSearchQuery);
  const [local, setLocal] = useState<Track[] | null>(null);
  const [jellyfin, setJellyfin] = useState<Track[]>([]);
  const [scope, setScope] = useState<Scope>("all");

  useEffect(() => {
    void loadLocalTracks().then(setLocal);
    void loadJellyfinTracks().then(setJellyfin);
  }, []);

  const pool = useMemo(() => {
    if (scope === "local") return local ?? [];
    if (scope === "jellyfin") return jellyfin;
    return [...(local ?? []), ...jellyfin];
  }, [scope, local, jellyfin]);

  const results = useMemo(() => {
    const q = query.trim();
    return q ? pool.filter((t) => matchesQuery(t, q)) : [];
  }, [pool, query]);

  const artists = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const names = new Map<string, number>();
    for (const t of results) {
      if (t.artist.toLowerCase().includes(q) && t.artist.toLowerCase() !== q) {
        names.set(t.artist, (names.get(t.artist) ?? 0) + 1);
      }
    }
    return [...names.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [results, query]);

  if (local === null) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap animate-slide-up">
        <div className="min-w-0">
          <h1 className="font-display text-[30px] font-bold tracking-[-0.03em] text-ink-hi truncate">
            {query.trim() ? `“${query.trim()}”` : "Search"}
          </h1>
          <p className="text-[13px] text-ink-faint mt-1">
            {results.length > MAX_RESULTS
              ? `${MAX_RESULTS} of ${results.length} songs`
              : `${results.length} song${results.length === 1 ? "" : "s"}`}{" "}
            in your library
          </p>
        </div>
        {jellyfin.length > 0 && (
          <Pills<Scope>
            options={[
              { key: "all", label: "Everything" },
              { key: "local", label: "On this device" },
              { key: "jellyfin", label: "Jellyfin" },
            ]}
            value={scope}
            onChange={setScope}
          />
        )}
      </div>

      {artists.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {artists.map(([name, count]) => (
            <button
              key={name}
              onClick={() => setQuery(name)}
              className="inline-flex items-center gap-2 h-8 pl-2.5 pr-3.5 rounded-full bg-ink-hi/[0.06] hover:bg-ink-hi/[0.12] text-[13px] text-ink-hi transition-colors"
            >
              <User className="w-3.5 h-3.5 text-ink-dim" />
              {name}
              <span className="text-ink-faint">{count}</span>
            </button>
          ))}
        </div>
      )}

      {results.length > 0 ? (
        <TrackList tracks={results.slice(0, MAX_RESULTS)} showAlbum emptyLabel="No songs." />
      ) : (
        <EmptyState
          icon={Search}
          title={query.trim() ? "Nothing in your library matches" : "Search your library"}
          body={
            query.trim()
              ? "Search looks through titles, artists and albums of your local files and your Jellyfin server."
              : "Type a song, artist or album in the search field above."
          }
        />
      )}
    </div>
  );
}
