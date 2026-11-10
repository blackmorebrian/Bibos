/**
 * Twitch chat on the two side screens ("chat" screen mode): the last few
 * messages in real text, names in their chat colors, emotes as pictures,
 * new lines sliding up from the bottom, with a faint LED-wall grid on top.
 *
 * Keeps a short history all the time, so switching to chat mode shows recent
 * chat at once. Commands, bots and links never show; messages a mod deletes,
 * and everything from someone who's timed out or banned, come straight off.
 */
import * as THREE from 'three';

const W = 448, H = 512, PAD = 18, SIDE = 44, FS = 34, LINE = 42, EMOTE = 38;
const MAX_KEEP = 24, MAX_CHARS = 200, MAX_LINES = 4, SLIDE = 0.35;
const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|tv|gg|ly|io|co|me|xyz|link|shop)\b)/i;
const NAME_COLORS = ['#ff7eb6', '#5ee6d8', '#ffd25e', '#a998ff', '#ff9a5e', '#8fe36b', '#7fc8ff'];

export interface WallMessage {
  id?: string; login: string; display: string; color: string; text: string;
  /** Emotes by position in the text (in characters, end inclusive), as Twitch sends them. */
  emoteAt?: { start: number; end: number; id: string }[];
}
type Piece = { text: string } | { emote: string };
interface Entry { id?: string; login: string; name: string; color: string; pieces: Piece[]; h: number }

const emoteImgs = new Map<string, HTMLImageElement | null>();

export class ChatWall {
  readonly texture: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private list: Entry[] = [];
  private dirty = true;
  private slideFrom = 0;
  private slideAt = -99;
  private grid: HTMLCanvasElement;

  constructor() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    this.g = c.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(c);
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.anisotropy = 4;
    // LED wall: dark gaps between pixel rows and columns, drawn over the text.
    this.grid = document.createElement('canvas');
    this.grid.width = W; this.grid.height = H;
    const gg = this.grid.getContext('2d')!;
    gg.fillStyle = 'rgba(10,4,40,0.32)';
    for (let x = 0; x < W; x += 4) gg.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 4) gg.fillRect(0, y, W, 1);
  }

  /** A chat message arrived. Commands and links are skipped here; the caller skips bots. */
  add(m: WallMessage): void {
    const now = performance.now() / 1000;
    const text = m.text.trim();
    if (!text || text.startsWith('!') || LINK.test(text)) return;
    const e: Entry = { id: m.id, login: m.login, name: m.display || m.login, color: nameColor(m.color, m.login), pieces: split(text, m.emoteAt ?? []), h: 0 };
    e.h = this.measure(e);
    this.list.push(e);
    if (this.list.length > MAX_KEEP) this.list.shift();
    this.slideFrom = e.h; this.slideAt = now;
    this.dirty = true;
  }
  removeUser(login: string): void { this.drop((e) => e.login === login); }
  removeId(id: string): void { this.drop((e) => e.id === id); }
  clear(): void { this.drop(() => true); }
  private drop(f: (e: Entry) => boolean): void {
    const n = this.list.length;
    this.list = this.list.filter((e) => !f(e));
    if (this.list.length !== n) this.dirty = true;
  }

  /** Redraw if anything changed or a line is still sliding in. Call only while chat mode is showing. */
  update(): void {
    const now = performance.now() / 1000;
    const k = Math.min(1, (now - this.slideAt) / SLIDE);
    if (!this.dirty && k >= 1) return;
    this.dirty = false;
    const off = this.slideFrom * (1 - k) * (1 - k) * (1 - k);
    const g = this.g;
    g.fillStyle = '#140a4f';
    g.fillRect(0, 0, W, H);
    let y = H - PAD + off;
    for (let i = this.list.length - 1; i >= 0 && y > 0; i--) {
      const e = this.list[i];
      y -= e.h;
      g.globalAlpha = i === this.list.length - 1 ? Math.min(1, 0.25 + k) : 1;
      this.draw(e, y, true);
      y -= 10;
    }
    g.globalAlpha = 1;
    if (!this.list.length) {
      g.font = `800 ${FS}px Figtree,system-ui,sans-serif`;
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.textAlign = 'center';
      g.fillText('CHAT', W / 2, H / 2);
      g.textAlign = 'left';
    }
    // Soft fade at the top so old lines leave gently.
    const fade = g.createLinearGradient(0, 0, 0, 70);
    fade.addColorStop(0, '#140a4f'); fade.addColorStop(1, 'rgba(20,10,79,0)');
    g.fillStyle = fade; g.fillRect(0, 0, W, 70);
    g.drawImage(this.grid, 0, 0);
    this.texture.needsUpdate = true;
  }

  private measure(e: Entry): number { return this.draw(e, 0, false); }

  /** Lay out (and optionally paint) one message with its top at y; returns its height. */
  private draw(e: Entry, y0: number, paint: boolean): number {
    // Wide side margins: the camera sways, and the outer edges of the screens slip out of shot.
    const g = this.g, right = W - SIDE;
    g.font = `800 ${FS}px Figtree,system-ui,sans-serif`;
    g.textBaseline = 'alphabetic';
    let x = SIDE, line = 0, cut = false;
    const base = () => y0 + FS + line * LINE;
    const name = `${e.name}:`;
    if (paint) { g.fillStyle = e.color; g.fillText(name, x, base()); }
    x += g.measureText(name).width + 10;
    g.font = `600 ${FS}px Figtree,system-ui,sans-serif`;
    const space = g.measureText(' ').width;
    const newLine = () => { if (line + 1 >= MAX_LINES) { cut = true; return false; } line++; x = SIDE; return true; };
    outer: for (const p of e.pieces) {
      if ('emote' in p) {
        if (x + EMOTE > right && x > SIDE && !newLine()) break;
        if (paint) {
          const img = emoteImage(p.emote, () => { this.dirty = true; });
          if (img) g.drawImage(img, x, base() - EMOTE + 6, EMOTE, EMOTE);
        }
        x += EMOTE + space;
        continue;
      }
      for (const word of p.text.split(/\s+/)) {
        if (!word) continue;
        let w = g.measureText(word).width;
        if (x + w > right && x > SIDE && !newLine()) break outer;
        let shown = word;
        if (w > right - SIDE) { // one huge word: trim it to fit
          while (shown.length > 1 && g.measureText(shown + '…').width > right - x) shown = shown.slice(0, -1);
          shown += '…'; w = g.measureText(shown).width;
        }
        if (paint) { g.fillStyle = '#ffffff'; g.fillText(shown, x, base()); }
        x += w + space;
      }
    }
    if (cut && paint) { g.fillStyle = '#ffffff'; g.fillText('…', Math.min(x, right - 20), base()); }
    return FS + line * LINE + 10;
  }
}

/** Split text into words and emotes using Twitch's character positions. */
function split(text: string, at: { start: number; end: number; id: string }[]): Piece[] {
  const chars = Array.from(text).slice(0, MAX_CHARS);
  const out: Piece[] = [];
  let i = 0;
  for (const e of [...at].sort((a, b) => a.start - b.start)) {
    if (e.start < i || e.start >= chars.length) continue;
    if (e.start > i) out.push({ text: chars.slice(i, e.start).join('') });
    out.push({ emote: e.id });
    i = e.end + 1;
  }
  if (i < chars.length) out.push({ text: chars.slice(i).join('') });
  return out;
}

/** Chat colors made bright enough to read on the dark screen. */
function nameColor(hex: string, login: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    let h = 0;
    for (const ch of login) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return NAME_COLORS[h % NAME_COLORS.length];
  }
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  if (hsl.l < 0.62) c.setHSL(hsl.h, Math.min(1, hsl.s + 0.1), 0.62);
  return `#${c.getHexString()}`;
}

function emoteImage(id: string, onLoad: () => void): HTMLImageElement | null {
  if (emoteImgs.has(id)) return emoteImgs.get(id)!;
  emoteImgs.set(id, null);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { emoteImgs.set(id, img); onLoad(); };
  img.src = `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/static/dark/2.0`;
  return null;
}
