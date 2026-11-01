/**
 * Explore — the whole library as three big lists: albums, artists and
 * genres. Each sorts by any of its columns (a second click on the column
 * turns the order round), filters as you type and shows as a table or as
 * tiles; tab, layout and every tab's order are remembered. Opened from the
 * record in the search field, where ByTune always had its browse button.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, DiscAlbum, LayoutGrid, List, Play, Search, User, X } from "lucide-react";
import { AlbumTile, ArtistTile, CoverCollage, GenreTile, playCollection, useArtistPhoto, useSeen } from "../components/LibraryCards";
import { Artwork, EmptyState, Pills } from "../components/primitives";
import { artistTracks, useLibraryGenres, useLibraryIndex, type LibAlbum, type LibArtist, type LibGenre } from "../lib/catalogIndex";
import { fmtTime, plural } from "../lib/format";
import { splitCredits } from "../lib/libraryTracks";
import { compareReleases, RELEASE_LABEL, type ReleaseKind } from "../lib/releases";
import { useCatalog, useFreshPlayCounts, type PlayCounts } from "../stores/catalog";
import { useSettings, type ExploreSort, type ExploreTab } from "../stores/settings";
import { useUI, type MenuItem } from "../stores/ui";
import type { Track } from "../types";

interface Column<T> {
  key: string;
  label: string;
  /** width — the same classes on the header and on every cell */
  className: string;
  /** shown once the table is at least this wide (px); the page sits between the library and the side panel, so the window's width says little */
  from?: number;
  /** counts and dates start from the most / the newest; text from A */
  numeric?: boolean;
  right?: boolean;
  /** ascending */
  compare: (a: T, b: T) => number;
  /** rows without a value stay at the end, whichever way the column runs */
  missing?: (row: T) => boolean;
  cell: (row: T) => ReactNode;
}

interface AlbumRow {
  album: LibAlbum;
  plays: number;
}
interface ArtistRow {
  artist: LibArtist;
  plays: number;
  addedAt: number;
}
interface GenreRow {
  genre: LibGenre;
  plays: number;
}

const text = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
const playsOf = (list: Track[], counts: PlayCounts): number => list.reduce((n, t) => n + (counts[t.id]?.plays ?? 0), 0);
const KIND_ORDER: ReleaseKind[] = ["album", "ep", "single", "compilation"];

/** A local calendar day — new Date("2019-05-03") would be UTC midnight, the day before west of Greenwich. */
function dayLabel(date: string | undefined, year: number | undefined): string {
  const [y, m, d] = (date ?? "").split("-").map(Number);
  if (y && m && d) return new Date(y, m - 1, d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  if (y && m) return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return year ? String(year) : "—";
}
const addedLabel = (ms: number): string =>
  ms > 0 ? new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

function sortRows<T>(rows: T[], columns: Column<T>[], sort: ExploreSort): T[] {
  const col = columns.find((c) => c.key === sort.by) ?? columns[0];
  const first = columns[0];
  return [...rows].sort((a, b) => {
    const ma = col.missing?.(a) ?? false;
    const mb = col.missing?.(b) ?? false;
    if (ma !== mb) return ma ? 1 : -1;
    const c = col.compare(a, b);
    return (sort.desc ? -c : c) || first.compare(a, b);
  });
}

/* ------------------------------------------------------------ the table */

function Table<T>({
  label,
  rows,
  columns,
  sort,
  onSort,
  rowKey,
  lead,
  open,
  play,
}: {
  label: string;
  rows: T[];
  columns: Column<T>[];
  sort: ExploreSort;
  onSort: (col: Column<T>) => void;
  rowKey: (row: T) => string;
  /** the picture at the row's start */
  lead: (row: T) => ReactNode;
  open: (row: T) => void;
  play: (row: T) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(1200);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const shown = columns.filter((c) => !c.from || width >= c.from);
  return (
    <div ref={ref} role="table" aria-label={label}>
      <div role="row" className="flex items-center gap-4 px-3 pb-2.5 mb-1 border-b border-ink-hi/[0.06] text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-ghost">
        <div className="w-10 shrink-0" />
        {shown.map((c) => {
          const active = sort.by === c.key;
          return (
            <button
              key={c.key}
              role="columnheader"
              aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
              onClick={() => onSort(c)}
              title={`Sort by ${c.label.toLowerCase()}`}
              className={`${c.className} flex items-center gap-1 uppercase transition-colors hover:text-ink-hi ${c.right ? "justify-end" : ""} ${
                active ? "text-ink-hi" : ""
              }`}
            >
              <span className="truncate">{c.label}</span>
              {active && (sort.desc ? <ArrowDown className="w-3 h-3 shrink-0" /> : <ArrowUp className="w-3 h-3 shrink-0" />)}
            </button>
          );
        })}
      </div>
      {rows.map((r) => (
        <div
          key={rowKey(r)}
          role="row"
          onClick={() => open(r)}
          // Thousands of rows: only those on screen are laid out and painted.
          style={{ contentVisibility: "auto", containIntrinsicSize: "auto 56px" }}
          className="group flex items-center gap-4 h-14 px-3 rounded-lg cursor-pointer select-none hover:bg-ink-hi/[0.05] transition-colors"
        >
          <div className="relative w-10 h-10 shrink-0">
            {lead(r)}
            <button
              onClick={(e) => {
                e.stopPropagation();
                play(r);
              }}
              title="Play"
              aria-label="Play"
              className="absolute inset-0 hidden group-hover:grid place-items-center rounded-md bg-black/45 text-white"
            >
              <Play className="w-4 h-4 fill-current" />
            </button>
          </div>
          {shown.map((c, i) => (
            <div
              key={c.key}
              role="cell"
              className={`${c.className} truncate ${i === 0 ? "text-[15px] font-semibold text-ink-hi" : "text-[13.5px] text-ink-dim"} ${
                c.right ? "text-right tabular-nums" : ""
              }`}
            >
              {c.cell(r)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** An artist's round photo, asked for only once its row is on screen. */
function ArtistPhoto({ artist }: { artist: LibArtist }) {
  const [ref, seen] = useSeen<HTMLDivElement>();
  const photo = useArtistPhoto(seen ? artist.name : "", artist.thumb);
  return (
    <div ref={ref} className="w-10 h-10">
      {photo ? (
        <Artwork src={photo} rounded="rounded-full" className="w-10 h-10" iconClassName="w-4 h-4" />
      ) : (
        <span className="w-10 h-10 rounded-full bg-ink-hi/[0.06] grid place-items-center">
          <User className="w-4 h-4 text-ink-hi/55" />
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ the columns */

const albumColumns: Column<AlbumRow>[] = [
  { key: "title", label: "Title", className: "flex-[3] min-w-0", compare: (a, b) => text(a.album.title, b.album.title), cell: (r) => r.album.title },
  { key: "artist", label: "Artist", className: "flex-[2] min-w-0", compare: (a, b) => text(a.album.artist, b.album.artist), cell: (r) => r.album.artist },
  {
    key: "released",
    label: "Released",
    className: "w-28 shrink-0",
    from: 630,
    numeric: true,
    // Ascending is oldest first; the same order as the discography, turned round.
    compare: (a, b) => compareReleases(b.album, a.album),
    missing: (r) => !r.album.year,
    cell: (r) => <span title={r.album.date ?? undefined}>{dayLabel(r.album.date, r.album.year)}</span>,
  },
  {
    key: "type",
    label: "Type",
    className: "w-24 shrink-0",
    from: 820,
    compare: (a, b) => KIND_ORDER.indexOf(a.album.kind) - KIND_ORDER.indexOf(b.album.kind),
    cell: (r) => RELEASE_LABEL[r.album.kind],
  },
  { key: "songs", label: "Songs", className: "w-16 shrink-0", from: 710, numeric: true, right: true, compare: (a, b) => a.album.tracks.length - b.album.tracks.length, cell: (r) => r.album.tracks.length },
  { key: "length", label: "Length", className: "w-20 shrink-0", from: 920, numeric: true, right: true, compare: (a, b) => a.album.duration - b.album.duration, cell: (r) => fmtTime(r.album.duration) },
  {
    key: "added",
    label: "Added",
    className: "w-28 shrink-0",
    from: 1050,
    numeric: true,
    compare: (a, b) => a.album.addedAt - b.album.addedAt,
    missing: (r) => !r.album.addedAt,
    cell: (r) => addedLabel(r.album.addedAt),
  },
  { key: "plays", label: "Plays", className: "w-16 shrink-0", from: 500, numeric: true, right: true, compare: (a, b) => a.plays - b.plays, cell: (r) => r.plays || "—" },
];
const artistColumns: Column<ArtistRow>[] = [
  { key: "name", label: "Name", className: "flex-1 min-w-0", compare: (a, b) => text(a.artist.name, b.artist.name), cell: (r) => r.artist.name },
  { key: "albums", label: "Albums", className: "w-20 shrink-0", from: 420, numeric: true, right: true, compare: (a, b) => a.artist.albumCount - b.artist.albumCount, cell: (r) => r.artist.albumCount || "—" },
  { key: "songs", label: "Songs", className: "w-20 shrink-0", from: 520, numeric: true, right: true, compare: (a, b) => a.artist.trackCount - b.artist.trackCount, cell: (r) => r.artist.trackCount },
  { key: "plays", label: "Plays", className: "w-20 shrink-0", from: 620, numeric: true, right: true, compare: (a, b) => a.plays - b.plays, cell: (r) => r.plays || "—" },
  {
    key: "added",
    label: "Added",
    className: "w-28 shrink-0",
    from: 750,
    numeric: true,
    compare: (a, b) => a.addedAt - b.addedAt,
    missing: (r) => !r.addedAt,
    cell: (r) => addedLabel(r.addedAt),
  },
];
const genreColumns: Column<GenreRow>[] = [
  { key: "name", label: "Name", className: "flex-1 min-w-0", compare: (a, b) => text(a.genre.name, b.genre.name), cell: (r) => r.genre.name },
  { key: "artists", label: "Artists", className: "w-20 shrink-0", from: 620, numeric: true, right: true, compare: (a, b) => a.genre.artistCount - b.genre.artistCount, cell: (r) => r.genre.artistCount },
  { key: "albums", label: "Albums", className: "w-20 shrink-0", from: 520, numeric: true, right: true, compare: (a, b) => a.genre.albumCount - b.genre.albumCount, cell: (r) => r.genre.albumCount },
  { key: "songs", label: "Songs", className: "w-20 shrink-0", from: 420, numeric: true, right: true, compare: (a, b) => a.genre.tracks.length - b.genre.tracks.length, cell: (r) => r.genre.tracks.length },
  { key: "plays", label: "Plays", className: "w-20 shrink-0", from: 720, numeric: true, right: true, compare: (a, b) => a.plays - b.plays, cell: (r) => r.plays || "—" },
];

/* ------------------------------------------------------------ the page */

const TABS: { key: ExploreTab; label: string }[] = [
  { key: "albums", label: "Albums" },
  { key: "artists", label: "Artists" },
  { key: "genres", label: "Genres" },
];

export function ExploreView() {
  const { albums, artists, tracks, loaded } = useLibraryIndex();
  const genres = useLibraryGenres();
  const playCounts = useCatalog((s) => s.playCounts);
  useFreshPlayCounts();
  const navigate = useUI((s) => s.navigate);
  const tab = useSettings((s) => s.exploreTab);
  const setTab = useSettings((s) => s.setExploreTab);
  const layout = useSettings((s) => s.exploreLayout);
  const setLayout = useSettings((s) => s.setExploreLayout);
  const sorts = useSettings((s) => s.exploreSort);
  const setSort = useSettings((s) => s.setExploreSort);
  const [query, setQuery] = useState("");
  const sortButton = useRef<HTMLButtonElement | null>(null);

  const albumRows = useMemo<AlbumRow[]>(() => albums.map((album) => ({ album, plays: playsOf(album.tracks, playCounts) })), [albums, playCounts]);
  const artistRows = useMemo<ArtistRow[]>(() => {
    // One pass over the songs: each credited artist's plays and newest song.
    const stats = new Map<string, { plays: number; addedAt: number }>();
    for (const t of tracks) {
      for (const name of splitCredits(t.artist)) {
        const cur = stats.get(name.toLowerCase()) ?? { plays: 0, addedAt: 0 };
        cur.plays += playCounts[t.id]?.plays ?? 0;
        cur.addedAt = Math.max(cur.addedAt, t.addedAt ?? 0);
        stats.set(name.toLowerCase(), cur);
      }
    }
    return artists.map((artist) => ({ artist, plays: stats.get(artist.name.toLowerCase())?.plays ?? 0, addedAt: stats.get(artist.name.toLowerCase())?.addedAt ?? 0 }));
  }, [artists, tracks, playCounts]);
  const genreRows = useMemo<GenreRow[]>(() => genres.map((genre) => ({ genre, plays: playsOf(genre.tracks, playCounts) })), [genres, playCounts]);

  const q = query.trim().toLowerCase();
  const sort = sorts[tab];
  const shownAlbums = useMemo(
    () => sortRows(albumRows.filter((r) => !q || r.album.title.toLowerCase().includes(q) || r.album.artist.toLowerCase().includes(q)), albumColumns, sorts.albums),
    [albumRows, q, sorts.albums]
  );
  const shownArtists = useMemo(
    () => sortRows(artistRows.filter((r) => !q || r.artist.name.toLowerCase().includes(q)), artistColumns, sorts.artists),
    [artistRows, q, sorts.artists]
  );
  const shownGenres = useMemo(
    () => sortRows(genreRows.filter((r) => !q || r.genre.name.toLowerCase().includes(q)), genreColumns, sorts.genres),
    [genreRows, q, sorts.genres]
  );

  const columnsOf: { key: string; label: string; numeric?: boolean }[] = { albums: albumColumns, artists: artistColumns, genres: genreColumns }[tab];
  /** A new column starts from the most (counts, dates) or from A (text); the same column again turns round. */
  const sortBy = (col: { key: string; numeric?: boolean }): void => {
    setSort(tab, sort.by === col.key ? { by: col.key, desc: !sort.desc } : { by: col.key, desc: !!col.numeric });
  };
  const openSortMenu = (): void => {
    const ui = useUI.getState();
    if (ui.contextMenu) {
      ui.closeContextMenu();
      return;
    }
    const rect = sortButton.current?.getBoundingClientRect();
    const items: MenuItem[] = [
      { label: "Sort by", header: true },
      ...columnsOf.map((c) => ({
        label: c.label,
        icon: sort.by === c.key ? (sort.desc ? ArrowDown : ArrowUp) : undefined,
        action: () => sortBy(c),
      })),
    ];
    ui.openContextMenu(rect?.right ?? 0, (rect?.bottom ?? 0) + 6, items, { alignRight: true });
  };

  if (!loaded) return null;
  if (!tracks.length) {
    return <EmptyState icon={DiscAlbum} title="Nothing to explore yet" body="Add a music folder or connect a server — your albums, artists and genres show up here." />;
  }

  const counts = { albums: albums.length, artists: artists.length, genres: genres.length };
  const shown = { albums: shownAlbums.length, artists: shownArtists.length, genres: shownGenres.length }[tab];
  const sortLabel = columnsOf.find((c) => c.key === sort.by)?.label ?? columnsOf[0].label;

  return (
    <div className="space-y-6">
      <header className="pt-2">
        <h1 className="font-display text-[44px] font-extrabold tracking-[-0.04em] text-ink-hi leading-none">Explore</h1>
        <p className="text-[14px] text-ink-dim mt-3">
          {plural(albums.length, "album", "albums")} · {plural(artists.length, "artist", "artists")} · {plural(genres.length, "genre", "genres")} in your library
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Pills options={TABS.map((t) => ({ ...t, count: counts[t.key] }))} value={tab} onChange={setTab} />
        <div className="ml-auto flex items-center gap-2">
          <label className="relative flex items-center">
            <Search className="absolute left-3 w-4 h-4 text-ink-hi/45 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Filter ${tab}`}
              aria-label={`Filter ${tab}`}
              className="h-9 w-56 pl-9 pr-8 rounded-full bg-ink-hi/[0.06] text-[13.5px] text-ink-hi placeholder:text-ink-hi/40 outline-none focus:bg-ink-hi/[0.09] transition-colors"
            />
            {query && (
              <button onClick={() => setQuery("")} title="Clear filter" aria-label="Clear filter" className="absolute right-2 p-1 rounded-full text-ink-hi/55 hover:text-ink-hi">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </label>
          <button
            ref={sortButton}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              openSortMenu();
            }}
            title={`Sorted by ${sortLabel.toLowerCase()}, ${sort.desc ? "descending" : "ascending"}`}
            aria-label={`Sorted by ${sortLabel.toLowerCase()}`}
            className="h-9 px-3 rounded-full flex items-center gap-1.5 text-[13px] font-medium text-ink-hi/80 hover:text-ink-hi bg-ink-hi/[0.06] hover:bg-ink-hi/[0.09] transition-colors"
          >
            <ArrowUpDown className="w-4 h-4" />
            {sortLabel}
          </button>
          <div className="flex items-center rounded-full bg-ink-hi/[0.06] p-0.5">
            {(
              [
                ["list", List, "List"],
                ["grid", LayoutGrid, "Tiles"],
              ] as const
            ).map(([key, Icon, label]) => (
              <button
                key={key}
                onClick={() => setLayout(key)}
                aria-pressed={layout === key}
                title={label}
                aria-label={label}
                className={`w-8 h-8 grid place-items-center rounded-full transition-colors ${
                  layout === key ? "bg-ink-hi/[0.14] text-ink-hi" : "text-ink-hi/55 hover:text-ink-hi"
                }`}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {shown === 0 ? (
        <EmptyState icon={Search} title={`No ${tab} match “${query.trim()}”`} body="Try another word." />
      ) : layout === "grid" ? (
        <div className="flex flex-wrap gap-y-2 -mx-2">
          {tab === "albums" && shownAlbums.map((r) => <AlbumTile key={r.album.key} album={r.album} />)}
          {tab === "artists" &&
            shownArtists.map((r) => (
              <ArtistTile key={r.artist.route} name={r.artist.name} route={r.artist.route} subtitle={plural(r.artist.trackCount, "song", "songs")} fallbackThumb={r.artist.thumb} />
            ))}
          {tab === "genres" && shownGenres.map((r) => <GenreTile key={r.genre.key} genre={r.genre} />)}
        </div>
      ) : tab === "albums" ? (
        <Table
          label="Albums"
          rows={shownAlbums}
          columns={albumColumns}
          sort={sorts.albums}
          onSort={sortBy}
          rowKey={(r) => r.album.key}
          lead={(r) => <Artwork src={r.album.thumb} rounded="rounded-md" className="w-10 h-10" iconClassName="w-4 h-4" />}
          open={(r) => navigate({ name: "album", param: r.album.route })}
          play={(r) => playCollection(r.album.tracks)}
        />
      ) : tab === "artists" ? (
        <Table
          label="Artists"
          rows={shownArtists}
          columns={artistColumns}
          sort={sorts.artists}
          onSort={sortBy}
          rowKey={(r) => r.artist.route}
          lead={(r) => <ArtistPhoto artist={r.artist} />}
          open={(r) => navigate({ name: "artist", param: r.artist.route })}
          play={(r) => playCollection(artistTracks(tracks, r.artist.name))}
        />
      ) : (
        <Table
          label="Genres"
          rows={shownGenres}
          columns={genreColumns}
          sort={sorts.genres}
          onSort={sortBy}
          rowKey={(r) => r.genre.key}
          lead={(r) => <CoverCollage tracks={r.genre.tracks} className="w-10 h-10 rounded-md" />}
          open={(r) => navigate({ name: "genre", param: r.genre.route })}
          play={(r) => playCollection(r.genre.tracks, true)}
        />
      )}
    </div>
  );
}
