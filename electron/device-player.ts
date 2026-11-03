/**
 * One device on the network, however it's spoken to (UPnP or Cast): the same few
 * calls on the computer and the phone. No sockets of its own: each app hands in
 * how it opens one.
 */
import { CastClient, type CastSocket } from "../src/lib/castV2";
import type { NetDevice } from "../src/lib/netScan";
import type { ZoneDeviceStatus, ZonePlayState } from "../src/lib/zoneEngine";
import { isLanUrl, transport, type Renderer, type SongMeta } from "./upnp-control";

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
}

export interface DevicePlayer {
  id: string;
  name: string;
  host: string;
  /** puts the song on the device, at that place, playing or waiting */
  load(url: string, song: SongMeta & { art?: string }, position: number, play: boolean): Promise<void>;
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

export function upnpPlayer(r: Renderer): DevicePlayer {
  return {
    id: r.id,
    name: r.name,
    host: new URL(r.avTransport.url).hostname,
    async load(url, song, position, play) {
      await transport.load(r, url, song);
      // Many players seek only once playing: start, seek, then pause when asked to wait.
      if (play || position > 1) await transport.play(r);
      if (position > 1) await transport.seek(r, position).catch(() => undefined);
      if (!play) await transport.pause(r).catch(() => undefined);
    },
    play: () => transport.play(r),
    pause: () => transport.pause(r),
    stop: () => transport.stop(r),
    seek: (sec) => transport.seek(r, sec),
    async status() {
      const [state, at] = await Promise.all([transport.state(r), transport.position(r)]);
      return { state, position: at.position, duration: at.duration, uri: at.uri };
    },
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
  return {
    id: d.id,
    name: d.name,
    host: d.host,
    load: (url, song, position, play) =>
      client.load({ url, contentType: song.mime, title: song.title, artist: song.artist, album: song.album, duration: song.duration, art: song.art }, position, play),
    play: client.play,
    pause: client.pause,
    stop: () => client.stop(),
    seek: client.seek,
    async status() {
      const p = await client.playback();
      return { state: CAST_STATE[p.state] ?? "STOPPED", position: p.position, duration: p.duration, uri: p.url, finished: p.state === "IDLE" && p.idleReason === "FINISHED" };
    },
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
