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
  /** what the player measures of the connection; 0 before it has anything */
  bandwidthBps: number;
  repeat: RepeatMode;
}

type Events = {
  onState(state: PlaybackState): void;
  onError(error: { message: string; code?: string }): void;
};

declare class Media3PlayerModule extends NativeModule<Events> {
  setAuth(server: string, headers: Record<string, string>): Promise<void>;
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
