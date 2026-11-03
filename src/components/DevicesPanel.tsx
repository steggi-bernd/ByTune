/**
 * Devices: a small smart-home room for everything that can make sound. One click
 * moves the music to a device; the plus lets another one play along; a device can
 * also play something of its own (lib/zones.ts). This computer's own outputs are
 * here too, and the other computers and phones running Songsta, with what they play.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Bluetooth, Check, Headphones, Laptop, Loader2, MoreHorizontal, Pause, Play, Plus, RefreshCw, SkipForward, Smartphone, Speaker, Tv, Volume2, X } from "lucide-react";
import { listOutputDevices } from "../lib/audio";
import type { OutputDeviceChoice } from "../lib/audio-output";
import { castTo, joinCast, leaveCast, searchCastDevices, setCastVolume, setMemberVolume, stopCasting, useCast, type CastDevice } from "../lib/cast";
import { isAround, otherDevices, useHomeSync } from "../lib/homeSync";
import { pickMusicFor, useZones, zoneJoin, zoneLeave, zoneNext, zoneStop, zoneToggle, zoneVolume, type ZoneView } from "../lib/zones";
import { useDeviceNames } from "../stores/deviceNames";
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { useUI, type MenuItem } from "../stores/ui";

function kindIcon(device: CastDevice) {
  if (device.kind === "cast" || device.kind === "firetv") return Tv;
  return Speaker;
}

function Tile({
  icon: Icon,
  name,
  line,
  active,
  busy,
  dim,
  wide,
  onClick,
  actions,
  children,
}: {
  icon: typeof Speaker;
  name: string;
  line: string;
  active?: boolean;
  busy?: boolean;
  dim?: boolean;
  /** across the whole panel: there's more to it than a name */
  wide?: boolean;
  onClick?: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      title={line}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={`flex min-h-[104px] min-w-0 cursor-pointer flex-col justify-between rounded-2xl p-3 transition-colors ${wide ? "col-span-2" : ""} ${
        active ? "bg-primary text-on-primary" : "bg-ink-hi/[0.06] text-ink-hi hover:bg-ink-hi/[0.1]"
      } ${dim ? "opacity-60" : ""}`}
    >
      <div className="flex items-start justify-between gap-1">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${active ? "bg-on-primary/10" : "bg-ink-hi/[0.08]"}`}>
          {busy ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Icon className="h-[18px] w-[18px]" />}
        </span>
        {actions && <div className="-mr-1 -mt-1 flex shrink-0 items-center">{actions}</div>}
      </div>
      <div className="mt-2 min-w-0">
        <span className="block truncate text-[14px] font-semibold">{name}</span>
        <span className={`mt-0.5 block truncate text-[12px] ${active ? "text-on-primary/70" : "text-ink-dim"}`}>{line}</span>
      </div>
      {children}
    </div>
  );
}

function SmallButton({ title, onClick, children }: { title: string; onClick: (e: React.MouseEvent) => void; children: ReactNode }) {
  return (
    <button
      title={title}
      aria-label={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className="grid h-7 w-7 place-items-center rounded-full opacity-80 transition hover:bg-black/10 hover:opacity-100"
    >
      {children}
    </button>
  );
}

function VolumeRow({ name, value, onChange }: { name?: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="mt-2.5 flex items-center gap-2 text-[12px]" onClick={(e) => e.stopPropagation()}>
      <Volume2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
      {name && <span className="w-20 shrink-0 truncate opacity-80">{name}</span>}
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="min-w-0 flex-1 accent-current"
        aria-label={name ? `Volume of ${name}` : "Volume"}
      />
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="mb-2 px-1 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-faint">{title}</h3>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </section>
  );
}

function zoneLine(zone: ZoneView): string {
  const song = zone.state.queue[zone.state.index];
  if (zone.state.error) return zone.state.error;
  if (!song) return "Ready";
  return `${zone.state.state === "playing" ? "" : "Paused · "}${song.title}`;
}

export function DevicesPanel({ onClose }: { onClose: () => void }) {
  const devices = useCast((s) => s.devices);
  const searching = useCast((s) => s.searching);
  const active = useCast((s) => s.active);
  const connecting = useCast((s) => s.connecting);
  const members = useCast((s) => s.members);
  const castVolume = useCast((s) => s.volume);
  const others = useHomeSync((s) => s.others);
  const followed = useHomeSync((s) => s.followed);
  const syncStatus = useHomeSync((s) => s.status);
  const zones = useZones((s) => s.zones);
  const pickingFor = useZones((s) => s.pickingFor);
  const names = useDeviceNames((s) => s.names);
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const playing = usePlayer((s) => s.playing);
  const sinkId = useSettings((s) => s.audioSinkId);
  const [outputs, setOutputs] = useState<OutputDeviceChoice[]>([]);
  const [openOutputs, setOpenOutputs] = useState(false);

  useEffect(() => {
    void searchCastDevices();
    const refresh = (): void => void listOutputDevices().then(setOutputs);
    refresh();
    const md = navigator.mediaDevices;
    md?.addEventListener?.("devicechange", refresh);
    return () => md?.removeEventListener?.("devicechange", refresh);
  }, []);

  const nameOf = (d: CastDevice): string => names[d.id] ?? d.name;
  const playable = devices.filter((d) => d.kind === "upnp" || d.kind === "cast");
  const pairOnly = devices.filter((d) => d.kind === "echo" || d.kind === "firetv");
  const around = others.filter(isAround);
  const here = !active && !followed;
  const inGroup = (id: string): boolean => members.some((m) => m.id === id);
  const zoneOn = (id: string): ZoneView | undefined => zones.find((z) => z.members.some((m) => m.id === id) || z.device.id === id);

  const outputLabel = (): string => {
    if (sinkId) return outputs.find((o) => o.deviceId === sinkId)?.label ?? "Chosen output";
    return outputs.find((o) => o.deviceId !== "" && o.activeDefault)?.label ?? "System default";
  };

  const takeHere = (): void => {
    if (followed) otherDevices.takeHere();
    else if (active) void stopCasting();
  };

  const moveTo = (d: CastDevice): void => {
    if (followed) otherDevices.takeHere();
    void castTo(d);
  };

  const sendToDevice = (id: string, name: string): void => {
    if (active) void stopCasting(false);
    void otherDevices.sendTo(id).then((sent) => useUI.getState().toast(sent ? `Playing on ${name}` : `${name} can't be reached right now`, sent ? "info" : "error"));
  };

  const menu = (e: React.MouseEvent, d: CastDevice): void => {
    const zone = zoneOn(d.id);
    const items: MenuItem[] = [
      { label: "Play something else here", icon: Play, action: () => pickMusicFor(d) },
      ...(zone ? [{ label: "Stop the music here", icon: X, action: () => void zoneStop(zone.id) }] : []),
      ...zones
        .filter((z) => !z.members.some((m) => m.id === d.id))
        .map((z): MenuItem => ({ label: `Play along with ${names[z.device.id] ?? z.device.name}`, icon: Plus, action: () => void zoneJoin(z.id, d) })),
      {
        label: "Rename…",
        action: () =>
          useUI.getState().openDialog({
            title: "Rename this device",
            initialValue: nameOf(d),
            confirmLabel: "Save",
            onConfirm: (value) => useDeviceNames.getState().rename(d.id, value === d.name ? "" : value),
          }),
      },
    ];
    useUI.getState().openContextMenu(e.clientX, e.clientY, items);
  };

  const askBluetooth = (d: CastDevice): void => {
    const canOpenBluetooth = d.kind === "echo" && navigator.userAgent.includes("Windows");
    useUI.getState().openDialog({
      title: nameOf(d),
      body:
        d.kind === "echo"
          ? 'Amazon lets no app send music to an Echo directly. It works as a Bluetooth speaker: say "Alexa, connect", then pick it in Windows under Settings > Bluetooth. It then shows up here as an output of this computer.'
          : "A Fire TV can't be sent music directly yet. Songsta on the Fire TV itself would show up here like your other devices.",
      confirmLabel: canOpenBluetooth ? "Bluetooth settings" : "OK",
      cancelLabel: "Close",
      onConfirm: () => {
        if (canOpenBluetooth) window.open("ms-settings:bluetooth");
      },
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-1 pt-4">
        <h2 className="text-[20px] font-extrabold tracking-[-0.4px] text-ink-hi">Devices</h2>
        <div className="flex items-center gap-0.5 text-ink-hi">
          <SmallButton title="Look again" onClick={() => void searchCastDevices()}>
            <RefreshCw className={`h-4 w-4 ${searching ? "animate-spin" : ""}`} />
          </SmallButton>
          <SmallButton title="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </SmallButton>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {pickingFor && (
          <div className="mx-1 mt-2 flex items-center gap-2 rounded-xl bg-accent/20 px-3 py-2 text-[13px] text-ink-hi">
            <span className="min-w-0 flex-1">Choose a song or list: it plays on {names[pickingFor.id] ?? pickingFor.name}.</span>
            <button className="shrink-0 font-semibold underline" onClick={() => pickMusicFor(null)}>
              Cancel
            </button>
          </div>
        )}

        <Section title="This computer">
          <Tile
            icon={Laptop}
            name="This computer"
            line={here ? `${playing && track ? "Playing · " : ""}${outputLabel()}` : outputLabel()}
            active={here}
            wide
            onClick={takeHere}
            actions={
              <SmallButton title="Choose the output" onClick={() => setOpenOutputs(!openOutputs)}>
                <Headphones className="h-4 w-4" />
              </SmallButton>
            }
          >
            {openOutputs && (
              <div className="mt-2 flex flex-col gap-0.5">
                {outputs.map((o) => (
                  <button
                    key={o.deviceId || "default"}
                    onClick={() => useSettings.getState().setAudioSinkId(o.deviceId)}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-black/10"
                  >
                    <Check className={`h-3.5 w-3.5 shrink-0 ${o.deviceId === sinkId ? "" : "opacity-0"}`} />
                    <span className="truncate">{o.label}</span>
                  </button>
                ))}
              </div>
            )}
          </Tile>
        </Section>

        {(around.length > 0 || syncStatus === "connected") && (
          <Section title="Your other devices">
            {around.length === 0 && <p className="col-span-2 px-1 text-[13px] text-ink-dim">None of them is on right now.</p>}
            {around.map((d) => {
              const Icon = d.presence.kind === "computer" ? Laptop : Smartphone;
              const song = d.presence.track;
              const isFollowed = followed?.id === d.id;
              return (
                <Tile
                  key={d.id}
                  icon={Icon}
                  name={d.presence.name}
                  line={song ? `${d.presence.playing ? "" : "Paused · "}${song.title}` : "Ready"}
                  active={isFollowed}
                  onClick={() => (isFollowed ? undefined : sendToDevice(d.id, d.presence.name))}
                  actions={
                    song ? (
                      <SmallButton
                        title={d.presence.playing ? "Pause there" : "Play there"}
                        onClick={() => void otherDevices.send(d.id, { action: d.presence.playing ? "pause" : "play" })}
                      >
                        {d.presence.playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                      </SmallButton>
                    ) : undefined
                  }
                />
              );
            })}
          </Section>
        )}

        <Section title="Speakers, receivers and TVs">
          {playable.length === 0 && <p className="col-span-2 px-1 text-[13px] text-ink-dim">{searching ? "Looking on your network…" : "Nothing found on your network."}</p>}
          {playable.map((d) => {
            const zone = zoneOn(d.id);
            const isMain = inGroup(d.id) || active?.id === d.id;
            const Icon = kindIcon(d);
            const line = isMain ? (track ? `${playing ? "" : "Paused · "}${track.title}` : "Ready") : zone ? zoneLine(zone) : d.model || "Ready";
            return (
              <Tile
                key={d.id}
                icon={Icon}
                name={nameOf(d)}
                line={line}
                active={isMain || !!zone}
                wide={isMain || !!zone}
                busy={connecting === d.id}
                onClick={() => (isMain ? undefined : zone ? zoneToggle(zone.id) : moveTo(d))}
                actions={
                  <>
                    {zone && (
                      <>
                        <SmallButton title={zone.state.state === "playing" ? "Pause" : "Play"} onClick={() => zoneToggle(zone.id)}>
                          {zone.state.state === "playing" ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
                        </SmallButton>
                        <SmallButton title="Next" onClick={() => zoneNext(zone.id)}>
                          <SkipForward className="h-4 w-4 fill-current" />
                        </SmallButton>
                      </>
                    )}
                    {!zone && (isMain || active) && (
                      <SmallButton title={isMain ? "Stop playing here" : "Play along"} onClick={() => void (isMain ? leaveCast(d.id) : joinCast(d))}>
                        {isMain ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      </SmallButton>
                    )}
                    <SmallButton title="More" onClick={(e) => menu(e, d)}>
                      <MoreHorizontal className="h-4 w-4" />
                    </SmallButton>
                  </>
                }
              >
                {isMain &&
                  (members.length > 1
                    ? members
                        .filter((m) => m.id === d.id && m.volume !== null)
                        .map((m) => <VolumeRow key={m.id} value={m.volume as number} onChange={(v) => setMemberVolume(m.id, v)} />)
                    : castVolume !== null && <VolumeRow value={castVolume} onChange={setCastVolume} />)}
                {zone &&
                  zone.members
                    .filter((m) => m.volume !== null)
                    .map((m) => (
                      <div key={m.id}>
                        <VolumeRow name={zone.members.length > 1 ? m.name : undefined} value={m.volume as number} onChange={(v) => zoneVolume(zone.id, m.id, v)} />
                        {zone.members.length > 1 && (
                          <button className="mt-1 text-[12px] underline opacity-80" onClick={() => void zoneLeave(zone.id, m.id)}>
                            {m.name} leaves
                          </button>
                        )}
                      </div>
                    ))}
              </Tile>
            );
          })}
        </Section>

        {pairOnly.length > 0 && (
          <Section title="Over Bluetooth">
            {pairOnly.map((d) => (
              <Tile
                key={d.id}
                icon={d.kind === "echo" ? Bluetooth : Tv}
                name={nameOf(d)}
                line={d.kind === "echo" ? "Pair it as a speaker" : "Can't be sent music"}
                dim
                onClick={() => askBluetooth(d)}
                actions={
                  <SmallButton title="More" onClick={(e) => menu(e, d)}>
                    <MoreHorizontal className="h-4 w-4" />
                  </SmallButton>
                }
              />
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
