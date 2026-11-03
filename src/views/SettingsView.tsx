import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Activity,
  AppWindow,
  AudioLines,
  BarChart3,
  Check,
  ChevronRight,
  Circle,
  CircleCheck,
  CloudDownload,
  CloudUpload,
  Disc3,
  Download,
  Droplets,
  ExternalLink,
  FileAudio,
  FileDown,
  FileUp,
  FolderOpen,
  FolderSync,
  Gauge,
  HardDrive,
  Heart,
  Image,
  Infinity as InfinityIcon,
  KeyRound,
  Languages,
  Link2,
  ListChecks,
  ListMusic,
  Maximize2,
  Music4,
  Palette,
  Radio,
  RefreshCw,
  Server,
  ShoppingBag,
  SlidersHorizontal,
  SlidersVertical,
  Sparkles,
  Speaker,
  Squircle,
  Trash2,
  User,
  UserRound,
  Volume2,
  VolumeX,
  Wifi,
} from "lucide-react";
import {
  DOWNLOAD_QUALITY_LABEL,
  STREAM_QUALITY_LABEL,
  useSettings,
  type Accent,
  type Corners,
} from "../stores/settings";
import { useSession } from "../lib/session";
import { isLinux, isMac } from "../lib/platform";
import { setOnboardingIntent } from "../lib/onboardingIntent";
import { GuestDeleteModal } from "../components/AccountModals";
import { ParametricEqEditor } from "../components/ParametricEqEditor";
import { useUI, type MenuItem } from "../stores/ui";
import { EQ_BANDS, listOutputDevices } from "../lib/audio";
import type { OutputDeviceChoice } from "../lib/audio-output";
import type { DiscordStatus } from "../../electron/discord";
import type { JellyfinStatus } from "../../electron/jellyfin";
import type { SubsonicStatus } from "../../electron/subsonic";
import type { SoundStatus } from "../../electron/sound-library";
import { refreshHomeSync, useHomeSync } from "../lib/homeSync";
import { syncFavorites } from "../lib/serverSync";
import type { SyncStatus } from "../lib/syncEngine";

/* ============================================================ settings chrome
   Settings are inset cards of rows: an uppercase group header, a
   rounded card, glyph + title + optional subtitle on the left, a value/switch
   or chevron on the right, and hairline dividers inset to the text column. */

const GROUP_INSET = "px-0"; // page padding comes from the view container
const ROW_INSET = "px-4";
const TEXT_INSET = "pl-[52px]"; // icon (22) + gap (14) + row inset (16)

function SettingsGroup({
  header,
  footer,
  children,
}: {
  header?: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <section className="animate-slide-up">
      {header && (
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-dim px-1 pt-7 pb-2">
          {header}
        </h2>
      )}
      {!header && <div className="pt-7" />}
      <div className={`rounded-[calc(14px*var(--radius-scale))] bg-panel overflow-hidden ${GROUP_INSET}`}>{children}</div>
      {footer && <p className="text-[12.5px] text-ink-dim px-1 pt-2 leading-relaxed">{footer}</p>}
    </section>
  );
}

function Divider() {
  return <div className={`h-px bg-ink-hi/[0.08] ${TEXT_INSET}`} />;
}

function Switch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      className={`relative shrink-0 w-[42px] h-[26px] rounded-full transition-colors duration-200 disabled:opacity-40 ${
        checked ? "bg-accent" : "bg-ink-hi/[0.16]"
      }`}
    >
      <span
        className={`absolute top-[3px] w-[20px] h-[20px] rounded-full transition-all duration-200 ${
          checked ? "left-[19px] bg-on-primary" : "left-[3px] bg-white"
        }`}
      />
    </button>
  );
}

function Chevron() {
  return <ChevronRight className="w-5 h-5 text-ink-dim/70 shrink-0" />;
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-ink-hi/90 rounded-[5px] bg-ink-hi/[0.16] px-1.5 py-0.5">
      {children}
    </span>
  );
}

/** How this system installs FFmpeg, for the hint when it's missing. */
const FFMPEG_INSTALL = isLinux ? "sudo apt install ffmpeg" : isMac ? "brew install ffmpeg" : "winget install ffmpeg";

/**
 * FFmpeg status: AIFF, ALAC, WMA, WavPack, APE and DSD play through an FFmpeg
 * conversion (electron/transcode.ts). Clicking re-checks, so installing
 * FFmpeg while ByTune runs is picked up without a restart.
 */
function FfmpegRow() {
  const [status, setStatus] = useState<{ path: string | null; version: string | null } | null>(null);
  const check = (recheck: boolean): void => {
    void window.bytune?.ffmpegStatus(recheck).then(setStatus).catch(() => undefined);
  };
  useEffect(() => check(false), []);
  return (
    <SettingsRow
      icon={FileAudio}
      title="FFmpeg"
      subtitle={
        !status
          ? "Checking…"
          : status.path
            ? "AIFF, ALAC, WMA, WavPack, APE and DSD play through it (converted once, lossless)"
            : `Not found — needed for AIFF, ALAC, WMA, WavPack, APE and DSD. Install it (e.g. “${FFMPEG_INSTALL}”), then click to check again.`
      }
      value={status?.path ? `v${status.version}` : status ? "Missing" : undefined}
      onClick={() => check(true)}
    />
  );
}

/**
 * Sound analysis (electron/sound-library.ts): tempo, key and energy of every
 * local song, measured once in the background — its switch and how far it
 * got, asked again every few seconds while Settings is open.
 */
function SoundAnalysisRow() {
  const on = useSettings((s) => s.soundAnalysis);
  const setOn = useSettings((s) => s.setSoundAnalysis);
  const [status, setStatus] = useState<SoundStatus | null>(null);
  useEffect(() => {
    let live = true;
    const read = (): void => {
      void window.bytune
        ?.soundStatus()
        .then((st) => {
          if (live) setStatus(st);
        })
        .catch(() => undefined);
    };
    read();
    const timer = window.setInterval(read, 3000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);
  const n = (v: number): string => v.toLocaleString("en-US");
  const progress = !status
    ? ""
    : !status.ffmpeg
      ? "needs FFmpeg"
      : !on
        ? ""
        : status.total === 0
          ? "no local songs yet"
          : status.done >= status.total
            ? `all ${n(status.total)} songs measured`
            : `${n(status.done)} of ${n(status.total)} songs measured`;
  return (
    <SettingsRow
      icon={AudioLines}
      title="Sound analysis"
      subtitle={`Tempo, key and energy of each song, measured once in the background${progress ? ` — ${progress}` : ""}`}
      trailing={<Switch checked={on} onChange={setOn} />}
      onClick={() => setOn(!on)}
    />
  );
}

const DISCORD_PORTAL = "https://discord.com/developers/applications";

/**
 * Discord status (electron/discord.ts): the switch, the Application ID it
 * needs — an application the user creates, whose name Discord shows — and
 * how the connection is doing, polled while the switch is on.
 */
function DiscordGroup() {
  const enabled = useSettings((s) => s.discordPresence);
  const clientId = useSettings((s) => s.discordClientId);
  const setEnabled = useSettings((s) => s.setDiscordPresence);
  const setClientId = useSettings((s) => s.setDiscordClientId);
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  useEffect(() => {
    const bridge = window.bytune;
    if (!enabled || !bridge?.discordStatus) {
      setStatus(null);
      return;
    }
    let alive = true;
    const poll = (): void => {
      void bridge.discordStatus().then((s) => alive && setStatus(s)).catch(() => undefined);
    };
    poll();
    const timer = window.setInterval(poll, 1500);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [enabled, clientId]);

  const validId = /^\d{15,22}$/.test(clientId);
  const subtitle = !enabled
    ? "Show the song playing now as your Discord status"
    : !validId
      ? "Add your Application ID below to connect"
      : status?.state === "connected"
        ? `Connected${status.user ? ` as ${status.user}` : ""} · ${status.message ?? "shows while music plays"}`
        : status?.state === "unavailable"
          ? `${status.message ?? "Discord isn't running"} — connects once Discord is open`
          : status?.state === "error"
            ? `${status.message ?? "Discord refused the connection"} — check the ID`
            : "Connecting to Discord…";

  return (
    <SettingsGroup
      header="Discord"
      footer="Discord shows your application's name in “Listening to …”, so call it Songsta, for example. Only the Discord app on this computer gets the song title and artist; covers stay here."
    >
      <SettingsRow
        icon={Radio}
        title="Discord status"
        subtitle={subtitle}
        trailing={<Switch checked={enabled} onChange={setEnabled} />}
        onClick={() => setEnabled(!enabled)}
      />
      {enabled && (
        <>
          <Divider />
          <SettingsRow
            icon={KeyRound}
            title="Application ID"
            subtitle="From your application's General Information page"
            trailing={
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="e.g. 1234567890123456789"
                inputMode="numeric"
                spellCheck={false}
                aria-label="Discord Application ID"
                className={`w-56 h-9 px-3 rounded-lg bg-ink-hi/[0.05] border text-[13px] text-ink-hi tabular-nums placeholder:text-ink-faint outline-none focus:border-ink-hi/25 ${
                  clientId && !validId ? "border-red-400/60" : "border-ink-hi/10"
                }`}
              />
            }
          />
          <Divider />
          <SettingsRow
            icon={ExternalLink}
            title="Create an application"
            subtitle="Discord Developer Portal → New Application → name it → copy its Application ID (free)"
            onClick={() => window.open(DISCORD_PORTAL, "_blank")}
          />
        </>
      )}
    </SettingsGroup>
  );
}

const SYNC_LINE: Record<SyncStatus, string> = {
  off: "The same playlists on all your devices, and pick up where you stopped",
  connecting: "Looking for the sync service…",
  connected: "Connected: playlists and where you stopped stay the same on all your devices",
  unreachable: "The sync service isn't answering. Is it running on your server?",
  rejected: "The sync service refused this login",
};

/** Server sync — Liked Songs ↔ the servers' favorites, plays counted there
    too (lib/serverSync.ts). Shown with a server connected. An API-key login
    to Jellyfin belongs to no user, so it picks whose favorites and plays
    these are; until then Jellyfin sits out. */
function ServerSyncGroup() {
  const sync = useSettings((st) => st.serverSync);
  const plays = useSettings((st) => st.serverPlays);
  const setSync = useSettings((st) => st.setServerSync);
  const setPlays = useSettings((st) => st.setServerPlays);
  const syncPlaylists = useSettings((st) => st.syncPlaylists);
  const setSyncPlaylists = useSettings((st) => st.setSyncPlaylists);
  const syncStatus = useHomeSync((st) => st.status);
  const syncAddress = useHomeSync((st) => st.address);
  const customAddress = useHomeSync((st) => st.customAddress);
  const syncNeedsUser = useHomeSync((st) => st.needsUser);
  const openDialog = useUI((st) => st.openDialog);
  const toast = useUI((st) => st.toast);
  const [jf, setJf] = useState<JellyfinStatus | null>(null);
  const [navidrome, setNavidrome] = useState<SubsonicStatus | null>(null);
  useEffect(() => {
    const bridge = window.bytune;
    if (!bridge) return;
    let alive = true;
    void Promise.all([bridge.jellyfinStatus(), bridge.subsonicStatus()])
      .then(([j, s]) => {
        if (!alive) return;
        setJf(j as JellyfinStatus);
        setNavidrome(s as SubsonicStatus);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!jf?.connected && !navidrome?.connected) return null;

  const servers = [jf?.connected ? "Jellyfin" : null, navidrome?.connected ? "Navidrome" : null].filter(Boolean).join(" and ");
  const needsUser = !!jf?.connected && jf.apiKey && !jf.syncUserId;
  const pickUser = (e: React.MouseEvent): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ui = useUI.getState();
    const bridge = window.bytune;
    if (ui.contextMenu) {
      ui.closeContextMenu();
      return;
    }
    if (!bridge) return;
    void bridge
      .jellyfinUsers()
      .then((users) => {
        const items: MenuItem[] = users.map((u) => ({
          label: u.name,
          icon: Check,
          iconClassName: u.id === jf?.syncUserId ? "text-accent" : "opacity-0",
          action: () => {
            void bridge
              .jellyfinSetSyncUser(u.id)
              .then((status) => {
                refreshHomeSync();
                return status;
              })
              .then((s) => {
                setJf(s);
                void syncFavorites().catch(() => undefined);
              })
              .catch((err) => toast(err instanceof Error ? err.message : "Couldn't save the user", "error"));
          },
        }));
        ui.openContextMenu(rect.right, rect.bottom + 6, items, { alignRight: true });
      })
      .catch((err) => toast(err instanceof Error ? err.message : "Couldn't list the Jellyfin users", "error"));
  };

  const editSyncAddress = (): void => {
    openDialog({
      title: "Sync service address",
      body: "Empty: on the same machine as your Jellyfin server, port 8196.",
      initialValue: customAddress,
      confirmLabel: "Save",
      onConfirm: (value) => {
        void window.bytune
          ?.homeSyncSetAddress(value)
          .then(() => refreshHomeSync())
          .catch((err) => toast(err instanceof Error ? err.message : "That address doesn't work", "error"));
      },
    });
  };

  return (
    <SettingsGroup
      header="Server sync"
      footer={`A like here becomes a favorite on ${servers}, and a favorite set in another app (Finamp, Jellyfin Web, a Subsonic app) shows up in Liked Songs — taking one back works both ways too. A play counts there once you've heard half a song, at most 4 minutes.`}
    >
      <SettingsRow
        icon={Heart}
        title="Liked Songs ↔ favorites"
        subtitle={!sync ? `Keep Liked Songs and the ${servers} favorites the same` : needsUser ? "Jellyfin waits for a user — choose one below" : `Both ways with ${servers}`}
        trailing={<Switch checked={sync} onChange={setSync} />}
        onClick={() => setSync(!sync)}
      />
      <Divider />
      <SettingsRow
        icon={BarChart3}
        title="Count plays on the server"
        subtitle={`Play counts and “last played” on ${servers} include what you hear here`}
        trailing={<Switch checked={plays} onChange={setPlays} />}
        onClick={() => setPlays(!plays)}
      />
      {jf?.connected && (
        <>
          <Divider />
          <SettingsRow
            icon={ListMusic}
            title="Playlists and where you stopped"
            subtitle={syncNeedsUser ? "Waits for a user, chosen below" : syncPlaylists ? SYNC_LINE[syncStatus] : SYNC_LINE.off}
            trailing={<Switch checked={syncPlaylists} onChange={setSyncPlaylists} />}
            onClick={() => setSyncPlaylists(!syncPlaylists)}
          />
          {syncPlaylists && (
            <>
              <Divider />
              <SettingsRow
                icon={Link2}
                title="Sync service address"
                subtitle={customAddress ? "Entered by you" : "On your Jellyfin server"}
                value={syncAddress ?? "—"}
                onClick={editSyncAddress}
              />
            </>
          )}
        </>
      )}
      {jf?.connected && jf.apiKey && (
        <>
          <Divider />
          <SettingsRow
            icon={UserRound}
            title="Jellyfin user"
            subtitle="Signed in with an API key, which belongs to no user: whose favorites and plays these are"
            value={jf.syncUserName ?? "Choose…"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={pickUser}
          />
        </>
      )}
    </SettingsGroup>
  );
}

function SettingsRow({
  icon: Icon,
  title,
  subtitle,
  value,
  badge,
  disabled,
  onClick,
  onPointerDown,
  trailing,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  value?: string;
  badge?: string;
  disabled?: boolean;
  /** receives the event so rows can anchor a dropdown to themselves */
  onClick?: (e: React.MouseEvent) => void;
  /** dropdown rows stop the press here — the open menu survives until the
      click, letting the same row toggle it closed (playbar "+" pattern) */
  onPointerDown?: (e: React.PointerEvent) => void;
  trailing?: ReactNode;
}) {
  const interactive = onClick && !disabled;
  return (
    <div
      onPointerDown={onPointerDown}
      onClick={interactive ? (e) => onClick(e) : undefined}
      className={`flex items-center min-h-[52px] py-3 ${ROW_INSET} ${
        interactive ? "cursor-pointer hover:bg-ink-hi/[0.04] active:bg-ink-hi/[0.07] transition-colors" : ""
      } ${disabled ? "opacity-45" : ""}`}
    >
      <Icon className="w-[22px] h-[22px] shrink-0 text-ink-hi" />
      <div className="flex-1 min-w-0 ml-[14px]">
        <div className="flex items-center">
          <span className="text-[14px] text-ink-hi truncate">{title}</span>
          {badge && <Badge>{badge}</Badge>}
        </div>
        {subtitle && <div className="text-[12.5px] text-ink-dim mt-0.5 leading-snug">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-1 shrink-0 ml-3">
        {trailing ?? (
          <>
            {value && <span className="text-[14px] text-ink-dim">{value}</span>}
            {onClick && <Chevron />}
          </>
        )}
      </div>
    </div>
  );
}

/** A toggle that reads as part of the option above it — no glyph, no divider. */
function SettingsSubRow({
  title,
  checked,
  onChange,
  badge,
}: {
  title: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  badge?: string;
}) {
  return (
    <div
      onClick={() => onChange(!checked)}
      className={`flex items-center ${ROW_INSET} pb-2.5 -mt-1 cursor-pointer`}
    >
      <div className="flex-1 flex items-center min-w-0">
        <span className="text-[14px] text-ink-hi truncate">{title}</span>
        {badge && <Badge>{badge}</Badge>}
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

/** Thumb width of the .slider CSS — the fill is computed so it ends exactly
    at the thumb's centre (the native input insets the thumb by half its
    width at both ends of the range). */
const SLIDER_THUMB_PX = 13;

function SliderRow({
  icon: Icon,
  title,
  subtitle,
  value,
  min,
  max,
  step,
  current,
  onChange,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onChange: (v: number) => void;
}) {
  const frac = max > min ? Math.min(1, Math.max(0, (current - min) / (max - min))) : 0;
  return (
    <div className={`${ROW_INSET} py-3`}>
      <div className="flex items-center">
        <Icon className="w-[22px] h-[22px] shrink-0 text-ink-hi" />
        <div className="flex-1 min-w-0 ml-[14px]">
          <div className="text-[14px] text-ink-hi">{title}</div>
          {subtitle && <div className="text-[12.5px] text-ink-dim mt-0.5">{subtitle}</div>}
        </div>
        <span className="text-[14px] text-ink-dim ml-3 shrink-0">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        onChange={(e) => onChange(Number(e.target.value))}
        className="slider slider-dot w-full mt-3 ml-[36px]"
        style={
          {
            width: "calc(100% - 36px)",
            "--fill": `calc((100% - ${SLIDER_THUMB_PX}px) * ${frac} + ${SLIDER_THUMB_PX / 2}px)`,
          } as CSSProperties
        }
      />
    </div>
  );
}

const EQ_PRESETS: Record<string, number[]> = {
  Flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  Bass: [6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  Treble: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6],
  Vocal: [-2, -2, -1, 0, 2, 4, 4, 2, 0, -1],
  Loudness: [5, 4, 2, 0, -1, -1, 0, 2, 4, 5],
};

const bandLabel = (hz: number): string => (hz >= 1000 ? `${hz / 1000}k` : String(hz));

const REPLAYGAIN_LABEL = { off: "Off", track: "Per song", album: "Per album" } as const;
const TARGET_LABEL = { "-18": "−18 LUFS (ReplayGain)", "-14": "−14 LUFS (like Spotify)", "-11": "−11 LUFS (loud)" } as const;

/** 10-band graphic EQ: switch, presets, one vertical slider per band (±12 dB). */
function EqualizerRows() {
  const enabled = useSettings((st) => st.eqEnabled);
  const gains = useSettings((st) => st.eqGains);
  const mode = useSettings((st) => st.eqMode);
  const peqName = useSettings((st) => st.peq.name);
  const { setEqEnabled, setEqGains, setEqMode } = useSettings.getState();
  const preset = Object.keys(EQ_PRESETS).find((k) => EQ_PRESETS[k].every((g, i) => g === gains[i]));
  return (
    <>
      <SettingsRow
        icon={SlidersVertical}
        title="Equalizer"
        subtitle={
          !enabled
            ? "10-band EQ, or a parametric EQ with AutoEQ headphone corrections"
            : mode === "parametric"
              ? `Parametric, ${peqName}`
              : `10-band, ${preset ?? "Custom"}`
        }
        trailing={<Switch checked={enabled} onChange={setEqEnabled} />}
        onClick={() => setEqEnabled(!enabled)}
      />
      {enabled && (
        <div className={`${TEXT_INSET} pr-4 pt-1`}>
          <div className="flex gap-1.5 mb-3">
            {(
              [
                ["graphic", "10-band"],
                ["parametric", "Parametric · AutoEQ"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setEqMode(key)}
                className={`text-[12px] rounded-full px-3 py-1 transition-colors ${
                  mode === key ? "bg-primary text-on-primary" : "bg-ink-hi/[0.08] text-ink-hi hover:bg-ink-hi/[0.14]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {enabled && mode === "parametric" && (
        <div className={`${TEXT_INSET} pr-4 pb-4`}>
          <ParametricEqEditor />
        </div>
      )}
      {enabled && mode === "graphic" && (
        <div className={`${TEXT_INSET} pr-4 pb-4`}>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {Object.keys(EQ_PRESETS).map((name) => (
              <button
                key={name}
                onClick={() => setEqGains(EQ_PRESETS[name])}
                className={`text-[12px] rounded-full px-3 py-1 transition-colors ${
                  name === preset ? "bg-primary text-on-primary" : "bg-ink-hi/[0.08] text-ink-hi hover:bg-ink-hi/[0.14]"
                }`}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="flex justify-between gap-1 max-w-[520px]">
            {EQ_BANDS.map((hz, i) => (
              <label key={hz} className="flex flex-col items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[11px] tabular-nums text-ink-dim">
                  {gains[i] > 0 ? `+${gains[i]}` : gains[i]}
                </span>
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  value={gains[i] ?? 0}
                  aria-label={`${bandLabel(hz)} Hz`}
                  onChange={(e) => setEqGains(gains.map((g, j) => (j === i ? Number(e.target.value) : g)))}
                  onDoubleClick={() => setEqGains(gains.map((g, j) => (j === i ? 0 : g)))}
                  className="h-[120px] w-5 accent-[rgb(var(--primary))] cursor-pointer"
                  style={{ writingMode: "vertical-lr", direction: "rtl" }}
                />
                <span className="text-[11px] text-ink-dim">{bandLabel(hz)}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ============================================================ view */

/** Builds the option list for the quality dropdowns. Every row carries the
    check glyph — filled on the current value, invisible on the rest so the
    labels keep their alignment — and picking one commits it immediately. */
const CORNERS_LABEL: Record<Corners, string> = { round: "Round", soft: "Soft", square: "Square" };
const ACCENT_LABEL: Record<Accent, string> = {
  violet: "Violet",
  blue: "Blue",
  teal: "Teal",
  green: "Green",
  amber: "Amber",
  coral: "Coral",
  pink: "Pink",
  white: "White",
};
/** Each accent drawn in its own colour on its menu row (whole class names, so Tailwind keeps them). */
const ACCENT_SWATCH: Record<Accent, string> = {
  violet: "fill-[#a78bfa] text-[#a78bfa]",
  blue: "fill-[#60a5fa] text-[#60a5fa]",
  teal: "fill-[#2dd4bf] text-[#2dd4bf]",
  green: "fill-[#4ade80] text-[#4ade80]",
  amber: "fill-[#fbbf24] text-[#fbbf24]",
  coral: "fill-[#fb7185] text-[#fb7185]",
  pink: "fill-[#f472b6] text-[#f472b6]",
  white: "fill-white text-white",
};
const ACCENT_PICKED: Record<Accent, string> = {
  violet: "fill-[#a78bfa]/25 text-[#a78bfa]",
  blue: "fill-[#60a5fa]/25 text-[#60a5fa]",
  teal: "fill-[#2dd4bf]/25 text-[#2dd4bf]",
  green: "fill-[#4ade80]/25 text-[#4ade80]",
  amber: "fill-[#fbbf24]/25 text-[#fbbf24]",
  coral: "fill-[#fb7185]/25 text-[#fb7185]",
  pink: "fill-[#f472b6]/25 text-[#f472b6]",
  white: "fill-white/25 text-white",
};

/** The accent presets, each a dot of its colour; the current one is checked. */
function accentMenu(current: Accent, onPick: (a: Accent) => void): MenuItem[] {
  return (Object.keys(ACCENT_LABEL) as Accent[]).map((a) => ({
    label: ACCENT_LABEL[a],
    icon: a === current ? CircleCheck : Circle,
    iconClassName: a === current ? ACCENT_PICKED[a] : ACCENT_SWATCH[a],
    action: () => onPick(a),
  }));
}

function qualityMenu<T extends string>(
  order: T[],
  labels: Record<T, string>,
  current: T,
  onPick: (q: T) => void,
): MenuItem[] {
  return order.map((q) => ({
    label: labels[q],
    icon: Check,
    iconClassName: q === current ? "text-accent" : "opacity-0",
    action: () => onPick(q),
  }));
}

/** Opens the row's dropdown, right-aligned under the row's value — and
    toggles it closed when one is already open. Same contract as the playbar
    "+": the row's pointerdown keeps an open menu alive until this click (see
    SettingsRow's onPointerDown), so the click itself can close it. */
function toggleDropdownAt(e: React.MouseEvent, items: MenuItem[]): void {
  e.stopPropagation();
  const ui = useUI.getState();
  if (ui.contextMenu) {
    ui.closeContextMenu();
    return;
  }
  const rect = e.currentTarget.getBoundingClientRect();
  ui.openContextMenu(rect.right, rect.bottom + 6, items, { alignRight: true });
}

/** Output device — routes playback to a specific speaker/headset via
    setSinkId. Chromium hides device labels until the page has held capture
    permission once, so the first menu open asks for it on explicit intent;
    failure degrades to generic "Speaker N" names. */
function OutputDeviceGroup() {
  const sinkId = useSettings((st) => st.audioSinkId);
  const [devices, setDevices] = useState<OutputDeviceChoice[] | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = (): void => {
      void listOutputDevices().then((list) => {
        if (alive) setDevices(list);
      });
    };
    refresh();
    // Plugging or unplugging a device must update the row and the menu live.
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    md?.addEventListener?.("devicechange", refresh);
    return () => {
      alive = false;
      md?.removeEventListener?.("devicechange", refresh);
    };
  }, []);
  const current = devices?.find((d) => d.deviceId === sinkId);
  // Where sound is going RIGHT NOW: the pinned device, or — when following
  // the system default — whichever physical endpoint the OS currently routes
  // "default" to. Resolving this is what makes the row move when Windows
  // hands the default to a newly connected headset.
  const active = devices?.find((d) => d.deviceId !== "" && d.activeDefault);
  const value = sinkId ? (current?.label ?? "System default") : active ? active.label : "System default";
  const itemsFor = (list: OutputDeviceChoice[]): MenuItem[] =>
    list.map((d) => ({
      label: d.deviceId === "" && active ? `System default — ${active.label}` : d.label,
      icon: Check,
      iconClassName: d.deviceId === sinkId ? "text-accent" : "opacity-0",
      action: () => useSettings.getState().setAudioSinkId(d.deviceId),
    }));
  return (
    <SettingsGroup
      header="Audio output"
      footer="Playback follows the device you pick. If it disappears (headset unplugged, Bluetooth dropped), playback pauses and the setting falls back to the system default."
    >
      <SettingsRow
        icon={Speaker}
        title="Output device"
        subtitle={sinkId ? "Pinned to this device" : "Following the system default"}
        value={devices ? value : "System default"}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          // Same toggle contract as the quality rows: a click on the row
          // closes the open menu; otherwise the list resolves (async) and the
          // menu opens anchored to the row. The rect is captured
          // synchronously — React nulls currentTarget after the handler.
          const rect = e.currentTarget.getBoundingClientRect();
          const ui = useUI.getState();
          if (ui.contextMenu) {
            ui.closeContextMenu();
            return;
          }
          void listOutputDevices().then((list) => {
            setDevices(list);
            ui.openContextMenu(rect.right, rect.bottom + 6, itemsFor(list), { alignRight: true });
          });
        }}
      />
    </SettingsGroup>
  );
}

/**
 * ByTune account — the cloud layer above the YouTube cookie. Guests keep
 * everything local; signed-in users get automatic cloud backup of library,
 * playlists, history and settings. Backups always run on top of the local
 * copy: restoring never deletes anything without writing a local backup
 * first (userData/data/backups).
 */
function CloudAccountGroup() {
  const toast = useUI((st) => st.toast);
  const openDialog = useUI((st) => st.openDialog);
  const session = useSession();
  const [status, setStatus] = useState<{
    lastSyncAt: number | null;
    state: "idle" | "syncing" | "pending" | "error";
    lastError: string | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Keep the sync-status line honest: poll while mounted (cheap local IPC),
  // plus refresh after every mode change.
  useEffect(() => {
    let cancelled = false;
    const poll = (): void => {
      void window.bytune
        ?.syncStatus()
        .then((st) => {
          if (!cancelled) {
            const s = st as { lastSyncAt: number | null; state?: string; lastError?: string | null } | undefined;
            setStatus({
              lastSyncAt: s?.lastSyncAt ?? null,
              state: (s?.state as "idle" | "syncing" | "pending" | "error") ?? "idle",
              lastError: s?.lastError ?? null,
            });
          }
        })
        .catch(() => undefined);
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [session.mode]);

  const run = async (fn: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      toast(done, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Sync failed", "error");
    } finally {
      setBusy(false);
    }
  };

  const signOutWithConfirm = (): void => {
    openDialog({
      title: "Sign out of Songsta?",
      body: "Your account data is safely backed up to the cloud. You can sign in again any time to restore it.",
      confirmLabel: "Sign out",
      cancelLabel: "Cancel",
      onConfirm: () => void run(async () => { await window.bytune?.authSignOut(); }, "Signed out"),
    });
  };

  const changeUsername = (): void => {
    openDialog({
      title: "Change username",
      body: "Letters, numbers, _ and @. The new name must not already be taken.",
      initialValue: session.username ?? "",
      confirmLabel: "Rename",
      onConfirm: (value) => {
        const next = value.trim();
        if (!next || next === session.username) return;
        void run(async () => {
          await window.bytune?.authSetUsername(next);
          await useSession.getState().refresh();
        }, `Username changed to ${next}`);
      },
    });
  };

  const signedIn = session.mode === "account";
  const subtitle = !session.loaded
    ? "…"
    : signedIn
      ? status?.state === "syncing"
        ? "Syncing…"
        : status?.state === "error"
          ? `Sync error, will retry${status.lastError ? "" : ""}`
          : status?.state === "pending"
            ? "Pending changes"
            : status?.lastSyncAt
              ? `Synced ${new Date(status.lastSyncAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              : "Signed in, backing up automatically"
      : session.mode === "guest"
        ? "Your data is stored only on this device"
        : "Not signed in";

  return (
    <SettingsGroup
      header="Songsta account"
      footer={
        signedIn
          ? "Backup runs automatically. Changes upload within seconds. Restore replaces this device's copy with the cloud version (a local backup is kept first)."
          : "Create an account to keep your library safe even if this PC's app data is wiped."
      }
    >
      <SettingsRow
        icon={signedIn ? UserRound : User}
        title={signedIn ? (session.username ?? "Account") : session.mode === "guest" ? "Guest" : "No account"}
        subtitle={subtitle}
        badge={session.mode === "guest" ? "Guest" : undefined}
        trailing={
          signedIn ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                changeUsername();
              }}
              className="h-7 px-2.5 rounded-md bg-ink-hi/[0.08] hover:bg-ink-hi/[0.14] text-[12px] font-semibold text-ink-hi transition-colors"
            >
              Change
            </button>
          ) : undefined
        }
      />
      <div className="px-4 pb-3 flex flex-wrap gap-2">
        {signedIn ? (
          <>
            <button
              onClick={() => void run(async () => { await window.bytune?.syncBackupNow(); }, "Backup complete")}
              disabled={busy}
              className="h-9 px-3.5 rounded-lg bg-ink-hi/[0.08] hover:bg-ink-hi/[0.14] text-[13px] font-semibold text-ink-hi transition-colors disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <CloudUpload className="w-4 h-4" /> Back up now
            </button>
            <button
              onClick={() => void run(async () => { await window.bytune?.syncRestoreNow(); }, "Restored from cloud")}
              disabled={busy}
              className="h-9 px-3.5 rounded-lg bg-ink-hi/[0.08] hover:bg-ink-hi/[0.14] text-[13px] font-semibold text-ink-hi transition-colors disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              <CloudDownload className="w-4 h-4" /> Restore from cloud
            </button>
            <button
              onClick={signOutWithConfirm}
              disabled={busy}
              className="h-9 px-3.5 rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 text-[13px] font-semibold transition-colors disabled:opacity-40"
            >
              Sign out
            </button>
          </>
        ) : (
          <button
            onClick={async () => {
              // Guests upgrade by re-running onboarding; their local data
              // stays and merges into the account on the first sync.
              if (session.mode === "guest") {
                try {
                  await window.bytune?.authClearGuestProfile();
                } catch {
                  useUI.getState().toast("Couldn't open onboarding. Try again.", "error");
                  return;
                }
              }
              void useSession.getState().refresh();
            }}
            className="h-9 px-3.5 rounded-lg bg-accent text-[13px] font-semibold text-on-primary hover:brightness-110"
          >
            {session.mode === "guest" ? "Create account / sign in" : "Sign in or create account"}
          </button>
        )}
      </div>
    </SettingsGroup>
  );
}

export function SettingsView() {
  const s = useSettings();
  const toast = useUI((st) => st.toast);
  const openDialog = useUI((st) => st.openDialog);
  const versions = window.bytune?.versions;
  const session = useSession();
  const [guestDeleteOpen, setGuestDeleteOpen] = useState(false);
  const [folderSummary, setFolderSummary] = useState<string | null>(null);

  const refreshFolderSummary = async (): Promise<void> => {
    const lib = await window.bytune?.localLibrary();
    const n = lib?.folders?.length ?? 0;
    setFolderSummary(n === 0 ? "No folders imported yet" : `${n} folder${n === 1 ? "" : "s"} imported`);
  };

  useEffect(() => {
    void refreshFolderSummary();
  }, []);

  const browse = async (): Promise<void> => {
    if (!window.bytune) return;
    try {
      const dir = await window.bytune.pickFolder();
      if (dir) {
        s.setDownloadDir(dir);
        toast("Download folder updated", "success");
      }
    } catch {
      toast("Couldn't open the folder picker", "error");
    }
  };

  const chooseMusicFolder = async (): Promise<void> => {
    if (!window.bytune) return;
    try {
      const dir = await window.bytune.pickFolder();
      if (!dir) return;
      toast("Importing folder…", "info");
      const res = await window.bytune.addLibraryFolders([dir]);
      if (res.added.length === 0) {
        setFolderSummary(`${res.lib.folders.length} folders imported`);
        toast("That folder is already in your library", "info");
        return;
      }
      s.setLocalMusicFolder(dir);
      await window.bytune.scanLibrary(s.filterNonMusicAudio);
      setFolderSummary(`${res.lib.folders.length} folder${res.lib.folders.length === 1 ? "" : "s"} imported`);
      toast("Local library scanned", "success");
    } catch {
      toast("Couldn't import that folder", "error");
    }
  };

  const rescanMusic = async (): Promise<void> => {
    if (!window.bytune) return;
    const lib = await window.bytune.localLibrary();
    if (!lib?.folders?.length) {
      toast("Import a local folder first", "info");
      return;
    }
    toast("Rescanning local library…", "info");
    try {
      await window.bytune.scanLibrary(s.filterNonMusicAudio);
      toast("Local library updated", "success");
    } catch {
      toast("Rescan failed", "error");
    }
  };

  const exportData = async (): Promise<void> => {
    if (!window.bytune) return;
    try {
      const res = await window.bytune.backupExport();
      if (res?.path) toast("Backup saved", "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Export failed", "error");
    }
  };

  const importData = async (): Promise<void> => {
    if (!window.bytune) return;
    try {
      const res = await window.bytune.backupImport();
      if (res?.restored) {
        toast(
          `Backup restored${typeof res.months === "number" && res.months > 0 ? ` (${res.months} months of history)` : ""}. Reloading…`,
          "success"
        );
        window.setTimeout(() => window.location.reload(), 900);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Import failed", "error");
    }
  };

  const resetAppData = async (): Promise<void> => {
    if (!window.bytune) return;
    try {
      // Main-process wipe: every store, history buckets and derived caches.
      // Downloaded audio files are the user's files and stay on disk.
      await window.bytune.resetData();
      window.location.reload();
    } catch {
      toast("Couldn't reset app data", "error");
    }
  };

  return (
    <div className="max-w-2xl pb-14">
      <h1 className="font-display text-[34px] font-extrabold tracking-[-0.03em] text-ink-hi px-1 pt-2 pb-3.5">
        Settings
      </h1>

      <SettingsGroup
        header="Library sources"
        footer="Covers your files lack, album names and artist bios come from open databases: MusicBrainz, Cover Art Archive, iTunes Search and Wikipedia/Wikidata. Answers are cached on this device."
      >
        <SettingsRow
          icon={FolderOpen}
          title="Local Music"
          subtitle="Folders on this device"
          onClick={() => useUI.getState().navigate({ name: "local" })}
        />
        <Divider />
        <SettingsRow
          icon={Server}
          title="Jellyfin"
          subtitle="Your own media server"
          onClick={() => useUI.getState().navigate({ name: "jellyfin" })}
        />
        <Divider />
        <SettingsRow
          icon={Disc3}
          title="Navidrome"
          subtitle="Navidrome or any Subsonic server"
          onClick={() => useUI.getState().navigate({ name: "subsonic" })}
        />
        <Divider />
        <SettingsRow
          icon={FileUp}
          title="Import from Spotify"
          subtitle="Your Liked Songs: which you have, which to buy"
          onClick={() => useUI.getState().navigate({ name: "spotify" })}
        />
        <Divider />
        <SettingsRow
          icon={ShoppingBag}
          title="Shop links for missing songs"
          subtitle="In the Spotify import's “to buy” list: searches on Qobuz, Bandcamp, 7digital and Amazon"
          trailing={<Switch checked={s.storeLinks} onChange={s.setStoreLinks} />}
          onClick={() => s.setStoreLinks(!s.storeLinks)}
        />
        <Divider />
        <SettingsRow
          icon={FolderSync}
          title="Watch folders"
          subtitle="New, changed and deleted files show up without rescanning"
          trailing={<Switch checked={s.watchFolders} onChange={s.setWatchFolders} />}
          onClick={() => s.setWatchFolders(!s.watchFolders)}
        />
        <Divider />
        <FfmpegRow />
        <Divider />
        <SoundAnalysisRow />
        <Divider />
        <SettingsRow
          icon={ListChecks}
          title="Library check"
          subtitle="Artists written different ways, albums in parts, songs you have twice, missing covers"
          onClick={() => useUI.getState().navigate({ name: "check" })}
        />
      </SettingsGroup>

      <ServerSyncGroup />

      <OutputDeviceGroup />

      <SettingsGroup header="Playback">
        {!s.smartFade && (
          <>
            <SliderRow
              icon={Activity}
              title="Crossfade"
              subtitle="Blend the end of one track into the next"
              value={s.crossfadeSeconds === 0 ? "Off" : `${s.crossfadeSeconds}s`}
              min={0}
              max={12}
              step={1}
              current={s.crossfadeSeconds}
              onChange={s.setCrossfadeSeconds}
            />
            <Divider />
            {s.crossfadeSeconds === 0 && (
              <>
                <SettingsRow
                  icon={AudioLines}
                  title="Gapless playback"
                  subtitle={
                    s.skipSilence
                      ? "Off while Skip silence trims the song ends"
                      : "The next song starts the moment this one ends — live albums and soundtracks run on"
                  }
                  trailing={<Switch checked={s.gapless} onChange={s.setGapless} />}
                  onClick={() => s.setGapless(!s.gapless)}
                />
                <Divider />
              </>
            )}
          </>
        )}
        <SettingsRow
          icon={Sparkles}
          title="Automix"
          subtitle={s.smartFade ? "Enabled: transitions decided per track pair" : "Disabled: uses the crossfade above"}
          trailing={<Switch checked={s.smartFade} onChange={s.setSmartFade} />}
          onClick={() => s.setSmartFade(!s.smartFade)}
        />
        <Divider />
        <SettingsRow
          icon={InfinityIcon}
          title="Seamless albums"
          subtitle="Live albums, DJ mixes and songs that run into each other play on without a gap or a crossfade"
          trailing={<Switch checked={s.seamlessAlbums} onChange={s.setSeamlessAlbums} />}
          onClick={() => s.setSeamlessAlbums(!s.seamlessAlbums)}
        />
        <Divider />
        <SettingsRow
          icon={VolumeX}
          title="Skip silence"
          subtitle="Jump over silent intros and gaps"
          trailing={<Switch checked={s.skipSilence} onChange={s.setSkipSilence} />}
          onClick={() => s.setSkipSilence(!s.skipSilence)}
        />
        <Divider />
        <SettingsRow
          icon={InfinityIcon}
          title="Autoplay"
          subtitle="Keep the music going when the queue ends"
          trailing={<Switch checked={s.autoplay} onChange={s.setAutoplay} />}
          onClick={() => s.setAutoplay(!s.autoplay)}
        />
        <Divider />
        <SliderRow
          icon={Gauge}
          title="Playback speed"
          subtitle="Pitch-preserving tempo for everything you play"
          value={`${s.playbackSpeed.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}x`}
          min={0.5}
          max={2}
          step={0.05}
          current={s.playbackSpeed}
          onChange={s.setPlaybackSpeed}
        />
        <Divider />
        <SettingsRow
          icon={Gauge}
          title="Volume leveling"
          subtitle="ReplayGain — songs play at the same loudness, their dynamics untouched"
          value={REPLAYGAIN_LABEL[s.replayGainMode]}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) =>
            toggleDropdownAt(e, qualityMenu(["off", "track", "album"], REPLAYGAIN_LABEL, s.replayGainMode, s.setReplayGainMode))
          }
        />
        {s.replayGainMode !== "off" && (
          <>
            <Divider />
            <SettingsRow
              icon={Volume2}
              title="Leveling target"
              subtitle="Loud songs are turned down to it; quieter ones are never boosted, so nothing clips"
              value={TARGET_LABEL[String(s.replayGainTarget) as keyof typeof TARGET_LABEL] ?? `${s.replayGainTarget} LUFS`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) =>
                toggleDropdownAt(
                  e,
                  qualityMenu(["-18", "-14", "-11"] as const, TARGET_LABEL, String(s.replayGainTarget) as "-18" | "-14" | "-11", (v) =>
                    s.setReplayGainTarget(Number(v))
                  )
                )
              }
            />
          </>
        )}
        <Divider />
        <EqualizerRows />
      </SettingsGroup>

      <SettingsGroup header="Appearance">
        <SettingsRow
          icon={Squircle}
          title="Corners"
          subtitle="How round panels, cards and menus are"
          value={CORNERS_LABEL[s.corners]}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => toggleDropdownAt(e, qualityMenu(["round", "soft", "square"], CORNERS_LABEL, s.corners, s.setCorners))}
        />
        <Divider />
        <SettingsRow
          icon={Palette}
          title="Accent"
          subtitle="The colour of what's playing, what's on, likes and the main buttons"
          value={ACCENT_LABEL[s.accent]}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => toggleDropdownAt(e, accentMenu(s.accent, s.setAccent))}
        />
        <Divider />
        <SettingsRow
          icon={AppWindow}
          title="Reduce animation"
          subtitle="Cut crossfades and motion through the app"
          trailing={<Switch checked={s.reduceAnimation} onChange={s.setReduceAnimation} />}
          onClick={() => s.setReduceAnimation(!s.reduceAnimation)}
        />
        <Divider />
        <SettingsRow
          icon={Droplets}
          title="Reduce dynamic blur"
          subtitle="Fill glass surfaces solid instead of blurring"
          trailing={<Switch checked={s.reduceDynamicBlur} onChange={s.setReduceDynamicBlur} />}
          onClick={() => s.setReduceDynamicBlur(!s.reduceDynamicBlur)}
        />
        <Divider />
        <SettingsRow
          icon={Sparkles}
          title="Liquid glass"
          subtitle="Refractive glass on the floating chrome"
          trailing={<Switch checked={s.liquidGlass} onChange={s.setLiquidGlass} disabled={s.reduceDynamicBlur} />}
          onClick={() => s.setLiquidGlass(!s.liquidGlass)}
        />
        <Divider />
        <SettingsRow
          icon={Maximize2}
          title="Full-screen cover art"
          subtitle="Let the artwork bleed behind the status area"
          trailing={<Switch checked={s.fullBleedArtwork} onChange={s.setFullBleedArtwork} />}
          onClick={() => s.setFullBleedArtwork(!s.fullBleedArtwork)}
        />
        <Divider />
        <SettingsRow
          icon={Image}
          title="Legacy mesh gradient"
          subtitle="Use the older drifting-blob player backdrop"
          trailing={<Switch checked={s.legacyMeshGradient} onChange={s.setLegacyMeshGradient} />}
          onClick={() => s.setLegacyMeshGradient(!s.legacyMeshGradient)}
        />
        <Divider />
        <SettingsRow
          icon={Music4}
          title="Animated cover art"
          subtitle="Play canvas clips in place of the still cover"
          trailing={<Switch checked={s.animatedCanvas} onChange={s.setAnimatedCanvas} />}
          onClick={() => s.setAnimatedCanvas(!s.animatedCanvas)}
        />
        <Divider />
        <SettingsRow
          icon={ListMusic}
          title="Synced lyrics"
          subtitle="Highlight the current line and auto-scroll"
          trailing={<Switch checked={s.syncedLyrics} onChange={s.setSyncedLyrics} />}
          onClick={() => s.setSyncedLyrics(!s.syncedLyrics)}
        />
        {s.syncedLyrics && (
          <>
            <Divider />
            <SettingsRow
              icon={Droplets}
              title="Blur unfocused lyrics"
              subtitle="Keep the spotlight on the current line"
              trailing={<Switch checked={s.blurUnfocusedLyrics} onChange={s.setBlurUnfocusedLyrics} />}
              onClick={() => s.setBlurUnfocusedLyrics(!s.blurUnfocusedLyrics)}
            />
          </>
        )}
        <Divider />
        <SettingsRow
          icon={Languages}
          title="Cyrillic in Latin letters"
          subtitle="A Latin line under each line of Russian, Ukrainian or other Cyrillic lyrics"
          trailing={<Switch checked={s.lyricsLatin} onChange={s.setLyricsLatin} />}
          onClick={() => s.setLyricsLatin(!s.lyricsLatin)}
        />
      </SettingsGroup>

      <SettingsGroup header="Local music">
        <SettingsRow
          icon={FolderOpen}
          title="Local music folders"
          subtitle={folderSummary ?? "Your imported collections"}
          onClick={() => useUI.getState().navigate({ name: "local" })}
        />
        <Divider />
        <SettingsRow
          icon={ListMusic}
          title="Add a folder"
          subtitle="Import music folders — a parent folder brings its music subfolders along"
          onClick={() => void chooseMusicFolder()}
        />
        <Divider />
        <SettingsRow
          icon={RefreshCw}
          title="Rescan library"
          subtitle="Re-read tags and artwork from every imported folder"
          onClick={() => void rescanMusic()}
        />
        <Divider />
        <SettingsRow
          icon={Music4}
          title="Filter non-music audio"
          subtitle="Hide clips, recordings and voice notes (applies on rescan)"
          trailing={<Switch checked={s.filterNonMusicAudio} onChange={(v) => { s.setFilterNonMusicAudio(v); void rescanMusic(); }} />}
          onClick={() => { s.setFilterNonMusicAudio(!s.filterNonMusicAudio); void rescanMusic(); }}
        />
      </SettingsGroup>

      <DiscordGroup />

      <SettingsGroup header="Your data">
        <SettingsRow
          icon={BarChart3}
          title="Replay"
          subtitle="Your listening over time, and every listen — kept on this computer"
          onClick={() => useUI.getState().navigate({ name: "replay" })}
        />
        <Divider />
        <SettingsRow
          icon={FileUp}
          title="Export data"
          subtitle="Write a backup of your library and history"
          onClick={() => void exportData()}
        />
        <Divider />
        <SettingsRow
          icon={FileDown}
          title="Import data"
          subtitle="Restore a backup, replacing what's here"
          onClick={() =>
            openDialog({
              title: "Import a backup?",
              body: "Your current library, playlists and history will be replaced by the backup's.",
              confirmLabel: "Choose file",
              danger: true,
              onConfirm: () => void importData(),
            })
          }
        />
      </SettingsGroup>

      <SettingsGroup
        header="Miscellaneous"
        footer="These apply to this desktop client and are stored locally."
      >
        <SettingsRow
          icon={ListMusic}
          title="Don't repeat suggestions"
          subtitle="Keep recently played tracks out of the home feed"
          trailing={<Switch checked={s.dontRepeatSuggestions} onChange={s.setDontRepeatSuggestions} />}
          onClick={() => s.setDontRepeatSuggestions(!s.dontRepeatSuggestions)}
        />
        <Divider />
        <SettingsRow
          icon={VolumeX}
          title="Hide volume bar"
          subtitle="Keep the player bar free of the volume slider"
          trailing={<Switch checked={s.hideVolumeBar} onChange={s.setHideVolumeBar} />}
          onClick={() => s.setHideVolumeBar(!s.hideVolumeBar)}
        />
      </SettingsGroup>



      <SettingsGroup header="Danger zone">
        <SettingsRow
          icon={Trash2}
          title="Reset app data"
          subtitle="Erase library, playlists, history and settings on this device"
          onClick={() => {
            // Guests have no cloud backup — deletion is unrecoverable, so
            // route through the dedicated protection modal instead.
            if (session.mode === "guest") {
              setGuestDeleteOpen(true);
              return;
            }
            openDialog({
              title: "Reset local data?",
              body: "Your local Songsta data will be removed from this device. Your account and cloud backup won't be deleted. Sign in again and everything restores. Downloaded audio files are not touched.",
              confirmLabel: "Reset local data",
              danger: true,
              onConfirm: () => void resetAppData(),
            });
          }}
        />
      </SettingsGroup>

      {guestDeleteOpen && (
        <GuestDeleteModal
          onClose={() => setGuestDeleteOpen(false)}
          onSignIn={async () => {
            setGuestDeleteOpen(false);
            try {
              await window.bytune?.authClearGuestProfile();
            } catch {
              useUI.getState().toast("Couldn't open onboarding. Try again.", "error");
              return;
            }
            setOnboardingIntent("signin");
            void useSession.getState().refresh();
          }}
          onCreateAccount={async () => {
            setGuestDeleteOpen(false);
            try {
              await window.bytune?.authClearGuestProfile();
            } catch {
              useUI.getState().toast("Couldn't open onboarding. Try again.", "error");
              return;
            }
            setOnboardingIntent("signup");
            void useSession.getState().refresh();
          }}
          onDeleteAnyway={() => {
            setGuestDeleteOpen(false);
            void resetAppData();
          }}
        />
      )}


      <div className="text-center text-[11px] text-ink-dim/80 pt-6 px-1 leading-relaxed">
        Songsta {versions?.app ?? "1.0.0"} · GPL-3.0 · based on ByTune by rishiteja21
      </div>
    </div>
  );
}