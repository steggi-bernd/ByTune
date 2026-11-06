/**
 * One device on the network, however it's spoken to (UPnP or Cast): the same few
 * calls on the computer and the phone. No sockets of its own: each app hands in
 * how it opens one.
 */
import { CastClient, type CastSocket } from "../src/lib/castV2";
import { StartWatch } from "../src/lib/deviceStart";
import type { NetDevice } from "../src/lib/netScan";
import type { ZoneDeviceStatus, ZonePlayState } from "../src/lib/zoneEngine";
import { DeviceRefusal, isLanUrl, transport, type Renderer, type SongMeta } from "./upnp-control";

const AUDIO_MIME: Record<string, string> = {
  ".flac": "audio/flac", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".aac": "audio/aac",
  ".wav": "audio/wav", ".ogg": "audio/ogg", ".oga": "audio/ogg", ".opus": "audio/ogg", ".aif": "audio/aiff", ".aiff": "audio/aiff",
  ".m4b": "audio/mp4", ".webm": "audio/webm", ".webma": "audio/webm",
};

export const mimeOf = (ext: string, fallback = "audio/mpeg"): string => AUDIO_MIME[ext.toLowerCase()] ?? fallback;

/** What a device says about where it stands, in UPnP's words. */
export interface DeviceReport {
  state: string;
  position: number;
  duration: number;
  uri: string;
  finished?: boolean;
  /** it was handed a song to play and, after all that time, hasn't started it (said once) */
  notStarted?: boolean;
}

export interface DevicePlayer {
  id: string;
  name: string;
  host: string;
  /**
   * Puts the song on the device, at that place, playing or waiting. Answering doesn't mean it
   * plays: `status()` says "TRANSITIONING" until it does, and `notStarted` when it never did.
   */
  load(url: string, song: SongMeta & { art?: string }, position: number, play: boolean): Promise<void>;
  /** It was handed a song to play and hasn't started it yet: somebody has to keep asking `status()`. */
  starting(): boolean;
  play(): Promise<unknown>;
  pause(): Promise<unknown>;
  stop(): Promise<unknown>;
  seek(sec: number): Promise<unknown>;
  status(): Promise<DeviceReport>;
  setVolume(percent: number): Promise<unknown>;
  getVolume(): Promise<number | null>;
  getMute(): Promise<boolean>;
  setMute(on: boolean): Promise<unknown>;
  close(): void;
}

/** The song a device says it has is the one it was handed; some give another host or spelling of the address. */
function sameStream(uri: string, url: string): boolean {
  const plain = (u: string): string => {
    try {
      return decodeURIComponent(u).replace(/^\w+:\/\/[^/]+/, "");
    } catch {
      return u;
    }
  };
  return !uri || plain(uri) === plain(url);
}

/** A song it says it plays under another address: after this long that's the song, however it spells it. */
const OTHER_ADDRESS_MS = 8000;
/** It started this far before the place it was told: it missed the seek on its way up. */
const MISSED_THE_PLACE_SEC = 3;

/** What a device needs for `patient`: how to hand it a song. */
interface DeviceCalls {
  /** the song on the device, playing from that place */
  hand(url: string, song: SongMeta & { art?: string }, position: number, stillWanted: () => boolean): Promise<void>;
  /** the song on the device, waiting at that place */
  handPaused(url: string, song: SongMeta & { art?: string }, position: number): Promise<void>;
  play(): Promise<unknown>;
  pause(): Promise<unknown>;
  stop(): Promise<unknown>;
  seek(sec: number): Promise<unknown>;
  status(): Promise<DeviceReport>;
  /** the song itself is the problem: waiting won't help */
  isFinal(err: unknown): boolean;
}

/**
 * The calling side of a device that takes its time: a song handed over counts once
 * the device says it plays it, and until then it gets it again now and then
 * (see lib/deviceStart.ts). `status()` moves this along, about once a second.
 */
function patient(calls: DeviceCalls): Pick<DevicePlayer, "load" | "starting" | "play" | "pause" | "stop" | "seek" | "status"> {
  const watch = new StartWatch();
  /**
   * What it was given last. `played`: it has said so, and what it says about its place is about this song.
   * `spelled`: how it writes the address of this song, when that's its own way.
   */
  let handed: { url: string; song: SongMeta & { art?: string }; position: number; played: boolean; spelled?: string } | null = null;
  let handing = false;

  const hand = (h: NonNullable<typeof handed>): Promise<void> => calls.hand(h.url, h.song, h.position, () => handed === h && watch.active);

  const handAgain = (h: NonNullable<typeof handed>): void => {
    if (handing) return;
    handing = true;
    void hand(h)
      .catch(() => undefined)
      .finally(() => {
        handing = false;
      });
  };

  return {
    async load(url, song, position, play) {
      const h = { url, song, position, played: false };
      handed = h;
      if (!play) {
        watch.cancel();
        await calls.handPaused(url, song, position);
        return;
      }
      watch.begin();
      try {
        await hand(h);
      } catch (err) {
        // A device on its way up may not answer yet, or say no: it gets the song again in a moment.
        if (!calls.isFinal(err)) return;
        watch.cancel();
        throw err;
      }
    },
    starting: () => watch.active,
    play() {
      if (!handed) return calls.play();
      // From a pause, or back from one that never started: the same watch.
      watch.begin();
      return calls.play().catch(() => undefined);
    },
    pause() {
      const waiting = watch.active;
      watch.cancel();
      return waiting ? calls.pause().catch(() => undefined) : calls.pause();
    },
    stop() {
      watch.cancel();
      handed = null;
      return calls.stop();
    },
    seek(sec) {
      if (handed) handed.position = sec;
      return watch.active ? calls.seek(sec).catch(() => undefined) : calls.seek(sec);
    },
    async status() {
      let report: DeviceReport | null = null;
      let failure: unknown = null;
      try {
        report = await calls.status();
      } catch (err) {
        failure = err;
      }
      if (!watch.active || !handed) {
        if (!report) throw failure;
        if (!handed) return report;
        if (handed.spelled && report.uri === handed.spelled) report = { ...report, uri: handed.url };
        if (report.state === "PLAYING" && sameStream(report.uri, handed.url)) {
          handed.played = true;
          // Where it goes on from, if it has to be handed the song again later.
          handed.position = report.position;
        }
        // Paused on its way up, say: it has nothing to tell about this song, and the place in it mustn't get lost.
        return handed.played ? report : { ...report, position: handed.position };
      }
      const h = handed;
      const playing = report?.state === "PLAYING" && (sameStream(report.uri, h.url) || watch.sinceHanded() >= OTHER_ADDRESS_MS);
      const said: ZonePlayState | null = !report ? null : playing ? "playing" : report.state === "TRANSITIONING" || report.state === "PLAYING" ? "loading" : "stopped";
      const step = watch.see(said);
      if (step === "started" && report) {
        h.played = true;
        // It plays it under another address: from here on, that's this song's.
        if (!sameStream(report.uri, h.url)) h.spelled = report.uri;
        const uri = h.url;
        if (h.position > 1 && report.position < h.position - MISSED_THE_PLACE_SEC) {
          void calls.seek(h.position).catch(() => undefined);
          return { ...report, uri, position: h.position };
        }
        return { ...report, uri };
      }
      const waiting = { position: h.position, duration: report?.duration ?? 0, uri: h.url };
      if (step === "failed") return { ...waiting, state: "STOPPED", notStarted: true };
      if (step === "hand-again") handAgain(h);
      return { ...waiting, state: "TRANSITIONING" };
    },
  };
}

export function upnpPlayer(r: Renderer): DevicePlayer {
  return {
    id: r.id,
    name: r.name,
    host: new URL(r.avTransport.url).hostname,
    ...patient({
      async hand(url, song, position, stillWanted) {
        await transport.load(r, url, song);
        if (!stillWanted()) return;
        await transport.play(r);
        // Many players seek only once playing.
        if (position > 1 && stillWanted()) await transport.seek(r, position).catch(() => undefined);
      },
      async handPaused(url, song, position) {
        await transport.load(r, url, song);
        // Many players seek only once playing: start, seek, then pause.
        if (position > 1) {
          await transport.play(r);
          await transport.seek(r, position).catch(() => undefined);
        }
        await transport.pause(r).catch(() => undefined);
      },
      play: () => transport.play(r),
      pause: () => transport.pause(r),
      stop: () => transport.stop(r),
      seek: (sec) => transport.seek(r, sec),
      async status() {
        const [state, at] = await Promise.all([transport.state(r), transport.position(r)]);
        return { state, position: at.position, duration: at.duration, uri: at.uri };
      },
      isFinal: (err) => err instanceof DeviceRefusal && err.final,
    }),
    setVolume: (percent) => transport.volume(r, percent),
    getVolume: () => transport.getVolume(r),
    getMute: () => transport.getMute(r),
    setMute: (on) => transport.mute(r, on),
    close: () => undefined,
  };
}

const CAST_STATE: Record<string, string> = { PLAYING: "PLAYING", PAUSED: "PAUSED_PLAYBACK", BUFFERING: "TRANSITIONING", LOADING: "TRANSITIONING", IDLE: "STOPPED" };

export async function castPlayer(d: NetDevice, connect: (host: string, port: number) => Promise<CastSocket>): Promise<DevicePlayer> {
  if (!isLanUrl(`http://${d.host}/`)) throw new Error("That device isn't on the local network");
  const client = new CastClient(await connect(d.host, d.port));
  try {
    await client.receiverStatus();
  } catch (err) {
    client.close();
    throw err;
  }
  const load = (url: string, song: SongMeta & { art?: string }, position: number, play: boolean): Promise<unknown> =>
    client.load({ url, contentType: song.mime, title: song.title, artist: song.artist, album: song.album, duration: song.duration, art: song.art }, position, play);
  return {
    id: d.id,
    name: d.name,
    host: d.host,
    ...patient({
      hand: async (url, song, position) => void (await load(url, song, position, true)),
      handPaused: async (url, song, position) => void (await load(url, song, position, false)),
      play: client.play,
      pause: client.pause,
      stop: () => client.stop(),
      seek: client.seek,
      async status() {
        const p = await client.playback();
        return { state: CAST_STATE[p.state] ?? "STOPPED", position: p.position, duration: p.duration, uri: p.url, finished: p.state === "IDLE" && p.idleReason === "FINISHED" };
      },
      isFinal: (err) => err instanceof Error && /can't play this song|refused/.test(err.message),
    }),
    setVolume: (percent) => client.setVolume(percent / 100),
    getVolume: async () => (client.volume === null ? null : Math.round(client.volume * 100)),
    getMute: async () => client.muted,
    setMute: (on) => client.setMuted(on),
    close: () => client.close(),
  };
}

/** Tells a song played to its end from one stopped halfway, which look the same: players reset the position on stop. */
export class EndWatch {
  private reached = 0;
  private reported = false;
  private state: ZonePlayState = "loading";

  /** A song was put on the device, at this place. */
  begin(position: number): void {
    this.reached = position;
    this.reported = false;
    this.state = "loading";
  }

  /** Somebody moved within the song. */
  moved(position: number): void {
    this.reached = position;
  }

  see(at: DeviceReport, songDuration: number): ZoneDeviceStatus {
    const { state } = at;
    const s: ZonePlayState =
      state === "PLAYING" ? "playing" : state === "PAUSED_PLAYBACK" ? "paused" : state === "TRANSITIONING" ? "loading" : state === "STOPPED" || state === "NO_MEDIA_PRESENT" ? "stopped" : this.state;
    this.state = s;
    const duration = at.duration || songDuration;
    if (s === "playing") this.reached = Math.max(this.reached, at.position);
    // Stopped after getting within a few seconds of the end.
    const ended = s === "stopped" && !this.reported && (!!at.finished || (duration > 0 && this.reached >= duration - 4));
    if (ended) this.reported = true;
    return { state: s, position: s === "stopped" && ended ? duration : at.position, duration, ended };
  }
}
