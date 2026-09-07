import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { REGION_CONNECTIONS, WORLD_REGIONS } from "./WorldNavigation";

const smooth = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Local surface elevation. Scenery and terrain use this same deterministic field. */
export function terrainHeight(id: string, x: number, z: number): number {
  const region = WORLD_REGIONS.find((item) => item.id === id);
  if (!region) return 0.7;
  const r = region.radius;
  const city = id === "neon-city" || id === "sky-harbor";
  const peaks = city
    ? [[-0.32, -0.12, 17, 0.27], [0.32, 0.3, 23, 0.29], [-0.2, 0.48, 10, 0.22]]
    : [[-0.43, -0.28, 115, 0.25], [0.35, -0.34, 155, 0.24], [0.16, 0.46, 135, 0.28], [-0.44, 0.36, 90, 0.23]];
  let height = 0;
  for (const [px, pz, elevation, width] of peaks) {
    height += elevation * Math.exp(-((x / r - px) ** 2 + (z / r - pz) ** 2) / (width ** 2));
  }
  const distance = Math.hypot(x, z);
  height *= 1 - smooth((distance / r - 0.73) / 0.24);
  // Keep the existing water perfectly level and give lakes a gently rising shoreline.
  if (!city) height *= smooth((distance - 100) / 90);
  // Existing inter-district paths enter through broad valleys, not buried hillsides.
  for (const [a, b] of REGION_CONNECTIONS) {
    const otherId = a === id ? b : b === id ? a : null;
    if (!otherId) continue;
    const other = WORLD_REGIONS.find((item) => item.id === otherId)!;
    const dx = other.position.x - region.position.x;
    const dz = other.position.z - region.position.z;
    const length = Math.hypot(dx, dz);
    const along = (x * dx + z * dz) / length;
    const across = Math.abs((x * dz - z * dx) / length);
    const valley = smooth((along / r - 0.35) / 0.2) * (1 - smooth((across - 145) / 100));
    height *= 1 - valley;
  }
  return 0.7 + height;
}

function addVertex(data: {positions: number[]; normals: number[]; uvs: number[]}, id: string, x: number, z: number, lift: number, u: number, v: number): void {
  data.positions.push(x, terrainHeight(id, x, z) + lift, z);
  const normal = new Vector3(terrainHeight(id, x - 0.5, z) - terrainHeight(id, x + 0.5, z), 1,
    terrainHeight(id, x, z - 0.5) - terrainHeight(id, x, z + 0.5)).normalize();
  data.normals.push(normal.x, normal.y, normal.z);
  data.uvs.push(u, v);
}

/** Shared ring vertices and analytic normals give smooth hills without hard facets. */
export function terrainDisk(id: string, radius: number): VertexData {
  const arrays = {positions: [] as number[], normals: [] as number[], uvs: [] as number[]};
  const indices: number[] = [];
  const rings = 72;
  const sectors = 160;
  addVertex(arrays, id, 0, 0, 0, 0.5, 0.5);
  for (let ring = 1; ring <= rings; ring++) for (let sector = 0; sector < sectors; sector++) {
    const angle = sector / sectors * Math.PI * 2;
    const x = Math.cos(angle) * radius * ring / rings;
    const z = Math.sin(angle) * radius * ring / rings;
    addVertex(arrays, id, x, z, 0, x / (radius * 2) + 0.5, z / (radius * 2) + 0.5);
  }
  for (let sector = 0; sector < sectors; sector++) indices.push(0, 1 + sector, 1 + (sector + 1) % sectors);
  for (let ring = 1; ring < rings; ring++) for (let sector = 0; sector < sectors; sector++) {
    const a = 1 + (ring - 1) * sectors + sector;
    const b = a + sectors;
    const c = 1 + (ring - 1) * sectors + (sector + 1) % sectors;
    const d = c + sectors;
    indices.push(a, b, c, b, d, c);
  }
  const data = new VertexData();
  Object.assign(data, arrays, {indices});
  return data;
}

/** Roads and trails drape over the heightfield instead of cutting through hills. */
export function terrainStrip(id: string, points: readonly Vector3[], width: number, lift: number): VertexData {
  const arrays = {positions: [] as number[], normals: [] as number[], uvs: [] as number[]};
  const indices: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const tangent = points[Math.min(i + 1, points.length - 1)].subtract(points[Math.max(0, i - 1)]).normalize();
    for (let side = 0; side < 3; side++) {
      const offset = (side - 1) * width / 2;
      addVertex(arrays, id, points[i].x + tangent.z * offset, points[i].z - tangent.x * offset, lift, side / 2, i / (points.length - 1));
    }
    if (i) for (let side = 0; side < 2; side++) {
      const a = (i - 1) * 3 + side;
      indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
    }
  }
  const data = new VertexData();
  Object.assign(data, arrays, {indices});
  return data;
}
