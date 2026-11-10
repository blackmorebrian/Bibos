/**
 * Light rig: additive beams (instanced, camera-facing ribbons), laser fans,
 * fixture glows and floor pools. Looks: fan, cross, chase, wave, pulse.
 * The hype meter powers the rig from the center outward.
 * No full-screen strobing anywhere.
 */
import * as THREE from 'three';
import { clamp } from '@bibos/shared';
import { S, reduceMotion, activeLook } from './sim';
import { PALS } from './world';
import { SpriteBatch, glowTexture, rgb } from './sprites';
import { glows } from './bloom';
import { aim, strobeLevel } from './looks';

const MAX_BEAMS = 220;
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
varying vec4 vF;
varying vec3 vP;
void main() {
  vec3 p = mix(iS.xyz, iE.xyz, aCorner.x);
  float w = mix(iS.w, iE.w, aCorner.x);
  vec3 dir = normalize(iE.xyz - iS.xyz);
  vec3 side = normalize(cross(dir, p - cameraPosition));
  float sd = aCorner.y * 2.0 - 1.0;
  vP = p + side * w * sd;
  gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
  vT = aCorner.x; vSide = sd; vC = iC; vF = iF;
}`;
const fs = /* glsl */ `
uniform float uTime;
varying float vT;
varying float vSide;
varying vec4 vC;
varying vec4 vF; // end alpha, soft edge, haze, core
varying vec3 vP;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
void main() {
  float a = vT < 0.55 ? mix(0.85, 0.26, vT / 0.55) : mix(0.26, vF.x, (vT - 0.55) / 0.45);
  float d = abs(vSide);
  a *= mix(1.0, smoothstep(1.0, 0.0, d) * (1.0 - d * 0.35), vF.y);
  // Drifting haze: the beam reads as light hitting smoke, not a flat ribbon.
  vec3 q = vP * 0.085 + vec3(uTime * 0.21, -uTime * 0.07, uTime * 0.12);
  float h = noise(q) * 0.62 + noise(q * 2.6 + 7.3) * 0.38;
  a *= mix(1.0, 0.32 + h * 1.45, vF.z);
  // Hot core: near-white centre line, strongest at the lens.
  float core = exp(-d * d * 30.0) * vF.w * (1.25 - vT);
  vec3 col = vC.rgb * a + mix(vC.rgb, vec3(1.0), 0.65) * core * a * 1.6;
  gl_FragColor = vec4(col * vC.a, 0.0);
}`;

class Beams {
  readonly mesh: THREE.Mesh;
  private data = new Float32Array(MAX_BEAMS * STRIDE);
  private buf: THREE.InstancedInterleavedBuffer;
  private geo = new THREE.InstancedBufferGeometry();
  count = 0;
  readonly uTime = { value: 0 };
  constructor() {
    const geo = this.geo;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    ['iS', 'iE', 'iC', 'iF'].forEach((n, i) => geo.setAttribute(n, new THREE.InterleavedBufferAttribute(this.buf, 4, i * 4)));
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime },
      vertexShader: vs, fragmentShader: fs, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
  }
  begin(): void { this.count = 0; }
  add(s: number[], e: number[], w0: number, w1: number, c: readonly number[], a: number, endA: number, soft: number, haze = 1, core = 0): void {
    if (this.count >= MAX_BEAMS || a <= 0.002) return;
    const d = this.data, o = this.count++ * STRIDE;
    d[o] = s[0]; d[o + 1] = s[1]; d[o + 2] = s[2]; d[o + 3] = w0;
    d[o + 4] = e[0]; d[o + 5] = e[1]; d[o + 6] = e[2]; d[o + 7] = w1;
    d[o + 8] = c[0]; d[o + 9] = c[1]; d[o + 10] = c[2]; d[o + 11] = a;
    d[o + 12] = endA; d[o + 13] = soft; d[o + 14] = haze; d[o + 15] = core;
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
    this.glows = new SpriteBatch(glowTexture(), 320, 'add', 21);
    this.group.add(this.beams.mesh, this.glows.mesh);
    glows(this.beams.mesh, this.glows.mesh);
  }

  update(tReal: number, beat: number, back: boolean): void {
    const L = S.ld;
    this.lt += Math.max(0, Math.min(0.1, tReal - this.lastT)) * L.speed;
    this.lastT = tReal;
    const t = this.lt;
    const ph = ((beat % 1) + 1) % 1, kick = Math.pow(1 - ph, 2.4), bar = Math.floor(beat / 4);
    const pal = (L.colors ?? PALS[((Math.floor(bar / 8) % 4) + 4) % 4]).map(rgb);
    const look = activeLook(bar);
    // Strobe: beams and stage LEDs only (never a full-screen flash), at the designer's speed.
    const strobe = L.strobe && !reduceMotion ? strobeLevel(beat, L.strobeRate) : 1;
    const power = L.blackout ? 0 : clamp(0.35 + S.E * 0.75, 0, 1.25) * (1 - S.dim * 0.85) * L.intensity * strobe;
    const rig = 0.45 + 0.55 * S.mShow;
    const B = this.beams, G = this.glows;
    B.uTime.value = tReal;
    B.begin();
    G.begin();
    const WHITE = [1, 1, 0.94];
    // Lens: bright point, soft halo and a thin horizontal flare streak.
    const lens = (p: number[], c: readonly number[], a: number, size = 1) => {
      if (a <= 0.01) return;
      G.add(p[0], p[1], p[2], 5.5 * size, 5.5 * size, c[0], c[1], c[2], Math.min(1, a * 0.7));
      G.add(p[0], p[1], p[2], 1.6 * size, 1.6 * size, 1, 1, 1, Math.min(1, a));
      G.add(p[0], p[1], p[2], 16 * size, 0.55 * size, c[0] * 0.6 + 0.4, c[1] * 0.6 + 0.4, c[2] * 0.6 + 0.4, Math.min(0.8, a * 0.55));
    };

    /* Sky searchlights: four huge slow beams behind everything. Always on, even at low energy. */
    if (!L.blackout) {
      const sa = Math.min(0.5, (0.18 + S.E * 0.22) * (1 - S.dim * 0.7) * L.intensity) * strobe;
      for (let k = 0; k < 4; k++) {
        const s = k < 2 ? -1 : 1, off = k % 2 ? 0.9 : 0.4;
        const o = back ? [s * (30 + off * 25), 0, -60] : [s * (40 + off * 30), 0, 170];
        const sw = Math.sin(t * 0.22 + k * 1.7);
        const g = [o[0] + sw * 120 + s * 30, 260, o[2] + (back ? -40 : 60) * Math.cos(t * 0.17 + k)];
        B.add(o, g, 0.9, 16, k % 2 ? WHITE : pal[k % 2], sa, 0, 1, 1, 0.25);
      }
    }

    /* Moving heads: the main rig. More fixtures, hazy beams with hot cores. */
    const N = back ? 26 : 20;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), s = u * 2 - 1;
      if (Math.abs(s) > rig + 0.02) continue;
      const { ang, tilt, amp } = aim(look, i, u, beat, kick, t);
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
      const a = Math.min(1, amp * power * (up ? 0.95 : 0.34) * (0.75 + 0.25 * kick));
      B.add(o, g, 0.22, 0.4 + dist * (up ? 0.03 : 0.04), c, a, pool ? 0.12 : 0, 1, 1, up ? 0.8 : 0.25);
      if (pool) {
        G.add(g[0], 0.03, g[2], 15, 6, c[0], c[1], c[2], Math.min(0.55, amp * power * 0.45), 2);
      }
      lens(o, c, amp * power * (0.7 + 0.5 * kick));
    }

    /* Blinders: warm-white bank across the roof that punches on the kick when it's hot.
       Small light sources only (no full-screen flash). */
    const hot = clamp((S.E - 0.62) * 3, 0, 1) + S.flash;
    if (!L.blackout && hot > 0.02 && !reduceMotion) {
      const ba = Math.min(1.2, hot * Math.pow(kick, 3) * L.intensity);
      const row = back ? [-30, -18, -6, 6, 18, 30].map((x) => [x, 34.6, -14.8]) : [[-24, 21.4, 46], [24, 21.4, 46], [-12, 21.4, 46], [12, 21.4, 46]];
      for (const p of row) lens(p, [1, 0.85, 0.6], ba, 1.5);
    }
    /* Lasers on big moments (not in lights-down, skipped on every 4th bar unless very hype).
       Each emitter fans out a sheet; every 8 bars it closes into a spinning tunnel for two bars. */
    const autoLasers = S.E > 0.42 && S.dim < 0.5 && (bar % 4 !== 3 || S.E > 0.78);
    if (!L.blackout && (L.lasers === 'on' || (L.lasers === 'auto' && autoLasers))) {
      const em = back ? [[0, 33, -15], [-22, 33, -15], [22, 33, -15], [-40, 20, -15], [40, 20, -15]] : [[-24, 17, 46], [24, 17, 46], [0, 24, 0]];
      const la = clamp(S.E + 0.2, 0.5, 1) * Math.min(1.3, L.intensity) * strobe;
      const tunnel = ((bar % 8) + 8) % 8 >= 6;
      em.forEach((e, ei) => {
        const sw = Math.sin(t * 0.7 + ei * 2), c = pal[ei % 2];
        const n = 13;
        for (let j = 0; j < n; j++) {
          const v = (j / (n - 1)) * 2 - 1;
          let tgt: number[];
          if (tunnel) {
            const q = (j / n) * Math.PI * 2 + t * 1.4 * (ei % 2 ? 1 : -1), rad = back ? 20 : 45;
            tgt = back ? [e[0] + Math.cos(q) * rad, 20 + Math.sin(q) * rad * 0.6, S.maxZ * 0.6] : [e[0] + Math.cos(q) * rad, 50 + Math.sin(q) * rad * 0.6, 220];
          } else {
            const tx = e[0] + v * (back ? 46 + 18 * sw : 130) + Math.sin(t * 1.1 + ei) * 12;
            const ty = back ? 8 + 30 * Math.abs(Math.sin(t * 0.5 + ei + j * 0.08)) : 30 + 50 * Math.abs(Math.sin(t * 0.5 + ei + j * 0.08));
            tgt = [tx, ty, back ? S.maxZ * 0.4 : 220];
          }
          B.add(e, tgt, 0.14, 0.7, c, 0.22 * la, 0.3, 1, 0.8, 0);
          B.add(e, tgt, 0.035, 0.09, c, 0.9 * la, 0.3, 0, 0.25, 1);
        }
        lens(e, c, la * 0.9, 0.8);
      });
    }
    B.end();
    G.end();
  }
}
