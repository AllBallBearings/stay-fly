/// <reference lib="webworker" />

import { FaceLandmarker, FilesetResolver, HandLandmarker, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { WebcamWorkerRequest, WebcamWorkerResponse } from "./types";

const worker = self as DedicatedWorkerGlobalScope;
let pose: PoseLandmarker | null = null;
let face: FaceLandmarker | null = null;
let hands: HandLandmarker | null = null;
let currentGeneration = 0;

type MediaPipeWorkerScope = DedicatedWorkerGlobalScope & {
  ModuleFactory?: unknown;
};

const reply = (message: WebcamWorkerResponse) => worker.postMessage(message);
const closeTasks = () => {
  pose?.close();
  face?.close();
  hands?.close();
  pose = null;
  face = null;
  hands = null;
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

worker.onmessage = async (event: MessageEvent<WebcamWorkerRequest>) => {
  const message = event.data;
  if (message.type === "dispose") {
    if (message.generation === currentGeneration) closeTasks();
    return;
  }
  if (message.type === "init") {
    currentGeneration = message.generation;
    closeTasks();
    try {
      const vision = await FilesetResolver.forVisionTasks(message.assets.wasmRoot, true);
      // MediaPipe's generic script loader does not reliably expose the module
      // factory when it dynamically imports an ES-module WASM bootstrap from a
      // module worker. Import it ourselves and reinstall the factory before each
      // task creation (MediaPipe clears the global after consuming it).
      const loaderPath = vision.wasmLoaderPath;
      const wasmLoader = await import(/* @vite-ignore */ loaderPath) as { default: unknown };
      vision.wasmLoaderPath = "";
      const installModuleFactory = () => {
        (worker as MediaPipeWorkerScope).ModuleFactory = wasmLoader.default;
      };
      if (message.generation !== currentGeneration) return;
      installModuleFactory();
      pose = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: message.assets.poseModel },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });
      if (message.generation !== currentGeneration) { closeTasks(); return; }
      installModuleFactory();
      face = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: message.assets.faceModel },
        runningMode: "VIDEO",
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true,
      });
      if (message.generation !== currentGeneration) { closeTasks(); return; }
      installModuleFactory();
      hands = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: message.assets.handModel },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.45,
        minHandPresenceConfidence: 0.45,
        minTrackingConfidence: 0.45,
      });
      reply({ type: "ready", generation: message.generation });
    } catch (error) {
      closeTasks();
      reply({ type: "error", generation: message.generation, message: `Tracker setup failed: ${errorMessage(error)}` });
    }
    return;
  }

  const { frame } = message;
  try {
    if (message.generation !== currentGeneration || !pose || !face || !hands) return;
    const started = performance.now();
    const poseResult = pose.detectForVideo(frame, message.capturedAtMs);
    const faceResult = face.detectForVideo(frame, message.capturedAtMs);
    const handResult = hands.detectForVideo(frame, message.capturedAtMs);
    const image = poseResult.landmarks[0];
    const world = poseResult.worldLandmarks[0];
    const faceLandmarks = faceResult.faceLandmarks[0];
    const matrix = faceResult.facialTransformationMatrixes[0]?.data;
    reply({
      type: "sample",
      sample: {
        generation: message.generation,
        frameId: message.frameId,
        capturedAtMs: message.capturedAtMs,
        inferenceMs: performance.now() - started,
        pose: image && world ? {
          image: image.map(({ x, y, z, visibility }) => ({ x, y, z, visibility })),
          world: world.map(({ x, y, z, visibility }) => ({ x, y, z, visibility })),
        } : null,
        face: matrix && faceLandmarks ? {
          matrix: [...matrix],
          landmarks: faceLandmarks.map(({ x, y, z }) => ({ x, y, z })),
        } : null,
        hands: handResult.landmarks.map((landmarks) => ({
          landmarks: landmarks.map(({ x, y, z }) => ({ x, y, z })),
        })),
      },
    });
  } catch (error) {
    reply({ type: "error", generation: message.generation, message: `Frame analysis failed: ${errorMessage(error)}` });
  } finally {
    frame.close();
  }
};
