/**
 * Effects: floating emotes, confetti, CO2 jets, pyro, lights-down dimming and
 * the sea of lighters/phones that comes up when the lights go down.
 */
import * as THREE from 'three';
import type { Atlas } from '@bibos/bibo-art';
import { EmoteSheet } from './emotes';
import { S, floats, confetti, SEA, rnd, reduceMotion } from './sim';
import { SpriteBatch, canvasTexture, glowTexture, rgb } from './sprites';
import { params } from './params';
import { parts, pyroTick, setView, K } from './pyro';

function cellUv(atlas: Atlas, key: string): number[] {
  const idx = atlas.cells.get(key)!;
  const col = idx % atlas.cols, row = Math.floor(idx / atlas.cols);
  const { cellPx: c, pad: p, width: W, height: H } = atlas;
  return [(col * c + p) / W, (row * c + p) / H, ((col + 1) * c - p) / W, ((row + 1) * c - p) / H];
}

export class Fx {
  readonly group = new THREE.Group();
  private floatsB: SpriteBatch;
  private confettiB: SpriteBatch;
  /** Pyro particles: ground/stage batches draw before the crowd, sky batches first of all. */
  private pGlow: SpriteBatch;
  private pStreak: SpriteBatch;
  private pPuff: SpriteBatch;
  private sGlow: SpriteBatch;
  private sStreak: SpriteBatch;
  private seaGlow: SpriteBatch;
  private dim: THREE.Mesh;
  private dimColor = new THREE.Color(1, 1, 1);
  private emoteUv = new Map<string, number[]>();
  /** Real Twitch emotes (keys "tw:<id>"). */
  readonly twitch = new EmoteSheet();
  private twB: SpriteBatch;

  constructor(atlas: Atlas, atlasTex: THREE.Texture) {
    for (const k of atlas.cells.keys()) if (k.startsWith('emote:')) this.emoteUv.set(k.slice(6), cellUv(atlas, k));
    this.floatsB = new SpriteBatch(atlasTex, 260, 'premult', 60);
    this.twB = new SpriteBatch(this.twitch.texture, 260, 'premult', 61);
    const white = canvasTexture(4, 4, (g) => { g.fillStyle = '#fff'; g.fillRect(0, 0, 4, 4); });
    this.confettiB = new SpriteBatch(white, 440, 'premult', 50);

    const glow = glowTexture(), streak = streakTexture(), puff = puffTexture();
    this.pGlow = new SpriteBatch(glow, 4000, 'add', 5, true);
    this.pStreak = new SpriteBatch(streak, 4000, 'add', 5, true);
    this.pPuff = new SpriteBatch(puff, 5000, 'premult', 4, true);
    this.sGlow = new SpriteBatch(glow, 2500, 'add', 1, true);
    this.sStreak = new SpriteBatch(streak, 3000, 'add', 1, true);
    this.seaGlow = new SpriteBatch(glowTexture(), 520, 'add', 41);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.dim = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { uCol: { value: this.dimColor } },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform vec3 uCol; void main(){ gl_FragColor = vec4(uCol, 1.0); }',
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor, blendEquation: THREE.AddEquation,
    }));
    this.dim.frustumCulled = false;
    this.dim.renderOrder = 30;
    this.group.add(this.floatsB.mesh, this.twB.mesh, this.confettiB.mesh, this.pGlow.mesh, this.pStreak.mesh, this.pPuff.mesh, this.sGlow.mesh, this.sStreak.mesh, this.seaGlow.mesh, this.dim);
  }

  update(t: number, dt: number, back: boolean): void {
    // Floating emotes.
    const F = this.floatsB, TW = this.twB;
    F.begin();
    TW.begin();
    for (let i = floats.length - 1; i >= 0; i--) {
      const f = floats[i], age = t - f.at;
      if (age > f.life) { floats.splice(i, 1); continue; }
      const q = age / f.life;
      const pop = Math.min(1, age * 7) * (1 + 0.25 * Math.sin(Math.min(1, age * 4.5) * Math.PI));
      const sz = (f.sea ? 2.6 : 0.95) * pop;
      const a = q > 0.72 ? (1 - q) / 0.28 : 1;
      const x = f.x + Math.sin(age * 3 + f.dx) * 0.3, y = 2.55 + q * (f.sea ? 3.2 : 4.2);
      if (f.em.startsWith('tw:')) {
        const uv = this.twitch.uv(f.em.slice(3), t);
        if (uv) TW.add(x, y, f.z, sz * 1.1, sz * 1.1, 1, 1, 1, a, 0, 0, uv);
      } else {
        const uv = this.emoteUv.get(f.em);
        if (uv) F.add(x, y, f.z, sz, sz, 1, 1, 1, a, 0, 0, uv);
      }
    }
    F.end();
    TW.end();

    // Confetti.
    const C = this.confettiB;
    C.begin();
    for (let i = confetti.length - 1; i >= 0; i--) {
      const c = confetti[i];
      c.y -= c.v * dt; c.ph += dt * 7; c.x += Math.sin(c.ph * 0.5) * dt * 0.8;
      if (c.y < 0.05) { confetti.splice(i, 1); continue; }
      const [r, g, b] = rgb(c.c);
      C.add(c.x, c.y, c.z, Math.max(0.02, c.sz * Math.abs(Math.cos(c.ph))), c.sz * 0.62, r, g, b, 1);
    }
    C.end();

    this.drawPyro(t, dt, back);

    // Lights down: multiply-dim the frame, then lighters/phones glow in the far crowd.
    const k = S.dim;
    this.dim.visible = k > 0.01;
    this.dimColor.setRGB(1 - (1 - 30 / 255) * k, 1 - (1 - 26 / 255) * k, 1 - (1 - 92 / 255) * k);
    const G = this.seaGlow;
    G.begin();
    if (k > 0.01 && !back && params.backdrop) {
      const a = Math.min(0.6, k * 0.75);
      for (const sp of SEA) {
        if (sp[1] < S.maxZ + 2) continue;
        const r = 0.9 * (0.75 + 0.25 * Math.sin(t * 3 + sp[2]));
        if (sp[3]) G.add(sp[0], 2.6, sp[1], r * 2, r * 2, 1, 0.706, 0.275, a);
        else G.add(sp[0], 2.6, sp[1], r * 2, r * 2, 0.667, 0.843, 1, a);
      }
    }
    G.end();
    void rnd; void reduceMotion;
  }

  private drawPyro(t: number, dt: number, back: boolean): void {
    setView(back);
    pyroTick(dt, t);
    const G = this.pGlow, St = this.pStreak, P = this.pPuff, SG = this.sGlow, SS = this.sStreak;
    G.begin(); St.begin(); P.begin(); SG.begin(); SS.begin();
    const R = SpriteBatch.camRight, U = SpriteBatch.camUp;
    for (const p of parts) {
      const f = p.age / p.life;
      switch (p.k) {
        case K.FLAME: {
          // Solid paper-bright body (reads on a light sky) plus an additive hot core early on.
          // Tall and narrow so the jets read as columns, not balls.
          const [r, g, b] = flameColor(f);
          P.add(p.x, p.y, p.z, p.s * (0.55 + f * 0.75), p.s * (1.1 + f * 1.3), r, g, b, Math.pow(1 - f, 1.6) * 0.95, 0, (p.seed % 1 - 0.5) * 0.5);
          const s = p.s * (0.7 + f);
          if (f < 0.35) G.add(p.x, p.y, p.z, s * 0.8, s * 0.8, 1, 0.8, 0.4, (0.35 - f) * 1.6);
          break;
        }
        case K.EMBER:
          G.add(p.x, p.y, p.z, p.s, p.s, p.r, p.g, p.b, (1 - f) * (0.6 + 0.4 * Math.sin(p.age * 20 + p.seed)));
          break;
        case K.PUFF: {
          const s = p.s * (1 + f * 4.5);
          P.add(p.x, p.y, p.z, s, s, p.r, p.g, p.b, 0.5 * Math.pow(1 - f, 1.4), 0, p.seed);
          break;
        }
        case K.SPARK: case K.STAR: {
          // Streak along the on-screen direction of travel, head first.
          const vr = p.vx * R.x + p.vy * R.y + p.vz * R.z, vu = p.vx * U.x + p.vy * U.y + p.vz * U.z;
          const len = Math.min(1.8, Math.max(0.15, Math.hypot(vr, vu) * 0.06)) * (p.s / 0.6);
          const star = p.k === K.STAR;
          let a = star ? Math.pow(1 - f, 0.8) : 1 - f * f;
          if (star && f > 0.6 && Math.sin(p.age * 38 + p.seed) < -0.2) a *= 0.15; // twinkle out
          const B = p.sky ? SS : St;
          B.add(p.x, p.y, p.z, 0.2 * (p.s / 0.6), len, p.r, p.g, p.b, a, 0, Math.atan2(-vr, vu));
          if (star) SG.add(p.x, p.y, p.z, p.s * 1.6, p.s * 1.6, p.r, p.g, p.b, a * 0.4);
          break;
        }
        case K.ROCKET:
          SG.add(p.x, p.y, p.z, p.s, p.s, p.r, p.g, p.b, 1);
          break;
        case K.FLASH: {
          const s = p.s * (0.6 + f);
          SG.add(p.x, p.y, p.z, s, s, p.r, p.g, p.b, (1 - f) * 0.8);
          break;
        }
      }
    }
    G.end(); St.end(); P.end(); SG.end(); SS.end();
  }
}

/** White-hot core, then orange, red and out. */
const FLAME_STOPS: [number, number, number, number][] = [
  [0, 1, 0.93, 0.55], [0.18, 1, 0.76, 0.1], [0.45, 1, 0.45, 0.08], [0.75, 0.93, 0.18, 0.12], [1, 0.45, 0.08, 0.3],
];
function flameColor(f: number): [number, number, number] {
  let i = 0;
  while (i < FLAME_STOPS.length - 2 && f > FLAME_STOPS[i + 1][0]) i++;
  const a = FLAME_STOPS[i], b = FLAME_STOPS[i + 1], k = Math.min(1, Math.max(0, (f - a[0]) / (b[0] - a[0])));
  return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
}

/** A soft vertical streak, brightest at the top (the leading end). */
function streakTexture(): THREE.CanvasTexture {
  return canvasTexture(32, 128, (g) => {
    for (const [w, a] of [[16, 0.22], [8, 0.5], [3, 1]] as const) {
      const gr = g.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, `rgba(255,255,255,${a})`);
      gr.addColorStop(0.15, `rgba(255,255,255,${a})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.beginPath(); g.roundRect(16 - w / 2, 2, w, 124, w / 2); g.fill();
    }
  });
}

/** A soft lumpy cloud for CO2. */
function puffTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g) => {
    const blob = (x: number, y: number, r: number, a: number) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,255,255,${a})`);
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 128);
    };
    blob(64, 64, 60, 0.85);
    [[44, 52, 30], [84, 50, 28], [56, 82, 30], [82, 80, 26], [64, 40, 24]].forEach(([x, y, r]) => blob(x, y, r, 0.45));
  });
}
