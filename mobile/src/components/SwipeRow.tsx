/**
 * A song's row that can be pulled either way. To the right: let go quickly and
 * the song joins the queue, right behind the playing one and the ones pulled before
 * it; held there it charges up, and at the top it branches off: the song next and the
 * rest of its list after it, as on the computer. Pulling the song a branch starts
 * from takes it back; holding another song of that list starts the branch there
 * instead. To the left: the song is muted, or back from that. What lies under the row
 * says what letting go would do; the row kicks and the phone answers at every step,
 * and let go it snaps home like a taut rubber band.
 */
import { ListStart, Split, Undo2, Volume2, VolumeX, type LucideIcon } from "lucide-react-native";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, LayoutAnimation, PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { plural, type Track } from "../shared";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { toast } from "../stores/popups";
import { feel, useSettings, type SwipeFeel } from "../stores/settings";
import { colors } from "../theme";
import { T } from "../shared";

/** The list a row belongs to, and its name for the "Playing from". */
export interface RowList {
  tracks: Track[];
  name: string;
}

/** How far a row has to go before letting go does anything. */
const ARM_AT = 76;
/** Held past there this long, it branches off. */
const CHARGE_MS = 520;
/** With the row this far away, what's under it can be read whole. */
const LABEL_FITS_AT = 130;
/** A flick counts without going all the way. */
const FLICK_SPEED = 0.8;
const FLICK_AT = 28;
/** The sweep that fills up while a row is held, wider than a row ever goes. */
const CHARGE_WIDTH = 220;

/** How it feels: from where the row pulls against a spring and how hard, how it kicks, how it comes home. */
const FEELS: Record<
  SwipeFeel,
  {
    givesAt: number;
    gives: number;
    joltArmed: number;
    joltCharged: number;
    joltSpring: { stiffness: number; damping: number; mass: number };
    popArmed: number;
    popCharged: number;
    home: { stiffness: number; damping: number; mass: number };
  }
> = {
  // Pulled and held as ever; let go it's a tight band: all at once, and hardly past the middle.
  rubber: {
    givesAt: 170,
    gives: 0.3,
    joltArmed: 12,
    joltCharged: 26,
    joltSpring: { stiffness: 420, damping: 14, mass: 0.7 },
    popArmed: 1.45,
    popCharged: 1.9,
    home: { stiffness: 1000, damping: 40, mass: 0.8 },
  },
  // Gives less, kicks less, and comes home without going past it.
  taut: {
    givesAt: 130,
    gives: 0.2,
    joltArmed: 5,
    joltCharged: 10,
    joltSpring: { stiffness: 520, damping: 28, mass: 0.7 },
    popArmed: 1.2,
    popCharged: 1.45,
    home: { stiffness: 1500, damping: 66, mass: 0.8 },
  },
};

/** `pulled` does nothing yet; `armed` is what letting go would do; `charged` is the held one's end. */
type Stage = "pulled" | "armed" | "charged";

export function SwipeRow({ track, list, children }: { track: Track; list: RowList; children: ReactNode }) {
  const x = useRef(new Animated.Value(0, { useNativeDriver: true })).current;
  const kick = useRef(new Animated.Value(0, { useNativeDriver: true })).current;
  const pop = useRef(new Animated.Value(1, { useNativeDriver: true })).current;
  const charge = useRef(new Animated.Value(0, { useNativeDriver: true })).current;
  const [stage, setStage] = useState<Stage | null>(null);
  const [side, setSide] = useState<"left" | "right">("right");
  /** pulled on the song a branch starts from: letting go takes it back */
  const [undoing, setUndoing] = useState(false);
  const stageNow = useRef<Stage | null>(null);
  const sideNow = useRef<"left" | "right">("right");
  const holding = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** How far the finger had come when the swipe was recognised: the gesture counts from zero after that. */
  const caught = useRef(0);
  const latest = useRef({ track, list });
  latest.current = { track, list };
  const muted = useLibrary((s) => s.muted.has(track.id));

  // Only once there's room for it: half a word looks broken.
  const labelShows = useMemo(
    () => x.interpolate({ inputRange: [-LABEL_FITS_AT, -LABEL_FITS_AT + 14, LABEL_FITS_AT - 14, LABEL_FITS_AT], outputRange: [1, 0, 0, 1], extrapolate: "clamp" }),
    [x]
  );
  const rowX = useMemo(() => Animated.add(x, kick), [x, kick]);
  const chargeX = useMemo(() => charge.interpolate({ inputRange: [0, 1], outputRange: [-CHARGE_WIDTH, 0] }), [charge]);

  const pan = useMemo(() => {
    const motion = () => FEELS[useSettings.getState().swipeFeel];
    const still = () => useSettings.getState().reduceMotion;
    const go = (next: Stage | null): void => {
      stageNow.current = next;
      setStage(next);
    };
    /** The row jolts: a detent you can see. */
    const jolt = (by: number): void => {
      if (still()) return;
      Animated.sequence([
        Animated.timing(kick, { toValue: by, duration: 55, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(kick, { ...motion().joltSpring, toValue: 0, useNativeDriver: true }),
      ]).start();
    };
    const popIcon = (to: number, rest: number): void => {
      if (still()) return;
      Animated.sequence([
        Animated.timing(pop, { toValue: to, duration: 80, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
        Animated.spring(pop, { toValue: rest, stiffness: 320, damping: 12, mass: 0.7, useNativeDriver: true }),
      ]).start();
    };
    const stopCharging = (): void => {
      if (holding.current) {
        clearTimeout(holding.current);
        holding.current = null;
        feel("cancel");
      }
      Animated.timing(charge, { toValue: 0, duration: 120, useNativeDriver: true }).start();
    };
    /** This very song is where a branch of this list starts. */
    const isChosen = (): boolean => {
      const { track: song, list: songs } = latest.current;
      const player = usePlayer.getState();
      return !!player.branchFrom(song.id, songs.name);
    };
    /** Something to branch off into. */
    const canHold = (): boolean => {
      if (isChosen()) return false;
      const { track: song, list: songs } = latest.current;
      const at = songs.tracks.indexOf(song);
      return at >= 0 && at < songs.tracks.length - 1;
    };
    /** Back in place, like a band let go. */
    const home = (): void => {
      x.stopAnimation();
      const finish = (): void => {
        charge.setValue(0);
        pop.setValue(1);
        go(null);
        setUndoing(false);
      };
      if (still()) {
        x.setValue(0);
        finish();
        return;
      }
      Animated.spring(x, { ...motion().home, toValue: 0, useNativeDriver: true }).start(({ finished }) => finished && finish());
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
        setUndoing(sideNow.current === "right" && isChosen());
        pop.setValue(1);
        charge.setValue(0);
        go("pulled");
      },
      onPanResponderMove: (_, g) => {
        const m = motion();
        const pulled = caught.current + g.dx;
        // Changed its mind across the middle: the other side's business from here on.
        const nowSide = pulled < 0 ? "left" : "right";
        if (nowSide !== sideNow.current) {
          sideNow.current = nowSide;
          setSide(nowSide);
          setUndoing(nowSide === "right" && isChosen());
          stopCharging();
          if (stageNow.current !== "pulled") go("pulled");
        }
        const far = Math.abs(pulled);
        const shown = far <= m.givesAt ? far : m.givesAt + (far - m.givesAt) * m.gives;
        x.setValue(nowSide === "left" ? -shown : shown);
        if (far < ARM_AT) {
          // Brought back: nothing happens after all.
          stopCharging();
          if (stageNow.current !== "pulled") go("pulled");
          return;
        }
        if (stageNow.current === "pulled") {
          go("armed");
          feel("arm");
          jolt(nowSide === "left" ? -m.joltArmed : m.joltArmed);
          popIcon(m.popArmed, 1);
        }
        if (nowSide === "right" && stageNow.current === "armed" && !holding.current && canHold()) {
          feel("charge");
          Animated.timing(charge, { toValue: 1, duration: CHARGE_MS, easing: Easing.in(Easing.quad), useNativeDriver: true }).start();
          holding.current = setTimeout(() => {
            holding.current = null;
            go("charged");
            feel("charged");
            jolt(m.joltCharged);
            popIcon(m.popCharged, 1.25);
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
        if (done) feel("commit");
        home();
        if (!done) return;
        const { track: song, list: songs } = latest.current;
        if (sideThen === "left") {
          const nowMuted = useLibrary.getState().toggleMuted(song);
          toast(nowMuted ? T("Muted: “{title}” is skipped from now on", { title: song.title }) : T("“{title}” plays again", { title: song.title }));
        } else if (isChosen()) {
          usePlayer.getState().cancelBranch(songs.name);
          toast(T("Branch taken back"));
        } else if (stageThen === "charged") {
          const count = usePlayer.getState().branchOff(songs.tracks, Math.max(0, songs.tracks.indexOf(song)), songs.name);
          toast(T("Branching off into “{name}”: {count}", { name: songs.name, count: plural(count, T("song"), T("songs")) }));
        } else {
          const inLine = usePlayer.getState().addToQueue([song]);
          toast(inLine > 1 ? T("Added to queue, after {count}", { count: plural(inLine - 1, T("other song"), T("other songs")) }) : T("Plays next"));
        }
      },
      onPanResponderTerminate: () => {
        stopCharging();
        home();
      },
    });
  }, [charge, kick, pop, x]);

  const forward = side === "right";
  const under = forward ? (stage === "armed" || stage === "charged" ? styles.underNext : styles.underPulled) : stage === "armed" ? styles.underMute : styles.underMutePulled;
  const label = forward ? (undoing ? T("swipe.undo") : stage === "charged" ? T("swipe.branch") : T("swipe.queue")) : muted ? T("swipe.unmute") : T("swipe.mute");
  const dark = forward && stage !== "pulled";
  const inkColor = dark ? colors.onAccent : colors.ink;
  const Icon = forward ? (undoing ? Undo2 : stage === "charged" ? Split : ListStart) : muted ? Volume2 : VolumeX;

  return (
    <View>
      {!!stage && (
        <View style={[StyleSheet.absoluteFill, styles.under, forward ? styles.underStart : styles.underEnd, under]}>
          {forward && <Animated.View style={[styles.charge, { transform: [{ translateX: chargeX }] }]} />}
          {!forward && (
            <Animated.Text numberOfLines={1} style={[styles.label, { color: inkColor, opacity: labelShows }]}>
              {label}
            </Animated.Text>
          )}
          <Animated.View style={{ transform: [{ scale: pop }] }}>
            <Icon size={24} color={inkColor} strokeWidth={stage === "charged" ? 2.8 : 2.2} />
          </Animated.View>
          {forward && (
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

/** The rows around one that left or moved close up instead of jumping. */
export function glideList(): void {
  if (useSettings.getState().reduceMotion) return;
  LayoutAnimation.configureNext({ duration: 190, update: { type: "easeInEaseOut" }, delete: { type: "easeInEaseOut", property: "opacity" } });
}

/** How far a row flies, leaving: past any phone's edge. */
const FLIES_OFF = 520;

/**
 * A row with one thing to pull for, to the right: past the mark it kicks and the
 * phone answers, as with the song rows, and letting go does it. `leaves`: it's gone
 * after that, so it flies off instead of coming home.
 */
export function PullRow({
  label,
  Icon,
  tone = "accent",
  leaves = false,
  rowColor = colors.base,
  style,
  onPull,
  children,
}: {
  label: string;
  Icon: LucideIcon;
  tone?: "accent" | "danger";
  leaves?: boolean;
  rowColor?: string;
  style?: StyleProp<ViewStyle>;
  onPull: () => void;
  children: ReactNode;
}) {
  const x = useRef(new Animated.Value(0, { useNativeDriver: true })).current;
  const kick = useRef(new Animated.Value(0, { useNativeDriver: true })).current;
  const pop = useRef(new Animated.Value(1, { useNativeDriver: true })).current;
  const [stage, setStage] = useState<"pulled" | "armed" | null>(null);
  const stageNow = useRef<"pulled" | "armed" | null>(null);
  const caught = useRef(0);
  const latest = useRef({ onPull, leaves });
  latest.current = { onPull, leaves };
  const labelShows = useMemo(() => x.interpolate({ inputRange: [LABEL_FITS_AT - 14, LABEL_FITS_AT], outputRange: [0, 1], extrapolate: "clamp" }), [x]);
  const rowX = useMemo(() => Animated.add(x, kick), [x, kick]);

  const pan = useMemo(() => {
    const motion = () => FEELS[useSettings.getState().swipeFeel];
    const still = () => useSettings.getState().reduceMotion;
    const go = (next: "pulled" | "armed" | null): void => {
      stageNow.current = next;
      setStage(next);
    };
    const home = (): void => {
      x.stopAnimation();
      const finish = (): void => {
        pop.setValue(1);
        go(null);
      };
      if (still()) {
        x.setValue(0);
        finish();
        return;
      }
      Animated.spring(x, { ...motion().home, toValue: 0, useNativeDriver: true }).start(({ finished }) => finished && finish());
    };
    const flyOff = (done: () => void): void => {
      x.stopAnimation();
      const after = (): void => {
        done();
        // Gone by then; should it still stand there after all, it's back in place.
        setTimeout(() => {
          x.setValue(0);
          pop.setValue(1);
          go(null);
        }, 400);
      };
      if (still()) after();
      else Animated.timing(x, { toValue: FLIES_OFF, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(after);
    };
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => {
        caught.current = g.dx;
        return g.dx > 12 && g.dx > Math.abs(g.dy) * 1.5;
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        x.stopAnimation();
        pop.setValue(1);
        go("pulled");
      },
      onPanResponderMove: (_, g) => {
        const m = motion();
        const far = Math.max(0, caught.current + g.dx);
        x.setValue(far <= m.givesAt ? far : m.givesAt + (far - m.givesAt) * m.gives);
        if (far < ARM_AT) {
          if (stageNow.current !== "pulled") go("pulled");
          return;
        }
        if (stageNow.current === "pulled") {
          go("armed");
          feel("arm");
          if (!still()) {
            Animated.sequence([
              Animated.timing(kick, { toValue: m.joltArmed, duration: 55, easing: Easing.out(Easing.quad), useNativeDriver: true }),
              Animated.spring(kick, { ...m.joltSpring, toValue: 0, useNativeDriver: true }),
            ]).start();
            Animated.sequence([
              Animated.timing(pop, { toValue: m.popArmed, duration: 80, easing: Easing.out(Easing.back(2)), useNativeDriver: true }),
              Animated.spring(pop, { toValue: 1, stiffness: 320, damping: 12, mass: 0.7, useNativeDriver: true }),
            ]).start();
          }
        }
      },
      onPanResponderRelease: (_, g) => {
        const far = caught.current + g.dx;
        const flick = far > FLICK_AT && g.vx > FLICK_SPEED;
        const done = stageNow.current === "armed" || flick;
        if (!done) {
          home();
          return;
        }
        feel("commit");
        if (latest.current.leaves) {
          go("armed");
          flyOff(() => latest.current.onPull());
          return;
        }
        home();
        latest.current.onPull();
      },
      onPanResponderTerminate: home,
    });
  }, [kick, pop, x]);

  const armed = stage === "armed";
  const underColor = tone === "danger" ? (armed ? styles.underMute : styles.underMutePulled) : armed ? styles.underNext : styles.underPulled;
  const inkColor = tone === "accent" && armed ? colors.onAccent : colors.ink;
  return (
    <View style={[style, !!stage && styles.clipped]}>
      {!!stage && (
        <View style={[StyleSheet.absoluteFill, styles.under, styles.underStart, underColor]}>
          <Animated.View style={{ transform: [{ scale: pop }] }}>
            <Icon size={23} color={inkColor} strokeWidth={2.2} />
          </Animated.View>
          <Animated.Text numberOfLines={1} style={[styles.label, { color: inkColor, opacity: labelShows }]}>
            {label}
          </Animated.Text>
        </View>
      )}
      <Animated.View {...pan.panHandlers} style={{ backgroundColor: rowColor, transform: [{ translateX: rowX }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clipped: { overflow: "hidden" },
  under: { flexDirection: "row", alignItems: "center", gap: 10, overflow: "hidden" },
  underEnd: { justifyContent: "flex-end", paddingRight: 22 },
  underStart: { justifyContent: "flex-start", paddingLeft: 22 },
  underPulled: { backgroundColor: colors.button },
  underNext: { backgroundColor: colors.accent },
  underMutePulled: { backgroundColor: "#5A2B2B" },
  underMute: { backgroundColor: "#C24F4C" },
  charge: { position: "absolute", top: 0, bottom: 0, left: 0, width: CHARGE_WIDTH, backgroundColor: colors.ink },
  label: { fontSize: 13.5, fontWeight: "700" },
  row: { backgroundColor: colors.base },
});
