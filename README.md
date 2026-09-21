# Stay Fly

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
| Mouse after clicking the game, or arrow keys | Direct steering: up climbs, down dives; never inverted |
| `W` / `S` | Increase / decrease the selected speed; release to hold it |
| `A` / `D` | Alternative left / right steering |
| Hold `Shift` | Boost to maximum speed; release to return to selected speed |
| Hold `Space` | Brake to a true hover; release to return to selected speed |
| Hold `Q` / `E` | Bank left / right; release to level in Assisted mode |
| Double-tap `Q` / `E` | One full left / right roll in Assisted mode |
| Hold `Alt` + mouse | Look around without steering; release to smoothly recenter the view |
| `Esc` | Pause/resume |
| `R` | Recalibrate |

Hold **Shift** for fast flight: desktop top speed is **160 m/s (576 km/h)**, or **100 m/s (360 km/h)** with comfort mode on. W/S adjusts a persistent speed setting, initially 20% (32/20 m/s); Space brakes to zero. Mouse displacement aims directly with a short smoothing response rather than lingering turn inertia. Banking does not invert steering. Desktop-only field-of-view widening reinforces speed; headset field of view is unchanged. Focus loss and mouse capture loss pause desktop flight and clear held inputs.

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
| Tilt head right + lower right hand / raise left | Bank right; reverse the gesture for left |
| Hold a matching head/hand tilt | Bank smoothly; relaxing the tilt levels you again |
| A/X while prompted | Calibrate or retry |
| Thumbstick click | Pause/resume |
| B/Y or grip while paused | Recalibrate |

VR calibration has two steps: first look ahead with **both arms at your sides** and press A/X to set hover; then extend both arms **straight ahead, hands level**, and press A/X again. One-arm calibration also works. The second pose captures your actual controller-to-shoulder reach and, with both hands, your neutral hand-height offset. Seated, standing and prone play use the same controls. For prone play, get comfortable on a clear padded surface first. Raise and extend your arms to fly; lower or retract them to slow down. Your view follows the headset, so you can look elsewhere without changing course, then move your arms toward the new direction to steer there.

Steering uses a single spherical response that closes about 95% of the angle in 120 ms, including a full reversal. The rig never rotates toward the movement vector. Standard VR speed is up to 70 m/s with one arm and 140 m/s with two; comfort mode caps these at 35 and 70 m/s. Calibrated reach enters a forgiving full-speed plateau at 86% of the captured arm length, avoiding frame-to-frame under-reading at physical full extension. Missing controller poses contribute no thrust.

### Banking and collisions

Small matching head/hand tilts set a bank angle up to 35° (20° in comfort mode). Relax to level out. Both arms must be lifted and generally pointing together; head tilt alone, one arm resting, opposing gestures and small tracking jitter do not trigger banking. Head tilt reaches full input at 25°, and the hand line at 30°; do not strain your neck. VR tilt is bank-only and never triggers a barrel roll.

Solid terrain, buildings, rocks and trees use swept collision checks so high-speed movement cannot simply tunnel through them. Impacts reflect along the surface angle and substantially reduce speed; clouds, mist, waterfalls and water remain pass-through.

## Experimental desktop webcam flight

The landing screen includes an opt-in **Test webcam tracking** check. It runs MediaPipe Pose, Face and Hand models locally in a worker, requests no microphone, and does not upload or record frames. Once tracking is stable, choose **Use webcam to fly**. One click begins a hands-free calibration: first hold both open palms beside your shoulders for hover, then close both hands into fists and extend both arms toward the screen for full reach. During flight, a closed fist drives its arm and either clearly open palm stops and hovers immediately.

One closed fist supplies up to half speed and two supply full speed. Moving the active arms left/right turns continuously in that direction; return them to the calibrated center to hold the new heading. Moving them up climbs and down dives. Showing either open palm, retracting both arms, losing tracking, or holding Space produces an exact hover. Head movement never steers; matching head tilt and opposite hand heights control assisted banking. Webcam full rolls remain disabled for this prototype. Esc pauses, and webcam mode never captures the mouse pointer.

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
   Test small matching banks, neutral recovery, one deep-gesture roll, retrigger lockout, hover mid-roll, and both roll settings. Confirm looking around alone never rolls or steers.
4. Free flight around every island in both comfort and standard modes.
5. Sustained frame rate and comfort over multiple 2–5 minute runs.

Controller grip poses are sampled from the current XR frame. Left/right hand meshes are aligned to WebXR grip axes, with forearm roll following the wrists. Hands use a single merged mesh each to keep rendering overhead small. Shoulder orientation is fixed at calibration; elbows are inferred by a two-bone visual arm model because controllers do not track elbows or shoulders. Physical headset testing is still needed to judge comfort, body-size fit and sustained frame rate.

The city districts contain roughly 1 km of streets each, with windowed towers, sidewalks, roof equipment and open avenues. Forest islands span 1.4–1.6 km, with mixed broadleaf/conifer canopies, lakes and winding flight corridors. At moderate speed, crossing a district now takes tens of seconds. Opaque scenery is batched by material and 480 m area for spatial culling, with simpler foliage beyond 700 m. A 4,500 m radius sphere encloses the enlarged landscape.

`npm test` covers speed continuity, head/arm independence, calibrated coordinate agreement, 90°/180° turns, bank/stunt state transitions at multiple frame rates, roll pivot/heading preservation, hover recovery, keyboard/mouse mappings and free look, boundary departure, arm geometry and world generation. `tests/preview.html` adds synthetic head tilt, hand poses, roll settings and bank/roll/hover presets; it is development-only and excluded from the production entrypoint.
