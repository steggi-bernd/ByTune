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
import { artistTracks, useLibraryGenres, useLibraryIndex, type LibArtist } from "../lib/catalogIndex";
import {
  addedLabel,
  albumOrders,
  albumRowsOf,
  artistOrders,
  artistRowsOf,
  dayLabel,
  genreOrders,
  genreRowsOf,
  nextSort,
  sortRows,
  type AlbumRow,
  type ArtistRow,
  type ExploreOrder,
  type GenreRow,
} from "../lib/exploreRows";
import { fmtTime, plural } from "../lib/format";
import { RELEASE_LABEL } from "../lib/releases";
import { useCatalog, useFreshPlayCounts } from "../stores/catalog";
import { useSettings, type ExploreSort, type ExploreTab } from "../stores/settings";
import { useUI, type MenuItem } from "../stores/ui";

/** How an order looks as a table column. */
interface ColumnLook<T> {
  /** width — the same classes on the header and on every cell */
  className: string;
  /** shown once the table is at least this wide (px); the page sits between the library and the side panel, so the window's width says little */
  from?: number;
  right?: boolean;
  cell: (row: T) => ReactNode;
}
type Column<T> = ExploreOrder<T> & ColumnLook<T>;

const columnsOf = <T,>(orders: ExploreOrder<T>[], looks: Record<string, ColumnLook<T>>): Column<T>[] => orders.map((o) => ({ ...o, ...looks[o.key] }));

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

const albumColumns = columnsOf<AlbumRow>(albumOrders, {
  title: { className: "flex-[3] min-w-0", cell: (r) => r.album.title },
  artist: { className: "flex-[2] min-w-0", cell: (r) => r.album.artist },
  released: {
    className: "w-28 shrink-0",
    from: 630,
    cell: (r) => <span title={r.album.date ?? undefined}>{dayLabel(r.album.date, r.album.year)}</span>,
  },
  type: { className: "w-24 shrink-0", from: 820, cell: (r) => RELEASE_LABEL[r.album.kind] },
  songs: { className: "w-16 shrink-0", from: 710, right: true, cell: (r) => r.album.tracks.length },
  length: { className: "w-20 shrink-0", from: 920, right: true, cell: (r) => fmtTime(r.album.duration) },
  added: { className: "w-28 shrink-0", from: 1050, cell: (r) => addedLabel(r.album.addedAt) },
  plays: { className: "w-16 shrink-0", from: 500, right: true, cell: (r) => r.plays || "—" },
});
const artistColumns = columnsOf<ArtistRow>(artistOrders, {
  name: { className: "flex-1 min-w-0", cell: (r) => r.artist.name },
  albums: { className: "w-20 shrink-0", from: 420, right: true, cell: (r) => r.artist.albumCount || "—" },
  songs: { className: "w-20 shrink-0", from: 520, right: true, cell: (r) => r.artist.trackCount },
  plays: { className: "w-20 shrink-0", from: 620, right: true, cell: (r) => r.plays || "—" },
  added: { className: "w-28 shrink-0", from: 750, cell: (r) => addedLabel(r.addedAt) },
});
const genreColumns = columnsOf<GenreRow>(genreOrders, {
  name: { className: "flex-1 min-w-0", cell: (r) => r.genre.name },
  artists: { className: "w-20 shrink-0", from: 620, right: true, cell: (r) => r.genre.artistCount },
  albums: { className: "w-20 shrink-0", from: 520, right: true, cell: (r) => r.genre.albumCount },
  songs: { className: "w-20 shrink-0", from: 420, right: true, cell: (r) => r.genre.tracks.length },
  plays: { className: "w-20 shrink-0", from: 720, right: true, cell: (r) => r.plays || "—" },
});

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

  const albumRows = useMemo(() => albumRowsOf(albums, playCounts), [albums, playCounts]);
  const artistRows = useMemo(() => artistRowsOf(artists, tracks, playCounts), [artists, tracks, playCounts]);
  const genreRows = useMemo(() => genreRowsOf(genres, playCounts), [genres, playCounts]);

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

  const tabColumns: { key: string; label: string; numeric?: boolean }[] = { albums: albumColumns, artists: artistColumns, genres: genreColumns }[tab];
  const sortBy = (col: { key: string; numeric?: boolean }): void => setSort(tab, nextSort(sort, col));
  const openSortMenu = (): void => {
    const ui = useUI.getState();
    if (ui.contextMenu) {
      ui.closeContextMenu();
      return;
    }
    const rect = sortButton.current?.getBoundingClientRect();
    const items: MenuItem[] = [
      { label: "Sort by", header: true },
      ...tabColumns.map((c) => ({
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
  const sortLabel = tabColumns.find((c) => c.key === sort.by)?.label ?? tabColumns[0].label;

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
          {/* The list sorts by its column heads; the tiles have none. */}
          {layout === "grid" && (
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
          )}
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
