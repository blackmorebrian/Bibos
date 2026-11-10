/**
 * What goes on the LED wall. Three routes for the webcam spike:
 *  clip   - animated stand-in, uploaded every frame like real video (baseline)
 *  direct - getUserMedia on "OBS Virtual Camera" inside the browser source
 *           (OBS must be launched with --enable-media-stream)
 *  relay  - WebRTC from the Chrome sender page, signaled via the stress server
 */
import * as THREE from 'three';
import { params, signalUrl, type CamRoute } from './params';

export interface CamStatus { route: CamRoute; state: string; detail: string; devices: string[]; stats: string }

export class Webcam {
  readonly texture: THREE.Texture;
  readonly status: CamStatus = { route: params.cam, state: 'starting', detail: '', devices: [], stats: '' };
  private clipCanvas: HTMLCanvasElement | null = null;
  private clipCtx: CanvasRenderingContext2D | null = null;
  private video: HTMLVideoElement | null = null;
  private pc: RTCPeerConnection | null = null;

  constructor() {
    if (params.cam === 'direct' || params.cam === 'relay') {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.autoplay = true;
      this.video = v;
      const tex = new THREE.VideoTexture(v);
      tex.colorSpace = THREE.NoColorSpace;
      this.texture = tex;
      if (params.cam === 'direct') void this.startDirect();
      else this.startRelay();
    } else {
      const c = document.createElement('canvas');
      c.width = 640; c.height = 360;
      this.clipCanvas = c;
      this.clipCtx = c.getContext('2d')!;
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.NoColorSpace;
      this.texture = tex;
      this.status.state = params.cam === 'off' ? 'off' : 'ok';
      this.status.detail = params.cam === 'off' ? 'static' : 'test clip';
    }
  }

  private async startDirect(): Promise<void> {
    const st = this.status;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        st.state = 'error';
        st.detail = window.isSecureContext ? 'getUserMedia unavailable (launch OBS with --enable-media-stream)' : 'not a secure context: load via file:// or localhost';
        return;
      }
      // Labels are hidden until permission is granted once.
      let stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
      st.devices = devices.map((d) => d.label || d.deviceId.slice(0, 8));
      const want = devices.find((d) => d.label.toLowerCase().includes(params.camLabel.toLowerCase()));
      const current = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (want && want.deviceId !== current) {
        stream.getTracks().forEach((t) => t.stop());
        stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: want.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } } });
      }
      const track = stream.getVideoTracks()[0];
      const s = track.getSettings();
      st.detail = `${track.label} ${s.width}x${s.height}@${Math.round(s.frameRate ?? 0)}`;
      st.state = want ? 'ok' : 'warn: wanted device not found';
      this.video!.srcObject = stream;
      await this.video!.play();
    } catch (e) {
      st.state = 'error';
      st.detail = String((e as Error).message || e);
    }
  }

  private startRelay(): void {
    const st = this.status;
    const url = signalUrl();
    if (!url) { st.state = 'error'; st.detail = 'no signaling server (add ?server=host:port)'; return; }
    const connect = () => {
      st.state = 'connecting';
      const ws = new WebSocket(url);
      ws.onopen = () => { ws.send(JSON.stringify({ type: 'join', room: params.room, role: 'scene' })); st.state = 'waiting for sender'; };
      ws.onclose = () => { st.state = 'signal closed, retrying'; setTimeout(connect, 2000); };
      ws.onerror = () => { st.detail = 'signal error'; };
      ws.onmessage = async (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'offer') {
          this.pc?.close();
          const pc = new RTCPeerConnection({ iceServers: [] });
          this.pc = pc;
          pc.onicecandidate = (e) => { if (e.candidate) ws.send(JSON.stringify({ type: 'candidate', candidate: e.candidate })); };
          pc.ontrack = (e) => {
            this.video!.srcObject = e.streams[0] ?? new MediaStream([e.track]);
            void this.video!.play();
            st.state = 'ok';
          };
          pc.onconnectionstatechange = () => { st.detail = `pc ${pc.connectionState}`; };
          await pc.setRemoteDescription(msg.sdp);
          const ans = await pc.createAnswer();
          await pc.setLocalDescription(ans);
          ws.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription }));
        } else if (msg.type === 'candidate' && this.pc) {
          try { await this.pc.addIceCandidate(msg.candidate); } catch { /* ignore late candidates */ }
        }
      };
    };
    connect();
    setInterval(() => void this.pollStats(), 1000);
  }

  private lastStats: { t: number; frames: number; jb: number; jbn: number } | null = null;
  private async pollStats(): Promise<void> {
    if (!this.pc) return;
    const rep = await this.pc.getStats();
    rep.forEach((r) => {
      if (r.type === 'inbound-rtp' && r.kind === 'video') {
        const now = performance.now();
        const frames = r.framesDecoded ?? 0, jb = r.jitterBufferDelay ?? 0, jbn = r.jitterBufferEmittedCount ?? 0;
        if (this.lastStats) {
          const fps = ((frames - this.lastStats.frames) * 1000) / (now - this.lastStats.t);
          const jbMs = jbn > this.lastStats.jbn ? ((jb - this.lastStats.jb) / (jbn - this.lastStats.jbn)) * 1000 : 0;
          this.status.stats = `${r.frameWidth}x${r.frameHeight} ${fps.toFixed(0)}fps jitterbuf ${jbMs.toFixed(0)}ms dropped ${r.framesDropped ?? 0}`;
        }
        this.lastStats = { t: now, frames, jb, jbn };
      }
    });
  }

  /** Called every frame. The clip repaints and re-uploads to mimic video cost. */
  update(t: number, beat: number): void {
    const g = this.clipCtx;
    if (!g || params.cam === 'off') return;
    const W = 640, H = 360;
    g.fillStyle = '#3c1aa0';
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, H * 0.58);
    g.rotate(t * 0.18);
    g.fillStyle = '#6a2bd8';
    for (let i = 0; i < 12; i += 2) { g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 600, (i / 12) * Math.PI * 2, ((i + 1) / 12) * Math.PI * 2); g.closePath(); g.fill(); }
    g.restore();
    const bob = Math.pow(1 - (((beat % 1) + 1) % 1), 3) * 6;
    g.fillStyle = '#1a1358';
    g.beginPath(); g.moveTo(132, H); g.quadraticCurveTo(144, 248, 256, 228 + bob); g.lineTo(384, 228 + bob); g.quadraticCurveTo(496, 248, 508, H); g.closePath(); g.fill();
    g.fillRect(292, 200 + bob, 56, 40);
    g.beginPath(); g.arc(320, 160 + bob, 60, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#fffdf6'; g.lineWidth = 9;
    g.beginPath(); g.moveTo(259, 168 + bob); g.quadraticCurveTo(260, 86 + bob, 320, 86 + bob); g.quadraticCurveTo(380, 86 + bob, 381, 168 + bob); g.stroke();
    g.fillStyle = '#fffdf6';
    g.beginPath(); g.roundRect(245, 144 + bob, 25, 52, 10); g.roundRect(370, 144 + bob, 25, 52, 10); g.fill();
    g.fillRect(16, 16, 230, 40);
    g.fillStyle = '#1a1358';
    g.font = '400 24px "Bowlby One","Arial Black",sans-serif';
    g.textBaseline = 'middle';
    g.fillText('YOUR WEBCAM', 26, 37);
    g.font = '700 18px monospace';
    g.fillText((performance.now() / 1000).toFixed(2), W - 110, 37);
    this.texture.needsUpdate = true;
  }
}
