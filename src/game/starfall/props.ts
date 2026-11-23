import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { CreateBoxVertexData } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinderVertexData } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateIcoSphereVertexData } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { CreateSphereVertexData } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorusVertexData } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Collider } from "./colliders";
import { cel, faceted, fbm, hex, mix, palette, place, Random, scaleRGB, smoothstep, SUN, valueNoise, type PaintBatch, type Palette, type RGB } from "./paint";

/** Colours sampled from the reference painting (lit / mid / shadow). */
export const PALETTES = {
  dome: palette("#9a9e8a", "#7b897f", "#46565f"),
  domeShadow: palette("#2c3947", "#1f2a37", "#161e29"),
  paleStone: palette("#a6ae9a", "#7f897c", "#353b3b"),
  paleStoneRecess: palette("#56605a", "#323a39", "#161a1b"),
  obsidian: palette("#5d6e69", "#151a22", "#0c0d12"),
  slate: palette("#3b5772", "#223a50", "#152434"),
  tower: palette("#6a8a98", "#1f3651", "#142640"),
  obelisk: palette("#76806e", "#414c49", "#1a1e22"),
  rock: palette("#6f6446", "#3d3425", "#171315"),
  darkRock: palette("#3c3a3e", "#1b1519", "#0e0a0e"),
  foliage: palette("#2c3624", "#1a2015", "#0d0f0a"),
  bush: palette("#2f3a22", "#1d2616", "#0e110a"),
  farForest: palette("#3d5a46", "#1f3532", "#132324"),
  pod: palette("#959a87", "#5f6863", "#262c33"),
  white: palette("#9ea493", "#788279", "#3e4a53"),
  bark: palette("#3a2e22", "#221a13", "#100c09"),
} satisfies Record<string, Palette>;

export interface PropSink {
  batch: PaintBatch;
  colliders: Collider[];
  random: Random;
}

const facetedBox = (width: number, height: number, depth: number) => CreateBoxVertexData({ width, height, depth });

/** Painterly value variation so large flat planes never look computer-flat. */
const grain = (p: Vector3, scale: number, amount: number) => 1 + (valueNoise(p.x / scale + p.y / (scale * 1.7), p.z / scale - p.y / (scale * 2.3)) - 0.5) * amount;

/**
 * A colossal fluted monolith: a core slab wrapped in vertical fins of varied width,
 * protrusion and height. Flat face shading turns the fins into the reference's crisp
 * vertical light and shadow stripes; staggered fin heights give stepped silhouettes.
 */
export function addMonolith(sink: PropSink, base: Vector3, width: number, depth: number, height: number, yaw: number,
  colors: Palette, recess: Palette, options: { bias?: number; highlight?: Palette; highlightShare?: number } = {}): void {
  const { batch, colliders, random } = sink;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const toWorld = (x: number, y: number, z: number) => new Vector3(base.x + x * cos + z * sin, base.y + y, base.z - x * sin + z * cos);
  const paintFace = (p: Palette) => (point: Vector3, normal: Vector3): RGB => scaleRGB(cel(normal, p, options.bias ?? 0), grain(point, 40, 0.08) * (0.94 + 0.06 * smoothstep(base.y, base.y + height, point.y)));
  const core = place(facetedBox(width * 0.86, height, depth * 0.86), toWorld(0, height / 2, 0), { yaw });
  batch.add(core, paintFace(recess), "monolith");
  // Four faces: (along-axis, normal-axis) in local coordinates.
  const faces: [number, number, number, number][] = [[1, 0, 0, -1], [1, 0, 0, 1], [0, 1, -1, 0], [0, 1, 1, 0]];
  for (const [ax, az, nx, nz] of faces) {
    const span = ax ? width : depth;
    const reach = ax ? depth : width;
    let along = -span / 2;
    while (along < span / 2 - 1) {
      const finWidth = Math.min(span / 2 - along, span * random.range(0.02, 0.07));
      const protrude = random.next() < 0.35 ? 0 : reach * random.range(0.02, 0.075);
      const finHeight = height * (random.next() < 0.25 ? random.range(0.88, 0.97) : 1) * random.range(0.985, 1.0);
      if (protrude > 0) {
        const offset = reach * 0.43 + protrude / 2;
        const cx = ax ? along + finWidth / 2 : nx * offset;
        const cz = az ? along + finWidth / 2 : nz * offset;
        const w = ax ? finWidth * 0.94 : protrude + reach * 0.02;
        const d = az ? finWidth * 0.94 : protrude + reach * 0.02;
        const fin = place(facetedBox(w, finHeight, d), toWorld(cx, finHeight / 2, cz), { yaw });
        // Occasional rim-lit fins become the bright vertical streaks of the painting.
        const pick = random.next();
        batch.add(fin, paintFace(options.highlight && pick < (options.highlightShare ?? 0.16) ? options.highlight : pick > 0.8 ? recess : colors), "monolith");
      }
      along += finWidth;
    }
  }
  // Stepped crown blocks.
  for (let i = 0; i < 3; i++) {
    const w = width * random.range(0.25, 0.55);
    const d = depth * random.range(0.3, 0.6);
    const h = height * random.range(0.015, 0.05);
    const crown = place(facetedBox(w, h, d), toWorld(random.range(-0.2, 0.2) * width, height + h / 2 - 0.5, random.range(-0.15, 0.15) * depth), { yaw });
    batch.add(crown, paintFace(colors), "monolith");
  }
  colliders.push({ kind: "box", center: toWorld(0, height / 2, 0), half: new Vector3(width * 0.53, height / 2, depth * 0.53), yaw });
}

/** Slab tower with a set-back upper block and an optional needle spire. */
export function addTower(sink: PropSink, base: Vector3, blocks: readonly { x: number; z: number; width: number; depth: number; top: number }[],
  spire?: { x: number; z: number; top: number; width: number }): void {
  const { batch, colliders } = sink;
  // South faces stay in mid-blue; only westward planes and fin edges catch the light.
  const paint = (point: Vector3, normal: Vector3) => scaleRGB(cel(normal, PALETTES.tower, -0.22), grain(point, 60, 0.06));
  for (const block of blocks) {
    const height = block.top - base.y;
    const center = new Vector3(base.x + block.x, base.y + height / 2, base.z + block.z);
    batch.add(place(facetedBox(block.width, height, block.depth), center), paint, "tower");
    // Shallow vertical fins on the faces catch the light like the reference's grooves.
    for (let i = 1; i < 4; i++) {
      const fin = place(facetedBox(block.width * 0.06, height * 0.97, block.depth * 1.04), center.add(new Vector3(-block.width / 2 + block.width * i / 4, -height * 0.015, 0)));
      batch.add(fin, paint, "tower");
    }
    colliders.push({ kind: "box", center, half: new Vector3(block.width / 2, height / 2, block.depth / 2), yaw: 0 });
  }
  if (spire) {
    const height = spire.top - base.y;
    const needle = place(CreateCylinderVertexData({ height, diameterTop: 0, diameterBottom: spire.width, tessellation: 4 }),
      new Vector3(base.x + spire.x, base.y + height / 2, base.z + spire.z), { yaw: Math.PI / 4 });
    batch.add(faceted(needle), paint, "tower");
  }
}

/** Tapered stone obelisk with a pyramidion and a stepped base. */
export function addObelisk(sink: PropSink, base: Vector3, height: number, width: number, plinth: "steps" | "monument" | "none" = "steps"): void {
  const { batch, colliders } = sink;
  const paint = (p: Palette) => (point: Vector3, normal: Vector3) => scaleRGB(cel(normal, p, -0.22), grain(point, 6, 0.1) * (0.9 + 0.1 * smoothstep(base.y, base.y + height, point.y)));
  let footing = base.y;
  if (plinth === "steps") {
    for (const [scale, rise] of [[2.6, 0.035], [1.9, 0.035]] as const) {
      const step = place(facetedBox(width * scale, height * rise + 0.6, width * scale), new Vector3(base.x, footing + (height * rise + 0.6) / 2 - 0.5, base.z));
      batch.add(step, paint(PALETTES.obelisk), "stone");
      footing += height * rise;
    }
  } else if (plinth === "monument") {
    // Broad stepped pedestal with corner piers and a dark doorway, like the reference's foreground monument.
    const w = width * 4.4;
    const h = height * 0.24;
    const lower = place(facetedBox(w, h * 0.42, w * 0.78), new Vector3(base.x, base.y + h * 0.21 - 0.6, base.z));
    batch.add(lower, paint(PALETTES.obelisk), "stone");
    const upper = place(facetedBox(w * 0.74, h * 0.58, w * 0.6), new Vector3(base.x, base.y + h * 0.42 + h * 0.29 - 0.6, base.z));
    batch.add(upper, paint(PALETTES.obelisk), "stone");
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const pier = place(facetedBox(w * 0.16, h * 0.82, w * 0.16), new Vector3(base.x + sx * w * 0.41, base.y + h * 0.41 - 0.6, base.z + sz * w * 0.3));
      batch.add(pier, paint(PALETTES.obelisk), "stone");
    }
    const door = place(facetedBox(w * 0.2, h * 0.36, 0.6), new Vector3(base.x, base.y + h * 0.18 - 0.3, base.z - w * 0.39 - 0.25));
    const doorway = hex("#14181c");
    batch.add(door, () => doorway, "stone");
    colliders.push({ kind: "box", center: new Vector3(base.x, base.y + h * 0.45, base.z), half: new Vector3(w / 2, h * 0.5, w * 0.39), yaw: 0 });
    footing = base.y + h - 0.6;
  }
  const shaftHeight = base.y + height - footing - width * 1.1;
  const shaft = place(CreateCylinderVertexData({ height: shaftHeight, diameterBottom: width * Math.SQRT2, diameterTop: width * 0.68 * Math.SQRT2, tessellation: 4 }),
    new Vector3(base.x, footing + shaftHeight / 2, base.z), { yaw: Math.PI / 4 });
  batch.add(faceted(shaft), paint(PALETTES.obelisk), "stone");
  const tip = place(CreateCylinderVertexData({ height: width * 1.1, diameterBottom: width * 0.68 * Math.SQRT2, diameterTop: 0, tessellation: 4 }),
    new Vector3(base.x, footing + shaftHeight + width * 0.55, base.z), { yaw: Math.PI / 4 });
  batch.add(faceted(tip), paint(PALETTES.obelisk), "stone");
  colliders.push({ kind: "cylinder", x: base.x, z: base.z, bottom: base.y - 2, top: base.y + height, radius: width * 0.75 });
}

/** Brighter leaf colours for the sunlit clumps that sit on each foliage mass. */
export const LEAF_LIGHT = {
  foliage: palette("#4b5a3f", "#2e3a28", "#151a12"),
  bush: palette("#556b3e", "#384a2a", "#18200f"),
} satisfies Record<string, Palette>;

/**
 * One painted foliage mass: a dark, low-contrast body with a few lighter leaf clumps
 * on its sunlit side, so crowns read as brushed leaf clusters rather than shaded balls.
 */
export function addFoliageMass(batch: PaintBatch, center: Vector3, radius: number, body: Palette, leaves: Palette, random: Random,
  detail = 2, clumps = 2 + Math.floor(random.next() * 3), clumpSize = [0.26, 0.42]): void {
  const seed = random.range(0, 100);
  const mass = place(CreateIcoSphereVertexData({ radius, subdivisions: detail, flat: false }), center, { scale: new Vector3(1, random.range(0.8, 0.95), 1) });
  batch.add(mass, (p, n) => {
    const dapple = fbm(p.x / (radius * 0.3) + seed, p.z / (radius * 0.3) + p.y / (radius * 0.35), 2);
    return scaleRGB(cel(n, body, (dapple - 0.6) * 0.6), 0.8 + dapple * 0.35);
  }, "foliage");
  for (let i = 0; i < clumps; i++) {
    // Leaf clumps gather on the sunlit side but scatter all round for a broken silhouette.
    const lean = random.next() < 0.7 ? 1 : 0;
    const offset = new Vector3(SUN.x * lean + random.range(-0.9, 0.9), SUN.y * lean + random.range(-0.6, 0.6), SUN.z * lean + random.range(-0.9, 0.9)).normalize();
    const size = radius * random.range(clumpSize[0], clumpSize[1]);
    const clump = place(CreateIcoSphereVertexData({ radius: size, subdivisions: 1, flat: false }), center.add(offset.scale(radius * random.range(0.72, 0.95))));
    const tone = random.range(0.75, 1.15);
    batch.add(clump, (_p, n) => scaleRGB(cel(n, leaves, -0.05), tone), "foliage");
  }
}

/** Rounded anime tree: trunk plus clustered foliage masses with dappled highlights. */
export function addTree(sink: PropSink, ground: Vector3, height: number, crown: number, colors: Palette = PALETTES.foliage, detail = 2): void {
  const { batch, colliders, random } = sink;
  const trunkHeight = height * 0.62;
  // Shrubs are all foliage; only proper trees show a trunk.
  if (colors !== PALETTES.bush) {
    const trunk = place(CreateCylinderVertexData({ height: trunkHeight, diameterTop: crown * 0.12, diameterBottom: crown * 0.2, tessellation: 7 }),
      ground.add(new Vector3(0, trunkHeight / 2 - 0.5, 0)));
    batch.add(trunk, (_p, n) => cel(n, PALETTES.bark), "foliage");
  }
  const top = ground.y + height;
  const blobs = 3 + Math.floor(random.next() * 3);
  const leaves = colors === PALETTES.bush ? LEAF_LIGHT.bush : LEAF_LIGHT.foliage;
  for (let i = 0; i < blobs; i++) {
    const angle = random.range(0, Math.PI * 2);
    const spread = random.range(0.2, 0.62) * crown;
    const radius = crown * random.range(0.42, 0.64);
    const lowest = colors === PALETTES.bush ? ground.y + radius * 0.7 : -Infinity;
    const center = new Vector3(ground.x + Math.cos(angle) * spread, Math.max(lowest, top - crown * 0.55 - random.range(0, 0.6) * crown + radius * 0.25), ground.z + Math.sin(angle) * spread);
    if (detail > 1) addFoliageMass(batch, center, radius, colors, leaves, random, detail, 5, [0.16, 0.28]);
    else addFoliageMass(batch, center, radius, colors, leaves, random, detail, 2);
  }
  colliders.push({ kind: "sphere", center: new Vector3(ground.x, top - crown * 0.55, ground.z), radius: crown * 0.85 });
  colliders.push({ kind: "cylinder", x: ground.x, z: ground.z, bottom: ground.y - 1, top: ground.y + trunkHeight, radius: crown * 0.12 });
}

/** Low-cost distant tree used in the far-shore forest bands. */
export function addFarTree(batch: PaintBatch, ground: Vector3, height: number, random: Random): void {
  const radius = height * random.range(0.28, 0.38);
  const blob = place(CreateIcoSphereVertexData({ radius, subdivisions: 1, flat: false }), ground.add(new Vector3(0, height - radius, 0)), { scale: new Vector3(1, 1.35, 1) });
  const tone = random.range(0.82, 1.12);
  batch.add(blob, (_p, n) => scaleRGB(cel(n, PALETTES.farForest), tone), "forest");
}

/** Craggy flat-shaded boulder or rock mass; mossy where faces turn skyward. */
export function addRock(sink: PropSink, center: Vector3, size: Vector3, colors: Palette = PALETTES.rock, subdivisions = 2, collide = true): void {
  const { batch, colliders, random } = sink;
  const seed = random.range(0, 50);
  const data = CreateIcoSphereVertexData({ radius: 1, subdivisions, flat: false });
  const positions = data.positions!;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    // Broad lumps plus fine vertical fluting, like weathered cliff columns.
    const bump = 0.7 + 0.45 * fbm(x * 1.6 + seed, z * 1.6 + y * 1.2 - seed, 3) + 0.12 * fbm(Math.atan2(z, x) * 5 + seed, y * 0.6, 2);
    positions[i] = x * bump; positions[i + 1] = y * bump; positions[i + 2] = z * bump;
  }
  place(data, center, { scale: size, yaw: random.range(0, Math.PI * 2) });
  const normals: number[] = [];
  VertexData.ComputeNormals(data.positions!, data.indices!, normals);
  data.normals = normals;
  const moss = hex("#3c4426");
  const streak = Math.max(size.x, size.z) * 0.12;
  batch.add(data, (p, n) => {
    const fissure = fbm(p.x / streak + seed, p.z / streak + p.y / (streak * 6), 3);
    const base = scaleRGB(cel(n, colors, (fissure - 0.5) * 0.5), 0.72 + fissure * 0.56);
    return mix(base, moss, smoothstep(0.8, 0.95, n.y) * 0.5);
  }, "rock");
  if (collide) colliders.push({ kind: "sphere", center: center.clone(), radius: Math.min(size.x, size.y, size.z) * 0.95 });
}

export interface DomeLayout {
  center: Vector3;
  radius: number;
  /** Horizontal unit vector from the dome toward the opening viewpoint. */
  front: Vector3;
  /** A plane through the viewpoint whose negative side lies in the crag's cast shadow. */
  shadowPlane: { point: Vector3; normal: Vector3 };
}

/**
 * The great sphere: a pale panelled ball sunk into the shore, with grooved latitude
 * bands, a protruding ledge ring, roof hatches, a dark slot window and a white gantry.
 */
export function addDome(sink: PropSink, dome: DomeLayout): void {
  const { batch, colliders } = sink;
  const { center, radius, front } = dome;
  const right = new Vector3(front.z, 0, -front.x).scale(-1);
  const shade = (point: Vector3, normal: Vector3): RGB => {
    const offset = point.subtract(dome.shadowPlane.point);
    const inShadow = Vector3.Dot(offset, dome.shadowPlane.normal) < 0;
    const lit = cel(normal, PALETTES.dome, 0.08);
    const shadow = cel(normal, PALETTES.domeShadow);
    const soft = smoothstep(-4, 4, Vector3.Dot(offset, dome.shadowPlane.normal));
    return scaleRGB(inShadow ? mix(shadow, lit, soft * 0.4) : mix(shadow, lit, soft), grain(point, 45, 0.06));
  };
  const surface = (lon: number, lat: number, lift = 0) => {
    const horizontal = front.scale(Math.cos(lon)).add(right.scale(Math.sin(lon))).scale(Math.cos(lat));
    return center.add(horizontal.add(new Vector3(0, Math.sin(lat), 0)).scale(radius + lift));
  };
  const sphere = place(CreateSphereVertexData({ diameter: radius * 2, segments: 72 }), center);
  batch.add(sphere, shade, "dome");

  const groove = hex("#2e3a44");
  for (const [lat, thickness, protrude] of [[0.68, 0.9, 0.3], [0.19, 0.7, 0.2], [-0.5, 3.4, 2.4]] as const) {
    const ringRadius = Math.cos(lat) * radius + protrude;
    const ring = place(CreateTorusVertexData({ diameter: ringRadius * 2, thickness, tessellation: 96 }), center.add(new Vector3(0, Math.sin(lat) * radius, 0)));
    batch.add(ring, protrude > 2 ? (p, n) => mix(shade(p, n), groove, n.y < 0 ? 0.65 : 0.15) : (p, n) => mix(shade(p, n), groove, 0.75), "dome");
  }
  // Meridian seams and roof hatch frames (thin dark strips laid on the surface).
  const strip = (from: [number, number], to: [number, number], width: number) => {
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      const a = surface(from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps, 0.25);
      const b = surface(from[0] + (to[0] - from[0]) * (i + 1) / steps, from[1] + (to[1] - from[1]) * (i + 1) / steps, 0.25);
      const mid = a.add(b).scale(0.5);
      const along = b.subtract(a);
      const segment = CreateBoxVertexData({ width, height: width * 0.6, depth: along.length() + width });
      const outward = mid.subtract(center).normalize();
      const yaw = Math.atan2(along.x, along.z);
      const pitch = -Math.atan2(along.y, Math.hypot(along.x, along.z));
      place(segment, mid.add(outward.scale(0.1)), { yaw, pitch });
      batch.add(segment, (p, n) => mix(shade(p, n), groove, 0.75), "dome");
    }
  };
  strip([0.62, 0.2], [0.62, -0.45], 0.8);
  strip([-0.55, 0.68], [-0.55, -0.4], 0.7);
  strip([1.15, 0.68], [1.15, -0.2], 0.7);
  // Roof hatches: two rounded rectangles near the crown.
  for (const [lon0, lon1, lat0, lat1] of [[0.18, 0.62, 0.86, 1.02], [0.28, 0.52, 0.9, 0.98], [-0.32, -0.02, 0.88, 1.0]] as const) {
    strip([lon0, lat0], [lon1, lat0], 0.9);
    strip([lon1, lat0], [lon1, lat1], 0.9);
    strip([lon1, lat1], [lon0, lat1], 0.9);
    strip([lon0, lat1], [lon0, lat0], 0.9);
  }
  // Dark slot window on the right flank.
  const slot = surface(0.95, 0.38, 0.5);
  const slotBox = place(CreateBoxVertexData({ width: radius * 0.24, height: radius * 0.035, depth: 2 }), slot, { yaw: Math.atan2(slot.x - center.x, slot.z - center.z) });
  const slotColor = hex("#11161d");
  batch.add(slotBox, () => slotColor, "dome");

  // White service arm at the ledge ring, reaching toward the lake to a small cabin.
  const gantryBase = surface(0.82, -0.62, 1);
  const outward = new Vector3(gantryBase.x - center.x, 0, gantryBase.z - center.z).normalize();
  const gantryYaw = Math.atan2(outward.x, outward.z);
  const arm = place(CreateCylinderVertexData({ height: 36, diameter: 3.2, tessellation: 10 }), gantryBase.add(outward.scale(15)), { yaw: gantryYaw, pitch: Math.PI / 2 });
  batch.add(arm, (_p, n) => cel(n, PALETTES.white), "dome");
  const cabin = place(CreateBoxVertexData({ width: 9, height: 6, depth: 8 }), gantryBase.add(outward.scale(34)).add(new Vector3(0, -1, 0)), { yaw: gantryYaw });
  batch.add(cabin, (_p, n) => cel(n, PALETTES.white), "dome");
  colliders.push({ kind: "sphere", center: center.clone(), radius });
}

/** Silver egg-shaped landing pod resting in the meadow. */
export function addPod(sink: PropSink, ground: Vector3, length: number, yaw: number): void {
  const { batch, colliders } = sink;
  const center = ground.add(new Vector3(0, length * 0.22, 0));
  const shell = place(CreateSphereVertexData({ diameter: 1, segments: 24 }), center, { scale: new Vector3(length * 0.56, length * 0.46, length), yaw });
  batch.add(shell, (p, n) => scaleRGB(cel(n, PALETTES.pod, 0.1), grain(p, 3, 0.05)), "pod");
  const seam = place(CreateTorusVertexData({ diameter: 1, thickness: 0.035, tessellation: 40 }), center.add(new Vector3(0, length * 0.06, 0)), { scale: new Vector3(length * 0.57, length * 0.5, length * 1.01), yaw });
  const seamColor = hex("#3b434b");
  batch.add(seam, () => seamColor, "pod");
  colliders.push({ kind: "sphere", center, radius: length * 0.45 });
}

export { VertexData };
