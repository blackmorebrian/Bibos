/**
 * Light looks shared by the moving heads (lights.ts) and the stage LEDs
 * (world.ts), plus strobe timing. Pure math, no three.js.
 *
 * Motion looks move the beams; chase looks mostly switch fixtures on and off
 * in a pattern. Every look also has an on/off pattern so the LED strip and
 * screen rings can follow it.
 */

/** Order of the auto show (each look runs 4 bars). */
export const LOOKS = [
  'fan', 'cross', 'chase', 'wave', 'pulse', 'sweep', 'circle', 'bounce', 'ballyhoo', 'center', 'snap', 'tilt', 'random',
];

const fract = (x: number) => x - Math.floor(x);
/** Stable pseudo-random 0..1 for a fixture and a step. */
export const hash = (a: number, b: number) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453);

/** Where a beam points: ang = side to side (-1..1), tilt = low..high (0..1), amp = brightness. */
export interface Aim { ang: number; tilt: number; amp: number }

export function aim(look: string, i: number, u: number, beat: number, kick: number, t: number): Aim {
  const s = u * 2 - 1;
  switch (look) {
    case 'fan': return { ang: s * (0.7 + 0.25 * Math.sin(t * 0.6)), tilt: 0.55 + 0.2 * Math.sin(t * 0.8), amp: 1 };
    case 'cross': return { ang: (i % 2 ? 1 : -1) * (0.2 + 0.7 * Math.sin(t * 0.9 + u)), tilt: 0.5, amp: 1 };
    case 'wave': return { ang: s * 0.55, tilt: 0.5 + 0.4 * Math.sin(beat * Math.PI * 0.5 - u * 5), amp: 1 };
    case 'pulse': return { ang: s * (0.12 + 0.75 * kick), tilt: 0.35 + 0.25 * kick, amp: 0.5 + 0.7 * kick };
    // All heads together, sweeping side to side.
    case 'sweep': return { ang: 0.85 * Math.sin(t * 0.9) + s * 0.15, tilt: 0.5 + 0.12 * Math.sin(t * 1.8), amp: 1 };
    // Each head traces a circle, offset around the rig.
    case 'circle': { const q = t * 1.6 + u * Math.PI * 2; return { ang: s * 0.35 + 0.4 * Math.cos(q), tilt: 0.5 + 0.32 * Math.sin(q), amp: 1 }; }
    // Fast, wild figure-of-eights, all different.
    case 'ballyhoo': return { ang: 0.8 * Math.sin(t * 1.3 + i * 1.7), tilt: 0.5 + 0.42 * Math.sin(t * 2.1 + i * 2.3), amp: 1 };
    // Jump to a new random spot on every beat (quick move, then hold).
    case 'snap': {
      const k = Math.floor(beat), e = Math.min(1, fract(beat) / 0.12), m = e * e * (3 - 2 * e);
      const a0 = hash(i, k - 1) * 1.6 - 0.8, a1 = hash(i, k) * 1.6 - 0.8;
      const t0 = 0.2 + hash(i + 50, k - 1) * 0.7, t1 = 0.2 + hash(i + 50, k) * 0.7;
      return { ang: a0 + (a1 - a0) * m, tilt: t0 + (t1 - t0) * m, amp: 1 };
    }
    // Everyone tilts up on the kick and falls back down.
    case 'tilt': return { ang: s * 0.5, tilt: 0.15 + 0.75 * kick, amp: 0.7 + 0.5 * kick };
    // Chase family: fixed fan, brightness does the moving.
    default: return { ang: s * 0.6, tilt: 0.5, amp: chaseLevel(look, u, beat, kick, t) };
  }
}

/** On/off pattern across a row of lights (u = 0 left .. 1 right). About 0..1.25. */
export function chaseLevel(look: string, u: number, beat: number, kick: number, t: number): number {
  const spot = (d: number, w: number) => Math.max(0, 1 - (d / w) * (d / w));
  switch (look) {
    case 'chase': { // left to right, twice a bar-half
      const d = fract(beat * 0.5 - u * 1.5);
      return 0.12 + 1.15 * Math.pow(Math.max(0, Math.cos(d * Math.PI * 2)), 6);
    }
    case 'bounce': { // ping-pong
      const p = fract(beat / 4), head = p < 0.5 ? p * 2 : 2 - p * 2;
      return 0.1 + 1.15 * spot(u - head, 0.16);
    }
    case 'center': { // out from the middle on every beat
      const head = fract(beat), d = Math.abs(u - 0.5) * 2;
      return 0.1 + 1.15 * spot(d - head, 0.22);
    }
    case 'random': { // random fixtures pop on each 8th note
      const k = Math.floor(beat * 2);
      return hash(Math.round(u * 40), k) > 0.62 ? 1.2 * (1 - fract(beat * 2) * 0.6) : 0.08;
    }
    case 'cross': return Math.round(u * 24 + Math.floor(beat)) % 2 ? 1 : 0.12;
    case 'wave': return 0.5 + 0.5 * Math.sin(beat * Math.PI - u * 9);
    case 'pulse': case 'tilt': return 0.1 + kick * 1.15;
    case 'sweep': return 0.15 + spot(u - (0.5 + 0.45 * Math.sin(t * 0.9)), 0.25);
    case 'circle': return 0.55 + 0.45 * Math.sin(t * 1.6 + u * Math.PI * 2);
    case 'ballyhoo': return 0.4 + 0.6 * Math.abs(Math.sin(t * 3 + u * 17));
    case 'snap': return hash(Math.round(u * 40), Math.floor(beat)) > 0.5 ? 1 : 0.2;
    default: return 0.7 + 0.3 * kick; // fan: steady, breathing on the kick
  }
}

/** Strobe speeds, in flashes per beat. */
export const STROBE_RATES = [0.5, 1, 2, 4];

/**
 * Brightness multiplier while strobing. Slow rates go fully dark between
 * flashes; faster rates keep more light between hits, so the fast settings
 * flicker rather than blink hard on and off (gentler for viewers sensitive
 * to flashing).
 */
export function strobeLevel(beat: number, rate: number): number {
  const p = fract(beat * rate);
  const low = rate >= 4 ? 0.5 : rate >= 2 ? 0.3 : 0.06;
  return p < 0.16 * Math.min(1.5, rate) ? 1.25 : low;
}
