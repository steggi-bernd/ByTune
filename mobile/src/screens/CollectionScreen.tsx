/**
 * A list of songs with a playlist's page: a playlist, Liked Songs, a mix, a
 * genre, an artist's liked songs. The header is the desktop's: the picture full-bleed
 * and melting into the page, the name and the "PLAYLIST • N SONGS" line over
 * its lower edge, round glass controls under them.
 */
import { useNavigation, useRoute } from "@react-navigation/native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft, EllipsisVertical, Pause, Play, Shuffle } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NameDialog } from "../components/PlaylistSheets";
import { TrackRow } from "../components/ui";
import { artistTracks, fmtTime, plural, type Track } from "../shared";
import { useArtistPhoto, useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { playlistTracks, usePlaylists, type PlaylistTrack } from "../stores/playlists";
import { colors, PAGE_END } from "../theme";
import { useLiked } from "./ArtistScreen";

type Params = { kind: "playlist"; id: string } | { kind: "liked" } | { kind: "mix"; id: string } | { kind: "genre"; key: string } | { kind: "artistLiked"; name: string };

export function CollectionScreen() {
  const nav = useNavigation<any>();
  const params = useRoute<any>().params as Params;
  const insets = useSafeAreaInsets();
  const data = useLibrary((s) => s.data);
  const byId = useLibrary((s) => s.byId);
  const mixes = useLibrary((s) => s.mixes);
  const genres = useLibrary((s) => s.genres);
  const playTracks = usePlayer((s) => s.playTracks);
  const toggle = usePlayer((s) => s.toggle);
  const playWhenReady = usePlayer((s) => s.playWhenReady);

  const playlistId = params.kind === "playlist" ? params.id : null;
  const playlist = usePlaylists((s) => (playlistId ? s.playlists.find((p) => p.id === playlistId) : undefined));
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [held, setHeld] = useState<PlaylistTrack | null>(null);
  // Deleted here or on another device: nothing left to show.
  useEffect(() => {
    if (playlistId && !playlist && nav.canGoBack()) nav.goBack();
  }, [playlistId, playlist, nav]);

  const artistName = params.kind === "artistLiked" ? params.name : "";
  const artistSongs = useMemo(() => (artistName ? artistTracks(data.tracks, artistName) : []), [artistName, data.tracks]);
  const artistLiked = useLiked(artistSongs);
  const photo = useArtistPhoto(artistName);

  const { title, tracks: shown } = useMemo((): { title: string; tracks: PlaylistTrack[] } => {
    switch (params.kind) {
      case "playlist":
        return { title: playlist?.name ?? "Playlist", tracks: playlist ? playlistTracks(playlist) : [] };
      case "liked":
        return { title: "Liked Songs", tracks: data.favorites.map((id) => byId.get(id)).filter((t): t is Track => !!t) };
      case "mix": {
        const mix = mixes.find((m) => m.id === params.id);
        return { title: mix?.title ?? "Mix", tracks: mix?.tracks ?? [] };
      }
      case "genre": {
        const genre = genres.find((g) => g.key === params.key);
        return { title: genre?.name ?? "Genre", tracks: genre?.tracks ?? [] };
      }
      case "artistLiked":
        return { title: `Liked songs by ${params.name}`, tracks: artistLiked };
    }
  }, [params, playlist, data.tracks, data.favorites, byId, mixes, genres, artistLiked]);
  // What can play: a playlist's song this library doesn't have stays in the list only.
  const tracks = useMemo(() => shown.filter((t) => !t.missing), [shown]);

  // Exactly this list playing: its button pauses, not while an album plays one of its songs.
  const playingHere = usePlayer((s) => s.context === title && tracks.some((t) => t.id === s.queue[s.index]?.id));
  const pause = playingHere && playWhenReady;
  const seconds = tracks.reduce((sum, t) => sum + t.duration, 0);
  const meta = ["Playlist", shown.length ? plural(shown.length, "song", "songs") : "", seconds > 0 ? `about ${fmtTime(seconds)}` : ""]
    .filter(Boolean)
    .join(" • ")
    .toUpperCase();
  const picture = photo ?? tracks.find((t) => t.thumb)?.thumb;

  return (
    <>
      <FlatList
        style={styles.root}
        data={shown}
        keyExtractor={(t, i) => `${t.id}-${i}`}
        initialNumToRender={12}
        contentContainerStyle={{ paddingBottom: PAGE_END + insets.bottom }}
        ListHeaderComponent={
          <View style={styles.hero}>
            {!!picture && <Image source={{ uri: picture }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="disk" transition={200} />}
            <LinearGradient
              colors={["rgba(0,0,0,0.2)", "rgba(0,0,0,0.45)", "rgba(0,0,0,0.9)", colors.base]}
              locations={[0, 0.5, 0.8, 1]}
              style={StyleSheet.absoluteFill}
            />
            <Pressable onPress={() => nav.goBack()} accessibilityLabel="Go back" style={[styles.back, { top: insets.top + 2 }]}>
              <ChevronLeft size={28} color={colors.ink} />
            </Pressable>
            {!!playlist && (
              <Pressable onPress={() => setMenu(true)} accessibilityLabel="More options" style={[styles.more, { top: insets.top + 2 }]}>
                <EllipsisVertical size={22} color={colors.ink} />
              </Pressable>
            )}
            <Text numberOfLines={2} style={styles.title}>
              {title}
            </Text>
            <Text style={styles.meta}>{meta}</Text>
            <View style={styles.controls}>
              <Pressable
                accessibilityLabel="Shuffle"
                onPress={() => tracks.length && playTracks(tracks, Math.floor(Math.random() * tracks.length), title, true)}
                style={styles.round}
              >
                <Shuffle size={18} color={colors.ink} />
              </Pressable>
              <Pressable onPress={() => (playingHere ? toggle() : tracks.length && playTracks(tracks, 0, title, false))} style={styles.pill}>
                {pause ? <Pause size={18} color={colors.ink} fill={colors.ink} /> : <Play size={18} color={colors.ink} fill={colors.ink} />}
                <Text style={styles.pillText}>{pause ? "Pause" : "Play"}</Text>
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>No songs here yet.</Text>}
        renderItem={({ item, index }) => (
          <TrackRow
            track={item}
            number={index + 1}
            missing={item.missing}
            onLongPress={playlist ? () => setHeld(item) : undefined}
            onPress={() => playTracks(tracks, Math.max(0, tracks.indexOf(item)), title, false)}
          />
        )}
      />
      {!!playlist && (
      <>
        <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
          <Pressable style={styles.menuBack} onPress={() => setMenu(false)}>
            <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 10 }]}>
              <Pressable
                style={styles.menuRow}
                onPress={() => {
                  setMenu(false);
                  setRenaming(true);
                }}
              >
                <Text style={styles.menuText}>Rename</Text>
              </Pressable>
              <Pressable
                style={styles.menuRow}
                onPress={() => {
                  setMenu(false);
                  Alert.alert(`Delete “${playlist.name}”?`, "It goes from all your devices.", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => usePlaylists.getState().remove(playlist.id) },
                  ]);
                }}
              >
                <Text style={[styles.menuText, styles.menuDanger]}>Delete</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
        <Modal visible={!!held} transparent animationType="fade" onRequestClose={() => setHeld(null)}>
          <Pressable style={styles.menuBack} onPress={() => setHeld(null)}>
            <View style={[styles.menuSheet, { paddingBottom: insets.bottom + 10 }]}>
              {!held?.missing && (
                <Pressable
                  style={styles.menuRow}
                  onPress={() => {
                    const song = held;
                    setHeld(null);
                    if (song) usePlaylists.getState().setPicking(song);
                  }}
                >
                  <Text style={styles.menuText}>Add to playlist</Text>
                </Pressable>
              )}
              <Pressable
                style={styles.menuRow}
                onPress={() => {
                  if (held) usePlaylists.getState().removeTrack(playlist.id, held.entryId ?? held.id);
                  setHeld(null);
                }}
              >
                <Text style={styles.menuText}>Remove from this playlist</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
        <NameDialog
          visible={renaming}
          title="Rename playlist"
          placeholder="Name"
          initial={playlist.name}
          action="Save"
          onCancel={() => setRenaming(false)}
          onDone={(name) => {
            usePlaylists.getState().rename(playlist.id, name);
            setRenaming(false);
          }}
        />
    </>
    )}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.base },
  hero: { alignItems: "center", paddingTop: 176, paddingBottom: 14, paddingHorizontal: 20, overflow: "hidden" },
  back: { position: "absolute", left: 6, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  more: { position: "absolute", right: 6, width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  menuBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  menuSheet: { backgroundColor: colors.sheet, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 10 },
  menuRow: { height: 52, justifyContent: "center", paddingHorizontal: 20 },
  menuText: { color: colors.ink, fontSize: 16 },
  menuDanger: { color: "#FF9D9D" },
  title: { color: colors.ink, fontSize: 28, fontWeight: "800", letterSpacing: -0.8, lineHeight: 34, textAlign: "center" },
  meta: { color: "rgba(255,255,255,0.78)", fontSize: 11, fontWeight: "600", letterSpacing: 1.5, marginTop: 6, textAlign: "center" },
  controls: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 22,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  pillText: { color: colors.ink, fontSize: 14.5, fontWeight: "600" },
  empty: { color: colors.dim, fontSize: 14, textAlign: "center", marginTop: 24 },
});
