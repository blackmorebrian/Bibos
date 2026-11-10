/**
 * Effects: floating emotes, confetti, CO2 jets, pyro, lights-down dimming and
 * the sea of lighters/phones that comes up when the lights go down.
 */
import * as THREE from 'three';
import type { Atlas } from '@bibos/bibo-art';
import { EmoteSheet } from './emotes';
import { S, floats, confetti, SEA, rnd, reduceMotion } from './sim';
import { SpriteBatch, canvasTexture, glowTexture, rgb } from './sprites';

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
  private jets: SpriteBatch;
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

    // One texture holding a CO2 cone (left half) and a flame (right half).
    const jetTex = canvasTexture(256, 256, (g) => {
      const gr = g.createLinearGradient(0, 256, 0, 0);
      gr.addColorStop(0, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(255,255,255,0.15)');
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(58, 256); g.lineTo(70, 256); g.lineTo(126, 0); g.lineTo(2, 0); g.closePath(); g.fill();
      g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(192, 4); g.quadraticCurveTo(252, 180, 192, 252); g.quadraticCurveTo(132, 180, 192, 4); g.fill();
    });
    this.jets = new SpriteBatch(jetTex, 64, 'premult', 22, true);
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
    this.group.add(this.floatsB.mesh, this.twB.mesh, this.confettiB.mesh, this.jets.mesh, this.seaGlow.mesh, this.dim);
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

    // CO2 jets and pyro along the stage front.
    const J = this.jets;
    J.begin();
    const CO2 = [0, 0, 0.5, 1], FLAME = [0.5, 0, 1, 1];
    if (S.co2 > 0.04) {
      for (let i = 0; i < 6; i++) {
        const h = 17 * Math.min(1, S.co2 * 1.4), w = 1 + 7.2 * (1 - S.co2);
        J.add(-25 + i * 10, 1.7, -1.1, w, h, 1, 1, 1, 0.62 * S.co2, 1, 0, CO2);
      }
    }
    if (S.pyro > 0.05) {
      const layers: [string, number][] = [['#ff7a2f', 1], ['#ffc21a', 0.68], ['#fff4c2', 0.36]];
      for (let i = 0; i < 8; i++) {
        const h = S.pyro * (7 + Math.sin(t * 22 + i * 2));
        for (const [col, k] of layers) { const [r, g, b] = rgb(col); J.add(-42 + i * 12, 1.7, -1.2 + (1 - k) * 0.05, 2.4 * k, h * k, r, g, b, 1, 1, 0, FLAME); }
      }
    }
    J.end();

    // Lights down: multiply-dim the frame, then lighters/phones glow in the far crowd.
    const k = S.dim;
    this.dim.visible = k > 0.01;
    this.dimColor.setRGB(1 - (1 - 30 / 255) * k, 1 - (1 - 26 / 255) * k, 1 - (1 - 92 / 255) * k);
    const G = this.seaGlow;
    G.begin();
    if (k > 0.01 && !back) {
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
}
