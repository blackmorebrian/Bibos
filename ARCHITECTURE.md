# Bibos: Architecture and v1 Build Order

Proposal, 2026-11-08. Builds on `BIBOS-BRIEF.md`. Nothing here is built yet.

## Confirmed setup (answers to the brief's open questions)

| Question | Answer | Consequence |
|---|---|---|
| Stream PC OS | Windows | OBS browser source is CEF on Windows, so WebGL runs through ANGLE on D3D11. |
| GPU / encoder | NVIDIA, NVENC | Encoding runs on the NVENC block, but the scene still shares GPU time with OBS compositing. The stress test measures that. |
| Webcam | Plugged into the stream PC | The brief's path works: OBS Virtual Camera, then a Chrome sender page, then WebRTC into the scene. |
| DJ software | Serato DJ | Not integrated. Beat comes only from tap tempo. |
| Energy source | Chat and emotes only (decided 2026-11-08) | No Ableton Link and no OBS volume metering. Crowd energy comes from chat hype plus the DJ's Drop and Lights down. |

Development happens on the Mac. Testing happens on the Windows stream PC, which loads each build from a URL (see Stress test).

## Stack

**Language:** TypeScript everywhere, in one npm-workspaces monorepo. The avatar schema, network protocol, beat clock and hype scoring are shared code, so the scene, server and phone can't disagree about them.

```
packages/shared     avatar schema + presets, protocol types, beat clock, hype scoring, profanity filter
packages/bibo-art   paper-piece drawing → texture atlas (used by scene AND phone preview)
apps/scene          OBS browser source: Three.js renderer
apps/viewer         phone site: login, builder, action/emote buttons
apps/panel          DJ tablet panel
apps/webcam-sender  tiny Chrome page: Virtual Camera → WebRTC
apps/server         realtime server + Twitch integration + persistence
```

### Crowd scene: Three.js (WebGL2)
Chosen on merit over PixiJS and over keeping Canvas 2D:
- The world is truly 3D: a perspective camera with shots, push-ins and occlusion. Three.js gives a real camera and depth buffer. PixiJS is 2D and would mean hand-rolling the projection again, like the prototype does.
- The webcam becomes a `VideoTexture` on a plane, so it sits in correct perspective. That fixes the prototype's Canvas 2D mismatch.
- **Instanced, GPU-animated Bibos.** Each Bibo is a few instanced billboard quads (body, head, two arms, held prop) sampling one texture atlas. Per-instance data covers position, atlas cell, palette indices, beat offset, amplitude, and current action plus start time. The vertex shader computes hop, squash and stretch, lean, paper flip and arm poses from a shared beat uniform. The CPU only writes an instance attribute when a Bibo's state changes, not every frame. That should scale well past 500.
- **Recolor in the shader.** Atlas pieces are painted as channel masks (R = body color, G = shirt, B = accent) and the shader looks up the palette. Colors need no extra art, as the brief requires.
- **Art pipeline.** v1 renders the prototype's code-drawn pieces into the atlas at startup, ported into `bibo-art`. Later the real 30–40-piece art kit (SVG/PNG) drops into the same atlas layout, and no renderer code changes.
- The filler sea is an instanced quad field at lower resolution. Beams and pools are additive meshes, emotes and confetti are instanced particles, and text (names, meter, banner) uses an SDF text library (troika-three-text).
- The scene is plain Three.js plus a small render loop, with no React Three Fiber. A long-running OBS source gains nothing from a component framework, and plain code keeps the per-frame budget easy to see.

### Viewer site and DJ panel: Vite + Preact
Both are small, touch-first UIs. Preact keeps the phone bundle tiny, which matters on venue-grade mobile data. The Bibo builder's preview uses the same `bibo-art` drawing code, so the phone shows exactly what appears on stream.

### Realtime server: Node + `ws` on Fly.io, SQLite for v1
- It is one long-lived process. That suits the persistent Twitch EventSub WebSocket (chat, bans) and a simple in-memory room per channel.
- **Rooms per channel** from day one, so multi-streamer support later is a deployment change, not a rewrite.
- **Persistence.** v1 uses SQLite on a Fly volume behind a small repository layer, holding viewers, their Bibos, bans and channel settings. It can move to Postgres when there's more than one streamer.
- **Fan-out.** Phones send actions as tiny JSON messages, and the server rate-limits per viewer. The server sends the scene batched deltas at about 15 Hz: joins, leaves, actions and emotes. It sends phones almost nothing, because phones animate their own actions instantly, as the brief requires.
- **Auth.** Twitch OAuth (authorization-code flow) runs server-side, with a signed session cookie. The name-only join gets the same session type plus the profanity filter.
- A considered alternative was Cloudflare Durable Objects, which map neatly onto one object per room. I'm not choosing them for v1, because holding an outbound EventSub socket is clumsier there. Rooms are already the unit, so moving later stays possible.

### Beat, energy and clocks
- **Tap tempo** happens on the tablet. The tablet and the scene both sync to server time with an NTP-style ping exchange, so a downbeat tapped on the tablet lands in phase in the scene. Nudge adjusts the phase in ±10 ms steps. The beat clock lives in `shared`.
- There is no stream-delay problem for the beat. The scene and the audio both go through OBS together, so they reach viewers in sync.
- **Energy comes from chat, not audio.** There is no volume metering and no Ableton Link. The formula becomes `energy = max(0.22, chatEnergy) + dropBoost`, with the chat weight retuned so a busy chat alone reaches full energy. Breakdowns get their calm from Lights down, which already dims the room and lowers movement.
- With no Link, the native helper from the brief isn't needed at all.

### Webcam on the LED wall
The video is drawn as a `VideoTexture` inside the scene, because the camera moves and the crowd stands in front of the wall. A plain OBS layer can't do that. OBS Virtual Camera is set to output **only the webcam source** (OBS 30+), never the program, to avoid a feedback loop.

Routes, in order of preference (to be decided by the stress-test spike on the stream PC):

1. **Direct (preferred).** The scene's browser source calls `getUserMedia` on the "OBS Virtual Camera" device. It needs a one-time `--enable-media-stream` flag on the OBS shortcut. There's no extra window, no WebRTC encode, and no signaling, and the latency should be about one frame. It opens the Virtual Camera rather than the physical webcam, so it shouldn't fight OBS for the device. *Unverified:* that the browser source can read the Virtual Camera while OBS holds the webcam, and how reliable the flag is in current OBS.
2. **Relay (fallback).** A Chrome page on the stream PC (`apps/webcam-sender`) opens the Virtual Camera and sends it to the scene over WebRTC, using the server room for signaling. This is a proven pattern (VDO.Ninja). It costs an extra window that may be throttled when minimized, plus an encode and decode with roughly 100–200 ms of delay.
3. **Screenshot (last resort).** obs-websocket `GetSourceScreenshot` at about 10–15 fps. Choppy and CPU-heavy.

Whichever route wins, check that the DJ's hands on the wall don't visibly lag the music. If they do, a small audio sync offset on the mixer input in OBS fixes it.

### Failure isolation
- Music never passes through any of this. If the scene crashes, only a browser source dies, and OBS keeps the audio.
- The scene keeps rendering an idle filler crowd if the server or webcam drops, and reconnects with backoff.
- Watch item for the stress test: a heavy browser source can starve OBS compositing and cause "skipped frames due to rendering lag" even with NVENC. The scene gets a hard budget, and quality settings can be lowered from URL params.

## v1 build order

Each step ends with something runnable.

0. **Repo scaffold.** Monorepo, TypeScript, lint and format, shared types.
1. **500-Bibo stress test in OBS** *(the gate)*. Details below. Nothing visual gets built out until it passes.
2. **Scene core.** Port the stage, sea, lights, camera shots, auto-director, Drop and Lights down into Three.js, driven by a local fake input so it runs without a server.
3. **Server + DJ panel.** *(Replaced 2026-11-09: no server. The DJ panel is Stream Deck "Chat Message" keys sending `!dj drop`, `!dj lights down|up`, `!dj hype`, `!dj bpm 128`, `!dj beat` (press on a downbeat; `?beatlag=` compensates for chat latency, default 0.3 s), `!dj nudge ±ms`, `!dj cam wide|sweep|over|close|back|auto`, `!dj look auto|fan|cross|chase|wave|pulse`, `!dj kick name`, `!dj help`. Only you and your mods can use them.)* Original plan: Rooms, clock sync, tap tempo, nudge, Drop, Lights down, shots and light looks, wired into the scene.
4. ~~**Viewer site.**~~ *Dropped 2026-11-09: chat-only. Viewers join and customize by Twitch chat (`!bibo frog crown pink`, `!head`, `!hat`, `!color`, `!shirt`, `!extra`, `!pattern`, `!random`), with looks saved per viewer. A commands card shows every 10 minutes, on `!bibohelp` (90 s cooldown; mods skip it), or on the C key. A Twitch Extension panel is the follow-up if viewers want buttons.* Original plan: Name-only join first, then Twitch OAuth, the builder, actions and emotes, persistent Bibos. Real viewers replace NPCs in the front rows.
5. **Twitch chat.** *(Early version done 2026-11-09: the scene reads chat directly and anonymously over Twitch IRC (`?channel=`), with `!bibo` and action commands, real emotes floating from heads, hype relative to the channel's rolling average, bots ignored, bans/timeouts removing the Bibo, and joined viewers kept across reloads. It moves to the server and EventSub when the server exists.)* Full version: EventSub chat messages, the channel's real emotes floating over senders, the hype meter with the brief's scoring rules (rolling channel average, counted per person, bots ignored), crowd waves, `!bibo`, removal of banned users, and "kick user" on the panel.
6. **Webcam on the LED wall**, productionizing whichever route won the step 1 spike, with the others kept as fallbacks.
7. **Full dress rehearsal.** A real set on a private or unlisted stream, the bot swarm at 500 and more, and a check of the reconnect paths.

Item 8 in the brief's suggested scope (the stress test) moves to step 1, as you asked. Item 5 (OBS WebSocket volume input) is dropped.

## Step 1: the stress test, in detail

**What it renders:** an instanced Bibo crowd (default 500, set with `?n=`) using the real rig, meaning the shader animation, atlas and palette recolor. It also renders the filler sea, a placeholder stage with a video texture on the wall (a looping test clip stands in for the webcam), additive light beams, floating emote particles, name labels for recent emoters, the hype meter, and the five camera shots on the auto-director. A simulated chat and action storm runs on top, tunable from URL params.

**Webcam spike:** a `?cam=` switch picks what goes on the LED wall:
- `?cam=clip` (default): a looping test video. This is the baseline.
- `?cam=direct`: `getUserMedia` on the OBS Virtual Camera from inside the browser source (needs `--enable-media-stream`). The HUD lists the available video devices, so it's clear whether the device shows up at all.
- `?cam=relay`: WebRTC from a minimal Chrome sender page, signaled through a throwaway relay. A tiny WebSocket signaling script runs alongside the test.

For each route, record: whether it works at all, the frame-time cost compared with `clip`, the delay (wave a hand next to a visible clock, or clap on a mic, and compare the frames), and for `relay`, whether it degrades when the Chrome window is minimized.

**Instrumentation:** an optional HUD (`?hud=1`) shows the frame-time histogram, p50/p95/p99, draw calls, triangles and GPU timer queries where supported. A `?bench=60` mode runs a fixed 60-second camera path and prints a summary line to copy back.

**How you run it:** I deploy the static build to a URL. A Vite dev server on the Mac's LAN IP also works. Then you add an OBS browser source at 1920×1080 with "Control audio via OBS" off and the FPS set to your stream FPS.

**Pass criteria, measured in OBS while recording or streaming with NVENC:**
- The scene holds your stream FPS at 500 Bibos, with p99 frame time under the frame budget.
- OBS stats show no increase in "rendering lag" or "encoding lag" skipped frames compared with the same scene without the source.
- It runs for 30 minutes with no memory growth.
- Headroom: report the results at 1,000 and 2,000 Bibos too.
- Baseline: run the current Canvas 2D prototype in the same browser source, for comparison.
- Webcam: at least one of `direct` or `relay` works at 500 Bibos within the same budget. Pick the route with the lowest delay that passes.
