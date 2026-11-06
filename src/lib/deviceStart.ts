/**
 * Whether a device on the network really started what it was handed. A receiver
 * coming out of standby says yes to everything, forgets it on the way up and sits
 * there silent once it's awake, so "it took the command" says nothing. This
 * goes by what the device reports afterwards: it gets the song again from time
 * to time until it plays, and after long enough it counts as not having started.
 *
 * Pure, one copy for the computer and the phone; electron/device-player.ts uses it.
 */
import type { ZonePlayState } from "./zoneEngine";

/** How long a device may take: a receiver waking up can need most of this. */
export const START_PATIENCE_MS = 60_000;
/** Silent this long since it was handed the song, it gets it again: the gap grows, so a slow one isn't kept from starting. */
const FIRST_GAP_MS = 6000;
const LONGEST_GAP_MS = 15_000;
/** One that says it's working on it is left alone for longer. */
const WORKING_MS = 20_000;

export type StartStep = "wait" | "hand-again" | "started" | "failed";

export class StartWatch {
  /** it was handed something to play and hasn't started it yet */
  active = false;
  private since = 0;
  private handedAt = 0;
  private gap = FIRST_GAP_MS;

  begin(now = Date.now()): void {
    this.active = true;
    this.since = this.handedAt = now;
    this.gap = FIRST_GAP_MS;
  }

  /** Nothing to wait for any more: somebody paused or stopped it. */
  cancel(): void {
    this.active = false;
  }

  /** How long ago it last got the song. */
  sinceHanded(now = Date.now()): number {
    return now - this.handedAt;
  }

  /** What to do, going by what it says now; `null` when it doesn't answer. */
  see(state: ZonePlayState | null, now = Date.now()): StartStep {
    if (!this.active) return "started";
    if (state === "playing") {
      this.active = false;
      return "started";
    }
    if (now - this.since >= START_PATIENCE_MS) {
      this.active = false;
      return "failed";
    }
    if (now - this.handedAt < (state === "loading" ? Math.max(this.gap, WORKING_MS) : this.gap)) return "wait";
    this.handedAt = now;
    this.gap = Math.min(LONGEST_GAP_MS, this.gap * 1.5);
    return "hand-again";
  }
}
