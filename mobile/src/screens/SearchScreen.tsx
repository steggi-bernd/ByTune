/** Search over the library on this phone; before anything is typed, Explore. */
import { useNavigation } from "@react-navigation/native";
import { Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Cover, TrackRow } from "../components/ui";
import { matchesQuery } from "../shared";
import { useArtistPhoto, useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { colors, PAGE_END } from "../theme";
import { ExploreList } from "./ExploreList";

function ArtistResult({ name, thumb }: { name: string; thumb: string }) {
  const nav = useNavigation<any>();
  const photo = useArtistPhoto(name);
  return (
    <Pressable style={styles.result} onPress={() => nav.navigate("Artist", { name })}>
      <Cover uri={photo} fallback={thumb} size={48} radius={24} />
      <View style={styles.resultText}>
        <Text numberOfLines={1} style={styles.resultTitle}>
          {name}
        </Text>
        <Text style={styles.resultSub}>Artist</Text>
      </View>
    </Pressable>
  );
}

export function SearchScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const tracks = useLibrary((s) => s.data.tracks);
  const albums = useLibrary((s) => s.albums);
  const artists = useLibrary((s) => s.artists);
  const playTracks = usePlayer((s) => s.playTracks);
  const q = text.trim();

  const results = useMemo(() => {
    if (!q) return null;
    const needle = q.toLowerCase();
    return {
      artists: artists.filter((a) => a.name.toLowerCase().includes(needle)).slice(0, 5),
      albums: albums.filter((a) => a.title.toLowerCase().includes(needle)).slice(0, 5),
      songs: tracks.filter((t) => matchesQuery(t, q)).slice(0, 50),
    };
  }, [q, tracks, albums, artists]);

  const none = results && !results.artists.length && !results.albums.length && !results.songs.length;

  return (
    <View style={[styles.root, { paddingTop: insets.top + 14 }]}>
      <Text style={styles.title}>Search</Text>
      <View style={styles.field}>
        <Search size={20} color={colors.soft} strokeWidth={2.2} />
        <TextInput
          accessibilityLabel="Search your library"
          value={text}
          onChangeText={setText}
          placeholder="What do you want to play?"
          placeholderTextColor={colors.soft}
          autoCorrect={false}
          style={styles.input}
        />
      </View>
      {results ? (
        <FlatList
          data={results.songs}
          keyExtractor={(t) => t.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: PAGE_END + insets.bottom }}
          ListHeaderComponent={
            <View>
              {results.artists.map((a) => (
                <ArtistResult key={a.name} name={a.name} thumb={a.thumb} />
              ))}
              {results.albums.map((a) => (
                <Pressable key={a.key} style={styles.result} onPress={() => nav.navigate("Album", { albumKey: a.key })}>
                  <Cover uri={a.thumb} size={48} />
                  <View style={styles.resultText}>
                    <Text numberOfLines={1} style={styles.resultTitle}>
                      {a.title}
                    </Text>
                    <Text numberOfLines={1} style={styles.resultSub}>
                      Album · {a.artist}
                    </Text>
                  </View>
                </Pressable>
              ))}
              {none && <Text style={styles.none}>Nothing in your library matches “{q}”.</Text>}
            </View>
          }
          renderItem={({ item, index }) => <TrackRow track={item} onPress={() => playTracks(results.songs, index, "Search")} />}
        />
      ) : (
        <ExploreList />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.base },
  title: { color: colors.ink, fontSize: 26, fontWeight: "800", letterSpacing: -0.7, marginHorizontal: 16, marginBottom: 14 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 48,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#2C2C2E",
  },
  input: { flex: 1, minWidth: 0, color: colors.ink, fontSize: 15, fontWeight: "500", padding: 0 },
  result: { flexDirection: "row", alignItems: "center", gap: 12, height: 62, paddingHorizontal: 16 },
  resultText: { flex: 1, minWidth: 0 },
  resultTitle: { color: colors.ink, fontSize: 15, fontWeight: "500" },
  resultSub: { color: colors.dim, fontSize: 13, marginTop: 3 },
  none: { color: colors.dim, fontSize: 14, margin: 16 },
});
