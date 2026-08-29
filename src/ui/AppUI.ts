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

  updateFlight(telemetry: FlightTelemetry): void {
    element("speed-fill").style.width = `${Math.round(telemetry.speedRatio * 100)}%`;
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
