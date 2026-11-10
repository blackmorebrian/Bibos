/**
 * Builds the Bibo texture atlas from paper pieces.
 *
 * Two textures share one layout:
 *  - base:    RGBA, premultiplied, with every recolorable region painted black
 *  - weights: R = weight of the piece's "main" color, G = weight of its "accent" color
 * The shader reconstructs any color combo as  base.rgb + w.r*main + w.g*accent.
 * Weights come from rendering each piece three times with black/white keys, so
 * antialiased edges and translucent overlays recolor exactly.
 */
import { HEADS, HATS, EXTRAS, PLACEHOLDER_EMOTES, type HeadId } from '@bibos/shared';
import {
  HEAD_ART, HAT_ART, EXTRA_ART, EMOTE_ART, bodyArt, sleeveArt, knobArt, shadowArt, glowArt, phoneArt, lighterArt, flagArt,
} from './pieces';

/** Square rect of each piece kind in paper units (canvas y-down): [x0, y0, size]. */
export const RECT = {
  head: [-1, -1.25, 2],
  hat: [-0.85, -0.95, 1.7],
  body: [-0.7, -1.25, 1.4],
  unit: [-0.5, -0.5, 1],
  phone: [-0.36, -0.62, 0.72],
  lighter: [-0.36, -0.64, 0.72],
  flag: [-0.2, -1.85, 2.1],
  emote: [-0.6, -0.6, 1.2],
} as const satisfies Record<string, readonly [number, number, number]>;
export type RectKind = keyof typeof RECT;

type Draw = (g: CanvasRenderingContext2D, main: string, acc: string) => void;
interface PieceDef { key: string; rect: RectKind; recolor: boolean; draw: Draw }

/** Extras that are visible from behind. Others map to the plain back head. */
const BACK_EXTRAS = ['none', 'kandi', 'spikes'];

function pieceList(): PieceDef[] {
  const list: PieceDef[] = [];
  for (const h of HEADS) {
    for (const e of EXTRAS) {
      list.push({ key: `head:${h}:${e}`, rect: 'head', recolor: true, draw: (g, m) => { HEAD_ART[h](g, m, false); EXTRA_ART[e](g, h, false); } });
    }
    for (const e of BACK_EXTRAS) {
      list.push({ key: `headb:${h}:${e}`, rect: 'head', recolor: true, draw: (g, m) => { HEAD_ART[h](g, m, true); EXTRA_ART[e](g, h, true); } });
    }
  }
  for (const hat of HATS) {
    if (hat === 'none') continue;
    list.push({ key: `hat:${hat}`, rect: 'hat', recolor: false, draw: (g) => HAT_ART[hat](g, false) });
  }
  list.push({ key: 'hatb:swoop', rect: 'hat', recolor: false, draw: (g) => HAT_ART.swoop(g, true) });
  for (let p = 0; p < 3; p++) {
    list.push({ key: `body:${p}`, rect: 'body', recolor: true, draw: (g, m, a) => bodyArt(g, p, false, m, a) });
    list.push({ key: `bodyb:${p}`, rect: 'body', recolor: true, draw: (g, m, a) => bodyArt(g, p, true, m, a) });
  }
  list.push({ key: 'sleeve', rect: 'unit', recolor: true, draw: (g, m) => sleeveArt(g, m) });
  list.push({ key: 'knob', rect: 'unit', recolor: true, draw: (g, m) => knobArt(g, m) });
  list.push({ key: 'shadow', rect: 'unit', recolor: false, draw: (g) => shadowArt(g) });
  list.push({ key: 'glow', rect: 'unit', recolor: false, draw: (g) => glowArt(g) });
  list.push({ key: 'phone', rect: 'phone', recolor: false, draw: (g) => phoneArt(g, false) });
  list.push({ key: 'phoneb', rect: 'phone', recolor: false, draw: (g) => phoneArt(g, true) });
  list.push({ key: 'lighter', rect: 'lighter', recolor: false, draw: (g) => lighterArt(g) });
  list.push({ key: 'flag', rect: 'flag', recolor: true, draw: (g, m, a) => flagArt(g, m, a) });
  for (const e of PLACEHOLDER_EMOTES) list.push({ key: `emote:${e}`, rect: 'emote', recolor: false, draw: (g) => EMOTE_ART[e](g) });
  return list;
}

export interface Atlas {
  width: number;
  height: number;
  cellPx: number;
  pad: number;
  cols: number;
  base: Uint8Array;
  weights: Uint8Array;
  cells: Map<string, number>;
  buildMs: number;
}

export function buildAtlas(cellPx = 256): Atlas {
  const t0 = performance.now();
  const pieces = pieceList();
  const cols = 12;
  const rows = Math.ceil(pieces.length / cols);
  const width = cols * cellPx, height = rows * cellPx;
  const pad = Math.max(2, Math.round(cellPx / 32));
  const base = new Uint8Array(width * height * 4);
  const weights = new Uint8Array(width * height * 4);
  const cells = new Map<string, number>();

  const cv = document.createElement('canvas');
  cv.width = cv.height = cellPx;
  const g = cv.getContext('2d', { willReadFrequently: true })!;
  const inner = cellPx - pad * 2;

  const render = (p: PieceDef, main: string, acc: string): Uint8ClampedArray => {
    const [x0, y0, size] = RECT[p.rect];
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cellPx, cellPx);
    g.globalAlpha = 1;
    const s = inner / size;
    g.setTransform(s, 0, 0, s, pad - x0 * s, pad - y0 * s);
    p.draw(g, main, acc);
    return g.getImageData(0, 0, cellPx, cellPx).data;
  };

  pieces.forEach((p, idx) => {
    cells.set(p.key, idx);
    const cx = (idx % cols) * cellPx, cy = Math.floor(idx / cols) * cellPx;
    const k = render(p, '#000000', '#000000');
    const a = p.recolor ? render(p, '#ffffff', '#000000') : null;
    const b = p.recolor ? render(p, '#000000', '#ffffff') : null;
    for (let y = 0; y < cellPx; y++) {
      for (let x = 0; x < cellPx; x++) {
        const i = (y * cellPx + x) * 4;
        const o = ((cy + y) * width + cx + x) * 4;
        const al = k[i + 3] / 255;
        const pr = k[i] * al, pg = k[i + 1] * al, pb = k[i + 2] * al;
        base[o] = pr; base[o + 1] = pg; base[o + 2] = pb; base[o + 3] = k[i + 3];
        if (a && b) {
          const aa = a[i + 3] / 255, ba = b[i + 3] / 255;
          const wa = ((a[i] * aa + a[i + 1] * aa + a[i + 2] * aa) - (pr + pg + pb)) / 3;
          const wb = ((b[i] * ba + b[i + 1] * ba + b[i + 2] * ba) - (pr + pg + pb)) / 3;
          weights[o] = wa < 0 ? 0 : wa;
          weights[o + 1] = wb < 0 ? 0 : wb;
        }
      }
    }
  });
  return { width, height, cellPx, pad, cols, base, weights, cells, buildMs: performance.now() - t0 };
}

/** Atlas cell lookups for a look. -1 means "draw nothing". */
export function headCell(atlas: Atlas, head: number, extra: number, back: boolean): number {
  const h: HeadId = HEADS[head];
  const e = EXTRAS[extra];
  if (!back) return atlas.cells.get(`head:${h}:${e}`)!;
  return atlas.cells.get(`headb:${h}:${BACK_EXTRAS.includes(e) ? e : 'none'}`)!;
}
export function hatCell(atlas: Atlas, hat: number, back: boolean): number {
  const name = HATS[hat];
  if (name === 'none') return -1;
  if (back && name === 'swoop') return atlas.cells.get('hatb:swoop')!;
  return atlas.cells.get(`hat:${name}`)!;
}
export function bodyCell(atlas: Atlas, pattern: number, back: boolean): number {
  return atlas.cells.get(`${back ? 'bodyb' : 'body'}:${pattern}`)!;
}
