/**
 * The queue, as on Spotify: a sheet over the dimmed player with the playing
 * song on top, what comes next with its handles, Clear and Edit up top, and
 * Shuffle, Repeat and the sleep Timer as three big buttons below. Its grip and
 * its head drag it: all the way up, or down and away.
 */
import { useNavigation } from "@react-navigation/native";
import { CircleMinus, Menu, Pause, Play, Repeat, Repeat1, Shuffle, Timer } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { Animated, FlatList, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import { Cover, EqBars } from "../components/ui";
import type { Track } from "../shared";
import { usePlayer } from "../stores/player";
import { colors } from "../theme";

const ROW_HEIGHT = 61;
/** At rest the sheet covers this much of the screen. */
const AT_REST = 0.66;
const SHEET_GAP_ON_TOP = 8;
const BUTTON_HEIGHT = 58;
const BUTTONS_ABOVE = 8;
const BUTTONS_BELOW = 12;
/** A moment on from where the finger left it: a flick counts like a long drag. */
const FLICK_MS = 200;
const SPRING = { stiffness: 300, damping: 34, mass: 1, overshootClamping: true, useNativeDriver: true };

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

  // The sheet is always its full height and slides: 0 is all the way up.
  const { height } = useSafeAreaFrame();
  const sheetTop = insets.top + SHEET_GAP_ON_TOP;
  const away = height - sheetTop;
  const rest = away - height * AT_REST;
  const y = useRef(new Animated.Value(rest, { useNativeDriver: true })).current;
  const place = useRef(rest);
  const dragFrom = useRef(rest);
  const [big, setBig] = useState(false);

  const moveTo = useCallback(
    (to: number, velocity = 0) => {
      place.current = to;
      setBig(to === 0);
      Animated.spring(y, { ...SPRING, toValue: to, velocity }).start(({ finished }) => {
        if (finished && to === away) nav.goBack();
      });
    },
    [away, nav, y]
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          dragFrom.current = place.current;
          y.stopAnimation((value) => (dragFrom.current = value));
        },
        onPanResponderMove: (_, g) => y.setValue(Math.max(0, dragFrom.current + g.dy)),
        onPanResponderRelease: (_, g) => {
          const ahead = dragFrom.current + g.dy + g.vy * FLICK_MS;
          moveTo([0, rest, away].reduce((best, p) => (Math.abs(p - ahead) < Math.abs(best - ahead) ? p : best)), g.vy * 1000);
        },
        onPanResponderTerminate: () => moveTo(place.current),
      }),
    [away, moveTo, rest, y]
  );

  const dimming = useMemo(() => y.interpolate({ inputRange: [rest, away], outputRange: [1, 0], extrapolate: "clamp" }), [away, rest, y]);
  // The buttons stay at the bottom of the screen until the sheet goes below its resting place.
  const buttonsY = useMemo(() => y.interpolate({ inputRange: [0, rest, away], outputRange: [0, -rest, -rest] }), [away, rest, y]);
  const buttonsHeight = BUTTON_HEIGHT + BUTTONS_ABOVE + BUTTONS_BELOW + insets.bottom;

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.dim, { opacity: dimming }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => moveTo(away)} accessibilityLabel="Close the queue" />
      </Animated.View>
      <Animated.View style={[styles.sheet, { top: sheetTop, transform: [{ translateY: y }] }]}>
        <View {...pan.panHandlers}>
          <Pressable onPress={() => moveTo(big ? rest : 0)} accessibilityLabel={big ? "Make the queue smaller" : "Make the queue bigger"} style={styles.gripArea}>
            <View style={styles.grip} />
          </Pressable>
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
        </View>

        <FlatList
          data={upcoming}
          scrollEnabled={!dragging}
          // What the sheet's lower part hides at rest can still be scrolled up into view.
          contentContainerStyle={{ paddingBottom: buttonsHeight + (big ? 0 : rest) }}
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

        <Animated.View style={[styles.buttons, { paddingBottom: insets.bottom + BUTTONS_BELOW, transform: [{ translateY: buttonsY }] }]}>
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
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.68)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.sheet, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  gripArea: { height: 26, alignItems: "center", justifyContent: "center" },
  grip: { width: 34, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.3)" },
  head: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingHorizontal: 15, paddingTop: 2, paddingBottom: 8 },
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
  buttons: { position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", gap: 11, paddingHorizontal: 15, paddingTop: BUTTONS_ABOVE, backgroundColor: colors.sheet },
  bigButton: { flex: 1, height: BUTTON_HEIGHT, gap: 5, borderRadius: 10, backgroundColor: colors.button, alignItems: "center", justifyContent: "center" },
  bigLabel: { color: colors.ink, fontSize: 12.5 },
});
