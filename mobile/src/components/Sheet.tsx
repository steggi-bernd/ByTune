/**
 * The sheet every menu comes up in: it slides from the bottom over a dimmed page,
 * has a grip, and a pull downward sends it away. `MenuSheet` is the usual menu on
 * it: what it's about on top, then rows with an icon each to find them by.
 */
import { Check, type LucideIcon } from "lucide-react-native";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { T } from "../shared";
import { feel, useSettings } from "../stores/settings";
import { colors } from "../theme";

const SPRING = { stiffness: 460, damping: 40, mass: 0.9, useNativeDriver: true };
/** It starts this far down, sliding in. */
const COMES_FROM = 280;
const PULLED_AWAY_AT = 90;
const FLICKED_AWAY_AT = 0.7;
const DANGER = "#FF9D9D";

export function SheetFrame({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const y = useRef(new Animated.Value(0, { useNativeDriver: true })).current;
  const closing = useRef(onClose);
  closing.current = onClose;

  useEffect(() => {
    if (!visible || useSettings.getState().reduceMotion) return;
    y.setValue(COMES_FROM);
    Animated.spring(y, { ...SPRING, toValue: 0 }).start();
  }, [visible, y]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && g.dy > Math.abs(g.dx),
        onPanResponderMove: (_, g) => y.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > PULLED_AWAY_AT || g.vy > FLICKED_AWAY_AT) closing.current();
          else Animated.spring(y, { ...SPRING, toValue: 0 }).start();
        },
        onPanResponderTerminate: () => Animated.spring(y, { ...SPRING, toValue: 0 }).start(),
      }),
    [y]
  );

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.back}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={T("Close")} />
        <Animated.View {...pan.panHandlers} style={[styles.sheet, { paddingBottom: insets.bottom + 8, transform: [{ translateY: y }] }]}>
          <View style={styles.gripArea}>
            <View style={styles.grip} />
          </View>
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

export interface SheetRow {
  label: string;
  Icon?: LucideIcon;
  /** a second, smaller line */
  line?: string;
  danger?: boolean;
  /** the one chosen now: in the accent, with a check unless `trailing` says otherwise */
  active?: boolean;
  trailing?: ReactNode;
  run(): void;
}

export function SheetHead({ art, title, subtitle }: { art?: ReactNode; title?: string; subtitle?: string }) {
  if (!title && !art) return null;
  return (
    <View style={styles.head}>
      {art}
      <View style={styles.headText}>
        <Text numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {!!subtitle && (
          <Text numberOfLines={1} style={styles.subtitle}>
            {subtitle}
          </Text>
        )}
      </View>
    </View>
  );
}

export function SheetRows({ rows, onClose }: { rows: SheetRow[]; onClose: () => void }) {
  return (
    <ScrollView bounces={false} overScrollMode="never" style={styles.rows}>
      {rows.map((row) => {
        const tint = row.danger ? DANGER : row.active ? colors.accent : colors.ink;
        return (
          <Pressable
            key={row.label}
            accessibilityRole="button"
            accessibilityState={row.active ? { selected: true } : undefined}
            android_ripple={{ color: "rgba(255,255,255,0.08)" }}
            style={styles.row}
            onPress={() => {
              feel("tick");
              onClose();
              row.run();
            }}
          >
            {!!row.Icon && (
              <View style={styles.icon}>
                <row.Icon size={22} strokeWidth={1.9} color={row.danger || row.active ? tint : colors.soft} />
              </View>
            )}
            <View style={styles.rowText}>
              <Text numberOfLines={1} style={[styles.label, { color: tint }]}>
                {row.label}
              </Text>
              {!!row.line && (
                <Text numberOfLines={2} style={styles.line}>
                  {row.line}
                </Text>
              )}
            </View>
            {row.trailing ?? (row.active ? <Check size={20} color={colors.accent} /> : null)}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A menu. What it shows stays on while the sheet fades out, instead of going blank first. */
export function MenuSheet({ visible, title, subtitle, art, rows, onClose }: { visible: boolean; title?: string; subtitle?: string; art?: ReactNode; rows: SheetRow[]; onClose: () => void }) {
  const shown = useRef({ title, subtitle, art, rows });
  if (visible) shown.current = { title, subtitle, art, rows };
  return (
    <SheetFrame visible={visible} onClose={onClose}>
      <SheetHead art={shown.current.art} title={shown.current.title} subtitle={shown.current.subtitle} />
      <SheetRows rows={shown.current.rows} onClose={onClose} />
    </SheetFrame>
  );
}

const styles = StyleSheet.create({
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  sheet: { maxHeight: "86%", backgroundColor: colors.sheet, borderTopLeftRadius: 22, borderTopRightRadius: 22, elevation: 24 },
  gripArea: { height: 22, alignItems: "center", justifyContent: "center" },
  grip: { width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(255,255,255,0.28)" },
  head: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 18, paddingTop: 4, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,0.14)", marginBottom: 4 },
  headText: { flex: 1, minWidth: 0 },
  title: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  subtitle: { color: colors.dim, fontSize: 13, marginTop: 2 },
  rows: { flexGrow: 0, flexShrink: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 52, paddingHorizontal: 18, paddingVertical: 6 },
  icon: { width: 24, alignItems: "center" },
  rowText: { flex: 1, minWidth: 0 },
  label: { fontSize: 15.5 },
  line: { color: colors.dim, fontSize: 13, marginTop: 2 },
});
