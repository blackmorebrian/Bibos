/**
 * Static-ish world: sky, ground, filler sea, main stage, side towers.
 * Flat MeshBasicMaterial colors to match the paper look. Colors are sRGB
 * values used as-is (color management is off in main.ts).
 */
import * as THREE from 'three';
import { mulberry } from '@bibos/shared';
import { S, activeLook, activeChase, reduceMotion } from './sim';
import { canvasTexture } from './sprites';
import { params } from './params';
import { IMAGES, textColumns } from './screens';
import { glows } from './bloom';
import { chaseLevel, strobeLevel } from './looks';

export const PALS = [['#ff3d81', '#19d3c5'], ['#ffc21a', '#7c5cff'], ['#19d3c5', '#ff7a2f'], ['#ff4fd8', '#ffe066']];
const WHITE = new THREE.Color('#ffffff');
const clamp01 = (v: number) => Math.max(0, Math.min(1.5, v));
const CF = ['#ff3d81', '#ffc21a', '#19d3c5', '#ffffff', '#7c5cff', '#ff7a2f'];
const PAPER = '#fffdf6';
const CROWD_H = 1.8, TILE = 30;

const basic = (color: string | number, map?: THREE.Texture) =>
  new THREE.MeshBasicMaterial({ color, map: map ?? null, side: THREE.DoubleSide });

/* Lights down tints the whole frame dark. Like a real stage, the video screens stay bright:
   each webcam screen gets a copy drawn after the tint (fx.ts, render order 30), only where the
   screen itself is visible (same depth), fading in as the lights go down. */
const screenLit = new THREE.MeshBasicMaterial({
  color: '#ffffff', side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false, depthFunc: THREE.LessEqualDepth,
});
function brightCopy(screen: THREE.Mesh): THREE.Mesh {
  const m = new THREE.Mesh(screen.geometry, screenLit);
  m.renderOrder = 31;
  m.visible = false;
  screen.add(m);
  return m;
}
const brightScreens: THREE.Mesh[] = [];

function rect(x0: number, y0: number, x1: number, y1: number, z: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0)), mat);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z);
  return m;
}
function shape(points: number[][], z: number, mat: THREE.Material): THREE.Mesh {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const m = new THREE.Mesh(new THREE.ShapeGeometry(s), mat);
  m.position.z = z;
  return m;
}

/* ---------- sky: fullscreen gradient + stars, horizon tracked from the camera ---------- */
function makeSky(): { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> } {
  const uniforms = { uRes: { value: new THREE.Vector2(1920, 1080) }, uHy: { value: 600 } };
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
uniform vec2 uRes; uniform float uHy;
float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  float H = uRes.y;
  float y = H - gl_FragCoord.y;
  float t = clamp((y - (uHy - 0.95 * H)) / (0.95 * H), 0.0, 1.0);
  vec3 c0 = vec3(0.059, 0.031, 0.271), c1 = vec3(0.235, 0.090, 0.639), c2 = vec3(0.839, 0.184, 0.620), c3 = vec3(1.0, 0.604, 0.302);
  vec3 col = t < 0.55 ? mix(c0, c1, t / 0.55) : t < 0.85 ? mix(c1, c2, (t - 0.55) / 0.3) : mix(c2, c3, (t - 0.85) / 0.15);
  if (y < uHy - 0.3 * H) {
    float cs = H / 14.0;
    vec2 cell = floor(gl_FragCoord.xy / cs);
    float r = h21(cell);
    vec2 sp = (cell + vec2(h21(cell + 7.1), h21(cell + 3.3))) * cs;
    float sz = (r < 0.2 ? 2.0 : 1.0) * H / 900.0;
    vec2 d = abs(gl_FragCoord.xy - sp);
    if (r < 0.85 && d.x < sz && d.y < sz) col = vec3(1.0, 0.992, 0.965);
  }
  gl_FragColor = vec4(col, 1.0);
}`,
    depthTest: false, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  return { mesh, uniforms };
}

/* ---------- filler sea: instanced strips of muted silhouettes ---------- */
function makeStripTexture(seed: number): THREE.CanvasTexture {
  const t = canvasTexture(1200, 72, (g) => {
    const r = mulberry(seed);
    const cols = ['#7a4fd0', '#5a3bc0', '#a25ad8', '#c9549f', '#4a6fe0', '#3f2fa8', '#d9805a', '#6b46c8'];
    for (let i = 0; i < 170; i++) {
      const x = r() * 1200, h = 26 + r() * 18;
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.beginPath(); g.arc(x, 72 - h, 9, 0, Math.PI * 2); g.fill();
      g.fillRect(x - 8, 72 - h, 16, h);
      if (r() < 0.3) g.fillRect(x + 8, 72 - h - 20, 4, 28);
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

const seaVS = /* glsl */ `
const float PI = 3.14159265;
attribute vec2 aCorner;
attribute vec4 iR; // x0, width, z, uOffset
uniform float uBeat, uE, uDim;
varying vec2 vUv;
varying float vFog;
void main() {
  float z = iR.z;
  float wave = max(0.0, sin(uBeat * PI - z * 0.14)) * 0.28 * (0.35 + uE) * (uDim > 0.5 ? 0.3 : 1.0);
  vec3 p = vec3(iR.x + aCorner.x * iR.y, aCorner.y * ${CROWD_H.toFixed(2)} + wave, z);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vUv = vec2((p.x - iR.w) / ${TILE.toFixed(1)}, 1.0 - aCorner.y);
  vFog = clamp(1.05 + mv.z / 170.0, 0.32, 1.0);
}`;
const seaFS = /* glsl */ `
uniform sampler2D uTex;
uniform vec3 uHaze;
varying vec2 vUv;
varying float vFog;
void main() {
  vec4 t = texture2D(uTex, vUv);
  if (t.a < 0.5) discard;
  gl_FragColor = vec4(mix(uHaze, t.rgb / t.a, vFog), 1.0);
}`;

class SeaLayer {
  readonly meshes: THREE.Mesh[] = [];
  private geos: THREE.InstancedBufferGeometry[] = [];
  constructor(textures: THREE.Texture[], uniforms: Record<string, THREE.IUniform>) {
    for (const tex of textures) {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      geo.setAttribute('aCorner', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      const mat = new THREE.ShaderMaterial({ uniforms: { ...uniforms, uTex: { value: tex } }, vertexShader: seaVS, fragmentShader: seaFS, side: THREE.DoubleSide });
      const m = new THREE.Mesh(geo, mat);
      m.frustumCulled = false;
      m.renderOrder = -50;
      this.meshes.push(m);
      this.geos.push(geo);
    }
  }
  /** Fixed capacity: three.js caches a geometry's max instance count on first draw. */
  private static CAP = 512;
  set(rows: number[][]): void {
    this.geos.forEach((geo, v) => {
      let attr = geo.getAttribute('iR') as THREE.InstancedBufferAttribute | undefined;
      if (!attr) {
        attr = new THREE.InstancedBufferAttribute(new Float32Array(SeaLayer.CAP * 4), 4);
        geo.setAttribute('iR', attr);
      }
      const mine = rows.filter((r) => r[4] === v).slice(0, SeaLayer.CAP);
      const data = attr.array as Float32Array;
      mine.forEach((r, i) => data.set(r.slice(0, 4), i * 4));
      attr.needsUpdate = true;
      geo.instanceCount = mine.length;
    });
  }
  set visible(v: boolean) { this.meshes.forEach((m) => (m.visible = v)); }
}

export class World {
  readonly group = new THREE.Group();
  private sky = makeSky();
  private seaUniforms = { uBeat: { value: 0 }, uE: { value: 0.5 }, uDim: { value: 0 }, uHaze: { value: new THREE.Color('#2b1387') } };
  private seaFront: SeaLayer;
  private seaSide: SeaLayer;
  private mountains: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; i: number }[] = [];
  private panelCells!: THREE.InstancedMesh;
  private rings!: THREE.InstancedMesh;
  private deckLeds!: THREE.InstancedMesh;
  private triMats: THREE.MeshBasicMaterial[] = [];
  private speakers: THREE.Group[] = [];
  private ferrisSpin!: THREE.Group;
  private flags: THREE.Mesh[] = [];
  private tmpColor = new THREE.Color();
  private tmpColor2 = new THREE.Color();

  constructor(screenTex: THREE.Texture) {
    const g = this.group;
    g.add(this.sky.mesh);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 430), basic('#241577'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 185);
    ground.renderOrder = -90;
    g.add(ground);

    // Far side (seen from the DJ's view)
    g.add(shape([[-400, 0], [-300, 34], [-210, 16], [-130, 44], [-60, 20], [20, 38], [110, 18], [210, 46], [310, 20], [400, 0]], 320, basic('#2b1387')));
    this.buildFerris();
    this.buildFlags();
    for (const x of [-24, 24]) {
      g.add(rect(x - 0.7, 0, x + 0.7, 20, 46, basic('#1c1266')));
      g.add(rect(x - 8.35, 7.65, x + 8.35, 17.35, 45.85, basic(PAPER)));
      const scr = rect(x - 8, 8, x + 8, 17, 45.8, basic('#ffffff', screenTex));
      scr.rotation.y = Math.PI; // face the DJ's-view camera
      g.add(scr);
      brightScreens.push(brightCopy(scr));
    }

    this.buildStage(screenTex);

    const tex = [makeStripTexture(11), makeStripTexture(23), makeStripTexture(37)];
    this.seaFront = new SeaLayer(tex, this.seaUniforms);
    this.seaSide = new SeaLayer(tex, this.seaUniforms);
    this.seaFront.meshes.forEach((m) => g.add(m));
    this.seaSide.meshes.forEach((m) => g.add(m));
    this.layoutSea();
  }

  /** Re-place filler rows around the current crowd footprint. */
  layoutSea(): void {
    const front: number[][] = [], side: number[][] = [];
    if (!params.backdrop) { this.seaFront.set(front); this.seaSide.set(side); return; }
    let i = 0;
    for (let z = S.maxZ + 2.4; z < 160; z += 1.7 + z * 0.05, i++) front.push([-180, 360, z, (i * 11.3) % TILE, i % 3]);
    i = 0;
    for (let z = 1; z < S.maxZ + 3; z += 2.2, i++) {
      const xe = Math.min(17, Math.max(0.5, (S.K - z) / 0.55 + 0.8));
      side.push([xe, 90, z, xe, i % 3]);
      side.push([-xe - 90, 90, z, -xe, i % 3]);
    }
    this.seaFront.set(front);
    this.seaSide.set(side);
  }

  private buildFerris(): void {
    const grp = new THREE.Group();
    grp.position.set(-72, 34, 190);
    grp.add(new THREE.Mesh(new THREE.RingGeometry(27.5, 28.5, 64), basic('#ffc21a')));
    const spin = new THREE.Group();
    for (let i = 0; i < 10; i++) {
      const q = (i / 10) * Math.PI * 2;
      const spoke = new THREE.Mesh(new THREE.PlaneGeometry(28, 0.45), basic('#ff9ec4'));
      spoke.position.set(Math.cos(q) * 14, Math.sin(q) * 14, 0.05);
      spoke.rotation.z = q;
      spin.add(spoke);
      const cab = new THREE.Mesh(new THREE.CircleGeometry(2.2, 16), basic(CF[i % CF.length]));
      cab.position.set(Math.cos(q) * 28, Math.sin(q) * 28, -0.1);
      spin.add(cab);
    }
    grp.add(spin);
    this.ferrisSpin = spin;
    this.group.add(grp);
  }

  private buildFlags(): void {
    const list = [[-30, 36], [-14, 52], [4, 40], [18, 62], [33, 44], [-44, 70], [46, 78]];
    list.forEach(([x, z], i) => {
      this.group.add(rect(x - 0.08, 0, x + 0.08, 9, z, basic(PAPER)));
      const f = shape([[0, 0], [-1.6, -0.6], [-3.2, -1], [0, -2.1]], 0, basic(CF[i % CF.length]));
      f.position.set(x, 9, z - 0.02);
      this.group.add(f);
      this.flags.push(f);
    });
  }

  private buildStage(screenTex: THREE.Texture): void {
    const g = this.group;
    const peaks = [[-58, 0], [-44, 26], [-33, 13], [-22, 38], [-10, 21], [0, 47], [10, 21], [22, 38], [33, 13], [44, 26], [58, 0]];
    [0.8, 0.66, 0.52].forEach((l, i) => {
      const mat = basic(i === 0 ? '#26128f' : PALS[0][i - 1]);
      const mesh = shape(peaks.map(([x, y]) => [x * l, y * l]), -20 + i * 0.2, mat);
      g.add(mesh);
      this.mountains.push({ mesh, mat, i });
    });
    g.add(rect(-28, 1.7, 28, 33, -18, basic('#1c1266')));
    const cells: THREE.Matrix4[] = [];
    for (const s of [-1, 1]) {
      const x0 = s * 28;
      g.add(rect(x0, 2.6, x0 + s * 15.4, 20.2, -17.6, basic('#21137e')));
      const tri = basic(PALS[0][1]);
      this.triMats.push(tri);
      g.add(shape([[x0, 21], [x0 + s * 15.4, 21], [x0, 31]], -17.6, tri));
      for (let c = 0; c < 9; c++) for (let r = 0; r < 8; r++) {
        const x = x0 + s * (0.25 + c * 1.68), y = 3.1 + r * 2.15;
        cells.push(new THREE.Matrix4().makeTranslation(x + s * 0.71, y + 0.925, -17.5));
      }
    }
    this.panelCells = new THREE.InstancedMesh(new THREE.PlaneGeometry(1.42, 1.85), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), cells.length);
    cells.forEach((m, i) => { this.panelCells.setMatrixAt(i, m); this.panelCells.setColorAt(i, new THREE.Color('#21137e')); });
    g.add(this.panelCells);

    // Chasing LED rings around the main screen: 4 rings x 4 bars.
    this.rings = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 16);
    let ri = 0;
    for (let k = 3; k >= 0; k--) {
      const hw = 20.9 + k * 1.7, y0 = 3.1 - k * 0.2, y1 = 27.4 + k * 1.7, th = 0.7, z = -17.2 + (3 - k) * 0.01;
      const bars = [[-hw, y1, hw, y1 + th], [-hw, y0 - th, hw, y0], [-hw - th, y0 - th, -hw, y1 + th], [hw, y0 - th, hw + th, y1 + th]];
      for (const [a, b, c, d] of bars) {
        const m = new THREE.Matrix4().compose(new THREE.Vector3((a + c) / 2, (b + d) / 2, z), new THREE.Quaternion(), new THREE.Vector3(c - a, d - b, 1));
        this.rings.setMatrixAt(ri, m);
        this.rings.setColorAt(ri++, new THREE.Color('#2c1ca3'));
      }
    }
    g.add(this.rings);
    g.add(rect(-36, 33.2, 36, 34, -15, basic('#1c1266')));

    g.add(rect(-20.35, 3.65, 20.35, 26.85, -17.05, basic(PAPER)));
    const main = rect(-20, 4, 20, 26.5, -17, basic('#ffffff', screenTex));
    g.add(main);
    brightScreens.push(brightCopy(main));
    screenLit.map = screenTex;

    const deck = new THREE.Mesh(new THREE.PlaneGeometry(100, 15), basic('#3c28c4'));
    deck.rotation.x = -Math.PI / 2;
    deck.position.set(0, 1.7, -8.5);
    g.add(deck);
    g.add(rect(-50, 0, 50, 1.7, -1, basic('#ff3d81')));
    this.deckLeds = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 0.9), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 25);
    for (let i = 0; i < 25; i++) { this.deckLeds.setMatrixAt(i, new THREE.Matrix4().makeTranslation(-50 + i * 4 + 1, 0.85, -0.99)); this.deckLeds.setColorAt(i, new THREE.Color(PAPER)); }
    g.add(this.deckLeds);
    glows(this.panelCells, this.rings, this.deckLeds);

    for (const x of [-46, 46]) {
      g.add(rect(x - 3, 1.7, x + 3, 14, -4, basic('#1c1266')));
      for (const y of [4.6, 8, 11.4]) {
        const sp = new THREE.Group();
        sp.position.set(x, y, -3.98);
        const a = new THREE.Mesh(new THREE.CircleGeometry(1.45, 24), basic(PAPER));
        const b = new THREE.Mesh(new THREE.CircleGeometry(1.2, 24), basic('#ff3d81')); b.position.z = 0.005;
        const c = new THREE.Mesh(new THREE.CircleGeometry(0.45, 16), basic('#1c1266')); c.position.z = 0.01;
        sp.add(a, b, c);
        g.add(sp);
        this.speakers.push(sp);
      }
    }
  }

  update(camera: THREE.PerspectiveCamera, t: number, beat: number, W: number, H: number): void {
    // Horizon line for the sky gradient.
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const far = new THREE.Vector3(camera.position.x, 0, camera.position.z + (fwd.z < 0 ? -900 : 900)).project(camera);
    const hy = (1 - far.y) * 0.5 * H;
    this.sky.uniforms.uRes.value.set(W, H);
    this.sky.uniforms.uHy.value = Math.min(H * 1.4, Math.max(H * 0.05, hy));

    const back = fwd.z < 0;
    this.seaFront.visible = !back;
    this.seaUniforms.uBeat.value = beat;
    this.seaUniforms.uE.value = S.E;
    this.seaUniforms.uDim.value = S.dim;
    screenLit.opacity = Math.min(1, S.dim / 0.86);
    for (const m of brightScreens) m.visible = S.dim > 0.01;

    const bar = Math.floor(beat / 4), ph = ((beat % 1) + 1) % 1, kick = Math.pow(1 - ph, 3);
    const sect = ((Math.floor(bar / 8) % 4) + 4) % 4, pal = PALS[sect];
    for (const m of this.mountains) {
      const pop = 1 + kick * 0.035 * (m.i + 1) * (0.4 + S.E);
      m.mesh.scale.setScalar(pop);
      if (m.i > 0) m.mat.color.set(pal[m.i - 1]);
    }
    this.triMats.forEach((m) => m.color.set(pal[1]));

    const col = this.tmpColor;
    let idx = 0;
    const scr = S.screens.mode;
    const img = IMAGES[scr];
    const cols = scr === 'text' ? textColumns(S.screens.text) : null;
    const scroll = cols ? Math.floor(t * 7) % cols.length : 0;
    const two = S.ld.colors ?? pal;
    // Fixed pattern picks one of the show's four section styles; 'auto' follows the music.
    const pat = { meter: 0, stripes: 1, checker: 2, ripple: 3 }[scr as 'meter'] ?? sect;
    for (let s = 0; s < 2; s++) for (let c = 0; c < 9; c++) {
      const x = s === 0 ? 8 - c : c; // column counted from the screen's left edge
      const lvl = 0.2 + 0.8 * Math.abs(Math.sin(beat * Math.PI * 0.5 + c * 1.3)) * (0.4 + S.E * 0.7);
      for (let r = 0; r < 8; r++) {
        const y = 7 - r; // row counted from the top
        let on: string | null;
        if (scr === 'off' || S.ld.blackout) on = null; // blackout takes the pixel screens dark too
        else if (scr === 'solid') on = two[0];
        else if (img) { const ch = img[y][x]; on = ch === '#' ? two[0] : ch === '+' ? two[1] : null; }
        else if (cols) on = y < 7 && (cols[(scroll + x) % cols.length] >> y) & 1 ? two[0] : null;
        else {
          let lit: boolean;
          if (pat === 0) lit = r / 8 < lvl;
          else if (pat === 1) lit = (((c + r + Math.floor(beat * 2)) % 6) + 6) % 6 < 3;
          else if (pat === 2) lit = (c + r + Math.floor(beat)) % 2 === 0;
          else lit = Math.abs(Math.sin(Math.hypot(c - 4, r - 3.5) * 0.9 - beat * Math.PI * 0.5)) > 0.5;
          on = lit ? (pat === 0 && !S.ld.colors ? CF[c % CF.length] : two[(c + r) % 2]) : null;
        }
        if (on) {
          col.set(on);
          if (img || scr === 'solid') col.lerp(WHITE, kick * 0.35); // pictures pulse on the kick
        } else col.set('#21137e');
        this.panelCells.setColorAt(idx++, col);
      }
    }
    this.panelCells.instanceColor!.needsUpdate = true;

    /* Screen rings and the LED strip along the stage front are part of the light rig:
       same look, colors, intensity, strobe and blackout as the beams. */
    // The LEDs follow the chase; with no chase they follow the motion's own pattern.
    const L = S.ld, chase = activeChase(bar), look = chase === 'none' ? activeLook(bar) : chase;
    const [cA, cB] = L.colors ?? pal;
    const strobing = L.strobe && !reduceMotion;
    const power = L.blackout ? 0 : Math.min(1.2, L.intensity) * (1 - S.dim * 0.6);
    const lit = (on: string, level: number, off: string) => {
      const v = clamp01(level) * power;
      col.set(off).lerp(this.tmpColor2.set(on), Math.min(1, v));
      if (v > 1) col.lerp(WHITE, (v - 1) * 1.5);
    };
    const flash = strobeLevel(beat, L.strobeRate) * 0.8;
    let ri = 0;
    for (let k = 3; k >= 0; k--) {
      const r = 3 - k; // 0 = innermost ring
      let lv: number, c = r % 2 ? cB : cA;
      if (strobing) { lv = flash; c = PAPER; }
      else if (look === 'chase') lv = (r + Math.floor(beat * 2)) % 4 < 2 ? 1 : 0.05;
      else lv = chaseLevel(look, r / 3, beat, kick, t);
      lit(c, lv, '#2c1ca3');
      for (let b = 0; b < 4; b++) this.rings.setColorAt(ri++, col);
    }
    this.rings.instanceColor!.needsUpdate = true;

    for (let i = 0; i < 25; i++) {
      const u = i / 24;
      let lv: number, c = i % 2 ? cB : cA;
      if (strobing) { lv = flash; c = PAPER; }
      else if (look === 'chase') { // a bright head running left to right, twice a beat, with a tail
        const head = ((beat * 2) % 1 + 1) % 1, d = ((head - u) % 1 + 1) % 1;
        lv = d < 0.04 ? 1.25 : Math.max(0.06, 1 - d * 4); c = d < 0.04 ? PAPER : cA;
      } else {
        lv = chaseLevel(look, u, beat, kick, t);
        if (look === 'fan') c = u < 0.5 ? cA : cB; // split colors
        if (lv > 1.05) c = PAPER; // chase heads burn white
      }
      lit(c, lv, '#241a7a');
      this.deckLeds.setColorAt(i, col);
    }
    this.deckLeds.instanceColor!.needsUpdate = true;

    const pulse = 1 + 0.08 * kick;
    this.speakers.forEach((s) => s.scale.setScalar(pulse));
    this.ferrisSpin.rotation.z = t * 0.12;
    this.flags.forEach((f, i) => { f.scale.set(1 + Math.sin(t * 4 + i) * 0.08, 1 + Math.sin(t * 4 + i + 1) * 0.12, 1); });
  }
}
