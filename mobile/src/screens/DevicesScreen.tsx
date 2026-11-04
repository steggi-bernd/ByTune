/**
 * Devices: a small smart-home room for everything that can make sound. A press on
 * a tile moves the music there; the plus lets it play along; its menu gives it
 * music of its own. What's playing stands on top as cards, with its volume per
 * device. Your other devices with Songsta share one stream: this page steers it,
 * "This phone" brings it here, and that tile's menu starts a second one. Bluetooth
 * is Android's own list: no app can connect those by itself.
 */
import { useNavigation } from "@react-navigation/native";
import { Bluetooth, Check, ChevronDown, CircleStop, Headphones, Heart, Laptop, Link2, ListChecks, ListMusic, MoreHorizontal, Pause, Pencil, Play, Plus, RefreshCw, Search, SkipBack, SkipForward, Smartphone, Speaker, Split, Trash2, Tv, Volume2, X, type LucideIcon } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaFrame, useSafeAreaInsets } from "react-native-safe-area-context";
import Player, { type SoundOutput } from "../../modules/media3-player";
import { NameDialog } from "../components/PlaylistSheets";
import { MenuSheet, type SheetRow } from "../components/Sheet";
import { Cover, CoverGrid, SearchField } from "../components/ui";
import { VolumeBar } from "../components/VolumeBar";
import { matchesQuery, plural, type RemoteDevice, type Track } from "../shared";
import { isAround, useDevices } from "../stores/devices";
import { likedSongIds, useLibrary } from "../stores/library";
import { endSecondStream, startSecondStream, usePlayer } from "../stores/player";
import { playlistTracks, usePlaylists } from "../stores/playlists";
import { showDialog, toast } from "../stores/popups";
import { feel } from "../stores/settings";
import {
  addDeviceByAddress,
  canPlay,
  deviceName,
  forgetDevice,
  looksLikeTv,
  moveMusicHere,
  moveMusicTo,
  moveMusicToMany,
  pickMusicFor,
  playAlong,
  renameDevice,
  scanDevices,
  sendMusicToDevice,
  startOwnMusicOn,
  stopPlayingAlong,
  THIS_PHONE,
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
import { T } from "../shared";

const SIDE = 16;
const GAP = 10;

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
  onLongPress,
  picked,
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
  onLongPress?: () => void;
  /** choosing several: on or off, or null when it can't be one of them */
  picked?: boolean | null;
  corner?: ReactNode;
}) {
  const ink = active ? colors.onAccent : colors.ink;
  return (
    <Pressable
      onPress={() => {
        feel("tick");
        onPress();
      }}
      onLongPress={
        onLongPress &&
        (() => {
          feel("press");
          onLongPress();
        })
      }
      accessibilityLabel={`${name}. ${line}`}
      accessibilityState={picked === undefined || picked === null ? undefined : { checked: picked }}
      style={({ pressed }) => [styles.tile, { width, opacity: dim || picked === null ? 0.62 : 1 }, active && styles.tileActive, picked && styles.tilePicked, pressed && !active && styles.tilePressed]}
    >
      <View style={styles.tileTop}>
        <View style={[styles.tileIcon, active && styles.tileIconActive]}>{busy ? <ActivityIndicator size="small" color={ink} /> : <Icon size={20} color={ink} />}</View>
        {picked === true || picked === false ? (
          <View style={styles.tileCorner}>
            <View style={[styles.tick, picked && styles.tickOn]}>{picked && <Check size={16} color={colors.onAccent} strokeWidth={3} />}</View>
          </View>
        ) : (
          corner && <View style={styles.tileCorner}>{corner}</View>
        )}
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

/** What's playing on devices: a card per zone, its members with their own volume. */
function ZoneCard({ zone, onMenu }: { zone: ZoneView; onMenu: () => void }) {
  const ink = zone.main ? colors.onAccent : colors.ink;
  const isOn = zone.state === "playing" || zone.state === "loading";
  const names = zone.members.map((m) => m.name).join(" + ");
  const line = zone.error ?? (zone.song ? `${zone.song.title} · ${zone.song.artist}` : T("Ready"));
  const fill = ink === colors.onAccent ? ink : "transparent";
  return (
    <View style={[styles.card, zone.main ? styles.cardMain : styles.cardOwn]}>
      <View style={styles.cardHead}>
        <View style={styles.cardText}>
          <Text numberOfLines={1} style={[styles.cardName, { color: ink }]}>
            {names}
          </Text>
          <Text numberOfLines={zone.error ? 3 : 1} style={[styles.cardLine, { color: zone.main ? "rgba(18,11,36,0.72)" : colors.dim }]}>
            {line}
          </Text>
        </View>
        <SmallButton label={T("More")} onPress={onMenu} color={ink}>
          <MoreHorizontal size={20} color={ink} />
        </SmallButton>
      </View>
      {!!zone.song && (
        <View style={styles.cardControls}>
          <Pressable onPress={() => zonePrevious(zone.id)} accessibilityLabel={T("Previous")} hitSlop={8} style={styles.cardButton}>
            <SkipBack size={22} color={ink} fill={ink === colors.ink ? ink : fill} />
          </Pressable>
          <Pressable onPress={() => zoneToggle(zone.id)} accessibilityLabel={isOn ? T("Pause") : T("Play")} hitSlop={8} style={[styles.cardPlay, { backgroundColor: ink }]}>
            {isOn ? <Pause size={20} color={zone.main ? colors.accent : colors.base} fill={zone.main ? colors.accent : colors.base} /> : <Play size={20} color={zone.main ? colors.accent : colors.base} fill={zone.main ? colors.accent : colors.base} />}
          </Pressable>
          <Pressable onPress={() => zoneNext(zone.id)} accessibilityLabel={T("Next")} hitSlop={8} style={styles.cardButton}>
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
            <Text style={[styles.noVolume, { color: zone.main ? "rgba(18,11,36,0.72)" : colors.dim }]}>{T("Volume on the device itself")}</Text>
          ) : (
            <VolumeBar value={m.volume} ink={ink} onChange={(v) => zoneVolume(zone.id, m.id, v)} />
          )}
          <SmallButton label={zone.members.length > 1 ? T("{name} stops playing along", { name: m.name }) : T("Stop playing on {name}", { name: m.name })} onPress={() => void stopPlayingAlong(zone.id, m.id)} color={ink}>
            <X size={18} color={ink} />
          </SmallButton>
        </View>
      ))}
    </View>
  );
}

/** The stream on another device with Songsta on it: shown and steered from here, its volume too. */
function FollowedCard() {
  const remote = usePlayer((s) => s.remote);
  const song = usePlayer((s) => s.queue[s.index]);
  const volume = usePlayer((s) => s.remoteVolume);
  const { toggle, next, previous, setRemoteVolume } = usePlayer.getState();
  if (!remote || !song) return null;
  const ink = colors.onAccent;
  const press = (run: () => void) => () => {
    feel("tick");
    run();
  };
  return (
    <View style={[styles.card, styles.cardMain]}>
      <View style={styles.cardHead}>
        <View style={styles.cardText}>
          <Text numberOfLines={1} style={[styles.cardName, { color: ink }]}>
            {remote.name}
          </Text>
          <Text numberOfLines={1} style={[styles.cardLine, { color: "rgba(18,11,36,0.72)" }]}>
            {song.title} · {song.artist}
          </Text>
        </View>
      </View>
      <View style={styles.cardControls}>
        <Pressable onPress={press(previous)} accessibilityLabel={T("Previous")} hitSlop={8} style={styles.cardButton}>
          <SkipBack size={22} color={ink} fill={ink} />
        </Pressable>
        <Pressable onPress={press(toggle)} accessibilityLabel={remote.playing ? T("Pause") : T("Play")} hitSlop={8} style={[styles.cardPlay, { backgroundColor: ink }]}>
          {remote.playing ? <Pause size={20} color={colors.accent} fill={colors.accent} /> : <Play size={20} color={colors.accent} fill={colors.accent} />}
        </Pressable>
        <Pressable onPress={press(next)} accessibilityLabel={T("Next")} hitSlop={8} style={styles.cardButton}>
          <SkipForward size={22} color={ink} fill={ink} />
        </Pressable>
      </View>
      {volume !== null && (
        <View style={styles.memberRow}>
          <Volume2 size={16} color={ink} />
          <VolumeBar value={volume} ink={ink} onChange={setRemoteVolume} />
        </View>
      )}
    </View>
  );
}

/** What a device, or several, should play: without leaving this page. */
function MusicSheet({ devices, onClose, onBrowse }: { devices: FoundDevice[]; onClose: () => void; onBrowse: () => void }) {
  const insets = useSafeAreaInsets();
  const data = useLibrary((s) => s.data);
  const byId = useLibrary((s) => s.byId);
  const albums = useLibrary((s) => s.albums);
  const playlists = usePlaylists((s) => s.playlists);
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const [query, setQuery] = useState("");
  const names = useZones((s) => s.names);
  const rows = useMemo(() => {
    const wanted = (name: string): boolean => !query.trim() || name.toLowerCase().includes(query.trim().toLowerCase());
    const out: { key: string; title: string; line: string; tracks: Track[]; art: ReactNode }[] = [];
    if (queue.length && !query.trim()) {
      out.push({ key: "queue", title: T("What's playing now"), line: T("The same list, from this song on"), tracks: queue.slice(index), art: <View style={styles.sheetIcon}><ListMusic size={22} color={colors.accent} /></View> });
    }
    const liked = likedSongIds(data.favorites, byId).map((id) => byId.get(id)).filter((t): t is Track => !!t);
    if (liked.length && wanted(T("Liked Songs"))) out.push({ key: "liked", title: T("Liked Songs"), line: plural(liked.length, T("song"), T("songs")), tracks: liked, art: <View style={styles.sheetIcon}><Heart size={22} color={colors.accent} fill={colors.accent} /></View> });
    for (const p of playlists) {
      const tracks = playlistTracks(p).filter((t) => !t.missing);
      if (tracks.length && wanted(p.name)) out.push({ key: p.id, title: p.name, line: T("Playlist · {count}", { count: plural(tracks.length, T("song"), T("songs")) }), tracks, art: <CoverGrid tracks={tracks} size={48} /> });
    }
    for (const a of albums) if (wanted(a.title) || wanted(a.artist)) out.push({ key: a.key, title: a.title, line: T("Album · {artist}", { artist: a.artist }), tracks: a.tracks, art: <Cover uri={a.thumb} size={48} /> });
    // Songs by name, once somebody is looking for one.
    if (query.trim()) for (const t of data.tracks) if (matchesQuery(t, query)) out.push({ key: t.id, title: t.title, line: T("Song · {artist}", { artist: t.artist }), tracks: [t], art: <Cover uri={t.thumb} size={48} /> });
    return out;
  }, [query, queue, index, data, byId, albums, playlists]);
  const label = devices.map((d) => deviceName(d, names)).join(" + ");
  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.musicSheet, { paddingTop: insets.top + 6 }]}>
        <View style={styles.musicHead}>
          <Pressable onPress={onClose} accessibilityLabel={T("Close")} hitSlop={8} style={styles.headerButton}>
            <X size={24} color={colors.ink} />
          </Pressable>
          <Text numberOfLines={1} style={styles.musicTitle}>{T("Music for {label}", { label })}
          </Text>
        </View>
        <SearchField value={query} onChange={setQuery} placeholder={T("Albums, playlists, songs")} style={styles.musicSearch} />
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListHeaderComponent={
            <Pressable onPress={onBrowse} style={styles.musicRow}>
              <View style={styles.sheetIcon}>
                <Search size={22} color={colors.ink} />
              </View>
              <View style={styles.musicText}>
                <Text style={styles.musicRowTitle}>{T("Look through the whole library")}</Text>
                <Text style={styles.musicRowLine}>{T("Whatever you start next plays there")}</Text>
              </View>
            </Pressable>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => {
                onClose();
                void startOwnMusicOn(devices, item.tracks);
              }}
              style={styles.musicRow}
            >
              {item.art}
              <View style={styles.musicText}>
                <Text numberOfLines={1} style={styles.musicRowTitle}>
                  {item.title}
                </Text>
                <Text numberOfLines={1} style={styles.musicRowLine}>
                  {item.line}
                </Text>
              </View>
            </Pressable>
          )}
        />
      </View>
    </Modal>
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
  if (output.kind === "phone") return T("Speaker");
  return output.name || (output.kind === "bluetooth" ? T("Bluetooth") : output.kind === "wired" ? T("Headphones") : "TV");
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
  const secondStream = usePlayer((s) => s.secondStream);
  const playing = usePlayer((s) => s.playWhenReady);
  const track = usePlayer((s) => s.queue[s.index]);
  const [output, setOutput] = useState<SoundOutput>({ kind: "phone", name: "" });
  const [menu, setMenu] = useState<{ title: string; rows: SheetRow[] } | null>(null);
  const [asking, setAsking] = useState<{ title: string; hint: string; value: string; save: string; address?: boolean; run(value: string): void } | null>(null);
  /** choosing several at once; a tap on a tile then only marks it */
  const [choosing, setChoosing] = useState<Set<string> | null>(null);
  const [musicFor, setMusicFor] = useState<FoundDevice[] | null>(null);

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
  const phoneInGroup = taken.has(THIS_PHONE.id);
  const hereActive = (!remote && !device) || phoneInGroup;
  const chosenDevices = (): FoundDevice[] => {
    const all = [...found, THIS_PHONE];
    return choosing ? all.filter((d) => choosing.has(d.id)) : [];
  };
  const toggleChosen = (id: string): void => {
    if (!choosing) return;
    const next = new Set(choosing);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChoosing(next);
  };
  const startChoosing = (id: string): void => setChoosing(new Set([id]));
  /** Back to the library with the banner on; the others of a choice go along. */
  const browseFor = (devices: FoundDevice[]): void => {
    const others = devices.filter((d) => d.id !== THIS_PHONE.id);
    if (!others.length) return;
    setMusicFor(null);
    setChoosing(null);
    pickMusicFor(others[0], others.slice(1));
    nav.goBack();
  };

  const renameRow = (d: FoundDevice): SheetRow => ({
    label: T("Rename"),
    Icon: Pencil,
    run: () => setAsking({ title: T("Rename this device"), hint: d.name, value: deviceName(d, names), save: T("Save"), run: (value) => renameDevice(d, value) }),
  });

  const deviceMenu = (d: FoundDevice): void => {
    const rows: SheetRow[] = [];
    if (canPlay(d)) {
      rows.push({ label: T("Choose music for this device"), Icon: ListMusic, run: () => setMusicFor([d]) });
      for (const z of zones) {
        if (!z.members.some((m) => m.id === d.id)) rows.push({ label: T("Play along with {join}", { join: z.members.map((m) => m.name).join(" + ") }), Icon: Link2, run: () => void playAlong(z.id, d) });
      }
      rows.push({ label: T("Choose several devices"), Icon: ListChecks, run: () => startChoosing(d.id) });
    }
    rows.push(renameRow(d));
    if (d.byHand) rows.push({ label: T("Remove from this list"), Icon: Trash2, danger: true, run: () => forgetDevice(d.id) });
    setMenu({ title: deviceName(d, names), rows });
  };

  /** This phone's own menu: a second stream next to what plays elsewhere, and back to one. */
  const hereMenu = (): void => {
    const rows: SheetRow[] = [];
    if (remote) {
      rows.push({
        label: T("Start a second stream"),
        Icon: Split,
        run: () => {
          const name = startSecondStream();
          if (name) toast(T("Second stream: what you start now plays here. {name} goes on by itself.", { name }), true);
        },
      });
    }
    if (secondStream) rows.push({ label: T("End the second stream"), Icon: CircleStop, run: endSecondStream });
    rows.push({ label: T("Choose several devices"), Icon: ListChecks, run: () => startChoosing(THIS_PHONE.id) });
    setMenu({ title: T("This phone"), rows });
  };

  const zoneMenu = (z: ZoneView): void => {
    const first = found.find((d) => d.id === z.members[0]?.id);
    const rows: SheetRow[] = [];
    if (first) {
      rows.push({ label: z.main ? T("Choose other music for this device") : T("Choose other music"), Icon: ListMusic, run: () => setMusicFor([first]) });
      rows.push(renameRow(first));
    }
    rows.push({ label: z.main ? T("Back to this phone") : T("Stop the music here"), Icon: z.main ? Smartphone : CircleStop, run: () => void zoneStop(z.id) });
    setMenu({ title: z.members.map((m) => m.name).join(" + "), rows });
  };

  const explainPairing = (d: FoundDevice): void => {
    showDialog(
      deviceName(d, names),
      d.kind === "echo" ? T("Amazon lets no app send music to an Echo directly, but it works as a Bluetooth speaker. Say \"Alexa, connect\", pair it in Android's Bluetooth settings once, and from then on pick it under Bluetooth & more.") : T("A Fire TV can't be sent music directly. It can pair as a Bluetooth speaker, or run Songsta for Android TV one day."),
      [{ text: T("Close"), style: "cancel" }, { text: T("Bluetooth & more"), onPress: () => void Player.chooseOutput() }],
      { cancelable: true }
    );
  };

  const toHere = (): void => {
    if (remote) usePlayer.getState().takeHere();
    else if (device) moveMusicHere();
  };

  const otherLine = (d: RemoteDevice): string => {
    const song = d.presence.track;
    return song ? `${d.presence.separate ? T("Second stream · ") : ""}${d.presence.playing ? "" : T("Paused · ")}${song.title}` : T("Ready");
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 4 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => nav.goBack()} accessibilityLabel={T("Close")} hitSlop={8} style={styles.headerButton}>
          <ChevronDown size={28} color={colors.ink} />
        </Pressable>
        <Text style={styles.title}>{T("Devices")}</Text>
        <Pressable onPress={() => void scanDevices()} accessibilityLabel={T("Look again")} hitSlop={8} style={styles.headerButton}>
          {scanning ? <ActivityIndicator size="small" color={colors.ink} /> : <RefreshCw size={21} color={colors.ink} />}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + (choosing ? 150 : 28) }} showsVerticalScrollIndicator={false}>
        {(zones.length > 0 || !!remote) && (
          <View style={styles.cards}>
            <FollowedCard />
            {zones.map((z) => (
              <ZoneCard key={z.id} zone={z} onMenu={() => zoneMenu(z)} />
            ))}
          </View>
        )}

        <Section title={T("This phone")}>
          <Tile
            width={tileWidth}
            Icon={output.kind === "bluetooth" ? Bluetooth : output.kind === "wired" ? Headphones : output.kind === "tv" ? Tv : Smartphone}
            name={T("This phone")}
            line={secondStream ? (playing ? T("Second stream · playing") : T("Second stream")) : hereActive && playing && track ? T("Playing · {outputLine}", { outputLine: outputLine(output) }) : outputLine(output)}
            active={hereActive && !choosing}
            picked={choosing ? choosing.has(THIS_PHONE.id) : undefined}
            onPress={() => (choosing ? toggleChosen(THIS_PHONE.id) : toHere())}
            onLongPress={hereMenu}
            corner={
              <>
                {main && !phoneInGroup && (
                  <SmallButton label={T("This phone plays along")} onPress={() => void playAlong(main.id, THIS_PHONE)}>
                    <Plus size={18} color={colors.ink} />
                  </SmallButton>
                )}
                <SmallButton label={T("More about this phone")} onPress={hereMenu} color={hereActive ? colors.onAccent : undefined}>
                  <MoreHorizontal size={18} color={hereActive ? colors.onAccent : colors.ink} />
                </SmallButton>
              </>
            }
          />
          <Tile
            width={tileWidth}
            Icon={Bluetooth}
            name={T("Bluetooth & more")}
            line={T("Android's list of outputs")}
            picked={choosing ? null : undefined}
            onPress={() => {
              if (!choosing) void Player.chooseOutput();
            }}
          />
        </Section>

        {around.length > 0 && (
          <Section title={T("Your other devices")}>
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

        <Section title={T("Speakers, receivers and TVs")}>
          {free.length === 0 && (
            <Text style={styles.empty}>
              {noWifi ? T("Connect to your Wi-Fi to see them.") : scanning ? T("Looking on your network…") : zones.length ? T("All of them are playing.") : T("Nothing found on your network.")}
            </Text>
          )}
          {free.map((d) => (
            <Tile
              key={d.id}
              width={tileWidth}
              Icon={iconOf(d)}
              name={deviceName(d, names)}
              line={d.model || T("Ready")}
              busy={busy === d.id}
              picked={choosing ? choosing.has(d.id) : undefined}
              onPress={() => (choosing ? toggleChosen(d.id) : void moveMusicTo(d))}
              onLongPress={() => deviceMenu(d)}
              corner={
                <>
                  {main && (
                    <SmallButton label={T("{deviceName} plays along", { deviceName: deviceName(d, names) })} onPress={() => void playAlong(main.id, d)}>
                      <Plus size={18} color={colors.ink} />
                    </SmallButton>
                  )}
                  <SmallButton label={T("More about {deviceName}", { deviceName: deviceName(d, names) })} onPress={() => deviceMenu(d)}>
                    <MoreHorizontal size={18} color={colors.ink} />
                  </SmallButton>
                </>
              }
            />
          ))}
        </Section>

        {pairOnly.length > 0 && (
          <Section title={T("Over Bluetooth")}>
            {pairOnly.map((d) => (
              <Tile
                key={d.id}
                width={tileWidth}
                Icon={iconOf(d)}
                name={deviceName(d, names)}
                line={d.kind === "echo" ? T("Pair it as a speaker") : T("Can't be sent music")}
                dim
                picked={choosing ? null : undefined}
                onPress={() => {
                  if (!choosing) explainPairing(d);
                }}
                onLongPress={() => deviceMenu(d)}
                corner={
                  <SmallButton label={T("More about {deviceName}", { deviceName: deviceName(d, names) })} onPress={() => deviceMenu(d)}>
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
              title: T("Add a device by its address"),
              hint: "192.168.1.20",
              address: true,
              value: "",
              save: T("Add"),
              run: (value) => {
                if (!value.trim()) return;
                void addDeviceByAddress(value).then((name) => toast(name ? T("Found {name}", { name }) : T("Nothing playable answers there")));
              },
            })
          }
          style={styles.addRow}
        >
          <Plus size={18} color={colors.dim} />
          <Text style={styles.addText}>{T("Add a device by its address")}</Text>
        </Pressable>
      </ScrollView>

      {choosing && (
        <View style={[styles.chooseBar, { paddingBottom: insets.bottom + 12 }]}>
          <View style={styles.chooseHead}>
            <Text style={styles.chooseCount}>{T("{count} chosen", { count: plural(choosing.size, T("device"), T("devices")) })}</Text>
            <Pressable onPress={() => setChoosing(null)} hitSlop={8} accessibilityLabel={T("Stop choosing")}>
              <Text style={styles.chooseCancel}>{T("Cancel")}</Text>
            </Pressable>
          </View>
          <View style={styles.chooseButtons}>
            <Pressable
              disabled={!choosing.size}
              onPress={() => {
                const devices = chosenDevices();
                setChoosing(null);
                void moveMusicToMany(devices);
              }}
              style={[styles.chooseMain, !choosing.size && styles.chooseOff]}
            >
              <Text style={styles.chooseMainText}>{T("Play here together")}</Text>
            </Pressable>
            <Pressable
              disabled={!chosenDevices().some((d) => d.id !== THIS_PHONE.id)}
              onPress={() => {
                setMusicFor(chosenDevices().filter((d) => d.id !== THIS_PHONE.id));
                setChoosing(null);
              }}
              style={[styles.chooseOther, !chosenDevices().some((d) => d.id !== THIS_PHONE.id) && styles.chooseOff]}
            >
              <Text style={styles.chooseOtherText}>{T("Other music")}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {!!musicFor && <MusicSheet devices={musicFor} onClose={() => setMusicFor(null)} onBrowse={() => browseFor(musicFor)} />}

      <MenuSheet visible={!!menu} title={menu?.title} rows={menu?.rows ?? []} onClose={() => setMenu(null)} />

      <NameDialog
        visible={!!asking}
        title={asking?.title ?? ""}
        placeholder={asking?.hint ?? ""}
        initial={asking?.value ?? ""}
        action={asking?.save ?? ""}
        address={asking?.address}
        allowEmpty
        onCancel={() => setAsking(null)}
        onDone={(value) => {
          asking?.run(value);
          setAsking(null);
        }}
      />
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
  section: { marginTop: 22, paddingHorizontal: SIDE },
  sectionTitle: { color: colors.dim, fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 10 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  empty: { color: colors.dim, fontSize: 14, paddingVertical: 6 },
  tile: { minHeight: 112, borderRadius: 18, backgroundColor: colors.panel, padding: 12, justifyContent: "space-between" },
  tileActive: { backgroundColor: colors.accent },
  tilePressed: { backgroundColor: colors.button },
  tilePicked: { borderWidth: 2, borderColor: colors.accent, padding: 10 },
  tick: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.dim, alignItems: "center", justifyContent: "center" },
  tickOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chooseBar: { position: "absolute", left: 0, right: 0, bottom: 0, backgroundColor: colors.sheet, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingHorizontal: 16, paddingTop: 14 },
  chooseHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  chooseCount: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  chooseCancel: { color: colors.soft, fontSize: 14 },
  chooseButtons: { flexDirection: "row", gap: 10 },
  chooseMain: { flex: 1, height: 46, borderRadius: 23, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  chooseMainText: { color: colors.onAccent, fontSize: 14.5, fontWeight: "700" },
  chooseOther: { flex: 1, height: 46, borderRadius: 23, backgroundColor: colors.button, alignItems: "center", justifyContent: "center" },
  chooseOtherText: { color: colors.ink, fontSize: 14.5, fontWeight: "600" },
  chooseOff: { opacity: 0.45 },
  musicSheet: { flex: 1, backgroundColor: colors.base },
  musicHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, height: 48 },
  musicTitle: { flex: 1, color: colors.ink, fontSize: 16, fontWeight: "700", marginLeft: 4 },
  musicSearch: { marginHorizontal: 16, marginVertical: 8 },
  musicRow: { flexDirection: "row", alignItems: "center", gap: 12, height: 64, paddingHorizontal: 16 },
  musicText: { flex: 1, minWidth: 0 },
  musicRowTitle: { color: colors.ink, fontSize: 15, fontWeight: "600" },
  musicRowLine: { color: colors.dim, fontSize: 13, marginTop: 2 },
  sheetIcon: { width: 48, height: 48, borderRadius: 4, backgroundColor: colors.panel, alignItems: "center", justifyContent: "center" },
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
});
