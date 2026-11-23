import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/**
 * Starfall Lake's opening desktop view reproduces a painted reference frame. Like the
 * painting, it uses two-point perspective: the camera hovers 18 m above the meadow and
 * looks level due north (+z), and the lens is shifted so the horizon sits 80% of the
 * way down a 2240 × 1228 frame (verticals stay vertical). The vertical field of view
 * matches the 1.08 rad desktop camera. Landmarks are placed by where they appear in
 * that frame, so the composition holds whatever depth each one is given.
 */
export const REFERENCE_VIEW = {
  eye: new Vector3(0, 18, 0),
  width: 2240,
  height: 1228,
  focal: 614 / Math.tan(0.54),
  horizon: 987,
} as const;

/** Vertical lens shift (normalized device units) that puts the horizon on `horizon`. */
export const REFERENCE_LENS_SHIFT = 1 - 2 * REFERENCE_VIEW.horizon / REFERENCE_VIEW.height;

/** World ray through a frame pixel, scaled so its northward component is 1. */
export function referenceRay(px: number, py: number): Vector3 {
  return new Vector3(
    (px - REFERENCE_VIEW.width / 2) / REFERENCE_VIEW.focal,
    (REFERENCE_VIEW.horizon - py) / REFERENCE_VIEW.focal,
    1,
  );
}

/** The point seen at a frame pixel, `z` metres north of the eye. */
export function atDepth(px: number, py: number, z: number): Vector3 {
  return REFERENCE_VIEW.eye.add(referenceRay(px, py).scale(z - REFERENCE_VIEW.eye.z));
}

/** The point seen at a frame pixel where the view ray meets the horizontal plane `y`. */
export function onPlane(px: number, py: number, y: number): Vector3 {
  const ray = referenceRay(px, py);
  return REFERENCE_VIEW.eye.add(ray.scale((y - REFERENCE_VIEW.eye.y) / ray.y));
}

/** Azimuth (0 = north, positive toward east) and elevation of a frame pixel, in radians. */
export function referenceAngles(px: number, py: number): { azimuth: number; elevation: number } {
  const ray = referenceRay(px, py);
  return { azimuth: Math.atan2(ray.x, ray.z), elevation: Math.atan2(ray.y, Math.hypot(ray.x, ray.z)) };
}

/** Frame pixel of a world point in the opening view; used by tests and layout checks. */
export function projectToReference(point: Vector3): { x: number; y: number } {
  const relative = point.subtract(REFERENCE_VIEW.eye);
  return {
    x: REFERENCE_VIEW.width / 2 + REFERENCE_VIEW.focal * relative.x / relative.z,
    y: REFERENCE_VIEW.horizon - REFERENCE_VIEW.focal * relative.y / relative.z,
  };
}
