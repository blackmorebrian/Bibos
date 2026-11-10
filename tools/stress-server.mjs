// Bibos stress-test server: serves the scene + sender builds, relays WebRTC
// signaling between them, and collects bench results and remote errors.
//   node tools/stress-server.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || 8787);
const files = {
  '/': path.join(root, 'apps/scene/dist/index.html'),
  '/index.html': path.join(root, 'apps/scene/dist/index.html'),
  '/sender.html': path.join(root, 'apps/webcam-sender/dist/index.html'),
};
const downloads = {
  '/download/bibos-scene.html': files['/'],
  '/download/bibos-sender.html': files['/sender.html'],
};
const resultsDir = path.join(root, 'results');
fs.mkdirSync(resultsDir, { recursive: true });

const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-private-network': 'true' };

function body(req) {
  return new Promise((resolve) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => resolve(b)); });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method === 'POST' && url.pathname === '/results') {
    const txt = await body(req);
    try {
      const r = JSON.parse(txt);
      const name = `${r.when.replace(/[:.]/g, '-')}_n${r.n}_${r.cam}${r.tag ? '_' + r.tag.replace(/[^\w-]/g, '') : ''}.json`;
      fs.writeFileSync(path.join(resultsDir, name), JSON.stringify(r, null, 2));
      console.log(`\n[bench] n=${r.n} cam=${r.cam} fps=${r.fpsAvg} frame p50/p95/p99=${r.frameMs.p50}/${r.frameMs.p95}/${r.frameMs.p99} cpu p95=${r.cpuMs.p95} gpu=${r.gpuMs ? r.gpuMs.p95 : 'n/a'} long=${r.longFrames}/${r.frames}\n        ${r.renderer}\n        -> results/${name}`);
    } catch (e) { console.log('[bench] bad payload', e.message); }
    res.writeHead(204, cors); return res.end();
  }
  if (req.method === 'POST' && url.pathname === '/log') {
    console.log('[remote]', await body(req));
    res.writeHead(204, cors); return res.end();
  }
  const dl = downloads[url.pathname];
  const file = dl || files[url.pathname];
  if (file && fs.existsSync(file)) {
    const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...cors };
    if (dl) headers['content-disposition'] = `attachment; filename="${path.basename(url.pathname)}"`;
    res.writeHead(200, headers);
    if (dl && url.pathname === '/download/bibos-scene.html') {
      // Bake defaults into the downloaded copy so it can be loaded as an OBS "Local file"
      // (which can't carry ?params). Defaults: webcam via OBS Virtual Camera, logs to this server.
      const d = new URLSearchParams({ cam: 'direct', channel: 'itsbrianblackmore' });
      url.searchParams.forEach((v, k) => d.set(k, v));
      d.set('server', req.headers.host);
      const inject = `<script>window.BIBOS_DEFAULTS=${JSON.stringify(d.toString())}</script>`;
      return res.end(fs.readFileSync(file, 'utf8').replace('<head>', `<head>${inject}`));
    }
    return fs.createReadStream(file).pipe(res);
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end(file ? 'Not built yet: run npm run build' : 'not found');
});

// Signaling: everyone in a room hears everyone else's messages.
const rooms = new Map();
const wss = new WebSocketServer({ server, path: '/signal' });
wss.on('connection', (ws) => {
  let room = null, role = null;
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type === 'join') {
      room = String(msg.room || 'stress'); role = String(msg.role || 'peer');
      if (!rooms.has(room)) rooms.set(room, new Set());
      const peers = rooms.get(room);
      ws.send(JSON.stringify({ type: 'peers', roles: [...peers].map((p) => p.role) }));
      for (const p of peers) p.ws.send(JSON.stringify({ type: 'joined', role }));
      peers.add({ ws, role });
      console.log(`[signal] ${role} joined room ${room} (${peers.size} peers)`);
      return;
    }
    if (!room) return;
    for (const p of rooms.get(room)) if (p.ws !== ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  });
  ws.on('close', () => {
    if (!room) return;
    const peers = rooms.get(room);
    for (const p of peers) if (p.ws === ws) peers.delete(p);
    console.log(`[signal] ${role} left room ${room}`);
  });
});

server.listen(port, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`Bibos stress server on port ${port}`);
  for (const ip of ips) {
    console.log(`  scene:     http://${ip}:${port}/?n=500&hud=1`);
    console.log(`  bench:     http://${ip}:${port}/?n=500&bench=60`);
    console.log(`  downloads: http://${ip}:${port}/download/bibos-scene.html  and  /download/bibos-sender.html`);
  }
});
