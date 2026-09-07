import type { FlightTelemetry, GamePhase, GameSettings } from "../game/types";

interface UIActions {
  enterVR: () => void;
  playDesktop: () => void;
  calibrate: () => void;
  resume: () => void;
  recalibrate: () => void;
  restart: () => void;
}

const element = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing UI element #${id}`);
  return value as T;
};

export class AppUI {
  private readonly landing = element("landing");
  private readonly calibration = element("calibration");
  private readonly pause = element("pause-menu");
  private readonly hud = element("hud");
  private readonly reticle = element("reticle");
  private readonly toast = element("toast");
  private readonly enterVRButton = element<HTMLButtonElement>("enter-vr");
  private readonly xrStatus = element("xr-status");
  private readonly comfortMode = element<HTMLInputElement>("comfort-mode");
  private readonly vignetteToggle = element<HTMLInputElement>("vignette-toggle");
  private toastTimer = 0;

  constructor(
    private readonly settings: GameSettings,
    actions: UIActions,
  ) {
    element("play-desktop").addEventListener("click", actions.playDesktop);
    this.enterVRButton.addEventListener("click", actions.enterVR);
    element("calibrate").addEventListener("click", actions.calibrate);
    element("resume").addEventListener("click", actions.resume);
    element("recalibrate").addEventListener("click", actions.recalibrate);
    element("restart").addEventListener("click", actions.restart);

    this.comfortMode.checked = settings.comfortMode;
    this.vignetteToggle.checked = settings.vignette;
    this.comfortMode.addEventListener("change", () => { settings.comfortMode = this.comfortMode.checked; });
    this.vignetteToggle.addEventListener("change", () => {
      settings.vignette = this.vignetteToggle.checked;
      if (!settings.vignette) this.setVignette(0);
    });
  }

  setXRSupport(supported: boolean): void {
    this.enterVRButton.disabled = !supported;
    this.xrStatus.textContent = supported
      ? "WebXR headset detected — ready for takeoff."
      : "Immersive VR is not available here. Desktop flight is ready.";
  }

  setPhase(phase: GamePhase): void {
    this.landing.classList.toggle("hidden", phase !== "landing");
    this.calibration.classList.toggle("hidden", phase !== "calibrating");
    this.pause.classList.toggle("hidden", phase !== "paused");
    this.hud.classList.toggle("hidden", phase !== "flying");
    this.reticle.classList.toggle("hidden", phase !== "flying");
  }

  setCalibrationStep(step: "hover" | "reach"): void {
    const hover = step === "hover";
    element("calibration-step").textContent = hover ? "Step 1 of 2 · Before takeoff" : "Step 2 of 2 · Measure your reach";
    element("calibration-title").textContent = hover ? "Set your hover pose" : "Set your full reach";
    element("calibration-description").textContent = hover
      ? "Look ahead and rest both arms at your sides. This records the pose that stops your flight."
      : "Point one or both arms straight ahead at full extension. This records where maximum speed begins.";
    element<HTMLButtonElement>("calibrate").textContent = hover ? "Set hover posture" : "Set full reach";
  }

  updateFlight(telemetry: FlightTelemetry): void {
    element("speed-fill").style.width = `${Math.round(telemetry.speedRatio * 100)}%`;
    element("speed-value").textContent = `${Math.round(telemetry.speed * 3.6)} km/h`;
  }

  updateNavigation(region: string, directions: string): void {
    element("region-name").textContent = region;
    element("region-directions").textContent = directions;
  }

  setVignette(intensity: number): void {
    element("vignette").style.opacity = this.settings.vignette ? String(intensity) : "0";
  }

  showToast(message: string): void {
    window.clearTimeout(this.toastTimer);
    this.toast.textContent = message;
    this.toast.classList.remove("hidden");
    this.toastTimer = window.setTimeout(() => this.toast.classList.add("hidden"), 1700);
  }

}
