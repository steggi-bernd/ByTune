/** A volume to drag: what it's set to right under the finger, and what it says goes out only every so often. */
import { useMemo, useRef, useState } from "react";
import { PanResponder, StyleSheet, View } from "react-native";
import { feel } from "../stores/settings";
import { colors } from "../theme";
import { T } from "../shared";

const SEND_EVERY_MS = 200;

export function VolumeBar({ value, onChange, ink }: { value: number; onChange: (v: number) => void; ink: string }) {
  const [drag, setDrag] = useState<number | null>(null);
  const width = useRef(1);
  const start = useRef(0);
  const sentAt = useRef(0);
  const last = useRef(value);
  const change = useRef(onChange);
  change.current = onChange;

  const pan = useMemo(() => {
    const at = (x: number): number => Math.max(0, Math.min(1, x / width.current));
    const send = (v: number): void => {
      sentAt.current = Date.now();
      change.current(v);
    };
    /** Its ends can be felt. */
    const reached = (v: number): void => {
      if ((v === 0 || v === 1) && last.current !== v) feel("tick");
      last.current = v;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        start.current = e.nativeEvent.locationX;
        const v = at(start.current);
        last.current = v;
        feel("tick");
        setDrag(v);
      },
      onPanResponderMove: (_, g) => {
        const v = at(start.current + g.dx);
        reached(v);
        setDrag(v);
        if (Date.now() - sentAt.current >= SEND_EVERY_MS) send(v);
      },
      onPanResponderRelease: (_, g) => {
        send(at(start.current + g.dx));
        setDrag(null);
      },
      onPanResponderTerminate: () => setDrag(null),
    });
  }, []);

  const part = drag ?? value;
  return (
    <View {...pan.panHandlers} onLayout={(e) => (width.current = Math.max(1, e.nativeEvent.layout.width))} style={styles.volume} accessibilityRole="adjustable" accessibilityLabel={T("Volume {round} percent", { round: Math.round(part * 100) })}>
      <View pointerEvents="none" style={[styles.track, { backgroundColor: ink === colors.ink ? colors.chip : "rgba(18,11,36,0.22)" }]}>
        <View style={[styles.fill, { width: `${part * 100}%`, backgroundColor: ink }]} />
      </View>
      <View pointerEvents="none" style={[styles.knob, { left: `${part * 100}%`, backgroundColor: ink }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  volume: { flex: 1, height: 34, justifyContent: "center" },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: 4 },
  knob: { position: "absolute", width: 14, height: 14, borderRadius: 7, marginLeft: -7, top: 10 },
});
