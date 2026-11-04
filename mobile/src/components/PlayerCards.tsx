/**
 * What lies under the player, as in the computer's side panel: what comes next,
 * about the song (Genius), about the artist (Wikipedia, MusicBrainz). A card
 * nobody has anything for stays away.
 */
import { useNavigation } from "@react-navigation/native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useArtistAbout, useSongAbout } from "../about";
import { leadArtist, OPEN_DATA_AGENT, type Track } from "../shared";
import { useArtistPhoto } from "../stores/library";
import { usePlayer } from "../stores/player";
import { colors } from "../theme";
import { Cover, picture } from "./ui";
import { T } from "../shared";

const NEXT_UP_SHOWN = 3;
const CREDITS_SHOWN = 4;
const LINES_SHOWN = 5;
/** Longer than this it won't fit the lines shown. */
const STORY_FITS = 260;

export function NextUpCard() {
  const nav = useNavigation<any>();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const next = queue.slice(index + 1, index + 1 + NEXT_UP_SHOWN);
  if (!next.length) return null;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{T("Next up")}</Text>
        <Pressable onPress={() => nav.navigate("Queue")} hitSlop={10}>
          <Text style={styles.link}>{T("Open queue")}</Text>
        </Pressable>
      </View>
      {next.map((t, i) => (
        <Pressable key={`${index + 1 + i}:${t.id}`} onPress={() => usePlayer.getState().skipTo(index + 1 + i)} style={styles.nextRow}>
          <Cover uri={t.thumb} size={44} />
          <View style={styles.nextText}>
            <Text numberOfLines={1} style={styles.nextTitle}>
              {t.title}
            </Text>
            <Text numberOfLines={1} style={styles.nextArtist}>
              {t.artist}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

function Fact({ label, children }: { label: string; children: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{children}</Text>
    </View>
  );
}

function Pill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={6} style={styles.pill}>
      <Text style={styles.pillText}>{label}</Text>
    </Pressable>
  );
}

export function AboutSongCard({ track, active }: { track: Track; active: boolean }) {
  const songInfo = useSongAbout(track, active);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [track.id]);
  const info = songInfo && (songInfo.description || songInfo.credits.length || songInfo.released) ? songInfo : null;
  if (!info) return null;
  const when = [info.released, info.album].filter(Boolean).join(" · ");
  const more = (info.description?.length ?? 0) > STORY_FITS || info.credits.length > CREDITS_SHOWN || info.samples.length > 0 || !!info.recordedAt;
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{T("About the song")}</Text>
        <Pill label={T("Genius")} onPress={() => void Linking.openURL(info.url)} />
      </View>
      {!!when && (
        <Text numberOfLines={1} style={styles.line}>
          {when}
        </Text>
      )}
      {!!info.description && (
        <Text numberOfLines={open ? undefined : LINES_SHOWN} style={styles.story}>
          {info.description}
        </Text>
      )}
      {(open ? info.credits : info.credits.slice(0, CREDITS_SHOWN)).map((c, i) => (
        <Fact key={`${c.label}-${i}`} label={c.label}>
          {c.names.join(", ")}
        </Fact>
      ))}
      {open && info.samples.length > 0 && <Fact label={T("Samples")}>{info.samples.map((x) => (x.artist ? `${x.title} · ${x.artist}` : x.title)).join("\n")}</Fact>}
      {open && !!info.recordedAt && <Fact label={T("Recorded at")}>{info.recordedAt}</Fact>}
      {more && (
        <Pressable onPress={() => setOpen(!open)} hitSlop={10} style={styles.more}>
          <Text style={styles.link}>{open ? T("Show less") : T("Show more")}</Text>
        </Pressable>
      )}
    </View>
  );
}

export function AboutArtistCard({ track, active, onOpen }: { track: Track; active: boolean; onOpen: () => void }) {
  const about = useArtistAbout(track, active);
  const own = useArtistPhoto(leadArtist(track.artist));
  const [ownFailed, setOwnFailed] = useState<string | null>(null);
  if (!about) return null;
  // The server's copy first: no reason to fetch a picture the phone can have from home.
  const ownShown = own && own !== ownFailed ? own : null;
  const source = ownShown ? picture(ownShown) : about.image ? { uri: about.image, headers: { "User-Agent": OPEN_DATA_AGENT } } : null;
  return (
    <Pressable onPress={onOpen} accessibilityLabel={T("About the artist: open {name}", { name: about.name })} style={[styles.card, styles.artistCard]}>
      {source ? (
        <View style={styles.photo}>
          <Image
            source={source}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition="top"
            cachePolicy="disk"
            transition={150}
            onError={() => {
              if (ownShown) setOwnFailed(ownShown);
            }}
          />
          <LinearGradient colors={["rgba(0,0,0,0.55)", "rgba(0,0,0,0.1)", "transparent"]} style={StyleSheet.absoluteFill} />
          <Text style={[styles.title, styles.photoTitle]}>{T("About the artist")}</Text>
        </View>
      ) : (
        <Text style={[styles.title, styles.plainTitle]}>{T("About the artist")}</Text>
      )}
      <View style={styles.artistBody}>
        <Text numberOfLines={1} style={styles.name}>
          {about.name}
        </Text>
        {about.genres.length > 0 && (
          <Text numberOfLines={1} style={styles.line}>
            {about.genres.slice(0, 3).join(" · ")}
          </Text>
        )}
        <View style={styles.factsRow}>
          <Text numberOfLines={1} style={styles.facts}>
            {about.facts ?? T("Artist")}
          </Text>
          {!!about.wikiUrl && <Pill label={T("Wikipedia")} onPress={() => void Linking.openURL(about.wikiUrl as string)} />}
        </View>
        {!!about.description && (
          <Text numberOfLines={LINES_SHOWN} style={styles.story}>
            {about.description}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 16, backgroundColor: "rgba(255,255,255,0.08)" },
  artistCard: { padding: 0, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, minHeight: 28 },
  title: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  link: { color: "rgba(255,255,255,0.72)", fontSize: 13, fontWeight: "600" },
  nextRow: { flexDirection: "row", alignItems: "center", gap: 12, height: 58 },
  nextText: { flex: 1, minWidth: 0 },
  nextTitle: { color: colors.ink, fontSize: 14.5 },
  nextArtist: { color: colors.soft, fontSize: 13, marginTop: 2 },
  pill: { height: 28, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)", justifyContent: "center" },
  pillText: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  line: { color: "rgba(255,255,255,0.58)", fontSize: 13, marginTop: 4 },
  story: { color: "rgba(255,255,255,0.75)", fontSize: 14, lineHeight: 20, marginTop: 10 },
  fact: { marginTop: 12 },
  factLabel: { color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: "600", letterSpacing: 0.9, textTransform: "uppercase" },
  factValue: { color: "rgba(255,255,255,0.88)", fontSize: 14, marginTop: 3 },
  more: { alignSelf: "flex-start", marginTop: 12 },
  photo: { aspectRatio: 3 / 2, backgroundColor: "rgba(255,255,255,0.06)" },
  photoTitle: { position: "absolute", top: 12, left: 16 },
  plainTitle: { paddingHorizontal: 16, paddingTop: 16 },
  artistBody: { padding: 16, paddingTop: 12 },
  name: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  factsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 10 },
  facts: { flexShrink: 1, color: "rgba(255,255,255,0.72)", fontSize: 13.5 },
});
