import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateBoxVertexData } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinderVertexData } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";
import type { FlightBounds, FlightCollision } from "../FlightController";
import type { GameWorld, WorldEnvironment, WorldNavigation } from "../GameWorld";
import { getWorldNavigation, type NavigationRegion } from "../WorldNavigation";
import { colliderRadius, rayCollider, type Collider, type RayHit } from "./colliders";
import { cel, clamp01, fbm, hash2, hex, mix, PaintBatch, palette, place, Random, scaleRGB, smoothstep, SUN, type RGB } from "./paint";
import { addDome, addFarTree, addFoliageMass, addMonolith, addObelisk, addPod, addRock, addTower, addTree, PALETTES, type PropSink } from "./props";
import { atDepth, onPlane, REFERENCE_LENS_SHIFT, REFERENCE_VIEW, referenceRay } from "./reference";
import { paintSkyTexture, SKY, skyDomeData } from "./sky";
import { cragHeight, CRAGS, eastRidgeWeight, groundHeight, lakeDistance, mountainHeight, MOUNTAINS, valleyHeight, WATER_LEVEL, type Crag, type Mountain } from "./valley";

const GRASS = { lit: hex("#6c783e"), mid: hex("#454425"), dark: hex("#1f1e10"), pale: hex("#7a8446") };
const SHORE = hex("#5d6d52");
const PATH = hex("#6c6540");
const HIGHLAND = palette("#4d6a52", "#2b4540", "#182a2b");
const RIDGE = palette("#191c22", "#0f0b11", "#080609");
const SNOW = palette("#a6a993", "#3c5870", "#18263d");
const MOUNTAIN_ROCK = palette("#748886", "#2c4864", "#16253b");
const MOUNTAIN_GREEN = palette("#5e8472", "#33555a", "#1b313c");
const HAZE = hex("#6a8488");
const CRAG_ROCK = palette("#9a8a60", "#4a3f2a", "#141012");
const MOSS = hex("#3d4626");
const WATER = {
  near: hex("#44687a"), far: hex("#4c7080"), light: hex("#5f7f84"), sky: hex("#5a7a80"),
  dark: hex("#12171e"), forest: hex("#21374a"), dome: hex("#61797a"),
};

/** Where the opening view looks, in the pause/HUD vocabulary. */
const LANDMARKS: readonly NavigationRegion[] = [
  { id: "meadow", name: "Launch Meadow", position: new Vector3(0, 0, 40), radius: 170 },
  { id: "dome", name: "The Sphere", position: atDepth(542, 866, 560), radius: 230 },
  { id: "obelisk-shore", name: "Obelisk Shore", position: new Vector3(130, 0, 400), radius: 160 },
  { id: "lake", name: "Starfall Lake", position: new Vector3(-20, 0, 1050), radius: 720 },
  { id: "pale-monolith", name: "Pale Monolith", position: new Vector3(-700, 0, 860), radius: 260 },
  { id: "dark-monolith", name: "Obsidian Monolith", position: new Vector3(700, 0, 760), radius: 330 },
  { id: "spires", name: "Twin Spires", position: new Vector3(-450, 0, 2900), radius: 800 },
  { id: "needles", name: "Needle Peaks", position: new Vector3(1600, 0, 2800), radius: 800 },
  { id: "observatory", name: "South Observatory", position: new Vector3(40, 0, -520), radius: 260 },
];

/**
 * A retro-future valley reproducing a 1980s anime background painting: a starry dusk sky
 * over a daylit lake, a great sphere on the shore, twin spires on the mountains and
 * colossal fluted monoliths on both banks. Everything is vertex-painted and unlit so the
 * gouache palette survives exactly; one material covers nearly every prop.
 */
export class StarfallLake implements GameWorld {
  readonly id = "starfall-lake" as const;
  readonly flightBounds: FlightBounds = { center: new Vector3(0, 300, 1000), radius: 5200 };
  readonly startPosition = REFERENCE_VIEW.eye.clone();
  readonly startDirection = Vector3.Forward();
  /** Desktop opening view: shift the lens so the horizon falls where the painting puts it. */
  readonly openingLensShift = REFERENCE_LENS_SHIFT;
  readonly environment: WorldEnvironment = {
    clearColor: new Color4(0.06, 0.08, 0.11, 1),
    ambientColor: new Color3(0.3, 0.36, 0.4),
    fogColor: Color3.FromHexString("#587680"),
    fogDensity: 0.000145,
    skyLight: { direction: new Vector3(0.2, 1, -0.1), diffuse: new Color3(0.62, 0.72, 0.78), ground: new Color3(0.16, 0.18, 0.14), intensity: 0.8 },
    sunLight: { direction: SUN.scale(-1), diffuse: new Color3(0.95, 0.93, 0.82), intensity: 0.75 },
    toneMapping: false,
    exposure: 1,
    contrast: 1,
    glowIntensity: 0,
    vignette: 2.1,
  };

  private readonly meshes: AbstractMesh[] = [];
  private readonly colliders: Collider[] = [];
  private readonly broadPhase: { center: Vector3; radius: number }[] = [];
  private readonly random = new Random(1984);
  private waterTexture: Texture | null = null;
  private meteor: ShootingStar | null = null;
  private lastTime = 0;

  constructor(private readonly scene: Scene) {
    const before = new Set(scene.meshes);
    this.build();
    this.meshes = scene.meshes.filter((mesh) => !before.has(mesh));
    this.broadPhase = this.colliders.map(colliderRadius);
  }

  setEnabled(enabled: boolean): void {
    for (const mesh of this.meshes) mesh.setEnabled(enabled);
    if (!enabled) this.meteor?.hide();
  }

  update(timeSeconds: number): void {
    const dt = this.lastTime ? Math.min(0.1, timeSeconds - this.lastTime) : 0;
    this.lastTime = timeSeconds;
    if (this.waterTexture) {
      this.waterTexture.vOffset = (this.waterTexture.vOffset + dt * 0.018) % 1;
      this.waterTexture.uOffset = Math.sin(timeSeconds * 0.05) * 0.04;
    }
    this.meteor?.update(timeSeconds, this.scene.activeCamera?.globalPosition ?? Vector3.Zero());
  }

  navigate(position: Vector3, forward: Vector3): WorldNavigation {
    return getWorldNavigation(position, forward, LANDMARKS, "Starfall Valley");
  }

  /** Swept collision against the painted ground, mountains and prop volumes. */
  resolveFlightMotion(position: Vector3, displacement: Vector3): FlightCollision | null {
    const distance = displacement.length();
    if (distance < 0.0001) return null;
    const direction = displacement.scale(1 / distance);
    const clearance = 0.65;
    const reach = distance + clearance;
    let hit: RayHit | null = this.groundHit(position, direction, reach);
    for (let i = 0; i < this.colliders.length; i++) {
      const bounds = this.broadPhase[i];
      if (Vector3.DistanceSquared(bounds.center, position) > (bounds.radius + reach) ** 2) continue;
      const candidate = rayCollider(position, direction, this.colliders[i]);
      if (candidate && candidate.distance <= reach && (!hit || candidate.distance < hit.distance)) hit = candidate;
    }
    if (!hit) return null;
    let normal = hit.normal.clone();
    if (Vector3.Dot(direction, normal) > 0) normal = normal.scale(-1);
    normal.normalize();
    const approach = Math.max(0, hit.distance - clearance);
    const remaining = Math.max(0, distance - approach);
    const reflected = direction.subtract(normal.scale(2 * Vector3.Dot(direction, normal))).normalize();
    const impact = Math.max(0, -Vector3.Dot(direction, normal));
    return {
      displacement: direction.scale(approach).addInPlace(reflected.scale(remaining * 0.28)).addInPlace(normal.scale(0.025)),
      normal,
      speedScale: 0.38 + (1 - impact) * 0.2,
    };
  }

  private groundHit(origin: Vector3, direction: Vector3, reach: number): RayHit | null {
    const clearance = 0.65;
    const above = (t: number) => {
      const x = origin.x + direction.x * t, z = origin.z + direction.z * t;
      return origin.y + direction.y * t - groundHeight(x, z) - clearance;
    };
    if (above(0) < -0.05) {
      // Already below the surface (e.g. after a teleport): only stop further descent.
      if (direction.y >= 0) return null;
      return { distance: clearance, normal: this.groundNormal(origin.x, origin.z) };
    }
    const steps = Math.max(1, Math.ceil(reach / 4));
    let previous = 0;
    for (let step = 1; step <= steps; step++) {
      const t = reach * step / steps;
      if (above(t) > 0) { previous = t; continue; }
      let low = previous, high = t;
      for (let i = 0; i < 8; i++) {
        const mid = (low + high) / 2;
        if (above(mid) > 0) low = mid; else high = mid;
      }
      const x = origin.x + direction.x * high, z = origin.z + direction.z * high;
      return { distance: high + clearance, normal: this.groundNormal(x, z) };
    }
    return null;
  }

  private groundNormal(x: number, z: number): Vector3 {
    const e = 1.5;
    return new Vector3(groundHeight(x - e, z) - groundHeight(x + e, z), 2 * e, groundHeight(x, z - e) - groundHeight(x, z + e)).normalize();
  }

  private build(): void {
    const paint = new StandardMaterial("starfall-paint", this.scene);
    paint.disableLighting = true;
    paint.emissiveColor = Color3.White();
    paint.specularColor = Color3.Black();
    paint.backFaceCulling = false;

    this.buildSky();
    const terrain = new PaintBatch(1400, 9);
    this.buildTerrain(terrain);
    const mountains = new PaintBatch(2500);
    for (const m of MOUNTAINS) this.buildMountain(mountains, m);
    for (const c of CRAGS) this.buildCrag(terrain, c);
    this.buildWater();

    const props = new PaintBatch(520);
    const sink: PropSink = { batch: props, colliders: this.colliders, random: this.random };
    this.buildPath(props);
    this.buildLandmarks(sink);
    this.buildVegetation(sink);

    // Ground gets a tiling gouache grain so it holds up close; colour stays per-vertex.
    const ground = paint.clone("starfall-ground");
    ground.diffuseTexture = grainTexture(this.scene);
    terrain.build(this.scene, "starfall-terrain", ground);
    mountains.build(this.scene, "starfall-mountain", paint);
    props.build(this.scene, "starfall-props", paint);
    this.meteor = new ShootingStar(this.scene);
  }

  private buildSky(): void {
    const texture = RawTexture.CreateRGBATexture(paintSkyTexture(), SKY.width, SKY.height, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    texture.name = "starfall-sky";
    texture.wrapU = Texture.WRAP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 4;
    const material = new StandardMaterial("starfall-sky", this.scene);
    material.disableLighting = true;
    material.emissiveColor = Color3.White();
    material.diffuseTexture = texture;
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    const dome = new Mesh("starfall-sky-dome", this.scene);
    skyDomeData(9000).applyToMesh(dome);
    dome.material = material;
    dome.infiniteDistance = true;
    dome.applyFog = false;
    dome.isPickable = false;
    dome.renderingGroupId = 0;
    dome.alphaIndex = -1;
  }

  /** Polar terrain: dense under the opening view, coarse toward the outer ranges. */
  private buildTerrain(batch: PaintBatch): void {
    const center = new Vector3(0, 0, 230);
    const radius = 7800;
    const rings = 210;
    const sectors = 512;
    const wedges = 16;
    const ringRadius = (ring: number) => radius * (ring / rings) ** 1.7;
    for (let wedge = 0; wedge < wedges; wedge++) {
      const first = wedge * sectors / wedges;
      const count = sectors / wedges;
      const positions: number[] = [center.x, valleyHeight(center.x, center.z), center.z];
      for (let ring = 1; ring <= rings; ring++) {
        const r = ringRadius(ring);
        for (let s = 0; s <= count; s++) {
          const angle = (first + s) / sectors * Math.PI * 2;
          const x = center.x + Math.cos(angle) * r;
          const z = center.z + Math.sin(angle) * r;
          positions.push(x, valleyHeight(x, z), z);
        }
      }
      const indices: number[] = [];
      for (let s = 0; s < count; s++) indices.push(0, 1 + s, 2 + s);
      for (let ring = 1; ring < rings; ring++) for (let s = 0; s < count; s++) {
        const a = 1 + (ring - 1) * (count + 1) + s;
        const b = a + count + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
      batch.add(heightfield(positions, indices), (p, n) => this.paintGround(p, n), `terrain-${wedge}`);
    }
  }

  private paintGround(p: Vector3, n: Vector3): RGB {
    const shore = lakeDistance(p.x, p.z);
    if (shore < -4) return hex("#2a3a3c");
    const slope = 1 - n.y;
    const patches = fbm(p.x / 75 + 11, p.z / 60 - 4, 3);
    // Variation finer than the mesh would alias into streaks; the grain texture adds it instead.
    const fine = fbm(p.x / 34, p.z / 28, 2);
    // Meadow: broad lit and shaded patches, like cloud shadows over gouache grass.
    const shadows = smoothstep(0.42, 0.62, fbm(p.x / 160 - 7, p.z / 110 + 3, 3));
    let color = mix(GRASS.dark, GRASS.mid, smoothstep(0.28, 0.45, patches));
    color = mix(color, GRASS.lit, smoothstep(0.5, 0.66, patches));
    color = mix(color, GRASS.pale, smoothstep(0.74, 0.86, patches) * 0.6);
    color = mix(color, scaleRGB(GRASS.dark, 0.9), shadows * 0.38);
    color = scaleRGB(color, 0.86 + fine * 0.3);
    color = mix(color, cel(n, { lit: GRASS.lit, mid: GRASS.mid, dark: GRASS.dark }), smoothstep(0.06, 0.25, slope));
    // Lit sage grass at the waterline.
    color = mix(SHORE, color, smoothstep(1, 18, shore));
    // Brown rock where the land breaks steeply.
    color = mix(color, scaleRGB(cel(n, PALETTES.rock), 0.85 + fine * 0.3), smoothstep(0.32, 0.55, slope));
    // Forested highlands toward the rim.
    color = mix(color, scaleRGB(cel(n, HIGHLAND), 0.85 + fine * 0.3), smoothstep(55, 190, p.y) * (1 - smoothstep(0.45, 0.7, slope) * 0.5));
    // The dark ridge under the obsidian monolith, and the promontory in its shadow.
    const ragged = (fbm(p.x / 60, p.z / 60, 3) - 0.5) * 90;
    const shadowed = smoothstep(0, 70, p.x - 0.2 * p.z - 20 + ragged) * smoothstep(240, 330, p.z + ragged * 0.5) * (1 - smoothstep(900, 1300, p.z));
    const ridge = Math.max(eastRidgeWeight(p.x, p.z) * smoothstep(2, 22, p.y), shadowed);
    const crag = fbm(p.x / 14 + 2, p.z / 14 + p.y / 9, 3);
    color = mix(color, scaleRGB(cel(n, RIDGE), 0.7 + crag * 0.7), ridge);
    return color;
  }

  private buildMountain(batch: PaintBatch, m: Mountain): void {
    const rings = m.far ? 34 : 60;
    const sectors = m.far ? 72 : 128;
    const outer = m.radius * 1.25;
    const positions: number[] = [m.x, m.peak, m.z];
    for (let ring = 1; ring <= rings; ring++) {
      const r = outer * (ring / rings) ** 1.25;
      for (let s = 0; s <= sectors; s++) {
        const angle = s / sectors * Math.PI * 2;
        const x = m.x + Math.cos(angle) * r;
        const z = m.z + Math.sin(angle) * r;
        const floor = valleyHeight(x, z);
        const surface = mountainHeight(m, x, z);
        positions.push(x, surface > floor ? surface : floor - 8, z);
      }
    }
    const indices: number[] = [];
    for (let s = 0; s < sectors; s++) indices.push(0, 1 + s, 2 + s);
    for (let ring = 1; ring < rings; ring++) for (let s = 0; s < sectors; s++) {
      const a = 1 + (ring - 1) * (sectors + 1) + s;
      const b = a + sectors + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    const snowLine = 1 - m.snow * 0.62;
    batch.add(heightfield(positions, indices), (p, n) => {
      const height = clamp01(p.y / m.peak);
      const steep = 1 - n.y;
      const streak = fbm(p.x / 90 + m.seed, p.z / 90 + p.y / 60, 3) - 0.5;
      // South faces turn toward us in mid-blue; only west-facing planes take the pale light.
      let color = mix(cel(n, MOUNTAIN_GREEN, -0.08), cel(n, MOUNTAIN_ROCK, -0.18), smoothstep(0.18, 0.42, height + steep * 0.35 + streak * 0.3));
      const snow = smoothstep(snowLine, snowLine + 0.12, height + streak * 0.18 + (n.y - 0.5) * 0.1);
      color = mix(color, cel(n, SNOW, -0.2), snow);
      // Far ranges carry extra painted haze beyond what fog alone gives.
      const haze = smoothstep(3800, 7000, Math.hypot(p.x - REFERENCE_VIEW.eye.x, p.z - REFERENCE_VIEW.eye.z)) * 0.5;
      return mix(scaleRGB(color, 0.9 + (streak + 0.5) * 0.2), HAZE, haze);
    }, `mountain-${m.id}`);
  }

  /** Finely tessellated rock outcrop with downhill fissures and mossy ledges. */
  private buildCrag(batch: PaintBatch, c: Crag): void {
    const rings = 72;
    const sectors = 200;
    const outer = c.radius * 1.3;
    const positions: number[] = [c.x, c.peak, c.z];
    for (let ring = 1; ring <= rings; ring++) {
      const r = outer * (ring / rings) ** 1.1;
      for (let s = 0; s <= sectors; s++) {
        const angle = s / sectors * Math.PI * 2;
        const x = c.x + Math.cos(angle) * r;
        const z = c.z + Math.sin(angle) * r;
        const floor = valleyHeight(x, z);
        const surface = cragHeight(c, x, z);
        positions.push(x, surface > floor ? surface : floor - 3, z);
      }
    }
    const indices: number[] = [];
    for (let s = 0; s < sectors; s++) indices.push(0, 1 + s, 2 + s);
    for (let ring = 1; ring < rings; ring++) for (let s = 0; s < sectors; s++) {
      const a = 1 + (ring - 1) * (sectors + 1) + s;
      const b = a + sectors + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
    batch.add(heightfield(positions, indices), (p, n) => {
      const fissure = fbm(p.x / 5 + c.seed, p.z / 5 + p.y / 22, 3);
      const rock = scaleRGB(cel(n, CRAG_ROCK, (fissure - 0.5) * 0.6), 0.74 + fissure * 0.5);
      const grassy = smoothstep(0.8, 0.94, n.y) * (0.5 + 0.5 * fbm(p.x / 9, p.z / 9, 2));
      return mix(rock, scaleRGB(MOSS, 0.8 + fissure * 0.4), grassy * 0.75);
    }, `crag-${c.id}`);
  }

  /** Painted water: sky tones with horizontal strokes and hand-placed reflections. */
  private buildWater(): void {
    const xs = steps(-720, 900, [[-280, 4], [390, 4]], 14);
    const zs = steps(150, 1920, [[480, 3], [820, 6], [1300, 14]], 28);
    const positions: number[] = [];
    const colors: number[] = [];
    const uvs: number[] = [];
    const reflectors = this.reflectors();
    const wet: boolean[] = [];
    for (const z of zs) for (const x of xs) {
      positions.push(x, WATER_LEVEL, z);
      uvs.push(x / 70, z / 11);
      wet.push(lakeDistance(x, z) < 40);
      const c = this.paintWater(x, z, reflectors);
      colors.push(c[0], c[1], c[2], 1);
    }
    const indices: number[] = [];
    const w = xs.length;
    for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < w - 1; i++) {
      const a = j * w + i;
      if (!wet[a] && !wet[a + 1] && !wet[a + w] && !wet[a + w + 1]) continue;
      indices.push(a, a + w, a + 1, a + 1, a + w, a + w + 1);
    }
    const data = new VertexData();
    data.positions = positions;
    data.colors = colors;
    data.uvs = uvs;
    data.indices = indices;
    const water = new Mesh("starfall-water", this.scene);
    data.applyToMesh(water);
    const material = new StandardMaterial("starfall-water", this.scene);
    material.disableLighting = true;
    material.emissiveColor = Color3.White();
    material.backFaceCulling = false;
    material.diffuseTexture = this.waterTexture = rippleTexture(this.scene);
    water.material = material;
    water.isPickable = false;
    water.freezeWorldMatrix();
  }

  /** Vertical props whose reflections the painter streaked down the water toward us. */
  private reflectors(): { x: number; z: number; height: number; width: number; strength: number }[] {
    const list = [
      { px: 1160, pyTop: 990, pyBase: 1040, width: 6, strength: 0.75 },
      { px: 1440, pyTop: 940, pyBase: 1030, width: 7, strength: 0.6 },
      { px: 1510, pyTop: 880, pyBase: 1042, width: 8, strength: 0.6 },
      { px: 615, pyTop: 955, pyBase: 1064, width: 7, strength: 0.45 },
    ];
    return list.map(({ px, pyTop, pyBase, width, strength }) => {
      const base = onPlane(px, pyBase, WATER_LEVEL);
      const top = atDepth(px, pyTop, base.z);
      return { x: base.x, z: base.z, height: top.y - WATER_LEVEL, width, strength };
    });
  }

  private paintWater(x: number, z: number, reflectors: ReturnType<StarfallLake["reflectors"]>): RGB {
    const strokes = fbm(x / 160 + 3, z / 7, 3);
    let color = mix(WATER.near, WATER.far, smoothstep(170, 1500, z));
    color = mix(color, WATER.light, smoothstep(0.56, 0.74, strokes) * 0.55);
    color = mix(color, WATER.sky, smoothstep(500, 900, z) * (1 - smoothstep(1250, 1650, z)) * 0.5);
    // Dark reflection of the eastern ridge and the obsidian monolith.
    const east = smoothstep(-8, 30, x - 0.18 * z) * (1 - smoothstep(650, 1150, z));
    color = mix(color, WATER.dark, east * 0.88);
    // Forest reflections hug the far shore.
    const shore = -lakeDistance(x, z);
    color = mix(color, WATER.forest, (1 - smoothstep(10, 150, shore)) * smoothstep(1250, 1600, z) * 0.85);
    // Pale reflection beneath the sphere.
    color = mix(color, WATER.dome, Math.exp(-(((x + 190) / 70) ** 2 + ((z - 440) / 90) ** 2)) * 0.7);
    const eyeHeight = REFERENCE_VIEW.eye.y - WATER_LEVEL;
    for (const r of reflectors) {
      const length2 = r.x * r.x + r.z * r.z;
      const along = (x * r.x + z * r.z) / length2;
      const start = eyeHeight / (eyeHeight + r.height);
      if (along > 1.01 || along < start) continue;
      const across = Math.abs(x * r.z - z * r.x) / Math.sqrt(length2);
      const width = r.width * 0.5 * along;
      const fade = smoothstep(start, start + (1 - start) * 0.5, along);
      color = mix(color, WATER.dark, (1 - smoothstep(width * 0.5, width, across)) * fade * r.strength);
    }
    return scaleRGB(color, 1.07);
  }

  /** The sandy footpath crossing the meadow below the opening view. */
  private buildPath(batch: PaintBatch): void {
    const points: Vector3[] = [];
    for (let x = -260; x <= 300; x += 3) points.push(new Vector3(x, 0, 106 + Math.sin(x / 47) * 7 + Math.max(0, -x - 90) * 0.35));
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const next = points[Math.min(i + 1, points.length - 1)];
      const prev = points[Math.max(0, i - 1)];
      const tangent = next.subtract(prev).normalize();
      const width = 2.4 + Math.sin(i * 0.37) * 0.4;
      for (const side of [-1, 1]) {
        const x = p.x + tangent.z * side * width;
        const z = p.z - tangent.x * side * width;
        positions.push(x, valleyHeight(x, z) + 0.12, z);
      }
      if (i) indices.push((i - 1) * 2, i * 2, (i - 1) * 2 + 1, (i - 1) * 2 + 1, i * 2, i * 2 + 1);
    }
    batch.add(heightfield(positions, indices), (p) => scaleRGB(PATH, 0.9 + fbm(p.x / 4, p.z / 3, 2) * 0.35), "path");
  }

  private buildLandmarks(sink: PropSink): void {
    const ground = (x: number, z: number) => valleyHeight(x, z);

    // The great sphere, sunk into the west shore and half in the crag's shadow.
    const center = atDepth(542, 866, 560);
    const radius = 113;
    const eye = REFERENCE_VIEW.eye;
    const surfaceAlong = (px: number, py: number) => {
      const ray = referenceRay(px, py).normalize();
      const offset = eye.subtract(center);
      const b = Vector3.Dot(offset, ray);
      const t = -b - Math.sqrt(Math.max(0, b * b - (offset.lengthSquared() - radius * radius)));
      return eye.add(ray.scale(t));
    };
    const upper = surfaceAlong(520, 672);
    const lower = surfaceAlong(430, 960);
    let normal = Vector3.Cross(upper.subtract(eye), lower.subtract(eye)).normalize();
    if (Vector3.Dot(surfaceAlong(700, 820).subtract(eye), normal) < 0) normal = normal.scale(-1);
    const front = new Vector3(eye.x - center.x, 0, eye.z - center.z).normalize();
    addDome(sink, { center, radius, front, shadowPlane: { point: eye.clone(), normal } });

    // Colossal fluted monoliths, each turned to face the launch point: pale on the west bank,
    // obsidian and slate on the east ridge. Placed by their frame position and painted top.
    const facing = (px: number, distance: number, width: number, depth: number, pyTop: number) => {
      const azimuth = Math.atan2((px - REFERENCE_VIEW.width / 2) / REFERENCE_VIEW.focal, 1);
      const direction = new Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
      const face = direction.scale(distance);
      const center = face.add(direction.scale(depth / 2));
      const top = atDepth(px, pyTop, face.z).y;
      const base = Math.min(ground(center.x, center.z), ground(face.x, face.z)) - 30;
      return { base: new Vector3(center.x, base, center.z), width, depth, height: top - base, yaw: azimuth };
    };
    const obsidianRecess = palette("#2a3236", "#0f1218", "#0a0b0f");
    const slateRecess = palette("#2a4258", "#192c3e", "#0f1c2a");
    const pale = facing(250, 1050, 190, 120, 110);
    addMonolith(sink, pale.base, pale.width, pale.depth, pale.height, pale.yaw, PALETTES.paleStone, PALETTES.paleStoneRecess,
      { highlight: palette("#a2aa96", "#86907f", "#40463f"), highlightShare: 0.4 });
    const obsidian = facing(2238, 900, 300, 210, -1400);
    addMonolith(sink, obsidian.base, obsidian.width, obsidian.depth, obsidian.height, obsidian.yaw, PALETTES.obsidian, obsidianRecess,
      { bias: -0.6, highlight: palette("#7b8d88", "#55635d", "#1a1f26") });
    const slate = facing(1875, 1400, 80, 80, 395);
    addMonolith(sink, slate.base, slate.width, slate.depth, slate.height, slate.yaw, PALETTES.slate, slateRecess, { bias: -0.35 });
    // Invented: more of the ring stands off-frame beside and behind the launch meadow.
    const ring = (x: number, z: number, width: number, depth: number, top: number, colors: typeof PALETTES.paleStone, recess: typeof PALETTES.paleStone, bias = 0) => {
      const yaw = Math.atan2(-x, -z) + Math.PI;
      addMonolith(sink, new Vector3(x, ground(x, z) - 30, z), width, depth, top - ground(x, z) + 30, yaw, colors, recess, { bias });
    };
    ring(-1150, 620, 130, 105, 880, PALETTES.paleStone, PALETTES.paleStoneRecess);
    ring(-2100, 1700, 150, 130, 1000, PALETTES.paleStone, PALETTES.paleStoneRecess);
    ring(-760, -380, 140, 110, 820, PALETTES.paleStone, PALETTES.paleStoneRecess);
    ring(830, -500, 210, 140, 980, PALETTES.obsidian, obsidianRecess, -0.5);
    ring(-300, -1350, 150, 120, 1080, PALETTES.slate, slateRecess, -0.2);
    ring(380, -1450, 130, 110, 880, PALETTES.paleStone, PALETTES.paleStoneRecess);
    ring(1650, 250, 170, 140, 1050, PALETTES.obsidian, obsidianRecess, -0.5);

    // Twin spires on the far mountains (left tower notched with a needle; right a stepped group).
    addTower(sink, new Vector3(0, 640, 2600), [
      { x: -882, z: 0, width: 140, depth: 120, top: 1356 },
      { x: -750, z: 10, width: 124, depth: 104, top: 1482 },
    ], { x: -700, z: 10, top: 1540, width: 22 });
    addTower(sink, new Vector3(0, 340, 3300), [
      { x: -145, z: 0, width: 160, depth: 130, top: 1506 },
      { x: -32, z: 8, width: 64, depth: 112, top: 1410 },
      { x: 56, z: 12, width: 80, depth: 90, top: 878 },
    ]);

    // Obelisks exactly where the painting stands them.
    const obelisk = (px: number, pyTop: number, pyBase: number, groundY: number, widthPx: number, plinth: "steps" | "monument" | "none" = "steps") => {
      const base = onPlane(px, pyBase, groundY);
      const top = atDepth(px, pyTop, base.z);
      const width = widthPx / REFERENCE_VIEW.focal * base.z;
      const footing = new Vector3(base.x, Math.min(groundY, ground(base.x, base.z) - 0.2), base.z);
      addObelisk(sink, footing, top.y - footing.y, width, plinth);
      return base;
    };
    obelisk(470, 962, 1030, -2, 7);
    obelisk(505, 934, 1046, -2, 10);
    obelisk(615, 952, 1064, -2, 12);
    const islet = obelisk(1160, 990, 1040, -2.4, 9, "none");
    addRock(sink, new Vector3(islet.x, WATER_LEVEL - 0.8, islet.z), new Vector3(9, 2.6, 7), PALETTES.darkRock, 2, false);
    obelisk(1440, 940, 1030, -1.5, 11);
    obelisk(1510, 880, 1042, -1.5, 14);
    obelisk(1765, 852, 1145, 0, 40, "monument");
    obelisk(1817, 930, 1062, -1.5, 15);
    // Invented: obelisks continue around the shore and line an avenue behind the meadow.
    for (const [x, z, h] of [[-250, 700, 40], [-470, 1180, 46], [-300, 1920, 52], [210, 1960, 48], [520, 1350, 44], [-30, 1930, 30]] as const) {
      addObelisk(sink, new Vector3(x, ground(x, z) - 0.3, z), h, h * 0.12);
    }
    for (let z = -90; z >= -430; z -= 68) for (const x of [-30, 30]) addObelisk(sink, new Vector3(x, ground(x, z) - 0.3, z), 24, 2.6);

    // White service buildings at the sphere's lakeside foot.
    for (const [x, z, w, h, d] of [[-232, 655, 26, 8, 14], [-250, 690, 18, 6, 12], [-215, 620, 12, 5, 10]] as const) {
      sink.batch.add(boxAt(new Vector3(x, ground(x, z) + h / 2 - 0.5, z), w, h, d), (_p, n) => cel(n, PALETTES.white), "dome");
      sink.colliders.push({ kind: "box", center: new Vector3(x, ground(x, z) + h / 2, z), half: new Vector3(w / 2, h / 2, d / 2), yaw: 0 });
    }

    // Invented: a smaller observatory sphere ends the obelisk avenue behind the start.
    const observatory = new Vector3(40, ground(40, -560) + 18, -560);
    addDome(sink, {
      center: observatory, radius: 46, front: new Vector3(0, 0, 1),
      shadowPlane: { point: observatory.add(new Vector3(-80, 0, 0)), normal: new Vector3(1, 0, 0) },
    });

    // The landing pod resting in the meadow.
    const pod = onPlane(1395, 1182, 0);
    addPod(sink, new Vector3(pod.x, ground(pod.x, pod.z), pod.z), 9.4, Math.PI / 2 + 0.08);

    // Fallen boulders at the crag's foot.
    for (let i = 0; i < 10; i++) {
      const px = this.random.range(120, 470);
      const py = this.random.range(1010, 1065);
      const at = onPlane(px, py, 0);
      const size = this.random.range(4, 9);
      addRock(sink, new Vector3(at.x, ground(at.x, at.z) + size * 0.25, at.z), new Vector3(size * 1.3, size * 0.8, size * 1.1), PALETTES.rock, 3);
    }

    for (const [px, py, size] of [[1900, 1188, 7.5], [2010, 1200, 9.5], [2150, 1178, 8.5], [2230, 1212, 6], [1840, 1214, 4.5]] as const) {
      const at = onPlane(px, py, 0);
      addRock(sink, new Vector3(at.x, ground(at.x, at.z) + size * 0.32, at.z + size * 0.4), new Vector3(size * 1.15, size * 0.88, size), palette("#5e4f37", "#33291d", "#120e0d"), 3);
    }
    for (let i = 0; i < 60; i++) {
      const x = this.random.range(-900, 900);
      const z = this.random.range(-700, 120);
      if (Math.hypot(x, z) < 60 || lakeDistance(x, z) < 10) continue;
      const size = this.random.range(2, 7);
      addRock(sink, new Vector3(x, ground(x, z) + size * 0.2, z), new Vector3(size * 1.3, size * 0.7, size), PALETTES.rock, 1);
    }
  }

  private buildVegetation(sink: PropSink): void {
    const ground = (x: number, z: number) => valleyHeight(x, z);
    const random = this.random;

    // The dark tree framing the left edge of the opening view: many small leaf masses packed
    // inside the silhouette traced from the painting (frame x of its right edge per row).
    const depth = 30;
    const edge: readonly (readonly [number, number])[] = [[0, 345], [120, 350], [150, 280], [230, 238], [280, 320], [330, 300], [370, 226], [450, 200], [560, 150], [700, 118], [800, 76], [900, 44], [1000, 12]];
    const rightEdge = (py: number) => {
      for (let i = 1; i < edge.length; i++) if (py <= edge[i][0]) {
        const t = (py - edge[i - 1][0]) / (edge[i][0] - edge[i - 1][0]);
        return edge[i - 1][1] + (edge[i][1] - edge[i - 1][1]) * t;
      }
      return 0;
    };
    const body = palette("#283825", "#1a2617", "#0c110a");
    const leaves = palette("#4c6743", "#33482e", "#162013");
    // Trunk sits just outside the frame, under a crown that extends off-screen to the left.
    sink.batch.add(cylinderAt(new Vector3(-40, 12, 32), 1.6, 2.8, 26), (_p, n) => cel(n, PALETTES.bark), "foliage");
    for (let py = -30; py <= 1000; py += 24) {
      for (let px = py < 700 ? -260 : -150; px < rightEdge(py); px += random.range(28, 42)) {
        const r = random.range(15, 30);
        const x = Math.min(px, rightEdge(py) - r * 0.5);
        const center = atDepth(x, py + random.range(-10, 10), depth + random.range(-6, 9));
        addFoliageMass(sink.batch, center, r / REFERENCE_VIEW.focal * center.z, body, leaves, random, 1, 4, [0.2, 0.34]);
      }
    }
    sink.colliders.push({ kind: "sphere", center: atDepth(160, 300, depth), radius: 9 });

    // Bushy treetops filling the lower left, sized so each crown tops out where the painting has it.
    const bushTop = (px: number, py: number, height: number) => {
      let z = (REFERENCE_VIEW.eye.y - height) * REFERENCE_VIEW.focal / (py - REFERENCE_VIEW.horizon);
      for (let i = 0; i < 2; i++) {
        const probe = atDepth(px, py, z);
        z = (REFERENCE_VIEW.eye.y - height - ground(probe.x, probe.z)) * REFERENCE_VIEW.focal / (py - REFERENCE_VIEW.horizon);
      }
      const top = atDepth(px, py, z);
      return new Vector3(top.x, ground(top.x, top.z), top.z);
    };
    const bushEdge = (py: number) => py < 1060 ? 300 + (py - 1000) * 3 : py < 1150 ? 560 : 640;
    for (let py = 1000; py < 1250; py += 30) {
      for (let px = -40; px < bushEdge(py); px += random.range(40, 70)) {
        const height = random.range(4, 9) + (1230 - py) * 0.018;
        const base = bushTop(px + random.range(-10, 10), py + random.range(-8, 8), height);
        if (base.z < 20 || lakeDistance(base.x, base.z) < 2) continue;
        addTree(sink, base, height, height * random.range(0.45, 0.6), PALETTES.bush);
      }
    }

    // Low dark shrubs scattered through the foreground meadow, as in the painting.
    for (let i = 0; i < 90; i++) {
      const x = random.range(-120, 260);
      const z = random.range(70, 185);
      if (Math.hypot(x - 26, z - 96) < 12 || Math.hypot(x - 74, z - 117) < 18 || lakeDistance(x, z) < 3) continue;
      if (Math.abs(x) < z * 0.35 && random.next() < 0.6) continue;
      const height = random.range(1.2, 3.2);
      addTree(sink, new Vector3(x, ground(x, z), z), height, height * random.range(0.9, 1.4), PALETTES.bush, 1);
    }

    // Shoreline shrubs along the near bank.
    for (let x = -150; x < 300; x += random.range(9, 22)) {
      const z = 168 + random.range(-6, 4) + Math.max(0, x - 120) * 0.18;
      if (lakeDistance(x, z) < 2) continue;
      addTree(sink, new Vector3(x, ground(x, z), z), random.range(2.2, 4.5), random.range(2, 3.5), PALETTES.bush, 1);
    }

    // Meadow and woodland trees around and behind the launch point.
    for (let i = 0; i < 170; i++) {
      const x = random.range(-1300, 1300);
      const z = random.range(-1100, 260);
      const g = ground(x, z);
      if (lakeDistance(x, z) < 15 || Math.abs(x) < 70 && z > -460 && z < 60 || g > 160 || groundHeight(x, z) > g + 1) continue;
      // Keep the opening frame as painted.
      if (z > 40 && Math.abs(x) < z * 1.15) continue;
      const height = random.range(12, 26);
      addTree(sink, new Vector3(x, g, z), height, height * random.range(0.42, 0.55), PALETTES.foliage, Math.hypot(x, z) > 420 ? 1 : 2);
    }

    // Distant forest bands: the far north shore below the spires, and the wooded ridges.
    const forest = (x: number, z: number, height: number) => {
      const floor = groundHeight(x, z);
      // Forest stays on the shore flats; the mountains keep their bare painted slopes.
      if (lakeDistance(x, z) < 6 || floor > valleyHeight(x, z) + 4 || floor > 120) return;
      addFarTree(sink.batch, new Vector3(x, floor - 1, z), height, random);
    };
    for (let i = 0; i < 1300; i++) {
      const x = random.range(-950, 1100);
      const z = random.range(1880, 2450);
      forest(x, z, random.range(18, 30));
    }
    for (let i = 0; i < 500; i++) {
      const side = random.next() < 0.5 ? -1 : 1;
      const x = side < 0 ? random.range(-1300, -420) : random.range(700, 1500);
      const z = random.range(side < 0 ? 950 : 1250, 2300);
      forest(x, z, random.range(16, 26));
    }
  }
}

/** Heightfield vertex data with upward-facing smooth normals. */
function heightfield(positions: number[], indices: number[]): VertexData {
  const normals: number[] = [];
  VertexData.ComputeNormals(positions, indices, normals);
  let up = 0;
  for (let i = 1; i < normals.length; i += 3) up += normals[i];
  if (up < 0) for (let i = 0; i < normals.length; i++) normals[i] = -normals[i];
  const data = new VertexData();
  data.positions = positions;
  data.normals = normals;
  data.indices = indices;
  return data;
}

/** Sample positions: `fine` spacing up to each break, then `coarse` beyond the last. */
function steps(from: number, to: number, breaks: readonly (readonly [number, number])[], coarse: number): number[] {
  const values: number[] = [];
  let value = from;
  while (value < to) {
    values.push(value);
    const segment = breaks.find(([limit]) => value < limit);
    value += segment ? segment[1] : coarse;
  }
  values.push(to);
  return values;
}

function boxAt(center: Vector3, width: number, height: number, depth: number): VertexData {
  return place(CreateBoxVertexData({ width, height, depth }), center);
}
function cylinderAt(center: Vector3, top: number, bottom: number, height: number): VertexData {
  return place(CreateCylinderVertexData({ height, diameterTop: top, diameterBottom: bottom, tessellation: 8 }), center);
}

/** Soft mottled grain, multiplied over the ground's painted colours. */
function grainTexture(scene: Scene): Texture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  // Value noise on a wrapped lattice so the texture tiles without seams.
  const tile = (x: number, y: number, period: number) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const h = (i: number, j: number) => hash2(((i % period) + period) % period, ((j % period) + period) % period);
    const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const grain = tile(u * 8, v * 8, 8) * 0.45 + tile(u * 32, v * 16, 32) * 0.35 + tile(u * 64, v * 64, 64) * 0.2;
    const value = Math.round(255 * (0.78 + grain * 0.22));
    data.set([value, value, value, 255], (y * size + x) * 4);
  }
  const texture = RawTexture.CreateRGBATexture(data, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = "starfall-grain";
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/** Horizontal brush-stroke ripples, multiplied over the water's painted colours. */
function rippleTexture(scene: Scene): Texture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const random = new Random(77);
  data.fill(236);
  for (let i = 0; i < 520; i++) {
    const y = Math.floor(random.next() * size);
    const x0 = random.next() * size;
    const length = random.range(10, 70);
    const value = random.next() < 0.7 ? 255 : 205;
    for (let x = 0; x < length; x++) {
      const fade = Math.sin(Math.PI * x / length);
      const offset = (y * size + Math.floor(x0 + x) % size) * 4;
      const current = data[offset];
      const next = Math.round(current + (value - current) * fade);
      data[offset] = data[offset + 1] = data[offset + 2] = next;
    }
  }
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  const texture = RawTexture.CreateRGBATexture(data, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.name = "starfall-ripples";
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  return texture;
}

/** An occasional meteor streaking across the painted sky, like the one in the reference. */
class ShootingStar {
  private readonly mesh: Mesh;
  private next = 6;
  private start = -1;
  private from = Vector3.Forward();
  private to = Vector3.Forward();

  constructor(scene: Scene) {
    this.mesh = new Mesh("starfall-meteor", scene);
    const data = new VertexData();
    data.positions = new Array(12).fill(0);
    data.colors = [0.9, 0.94, 0.96, 0.95, 0.9, 0.94, 0.96, 0.95, 0.9, 0.94, 0.96, 0, 0.9, 0.94, 0.96, 0];
    data.indices = [0, 1, 2, 1, 3, 2];
    data.applyToMesh(this.mesh, true);
    this.mesh.hasVertexAlpha = true;
    const material = new StandardMaterial("starfall-meteor", scene);
    material.disableLighting = true;
    material.emissiveColor = Color3.White();
    material.backFaceCulling = false;
    material.disableDepthWrite = true;
    this.mesh.material = material;
    this.mesh.applyFog = false;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.setEnabled(false);
  }

  hide(): void { this.mesh.setEnabled(false); this.start = -1; }

  update(time: number, eye: Vector3): void {
    if (this.start < 0 && time >= this.next) {
      const random = Math.random;
      const azimuth = random() * Math.PI * 2;
      const elevation = (24 + random() * 30) * Math.PI / 180;
      const heading = random() * Math.PI * 2;
      const span = (8 + random() * 8) * Math.PI / 180;
      this.from = direction(azimuth, elevation);
      this.to = direction(azimuth + Math.cos(heading) * span, elevation - Math.abs(Math.sin(heading)) * span * 0.7);
      this.start = time;
    }
    if (this.start < 0) return;
    const t = (time - this.start) / 0.9;
    if (t >= 1) {
      this.hide();
      this.next = time + 7 + Math.random() * 11;
      return;
    }
    const distance = 8500;
    const head = Vector3.Lerp(this.from, this.to, Math.min(1, t * 1.15)).normalize();
    const tail = Vector3.Lerp(this.from, this.to, Math.max(0, t * 1.15 - 0.35)).normalize();
    const side = Vector3.Cross(head.subtract(tail), head).normalize().scale(distance * 0.00055 * Math.sin(Math.PI * t));
    const h = head.scale(distance), tl = tail.scale(distance);
    this.mesh.position.copyFrom(eye);
    this.mesh.updateVerticesData(VertexBuffer.PositionKind, [
      h.x + side.x, h.y + side.y, h.z + side.z, h.x - side.x, h.y - side.y, h.z - side.z,
      tl.x, tl.y, tl.z, tl.x, tl.y, tl.z,
    ]);
    this.mesh.setEnabled(true);
  }
}

const direction = (azimuth: number, elevation: number) =>
  new Vector3(Math.cos(elevation) * Math.sin(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.cos(azimuth));
