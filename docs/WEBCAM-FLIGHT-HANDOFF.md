# Webcam flight — implementation handoff

## Start here

Implement this plan in small, tested stages. Read this file first, then only the source files needed for the current stage. Do not reload the conversation or redesign the controls. Update the checklist and leave a short next-step note when stopping. No webcam implementation has been done yet.

Repository: `AllBallBearings/stay-fly`; workspace: `/Users/jaredgoolsby/Documents/ChatGPT/MetaQuestGames`; Vite + TypeScript + Babylon.js; GitHub Pages deployment. Planning snapshot: 2026-09-20, HEAD `c428f3c` **plus uncommitted work**.

**Important baseline:** this workspace already contains new `DesktopControls.ts`, `RollController.ts`, `VRRoll.ts`, and edits to FlightController, StarlightGame, types, AppUI, HTML/CSS, README and tests. They implement Assisted/Free roll and revised keyboard controls. Preserve them. A fresh checkout of `c428f3c` does NOT contain this baseline. If working elsewhere, obtain the whole working-tree snapshot, including untracked files, before implementation; do not reconstruct it from this plan.

Last checks: 29 regression checks passed; production build passed before the last small UI/docs edits. Browser verified pause settings and a synthetic VR bank. Later browser inspection was interrupted. Changes have NOT been committed, pushed or fully tested on Quest. Run checks again; do not treat the baseline as release-ready.

## 1. Confirmed product decisions

- Add an **optional desktop webcam input mode**; retain keyboard/mouse and real Quest/WebXR controls.
- Player sits a bit farther back, facing the monitor; head, shoulders, elbows and hands should fit in the camera view.
- Arms determine speed and steering. One extended arm with a closed hand: up to moderate/half speed. Two: up to full speed. Intermediate extension is a continuous slow-to-fast gradient. For webcam mode, either clearly open palm commands immediate hover.
- Steering is **turn-rate based**, not absolute world-space pointing: hold arms right to keep turning right; return to centered forward pose to stop turning and retain the new heading. Up climbs; down dives. No inverted controls.
- View faces the flight heading. **No head-controlled looking.** Head tilt contributes only to banking/roll, combined with matching hand-height difference. Head yaw/pitch never steer or move the view.
- Preserve the approved Assisted/Free concept: small matching gestures bank; deliberate deep gesture triggers a single Assisted roll; Free rotates while held. Arms continue steering during rotation.
- Task requested here was a plan for another model, NOT permission to activate the webcam during planning. Camera access must be opt-in at runtime.

### Proposed defaults — not separately confirmed by the user

Use these for the first prototype; expose tuning constants rather than inventing new behavior:

- Retain the existing desktop pitch cap (about ±89°); no pitch loops. Roll remains a separate axis; bank must not invert steering.
- Webcam starts in Assisted, **full rolls off** until explicitly enabled. This is webcam-specific; preserve other modes' preferences.
- Losing the required pose causes hover, with explicit neutral re-engagement rather than automatic takeoff. Details below.
- Use inferred pose depth for extension initially, gated by a real-camera validation milestone. If inadequate, report the failure and ask about an alternate speed gesture; do NOT silently substitute one.
- Webcam mode uses hand/finger landmarks. Two open palms beside the shoulders are the calibrated hover pose; closed hands/fists enable arm propulsion. Existing procedural arms may be reused for visuals; no detailed finger animation is required.
- Local processing only; no recording, uploads, face identification or microphone access. Chrome desktop first; test Safari separately. Do not claim unsupported browsers work.

## 2. Scope and implementation seams

| File | Responsibility |
| --- | --- |
| NEW `src/game/webcam/types.ts` | Serializable tracking samples, calibration, status and worker messages |
| NEW `src/game/webcam/WebcamTracker.ts` | Permission, video/worker lifecycle, timestamp/generation checks; no flight math |
| NEW `src/game/webcam/tracking.worker.ts` | MediaPipe Pose + Face inference; no game/render dependencies |
| NEW `src/game/webcam/WebcamControls.ts` | Pure landmarks → calibrated/filterable `FlightIntent`; no DOM/camera APIs |
| `src/game/StarlightGame.ts` | Explicit keyboard/webcam mode selection, calibration, per-frame input routing, pause/cleanup |
| `src/game/FlightController.ts` | Minimal desktop intent extensions for exact hover and gesture rolls; preserve XR branch |
| `src/game/RollController.ts` | Reuse existing bank/stunt state machine; do not duplicate |
| `src/ui/AppUI.ts`, `index.html`, `src/style.css` | Webcam action, calibration/preview, tracking status, stop camera, mode settings |
| `tests/flight.test.ts`, NEW webcam test module if useful | Pure mapping/state tests; import new tests into existing runner entry |
| `package.json`, lockfile, model/WASM assets | Pin tested dependencies; respect Pages base paths |

**Never pass webcam data as fake `XRFlightIntent` or fake controller poses.** `update(..., xrIntent)` selects headset physics and 42/60 m/s speed, while desktop uses 100/160 m/s. `createXRIntent()` assumes genuine XR tracking coordinates and inferred XR shoulders. Webcam mapping belongs in the desktop path.

Current `FlightIntent`: required `throttle`, `brake`, `yaw`, `pitch`; optional mouse aim, `roll`, `stunt`, free-look fields. Webcam outputs normalized turn rates and throttle. Set all aim/free-look fields to zero/false. Do not supply a gamepad in webcam mode; do not merge stale keyboard/mouse movement into webcam input.

Add optional desktop-only fields:

```ts
hover?: boolean;           // exact zero speed; clear stale throttle/turn rates
gestureStunts?: boolean;   // webcam true; ordinary keyboard holds remain false
allowFullRolls?: boolean;  // webcam preference; combines with existing safety setting
```

In the desktop controller, `hover` must bypass speed smoothing to zero, ignore aim/steering, clear residual yaw/pitch rates, and let roll recover gently without translating. Ordinary Space braking in keyboard mode remains unchanged. Route `gestureStunts` to `RollController.update()`. Full rolls require both applicable settings to permit them. Keep the actual XR branch unchanged.

The current pointer-lock-loss handler pauses every non-XR session: restrict that handler and mouse-capture requests to keyboard mode. Webcam mode must not need pointer lock. On entering XR, stop webcam and clear all webcam state first.

## 3. Tracker contract and assets

Use `@mediapipe/tasks-vision` Pose Landmarker (one person, initially lite) + Face Landmarker (one face, transformation matrix enabled, blendshapes disabled) + Hand Landmarker (two hands). Pose supplies shoulders/elbows/wrists, Face supplies head rotation, and Hand supplies the open-palm/closed-hand safety gesture.

Pin the exact tested package version and compatible WASM/model assets. Resolve assets/workers through Vite's deployment base, not root-relative `/models/...`; `vite.config.ts` uses a relative Pages base. Record source/version/license of vendored model files. Lazy-load tracking only after webcam mode is selected.

Suggested sample contract:

```ts
type Joint = { x: number; y: number; z: number; visibility: number; presence?: number };
type TrackingSample = {
  generation: number;
  frameId: number;
  capturedAtMs: number;       // same monotonic clock as control updates
  pose: null | { image: Joint[]; world: Joint[] };
  face: null | { matrix: number[] };
};
```

Use named constants for landmarks: anatomical left/right shoulders 11/12, elbows 13/14, wrists 15/16. Verify with an actual raised-right-hand test before mapping signs. Image coordinates are normalized; pose world landmarks have a hip-relative origin and estimated depth. Hand-model world landmarks, if added later, have separate hand-relative origins and cannot be subtracted from pose shoulders.

Worker messages: `init`, `frame`, `dispose`; responses `ready`, `sample`, `error`, all generation-tagged. At most one frame in flight. Transfer an ImageBitmap, close it in `finally`, drop superseded frames, and discard out-of-order/stale/old-generation responses. Use video-frame callbacks with a supported fallback; run inference independently of rendering. Pose, Face and Hand results from the same frame simplify freshness checks. Never run synchronous inference inside Babylon's render callback.

## 4. Calibration and input mapping

Collect medians over ~1 second of stable, confident samples per pose. Reject insufficient frames or moving/out-of-frame landmarks; show which joint is missing. Store in memory for this camera session; camera/framing changes require recalibration.

1. **Rest:** face forward with both open palms beside the shoulders in a visible “hands up” pose. Capture neutral head matrix, torso reference and retracted shoulder-to-wrist reach. Both hands, shoulders and head must be visible.
2. **Full forward reach:** close both hands into fists and extend both arms comfortably forward. Capture each arm's full shoulder-to-wrist distance and centered steering position. Do not start moving after capture.
3. **Steering range:** both arms comfortably left, right, up and down in turn. Measure asymmetric ranges; show live arrows. This range is for software scaling, not a requirement to move the torso or look away.
4. Confirm diagnostics, then explicit **Start flying** while neutral. No surprise acceleration during calibration.

Use anatomical shoulder line to define body-relative screen-right, with perpendicular screen-up oriented toward image top. Normalize image distances by shoulder width. Mirror only the preview, not inference data. Subtract each arm's calibrated forward-center offset. Camera-facing anatomical right must map to positive game yaw regardless of preview mirroring.

Per arm `i`:

- `R_i = distance(worldWrist, worldShoulder)`; estimated extension, not measured metric reach.
- `reach_i = smoothstep(clamp01((R_i / calibratedFullReach_i - 0.35) / 0.65))`.
- `thrust_i = smoothstep(clamp01((R_i - calibratedRestReach_i) / (calibratedFullReach_i - calibratedRestReach_i)))`; only an associated confidently closed hand enables that arm. Invalid/resting arms contribute zero. Validate denominators/ranges during calibration; never divide by near-zero.
- `yaw_i`: centered horizontal offset divided by the corresponding calibrated left/right range.
- `up_i`: centered vertical offset divided by the corresponding calibrated up/down range.
- Apply continuous deadzone: `dead(v) = sign(v) * clamp01((abs(v)-0.08)/0.92)`.
- `throttle = 0.5 * (thrust_left + thrust_right)`.
- Steering = thrust-weighted average of per-arm deadzoned inputs; ignore contributions below 0.03. No active arms → hover. Left/right conflicting inputs cancel proportionally.
- `intent.yaw = averageYaw`; `intent.pitch = -averageUp` because Babylon negative pitch means climb. Verify rather than assuming model/matrix signs.

These formulas are starting values, subject to the diagnostic gate. World depth can be unstable when a forward fist hides the elbow. Do not replace low-confidence depth with “fully extended.” Do not add a fixed minimum flying speed.

Filter normalized control signals using `alpha = 1-exp(-dt/0.06)`; never filter a safety stop. Existing controller steering adds smoothing, so measure combined response and avoid additional layers. Target neutral-to-stop-turn response below 200 ms. Keep max turn rates from desktop physics initially; calibration controls gesture sensitivity, not top speed.

Roll: derive neutral-relative lateral head tilt from the face transform (prove row/column order, handedness and yaw/pitch rejection with tests). Compute signed hand-line bank relative to the calibrated level pose. Feed matching signs through existing `combinedRoll()`; require two confidently active arms pointing generally together. Send the result as `roll`, with `gestureStunts: true`. Neither head yaw nor pitch may enter steering or camera rotation. Reuse Assisted deep-gesture hold/rearm rules; do not auto-repeat full rolls.

Render view along flight heading with zero free-look offset. Optional arm meshes follow filtered inferred joints only; their quality/confidence must not drive flight feedback. Hide stale arm visuals instead of freezing them in misleading poses.

## 5. Safety, privacy and lifecycle

States: `off → requesting → loading → calibrating → ready → flying`; `tracking-lost`, `paused`, `error` are explicit states, not silent fallbacks.

- Explicit camera opt-in; `getUserMedia({video: ..., audio:false})`. No prompt for keyboard/XR. Provide cancel while requesting/loading; stop late-arriving streams after cancellation.
- Start with shoulder/elbow/wrist visibility ≥0.65 and presence ≥0.65 when supplied. Require valid face for head-dependent roll; sustained face or torso loss stops flight. Thresholds are named tuning constants.
- Isolated missing arm contributes zero; a confidently tracked closed hand on the other arm can continue at one-arm speed. Either confidently open palm, or both arms missing/resting, means hover. Do not interpret a missing arm as extended.
- Brief gaps: stop adding steering/roll and decay that arm's thrust to zero within 100 ms; never extrapolate a pointing direction indefinitely. Samples older than 200 ms, camera errors or missing torso/face beyond 200 ms → exact hover and disarm.
- Reacquisition does not launch automatically: require ~0.5 s confident neutral/rest, then a fresh arm extension. Offer an explicit on-screen rearm if rest cannot be seen. Space is an emergency hover/disarm; Esc pauses. Browser focus loss pauses/disarms.
- Pause freezes flight; show camera-live status. Stop camera completely on mode exit, stop-camera action, XR entry, or disposal. Stop owned tracks, clear video source, cancel callbacks, close models/worker/image resources, increment generation.
- No video upload, recording, screenshot capture, frame logs or landmark telemetry. Preview visible during setup; optional small mirrored preview/status during play. Keep plain keyboard fallback available after permission/model errors.

## 6. Ordered implementation tickets

- [x] **0 — Baseline.** Verified the dirty working-tree snapshot and preserved the existing roll/keyboard changes. `npm test` (29 tests) and `npm run build` passed before webcam work.
- [x] **1 — Diagnostic vertical slice.** Added opt-in camera, pinned Pose+Face+Hand assets, worker and overlay/status. Real camera remained stable with all three models; the user confirmed shoulder/arm/head tracking looked good before Hand was added.
- [x] **2 — Pure mapping.** Implemented sample validation, two-pose calibration, arm throttle/turn/climb mapping, filtering, stale-sample hover and matching head/hand bank. Synthetic mapping and safety tests pass.
- [x] **3 — Flight integration.** Added explicit keyboard/webcam routing, exact hover, no webcam gamepad/mouse leakage, no pointer lock, Space emergency hover, tracking status and webcam-disabled full rolls. Real XR pose interpretation is unchanged. Manual flight tuning is pending.
- [ ] **4 — UX and cleanup.** Calibration instructions, confidence feedback, neutral rearm, emergency stop, webcam-only full-roll toggle, optional arm visuals. Test camera denial, cancel, error and mode switching.
- [ ] **5 — Verify and hand off.** Run tests/build, browser test local and built Pages-base paths, real-camera checklist, and separate Quest regression if hardware available. Report untested hardware explicitly. Update README and this checklist. Publishing requires the user's current deployment instruction; do not publish an unvalidated prototype just because an earlier task auto-pushed.

**Gate after ticket 1:** reliable forward-vs-bent reach is mandatory. Suggested target: inference 15+ Hz and total control response under 200 ms, with game rendering ≥30 FPS on the target desktop. These are targets, not promised results. If reach cannot be distinguished reliably or worker inference cannot coexist with rendering, stop with evidence and request a control/performance tradeoff. No silent switch to head steering, cloud processing or a different throttle gesture.

## 7. Acceptance tests

Pure tests: input reflection/mirrored preview does not swap anatomical hands; camera scale normalization; calibrated neutral deadzone; monotonic extension/lift; one arm ≤0.5 and two ≤1 throttle; conflicting arm headings; pointed-up produces climb; centered arms stop turning without restoring old heading; head yaw/pitch cause no movement/view change; matching head/hand roll only; no stunt retrigger before neutral; missing/stale/out-of-order samples; invalid calibration; session cancellation; neutral rearm after loss; no NaN/Infinity. Exercise 15/30 Hz samples with 60/90/120 Hz game updates.

Integration: webcam hover sets actual speed exactly zero without residual steering; no gamepad/mouse leakage; keyboard and Quest regression tests still pass; webcam cannot change XR speed caps; Space/Esc remain usable; permission denial never disables keyboard play; repeated mode switches leave no live camera/worker leaks. No network request may contain camera frames or landmarks.

Manual: sit farther back; test open hands and fists, one/two arms, partial reach, fast left/right reversal, down/up, centered new heading, head yaw ignored, bank both ways, optional roll, hands out of frame, face occlusion, returning to frame, camera stop indicator. Confirm actual behavior rather than only code completion. Do not activate the user's camera without their runtime opt-in.

## 8. Primary references — read only what the current ticket needs

- Pose coordinates, confidence and worker requirement: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- Face transform output: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js
- Browser setup/support: https://developers.google.com/edge/mediapipe/solutions/setup_web
- Hand-coordinate warning, if adding fingers: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js
- Permission/lifecycle: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Track cleanup: https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop
- Frame scheduling: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback

## Next-agent progress note

Completed: ticket 0 and the code portion of ticket 1. The diagnostic uses pinned `@mediapipe/tasks-vision@1.0.1`, local Pose/Face models and WASM, a dedicated worker, explicit camera opt-in, a mirrored arm skeleton plus sparse face/head guide overlay, reach/confidence/rate metrics, and full camera/worker cleanup. The worker directly imports and installs MediaPipe's ES-module WASM factory before creating each task; relying on its generic loader caused `ModuleFactory not set` and stopped the camera immediately. A live local retry remained active, found pose and face, and reported approximately 15 Hz / 38–39 ms inference. It is not connected to flight. Tests (29), production build and deployment-path checks pass. Roll/keyboard baseline remains uncommitted.

Next: webcam calibration is hands-free after one initial click. The calibration screen keeps the live video/skeleton visible, counts down to a two-open-palms hands-up hover capture, confirms success, then asks for closed fists with both arms extended and captures full reach automatically. The overlay and metrics show both hand skeletons and their open/closed/uncertain classification. Pure tests cover open-palm immediate hover and one/two-arm fist propulsion; 31 regression checks and the production build pass. Manually test real-camera gesture classification, one/two-arm speed, steering, head isolation, banking, Space hover and tracking loss before publishing.
