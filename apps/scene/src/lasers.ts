/**
 * Lasers: thin, saturated, razor-sharp beams with a soft haze sheath, in four
 * looks. They draw after the lights-down tint (render order 32+), so they cut
 * through the dark, and the rig lets a laser you switched on fire through a
 * blackout too.
 *
 *  fan     - flat sheets that snap to new heights and tilts every two beats
 *  grid    - slanted vertical sheets crossing each other over low horizontal
 *            sheets: a lattice like modern EDM productions
 *  liquid  - "liquid sky": a rippling sheet of laser light just over the crowd's heads
 *  tunnel  - spinning cones aimed out at the crowd
 */
import * as THREE from 'three';
import { S } from './sim';
import { Beams } from './beams';
import { SpriteBatch, glowTexture } from './sprites';
import { glows } from './bloom';
import { hash } from './looks';
import { ROOF, TOWER_X, FOH } from './rig';

/* Every laser sits on structure (rig.ts): under the roof truss and on the side towers
   (stage), or under the front-of-house crossbar and on its towers (DJ's view). */
const RY = ROOF.y0 - 0.3, RZ = ROOF.z + 0.4, TX = TOWER_X, TZ = ROOF.z + 0.6;
const FY = FOH.y0 - 0.6, FZ = FOH.z - 0.2;

export const LASER_LOOKS = ['fan', 'grid', 'liquid', 'tunnel'];
const AUTO = ['fan', 'grid', 'liquid'];

const fract = (x: number) => x - Math.floor(x);
const ease = (x: number) => { const e = Math.min(1, Math.max(0, x)); return e * e * (3 - 2 * e); };

/** Laser colors: the show's colors pushed to full saturation, like real diode lasers. */
function laserColor(c: readonly number[], out: number[]): number[] {
  const col = new THREE.Color(c[0], c[1], c[2]), hsl = { h: 0, s: 0, l: 0 };
  col.getHSL(hsl);
  col.setHSL(hsl.h, Math.max(0.85, hsl.s), Math.min(0.62, Math.max(0.5, hsl.l)));
  out[0] = col.r; out[1] = col.g; out[2] = col.b;
  return out;
}

const skyVs = /* glsl */ `
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const skyFs = /* glsl */ `
uniform float uTime, uA, uFar;
uniform vec3 uC0, uC1;
uniform vec2 uO;
varying vec3 vW;
void main() {
  vec2 d = vW.xz - uO;
  float r = length(d), th = atan(d.x, d.y);
  // Ripples rolling out from the laser, wobbling like a liquid surface.
  float w = sin(r * 1.25 - uTime * 3.2 + sin(th * 5.0 + uTime * 0.8) * 2.2 + sin(vW.x * 0.21 - uTime * 1.3) * 1.4);
  float ripples = pow(abs(w), 22.0);
  // The scanned beam itself: fine radial lines.
  float rays = pow(abs(sin(th * 46.0 + sin(r * 0.18 + uTime * 0.9) * 1.6)), 36.0);
  float n = 0.55 + 0.45 * sin(vW.x * 0.33 + uTime * 1.1) * sin(vW.z * 0.41 - uTime * 0.7);
  float edge = smoothstep(62.0, 38.0, abs(vW.x)) * smoothstep(uFar, uFar - 10.0, vW.z) * smoothstep(-12.0, -4.0, vW.z);
  float a = (0.07 + ripples * 0.75 + rays * 0.3) * n * edge * uA;
  vec3 col = mix(uC0, uC1, 0.5 + 0.5 * sin(th * 3.0 + uTime * 0.6));
  gl_FragColor = vec4(col * a, 0.0);
}`;

export interface LaserFrame { t: number; beat: number; bar: number; kick: number; back: boolean; pal: readonly (readonly number[])[] }

export class Lasers {
  readonly group = new THREE.Group();
  private B = new Beams(900, 32);
  private dots = new SpriteBatch(glowTexture(), 64, 'add', 33);
  private sky: THREE.Mesh;
  private skyU = {
    uTime: { value: 0 }, uA: { value: 0 }, uFar: { value: 30 },
    uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uO: { value: new THREE.Vector2(0, -13) },
  };
  private c0 = [0, 1, 0];
  private c1 = [0, 1, 1];

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    this.sky = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.skyU, vertexShader: skyVs, fragmentShader: skyFs, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    }));
    this.sky.frustumCulled = false;
    this.sky.renderOrder = 32;
    this.sky.visible = false;
    this.group.add(this.B.mesh, this.dots.mesh, this.sky);
    glows(this.B.mesh, this.dots.mesh, this.sky);
  }

  /** a = overall laser level (0 = off). */
  update(a: number, f: LaserFrame): void {
    const B = this.B, D = this.dots;
    B.uTime.value = f.t;
    B.begin(); D.begin();
    this.sky.visible = false;
    if (a > 0.01) {
      const L = S.ld;
      let look = L.laserLook === 'auto' ? AUTO[((Math.floor(f.bar / 8) % AUTO.length) + AUTO.length) % AUTO.length] : L.laserLook;
      if (L.laserLook === 'auto' && look !== 'liquid' && ((f.bar % 8) + 8) % 8 >= 6) look = 'tunnel'; // the auto show closes into a tunnel
      laserColor(f.pal[0], this.c0);
      laserColor(f.pal[1], this.c1);
      if (look === 'grid') this.grid(a, f);
      else if (look === 'liquid') this.liquid(a, f);
      else if (look === 'tunnel') this.tunnel(a, f);
      else this.fan(a, f);
    }
    B.end(); D.end();
  }

  /** One laser: a soft haze sheath plus a razor-thin hot core. */
  private ray(s: number[], e: number[], c: readonly number[], a: number, thin = 1): void {
    this.B.add(s, e, 0.06 * thin, 0.2 * thin, c, 0.14 * a, 0.75, 1, 0.9, 0);
    this.B.add(s, e, 0.016 * thin, 0.04 * thin, c, a, 0.7, 0, 0.35, 1);
  }
  private emitter(p: number[], c: readonly number[], a: number): void {
    this.dots.add(p[0], p[1], p[2], 2.4, 2.4, c[0], c[1], c[2], Math.min(1, a * 0.8));
    this.dots.add(p[0], p[1], p[2], 0.8, 0.8, 1, 1, 1, Math.min(1, a));
  }
  /** Where beams land: a plane between the stage and the camera (crowd view) or far out past the crowd (stage view). */
  private zT(back: boolean): number { return back ? S.maxZ * 0.55 + 3 : 230; }

  private fan(a: number, f: LaserFrame): void {
    const { back, beat, kick } = f, zT = this.zT(back);
    const em = back ? [[0, RY, RZ], [-20, RY, RZ], [20, RY, RZ], [-TX, 21, TZ], [TX, 21, TZ]] : [[-24, FY, FZ], [24, FY, FZ], [0, FY, FZ]];
    const ks = beat / 2, k = Math.floor(ks), m = ease(fract(ks) / 0.12); // snap to a new position every 2 beats
    const open = 0.75 + 0.25 * kick;
    em.forEach((e, ei) => {
      const c = ei % 2 ? this.c1 : this.c0;
      const pick = (o: number) => hash(ei * 7.1 + o, k - 1) + (hash(ei * 7.1 + o, k) - hash(ei * 7.1 + o, k - 1)) * m;
      const yc = back ? 3 + pick(0) * 26 : 25 + pick(0) * 70;
      const slope = (pick(30) - 0.5) * 1.1;
      const span = (back ? 30 : 120) * open, cx = e[0] * (back ? 1.3 : 2);
      const n = 15;
      for (let j = 0; j < n; j++) {
        const v = (j / (n - 1)) * 2 - 1;
        this.ray(e, [cx + v * span, Math.max(0.4, yc + v * span * slope), zT], c, a);
      }
      this.emitter(e, c, a);
    });
  }

  private grid(a: number, f: LaserFrame): void {
    const { back, beat } = f, zT = this.zT(back);
    // Slanted vertical sheets, alternating left and right so they cross into a lattice.
    const xs = back ? [-36, -24, -12, 0, 12, 24, 36] : [-30, -18, -6, 6, 18, 30];
    const k = Math.floor(beat), m = ease(fract(beat) / 0.1);
    const width = (q: number) => 10 + 16 * (((q % 4) + 4) % 4) / 3; // steps wider each beat, then resets
    const off = width(k - 1) + (width(k) - width(k - 1)) * m;
    const n = 8;
    xs.forEach((x, i) => {
      const e = back ? [x, RY, RZ] : [x, FY, FZ], dir = i % 2 ? 1 : -1, c = i % 2 ? this.c1 : this.c0;
      for (let j = 0; j < n; j++) {
        const y = back ? 0.5 + (j / (n - 1)) * 36 : 10 + (j / (n - 1)) * 90;
        this.ray(e, [e[0] + dir * off * (back ? 1 : 3.2), y, zT], c, a * 0.85);
      }
      this.emitter(e, c, a);
    });
    // Low horizontal sheets from the sides, crossing under the vertical ones.
    const sides = back ? [[-TX, 5, TZ], [TX, 5, TZ]] : [[-FOH.towerX, 6, FZ], [FOH.towerX, 6, FZ]];
    sides.forEach((e, si) => {
      const c = si ? this.c0 : this.c1, h = 0.5 + 0.5 * Math.sin(f.t * 1.3 + si * 2);
      const n2 = 12;
      for (let j = 0; j < n2; j++) {
        const v = (j / (n2 - 1)) * 2 - 1;
        this.ray(e, [v * (back ? 50 : 160), back ? 1.4 + h * 3 : 20 + h * 15, zT], c, a * 0.75);
      }
      this.emitter(e, c, a);
    });
  }

  private liquid(a: number, f: LaserFrame): void {
    const t = f.t, far = S.maxZ + 14, O = [0, 3.3, -13];
    // The rippling sheet just over the crowd's heads.
    const u = this.skyU;
    u.uTime.value = t; u.uA.value = Math.min(1.2, a); u.uFar.value = far;
    u.uC0.value.setRGB(this.c0[0], this.c0[1], this.c0[2]);
    u.uC1.value.setRGB(this.c1[0], this.c1[1], this.c1[2]);
    this.sky.position.set(0, 3.2, (-12 + far) / 2);
    this.sky.scale.set(124, 1, far + 12);
    this.sky.visible = true;
    // The scanned beam fanning out to make it, rolling gently like a wave.
    const n = 40;
    for (let j = 0; j < n; j++) {
      const v = (j / (n - 1)) * 2 - 1;
      const y = 3.2 + 0.22 * Math.sin(t * 2.2 + v * 5);
      this.ray(O, [v * 58, y, far], j % 2 ? this.c1 : this.c0, a * 0.42, 0.8);
    }
    this.emitter(O, this.c0, a);
  }

  private tunnel(a: number, f: LaserFrame): void {
    const { back, t, kick } = f, zT = this.zT(back);
    const em = back ? [[0, RY, RZ], [-TX, 26, TZ], [TX, 26, TZ]] : [[0, FY, FZ], [-30, FY, FZ], [30, FY, FZ]];
    em.forEach((e, ei) => {
      const c = ei % 2 ? this.c1 : this.c0, big = ei === 0;
      const n = big ? 26 : 14, r = (back ? (big ? 17 : 9) : big ? 70 : 35) * (0.85 + 0.25 * kick);
      const cx = back ? e[0] * 0.8 : e[0] * 2.5, cy = back ? (big ? 15 : 12) : 55;
      for (let j = 0; j < n; j++) {
        const q = (j / n) * Math.PI * 2 + t * (big ? 1.4 : -1.9);
        this.ray(e, [cx + Math.cos(q) * r, Math.max(0.4, cy + Math.sin(q) * r * 0.8), zT], c, a * (big ? 1 : 0.8));
      }
      this.emitter(e, c, a);
    });
  }
}
