/**
 * Light rig: additive beams (instanced, camera-facing ribbons), laser fans,
 * fixture glows and floor pools. Looks: fan, cross, chase, wave, pulse.
 * The hype meter powers the rig from the center outward.
 * No full-screen strobing anywhere.
 */
import * as THREE from 'three';
import { clamp } from '@bibos/shared';
import { S, reduceMotion, activeLook, activeChase, held, isStrobe, isBlackout } from './sim';
import { PALS } from './world';
import { SpriteBatch, glowTexture, rgb } from './sprites';
import { glows } from './bloom';
import { aim, chaseLevel, strobeLevel } from './looks';
import { Beams } from './beams';
import { Lasers } from './lasers';

export class Lights {
  readonly group = new THREE.Group();
  private beams = new Beams();
  readonly glows: SpriteBatch;
  /** Movement clock, sped up or slowed by the designer's speed control. */
  private lt = 0;
  private lastT = 0;
  private lasers = new Lasers();
  constructor() {
    this.glows = new SpriteBatch(glowTexture(), 320, 'add', 21);
    this.group.add(this.beams.mesh, this.glows.mesh, this.lasers.group);
    glows(this.beams.mesh, this.glows.mesh);
  }

  update(tReal: number, beat: number, back: boolean): void {
    const L = S.ld;
    const dtReal = Math.max(0, Math.min(0.1, tReal - this.lastT));
    this.lt += dtReal * L.speed;
    this.lastT = tReal;
    const t = this.lt;
    const ph = ((beat % 1) + 1) % 1, kick = Math.pow(1 - ph, 2.4), bar = Math.floor(beat / 4);
    const pal = (L.colors ?? PALS[((Math.floor(bar / 8) % 4) + 4) % 4]).map(rgb);
    const look = activeLook(bar), chase = activeChase(bar);
    // Strobe: beams and stage LEDs only (never a full-screen flash), at the designer's speed.
    const strobe = isStrobe() && !reduceMotion ? strobeLevel(beat, L.strobeRate) : 1;
    const dark = isBlackout();
    // A look picked on the desk always gets the whole rig at a good level, even when the crowd is quiet.
    const picked = S.look !== 'auto' || S.chase !== 'auto';
    const power = dark ? 0 : clamp(Math.max(picked ? 0.85 : 0, 0.35 + S.E * 0.75), 0, 1.25) * (1 - S.dim * 0.85) * L.intensity * strobe;
    const rig = picked ? 1 : 0.45 + 0.55 * S.mShow;
    const B = this.beams, G = this.glows;
    B.uTime.value = tReal;
    B.begin();
    G.begin();
    const WHITE = [1, 1, 0.94];
    // Lens: bright point, soft halo and a thin horizontal flare streak.
    const lens = (p: number[], c: readonly number[], a: number, size = 1) => {
      if (a <= 0.01) return;
      G.add(p[0], p[1], p[2], 5.5 * size, 5.5 * size, c[0], c[1], c[2], Math.min(1, a * 0.7));
      G.add(p[0], p[1], p[2], 1.6 * size, 1.6 * size, 1, 1, 1, Math.min(1, a));
      G.add(p[0], p[1], p[2], 16 * size, 0.55 * size, c[0] * 0.6 + 0.4, c[1] * 0.6 + 0.4, c[2] * 0.6 + 0.4, Math.min(0.8, a * 0.55));
    };

    /* Sky searchlights: four huge slow beams behind everything. Always on, even at low energy. */
    if (!dark) {
      const sa = Math.min(0.5, (0.18 + S.E * 0.22) * (1 - S.dim * 0.7) * L.intensity) * strobe;
      for (let k = 0; k < 4; k++) {
        const s = k < 2 ? -1 : 1, off = k % 2 ? 0.9 : 0.4;
        const o = back ? [s * (30 + off * 25), 0, -60] : [s * (40 + off * 30), 0, 170];
        const sw = Math.sin(t * 0.22 + k * 1.7);
        const g = [o[0] + sw * 120 + s * 30, 260, o[2] + (back ? -40 : 60) * Math.cos(t * 0.17 + k)];
        B.add(o, g, 0.9, 16, k % 2 ? WHITE : pal[k % 2], sa, 0, 1, 1, 0.25);
      }
    }

    /* Moving heads: the main rig. More fixtures, hazy beams with hot cores. */
    const N = back ? 26 : 20;
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1), s = u * 2 - 1;
      if (Math.abs(s) > rig + 0.02) continue;
      const m = aim(look, i, u, beat, kick, t), { ang, tilt } = m;
      // The chase switches heads on and off while they keep moving.
      const amp = chase === 'none' ? m.amp : m.amp * chaseLevel(chase, u, beat, kick, t);
      const up = i % 2 === 0;
      const o = back ? (up ? [s * 36, 34, -15] : [s * 34, 32.8, -15]) : (up ? [s * 70, 7, 100] : [s * 34, 17, 0]);
      let g: number[], pool = false;
      if (back) {
        // Seen from the crowd: the upper heads fan out over the audience toward the camera (low tilt)
        // or up into the sky (high tilt), so their movement crosses the frame.
        if (up) g = [o[0] + ang * 70, 10 + tilt * 70, -15 + (1 - tilt) * (S.maxZ + 45)];
        else { g = [s * 10 + ang * 32, 0, 1 + S.maxZ * clamp(tilt, 0.05, 1.1)]; pool = true; }
      } else if (up) g = [o[0] + ang * 130, 60 + tilt * 110, 100 - (1 - tilt) * 70];
      else { g = [ang * 30 + s * 8, 0, S.midZ + tilt * S.maxZ * 1.2]; pool = true; }
      const c = pal[i % 2];
      const dist = Math.hypot(g[0] - o[0], g[1] - o[1], g[2] - o[2]);
      const a = Math.min(1, amp * power * (up ? 0.95 : back ? 0.6 : 0.34) * (0.75 + 0.25 * kick));
      B.add(o, g, 0.22, 0.4 + dist * (up ? 0.03 : 0.04), c, a, pool ? 0.12 : 0, 1, 1, up ? 0.8 : 0.25);
      if (pool) {
        G.add(g[0], 0.03, g[2], 15, 6, c[0], c[1], c[2], Math.min(0.55, amp * power * 0.45), 2);
      }
      lens(o, c, amp * power * (0.7 + 0.5 * kick));
    }

    /* Blinders: warm-white bank across the roof that punches on the kick when it's hot.
       Small light sources only (no full-screen flash). */
    const hot = clamp((S.E - 0.62) * 3, 0, 1) + S.flash;
    // Held blinder: the whole bank full on (even through a blackout, like a real desk's flash).
    // Snaps on, fades off over a moment like hot bulbs. Steady light, so it's not a strobe.
    S.blind = held('blinder') ? Math.min(1, S.blind + dtReal * 25) : Math.max(0, S.blind - dtReal * 2.6);
    const kickBlind = !dark && hot > 0.02 && !reduceMotion ? Math.min(1.2, hot * Math.pow(kick, 3) * L.intensity) : 0;
    const blind = S.blind * Math.max(0.7, Math.min(1.3, L.intensity)) * 1.5;
    if (kickBlind > 0.01 || blind > 0.01) {
      const ba = Math.max(kickBlind, blind);
      const row = back ? [-30, -18, -6, 6, 18, 30].map((x) => [x, 34.6, -14.8]) : [[-24, 21.4, 46], [24, 21.4, 46], [-12, 21.4, 46], [12, 21.4, 46]];
      for (const p of row) lens(p, [1, 0.85, 0.6], ba, 1.5 + S.blind * 0.9);
    }
    /* Lasers. Auto: on big moments (not in lights-down or blackout, skipped on every 4th bar unless very hype).
       Switched on (or held) on the desk: always, cutting through lights-down and blackout. */
    const autoLasers = S.E > 0.42 && S.dim < 0.5 && (bar % 4 !== 3 || S.E > 0.78);
    const forced = held('lasers') || L.lasers === 'on';
    const lasersOn = forced || (L.lasers === 'auto' && autoLasers && !dark);
    const la = (forced ? Math.max(0.9, Math.min(1.1, S.E + 0.3)) : clamp(S.E + 0.2, 0.5, 1)) * Math.min(1.3, L.intensity) * strobe;
    this.lasers.update(lasersOn ? la : 0, { t, beat, bar, kick, back, pal });
    B.end();
    G.end();
  }
}
