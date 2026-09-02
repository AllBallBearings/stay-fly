# I Gotta Stay Fly

A ridiculous, comfort-first WebXR flight playground for Meta Quest. Calibrate in any comfortable posture—including lying face-down in a Superman pose—then freely explore floating islands above the clouds.

This repository contains the first playable vertical slice:

- Objective-free exploration with no score, collectibles, timer, or finish line
- Floating waterfall islands, crystal pools, neon skylines, and tranquil tree groves
- Pose-driven Superman/Peter Pan flight with head-tilt roll
- Neutral-head calibration designed for prone play
- Meta Quest controller input and desktop keyboard/mouse fallback
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

## Meta Quest controls

Open the deployed HTTPS URL in Meta Quest Browser and choose **Enter VR**.

| Input | Action |
| --- | --- |
| Reach either controller away from your head | The arm immediately defines the next segment of your 3D flight path |
| Move the extended arm left/right/up/down | The virtual world follows that vector with a tightly smoothed turn |
| Reach both controllers | The farther-reaching controller sets direction; hands closer together increase speed |
| Bring both extended hands closer together | Fly faster |
| Put both controllers at your sides | Stop flight |
| Tilt your head left/right | Roll left/right without changing flight direction |
| Turn or look around | Look freely; head movement does not steer flight |
| A/X while prompted | Calibrate or retry |
| Thumbstick click | Pause/resume |
| B/Y or grip while paused | Recalibrate |

For prone play, lie on a clear padded surface before entering VR. Look in the direction that should feel like “forward,” rest your arms comfortably, and calibrate. Your extended arm acts like the roller-coaster track immediately in front of you: move it through 3D space to set the next flight vector, while your body stays still. Set both controllers down at your sides to stop.

## Build and deploy

```bash
npm run build
npm run preview
```

The production build is written to `dist/`. The included GitHub Actions workflow deploys that directory to GitHub Pages whenever `main` is pushed. In the repository settings, set **Pages → Source** to **GitHub Actions**.

WebXR requires a secure context. `localhost` works for desktop development; a Quest headset should use the deployed HTTPS URL.

## Quest verification checklist

The desktop build has been compiled and browser-tested. Before calling a release Quest-ready, verify on physical hardware:

1. Entering and exiting immersive VR from Meta Quest Browser.
2. Calibration while prone on the intended padded surface.
3. Single-arm direction, two-hand speed, hands-down stopping, head-tilt roll, pause, and recalibration on both controllers.
4. Free flight around every island in both comfort and standard modes.
5. Sustained frame rate and comfort over multiple 2–5 minute runs.

The controller positions and pointing rays are sampled every XR frame. This still needs real-device tuning for reach thresholds and speed on different body sizes and play postures.
