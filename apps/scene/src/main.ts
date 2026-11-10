/**
 * Bibos crowd scene: 500-Bibo stress test build.
 * Loads as an OBS browser source at 1920x1080. See STRESS-TEST.md.
 */
import * as THREE from 'three';
import { buildAtlas } from '@bibos/bibo-art';
import { ACTIONS } from '@bibos/shared';
import { params, serverBase } from './params';
import { S, clock, crowd, crowdVersion, setCrowd, live, simTick, drop, toggleLights, spamEmote, everyone, type ShotName } from './sim';
import { Crowd } from './crowd';
import { World } from './world';
import { Lights } from './lights';
import { Fx } from './fx';
import { Webcam } from './webcam';
import { Overlay } from './overlay';
import { Stats, Bench, pct } from './stats';
import { updateCamera, cutTo, SHOT_NAMES } from './camera';
import { SpriteBatch } from './sprites';
import { TwitchChat, parseEmotes } from './twitch';
import { handleChat, removeViewer, restoreViewers, joinedCount } from './viewers';

// Flat paper colors: treat every color value as final sRGB, like Canvas 2D.
THREE.ColorManagement.enabled = false;

// Forward errors to the stress server so OBS-side problems show up on the dev machine.
const logBase = serverBase();
function remoteLog(kind: string, msg: string): void {
  if (!logBase) return;
  fetch(`${logBase}/log`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ kind, msg, ua: navigator.userAgent }) }).catch(() => {});
}
addEventListener('error', (e) => remoteLog('error', `${e.message} @ ${e.filename}:${e.lineno}`));
addEventListener('unhandledrejection', (e) => remoteLog('rejection', String(e.reason)));

const atlas = buildAtlas(params.cell);
if (new URLSearchParams(location.search).has('atlas')) {
  // Debug: show the atlas (base texture, alpha flattened onto grey).
  const c = document.createElement('canvas');
  c.width = atlas.width; c.height = atlas.height;
  const img = new ImageData(atlas.width, atlas.height);
  for (let i = 0; i < atlas.base.length; i += 4) {
    const a = atlas.base[i + 3] / 255, w = atlas.weights[i] / 255;
    img.data[i] = atlas.base[i] + (1 - a) * 90 + w * 255;
    img.data[i + 1] = atlas.base[i + 1] + (1 - a) * 90;
    img.data[i + 2] = atlas.base[i + 2] + (1 - a) * 90 + atlas.weights[i + 1];
    img.data[i + 3] = 255;
  }
  c.getContext('2d')!.putImageData(img, 0, 0);
  c.style.cssText = 'position:fixed;inset:0;z-index:9;width:100%;height:auto;';
  document.body.appendChild(c);
}
setCrowd(params.n);
clock.t0 = performance.now() / 1000;

const renderer = new THREE.WebGLRenderer({ antialias: params.aa, powerPreference: 'high-performance', alpha: false, stencil: false });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(params.scale);
renderer.setSize(innerWidth, innerHeight);
renderer.domElement.id = 'scene';
document.body.appendChild(renderer.domElement);

const overlay = new Overlay();
document.body.appendChild(overlay.canvas);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.3, 1500);
const webcam = new Webcam();
const world = new World(webcam.texture);
const crowdR = new Crowd(atlas);
const lights = new Lights();
const fx = new Fx(atlas, crowdR.baseTex);
scene.add(world.group, crowdR.mesh, crowdR.glowMesh, lights.group, fx.group);

// Real Twitch chat (read-only, anonymous). Without ?channel= the fake chat runs.
const twitch = params.channel ? new TwitchChat(params.channel, handleChat, removeViewer) : null;
if (twitch) restoreViewers();

const stats = new Stats(renderer);
const bench = new Bench();
if (params.shot && (SHOT_NAMES as string[]).includes(params.shot)) { S.auto = false; cutTo(params.shot as ShotName); }

function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  overlay.resize(innerWidth, innerHeight);
}
addEventListener('resize', resize);
resize();

/* ---------- manual controls (keyboard in a normal browser, or OBS "Interact") ---------- */
addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  const shotKey = '12345'.indexOf(k);
  if (shotKey >= 0) { S.auto = false; cutTo(SHOT_NAMES[shotKey]); }
  else if (k === '0') { S.auto = !S.auto; S.nextCut = Math.floor(S.beat / 4) + 1; }
  else if (k === 'd') drop();
  else if (k === 'l') toggleLights();
  else if (k === 'h') { S.hypeAt = -99; S.meter = 1; }
  else if (k === 'w') spamEmote('fire');
  else if (k === 'j') everyone(ACTIONS[Math.floor(Math.random() * ACTIONS.length)]);
  else if (k === 't') clock.tap(performance.now() / 1000);
  else if ((k === '=' || k === '+') && !live) setCrowd(crowd.length + 100);
  else if (k === '-' && !live) setCrowd(crowd.length - 100);
  else if (k === 'u') hudOn = !hudOn;
  else if (k === 'c') S.helpAt = S.t;
});
let drag: [number, number] | null = null;
renderer.domElement.style.touchAction = 'none';
addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; });
addEventListener('pointerup', () => { drag = null; });
addEventListener('pointermove', (e) => {
  if (!drag) return;
  S.mx = Math.max(-13, Math.min(13, S.mx + (e.clientX - drag[0]) * 0.025));
  S.my = Math.max(-3, Math.min(5, S.my + (e.clientY - drag[1]) * 0.012));
  drag = [e.clientX, e.clientY];
  S.auto = false;
});
addEventListener('wheel', (e) => { S.zoom = Math.max(0.7, Math.min(2.4, S.zoom * (1 - e.deltaY * 0.001))); }, { passive: true });

/* ---------- frame loop ---------- */
let hudOn = params.hud;
let last = performance.now();
let seenVersion = -1; // force a rebuild on the first frame (viewers may have been restored after the renderer was made)
let hudAt = 0, uploadsAt = 0, uploadsRate = 0;
const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();

function frame(): void {
  requestAnimationFrame(frame);
  const now = performance.now();
  const interval = now - last;
  last = now;
  const dt = Math.min(0.1, interval / 1000);
  S.t += dt;
  const t = S.t;
  const beat = clock.beatAt(now / 1000);
  S.beat = beat;

  simTick(dt);
  if (seenVersion !== crowdVersion) { seenVersion = crowdVersion; crowdR.rebuild(); world.layoutSea(); }
  updateCamera(camera, t, Math.floor(beat / 4));
  camera.matrixWorld.extractBasis(right, up, fwd);
  SpriteBatch.camRight.copy(right);
  SpriteBatch.camUp.copy(up);
  const back = fwd.z > 0; // camera looks down -fwd, so back view = looking toward -z
  crowdR.update(camera, t, beat);
  const W = renderer.domElement.width, H = renderer.domElement.height;
  world.update(camera, t, beat, W, H);
  lights.update(t, beat, back);
  fx.update(t, dt, back);
  webcam.update(t, beat);

  stats.gpuBegin();
  renderer.render(scene, camera);
  stats.gpuEnd();

  const cpu = performance.now() - now;
  stats.frame(interval, cpu);
  const summary = bench.tick(t, stats, interval, cpu);
  if (summary) overlay.summary = summary;

  if (now - hudAt > 250) {
    hudAt = now;
    if (now - uploadsAt > 1000) { uploadsRate = crowdR.uploads; crowdR.uploads = 0; uploadsAt = now; }
    const info = renderer.info.render;
    const iv = stats.intervals, c = stats.cpu, g = stats.gpu;
    const cs = webcam.status;
    overlay.hudLines = hudOn ? [
      `fps ${(1000 / (iv.reduce((a, b) => a + b, 0) / Math.max(1, iv.length))).toFixed(1)}   frame p50/p95/p99 ${pct(iv, 50).toFixed(1)}/${pct(iv, 95).toFixed(1)}/${pct(iv, 99).toFixed(1)} ms`,
      `cpu p50/p95 ${pct(c, 50).toFixed(2)}/${pct(c, 95).toFixed(2)} ms   gpu ${stats.gpuSupported ? `${pct(g, 50).toFixed(2)}/${pct(g, 95).toFixed(2)} ms` : 'n/a'}`,
      `bibos ${crowd.length}   draws ${info.calls}   tris ${info.triangles}   crowd uploads/s ${uploadsRate}`,
      `energy ${S.E.toFixed(2)}  chat ${S.chatE.toFixed(2)}  meter ${S.mShow.toFixed(2)}  shot ${S.shot}${S.auto ? ' (auto)' : ''}  bpm ${clock.bpm}`,
      `gpu: ${stats.renderer.slice(0, 80)}`,
      `atlas ${atlas.width}x${atlas.height} cell ${atlas.cellPx}px  built ${atlas.buildMs.toFixed(0)} ms  aa ${params.aa}  scale ${params.scale}`,
      `cam ${cs.route}: ${cs.state}  ${cs.detail}`,
      ...(twitch ? [`twitch #${twitch.status.channel}: ${twitch.status.state}  msgs ${twitch.status.msgs}  joined ${joinedCount()}  chatters/min ${S.active}  base ${S.base.toFixed(1)}`] : []),
      ...(cs.devices.length ? [`devices: ${cs.devices.join(' | ').slice(0, 90)}`] : []),
      ...(cs.stats ? [`webrtc: ${cs.stats}`] : []),
      ...(bench.active ? [`BENCH running ${params.bench}s ...`] : []),
      'keys 1-5 shots  0 auto  D drop  L lights  H hype  W wave  J all act  T tap  +/- 100  C commands  U hud',
    ] : [];
  }
  overlay.draw(camera, t, beat);
}
requestAnimationFrame(frame);

// Debug handle for the browser console.
(window as any).__bibos = {
  S, crowd, crowdR, renderer, scene, camera, atlas, stats,
  /** Test hook: pretend someone typed in chat, e.g. __bibos.say('kevin', '!bibo') or say('kevin', 'Kappa', '25:0-4'). */
  say: (login: string, text: string, emotes = '', broadcaster = false) =>
    handleChat({ login: login.toLowerCase(), display: login, color: '', text, emotes: parseEmotes(emotes), mod: false, broadcaster }),
};
