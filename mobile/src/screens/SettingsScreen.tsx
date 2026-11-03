/** Where the server is, at home and away; the library; what's kept on the phone; the sync service; signing out. */
import { useNavigation } from "@react-navigation/native";
import { ChevronLeft, Link2, LogOut, RefreshCw, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Reach } from "../addresses";
import type { Leveling } from "../quality";
import { NameDialog } from "../components/PlaylistSheets";
import { Chip } from "../components/ui";
import { plural, type SyncStatus } from "../shared";
import { useConnection } from "../stores/connection";
import { sizeLine, useDownloads } from "../stores/downloads";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { usePlaylists } from "../stores/playlists";
import { useSession } from "../stores/session";
import { syncAddress, useSync } from "../sync";
import { colors, PAGE_END } from "../theme";

const SYNC_LINE: Record<SyncStatus, string> = {
  off: "Off",
  connecting: "Looking for it…",
  connected: "Connected",
  unreachable: "Not found. Is it running there?",
  rejected: "It refused this login",
};

const LEVELS: { value: Leveling; label: string; line: string }[] = [
  { value: "off", label: "Off", line: "Every song as loud as it was mastered" },
  { value: "quiet", label: "Quiet", line: "Loud songs come down to about −18 LUFS" },
  { value: "normal", label: "Normal", line: "Loud songs come down to about −14 LUFS, as on Spotify" },
  { value: "loud", label: "Loud", line: "Loud songs come down to about −11 LUFS" },
];

const REACH_LINE: Record<Reach, string> = {
  home: "Connected at home",
  away: "Connected from away",
  offline: "Out of reach. Downloaded music plays.",
};

export function SettingsScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const session = useSession((s) => s.session);
  const signOut = useSession((s) => s.signOut);
  const setAddress = useSession((s) => s.setAddress);
  const reach = useConnection((s) => s.reach);
  const count = useLibrary((s) => s.data.tracks.length);
  const refreshing = useLibrary((s) => s.refreshing);
  const refresh = useLibrary((s) => s.refresh);
  const clear = useLibrary((s) => s.clear);
  const stop = usePlayer((s) => s.stop);
  const syncStatus = useSync((s) => s.status);
  const customAddress = useSync((s) => s.customAddress);
  const setCustomAddress = useSync((s) => s.setCustomAddress);
  const kept = useDownloads((s) => s.kept);
  const waitingForWifi = useDownloads((s) => Object.values(s.loading).filter((song) => song.wantsWifi).length);
  const quality = useDownloads((s) => s.quality);
  const overMobile = useDownloads((s) => s.overMobile);
  const keep24Bit = usePlayer((s) => s.keep24Bit);
  const leveling = usePlayer((s) => s.leveling);
  const lastProblem = useDownloads((s) => s.lastProblem);
  const failedCount = useDownloads((s) => Object.values(s.loading).filter((song) => song.failed).length);
  const loadingCount = useDownloads((s) => Object.values(s.loading).filter((song) => !song.failed).length);
  const [editingSync, setEditingSync] = useState(false);
  const [editingServer, setEditingServer] = useState<"home" | "away" | null>(null);

  const keptSongs = Object.values(kept);
  const keptBytes = keptSongs.reduce((sum, song) => sum + song.bytes, 0);
  const onItsWay = useDownloads((s) => Object.keys(s.loading).length);
  const anyDownloads = keptSongs.length + onItsWay > 0;

  const leave = (): void => {
    stop();
    clear();
    usePlaylists.getState().clear();
    useDownloads.getState().removeAll();
    void signOut();
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + 2, paddingBottom: PAGE_END + insets.bottom }}>
      <Pressable onPress={() => nav.goBack()} accessibilityLabel="Go back" style={styles.back}>
        <ChevronLeft size={28} color={colors.ink} />
      </Pressable>
      <Text style={styles.title}>Settings</Text>

      <Text style={styles.section}>SERVER</Text>
      <View style={styles.group}>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Jellyfin</Text>
          <Text style={[styles.rowSub, reach !== "offline" && { color: colors.accent }]}>{REACH_LINE[reach]}</Text>
          <Text style={styles.rowSub}>
            {session?.userName} · {plural(count, "song", "songs")}
          </Text>
        </View>
        <View style={styles.divider} />
        <Pressable onPress={() => setEditingServer("home")} style={styles.row}>
          <Text style={styles.rowTitle}>Address at home</Text>
          <Text numberOfLines={1} style={styles.rowSub}>
            {session?.home}
          </Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable onPress={() => setEditingServer("away")} style={styles.row}>
          <Text style={styles.rowTitle}>Address away from home</Text>
          <Text numberOfLines={2} style={styles.rowSub}>
            {session?.away ?? "None yet: your music plays only at home. Enter the address of your tunnel or proxy."}
          </Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable disabled={refreshing} onPress={() => void refresh()} style={styles.action}>
          <RefreshCw size={20} color={colors.ink} />
          <Text style={styles.actionText}>{refreshing ? "Reading the library…" : "Read the library again"}</Text>
        </Pressable>
        <View style={styles.divider} />
        <Pressable
          onPress={() => {
            if (!keptSongs.length) leave();
            else {
              Alert.alert("Sign out?", `Your downloads go too: ${plural(keptSongs.length, "song", "songs")}, ${sizeLine(keptBytes)}.`, [
                { text: "Cancel", style: "cancel" },
                { text: "Sign out", style: "destructive", onPress: leave },
              ]);
            }
          }}
          style={styles.action}
        >
          <LogOut size={20} color="#FF9D9D" />
          <Text style={[styles.actionText, { color: "#FF9D9D" }]}>Sign out</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>PLAYBACK</Text>
      <View style={styles.group}>
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Volume leveling</Text>
          <View style={styles.chips}>
            {LEVELS.map((level) => (
              <Chip key={level.value} label={level.label} active={leveling === level.value} onPress={() => usePlayer.getState().setLeveling(level.value)} />
            ))}
          </View>
          <Text style={styles.rowSub}>{LEVELS.find((level) => level.value === leveling)?.line}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.rowTitle}>24-bit output</Text>
            <Text style={styles.rowSub}>Keeps the full resolution of 24-bit files up to your phone's mixer. Turn it off if those songs play too fast.</Text>
          </View>
          <Switch accessibilityLabel="24-bit output" value={keep24Bit} onValueChange={(on) => usePlayer.getState().setKeep24Bit(on)} trackColor={{ true: colors.accent }} />
        </View>
      </View>

      <Text style={styles.section}>DOWNLOADS</Text>
      <View style={styles.group}>
        {!!(loadingCount || failedCount) && (
          <>
            <View style={styles.row}>
              <Text style={styles.rowTitle}>
                {waitingForWifi ? `${plural(waitingForWifi, "song waits", "songs wait")} for Wi-Fi` : loadingCount ? `Downloading ${plural(loadingCount, "song", "songs")}` : `${plural(failedCount, "song", "songs")} didn't download`}
              </Text>
              {!!failedCount && !!lastProblem && <Text style={[styles.rowSub, { color: "#FF9D9D" }]}>{lastProblem}</Text>}
            </View>
            <View style={styles.divider} />
          </>
        )}
        <View style={styles.row}>
          <Text style={styles.rowTitle}>Quality of new downloads</Text>
          <View style={styles.chips}>
            <Chip label="Original" active={quality === "original"} onPress={() => useDownloads.getState().setQuality("original")} />
            <Chip label="Compact" active={quality === "compact"} onPress={() => useDownloads.getState().setQuality("compact")} />
          </View>
          <Text style={styles.rowSub}>{quality === "original" ? "The files themselves, FLAC stays FLAC" : "MP3 at 192 kbps, about 1.5 MB a minute"}</Text>
        </View>
        <View style={styles.divider} />
        <View style={styles.switchRow}>
          <View style={styles.switchText}>
            <Text style={styles.rowTitle}>Download over mobile data</Text>
          </View>
          <Switch
            accessibilityLabel="Download over mobile data"
            value={overMobile}
            onValueChange={(on) => useDownloads.getState().setOverMobile(on)}
            trackColor={{ true: colors.accent }}
          />
        </View>
        <View style={styles.divider} />
        <Pressable
          disabled={!anyDownloads}
          onPress={() =>
            Alert.alert("Remove all downloads?", `${plural(keptSongs.length, "song", "songs")}, ${sizeLine(keptBytes)} from this phone${onItsWay ? `, and ${plural(onItsWay, "song", "songs")} on the way` : ""}. They stay on your server.`, [
              { text: "Cancel", style: "cancel" },
              { text: "Remove", style: "destructive", onPress: () => useDownloads.getState().removeAll() },
            ])
          }
          style={styles.action}
        >
          <Trash2 size={20} color={anyDownloads ? "#FF9D9D" : colors.dim} />
          <Text style={[styles.actionText, { color: anyDownloads ? "#FF9D9D" : colors.dim }]}>
            {anyDownloads ? `Remove all (${plural(keptSongs.length + onItsWay, "song", "songs")}, ${sizeLine(keptBytes)})` : "Nothing downloaded yet"}
          </Text>
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
        <Pressable onPress={() => setEditingSync(true)} style={styles.action}>
          <Link2 size={20} color={colors.ink} />
          <Text style={styles.actionText}>{customAddress ? "Change the address" : "Enter another address"}</Text>
        </Pressable>
      </View>

      <NameDialog
        visible={editingSync}
        title="Sync service"
        placeholder="Empty: on your Jellyfin server"
        initial={customAddress}
        action="Save"
        allowEmpty
        address
        onCancel={() => setEditingSync(false)}
        onDone={(address) => {
          setCustomAddress(address);
          setEditingSync(false);
        }}
      />
      <NameDialog
        visible={!!editingServer}
        title={editingServer === "away" ? "Address away from home" : "Address at home"}
        placeholder={editingServer === "away" ? "https://music.example.org" : "http://192.168.1.20:8096"}
        initial={(editingServer && session?.[editingServer]) ?? ""}
        action="Save"
        allowEmpty={editingServer === "away"}
        address
        onCancel={() => setEditingServer(null)}
        onDone={(address) => {
          const which = editingServer;
          setEditingServer(null);
          if (!which) return;
          setAddress(which, address).then(
            () => void useConnection.getState().check(),
            (err) => Alert.alert("That address didn't work", err instanceof Error ? err.message : "The server did not answer")
          );
        }}
      />
    </ScrollView>
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
  chips: { flexDirection: "row", gap: 8, marginVertical: 8 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 8 },
  switchText: { flex: 1, minWidth: 0, gap: 3 },
  divider: { height: 1, backgroundColor: colors.hairline, marginLeft: 14 },
  action: { flexDirection: "row", alignItems: "center", gap: 12, height: 52, paddingHorizontal: 14 },
  actionText: { flexShrink: 1, color: colors.ink, fontSize: 15 },
});
