/**
 * The songs around the playing one, side by side on a strip: the big cover, the
 * title under it, the mini player's row. One number says where the strip
 * stands, `trackPosition`: the queue's index, in between while a finger or an
 * animation moves it. A page's place on the strip is its index, so nothing has
 * to jump when the song changes: the strip is already standing there.
 */
import { useMemo, useRef, type ReactNode } from "react";
import { Animated, Easing, PanResponder, StyleSheet, View } from "react-native";
import type { RepeatMode } from "../../modules/media3-player";
import type { Track } from "../shared";
import { usePlayer } from "../stores/player";

export const trackPosition = new Animated.Value(0, { useNativeDriver: true });

const SPRING = { stiffness: 280, damping: 32, mass: 1, overshootClamping: true, useNativeDriver: true };

/** Where the strip is headed: a song changed by a swipe has its animation already. */
let heading = 0;

usePlayer.subscribe((s, prev) => {
  if (s.index === heading) return;
  const step = Math.abs(s.index - heading);
  heading = s.index;
  // Next, previous, the song's end: one page along. Anything else is a new place.
  if (step === 1 && s.queue === prev.queue) {
    Animated.timing(trackPosition, { toValue: s.index, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  } else {
    trackPosition.setValue(s.index);
  }
});

/** The song at a place on the strip; with Repeat on, the queue goes on round its ends. */
function trackAt(queue: Track[], at: number, repeat: RepeatMode): Track | undefined {
  if (at >= 0 && at < queue.length) return queue[at];
  return repeat === "all" && queue.length > 1 ? queue[(at + queue.length) % queue.length] : undefined;
}

function release(dx: number, vx: number, width: number): void {
  const { queue, index, repeat, skipBy } = usePlayer.getState();
  // Where the finger was headed a moment on: a flick counts like a long drag.
  const ahead = -dx / width - (vx * 250) / width;
  const delta = Math.abs(ahead) > 0.5 ? Math.sign(ahead) : 0;
  const velocity = (-vx * 1000) / width;
  if (!delta || !trackAt(queue, index + delta, repeat)) {
    Animated.spring(trackPosition, { ...SPRING, toValue: index, velocity }).start();
    return;
  }
  const to = index + delta;
  if (to >= 0 && to < queue.length) {
    heading = to;
    Animated.spring(trackPosition, { ...SPRING, toValue: to, velocity }).start();
    skipBy(delta);
    return;
  }
  // Round the queue's end: the page over the edge first, then the strip's real place.
  Animated.spring(trackPosition, { ...SPRING, toValue: to, velocity }).start(() => {
    heading = (to + queue.length) % queue.length;
    skipBy(delta);
    trackPosition.setValue(heading);
  });
}

/** A horizontal swipe over pages of this width; anything showing the strip can carry its handlers. */
export function useTrackSwipe(pageWidth: number) {
  const width = useRef(pageWidth);
  width.current = pageWidth;
  /** How far the finger had come when the swipe was recognised: the gesture counts from zero after that. */
  const caught = useRef(0);
  return useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => {
          caught.current = g.dx;
          return Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => trackPosition.stopAnimation(),
        onPanResponderMove: (_, g) => {
          const { queue, index, repeat } = usePlayer.getState();
          const part = -(caught.current + g.dx) / width.current;
          // Nothing there: the strip gives a little and comes back.
          const moved = trackAt(queue, index + Math.sign(part), repeat) ? Math.max(-1, Math.min(1, part)) : part * 0.25;
          trackPosition.setValue(index + moved);
        },
        onPanResponderRelease: (_, g) => release(caught.current + g.dx, g.vx, width.current),
        onPanResponderTerminate: () => {
          Animated.spring(trackPosition, { ...SPRING, toValue: usePlayer.getState().index }).start();
        },
      }),
    []
  );
}

/** Shows one page of its width: whatever holds it clips the rest. */
export function TrackStrip({ width, children }: { width: number; children: (track: Track) => ReactNode }) {
  const index = usePlayer((s) => s.index);
  const queue = usePlayer((s) => s.queue);
  const repeat = usePlayer((s) => s.repeat);
  const x = useMemo(() => Animated.multiply(trackPosition, -width), [width]);
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: x }] }]}>
      {[index - 1, index, index + 1].map((at) => {
        const track = trackAt(queue, at, repeat);
        if (!track) return null;
        return (
          <View key={at} style={{ position: "absolute", top: 0, bottom: 0, left: at * width, width }}>
            {children(track)}
          </View>
        );
      })}
    </Animated.View>
  );
}
