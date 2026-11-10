import { clamp } from './rng';

/**
 * Beat clock driven by tap tempo. Times are seconds on a shared clock
 * (in the stress test that is just performance.now()/1000; later it is
 * server-synced time so tablet taps and the scene agree on phase).
 */
export class BeatClock {
  bpm = 128;
  /** Shared-clock time of a downbeat. */
  t0 = 0;
  private taps: number[] = [];

  beatAt(now: number): number {
    return ((now - this.t0) * this.bpm) / 60;
  }
  tap(now: number): void {
    if (this.taps.length && now - this.taps[this.taps.length - 1] > 2) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 8) this.taps.shift();
    if (this.taps.length >= 2) {
      const span = this.taps[this.taps.length - 1] - this.taps[0];
      this.bpm = clamp(Math.round(((60 * (this.taps.length - 1)) / span) * 10) / 10, 60, 200);
    }
    this.t0 = now;
  }
  /** Shift phase; positive = later. */
  nudge(seconds: number): void {
    this.t0 += seconds;
  }
}
