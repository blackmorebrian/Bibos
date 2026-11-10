/**
 * Bibos Light Desk: a password-locked control panel for a light designer.
 * Talks to the crowd scene through the hub (Cloudflare Worker); the hub
 * checks the password before passing any command on.
 */

import { IMAGES } from '../../scene/src/screens';

const HUB = new URLSearchParams(location.search).get('hub') ?? 'wss://bibos-hub.bibos-hub.workers.dev';
const DEFAULT_ROOM = 'itsbrianblackmore';
const STORE = 'bibos.panel';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const loginEl = $('login'), deskEl = $('desk');
const roomIn = $<HTMLInputElement>('room'), passIn = $<HTMLInputElement>('password'), rememberIn = $<HTMLInputElement>('remember');
const loginMsg = $('loginMsg'), dot = $('dot'), statusText = $('statusText');

/** The crowd version this desk expects (CROWD_VERSION in the scene's control.ts). */
const CROWD_VERSION = 3;

interface SceneState {
  v?: number; id?: string; layout?: string;
  look: string; chase?: string; colors: [string, string] | null; intensity: number; speed: number; lasers: string;
  strobe: boolean; blackout: boolean; lights: boolean; bpm: number; shot: string; auto: boolean; viewers: number;
  helpUp?: boolean; strobeRate?: number; glow?: number; helpEvery?: number; zoom?: number; pan?: number; height?: number; pace?: string; screens?: string; screenText?: string;
}
let state: SceneState | null = null;
/** Every crowd that has reported lately (widescreen and vertical OBS sources). */
const crowds = new Map<string, { state: SceneState; at: number }>();
/** The crowd the desk shows: an up-to-date one first, then widescreen over vertical, then the oldest-named. */
function primary(): string | undefined {
  const now = Date.now();
  for (const [k, v] of crowds) if (now - v.at > 4000) crowds.delete(k);
  const all = [...crowds.values()].map((v) => v.state);
  all.sort((a, b) => Number((a.v ?? 0) < CROWD_VERSION) - Number((b.v ?? 0) < CROWD_VERSION) || Number(a.layout === 'vertical') - Number(b.layout === 'vertical') || String(a.id).localeCompare(String(b.id)));
  return all[0]?.id ?? 'one';
}
let ws: WebSocket | null = null;
/** Button groups just pressed: keep the new pick lit until the crowd reports it. */
const held = new Map<string, number>();
let creds: { room: string; password: string } | null = null;
let scenes = 0;
let retry = 1000;
let ping = 0;

/* ---------- saved login ---------- */
try {
  const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
  roomIn.value = saved?.room ?? DEFAULT_ROOM;
  if (saved?.password) { creds = saved; connect(); }
} catch { roomIn.value = DEFAULT_ROOM; }

$('loginForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const room = roomIn.value.trim().toLowerCase(), password = passIn.value;
  if (!room || !password) { loginMsg.textContent = 'Enter the channel and password.'; return; }
  creds = { room, password };
  loginMsg.textContent = 'Checking…';
  connect();
});
$('logout').addEventListener('click', () => {
  try { localStorage.removeItem(STORE); } catch { /* ignore */ }
  creds = null;
  ws?.close();
  showLogin('Locked.');
});

/** The command list lives on whichever screen is showing: under the sign-in form, or at the top of the desk. */
const cmdsEl = document.querySelector<HTMLElement>('.cmds')!;

function showLogin(msg = ''): void {
  loginEl.appendChild(cmdsEl);
  deskEl.hidden = true;
  loginEl.hidden = false;
  passIn.value = '';
  loginMsg.textContent = msg;
}

/* ---------- connection ---------- */
function connect(): void {
  if (!creds) return;
  ws?.close();
  const sock = new WebSocket(`${HUB}/ws?room=${encodeURIComponent(creds.room)}&role=panel`);
  ws = sock;
  setStatus('warn', 'Connecting…');
  sock.onopen = () => sock.send(JSON.stringify({ type: 'auth', password: creds!.password }));
  sock.onmessage = (ev) => {
    if (ev.data === 'pong') return;
    const msg = JSON.parse(ev.data);
    if (msg.type === 'auth') {
      if (!msg.ok) {
        creds = null;
        try { localStorage.removeItem(STORE); } catch { /* ignore */ }
        showLogin('Wrong password.');
        return;
      }
      retry = 1000;
      if (rememberIn.checked) try { localStorage.setItem(STORE, JSON.stringify(creds)); } catch { /* ignore */ }
      deskEl.querySelector('header')!.after(cmdsEl);
      loginEl.hidden = true;
      deskEl.hidden = false;
      clearInterval(ping);
      ping = window.setInterval(() => sock.readyState === 1 && sock.send('ping'), 25000);
    } else if (msg.type === 'presence') {
      scenes = msg.scenes;
      refreshStatus();
    } else if (msg.type === 'state') {
      const st = msg as SceneState;
      crowds.set(st.id ?? 'one', { state: st, at: Date.now() });
      if (st.id === primary()) { state = st; render(); }
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    clearInterval(ping);
    if (!creds) return;
    setStatus('bad', `Disconnected, retrying…`);
    setTimeout(connect, retry);
    retry = Math.min(15000, retry * 2);
  };
}

function setStatus(kind: 'ok' | 'warn' | 'bad', text: string): void {
  dot.className = `dot ${kind}`;
  statusText.textContent = text;
}
function refreshStatus(): void {
  const n = crowds.size, kinds = [...crowds.values()].map((v) => v.state.layout);
  const which = n > 1 ? `${n} crowds connected (${kinds.includes('wide') ? 'widescreen' : ''}${kinds.includes('wide') && kinds.includes('vertical') ? ' + ' : ''}${kinds.includes('vertical') ? 'vertical' : ''})` : 'crowd connected';
  const old = [...crowds.values()].filter((c) => (c.state.v ?? 0) < CROWD_VERSION).map((c) => c.state.layout === 'vertical' ? 'vertical' : 'widescreen');
  if (scenes > 0 && old.length) setStatus('warn', `A ${[...new Set(old)].join(' and ')} crowd is out of date: in OBS, click that Bibos source and press Refresh`);
  else if (scenes > 0) setStatus('ok', `Live: ${which}${state ? ` · ${state.viewers} Bibo${state.viewers === 1 ? '' : 's'}` : ''}`);
  else setStatus('warn', 'Signed in, but the crowd isn’t open in OBS');
}

function send(what: string, arg = ''): void {
  if (ws?.readyState === 1) ws.send(JSON.stringify({ type: 'cmd', what, arg }));
}

/* ---------- buttons ---------- */
document.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) => {
  b.addEventListener('click', () => {
    const what = b.dataset.cmd!;
    let arg = b.dataset.arg ?? '';
    // Toggles send an explicit state so two people pressing can't get out of sync.
    if (b.dataset.state && state) {
      const on = !!state[b.dataset.state as 'lights' | 'strobe' | 'blackout'];
      arg = what === 'lights' ? (on ? 'up' : 'down') : on ? 'off' : 'on';
    }
    send(what, arg);
    // Light the pick straight away (the crowd confirms a moment later).
    const group = b.closest<HTMLElement>('[data-group]')?.dataset.group;
    if (group) {
      document.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] button`).forEach((x) => x.classList.toggle('on', x === b));
      held.set(group, Date.now() + 1500);
    }
    b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
  });
});

const SWATCHES: [string, string, string][] = [
  ['Pink / Teal', '#ff3d81', '#19d3c5'], ['Gold / Violet', '#ffc21a', '#7c5cff'], ['Teal / Orange', '#19d3c5', '#ff7a2f'],
  ['Magenta / Lemon', '#ff4fd8', '#ffe066'], ['Red', '#ff2a2a', '#ff7a2f'], ['Ice', '#9fe8ff', '#ffffff'],
  ['Deep blue', '#2b5bff', '#7c5cff'], ['Acid', '#7dff3a', '#19d3c5'], ['Warm white', '#fff1c9', '#ffc21a'],
];
const sw = $('swatches');
const autoBtn = document.createElement('button');
autoBtn.className = 'swatch auto';
autoBtn.innerHTML = '<b>Auto</b>';
autoBtn.dataset.colors = 'auto';
autoBtn.addEventListener('click', () => send('colors', 'auto'));
sw.appendChild(autoBtn);
for (const [name, a, b] of SWATCHES) {
  const btn = document.createElement('button');
  btn.className = 'swatch';
  btn.innerHTML = `<i style="background:${a}"></i><i style="background:${b}"></i><b>${name}</b>`;
  btn.dataset.colors = `${a},${b}`;
  btn.setAttribute('aria-label', `Colors ${name}`);
  btn.addEventListener('click', () => send('colors', `${a},${b}`));
  sw.appendChild(btn);
}
$('sendColors').addEventListener('click', () => send('colors', `${$<HTMLInputElement>('colA').value},${$<HTMLInputElement>('colB').value}`));

// Sliders: send while dragging, at most ~12 times a second.
function slider(id: string, out: string, what: string, fmt: (v: number) => string): void {
  const el = $<HTMLInputElement>(id), o = $(out);
  let last = 0, timer = 0;
  el.addEventListener('input', () => {
    o.textContent = fmt(+el.value);
    const fire = () => { last = performance.now(); send(what, el.value); };
    clearTimeout(timer);
    if (performance.now() - last > 80) fire(); else timer = window.setTimeout(fire, 80);
  });
}
slider('intensity', 'intOut', 'intensity', (v) => `${Math.round(v * 100)}%`);
slider('glow', 'glowOut', 'glow', (v) => `${Math.round(v * 100)}%`);
slider('speed', 'spdOut', 'speed', (v) => `${v.toFixed(1)}×`);
slider('zoom', 'zoomOut', 'zoom', (v) => `${v.toFixed(1)}×`);
slider('pan', 'panOut', 'pan', (v) => String(v));
slider('height', 'heightOut', 'height', (v) => String(v));

$('focusForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $<HTMLInputElement>('focusName').value.trim().replace(/^@/, '');
  if (name) send('focus', name.toLowerCase());
});
$('textForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $<HTMLInputElement>('screenText').value.trim();
  if (text) send('screens', `text ${text}`);
});

// Little previews of the pixel pictures on their buttons.
document.querySelectorAll<HTMLElement>('.pix').forEach((el) => {
  for (const row of IMAGES[el.dataset.img!] ?? []) for (const ch of row) {
    const i = document.createElement('i');
    if (ch !== '.') i.className = ch === '#' ? 'a' : 'b';
    el.appendChild(i);
  }
});

// Tap tempo: average the last taps, then lock the downbeat to the last tap.
let taps: number[] = [];
$('tap').addEventListener('click', () => {
  const now = performance.now();
  if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
  taps.push(now);
  if (taps.length > 8) taps.shift();
  if (taps.length >= 3) {
    const bpm = Math.round((60000 * (taps.length - 1)) / (now - taps[0]) * 10) / 10;
    if (bpm >= 60 && bpm <= 200) { send('bpm', String(bpm)); send('beat'); $('bpm').textContent = String(Math.round(bpm)); }
  }
});

/* ---------- show what's live ---------- */
function render(): void {
  if (!state) return;
  refreshStatus();
  const s = state;
  const mark = (group: string, value: string) =>
    (held.get(group) ?? 0) < Date.now() &&
    document.querySelectorAll<HTMLButtonElement>(`[data-group="${group}"] button`).forEach((b) => b.classList.toggle('on', b.dataset.arg === value));
  mark('look', s.look);
  mark('chase', s.chase ?? 'auto');
  mark('lasers', s.lasers);
  mark('shot', s.auto ? 'auto' : s.shot);
  mark('pace', s.pace ?? 'normal');
  mark('strobeRate', String(s.strobeRate ?? 1));
  mark('helpEvery', String(s.helpEvery ?? 10));
  $('helpShow').classList.toggle('on', !!s.helpUp);
  mark('screens', s.screens ?? 'auto');
  const cur = s.colors ? s.colors.join(',').toLowerCase() : 'auto';
  sw.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.colors === cur));
  document.querySelectorAll<HTMLButtonElement>('button[data-state]').forEach((b) => {
    const on = !!s[b.dataset.state as 'lights' | 'strobe' | 'blackout'];
    b.setAttribute('aria-pressed', String(on));
    if (b.dataset.state === 'lights') b.textContent = on ? '☀️ Lights up' : '🌙 Lights down';
  });
  const setIf = (id: string, out: string, v: number, fmt: (v: number) => string) => {
    const el = $<HTMLInputElement>(id);
    if (document.activeElement !== el) { el.value = String(v); $(out).textContent = fmt(v); }
  };
  setIf('intensity', 'intOut', s.intensity, (v) => `${Math.round(v * 100)}%`);
  setIf('glow', 'glowOut', s.glow ?? 1, (v) => `${Math.round(v * 100)}%`);
  setIf('speed', 'spdOut', s.speed, (v) => `${v.toFixed(1)}×`);
  setIf('zoom', 'zoomOut', s.zoom ?? 1, (v) => `${v.toFixed(1)}×`);
  setIf('pan', 'panOut', s.pan ?? 0, (v) => String(v));
  setIf('height', 'heightOut', s.height ?? 0, (v) => String(v));
  $('bpm').textContent = String(Math.round(s.bpm));
}
