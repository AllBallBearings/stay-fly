import "@babylonjs/core/Helpers/sceneHelpers";
import "@babylonjs/core/Shaders/glowMapGeneration.vertex";
import "@babylonjs/core/Shaders/glowMapGeneration.fragment";
import "@babylonjs/core/Shaders/glowMapMerge.vertex";
import "@babylonjs/core/Shaders/glowMapMerge.fragment";
import "@babylonjs/core/Shaders/glowBlurPostProcess.fragment";
import "@babylonjs/core/Shaders/kernelBlur.vertex";
import "@babylonjs/core/Shaders/kernelBlur.fragment";
import "@babylonjs/core/Shaders/postprocess.vertex";
import "@babylonjs/core/Shaders/default.vertex";
import "@babylonjs/core/Shaders/default.fragment";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Engine } from "@babylonjs/core/Engines/engine";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreatePlane } from "@babylonjs/core/Meshes/Builders/planeBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { Scene } from "@babylonjs/core/scene";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import type { WebXRDefaultExperience } from "@babylonjs/core/XR/webXRDefaultExperience";
import type { WebXRInputSource } from "@babylonjs/core/XR/webXRInputSource";
import { WebXRState } from "@babylonjs/core/XR/webXRTypes";
import { AdvancedDynamicTexture, Control, Rectangle, StackPanel, TextBlock } from "@babylonjs/gui/2D";
import { SkyWorld } from "./Course";
import { FlightController, type FlightIntent, type XRControllerPose, type XRFlightIntent } from "./FlightController";
import { PlayerArm } from "./PlayerArm";
import { DesktopControls } from "./DesktopControls";
import { getWorldNavigation, WORLD_REGIONS } from "./WorldNavigation";
import type { GamePhase, GameSettings } from "./types";
import type { AppUI } from "../ui/AppUI";
import type { WebcamTracker } from "./webcam/WebcamTracker";
import { WebcamControls } from "./webcam/WebcamControls";

export class StarlightGame {
  readonly settings: GameSettings = { comfortMode: true, vignette: true, rollMode: "assisted", fullRolls: true };
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly desktopCamera: UniversalCamera;
  private readonly flightRig: TransformNode;
  private readonly world: SkyWorld;
  private flight: FlightController;
  private xr: WebXRDefaultExperience | null = null;
  private ui: AppUI | null = null;
  private phase: GamePhase = "landing";
  private readonly desktopControls = new DesktopControls();
  private lastFrameTime = performance.now();
  private activeGamepad: Gamepad | undefined;
  private xrFlightIntent: XRFlightIntent | undefined;
  private previousButtons = new Map<Gamepad, boolean[]>();
  private vrPanel: Mesh | null = null;
  private xrArms = new Map<string, PlayerArm>();
  private trackedPoses: XRControllerPose[] = [];
  private calibrationStep: "hover" | "reach" = "hover";
  private nextNavigationUpdate = 0;
  private pauseAxisHeld = false;
  private webcamTracker: WebcamTracker | null = null;
  private readonly webcamControls = new WebcamControls();
  private desktopInputMode: "keyboard" | "webcam" = "keyboard";
  private webcamEmergencyHover = false;
  private webcamCalibrationRun = 0;
  private webcamCalibrationBusy = false;
  private webcamAutoCalibrationPending = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, powerPreference: "high-performance" });
    this.scene = this.createScene();
    this.flightRig = new TransformNode("flight-rig", this.scene);
    this.desktopCamera = new UniversalCamera("desktop-camera", Vector3.Zero(), this.scene);
    this.desktopCamera.minZ = 0.05;
    this.desktopCamera.maxZ = 12000;
    this.desktopCamera.fov = 1.08;
    this.desktopCamera.parent = this.flightRig;
    this.scene.activeCamera = this.desktopCamera;

    this.world = new SkyWorld(this.scene);
    this.addRegionSigns();
    this.flight = new FlightController(this.flightRig, this.desktopCamera, this.settings, this.world.flightBounds);
    this.flight.reset(this.world.startPosition, this.world.startDirection);
    this.bindInput();
    this.engine.runRenderLoop(() => this.frame());
    window.addEventListener("resize", () => this.engine.resize());
    window.addEventListener("pagehide", () => this.stopWebcamDiagnostic());
  }

  attachUI(ui: AppUI): void { this.ui = ui; }

  async initializeXR(): Promise<boolean> {
    const browserXR = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
    if (!browserXR || !(await browserXR.isSessionSupported("immersive-vr"))) return false;

    this.xr = await this.scene.createDefaultXRExperienceAsync({
      disableDefaultUI: true,
      disablePointerSelection: true,
      disableTeleportation: true,
      disableNearInteraction: true,
      disableHandTracking: true,
      inputOptions: { doNotLoadControllerMeshes: true },
      optionalFeatures: true,
      uiOptions: { sessionMode: "immersive-vr", referenceSpaceType: "local-floor" },
    });

    this.xr.input.onControllerAddedObservable.add((controller) => {
      this.xrArms.set(controller.uniqueId, new PlayerArm(this.scene, this.flightRig, controller.uniqueId, controller.inputSource.handedness === "left"));
    });
    this.xr.input.onControllerRemovedObservable.add((controller) => this.detachXRArm(controller));

    this.xr.baseExperience.onInitialXRPoseSetObservable.add((camera) => {
      // Babylon copies the desktop camera's WORLD transform on entry. This game moves
      // a parent rig, so importing that transform again doubles the launch translation
      // inside XR reference space. Keep native tracking local to the existing rig.
      camera.parent = this.flightRig;
      camera.position.set(0, 0, 0);
      camera.rotationQuaternion.copyFrom(Quaternion.Identity());
    });

    this.xr.baseExperience.onStateChangedObservable.add((state) => {
      if (!this.xr) return;
      if (state === WebXRState.IN_XR) {
        const camera = this.xr.baseExperience.camera;
        camera.parent = this.flightRig;
        camera.minZ = 0.05;
        camera.maxZ = 12000;
        this.flight.setCamera(camera);
        this.beginCalibration();
      }
      if (state === WebXRState.NOT_IN_XR && this.phase !== "landing") {
        this.desktopCamera.parent = this.flightRig;
        this.scene.activeCamera = this.desktopCamera;
        this.flight.setCamera(this.desktopCamera);
        this.pauseGame();
      }
    });
    return true;
  }

  async enterVR(): Promise<void> {
    if (!this.xr) return;
    this.ui?.setWebcamFlightMode(false);
    this.stopWebcamDiagnostic();
    await this.xr.baseExperience.enterXRAsync("immersive-vr", "local-floor");
  }

  async startWebcamDiagnostic(): Promise<void> {
    if (this.isInXR() || !this.ui) return;
    const video = this.ui.showWebcamDiagnostic();
    if (!navigator.mediaDevices?.getUserMedia) {
      this.ui.setWebcamDiagnosticState("error", "This browser does not provide webcam access. Keyboard play remains available.");
      return;
    }
    await this.startWebcamTracker(video);
  }

  stopWebcamDiagnostic(): void {
    this.webcamTracker?.stop();
    this.ui?.hideWebcamDiagnostic();
  }

  startDesktop(): void {
    void this.startHandTrackingDesktop();
  }

  startKeyboardDesktop(): void {
    this.webcamAutoCalibrationPending = false;
    this.desktopInputMode = "keyboard";
    this.ui?.setWebcamFlightMode(false);
    this.stopWebcamDiagnostic();
    this.beginCalibration();
  }

  private async startHandTrackingDesktop(): Promise<void> {
    if (this.isInXR() || !this.ui) return;
    this.desktopInputMode = "webcam";
    this.webcamControls.resetCalibration();
    this.webcamEmergencyHover = false;
    this.webcamAutoCalibrationPending = true;
    this.ui.setWebcamFlightMode(true);
    this.beginCalibration();
    this.ui.setWebcamCalibrationBusy(true, "Waiting for camera tracking…");
    if (!navigator.mediaDevices?.getUserMedia) {
      this.fallbackToKeyboard("This browser does not support webcam tracking. Starting keyboard controls.");
      return;
    }
    await this.startWebcamTracker(this.ui.webcamSetupVideo());
  }

  private async startWebcamTracker(video: HTMLVideoElement): Promise<void> {
    if (!this.ui) return;
    if (!this.webcamTracker) {
      const { WebcamTracker } = await import("./webcam/WebcamTracker");
      this.webcamTracker = new WebcamTracker({
        onState: (state, detail) => {
          this.ui?.setWebcamDiagnosticState(state, detail);
          if (!this.webcamAutoCalibrationPending) return;
          if (state === "tracking") {
            if (!this.webcamControls.hasHandsUpPose()) {
              this.ui?.setCalibrationFeedback("Camera tracking is ready. Raise both open palms beside your shoulders to start calibration.");
              return;
            }
            this.webcamAutoCalibrationPending = false;
            void this.runHandsFreeWebcamCalibration();
          } else if (state === "error") {
            this.webcamAutoCalibrationPending = false;
            this.fallbackToKeyboard(`${detail} Starting keyboard controls.`);
          }
        },
        onSample: (sample) => {
          this.webcamControls.addSample(sample);
          this.ui?.updateWebcamDiagnostic(sample);
        },
      });
    }
    await this.webcamTracker.start(video);
  }

  private fallbackToKeyboard(message: string): void {
    this.webcamAutoCalibrationPending = false;
    this.desktopInputMode = "keyboard";
    this.ui?.setWebcamFlightMode(false);
    this.webcamTracker?.stop();
    this.ui?.showToast(message);
    this.beginCalibration();
  }

  startWebcamFlight(): void {
    if (!this.webcamTracker) return;
    this.desktopInputMode = "webcam";
    this.webcamAutoCalibrationPending = false;
    this.webcamControls.resetCalibration();
    this.webcamEmergencyHover = false;
    this.ui?.setWebcamFlightMode(true);
    this.ui?.hideWebcamDiagnostic();
    this.beginCalibration();
  }

  calibrate(): void {
    if (this.phase !== "calibrating") return;
    if (!this.isInXR() && this.desktopInputMode === "webcam") {
      if (!this.webcamCalibrationBusy) void this.runHandsFreeWebcamCalibration();
      return;
    }
    if (this.isInXR() && this.calibrationStep === "hover") {
      this.flight.calibrateHover(this.trackedPoses);
      this.calibrationStep = "reach";
      this.ui?.setCalibrationStep("reach");
      this.showVRPanel("SET YOUR FULL REACH", "Extend both arms straight ahead, hands level, then press A or X. One arm also works. Tilt head and hands together to bank; hold a deeper tilt for one full roll.");
      return;
    }
    if (this.isInXR() && this.flight.calibrateFullReach(this.trackedPoses) === 0) {
      this.ui?.showToast("Extend an arm forward, then try again");
      this.showVRPanel("FULL REACH NOT CAPTURED", "Point an arm straight ahead at full extension, then press A or X. Keep your arm clear of the rest position.");
      return;
    }
    if (!this.isInXR() && this.desktopInputMode === "keyboard") this.flight.calibrateHover();
    this.hideVRPanel();
    this.phase = "flying";
    this.lastFrameTime = performance.now();
    this.ui?.setPhase(this.phase);
    this.ui?.showToast(this.isInXR() ? "Reach calibrated — go anywhere" : this.desktopInputMode === "webcam" ? "Webcam flight ready — raise your arms" : "Neutral pose set — go anywhere");
  }

  resume(): void {
    if (this.phase !== "paused") return;
    this.hideVRPanel();
    this.phase = "flying";
    this.lastFrameTime = performance.now();
    this.ui?.setPhase(this.phase);
  }

  recalibrate(): void { this.beginCalibration(); }

  restart(): void {
    this.desktopControls.reset();
    this.world.reset();
    this.flight.reset(this.world.startPosition, this.world.startDirection);
    this.beginCalibration();
  }

  togglePause(): void {
    if (this.phase === "flying") this.pauseGame();
    else if (this.phase === "paused") this.resume();
  }

  private beginCalibration(): void {
    this.webcamCalibrationRun++;
    this.webcamCalibrationBusy = false;
    this.desktopControls.clear();
    this.phase = "calibrating";
    this.calibrationStep = "hover";
    this.ui?.setPhase(this.phase);
    this.ui?.setCalibrationStep("hover");
    if (!this.isInXR() && this.desktopInputMode === "webcam") this.ui?.setWebcamCalibrationStep("hover");
    this.showVRPanel("STEP 1: SET YOUR HOVER POSE", "Look ahead with both arms resting at your sides, then press A or X. Next, you will measure your fully extended reach.");
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private async runHandsFreeWebcamCalibration(): Promise<void> {
    if (!this.ui || this.webcamCalibrationBusy) return;
    this.webcamCalibrationBusy = true;
    const run = ++this.webcamCalibrationRun;
    this.ui.setWebcamCalibrationBusy(true, "Capturing automatically…");
    const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
    const active = () => run === this.webcamCalibrationRun && this.phase === "calibrating" && this.desktopInputMode === "webcam";
    for (let count = 3; count >= 1; count--) {
      this.ui.setCalibrationFeedback(`Open-palms hover capture in ${count}…`);
      await wait(1000);
      if (!active()) return;
    }
    if (!this.webcamControls.captureRest()) {
      this.webcamCalibrationBusy = false;
      this.ui.setCalibrationFeedback("Hover was not captured. Show both open palms beside your shoulders and keep your upper body visible.", "error");
      this.ui.setWebcamCalibrationBusy(false, "Retry hands-free calibration");
      return;
    }
    this.flight.calibrateHover();
    this.calibrationStep = "reach";
    this.ui.setWebcamCalibrationStep("reach");
    this.ui.setCalibrationFeedback("✓ Hands-up hover captured. Close both hands into fists and extend your arms toward the screen.");
    await wait(1400);
    if (!active()) return;

    while (active()) {
      for (let count = 3; count >= 1; count--) {
        this.ui.setCalibrationFeedback(`✓ Hover captured · Fists-forward reach capture in ${count}…`);
        await wait(1000);
        if (!active()) return;
      }
      if (this.webcamControls.captureReach()) break;
      this.ui.setCalibrationFeedback(`${this.webcamControls.getCalibrationIssue()} Retrying automatically…`, "error");
      await wait(1500);
    }
    if (!active()) return;
    this.ui.setCalibrationFeedback("✓ Hover captured · ✓ Full reach captured · Starting flight…");
    await wait(900);
    if (!active()) return;
    this.webcamCalibrationBusy = false;
    this.hideVRPanel();
    this.phase = "flying";
    this.lastFrameTime = performance.now();
    this.ui.setPhase(this.phase);
    this.ui.showToast("Webcam flight ready — fists fly, an open palm hovers");
  }

  private pauseGame(): void {
    if (this.phase !== "flying") return;
    this.phase = "paused";
    this.desktopControls.clear();
    this.ui?.setPhase(this.phase);
    this.showVRPausePanel();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private frame(): void {
    const now = performance.now();
    const deltaSeconds = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    this.xrFlightIntent = this.readXRFlightIntent();
    this.readXRControllers();
    // A/X may just have calibrated the body pose used by this frame's controls.
    if (this.isInXR()) this.xrFlightIntent = this.flight.createXRIntent(this.trackedPoses);
    if (this.phase === "flying") {
      const gamepad = this.desktopInputMode === "keyboard" ? this.activeGamepad : undefined;
      const telemetry = this.flight.update(deltaSeconds, this.readDesktopIntent(deltaSeconds), gamepad, this.xrFlightIntent);
      this.world.update(now / 1000);
      this.ui?.updateFlight(telemetry);
      if (!this.isInXR()) {
        // A subtle desktop-only widening reinforces speed without changing headset optics.
        const targetFov = 1.08 + telemetry.speedRatio ** 2 * (this.settings.comfortMode ? 0.09 : 0.22);
        this.desktopCamera.fov += (targetFov - this.desktopCamera.fov) * (1 - Math.exp(-deltaSeconds * 4));
      }
      if (now >= this.nextNavigationUpdate) {
        const camera = this.scene.activeCamera!;
        const navigation = getWorldNavigation(camera.globalPosition, camera.getForwardRay().direction);
        this.ui?.updateNavigation(navigation.region, navigation.directions);
        this.nextNavigationUpdate = now + 150;
      }
      const vignette = Math.min(0.7, telemetry.turnIntensity * 0.46 + telemetry.accelerationIntensity * 0.34);
      this.ui?.setVignette(vignette);
      this.scene.imageProcessingConfiguration.vignetteWeight = this.settings.vignette ? 1.4 + vignette * 2.4 : 0;
    } else {
      this.ui?.setVignette(0);
    }

    this.scene.render();
  }

  private readDesktopIntent(dt: number): FlightIntent {
    if (this.desktopInputMode === "webcam") return this.webcamControls.read(performance.now(), Math.min(dt, 0.05), this.webcamEmergencyHover);
    return this.desktopControls.read(Math.min(dt, 0.05));
  }

  private readXRControllers(): void {
    const gamepads = (this.isInXR()
      ? this.xr!.input.controllers.map((controller) => controller.inputSource.gamepad)
      : Array.from(navigator.getGamepads?.() ?? []))
      .filter((gamepad): gamepad is Gamepad => Boolean(gamepad));
    this.activeGamepad = gamepads[0];
    let calibrate = false;
    let pause = false;
    let recalibrate = false;
    for (const gamepad of gamepads) {
      const buttons = gamepad.buttons.map((button) => button.pressed);
      const previous = this.previousButtons.get(gamepad) ?? [];
      const pressed = (index: number) => Boolean(buttons[index] && !previous[index]);
      calibrate ||= pressed(4) || pressed(5) || pressed(0);
      pause ||= pressed(3) || pressed(7);
      recalibrate ||= pressed(1) || pressed(5);
      this.previousButtons.set(gamepad, buttons);
    }
    for (const gamepad of this.previousButtons.keys()) if (!gamepads.includes(gamepad)) this.previousButtons.delete(gamepad);
    // One state transition per frame, regardless of how many controllers were pressed.
    if (this.phase === "calibrating" && calibrate) this.calibrate();
    else if (this.phase === "paused" && recalibrate) this.recalibrate();
    else if (pause) this.togglePause();
    else if (this.phase === "paused" && this.isInXR()) {
      const x = gamepads.map((pad) => pad.axes[2] ?? pad.axes[0] ?? 0).find((axis) => Math.abs(axis) > 0.65) ?? 0;
      if (x && !this.pauseAxisHeld) this.settings.rollMode = x < 0 ? "assisted" : "free";
      if (calibrate) this.settings.fullRolls = !this.settings.fullRolls;
      if ((x && !this.pauseAxisHeld) || calibrate) { this.ui?.setPhase("paused"); this.showVRPausePanel(); }
      this.pauseAxisHeld = x !== 0;
    } else this.pauseAxisHeld = false;
  }

  private readXRFlightIntent(): XRFlightIntent | undefined {
    if (!this.isInXR() || !this.xr) return undefined;
    const manager = this.xr.baseExperience.sessionManager;
    this.trackedPoses = [];
    for (const controller of this.xr.input.controllers) {
      const source = controller.inputSource;
      const arm = this.xrArms.get(controller.uniqueId);
      // A pointing ray is not an anatomical grip pose; never render a wrist from it.
      const pose = source.gripSpace && manager.currentFrame?.getPose(source.gripSpace, manager.referenceSpace);
      if (!pose || source.targetRayMode !== "tracked-pointer") {
        arm?.root.setEnabled(false);
        continue;
      }
      const p = pose.transform.position;
      const q = pose.transform.orientation;
      const position = new Vector3(p.x, p.y, -p.z).scaleInPlace(manager.worldScalingFactor);
      const rotation = PlayerArm.rotationFromGrip(new Quaternion(q.x, q.y, -q.z, -q.w), source.handedness === "left");
      this.trackedPoses.push({ position, handedness: source.handedness });
      const shoulder = this.flight.getShoulderPosition(source.handedness);
      const pole = shoulder.subtract(this.xr.baseExperience.camera.position);
      arm?.update(shoulder, position, rotation, pole);
    }
    return this.flight.createXRIntent(this.trackedPoses);
  }

  private detachXRArm(controller: WebXRInputSource): void {
    this.xrArms.get(controller.uniqueId)?.dispose();
    this.xrArms.delete(controller.uniqueId);
  }

  private bindInput(): void {
    window.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (this.phase === "flying" && !this.isInXR() && this.desktopInputMode === "keyboard") this.desktopControls.keyDown(event.code, performance.now(), event.repeat);
      if (this.phase === "flying" && !this.isInXR() && this.desktopInputMode === "webcam" && event.code === "Space") this.webcamEmergencyHover = true;
      if (event.repeat) return;
      if (event.code === "Escape") this.togglePause();
      if (event.code === "KeyR" && (this.phase === "flying" || this.phase === "paused")) this.recalibrate();
      if (event.code === "Enter" && this.phase === "calibrating") this.calibrate();
    });
    window.addEventListener("keyup", (event) => {
      this.desktopControls.keyUp(event.code);
      if (event.code === "Space") this.webcamEmergencyHover = false;
    });
    window.addEventListener("blur", () => { this.desktopControls.clear(); if (!this.isInXR()) this.pauseGame(); });
    document.addEventListener("pointerlockchange", () => {
      if (!document.pointerLockElement && !this.isInXR() && this.desktopInputMode === "keyboard") { this.desktopControls.clear(); this.pauseGame(); }
    });
    window.addEventListener("mousemove", (event) => {
      if (this.desktopInputMode !== "keyboard" || document.pointerLockElement !== this.canvas || this.phase !== "flying") return;
      this.desktopControls.mouseMove(event.movementX, event.movementY);
    });
    this.canvas.addEventListener("click", () => {
      if (this.phase === "flying" && !this.isInXR() && this.desktopInputMode === "keyboard") this.canvas.requestPointerLock?.();
    });
  }

  private createScene(): Scene {
    const scene = new Scene(this.engine);
    scene.clearColor = new Color4(0.22, 0.48, 0.76, 1);
    scene.ambientColor = new Color3(0.34, 0.44, 0.55);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.00016;
    scene.fogColor = new Color3(0.34, 0.58, 0.78);

    const ambient = new HemisphericLight("ambient", new Vector3(0.2, 1, -0.15), scene);
    ambient.intensity = 0.78;
    ambient.diffuse = new Color3(0.72, 0.88, 1);
    ambient.groundColor = new Color3(0.19, 0.27, 0.35);
    const rim = new DirectionalLight("sunlight", new Vector3(-0.5, -0.8, 0.35), scene);
    rim.intensity = 0.86;
    rim.diffuse = new Color3(1, 0.88, 0.68);

    const glow = new GlowLayer("sky-glow", scene, { blurKernelSize: 32 });
    glow.intensity = 0.34;
    scene.imageProcessingConfiguration.toneMappingEnabled = true;
    scene.imageProcessingConfiguration.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    scene.imageProcessingConfiguration.exposure = 0.9;
    scene.imageProcessingConfiguration.contrast = 1.06;
    scene.imageProcessingConfiguration.vignetteEnabled = true;
    scene.imageProcessingConfiguration.vignetteBlendMode = ImageProcessingConfiguration.VIGNETTEMODE_MULTIPLY;
    scene.imageProcessingConfiguration.vignetteColor = new Color4(0, 0, 0.02, 1);
    scene.imageProcessingConfiguration.vignetteWeight = 1.4;

    this.createSky(scene);
    return scene;
  }

  private createSky(scene: Scene): void {
    const dome = CreateSphere("sky-dome", { diameter: 20000, segments: 20, sideOrientation: Mesh.BACKSIDE }, scene);
    const material = new StandardMaterial("sky", scene);
    material.disableLighting = true;
    material.backFaceCulling = false;
    material.emissiveColor = new Color3(0.12, 0.34, 0.66);
    dome.material = material;
    dome.infiniteDistance = true;
    dome.isPickable = false;

    const sun = CreateSphere("sun", { diameter: 28, segments: 16 }, scene);
    sun.position.set(-260, 210, 390);
    const sunMaterial = new StandardMaterial("sun-material", scene);
    sunMaterial.disableLighting = true;
    sunMaterial.emissiveColor = new Color3(1, 0.67, 0.26);
    sun.material = sunMaterial;
    sun.infiniteDistance = true;
  }

  private addRegionSigns(): void {
    // In-world labels work on the headset too; the desktop HUD is not visible in XR.
    for (const region of WORLD_REGIONS) {
      const sign = CreatePlane(`district-sign-${region.id}`, { width: 160, height: 30 }, this.scene);
      sign.position.copyFrom(region.position).addInPlace(new Vector3(0, region.signHeight, 0));
      sign.billboardMode = Mesh.BILLBOARDMODE_ALL;
      sign.isPickable = false;
      const texture = AdvancedDynamicTexture.CreateForMesh(sign, 1024, 192, false);
      const panel = new Rectangle();
      panel.cornerRadius = 28;
      panel.thickness = 3;
      panel.color = region.color;
      panel.background = "#0b182ce6";
      texture.addControl(panel);
      const label = new TextBlock();
      label.text = region.name.toUpperCase();
      label.color = region.color;
      label.fontSize = 72;
      label.fontWeight = "600";
      panel.addControl(label);
    }
  }

  private showVRPanel(title: string, body: string): void {
    if (!this.isInXR() || !this.xr) return;
    this.hideVRPanel();
    const camera = this.xr.baseExperience.camera;
    const forward = camera.getForwardRay().direction.normalize();
    const panel = CreatePlane("vr-panel", { width: 2.6, height: 1.25 }, this.scene);
    panel.position.copyFrom(camera.globalPosition.add(forward.scale(2.5)));
    panel.billboardMode = Mesh.BILLBOARDMODE_ALL;

    const texture = AdvancedDynamicTexture.CreateForMesh(panel, 1024, 512, false);
    const background = new Rectangle();
    background.cornerRadius = 48;
    background.thickness = 2;
    background.color = "#5eefff";
    background.background = "#080b22e8";
    background.paddingLeft = "32px";
    background.paddingRight = "32px";
    background.paddingTop = "28px";
    background.paddingBottom = "28px";
    texture.addControl(background);

    const stack = new StackPanel();
    stack.verticalAlignment = Control.VERTICAL_ALIGNMENT_CENTER;
    background.addControl(stack);
    const heading = new TextBlock();
    heading.text = title;
    heading.color = "#7ff7ff";
    heading.fontSize = 42;
    heading.height = "80px";
    heading.fontWeight = "700";
    stack.addControl(heading);
    const description = new TextBlock();
    description.text = body;
    description.color = "#d7ddf5";
    description.fontSize = 28;
    description.textWrapping = true;
    description.height = "180px";
    stack.addControl(description);
    this.vrPanel = panel;
  }

  private showVRPausePanel(): void {
    this.showVRPanel("FLIGHT PAUSED", `Roll: ${this.settings.rollMode === "free" ? "Free" : "Assisted"}. Full rolls: ${this.settings.fullRolls ? "ON" : "OFF"}. Stick left/right selects Assisted/Free; A or X toggles full rolls. Click stick to resume. B or Y recalibrates.`);
  }

  private hideVRPanel(): void {
    this.vrPanel?.dispose(false, true);
    this.vrPanel = null;
  }

  private isInXR(): boolean { return this.xr?.baseExperience.state === WebXRState.IN_XR; }
}
