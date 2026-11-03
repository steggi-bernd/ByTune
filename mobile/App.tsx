import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { AddToPlaylistSheet } from "./src/components/PlaylistSheets";
import { AppNavigation } from "./src/navigation";
import { ConnectScreen } from "./src/screens/ConnectScreen";
import { useLibrary } from "./src/stores/library";
import { usePlayer, watchPlayer } from "./src/stores/player";
import { useSession } from "./src/stores/session";
import { startSync, stopSync } from "./src/sync";
import { colors } from "./src/theme";

watchPlayer();

/** Keeps the clock and icons readable while a page scrolls under them. */
function StatusScrim() {
  const insets = useSafeAreaInsets();
  return (
    <LinearGradient
      pointerEvents="none"
      colors={["rgba(0,0,0,0.72)", "rgba(0,0,0,0)"]}
      style={[styles.scrim, { height: insets.top + 14 }]}
    />
  );
}

export default function App() {
  const ready = useSession((s) => s.ready);
  const session = useSession((s) => s.session);
  const loaded = useLibrary((s) => s.loaded);
  const queueRestored = useRef(false);

  useEffect(() => {
    void useSession.getState().restore();
  }, []);

  useEffect(() => {
    if (session) void useLibrary.getState().restore();
    queueRestored.current = false;
  }, [session]);

  // Where playback stopped comes back once the library can say what the songs are.
  useEffect(() => {
    if (!session || !loaded || queueRestored.current) return;
    queueRestored.current = true;
    // The sync comes after: it decides from what the phone remembers whether another device is newer.
    void usePlayer.getState().restore().then(startSync);
  }, [session, loaded]);

  useEffect(() => {
    if (!session) stopSync();
  }, [session]);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={styles.root}>
        {ready && (session ? <AppNavigation /> : <ConnectScreen />)}
        <AddToPlaylistSheet />
        <StatusScrim />
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.base },
  scrim: { position: "absolute", left: 0, right: 0, top: 0 },
});
