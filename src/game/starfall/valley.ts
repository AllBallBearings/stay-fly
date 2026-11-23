import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { atDepth } from "./reference";
import { fbm, ridged, smoothstep } from "./paint";

/** Lake surface elevation. The meadow under the opening view is at y = 0. */
export const WATER_LEVEL = -3;

/**
 * Shoreline (x east, z north) traced from the reference frame onto the water plane:
 * a near shore below the meadow, a grassy spit before the dome, a narrow eastern lobe at
 * the foot of the dark ridge, the obelisk promontory and a far north shore under forest.
 */
export const LAKE_OUTLINE: readonly (readonly [number, number])[] = [
  [-37, 172], [-20, 171], [0, 172], [22, 175], [47, 172], [63, 169], [90, 175], [126, 190], [160, 197],
  [196, 205], [245, 213], [330, 240], [372, 280], [330, 300], [260, 290], [205, 266], [175, 272],
  [155, 331], [110, 341], [74, 359], [67, 406], [103, 500], [198, 615], [300, 760], [370, 860],
  [460, 1020], [560, 1195], [700, 1450], [840, 1721], [665, 1793], [450, 1850], [237, 1870], [0, 1885],
  [-219, 1870], [-400, 1840], [-560, 1793], [-678, 1655], [-560, 1350], [-420, 1060], [-302, 860],
  [-240, 640], [-205, 500], [-206, 439], [-222, 406], [-228, 365], [-200, 331], [-161, 316], [-118, 303],
  [-96, 272], [-97, 236], [-117, 231], [-141, 226], [-141, 209], [-117, 182], [-89, 175], [-62, 172],
];

const LAKE_BOUNDS = LAKE_OUTLINE.reduce((box, [x, z]) => ({
  minX: Math.min(box.minX, x), maxX: Math.max(box.maxX, x), minZ: Math.min(box.minZ, z), maxZ: Math.max(box.maxZ, z),
}), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });

/** Signed distance to the shoreline: negative over water. Far points return a lower bound. */
export function lakeDistance(x: number, z: number): number {
  const outside = Math.max(LAKE_BOUNDS.minX - x, x - LAKE_BOUNDS.maxX, LAKE_BOUNDS.minZ - z, z - LAKE_BOUNDS.maxZ);
  if (outside > 120) return outside;
  let best = Infinity;
  let inside = false;
  for (let i = 0, j = LAKE_OUTLINE.length - 1; i < LAKE_OUTLINE.length; j = i++) {
    const [xi, zi] = LAKE_OUTLINE[i];
    const [xj, zj] = LAKE_OUTLINE[j];
    const ex = xi - xj, ez = zi - zj;
    const wx = x - xj, wz = z - zj;
    const t = Math.max(0, Math.min(1, (wx * ex + wz * ez) / (ex * ex + ez * ez)));
    const dx = wx - ex * t, dz = wz - ez * t;
    best = Math.min(best, dx * dx + dz * dz);
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return (inside ? -1 : 1) * Math.sqrt(best);
}

interface Ridge {
  /** Crest polyline: x, z, crest height and optional local half-width. */
  points: readonly (readonly [number, number, number, number?])[];
  width: number;
}

/** Long hills drawn as crest polylines (x, z, crest height) with a bell-shaped section. */
const RIDGES: Record<"east" | "west" | "north" | "south" | "crag", Ridge> = {
  // The dark ridge that carries the giant eastern monolith.
  east: { width: 240, points: [[170, 340, 16, 100], [380, 430, 110, 125], [520, 600, 212, 150], [640, 760, 245, 170], [790, 1000, 255, 200], [930, 1300, 232, 240], [1080, 1700, 180, 260], [1150, 2100, 120, 260]] },
  // Western shore hills under the pale monolith, rising behind the dome.
  west: { width: 230, points: [[-470, 470, 36], [-640, 650, 95], [-780, 900, 135], [-860, 1250, 150], [-860, 1650, 130], [-640, 2050, 90]] },
  // Forested far shore below the twin-spire mountain.
  north: { width: 260, points: [[-900, 2250, 70], [-450, 2300, 85], [0, 2330, 90], [380, 2280, 70]] },
  // Invented: the meadow ends in soft wooded hills behind the opening view.
  south: { width: 300, points: [[-1100, -560, 110], [-560, -820, 80], [0, -900, 70], [560, -820, 85], [1150, -520, 120]] },
  // Base of the crag before the dome; the rock formation itself is modelled separately.
  crag: { width: 95, points: [[-470, 250, 40], [-330, 290, 46], [-270, 330, 30], [-300, 430, 18]] },
};

function ridgeHeight(ridge: Ridge, x: number, z: number): number {
  let best = 0;
  for (let i = 1; i < ridge.points.length; i++) {
    const [ax, az, ah, aw = ridge.width] = ridge.points[i - 1];
    const [bx, bz, bh, bw = ridge.width] = ridge.points[i];
    const ex = bx - ax, ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    const distance = Math.hypot(x - ax - ex * t, z - az - ez * t);
    const width = aw + (bw - aw) * t;
    if (distance > width * 2.6) continue;
    best = Math.max(best, (ah + (bh - ah) * t) * Math.exp(-((distance / width) ** 2)));
  }
  return best;
}

/** How strongly a point belongs to the dark eastern ridge (0..1), for painting. */
export const eastRidgeWeight = (x: number, z: number) => smoothstep(8, 60, ridgeHeight(RIDGES.east, x, z));

export const VALLEY_CENTER = new Vector3(0, 0, 1000);

/** Ground elevation of the valley floor, hills, shore and lake bed (mountains excluded). */
export function valleyHeight(x: number, z: number): number {
  // Gentle meadow swells; the immediate launch meadow stays nearly level.
  let height = (fbm(x / 240 + 3.1, z / 240 - 7.7, 3) - 0.5) * 7;
  height *= 0.35 + 0.65 * smoothstep(60, 260, Math.hypot(x, z - 60));
  // The valley rim climbs toward the surrounding ranges.
  const rim = Math.hypot(x - VALLEY_CENTER.x, (z - VALLEY_CENTER.z) * 0.82);
  height += smoothstep(2000, 4600, rim) ** 1.2 * 560 * (0.65 + 0.7 * fbm(x / 1100, z / 1100, 3));
  for (const ridge of Object.values(RIDGES)) height = Math.max(height, ridgeHeight(ridge, x, z));
  // Rocky texture on high ground, craggiest on the dark eastern ridge.
  const rough = smoothstep(25, 140, height);
  if (rough > 0) height += (ridged(x / 160, z / 160, 3) - 0.45) * 26 * rough;
  const crags = smoothstep(10, 60, ridgeHeight(RIDGES.east, x, z));
  if (crags > 0) height += (ridged(x / 55 + 4, z / 55, 3) - 0.4) * 22 * crags;

  const shore = lakeDistance(x, z);
  if (shore < 0) return WATER_LEVEL - 0.8 - Math.min(-shore * 0.22, 22);
  const blend = 18 + 32 * (1 - smoothstep(12, 45, height));
  const bank = smoothstep(0, blend, shore);
  return WATER_LEVEL + 0.45 + (height - WATER_LEVEL - 0.45) * bank;
}

export interface Mountain {
  id: string;
  x: number;
  z: number;
  /** Summit elevation above the valley datum. */
  peak: number;
  radius: number;
  /** >1 gives concave, spire-like flanks. */
  sharpness: number;
  /** Ridge relief as a fraction of local height. */
  relief: number;
  /** 0 = rock and grass to the top, 1 = pale snowy summit. */
  snow: number;
  seed: number;
  /** Lowers mesh resolution for very distant ranges. */
  far?: boolean;
}

const summit = (px: number, py: number, z: number) => atDepth(px, py, z);

function mountain(id: string, point: Vector3, radius: number, options: Partial<Mountain> = {}): Mountain {
  return { id, x: point.x, z: point.z, peak: point.y, radius, sharpness: 1.45, relief: 0.32, snow: 0.6, seed: id.length * 13.7, ...options };
}

/**
 * Peaks seen in the reference frame are placed by their summit pixels; the rest of the
 * ring (sides and behind the opening view) continues the same pale, blue-shadowed ranges.
 */
export const MOUNTAINS: readonly Mountain[] = [
  // Broad green mountain whose summit carries the left spire.
  mountain("spire-mountain", summit(790, 702, 2600), 1250, { sharpness: 1.25, relief: 0.28, snow: 0.35 }),
  mountain("spire-shoulder", summit(1000, 805, 2750), 900, { sharpness: 1.3, relief: 0.3, snow: 0.2 }),
  // Hidden pedestal for the right spire group.
  mountain("north-bastion", new Vector3(-120, 470, 3350), 820, { sharpness: 1.3, snow: 0.3 }),
  // Sharp pale needles to the right of the opening view.
  mountain("needle-west", summit(1560, 760, 2450), 620, { sharpness: 1.7, relief: 0.38, snow: 0.8 }),
  mountain("needle", summit(1690, 618, 2800), 820, { sharpness: 1.85, relief: 0.42, snow: 0.95 }),
  mountain("needle-east", summit(1812, 598, 3050), 860, { sharpness: 1.8, relief: 0.42, snow: 0.95 }),
  // Pale snowy ranges far up the valley.
  mountain("far-center", summit(1250, 846, 4600), 1150, { sharpness: 1.5, snow: 0.9 }),
  mountain("far-center-east", summit(1335, 862, 4900), 1000, { sharpness: 1.5, snow: 0.9 }),
  mountain("far-haze", summit(1405, 925, 6200), 1500, { sharpness: 1.3, snow: 0.7, far: true }),
  mountain("far-haze-east", summit(1500, 935, 6400), 1300, { sharpness: 1.3, snow: 0.7, far: true }),
  // Snow peak glimpsed behind the dome.
  mountain("dome-peak", summit(440, 556, 3600), 2000, { sharpness: 1.55, relief: 0.4, snow: 1 }),
  // Invented: the ring closes behind and beside the player.
  mountain("west-wall", new Vector3(-3300, 1250, 1600), 1500, { snow: 0.9 }),
  mountain("west-north", new Vector3(-2400, 1050, 4300), 1300, { snow: 0.85 }),
  mountain("east-wall", new Vector3(3200, 1180, 1300), 1450, { sharpness: 1.6, snow: 0.9 }),
  mountain("east-north", new Vector3(3100, 960, 3900), 1300, { snow: 0.85 }),
  mountain("southwest", new Vector3(-2900, 1150, -1700), 1500, { sharpness: 1.6, snow: 0.95 }),
  mountain("south", new Vector3(-600, 980, -3300), 1450, { snow: 0.85 }),
  mountain("south-needle", new Vector3(900, 1320, -3000), 1200, { sharpness: 1.9, relief: 0.42, snow: 1 }),
  mountain("southeast", new Vector3(2800, 1050, -1600), 1400, { snow: 0.9 }),
  mountain("far-west", new Vector3(-5200, 1500, 900), 2000, { snow: 1, far: true }),
  mountain("far-south", new Vector3(200, 1450, -5600), 2000, { snow: 1, far: true }),
  mountain("far-east", new Vector3(5300, 1400, 600), 2000, { snow: 1, far: true }),
];

/** Absolute elevation of one mountain's surface (may be below the valley floor). */
export function mountainHeight(m: Mountain, x: number, z: number): number {
  const dx = x - m.x;
  const dz = z - m.z;
  const distance = Math.hypot(dx, dz);
  if (distance >= m.radius * 1.25) return -Infinity;
  const angle = Math.atan2(dz, dx);
  // Lobed footprint so ranges read as ridges radiating from the summit.
  const lobes = 0.78 + 0.42 * fbm(Math.cos(angle) * 1.3 + m.seed, Math.sin(angle) * 1.3 - m.seed, 3);
  const t = distance / (m.radius * lobes);
  if (t >= 1) return -Infinity;
  const profile = (1 - t) ** m.sharpness;
  // Ridge spacing is capped so even the broad ranges break into many painted facets.
  const scale = Math.min(m.radius / 3.2, 210);
  const crest = ridged(x / scale + m.seed, z / scale - m.seed, 5);
  // Relief fades in away from the summit so the traced peak stays the highest point.
  const relief = 1 + m.relief * (crest * 2 - 1) * smoothstep(0, 0.35, t);
  // Foothills give way to the lake shore instead of rising out of the water.
  const shore = smoothstep(80, 420, lakeDistance(x, z));
  return (m.peak * profile * relief - 40 * t) * shore - 60 * (1 - shore);
}

export interface Crag {
  id: string;
  x: number;
  z: number;
  peak: number;
  radius: number;
  sharpness: number;
  seed: number;
}

/**
 * The weathered rock outcrop between the launch meadow and the sphere. Its summit is
 * placed on the painting's crag silhouette; fissures run downhill like the brushwork.
 */
export const CRAGS: readonly Crag[] = [
  { id: "crag", ...pick(atDepth(212, 756, 285)), radius: 74, sharpness: 0.78, seed: 3.1 },
  { id: "crag-mid", ...pick(atDepth(140, 762, 292)), radius: 70, sharpness: 0.8, seed: 9.3 },
  { id: "crag-west", ...pick(atDepth(60, 772, 305)), radius: 105, sharpness: 0.9, seed: 7.4 },
  { id: "crag-back", x: -330, z: 395, peak: 66, radius: 140, sharpness: 1.1, seed: 11.2 },
  { id: "crag-far", x: -450, z: 300, peak: 72, radius: 170, sharpness: 1.15, seed: 5.6 },
];

function pick(point: Vector3): { x: number; z: number; peak: number } {
  return { x: point.x, z: point.z, peak: point.y };
}

export function cragHeight(c: Crag, x: number, z: number): number {
  const dx = x - c.x, dz = z - c.z;
  const distance = Math.hypot(dx, dz);
  if (distance >= c.radius * 1.3) return -Infinity;
  const angle = Math.atan2(dz, dx);
  const lobes = 0.78 + 0.5 * fbm(Math.cos(angle) * 1.4 + c.seed, Math.sin(angle) * 1.4 - c.seed, 3);
  const t = distance / (c.radius * lobes);
  if (t >= 1) return -Infinity;
  const profile = (1 - t) ** c.sharpness;
  // Downhill fissures: ridged noise in polar coordinates around the summit.
  const fissure = ridged(angle * 8 + c.seed, distance / 20 + c.seed, 3);
  const ledges = fbm(x / 7 + c.seed, z / 7 + distance / 30, 2) - 0.5;
  return c.peak * profile * (0.84 + 0.26 * fissure * smoothstep(0, 0.2, t)) + ledges * 7 * profile - 3 * t;
}

/** The solid ground surface used for collision: valley floor or any mountain above it. */
export function groundHeight(x: number, z: number): number {
  let height = valleyHeight(x, z);
  for (const m of MOUNTAINS) {
    if (Math.abs(x - m.x) > m.radius * 1.25 || Math.abs(z - m.z) > m.radius * 1.25) continue;
    height = Math.max(height, mountainHeight(m, x, z));
  }
  for (const c of CRAGS) {
    if (Math.abs(x - c.x) > c.radius * 1.3 || Math.abs(z - c.z) > c.radius * 1.3) continue;
    height = Math.max(height, cragHeight(c, x, z));
  }
  return height;
}
