/**
 * A song's row that can be pulled either way. To the left: let go quickly and
 * the song joins the queue; held there it charges up, and at the top it branches
 * off: the song plays next and the rest of its list after it, as on the computer.
 * To the right: the song is muted, or back from that. What lies under the row
 * says what letting go would do; the row kicks and the phone answers at every
 * step, and what's done is thrown a little further before it comes home.
 */
import { ListPlus, Split, Volume2, VolumeX } from "lucide-react-native";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, StyleSheet, ToastAndroid, View } from "react-native";
import Player from "../../modules/media3-player";
import { plural, type Track } from "../shared";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { colors } from "../theme";

/** The list a row belongs to, and its name for the "Playing from". */
export interface RowList {
  tracks: Track[];
  name: string;
}

/** How far a row has to go before letting go does anything. */
const ARM_AT = 76;
/** Held past there this long, it branches off. */
const CHARGE_MS = 520;
/** From here on the row pulls against a spring. */
const GIVES_AT = 170;
/** With the row this far away, what's under it can be read whole. */
const LABEL_FITS_AT = 152;
/** A flick counts without going all the way. */
const FLICK_SPEED = 0.8;
const FLICK_AT = 28;
/** How much further the row is thrown when something is done. */
const THROW = 46;
const HOME = { stiffness: 300, damping: 34, mass: 1, overshootClamping: true, useNativeDriver: true };
const HOME_BOUNCING = { stiffness: 240, damping: 15, mass: 0.9, useNativeDriver: true };

/** `pulled` does nothing yet; `armed` is what letting go would do; `charged` is the held one's end. */
type Stage = "pulled" | "armed" | "charged";

export function SwipeRow({ track, list, children }: { track: Track; list: RowList; children: ReactNode }) {
  const x = useRef(new Animated.Value(0, { useNativeDriver: true })).current;
  const kick = useRef(new Animated.Value(0, { useNativeDriver: true })).current;
  const pop = useRef(new Animated.Value(1, { useNativeDriver: true })).current;
  const charge = useRef(new Animated.Value(0, { useNativeDriver: true })).current;
  const [stage, setStage] = useState<Stage | null>(null);
  const [side, setSide] = useState<"left" | "right">("left");
  const stageNow = useRef<Stage | null>(null);
  const sideNow = useRef<"left" | "right">("left");
  const holding = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** How far the finger had come when the swipe was recognised: the gesture counts from zero after that. */
  const caught = useRef(0);
  const latest = useRef({ track, list });
  latest.current = { track, list };
  const muted = useLibrary((s) => s.muted.has(track.id));

  // Only once there's room for it: half a word looks broken.
  const labelShows = useMemo(
    () => x.interpolate({ inputRange: [-LABEL_FITS_AT, -LABEL_FITS_AT + 12, LABEL_FITS_AT - 12, LABEL_FITS_AT], outputRange: [1, 0, 0, 1], extrapolate: "clamp" }),
    [x]
  );
  const rowX = useMemo(() => Animated.add(x, kick), [x, kick]);
  const chargeX = useMemo(() => charge.interpolate({ inputRange: [0, 1], outputRange: [GIVES_AT + 40, 0] }), [charge]);

  const pan = useMemo(() => {
    const go = (next: Stage | null): void => {
      stageNow.current = next;
      setStage(next);
    };
    /** The row jolts: a detent you can see. */
    const jolt = (by: number): void => {
      Animated.sequence([
        Animated.timing(kick, { toValue: by, duration: 55, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(kick, { toValue: 0, stiffness: 420, damping: 14, mass: 0.7, useNativeDriver: true }),
      ]).start();
    };
    const popIcon = (to: number, rest: number): void => {
      Animated.sequence([
        Animated.timing(pop, { toValue: to, duration: 80, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
        Animated.spring(pop, { toValue: rest, stiffness: 320, damping: 12, mass: 0.7, useNativeDriver: true }),
      ]).start();
    };
    const stopCharging = (): void => {
      if (holding.current) {
        clearTimeout(holding.current);
        holding.current = null;
        void Player.haptic("cancel");
      }
      Animated.timing(charge, { toValue: 0, duration: 120, useNativeDriver: true }).start();
    };
    const songsBehind = (): boolean => {
      const { track: song, list: songs } = latest.current;
      const at = songs.tracks.indexOf(song);
      return at >= 0 && at < songs.tracks.length - 1;
    };
    /** Back in place: thrown on a bit first when something was done. */
    const home = (velocity: number, done: boolean): void => {
      const direction = sideNow.current === "left" ? -1 : 1;
      x.stopAnimation((value) => {
        const finish = (): void => {
          charge.setValue(0);
          pop.setValue(1);
          go(null);
        };
        if (!done) {
          Animated.spring(x, { ...HOME, toValue: 0, velocity }).start(({ finished }) => finished && finish());
          return;
        }
        const thrown = direction * Math.max(Math.abs(value), ARM_AT) + direction * THROW;
        Animated.sequence([
          Animated.timing(x, { toValue: thrown, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.delay(40),
          Animated.spring(x, { ...HOME_BOUNCING, toValue: 0 }),
        ]).start(({ finished }) => finished && finish());
      });
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => {
        caught.current = g.dx;
        return Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        x.stopAnimation();
        sideNow.current = caught.current < 0 ? "left" : "right";
        setSide(sideNow.current);
        pop.setValue(1);
        charge.setValue(0);
        go("pulled");
      },
      onPanResponderMove: (_, g) => {
        const pulled = caught.current + g.dx;
        // Changed its mind across the middle: the other side's business from here on.
        const nowSide = pulled < 0 ? "left" : "right";
        if (nowSide !== sideNow.current) {
          sideNow.current = nowSide;
          setSide(nowSide);
          stopCharging();
          if (stageNow.current !== "pulled") go("pulled");
        }
        const far = Math.abs(pulled);
        const shown = far <= GIVES_AT ? far : GIVES_AT + (far - GIVES_AT) * 0.3;
        x.setValue(nowSide === "left" ? -shown : shown);
        if (far < ARM_AT) {
          // Brought back: nothing happens after all.
          stopCharging();
          if (stageNow.current !== "pulled") go("pulled");
          return;
        }
        if (stageNow.current === "pulled") {
          go("armed");
          void Player.haptic("arm");
          jolt(nowSide === "left" ? -12 : 12);
          popIcon(1.45, 1);
        }
        if (nowSide === "left" && stageNow.current === "armed" && !holding.current && songsBehind()) {
          void Player.haptic("charge");
          Animated.timing(charge, { toValue: 1, duration: CHARGE_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
          holding.current = setTimeout(() => {
            holding.current = null;
            go("charged");
            void Player.haptic("charged");
            jolt(-26);
            popIcon(1.9, 1.25);
          }, CHARGE_MS);
        }
      },
      onPanResponderRelease: (_, g) => {
        const stageThen = stageNow.current;
        const sideThen = sideNow.current;
        const pulled = caught.current + g.dx;
        const flick = Math.abs(pulled) > FLICK_AT && Math.abs(g.vx) > FLICK_SPEED && Math.sign(g.vx) === Math.sign(pulled);
        const done = stageThen === "armed" || stageThen === "charged" || flick;
        stopCharging();
        if (done) void Player.haptic("commit");
        home(g.vx * 1000, done);
        if (!done) return;
        const { track: song, list: songs } = latest.current;
        if (sideThen === "right") {
          const nowMuted = useLibrary.getState().toggleMuted(song);
          ToastAndroid.show(nowMuted ? `Muted: “${song.title}” is skipped from now on` : `“${song.title}” plays again`, ToastAndroid.SHORT);
        } else if (stageThen === "charged") {
          const count = usePlayer.getState().branchOff(songs.tracks, Math.max(0, songs.tracks.indexOf(song)), songs.name);
          ToastAndroid.show(`Branching off into “${songs.name}”: ${plural(count, "song", "songs")}`, ToastAndroid.SHORT);
        } else {
          usePlayer.getState().addToQueue([song]);
          ToastAndroid.show("Added to the queue", ToastAndroid.SHORT);
        }
      },
      onPanResponderTerminate: () => {
        stopCharging();
        home(0, false);
      },
    });
  }, [charge, kick, pop, x]);

  const left = side === "left";
  const under = left ? (stage === "armed" || stage === "charged" ? styles.underQueue : styles.underPulled) : stage === "armed" ? styles.underMute : styles.underMutePulled;
  const label = left ? (stage === "charged" ? "Branch off" : "Add to queue") : muted ? "Play again" : "Mute song";
  const dark = left && stage !== "pulled";
  const inkColor = dark ? colors.onAccent : colors.ink;
  const Icon = left ? (stage === "charged" ? Split : ListPlus) : muted ? Volume2 : VolumeX;

  return (
    <View>
      {!!stage && (
        <View style={[StyleSheet.absoluteFill, styles.under, left ? styles.underEnd : styles.underStart, under]}>
          {left && <Animated.View style={[styles.charge, { transform: [{ translateX: chargeX }] }]} />}
          {left && (
            <Animated.Text numberOfLines={1} style={[styles.label, { color: inkColor, opacity: labelShows }]}>
              {label}
            </Animated.Text>
          )}
          <Animated.View style={{ transform: [{ scale: pop }] }}>
            <Icon size={24} color={inkColor} strokeWidth={stage === "charged" ? 2.8 : 2.2} />
          </Animated.View>
          {!left && (
            <Animated.Text numberOfLines={1} style={[styles.label, { color: inkColor, opacity: labelShows }]}>
              {label}
            </Animated.Text>
          )}
        </View>
      )}
      <Animated.View {...pan.panHandlers} style={[styles.row, { transform: [{ translateX: rowX }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  under: { flexDirection: "row", alignItems: "center", gap: 10, overflow: "hidden" },
  underEnd: { justifyContent: "flex-end", paddingRight: 22 },
  underStart: { justifyContent: "flex-start", paddingLeft: 22 },
  underPulled: { backgroundColor: colors.button },
  underQueue: { backgroundColor: colors.accent },
  underMutePulled: { backgroundColor: "#5A2B2B" },
  underMute: { backgroundColor: "#C24F4C" },
  charge: { position: "absolute", top: 0, bottom: 0, right: 0, width: GIVES_AT + 40, backgroundColor: colors.ink },
  label: { fontSize: 13.5, fontWeight: "700" },
  row: { backgroundColor: colors.base },
});
