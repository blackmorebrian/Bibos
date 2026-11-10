/**
 * Camera shots + auto-director, ported from the prototype. Coordinates match
 * the prototype exactly (three.js lookAt gives the same handedness).
 */
import * as THREE from 'three';
import { crowd, S, pick, rnd, emote, reduceMotion, type Bibo, type ShotName } from './sim';

type Shot = { p: number[]; l: number[]; f: number };
const SHOTS: Record<ShotName, (t: number) => Shot> = {
  wide: (t) => ({ p: [Math.sin(t * 0.13) * 6, 6.6, -5], l: [Math.sin(t * 0.13) * 2.5, 4.4, 13], f: 0.92 }),
  sweep: (t) => { const x = Math.sin(t * 0.2) * 11; return { p: [x, 2, -2.8], l: [x * 0.82, 1.6, 7], f: 1 }; },
  over: (t) => ({ p: [Math.cos(t * 0.14) * 5, 10 + S.maxZ * 0.2, S.midZ - 11 + Math.sin(t * 0.11) * 1.5], l: [Math.cos(t * 0.14) * 1.5, 1.5, S.midZ + 7], f: 1.02 }),
  close: (t) => { const a = S.target || crowd[0]; return { p: [a.x + Math.sin(t * 0.35) * 0.7, 2.05, a.z - 3.7], l: [a.x, 1.55, a.z], f: 0.92 }; },
  back: (t) => ({ p: [Math.sin(t * 0.11) * 6, 8, S.maxZ + 12], l: [Math.sin(t * 0.11) * 2, 13, -17], f: 0.72 }),
};
export const SHOT_NAMES = Object.keys(SHOTS) as ShotName[];

function pickTarget(): Bibo {
  const rec = crowd.filter((a) => S.t - a.lastEmote < 3 && a.z < 16);
  if (rec.length) return pick(rec);
  const a = crowd[Math.floor(rnd() * Math.min(crowd.length, 70))];
  emote(a, pick(['dance', 'clap', 'jump'] as const));
  return a;
}

export function cutTo(n: ShotName, target?: Bibo): void {
  S.shot = n;
  S.cutAt = S.t;
  S.mx = 0;
  S.my = 0;
  if (n === 'close') S.target = target || pickTarget();
}

export function autoCut(bar: number): void {
  const pool: ShotName[] = S.lights ? ['wide', 'back', 'close', 'wide'] : ['wide', 'sweep', 'over', 'close', 'back', 'close'];
  let n = pick(pool), g = 0;
  while (n === S.shot && g++ < 8) n = pick(pool);
  cutTo(n);
  S.nextCut = bar + (n === 'close' ? 2 : pick([2, 3, 4])) * (S.lights ? 2 : 1);
}

export function updateCamera(cam: THREE.PerspectiveCamera, t: number, bar: number): void {
  if (S.auto && bar >= S.nextCut) autoCut(bar);
  const st = reduceMotion ? 0 : t;
  const sh = SHOTS[S.shot](st);
  const push = 1 + Math.min(t - S.cutAt, 12) * (reduceMotion ? 0 : 0.012);
  const dir = sh.p[2] < sh.l[2] ? 1 : -1;
  sh.p[0] += S.mx * dir; sh.l[0] += S.mx * dir;
  sh.p[1] = Math.max(0.8, sh.p[1] + S.my); sh.l[1] += S.my;
  if (S.shake > 0.01 && !reduceMotion) { sh.l[0] += (rnd() - 0.5) * S.shake * 0.9; sh.l[1] += (rnd() - 0.5) * S.shake * 0.9; }
  const fm = sh.f * S.zoom * push;
  cam.fov = (2 * Math.atan(1 / (2.2 * fm)) * 180) / Math.PI;
  cam.position.set(sh.p[0], sh.p[1], sh.p[2]);
  cam.lookAt(sh.l[0], sh.l[1], sh.l[2]);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
}
