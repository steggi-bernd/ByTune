/** The equalizer: the computer's ten bands, on this phone's own player. Devices on the network have their own sound. */
import { useNavigation } from "@react-navigation/native";
import { ChevronLeft } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Chip } from "../components/ui";
import { EQ_BANDS, EQ_PRESETS, EQ_RANGE_DB, feel, useSettings } from "../stores/settings";
import { colors, PAGE_END } from "../theme";
import { T } from "../shared";

const SLIDER_HEIGHT = 240;
const SEND_EVERY_MS = 120;

const hzLabel = (hz: number): string => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

/** One band, upright: the middle is no change. */
function Band({ hz, gain, on, onChange }: { hz: number; gain: number; on: boolean; onChange: (gain: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef(0);
  const sentAt = useRef(0);
  const last = useRef(gain);
  const change = useRef(onChange);
  change.current = onChange;
  const pan = useMemo(() => {
    const gainAt = (y: number): number => {
      const part = 1 - Math.max(0, Math.min(1, y / SLIDER_HEIGHT));
      return Math.round((part * 2 - 1) * EQ_RANGE_DB * 2) / 2;
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        start.current = e.nativeEvent.locationY;
        last.current = gainAt(start.current);
        setDrag(gainAt(start.current));
      },
      onPanResponderMove: (_, g) => {
        const value = gainAt(start.current + g.dy);
        // No change, and the ends: places you can feel.
        if (value !== last.current && (value === 0 || Math.abs(value) === EQ_RANGE_DB)) feel("tick");
        last.current = value;
        setDrag(value);
        if (Date.now() - sentAt.current >= SEND_EVERY_MS) {
          sentAt.current = Date.now();
          change.current(value);
        }
      },
      onPanResponderRelease: (_, g) => {
        change.current(gainAt(start.current + g.dy));
        setDrag(null);
      },
      onPanResponderTerminate: () => setDrag(null),
    });
  }, []);
  const shown = drag ?? gain;
  const top = (1 - (shown + EQ_RANGE_DB) / (EQ_RANGE_DB * 2)) * SLIDER_HEIGHT;
  const middle = SLIDER_HEIGHT / 2;
  const ink = on ? colors.accent : colors.dim;
  return (
    <View style={styles.band}>
      <Text style={styles.gain}>{shown > 0 ? `+${shown}` : shown}</Text>
      <View {...pan.panHandlers} accessibilityRole="adjustable" accessibilityLabel={T("{hzLabel} hertz, {shown} decibels", { hzLabel: hzLabel(hz), shown })} style={styles.slider}>
        <View pointerEvents="none" style={styles.track} />
        <View pointerEvents="none" style={[styles.fill, { top: Math.min(top, middle), height: Math.abs(top - middle), backgroundColor: ink }]} />
        <View pointerEvents="none" style={[styles.knob, { top: top - 9, backgroundColor: ink }]} />
      </View>
      <Text style={styles.hz}>{hzLabel(hz)}</Text>
    </View>
  );
}

export function EqualizerScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const on = useSettings((s) => s.eqOn);
  const gains = useSettings((s) => s.eqGains);
  const change = useSettings((s) => s.change);
  const preset = EQ_PRESETS.find((p) => p.gains.every((g, i) => g === gains[i]))?.label;

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + 2, paddingBottom: PAGE_END + insets.bottom }}>
      <Pressable onPress={() => nav.goBack()} accessibilityLabel={T("Go back")} style={styles.back}>
        <ChevronLeft size={28} color={colors.ink} />
      </Pressable>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{T("Equalizer")}</Text>
        <Switch accessibilityLabel={T("Equalizer")} value={on} onValueChange={(eqOn) => change({ eqOn })} trackColor={{ true: colors.accent }} thumbColor={colors.ink} />
      </View>
      <Text style={styles.note}>{T("For this phone and whatever is connected to it. Speakers on your network have their own sound settings.")}</Text>
      <View style={styles.presets}>
        {EQ_PRESETS.map((p) => (
          <Chip key={p.label} label={p.label} active={preset === p.label} onPress={() => change({ eqGains: p.gains, eqOn: true })} />
        ))}
      </View>
      <View style={styles.bands}>
        {EQ_BANDS.map((hz, i) => (
          <Band key={hz} hz={hz} gain={gains[i] ?? 0} on={on} onChange={(gain) => change({ eqGains: gains.map((g, at) => (at === i ? gain : g)) })} />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.base, paddingHorizontal: 16 },
  back: { width: 44, height: 44, marginLeft: -10, alignItems: "center", justifyContent: "center" },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  title: { color: colors.ink, fontSize: 30, fontWeight: "800", letterSpacing: -0.8 },
  note: { color: colors.dim, fontSize: 13, lineHeight: 18, marginTop: 8 },
  presets: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16 },
  bands: { flexDirection: "row", justifyContent: "space-between", marginTop: 24 },
  band: { alignItems: "center", width: 32 },
  gain: { color: colors.dim, fontSize: 10.5, marginBottom: 8, height: 14 },
  slider: { width: 32, height: SLIDER_HEIGHT, alignItems: "center" },
  track: { position: "absolute", width: 4, height: SLIDER_HEIGHT, borderRadius: 2, backgroundColor: colors.chip },
  fill: { position: "absolute", width: 4 },
  knob: { position: "absolute", width: 18, height: 18, borderRadius: 9 },
  hz: { color: colors.soft, fontSize: 11, marginTop: 10 },
});
