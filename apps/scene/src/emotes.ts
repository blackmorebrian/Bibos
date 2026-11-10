/**
 * Twitch emote images, loaded on demand from Twitch's CDN (it sends
 * Access-Control-Allow-Origin: *) and packed into one texture with a white
 * paper-sticker outline so they match the cutout style. 64 slots, LRU.
 */
import * as THREE from 'three';
import { canvasTexture } from './sprites';

const GRID = 8, CELL = 128, PAD = 7;

interface Slot { i: number; used: number; state: 'loading' | 'ready' | 'failed' }

export class EmoteSheet {
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private slots = new Map<string, Slot>();
  private tmp = document.createElement('canvas');

  constructor() {
    this.texture = canvasTexture(GRID * CELL, GRID * CELL, () => {});
    this.g = (this.texture.image as HTMLCanvasElement).getContext('2d')!;
    this.tmp.width = this.tmp.height = CELL;
  }

  /** UV rect for a Twitch emote id once loaded; null while loading or if it failed. */
  uv(id: string, now: number): number[] | null {
    let s = this.slots.get(id);
    if (!s) s = this.load(id, now);
    if (!s || s.state !== 'ready') return null;
    s.used = now;
    const c = s.i % GRID, r = Math.floor(s.i / GRID);
    return [c / GRID, r / GRID, (c + 1) / GRID, (r + 1) / GRID];
  }

  private load(id: string, now: number): Slot | undefined {
    let i = this.slots.size;
    if (i >= GRID * GRID) {
      // Evict the least recently used finished slot.
      let oldK = '', old: Slot | null = null;
      for (const [k, s] of this.slots) if (s.state !== 'loading' && (!old || s.used < old.used)) { old = s; oldK = k; }
      if (!old) return undefined;
      this.slots.delete(oldK);
      i = old.i;
    }
    const slot: Slot = { i, used: now, state: 'loading' };
    this.slots.set(id, slot);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { if (this.slots.get(id) === slot) { this.draw(slot.i, img); slot.state = 'ready'; } };
    img.onerror = () => { slot.state = 'failed'; };
    // "static" gives a still frame for animated emotes.
    img.src = `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/static/dark/3.0`;
    return slot;
  }

  private draw(i: number, img: HTMLImageElement): void {
    const x0 = (i % GRID) * CELL, y0 = Math.floor(i / GRID) * CELL;
    const inner = CELL - PAD * 2 - 4;
    const sc = inner / Math.max(img.width, img.height);
    const w = img.width * sc, h = img.height * sc, ox = (CELL - w) / 2, oy = (CELL - h) / 2;

    // White silhouette for the sticker edge.
    const t = this.tmp.getContext('2d')!;
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, CELL, CELL);
    t.drawImage(img, ox, oy, w, h);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = '#fffdf6';
    t.fillRect(0, 0, CELL, CELL);

    const g = this.g;
    g.clearRect(x0, y0, CELL, CELL);
    for (let k = 0; k < 16; k++) {
      const q = (k / 16) * Math.PI * 2;
      g.drawImage(this.tmp, x0 + Math.cos(q) * PAD * 0.8, y0 + Math.sin(q) * PAD * 0.8);
    }
    g.drawImage(img, x0 + ox, y0 + oy, w, h);
    this.texture.needsUpdate = true;
  }
}
