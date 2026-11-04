import { T } from "./i18n";
/**
 * A zone: music on one network device or a group of them, with a queue of its
 * own, apart from what the app itself is playing. The same engine runs on the
 * phone and the computer; how a device is actually spoken to (UPnP, Cast) is its
 * driver's business. Somebody has to call tick() about once a second: that's what
 * notices a song's end and moves the zone on.
 *
 * A group plays the same song on each member, started together. It isn't sample
 * exact: each device fetches and buffers on its own, which you can hear between
 * two speakers in one room. A Cast group made in Google's own app is exact, and
 * is one device here.
 */

export interface ZoneSong {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  art?: string;
}

export type ZonePlayState = "idle" | "loading" | "playing" | "paused" | "stopped";

export interface ZoneDeviceStatus {
  state: ZonePlayState;
  position: number;
  duration: number;
  /** played to its end, since the last status */
  ended: boolean;
}

export interface ZoneDriver {
  load(song: ZoneSong, positionSec: number, play: boolean): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  seek(sec: number): Promise<void>;
  status(): Promise<ZoneDeviceStatus>;
  setVolume(level: number): Promise<void>;
  /** 0–1; null when it can't be read or set from here */
  getVolume(): Promise<number | null>;
  /** The connection isn't needed any more. */
  close(): void;
}

export interface ZoneMember {
  deviceId: string;
  name: string;
  driver: ZoneDriver;
  volume: number | null;
}

export interface ZoneState {
  queue: ZoneSong[];
  index: number;
  state: ZonePlayState;
  position: number;
  duration: number;
  repeat: "off" | "all" | "one";
  error: string | null;
}

/** Statuses in a row without an answer before a device counts as gone. */
const LOST_AFTER = 8;
/** After a command the device's reports may still show the state before it. */
const SETTLE_MS = 2500;
/** A status asked for that never came back; on a phone in the background its own timeout can't fire either. */
const TICK_PATIENCE_MS = 15_000;

export class Zone {
  members: ZoneMember[];
  private lost = new Map<string, number>();
  private lastCommandAt = 0;
  private loadSeq = 0;
  private tickingSince = 0;
  /** A song that was asked to play and hasn't started yet: since when. */
  private startingSince: number | null = null;
  state: ZoneState = { queue: [], index: 0, state: "idle", position: 0, duration: 0, repeat: "off", error: null };

  constructor(
    members: ZoneMember[],
    /** Something changed: the screen wants to know. */
    private onChange: (zone: Zone) => void
  ) {
    this.members = members;
  }

  private set(next: Partial<ZoneState>): void {
    this.state = { ...this.state, ...next };
    this.onChange(this);
  }

  private get current(): ZoneSong | undefined {
    return this.state.queue[this.state.index];
  }

  private all(action: (member: ZoneMember) => Promise<unknown>): Promise<void> {
    this.lastCommandAt = Date.now();
    return Promise.allSettled(this.members.map(action)).then((results) => {
      const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      if (failed && results.every((r) => r.status === "rejected")) {
        this.set({ error: failed.reason instanceof Error ? failed.reason.message : T("The device didn't take that") });
      }
    });
  }

  private async loadCurrent(position: number, play: boolean): Promise<void> {
    const song = this.current;
    if (!song) return;
    const seq = ++this.loadSeq;
    this.startingSince = play ? Date.now() : null;
    this.set({ state: "loading", position, duration: song.duration, error: null });
    await this.all((m) => m.driver.load(song, position, play));
    if (seq !== this.loadSeq) return;
    this.lastCommandAt = Date.now();
    this.set({ state: this.state.error ? "stopped" : play ? "playing" : "paused" });
  }

  /** Songs to play here, from one of them on. */
  play(queue: ZoneSong[], index = 0, position = 0, play = true): Promise<void> {
    this.state = { ...this.state, queue, index: Math.max(0, Math.min(index, queue.length - 1)) };
    return this.loadCurrent(position, play);
  }

  toggle(): Promise<void> {
    if (!this.current) return Promise.resolve();
    if (this.state.state === "playing" || this.state.state === "loading") {
      this.set({ state: "paused" });
      return this.all((m) => m.driver.pause());
    }
    // A device that let go of the song starts it again; one that merely paused goes on.
    if (this.state.state === "stopped" || this.state.state === "idle") return this.loadCurrent(this.state.position, true);
    this.set({ state: "playing" });
    return this.all((m) => m.driver.play());
  }

  pause(): Promise<void> {
    if (this.state.state !== "playing" && this.state.state !== "loading") return Promise.resolve();
    return this.toggle();
  }

  next(manual = true): Promise<void> {
    const { queue, index, repeat } = this.state;
    if (!queue.length) return Promise.resolve();
    if (repeat === "one" && !manual) return this.loadCurrent(0, true);
    const at = index + 1;
    if (at >= queue.length) {
      if (repeat !== "all" && !manual) {
        this.set({ state: "stopped", position: 0 });
        return Promise.resolve();
      }
      this.state = { ...this.state, index: 0 };
      return this.loadCurrent(0, true);
    }
    this.state = { ...this.state, index: at };
    return this.loadCurrent(0, true);
  }

  previous(): Promise<void> {
    const { index, position, queue } = this.state;
    if (!queue.length) return Promise.resolve();
    if (position > 3 || index === 0) {
      return this.state.state === "stopped" || this.state.state === "idle" ? this.loadCurrent(0, true) : this.seek(0);
    }
    this.state = { ...this.state, index: index - 1 };
    return this.loadCurrent(0, true);
  }

  jump(index: number): Promise<void> {
    if (!this.state.queue[index]) return Promise.resolve();
    this.state = { ...this.state, index };
    return this.loadCurrent(0, true);
  }

  seek(sec: number): Promise<void> {
    this.set({ position: sec });
    return this.all((m) => m.driver.seek(sec));
  }

  /** What was coming is replaced; the song on stays on. */
  setUpcoming(songs: ZoneSong[]): void {
    const { queue, index } = this.state;
    this.set({ queue: [...queue.slice(0, index + 1), ...songs] });
  }

  insert(at: number, songs: ZoneSong[]): void {
    const { queue } = this.state;
    this.set({ queue: [...queue.slice(0, at), ...songs, ...queue.slice(at)] });
  }

  remove(index: number): void {
    const { queue, index: current } = this.state;
    if (index === current || !queue[index]) return;
    this.set({ queue: queue.filter((_, i) => i !== index), index: index < current ? current - 1 : current });
  }

  move(from: number, to: number): void {
    const { queue, index: current } = this.state;
    if (from === current || !queue[from] || !queue[to]) return;
    const next = [...queue];
    const [song] = next.splice(from, 1);
    next.splice(to, 0, song);
    const shift = from < current && to >= current ? -1 : from > current && to <= current ? 1 : 0;
    this.set({ queue: next, index: current + shift });
  }

  setRepeat(repeat: ZoneState["repeat"]): void {
    this.set({ repeat });
  }

  /** Another device joins: it starts the same song from where the others are. */
  async join(member: ZoneMember): Promise<void> {
    if (this.members.some((m) => m.deviceId === member.deviceId)) return;
    this.members = [...this.members, member];
    member.volume = await member.driver.getVolume().catch(() => null);
    const song = this.current;
    if (song && this.state.state !== "stopped" && this.state.state !== "idle") {
      await member.driver.load(song, this.state.position, this.state.state === "playing").catch((err: unknown) => {
        this.members = this.members.filter((m) => m !== member);
        this.set({ error: err instanceof Error ? err.message : T("{name} can't join", { name: member.name }) });
      });
    }
    this.onChange(this);
  }

  /** A device leaves; the others go on. Answers whether any are left. */
  async leave(deviceId: string): Promise<boolean> {
    const member = this.members.find((m) => m.deviceId === deviceId);
    if (!member) return this.members.length > 0;
    this.members = this.members.filter((m) => m !== member);
    await member.driver.stop().catch(() => undefined);
    member.driver.close();
    this.onChange(this);
    return this.members.length > 0;
  }

  async setVolume(deviceId: string, level: number): Promise<void> {
    const member = this.members.find((m) => m.deviceId === deviceId);
    if (!member) return;
    member.volume = level;
    this.onChange(this);
    await member.driver.setVolume(level).catch(() => undefined);
  }

  /** Everything stops and the devices are let go. */
  async stop(): Promise<void> {
    this.loadSeq += 1;
    const members = this.members;
    this.members = [];
    await Promise.allSettled(members.map((m) => m.driver.stop()));
    for (const m of members) m.driver.close();
    this.set({ state: "stopped" });
  }

  /** Lets go of the devices without stopping them. */
  release(): void {
    this.loadSeq += 1;
    for (const m of this.members) m.driver.close();
    this.members = [];
  }

  /** Once a second: where the first device stands is where the zone stands. */
  async tick(): Promise<void> {
    if (!this.members.length || !this.current) return;
    if (this.tickingSince && Date.now() - this.tickingSince < TICK_PATIENCE_MS) return;
    const started = Date.now();
    this.tickingSince = started;
    const song = this.current;
    try {
      const leader = this.members[0];
      let status: ZoneDeviceStatus;
      try {
        status = await leader.driver.status();
        this.lost.delete(leader.deviceId);
      } catch (err) {
        const misses = (this.lost.get(leader.deviceId) ?? 0) + 1;
        this.lost.set(leader.deviceId, misses);
        if (misses >= LOST_AFTER) {
          this.lost.delete(leader.deviceId);
          // The next one takes over; with none left the zone says so and stands still.
          this.members = this.members.slice(1);
          leader.driver.close();
          this.set({ error: T("{name} stopped answering", { name: leader.name }), state: this.members.length ? this.state.state : "stopped" });
        }
        return;
      }
      if (song !== this.current) return;
      if (status.ended) {
        await this.next(false);
        return;
      }
      if (status.state === "playing") this.startingSince = null;
      if (status.state === "loading") return;
      const settled = Date.now() - this.lastCommandAt > SETTLE_MS;
      const changes: Partial<ZoneState> = {};
      if (settled || status.state === "playing") {
        changes.position = status.position;
        if (status.duration > 0) changes.duration = status.duration;
      }
      // Paused or stopped on the device itself: the zone follows, but not while a song starts.
      if (settled && this.startingSince === null && status.state !== this.state.state) changes.state = status.state;
      if (Object.keys(changes).length) this.set(changes);
    } finally {
      if (this.tickingSince === started) this.tickingSince = 0;
    }
  }
}
