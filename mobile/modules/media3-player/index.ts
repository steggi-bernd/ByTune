/** The native player (android/): commands in, one state event out. */
import { NativeModule, requireNativeModule } from "expo";

export type RepeatMode = "off" | "all" | "one";

export interface QueueItem {
  id: string;
  url: string;
  title: string;
  artist: string;
  album: string;
  artworkUrl?: string;
  /** a loudness gain in dB; only ever lowers the volume */
  gainDb?: number;
}

export interface PlaybackState {
  isPlaying: boolean;
  /** asked to play: also true while it buffers */
  playWhenReady: boolean;
  isBuffering: boolean;
  isEnded: boolean;
  index: number;
  count: number;
  positionMs: number;
  durationMs: number;
  /** how fast the connection delivers while the player wants data; 0 before it has measured anything */
  bandwidthBps: number;
  /** what the sound goes through: decoder, output, speed */
  audio: string;
  repeat: RepeatMode;
}

export interface NetworkState {
  connected: boolean;
  /** it costs by the byte: mobile data, a phone's hotspot */
  metered: boolean;
}

export interface DownloadJob {
  job: number;
  status: "waiting" | "wifi" | "running" | "done" | "failed";
  /** the server's HTTP status when it refused */
  reason: number;
  /** what went wrong, in words */
  problem: string;
  loaded: number;
  /** -1 when the server doesn't say */
  total: number;
}

type Events = {
  onState(state: PlaybackState): void;
  onError(error: { message: string; code?: string }): void;
  onNetwork(state: NetworkState): void;
};

declare class Media3PlayerModule extends NativeModule<Events> {
  setAuth(server: string, headers: Record<string, string>, addresses: string[]): Promise<void>;
  setKeep24Bit(on: boolean, restart: boolean): Promise<void>;
  setGain(gainDb: number): Promise<void>;
  getNetwork(): Promise<NetworkState>;
  downloadStart(url: string, headers: Record<string, string>, fileName: string, wifiOnly: boolean): Promise<number>;
  downloadQuery(jobs: number[]): Promise<DownloadJob[]>;
  downloadFinish(job: number): Promise<{ file: string; bytes: number } | null>;
  downloadCancel(job: number): Promise<void>;
  downloadDelete(path: string): Promise<void>;
  downloadExisting(paths: string[]): Promise<string[]>;
  setQueue(items: QueueItem[], startIndex: number, startMs: number, play: boolean): Promise<void>;
  replaceUpcoming(items: QueueItem[]): Promise<void>;
  replaceCurrent(item: QueueItem, positionMs: number): Promise<void>;
  addItems(items: QueueItem[]): Promise<void>;
  removeItem(index: number): Promise<void>;
  moveItem(from: number, to: number): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(positionMs: number): Promise<void>;
  skipTo(index: number, play: boolean): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  setRepeat(mode: RepeatMode): Promise<void>;
  getState(): Promise<PlaybackState>;
}

export default requireNativeModule<Media3PlayerModule>("Media3Player");
