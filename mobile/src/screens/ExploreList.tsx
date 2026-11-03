/**
 * Explore, as on the desktop: the whole library as three big lists, albums,
 * artists and genres, each in any of its orders, as rows or as tiles. Tab,
 * layout and every tab's order are remembered.
 */
import { useNavigation } from "@react-navigation/native";
import { ArrowDown, ArrowUp, ArrowUpDown, LayoutGrid, List } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Modal, Pressable, SectionList, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, Chip, Cover, CoverGrid } from "../components/ui";
import {
  addedLabel,
  albumOrders,
  albumRowsOf,
  artistOrders,
  artistRowsOf,
  dayLabel,
  fmtLength,
  genreOrders,
  genreRowsOf,
  nextSort,
  plural,
  RELEASE_LABEL,
  sortRows,
  type AlbumRow,
  type ArtistRow,
  type ExploreTab,
  type GenreRow,
} from "../shared";
import { useExplore } from "../stores/explore";
import { useArtistPhoto, useLibrary } from "../stores/library";
import { colors, PAGE_END } from "../theme";

type Item =
  | { kind: "album"; key: string; row: AlbumRow }
  | { kind: "artist"; key: string; row: ArtistRow }
  | { kind: "genre"; key: string; row: GenreRow };

const COLUMNS = 3;
const GAP = 12;
const SIDE = 16;

const TABS: { key: ExploreTab; label: string }[] = [
  { key: "albums", label: "Albums" },
  { key: "artists", label: "Artists" },
  { key: "genres", label: "Genres" },
];

const titleOf = (item: Item): string =>
  item.kind === "album" ? item.row.album.title : item.kind === "artist" ? item.row.artist.name : item.row.genre.name;

/** The value the list is ordered by, where that isn't the name itself. */
function valueOf(item: Item, by: string): string | null {
  const plays = plural(item.row.plays, "play", "plays");
  if (item.kind === "album") {
    const { album } = item.row;
    if (by === "released") return dayLabel(album.date, album.year);
    if (by === "type") return RELEASE_LABEL[album.kind];
    if (by === "songs") return plural(album.tracks.length, "song", "songs");
    if (by === "length") return fmtLength(album.duration);
    if (by === "added") return addedLabel(album.addedAt);
    return by === "plays" ? plays : null;
  }
  if (item.kind === "artist") {
    const { artist, addedAt } = item.row;
    if (by === "albums") return plural(artist.albumCount, "album", "albums");
    if (by === "songs") return plural(artist.trackCount, "song", "songs");
    if (by === "added") return addedLabel(addedAt);
    return by === "plays" ? plays : null;
  }
  const { genre } = item.row;
  if (by === "artists") return plural(genre.artistCount, "artist", "artists");
  if (by === "albums") return plural(genre.albumCount, "album", "albums");
  if (by === "songs") return plural(genre.tracks.length, "song", "songs");
  return by === "plays" ? plays : null;
}

/** A row's line under the title: there is room for who it is by as well. */
function lineOf(item: Item, by: string): string {
  const value = valueOf(item, by);
  if (item.kind === "album") {
    const { album } = item.row;
    return [album.artist, value ?? album.year].filter(Boolean).join(" · ");
  }
  if (item.kind === "artist") {
    const { artist } = item.row;
    return value ?? `${plural(artist.albumCount, "album", "albums")} · ${plural(artist.trackCount, "song", "songs")}`;
  }
  return value ?? plural(item.row.genre.tracks.length, "song", "songs");
}

/** A tile's line: one thing fits. */
function shortOf(item: Item, by: string): string {
  const value = valueOf(item, by);
  if (value) return value;
  if (item.kind === "album") return item.row.album.artist;
  if (item.kind === "artist") return plural(item.row.artist.trackCount, "song", "songs");
  return plural(item.row.genre.tracks.length, "song", "songs");
}

function ArtistArt({ name, thumb, size }: { name: string; thumb: string; size: number }) {
  const photo = useArtistPhoto(name);
  return <Cover uri={photo} fallback={thumb} size={size} radius={size / 2} />;
}

function Art({ item, size }: { item: Item; size: number }) {
  if (item.kind === "album") return <Cover uri={item.row.album.thumb} size={size} />;
  if (item.kind === "artist") return <ArtistArt name={item.row.artist.name} thumb={item.row.artist.thumb} size={size} />;
  return <CoverGrid tracks={item.row.genre.tracks} size={size} />;
}

export function ExploreList() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tab = useExplore((s) => s.tab);
  const layout = useExplore((s) => s.layout);
  const sorts = useExplore((s) => s.sorts);
  const { setTab, setLayout, setSort } = useExplore.getState();
  const tracks = useLibrary((s) => s.data.tracks);
  const counts = useLibrary((s) => s.data.counts);
  const albums = useLibrary((s) => s.albums);
  const artists = useLibrary((s) => s.artists);
  const genres = useLibrary((s) => s.genres);
  const [menu, setMenu] = useState(false);
  const sort = sorts[tab];

  const items = useMemo<Item[]>(() => {
    if (tab === "albums") return sortRows(albumRowsOf(albums, counts), albumOrders, sort).map((row) => ({ kind: "album", key: row.album.key, row }));
    if (tab === "artists") return sortRows(artistRowsOf(artists, tracks, counts), artistOrders, sort).map((row) => ({ kind: "artist", key: row.artist.name, row }));
    return sortRows(genreRowsOf(genres, counts), genreOrders, sort).map((row) => ({ kind: "genre", key: row.genre.key, row }));
  }, [tab, sort, albums, artists, genres, tracks, counts]);

  const rows = useMemo(() => {
    const size = layout === "grid" ? COLUMNS : 1;
    const out: Item[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }, [items, layout]);

  const open = useCallback(
    (item: Item) => {
      if (item.kind === "album") nav.navigate("Album", { albumKey: item.row.album.key });
      else if (item.kind === "artist") nav.navigate("Artist", { name: item.row.artist.name });
      else nav.navigate("Collection", { kind: "genre", key: item.row.genre.key });
    },
    [nav]
  );

  if (!tracks.length) return <Text style={styles.none}>Nothing to explore yet.</Text>;

  const orders: { key: string; label: string; numeric?: boolean }[] = tab === "albums" ? albumOrders : tab === "artists" ? artistOrders : genreOrders;
  const sortLabel = orders.find((o) => o.key === sort.by)?.label ?? orders[0].label;
  const totals: Record<ExploreTab, number> = { albums: albums.length, artists: artists.length, genres: genres.length };
  const tile = (width - SIDE * 2 - GAP * (COLUMNS - 1)) / COLUMNS;

  return (
    <>
      <SectionList
        key={`${tab}:${layout}`}
        sections={[{ key: tab, data: rows }]}
        stickySectionHeadersEnabled
        keyExtractor={(row) => row[0].key}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        contentContainerStyle={{ paddingBottom: PAGE_END + insets.bottom }}
        ListHeaderComponent={<Text style={styles.heading}>Explore your library</Text>}
        renderSectionHeader={() => (
          <View style={styles.controls}>
            <View style={styles.chips}>
              {TABS.map((t) => (
                <Chip key={t.key} label={`${t.label} ${totals[t.key]}`} active={tab === t.key} onPress={() => setTab(t.key)} />
              ))}
            </View>
            <View style={styles.tools}>
              <Pressable onPress={() => setMenu(true)} accessibilityLabel={`Sorted by ${sortLabel}`} style={styles.sort}>
                <ArrowUpDown size={16} color={colors.ink} />
                <Text style={styles.sortText}>{sortLabel}</Text>
              </Pressable>
              <Pressable
                onPress={() => setLayout(layout === "grid" ? "list" : "grid")}
                accessibilityLabel={layout === "grid" ? "Show as list" : "Show as tiles"}
                style={styles.layout}
              >
                {layout === "grid" ? <List size={20} color={colors.ink} /> : <LayoutGrid size={20} color={colors.ink} />}
              </Pressable>
            </View>
          </View>
        )}
        renderItem={({ item: row }) =>
          layout === "grid" ? (
            <View style={styles.tiles}>
              {row.map((item) => (
                <Card key={item.key} width={tile} art={<Art item={item} size={tile} />} title={titleOf(item)} subtitle={shortOf(item, sort.by)} onPress={() => open(item)} />
              ))}
            </View>
          ) : (
            <Pressable style={styles.row} onPress={() => open(row[0])}>
              <Art item={row[0]} size={56} />
              <View style={styles.rowText}>
                <Text numberOfLines={1} style={styles.rowTitle}>
                  {titleOf(row[0])}
                </Text>
                <Text numberOfLines={1} style={styles.rowSub}>
                  {lineOf(row[0], sort.by)}
                </Text>
              </View>
            </Pressable>
          )
        }
      />

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={styles.menuBack} onPress={() => setMenu(false)}>
          <View style={[styles.menu, { paddingBottom: insets.bottom + 10 }]}>
            <Text style={styles.menuTitle}>Sort by</Text>
            {orders.map((o) => {
              const active = sort.by === o.key;
              return (
                <Pressable
                  key={o.key}
                  style={styles.menuRow}
                  onPress={() => {
                    setSort(tab, nextSort(sort, o));
                    setMenu(false);
                  }}
                >
                  <Text style={[styles.menuText, active && { color: colors.accent }]}>{o.label}</Text>
                  {active && (sort.desc ? <ArrowDown size={18} color={colors.accent} /> : <ArrowUp size={18} color={colors.accent} />)}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  none: { color: colors.dim, fontSize: 14, margin: SIDE },
  heading: { color: colors.ink, fontSize: 17, fontWeight: "700", marginHorizontal: SIDE, marginTop: 8, marginBottom: 12 },
  controls: { backgroundColor: colors.base, paddingBottom: 8 },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: SIDE },
  tools: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 40, paddingLeft: SIDE, paddingRight: 8, marginTop: 6 },
  sort: { flexDirection: "row", alignItems: "center", gap: 8, height: 40 },
  sortText: { color: colors.ink, fontSize: 13, fontWeight: "500" },
  layout: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  tiles: { flexDirection: "row", gap: GAP, paddingHorizontal: SIDE, paddingBottom: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, height: 68, paddingHorizontal: SIDE },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  rowSub: { color: colors.dim, fontSize: 13, marginTop: 3 },
  menuBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  menu: { backgroundColor: colors.sheet, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 14 },
  menuTitle: { color: colors.dim, fontSize: 13, fontWeight: "600", paddingHorizontal: 20, paddingBottom: 6 },
  menuRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 50, paddingHorizontal: 20 },
  menuText: { color: colors.ink, fontSize: 16 },
});
