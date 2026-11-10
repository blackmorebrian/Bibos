/**
 * Bibos control hub (Cloudflare Worker + one Durable Object per channel).
 *
 * The crowd scene connects as role=scene and listens. The light designer's
 * control panel connects as role=panel and must send the password first;
 * only then are its commands relayed to the scene. The scene reports its
 * current state back so the panel can show what's live.
 *
 *   wss://<hub>/ws?room=<channel>&role=scene|panel
 *   panel -> {type:'auth', password} then {type:'cmd', what, arg}
 *   scene -> {type:'state', ...}  (forwarded to signed-in panels)
 *   hub   -> {type:'auth', ok} | {type:'presence', scenes} | {type:'cmd', what, arg}
 */
import { DurableObject } from 'cloudflare:workers';

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  PANEL_PASSWORD?: string;
}

interface Att { role: 'scene' | 'panel'; authed: boolean }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a websocket', { status: 426 });
      const room = (url.searchParams.get('room') ?? '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) || 'default';
      return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(req);
    }
    return new Response('Bibos hub is running.', { headers: { 'content-type': 'text/plain' } });
  },
};

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req: Request): Promise<Response> {
    const role = new URL(req.url).searchParams.get('role') === 'scene' ? 'scene' : 'panel';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, authed: role === 'scene' } satisfies Att);
    if (role === 'scene') this.presence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const att = ws.deserializeAttachment() as Att;
    let msg: { type?: string; password?: unknown; what?: unknown; arg?: unknown };
    try { msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw)); } catch { return; }

    if (att.role === 'scene') {
      if (msg.type === 'state') {
        const out = JSON.stringify(msg).slice(0, 4000);
        for (const p of this.panels()) p.send(out);
      }
      return;
    }

    if (!att.authed) {
      const ok = msg.type === 'auth' && typeof msg.password === 'string' && (await checkPassword(msg.password, this.env.PANEL_PASSWORD));
      if (!ok) {
        await new Promise((r) => setTimeout(r, 1200)); // slow down guessing
        ws.send(JSON.stringify({ type: 'auth', ok: false }));
        ws.close(4001, 'wrong password');
        return;
      }
      ws.serializeAttachment({ ...att, authed: true } satisfies Att);
      ws.send(JSON.stringify({ type: 'auth', ok: true }));
      ws.send(JSON.stringify({ type: 'presence', scenes: this.ctx.getWebSockets('scene').length }));
      return;
    }

    if (msg.type === 'cmd' && typeof msg.what === 'string') {
      const out = JSON.stringify({ type: 'cmd', what: msg.what.slice(0, 24), arg: String(msg.arg ?? '').slice(0, 64) });
      for (const s of this.ctx.getWebSockets('scene')) s.send(out);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const att = ws.deserializeAttachment() as Att;
    if (att.role === 'scene') this.presence(ws);
  }

  private panels(): WebSocket[] {
    return this.ctx.getWebSockets('panel').filter((p) => (p.deserializeAttachment() as Att).authed);
  }

  /** Tell signed-in panels how many crowd scenes (OBS sources) are listening. */
  private presence(closing?: WebSocket): void {
    const scenes = this.ctx.getWebSockets('scene').filter((s) => s !== closing).length;
    const out = JSON.stringify({ type: 'presence', scenes });
    for (const p of this.panels()) p.send(out);
  }
}

async function checkPassword(given: string, real: string | undefined): Promise<boolean> {
  if (!real) return false; // no password set: nobody gets in
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(given)), crypto.subtle.digest('SHA-256', enc.encode(real))]);
  return crypto.subtle.timingSafeEqual(a, b);
}
