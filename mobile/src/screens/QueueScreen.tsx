/**
 * The queue, as on Spotify: a sheet over the dimmed player with the playing
 * song on top, what comes next with its handles, Clear and Edit up top, and
 * Shuffle, Repeat and the sleep Timer as three big buttons below.
 */
import { useNavigation } from "@react-navigation/native";
import { CircleMinus, Menu, Pause, Play, Repeat, Repeat1, Shuffle, Timer } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, FlatList, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Cover, EqBars } from "../components/ui";
import type { Track } from "../shared";
import { usePlayer } from "../stores/player";
import { colors } from "../theme";

const ROW_HEIGHT = 61;

/** One song that comes next. Its handle drags it: every row's height away is one place in the list. */
function UpcomingRow({
  track,
  index,
  editing,
  onDragChange,
}: {
  track: Track;
  index: number;
  editing: boolean;
  onDragChange: (dragging: boolean) => void;
}) {
  const { skipTo, removeAt, moveItem } = usePlayer.getState();
  const y = useRef(new Animated.Value(0)).current;
  const [held, setHeld] = useState(false);
  const place = useRef(index);
  place.current = index;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          setHeld(true);
          onDragChange(true);
        },
        onPanResponderMove: (_, g) => y.setValue(g.dy),
        onPanResponderRelease: (_, g) => {
          y.setValue(0);
          setHeld(false);
          onDragChange(false);
          const state = usePlayer.getState();
          const target = Math.max(state.index + 1, Math.min(state.queue.length - 1, place.current + Math.round(g.dy / ROW_HEIGHT)));
          moveItem(place.current, target);
        },
        onPanResponderTerminate: () => {
          y.setValue(0);
          setHeld(false);
          onDragChange(false);
        },
      }),
    [y, moveItem, onDragChange]
  );

  return (
    <Animated.View style={[styles.row, held && styles.rowHeld, { transform: [{ translateY: y }] }]}>
      {editing && (
        <Pressable onPress={() => removeAt(index)} accessibilityLabel={`Remove ${track.title}`} style={styles.remove}>
          <CircleMinus size={22} color={colors.soft} />
        </Pressable>
      )}
      <Pressable onPress={() => skipTo(index)} style={styles.rowMain}>
        <Cover uri={track.thumb} size={46} />
        <View style={styles.rowText}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {track.title}
          </Text>
          <Text numberOfLines={1} style={styles.rowArtist}>
            {track.artist}
          </Text>
        </View>
      </Pressable>
      <View {...pan.panHandlers} accessibilityLabel={`Move ${track.title}`} style={styles.handle}>
        <Menu size={20} color={colors.ink} />
      </View>
    </Animated.View>
  );
}

export function QueueScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const context = usePlayer((s) => s.context);
  const playWhenReady = usePlayer((s) => s.playWhenReady);
  const shuffle = usePlayer((s) => s.shuffle);
  const repeat = usePlayer((s) => s.repeat);
  const sleepAt = usePlayer((s) => s.sleepAt);
  const { toggle, toggleShuffle, cycleRepeat, clearUpcoming, cycleSleepTimer } = usePlayer.getState();
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const current = queue[index];
  const onDragChange = useCallback((d: boolean) => setDragging(d), []);
  const upcoming = useMemo(() => queue.slice(index + 1).map((track, i) => ({ track, at: index + 1 + i })), [queue, index]);
  const minutesLeft = sleepAt ? Math.max(1, Math.round((sleepAt - Date.now()) / 60000)) : 0;

  return (
    <View style={styles.root}>
      <Pressable style={styles.dim} onPress={() => nav.goBack()} accessibilityLabel="Close the queue" />
      <View style={styles.sheet}>
        <View style={styles.grip} />
        <View style={styles.head}>
          <View style={styles.headText}>
            <Text style={styles.heading}>Queue</Text>
            <Text numberOfLines={1} style={styles.from}>
              Playing from '{context}'
            </Text>
          </View>
          <Pressable onPress={clearUpcoming} style={styles.pill}>
            <Text style={styles.pillText}>Clear</Text>
          </Pressable>
          <Pressable onPress={() => setEditing((e) => !e)} style={styles.pill}>
            <Text style={styles.pillText}>{editing ? "Done" : "Edit"}</Text>
          </Pressable>
        </View>

        <FlatList
          data={upcoming}
          scrollEnabled={!dragging}
          keyExtractor={(u, i) => `${u.track.id}-${i}`}
          getItemLayout={(_, i) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * i, index: i })}
          ListHeaderComponent={
            current ? (
              <View style={styles.row}>
                <View style={styles.rowMain}>
                  <Cover uri={current.thumb} size={46} />
                  <View style={styles.rowText}>
                    <View style={styles.currentLine}>
                      <EqBars />
                      <Text numberOfLines={1} style={[styles.rowTitle, styles.currentTitle]}>
                        {current.title}
                      </Text>
                    </View>
                    <Text numberOfLines={1} style={styles.rowArtist}>
                      {current.artist}
                    </Text>
                  </View>
                </View>
                <Pressable onPress={toggle} accessibilityLabel={playWhenReady ? "Pause" : "Play"} style={styles.currentButton}>
                  {playWhenReady ? <Pause size={15} color="#121212" fill="#121212" /> : <Play size={15} color="#121212" fill="#121212" />}
                </Pressable>
              </View>
            ) : undefined
          }
          renderItem={({ item }) => <UpcomingRow track={item.track} index={item.at} editing={editing} onDragChange={onDragChange} />}
        />

        <View style={[styles.buttons, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable onPress={toggleShuffle} style={styles.bigButton}>
            <Shuffle size={22} color={shuffle ? colors.accent : colors.ink} />
            <Text style={[styles.bigLabel, shuffle && { color: colors.accent }]}>Shuffle</Text>
          </Pressable>
          <Pressable onPress={cycleRepeat} style={styles.bigButton}>
            {repeat === "one" ? <Repeat1 size={22} color={colors.accent} /> : <Repeat size={22} color={repeat === "all" ? colors.accent : colors.ink} />}
            <Text style={[styles.bigLabel, repeat !== "off" && { color: colors.accent }]}>Repeat</Text>
          </Pressable>
          <Pressable onPress={() => cycleSleepTimer()} style={styles.bigButton}>
            <Timer size={22} color={sleepAt ? colors.accent : colors.ink} />
            <Text style={[styles.bigLabel, !!sleepAt && { color: colors.accent }]}>{sleepAt ? `${minutesLeft} min` : "Timer"}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.68)" },
  sheet: { height: "66%", backgroundColor: colors.sheet, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  grip: { alignSelf: "center", width: 34, height: 4, borderRadius: 2, marginTop: 9, backgroundColor: "rgba(255,255,255,0.3)" },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 15, paddingTop: 12, paddingBottom: 8 },
  headText: { flex: 1, minWidth: 0 },
  heading: { color: colors.ink, fontSize: 20, fontWeight: "700", letterSpacing: -0.3 },
  from: { color: "#B3B3B8", fontSize: 13, marginTop: 4 },
  pill: { height: 34, paddingHorizontal: 14, borderRadius: 17, backgroundColor: colors.button, justifyContent: "center" },
  pillText: { color: colors.ink, fontSize: 13.5, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", height: ROW_HEIGHT, paddingLeft: 15, paddingRight: 6 },
  rowHeld: { backgroundColor: colors.button, zIndex: 10, elevation: 8 },
  remove: { width: 34, height: 44, alignItems: "flex-start", justifyContent: "center" },
  rowMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12, height: "100%" },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.ink, fontSize: 15.5 },
  rowArtist: { color: "#B3B3B8", fontSize: 13.5, marginTop: 3 },
  currentLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  currentTitle: { flexShrink: 1, color: colors.accent },
  currentButton: { width: 32, height: 32, marginRight: 8, borderRadius: 16, backgroundColor: colors.ink, alignItems: "center", justifyContent: "center" },
  handle: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  buttons: { flexDirection: "row", gap: 11, paddingHorizontal: 15, paddingTop: 8, backgroundColor: colors.sheet },
  bigButton: { flex: 1, height: 58, gap: 5, borderRadius: 10, backgroundColor: colors.button, alignItems: "center", justifyContent: "center" },
  bigLabel: { color: colors.ink, fontSize: 12.5 },
});
