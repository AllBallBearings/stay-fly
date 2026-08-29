# I Gotta Stay Fly

A ridiculous, comfort-first WebXR flight playground for Meta Quest. Calibrate in any comfortable posture—including lying face-down in a Superman pose—then freely explore floating islands above the clouds.

This repository contains the first playable vertical slice:

- Objective-free exploration with no score, collectibles, timer, or finish line
- Floating waterfall islands, crystal pools, neon skylines, and tranquil tree groves
- Smoothed acceleration, braking, yaw, and pitch with no forced roll
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
| `Shift` or `Space` | Accelerate |
| `Ctrl` | Brake |
| `W` / `S` | Pitch |
| `A` / `D` | Turn |
| Mouse after clicking the game | Gentle steering |
| `Esc` | Pause/resume |
| `R` | Recalibrate |

## Meta Quest controls

Open the deployed HTTPS URL in Meta Quest Browser and choose **Enter VR**.

| Input | Action |
| --- | --- |
| Trigger | Accelerate |
| Grip | Brake |
| Thumbstick | Turn and pitch |
| A/X while prompted | Calibrate or retry |
| Thumbstick click | Pause/resume |
| B/Y or grip while paused | Recalibrate |

For prone play, lie on a clear padded surface before entering VR. Look in the direction that should feel like “forward,” rest your arms comfortably, and calibrate. The game measures subsequent head motion relative to that pose rather than assuming the player is upright.

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
3. Trigger, grip, thumbstick, pause, and recalibration mappings on both controllers.
4. Free flight around every island in both comfort and standard modes.
5. Sustained frame rate and comfort over multiple 2–5 minute runs.

Hand-position throttle is intentionally not part of this first controller-driven slice. The next milestone is hand tracking with graceful loss-of-tracking behavior, after real-device tuning of the core flight model.
