import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateCylinder } from "@babylonjs/core/Meshes/Builders/cylinderBuilder";
import { CreateIcoSphere } from "@babylonjs/core/Meshes/Builders/icoSphereBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import type { Scene } from "@babylonjs/core/scene";

interface WaterfallSheet {
  mesh: Mesh;
  baseY: number;
  phase: number;
}

export class SkyWorld {
  private readonly waterfallSheets: WaterfallSheet[] = [];
  private seed = 7331;

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

  get startPosition(): Vector3 { return new Vector3(0, 24, -24); }
  get startDirection(): Vector3 { return new Vector3(0, 0.04, 1).normalize(); }

  private buildWorld(): void {
    const waterfallIsland = this.createIsland("azure-falls", new Vector3(-27, 8, 66), 38, 24, "lush");
    this.addCrystalPool(waterfallIsland, new Vector3(-4, 0.7, 2), 13);
    this.addWaterfall(waterfallIsland, new Vector3(-17, -9, 2), 8, 20);
    this.addGrove(waterfallIsland, 10, 12);

    const cityIsland = this.createIsland("neon-city", new Vector3(64, 5, 148), 48, 28, "city");
    this.addCity(cityIsland, 27, 19);

    const groveIsland = this.createIsland("quiet-grove", new Vector3(124, 11, 106), 40, 24, "lush");
    this.addGrove(groveIsland, 28, 16);
    this.addCrystalPool(groveIsland, new Vector3(5, 0.7, -4), 9);

    const harborIsland = this.createIsland("sky-harbor", new Vector3(145, 3, 56), 34, 22, "city");
    this.addCity(harborIsland, 16, 13);
    this.addWaterfall(harborIsland, new Vector3(14, -8, -2), 5, 17);

    const gardenIsland = this.createIsland("little-garden", new Vector3(23, 15, 122), 25, 17, "lush");
    this.addGrove(gardenIsland, 12, 9);

    this.addFloatingRocks();
    this.addClouds();
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
      tessellation: 9,
      subdivisions: 1,
    }, this.scene);
    cliff.parent = root;
    cliff.position.y = -depth / 2;
    cliff.rotation.y = this.random() * Math.PI;
    cliff.scaling.z = 0.82 + this.random() * 0.22;
    cliff.material = this.material("sunlit-cliff", new Color3(0.46, 0.36, 0.29), new Color3(0.025, 0.02, 0.015));

    const top = CreateCylinder(`${name}-top`, {
      diameter: diameter * 0.97,
      height: 0.9,
      tessellation: 9,
    }, this.scene);
    top.parent = root;
    top.position.y = 0.25;
    top.rotation.y = cliff.rotation.y;
    top.scaling.z = cliff.scaling.z;
    top.material = style === "lush"
      ? this.material("island-grass", new Color3(0.18, 0.52, 0.31), new Color3(0.015, 0.05, 0.025))
      : this.material("city-ground", new Color3(0.27, 0.32, 0.38), new Color3(0.025, 0.035, 0.05));
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
    rim.rotation.x = Math.PI / 2;
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

    for (let index = 0; index < count; index += 1) {
      const angle = this.random() * Math.PI * 2;
      const distance = Math.sqrt(this.random()) * radius;
      const width = 2.2 + this.random() * 3.4;
      const depth = 2.2 + this.random() * 3.4;
      const height = 6 + this.random() * 20;
      const building = CreateBox(`${root.name}-tower-${index}`, { width, depth, height }, this.scene);
      building.parent = root;
      building.position.set(Math.cos(angle) * distance, 0.7 + height / 2, Math.sin(angle) * distance);
      building.rotation.y = Math.round(this.random() * 4) * Math.PI / 2 + (this.random() - 0.5) * 0.16;
      building.material = buildingMaterials[index % buildingMaterials.length];

      if (index % 2 === 0) {
        const crown = CreateBox(`${root.name}-neon-${index}`, { width: width * 0.78, height: 0.28, depth: depth * 1.03 }, this.scene);
        crown.parent = root;
        crown.position.set(building.position.x, building.position.y + height / 2 - 0.8, building.position.z);
        crown.rotation.y = building.rotation.y;
        crown.material = neonMaterials[index % neonMaterials.length];
      }
      if (index % 7 === 0) {
        const spire = CreateCylinder(`${root.name}-spire-${index}`, { diameterTop: 0, diameterBottom: 0.35, height: 5, tessellation: 6 }, this.scene);
        spire.parent = root;
        spire.position.set(building.position.x, 0.7 + height + 2.5, building.position.z);
        spire.material = neonMaterials[(index + 1) % neonMaterials.length];
      }
    }
  }

  private addGrove(root: TransformNode, count: number, radius: number): void {
    const trunkMaterial = this.material("tree-trunk", new Color3(0.3, 0.19, 0.11), new Color3(0.015, 0.008, 0.004));
    const leafMaterials = [
      this.material("leaves-jade", new Color3(0.08, 0.45, 0.28), new Color3(0.01, 0.07, 0.025)),
      this.material("leaves-light", new Color3(0.22, 0.62, 0.31), new Color3(0.025, 0.09, 0.025)),
      this.material("leaves-pine", new Color3(0.06, 0.31, 0.24), new Color3(0.008, 0.05, 0.03)),
    ];

    for (let index = 0; index < count; index += 1) {
      const angle = this.random() * Math.PI * 2;
      const distance = Math.sqrt(this.random()) * radius;
      const height = 2.4 + this.random() * 2.6;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const trunk = CreateCylinder(`${root.name}-trunk-${index}`, { diameter: 0.42, height, tessellation: 6 }, this.scene);
      trunk.parent = root;
      trunk.position.set(x, 0.7 + height / 2, z);
      trunk.material = trunkMaterial;

      const crown = CreateIcoSphere(`${root.name}-crown-${index}`, { radius: 1.3 + this.random() * 0.8, subdivisions: 1, flat: true }, this.scene);
      crown.parent = root;
      crown.position.set(x, 0.7 + height + 0.7, z);
      crown.scaling.y = 1.1 + this.random() * 0.55;
      crown.material = leafMaterials[index % leafMaterials.length];
    }
  }

  private addFloatingRocks(): void {
    const rockMaterial = this.material("floating-rock", new Color3(0.39, 0.33, 0.3), new Color3(0.012, 0.01, 0.01));
    const centers = [new Vector3(-27, 8, 66), new Vector3(64, 5, 148), new Vector3(124, 11, 106), new Vector3(145, 3, 56)];
    for (const center of centers) {
      for (let index = 0; index < 7; index += 1) {
        const angle = this.random() * Math.PI * 2;
        const rock = CreateIcoSphere("floating-rock", { radius: 1.1 + this.random() * 2.2, subdivisions: 1, flat: true }, this.scene);
        rock.position.set(
          center.x + Math.cos(angle) * (22 + this.random() * 15),
          center.y - 8 - this.random() * 19,
          center.z + Math.sin(angle) * (22 + this.random() * 15),
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
        -190 + this.random() * 500,
        -22 + this.random() * 18 + (cluster % 7 === 0 ? 58 : 0),
        -70 + this.random() * 360,
      );
      const pieceCount = 3 + Math.floor(this.random() * 4);
      for (let piece = 0; piece < pieceCount; piece += 1) {
        const cloud = CreateIcoSphere("cloud-piece", { radius: 6 + this.random() * 9, subdivisions: 2, flat: true }, this.scene);
        cloud.position.copyFrom(center.add(new Vector3((piece - pieceCount / 2) * 8, this.random() * 4, (this.random() - 0.5) * 9)));
        cloud.scaling.y = 0.45 + this.random() * 0.22;
        cloud.material = cloudMaterial;
        cloudPieces.push(cloud);
      }
    }
    Mesh.MergeMeshes(cloudPieces, true, true, undefined, false, true)?.freezeWorldMatrix();
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

  private random(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return (this.seed - 1) / 2147483646;
  }
}
