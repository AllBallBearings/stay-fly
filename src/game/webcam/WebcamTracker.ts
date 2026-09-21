import type { TrackingSample, WebcamDiagnosticState, WebcamWorkerRequest, WebcamWorkerResponse } from "./types";

export interface WebcamTrackerCallbacks {
  onState: (state: WebcamDiagnosticState, detail: string) => void;
  onSample: (sample: TrackingSample) => void;
}

export class WebcamTracker {
  private generation = 0;
  private worker: Worker | null = null;
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private callbackHandle = 0;
  private callbackKind: "video" | "animation" | null = null;
  private inFlight = false;
  private ready = false;
  private frameId = 0;
  private lastSubmittedAt = -Infinity;

  constructor(private readonly callbacks: WebcamTrackerCallbacks) {}

  async start(video: HTMLVideoElement): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    this.video = video;
    this.callbacks.onState("requesting", "Waiting for camera permission…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30, max: 30 }, facingMode: "user" },
      });
      if (generation !== this.generation) { stream.getTracks().forEach((track) => track.stop()); return; }
      this.stream = stream;
      video.srcObject = stream;
      await video.play();
      if (generation !== this.generation) return;
      this.callbacks.onState("loading", "Camera ready. Loading local pose models…");
      const worker = new Worker(new URL("./tracking.worker.ts", import.meta.url), { type: "module" });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<WebcamWorkerResponse>) => this.handleWorkerMessage(event.data);
      worker.onerror = (event) => this.fail(`Tracking worker failed: ${event.message || "unknown error"}`);
      const base = new URL("./", document.baseURI);
      const request: WebcamWorkerRequest = {
        type: "init",
        generation,
        assets: {
          wasmRoot: new URL("mediapipe/wasm", base).href,
          poseModel: new URL("mediapipe/models/pose_landmarker_lite.task", base).href,
          faceModel: new URL("mediapipe/models/face_landmarker.task", base).href,
          handModel: new URL("mediapipe/models/hand_landmarker.task", base).href,
        },
      };
      worker.postMessage(request);
    } catch (error) {
      if (generation !== this.generation) return;
      const name = error instanceof DOMException ? error.name : "Error";
      const detail = name === "NotAllowedError"
        ? "Camera permission was denied. Keyboard and Quest modes are unchanged."
        : `Could not start the camera: ${error instanceof Error ? error.message : String(error)}`;
      this.fail(detail);
    }
  }

  stop(): void {
    this.generation++;
    this.cancelFrameLoop();
    if (this.worker) {
      const request: WebcamWorkerRequest = { type: "dispose", generation: this.generation - 1 };
      this.worker.postMessage(request);
      this.worker.terminate();
      this.worker = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
    this.video = null;
    this.inFlight = this.ready = false;
    this.frameId = 0;
    this.callbacks.onState("off", "Camera stopped.");
  }

  private handleWorkerMessage(message: WebcamWorkerResponse): void {
    const generation = message.type === "sample" ? message.sample.generation : message.generation;
    if (generation !== this.generation) return;
    if (message.type === "error") { this.inFlight = false; this.fail(message.message); return; }
    if (message.type === "ready") {
      this.ready = true;
      this.callbacks.onState("ready", "Models ready. Finding your head, arms, hands and fingers…");
      this.scheduleFrame();
      return;
    }
    this.inFlight = false;
    this.callbacks.onSample(message.sample);
    const tracked = Boolean(message.sample.pose && message.sample.face);
    this.callbacks.onState(tracked ? "tracking" : "tracking-lost", tracked
      ? `Pose and head detected · ${message.sample.hands.length} hand${message.sample.hands.length === 1 ? "" : "s"} found. Raise both open palms near your shoulders to calibrate.`
      : message.sample.pose
        ? "Head tracking lost. Face the camera to restore safe flight."
        : "No complete body pose detected. Move farther back and keep your upper body in frame.");
  }

  private scheduleFrame(): void {
    if (!this.video || !this.ready) return;
    const run = (now: number) => {
      this.callbackHandle = 0;
      void this.submitFrame(now);
      this.scheduleFrame();
    };
    if ("requestVideoFrameCallback" in this.video) {
      this.callbackKind = "video";
      this.callbackHandle = this.video.requestVideoFrameCallback(run);
    } else {
      this.callbackKind = "animation";
      this.callbackHandle = requestAnimationFrame(run);
    }
  }

  private async submitFrame(now: number): Promise<void> {
    if (!this.video || !this.worker || this.inFlight || now - this.lastSubmittedAt < 50) return;
    this.inFlight = true;
    this.lastSubmittedAt = now;
    const generation = this.generation;
    try {
      const frame = await createImageBitmap(this.video);
      if (generation !== this.generation || !this.worker) { frame.close(); return; }
      const request: WebcamWorkerRequest = { type: "frame", generation, frameId: ++this.frameId, capturedAtMs: now, frame };
      this.worker.postMessage(request, [frame]);
    } catch (error) {
      this.inFlight = false;
      if (generation === this.generation) this.fail(`Could not read a camera frame: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private cancelFrameLoop(): void {
    if (!this.callbackHandle) return;
    if (this.callbackKind === "video") this.video?.cancelVideoFrameCallback(this.callbackHandle);
    else cancelAnimationFrame(this.callbackHandle);
    this.callbackHandle = 0;
    this.callbackKind = null;
  }

  private fail(detail: string): void {
    this.callbacks.onState("error", detail);
    this.cancelFrameLoop();
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.video) { this.video.pause(); this.video.srcObject = null; }
    this.video = null;
    this.inFlight = this.ready = false;
  }
}
