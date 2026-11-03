/**
 * What stays over every page: the player and the three tabs. They share this
 * slot so the tabs can lie on top of the rising player and slide away under it.
 */
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { LinearGradient } from "expo-linear-gradient";
import { House, Library, Search } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, TAB_BAR_HEIGHT } from "../theme";
import { PlayerSheet } from "./PlayerSheet";

const TABS = [
  { label: "Home", Icon: House },
  { label: "Search", Icon: Search },
  { label: "Your Library", Icon: Library },
];

export function BottomBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0, { useNativeDriver: true })).current;
  const [expanded, setExpanded] = useState(false);
  const tabsHeight = TAB_BAR_HEIGHT + insets.bottom;
  const tabsY = useMemo(() => progress.interpolate({ inputRange: [0, 1], outputRange: [0, tabsHeight] }), [progress, tabsHeight]);
  const shownTab = state.routes[state.index].name;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <PlayerSheet
        progress={progress}
        expanded={expanded}
        setExpanded={setExpanded}
        goTo={(screen, params) => navigation.navigate(shownTab, { screen, params })}
      />
      <Animated.View pointerEvents={expanded ? "none" : "box-none"} style={[styles.tabsLayer, { transform: [{ translateY: tabsY }] }]}>
        <LinearGradient colors={["rgba(0,0,0,0.72)", colors.base]} locations={[0, 0.5]} style={{ paddingBottom: insets.bottom }}>
          <View style={styles.tabs} accessibilityRole="tablist">
            {TABS.map(({ label, Icon }, i) => {
              const active = state.index === i;
              const color = active ? colors.ink : colors.dim;
              return (
                <Pressable
                  key={label}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  style={styles.tab}
                  onPress={() => {
                    const route = state.routes[i];
                    // On the tab already: back to its first page, as on Spotify.
                    if (active) navigation.navigate(route.name, { screen: route.name.replace("Tab", "") });
                    else navigation.navigate(route.name);
                  }}
                >
                  <Icon size={24} color={color} strokeWidth={active ? 2.6 : 1.9} fill={active && label === "Home" ? color : "transparent"} />
                  <Text style={[styles.tabLabel, { color }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabsLayer: { position: "absolute", left: 0, right: 0, bottom: 0 },
  tabs: { flexDirection: "row", height: TAB_BAR_HEIGHT, paddingHorizontal: 12 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  tabLabel: { fontSize: 11, fontWeight: "500" },
});
