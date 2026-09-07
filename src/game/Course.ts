import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3, Vector4 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Scene } from "@babylonjs/core/scene";
import type { FlightBounds } from "./FlightController";

interface WaterfallSheet {
  mesh: Mesh;
  baseY: number;
  phase: number;
}

export class SkyWorld {
  private readonly waterfallSheets: WaterfallSheet[] = [];
  private readonly distantCanopies = new Map<Mesh, Mesh>();
  private seed = 7331;
  readonly flightBounds: FlightBounds = {
    center: new Vector3(50, 30, 1100),
    radius: 4500,
  };

  constructor(private readonly scene: Scene) {
    this.buildWorld();
  }

  reset(): void {
    // This is a playground: resetting only returns the player to the launch point.
  }

  update(timeSeconds: number): void {
    for (const sheet of this.waterfallSheets) {
      sheet.mesh.position.y = sheet.baseY + Math.sin(timeSeconds * 1.7 + sheet.phase) * 0.16;
      const material = sheet.mesh.material;
      if (material instanceof StandardMaterial) {
        material.alpha = 0.58 + Math.sin(timeSeconds * 2.2 + sheet.phase) * 0.12;
      }
    }
  }

  get startPosition(): Vector3 { return new Vector3(0, 55, -250); }
  get startDirection(): Vector3 { return Vector3.Forward(); }

  private buildWorld(): void {
    let existingMeshes = new Set(this.scene.meshes);
    const finishDistrict = () => {
      this.batchScenery(existingMeshes);
      existingMeshes = new Set(this.scene.meshes);
    };
    const waterfallIsland = this.createIsland("azure-falls", new Vector3(-1200, 50, 400), 1400, 180, "lush");
    this.addCrystalPool(waterfallIsland, new Vector3(0, 0.7, 0), 180);
    this.addWaterfall(waterfallIsland, new Vector3(-650, -75, 0), 100, 210);
    this.addGrove(waterfallIsland, 900, 580);
    finishDistrict();

    const cityIsland = this.createIsland("neon-city", new Vector3(0, 5, 550), 1750, 200, "city");
    this.addCity(cityIsland, 625, 780);
    finishDistrict();

    const groveIsland = this.createIsland("quiet-grove", new Vector3(1550, 11, 700), 1600, 180, "lush");
    this.addGrove(groveIsland, 1300, 690);
    this.addCrystalPool(groveIsland, new Vector3(0, 0.7, 0), 160);
    finishDistrict();

    const harborIsland = this.createIsland("sky-harbor", new Vector3(550, 3, 2100), 1500, 170, "city");
    this.addCity(harborIsland, 441, 650);
    this.addWaterfall(harborIsland, new Vector3(700, -70, 0), 70, 190);
    finishDistrict();

    const gardenIsland = this.createIsland("little-garden", new Vector3(-1100, 25, 2000), 1400, 160, "lush");
    this.addGrove(gardenIsland, 700, 580);
    finishDistrict();

    this.addFloatingRocks();
    this.addClouds();
    this.addFlightBoundary();
    finishDistrict();
  }

  private batchScenery(existingMeshes: ReadonlySet<Scene["meshes"][number]>): void {
    // Batch opaque scenery by material AND local area so Quest can cull distant blocks.
    // Animated waterfalls, water and the boundary keep their separate materials.
    const batches = new Map<string, Mesh[]>();
    for (const mesh of this.scene.meshes) {
      if (existingMeshes.has(mesh) || !(mesh instanceof Mesh) || !mesh.material || mesh.material.alpha < 1 || mesh.metadata?.canopyLOD) continue;
      mesh.computeWorldMatrix(true);
      const p = mesh.getBoundingInfo().boundingBox.centerWorld;
      const key = `${mesh.material.uniqueId}:${Math.floor(p.x / 480)}:${Math.floor(p.z / 480)}`;
      const batch = batches.get(key) ?? [];
      batch.push(mesh);
      batches.set(key, batch);
    }
    // Detach descendants before MergeMeshes disposes their source parents (roads own
    // lane markings). setParent preserves each mesh's world transform.
    for (const batch of batches.values()) for (const mesh of batch) mesh.setParent(null);
    for (const [key, batch] of batches) {
      const lowDetail = batch.map((source) => this.distantCanopies.get(source)).filter((mesh): mesh is Mesh => Boolean(mesh));
      const mesh = batch.length > 1 ? Mesh.MergeMeshes(batch, true, true) : batch[0];
      if (!mesh) continue;
      mesh.name = `scenery-${key}`;
      mesh.isPickable = false;
      mesh.freezeWorldMatrix();
      if (lowDetail.length === batch.length) {
        const lod = lowDetail.length > 1 ? Mesh.MergeMeshes(lowDetail, true, true) : lowDetail[0];
        if (lod) {
          lod.name = `distant-${key}`;
          lod.isPickable = false;
          lod.freezeWorldMatrix();
          mesh.addLODLevel(700, lod);
        }
      }
    }
    this.distantCanopies.clear();
  }

  private createIsland(
    name: string,
    position: Vector3,
    diameter: number,
    depth: number,
    style: "lush" | "city",
  ): TransformNode {
    const root = new TransformNode(name, this.scene);
    root.position.copyFrom(position);

    const cliff = CreateCylinder(`${name}-cliff`, {
      diameterTop: diameter,
      diameterBottom: diameter * 0.13,
      height: depth,
      tessellation: 32,
      subdivisions: 1,
    }, this.scene);
    cliff.parent = root;
    cliff.position.y = -depth / 2;
    cliff.rotation.y = this.random() * Math.PI;
    cliff.scaling.z = 1;
    cliff.material = this.material("sunlit-cliff", new Color3(0.46, 0.36, 0.29), new Color3(0.025, 0.02, 0.015));

    const top = CreateCylinder(`${name}-top`, {
      diameter: diameter * 0.97,
      height: 0.9,
      tessellation: 32,
    }, this.scene);
    top.parent = root;
    top.position.y = 0.25;
    top.rotation.y = cliff.rotation.y;
    top.scaling.z = cliff.scaling.z;
    top.material = style === "lush"
      ? this.material("island-grass", new Color3(0.24, 0.34, 0.16), new Color3(0.01, 0.015, 0.005))
      : this.material("city-ground", new Color3(0.27, 0.32, 0.38), new Color3(0.025, 0.035, 0.05));
    if (style === "lush") (top.material as StandardMaterial).diffuseTexture = this.surfaceTexture("ground");
    return root;
  }

  private addCrystalPool(root: TransformNode, position: Vector3, diameter: number): void {
    const waterMaterial = this.material("crystal-water", new Color3(0.08, 0.72, 0.92), new Color3(0.05, 0.32, 0.5));
    waterMaterial.alpha = 0.86;
    const pool = CreateCylinder(`${root.name}-pool`, { diameter, height: 0.24, tessellation: 32 }, this.scene);
    pool.parent = root;
    pool.position.copyFrom(position);
    pool.material = waterMaterial;

    const rim = CreateTorus(`${root.name}-pool-rim`, { diameter: diameter * 1.03, thickness: 0.3, tessellation: 32 }, this.scene);
    rim.parent = root;
    rim.position.copyFrom(position);
    rim.material = this.material("pool-edge", new Color3(0.72, 0.83, 0.72), new Color3(0.03, 0.06, 0.05));
  }

  private addWaterfall(root: TransformNode, position: Vector3, width: number, height: number): void {
    for (let index = 0; index < 3; index += 1) {
      const material = this.material(`waterfall-${root.name}-${index}`, new Color3(0.2, 0.84, 1), new Color3(0.08, 0.46, 0.72));
      material.alpha = 0.65;
      material.disableDepthWrite = true;
      const sheet = CreateBox(`${root.name}-waterfall-${index}`, {
        width: width * (1 - index * 0.14),
        height,
        depth: 0.16,
      }, this.scene);
      sheet.parent = root;
      sheet.position.copyFrom(position.add(new Vector3(0, -index * 0.35, index * 0.23)));
      sheet.material = material;
      this.waterfallSheets.push({ mesh: sheet, baseY: sheet.position.y, phase: index * 1.8 });
    }

    const mistMaterial = this.material(`mist-${root.name}`, new Color3(0.78, 0.94, 1), new Color3(0.12, 0.18, 0.2));
    mistMaterial.alpha = 0.28;
    const mist = CreateIcoSphere(`${root.name}-mist`, { radius: width * 0.75, subdivisions: 2, flat: true }, this.scene);
    mist.parent = root;
    mist.position.copyFrom(position.add(new Vector3(0, -height * 0.52, 0)));
    mist.scaling.y = 0.28;
    mist.material = mistMaterial;
  }

  private addCity(root: TransformNode, count: number, radius: number): void {
    const buildingMaterials = [
      this.material("tower-midnight", new Color3(0.08, 0.13, 0.25), new Color3(0.025, 0.06, 0.16)),
      this.material("tower-cyan", new Color3(0.12, 0.3, 0.38), new Color3(0.02, 0.14, 0.18)),
      this.material("tower-violet", new Color3(0.22, 0.16, 0.38), new Color3(0.09, 0.035, 0.16)),
      this.material("tower-silver", new Color3(0.44, 0.5, 0.56), new Color3(0.04, 0.055, 0.07)),
    ];
    const neonMaterials = [
      this.material("neon-pink", new Color3(1, 0.16, 0.52), new Color3(1, 0.08, 0.38)),
      this.material("neon-blue", new Color3(0.1, 0.84, 1), new Color3(0.04, 0.66, 1)),
      this.material("neon-gold", new Color3(1, 0.68, 0.12), new Color3(0.9, 0.38, 0.04)),
    ];

    const facade = this.createFacadeTexture();
    for (const material of buildingMaterials) {
      material.diffuseTexture = facade;
      material.specularColor = new Color3(0.4, 0.45, 0.5);
    }
    const asphalt = this.material("asphalt", new Color3(0.12, 0.14, 0.16), Color3.Black());
    const concrete = this.material("sidewalk", new Color3(0.5, 0.51, 0.49), Color3.Black());
    const roadPaint = this.material("road-paint", new Color3(0.85, 0.79, 0.5), Color3.Black());
    const grid = Math.floor(Math.sqrt(count));
    const spacing = 48;
    const span = grid * spacing;
    for (let street = 0; street <= grid; street++) {
      const offset = (street - grid / 2) * spacing;
      for (let orientation = 0; orientation < 2; orientation++) {
        const road = CreateBox(`${root.name}-avenue`, { width: 16, height: 0.1, depth: span }, this.scene);
        road.parent = root;
        road.position.set(orientation ? 0 : offset, 0.76, orientation ? offset : 0);
        road.rotation.y = orientation * Math.PI / 2;
        road.material = asphalt;
        for (let dash = 0; dash < grid * 3; dash++) {
          const stripe = CreateBox("lane-marker", { width: 0.3, height: 0.02, depth: 5 }, this.scene);
          stripe.parent = road;
          stripe.position.set(0, 0.065, (dash - grid * 1.5) * 16 + 8);
          stripe.material = roadPaint;
        }
      }
    }

    for (let index = 0; index < count; index += 1) {
      const x = ((index % grid) - (grid - 1) / 2) * spacing;
      const z = (Math.floor(index / grid) - (grid - 1) / 2) * spacing;
      if (Math.hypot(x, z) > radius || Math.abs(x) < 1 || index % 23 === 0) continue;
      const width = 19 + this.random() * 9;
      const depth = 19 + this.random() * 9;
      const height = 22 + this.random() * 55 + Math.max(0, 1 - Math.hypot(x, z) / radius) * 95;
      const sidewalk = CreateBox("building-plinth", { width: 32, depth: 32, height: 0.3 }, this.scene);
      sidewalk.parent = root;
      sidewalk.position.set(x, 0.9, z);
      sidewalk.material = concrete;
      const faceUV = [width, width, depth, depth, 0, 0].map((w) => new Vector4(0, 0, w / 24, w ? height / 48 : 0));
      const building = CreateBox(`${root.name}-tower-${index}`, { width, depth, height, faceUV }, this.scene);
      building.parent = root;
      building.position.set(x, 1 + height / 2, z);
      building.material = buildingMaterials[index % buildingMaterials.length];

      const roof = CreateBox("rooftop-equipment", { width: width * 0.45, depth: depth * 0.6, height: 3 }, this.scene);
      roof.parent = root;
      roof.position.set(x, height + 2.5, z);
      roof.material = concrete;

      if (index % 2 === 0) {
        const crown = CreateBox(`${root.name}-neon-${index}`, { width: width * 0.78, height: 0.28, depth: depth * 1.03 }, this.scene);
        crown.parent = root;
        crown.position.set(building.position.x, building.position.y + height / 2 - 0.8, building.position.z);
        crown.rotation.y = building.rotation.y;
        crown.material = neonMaterials[index % neonMaterials.length];
      }
      if (index % 7 === 0) {
        const spire = CreateCylinder(`${root.name}-spire-${index}`, { diameterTop: 0, diameterBottom: 1, height: 16, tessellation: 6 }, this.scene);
        spire.parent = root;
        spire.position.set(building.position.x, height + 9, building.position.z);
        spire.material = neonMaterials[(index + 1) % neonMaterials.length];
      }
    }
  }

  private addGrove(root: TransformNode, count: number, radius: number): void {
    const trunkMaterial = this.material("tree-trunk", new Color3(0.3, 0.19, 0.11), new Color3(0.015, 0.008, 0.004));
    const leafMaterials = [
      this.material("leaves-jade", new Color3(0.12, 0.25, 0.12), new Color3(0.01, 0.02, 0.005)),
      this.material("leaves-light", new Color3(0.29, 0.38, 0.14), new Color3(0.01, 0.02, 0.005)),
      this.material("leaves-pine", new Color3(0.12, 0.21, 0.13), new Color3(0.01, 0.02, 0.005)),
    ];
    trunkMaterial.diffuseTexture = this.surfaceTexture("bark");
    for (const material of leafMaterials) material.diffuseTexture = this.surfaceTexture("foliage");
    const earth = this.material("forest-earth", new Color3(0.35, 0.28, 0.18), Color3.Black());
    earth.diffuseTexture = this.surfaceTexture("ground");
    const rockMaterial = this.material("moss-rock", new Color3(0.3, 0.32, 0.24), Color3.Black());
    // A gently winding dirt route connects the forest edge to the lake clearing.
    for (let z = -radius; z < radius - 15; z += 15) {
      if (Math.abs(z) < 105) continue;
      const from = new Vector3(Math.sin(z / 110) * 65, 0.76, z);
      const to = new Vector3(Math.sin((z + 15) / 110) * 65, 0.76, z + 15);
      const direction = to.subtract(from);
      const trail = CreateBox("forest-trail", { width: 13, height: 0.04, depth: direction.length() + 1 }, this.scene);
      trail.parent = root;
      trail.position.copyFrom(from.add(to).scale(0.5));
      trail.rotation.y = Math.atan2(direction.x, direction.z);
      trail.material = earth;
    }

    for (let index = 0; index < count; index += 1) {
      const angle = this.random() * Math.PI * 2;
      const distance = Math.sqrt(this.random()) * radius;
      const height = 10 + this.random() * 16;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      // Open central lake and a winding corridor wide enough to fly below the canopy.
      if (distance < 100 || Math.abs(x - Math.sin(z / 110) * 65) < 15) continue;
      const trunk = CreateCylinder(`${root.name}-trunk-${index}`, { diameterTop: 0.5, diameterBottom: 1.4, height, tessellation: 7 }, this.scene);
      trunk.parent = root;
      trunk.position.set(x, 0.7 + height / 2, z);
      trunk.material = trunkMaterial;
      if (index % 9 === 0) {
        const rock = CreateIcoSphere("forest-boulder", { radius: 1.5 + this.random() * 2, subdivisions: 2, flat: true }, this.scene);
        rock.parent = root;
        rock.position.set(x + 4, 1.2, z + 3);
        rock.scaling.set(1.3, 0.7, 0.85);
        rock.material = rockMaterial;
      }

      const crownRadius = 4 + this.random() * 4;
      for (let tier = 0; tier < 3; tier++) {
        const crown = index % 3 === 0
          ? CreateCylinder(`${root.name}-pine`, { diameterTop: 0, diameterBottom: crownRadius * (2 - tier * 0.35), height: 9, tessellation: 9 }, this.scene)
          : CreateIcoSphere(`${root.name}-canopy`, { radius: crownRadius * (1 - tier * 0.15), subdivisions: 2, flat: false }, this.scene);
        crown.parent = root;
        crown.position.set(x + (index % 3 ? Math.sin(tier * 3) * 3 : 0), height - 3 + tier * 4, z + (index % 3 ? Math.cos(tier * 3) * 3 : 0));
        crown.scaling.set(0.85 + this.random() * 0.3, 0.7 + this.random() * 0.3, 0.85 + this.random() * 0.3);
        crown.material = leafMaterials[index % leafMaterials.length];
        // Distant foliage keeps its silhouette with fewer polygons. These sources are
        // excluded from the main batch pass and attached to the corresponding batch.
        const distant = index % 3 === 0
          ? CreateCylinder("distant-pine", { diameterTop: 0, diameterBottom: crownRadius * (2 - tier * 0.35), height: 9, tessellation: 5 }, this.scene)
          : CreateIcoSphere("distant-canopy", { radius: crownRadius * (1 - tier * 0.15), subdivisions: 1, flat: false }, this.scene);
        distant.parent = root;
        distant.position.copyFrom(crown.position);
        distant.scaling.copyFrom(crown.scaling);
        distant.material = crown.material;
        distant.metadata = { canopyLOD: true };
        this.distantCanopies.set(crown, distant);
      }
    }
  }

  private addFloatingRocks(): void {
    const rockMaterial = this.material("floating-rock", new Color3(0.39, 0.33, 0.3), new Color3(0.012, 0.01, 0.01));
    const centers = [new Vector3(-1200, 50, 400), new Vector3(0, 5, 550), new Vector3(1550, 11, 700), new Vector3(550, 3, 2100)];
    for (const center of centers) {
      for (let index = 0; index < 7; index += 1) {
        const angle = this.random() * Math.PI * 2;
        const rock = CreateIcoSphere("floating-rock", { radius: 12 + this.random() * 22, subdivisions: 2, flat: true }, this.scene);
        rock.position.set(
          center.x + Math.cos(angle) * (650 + this.random() * 150),
          center.y - 80 - this.random() * 150,
          center.z + Math.sin(angle) * (650 + this.random() * 150),
        );
        rock.scaling.y = 1.4 + this.random();
        rock.rotation.set(this.random() * Math.PI, this.random() * Math.PI, this.random() * Math.PI);
        rock.material = rockMaterial;
        rock.freezeWorldMatrix();
      }
    }
  }

  private addClouds(): void {
    const cloudMaterial = this.material("clouds", new Color3(0.88, 0.94, 1), new Color3(0.09, 0.12, 0.15));
    const cloudPieces: Mesh[] = [];
    for (let cluster = 0; cluster < 26; cluster += 1) {
      const center = new Vector3(
        -2300 + this.random() * 5000,
        -250 + this.random() * 70,
        -700 + this.random() * 4500,
      );
      const pieceCount = 3 + Math.floor(this.random() * 4);
      for (let piece = 0; piece < pieceCount; piece += 1) {
        const cloud = CreateIcoSphere("cloud-piece", { radius: 60 + this.random() * 90, subdivisions: 2, flat: false }, this.scene);
        cloud.position.copyFrom(center.add(new Vector3((piece - pieceCount / 2) * 80, this.random() * 40, (this.random() - 0.5) * 90)));
        cloud.scaling.y = 0.45 + this.random() * 0.22;
        cloud.material = cloudMaterial;
        cloudPieces.push(cloud);
      }
    }
    Mesh.MergeMeshes(cloudPieces, true, true, undefined, false, true)?.freezeWorldMatrix();
  }

  private addFlightBoundary(): void {
    const boundary = CreateSphere("flight-boundary", {
      diameter: this.flightBounds.radius * 2,
      segments: 32,
      sideOrientation: Mesh.BACKSIDE,
    }, this.scene);
    boundary.position.copyFrom(this.flightBounds.center);
    boundary.isPickable = false;

    const material = new StandardMaterial("flight-boundary-material", this.scene);
    material.disableLighting = true;
    material.disableDepthWrite = true;
    material.backFaceCulling = false;
    material.wireframe = true;
    material.alpha = 0.045;
    material.emissiveColor = new Color3(0.18, 0.62, 0.9);
    boundary.material = material;
    boundary.freezeWorldMatrix();
  }

  private material(name: string, diffuse: Color3, emissive: Color3): StandardMaterial {
    const existing = this.scene.getMaterialByName(name);
    if (existing instanceof StandardMaterial) return existing;
    const material = new StandardMaterial(name, this.scene);
    material.diffuseColor = diffuse;
    material.emissiveColor = emissive;
    material.specularColor = Color3.Black();
    return material;
  }

  private createFacadeTexture(): Texture {
    const existing = this.scene.getTextureByName("city-facade");
    if (existing instanceof Texture) return existing;
    const data = new Uint8Array(64 * 128 * 4);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 64; x++) {
        const window = x % 8 > 1 && x % 8 < 7 && y % 8 > 1 && y % 8 < 7;
        const lit = (Math.floor(x / 8) * 17 + Math.floor(y / 8) * 13) % 7 < 2;
        const offset = (y * 64 + x) * 4;
        data.set(window ? (lit ? [230, 215, 170, 255] : [85, 130, 160, 255]) : [170, 175, 180, 255], offset);
      }
    }
    const texture = RawTexture.CreateRGBATexture(data, 64, 128, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    texture.name = "city-facade";
    texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
    return texture;
  }

  private surfaceTexture(kind: "ground" | "foliage" | "bark"): Texture {
    const existing = this.scene.getTextureByName(kind);
    if (existing instanceof Texture) return existing;
    const size = 128;
    const data = new Uint8Array(size * size * 4);
    const noise = (x: number, y: number) => {
      const hash = Math.imul(x + 31, 374761393) ^ Math.imul(y + 17, 668265263);
      return ((hash ^ (hash >>> 13)) >>> 0) / 4294967295;
    };
    const cloudNoise = (x: number, y: number, cell: number) => {
      const ix = Math.floor(x / cell);
      const iy = Math.floor(y / cell);
      const fx = x / cell - ix;
      const fy = y / cell - iy;
      const tx = fx * fx * (3 - 2 * fx);
      const ty = fy * fy * (3 - 2 * fy);
      const n = (a: number, b: number) => noise(a % (size / cell), b % (size / cell));
      const top = n(ix, iy) * (1 - tx) + n(ix + 1, iy) * tx;
      const bottom = n(ix, iy + 1) * (1 - tx) + n(ix + 1, iy + 1) * tx;
      return top * (1 - ty) + bottom * ty;
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const broad = cloudNoise(x, y, 32) * 0.65 + cloudNoise(x, y, 8) * 0.35;
      const fleck = noise(x, y);
      const shade = kind === "bark"
        ? 0.4 + 0.4 * noise(Math.floor(x / 3), Math.floor(y / 40)) + fleck * 0.2
        : 0.65 + broad * 0.3 + fleck * 0.05;
      const color = Math.round(255 * shade);
      data.set([color, color, kind === "ground" ? color * 0.84 : color, 255], (y * size + x) * 4);
    }
    const texture = RawTexture.CreateRGBATexture(data, size, size, this.scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
    texture.name = kind;
    texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
    texture.uScale = kind === "ground" ? 18 : 2;
    texture.vScale = kind === "ground" ? 18 : 2;
    return texture;
  }

  private random(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
}
