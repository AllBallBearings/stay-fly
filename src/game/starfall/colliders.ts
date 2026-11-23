import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** Simple solid volumes standing in for painted props during swept flight collision. */
export type Collider =
  | { kind: "sphere"; center: Vector3; radius: number }
  | { kind: "box"; center: Vector3; half: Vector3; yaw: number }
  | { kind: "cylinder"; x: number; z: number; bottom: number; top: number; radius: number };

export interface RayHit {
  distance: number;
  normal: Vector3;
}

function raySphere(origin: Vector3, direction: Vector3, center: Vector3, radius: number): RayHit | null {
  const ox = origin.x - center.x, oy = origin.y - center.y, oz = origin.z - center.z;
  const b = ox * direction.x + oy * direction.y + oz * direction.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  // Starting inside lets the player leave instead of being trapped.
  if (c < 0) return null;
  const discriminant = b * b - c;
  if (discriminant < 0) return null;
  const distance = -b - Math.sqrt(discriminant);
  if (distance < 0) return null;
  const point = origin.add(direction.scale(distance));
  return { distance, normal: point.subtract(center).normalize() };
}

function rayBox(origin: Vector3, direction: Vector3, center: Vector3, half: Vector3, yaw: number): RayHit | null {
  // Work in the box frame (rotation about +y only).
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const rx = origin.x - center.x, rz = origin.z - center.z;
  const o = [rx * cos - rz * sin, origin.y - center.y, rx * sin + rz * cos];
  const d = [direction.x * cos - direction.z * sin, direction.y, direction.x * sin + direction.z * cos];
  const h = [half.x, half.y, half.z];
  if (Math.abs(o[0]) < h[0] && Math.abs(o[1]) < h[1] && Math.abs(o[2]) < h[2]) return null;
  let near = -Infinity, far = Infinity, axis = -1, sign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (Math.abs(o[i]) > h[i]) return null;
      continue;
    }
    let t1 = (-h[i] - o[i]) / d[i];
    let t2 = (h[i] - o[i]) / d[i];
    let entrySign = -1;
    if (t1 > t2) { [t1, t2] = [t2, t1]; entrySign = 1; }
    if (t1 > near) { near = t1; axis = i; sign = entrySign; }
    far = Math.min(far, t2);
    if (near > far) return null;
  }
  if (near < 0 || axis < 0) return null;
  const local = [0, 0, 0];
  local[axis] = sign;
  // Rotate the local face normal back into world space.
  const normal = new Vector3(local[0] * cos + local[2] * sin, local[1], -local[0] * sin + local[2] * cos);
  return { distance: near, normal };
}

function rayCylinder(origin: Vector3, direction: Vector3, cylinder: Extract<Collider, { kind: "cylinder" }>): RayHit | null {
  const ox = origin.x - cylinder.x, oz = origin.z - cylinder.z;
  const insideRadius = ox * ox + oz * oz < cylinder.radius * cylinder.radius;
  if (insideRadius && origin.y > cylinder.bottom && origin.y < cylinder.top) return null;
  let best: RayHit | null = null;
  const a = direction.x * direction.x + direction.z * direction.z;
  if (a > 1e-9 && !insideRadius) {
    const b = ox * direction.x + oz * direction.z;
    const c = ox * ox + oz * oz - cylinder.radius * cylinder.radius;
    const discriminant = b * b - a * c;
    if (discriminant >= 0) {
      const distance = (-b - Math.sqrt(discriminant)) / a;
      const y = origin.y + direction.y * distance;
      if (distance >= 0 && y >= cylinder.bottom && y <= cylinder.top) {
        best = { distance, normal: new Vector3(ox + direction.x * distance, 0, oz + direction.z * distance).normalize() };
      }
    }
  }
  if (Math.abs(direction.y) > 1e-9) {
    for (const [plane, up] of [[cylinder.top, 1], [cylinder.bottom, -1]] as const) {
      const distance = (plane - origin.y) / direction.y;
      if (distance < 0 || (best && distance >= best.distance)) continue;
      const x = ox + direction.x * distance, z = oz + direction.z * distance;
      if (x * x + z * z <= cylinder.radius * cylinder.radius) best = { distance, normal: new Vector3(0, up, 0) };
    }
  }
  return best;
}

export function rayCollider(origin: Vector3, direction: Vector3, collider: Collider): RayHit | null {
  if (collider.kind === "sphere") return raySphere(origin, direction, collider.center, collider.radius);
  if (collider.kind === "box") return rayBox(origin, direction, collider.center, collider.half, collider.yaw);
  return rayCylinder(origin, direction, collider);
}

/** Broad-phase bounds so far-away props are skipped cheaply. */
export function colliderRadius(collider: Collider): { center: Vector3; radius: number } {
  if (collider.kind === "sphere") return { center: collider.center, radius: collider.radius };
  if (collider.kind === "box") return { center: collider.center, radius: collider.half.length() };
  const height = (collider.top - collider.bottom) / 2;
  return { center: new Vector3(collider.x, collider.bottom + height, collider.z), radius: Math.hypot(height, collider.radius) };
}
