/**
 * Link to the control hub, so a light designer's panel (password-locked on
 * the hub side) can run the show. Listens for commands and reports what's live.
 */
import { S, clock, crowd, live } from './sim';
import { params } from './params';
import { applyCommand, joinedCount, HELP_SECONDS } from './viewers';

export interface HubStatus { state: string }

/** Bump when the desk needs something new from the crowd; the desk asks for a refresh of older ones. */
export const CROWD_VERSION = 3;

export function connectHub(): HubStatus {
  const status: HubStatus = { state: 'off' };
  if (!params.hub || !params.channel) return status;
  let ws: WebSocket | null = null, retry = 1000, pingT = 0;

  // Each crowd (e.g. a widescreen and a vertical OBS source) reports separately; the desk
  // follows one of them so its buttons don't flicker between the two.
  const id = Math.random().toString(36).slice(2, 10);
  const report = () => {
    if (ws?.readyState !== 1) return;
    const L = S.ld;
    ws.send(JSON.stringify({
      type: 'state', v: CROWD_VERSION, id, layout: innerHeight > innerWidth ? 'vertical' : 'wide', look: S.look, chase: S.chase, colors: L.colors, intensity: L.intensity, glow: L.glow, speed: L.speed, lasers: L.lasers,
      strobe: L.strobe, strobeRate: L.strobeRate, blackout: L.blackout, lights: S.lights, bpm: clock.bpm, shot: S.shot, auto: S.auto,
      zoom: S.zoom, pan: S.cam.panX, height: S.cam.panY, pace: S.cam.pace, screens: S.screens.mode, helpUp: S.t - S.helpAt < HELP_SECONDS, helpEvery: S.helpEvery, screenText: S.screens.text,
      viewers: live ? joinedCount() : crowd.length,
    }));
  };

  const connect = () => {
    status.state = 'connecting';
    const sock = new WebSocket(`${params.hub}/ws?room=${encodeURIComponent(params.channel)}&role=scene`);
    ws = sock;
    sock.onopen = () => {
      status.state = 'connected'; retry = 1000; report();
      clearInterval(pingT);
      pingT = window.setInterval(() => sock.readyState === 1 && sock.send('ping'), 25000);
    };
    sock.onmessage = (ev) => {
      if (ev.data === 'pong') return;
      try {
        const m = JSON.parse(ev.data);
        if (m.type === 'cmd') { applyCommand(String(m.what), String(m.arg ?? ''), 0.08); report(); }
      } catch { /* ignore junk */ }
    };
    sock.onclose = () => {
      clearInterval(pingT);
      status.state = `offline, retrying in ${Math.round(retry / 1000)}s`;
      setTimeout(connect, retry);
      retry = Math.min(30000, retry * 2);
    };
  };
  connect();
  setInterval(report, 1000);
  return status;
}
