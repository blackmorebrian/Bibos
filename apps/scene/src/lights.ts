/**
 * Light rig: additive beams (instanced, camera-facing ribbons), laser fans,
 * fixture glows and floor pools. Looks: fan, cross, chase, wave, pulse.
 * The hype meter powers the rig from the center outward.
 * No full-screen strobing anywhere.
 */
import * as THREE from 'three';
import { clamp } from '@bibos/shared';
import { S, reduceMotion } from './sim';
import { PALS } from './world';
import { SpriteBatch, glowTexture, rgb } from './sprites';

const LOOKS = ['fan', 'cross', 'chase', 'wave', 'pulse'];
const MAX_BEAMS = 96;
const STRIDE = 16;

const vs = /* glsl */ `
attribute vec2 aCorner; // x: along 0..1, y: side 0..1
attribute vec4 iS; // start xyz, w0
attribute vec4 iE; // end xyz, w1
attribute vec4 iC; // rgb, alpha
attribute vec4 iF; // end alpha factor, soft edge, -, -
varying float vT;
varying float vSide;
varying vec4 vC;
varying vec2 vF;
void main() {
  vec3 p = mix(iS.xyz, iE.xyz, aCorner.x);
  float w = mix(iS.w, iE.w, aCorner.x);
  vec3 dir = normalize(iE.xyz - iS.xyz);
  vec3 side = normalize(cross(dir, p - cameraPosition));
  float sd = aCorner.y * 2.0 - 1.0;
  gl_Position = projectionMatrix * viewMatrix * vec4(p + side * w * sd, 1.0);
  vT = aCorner.x; vSide = sd; vC = iC; vF = iF.xy;
}`;
const fs = /* glsl */ `
varying float vT;
varying float vSide;
varying vec4 vC;
varying vec2 vF;
void main() {
  float a = vT < 0.55 ? mix(0.85, 0.26, vT / 0.55) : mix(0.26, vF.x, (vT - 0.55) / 0.45);
  a *= mix(1.0, smoothstep(1.0, 0.55, abs(vSide)), vF.y);
  gl_FragColor = vec4(vC.rgb * vC.a * a, 0.0);
}`;

class Beams {
  readonly mesh: THREE.Mesh;
  private data = new Float32Array(MAX_BEAMS * STRIDE);
  private buf: THREE.InstancedInterleavedBuffer;
  private geo = new THREE.InstancedBufferGeometry();
  count = 0;
  constructor() {
    const geo = this.geo;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    ['iS', 'iE', 'iC', 'iF'].forEach((n, i) => geo.setAttribute(n, new THREE.InterleavedBufferAttribute(this.buf, 4, i * 4)));
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: vs, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }
  begin(): void { this.count = 0; }
  add(s: number[], e: number[], w0: number, w1: number, c: [number, number, number], a: number, endA: number, soft: number): void {
    if (this.count >= MAX_BEAMS || a <= 0.002) return;
    const d = this.data, o = this.count++ * STRIDE;
    d[o] = s[0]; d[o + 1] = s[1]; d[o + 2] = s[2]; d[o + 3] = w0;
    d[o + 4] = e[0]; d[o + 5] = e[1]; d[o + 6] = e[2]; d[o + 7] = w1;
    d[o + 8] = c[0]; d[o + 9] = c[1]; d[o + 10] = c[2]; d[o + 11] = a;
    d[o + 12] = endA; d[o + 13] = soft;
  }
  end(): void {
    this.geo.instanceCount = this.count;
    this.buf.clearUpdateRanges();
    this.buf.addUpdateRange(0, Math.max(1, this.count) * STRIDE);
    this.buf.needsUpdate = true;
  }
}

export class Lights {
  readonly group = new THREE.Group();
  private beams = new Beams();
  readonly glows: SpriteBatch;
  /** Movement clock, sped up or slowed by the designer's speed control. */
  private lt = 0;
  private lastT = 0;
  constructor() {
    this.glows = new SpriteBatch(glowTexture(), 160, 'add', 21);
    this.group.add(this.beams.mesh, this.glows.mesh);
  }

  update(tReal: number, beat: number, back: boolean): void {
    const L = S.ld;
    this.lt += Math.max(0, Math.min(0.1, tReal - this.lastT)) * L.speed;
    this.lastT = tReal;
    const t = this.lt;
    const ph = ((beat % 1) + 1) % 1, kick = Math.pow(1 - ph, 2.4), bar = Math.floor(beat / 4);
    const pal = (L.colors ?? PALS[((Math.floor(bar / 8) % 4) + 4) % 4]).map(rgb);
    const look = S.look === 'auto' ? LOOKS[((Math.floor(bar / 4) % 5) + 5) % 5] : S.look;
    // Strobe: beams only, once per beat (kept slow on purpose; never full-screen).
    const strobe = L.strobe && !reduceMotion ? (ph < 0.16 ? 1.25 : 0.06) : 1;
    const power = L.blackout ? 0 : clamp(0.35 + S.E * 0.75, 0, 1.25) * (1 - S.dim * 0.85) * L.intensity * strobe;
    const rig = 0.45 + 0.55 * S.mShow;
    const N = back ? 18 : 14;
    const B = this.beams, G = this.glows;
    B.begin();
    G.begin();
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), s = u * 2 - 1;
      if (Math.abs(s) > rig + 0.02) continue;
      let ang = 0, tilt = 0.5, amp = 1;
      if (look === 'fan') { ang = s * (0.7 + 0.25 * Math.sin(t * 0.6)); tilt = 0.55 + 0.2 * Math.sin(t * 0.8); }
      else if (look === 'cross') ang = (i % 2 ? 1 : -1) * (0.2 + 0.7 * Math.sin(t * 0.9 + u));
      else if (look === 'chase') { ang = s * 0.6; amp = Math.pow(Math.max(0, Math.cos((u * 3 - beat * 0.5) * Math.PI)), 2) * 1.2 + 0.12; }
      else if (look === 'wave') { ang = s * 0.55; tilt = 0.5 + 0.4 * Math.sin(beat * Math.PI * 0.5 - u * 5); }
      else { ang = s * (0.12 + 0.75 * kick); tilt = 0.35 + 0.25 * kick; amp = 0.5 + 0.7 * kick; }
      const up = i % 2 === 0;
      const o = back ? (up ? [s * 36, 34, -15] : [s * 34, 32.8, -15]) : (up ? [s * 70, 7, 100] : [s * 34, 17, 0]);
      let g: number[], pool = false;
      if (back) {
        if (up) g = [o[0] + ang * 75, 62 + tilt * 55, -15];
        else { g = [s * 9 + ang * 20, 0, S.maxZ * clamp(tilt, 0.05, 1)]; pool = true; }
      } else if (up) g = [o[0] + ang * 130, 90 + tilt * 80, 100];
      else { g = [ang * 24 + s * 8, 0, S.midZ + tilt * S.maxZ * 1.2]; pool = true; }
      const c = pal[i % 2];
      const dist = Math.hypot(g[0] - o[0], g[1] - o[1], g[2] - o[2]);
      const a = Math.min(0.9, amp * power * (up ? 0.85 : 0.42) * (0.75 + 0.25 * kick));
      B.add(o, g, 0.16, 0.3 + dist * (up ? 0.028 : 0.04), c, a, pool ? 0.14 : 0, 0.6);
      if (pool) G.add(g[0], 0.03, g[2], 15, 6, c[0], c[1], c[2], Math.min(0.7, amp * power * 0.6), 2);
      G.add(o[0], o[1], o[2], 2.4, 2.4, c[0], c[1], c[2], Math.min(1, amp * power * (0.6 + 0.4 * kick)));
    }
    // Laser fans on big moments (not in lights-down, skipped on every 4th bar unless very hype).
    const autoLasers = S.E > 0.42 && S.dim < 0.5 && (bar % 4 !== 3 || S.E > 0.78);
    if (!L.blackout && (L.lasers === 'on' || (L.lasers === 'auto' && autoLasers))) {
      const em = back ? [[0, 33, -15], [-22, 33, -15], [22, 33, -15]] : [[-24, 17, 46], [24, 17, 46], [0, 24, 0]];
      const la = clamp(S.E + 0.2, 0.5, 1) * Math.min(1.3, L.intensity) * strobe;
      em.forEach((e, ei) => {
        const sw = Math.sin(t * 0.7 + ei * 2), c = pal[ei % 2];
        for (let j = 0; j < 9; j++) {
          const v = (j / 8) * 2 - 1;
          const tx = e[0] + v * (back ? 46 + 18 * sw : 130) + Math.sin(t * 1.1 + ei) * 12;
          const ty = back ? 8 + 30 * Math.abs(Math.sin(t * 0.5 + ei + j * 0.08)) : 30 + 50 * Math.abs(Math.sin(t * 0.5 + ei + j * 0.08));
          const tgt = [tx, ty, back ? S.maxZ * 0.4 : 220];
          B.add(e, tgt, 0.12, 0.5, c, 0.25 * la, 1 / 0.85 * 0.26, 1);
          B.add(e, tgt, 0.03, 0.08, [1, 1, 1], 0.8 * la, 1 / 0.85 * 0.26, 0);
        }
      });
    }
    B.end();
    G.end();
  }
}
