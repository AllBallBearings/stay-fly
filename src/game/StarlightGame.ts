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
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
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
import { WebXRState } from "@babylonjs/core/XR/webXRTypes";
import { AdvancedDynamicTexture, Control, Rectangle, StackPanel, TextBlock } from "@babylonjs/gui/2D";
import { SkyWorld } from "./Course";
import { FlightController, type FlightIntent, type XRFlightIntent } from "./FlightController";
import type { GamePhase, GameSettings } from "./types";
import type { AppUI } from "../ui/AppUI";

export class StarlightGame {
  readonly settings: GameSettings = { comfortMode: true, vignette: true };
  private readonly engine: Engine;
  private readonly scene: Scene;
  private readonly desktopCamera: UniversalCamera;
  private readonly flightRig: TransformNode;
  private readonly world: SkyWorld;
  private flight: FlightController;
  private xr: WebXRDefaultExperience | null = null;
  private ui: AppUI | null = null;
  private phase: GamePhase = "landing";
  private keys = new Set<string>();
  private pointerIntent = { x: 0, y: 0 };
  private lastFrameTime = performance.now();
  private activeGamepad: Gamepad | undefined;
  private xrFlightIntent: XRFlightIntent | undefined;
  private previousButtons: boolean[] = [];
  private vrPanel: Mesh | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, powerPreference: "high-performance" });
    this.scene = this.createScene();
    this.flightRig = new TransformNode("flight-rig", this.scene);
    this.desktopCamera = new UniversalCamera("desktop-camera", Vector3.Zero(), this.scene);
    this.desktopCamera.minZ = 0.05;
    this.desktopCamera.maxZ = 1800;
    this.desktopCamera.fov = 1.08;
    this.desktopCamera.parent = this.flightRig;
    this.scene.activeCamera = this.desktopCamera;

    this.world = new SkyWorld(this.scene);
    this.flight = new FlightController(this.flightRig, this.desktopCamera, this.settings);
    this.flight.reset(this.world.startPosition, this.world.startDirection);
    this.bindInput();
    this.engine.runRenderLoop(() => this.frame());
    window.addEventListener("resize", () => this.engine.resize());
  }

  attachUI(ui: AppUI): void { this.ui = ui; }

  async initializeXR(): Promise<boolean> {
    const browserXR = (navigator as Navigator & { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
    if (!browserXR || !(await browserXR.isSessionSupported("immersive-vr"))) return false;

    this.xr = await this.scene.createDefaultXRExperienceAsync({
      disableDefaultUI: true,
      disableTeleportation: true,
      optionalFeatures: true,
      uiOptions: { sessionMode: "immersive-vr", referenceSpaceType: "local-floor" },
    });

    this.xr.baseExperience.onStateChangedObservable.add((state) => {
      if (!this.xr) return;
      if (state === WebXRState.IN_XR) {
        const camera = this.xr.baseExperience.camera;
        camera.parent = this.flightRig;
        camera.minZ = 0.05;
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
    await this.xr.baseExperience.enterXRAsync("immersive-vr", "local-floor");
  }

  startDesktop(): void {
    this.beginCalibration();
  }

  calibrate(): void {
    if (this.phase !== "calibrating") return;
    this.flight.calibrate();
    this.hideVRPanel();
    this.phase = "flying";
    this.lastFrameTime = performance.now();
    this.ui?.setPhase(this.phase);
    this.ui?.showToast("Neutral pose set — go anywhere");
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
    this.world.reset();
    this.flight.reset(this.world.startPosition, this.world.startDirection);
    this.beginCalibration();
  }

  togglePause(): void {
    if (this.phase === "flying") this.pauseGame();
    else if (this.phase === "paused") this.resume();
  }

  private beginCalibration(): void {
    this.phase = "calibrating";
    this.ui?.setPhase(this.phase);
    this.showVRPanel("FIND YOUR NEUTRAL POSE", "Get comfortable, look ahead, then press A or X. Reach an arm in any direction to fly; hands down stops.");
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private pauseGame(): void {
    if (this.phase !== "flying") return;
    this.phase = "paused";
    this.ui?.setPhase(this.phase);
    this.showVRPanel("FLIGHT PAUSED", "Click the thumbstick to resume. B or Y recalibrates.");
    if (document.pointerLockElement) document.exitPointerLock();
  }

  private frame(): void {
    const now = performance.now();
    const deltaSeconds = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    this.readXRControllers();
    this.xrFlightIntent = this.readXRFlightIntent();
    if (this.phase === "flying") {
      const telemetry = this.flight.update(deltaSeconds, this.readDesktopIntent(), this.activeGamepad, this.xrFlightIntent);
      this.world.update(now / 1000);
      this.ui?.updateFlight(telemetry);
      const vignette = Math.min(0.7, telemetry.turnIntensity * 0.46 + telemetry.accelerationIntensity * 0.34);
      this.ui?.setVignette(vignette);
      this.scene.imageProcessingConfiguration.vignetteWeight = this.settings.vignette ? 1.4 + vignette * 2.4 : 0;
    } else {
      this.ui?.setVignette(0);
    }

    this.pointerIntent.x *= Math.exp(-deltaSeconds * 4.2);
    this.pointerIntent.y *= Math.exp(-deltaSeconds * 4.2);
    this.scene.render();
  }

  private readDesktopIntent(): FlightIntent {
    const pressed = (...codes: string[]) => codes.some((code) => this.keys.has(code));
    return {
      throttle: pressed("ArrowUp", "ShiftLeft", "ShiftRight", "Space") ? 1 : 0,
      brake: pressed("ArrowDown", "ControlLeft", "ControlRight") ? 1 : 0,
      yaw: Math.max(-1, Math.min(1, (pressed("KeyD", "ArrowRight") ? 1 : 0) - (pressed("KeyA", "ArrowLeft") ? 1 : 0) + this.pointerIntent.x)),
      pitch: Math.max(-1, Math.min(1, (pressed("KeyS") ? 1 : 0) - (pressed("KeyW") ? 1 : 0) + this.pointerIntent.y)),
    };
  }

  private readXRControllers(): void {
    this.activeGamepad = this.xr?.input.controllers
      .map((controller) => controller.inputSource.gamepad)
      .find((gamepad): gamepad is Gamepad => Boolean(gamepad));
    if (!this.activeGamepad && !this.isInXR()) {
      this.activeGamepad = Array.from(navigator.getGamepads?.() ?? []).find((gamepad): gamepad is Gamepad => Boolean(gamepad));
    }
    if (!this.activeGamepad) return;

    const buttons = this.activeGamepad.buttons.map((button) => button.pressed);
    const justPressed = (index: number) => Boolean(buttons[index] && !this.previousButtons[index]);
    if ((justPressed(4) || justPressed(5) || justPressed(0)) && this.phase === "calibrating") this.calibrate();
    if (justPressed(3) || justPressed(7)) this.togglePause();
    if ((justPressed(1) || justPressed(5)) && this.phase === "paused") this.recalibrate();
    this.previousButtons = buttons;
  }

  private readXRFlightIntent(): XRFlightIntent | undefined {
    if (!this.isInXR() || !this.xr) return undefined;
    const poses = this.xr.input.controllers.map((controller) => ({ position: controller.pointer.absolutePosition.clone() }));
    return this.flight.createXRIntent(poses);
  }

  private bindInput(): void {
    window.addEventListener("keydown", (event) => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(event.code)) event.preventDefault();
      this.keys.add(event.code);
      if (event.code === "Escape") this.togglePause();
      if (event.code === "KeyR" && (this.phase === "flying" || this.phase === "paused")) this.recalibrate();
      if (event.code === "Enter" && this.phase === "calibrating") this.calibrate();
    });
    window.addEventListener("keyup", (event) => this.keys.delete(event.code));
    window.addEventListener("mousemove", (event) => {
      if (document.pointerLockElement !== this.canvas || this.phase !== "flying") return;
      this.pointerIntent.x = Math.max(-1, Math.min(1, this.pointerIntent.x + event.movementX * 0.0025));
      this.pointerIntent.y = Math.max(-1, Math.min(1, this.pointerIntent.y + event.movementY * 0.0025));
    });
    this.canvas.addEventListener("click", () => {
      if (this.phase === "flying" && !this.isInXR()) this.canvas.requestPointerLock?.();
    });
  }

  private createScene(): Scene {
    const scene = new Scene(this.engine);
    scene.clearColor = new Color4(0.22, 0.48, 0.76, 1);
    scene.ambientColor = new Color3(0.34, 0.44, 0.55);
    scene.fogMode = Scene.FOGMODE_EXP2;
    scene.fogDensity = 0.00115;
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
    const dome = CreateSphere("sky-dome", { diameter: 1500, segments: 20, sideOrientation: Mesh.BACKSIDE }, scene);
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

  private hideVRPanel(): void {
    this.vrPanel?.dispose(false, true);
    this.vrPanel = null;
  }

  private isInXR(): boolean { return this.xr?.baseExperience.state === WebXRState.IN_XR; }
}
