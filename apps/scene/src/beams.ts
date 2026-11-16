/**
 * Beam renderer shared by the moving heads (lights.ts) and the lasers (lasers.ts).
 */
import * as THREE from 'three';

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

/** Additive light beams: instanced camera-facing ribbons with drifting haze and a hot core. */
export class Beams {
  readonly mesh: THREE.Mesh;
  private data: Float32Array;
  private buf: THREE.InstancedInterleavedBuffer;
  private geo = new THREE.InstancedBufferGeometry();
  count = 0;
  readonly uTime = { value: 0 };
  constructor(private max = MAX_BEAMS, order = 20) {
    this.data = new Float32Array(max * STRIDE);
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
    this.mesh.renderOrder = order;
  }
  begin(): void { this.count = 0; }
  add(s: number[], e: number[], w0: number, w1: number, c: readonly number[], a: number, endA: number, soft: number, haze = 1, core = 0): void {
    if (this.count >= this.max || a <= 0.002) return;
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

