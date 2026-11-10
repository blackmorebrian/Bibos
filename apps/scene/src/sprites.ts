/**
 * Instanced camera-facing (or ground-flat) sprites, refilled every frame.
 * Used for emotes, confetti, glows, pools, CO2 and pyro.
 */
import * as THREE from 'three';

const STRIDE = 16;

const vs = /* glsl */ `
attribute vec2 aCorner;
attribute vec4 iP; // x, y, z, mode (0 billboard centered, 1 billboard bottom-anchored, 2 ground)
attribute vec4 iS; // w, h, rot, unused
attribute vec4 iC; // rgba tint (straight alpha)
attribute vec4 iU; // u0, v0, u1, v1
uniform vec3 uCamRight, uCamUp;
varying vec2 vUv;
varying vec4 vC;
void main() {
  vec2 c = aCorner - vec2(0.5, iP.w > 0.5 && iP.w < 1.5 ? 0.0 : 0.5);
  float cr = cos(iS.z), sr = sin(iS.z);
  vec2 q = vec2(c.x * iS.x, c.y * iS.y);
  q = vec2(q.x * cr - q.y * sr, q.x * sr + q.y * cr);
  vec3 p = iP.xyz;
  vec3 w = iP.w > 1.5 ? p + vec3(q.x, 0.0, q.y) : p + uCamRight * q.x + uCamUp * q.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  vUv = mix(iU.xy, iU.zw, vec2(aCorner.x, 1.0 - aCorner.y));
  vC = iC;
}`;
const fs = /* glsl */ `
uniform sampler2D uTex;
varying vec2 vUv;
varying vec4 vC;
void main() {
  vec4 t = texture2D(uTex, vUv);
  gl_FragColor = t * vec4(vC.rgb * vC.a, vC.a);
}`;

export type SpriteBlend = 'premult' | 'add';

export class SpriteBatch {
  readonly mesh: THREE.Mesh;
  private data: Float32Array;
  private buf: THREE.InstancedInterleavedBuffer;
  private geo: THREE.InstancedBufferGeometry;
  count = 0;
  static camRight = new THREE.Vector3(1, 0, 0);
  static camUp = new THREE.Vector3(0, 1, 0);

  constructor(tex: THREE.Texture, private max: number, blend: SpriteBlend, renderOrder: number, depthTest = false) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    geo.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.data = new Float32Array(max * STRIDE);
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    ['iP', 'iS', 'iC', 'iU'].forEach((n, i) => geo.setAttribute(n, new THREE.InterleavedBufferAttribute(this.buf, 4, i * 4)));
    geo.instanceCount = 0;
    this.geo = geo;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: tex }, uCamRight: { value: SpriteBatch.camRight }, uCamUp: { value: SpriteBatch.camUp } },
      vertexShader: vs, fragmentShader: fs, side: THREE.DoubleSide, transparent: true, depthTest, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor,
      blendDst: blend === 'add' ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
  }

  begin(): void { this.count = 0; }

  /** color is a THREE.Color or [r,g,b]; uv defaults to the full texture. */
  add(x: number, y: number, z: number, w: number, h: number, r: number, g: number, b: number, a: number,
    mode = 0, rot = 0, uv: readonly number[] = FULL): void {
    if (this.count >= this.max || a <= 0.001) return;
    const d = this.data, o = this.count++ * STRIDE;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = mode;
    d[o + 4] = w; d[o + 5] = h; d[o + 6] = rot;
    d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
    d[o + 12] = uv[0]; d[o + 13] = uv[1]; d[o + 14] = uv[2]; d[o + 15] = uv[3];
  }

  end(): void {
    this.geo.instanceCount = this.count;
    if (this.count) {
      this.buf.clearUpdateRanges();
      this.buf.addUpdateRange(0, this.count * STRIDE);
      this.buf.needsUpdate = true;
    }
  }
}
export const FULL = [0, 0, 1, 1] as const;

/** Canvas-drawn texture with premultiplied upload. */
export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.premultiplyAlpha = true;
  t.flipY = false; // v=0 is the top row everywhere (matches the atlas)
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function glowTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,.45)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  });
}

export const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
