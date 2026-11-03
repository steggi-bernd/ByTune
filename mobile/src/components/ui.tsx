/** The small parts every screen is built from: covers, chips, shelves, song rows. */
import { Image } from "expo-image";
import { Heart, Music2 } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { PixelRatio, Pressable, ScrollView, StyleSheet, Text, View, type ImageStyle, type ViewStyle } from "react-native";
import type { Track } from "../shared";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { usePlaylists } from "../stores/playlists";
import { colors } from "../theme";

/** Jellyfin scales pictures to order: a row's 48 points don't need the player's 800 pixels. */
const PICTURE_WIDTHS = [200, 480];
function sized(uri: string, size: number): string {
  const width = PICTURE_WIDTHS.find((w) => w >= size * PixelRatio.get());
  return width ? uri.replace(/([?&]maxWidth=)[0-9]+/, `$1${width}`) : uri;
}

/** A cover or photo; `fallback` stands in when the server has no such picture. */
export function Cover({
  uri,
  fallback,
  size,
  radius = 4,
  style,
}: {
  uri?: string | null;
  fallback?: string;
  size: number;
  radius?: number;
  style?: ImageStyle;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const box = { width: size, height: size, borderRadius: radius };
  const shown = uri && uri !== failed ? uri : fallback;
  if (!shown) {
    return (
      <View style={[box, styles.noCover, style as ViewStyle]}>
        <Music2 size={size * 0.4} color={colors.dim} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri: sized(shown, size) }}
      style={[box, style]}
      contentFit="cover"
      cachePolicy="disk"
      recyclingKey={shown}
      transition={100}
      onError={() => shown === uri && setFailed(uri)}
    />
  );
}

/** Four covers of a mix or playlist, or the one it has. */
export function CoverGrid({ tracks, size, radius = 4 }: { tracks: Track[]; size: number; radius?: number }) {
  const covers: string[] = [];
  for (const t of tracks) {
    if (t.thumb && !covers.includes(t.thumb)) covers.push(t.thumb);
    if (covers.length === 4) break;
  }
  if (covers.length < 4) return <Cover uri={covers[0]} size={size} radius={radius} />;
  return (
    <View style={{ width: size, height: size, borderRadius: radius, overflow: "hidden", flexDirection: "row", flexWrap: "wrap" }}>
      {covers.map((c) => (
        <Cover key={c} uri={c} size={size / 2} radius={0} />
      ))}
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function Shelf({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.shelf}>
      <Text style={styles.shelfTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelfRow}>
        {children}
      </ScrollView>
    </View>
  );
}

export function Card({
  art,
  title,
  subtitle,
  width = CARD_SIZE,
  onPress,
}: {
  art: ReactNode;
  title: string;
  subtitle?: string;
  width?: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ width }}>
      {art}
      <Text numberOfLines={1} style={styles.cardTitle}>
        {title}
      </Text>
      {!!subtitle && (
        <Text numberOfLines={1} style={styles.cardSubtitle}>
          {subtitle}
        </Text>
      )}
    </Pressable>
  );
}

export const CARD_SIZE = 148;

export function LikeButton({ track, size = 20 }: { track: Track; size?: number }) {
  const liked = useLibrary((s) => s.favorites.has(track.id));
  const toggle = useLibrary((s) => s.toggleFavorite);
  return (
    <Pressable
      onPress={() => toggle(track)}
      hitSlop={6}
      accessibilityLabel={liked ? "Remove from Liked Songs" : "Add to Liked Songs"}
      style={styles.iconButton}
    >
      <Heart size={size} color={liked ? colors.accent : colors.dim} fill={liked ? colors.accent : "transparent"} />
    </Pressable>
  );
}

/** Playing: three little bars, the desktop's mark for the song on air. */
export function EqBars({ color = colors.accent }: { color?: string }) {
  return (
    <View accessibilityLabel="Playing" style={styles.eq}>
      {[8, 13, 6].map((h, i) => (
        <View key={i} style={{ width: 3, height: h, borderRadius: 1, backgroundColor: color }} />
      ))}
    </View>
  );
}

export function TrackRow({
  track,
  number,
  showCover = true,
  subtitle,
  missing,
  onPress,
  onLongPress,
}: {
  track: Track;
  number?: number;
  showCover?: boolean;
  subtitle?: string;
  /** a playlist's song this library doesn't have */
  missing?: boolean;
  onPress: () => void;
  /** by default a held song can go to a playlist */
  onLongPress?: () => void;
}) {
  const current = usePlayer((s) => s.queue[s.index]?.id === track.id);
  const playing = usePlayer((s) => s.isPlaying);
  return (
    <Pressable
      disabled={missing && !onLongPress}
      onPress={missing ? undefined : onPress}
      onLongPress={onLongPress ?? (() => usePlaylists.getState().setPicking(track))}
      style={[styles.row, !showCover && styles.rowPlain, missing && styles.rowMissing]}
    >
      {number !== undefined && (
        <View style={styles.rowNumber}>
          {current && playing ? <EqBars /> : <Text style={[styles.rowNumberText, current && { color: colors.accent }]}>{number}</Text>}
        </View>
      )}
      {showCover && <Cover uri={track.thumb} size={48} radius={4} />}
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, current && { color: colors.accent }]}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={styles.rowSubtitle}>
          {missing ? "Not on this server" : subtitle ?? track.artist}
        </Text>
      </View>
      {!missing && <LikeButton track={track} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  noCover: { backgroundColor: colors.panel, alignItems: "center", justifyContent: "center" },
  chip: { height: 32, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.chip, justifyContent: "center" },
  chipActive: { backgroundColor: colors.ink },
  chipText: { color: colors.ink, fontSize: 13, fontWeight: "500" },
  chipTextActive: { color: colors.base, fontWeight: "600" },
  shelf: { paddingTop: 26 },
  shelfTitle: { color: colors.ink, fontSize: 21, fontWeight: "700", letterSpacing: -0.3, marginLeft: 16, marginBottom: 12 },
  shelfRow: { paddingHorizontal: 16, gap: 12 },
  cardTitle: { color: colors.ink, fontSize: 13.5, fontWeight: "600", marginTop: 8 },
  cardSubtitle: { color: colors.dim, fontSize: 12.5, marginTop: 2 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  eq: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 14 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, height: 62, paddingLeft: 16, paddingRight: 6 },
  rowPlain: { height: 60 },
  rowMissing: { opacity: 0.45 },
  rowNumber: { width: 18, alignItems: "center" },
  rowNumberText: { color: colors.dim, fontSize: 13 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: "500" },
  rowSubtitle: { color: colors.dim, fontSize: 13, marginTop: 3 },
});
