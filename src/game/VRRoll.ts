import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";

const radians = (degrees: number) => degrees * Math.PI / 180;
const response = (angle: number, deadzone: number, full: number) => {
  const t = Math.max(0, Math.min(1, (Math.abs(angle) - deadzone) / (full - deadzone)));
  return Math.sign(angle) * t * t * (3 - 2 * t);
};

/** Right is positive: the right hand is below the left in calibrated body space. */
export function handBankAngle(left: Vector3, right: Vector3, bodyRotation: Quaternion): number {
  const line = right.subtract(left);
  line.rotateByQuaternionToRef(bodyRotation.conjugate(), line);
  return Math.atan2(-line.y, Math.max(0.18, Math.hypot(line.x, line.z)));
}

/** Measure lateral head tilt, excluding yaw and pitch, in native tracking space. */
export function headBankAngle(head: Quaternion, neutral: Quaternion): number {
  const relative = neutral.conjugate().multiply(head).normalize();
  const forward = Vector3.Forward();
  const up = Vector3.Up();
  forward.rotateByQuaternionToRef(relative, forward);
  up.rotateByQuaternionToRef(relative, up);
  // Looking nearly straight up/down makes lateral tilt ambiguous; never amplify it.
  if (Math.abs(forward.y) > 0.97) return 0;
  const levelRight = Vector3.Cross(Vector3.Up(), forward).normalize();
  const levelUp = Vector3.Cross(forward, levelRight).normalize();
  return Math.atan2(Vector3.Dot(up, levelRight), Vector3.Dot(up, levelUp));
}

/** Both gestures must agree. Tiny tracking changes and opposing gestures give zero. */
export function combinedRoll(headAngle: number, handAngle: number): number {
  const head = response(headAngle, radians(5), radians(25));
  const hands = response(handAngle, radians(7), radians(30));
  if (head * hands <= 0) return 0;
  return Math.sign(head) * Math.sqrt(Math.abs(head * hands));
}
