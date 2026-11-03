/**
 * Devices: a small smart-home room for everything that can make sound. A press on
 * a tile moves the music there; the plus lets it play along; its menu gives it
 * music of its own. What's playing stands on top as cards, with its volume per
 * device. Bluetooth is Android's own list: no app can connect those by itself.
 */
import { useNavigation } from "@react-navigation/native";
import { Bluetooth, ChevronDown, Headphones, Laptop, MoreHorizontal, Pause, Play, Plus, RefreshCw, SkipBack, SkipForward, Smartphone, Speaker, Tv, Volume2, X, type LucideIcon } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, ToastAndroid, View } from "react-native";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import Player, { type SoundOutput } from "../../modules/media3-player";
import type { RemoteDevice } from "../shared";
import { isAround, useDevices } from "../stores/devices";
import { usePlayer } from "../stores/player";
import {
  addDeviceByAddress,
  canPlay,
  deviceName,
  forgetDevice,
  looksLikeTv,
  moveMusicHere,
  moveMusicTo,
  pickMusicFor,
  playAlong,
  renameDevice,
  scanDevices,
  sendMusicToDevice,
  stopPlayingAlong,
  useZones,
  zoneNext,
  zonePrevious,
  zoneStop,
  zoneToggle,
  zoneVolume,
  type FoundDevice,
  type ZoneView,
} from "../stores/zones";
import { colors } from "../theme";

const SIDE = 16;
const GAP = 10;
const SEND_VOLUME_EVERY_MS = 200;

const iconOf = (d: FoundDevice): LucideIcon => (looksLikeTv(d) ? Tv : d.kind === "echo" ? Bluetooth : Speaker);

function SmallButton({ label, onPress, color, children }: { label: string; onPress: () => void; color?: string; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={6} style={({ pressed }) => [styles.small, pressed && { backgroundColor: color ? "rgba(0,0,0,0.12)" : colors.chip }]}>
      {children}
    </Pressable>
  );
}

/** A device, as a tile: filled while it's the one playing. */
function Tile({
  width,
  Icon,
  name,
  line,
  active,
  busy,
  dim,
  onPress,
  corner,
}: {
  width: number;
  Icon: LucideIcon;
  name: string;
  line: string;
  active?: boolean;
  busy?: boolean;
  dim?: boolean;
  onPress: () => void;
  corner?: ReactNode;
}) {
  const ink = active ? colors.onAccent : colors.ink;
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`${name}. ${line}`}
      style={({ pressed }) => [styles.tile, { width, opacity: dim ? 0.62 : 1 }, active && styles.tileActive, pressed && !active && styles.tilePressed]}
    >
      <View style={styles.tileTop}>
        <View style={[styles.tileIcon, active && styles.tileIconActive]}>{busy ? <ActivityIndicator size="small" color={ink} /> : <Icon size={20} color={ink} />}</View>
        {corner && <View style={styles.tileCorner}>{corner}</View>}
      </View>
      <Text numberOfLines={1} style={[styles.tileName, { color: ink }]}>
        {name}
      </Text>
      <Text numberOfLines={1} style={[styles.tileLine, { color: active ? "rgba(18,11,36,0.72)" : colors.dim }]}>
        {line}
      </Text>
    </Pressable>
  );
}

function VolumeBar({ value, onChange, ink }: { value: number; onChange: (v: number) => void; ink: string }) {
  const [drag, setDrag] = useState<number | null>(null);
  const width = useRef(1);
  const start = useRef(0);
  const sentAt = useRef(0);
  const change = useRef(onChange);
  change.current = onChange;

  const pan = useMemo(() => {
    const at = (x: number): number => Math.max(0, Math.min(1, x / width.current));
    const send = (v: number): void => {
      sentAt.current = Date.now();
      change.current(v);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        start.current = e.nativeEvent.locationX;
        setDrag(at(start.current));
      },
      onPanResponderMove: (_, g) => {
        const v = at(start.current + g.dx);
        setDrag(v);
        if (Date.now() - sentAt.current >= SEND_VOLUME_EVERY_MS) send(v);
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
    <View {...pan.panHandlers} onLayout={(e) => (width.current = Math.max(1, e.nativeEvent.layout.width))} style={styles.volume} accessibilityRole="adjustable" accessibilityLabel={`Volume ${Math.round(part * 100)} percent`}>
      <View pointerEvents="none" style={[styles.volumeTrack, { backgroundColor: ink === colors.ink ? colors.chip : "rgba(18,11,36,0.22)" }]}>
        <View style={[styles.volumeFill, { width: `${part * 100}%`, backgroundColor: ink }]} />
      </View>
      <View pointerEvents="none" style={[styles.volumeKnob, { left: `${part * 100}%`, backgroundColor: ink }]} />
    </View>
  );
}

/** What's playing on devices: a card per zone, its members with their own volume. */
function ZoneCard({ zone, onMenu }: { zone: ZoneView; onMenu: () => void }) {
  const ink = zone.main ? colors.onAccent : colors.ink;
  const isOn = zone.state === "playing" || zone.state === "loading";
  const names = zone.members.map((m) => m.name).join(" + ");
  const line = zone.error ?? (zone.song ? `${zone.song.title} · ${zone.song.artist}` : "Ready");
  const fill = ink === colors.onAccent ? ink : "transparent";
  return (
    <View style={[styles.card, zone.main ? styles.cardMain : styles.cardOwn]}>
      <View style={styles.cardHead}>
        <View style={styles.cardText}>
          <Text numberOfLines={1} style={[styles.cardName, { color: ink }]}>
            {names}
          </Text>
          <Text numberOfLines={1} style={[styles.cardLine, { color: zone.main ? "rgba(18,11,36,0.72)" : colors.dim }]}>
            {line}
          </Text>
        </View>
        <SmallButton label="More" onPress={onMenu} color={ink}>
          <MoreHorizontal size={20} color={ink} />
        </SmallButton>
      </View>
      {!!zone.song && (
        <View style={styles.cardControls}>
          <Pressable onPress={() => zonePrevious(zone.id)} accessibilityLabel="Previous" hitSlop={8} style={styles.cardButton}>
            <SkipBack size={22} color={ink} fill={ink === colors.ink ? ink : fill} />
          </Pressable>
          <Pressable onPress={() => zoneToggle(zone.id)} accessibilityLabel={isOn ? "Pause" : "Play"} hitSlop={8} style={[styles.cardPlay, { backgroundColor: ink }]}>
            {isOn ? <Pause size={20} color={zone.main ? colors.accent : colors.base} fill={zone.main ? colors.accent : colors.base} /> : <Play size={20} color={zone.main ? colors.accent : colors.base} fill={zone.main ? colors.accent : colors.base} />}
          </Pressable>
          <Pressable onPress={() => zoneNext(zone.id)} accessibilityLabel="Next" hitSlop={8} style={styles.cardButton}>
            <SkipForward size={22} color={ink} fill={ink === colors.ink ? ink : fill} />
          </Pressable>
        </View>
      )}
      {zone.members.map((m) => (
        <View key={m.id} style={styles.memberRow}>
          <Volume2 size={16} color={ink} />
          {zone.members.length > 1 && (
            <Text numberOfLines={1} style={[styles.memberName, { color: ink }]}>
              {m.name}
            </Text>
          )}
          {m.volume === null ? (
            <Text style={[styles.noVolume, { color: zone.main ? "rgba(18,11,36,0.72)" : colors.dim }]}>Volume on the device itself</Text>
          ) : (
            <VolumeBar value={m.volume} ink={ink} onChange={(v) => zoneVolume(zone.id, m.id, v)} />
          )}
          <SmallButton label={zone.members.length > 1 ? `${m.name} stops playing along` : `Stop playing on ${m.name}`} onPress={() => void stopPlayingAlong(zone.id, m.id)} color={ink}>
            <X size={18} color={ink} />
          </SmallButton>
        </View>
      ))}
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.grid}>{children}</View>
    </View>
  );
}

function outputLine(output: SoundOutput): string {
  if (output.kind === "phone") return "Speaker";
  return output.name || (output.kind === "bluetooth" ? "Bluetooth" : output.kind === "wired" ? "Headphones" : "TV");
}

interface MenuRow {
  label: string;
  run(): void;
}

export function DevicesScreen() {
  const nav = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { width } = useSafeAreaFrame();
  const found = useZones((s) => s.found);
  const scanning = useZones((s) => s.scanning);
  const noWifi = useZones((s) => s.noWifi);
  const busy = useZones((s) => s.connecting);
  const names = useZones((s) => s.names);
  const zones = useZones((s) => s.zones);
  const others = useDevices((s) => s.others);
  const remote = usePlayer((s) => s.remote);
  const device = usePlayer((s) => s.device);
  const playing = usePlayer((s) => s.playWhenReady);
  const track = usePlayer((s) => s.queue[s.index]);
  const [output, setOutput] = useState<SoundOutput>({ kind: "phone", name: "" });
  const [menu, setMenu] = useState<{ title: string; rows: MenuRow[] } | null>(null);
  const [asking, setAsking] = useState<{ title: string; hint: string; value: string; save: string; run(value: string): void } | null>(null);

  useEffect(() => {
    void scanDevices();
    void Player.getOutput().then(setOutput).catch(() => undefined);
    const sub = Player.addListener("onOutput", setOutput);
    return () => sub.remove();
  }, []);

  const tileWidth = (width - SIDE * 2 - GAP) / 2;
  const main = zones.find((z) => z.main);
  const taken = new Set(zones.flatMap((z) => z.members.map((m) => m.id)));
  const free = found.filter((d) => canPlay(d) && !taken.has(d.id));
  const pairOnly = found.filter((d) => !canPlay(d));
  const around = others.filter(isAround);
  const hereActive = !remote && !device;

  const renameRow = (d: FoundDevice): MenuRow => ({
    label: "Rename",
    run: () => setAsking({ title: "Rename this device", hint: d.name, value: deviceName(d, names), save: "Save", run: (value) => renameDevice(d, value) }),
  });

  const deviceMenu = (d: FoundDevice): void => {
    const rows: MenuRow[] = [];
    if (canPlay(d)) {
      rows.push({
        label: "Play something else here",
        run: () => {
          pickMusicFor(d);
          nav.goBack();
        },
      });
      for (const z of zones) {
        if (!z.members.some((m) => m.id === d.id)) rows.push({ label: `Play along with ${z.members.map((m) => m.name).join(" + ")}`, run: () => void playAlong(z.id, d) });
      }
    }
    rows.push(renameRow(d));
    if (d.byHand) rows.push({ label: "Remove from this list", run: () => forgetDevice(d.id) });
    setMenu({ title: deviceName(d, names), rows });
  };

  const zoneMenu = (z: ZoneView): void => {
    const first = found.find((d) => d.id === z.members[0]?.id);
    const rows: MenuRow[] = [];
    if (first) {
      rows.push({
        label: z.main ? "Play something else here" : "Choose other music",
        run: () => {
          pickMusicFor(first);
          nav.goBack();
        },
      });
      rows.push(renameRow(first));
    }
    rows.push({ label: z.main ? "Back to this phone" : "Stop the music here", run: () => void zoneStop(z.id) });
    setMenu({ title: z.members.map((m) => m.name).join(" + "), rows });
  };

  const explainPairing = (d: FoundDevice): void => {
    Alert.alert(
      deviceName(d, names),
      d.kind === "echo"
        ? 'Amazon lets no app send music to an Echo directly, but it works as a Bluetooth speaker. Say "Alexa, connect", pair it in Android\'s Bluetooth settings once, and from then on pick it under Bluetooth & more.'
        : "A Fire TV can't be sent music directly. It can pair as a Bluetooth speaker, or run Songsta for Android TV one day.",
      [{ text: "Close", style: "cancel" }, { text: "Bluetooth & more", onPress: () => void Player.chooseOutput() }],
      { cancelable: true }
    );
  };

  const toHere = (): void => {
    if (remote) usePlayer.getState().takeHere();
    else if (device) moveMusicHere();
  };

  const otherLine = (d: RemoteDevice): string => {
    const song = d.presence.track;
    return song ? `${d.presence.playing ? "" : "Paused · "}${song.title}` : "Ready";
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} accessibilityLabel="Close" hitSlop={8} style={styles.headerButton}>
          <ChevronDown size={28} color={colors.ink} />
        </Pressable>
        <Text style={styles.title}>Devices</Text>
        <Pressable onPress={() => void scanDevices()} accessibilityLabel="Look again" hitSlop={8} style={styles.headerButton}>
          {scanning ? <ActivityIndicator size="small" color={colors.ink} /> : <RefreshCw size={21} color={colors.ink} />}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
        {zones.length > 0 && (
          <View style={styles.cards}>
            {zones.map((z) => (
              <ZoneCard key={z.id} zone={z} onMenu={() => zoneMenu(z)} />
            ))}
          </View>
        )}

        <Section title="This phone">
          <Tile
            width={tileWidth}
            Icon={output.kind === "bluetooth" ? Bluetooth : output.kind === "wired" ? Headphones : output.kind === "tv" ? Tv : Smartphone}
            name="This phone"
            line={hereActive && playing && track ? `Playing · ${outputLine(output)}` : outputLine(output)}
            active={hereActive}
            onPress={toHere}
          />
          <Tile width={tileWidth} Icon={Bluetooth} name="Bluetooth & more" line="Android's list of outputs" onPress={() => void Player.chooseOutput()} />
        </Section>

        {around.length > 0 && (
          <Section title="Your other devices">
            {around.map((d) => (
              <Tile
                key={d.id}
                width={tileWidth}
                Icon={d.presence.kind === "computer" ? Laptop : Smartphone}
                name={d.presence.name}
                line={otherLine(d)}
                active={remote?.id === d.id}
                onPress={() => {
                  if (remote?.id !== d.id) void sendMusicToDevice(d.id, d.presence.name);
                }}
              />
            ))}
          </Section>
        )}

        <Section title="Speakers, receivers and TVs">
          {free.length === 0 && (
            <Text style={styles.empty}>
              {noWifi ? "Connect to your Wi-Fi to see them." : scanning ? "Looking on your network…" : zones.length ? "All of them are playing." : "Nothing found on your network."}
            </Text>
          )}
          {free.map((d) => (
            <Tile
              key={d.id}
              width={tileWidth}
              Icon={iconOf(d)}
              name={deviceName(d, names)}
              line={d.model || "Ready"}
              busy={busy === d.id}
              onPress={() => void moveMusicTo(d)}
              corner={
                <>
                  {main && (
                    <SmallButton label={`${deviceName(d, names)} plays along`} onPress={() => void playAlong(main.id, d)}>
                      <Plus size={18} color={colors.ink} />
                    </SmallButton>
                  )}
                  <SmallButton label={`More about ${deviceName(d, names)}`} onPress={() => deviceMenu(d)}>
                    <MoreHorizontal size={18} color={colors.ink} />
                  </SmallButton>
                </>
              }
            />
          ))}
        </Section>

        {pairOnly.length > 0 && (
          <Section title="Over Bluetooth">
            {pairOnly.map((d) => (
              <Tile
                key={d.id}
                width={tileWidth}
                Icon={iconOf(d)}
                name={deviceName(d, names)}
                line={d.kind === "echo" ? "Pair it as a speaker" : "Can't be sent music"}
                dim
                onPress={() => explainPairing(d)}
                corner={
                  <SmallButton label={`More about ${deviceName(d, names)}`} onPress={() => deviceMenu(d)}>
                    <MoreHorizontal size={18} color={colors.ink} />
                  </SmallButton>
                }
              />
            ))}
          </Section>
        )}

        <Pressable
          onPress={() =>
            setAsking({
              title: "Add a device by its address",
              hint: "192.168.1.20",
              value: "",
              save: "Add",
              run: (value) => {
                if (!value.trim()) return;
                void addDeviceByAddress(value).then((name) => ToastAndroid.show(name ? `Found ${name}` : "Nothing playable answers there", ToastAndroid.SHORT));
              },
            })
          }
          style={styles.addRow}
        >
          <Plus size={18} color={colors.dim} />
          <Text style={styles.addText}>Add a device by its address</Text>
        </Pressable>
      </ScrollView>

      <Modal visible={!!menu} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setMenu(null)}>
        <Pressable style={styles.back} onPress={() => setMenu(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
            <Text numberOfLines={1} style={styles.sheetTitle}>
              {menu?.title}
            </Text>
            {menu?.rows.map((row) => (
              <Pressable
                key={row.label}
                style={styles.sheetRow}
                onPress={() => {
                  setMenu(null);
                  row.run();
                }}
              >
                <Text numberOfLines={1} style={styles.sheetText}>
                  {row.label}
                </Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!asking} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setAsking(null)}>
        <Pressable style={styles.dialogBack} onPress={() => setAsking(null)}>
          <Pressable style={styles.dialog}>
            <Text style={styles.dialogTitle}>{asking?.title}</Text>
            <TextInput
              value={asking?.value ?? ""}
              onChangeText={(value) => setAsking((a) => a && { ...a, value })}
              placeholder={asking?.hint}
              placeholderTextColor={colors.dim}
              autoFocus
              selectTextOnFocus
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.dialogInput}
            />
            <View style={styles.dialogButtons}>
              <Pressable onPress={() => setAsking(null)} style={styles.dialogButton}>
                <Text style={styles.dialogCancel}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (asking) asking.run(asking.value);
                  setAsking(null);
                }}
                style={styles.dialogButton}
              >
                <Text style={styles.dialogSave}>{asking?.save}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, height: 48 },
  headerButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, textAlign: "center", color: colors.ink, fontSize: 16, fontWeight: "700" },
  cards: { paddingHorizontal: SIDE, gap: GAP, marginTop: 6 },
  card: { borderRadius: 18, padding: 14 },
  cardMain: { backgroundColor: colors.accent },
  cardOwn: { backgroundColor: colors.panel, borderWidth: 1.5, borderColor: colors.accent },
  cardHead: { flexDirection: "row", alignItems: "flex-start" },
  cardText: { flex: 1, minWidth: 0, marginRight: 6 },
  cardName: { fontSize: 16, fontWeight: "700" },
  cardLine: { fontSize: 13, marginTop: 2 },
  cardControls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 26, marginTop: 10 },
  cardButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  cardPlay: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, minHeight: 34 },
  memberName: { width: 82, fontSize: 13 },
  noVolume: { flex: 1, fontSize: 12 },
  volume: { flex: 1, height: 34, justifyContent: "center" },
  volumeTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  volumeFill: { height: 4 },
  volumeKnob: { position: "absolute", width: 14, height: 14, borderRadius: 7, marginLeft: -7, top: 10 },
  section: { marginTop: 22, paddingHorizontal: SIDE },
  sectionTitle: { color: colors.dim, fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  empty: { color: colors.dim, fontSize: 14, paddingVertical: 6 },
  tile: { minHeight: 112, borderRadius: 18, backgroundColor: colors.panel, padding: 12, justifyContent: "space-between" },
  tileActive: { backgroundColor: colors.accent },
  tilePressed: { backgroundColor: colors.button },
  tileTop: { flexDirection: "row", alignItems: "flex-start", marginBottom: 10 },
  tileIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.tile, alignItems: "center", justifyContent: "center" },
  tileIconActive: { backgroundColor: "rgba(18,11,36,0.12)" },
  tileCorner: { flex: 1, flexDirection: "row", justifyContent: "flex-end", marginRight: -4, marginTop: -4 },
  tileName: { fontSize: 15, fontWeight: "700" },
  tileLine: { fontSize: 12.5, marginTop: 2 },
  small: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  addRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 22, paddingHorizontal: SIDE, height: 40 },
  addText: { color: colors.dim, fontSize: 14 },
  back: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.sheet, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 16 },
  sheetTitle: { color: colors.ink, fontSize: 16, fontWeight: "600", paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  sheetRow: { height: 52, justifyContent: "center", paddingHorizontal: 20 },
  sheetText: { color: colors.ink, fontSize: 16 },
  dialogBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", paddingHorizontal: 28 },
  dialog: { backgroundColor: colors.sheet, borderRadius: 16, padding: 18 },
  dialogTitle: { color: colors.ink, fontSize: 16, fontWeight: "700" },
  dialogInput: { color: colors.ink, fontSize: 16, backgroundColor: colors.tile, borderRadius: 10, paddingHorizontal: 12, height: 46, marginTop: 14 },
  dialogButtons: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 14 },
  dialogButton: { height: 40, paddingHorizontal: 12, justifyContent: "center" },
  dialogCancel: { color: colors.soft, fontSize: 15 },
  dialogSave: { color: colors.accent, fontSize: 15, fontWeight: "700" },
});
