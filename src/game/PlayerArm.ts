import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { CreateSphere } from "@babylonjs/core/Meshes/Builders/sphereBuilder";
import { CreateLathe } from "@babylonjs/core/Meshes/Builders/latheBuilder";
import { CreateCapsule } from "@babylonjs/core/Meshes/Builders/capsuleBuilder";
import type { Scene } from "@babylonjs/core/scene";

/** Controller-anchored hands with anatomically shaped, inferred two-bone arms. */
export class PlayerArm {
  /** WebXR grip axes, after Babylon's RH-to-LH conversion.
   * https://www.w3.org/TR/webxr/#dom-xrinputsource-gripspace
   * Grip +Z points toward the thumb; +/-X points out of the back of the hand.
   * Our sculpt uses +Y for the hand's back and +Z for the knuckles.
   */
  static rotationFromGrip(grip: Quaternion, left: boolean): Quaternion {
    const mirror = left ? 1 : -1;
    const alignment = Quaternion.RotationQuaternionFromAxis(
      new Vector3(0, 0, mirror), new Vector3(-mirror, 0, 0), new Vector3(0, -1, 0),
    );
    return grip.multiply(alignment);
  }

  readonly root: TransformNode;
  private readonly upper: Mesh;
  private readonly lower: Mesh;
  private readonly elbow: Mesh;
  private readonly fist: TransformNode;
  private readonly material: StandardMaterial;
  private readonly sleeveMaterial: StandardMaterial;

  constructor(scene: Scene, rig: TransformNode, id: string, left: boolean) {
    this.root = new TransformNode(`arm-${id}`, scene);
    this.root.parent = rig;
    this.material = new StandardMaterial(`skin-${id}`, scene);
    this.material.diffuseColor = new Color3(0.62, 0.39, 0.27);
    this.material.specularColor = new Color3(0.085, 0.065, 0.055);
    this.material.specularPower = 24;
    this.sleeveMaterial = new StandardMaterial(`sleeve-${id}`, scene);
    this.sleeveMaterial.diffuseColor = new Color3(0.065, 0.085, 0.11);
    this.sleeveMaterial.specularColor = new Color3(0.04, 0.04, 0.04);
    const sphere = (name: string, size: Vector3, parent: TransformNode) => {
      const mesh = CreateSphere(`${id}-${name}`, { diameter: 1, segments: 16 }, scene);
      mesh.scaling.copyFrom(size);
      mesh.parent = parent;
      mesh.material = this.material;
      mesh.isPickable = false;
      return mesh;
    };
    // Radius profiles run from shoulder/elbow (-Y) toward elbow/wrist (+Y).
    // Muscle bellies and narrow joints replace the old constant-width tubes.
    const segment = (name: string, profile: number[]) => {
      const mesh = CreateLathe(`${id}-${name}`, {
        shape: profile.map((radius, i) => new Vector3(radius, i / (profile.length - 1) - 0.5, 0)),
        tessellation: 24,
        cap: Mesh.CAP_ALL,
      }, scene);
      mesh.parent = this.root;
      mesh.material = this.material;
      mesh.isPickable = false;
      mesh.rotationQuaternion = Quaternion.Identity();
      return mesh;
    };
    this.upper = segment("upper-arm", [0.046, 0.055, 0.06, 0.061, 0.059, 0.056, 0.052, 0.047, 0.042, 0.037, 0.034]);
    this.upper.scaling.z = 0.88;
    this.lower = segment("forearm", [0.034, 0.039, 0.045, 0.047, 0.046, 0.043, 0.039, 0.035, 0.031, 0.028, 0.027]);
    this.lower.scaling.z = 0.8;
    this.elbow = sphere("elbow", new Vector3(0.067, 0.065, 0.066), this.root);

    const sleeve = segment("short-sleeve", [0.048, 0.057, 0.063, 0.064, 0.063, 0.061]);
    sleeve.parent = this.upper;
    sleeve.position.y = -0.27;
    sleeve.scaling.y = 0.46;
    sleeve.material = this.sleeveMaterial;

    this.fist = new TransformNode(`fist-${id}`, scene);
    this.fist.parent = this.root;
    this.fist.rotationQuaternion = Quaternion.Identity();
    // Grip origin sits inside the palm, not at the end of an oversized ball.
    // +Z is the fist's forward axis; the curled fingers wrap below its back.
    const palm = sphere("palm", Vector3.One(), this.fist);
    const positions = palm.getVerticesData(VertexBuffer.PositionKind)!;
    // A flattened, rounded hand volume widens from the wrist into the knuckles.
    // One continuous surface avoids visible ball joints and glued-on tendons.
    const rounded = (value: number, exponent: number) => Math.sign(value) * Math.abs(value) ** exponent;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] * 2;
      const y = positions[i + 1] * 2;
      const z = positions[i + 2] * 2;
      const along = (z + 1) * 0.5;
      const width = 0.026 + 0.015 * Math.sin(along * Math.PI * 0.65);
      positions[i] = rounded(x, 0.72) * width;
      positions[i + 1] = rounded(y, 0.65) * 0.022 - 0.002;
      positions[i + 2] = rounded(z, 0.8) * 0.063 - 0.022;
    }
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, palm.getIndices()!, normals);
    palm.setVerticesData(VertexBuffer.PositionKind, positions);
    palm.setVerticesData(VertexBuffer.NormalKind, normals);
    const bone = (name: string, from: Vector3, to: Vector3, radius: number, endRadius = radius) => {
      const direction = to.subtract(from);
      const mesh = CreateCapsule(`${id}-${name}`, {
        height: direction.length() + radius + endRadius,
        radiusBottom: radius, radiusTop: endRadius,
        tessellation: 12, capSubdivisions: 4, subdivisions: 1,
      }, scene);
      mesh.parent = this.fist;
      mesh.material = this.material;
      mesh.isPickable = false;
      mesh.position.copyFrom(from.add(to).scale(0.5));
      mesh.rotationQuaternion = Quaternion.Identity();
      Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction.normalize(), mesh.rotationQuaternion);
      return mesh;
    };
    const mirror = left ? 1 : -1;
    for (let i = 0; i < 4; i++) {
      // Index through little finger: staggered heights and lengths, not a row of beads.
      const x = mirror * (0.028 - i * 0.018);
      const z = [0.035, 0.041, 0.036, 0.024][i];
      const radius = [0.0105, 0.0108, 0.0101, 0.0088][i];
      const knuckle = new Vector3(x, 0.008 - i * 0.001, z);
      const curl = new Vector3(x, -0.015, z + 0.012);
      const fold = new Vector3(x, -0.038, z - 0.004);
      const tip = new Vector3(x, -0.032, z - 0.024);
      bone(`finger-${i}-proximal`, knuckle, curl, radius);
      bone(`finger-${i}-middle`, curl, fold, radius, radius * 0.9);
      bone(`finger-${i}-tip`, fold, tip, radius * 0.9, radius * 0.8);
    }
    sphere("thumb-base", new Vector3(0.03, 0.032, 0.045), this.fist).position.set(mirror * 0.026, -0.013, -0.015);
    bone("thumb-proximal", new Vector3(mirror * 0.033, -0.015, -0.02), new Vector3(mirror * 0.039, -0.03, 0.008), 0.0115, 0.0105);
    bone("thumb-distal", new Vector3(mirror * 0.039, -0.03, 0.008), new Vector3(mirror * 0.015, -0.038, 0.028), 0.0105, 0.009);

    // The hand is rigidly tracked. Merge its anatomical pieces once, retaining a
    // single draw call per hand rather than dozens of tiny finger submissions.
    // Merge in hand-local space, not the flight rig's translated world space.
    this.fist.parent = null;
    const hand = Mesh.MergeMeshes(this.fist.getChildMeshes() as Mesh[], true, true);
    if (hand) {
      hand.name = `${id}-closed-hand`;
      hand.parent = this.fist;
      hand.isPickable = false;
    }
    this.fist.parent = this.root;
    this.root.setEnabled(false);
  }

  update(shoulder: Vector3, grip: Vector3, rotation: Quaternion, pole: Vector3): void {
    this.root.setEnabled(true);
    const wristOffset = new Vector3(0, 0, -0.06);
    wristOffset.rotateByQuaternionToRef(rotation, wristOffset);
    const wrist = grip.add(wristOffset);
    const axis = wrist.subtract(shoulder);
    const distance = axis.length();
    axis.scaleInPlace(1 / Math.max(distance, 0.00001));
    let bend = pole.subtract(axis.scale(Vector3.Dot(pole, axis)));
    if (bend.lengthSquared() < 0.0001) {
      bend = Vector3.Cross(axis, Math.abs(axis.y) < 0.9 ? Vector3.Up() : Vector3.Forward());
    }
    // Equal bone lengths yield a stable elbow on the circle between shoulder and wrist.
    // Allow visual extension for players whose reach exceeds the default estimate.
    const boneLength = Math.max(0.34, distance * 0.501);
    const bendDistance = Math.sqrt(Math.max(0, boneLength ** 2 - (distance * 0.5) ** 2));
    const elbow = shoulder.add(wrist).scale(0.5).add(bend.normalize().scale(bendDistance));
    this.elbow.position.copyFrom(elbow);
    this.fitSegment(this.upper, shoulder, elbow);
    this.fitSegment(this.lower, elbow, wrist);
    // Keep the forearm's oval cross-section aligned with the wrist's roll.
    const dorsal = Vector3.Up();
    dorsal.rotateByQuaternionToRef(rotation, dorsal);
    const forearmAxis = wrist.subtract(elbow).normalize();
    const lateral = Vector3.Cross(forearmAxis, dorsal);
    if (lateral.lengthSquared() > 0.0001) {
      lateral.normalize();
      this.lower.rotationQuaternion!.copyFrom(Quaternion.RotationQuaternionFromAxis(
        lateral, forearmAxis, Vector3.Cross(lateral, forearmAxis).normalize(),
      ));
    }
    this.fist.position.copyFrom(grip);
    this.fist.rotationQuaternion!.copyFrom(rotation);
  }

  private fitSegment(mesh: Mesh, from: Vector3, to: Vector3): void {
    const direction = to.subtract(from);
    mesh.position.copyFrom(from.add(to).scale(0.5));
    mesh.scaling.y = Math.max(direction.length(), 0.001);
    Quaternion.FromUnitVectorsToRef(Vector3.Up(), direction.normalize(), mesh.rotationQuaternion!);
  }

  dispose(): void {
    this.root.dispose();
    this.material.dispose();
    this.sleeveMaterial.dispose();
  }
}
