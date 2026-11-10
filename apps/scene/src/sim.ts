/**
 * Scene state and crowd simulation (fake viewers + fake chat), ported from the
 * prototype. In the real build, joins/actions/chat arrive from the server; the
 * state shape and scoring rules stay.
 */
import {
  ACTION_DURATION, ACTIONS, BeatClock, BODY_COLORS, EM, EXTRAS, HATS, HEADS, PATTERNS, PLACEHOLDER_EMOTES, SHIRT_COLORS,
  clamp, mulberry, type ActionId, type BiboLook,
} from '@bibos/shared';
import { params } from './params';

export let rnd = mulberry(params.seed);
export const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const range = (a: number, b: number) => a + rnd() * (b - a);

/** True when reading a real Twitch channel: fake chat stops, real chat drives energy. */
export const live = !!params.channel;

export const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export const S = {
  t: 0,
  beat: 0,
  E: 0.5,
  boost: 0,
  lights: false,
  lightsAt: -99,
  dim: 0,
  flash: 0,
  shake: 0,
  pyro: 0,
  co2: 0,
  look: 'auto' as string,
  auto: !reduceMotion,
  shot: 'wide' as ShotName,
  cutAt: 0,
  target: null as Bibo | null,
  nextCut: 3,
  zoom: 1,
  mx: 0,
  my: 0,
  chat: params.chat,
  heat: 0,
  chatE: 0.4,
  meter: 0.3,
  mShow: 0.3,
  msgDebt: 0,
  actDebt: 0,
  spam: null as null | { em: string; until: number },
  waveAt: -99,
  hypeAt: -99,
  counts: {} as Record<string, number>,
  /** Rolling channel baseline of chat heat (live mode), so small and big channels both work. */
  base: 4,
  /** Distinct real chatters in the last minute. */
  active: 0,
  /** Recently used Twitch emote keys ("tw:<id>"), newest last. */
  recentEmotes: [] as string[],
  /** When the "how to join" commands card last appeared (first auto-show ~30 s after load). */
  helpAt: -(Math.max(1, params.help) * 60) + 30,
  midZ: 8,
  maxZ: 20,
  K: 20,
};
export type ShotName = 'wide' | 'sweep' | 'over' | 'close' | 'back';
export const clock = new BeatClock();

export interface Bibo {
  id: number;
  x: number;
  z: number;
  name: string;
  nameColor: string;
  look: BiboLook;
  off: number;
  amp: number;
  seed: number;
  hype: number;
  em: number;
  emEnd: number;
  lastEmote: number;
  born: number;
  hold: number; // 0 lighter, 1 phone
  holdAt: number;
  lastChat: number;
  dirty: boolean;
  /** Twitch login of the real viewer who owns this Bibo (undefined = NPC). */
  viewer?: string;
}

/* ---------- crowd slots: rows of a loose grid, nearest the stage first ---------- */
interface Slot { x: number; z: number; k: number }
const slots: Slot[] = [];
function ensureSlots(n: number): void {
  if (slots.length >= n) return;
  const r2 = mulberry(19);
  slots.length = 0;
  for (let r = 0; slots.length < n * 1.15 + 50; r++) {
    const half = 13 + Math.floor(r * 0.25);
    for (let c = -half; c <= half; c++) {
      const x = c * 1.07 + (r % 2 ? 0.53 : 0) + (r2() - 0.5) * 0.42;
      const z = 4.6 + r * 1.03 + (r2() - 0.5) * 0.42; // first row clear of the stage and inside the wide shot
      slots.push({ x, z, k: z + Math.abs(x) * 0.55 });
    }
  }
  slots.sort((a, b) => a.k - b.k);
}

const W1 = ['mosh', 'sad', 'disco', 'lofi', 'basement', 'neon', 'tiny', 'loud', 'sleepy', 'grumpy', 'soggy', 'turbo', 'cosmic', 'haunted', 'feral', 'crispy'];
const W2 = ['gremlin', 'toast', 'possum', 'goblin', 'waffle', 'moth', 'kevin', 'pigeon', 'noodle', 'raccoon', 'dad', 'bagel', 'ghost', 'frog'];
const W3 = ['', '', '_irl', '99', '_tv', 'xo', '2004', '_ct'];
const NAMECOL = ['#d81b60', '#1d4ed8', '#047857', '#7c3aed', '#c2410c', '#0e7490'];

export function makeBot(id: number, slot: Slot, born: number): Bibo {
  return {
    id, x: slot.x, z: slot.z,
    name: pick(W1) + '_' + pick(W2) + pick(W3),
    nameColor: pick(NAMECOL),
    look: {
      head: Math.floor(rnd() * HEADS.length),
      hat: Math.floor(rnd() * HATS.length),
      extra: rnd() < 0.35 ? 0 : Math.floor(rnd() * EXTRAS.length),
      color: Math.floor(rnd() * BODY_COLORS.length),
      shirt: Math.floor(rnd() * SHIRT_COLORS.length),
      pattern: Math.floor(rnd() * PATTERNS.length),
    },
    off: (rnd() - 0.5) * 0.14,
    amp: range(0.75, 1.2),
    seed: rnd() * Math.PI * 2,
    hype: range(0.45, 1.25),
    em: 0, emEnd: 0, lastEmote: -99, born,
    hold: rnd() < 0.62 ? 0 : 1,
    holdAt: range(0, 4),
    lastChat: -9,
    dirty: true,
  };
}

export const crowd: Bibo[] = [];
/** Bumped whenever crowd membership changes, so renderers rebuild. */
export let crowdVersion = 0;

export function setCrowd(n: number): void {
  n = Math.max(0, Math.floor(n));
  ensureSlots(n);
  while (crowd.length < n) crowd.push(makeBot(crowd.length, slots[crowd.length], crowd.length < 140 ? -10 : S.t));
  while (crowd.length > n) crowd.pop();
  crowdChanged();
}

/** Crowd footprint drives camera framing, light aim and where the painted backdrop crowd starts.
 *  Never smaller than ~80 spots, so an empty or tiny crowd still has an open area in front of the stage. */
const MIN_FOOTPRINT = 150;
function crowdChanged(): void {
  const m = Math.max(crowd.length, MIN_FOOTPRINT);
  ensureSlots(m);
  let sum = 0, max = 0, K = 0;
  for (let i = 0; i < m; i++) {
    const p = crowd[i] ?? slots[i];
    sum += p.z; if (p.z > max) max = p.z; K = Math.max(K, p.z + Math.abs(p.x) * 0.55);
  }
  S.midZ = sum / m;
  S.maxZ = max;
  S.K = K;
  crowdVersion++;
}

/** A new Bibo in the next free spot (front rows fill first). */
export function appendBibo(): Bibo {
  ensureSlots(crowd.length + 1);
  const a = makeBot(crowd.length, slots[crowd.length], S.t);
  crowd.push(a);
  crowdChanged();
  return a;
}

/** Remove a Bibo. The newest arrival steps into the gap so the crowd stays packed. */
export function removeBibo(a: Bibo): void {
  const last = crowd.pop()!;
  if (last !== a) { last.x = a.x; last.z = a.z; last.id = a.id; crowd[a.id] = last; last.dirty = true; }
  if (S.target === a) S.target = null;
  crowdChanged();
}

export function emote(a: Bibo, act: ActionId, extra = 0): void {
  a.em = EM[act];
  a.emEnd = S.t + ACTION_DURATION[act] + extra;
  a.lastEmote = S.t;
  a.dirty = true;
}

/* ---------- floating emotes ---------- */
export interface Float { x: number; z: number; em: string; sea: boolean; at: number; life: number; dx: number }
export const floats: Float[] = [];
export function addFloat(x: number, z: number, em: string, sea: boolean): void {
  if (sea && !params.backdrop) return;
  if (floats.length < 240) floats.push({ x, z, em, sea, at: S.t, life: 2.1 + rnd() * 0.7, dx: rnd() * Math.PI * 2 });
}

/** Far filler crowd points (used for sea emotes and lights-down glows). */
export const SEA: [number, number, number, boolean][] = [];
{
  const r = mulberry(41);
  for (let i = 0; i < 460; i++) {
    const z = 14 + Math.pow(r(), 1.4) * 140;
    SEA.push([(r() - 0.5) * (60 + z * 1.5), z, r() * Math.PI * 2, r() < 0.62]);
  }
}

/* ---------- chat + hype meter (prototype scoring; real build uses channel rolling average) ---------- */
function chatMsg(a: Bibo, em: string | null): void {
  const capped = S.t - a.lastChat < 2;
  if (em) addFloat(a.x, a.z, em, false);
  if (capped) return;
  a.lastChat = S.t;
  S.heat += 1 + (em ? 1.5 : 0);
  if (em) S.counts[em] = (S.counts[em] || 0) + 1;
}

/** Real chat message (live mode). Counted once per person per 2 s, like the prototype. */
const lastChatBy = new Map<string, number>();
export function liveChat(login: string, em: string | null): void {
  if (S.t - (lastChatBy.get(login) ?? -99) < 2) return;
  lastChatBy.set(login, S.t);
  S.heat += 1 + (em ? 1.5 : 0);
  if (em) S.counts[em] = (S.counts[em] || 0) + 1;
}
function countActive(): number {
  let n = 0;
  for (const [k, at] of lastChatBy) { if (S.t - at < 60) n++; else if (S.t - at > 600) lastChatBy.delete(k); }
  return n;
}

/** Recent joins, for the on-screen "X joined" toasts. */
export const joins: { name: string; color: string; at: number }[] = [];

export interface Firework { x: number; y: number; at: number; c: string; s: number }
export const fireworks: Firework[] = [];
export interface Confetto { x: number; y: number; z: number; v: number; ph: number; c: string; sz: number }
export const confetti: Confetto[] = [];
const CF = ['#ff3d81', '#ffc21a', '#19d3c5', '#ffffff', '#7c5cff', '#ff7a2f'];
export function spawnConfetti(n: number): void {
  for (let i = 0; i < n && confetti.length < 420; i++) {
    confetti.push({ x: (rnd() - 0.5) * 28, y: 6 + rnd() * 9, z: rnd() * 24, v: 1.6 + rnd() * 1.6, ph: rnd() * Math.PI * 2, c: CF[i % CF.length], sz: 0.14 + rnd() * 0.14 });
  }
}
function addFireworks(n: number, spread: number): void {
  if (reduceMotion) return;
  for (let i = 0; i < n; i++) fireworks.push({ x: 0.08 + rnd() * 0.84, y: 0.1 + rnd() * spread, at: S.t + i * 0.2, c: CF[i % CF.length], s: rnd() * Math.PI * 2 });
}

export function hypeBurst(): void {
  S.hypeAt = S.t;
  S.boost = Math.max(S.boost, 0.8);
  S.pyro = 1;
  S.flash = 0.4;
  spawnConfetti(300);
  addFireworks(9, 0.22);
  const pool: readonly string[] = live && S.recentEmotes.length ? S.recentEmotes : PLACEHOLDER_EMOTES;
  crowd.forEach((a, i) => {
    emote(a, 'jump', rnd() * 1.2 - 0.4);
    if (i < 130) addFloat(a.x, a.z, pool[i % pool.length], false);
  });
  // The painted backdrop crowd joins in too, so a small crowd still gets a big moment.
  for (let i = 0; i < 40; i++) { const sp = SEA[Math.floor(rnd() * SEA.length)]; if (sp[1] > S.maxZ + 2) addFloat(sp[0], sp[1], pool[i % pool.length], true); }
}

export function drop(): void {
  S.boost = 1;
  S.flash = 1;
  S.shake = 1;
  S.pyro = 1;
  if (S.lights) toggleLights();
  addFireworks(7, 0.26);
  for (const a of crowd) emote(a, 'jump', rnd() * 1.4 - 0.4);
  spawnConfetti(380);
}

export function toggleLights(): void {
  S.lights = !S.lights;
  S.lightsAt = S.t;
  if (S.lights) for (const a of crowd) { if (a.em) { a.em = 0; a.dirty = true; } }
}

export function spamEmote(em: string): void {
  S.spam = { em, until: S.t + 3.5 };
}

export function simTick(dt: number): void {
  const t = S.t, n = crowd.length;
  const spam = S.spam && t < S.spam.until;
  if (!live) S.msgDebt += n * (0.35 * Math.pow(S.chat, 1.5) + (spam ? 0.75 : 0)) * dt;
  let guard = 0;
  if (!n) S.msgDebt = 0;
  while (S.msgDebt >= 1 && guard++ < 400) {
    S.msgDebt--;
    const a = crowd[Math.floor(rnd() * n)];
    const em = spam && rnd() < 0.85 ? S.spam!.em : rnd() < 0.62 ? pick(PLACEHOLDER_EMOTES) : null;
    chatMsg(a, em);
    if (em && rnd() < 0.35) {
      const sp = SEA[Math.floor(rnd() * SEA.length)];
      if (sp[1] > S.maxZ + 2) addFloat(sp[0], sp[1], em, true);
    }
  }
  S.msgDebt = Math.min(S.msgDebt, 5);
  S.heat *= Math.exp(-dt / 6);
  let target: number, waveNeed: number;
  if (live && params.help > 0 && t - S.helpAt > params.help * 60) S.helpAt = t;
  if (live) {
    // Relative to this channel's usual activity: ~normal chat sits around 0.4,
    // about double the usual rate pushes toward 1 and fills the meter.
    // Learns quickly in the first minutes after the source loads, then settles to a ~10 min average.
    S.base = Math.max(4, S.base + (S.heat - S.base) * Math.min(1, dt / Math.min(600, 20 + t)));
    // Warm-up after a (re)load: heat is still ramping, so don't mistake normal chat for a hype spike.
    if (t < 45) S.base = Math.max(S.base, S.heat);
    target = clamp(S.heat / (2.5 * S.base), 0, 1);
    S.active = countActive();
    waveNeed = Math.max(3, S.active * 0.4);
  } else {
    target = clamp(S.heat / (n * 1.6), 0, 1);
    waveNeed = n * 0.32;
  }
  S.chatE += (target - S.chatE) * Math.min(1, dt * 1.5);
  for (const k in S.counts) {
    S.counts[k] *= Math.exp(-dt / 2);
    if (S.counts[k] > waveNeed && t - S.waveAt > 7) S.waveAt = t;
  }
  if (t - S.hypeAt < 8) S.meter *= Math.exp(-dt * 0.9);
  else {
    S.meter = clamp(S.meter + dt * (Math.pow(S.chatE, 2.5) * 0.32 - 0.03), 0, 1);
    if (S.meter >= 1 && !S.lights) hypeBurst();
  }
  S.mShow += (S.meter - S.mShow) * Math.min(1, dt * 7);

  // Energy now comes from chat only (no audio input), plus the DJ's drop boost.
  S.boost *= Math.exp(-dt / 5);
  S.E = clamp(Math.max(0.22, S.chatE * 1.05) + S.boost * 0.7, 0, 1.3);
  S.dim += ((S.lights ? 0.86 : 0) - S.dim) * Math.min(1, dt * 1.6);
  S.flash *= Math.exp(-dt * 5);
  S.shake *= Math.exp(-dt * 3.2);
  S.pyro *= Math.exp(-dt * 2.2);
  S.co2 = Math.max(S.co2 * Math.exp(-dt * 1.4), S.pyro * 0.9);
  const bph = ((S.beat % 1) + 1) % 1, win = (dt * clock.bpm) / 60;
  if (!reduceMotion && S.E > 0.62 && Math.floor(S.beat) % 32 === 0 && bph < win) S.co2 = 1;
  if (!reduceMotion && S.E > 0.8 && Math.floor(S.beat) % 16 === 0 && bph < win) S.pyro = Math.max(S.pyro, 0.7);

  // Fake viewers pressing action buttons.
  if (!n) S.actDebt = 0;
  S.actDebt += n * 0.032 * (0.3 + S.E) * (S.lights ? 0.25 : 1) * dt;
  guard = 0;
  while (S.actDebt >= 1 && guard++ < 200) {
    S.actDebt--;
    const a = crowd[Math.floor(rnd() * n)];
    if (a.viewer) continue; // real viewers only move when they ask to
    emote(a, pick(['clap', 'clap', 'phone', 'lighter', 'jump', 'dance', 'dance', 'flag'] as ActionId[]));
  }
  S.actDebt = Math.min(S.actDebt, 5);
}

export function everyone(act: ActionId): void {
  for (const a of crowd) emote(a, act, rnd() * 0.6);
}
export { ACTIONS };
