import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import type { Material } from "@babylonjs/core/Materials/material";
import type { Scene } from "@babylonjs/core/scene";

export type RGB = readonly [number, number, number];

export const hex = (value: string): RGB => {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
};
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scaleRGB = (a: RGB, s: number): RGB => [a[0] * s, a[1] * s, a[2] * s];
export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

/**
 * Painted key light. It rakes in from high on the left and slightly toward the viewer,
 * matching the reference: west faces are lit, eastern flanks fall into blue shadow.
 */
export const SUN = new Vector3(-0.62, 0.62, -0.48).normalize();

export interface Palette {
  lit: RGB;
  mid: RGB;
  dark: RGB;
}

export const palette = (lit: string, mid: string, dark: string): Palette => ({ lit: hex(lit), mid: hex(mid), dark: hex(dark) });

/**
 * Three-tone gouache shading: a broad mid tone, a crisp lit plane and a soft core shadow.
 * `bias` shifts a surface toward light (+) or shadow (-) as a painter would.
 */
export function cel(normal: Vector3, colors: Palette, bias = 0): RGB {
  const light = Vector3.Dot(normal, SUN) + bias;
  const shade = mix(colors.dark, colors.mid, smoothstep(-0.16, 0.12, light));
  return mix(shade, colors.lit, smoothstep(0.36, 0.56, light));
}

export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/** Fractal value noise in roughly 0..1. */
export function fbm(x: number, y: number, octaves = 4): number {
  let total = 0;
  let amplitude = 0.5;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    total += valueNoise(x, y) * amplitude;
    norm += amplitude;
    x = x * 2.03 + 17.1;
    y = y * 2.03 - 9.7;
    amplitude *= 0.5;
  }
  return total / norm;
}

/** Ridged multifractal: sharp crests for painted mountain ridgelines. */
export function ridged(x: number, y: number, octaves = 5): number {
  let total = 0;
  let amplitude = 0.5;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave++) {
    const n = 1 - Math.abs(valueNoise(x, y) * 2 - 1);
    total += n * n * amplitude;
    norm += amplitude;
    x = x * 2.1 + 5.3;
    y = y * 2.1 - 3.1;
    amplitude *= 0.5;
  }
  return total / norm;
}

/** Deterministic PRNG so the valley is identical on every visit. */
export class Random {
  constructor(private seed: number) {}
  next(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
  range(min: number, max: number): number { return min + (max - min) * this.next(); }
}

/** Composes scale, yaw/pitch/roll and translation and bakes them into geometry. */
export function place(
  data: VertexData,
  position: Vector3,
  options: { scale?: Vector3; yaw?: number; pitch?: number; roll?: number } = {},
): VertexData {
  const rotation = Quaternion.FromEulerAngles(options.pitch ?? 0, options.yaw ?? 0, options.roll ?? 0);
  data.transform(Matrix.Compose(options.scale ?? Vector3.One(), rotation, position));
  return data;
}

/** Splits shared vertices so every triangle carries its own face normal (crisp planes). */
export function faceted(data: VertexData): VertexData {
  const positions = data.positions!;
  const normals = data.normals;
  const indices = data.indices!;
  const out = new VertexData();
  const p: number[] = [];
  const n: number[] = [];
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let i = 0; i < indices.length; i += 3) {
    const [i0, i1, i2] = [indices[i], indices[i + 1], indices[i + 2]];
    a.fromArray(positions, i0 * 3); b.fromArray(positions, i1 * 3); c.fromArray(positions, i2 * 3);
    const face = Vector3.Cross(b.subtract(a), c.subtract(a));
    if (normals) {
      const reference = new Vector3(normals[i0 * 3] + normals[i1 * 3] + normals[i2 * 3],
        normals[i0 * 3 + 1] + normals[i1 * 3 + 1] + normals[i2 * 3 + 1],
        normals[i0 * 3 + 2] + normals[i1 * 3 + 2] + normals[i2 * 3 + 2]);
      if (Vector3.Dot(face, reference) < 0) face.scaleInPlace(-1);
    }
    face.normalize();
    for (const v of [a, b, c]) { p.push(v.x, v.y, v.z); n.push(face.x, face.y, face.z); }
  }
  out.positions = p;
  out.normals = n;
  out.indices = Array.from({ length: p.length / 3 }, (_, i) => i);
  return out;
}

export type VertexPainter = (position: Vector3, normal: Vector3, index: number) => RGB;

interface Cell {
  positions: number[];
  colors: number[];
  uvs: number[];
  indices: number[];
}

/**
 * Collects baked, vertex-painted world geometry and emits one mesh per spatial cell.
 * One unlit material renders everything, so draw calls scale with area, not props.
 */
export class PaintBatch {
  private readonly cells = new Map<string, Cell>();
  private readonly point = new Vector3();
  private readonly normal = new Vector3();

  /** `uvScale` adds planar world-space UVs (metres per texture repeat) for a detail texture. */
  constructor(private readonly cellSize: number, private readonly uvScale = 0) {}

  add(data: VertexData, painter: VertexPainter, group = ""): void {
    const positions = data.positions!;
    const normals = data.normals!;
    const indices = data.indices!;
    let cx = 0, cz = 0;
    for (let i = 0; i < positions.length; i += 3) { cx += positions[i]; cz += positions[i + 2]; }
    const count = positions.length / 3;
    const key = `${group}:${Math.floor(cx / count / this.cellSize)}:${Math.floor(cz / count / this.cellSize)}`;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = { positions: [], colors: [], uvs: [], indices: [] };
      this.cells.set(key, cell);
    }
    const base = cell.positions.length / 3;
    for (let i = 0; i < count; i++) {
      this.point.fromArray(positions, i * 3);
      this.normal.fromArray(normals, i * 3);
      const color = painter(this.point, this.normal, i);
      cell.positions.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      cell.colors.push(color[0], color[1], color[2], 1);
      if (this.uvScale) cell.uvs.push(positions[i * 3] / this.uvScale, positions[i * 3 + 2] / this.uvScale);
    }
    for (const index of indices) cell.indices.push(base + index);
  }

  get vertexCount(): number {
    let total = 0;
    for (const cell of this.cells.values()) total += cell.positions.length / 3;
    return total;
  }

  build(scene: Scene, name: string, material: Material): Mesh[] {
    const meshes: Mesh[] = [];
    for (const [key, cell] of this.cells) {
      if (!cell.indices.length) continue;
      const mesh = new Mesh(`${name}-${key}`, scene);
      const data = new VertexData();
      data.positions = cell.positions;
      data.colors = cell.colors;
      if (this.uvScale) data.uvs = cell.uvs;
      data.indices = cell.indices;
      data.applyToMesh(mesh, false);
      mesh.material = material;
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      mesh.doNotSyncBoundingInfo = true;
      meshes.push(mesh);
    }
    this.cells.clear();
    return meshes;
  }
}
