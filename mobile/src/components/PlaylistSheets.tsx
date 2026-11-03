/** The small sheets around playlists: which one a song goes to, and what a new one is called. */
import { Check, Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import { FlatList, KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { plural } from "../shared";
import { entryOf, playlistTracks, usePlaylists } from "../stores/playlists";
import { colors } from "../theme";
import { CoverGrid } from "./ui";

/** Asks for a name: a new playlist's, a playlist's new one, or anything of that size. */
export function NameDialog({
  visible,
  title,
  placeholder,
  initial = "",
  action,
  allowEmpty,
  address,
  onDone,
  onCancel,
}: {
  visible: boolean;
  title: string;
  placeholder: string;
  initial?: string;
  action: string;
  allowEmpty?: boolean;
  /** a web address, not a name */
  address?: boolean;
  onDone: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    if (visible) setValue(initial);
  }, [visible, initial]);
  const ready = allowEmpty || !!value.trim();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior="padding" style={styles.dialogBack}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} accessibilityLabel="Cancel" />
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>{title}</Text>
          <TextInput
            autoFocus
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.dim}
            autoCorrect={false}
            autoCapitalize={address ? "none" : "sentences"}
            keyboardType={address ? "url" : "default"}
            onSubmitEditing={() => ready && onDone(value.trim())}
            style={styles.input}
          />
          <View style={styles.buttons}>
            <Pressable onPress={onCancel} style={styles.button}>
              <Text style={styles.buttonText}>Cancel</Text>
            </Pressable>
            <Pressable disabled={!ready} onPress={() => onDone(value.trim())} style={styles.button}>
              <Text style={[styles.buttonText, styles.buttonMain, !ready && styles.buttonOff]}>{action}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Opened with a song set as `picking`: anywhere a song can be held down. */
export function AddToPlaylistSheet() {
  const insets = useSafeAreaInsets();
  const picking = usePlaylists((s) => s.picking);
  const playlists = usePlaylists((s) => s.playlists);
  const { setPicking, addTrack, removeTrack, create } = usePlaylists.getState();
  const [naming, setNaming] = useState(false);
  const close = (): void => setPicking(null);

  return (
    <>
      <Modal visible={!!picking && !naming} transparent animationType="fade" onRequestClose={close}>
        <Pressable style={styles.back} onPress={close}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 10 }]}>
            <Text style={styles.heading}>Add to playlist</Text>
            <Text numberOfLines={1} style={styles.song}>
              {picking?.title}
            </Text>
            <Pressable style={styles.row} onPress={() => setNaming(true)}>
              <View style={styles.newMark}>
                <Plus size={24} color={colors.ink} />
              </View>
              <Text style={styles.rowTitle}>New playlist</Text>
            </Pressable>
            <FlatList
              data={playlists}
              keyExtractor={(p) => p.id}
              style={styles.list}
              renderItem={({ item }) => {
                const entry = picking ? entryOf(item, picking) : undefined;
                return (
                  <Pressable
                    style={styles.row}
                    onPress={() => {
                      if (!picking) return;
                      if (entry) removeTrack(item.id, entry.id);
                      else addTrack(item.id, picking);
                      close();
                    }}
                  >
                    <CoverGrid tracks={playlistTracks(item)} size={48} />
                    <View style={styles.rowText}>
                      <Text numberOfLines={1} style={styles.rowTitle}>
                        {item.name}
                      </Text>
                      <Text style={styles.rowSub}>{plural(item.tracks.length, "song", "songs")}</Text>
                    </View>
                    {!!entry && <Check size={22} color={colors.accent} />}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
      <NameDialog
        visible={!!picking && naming}
        title="New playlist"
        placeholder="Name"
        action="Create"
        onCancel={() => setNaming(false)}
        onDone={(name) => {
          if (picking) addTrack(create(name), picking);
          setNaming(false);
          close();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { maxHeight: "75%", backgroundColor: colors.sheet, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 16 },
  heading: { color: colors.ink, fontSize: 18, fontWeight: "700", paddingHorizontal: 20 },
  song: { color: colors.dim, fontSize: 13, paddingHorizontal: 20, marginTop: 3, marginBottom: 8 },
  list: { flexGrow: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, height: 62, paddingHorizontal: 20 },
  newMark: { width: 48, height: 48, borderRadius: 4, backgroundColor: colors.button, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: "500" },
  rowSub: { color: colors.dim, fontSize: 13, marginTop: 2 },
  dialogBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 28 },
  dialog: { backgroundColor: colors.sheet, borderRadius: 14, padding: 20 },
  dialogTitle: { color: colors.ink, fontSize: 18, fontWeight: "700", marginBottom: 14 },
  input: { height: 46, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.button, color: colors.ink, fontSize: 15 },
  buttons: { flexDirection: "row", justifyContent: "flex-end", gap: 4, marginTop: 14 },
  button: { height: 40, paddingHorizontal: 14, justifyContent: "center" },
  buttonText: { color: colors.soft, fontSize: 15, fontWeight: "600" },
  buttonMain: { color: colors.accent },
  buttonOff: { opacity: 0.4 },
});
