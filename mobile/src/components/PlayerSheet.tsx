/**
 * The player: one surface over the tabs. Collapsed it is the mini player above
 * the tab bar, opened it fills the screen. One number runs the whole way
 * between the two, `progress` from 0 to 1, and everything hangs on it on the
 * native side, so the motion stays smooth whatever JavaScript is doing: the
 * surface rises, the little cover grows into the big one, the mini row fades
 * out and the page fades in. A finger moves the same number.
 */
import { useNavigation } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { Check, Pause, Play } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, BackHandler, Modal, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import { tinted } from "../color";
import type { QualityMode } from "../quality";
import { leadArtist, type Track } from "../shared";
import { useCoverColor } from "../stores/library";
import { usePlayer } from "../stores/player";
import { usePlaylists } from "../stores/playlists";
import { colors, MINI_PLAYER_HEIGHT, TAB_BAR_HEIGHT } from "../theme";
import { PlayerPage } from "./PlayerPage";
import { TrackStrip, useTrackSwipe } from "./TrackStrip";
import { Cover } from "./ui";

const SPRING = { stiffness: 260, damping: 32, mass: 1, overshootClamping: true, useNativeDriver: true };

const MINI_MARGIN = 8;
const MINI_COVER = 40;
const MINI_ROW = 56;
const MINI_BUTTON_ROOM = 48;
/** How much of the cards shows under the player's page. */
const PEEK = 32;
const COVER_SIDE = 23;
const COVER_RADIUS = 8;

const MINI_RADIUS = 4;

const QUALITIES: { mode: QualityMode; title: string; line: string }[] = [
  { mode: "auto", title: "Automatic", line: "The best your connection carries right now" },
  { mode: "original", title: "Original", line: "Always the file itself, nothing converted" },
  { mode: "compact", title: "Compact", line: "A small copy (128 kbps) that saves data" },
];

/** Past the end of the page the finger pulls against a spring. */
const pageAt = (y: number, max: number): number => (y >= 0 ? 0 : y < -max ? -max + (y + max) * 0.3 : y);

function MiniProgress() {
  const part = usePlayer((s) => (s.durationMs > 0 ? Math.min(1, s.positionMs / s.durationMs) : 0));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${part * 100}%` }]} />
    </View>
  );
}

function MiniPlayer({ width, onOpen }: { width: number; onOpen: () => void }) {
  const track = usePlayer((s) => s.queue[s.index]);
  const playWhenReady = usePlayer((s) => s.playWhenReady);
  const toggle = usePlayer((s) => s.toggle);
  const color = useCoverColor(track?.thumb);
  const stripWidth = width - MINI_MARGIN * 2 - MINI_BUTTON_ROOM;
  const swipe = useTrackSwipe(stripWidth);
  return (
    <View style={[styles.mini, { backgroundColor: tinted(color, 0.2) }]}>
      <View style={styles.miniRow}>
        <View {...swipe.panHandlers} style={styles.miniStrip}>
          <TrackStrip width={stripWidth}>
            {(t) => (
              <Pressable onPress={onOpen} style={styles.miniOpen} accessibilityLabel="Open the player">
                <Cover uri={t.thumb} size={MINI_COVER} radius={MINI_RADIUS} />
                <View style={styles.miniText}>
                  <Text numberOfLines={1} style={styles.miniTitle}>
                    {t.title}
                  </Text>
                  <Text numberOfLines={1} style={styles.miniArtist}>
                    {t.artist}
                  </Text>
                </View>
              </Pressable>
            )}
          </TrackStrip>
        </View>
        <Pressable onPress={toggle} style={styles.miniButton} accessibilityLabel={playWhenReady ? "Pause" : "Play"}>
          {playWhenReady ? <Pause size={24} color={colors.ink} fill={colors.ink} /> : <Play size={24} color={colors.ink} fill={colors.ink} />}
        </Pressable>
      </View>
      <MiniProgress />
    </View>
  );
}

export function PlayerSheet({
  progress,
  expanded,
  setExpanded,
  goTo,
}: {
  progress: Animated.Value;
  expanded: boolean;
  setExpanded: (open: boolean) => void;
  /** a page in the tab showing under the sheet */
  goTo: (screen: string, params: object) => void;
}) {
  const nav = useNavigation<any>();
  const { width, height } = useSafeAreaFrame();
  const insets = useSafeAreaInsets();
  const track = usePlayer((s) => s.queue[s.index]);
  const hasTrack = !!track;
  const color = useCoverColor(track?.thumb);
  const pageY = useRef(new Animated.Value(0, { useNativeDriver: true })).current;
  const [coverArea, setCoverArea] = useState({ y: insets.top + 46, height: width });
  const [menu, setMenu] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const quality = usePlayer((s) => s.quality);
  const setQuality = usePlayer((s) => s.setQuality);

  const collapsedY = height - TAB_BAR_HEIGHT - insets.bottom - MINI_PLAYER_HEIGHT;
  const geometry = useRef({ collapsedY, pageMax: 0 });
  geometry.current.collapsedY = collapsedY;
  const isOpen = useRef(false);
  /** where the page came to rest: at the top, or down at the cards */
  const pageRest = useRef(0);
  const from = useRef({ sheet: 0, page: 0 });
  /** How far the finger had come when the drag was recognised: the gesture counts from zero after that. */
  const caught = useRef(0);

  const settlePage = useCallback(
    (to: number, velocity = 0) => {
      pageRest.current = to;
      Animated.spring(pageY, { ...SPRING, toValue: to, velocity }).start();
    },
    [pageY]
  );

  const settle = useCallback(
    (open: boolean, velocity = 0) => {
      isOpen.current = open;
      setExpanded(open);
      Animated.spring(progress, { ...SPRING, toValue: open ? 1 : 0, velocity }).start();
      if (!open && pageRest.current !== 0) settlePage(0);
    },
    [progress, setExpanded, settlePage]
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_, g) => {
          caught.current = g.dy;
          if (Math.abs(g.dy) <= 10 || Math.abs(g.dy) <= Math.abs(g.dx) * 1.5) return false;
          return isOpen.current || g.dy < 0;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          from.current = { sheet: isOpen.current ? 1 : 0, page: pageRest.current };
          // Caught on its way: from wherever it is now.
          progress.stopAnimation((value) => (from.current.sheet = value));
          pageY.stopAnimation((value) => (from.current.page = value));
        },
        onPanResponderMove: (_, g) => {
          const { collapsedY: travel, pageMax } = geometry.current;
          const dy = caught.current + g.dy;
          if (from.current.page < -0.5) {
            // Down at the cards this drag only scrolls, back to the top at most.
            pageY.setValue(pageAt(from.current.page + dy, pageMax));
            return;
          }
          const sheet = from.current.sheet - dy / travel;
          progress.setValue(Math.max(0, Math.min(1, sheet)));
          // Pushed up past fully open: the page itself goes on.
          pageY.setValue(pageAt((1 - sheet) * travel, pageMax));
        },
        onPanResponderRelease: (_, g) => {
          const { collapsedY: travel, pageMax } = geometry.current;
          const dy = caught.current + g.dy;
          const sheet = from.current.sheet - dy / travel;
          if (from.current.page < -0.5 || sheet > 1) {
            const y = from.current.page < -0.5 ? from.current.page + dy : (1 - sheet) * travel;
            settlePage(y + g.vy * 200 < -pageMax / 2 ? -pageMax : 0, g.vy * 1000);
            return;
          }
          // Where the finger was headed a moment on: a flick counts like a long drag.
          const ahead = sheet - (g.vy * 200) / travel;
          settle(ahead > (isOpen.current ? 0.8 : 0.2), (-g.vy * 1000) / travel);
        },
        onPanResponderTerminate: () => settle(isOpen.current),
      }),
    [pageY, progress, settle, settlePage]
  );

  const swipe = useTrackSwipe(width);

  // The system's back closes the player; a sheet opened over it goes first.
  useEffect(() => {
    if (!expanded) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (nav.getState()?.routes.length > 1) return false;
      settle(false);
      return true;
    });
    return () => sub.remove();
  }, [expanded, nav, settle]);

  // Nothing left to show: the queue was emptied.
  useEffect(() => {
    if (!hasTrack && isOpen.current) settle(false);
  }, [hasTrack, settle]);

  const coverSize = Math.max(120, Math.min(width - COVER_SIDE * 2, coverArea.height));
  const coverTop = coverArea.y + (coverArea.height - coverSize) / 2;

  const motion = useMemo(() => {
    const smallest = MINI_COVER / coverSize;
    const middle = (smallest + 1) / 2;
    const clamp = "clamp" as const;
    return {
      y: progress.interpolate({ inputRange: [0, 1], outputRange: [collapsedY, 0] }),
      miniOpacity: progress.interpolate({ inputRange: [0, 0.14], outputRange: [1, 0], extrapolate: clamp }),
      backOpacity: progress.interpolate({ inputRange: [0, 0.06], outputRange: [0, 1], extrapolate: clamp }),
      // As wide as the mini player when it starts, and with its corners.
      backScale: progress.interpolate({ inputRange: [0, 0.2], outputRange: [(width - MINI_MARGIN * 2) / width, 1], extrapolate: clamp }),
      backRadius: progress.interpolate({ inputRange: [0, 0.2, 1], outputRange: [8, 14, 0] }),
      pageOpacity: progress.interpolate({ inputRange: [0.4, 0.9], outputRange: [0, 1], extrapolate: clamp }),
      coverX: progress.interpolate({ inputRange: [0, 1], outputRange: [MINI_MARGIN * 2 + MINI_COVER / 2 - width / 2, 0] }),
      coverY: progress.interpolate({ inputRange: [0, 1], outputRange: [(MINI_ROW - MINI_COVER) / 2 + MINI_COVER / 2 - coverTop - coverSize / 2, 0] }),
      coverScale: progress.interpolate({ inputRange: [0, 1], outputRange: [smallest, 1] }),
      // The radius scales with the picture: bigger while it is small, to look the same.
      coverRadius: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [MINI_RADIUS / smallest, COVER_RADIUS / middle, COVER_RADIUS] }),
    };
  }, [progress, collapsedY, width, coverSize, coverTop]);

  const renderCover = useCallback(
    (t: Track) => (
      <View style={styles.coverPage}>
        <Animated.View style={{ width: coverSize, height: coverSize, overflow: "hidden", borderRadius: motion.coverRadius }}>
          <Cover uri={t.thumb} size={coverSize} radius={0} />
        </Animated.View>
      </View>
    ),
    [coverSize, motion.coverRadius]
  );

  const open = useCallback(() => settle(true), [settle]);
  const close = useCallback(() => settle(false), [settle]);
  const openPage = useCallback(
    (screen: string, params: object) => {
      setMenu(false);
      settle(false);
      goTo(screen, params);
    },
    [goTo, settle]
  );

  if (!track) return null;
  const albumKey = track.albumId ? decodeURIComponent(track.albumId.replace("lib:album:", "")) : null;

  return (
    <>
      <Animated.View
        {...pan.panHandlers}
        pointerEvents={expanded ? "auto" : "box-none"}
        style={[StyleSheet.absoluteFill, { transform: [{ translateY: motion.y }] }]}
      >
        <Animated.View
          pointerEvents="none"
          style={[styles.back, { opacity: motion.backOpacity, borderRadius: motion.backRadius, transform: [{ scaleX: motion.backScale }] }]}
        >
          <LinearGradient colors={[tinted(color, 0.24), tinted(color, 0.16), "#121212"]} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
        </Animated.View>

        <Animated.View
          pointerEvents={expanded ? "auto" : "none"}
          importantForAccessibility={expanded ? "auto" : "no-hide-descendants"}
          accessibilityElementsHidden={!expanded}
          style={[styles.page, { opacity: motion.pageOpacity, transform: [{ translateY: pageY }] }]}
        >
          <PlayerPage
            height={height - PEEK}
            expanded={expanded}
            swipe={swipe.panHandlers}
            onClose={close}
            onMenu={() => setMenu(true)}
            onQuality={() => setQualityOpen(true)}
            onArtist={(t) => openPage("Artist", { name: leadArtist(t.artist) })}
            onCoverArea={(y, h) => setCoverArea((a) => (a.y === y && a.height === h ? a : { y, height: h }))}
            onCardsHeight={(h) => {
              geometry.current.pageMax = Math.max(0, h - PEEK);
              if (pageRest.current < -geometry.current.pageMax) settlePage(-geometry.current.pageMax);
            }}
          />
        </Animated.View>

        <Animated.View
          {...swipe.panHandlers}
          pointerEvents={expanded ? "auto" : "none"}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          style={[
            styles.flight,
            {
              top: coverTop,
              height: coverSize,
              transform: [{ translateX: motion.coverX }, { translateY: motion.coverY }, { translateY: pageY }, { scale: motion.coverScale }],
            },
          ]}
        >
          <TrackStrip width={width}>{renderCover}</TrackStrip>
        </Animated.View>

        <Animated.View
          pointerEvents={expanded ? "none" : "box-none"}
          importantForAccessibility={expanded ? "no-hide-descendants" : "auto"}
          accessibilityElementsHidden={expanded}
          style={[styles.miniLayer, { opacity: motion.miniOpacity }]}
        >
          <MiniPlayer width={width} onOpen={open} />
        </Animated.View>
      </Animated.View>

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={styles.menuBack} onPress={() => setMenu(false)}>
          <View style={[styles.menu, { paddingBottom: insets.bottom + 10 }]}>
            <Pressable
              style={styles.menuRow}
              onPress={() => {
                setMenu(false);
                usePlaylists.getState().setPicking(track);
              }}
            >
              <Text style={styles.menuText}>Add to playlist</Text>
            </Pressable>
            <Pressable
              style={styles.menuRow}
              onPress={() => {
                setMenu(false);
                setQualityOpen(true);
              }}
            >
              <Text style={styles.menuText}>Quality: {QUALITIES.find((q) => q.mode === quality)?.title}</Text>
            </Pressable>
            {!!track.album && !!albumKey && (
              <Pressable style={styles.menuRow} onPress={() => openPage("Album", { albumKey })}>
                <Text style={styles.menuText}>Go to album</Text>
              </Pressable>
            )}
            <Pressable style={styles.menuRow} onPress={() => openPage("Artist", { name: leadArtist(track.artist) })}>
              <Text style={styles.menuText}>Go to artist</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={qualityOpen} transparent animationType="fade" onRequestClose={() => setQualityOpen(false)}>
        <Pressable style={styles.menuBack} onPress={() => setQualityOpen(false)}>
          <View style={[styles.menu, { paddingBottom: insets.bottom + 10 }]}>
            <Text style={styles.menuHeading}>Quality</Text>
            {QUALITIES.map((q) => (
              <Pressable
                key={q.mode}
                accessibilityState={{ selected: quality === q.mode }}
                style={styles.qualityRow}
                onPress={() => {
                  setQuality(q.mode);
                  setQualityOpen(false);
                }}
              >
                <View style={styles.qualityText}>
                  <Text style={[styles.menuText, quality === q.mode && { color: colors.accent }]}>{q.title}</Text>
                  <Text style={styles.qualityLine}>{q.line}</Text>
                </View>
                {quality === q.mode && <Check size={20} color={colors.accent} />}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  back: { ...StyleSheet.absoluteFill, overflow: "hidden", backgroundColor: "#121212" },
  page: { position: "absolute", left: 0, right: 0, top: 0 },
  flight: { position: "absolute", left: 0, right: 0, overflow: "hidden" },
  coverPage: { flex: 1, alignItems: "center" },
  miniLayer: { position: "absolute", left: 0, right: 0, top: 0 },
  mini: { marginHorizontal: MINI_MARGIN, borderRadius: 8, overflow: "hidden" },
  miniRow: { flexDirection: "row", alignItems: "center", height: MINI_ROW, paddingRight: 4 },
  miniStrip: { flex: 1, minWidth: 0, height: MINI_ROW, overflow: "hidden" },
  miniOpen: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 8 },
  miniText: { flex: 1, minWidth: 0, paddingRight: 8 },
  miniTitle: { color: colors.ink, fontSize: 13.5, fontWeight: "600" },
  miniArtist: { color: "rgba(255,255,255,0.78)", fontSize: 12.5, marginTop: 2 },
  miniButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  progressTrack: { height: 2, marginHorizontal: 8, backgroundColor: "rgba(255,255,255,0.25)" },
  progressFill: { height: 2, backgroundColor: colors.ink },
  menuBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  menu: { backgroundColor: colors.sheet, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 10 },
  menuRow: { height: 52, justifyContent: "center", paddingHorizontal: 20 },
  menuText: { color: colors.ink, fontSize: 16 },
  menuHeading: { color: colors.ink, fontSize: 18, fontWeight: "700", paddingHorizontal: 20, paddingTop: 6, paddingBottom: 8 },
  qualityRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 62, paddingHorizontal: 20 },
  qualityText: { flex: 1, minWidth: 0 },
  qualityLine: { color: colors.dim, fontSize: 13, marginTop: 2 },
});
