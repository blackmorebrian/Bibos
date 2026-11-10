/**
 * Placeholder paper pieces, ported from bibos-prototype.html.
 * Every function draws in "paper units" with canvas y pointing down.
 * Recolorable regions are painted with `main` / `acc` so the atlas builder
 * can extract per-pixel recolor weights (see atlas.ts). Real art replaces
 * these later; the atlas layout stays.
 */
import { EYE_X, EYE_Y, type HeadId } from '@bibos/shared';

type G = CanvasRenderingContext2D;
type Path = (g: G) => void;

const PI = Math.PI;
const TAU = PI * 2;
export const PAPER = '#fffdf6';
export const INK = '#1a1358';
export const CONFETTI = ['#ff3d81', '#ffc21a', '#19d3c5', '#ffffff', '#7c5cff', '#ff7a2f'];

export function cut(g: G, path: Path, fill: string, edge = 0.09): void {
  g.beginPath();
  path(g);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = PAPER;
  g.lineWidth = edge;
  g.stroke();
  g.fillStyle = fill;
  g.fill();
}
const circ = (x: number, y: number, r: number): Path => (g) => {
  g.moveTo(x + r, y);
  g.arc(x, y, r, 0, TAU);
};
const ell = (x: number, y: number, a: number, b: number): Path => (g) => {
  g.moveTo(x + a, y);
  g.ellipse(x, y, a, b, 0, 0, TAU);
};
const rr = (x: number, y: number, w: number, h: number, r: number): Path => (g) => g.roundRect(x, y, w, h, r);
function fill(g: G, path: Path, c: string): void {
  g.beginPath();
  path(g);
  g.fillStyle = c;
  g.fill();
}
function line(g: G, c: string, w: number, draw: Path): void {
  g.beginPath();
  draw(g);
  g.strokeStyle = c;
  g.lineWidth = w;
  g.lineCap = 'round';
  g.stroke();
}
function eyes(g: G, dx: number, y: number, r: number): void {
  fill(g, circ(-dx, y, r), '#fff');
  fill(g, circ(dx, y, r), '#fff');
  fill(g, circ(-dx + r * 0.2, y + r * 0.1, r * 0.55), INK);
  fill(g, circ(dx - r * 0.2, y + r * 0.1, r * 0.55), INK);
}

type HeadFn = (g: G, c: string, back: boolean) => void;
export const HEAD_ART: Record<HeadId, HeadFn> = {
  cat(g, c, b) {
    const ear = (s: number): Path => (x) => {
      x.moveTo(s * 0.44, -0.1);
      x.lineTo(s * 0.47, -0.62);
      x.lineTo(s * 0.08, -0.32);
      x.closePath();
    };
    cut(g, ear(-1), c);
    cut(g, ear(1), c);
    fill(g, (x) => {
      for (const s of [-1, 1]) {
        x.moveTo(s * 0.38, -0.2);
        x.lineTo(s * 0.41, -0.48);
        x.lineTo(s * 0.18, -0.31);
        x.closePath();
      }
    }, '#ffb3cf');
    cut(g, ell(0, 0.03, 0.5, 0.42), c);
    line(g, 'rgba(255,255,255,.6)', 0.05, (x) => {
      x.moveTo(0, -0.36); x.lineTo(0, -0.2);
      x.moveTo(-0.14, -0.33); x.lineTo(-0.12, -0.2);
      x.moveTo(0.14, -0.33); x.lineTo(0.12, -0.2);
    });
    if (b) return;
    fill(g, ell(-0.21, -0.03, 0.12, 0.13), '#fff');
    fill(g, ell(0.21, -0.03, 0.12, 0.13), '#fff');
    fill(g, ell(-0.21, -0.03, 0.05, 0.11), INK);
    fill(g, ell(0.21, -0.03, 0.05, 0.11), INK);
    fill(g, (x) => { x.moveTo(-0.05, 0.13); x.lineTo(0.05, 0.13); x.lineTo(0, 0.19); x.closePath(); }, '#ff7aa8');
    line(g, INK, 0.035, (x) => {
      x.moveTo(-0.13, 0.21); x.quadraticCurveTo(-0.06, 0.3, 0, 0.19); x.quadraticCurveTo(0.06, 0.3, 0.13, 0.21);
    });
    line(g, INK, 0.022, (x) => {
      for (const s of [-1, 1]) { x.moveTo(s * 0.32, 0.09); x.lineTo(s * 0.64, 0.02); x.moveTo(s * 0.32, 0.16); x.lineTo(s * 0.64, 0.2); }
    });
  },
  dog(g, c, b) {
    const ear = (s: number): Path => (x) => {
      x.moveTo(s * 0.34, -0.3);
      x.quadraticCurveTo(s * 0.78, -0.24, s * 0.72, 0.26);
      x.quadraticCurveTo(s * 0.62, 0.48, s * 0.46, 0.22);
      x.quadraticCurveTo(s * 0.42, -0.05, s * 0.3, -0.1);
      x.closePath();
    };
    cut(g, ear(-1), '#6b3f2a');
    cut(g, ear(1), '#6b3f2a');
    cut(g, ell(0, 0, 0.47, 0.44), c);
    if (b) return;
    fill(g, ell(0.2, -0.1, 0.19, 0.19), 'rgba(255,255,255,.38)');
    eyes(g, 0.19, -0.1, 0.11);
    fill(g, ell(0, 0.21, 0.26, 0.18), '#fff6d8');
    fill(g, ell(0, 0.11, 0.1, 0.07), INK);
    line(g, INK, 0.035, (x) => {
      x.moveTo(0, 0.18); x.lineTo(0, 0.25);
      x.moveTo(-0.13, 0.26); x.quadraticCurveTo(-0.06, 0.33, 0, 0.25); x.quadraticCurveTo(0.06, 0.33, 0.13, 0.26);
    });
    fill(g, rr(-0.06, 0.29, 0.12, 0.16, 0.06), '#ff7aa8');
  },
  frog(g, c, b) {
    cut(g, circ(-0.28, -0.34, 0.19), c);
    cut(g, circ(0.28, -0.34, 0.19), c);
    cut(g, ell(0, 0.03, 0.58, 0.42), c);
    fill(g, circ(-0.28, -0.34, 0.16), c);
    fill(g, circ(0.28, -0.34, 0.16), c);
    if (b) return;
    eyes(g, 0.28, -0.36, 0.13);
    line(g, INK, 0.05, (x) => { x.moveTo(-0.36, 0.08); x.quadraticCurveTo(0, 0.36, 0.36, 0.08); });
    fill(g, ell(-0.42, 0.1, 0.08, 0.05), '#ff9ec4');
    fill(g, ell(0.42, 0.1, 0.08, 0.05), '#ff9ec4');
  },
  moth(g, c, b) {
    line(g, INK, 0.04, (x) => {
      x.moveTo(-0.12, -0.36); x.quadraticCurveTo(-0.3, -0.75, -0.55, -0.72);
      x.moveTo(0.12, -0.36); x.quadraticCurveTo(0.3, -0.75, 0.55, -0.72);
      for (let i = 0; i < 4; i++) {
        const t = 0.45 + i * 0.17;
        x.moveTo(-0.2 - t * 0.45, -0.5 - t * 0.3); x.lineTo(-0.25 - t * 0.45, -0.66 - t * 0.3);
        x.moveTo(0.2 + t * 0.45, -0.5 - t * 0.3); x.lineTo(0.25 + t * 0.45, -0.66 - t * 0.3);
      }
    });
    cut(g, ell(0, 0.32, 0.52, 0.2), '#fff6d8');
    cut(g, circ(0, -0.02, 0.43), c);
    if (b) return;
    fill(g, ell(-0.2, -0.05, 0.15, 0.19), INK);
    fill(g, ell(0.2, -0.05, 0.15, 0.19), INK);
    fill(g, circ(-0.15, -0.12, 0.05), '#fff');
    fill(g, circ(0.25, -0.12, 0.05), '#fff');
    line(g, INK, 0.04, (x) => { x.moveTo(-0.07, 0.22); x.quadraticCurveTo(0, 0.28, 0.07, 0.22); });
  },
  cactus(g, c, b) {
    const arms: Path = (x) => {
      x.moveTo(-0.28, 0.14); x.lineTo(-0.56, 0.14); x.lineTo(-0.56, -0.18);
      x.moveTo(0.28, 0.02); x.lineTo(0.56, 0.02); x.lineTo(0.56, -0.3);
    };
    line(g, PAPER, 0.3, arms);
    line(g, c, 0.21, arms);
    cut(g, rr(-0.33, -0.5, 0.66, 1.02, 0.33), c);
    line(g, 'rgba(255,255,255,.55)', 0.03, (x) => {
      for (const [a, e] of [[-0.2, -0.28], [0.2, -0.3], [-0.22, 0.32], [0.22, 0.34], [0, 0.42], [0, -0.4]]) { x.moveTo(a - 0.04, e); x.lineTo(a + 0.04, e); }
    });
    if (b) return;
    eyes(g, 0.14, -0.1, 0.1);
    line(g, INK, 0.045, (x) => { x.moveTo(-0.1, 0.12); x.quadraticCurveTo(0, 0.22, 0.1, 0.12); });
  },
  ghost(g, c, b) {
    cut(g, (x) => {
      x.moveTo(-0.46, 0.46); x.lineTo(-0.46, -0.04); x.arc(0, -0.04, 0.46, PI, 0); x.lineTo(0.46, 0.46);
      x.quadraticCurveTo(0.345, 0.3, 0.23, 0.46); x.quadraticCurveTo(0.115, 0.3, 0, 0.46);
      x.quadraticCurveTo(-0.115, 0.3, -0.23, 0.46); x.quadraticCurveTo(-0.345, 0.3, -0.46, 0.46); x.closePath();
    }, c);
    if (b) return;
    fill(g, ell(-0.17, -0.08, 0.09, 0.14), INK);
    fill(g, ell(0.17, -0.08, 0.09, 0.14), INK);
    fill(g, ell(0, 0.14, 0.07, 0.09), INK);
    fill(g, ell(-0.32, 0.08, 0.08, 0.05), 'rgba(255,255,255,.65)');
    fill(g, ell(0.32, 0.08, 0.08, 0.05), 'rgba(255,255,255,.65)');
  },
  toaster(g, c, b) {
    cut(g, rr(-0.3, -0.54, 0.26, 0.4, 0.07), '#f0b76a');
    cut(g, rr(0.04, -0.48, 0.26, 0.34, 0.07), '#f0b76a');
    cut(g, rr(-0.54, -0.26, 1.08, 0.72, 0.17), c);
    fill(g, rr(-0.54, 0.2, 1.08, 0.08, 0), 'rgba(255,255,255,.5)');
    cut(g, rr(0.54, -0.1, 0.1, 0.26, 0.04), INK, 0.05);
    if (b) return;
    eyes(g, 0.2, -0.04, 0.12);
    line(g, INK, 0.05, (x) => { x.moveTo(-0.12, 0.13); x.lineTo(0.12, 0.13); });
  },
  gremlin(g, c, b) {
    const e = (s: number): Path => (x) => { x.moveTo(s * 0.32, -0.24); x.lineTo(s * 0.93, -0.48); x.lineTo(s * 0.4, 0.14); x.closePath(); };
    cut(g, e(-1), c);
    cut(g, e(1), c);
    fill(g, (x) => {
      x.moveTo(-0.42, -0.16); x.lineTo(-0.76, -0.36); x.lineTo(-0.44, 0.04); x.closePath();
      x.moveTo(0.42, -0.16); x.lineTo(0.76, -0.36); x.lineTo(0.44, 0.04); x.closePath();
    }, 'rgba(255,255,255,.4)');
    cut(g, ell(0, 0.02, 0.48, 0.4), c);
    if (b) return;
    fill(g, ell(-0.2, -0.05, 0.13, 0.1), '#ffe66b');
    fill(g, ell(0.2, -0.05, 0.13, 0.1), '#ffe66b');
    fill(g, ell(-0.2, -0.05, 0.035, 0.09), INK);
    fill(g, ell(0.2, -0.05, 0.035, 0.09), INK);
    line(g, INK, 0.04, (x) => { x.moveTo(-0.2, 0.2); x.quadraticCurveTo(0, 0.27, 0.2, 0.2); });
    fill(g, (x) => { x.moveTo(0.06, 0.23); x.lineTo(0.17, 0.2); x.lineTo(0.12, 0.33); x.closePath(); }, '#fff');
  },
};

type HatFn = (g: G, back: boolean) => void;
export const HAT_ART: Record<string, HatFn> = {
  flowers(g) {
    const c = ['#ff5fa8', '#ffd23f', '#35c8ff', '#fffdf6', '#b983ff'];
    for (let i = 0; i < 5; i++) {
      const x = -0.36 + i * 0.18, y = 0.02 - Math.sin(((i + 0.5) / 5) * PI) * 0.13;
      cut(g, circ(x, y, 0.1), c[i], 0.05);
      fill(g, circ(x, y, 0.04), '#ff7a2f');
    }
  },
  bow(g) {
    cut(g, (x) => { x.moveTo(0, -0.08); x.lineTo(-0.36, -0.3); x.lineTo(-0.36, 0.14); x.closePath(); }, '#ff5fa8');
    cut(g, (x) => { x.moveTo(0, -0.08); x.lineTo(0.36, -0.3); x.lineTo(0.36, 0.14); x.closePath(); }, '#ff5fa8');
    cut(g, circ(0, -0.08, 0.09), '#ffd23f');
  },
  party(g) {
    cut(g, (x) => { x.moveTo(-0.25, 0.08); x.lineTo(0, -0.62); x.lineTo(0.25, 0.08); x.closePath(); }, '#ff3d81');
    fill(g, (x) => { x.moveTo(-0.16, -0.17); x.lineTo(0.16, -0.17); x.lineTo(0.08, -0.38); x.lineTo(-0.08, -0.38); x.closePath(); }, '#ffc21a');
    cut(g, circ(0, -0.64, 0.09), '#19d3c5');
  },
  bucket(g) {
    cut(g, (x) => { x.moveTo(-0.54, 0.12); x.lineTo(-0.3, -0.32); x.lineTo(0.3, -0.32); x.lineTo(0.54, 0.12); x.closePath(); }, '#ffc21a');
    fill(g, rr(-0.4, -0.14, 0.8, 0.1, 0), '#ff3d81');
  },
  crown(g) {
    cut(g, (x) => {
      x.moveTo(-0.34, 0.1); x.lineTo(-0.4, -0.34); x.lineTo(-0.18, -0.1); x.lineTo(0, -0.44);
      x.lineTo(0.18, -0.1); x.lineTo(0.4, -0.34); x.lineTo(0.34, 0.1); x.closePath();
    }, '#ffc21a');
    fill(g, circ(0, -0.08, 0.06), '#ff3d81');
  },
  phones(g) {
    const band: Path = (x) => { x.moveTo(-0.5, 0.42); x.quadraticCurveTo(-0.5, -0.28, 0, -0.28); x.quadraticCurveTo(0.5, -0.28, 0.5, 0.42); };
    line(g, PAPER, 0.17, band);
    line(g, INK, 0.1, band);
    cut(g, rr(-0.66, 0.26, 0.24, 0.44, 0.1), '#ff3d81');
    cut(g, rr(0.42, 0.26, 0.24, 0.44, 0.1), '#ff3d81');
  },
  mohawk(g) {
    cut(g, (x) => {
      x.moveTo(-0.34, 0.12);
      for (let i = 0; i < 5; i++) { const a = -0.34 + 0.17 * i; x.lineTo(a + 0.05, -0.48 + Math.abs(i - 2) * 0.09); x.lineTo(a + 0.17, 0.02); }
      x.lineTo(0.34, 0.12); x.closePath();
    }, '#ff2f6b');
  },
  swoop(g, b) {
    if (b) { cut(g, rr(-0.42, -0.12, 0.84, 0.6, 0.3), '#241a5e'); return; }
    cut(g, (x) => {
      x.moveTo(0.42, 0.2); x.quadraticCurveTo(0.46, -0.2, 0.05, -0.2); x.quadraticCurveTo(-0.46, -0.16, -0.46, 0.56);
      x.quadraticCurveTo(-0.26, 0.45, -0.16, 0.38); x.quadraticCurveTo(0.15, 0.14, 0.42, 0.2); x.closePath();
    }, '#241a5e');
  },
  horns(g) {
    const h = (s: number): Path => (x) => { x.moveTo(s * 0.16, 0.1); x.quadraticCurveTo(s * 0.32, -0.14, s * 0.5, -0.46); x.quadraticCurveTo(s * 0.52, -0.04, s * 0.38, 0.14); x.closePath(); };
    cut(g, h(-1), '#1a1358');
    cut(g, h(1), '#1a1358');
  },
};

type ExtraFn = (g: G, head: HeadId, back: boolean) => void;
export const EXTRA_ART: Record<string, ExtraFn> = {
  none() {},
  hearts(g, head, b) {
    if (b) return;
    const y = EYE_Y[head] + 0.24, x0 = EYE_X[head] + 0.12;
    for (const s of [-1, 1]) {
      const x = s * x0;
      fill(g, (c) => { c.moveTo(x, y + 0.09); c.bezierCurveTo(x - 0.15, y - 0.02, x - 0.07, y - 0.11, x, y - 0.03); c.bezierCurveTo(x + 0.07, y - 0.11, x + 0.15, y - 0.02, x, y + 0.09); }, '#ff3d81');
    }
  },
  kandi(g) {
    for (let i = 0; i < 9; i++) { const x = -0.4 + i * 0.1, y = 0.46 + Math.sin((i / 8) * PI) * 0.1; fill(g, circ(x, y, 0.06), CONFETTI[i % CONFETTI.length]); }
  },
  shades(g, head, b) {
    if (b) return;
    const y = EYE_Y[head], x = EYE_X[head];
    cut(g, rr(-x - 0.16, y - 0.11, 0.32, 0.22, 0.07), INK, 0.05);
    cut(g, rr(x - 0.16, y - 0.11, 0.32, 0.22, 0.07), INK, 0.05);
    line(g, INK, 0.05, (c) => { c.moveTo(-x + 0.16, y - 0.03); c.lineTo(x - 0.16, y - 0.03); });
    line(g, '#35c8ff', 0.03, (c) => { c.moveTo(-x - 0.08, y - 0.05); c.lineTo(-x + 0.02, y - 0.05); c.moveTo(x - 0.08, y - 0.05); c.lineTo(x + 0.02, y - 0.05); });
  },
  paint(g, head, b) {
    if (b) return;
    const y = EYE_Y[head] + 0.15, x = EYE_X[head];
    line(g, INK, 0.05, (c) => { for (const s of [-1, 1]) for (const d of [-0.06, 0.06]) { c.moveTo(s * x + d, y); c.lineTo(s * x + d, y + 0.2); } });
  },
  spikes(g) {
    cut(g, rr(-0.4, 0.42, 0.8, 0.13, 0.05), INK, 0.05);
    fill(g, (c) => { for (let i = 0; i < 5; i++) { const x = -0.3 + i * 0.15; c.moveTo(x - 0.05, 0.45); c.lineTo(x, 0.31); c.lineTo(x + 0.05, 0.45); c.closePath(); } }, '#e6e4ff');
  },
};

/** Torso + legs. `main` = shirt, `acc` = pattern accent. */
export function bodyArt(g: G, pattern: number, back: boolean, main: string, acc: string): void {
  const torso = rr(-0.32, -0.98, 0.64, 0.67, 0.16);
  cut(g, rr(-0.24, -0.38, 0.2, 0.36, 0.06), '#2a2277');
  cut(g, rr(0.04, -0.38, 0.2, 0.36, 0.06), '#2a2277');
  cut(g, ell(-0.17, -0.02, 0.15, 0.07), PAPER);
  cut(g, ell(0.17, -0.02, 0.15, 0.07), PAPER);
  cut(g, torso, main);
  g.save();
  g.beginPath();
  torso(g);
  g.clip();
  g.globalAlpha = 0.75;
  g.fillStyle = acc;
  if (pattern === 1) { g.fillRect(-0.4, -0.84, 0.8, 0.09); g.fillRect(-0.4, -0.66, 0.8, 0.09); g.fillRect(-0.4, -0.48, 0.8, 0.09); }
  if (pattern === 2 && !back) {
    fill(g, (x) => { x.moveTo(0.06, -0.9); x.lineTo(-0.13, -0.63); x.lineTo(-0.01, -0.63); x.lineTo(-0.07, -0.42); x.lineTo(0.14, -0.7); x.lineTo(0.02, -0.7); x.closePath(); }, acc);
  }
  g.restore();
}

/** Vertical sleeve bar filling the cell: white edge strips, `main` fill. */
export function sleeveArt(g: G, main: string): void {
  g.fillStyle = PAPER;
  g.fillRect(-0.5, -0.5, 1, 1);
  g.fillStyle = main;
  g.fillRect(-0.5 * (0.15 / 0.22), -0.5, 0.15 / 0.22, 1);
}
/** Round hand / shoulder knob: white edge ring, `main` fill. Unit circle cell. */
export function knobArt(g: G, main: string): void {
  fill(g, circ(0, 0, 0.5), PAPER);
  fill(g, circ(0, 0, 0.5 * (0.085 / 0.115)), main);
}
export function shadowArt(g: G): void {
  fill(g, ell(0, 0, 0.5, 0.5), 'rgba(10,6,50,.32)');
}
export function glowArt(g: G): void {
  const r = g.createRadialGradient(0, 0, 0, 0, 0, 0.5);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.25, 'rgba(255,255,255,.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(-0.5, -0.5, 1, 1);
}
/** Props are drawn relative to the hand at (0,0). */
export function phoneArt(g: G, back: boolean): void {
  cut(g, rr(-0.14, -0.5, 0.28, 0.5, 0.05), back ? '#bfe9ff' : '#241d68', 0.06);
  if (back) { fill(g, rr(-0.1, -0.32, 0.2, 0.1, 0.01), '#ff3d81'); fill(g, rr(-0.1, -0.2, 0.2, 0.05, 0.01), '#ffc21a'); }
  else fill(g, circ(0.07, -0.43, 0.035), '#fff');
}
export function lighterArt(g: G): void {
  const fy = -0.26;
  cut(g, rr(-0.07, fy, 0.14, 0.22, 0.03), '#ef4545', 0.05);
  fill(g, (x) => { x.moveTo(0, fy - 0.34); x.quadraticCurveTo(0.15, fy - 0.08, 0, fy); x.quadraticCurveTo(-0.15, fy - 0.08, 0, fy - 0.34); }, '#ffb01f');
  fill(g, (x) => { x.moveTo(0, fy - 0.18); x.quadraticCurveTo(0.07, fy - 0.04, 0, fy); x.quadraticCurveTo(-0.07, fy - 0.04, 0, fy - 0.18); }, '#fff4c2');
}
/** Flag: `main` = cloth (body color), `acc` = badge (shirt color). Hand at (0,0), pole top at y=-1.7. */
export function flagArt(g: G, main: string, acc: string): void {
  const top = -1.7;
  line(g, PAPER, 0.11, (x) => { x.moveTo(0, 0.2); x.lineTo(0, top); });
  line(g, '#241d68', 0.06, (x) => { x.moveTo(0, 0.2); x.lineTo(0, top); });
  cut(g, (x) => {
    x.moveTo(0, top);
    for (let k = 1; k <= 6; k++) { const q = k / 6; x.lineTo(q * 1.25, top + Math.sin(q * 4) * 0.06 * q); }
    for (let k = 6; k >= 1; k--) { const q = k / 6; x.lineTo(q * 1.25, top + 0.72 + Math.sin(q * 4) * 0.06 * q); }
    x.lineTo(0, top + 0.72);
    x.closePath();
  }, main, 0.06);
  fill(g, circ(0.62, top + 0.36, 0.16), acc);
}

/* Placeholder emotes (fixed colors). Unit-ish art centered at 0. */
export const EMOTE_ART: Record<string, (g: G) => void> = {
  heart(g) { cut(g, (x) => { x.moveTo(0, 0.42); x.bezierCurveTo(-0.7, -0.02, -0.4, -0.62, 0, -0.2); x.bezierCurveTo(0.4, -0.62, 0.7, -0.02, 0, 0.42); }, '#ff3d81', 0.1); },
  fire(g) {
    const p: Path = (x) => { x.moveTo(0, -0.52); x.bezierCurveTo(0.12, -0.24, 0.46, -0.1, 0.4, 0.16); x.quadraticCurveTo(0.3, 0.5, 0, 0.5); x.quadraticCurveTo(-0.3, 0.5, -0.4, 0.16); x.bezierCurveTo(-0.46, -0.1, -0.12, -0.24, 0, -0.52); };
    cut(g, p, '#ff7a2f', 0.1);
    g.save(); g.translate(0, 0.17); g.scale(0.56, 0.56); fill(g, p, '#ffc21a'); g.restore();
  },
  skull(g) {
    cut(g, circ(0, -0.08, 0.38), '#e8e4ff', 0.1);
    cut(g, rr(-0.2, 0.14, 0.4, 0.3, 0.07), '#e8e4ff', 0.1);
    fill(g, circ(0, -0.08, 0.36), '#e8e4ff');
    fill(g, ell(-0.15, -0.08, 0.1, 0.12), INK); fill(g, ell(0.15, -0.08, 0.1, 0.12), INK); fill(g, ell(0, 0.1, 0.04, 0.05), INK);
    line(g, INK, 0.035, (x) => { x.moveTo(-0.08, 0.26); x.lineTo(-0.08, 0.4); x.moveTo(0.08, 0.26); x.lineTo(0.08, 0.4); });
  },
  star(g) {
    cut(g, (x) => { for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.21 : 0.5, q = -PI / 2 + (i / 10) * TAU; const px = Math.cos(q) * r, py = Math.sin(q) * r; if (i) x.lineTo(px, py); else x.moveTo(px, py); } x.closePath(); }, '#ffc21a', 0.1);
  },
  laugh(g) {
    cut(g, circ(0, 0, 0.42), '#ffd23f', 0.1);
    line(g, INK, 0.05, (x) => { x.moveTo(-0.26, -0.08); x.quadraticCurveTo(-0.16, -0.25, -0.06, -0.08); x.moveTo(0.06, -0.08); x.quadraticCurveTo(0.16, -0.25, 0.26, -0.08); });
    fill(g, (x) => { x.moveTo(-0.25, 0.06); x.quadraticCurveTo(0, 0.46, 0.25, 0.06); x.closePath(); }, INK);
    fill(g, ell(-0.44, 0.03, 0.07, 0.11), '#35c8ff'); fill(g, ell(0.44, 0.03, 0.07, 0.11), '#35c8ff');
  },
  w(g) {
    cut(g, rr(-0.44, -0.44, 0.88, 0.88, 0.16), '#14b8a6', 0.1);
    line(g, PAPER, 0.13, (x) => { x.moveTo(-0.3, -0.2); x.lineTo(-0.15, 0.24); x.lineTo(0, -0.06); x.lineTo(0.15, 0.24); x.lineTo(0.3, -0.2); });
  },
};
