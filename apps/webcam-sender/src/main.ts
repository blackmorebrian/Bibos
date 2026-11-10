/** Relay route sender: OBS Virtual Camera -> WebRTC -> crowd scene. */
const q = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const devSel = $<HTMLSelectElement>('dev');
const serverIn = $<HTMLInputElement>('server');
const video = $<HTMLVideoElement>('v');
const logEl = $<HTMLPreElement>('log');
const want = (q.get('camLabel') ?? 'OBS Virtual Camera').toLowerCase();
serverIn.value = q.get('server') ?? (location.protocol.startsWith('http') ? location.host : '');
const room = q.get('room') ?? 'stress';

const lines: string[] = [];
function log(s: string): void {
  lines.push(`${new Date().toLocaleTimeString()}  ${s}`);
  if (lines.length > 14) lines.shift();
  logEl.textContent = lines.join('\n');
}

let stream: MediaStream | null = null;
let pc: RTCPeerConnection | null = null;
let ws: WebSocket | null = null;

async function listDevices(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    log(window.isSecureContext ? 'getUserMedia unavailable' : 'Not a secure context. Open this page from file:// or localhost.');
    return;
  }
  const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
  tmp.getTracks().forEach((t) => t.stop());
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  devSel.innerHTML = '';
  for (const d of devs) {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || d.deviceId.slice(0, 8);
    if (d.label.toLowerCase().includes(want)) o.selected = true;
    devSel.appendChild(o);
  }
  log(`found ${devs.length} cameras`);
}

async function openCamera(): Promise<void> {
  stream?.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: devSel.value }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } },
  });
  video.srcObject = stream;
  const s = stream.getVideoTracks()[0].getSettings();
  log(`camera ${s.width}x${s.height}@${Math.round(s.frameRate ?? 0)}`);
}

async function negotiate(): Promise<void> {
  if (!stream || !ws) return;
  pc?.close();
  pc = new RTCPeerConnection({ iceServers: [] });
  const track = stream.getVideoTracks()[0];
  track.contentHint = 'motion';
  const sender = pc.addTrack(track, stream);
  pc.onicecandidate = (e) => { if (e.candidate) ws!.send(JSON.stringify({ type: 'candidate', candidate: e.candidate })); };
  pc.onconnectionstatechange = () => log(`peer ${pc!.connectionState}`);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const p = sender.getParameters();
  if (!p.encodings?.length) p.encodings = [{}];
  p.encodings[0].maxBitrate = 8_000_000;
  p.degradationPreference = 'maintain-framerate';
  await sender.setParameters(p).catch(() => {});
  ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }));
  log('offer sent');
}

function connect(): void {
  const host = serverIn.value.trim();
  if (!host) { log('enter the stress server host:port'); return; }
  ws = new WebSocket(`ws://${host}/signal`);
  ws.onopen = () => { ws!.send(JSON.stringify({ type: 'join', room, role: 'sender' })); log('signaling connected'); };
  ws.onclose = () => { log('signaling closed, retrying in 2 s'); setTimeout(connect, 2000); };
  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'peers' && msg.roles.includes('scene')) void negotiate();
    else if (msg.type === 'joined' && msg.role === 'scene') void negotiate();
    else if (msg.type === 'answer' && pc) { await pc.setRemoteDescription(msg.sdp); log('connected to scene'); }
    else if (msg.type === 'candidate' && pc) { try { await pc.addIceCandidate(msg.candidate); } catch { /* late */ } }
  };
}

$('go').addEventListener('click', async () => {
  try { await openCamera(); connect(); } catch (e) { log(String(e)); }
});
listDevices().then(() => { if (q.has('auto')) $('go').click(); }).catch((e) => log(String(e)));
