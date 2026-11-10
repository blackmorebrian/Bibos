/**
 * Selective bloom: only things on the GLOW layer (beams, lasers, fixture
 * glows, pyro, LEDs) are drawn again into a small offscreen buffer, blurred
 * at several sizes, and added on top of the finished frame. The crowd and the
 * webcam screen never bloom. Only the blurred levels are added, so glow from
 * something behind a Bibo shows as a soft halo, never as a sharp see-through.
 */
import * as THREE from 'three';

export const GLOW_LAYER = 1;

/** Put a mesh on the glow layer as well as the normal one. */
export function glows(...objs: THREE.Object3D[]): void { for (const o of objs) o.layers.enable(GLOW_LAYER); }

const quadVs = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const blurFs = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uDir; // one texel along the blur direction
varying vec2 vUv;
void main() {
  // 9-tap gaussian folded into 5 bilinear reads.
  vec3 c = texture2D(uTex, vUv).rgb * 0.2270270270;
  vec2 o1 = uDir * 1.3846153846, o2 = uDir * 3.2307692308;
  c += (texture2D(uTex, vUv + o1).rgb + texture2D(uTex, vUv - o1).rgb) * 0.3162162162;
  c += (texture2D(uTex, vUv + o2).rgb + texture2D(uTex, vUv - o2).rgb) * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const LEVELS = 5;
const compFs = /* glsl */ `
uniform sampler2D uL0, uL1, uL2, uL3, uL4;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uL0, vUv).rgb * 0.9 + texture2D(uL1, vUv).rgb * 0.8 + texture2D(uL2, vUv).rgb * 0.7
         + texture2D(uL3, vUv).rgb * 0.6 + texture2D(uL4, vUv).rgb * 0.5;
  c *= uStrength;
  // Soft knee so stacked beams glow white-hot without clipping to flat white.
  c = c / (1.0 + max(max(c.r, c.g), c.b) * 0.35);
  gl_FragColor = vec4(c, 1.0);
}`;

export class Bloom {
  strength = 1;
  private src: THREE.WebGLRenderTarget;
  private a: THREE.WebGLRenderTarget[] = [];
  private b: THREE.WebGLRenderTarget[] = [];
  private quad: THREE.Mesh;
  private qScene = new THREE.Scene();
  private qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private blur: THREE.ShaderMaterial;
  private comp: THREE.ShaderMaterial;
  private camLayers = new THREE.Layers();

  constructor(private renderer: THREE.WebGLRenderer) {
    const opt = { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.src = new THREE.WebGLRenderTarget(1, 1, { ...opt });
    for (let i = 0; i < LEVELS; i++) { this.a.push(new THREE.WebGLRenderTarget(1, 1, opt)); this.b.push(new THREE.WebGLRenderTarget(1, 1, opt)); }
    this.blur = new THREE.ShaderMaterial({ uniforms: { uTex: { value: null }, uDir: { value: new THREE.Vector2() } }, vertexShader: quadVs, fragmentShader: blurFs, depthTest: false, depthWrite: false });
    const u: Record<string, THREE.IUniform> = { uStrength: { value: 1 } };
    for (let i = 0; i < LEVELS; i++) u[`uL${i}`] = { value: this.a[i].texture };
    this.comp = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: quadVs, fragmentShader: compFs, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blur);
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);
  }

  setSize(w: number, h: number): void {
    // Glow source at quarter resolution: plenty for something that gets blurred anyway.
    let sw = Math.max(2, Math.round(w / 4)), sh = Math.max(2, Math.round(h / 4));
    this.src.setSize(sw, sh);
    for (let i = 0; i < LEVELS; i++) {
      this.a[i].setSize(sw, sh); this.b[i].setSize(sw, sh);
      sw = Math.max(2, sw >> 1); sh = Math.max(2, sh >> 1);
    }
  }

  private pass(mat: THREE.Material, target: THREE.WebGLRenderTarget | null): void {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.qScene, this.qCam);
  }

  /** Call right after the normal render of the scene to the screen. */
  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.strength <= 0.01) return;
    const r = this.renderer;
    const bg = scene.background, autoClear = r.autoClear;
    const clear = r.getClearColor(new THREE.Color()), clearA = r.getClearAlpha();
    this.camLayers.mask = camera.layers.mask;

    // 1. Only the glowing things, on black.
    scene.background = null;
    camera.layers.set(GLOW_LAYER);
    r.setClearColor(0x000000, 1);
    r.autoClear = true;
    r.setRenderTarget(this.src);
    r.render(scene, camera);
    camera.layers.mask = this.camLayers.mask;

    // 2. Blur at each size, each level starting from the one above.
    let input = this.src.texture;
    for (let i = 0; i < LEVELS; i++) {
      const A = this.a[i], B = this.b[i];
      this.blur.uniforms.uTex.value = input;
      this.blur.uniforms.uDir.value.set(1 / A.width, 0);
      this.pass(this.blur, B);
      this.blur.uniforms.uTex.value = B.texture;
      this.blur.uniforms.uDir.value.set(0, 1 / A.height);
      this.pass(this.blur, A);
      input = A.texture;
    }

    // 3. Add on top of the frame.
    this.comp.uniforms.uStrength.value = this.strength;
    r.autoClear = false;
    this.pass(this.comp, null);

    r.autoClear = autoClear;
    r.setClearColor(clear, clearA);
    scene.background = bg;
  }
}
