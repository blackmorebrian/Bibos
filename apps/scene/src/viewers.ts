/**
 * Real viewers from Twitch chat: !bibo joins (replacing an NPC in the front
 * rows), action commands, emotes floating from the sender's head, chat heat,
 * and bans/timeouts removing the Bibo. Joined viewers survive a page reload.
 */
import {
  ACTIONS, BODY_COLORS, BODY_COLOR_NAMES, EXTRAS, HATS, HEADS, PATTERNS, SHIRT_COLORS, SHIRT_COLOR_NAMES,
  mulberry, type ActionId, type BiboLook,
} from '@bibos/shared';
import {
  S, crowd, emote, addFloat, liveChat, joins, makeBot, rnd, SEA, clock, drop, toggleLights, appendBibo, removeBibo,
  type Bibo, type ShotName,
} from './sim';
import { cutTo, SHOT_NAMES } from './camera';
import { params } from './params';
import type { ChatMessage } from './twitch';

/** Bots never join and never count toward hype. */
const BOTS = new Set([
  'nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot', 'wizebot', 'soundalerts', 'sery_bot',
  'commanderroot', 'botisimo', 'deepbot', 'coebot', 'ankhbot', 'phantombot', 'pretzelrocks', 'kofistreambot',
  'streamstickers', 'own3d', 'blerp', 'tangiabot', 'frostytoolsdotcom', 'lumiastream', 'creatisbot',
]);
const isBot = (login: string) => BOTS.has(login) || login.endsWith('bot');

const COMMANDS: Record<string, ActionId> = {
  '!clap': 'clap', '!phone': 'phone', '!lighter': 'lighter', '!jump': 'jump', '!dance': 'dance', '!flag': 'flag', '!wave': 'flag',
};

const byLogin = new Map<string, Bibo>();
const STORE = `bibos.viewers.${params.channel}`;
const KEEP_MS = 12 * 3600 * 1000;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/* ---------- customizing by chat ---------- */
type Part = 'head' | 'hat' | 'extra' | 'pattern' | 'color' | 'shirt';
const ALIASES: Record<string, string> = {
  headphones: 'phones', flower: 'flowers', flowercrown: 'flowers', buckethat: 'bucket', partyhat: 'party', emo: 'swoop',
  horn: 'horns', sunglasses: 'shades', glasses: 'shades', facepaint: 'paint', heart: 'hearts', spike: 'spikes',
  stripes: 'stripe', striped: 'stripe', lightning: 'bolt', cyan: 'teal', violet: 'purple', gold: 'yellow',
  kitty: 'cat', puppy: 'dog', toast: 'toaster', gremlins: 'gremlin', nothing: 'none', off: 'none',
};
const OPTIONS: Record<Part, readonly string[]> = {
  head: HEADS, hat: HATS, extra: EXTRAS, pattern: PATTERNS, color: BODY_COLOR_NAMES, shirt: SHIRT_COLOR_NAMES,
};
const word = (w: string) => { const x = w.toLowerCase().replace(/[^a-z]/g, ''); return ALIASES[x] ?? x; };

/** Apply one option to one part; false if the word isn't an option for it. */
function setPart(look: BiboLook, part: Part, w: string): boolean {
  const i = (OPTIONS[part] as readonly string[]).indexOf(word(w));
  if (i < 0) return false;
  if (part === 'head') look.head = i;
  else if (part === 'hat') look.hat = i;
  else if (part === 'extra') look.extra = i;
  else if (part === 'pattern') look.pattern = i;
  else if (part === 'color') look.color = i;
  else look.shirt = i;
  return true;
}
/** "!bibo frog crown pink": any words, any order. Colors go to the body (use !shirt for the shirt). */
function applyWords(look: BiboLook, words: string[]): boolean {
  let any = false;
  for (const w of words) {
    for (const part of ['head', 'hat', 'extra', 'pattern', 'color'] as Part[]) {
      if (setPart(look, part, w)) { any = true; break; }
    }
  }
  return any;
}

const LOOKS = 'bibos.looks';
let saved: Record<string, BiboLook> = {};
try { saved = JSON.parse(localStorage.getItem(LOOKS) ?? '{}'); } catch { /* ignore */ }
function saveLook(login: string, look: BiboLook): void {
  saved[login] = { ...look };
  try { localStorage.setItem(LOOKS, JSON.stringify(saved)); } catch { /* ignore */ }
}

/** A viewer's saved look, or the same random one every stream until they customize. */
export function lookFor(login: string): BiboLook {
  if (saved[login]) return { ...saved[login] };
  return randomLook(hash(login));
}
function randomLook(seed: number): BiboLook {
  const r = mulberry(seed);
  const i = (n: number) => Math.floor(r() * n);
  return {
    head: i(HEADS.length), hat: i(HATS.length), extra: r() < 0.35 ? 0 : i(EXTRAS.length),
    color: i(BODY_COLORS.length), shirt: i(SHIRT_COLORS.length), pattern: i(PATTERNS.length),
  };
}

const NAMECOL = ['#d81b60', '#1d4ed8', '#047857', '#7c3aed', '#c2410c', '#0e7490'];
/** Twitch chat color if it reads on the white name tag, else a safe one. */
function nameColor(login: string, c: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    if (0.299 * r + 0.587 * g + 0.114 * b < 150) return c;
  }
  return NAMECOL[hash(login) % NAMECOL.length];
}

export function joinViewer(login: string, display: string, color: string, quiet = false): Bibo | null {
  const have = byLogin.get(login);
  if (have) return have;
  // Take over the front-most filler Bibo if there are any, else step into the next free spot.
  const a = crowd.find((b) => !b.viewer) ?? appendBibo();
  a.viewer = login;
  a.name = display;
  a.nameColor = nameColor(login, color);
  a.look = lookFor(login);
  a.lastChat = -9;
  a.dirty = true;
  byLogin.set(login, a);
  if (!quiet) {
    a.born = S.t;
    emote(a, 'jump');
    joins.push({ name: display, color: a.nameColor, at: S.t });
    if (joins.length > 6) joins.shift();
    save();
  }
  return a;
}

export function removeViewer(login: string): void {
  const a = byLogin.get(login);
  if (!a) return;
  byLogin.delete(login);
  if (crowd.some((b) => !b.viewer)) {
    // Filler crowd present: turn back into an anonymous filler Bibo in the same spot.
    const npc = makeBot(a.id, { x: a.x, z: a.z, k: 0 }, S.t);
    Object.assign(a, npc, { viewer: undefined, dirty: true });
  } else removeBibo(a);
  save();
}

export function joinedCount(): number { return byLogin.size; }

const PART_CMDS: Record<string, Part> = {
  '!head': 'head', '!hat': 'hat', '!extra': 'extra', '!pattern': 'pattern', '!color': 'color', '!colour': 'color', '!shirt': 'shirt',
};
let helpAsked = -99;

/* ---------- DJ controls: "!dj <command>" from you or your mods (Stream Deck "Chat Message" keys) ---------- */
const LOOK_NAMES = ['auto', 'fan', 'cross', 'chase', 'wave', 'pulse'];
function djCommand(args: string[]): void {
  const [what = '', arg = ''] = args.map((a) => a.toLowerCase());
  const now = performance.now() / 1000;
  switch (what) {
    case 'drop': drop(); break;
    case 'lights':
      if (['down', 'off', 'dark'].includes(arg)) { if (!S.lights) toggleLights(); }
      else if (['up', 'on', 'bright'].includes(arg)) { if (S.lights) toggleLights(); }
      else toggleLights();
      break;
    case 'dark': if (!S.lights) toggleLights(); break;
    case 'bright': if (S.lights) toggleLights(); break;
    case 'hype': S.hypeAt = -99; S.meter = 1; break;
    case 'bpm': {
      const b = parseFloat(arg);
      if (b >= 60 && b <= 200) { const beat = clock.beatAt(now); clock.bpm = b; clock.t0 = now - (beat * 60) / b; } // keep phase
      break;
    }
    // Press on a downbeat. Chat takes a moment to arrive, so assume it was sent a little earlier.
    case 'beat': case 'sync': clock.t0 = now - params.beatlag; break;
    case 'nudge': { const ms = parseFloat(arg); if (Math.abs(ms) <= 500) clock.nudge(ms / 1000); break; }
    case 'cam': case 'camera':
      if (arg === 'auto') { S.auto = true; S.nextCut = Math.floor(S.beat / 4) + 1; }
      else if ((SHOT_NAMES as string[]).includes(arg)) { S.auto = false; cutTo(arg as ShotName); }
      break;
    case 'look': if (LOOK_NAMES.includes(arg)) S.look = arg; break;
    case 'kick': if (arg) removeViewer(arg.replace(/^@/, '')); break;
    case 'help': S.helpAt = S.t; break;
  }
}

export function handleChat(m: ChatMessage): void {
  if (isBot(m.login)) return;
  const [first = '', ...args] = m.text.trim().split(/\s+/);
  const cmd = first.toLowerCase();
  if (cmd === '!dj') { if (m.broadcaster || m.mod) djCommand(args); return; }
  let a = byLogin.get(m.login) ?? null;

  const restyle = (change: (look: BiboLook) => boolean) => {
    a = a ?? joinViewer(m.login, m.display, m.color);
    if (!a) return;
    const look = { ...a.look };
    if (!change(look)) return;
    a.look = look;
    a.born = S.t; // flip-and-hop so they can spot the change
    a.dirty = true;
    saveLook(m.login, look);
  };

  if (cmd === '!bibo' || cmd === '!join') {
    const fresh = !a;
    a = a ?? joinViewer(m.login, m.display, m.color);
    if (args.length) restyle((l) => applyWords(l, args));
    else if (a && !fresh) emote(a, 'jump');
  } else if (PART_CMDS[cmd] && args.length) {
    restyle((l) => setPart(l, PART_CMDS[cmd], args[0]));
  } else if (cmd === '!random' || cmd === '!reroll') {
    restyle((l) => { Object.assign(l, randomLook((Math.random() * 2 ** 32) >>> 0)); return true; });
  } else if (COMMANDS[cmd]) {
    a = a ?? joinViewer(m.login, m.display, m.color);
    if (a) emote(a, COMMANDS[cmd]);
  } else if (cmd === '!bibohelp' || cmd === '!bibos') {
    // Anyone can ask; mods and you skip the cooldown. Never re-shows while it's still up.
    const up = S.t - S.helpAt < HELP_SECONDS;
    if (!up && (m.mod || m.broadcaster || S.t - helpAsked > 90)) { S.helpAt = S.t; helpAsked = S.t; }
  }

  const keys = m.emotes.slice(0, 3).map((id) => `tw:${id}`);
  for (const k of keys) {
    S.recentEmotes = S.recentEmotes.filter((e) => e !== k);
    S.recentEmotes.push(k);
    if (S.recentEmotes.length > 12) S.recentEmotes.shift();
  }
  liveChat(m.login, keys[0] ?? null);

  if (a) {
    a.lastEmote = S.t; // pops their name tag
    for (const k of keys) addFloat(a.x, a.z, k, false);
  } else if (keys.length) {
    // Not in the crowd yet: float from a random spot so every emote still shows.
    const b = crowd[Math.floor(rnd() * Math.min(crowd.length, 300))];
    if (rnd() < 0.7 && b) for (const k of keys) addFloat(b.x, b.z, k, false);
    else { const sp = SEA[Math.floor(rnd() * SEA.length)]; addFloat(sp[0], sp[1], keys[0], true); }
  }
}

function save(): void {
  try {
    const list = [...byLogin.values()].map((b) => ({ l: b.viewer, d: b.name, c: b.nameColor, t: Date.now() }));
    localStorage.setItem(STORE, JSON.stringify(list));
  } catch { /* storage unavailable: viewers just don't survive a reload */ }
}

/** Bring back viewers who joined in the last 12 hours (OBS source refresh, PC restart). */
export function restoreViewers(): void {
  try {
    const list = JSON.parse(localStorage.getItem(STORE) ?? '[]') as { l: string; d: string; c: string; t: number }[];
    for (const v of list) if (Date.now() - v.t < KEEP_MS) joinViewer(v.l, v.d, v.c, true);
  } catch { /* ignore */ }
}

/** How long the commands card stays up. */
export const HELP_SECONDS = 20;
export { ACTIONS };
