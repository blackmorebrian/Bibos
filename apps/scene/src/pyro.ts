/**
 * Pyrotechnics as a small CPU particle system: flame jets, CO2 geysers,
 * spark fountains, a spark waterfall off the stage roof, and 3D fireworks.
 * Pure simulation (no three.js); fx.ts draws the particles.
 *
 * Emitters sit in two places so every camera shot sees something:
 *  - the stage front (seen in the "back" shot, looking at the DJ)
 *  - the festival field: on top of the two screen towers and at the crowd's
 *    sides (seen in the wide/sweep/over shots, looking at the crowd)
 * Fireworks launch wherever the camera is currently looking.
 */

export const K = { FLAME: 0, EMBER: 1, PUFF: 2, SPARK: 3, ROCKET: 4, STAR: 5, FLASH: 6 } as const;
export type K = (typeof K)[keyof typeof K];

export interface Particle {
  k: K;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  age: number; life: number;
  s: number; // base size
  r: number; g: number; b: number;
  drag: number; grav: number;
  sky: boolean;
  seed: number;
  burst?: Burst; // rockets only
}
type Burst = 'peony' | 'willow' | 'ring' | 'palm';

export const parts: Particle[] = [];
const MAX = 7000;

type EKind = 'flame' | 'co2' | 'sparks' | 'falls';
interface Emitter { k: EKind; x: number; y: number; z: number; at: number; until: number; rate: number; acc: number }
const emitters: Emitter[] = [];

const R = Math.random;
const rr = (a: number, b: number) => a + R() * (b - a);

/* ---------- where things are ---------- */
const STAGE_Z = -1.4, DECK_Y = 1.7;
const FLAMES: [number, number, number][] = [
  ...[-32, -20, -8, 8, 20, 32].map((x) => [x, DECK_Y, STAGE_Z] as [number, number, number]),
  [-24, 20.3, 46], [24, 20.3, 46], // tower tops
  [-18, 0, 20], [18, 0, 20], [-30, 0, 64], [30, 0, 64], // flame pots at the crowd's sides
];
const GEYSERS: [number, number, number][] = [
  ...[-26, -14, 14, 26].map((x) => [x, DECK_Y, STAGE_Z] as [number, number, number]),
  [-22, 0, 30], [22, 0, 30], [-34, 0, 78], [34, 0, 78],
];
const FOUNTAINS: [number, number, number][] = [
  ...[-38, -3, 3, 38].map((x) => [x, DECK_Y, STAGE_Z] as [number, number, number]),
  [-25.3, 20.3, 46], [-22.7, 20.3, 46], [22.7, 20.3, 46], [25.3, 20.3, 46],
  [-16, 0, 12], [16, 0, 12],
];

let lookingAtStage = false;
/** fx.ts tells us which way the camera faces, so fireworks go up in view. */
export function setView(back: boolean): void { lookingAtStage = back; }

function add(p: Omit<Particle, 'age' | 'seed'>): Particle | null {
  if (parts.length >= MAX) return null;
  const q = p as Particle;
  q.age = 0;
  q.seed = R() * 100;
  parts.push(q);
  return q;
}

function emit(k: EKind, list: [number, number, number][], now: number, dur: number, rate: number, stagger = 0): void {
  // Left-to-right chase when staggered.
  const sorted = stagger ? [...list].sort((a, b) => a[0] - b[0]) : list;
  sorted.forEach(([x, y, z], i) => {
    const at = now + i * stagger;
    emitters.push({ k, x, y, z, at, until: at + dur, rate, acc: 0 });
  });
}

/* ---------- triggers ---------- */
export function fire(now: number, chase = false): void { emit('flame', FLAMES, now, 0.85, 200, chase ? 0.09 : 0); }
export function co2(now: number): void { emit('co2', GEYSERS, now, 0.9, 170); }
export function sparks(now: number): void { emit('sparks', FOUNTAINS, now, 1.8, 240); }
export function falls(now: number): void { emitters.push({ k: 'falls', x: 0, y: 33, z: -13.5, at: now, until: now + 3.5, rate: 520, acc: 0 }); }

const PALETTE: [number, number, number][] = [
  [1, 0.24, 0.5], [1, 0.76, 0.1], [0.1, 0.83, 0.77], [1, 1, 1], [0.49, 0.36, 1], [1, 0.48, 0.18], [0.4, 1, 0.5],
];
const pending: { at: number }[] = [];
/** Launch n rockets over the next second or so. */
export function fireworks(now: number, n: number): void {
  for (let i = 0; i < n; i++) pending.push({ at: now + i * rr(0.08, 0.22) });
}
function launch(): void {
  const back = lookingAtStage;
  // Behind the stage they must clear the roof and mountains; over the field they
  // burst lower so they sit inside the wide shot.
  const x = rr(-55, 55), z = back ? rr(-55, -35) : rr(55, 110);
  const vy = back ? rr(36, 44) : rr(26, 31);
  const burst: Burst = (['peony', 'peony', 'willow', 'ring', 'palm'] as Burst[])[Math.floor(R() * 5)];
  add({ k: K.ROCKET, x, y: 0, z, vx: rr(-2, 2), vy, vz: rr(-2, 2), life: 4, s: 1.1, r: 1, g: 0.85, b: 0.5, drag: 0, grav: -14, sky: true, burst });
}

function explode(p: Particle): void {
  const c1 = PALETTE[Math.floor(R() * PALETTE.length)], c2 = PALETTE[Math.floor(R() * PALETTE.length)];
  add({ k: K.FLASH, x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.35, s: 30, r: 1, g: 0.95, b: 0.8, drag: 0, grav: 0, sky: true });
  const kind = p.burst ?? 'peony';
  const n = kind === 'ring' ? 80 : kind === 'palm' ? 60 : 130;
  // Ring: a random plane; others: a sphere.
  const ay = rr(-1, 1), az = rr(-1, 1);
  for (let i = 0; i < n; i++) {
    let dx: number, dy: number, dz: number;
    if (kind === 'ring') {
      const q = (i / n) * Math.PI * 2;
      dx = Math.cos(q); dy = Math.sin(q) * (0.4 + Math.abs(ay) * 0.6); dz = Math.sin(q) * az;
    } else if (kind === 'palm') {
      const q = R() * Math.PI * 2, up = rr(0.3, 1);
      dx = Math.cos(q) * Math.sqrt(1 - up * up); dy = up; dz = Math.sin(q) * Math.sqrt(1 - up * up);
    } else {
      dy = rr(-1, 1); const q = R() * Math.PI * 2, rad = Math.sqrt(1 - dy * dy);
      dx = Math.cos(q) * rad; dz = Math.sin(q) * rad;
    }
    const willow = kind === 'willow';
    const sp = willow ? rr(11, 13) : kind === 'palm' ? rr(13, 18) : rr(17, 21);
    const c = willow ? [1, 0.78, 0.35] : i % 2 ? c1 : c2;
    add({
      k: K.STAR, x: p.x, y: p.y, z: p.z, vx: dx * sp, vy: dy * sp, vz: dz * sp,
      life: willow ? rr(2.8, 3.4) : rr(1.7, 2.3), s: willow ? 1.3 : 1.6,
      r: c[0], g: c[1], b: c[2], drag: willow ? 0.7 : 1.15, grav: willow ? -5 : -3, sky: true,
    });
  }
}

/* ---------- jetpack ---------- */
let jetAcc = 0;
/** Flame and sparks out of a flying Bibo's jetpack, pointing down. */
export function jetFlame(x: number, y: number, z: number, dt: number, thrust: number): void {
  jetAcc += 110 * dt * thrust;
  while (jetAcc >= 1) {
    jetAcc--;
    add({ k: K.FLAME, x: x + rr(-0.12, 0.12), y, z: z + 0.15, vx: rr(-0.5, 0.5), vy: rr(-9, -6), vz: rr(-0.5, 0.5), life: rr(0.22, 0.36), s: rr(0.75, 1.1), r: 1, g: 1, b: 1, drag: 2, grav: 0, sky: false });
    if (R() < 0.35) add({ k: K.SPARK, x, y, z: z + 0.15, vx: rr(-2, 2), vy: rr(-7, -3), vz: rr(-2, 2), life: rr(0.3, 0.6), s: 0.35, r: 1, g: 0.8, b: 0.4, drag: 0.6, grav: -14, sky: false });
  }
}
/** Take-off: a puff of smoke and a ring of sparks on the ground. */
export function jetBurst(x: number, z: number): void {
  for (let i = 0; i < 10; i++) add({ k: K.PUFF, x: x + rr(-0.3, 0.3), y: 0.2, z: z + rr(-0.3, 0.3), vx: rr(-3, 3), vy: rr(0.5, 2), vz: rr(-3, 3), life: rr(0.6, 1), s: rr(0.5, 0.8), r: 0.93, g: 0.96, b: 1, drag: 2.5, grav: 0, sky: false });
  for (let i = 0; i < 16; i++) { const q = (i / 16) * Math.PI * 2; add({ k: K.SPARK, x, y: 0.15, z, vx: Math.cos(q) * rr(4, 6), vy: rr(1, 3), vz: Math.sin(q) * rr(4, 6), life: rr(0.3, 0.5), s: 0.4, r: 1, g: 0.85, b: 0.45, drag: 1, grav: -10, sky: false }); }
}

/* ---------- simulation ---------- */
export function pyroTick(dt: number, now: number): void {
  for (let i = pending.length - 1; i >= 0; i--) if (now >= pending[i].at) { pending.splice(i, 1); launch(); }

  for (let i = emitters.length - 1; i >= 0; i--) {
    const e = emitters[i];
    if (now < e.at) continue;
    if (now > e.until) { emitters.splice(i, 1); continue; }
    e.acc += e.rate * dt;
    while (e.acc >= 1) { e.acc--; spawn(e); }
  }

  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.age += dt;
    if (p.age >= p.life) {
      if (p.k === K.ROCKET) explode(p);
      parts[i] = parts[parts.length - 1]; parts.pop();
      continue;
    }
    const d = Math.exp(-p.drag * dt);
    p.vx *= d; p.vy = p.vy * d + p.grav * dt; p.vz *= d;
    if (p.k === K.PUFF) { p.vx += rr(-6, 6) * dt; p.vz += rr(-6, 6) * dt; }
    if (p.k === K.EMBER) p.vx += Math.sin(p.age * 5 + p.seed) * 3 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.k === K.ROCKET) {
      // Trail, and burst near the top of the climb.
      add({ k: K.SPARK, x: p.x, y: p.y, z: p.z, vx: rr(-1, 1), vy: rr(-3, 0), vz: rr(-1, 1), life: rr(0.3, 0.6), s: 1, r: 1, g: 0.75, b: 0.4, drag: 1, grav: -6, sky: true });
      if (p.vy < 6) p.life = p.age; // explodes next tick
    }
    if (p.k === K.SPARK && !p.sky && p.y < 0.05 && p.vy < 0) { p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; } // bounce off the ground
  }
}

function spawn(e: Emitter): void {
  const { x, y, z } = e;
  switch (e.k) {
    case 'flame':
      add({ k: K.FLAME, x: x + rr(-0.4, 0.4), y, z: z + rr(-0.3, 0.3), vx: rr(-1.4, 1.4), vy: rr(18, 26), vz: rr(-1.4, 1.4), life: rr(0.6, 0.9), s: rr(2.4, 3.4), r: 1, g: 1, b: 1, drag: 1.6, grav: 3, sky: false });
      if (R() < 0.15) add({ k: K.EMBER, x, y: y + rr(2, 8), z, vx: rr(-2, 2), vy: rr(5, 10), vz: rr(-2, 2), life: rr(1.4, 2.6), s: rr(0.18, 0.32), r: 1, g: 0.55, b: 0.15, drag: 0.8, grav: -1, sky: false });
      break;
    case 'co2':
      add({ k: K.PUFF, x: x + rr(-0.2, 0.2), y, z: z + rr(-0.2, 0.2), vx: rr(-1.4, 1.4), vy: rr(27, 34), vz: rr(-1.4, 1.4), life: rr(1.2, 1.8), s: rr(0.7, 1.1), r: 0.93, g: 0.96, b: 1, drag: 2.4, grav: 0, sky: false });
      break;
    case 'sparks': {
      const gold = R() < 0.75;
      add({ k: K.SPARK, x, y, z, vx: rr(-3.5, 3.5), vy: rr(13, 19), vz: rr(-3.5, 3.5), life: rr(0.6, 1.15), s: rr(0.5, 0.8), r: 1, g: gold ? 0.82 : 1, b: gold ? 0.42 : 0.95, drag: 0.4, grav: -20, sky: false });
      break;
    }
    case 'falls':
      add({ k: K.SPARK, x: rr(-34, 34), y, z: z + rr(-0.3, 0.3), vx: rr(-0.3, 0.3), vy: rr(-1, 0), vz: rr(-0.3, 0.3), life: rr(2, 3), s: 0.45, r: 1, g: 0.8, b: 0.4, drag: 0.6, grav: -6, sky: false });
      break;
  }
}
