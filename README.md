# I Gotta Stay Fly

A ridiculous, comfort-first WebXR flight playground for Meta Quest. Calibrate in any comfortable posture—including lying face-down in a Superman pose—then freely explore floating islands above the clouds.

This repository contains the first playable vertical slice:

- Objective-free exploration with no score, collectibles, timer, or finish line
- Floating waterfall islands, crystal pools, neon skylines, and tranquil tree groves
- Arm-driven Superman/Peter Pan flight with independent head tracking
- Neutral-head calibration designed for prone play
- Meta Quest controller input and desktop keyboard/mouse fallback
- First-person tapered arms, bending elbows, natural wrist/palm shapes, curled fingers and mirrored thumbs; no controller lasers
- A visible spherical flight boundary surrounding the landscape
- Comfort mode, dynamic vignette, pause, recalibration, restart, and finish flow
- Quest-visible in-world calibration and pause instructions
- Static production build and GitHub Pages deployment workflow

## Run locally

```bash
npm install
npm run dev
```

Open the printed local URL. Choose **Play on desktop**, set your neutral pose, then use:

| Input | Action |
| --- | --- |
| `Up arrow` | Accelerate |
| `Down arrow` | Brake |
| `W` / `S` | Pitch |
| `A` / `D` | Turn |
| `Shift` / `Space` / `Ctrl` | Alternate speed controls |
| Mouse after clicking the game | Gentle steering |
| `Esc` | Pause/resume |
| `R` | Recalibrate |

Hold **Shift, Space or Up** for fast flight: desktop top speed is **160 m/s (576 km/h)**, or **100 m/s (360 km/h)** with comfort mode on. Releasing acceleration returns to a 32/22 m/s cruise; **Ctrl or Down** brakes rapidly to 2.5 m/s. Acceleration, turning response and desktop-only field-of-view widening are tuned for high-speed traversal. VR speed and headset field of view are unchanged.

## One connected world

There is no environment selector or loading screen: all five districts coexist. From launch, **Neon City is ahead, Quiet Forest is to the right, Azure Falls is to the left, and Sky Harbor is beyond the city**. Wild Gardens sits beyond the falls. Broad, tree-lined land connections link the districts into one traversable landscape.

Fly toward the floating district signs (visible in desktop and VR). The desktop HUD shows your current district, speed in km/h, and arrows/distances to nearby districts; arrows are relative to the direction you are looking.

Cities have gentle rolling hills, while forests, falls and gardens have much taller hills and broad valleys. Roads and trails follow the terrain; buildings remain upright on level foundations, and trees/boulders sit on the slopes. Lake clearings and the approaches to inter-district paths stay level. Terrain geometry is generated once, not rebuilt during flight.

## Meta Quest controls

Open the deployed HTTPS URL in Meta Quest Browser and choose **Enter VR**.

| Input | Action |
| --- | --- |
| Raise and extend an arm | Smooth gradient from hover to half speed, following the shoulder-to-hand direction |
| Raise and extend both arms | Each arm contributes up to half speed; equal reaches average their directions centrally |
| Lower or retract your arms | Reduce speed continuously, including very slow movement just above the rest pose |
| Put both controllers at your calibrated rest position | Stop immediately and hover, without altitude drift |
| Turn or look around | Look freely; head movement does not steer flight |
| A/X while prompted | Calibrate or retry |
| Thumbstick click | Pause/resume |
| B/Y or grip while paused | Recalibrate |

Calibrate while looking ahead with **both arms at your sides**. This records your resting arm directions and estimates your reach. Seated, standing and prone play use the same controls. For prone play, get comfortable on a clear padded surface first. Raise and extend your arms to fly; lower or retract them to slow down. Your view follows the headset, so you can look elsewhere without changing course, then move your arms toward the new direction to steer there.

Steering uses a single spherical response that closes about 95% of the angle in 120 ms, including a full reversal. The rig never rotates toward the movement vector. Standard VR speed is up to 30 m/s with one arm and 60 m/s with two; comfort mode caps these at 21 and 42 m/s. Missing controller poses contribute no thrust.

## Build and deploy

```bash
npm run build
npm test
npm run preview
```

The production build is written to `dist/`. The included GitHub Actions workflow deploys that directory to GitHub Pages whenever `main` is pushed. In the repository settings, set **Pages → Source** to **GitHub Actions**.

WebXR requires a secure context. `localhost` works for desktop development; a Quest headset should use the deployed HTTPS URL.

## Quest verification checklist

The desktop build has been compiled and browser-tested. Before calling a release Quest-ready, verify on physical hardware:

1. Entering and exiting immersive VR from Meta Quest Browser.
2. Calibration while prone on the intended padded surface.
3. Slowly raise each arm from rest; test retraction, two-arm blending, hover, head-only turns, and abrupt direction changes.
4. Free flight around every island in both comfort and standard modes.
5. Sustained frame rate and comfort over multiple 2–5 minute runs.

Controller grip poses are sampled from the current XR frame. Left/right hand meshes are aligned to WebXR grip axes, with forearm roll following the wrists. Hands use a single merged mesh each to keep rendering overhead small. Shoulder orientation is fixed at calibration; elbows are inferred by a two-bone visual arm model because controllers do not track elbows or shoulders. Physical headset testing is still needed to judge comfort, body-size fit and sustained frame rate.

The city districts contain roughly 1 km of streets each, with windowed towers, sidewalks, roof equipment and open avenues. Forest islands span 1.4–1.6 km, with mixed broadleaf/conifer canopies, lakes and winding flight corridors. At moderate speed, crossing a district now takes tens of seconds. Opaque scenery is batched by material and 480 m area for spatial culling, with simpler foliage beyond 700 m. A 4,500 m radius sphere encloses the enlarged landscape.

`npm test` covers speed continuity, head/arm independence, calibrated coordinate agreement, 90°/180° turns at multiple frame rates, exact hover, boundary departure, arm geometry and world generation. `tests/preview.html` is a development-only scene/arm inspection page served by Vite; it is excluded from the production entrypoint.
