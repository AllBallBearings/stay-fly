export type WebcamDiagnosticState =
  | "off"
  | "requesting"
  | "loading"
  | "ready"
  | "tracking"
  | "tracking-lost"
  | "error";

export interface TrackedJoint {
  x: number;
  y: number;
  z: number;
  visibility: number;
}

export interface TrackedPoint {
  x: number;
  y: number;
  z: number;
}

export interface TrackingSample {
  generation: number;
  frameId: number;
  capturedAtMs: number;
  inferenceMs: number;
  pose: null | { image: TrackedJoint[]; world: TrackedJoint[] };
  face: null | { matrix: number[]; landmarks: TrackedPoint[] };
  hands: Array<{ landmarks: TrackedPoint[] }>;
}

export interface WebcamWorkerAssets {
  wasmRoot: string;
  poseModel: string;
  faceModel: string;
  handModel: string;
}

export type WebcamWorkerRequest =
  | { type: "init"; generation: number; assets: WebcamWorkerAssets }
  | { type: "frame"; generation: number; frameId: number; capturedAtMs: number; frame: ImageBitmap }
  | { type: "dispose"; generation: number };

export type WebcamWorkerResponse =
  | { type: "ready"; generation: number }
  | { type: "sample"; sample: TrackingSample }
  | { type: "error"; generation: number; message: string };
