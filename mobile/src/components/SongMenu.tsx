/** What a held song offers, and the download button of a whole list. */
import { CircleArrowDown } from "lucide-react-native";
import { Alert, Modal, Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";
import { plural, type Track } from "../shared";
import { useConnection } from "../stores/connection";
import { downloadOf, useDownloads } from "../stores/downloads";
import { usePlaylists } from "../stores/playlists";
import { colors } from "../theme";

interface MenuExtra {
  label: string;
  run(): void;
}

interface SongMenuState {
  track: Track | null;
  extras: MenuExtra[];
  /** a playlist's song this library doesn't have: only the extras apply */
  plain: boolean;
  open(track: Track, options?: { extras?: MenuExtra[]; plain?: boolean }): void;
  close(): void;
}

export const useSongMenu = create<SongMenuState>((set) => ({
  track: null,
  extras: [],
  plain: false,
  open: (track, options) => set({ track, extras: options?.extras ?? [], plain: !!options?.plain }),
  close: () => set({ track: null, extras: [], plain: false }),
}));

const DOWNLOAD_LABEL = { kept: "Remove download", loading: "Stop downloading", wifi: "Stop waiting for Wi-Fi", failed: "Try downloading again" } as const;

/** On mobile data the question comes up at once: nothing that silently waits for a Wi-Fi nobody has in mind. */
export function startDownload(tracks: Track[]): void {
  const { add, overMobile, setOverMobile, quality } = useDownloads.getState();
  if (!useConnection.getState().metered || overMobile) {
    add(tracks);
    return;
  }
  Alert.alert(
    "You're on mobile data",
    quality === "original" ? "Downloading the files themselves takes about 10 MB a minute of music, or wait for Wi-Fi." : "Downloading takes about 1.5 MB a minute of music, or wait for Wi-Fi.",
    [
      { text: "Wait for Wi-Fi", onPress: () => add(tracks) },
      {
        text: "Use mobile data",
        onPress: () => {
          setOverMobile(true);
          add(tracks);
        },
      },
    ],
    { cancelable: true }
  );
}

/** One song's download, the same words wherever it is offered. */
export function useDownloadAction(track: Track | null | undefined): { label: string; run(): void } | null {
  const state = useDownloads((s) => (track ? downloadOf(s, track.id) : null));
  if (!track) return null;
  const { remove } = useDownloads.getState();
  return {
    label: state ? DOWNLOAD_LABEL[state] : "Download",
    run: () => (state === "kept" || state === "loading" || state === "wifi" ? remove([track]) : startDownload([track])),
  };
}

export function SongMenu() {
  const insets = useSafeAreaInsets();
  const { track, extras, plain, close } = useSongMenu();
  const download = useDownloadAction(track);
  const row = (label: string, run: () => void) => (
    <Pressable
      key={label}
      style={styles.row}
      onPress={() => {
        close();
        run();
      }}
    >
      <Text style={styles.rowText}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible={!!track} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.back} onPress={close}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 10 }]}>
          {!!track && (
            <View style={styles.head}>
              <Text numberOfLines={1} style={styles.title}>
                {track.title}
              </Text>
              <Text numberOfLines={1} style={styles.artist}>
                {track.artist}
              </Text>
            </View>
          )}
          {!plain && !!download && row(download.label, download.run)}
          {!plain && !!track && row("Add to playlist", () => usePlaylists.getState().setPicking(track))}
          {extras.map((extra) => row(extra.label, extra.run))}
        </View>
      </Pressable>
    </Modal>
  );
}

/** All of a list on the phone: the arrow fills up as its songs arrive. */
export function DownloadButton({ tracks, size = 24, style }: { tracks: Track[]; size?: number; style?: ViewStyle }) {
  const counts = useDownloads((s) => {
    let kept = 0;
    let loading = 0;
    for (const t of tracks) {
      if (s.kept[t.id]) kept += 1;
      else if (s.loading[t.id] && !s.loading[t.id].failed) loading += 1;
    }
    return `${kept}/${loading}`;
  });
  const [kept, loading] = counts.split("/").map(Number);
  const all = tracks.length > 0 && kept === tracks.length;
  const { remove } = useDownloads.getState();
  const label = all ? "Remove download" : loading ? "Downloading" : "Download";
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={() => {
        if (!tracks.length) return;
        if (all || loading) {
          Alert.alert(all ? "Remove these downloads?" : "Stop these downloads?", `${plural(kept + loading, "song", "songs")} from this phone. They stay on your server.`, [
            { text: "Cancel", style: "cancel" },
            { text: "Remove", style: "destructive", onPress: () => remove(tracks) },
          ]);
        } else startDownload(tracks);
      }}
      style={[styles.button, style]}
    >
      <CircleArrowDown size={size} color={all ? colors.onAccent : loading ? colors.accent : colors.ink} fill={all ? colors.accent : "transparent"} />
      {!!loading && (
        <Text style={styles.count}>
          {kept}/{tracks.length}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.sheet, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 10 },
  head: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: colors.hairline, marginBottom: 4 },
  title: { color: colors.ink, fontSize: 16, fontWeight: "600" },
  artist: { color: colors.dim, fontSize: 13, marginTop: 2 },
  row: { height: 52, justifyContent: "center", paddingHorizontal: 20 },
  rowText: { color: colors.ink, fontSize: 16 },
  button: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minWidth: 44, height: 44 },
  count: { color: colors.accent, fontSize: 12, fontWeight: "600" },
});
