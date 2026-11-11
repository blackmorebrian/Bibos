/**
 * 2D overlay canvas on top of WebGL: name labels, hype meter, stream tags,
 * "CHAT EARNED THIS" banner, drop flash, HUD.
 */
import * as THREE from 'three';
import { clamp, HEADS, HATS, EXTRAS, PATTERNS, BODY_COLORS, BODY_COLOR_NAMES, SHIRT_COLORS, SHIRT_COLOR_NAMES } from '@bibos/shared';
import { HELP_SECONDS, joinedCount } from './viewers';
import { crowd, S, reduceMotion, clock, joins, live } from './sim';
import { poseHop } from './crowd';
import { params } from './params';

const PAPER = '#fffdf6', INK = '#1a1358';
const DISPLAY = '"Bowlby One","Arial Black",Impact,sans-serif';

export class Overlay {
  readonly canvas = document.createElement('canvas');
  private g = this.canvas.getContext('2d')!;
  W = 1920;
  H = 1080;
  hudLines: string[] = [];
  summary: string[] | null = null;
  private v = new THREE.Vector3();
  private placed: number[][] = [];
  /** Right edge of the top-left "N BIBOS" tag, so the hype meter never covers it. */
  private tagRight = 0;
  /** Vertical (TikTok / Reels / Shorts): sized off the width, and kept clear of the apps' own
      buttons and captions (top bar, right-side buttons, bottom caption area). */
  private portrait = false;
  private safe = { top: 0, right: 0, bottom: 0 };

  constructor() {
    this.canvas.id = 'overlay';
  }
  resize(W: number, H: number): void {
    this.W = W; this.H = H;
    this.canvas.width = W; this.canvas.height = H;
  }

  draw(cam: THREE.PerspectiveCamera, t: number, beat: number): void {
    const { g, W, H } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    this.portrait = H > W;
    const k = this.portrait ? W / 1080 : H / 1080;
    const m = 26 * k;
    this.safe = this.portrait ? { top: 150 * k, right: 150 * k, bottom: 430 * k } : { top: m, right: m, bottom: m };

    if (params.labels) this.labels(cam, t, beat, k);
    this.tags(k);
    this.joinToasts(t, k);
    this.meter(t, k);
    if (t - S.helpAt < HELP_SECONDS) this.helpCard(t - S.helpAt, k);
    if (S.flash > 0.01 && !reduceMotion) {
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = `rgba(255,255,255,${S.flash * 0.55})`;
      g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
    }
    if (this.hudLines.length) this.hud(k);
    if (this.summary) this.drawSummary(k);
  }

  private labels(cam: THREE.PerspectiveCamera, t: number, beat: number, k: number): void {
    const { g, W, H, v } = this;
    const fpx = H / 2 / Math.tan((cam.fov * Math.PI) / 360);
    const right = new THREE.Vector3(), up = new THREE.Vector3(), fwd = new THREE.Vector3();
    cam.matrixWorld.extractBasis(right, up, fwd);
    fwd.negate();
    const cand: [typeof crowd[number], number, number][] = [];
    for (const a of crowd) {
      const rec = t - a.lastEmote;
      const d = (a.x - cam.position.x) * fwd.x + (0 - cam.position.y) * fwd.y + (a.z - cam.position.z) * fwd.z;
      if (d < 0.9) continue;
      const s = fpx / d;
      if (rec < 2.4 || s > 210) cand.push([a, -rec + (a === S.target && S.shot === 'close' ? 100 : 0), s]);
    }
    cand.sort((x, y) => y[1] - x[1]);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    this.placed.length = 0;
    let n = 0;
    for (const [a, , s] of cand) {
      if (n >= 16) break;
      const { hop, em } = poseHop(a, t, beat);
      const lift = em === 6 ? 3.95 : em === 7 || !em ? 2.3 : 2.95;
      v.set(a.x, 0, a.z).addScaledVector(up, hop + lift).project(cam);
      if (v.z > 1) continue;
      const x0 = (v.x + 1) * 0.5 * W, y = (1 - v.y) * 0.5 * H;
      const fs = clamp(s * 0.2, 19 * k, 36 * k);
      if (y < fs) continue;
      g.font = `800 ${fs}px Figtree,system-ui,sans-serif`;
      const w = g.measureText(a.name).width + fs * 1.1, h = fs * 1.65, x = x0 - w / 2, top = y - h / 2;
      if (x < 0 || x + w > W) continue;
      if (this.placed.some((r) => x < r[0] + r[2] && x + w > r[0] && top < r[1] + r[3] && top + h > r[1])) continue;
      this.placed.push([x, top, w, h]);
      n++;
      g.globalAlpha = S.dim > 0.5 ? 0.92 : 1;
      g.fillStyle = PAPER;
      g.beginPath(); g.roundRect(x, top, w, h, h * 0.22); g.fill();
      g.fillStyle = a.nameColor;
      g.fillText(a.name, x0, y + fs * 0.04);
      g.globalAlpha = 1;
    }
  }

  /** "<name> JOINED THE CROWD" stickers, bottom left, newest at the bottom. */
  private joinToasts(t: number, k: number): void {
    const { g, H } = this;
    const fs = 26 * k, h = fs * 1.75, m = 26 * k;
    // Portrait: stack above the "TYPE !BIBO" tag, which sits in the bottom safe line.
    let y = this.portrait ? H - this.safe.bottom - 28 * k * 1.8 - 14 * k - h : H - m - h;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    for (let i = joins.length - 1; i >= 0; i--) {
      const j = joins[i], age = t - j.at;
      if (age > 6) { joins.splice(i, 1); continue; }
      const slide = reduceMotion ? 1 : Math.min(1, age * 5);
      g.globalAlpha = age > 5.4 ? (6 - age) / 0.6 : 1;
      g.font = `800 ${fs}px Figtree,system-ui,sans-serif`;
      const nw = g.measureText(j.name).width;
      g.font = `400 ${fs * 0.8}px ${DISPLAY}`;
      const tail = ' JOINED THE CROWD', tw = g.measureText(tail).width;
      const w = nw + tw + fs * 1.2, x = m - (1 - slide) * (w + m);
      g.fillStyle = PAPER;
      g.beginPath(); g.roundRect(x, y, w, h, h * 0.22); g.fill();
      g.font = `800 ${fs}px Figtree,system-ui,sans-serif`;
      g.fillStyle = j.color; g.fillText(j.name, x + fs * 0.6, y + h / 2 + fs * 0.04);
      g.font = `400 ${fs * 0.8}px ${DISPLAY}`;
      g.fillStyle = INK; g.fillText(tail, x + fs * 0.6 + nw, y + h / 2 + fs * 0.06);
      y -= h + 10 * k;
    }
    g.globalAlpha = 1;
  }

  /** The "how to join and customize" card: slides in on the left for HELP_SECONDS. */
  private helpCard(age: number, k: number): void {
    const { g } = this;
    const W = 720 * k, pad = 30 * k, fs = 23 * k, pillFs = 22 * k, lineH = fs * 1.55, pillW = 150 * k;
    const opts = (a: readonly string[], cols?: readonly string[]) =>
      [...a.filter((x) => x !== 'none'), ...(a.includes('none') ? ['none'] : [])].map((x) => ({ x, c: cols?.[a.indexOf(x)] }));
    const rows: [string, { x: string; c?: string }[]][] = [
      ['!bibo', [{ x: 'join the crowd' }]],
      ['!head', opts(HEADS)],
      ['!hat', opts(HATS)],
      ['!color', opts(BODY_COLOR_NAMES, BODY_COLORS)],
      ['!shirt', opts(SHIRT_COLOR_NAMES, SHIRT_COLORS)],
      ['!extra', opts(EXTRAS)],
      ['!pattern', opts(PATTERNS)],
      ['moves', ['!clap', '!dance', '!jump', '!lighter', '!phone', '!flag'].map((x) => ({ x }))],
      ['subs', [{ x: '!jetpack  fly over the crowd' }]],
    ];

    // Lay out first so the card can be sized to fit.
    g.font = `800 ${fs}px Figtree,system-ui,sans-serif`;
    const sw = fs * 0.8, gap = fs * 0.55, x0 = pad + pillW + 14 * k, maxX = W - pad;
    const ops: { kind: 'pill' | 'word'; x: number; y: number; s: string; c?: string }[] = [];
    let y = pad + 62 * k;
    for (const [cmd, words] of rows) {
      ops.push({ kind: 'pill', x: pad, y, s: cmd });
      let x = x0;
      for (const w of words) {
        const ww = g.measureText(w.x).width + (w.c ? sw + 6 * k : 0);
        if (x > x0 && x + ww > maxX) { x = x0; y += lineH; }
        ops.push({ kind: 'word', x, y, s: w.x, c: w.c });
        x += ww + gap;
      }
      y += lineH + 9 * k;
    }
    const tipY = y + 6 * k, Hc = tipY + 50 * k + pad;

    const slideIn = reduceMotion ? 1 : 1 - Math.pow(1 - Math.min(1, age / 0.45), 3);
    const slideOut = reduceMotion ? 1 : Math.min(1, (HELP_SECONDS - age) / 0.45);
    const s = Math.min(slideIn, slideOut);
    const X = 26 * k - (1 - s) * (W + 60 * k), Y = Math.max(this.portrait ? this.safe.top + 180 * k : 96 * k, (this.H - Hc) / 2 - 40 * k);
    g.save();
    g.translate(X, Y);
    g.fillStyle = '#ff3d81'; g.fillRect(12 * k, 12 * k, W, Hc);
    g.fillStyle = PAPER; g.fillRect(0, 0, W, Hc);
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = `400 ${40 * k}px ${DISPLAY}`;
    g.fillStyle = INK; g.fillText('GET IN THE CROWD', pad, pad + 20 * k);
    for (const o of ops) {
      if (o.kind === 'pill') {
        g.font = `400 ${pillFs}px ${DISPLAY}`;
        const pw = g.measureText(o.s).width + pillFs * 1.0, ph = pillFs * 1.5;
        g.fillStyle = o.s === 'moves' ? INK : o.s === 'subs' ? '#7c5cff' : '#ff3d81';
        g.beginPath(); g.roundRect(o.x, o.y - ph / 2, pw, ph, ph * 0.25); g.fill();
        g.fillStyle = PAPER; g.fillText(o.s.toUpperCase(), o.x + pillFs * 0.5, o.y + pillFs * 0.06);
      } else {
        g.font = `800 ${fs}px Figtree,system-ui,sans-serif`;
        let x = o.x;
        if (o.c) {
          g.fillStyle = o.c; g.strokeStyle = INK; g.lineWidth = 2 * k;
          g.beginPath(); g.arc(x + sw / 2, o.y, sw / 2, 0, Math.PI * 2); g.fill(); g.stroke();
          x += sw + 6 * k;
        }
        g.fillStyle = INK; g.fillText(o.s, x, o.y + fs * 0.04);
      }
    }
    // Tip: everything in one go.
    g.font = `400 ${22 * k}px ${DISPLAY}`;
    const tip = 'ALL AT ONCE:  !bibo frog crown pink';
    const tw = g.measureText(tip).width + 28 * k;
    g.fillStyle = '#ffc21a'; g.fillRect(pad - 4 * k, tipY, tw, 44 * k);
    g.fillStyle = INK; g.fillText(tip, pad + 10 * k, tipY + 23 * k);
    g.restore();
  }

  private tags(k: number): void {
    const { g, W, H } = this;
    const m = 26 * k;
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const tag = (text: string, x: number, y: number, bg: string, fg: string, fs: number) => {
      g.font = `400 ${fs}px ${DISPLAY}`;
      const w = g.measureText(text).width + fs * 1.2, h = fs * 1.8, X = x < 0 ? W + x - w : x;
      g.fillStyle = bg; g.fillRect(X, y, w, h);
      g.fillStyle = fg; g.fillText(text, X + fs * 0.6, y + h / 2 + fs * 0.03);
      return X + w;
    };
    // Live, only real viewers count.
    const n = live && !S.demo.fill ? joinedCount() : crowd.length;
    const label = n === 0 ? 'BE THE FIRST IN THE CROWD' : `${n} BIBO${n === 1 ? '' : 'S'} IN THE CROWD`;
    this.tagRight = tag(label, m, this.safe.top, PAPER, INK, 28 * k);
    const alt = live && Math.floor(S.t / 8) % 2 === 1;
    const call = alt ? 'TYPE !BIBOHELP TO CUSTOMIZE' : 'TYPE !BIBO TO GET IN';
    if (this.portrait) tag(call, m, H - this.safe.bottom - 28 * k * 1.8, '#ff3d81', PAPER, 28 * k);
    else tag(call, -m, H - m - 28 * k * 1.8, '#ff3d81', PAPER, 28 * k);
  }

  private meter(t: number, k: number): void {
    const { g, W, H } = this;
    const h = 48 * k, v = S.mShow, lit = t - S.hypeAt < 3, pad = 7 * k;
    // Centered, but always clear of the "N BIBOS" tag (fonts differ between machines).
    // Landscape: centered, but always clear of the "N BIBOS" tag (fonts differ between machines).
    // Portrait: its own row under the tag, across the width.
    const left = this.portrait ? 26 * k + pad : Math.max((W - W * 0.36) / 2, this.tagRight + 24 * k + pad);
    const w = this.portrait ? W - 2 * (26 * k + pad) : Math.min(W * 0.36, W - 26 * k - pad - left);
    const sh = v > 0.82 && !reduceMotion ? Math.sin(t * 38) * 4 * k * (v - 0.82) / 0.18 : 0;
    const x = left + sh, y = this.portrait ? this.safe.top + 28 * k * 1.8 + 22 * k : 30 * k;
    g.fillStyle = PAPER; g.fillRect(x - pad, y - pad, w + pad * 2, h + pad * 2);
    g.fillStyle = '#1c1266'; g.fillRect(x, y, w, h);
    const gr = g.createLinearGradient(x, 0, x + w, 0);
    gr.addColorStop(0, '#19d3c5'); gr.addColorStop(0.55, '#ffc21a'); gr.addColorStop(1, '#ff3d81');
    g.fillStyle = gr; g.fillRect(x, y, w * v, h);
    g.fillStyle = 'rgba(28,18,102,.55)';
    for (let i = 1; i < 12; i++) g.fillRect(x + (w * i) / 12 - k, y, 2 * k, h);
    g.font = `400 ${29 * k}px ${DISPLAY}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const txt = S.lights && v > 0.99 ? 'READY WHEN THE LIGHTS COME UP' : 'HYPE';
    g.fillStyle = INK; g.fillText(txt, x + w / 2 + 2 * k, y + h / 2 + 3 * k);
    g.fillStyle = PAPER; g.fillText(txt, x + w / 2, y + h / 2 + k);
    if (lit) {
      const age = t - S.hypeAt, sc = Math.min(1, age * 6) * (1 + 0.14 * Math.sin(Math.min(1, age * 4) * Math.PI));
      g.save();
      g.translate(W / 2, H * 0.3); g.rotate(-0.045); g.scale(sc, sc);
      g.globalAlpha = age > 2.5 ? (3 - age) / 0.5 : 1;
      g.font = `400 ${92 * k}px ${DISPLAY}`;
      const fs = 92 * k * Math.min(1, (W * 0.82) / (g.measureText('CHAT EARNED THIS').width + 92 * k * 1.1));
      g.font = `400 ${fs}px ${DISPLAY}`;
      const lbl = 'CHAT EARNED THIS', tw = g.measureText(lbl).width + fs * 1.1, th = fs * 1.75;
      g.fillStyle = '#ff3d81'; g.fillRect(-tw / 2 + 12 * k, -th / 2 + 12 * k, tw, th);
      g.fillStyle = PAPER; g.fillRect(-tw / 2, -th / 2, tw, th);
      g.fillStyle = INK; g.fillText(lbl, 0, fs * 0.05);
      g.restore();
      g.globalAlpha = 1;
    }
  }

  private hud(k: number): void {
    const { g } = this;
    const fs = 17 * k, lh = fs * 1.3, x = 26 * k, y = 110 * k;
    g.font = `600 ${fs}px ui-monospace,Menlo,Consolas,monospace`;
    g.textAlign = 'left'; g.textBaseline = 'top';
    const w = Math.max(...this.hudLines.map((l) => g.measureText(l).width)) + fs;
    g.fillStyle = 'rgba(10,6,40,.78)';
    g.fillRect(x - fs / 2, y - fs / 2, w, this.hudLines.length * lh + fs);
    g.fillStyle = '#d6fff9';
    this.hudLines.forEach((l, i) => g.fillText(l, x, y + i * lh));
    void clock;
  }

  private drawSummary(k: number): void {
    const { g, W, H } = this;
    const lines = this.summary!;
    const fs = 26 * k, lh = fs * 1.35;
    g.font = `700 ${fs}px ui-monospace,Menlo,Consolas,monospace`;
    const w = Math.max(...lines.map((l) => g.measureText(l).width)) + fs * 2, h = lines.length * lh + fs * 2;
    const x = (W - w) / 2, y = (H - h) / 2;
    g.fillStyle = 'rgba(10,6,40,.92)'; g.fillRect(x, y, w, h);
    g.strokeStyle = PAPER; g.lineWidth = 4 * k; g.strokeRect(x, y, w, h);
    g.fillStyle = PAPER; g.textAlign = 'left'; g.textBaseline = 'top';
    lines.forEach((l, i) => g.fillText(l, x + fs, y + fs + i * lh));
  }
}
