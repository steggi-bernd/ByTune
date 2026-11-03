/**
 * Google Cast, the part both apps share: the small protobuf frames of the CASTV2
 * protocol and a client that keeps a Cast device talking (Chromecast, Google TV,
 * Nest speakers, speaker groups). How the bytes travel, a TLS socket to the device,
 * is each app's own business (CastSocket).
 *
 * Music goes through the device's built-in Default Media Receiver: it fetches the
 * song itself, keeps playing with the app closed and shows title and cover.
 */

export const DEFAULT_MEDIA_RECEIVER = "CC1AD845";

const NS_CONNECTION = "urn:x-cast:com.google.cast.tp.connection";
const NS_HEARTBEAT = "urn:x-cast:com.google.cast.tp.heartbeat";
const NS_RECEIVER = "urn:x-cast:com.google.cast.receiver";
const NS_MEDIA = "urn:x-cast:com.google.cast.media";

const SENDER = "sender-songsta";
const RECEIVER = "receiver-0";
/** The device hangs up after some seconds of silence. */
const PING_EVERY_MS = 5000;
const REPLY_MS = 10_000;
/** A song can take a moment to start on a device that has to wake up. */
const LOAD_REPLY_MS = 25_000;

/* ------------------------------------------------------------- UTF-8, by hand: Hermes has no TextDecoder */

export function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.codePointAt(0) as number;
    if (code < 0x80) out.push(code);
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63));
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63));
  }
  return Uint8Array.from(out);
}

export function utf8Text(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    const size = b < 0x80 ? 1 : b < 0xe0 ? 2 : b < 0xf0 ? 3 : 4;
    let code = size === 1 ? b : b & (0xff >> (size + 1));
    for (let k = 1; k < size; k++) code = (code << 6) | (bytes[i + k] & 63);
    out += String.fromCodePoint(code);
    i += size;
  }
  return out;
}

/* ------------------------------------------------------------- the frames */

export interface CastMessage {
  source: string;
  destination: string;
  namespace: string;
  payload: string;
}

function varint(value: number): number[] {
  const out: number[] = [];
  let v = value;
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

function stringField(field: number, text: string): number[] {
  const bytes = utf8Bytes(text);
  return [(field << 3) | 2, ...varint(bytes.length), ...bytes];
}

/** One message with the length in front, as it goes on the wire. */
export function encodeFrame(m: CastMessage): Uint8Array {
  const body = [
    (1 << 3) | 0, 0, // protocol_version: CASTV2_1_0
    ...stringField(2, m.source),
    ...stringField(3, m.destination),
    ...stringField(4, m.namespace),
    (5 << 3) | 0, 0, // payload_type: STRING
    ...stringField(6, m.payload),
  ];
  const n = body.length;
  return Uint8Array.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...body]);
}

export function decodeMessage(bytes: Uint8Array): CastMessage | null {
  const m: Partial<CastMessage> = {};
  let i = 0;
  const readVarint = (): number => {
    let value = 0;
    let scale = 1;
    while (i < bytes.length) {
      const b = bytes[i++];
      value += (b & 0x7f) * scale;
      if (!(b & 0x80)) return value;
      scale *= 128;
    }
    return value;
  };
  while (i < bytes.length) {
    const key = readVarint();
    const field = key >>> 3;
    const wire = key & 7;
    if (wire === 0) readVarint();
    else if (wire === 2) {
      const size = readVarint();
      const value = bytes.subarray(i, i + size);
      i += size;
      if (field === 2) m.source = utf8Text(value);
      else if (field === 3) m.destination = utf8Text(value);
      else if (field === 4) m.namespace = utf8Text(value);
      else if (field === 6) m.payload = utf8Text(value);
    } else return null;
  }
  return m.namespace !== undefined && m.payload !== undefined ? ({ source: "", destination: "", ...m } as CastMessage) : null;
}

/** Bytes come as they come: whole messages come out. */
export class FrameReader {
  private pending = new Uint8Array(0);

  push(chunk: Uint8Array): CastMessage[] {
    const joined = new Uint8Array(this.pending.length + chunk.length);
    joined.set(this.pending);
    joined.set(chunk, this.pending.length);
    const out: CastMessage[] = [];
    let at = 0;
    while (joined.length - at >= 4) {
      const size = joined[at] * 0x1000000 + (joined[at + 1] << 16) + (joined[at + 2] << 8) + joined[at + 3];
      if (joined.length - at - 4 < size) break;
      const message = decodeMessage(joined.subarray(at + 4, at + 4 + size));
      if (message) out.push(message);
      at += 4 + size;
    }
    this.pending = joined.slice(at);
    return out;
  }
}

/* ------------------------------------------------------------- the client */

/** A TLS connection to the device, however this app makes one. */
export interface CastSocket {
  write(bytes: Uint8Array): void;
  close(): void;
  onData(listener: (bytes: Uint8Array) => void): void;
  /** The connection is gone, for whatever reason. */
  onClose(listener: () => void): void;
}

export interface CastSong {
  url: string;
  contentType: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  art?: string;
}

export interface CastPlayback {
  state: "IDLE" | "BUFFERING" | "PLAYING" | "PAUSED" | "LOADING";
  /** why it's idle: FINISHED, ERROR, CANCELLED, INTERRUPTED */
  idleReason?: string;
  position: number;
  duration: number;
  url: string;
}

export class CastClient {
  private reader = new FrameReader();
  private nextId = 1;
  private waiting = new Map<number, { resolve(reply: any): void; reject(err: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private pinger: ReturnType<typeof setInterval> | null = null;
  private lastPingAt = 0;
  private transportId: string | null = null;
  private sessionId: string | null = null;
  private mediaSessionId: number | null = null;
  private media: (CastPlayback & { at: number }) | null = null;
  /** the device's own volume 0–1 */
  volume: number | null = null;
  muted = false;
  closed = false;
  /** What the device says about itself, for those who keep an eye on it. */
  onChange: (() => void) | null = null;

  constructor(private socket: CastSocket) {
    socket.onData((bytes) => {
      for (const message of this.reader.push(bytes)) this.receive(message);
    });
    socket.onClose(() => this.shutDown());
    this.send(RECEIVER, NS_CONNECTION, { type: "CONNECT" });
    this.pinger = setInterval(() => this.pingIfDue(), PING_EVERY_MS);
  }

  /** Also from playback(), asked once a second: on a phone timers don't run in the background. */
  private pingIfDue(): void {
    const now = Date.now();
    if (now - this.lastPingAt < PING_EVERY_MS - 500) return;
    this.lastPingAt = now;
    this.send(RECEIVER, NS_HEARTBEAT, { type: "PING" });
  }

  private send(destination: string, namespace: string, payload: object): void {
    if (this.closed) return;
    this.socket.write(encodeFrame({ source: SENDER, destination, namespace, payload: JSON.stringify(payload) }));
  }

  private ask(destination: string, namespace: string, payload: object, ms = REPLY_MS): Promise<any> {
    if (this.closed) return Promise.reject(new Error("The device isn't connected any more"));
    const requestId = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(requestId);
        reject(new Error("The device didn't answer"));
      }, ms);
      this.waiting.set(requestId, { resolve, reject, timer });
      this.send(destination, namespace, { ...payload, requestId });
    });
  }

  private receive(message: CastMessage): void {
    let body: any;
    try {
      body = JSON.parse(message.payload);
    } catch {
      return;
    }
    if (message.namespace === NS_HEARTBEAT) {
      if (body.type === "PING") this.send(message.source || RECEIVER, NS_HEARTBEAT, { type: "PONG" });
      return;
    }
    if (message.namespace === NS_CONNECTION) {
      // The app on the device closed: what was loaded is gone with it.
      if (body.type === "CLOSE" && message.source === this.transportId) {
        this.transportId = null;
        this.sessionId = null;
        this.mediaSessionId = null;
      }
      return;
    }
    if (body.type === "RECEIVER_STATUS") this.takeReceiverStatus(body.status);
    if (body.type === "MEDIA_STATUS") this.takeMediaStatus(body.status);
    const asked = typeof body.requestId === "number" && body.requestId > 0 ? this.waiting.get(body.requestId) : undefined;
    if (asked) {
      clearTimeout(asked.timer);
      this.waiting.delete(body.requestId);
      if (body.type === "LOAD_FAILED" || body.type === "LOAD_CANCELLED" || body.type === "INVALID_REQUEST" || body.type === "LAUNCH_ERROR") {
        asked.reject(new Error(body.type === "LOAD_FAILED" ? "The device can't play this song" : `The device refused: ${body.reason ?? body.type}`));
      } else asked.resolve(body);
    }
    this.onChange?.();
  }

  private takeReceiverStatus(status: any): void {
    if (status?.volume) {
      if (typeof status.volume.level === "number") this.volume = status.volume.level;
      this.muted = !!status.volume.muted;
    }
    const app = (status?.applications ?? []).find((a: any) => a.appId === DEFAULT_MEDIA_RECEIVER);
    if (!app) {
      this.transportId = null;
      this.sessionId = null;
      this.mediaSessionId = null;
    }
  }

  private takeMediaStatus(list: any): void {
    const status = Array.isArray(list) ? list[0] : null;
    if (!status) {
      this.media = this.media && { ...this.media, state: "IDLE", at: Date.now() };
      return;
    }
    if (typeof status.mediaSessionId === "number") this.mediaSessionId = status.mediaSessionId;
    this.media = {
      state: status.playerState ?? "IDLE",
      idleReason: status.idleReason,
      position: typeof status.currentTime === "number" ? status.currentTime : this.media?.position ?? 0,
      duration: typeof status.media?.duration === "number" ? status.media.duration : this.media?.duration ?? 0,
      url: status.media?.contentId ?? this.media?.url ?? "",
      at: Date.now(),
    };
  }

  private shutDown(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pinger) clearInterval(this.pinger);
    this.pinger = null;
    for (const asked of this.waiting.values()) {
      clearTimeout(asked.timer);
      asked.reject(new Error("The device isn't connected any more"));
    }
    this.waiting.clear();
    this.onChange?.();
  }

  /** The device's name for what it's doing, and its volume; launches nothing. */
  async receiverStatus(): Promise<{ apps: string[]; volume: number | null; muted: boolean }> {
    const reply = await this.ask(RECEIVER, NS_RECEIVER, { type: "GET_STATUS" });
    return { apps: (reply.status?.applications ?? []).map((a: any) => String(a.displayName ?? a.appId)), volume: this.volume, muted: this.muted };
  }

  /** The media receiver running on the device and this client connected to it. */
  private async ready(): Promise<string> {
    if (this.transportId) return this.transportId;
    let reply = await this.ask(RECEIVER, NS_RECEIVER, { type: "GET_STATUS" });
    let app = (reply.status?.applications ?? []).find((a: any) => a.appId === DEFAULT_MEDIA_RECEIVER);
    if (!app) {
      reply = await this.ask(RECEIVER, NS_RECEIVER, { type: "LAUNCH", appId: DEFAULT_MEDIA_RECEIVER }, LOAD_REPLY_MS);
      app = (reply.status?.applications ?? []).find((a: any) => a.appId === DEFAULT_MEDIA_RECEIVER);
    }
    if (!app?.transportId) throw new Error("The device didn't start its player");
    this.transportId = app.transportId;
    this.sessionId = app.sessionId;
    this.send(app.transportId, NS_CONNECTION, { type: "CONNECT" });
    return app.transportId;
  }

  async load(song: CastSong, positionSec: number, play: boolean): Promise<void> {
    const transport = await this.ready();
    this.media = null;
    const reply = await this.ask(
      transport,
      NS_MEDIA,
      {
        type: "LOAD",
        sessionId: this.sessionId,
        autoplay: play,
        currentTime: positionSec,
        media: {
          contentId: song.url,
          contentType: song.contentType,
          streamType: "BUFFERED",
          duration: song.duration > 0 ? song.duration : undefined,
          metadata: {
            metadataType: 3,
            title: song.title,
            artist: song.artist,
            albumName: song.album,
            images: song.art ? [{ url: song.art }] : [],
          },
        },
      },
      LOAD_REPLY_MS
    );
    this.takeMediaStatus(reply.status);
  }

  private mediaCommand(type: string, extra: object = {}): Promise<any> {
    if (!this.transportId || this.mediaSessionId === null) return Promise.reject(new Error("Nothing is loaded on the device"));
    return this.ask(this.transportId, NS_MEDIA, { type, mediaSessionId: this.mediaSessionId, ...extra });
  }

  play = (): Promise<any> => this.mediaCommand("PLAY");
  pause = (): Promise<any> => this.mediaCommand("PAUSE");
  seek = (sec: number): Promise<any> => this.mediaCommand("SEEK", { currentTime: sec });

  /** Ends the music on the device and closes its player, so it goes back to what it showed. */
  async stop(): Promise<void> {
    if (!this.sessionId) return;
    await this.ask(RECEIVER, NS_RECEIVER, { type: "STOP", sessionId: this.sessionId }).catch(() => undefined);
    this.transportId = null;
    this.sessionId = null;
    this.mediaSessionId = null;
    this.media = null;
  }

  /** Where the device stands now: asked anew when it can be, reckoned from the last answer otherwise. */
  async playback(): Promise<CastPlayback> {
    this.pingIfDue();
    if (this.transportId) {
      const reply = await this.ask(this.transportId, NS_MEDIA, { type: "GET_STATUS" });
      this.takeMediaStatus(reply.status);
    }
    const m = this.media;
    if (!m) return { state: "IDLE", position: 0, duration: 0, url: "" };
    const running = m.state === "PLAYING" ? (Date.now() - m.at) / 1000 : 0;
    return { state: m.state, idleReason: m.idleReason, position: m.position + running, duration: m.duration, url: m.url };
  }

  async setVolume(level: number): Promise<void> {
    this.volume = level;
    await this.ask(RECEIVER, NS_RECEIVER, { type: "SET_VOLUME", volume: { level } });
  }

  async setMuted(muted: boolean): Promise<void> {
    this.muted = muted;
    await this.ask(RECEIVER, NS_RECEIVER, { type: "SET_VOLUME", volume: { muted } });
  }

  /** Lets go of the device; what it plays goes on. */
  close(): void {
    if (this.closed) return;
    this.send(RECEIVER, NS_CONNECTION, { type: "CLOSE" });
    this.socket.close();
    this.shutDown();
  }
}
