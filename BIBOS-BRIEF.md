# Bibos: Project Brief

Build brief for a virtual festival crowd for DJ livestreams. `bibos-prototype.html` is a working visual mockup of the concept and is the reference for look and behavior.

## The idea

A DJ streams a set to Twitch. Viewers open a website on their phone, build a paper-cutout character called a **Bibo**, and join a virtual festival crowd shown on stream. They clap, dance, wave flags, and send emotes that float up from their Bibo's head. The DJ appears on a giant screen on the main stage, in the style of Fortnite's digital concerts. There is no DJ character on stage.

The pitch: anyone can headline their own main stage.

## Who runs what

The DJ uses two computers. The DJ computer plays music into a mixer, and the mixer feeds the stream PC. **The DJ computer runs nothing from this project.**

| Piece | Where it runs | What it does |
|---|---|---|
| Crowd scene | One OBS browser source on the stream PC, 1920x1080 | Renders the stage, crowd, camera, lights, and hype meter |
| DJ control panel | Web page on a tablet (or Stream Deck) | Tap tempo, Drop, Lights down, camera shots, light looks, moderation |
| Viewer site | Hosted, phone-first website | Login, Bibo builder, emote and action buttons |
| Realtime server | Hosted | Passes avatars, actions, and control messages between the pieces |
| Webcam sender | Small page in regular Chrome on the stream PC | Sends the webcam to the crowd scene (see Webcam) |
| Native helper | Later, only if needed | Things browsers cannot do, such as Ableton Link |

A crash in the crowd scene must never affect the music.

## Decisions already made

### Look
- Flat, bold paper-cutout characters in a 3D world, with white cut-paper edges and flat colors. PaRappa the Rapper was the style inspiration. **No characters or assets from it.** Keep beanies off the hat list so the dog stays distinct.
- Night-time outdoor festival.
- Characters can read cute or edgy depending on what the viewer picks.
- A sea of muted filler people stretches to the horizon, so a small crowd still looks like a festival. Real viewers stand up front in full color.

### Bibo customization (prototype set)
- **Heads:** cat, dog, frog, moth, cactus, ghost, toaster, gremlin
- **Hats:** none, flower crown, bow, party hat, bucket hat, crown, headphones, mohawk, emo swoop, horns
- **Extras:** none, heart stickers, kandi, shades, face paint, spiked collar
- 8 body colors, 6 shirt colors, 3 shirt patterns. Recolor in code so colors need no extra art.
- Presets only. **No user uploads.**

### Animation
- Each Bibo is a stack of paper pieces. Motion is squash and stretch on the beat, arm poses, and paper flips. No frame-by-frame animation.
- Small random timing offset per Bibo so the crowd looks human and small drift is hidden.
- **Actions:** clap, phone up, lighter, jump, dance, wave flag. Animate instantly on the viewer's phone, because the stream runs several seconds behind.
- **Names** appear only when a Bibo emotes or the camera is close. The viewer's own name is always shown.

### Beat and energy
The crowd scene cannot hear the OBS mixer directly, so beat info arrives other ways:
1. **Tap tempo** on the tablet sets BPM and the downbeat, with a nudge control. This is v1 and may be all that is ever needed.
2. **OBS WebSocket volume levels** drive energy, so breakdowns feel calm and big moments hit.
3. **Ableton Link** is a possible later add. It only knows the Link session tempo, so it will not follow a DJ beatmatching by ear.

Layers: music volume is instant, chat is the slower overall mood, and viewer taps count too.

### Chat, emotes, and hype meter
- Emotes float up from over the sender's head. The real build uses the channel's actual Twitch emotes; the prototype's six are placeholders.
- A visible **hype meter** sits on stream. Chat fills it. When full: pyro, fireworks, everyone jumps, and a "CHAT EARNED THIS" banner.
- The meter also **powers the light rig**: fixtures switch on from the center outward as it climbs.
- The meter only ever fires visuals. Chat never controls the camera or the set.
- During Lights down, a full meter holds and shows a "ready" state, then fires when the lights return.
- Many people spamming the same emote triggers a wave through the crowd.
- Scoring rules: compare against the channel's own rolling average, count people rather than messages, cap each person per few seconds, ignore bots, weight emotes higher, and keep an energy floor so the crowd never looks dead.

Starting values from the prototype, all to be tuned against a real chat:
- 2-second cap per person
- Message worth 1, emote adds 1.5
- Heat decays with a 6-second time constant
- Energy = max(0.22, 0.55 x music + 0.6 x chat) + drop boost
- Meter change per second = chat^2.5 x 0.32 - 0.03
- Wave fires when one emote's decaying count exceeds 32% of crowd size, at most every 7 seconds

The prototype normalizes against crowd size. The real build should use the channel's rolling average.

### Camera
- An auto-director cuts between shots every few bars and pushes in on people who just emoted.
- **Shots:** DJ's view (looking out over the crowd), front row sweep, overhead, close-up, from the back (main stage).
- Manual drag to pan and zoom, plus shot buttons on the tablet.
- In close-ups, hide anyone standing between the camera and the target.
- Planned next: a **jumbotron** that cuts the LED wall to a viewer's Bibo for a few seconds.

### Stage and lights
- Giant LED screen showing the DJ's webcam, framed by chasing LED rings, with paper mountains behind that pop on the kick.
- Animated side panels with four patterns.
- CO2 jets, pyro, confetti, fireworks.
- Beams, crowd light pools, and laser fans. Looks: Fan, Cross, Chase, Wave, Pulse, on auto or chosen from the tablet.
- Palette changes every 8 bars.
- Lights down: room dims, lighters and phones come up in a wave.
- **No rapid full-screen strobing**, for photosensitive viewers and stream compression.

### Webcam on the LED wall
The webcam video is drawn as a texture in the crowd scene, so it moves with the camera and sits behind the crowd. OBS sees one browser source with the video already inside it.

Preferred path: `Webcam -> OBS -> Virtual Camera (set to output only the webcam source) -> small Chrome page -> WebRTC -> crowd scene -> OBS browser source`

- Virtual Camera must never output the full program, or it creates a feedback loop.
- Fallback: OBS WebSocket `GetSourceScreenshot`, which is simple but choppy.
- Avoid having the browser source open the camera itself. It needs a launch flag and forum reports are inconsistent.
- If the webcam source is hidden in the main scene, it may need "keep active" or to live in a separate scene.

### Platforms
- **Website first.** It works on any platform and any phone. Wrap the same pages as a Twitch Component Extension later, once people actually use it.
- Login: Twitch first, then Google, TikTok, and Facebook, plus "just pick a name" with a profanity filter.
- Chat commands such as `!bibo` and `!clap` are a bonus only. Twitch is the priority and YouTube has an official live chat API. TikTok appears to have only unofficial tools, and Instagram likely has nothing, so the website must work fully on its own.
- A QR code does not help someone watching on the phone they would scan with. Show a short, sayable URL on stream as well.
- Moderation: anyone banned from chat is removed from the crowd.
- Later: a dedicated vertical 9:16 scene for TikTok and Instagram, and a button that saves a vertical clip of a viewer's jumbotron moment.

## Suggested v1 scope
1. Viewer site: Twitch login plus name-only join, Bibo builder, action and emote buttons
2. Realtime server with persistent Bibos per viewer
3. Crowd scene in OBS: stage, filler crowd, NPCs that real viewers replace as they join
4. Tablet panel: tap tempo, nudge, Drop, Lights down, camera, light looks, kick user
5. OBS WebSocket volume input
6. Twitch chat reading: emotes, hype meter, `!bibo`
7. Webcam on the LED wall
8. Stress test with 500 fake Bibos **before** building out more visuals

Later: jumbotron, Twitch Extension, other login providers, vertical scene, multi-streamer accounts, billing.

## Technical notes on the prototype
- `bibos-prototype.html` is one self-contained page: hand-rolled perspective projection on Canvas 2D with cached sprites. There is no backend. Viewers and chat are simulated.
- It is throwaway reference code. Keep the look and behavior, and choose the real rendering stack on merit. WebGL (PixiJS or Three.js) is the obvious candidate, and it would also fix the screen texture not lining up perfectly in perspective, which is a Canvas 2D limit.
- All art is placeholder drawn in code. Real art needs a cohesive kit, roughly 30 to 40 pieces at minimum.

## Not yet verified
- Performance inside OBS's browser source alongside encoding. The prototype has only run in headless software rendering.
- The Virtual Camera to Chrome to WebRTC path has been reasoned through but not built. Also test whether a minimized Chrome window gets throttled.
- Current Twitch policy and API details. Re-check them when implementing.

## Open questions for Brian
- Which DJ software and controller? This decides whether Ableton Link is an option.
- Is the webcam plugged into the stream PC or the DJ computer? The plan assumes the stream PC.
- Is the stream PC Windows or Mac?

## Business and legal notes
Not legal advice. Get a lawyer before launching anything paid.
- **Do not use Tomorrowland, EDC, or Fortnite names, logos, or stage designs** in the product or marketing.
- **"Bibo" needs a trademark check.** A quick search found several US BIBO filings and a company called Bibos LLC. What they cover was not reviewed.
- **Music rights:** Twitch's DJ Program is opt-in and covers live streams, with revenue sharing on monetized streams. Clips and VODs are not covered, and it applies to Twitch only.
- **Monetization idea:** free for viewers, streamers pay monthly, with paid cosmetics and sponsored stages later. Stream Avatars, the closest competitor, is a one-time $14.99. Twitch Extensions restrict off-site shopping links, and viewer purchases in an Extension would likely go through Bits. A standalone website avoids this.
- **Validate first:** run it on Brian's own stream and measure how many viewers actually build a Bibo before investing in the business side.
