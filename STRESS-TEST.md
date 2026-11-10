# Bibos stress test: running it in OBS on the stream PC

> **Result, 2026-11-09 (RTX 3070, Aitum Vertical OBS, NVENC live):** 500 Bibos at 30 fps, 0–2 long frames per 1,740, GPU p50 ~0.6 ms. Webcam route A (direct, `--enable-media-stream` + `file:///` URL) works live. Relay route not needed.

Goal: prove 500 Bibos hold a solid frame rate as an OBS browser source at 1920×1080 **while you stream** (NVENC encoding, Serato running), and pick the webcam route.

## 1. Start the server (dev Mac or the stream PC)

```bash
npm install
npm run stress
```

This builds the scene and the webcam sender, then starts the server on port 8787 and prints LAN URLs, for example `http://192.168.86.52:8787/`. Everything below uses `HOST` for that `ip:port`.

The server also:
- saves each benchmark result to `results/<time>_n<N>_<cam>_<tag>.json` and prints a summary line
- prints any JavaScript errors from the OBS page (so you can see OBS-side failures on the Mac)
- relays WebRTC signaling for the relay webcam route

> Windows firewall: the first time, allow Node on private networks. If OBS can't load the URL, that is usually why.

## 2. Performance run (no webcam)

In OBS, add a **Browser** source:
- URL: `http://HOST/?n=500&bench=60&tag=pc-500`
- Width 1920, height 1080, FPS **60** (tick "Use custom frame rate" and set 60)
- Untick "Shutdown source when not visible"

The page plays a scripted 60-second loop (every camera shot, a drop, lights down, the hype finale, a wave, close-ups), then shows a **BENCH DONE** box and posts the numbers to the server.

Run it **while streaming or recording with NVENC** (a private/unlisted stream or a local recording is fine), with Serato open and playing. That's the real load.

Then repeat with `n=1000&tag=pc-1000` and `n=2000&tag=pc-2000` to see the headroom.

**Pass criteria (500 Bibos):**
| Metric | Pass |
|---|---|
| frame ms p95 | ≤ 18 ms (60 fps with little jitter) |
| long frames | < 1% of frames |
| gpu ms p95 | ≤ 8 ms (leaves room for OBS + NVENC) |
| OBS stats: "frames missed due to rendering lag" | stays at 0 |
| OBS stats: "skipped frames due to encoding lag" | stays at 0 |

Check OBS's own stats too (View → Stats).

**Soak:** `http://HOST/?n=500&bench=1800&tag=pc-soak` runs 30 minutes. Watch for frame time drifting upward or heap growing in the summary.

**Optional baseline:** load `bibos-prototype.html` as a local-file browser source for comparison. It's the old Canvas 2D version.

Manual controls: right-click the source → **Interact**, then use 1–5 for shots, 0 for auto, D drop, L lights, H hype, W wave, J everyone acts, T tap tempo, +/- 100 Bibos, U toggle HUD. Add `&hud=1` to the URL to keep the stats HUD visible.

## 3. Webcam spike: three routes, test the first two

The scene puts your webcam on the big stage screen. Start **OBS Virtual Camera** (Controls → Start Virtual Camera), so the camera image comes through OBS (cropped and color-corrected as usual).

### A. Direct (preferred): the browser source opens the virtual camera itself

An OBS browser source only gets camera access when (1) the page is a secure context and (2) OBS is started with a flag.

1. Download `http://HOST/download/bibos-scene.html` and save it on the stream PC, for example `C:\bibos\bibos-scene.html`.
2. Close OBS. Make a copy of its shortcut, open Properties, and append this to **Target**:
   `--enable-media-stream`
   (If camera access still fails, also try `--use-fake-ui-for-media-stream`.)
3. In the browser source, tick **Local file** off (OBS serves "Local file" pages from `http://absolute/`, which is NOT a secure context, so the camera is blocked) and use the URL field. The downloaded file already has `cam=direct`, `hud=1` and `server=` baked in, so the bare path is enough; no quotes, forward slashes:
   `file:///C:/bibos/bibos-scene.html?cam=direct&server=HOST&hud=1`
   The `server=` part sends logs and results back to the server.
4. The HUD's `cam direct:` line shows the state and the list of cameras it found. If the camera isn't named "OBS Virtual Camera", add `&camLabel=<part of its name>`.

Known risk: the virtual camera feeding a source inside the same OBS can produce a feedback loop if the Bibos scene is in the program output. Fix: set the Virtual Camera output to **Source → your webcam source** (OBS 30+), not the whole program.

### B. Relay (fallback): a Chrome tab sends the camera over WebRTC

1. Download `http://HOST/download/bibos-sender.html` and open it in **Chrome** on the stream PC as
   `file:///C:/bibos/bibos-sender.html?server=HOST`
   Pick "OBS Virtual Camera" (or the webcam directly) and press Start.
2. Browser source URL: `http://HOST/?cam=relay&hud=1`
3. The HUD's `webrtc:` line shows fps, jitter buffer and dropped frames.
4. **Minimize the sender window** and confirm the stage screen keeps updating. Chrome may throttle hidden tabs.

### C. Last resort: plain OBS screenshot
Turn the webcam off in the scene (`cam=off`) and put the normal webcam source on top of the stage screen in OBS. It always works, but it doesn't follow the 3D camera moves.

### Measure latency for A and B
Put your normal webcam source next to the Bibos source in OBS, clap, and record 10 seconds. Step through the recording frame by frame and count the frames between the two claps (1 frame = 16.7 ms at 60 fps).

Also run `?n=500&bench=60&cam=direct&tag=pc-direct` (route A, file URL) and `?n=500&bench=60&cam=relay&tag=pc-relay` (route B) so we can see what each route costs in frame time.

## 4. What to send back

- The `results/*.json` files (or the BENCH DONE box screenshots if the server wasn't reachable)
- OBS's Stats panel screenshot during a 500 run
- For each webcam route: whether it worked, the latency in frames, and anything odd
- The GPU model (the HUD and results include it)
