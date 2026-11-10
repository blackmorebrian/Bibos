/** URL parameters for the stress test. See STRESS-TEST.md. */
// A downloaded copy can carry baked-in defaults (see stress-server /download); URL params win.
const q = new URLSearchParams((window as any).BIBOS_DEFAULTS ?? '');
new URLSearchParams(location.search).forEach((v, k) => q.set(k, v));
const num = (k: string, d: number) => (q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : d);

export type CamRoute = 'clip' | 'direct' | 'relay' | 'off';

export const params = {
  /** Number of real (full-color) Bibos. */
  n: num('n', 500),
  /** Benchmark length in seconds (0 = free run). */
  bench: num('bench', 0),
  hud: q.get('hud') === '1' || q.has('bench'),
  cam: (q.get('cam') ?? 'clip') as CamRoute,
  /** Substring of the camera label to open for cam=direct. */
  camLabel: q.get('camLabel') ?? 'OBS Virtual Camera',
  /** Atlas cell size in px (256 default, try 384/512 for close-up sharpness). */
  cell: num('cell', 256),
  aa: q.get('aa') !== '0',
  /** Render scale for the 3D layer (1 = native). */
  scale: num('scale', 1),
  /** Simulated chat speed 0..1. */
  chat: num('chat', 0.35),
  /** host:port of the stress server, needed when loaded from file://. */
  server: q.get('server'),
  room: q.get('room') ?? 'stress',
  seed: num('seed', 7),
  shot: q.get('shot'),
  labels: q.get('labels') !== '0',
  /** Twitch channel to read chat from (anonymous, read-only). Empty = fake chat. */
  channel: (q.get('channel') ?? '').replace(/^#/, '').trim().toLowerCase(),
  /** Minutes between automatic "how to join" cards (0 = only on !bibohelp or the C key). */
  help: num('help', 10),
  /** Free-text tag stored with bench results (e.g. "streaming-nvenc"). */
  tag: q.get('tag') ?? '',
};

export function serverBase(): string | null {
  if (params.server) return `http://${params.server}`;
  if (location.protocol.startsWith('http')) return location.origin;
  return null;
}
export function signalUrl(): string | null {
  if (params.server) return `ws://${params.server}/signal`;
  if (location.protocol.startsWith('http')) return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/signal`;
  return null;
}
