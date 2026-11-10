/**
 * Instanced Bibo crowd. One draw call for every Bibo (plus one for lights-down
 * glows). Each Bibo is 12 paper quads; the vertex shader computes the whole
 * pose (hop, squash, lean, flip, arms, props) from the shared beat, so the CPU
 * only touches a Bibo when its action changes. Instances are depth-sorted
 * back-to-front with an incremental insertion sort (near O(n) frame to frame)
 * and only re-uploaded when the order or a Bibo's state changed.
 */
import * as THREE from 'three';
import { BODY_COLORS, SHIRT_COLORS, HEAD_TOP, HEADS } from '@bibos/shared';
import { type Atlas, headCell, hatCell, bodyCell } from '@bibos/bibo-art';
import { S, crowd, type Bibo } from './sim';

const STRIDE = 20;
const PARTS = 12;

const hexVec = (h: string) => { const c = new THREE.Color(h); return new THREE.Vector3(c.r, c.g, c.b); };

function vertexShader(atlas: Atlas): string {
  const c = (k: string) => atlas.cells.get(k)!.toFixed(1);
  return /* glsl */ `
#define CELL_SHADOW ${c('shadow')}
#define CELL_KNOB ${c('knob')}
#define CELL_SLEEVE ${c('sleeve')}
#define CELL_GLOW ${c('glow')}
#define CELL_PHONE ${c('phone')}
#define CELL_PHONEB ${c('phoneb')}
#define CELL_LIGHTER ${c('lighter')}
#define CELL_FLAG ${c('flag')}
const float PI = 3.14159265;
const float TAU = 6.28318531;

attribute float aPart;
attribute vec2 aCorner;
attribute vec4 iA; // x, z, id, headType
attribute vec4 iB; // cellHeadF, cellHeadB, cellHatF, cellHatB
attribute vec4 iC; // cellBodyF, cellBodyB, color, shirt
attribute vec4 iD; // off, amp, seed, hype
attribute vec4 iE; // em, emEnd, born, holdPack

uniform float uTime, uBeat, uE, uDim, uLights, uLightsAt, uWaveAt, uBack, uHideDepth, uTargetId, uGlow;
uniform vec3 uCamRight, uCamUp, uCamFwd;
uniform vec3 uAtlas; // cols, cellPx, pad
uniform vec2 uAtlasSize;
uniform vec3 uBodyCols[8];
uniform vec3 uShirtCols[6];
uniform float uHeadTop[8];

varying vec2 vUv;
varying vec3 vMain;
varying vec3 vAcc;
varying vec3 vGlowCol;

vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(p.x * c - p.y * s, p.x * s + p.y * c); }

void kill() { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vUv = vec2(0.0); }

void main() {
  int part = int(aPart + 0.5);
  bool glowPart = part == 11;
  if ((uGlow > 0.5) != glowPart) { kill(); return; }

  vec3 base = vec3(iA.x, 0.0, iA.y);
  if (uHideDepth > 0.0 && abs(iA.z - uTargetId) > 0.5 && dot(base - cameraPosition, uCamFwd) < uHideDepth) { kill(); return; }

  float t = uTime;
  float b = uBeat + iD.x;
  float ph = fract(b);
  float amp = (0.35 + 0.85 * uE) * iD.y;
  float seed = iD.z;
  float em = t < iE.y ? iE.x : 0.0;
  float hold = step(10.0, iE.w);
  float holdAt = iE.w - hold * 10.0;
  if (em < 0.5 && uLights > 0.5 && t - uLightsAt > holdAt) em = hold > 0.5 ? 2.0 : 3.0;
  if (em < 0.5 && uE > iD.w) em = 7.0;
  if (uDim > 0.5 && em != 4.0 && em != 5.0) amp *= 0.35;

  float s1 = sin(ph * PI);
  float hop = s1 * 0.14 * amp;
  float sq = 1.0 - 0.14 * amp * pow(1.0 - ph, 5.0) + 0.05 * amp * s1;
  float lean = sin(b * PI * 0.5 + seed) * 0.04 * amp;
  if (uDim > 0.5) lean = sin(t * 1.15 + seed * 0.5) * 0.1;
  float flip = 1.0;
  vec2 L = vec2(-0.44, -0.5 + 0.05 * s1);
  vec2 R = vec2(0.44, L.y);
  float headDip = 0.05 * amp * pow(1.0 - ph, 3.0);

  if (em == 7.0) { R = vec2(0.46, -1.95 - 0.2 * s1); }
  else if (em == 1.0) { float o = abs(sin(b * PI)); L = vec2(-(0.04 + 0.27 * o), -2.25); R = vec2(0.04 + 0.27 * o, -2.25); }
  else if (em == 2.0) { R = vec2(0.46, -2.0 + sin(t * 1.3 + seed) * 0.04); }
  else if (em == 3.0) { R = vec2(0.5 + sin(t * 1.2 + seed) * 0.09, -2.0); }
  else if (em == 6.0) { R = vec2(0.5 + sin(t * 2.4 + seed) * 0.12, -2.0); }
  else if (em == 4.0) {
    float q = mod(b, 1.5) / 1.5;
    hop = sin(q * PI) * 1.15;
    sq = 1.0 + 0.1 * sin(q * PI) - 0.14 * pow(1.0 - q, 8.0);
    L = vec2(-0.6, -2.05); R = vec2(0.6, -2.05);
  } else if (em == 5.0) {
    float s = sin(b * PI);
    lean = s * 0.26;
    L = vec2(-0.62, -1.1 - 0.8 * max(s, 0.0));
    R = vec2(0.62, -1.1 - 0.8 * max(-s, 0.0));
    float bar = mod(b, 4.0);
    if (bar > 3.0) flip = cos((bar - 3.0) * TAU);
  }
  float wd = t - uWaveAt - iA.y / 11.0;
  if (wd > 0.0 && wd < 0.6) { float w = sin(wd / 0.6 * PI); hop += w * 0.85; L = vec2(-0.6, -1.2 - 0.9 * w); R = vec2(0.6, L.y); }
  float age = t - iE.z;
  if (age < 0.8) { float k = 1.0 - age / 0.8; flip = cos(k * TAU); hop += k * k * 2.4; }
  if (abs(flip) < 0.06) flip = flip < 0.0 ? -0.06 : 0.06;

  bool back = uBack > 0.5;
  int head = int(iA.w + 0.5);
  int shirtI = int(iC.w + 0.5);
  vec3 bodyCol = uBodyCols[int(iC.z + 0.5)];
  vec3 shirtCol = uShirtCols[shirtI];
  vec3 sleeveCol = shirtI == 3 ? vec3(0.863, 0.847, 1.0) : shirtCol;
  vec3 accentCol = shirtI == 3 ? vec3(1.0, 0.239, 0.506) : vec3(1.0);
  float hy = -1.42 + headDip;
  float hs = 0.92;
  vec2 c = aCorner;
  float cell = -1.0;
  vec2 P = vec2(0.0);
  bool posed = true;
  vec3 mainC = vec3(0.0), accC = vec3(0.0);
  vec2 glowExt = vec2(0.0);
  vGlowCol = vec3(0.0);

  if (part == 0) {
    cell = CELL_SHADOW; posed = false;
    float k = 1.0 - min(hop, 0.8) * 0.5;
    P = vec2((c.x - 0.5) * 0.84 * k, (c.y - 0.5) * 0.24 + 0.02);
  } else if (part == 1) {
    cell = back ? iC.y : iC.x; mainC = shirtCol; accC = accentCol;
    P = vec2(-0.7, -1.25) + c * 1.4;
  } else if (part == 2) {
    cell = back ? iB.y : iB.x; mainC = bodyCol;
    P = (vec2(-1.0, -1.25) + c * 2.0) * hs + vec2(0.0, hy);
  } else if (part == 3) {
    cell = back ? iB.w : iB.z;
    P = (vec2(-0.85, -0.95 + uHeadTop[head]) + c * 1.7) * hs + vec2(0.0, hy);
  } else if (part == 4) {
    if (em == 2.0) { cell = back ? CELL_PHONEB : CELL_PHONE; P = R + vec2(-0.36, -0.62) + c * 0.72; }
    else if (em == 3.0) { cell = CELL_LIGHTER; P = R + vec2(-0.36, -0.64) + c * 0.72; }
    else if (em == 6.0) {
      cell = CELL_FLAG; mainC = bodyCol; accC = shirtCol;
      vec2 q = vec2(-0.2, -1.85) + c * 2.1;
      q.y += sin(t * 5.0 + q.x * 4.0 + seed) * 0.1 * max(q.x, 0.0) / 1.25;
      P = vec2(R.x, -2.0) + q;
    }
  } else if (part <= 10) {
    bool right = part >= 8;
    int k = part - (right ? 8 : 5);
    vec2 S0 = vec2(right ? 0.32 : -0.32, -0.86);
    vec2 H = right ? R : L;
    if (k == 0) { cell = CELL_KNOB; mainC = sleeveCol; P = S0 + (c - 0.5) * 0.23; }
    else if (k == 1) {
      cell = CELL_SLEEVE; mainC = sleeveCol;
      vec2 d = H - S0; float len = length(d);
      vec2 dir = len > 1e-4 ? d / len : vec2(0.0, 1.0);
      vec2 nrm = vec2(-dir.y, dir.x);
      P = S0 + dir * (c.y * len) + nrm * ((c.x - 0.5) * 0.22);
    } else { cell = CELL_KNOB; mainC = bodyCol; P = H + (c - 0.5) * 0.23; }
  } else {
    if (em == 2.0 || em == 3.0) {
      cell = CELL_GLOW;
      float fl = 1.0 + sin(t * 19.0 + seed * 7.0) * 0.12;
      float r = em == 2.0 ? (back ? 0.8 : 0.5) : 0.9 * fl;
      P = R + vec2(0.0, em == 2.0 ? -0.32 : -0.4);
      glowExt = (c - 0.5) * 2.0 * r;
      vGlowCol = em == 2.0 ? vec3(0.667, 0.843, 1.0) : vec3(1.0, 0.706, 0.275);
    }
  }
  if (cell < 0.0) { kill(); return; }

  vec2 Q = P;
  if (posed) { Q = rot(P, lean); Q = vec2(Q.x * flip / sq, Q.y * sq - hop); }
  Q += glowExt;
  vec3 world = base + uCamRight * Q.x - uCamUp * Q.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);

  float row = floor((cell + 0.5) / uAtlas.x);
  float col = cell - row * uAtlas.x;
  vUv = (vec2(col, row) * uAtlas.y + uAtlas.z + c * (uAtlas.y - 2.0 * uAtlas.z)) / uAtlasSize;
  vMain = mainC;
  vAcc = accC;
}`;
}

const fragmentShader = /* glsl */ `
uniform sampler2D uBase;
uniform sampler2D uWeights;
uniform float uGlow, uGlowI;
varying vec2 vUv;
varying vec3 vMain;
varying vec3 vAcc;
varying vec3 vGlowCol;
void main() {
  vec4 b = texture2D(uBase, vUv);
  if (uGlow > 0.5) { gl_FragColor = vec4(vGlowCol * b.a * uGlowI, 0.0); return; }
  if (b.a < 0.004) discard;
  vec2 w = texture2D(uWeights, vUv).rg;
  gl_FragColor = vec4(b.rgb + w.r * vMain + w.g * vAcc, b.a);
}`;

export class Crowd {
  readonly mesh: THREE.Mesh;
  readonly glowMesh: THREE.Mesh;
  private geo: THREE.InstancedBufferGeometry;
  private master = new Float32Array(0);
  private sorted = new Float32Array(0);
  private buf!: THREE.InstancedInterleavedBuffer;
  private order: number[] = [];
  private depth = new Float32Array(0);
  private uniforms: Record<string, THREE.IUniform>;
  private glowUniforms: Record<string, THREE.IUniform>;
  uploads = 0;
  readonly baseTex: THREE.DataTexture;

  constructor(private atlas: Atlas) {
    const baseTex = new THREE.DataTexture(atlas.base, atlas.width, atlas.height, THREE.RGBAFormat);
    this.baseTex = baseTex;
    const wTex = new THREE.DataTexture(atlas.weights, atlas.width, atlas.height, THREE.RGBAFormat);
    for (const tx of [baseTex, wTex]) {
      tx.generateMipmaps = true;
      tx.minFilter = THREE.LinearMipmapLinearFilter;
      tx.magFilter = THREE.LinearFilter;
      tx.colorSpace = THREE.NoColorSpace;
      tx.needsUpdate = true;
    }

    // Base geometry: PARTS quads, drawn in order (painter's order within one Bibo).
    const part = new Float32Array(PARTS * 4);
    const corner = new Float32Array(PARTS * 4 * 2);
    const index: number[] = [];
    for (let p = 0; p < PARTS; p++) {
      const cs = [[0, 0], [1, 0], [1, 1], [0, 1]];
      cs.forEach(([u, v], i) => { part[p * 4 + i] = p; corner[(p * 4 + i) * 2] = u; corner[(p * 4 + i) * 2 + 1] = v; });
      const o = p * 4;
      index.push(o, o + 1, o + 2, o, o + 2, o + 3);
    }
    this.baseAttrs = {
      position: new THREE.BufferAttribute(new Float32Array(PARTS * 4 * 3), 3),
      aPart: new THREE.BufferAttribute(part, 1),
      aCorner: new THREE.BufferAttribute(corner, 2),
      index: new THREE.BufferAttribute(new Uint16Array(index), 1),
    };
    const geo = this.makeGeometry();
    this.geo = geo;

    const common = {
      uTime: { value: 0 }, uBeat: { value: 0 }, uE: { value: 0.5 }, uDim: { value: 0 }, uLights: { value: 0 }, uLightsAt: { value: -99 },
      uWaveAt: { value: -99 }, uBack: { value: 0 }, uHideDepth: { value: 0 }, uTargetId: { value: -1 },
      uCamRight: { value: new THREE.Vector3(1, 0, 0) }, uCamUp: { value: new THREE.Vector3(0, 1, 0) }, uCamFwd: { value: new THREE.Vector3(0, 0, 1) },
      uAtlas: { value: new THREE.Vector3(atlas.cols, atlas.cellPx, atlas.pad) },
      uAtlasSize: { value: new THREE.Vector2(atlas.width, atlas.height) },
      uBodyCols: { value: BODY_COLORS.map(hexVec) },
      uShirtCols: { value: SHIRT_COLORS.map(hexVec) },
      uHeadTop: { value: HEADS.map((h) => HEAD_TOP[h]) },
      uBase: { value: baseTex }, uWeights: { value: wTex },
      uGlowI: { value: 0 },
    };
    this.uniforms = { ...common, uGlow: { value: 0 } };
    this.glowUniforms = { ...common, uGlow: { value: 1 } }; // shares the uniform objects above
    const mk = (u: Record<string, THREE.IUniform>) => new THREE.ShaderMaterial({
      uniforms: u, vertexShader: vertexShader(atlas), fragmentShader,
      side: THREE.DoubleSide, // paper quads flip winding with the y-down canvas mapping
      transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    });
    this.mesh = new THREE.Mesh(geo, mk(this.uniforms));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.glowMesh = new THREE.Mesh(geo, mk(this.glowUniforms));
    this.glowMesh.frustumCulled = false;
    this.glowMesh.renderOrder = 40;
    this.rebuild();
  }

  private baseAttrs: Record<'position' | 'aPart' | 'aCorner' | 'index', THREE.BufferAttribute>;

  private makeGeometry(): THREE.InstancedBufferGeometry {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', this.baseAttrs.position);
    g.setAttribute('aPart', this.baseAttrs.aPart);
    g.setAttribute('aCorner', this.baseAttrs.aCorner);
    g.setIndex(this.baseAttrs.index);
    return g;
  }

  /** Call when crowd membership changes. */
  rebuild(): void {
    const n = crowd.length;
    this.master = new Float32Array(Math.max(1, n) * STRIDE);
    this.sorted = new Float32Array(Math.max(1, n) * STRIDE);
    this.depth = new Float32Array(n);
    this.order = crowd.map((_, i) => i);
    for (const a of crowd) { a.dirty = true; this.write(a); }
    // three.js caches the max instance count per geometry on first draw, so a
    // resized crowd needs a fresh geometry (base attributes are shared).
    if (this.mesh) {
      const old = this.geo;
      this.geo = this.makeGeometry();
      this.mesh.geometry = this.geo;
      this.glowMesh.geometry = this.geo;
      old.dispose();
    }
    this.buf = new THREE.InstancedInterleavedBuffer(this.sorted, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    const names = ['iA', 'iB', 'iC', 'iD', 'iE'];
    names.forEach((nm, i) => this.geo.setAttribute(nm, new THREE.InterleavedBufferAttribute(this.buf, 4, i * 4)));
    this.geo.instanceCount = n;
    if (this.mesh) this.mesh.visible = this.glowMesh.visible = n > 0;
    this.forceUpload = true;
  }
  private forceUpload = true;

  private write(a: Bibo): void {
    const m = this.master, o = a.id * STRIDE, L = a.look, at = this.atlas;
    m[o] = a.x; m[o + 1] = a.z; m[o + 2] = a.id; m[o + 3] = L.head;
    m[o + 4] = headCell(at, L.head, L.extra, false); m[o + 5] = headCell(at, L.head, L.extra, true);
    m[o + 6] = hatCell(at, L.hat, false); m[o + 7] = hatCell(at, L.hat, true);
    m[o + 8] = bodyCell(at, L.pattern, false); m[o + 9] = bodyCell(at, L.pattern, true);
    m[o + 10] = L.color; m[o + 11] = L.shirt;
    m[o + 12] = a.off; m[o + 13] = a.amp; m[o + 14] = a.seed; m[o + 15] = a.hype;
    m[o + 16] = a.em; m[o + 17] = a.emEnd; m[o + 18] = a.born; m[o + 19] = a.hold * 10 + a.holdAt;
    a.dirty = false;
  }

  update(camera: THREE.PerspectiveCamera, t: number, beat: number): void {
    const u = this.uniforms;
    const right = u.uCamRight.value as THREE.Vector3, up = u.uCamUp.value as THREE.Vector3, fwd = u.uCamFwd.value as THREE.Vector3;
    camera.matrixWorld.extractBasis(right, up, fwd);
    fwd.negate(); // camera looks down -Z
    u.uTime.value = t;
    u.uBeat.value = beat;
    u.uE.value = S.E;
    u.uDim.value = S.dim;
    u.uLights.value = S.lights ? 1 : 0;
    u.uLightsAt.value = S.lightsAt;
    u.uWaveAt.value = S.waveAt;
    u.uBack.value = fwd.z < 0 ? 1 : 0;
    u.uGlowI.value = Math.min(0.6, S.dim * 0.75);
    this.glowMesh.visible = S.dim > 0.01;
    if (S.shot === 'close' && S.target) {
      const d = (S.target.x - camera.position.x) * fwd.x + (S.target.z - camera.position.z) * fwd.z + (0 - camera.position.y) * fwd.y;
      u.uHideDepth.value = Math.max(0.01, d - 0.7);
      u.uTargetId.value = S.target.id;
    } else {
      u.uHideDepth.value = 0;
      u.uTargetId.value = -1;
    }

    let dirty = this.forceUpload;
    for (const a of crowd) if (a.dirty) { this.write(a); dirty = true; }

    // Depth along view direction; draw far first.
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, dep = this.depth;
    for (const a of crowd) dep[a.id] = (a.x - cx) * fwd.x + (0 - cy) * fwd.y + (a.z - cz) * fwd.z;
    const ord = this.order;
    let swapped = false;
    for (let i = 1; i < ord.length; i++) {
      const v = ord[i], dv = dep[v];
      let j = i - 1;
      while (j >= 0 && dep[ord[j]] < dv) { ord[j + 1] = ord[j]; j--; }
      if (j !== i - 1) swapped = true;
      ord[j + 1] = v;
    }
    if (dirty || swapped) {
      const m = this.master, s = this.sorted;
      for (let i = 0; i < ord.length; i++) s.set(m.subarray(ord[i] * STRIDE, ord[i] * STRIDE + STRIDE), i * STRIDE);
      this.buf.needsUpdate = true;
      this.forceUpload = false;
      this.uploads++;
    }
  }
}

/** CPU mirror of the shader's hop + resolved action, for name-label placement. */
export function poseHop(a: Bibo, t: number, beat: number): { hop: number; em: number } {
  const b = beat + a.off, ph = ((b % 1) + 1) % 1;
  let amp = (0.35 + 0.85 * S.E) * a.amp;
  let em = t < a.emEnd ? a.em : 0;
  if (!em && S.lights && t - S.lightsAt > a.holdAt) em = a.hold ? 2 : 3;
  if (!em && S.E > a.hype) em = 7;
  if (S.dim > 0.5 && em !== 4 && em !== 5) amp *= 0.35;
  let hop = Math.sin(ph * Math.PI) * 0.14 * amp;
  if (em === 4) { const q = (((b % 1.5) + 1.5) % 1.5) / 1.5; hop = Math.sin(q * Math.PI) * 1.15; }
  const wd = t - S.waveAt - a.z / 11;
  if (wd > 0 && wd < 0.6) hop += Math.sin((wd / 0.6) * Math.PI) * 0.85;
  const age = t - a.born;
  if (age < 0.8) { const k = 1 - age / 0.8; hop += k * k * 2.4; }
  return { hop, em };
}
