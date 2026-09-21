import type { FlightIntent } from "../FlightController";
import type { TrackingSample, TrackedPoint } from "./types";

const LEFT = { shoulder: 11, elbow: 13, wrist: 15 } as const;
const RIGHT = { shoulder: 12, elbow: 14, wrist: 16 } as const;
type ArmIndices = { readonly shoulder: number; readonly elbow: number; readonly wrist: number };
const MIN_VISIBILITY = 0.04;
const MAX_SAMPLE_AGE_MS = 220;
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const smoothstep = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const deadzone = (value: number) => Math.sign(value) * clamp((Math.abs(value) - 0.08) / 0.92);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const distance = (a: TrackedPoint, b: TrackedPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const distance2D = (a: TrackedPoint, b: TrackedPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const headBank = (sample: TrackingSample) => {
  const matrix = sample.face?.matrix;
  return matrix?.length === 16 ? Math.atan2(matrix[1], matrix[0]) : 0;
};
const handBank = (sample: TrackingSample) => {
  const pose = sample.pose!.image;
  const left = pose[LEFT.wrist]; const right = pose[RIGHT.wrist];
  return Math.atan2(right.y - left.y, Math.max(0.05, Math.abs(right.x - left.x)));
};
const bankResponse = (angle: number, deadDegrees: number, fullDegrees: number) => {
  const dead = deadDegrees * Math.PI / 180; const full = fullDegrees * Math.PI / 180;
  return Math.sign(angle) * smoothstep((Math.abs(angle) - dead) / (full - dead));
};

interface ArmCalibration {
  restReach: number;
  fullReach: number;
  restPalmScale: number;
  fullPalmScale: number;
  centerX: number;
  centerY: number;
}

export type HandGesture = "open" | "closed" | "uncertain";

/** Scale-independent finger classification; the thumb is deliberately optional. */
export const classifyHand = (landmarks: TrackedPoint[]): HandGesture => {
  if (landmarks.length < 21) return "uncertain";
  const wrist = landmarks[0];
  const fingers = [[5, 6, 8], [9, 10, 12], [13, 14, 16], [17, 18, 20]] as const;
  const extended = fingers.filter(([mcp, pip, tip]) =>
    distance(wrist, landmarks[tip]) > distance(wrist, landmarks[pip]) * 1.12
    && distance(landmarks[mcp], landmarks[tip]) > distance(landmarks[mcp], landmarks[pip]) * 1.2
  ).length;
  const palmWidth = Math.max(0.001, distance(landmarks[5], landmarks[17]));
  const fingerSpan = distance(landmarks[8], landmarks[20]);
  if (extended >= 3 && fingerSpan > palmWidth * 1.05) return "open";
  if (extended <= 1) return "closed";
  return "uncertain";
};

interface AssociatedHands {
  left: TrackedPoint[] | null;
  right: TrackedPoint[] | null;
}

const associateHands = (sample: TrackingSample): AssociatedHands => {
  const pose = sample.pose?.image;
  if (!pose || !sample.hands.length) return { left: null, right: null };
  const candidates = sample.hands.map((hand) => hand.landmarks).filter((points) => points.length >= 21).slice(0, 2);
  if (!candidates.length) return { left: null, right: null };
  if (candidates.length === 1) {
    const points = candidates[0];
    return distance2D(points[0], pose[LEFT.wrist]) <= distance2D(points[0], pose[RIGHT.wrist])
      ? { left: points, right: null } : { left: null, right: points };
  }
  const direct = distance2D(candidates[0][0], pose[LEFT.wrist]) + distance2D(candidates[1][0], pose[RIGHT.wrist]);
  const crossed = distance2D(candidates[1][0], pose[LEFT.wrist]) + distance2D(candidates[0][0], pose[RIGHT.wrist]);
  return direct <= crossed
    ? { left: candidates[0], right: candidates[1] }
    : { left: candidates[1], right: candidates[0] };
};

const palmScale = (sample: TrackingSample, hand: TrackedPoint[]) => {
  const pose = sample.pose!.image;
  const shoulderWidth = Math.max(0.04, Math.abs(pose[LEFT.shoulder].x - pose[RIGHT.shoulder].x));
  return distance2D(hand[5], hand[17]) / shoulderWidth;
};

interface WebcamCalibration {
  shoulderWidth: number;
  headBank: number;
  handBank: number;
  left: ArmCalibration;
  right: ArmCalibration;
}

/** Pure pose-to-flight mapper. It owns no camera, DOM, or render state. */
export class WebcamControls {
  private samples: TrackingSample[] = [];
  private calibration: WebcamCalibration | null = null;
  private restCapture: { shoulderWidth: number; headBank: number; handBank: number; leftReach: number; rightReach: number; leftPalmScale: number; rightPalmScale: number } | null = null;
  private filtered = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
  private calibrationIssue = "";

  addSample(sample: TrackingSample): void {
    this.samples.push(sample);
    if (this.samples.length > 30) this.samples.shift();
  }

  resetCalibration(): void {
    this.calibration = null;
    this.restCapture = null;
    this.filtered = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    this.calibrationIssue = "";
  }

  captureRest(now = performance.now()): boolean {
    const samples = this.recentValid(now).filter((sample) => {
      const hands = associateHands(sample);
      if (!hands.left || !hands.right || classifyHand(hands.left) !== "open" || classifyHand(hands.right) !== "open") return false;
      const pose = sample.pose!.image;
      const width = Math.max(0.04, Math.abs(pose[LEFT.shoulder].x - pose[RIGHT.shoulder].x));
      return distance2D(pose[LEFT.shoulder], pose[LEFT.wrist]) < width * 1.35
        && distance2D(pose[RIGHT.shoulder], pose[RIGHT.wrist]) < width * 1.35;
    });
    if (samples.length < 4) {
      this.calibrationIssue = "I need both open palms visible beside your shoulders.";
      return false;
    }
    this.restCapture = {
      shoulderWidth: median(samples.map((sample) => Math.abs(sample.pose!.image[LEFT.shoulder].x - sample.pose!.image[RIGHT.shoulder].x))),
      headBank: median(samples.map(headBank)),
      handBank: median(samples.map(handBank)),
      leftReach: median(samples.map((sample) => distance(sample.pose!.world[LEFT.shoulder], sample.pose!.world[LEFT.wrist]))),
      rightReach: median(samples.map((sample) => distance(sample.pose!.world[RIGHT.shoulder], sample.pose!.world[RIGHT.wrist]))),
      leftPalmScale: median(samples.map((sample) => palmScale(sample, associateHands(sample).left!))),
      rightPalmScale: median(samples.map((sample) => palmScale(sample, associateHands(sample).right!))),
    };
    this.samples = [];
    this.calibrationIssue = "";
    return this.restCapture.shoulderWidth > 0.04;
  }

  captureReach(now = performance.now()): boolean {
    if (!this.restCapture) return false;
    const recent = this.recentValid(now);
    const samples = recent.filter((sample) => {
      const hands = associateHands(sample);
      // Real fists are frequently classified as "uncertain" when fingertips
      // occlude one another. Only reject a clearly open safety-stop palm.
      return Boolean(hands.left && hands.right && classifyHand(hands.left) !== "open" && classifyHand(hands.right) !== "open");
    });
    if (samples.length < 4) {
      const latest = recent.at(-1);
      const gestures = latest ? Object.values(associateHands(latest)).filter(Boolean).map((hand) => classifyHand(hand!)) : [];
      this.calibrationIssue = gestures.length < 2
        ? `I can only see ${gestures.length} hand${gestures.length === 1 ? "" : "s"}. Keep both fists visible.`
        : `A hand still looks open (${gestures.join(" / ")}). Curl your fingers and keep both arms extended.`;
      return false;
    }
    const arm = (indices: ArmIndices, side: keyof AssociatedHands, restReach: number, restPalmScale: number): ArmCalibration => ({
      restReach,
      fullReach: median(samples.map((sample) => distance(sample.pose!.world[indices.shoulder], sample.pose!.world[indices.wrist]))),
      restPalmScale,
      fullPalmScale: median(samples.map((sample) => palmScale(sample, associateHands(sample)[side]!))),
      centerX: median(samples.map((sample) => sample.pose!.image[indices.wrist].x)),
      centerY: median(samples.map((sample) => sample.pose!.image[indices.wrist].y)),
    });
    const left = arm(LEFT, "left", this.restCapture.leftReach, this.restCapture.leftPalmScale);
    const right = arm(RIGHT, "right", this.restCapture.rightReach, this.restCapture.rightPalmScale);
    const hasDepthChange = (value: ArmCalibration) =>
      value.fullReach - value.restReach >= Math.max(0.04, value.restReach * 0.12)
      || value.fullPalmScale - value.restPalmScale >= Math.max(0.015, value.restPalmScale * 0.08);
    if (!hasDepthChange(left) || !hasDepthChange(right)) {
      const scaleRatio = (value: ArmCalibration) => value.fullPalmScale / Math.max(0.001, value.restPalmScale);
      this.calibrationIssue = `Both hands are visible, but one fist does not look closer yet (depth L ${scaleRatio(left).toFixed(2)}× / R ${scaleRatio(right).toFixed(2)}×). Keep both fists in frame and bring them toward the camera.`;
      return false;
    }
    this.calibration = { ...this.restCapture, left, right };
    this.samples = [];
    this.calibrationIssue = "";
    return true;
  }

  isCalibrated(): boolean { return this.calibration !== null; }
  getCalibrationIssue(): string { return this.calibrationIssue; }

  hasHandsUpPose(now = performance.now()): boolean {
    const sample = this.samples.at(-1);
    if (!sample || now - sample.capturedAtMs > MAX_SAMPLE_AGE_MS || !this.valid(sample)) return false;
    const hands = associateHands(sample);
    if (!hands.left || !hands.right || classifyHand(hands.left) !== "open" || classifyHand(hands.right) !== "open") return false;
    const pose = sample.pose!.image;
    const width = Math.max(0.04, Math.abs(pose[LEFT.shoulder].x - pose[RIGHT.shoulder].x));
    return distance2D(pose[LEFT.shoulder], pose[LEFT.wrist]) < width * 1.35
      && distance2D(pose[RIGHT.shoulder], pose[RIGHT.wrist]) < width * 1.35;
  }

  read(now: number, dt: number, emergencyHover = false): FlightIntent {
    const sample = this.samples.at(-1);
    if (emergencyHover || !sample || !this.calibration || now - sample.capturedAtMs > MAX_SAMPLE_AGE_MS || !this.valid(sample)) return this.hover();
    const pose = sample.pose!;
    const hands = associateHands(sample);
    if ((hands.left && classifyHand(hands.left) === "open") || (hands.right && classifyHand(hands.right) === "open")) return this.hover();
    const shoulderWidth = Math.max(this.calibration.shoulderWidth, 0.04);
    const mapArm = (indices: ArmIndices, calibration: ArmCalibration, hand: TrackedPoint[] | null) => {
      const imageShoulder = pose.image[indices.shoulder]; const imageWrist = pose.image[indices.wrist];
      if (!hand || classifyHand(hand) === "open" || Math.min(imageShoulder.visibility, imageWrist.visibility) < MIN_VISIBILITY) return null;
      const extension = distance(pose.world[indices.shoulder], pose.world[indices.wrist]);
      const reachRange = calibration.fullReach - calibration.restReach;
      const scaleRange = calibration.fullPalmScale - calibration.restPalmScale;
      const reachThrust = reachRange > 0.03 ? smoothstep((extension - calibration.restReach) / reachRange) : 0;
      const scaleThrust = scaleRange > 0.01
        ? smoothstep((palmScale(sample, hand) - calibration.restPalmScale) / scaleRange)
        : 0;
      const thrust = Math.max(reachThrust, scaleThrust);
      return {
        thrust,
        yaw: deadzone(-(imageWrist.x - calibration.centerX) / (shoulderWidth * 0.8)),
        pitch: deadzone((imageWrist.y - calibration.centerY) / (shoulderWidth * 0.65)),
      };
    };
    const left = mapArm(LEFT, this.calibration.left, hands.left); const right = mapArm(RIGHT, this.calibration.right, hands.right);
    const arms = [left, right].filter((arm): arm is NonNullable<typeof arm> => Boolean(arm && arm.thrust > 0.03));
    if (!arms.length) return this.hover();
    const weight = arms.reduce((sum, arm) => sum + arm.thrust, 0);
    const target = {
      throttle: clamp(0.5 * ((left?.thrust ?? 0) + (right?.thrust ?? 0))),
      yaw: clamp(arms.reduce((sum, arm) => sum + arm.yaw * arm.thrust, 0) / weight, -1, 1),
      pitch: clamp(arms.reduce((sum, arm) => sum + arm.pitch * arm.thrust, 0) / weight, -1, 1),
      roll: 0,
    };
    if (left && right && left.thrust > 0.1 && right.thrust > 0.1) {
      const head = bankResponse(wrap(headBank(sample) - this.calibration.headBank), 5, 25);
      const hands = bankResponse(wrap(handBank(sample) - this.calibration.handBank), 7, 30);
      if (head * hands > 0) target.roll = Math.sign(head) * Math.sqrt(Math.abs(head * hands));
    }
    const alpha = 1 - Math.exp(-Math.min(dt, 0.05) / 0.06);
    for (const key of ["throttle", "yaw", "pitch", "roll"] as const) this.filtered[key] += (target[key] - this.filtered[key]) * alpha;
    return { ...this.filtered, brake: 0, gestureStunts: true, allowFullRolls: false };
  }

  private hover(): FlightIntent {
    this.filtered = { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
    return { throttle: 0, brake: 0, yaw: 0, pitch: 0, roll: 0, hover: true, gestureStunts: true, allowFullRolls: false };
  }

  private recentValid(now: number): TrackingSample[] {
    return this.samples.filter((sample) => now - sample.capturedAtMs <= 1200 && this.valid(sample)).slice(-12);
  }

  private valid(sample: TrackingSample): boolean {
    if (!sample.pose || !sample.face) return false;
    return [LEFT.shoulder, LEFT.elbow, LEFT.wrist, RIGHT.shoulder, RIGHT.elbow, RIGHT.wrist]
      .every((index) => (sample.pose!.image[index]?.visibility ?? 0) >= MIN_VISIBILITY);
  }
}
