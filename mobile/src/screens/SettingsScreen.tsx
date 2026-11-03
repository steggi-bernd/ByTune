/** Which server this phone is signed in to; reading the library again; the sync service; signing out. */
import { useNavigation } from "@react-navigation/native";
import { ChevronLeft, Link2, LogOut, RefreshCw } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NameDialog } from "../components/PlaylistSheets";
import { plural, type SyncStatus } from "../shared";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { usePlaylists } from "../stores/playlists";
import { useSession } from "../stores/session";
import { syncAddress, useSync } from "../sync";
import { colors } from "../theme";

const SYNC_LINE: Record<SyncStatus, string> = {
  off: "Off",
  connecting: "Looking for it…",
  connected: "Connected",
  unreachable: "Not found. Is it running there?",
  rejected: "It refused this login",
};

export function SettingsScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const session = useSession((s) => s.session);
  const signOut = useSession((s) => s.signOut);
  const count = useLibrary((s) => s.data.tracks.length);
  const refreshing = useLibrary((s) => s.refreshing);
  const refresh = useLibrary((s) => s.refresh);
  const clear = useLibrary((s) => s.clear);
  const stop = usePlayer((s) => s.stop);
  const syncStatus = useSync((s) => s.status);
  const customAddress = useSync((s) => s.customAddress);
  const setCustomAddress = useSync((s) => s.setCustomAddress);
  const [editingAddress, setEditingAddress] = useState(false);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 2 }]}>
      <Pressable onPress={() => nav.goBack()} accessibilityLabel="Go back" style={styles.back}>
        <ChevronLeft size={28} color={colors.ink} />
      </Pressable>
      <Text style={styles.title}>Settings</Text>

      <Text style={styles.section}>SERVER</Text>
      <View style={styles.group}>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Jellyfin</Text>
          <Text numberOfLines={1} style={styles.rowSub}>
            {session?.server}
          </Text>
          <Text style={styles.rowSub}>
            {session?.userName} · {plural(count, "song", "songs")}
          </Text>
        </View>
        <View style={styles.divider} />
        <Pressable disabled={refreshing} onPress={() => void refresh()} style={styles.action}>
          <RefreshCw size={20} color={colors.ink} />
          <Text style={styles.actionText}>{refreshing ? "Reading the library…" : "Read the library again"}</Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          onPress={() => {
            stop();
            clear();
            usePlaylists.getState().clear();
            void signOut();
          }}
          style={styles.action}
        >
          <LogOut size={20} color="#FF9D9D" />
          <Text style={[styles.actionText, { color: "#FF9D9D" }]}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>SYNC</Text>
      <View style={styles.group}>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Playlists and where you stopped</Text>
          <Text style={[styles.rowSub, syncStatus === "connected" && { color: colors.accent }]}>{SYNC_LINE[syncStatus]}</Text>
          <Text numberOfLines={1} style={styles.rowSub}>
            {syncAddress()}
          </Text>
        </View>
        <View style={styles.divider} />
        <Pressable onPress={() => setEditingAddress(true)} style={styles.action}>
          <Link2 size={20} color={colors.ink} />
          <Text style={styles.actionText}>{customAddress ? "Change the address" : "Enter another address"}</Text>
        </Pressable>
      </View>

      <NameDialog
        visible={editingAddress}
        title="Sync service"
        placeholder="Empty: on your Jellyfin server"
        initial={customAddress}
        action="Save"
        allowEmpty
        onCancel={() => setEditingAddress(false)}
        onDone={(address) => {
          setCustomAddress(address);
          setEditingAddress(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.base, paddingHorizontal: 16 },
  back: { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" },
  title: { color: colors.ink, fontSize: 30, fontWeight: "800", letterSpacing: -0.8, marginTop: 4 },
  section: { color: colors.dim, fontSize: 11, fontWeight: "600", letterSpacing: 1.5, marginTop: 26, marginBottom: 8 },
  group: { borderRadius: 12, backgroundColor: colors.panel, overflow: "hidden" },
  row: { padding: 14, gap: 3 },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  rowSub: { color: colors.dim, fontSize: 13 },
  divider: { height: 1, backgroundColor: colors.hairline, marginLeft: 14 },
  action: { flexDirection: "row", alignItems: "center", gap: 12, height: 52, paddingHorizontal: 14 },
  actionText: { color: colors.ink, fontSize: 15 },
});
