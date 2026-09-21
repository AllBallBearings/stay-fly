import type { FlightTelemetry, GamePhase, GameSettings } from "../game/types";
import type { TrackingSample, WebcamDiagnosticState } from "../game/webcam/types";
import { classifyHand } from "../game/webcam/WebcamControls";

const FACE_OVAL = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10];
const LEFT_EYE = [33,160,158,133,153,144,33];
const RIGHT_EYE = [362,385,387,263,373,380,362];
const NOSE_BRIDGE = [168,6,197,195,5,4,1,19,94];
const HAND_SEGMENTS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]] as const;

interface UIActions {
  enterVR: () => void;
  playDesktop: () => void;
  playKeyboard: () => void;
  calibrate: () => void;
  resume: () => void;
  recalibrate: () => void;
  restart: () => void;
  testWebcam: () => void;
  stopWebcam: () => void;
  startWebcamFlight: () => void;
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
  private readonly rollMode = element<HTMLSelectElement>("roll-mode");
  private readonly fullRolls = element<HTMLInputElement>("full-rolls");
  private readonly webcamDiagnostic = element("webcam-diagnostic");
  private readonly webcamVideo = element<HTMLVideoElement>("webcam-video");
  private readonly webcamOverlay = element<HTMLCanvasElement>("webcam-overlay");
  private readonly webcamStage = element("webcam-stage");
  private readonly webcamCalibrationSlot = element("webcam-calibration-slot");
  private readonly calibrationFeedback = element("calibration-feedback");
  private readonly webcamStatus = element("webcam-status");
  private readonly webcamMetrics = element("webcam-metrics");
  private readonly startWebcamFlightButton = element<HTMLButtonElement>("start-webcam-flight");
  private readonly webcamFlightStatus = element("webcam-flight-status");
  private webcamFlightMode = false;
  private diagnosticLastSampleAt = 0;
  private diagnosticFps = 0;
  private toastTimer = 0;

  constructor(
    private readonly settings: GameSettings,
    actions: UIActions,
  ) {
    element("play-desktop").addEventListener("click", actions.playDesktop);
    element("play-keyboard").addEventListener("click", actions.playKeyboard);
    this.enterVRButton.addEventListener("click", actions.enterVR);
    element("calibrate").addEventListener("click", actions.calibrate);
    element("resume").addEventListener("click", actions.resume);
    element("recalibrate").addEventListener("click", actions.recalibrate);
    element("restart").addEventListener("click", actions.restart);
    element("test-webcam").addEventListener("click", actions.testWebcam);
    element("restart-webcam").addEventListener("click", actions.testWebcam);
    element("stop-webcam").addEventListener("click", actions.stopWebcam);
    this.startWebcamFlightButton.addEventListener("click", actions.startWebcamFlight);

    this.comfortMode.checked = settings.comfortMode;
    this.vignetteToggle.checked = settings.vignette;
    this.rollMode.value = settings.rollMode ?? "assisted";
    this.fullRolls.checked = settings.fullRolls !== false;
    this.rollMode.addEventListener("change", () => { settings.rollMode = this.rollMode.value === "free" ? "free" : "assisted"; });
    this.fullRolls.addEventListener("change", () => { settings.fullRolls = this.fullRolls.checked; });
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
    this.rollMode.value = this.settings.rollMode ?? "assisted";
    this.fullRolls.checked = this.settings.fullRolls !== false;
    this.landing.classList.toggle("hidden", phase !== "landing");
    this.calibration.classList.toggle("hidden", phase !== "calibrating");
    this.pause.classList.toggle("hidden", phase !== "paused");
    this.hud.classList.toggle("hidden", phase !== "flying");
    this.reticle.classList.toggle("hidden", phase !== "flying");
    if (this.webcamFlightMode && (phase === "flying" || phase === "paused")) {
      document.body.append(this.webcamStage);
      this.webcamStage.classList.add("webcam-flight-preview");
      this.webcamStage.classList.remove("hidden");
    } else if (this.webcamFlightMode && phase === "calibrating") {
      this.webcamStage.classList.remove("webcam-flight-preview");
      this.webcamStage.classList.remove("hidden");
      this.webcamCalibrationSlot.append(this.webcamStage);
    } else {
      this.webcamStage.classList.add("hidden");
      this.webcamStage.classList.remove("webcam-flight-preview");
    }
  }

  setCalibrationStep(step: "hover" | "reach"): void {
    this.calibration.classList.remove("webcam-calibration");
    const hover = step === "hover";
    element("calibration-step").textContent = hover ? "Step 1 of 2 · Before takeoff" : "Step 2 of 2 · Measure your reach";
    element("calibration-title").textContent = hover ? "Set your hover pose" : "Set your full reach";
    element("calibration-description").textContent = hover
      ? "Look ahead and rest both arms at your sides. This records the pose that stops your flight."
      : "Extend both arms straight ahead with hands level to set full speed and neutral bank. One arm also works.";
    element<HTMLButtonElement>("calibrate").textContent = hover ? "Set hover posture" : "Set full reach";
    element("calibration-hint").textContent = "Controller: press A or X for each step · point your arms to steer · click thumbstick to pause";
    this.webcamCalibrationSlot.classList.add("hidden");
    this.calibrationFeedback.textContent = "";
  }

  setWebcamCalibrationStep(step: "hover" | "reach"): void {
    this.calibration.classList.add("webcam-calibration");
    const hover = step === "hover";
    element("calibration-step").textContent = hover ? "Webcam setup · Step 1 of 2" : "Webcam setup · Step 2 of 2";
    element("calibration-title").textContent = hover ? "Capture hands-up hover" : "Capture full forward reach";
    element("calibration-description").textContent = hover
      ? "Hold both open palms beside your shoulders like a hands-up pose. One click starts both captures; you will not need to touch the mouse while posing."
      : "Close both hands into fists and extend both arms comfortably toward the screen. Keep holding while the automatic countdown finishes."
    element<HTMLButtonElement>("calibrate").textContent = hover ? "Begin hands-free calibration" : "Capturing automatically…";
    element("calibration-hint").textContent = "Keep the camera running · Space is emergency hover · Esc pauses";
    this.webcamCalibrationSlot.classList.remove("hidden");
    this.webcamCalibrationSlot.append(this.webcamStage);
  }

  setCalibrationFeedback(message: string, tone: "normal" | "error" = "normal"): void {
    this.calibrationFeedback.textContent = message;
    this.calibrationFeedback.dataset.tone = tone;
  }

  setWebcamCalibrationBusy(busy: boolean, label?: string): void {
    const button = element<HTMLButtonElement>("calibrate");
    button.disabled = busy;
    if (label) button.textContent = label;
  }

  setWebcamFlightMode(active: boolean): void {
    this.webcamFlightMode = active;
    this.webcamFlightStatus.classList.toggle("hidden", !active);
    if (!active) {
      this.webcamStage.classList.add("hidden");
      this.webcamStage.classList.remove("webcam-flight-preview");
    }
  }

  webcamSetupVideo(): HTMLVideoElement { return this.webcamVideo; }

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

  showWebcamDiagnostic(): HTMLVideoElement {
    this.webcamDiagnostic.querySelector(".webcam-card")?.append(this.webcamStage);
    this.webcamDiagnostic.classList.remove("hidden");
    return this.webcamVideo;
  }

  hideWebcamDiagnostic(): void {
    this.webcamDiagnostic.classList.add("hidden");
    this.clearWebcamCanvas();
  }

  setWebcamDiagnosticState(state: WebcamDiagnosticState, detail: string): void {
    this.webcamStatus.textContent = detail;
    this.webcamDiagnostic.dataset.state = state;
    this.startWebcamFlightButton.disabled = state !== "tracking";
    if (this.webcamFlightMode) {
      this.webcamFlightStatus.dataset.state = state;
      this.webcamFlightStatus.textContent = state === "tracking"
        ? "● Webcam tracking"
        : state === "tracking-lost" ? "● Tracking lost — hovering" : state === "error" ? "● Camera error — hovering" : "● Webcam starting";
    }
    if (state === "error" || state === "tracking-lost" || state === "off") this.clearWebcamCanvas();
  }

  updateWebcamDiagnostic(sample: TrackingSample): void {
    const now = performance.now();
    if (this.diagnosticLastSampleAt) {
      const instantaneous = 1000 / Math.max(1, now - this.diagnosticLastSampleAt);
      this.diagnosticFps += (instantaneous - this.diagnosticFps) * 0.18;
    }
    this.diagnosticLastSampleAt = now;
    const pose = sample.pose;
    const armReach = (shoulder: number, wrist: number) => {
      if (!pose) return null;
      const a = pose.world[shoulder];
      const b = pose.world[wrist];
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    };
    const confidence = (indices: number[]) => pose
      ? Math.min(...indices.map((index) => pose.image[index]?.visibility ?? 0))
      : 0;
    const matrix = sample.face?.matrix;
    // MediaPipe's transform is a flattened 4x4 matrix. This candidate bank is
    // deliberately diagnostic-only until a real-camera tilt/yaw/pitch check confirms signs.
    const bank = matrix?.length === 16 ? Math.atan2(matrix[1], matrix[0]) * 180 / Math.PI : null;
    const shoulderWidth = pose ? Math.max(0.04, Math.abs(pose.image[11].x - pose.image[12].x)) : 1;
    const handDepth = sample.hands.map((hand) => {
      const a = hand.landmarks[5]; const b = hand.landmarks[17];
      return (Math.hypot(a.x - b.x, a.y - b.y) / shoulderWidth).toFixed(2);
    });
    const values = [
      `Pose: ${pose ? `${(confidence([11,12,13,14,15,16]) * 100).toFixed(0)}% joints` : "lost"}`,
      `Face: ${sample.face ? "found" : "lost"}`,
      `Hands: ${sample.hands.length} · ${sample.hands.map((hand) => classifyHand(hand.landmarks)).join(" / ") || "lost"}`,
      `Hand depth: ${handDepth.join(" / ") || "—"}`,
      `Inference: ${sample.inferenceMs.toFixed(0)} ms · ${this.diagnosticFps.toFixed(0)} Hz`,
      `Left reach: ${armReach(11, 15)?.toFixed(3) ?? "—"} m`,
      `Right reach: ${armReach(12, 16)?.toFixed(3) ?? "—"} m`,
      `Head bank*: ${bank === null ? "—" : `${bank.toFixed(1)}°`}`,
    ];
    this.webcamMetrics.replaceChildren(...values.map((value) => {
      const span = document.createElement("span");
      span.textContent = value;
      return span;
    }));
    this.drawWebcamPose(sample);
  }

  private drawWebcamPose(sample: TrackingSample): void {
    const width = this.webcamVideo.videoWidth || 960;
    const height = this.webcamVideo.videoHeight || 540;
    if (this.webcamOverlay.width !== width) this.webcamOverlay.width = width;
    if (this.webcamOverlay.height !== height) this.webcamOverlay.height = height;
    const context = this.webcamOverlay.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    const pose = sample.pose?.image;
    const segments = [[11,12],[11,13],[13,15],[12,14],[14,16]] as const;
    context.lineWidth = Math.max(3, width / 240);
    context.lineCap = "round";
    if (pose) {
      for (const [a, b] of segments) {
        const from = pose[a]; const to = pose[b];
        context.strokeStyle = Math.min(from.visibility, to.visibility) >= 0.65 ? "#74f6ff" : "#ffb86b";
        context.beginPath(); context.moveTo(from.x * width, from.y * height); context.lineTo(to.x * width, to.y * height); context.stroke();
      }
      for (const index of [11,12,13,14,15,16]) {
        const joint = pose[index];
        context.fillStyle = joint.visibility >= 0.65 ? "#d8ffff" : "#ff8b6b";
        context.beginPath(); context.arc(joint.x * width, joint.y * height, Math.max(5, width / 130), 0, Math.PI * 2); context.fill();
      }
    }

    for (const hand of sample.hands) {
      const gesture = classifyHand(hand.landmarks);
      const color = gesture === "open" ? "#75ffd1" : gesture === "closed" ? "#d6a1ff" : "#ffca67";
      context.strokeStyle = color;
      context.lineWidth = Math.max(2, width / 360);
      for (const [a, b] of HAND_SEGMENTS) {
        const from = hand.landmarks[a]; const to = hand.landmarks[b];
        context.beginPath(); context.moveTo(from.x * width, from.y * height); context.lineTo(to.x * width, to.y * height); context.stroke();
      }
      context.fillStyle = color;
      for (const index of [0,4,8,12,16,20]) {
        const point = hand.landmarks[index];
        context.beginPath(); context.arc(point.x * width, point.y * height, Math.max(3, width / 260), 0, Math.PI * 2); context.fill();
      }
    }

    const face = sample.face?.landmarks;
    if (!face?.length) return;
    const drawPath = (indices: number[], color: string, lineWidth: number) => {
      context.strokeStyle = color;
      context.lineWidth = lineWidth;
      context.beginPath();
      indices.forEach((index, position) => {
        const point = face[index];
        if (position === 0) context.moveTo(point.x * width, point.y * height);
        else context.lineTo(point.x * width, point.y * height);
      });
      context.stroke();
    };
    const fineLine = Math.max(1.5, width / 480);
    drawPath(FACE_OVAL, "rgba(176, 255, 222, .9)", fineLine);
    drawPath(LEFT_EYE, "rgba(176, 255, 222, .8)", fineLine);
    drawPath(RIGHT_EYE, "rgba(176, 255, 222, .8)", fineLine);
    drawPath(NOSE_BRIDGE, "rgba(176, 255, 222, .7)", fineLine);
    drawPath([234, 1, 454], "rgba(255, 202, 103, .9)", Math.max(2, width / 360));
    drawPath([10, 1, 152], "rgba(255, 202, 103, .9)", Math.max(2, width / 360));
    const nose = face[1];
    context.fillStyle = "#fff1bc";
    context.beginPath();
    context.arc(nose.x * width, nose.y * height, Math.max(3, width / 240), 0, Math.PI * 2);
    context.fill();
  }

  private clearWebcamCanvas(): void {
    this.webcamOverlay.getContext("2d")?.clearRect(0, 0, this.webcamOverlay.width, this.webcamOverlay.height);
    this.diagnosticLastSampleAt = this.diagnosticFps = 0;
  }

}
