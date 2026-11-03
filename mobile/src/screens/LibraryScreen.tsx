/**
 * Your Library: Liked Songs on top, the rest by when it last played or was
 * made. The playlists are the same ones as on the desktop (stores/playlists.ts);
 * the mixes stand in the list as playlists do.
 */
import { useNavigation } from "@react-navigation/native";
import { ArrowUpDown, CircleArrowDown, Heart, Pin, Plus } from "lucide-react-native";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NameDialog } from "../components/PlaylistSheets";
import { Chip, Cover, CoverGrid, EqBars } from "../components/ui";
import { plural, type LibAlbum, type Track } from "../shared";
import { sizeLine, useDownloads } from "../stores/downloads";
import { likedSongIds, useArtistPhoto, useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { playlistTracks, usePlaylists } from "../stores/playlists";
import { colors, PAGE_END } from "../theme";

type Filter = "playlists" | "albums" | "artists" | null;

type Row =
  | { kind: "liked"; key: string; count: number }
  | { kind: "downloads"; key: string; line: string }
  | { kind: "playlist"; key: string; title: string; subtitle: string; tracks: Track[]; lastAt: number }
  | { kind: "mix"; key: string; id: string; title: string; subtitle: string; tracks: Track[]; lastAt: number }
  | { kind: "album"; key: string; album: LibAlbum; lastAt: number }
  | { kind: "artist"; key: string; name: string; thumb: string; lastAt: number };

function ArtistArt({ name, thumb }: { name: string; thumb: string }) {
  const photo = useArtistPhoto(name);
  return <Cover uri={photo} fallback={thumb} size={56} radius={28} />;
}

export function LibraryScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<Filter>(null);
  const [naming, setNaming] = useState(false);
  const playlists = usePlaylists((s) => s.playlists);
  const data = useLibrary((s) => s.data);
  const byId = useLibrary((s) => s.byId);
  const albums = useLibrary((s) => s.albums);
  const artists = useLibrary((s) => s.artists);
  const mixes = useLibrary((s) => s.mixes);
  const playingAlbum = usePlayer((s) => s.queue[s.index]?.albumId);
  const kept = useDownloads((s) => s.kept);
  const loadingCount = useDownloads((s) => Object.values(s.loading).filter((song) => !song.failed).length);
  const wifiCount = useDownloads((s) => Object.values(s.loading).filter((song) => song.wantsWifi).length);

  const rows = useMemo<Row[]>(() => {
    const lastOf = (tracks: Track[]): number => Math.max(0, ...tracks.map((t) => data.counts[t.id]?.lastAt ?? 0));
    const artistLast = new Map<string, number>();
    for (const t of data.tracks) {
      const at = data.counts[t.id]?.lastAt ?? 0;
      if (at > (artistLast.get(t.artist.toLowerCase()) ?? 0)) artistLast.set(t.artist.toLowerCase(), at);
    }
    const rest: Row[] = [];
    if (filter !== "albums" && filter !== "artists") {
      for (const p of playlists) {
        const tracks = playlistTracks(p);
        rest.push({
          kind: "playlist",
          key: p.id,
          title: p.name,
          subtitle: `Playlist · ${plural(tracks.length, "song", "songs")}`,
          tracks,
          // A new one stands on top, as what somebody just did.
          lastAt: Math.max(p.createdAt, lastOf(tracks)),
        });
      }
      for (const m of mixes) rest.push({ kind: "mix", key: m.id, id: m.id, title: m.title, subtitle: `Mix · ${plural(m.tracks.length, "song", "songs")}`, tracks: m.tracks, lastAt: 0 });
    }
    if (filter !== "playlists" && filter !== "artists") {
      for (const album of albums) rest.push({ kind: "album", key: album.key, album, lastAt: lastOf(album.tracks) });
    }
    if (filter !== "playlists" && filter !== "albums") {
      for (const a of artists) rest.push({ kind: "artist", key: a.name, name: a.name, thumb: a.thumb, lastAt: artistLast.get(a.name.toLowerCase()) ?? 0 });
    }
    // Stable: what never played keeps its order behind the rest.
    const lastAt = (r: Row): number => (r.kind === "liked" || r.kind === "downloads" ? 0 : r.lastAt);
    rest.sort((a, b) => lastAt(b) - lastAt(a));
    const liked: Row[] = filter === "albums" || filter === "artists" ? [] : [{ kind: "liked", key: "liked", count: likedSongIds(data.favorites, byId).length }];
    const keptSongs = Object.values(kept);
    const downloads: Row[] =
      liked.length && (keptSongs.length || loadingCount)
        ? [
            {
              kind: "downloads",
              key: "downloads",
              line: wifiCount
                ? `${plural(wifiCount, "song waits", "songs wait")} for Wi-Fi`
                : loadingCount
                ? `Downloading ${plural(loadingCount, "song", "songs")}…`
                : `${plural(keptSongs.length, "song", "songs")} · ${sizeLine(keptSongs.reduce((sum, k) => sum + k.bytes, 0))}`,
            },
          ]
        : [];
    return [...liked, ...downloads, ...rest];
  }, [data, albums, artists, mixes, playlists, filter, kept, loadingCount, wifiCount]);

  const chip = (label: string, value: Exclude<Filter, null>) => (
    <Chip label={label} active={filter === value} onPress={() => setFilter(filter === value ? null : value)} />
  );

  const renderRow = ({ item }: { item: Row }) => {
    switch (item.kind) {
      case "liked":
        return (
          <Pressable style={styles.row} onPress={() => nav.navigate("Collection", { kind: "liked" })}>
            <LinearGradient colors={[colors.accent, "#3F3463"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.liked}>
              <Heart size={24} color={colors.ink} fill={colors.ink} />
            </LinearGradient>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Liked Songs</Text>
              <View style={styles.pinned}>
                <Pin size={12} color={colors.accent} fill={colors.accent} />
                <Text style={styles.rowSub}>Playlist · {plural(item.count, "song", "songs")}</Text>
              </View>
            </View>
          </Pressable>
        );
      case "downloads":
        return (
          <Pressable style={styles.row} onPress={() => nav.navigate("Collection", { kind: "downloads" })}>
            <View style={styles.downloads}>
              <CircleArrowDown size={26} color={colors.accent} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Downloads</Text>
              <Text style={styles.rowSub}>{item.line}</Text>
            </View>
          </Pressable>
        );
      case "playlist":
        return (
          <Pressable style={styles.row} onPress={() => nav.navigate("Collection", { kind: "playlist", id: item.key })}>
            <CoverGrid tracks={item.tracks} size={56} />
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={styles.rowSub}>
                {item.subtitle}
              </Text>
            </View>
          </Pressable>
        );
      case "mix":
        return (
          <Pressable style={styles.row} onPress={() => nav.navigate("Collection", { kind: "mix", id: item.id })}>
            <CoverGrid tracks={item.tracks} size={56} />
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {item.title}
              </Text>
              <Text numberOfLines={1} style={styles.rowSub}>
                {item.subtitle}
              </Text>
            </View>
          </Pressable>
        );
      case "album": {
        const playing = playingAlbum === item.album.route;
        return (
          <Pressable style={styles.row} onPress={() => nav.navigate("Album", { albumKey: item.album.key })}>
            <Cover uri={item.album.thumb} size={56} />
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={[styles.rowTitle, playing && { color: colors.accent }]}>
                {item.album.title}
              </Text>
              <Text numberOfLines={1} style={styles.rowSub}>
                Album · {item.album.artist}
              </Text>
            </View>
            {playing && <EqBars />}
          </Pressable>
        );
      }
      case "artist":
        return (
          <Pressable style={styles.row} onPress={() => nav.navigate("Artist", { name: item.name })}>
            <ArtistArt name={item.name} thumb={item.thumb} />
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={styles.rowTitle}>
                {item.name}
              </Text>
              <Text style={styles.rowSub}>Artist</Text>
            </View>
          </Pressable>
        );
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + 14 }]}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Your Library</Text>
        <Pressable onPress={() => setNaming(true)} accessibilityLabel="New playlist" style={styles.plus}>
          <Plus size={26} color={colors.ink} />
        </Pressable>
      </View>
      <View style={styles.chips}>
        {chip("Playlists", "playlists")}
        {chip("Albums", "albums")}
        {chip("Artists", "artists")}
      </View>
      <View style={styles.sort}>
        <ArrowUpDown size={16} color={colors.ink} />
        <Text style={styles.sortText}>Recently played</Text>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => `${r.kind}:${r.key}`}
        renderItem={renderRow}
        initialNumToRender={12}
        contentContainerStyle={{ paddingBottom: PAGE_END + insets.bottom }}
      />
      <NameDialog
        visible={naming}
        title="New playlist"
        placeholder="Name"
        action="Create"
        onCancel={() => setNaming(false)}
        onDone={(name) => {
          setNaming(false);
          nav.navigate("Collection", { kind: "playlist", id: usePlaylists.getState().create(name) });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.base },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12, paddingLeft: 16, paddingRight: 6 },
  title: { color: colors.ink, fontSize: 26, fontWeight: "800", letterSpacing: -0.7 },
  plus: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  sort: { flexDirection: "row", alignItems: "center", gap: 8, height: 36, paddingHorizontal: 16 },
  sortText: { color: colors.ink, fontSize: 13, fontWeight: "500" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, height: 68, paddingHorizontal: 16 },
  liked: { width: 56, height: 56, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  downloads: { width: 56, height: 56, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: colors.panel },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  rowSub: { color: colors.dim, fontSize: 13, marginTop: 3 },
  pinned: { flexDirection: "row", alignItems: "center", gap: 5 },
});
