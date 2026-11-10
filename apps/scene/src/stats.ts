/**
 * Frame timing (rAF intervals + CPU time per frame), GPU timer queries where
 * the driver exposes them, and the scripted benchmark.
 */
import * as THREE from 'three';
import { crowd, S, drop, toggleLights, spamEmote, hypeBurst } from './sim';
import { cutTo } from './camera';
import { params, serverBase } from './params';

export function pct(arr: number[], p: number): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export class Stats {
  intervals: number[] = []; // ms between frames (last 600)
  cpu: number[] = []; // ms of JS work per frame
  gpu: number[] = [];
  private ext: any = null;
  private gl: WebGL2RenderingContext;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  gpuSupported = false;
  renderer = 'unknown';

  constructor(r: THREE.WebGLRenderer) {
    this.gl = r.getContext() as WebGL2RenderingContext;
    this.ext = this.gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this.gpuSupported = !!this.ext;
    const dbg = this.gl.getExtension('WEBGL_debug_renderer_info');
    this.renderer = dbg ? String(this.gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(this.gl.getParameter(this.gl.RENDERER));
  }
  private push(arr: number[], v: number, max = 600): void { arr.push(v); if (arr.length > max) arr.shift(); }
  frame(interval: number, cpuMs: number): void {
    this.push(this.intervals, interval);
    this.push(this.cpu, cpuMs);
  }
  gpuBegin(): void {
    if (!this.ext || this.active || this.pending.length > 4) return;
    const q = this.gl.createQuery()!;
    this.gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q);
    this.active = q;
  }
  gpuEnd(): void {
    if (!this.ext || !this.active) return;
    this.gl.endQuery(this.ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
    const gl = this.gl;
    while (this.pending.length) {
      const q = this.pending[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = gl.getParameter(this.ext.GPU_DISJOINT_EXT);
      if (!disjoint) this.push(this.gpu, gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
      this.pending.shift();
    }
  }
}

/* ---------- scripted benchmark: same 60 s loop every run ---------- */
const SCRIPT: [number, () => void][] = [
  [0, () => cutTo('wide')],
  [5, () => cutTo('sweep')],
  [10, () => cutTo('over')],
  [12, () => drop()],
  [16, () => cutTo('close', crowd[Math.min(5, crowd.length - 1)])],
  [21, () => cutTo('back')],
  [25, () => { cutTo('wide'); toggleLights(); }],
  [30, () => cutTo('back')],
  [35, () => toggleLights()],
  [38, () => cutTo('wide')],
  [40, () => { S.hypeAt = -99; S.meter = 1; }],
  [44, () => cutTo('sweep')],
  [48, () => { spamEmote('fire'); cutTo('over'); }],
  [52, () => cutTo('close', crowd[Math.min(12, crowd.length - 1)])],
  [56, () => cutTo('back')],
];

export class Bench {
  readonly duration = params.bench;
  private start = -1;
  private lastLoop = -1;
  private nextStep = 0;
  done = false;
  private rec = { intervals: [] as number[], cpu: [] as number[], gpu: [] as number[] };
  private heap0 = 0;

  get active(): boolean { return this.duration > 0 && !this.done; }

  tick(t: number, stats: Stats, interval: number, cpu: number): string[] | null {
    if (!this.active) return null;
    if (this.start < 0) {
      this.start = t;
      S.auto = false;
      this.heap0 = (performance as any).memory?.usedJSHeapSize ?? 0;
    }
    const el = t - this.start;
    const loop = Math.floor(el / 60), lt = el - loop * 60;
    if (loop !== this.lastLoop) { this.lastLoop = loop; this.nextStep = 0; }
    while (this.nextStep < SCRIPT.length && SCRIPT[this.nextStep][0] <= lt) SCRIPT[this.nextStep++][1]();
    if (el > 2) { // skip warm-up
      this.rec.intervals.push(interval);
      this.rec.cpu.push(cpu);
      const g = stats.gpu[stats.gpu.length - 1];
      if (g !== undefined) this.rec.gpu.push(g);
    }
    if (el < this.duration) return null;
    this.done = true;
    return this.finish(stats);
  }

  private finish(stats: Stats): string[] {
    const r = this.rec;
    const heap1 = (performance as any).memory?.usedJSHeapSize ?? 0;
    const meanInt = r.intervals.reduce((a, b) => a + b, 0) / Math.max(1, r.intervals.length);
    const budget = 1000 / Math.round(1000 / pct(r.intervals, 50));
    const long = r.intervals.filter((x) => x > budget * 1.5).length;
    const res = {
      when: new Date().toISOString(),
      tag: params.tag,
      n: crowd.length,
      seconds: this.duration,
      cam: params.cam,
      cell: params.cell,
      aa: params.aa,
      scale: params.scale,
      size: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
      renderer: stats.renderer,
      ua: navigator.userAgent,
      fpsAvg: +(1000 / meanInt).toFixed(1),
      frameMs: { p50: +pct(r.intervals, 50).toFixed(2), p95: +pct(r.intervals, 95).toFixed(2), p99: +pct(r.intervals, 99).toFixed(2), max: +Math.max(...r.intervals).toFixed(1) },
      cpuMs: { p50: +pct(r.cpu, 50).toFixed(2), p95: +pct(r.cpu, 95).toFixed(2), p99: +pct(r.cpu, 99).toFixed(2) },
      gpuMs: r.gpu.length ? { p50: +pct(r.gpu, 50).toFixed(2), p95: +pct(r.gpu, 95).toFixed(2), p99: +pct(r.gpu, 99).toFixed(2) } : null,
      longFrames: long,
      frames: r.intervals.length,
      heapMB: heap0Fmt(this.heap0, heap1),
    };
    console.log('BIBOS_BENCH', JSON.stringify(res));
    const base = serverBase();
    if (base) fetch(`${base}/results`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(res) }).catch(() => {});
    return [
      `BENCH DONE  n=${res.n}  ${res.seconds}s  cam=${res.cam}  ${res.tag}`,
      `fps avg ${res.fpsAvg}   long frames ${long}/${res.frames}`,
      `frame ms p50 ${res.frameMs.p50}  p95 ${res.frameMs.p95}  p99 ${res.frameMs.p99}  max ${res.frameMs.max}`,
      `cpu ms   p50 ${res.cpuMs.p50}  p95 ${res.cpuMs.p95}  p99 ${res.cpuMs.p99}`,
      res.gpuMs ? `gpu ms   p50 ${res.gpuMs.p50}  p95 ${res.gpuMs.p95}  p99 ${res.gpuMs.p99}` : 'gpu ms   (timer queries not exposed)',
      `heap ${res.heapMB}`,
      `${res.renderer.slice(0, 70)}`,
      base ? 'results sent to stress server' : 'no server: copy these numbers',
    ];
  }
}
function heap0Fmt(a: number, b: number): string {
  if (!a || !b) return 'n/a';
  return `${(a / 1048576).toFixed(0)} -> ${(b / 1048576).toFixed(0)} MB`;
}
export { hypeBurst };
