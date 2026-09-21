import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import type { FlightTelemetry, GameSettings } from "./types";
import { combinedRoll, handBankAngle, headBankAngle } from "./VRRoll";
import { RollController } from "./RollController";

interface Intent {
  throttle: number;
  brake: number;
  yaw: number;
  pitch: number;
  aimYaw?: number;
  aimPitch?: number;
  roll?: number;
  stunt?: number;
  freeLook?: boolean;
  lookYaw?: number;
  lookPitch?: number;
  hover?: boolean;
  gestureStunts?: boolean;
  allowFullRolls?: boolean;
}

export interface XRFlightIntent {
  active: boolean;
  throttle: number;
  direction: Vector3;
  /** Signed roll gesture: right positive, independent of translation. */
  roll?: number;
}

export interface XRControllerPose {
  position: Vector3;
  handedness: "left" | "right" | "none";
}

export interface FlightBounds {
  center: Vector3;
  radius: number;
}

export interface FlightCollision {
  displacement: Vector3;
  normal: Vector3;
  speedScale: number;
}

export type FlightCollisionResolver = (position: Vector3, displacement: Vector3) => FlightCollision | null;

const SHOULDER_WIDTH = 0.36;
const SHOULDER_DROP = 0.18;
const smoothstep = (value: number) => {
  const t = Scalar.Clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

export class FlightController {
  private speed = 0;
  private throttle = 0;
  private yawRate = 0;
  private pitchRate = 0;
  private lastSpeed = 0;
  private neutralHeadRotation: Quaternion | null = null;
  private rollRate = 0;
  private neutralHandBank = 0;
  private readonly rollControl = new RollController();
  private rollReferenceUp = Vector3.Up();
  private xrBank = 0;
  private desktopYaw = 0;
  private desktopPitch = 0;
  private desktopHeading = Quaternion.Identity();
  private desktopBank = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private restDirections = new Map<string, Vector3>();
  private armLengths = new Map<string, number>();
  private flightDirection = Vector3.Forward();

  constructor(
    private readonly rig: TransformNode,
    private camera: TargetCamera,
    private readonly settings: GameSettings,
    private readonly bounds?: FlightBounds,
    private readonly resolveCollision?: FlightCollisionResolver,
  ) {
    this.rig.rotationQuaternion = Quaternion.Identity();
  }

  setCamera(camera: TargetCamera): void {
    this.camera = camera;
    this.neutralHeadRotation = null;
    this.rollControl.reset();
  }

  /** Records the no-thrust/rest pose. Reach is measured deliberately in a second step. */
  calibrateHover(controllers: ReadonlyArray<XRControllerPose> = []): void {
    const rotation = this.camera.rotationQuaternion;
    this.neutralHeadRotation = rotation ? rotation.clone() : Quaternion.FromEulerAngles(
      this.camera.rotation.x,
      this.camera.rotation.y,
      this.camera.rotation.z,
    );
    this.rollRate = 0;
    this.rollControl.reset();
    Vector3.Up().rotateByQuaternionToRef(this.rig.rotationQuaternion!.multiply(this.neutralHeadRotation), this.rollReferenceUp);
    this.xrBank = 0;
    this.neutralHandBank = 0;
    this.restDirections.clear();
    this.armLengths.clear();
    for (const controller of controllers) {
      const arm = controller.position.subtract(this.getShoulderPosition(controller.handedness));
      if (arm.length() < 0.25) continue;
      this.restDirections.set(controller.handedness, arm.normalize());
    }
    this.speed = 0;
    this.lastSpeed = 0;
  }

  /**
   * Stores the player's real, controller-to-shoulder reach while their arm is fully
   * extended in front. A held-down arm is deliberately rejected as a max-speed pose.
   */
  calibrateFullReach(controllers: ReadonlyArray<XRControllerPose>): number {
    let captured = 0;
    const capturedHands = new Map<string, Vector3>();
    for (const controller of controllers) {
      const arm = controller.position.subtract(this.getShoulderPosition(controller.handedness));
      const length = arm.length();
      if (length < 0.3) continue;
      const direction = arm.scale(1 / length);
      const rest = this.restDirections.get(controller.handedness);
      // Require a meaningfully lifted pose so a second accidental A/X press at rest
      // cannot turn the user's side-arm length into their flight range.
      if (rest && Vector3.Dot(direction, rest) > 0.7) continue;
      this.armLengths.set(controller.handedness, Scalar.Clamp(length, 0.35, 1.15));
      capturedHands.set(controller.handedness, controller.position);
      captured++;
    }
    const left = capturedHands.get("left");
    const right = capturedHands.get("right");
    if (left && right) this.neutralHandBank = handBankAngle(left, right, this.neutralHeadRotation ?? Quaternion.Identity());
    return captured;
  }

  /** Compatibility helper for desktop and test setup: capture hover and any supplied reach. */
  calibrate(controllers: ReadonlyArray<XRControllerPose> = []): void {
    this.calibrateHover(controllers);
    if (controllers.length) {
      // Existing one-step callers may intentionally provide an already raised pose.
      for (const controller of controllers) {
        const arm = controller.position.subtract(this.getShoulderPosition(controller.handedness));
        if (arm.length() >= 0.25) this.armLengths.set(controller.handedness, Scalar.Clamp(arm.length(), 0.35, 1.15));
      }
    }
  }

  reset(position: Vector3, direction: Vector3): void {
    this.rig.position.copyFrom(position);
    const yaw = Math.atan2(direction.x, direction.z);
    const horizontal = Math.sqrt(direction.x ** 2 + direction.z ** 2);
    const pitch = -Math.atan2(direction.y, horizontal);
    this.rig.rotationQuaternion = Quaternion.FromEulerAngles(pitch, yaw, 0);
    this.desktopYaw = yaw;
    this.desktopPitch = pitch;
    this.desktopHeading.copyFrom(this.rig.rotationQuaternion);
    this.desktopBank = this.lookYaw = this.lookPitch = 0;
    this.rollReferenceUp = Vector3.Up();
    this.xrBank = 0;
    this.rollControl.reset();
    this.rollRate = 0;
    this.neutralHandBank = 0;
    this.restDirections.clear();
    this.armLengths.clear();
    Vector3.Forward().rotateByQuaternionToRef(this.rig.rotationQuaternion, this.flightDirection);
    this.speed = 0;
    this.throttle = 0;
    this.yawRate = 0;
    this.pitchRate = 0;
    this.lastSpeed = 0;
  }

  update(deltaSeconds: number, desktopIntent: Intent, gamepad?: Gamepad, xrIntent?: XRFlightIntent): FlightTelemetry {
    const dt = Math.min(deltaSeconds, 0.05);
    if (xrIntent) return this.updateXRFlight(dt, xrIntent);
    const intent = this.mergeIntent(desktopIntent, gamepad);

    // Desktop has its own speed envelope; do not raise headset speeds implicitly.
    const maxSpeed = this.settings.comfortMode ? 100 : 160;
    const maxYaw = this.settings.comfortMode ? 1.15 : 1.6;
    const maxPitch = this.settings.comfortMode ? 0.8 : 1.1;

    const exactHover = intent.hover === true;
    const requestedThrottle = Scalar.Clamp(intent.throttle, 0, 1);
    this.throttle = exactHover ? 0 : Scalar.Lerp(this.throttle, requestedThrottle, 1 - Math.exp(-dt * 7));
    const targetSpeed = intent.brake > 0.1
      ? 0
      : maxSpeed * this.throttle;
    const speedResponse = targetSpeed > this.speed ? 5 : 18;
    this.speed = exactHover ? 0 : Scalar.Lerp(this.speed, targetSpeed, 1 - Math.exp(-dt * speedResponse));
    if (targetSpeed === 0 && this.speed < 0.05) this.speed = 0;

    const requestedYaw = Scalar.Clamp(intent.yaw, -1, 1) * maxYaw;
    const requestedPitch = Scalar.Clamp(intent.pitch, -1, 1) * maxPitch;
    this.yawRate = exactHover ? 0 : Scalar.Lerp(this.yawRate, requestedYaw, 1 - Math.exp(-dt * 8));
    this.pitchRate = exactHover ? 0 : Scalar.Lerp(this.pitchRate, requestedPitch, 1 - Math.exp(-dt * 8));

    this.desktopYaw += this.yawRate * dt + (intent.aimYaw ?? 0);
    this.desktopPitch = Scalar.Clamp(this.desktopPitch + this.pitchRate * dt + (intent.aimPitch ?? 0), -Math.PI * 0.495, Math.PI * 0.495);
    Quaternion.SlerpToRef(this.desktopHeading, Quaternion.FromEulerAngles(this.desktopPitch, this.desktopYaw, 0), 1 - Math.exp(-dt * 25), this.desktopHeading);
    const rollDelta = this.rollControl.update(dt, this.desktopBank, intent.roll ?? 0, {
      active: !exactHover && intent.brake <= 0.1, mode: this.settings.rollMode ?? "assisted", comfort: this.settings.comfortMode,
      fullRolls: this.settings.fullRolls !== false && intent.allowFullRolls !== false,
      gestureStunts: intent.gestureStunts === true, stunt: intent.stunt,
    });
    this.desktopBank = Math.atan2(Math.sin(this.desktopBank + rollDelta), Math.cos(this.desktopBank + rollDelta));
    this.rig.rotationQuaternion = this.desktopHeading.multiply(Quaternion.RotationAxis(Vector3.Forward(), -this.desktopBank));
    if (intent.freeLook) {
      this.lookYaw = Scalar.Clamp(this.lookYaw + (intent.lookYaw ?? 0), -Math.PI * 0.9, Math.PI * 0.9);
      this.lookPitch = Scalar.Clamp(this.lookPitch + (intent.lookPitch ?? 0), -1.3, 1.3);
    } else {
      this.lookYaw *= Math.exp(-dt * 12); this.lookPitch *= Math.exp(-dt * 12);
    }
    this.camera.rotationQuaternion = Quaternion.FromEulerAngles(this.lookPitch, this.lookYaw, 0);

    const forward = Vector3.Zero();
    Vector3.Forward().rotateByQuaternionToRef(this.desktopHeading, forward);
    this.moveWithinBounds(forward.scale(this.speed * dt));

    const acceleration = Math.abs(this.speed - this.lastSpeed) / Math.max(dt, 0.001);
    this.lastSpeed = this.speed;
    return {
      speed: this.speed,
      speedRatio: this.speed / maxSpeed,
      turnIntensity: Scalar.Clamp(Math.max((Math.abs(this.yawRate) + Math.abs(this.pitchRate)) / (maxYaw + maxPitch), Math.abs(rollDelta) / Math.max(dt, 0.001)), 0, 1),
      accelerationIntensity: Scalar.Clamp(acceleration / 9, 0, 1),
    };
  }

  getShoulderPosition(handedness: XRControllerPose["handedness"]): Vector3 {
    const side = handedness === "left" ? -1 : handedness === "right" ? 1 : 0;
    const offset = new Vector3(side * SHOULDER_WIDTH / 2, -SHOULDER_DROP, 0);
    const rotated = Vector3.Zero();
    offset.rotateByQuaternionToRef(this.neutralHeadRotation ?? Quaternion.Identity(), rotated);
    return this.camera.position.add(rotated);
  }

  createXRIntent(controllers: ReadonlyArray<XRControllerPose>): XRFlightIntent {
    // XR camera and controller positions share the flight rig's local tracking space.
    // Approximate each shoulder from the calibrated head pose so the control vector is
    // the user's arm direction, rather than the wrist-dependent controller pointing ray.
    const defaultRest = Vector3.Zero();
    new Vector3(0, -1, 0).rotateByQuaternionToRef(this.neutralHeadRotation ?? Quaternion.Identity(), defaultRest);

    const activeArms = controllers
      .slice(0, 2)
      .map((controller) => {
        const arm = controller.position.subtract(this.getShoulderPosition(controller.handedness));
        const extension = arm.length();
        const heading = arm.scale(1 / Math.max(extension, 0.0001));
        const rest = this.restDirections.get(controller.handedness) ?? defaultRest;
        const liftAngle = Math.acos(Scalar.Clamp(Vector3.Dot(heading, rest), -1, 1));
        // Until a deliberate reach calibration completes, retain a conservative
        // fallback. Once captured, full speed maps to this user's actual arm length.
        const fullReach = this.armLengths.get(controller.handedness) ?? 0.65;
        // Resting straight arms have full length too. Lift away from the recorded rest
        // pose AND extension determine thrust; there is no minimum moving speed.
        // Forward does not need to be an exact 90-degree departure from the recorded
        // side pose. Shoulder anatomy, controller grip position and a slightly prone
        // hover pose all make that unreliable. Treat roughly 60 degrees as fully raised.
        const lift = smoothstep((liftAngle - 0.08) / (Math.PI / 3 - 0.08));
        // XR grip/shoulder estimates routinely under-report physical reach. Calibrated
        // players therefore enter a forgiving full-reach plateau at 86% of the captured
        // length instead of having to exceed a single exact sample every frame.
        const fullSpeedReach = Math.max(0.32, fullReach * 0.86);
        const reach = smoothstep((extension - 0.18) / (fullSpeedReach - 0.18));
        return {
          controller,
          heading,
          thrust: lift * reach,
        };
      })
      .filter((arm) => arm.thrust > 0);

    if (!activeArms.length) {
      return { active: false, throttle: 0, direction: this.flightDirection.clone() };
    }

    const throttle = activeArms.reduce((total, arm) => total + arm.thrust * 0.5, 0);

    // Every tracked frame replaces the requested heading. For two-arm flight, average
    // the arm directions, with a modest reach weight so a clearly extended arm wins over
    // a hand that is only just leaving the shoulder.
    const localDirection = activeArms
      .reduce(
        (combined, arm) => combined.addInPlace(arm.heading.scale(arm.thrust)),
        Vector3.Zero(),
      );
    if (localDirection.lengthSquared() < 1e-12) {
      return { active: false, throttle: 0, direction: this.flightDirection.clone() };
    }
    const direction = Vector3.Zero();
    // Exactly the same tracking-to-world rotation used to render the hands. Applying
    // inverse head calibration here alone makes flight disagree with visible arms.
    localDirection.normalize().rotateByQuaternionToRef(this.rig.rotationQuaternion!, direction);
    const left = activeArms.find((arm) => arm.controller.handedness === "left");
    const right = activeArms.find((arm) => arm.controller.handedness === "right");
    let roll = 0;
    if (left && right && left.thrust > 0.1 && right.thrust > 0.1 && Vector3.Dot(left.heading, right.heading) > 0.5) {
      const body = this.neutralHeadRotation ?? Quaternion.Identity();
      const head = this.camera.rotationQuaternion ?? Quaternion.FromEulerAngles(this.camera.rotation.x, this.camera.rotation.y, this.camera.rotation.z);
      roll = combinedRoll(headBankAngle(head, body), handBankAngle(left.controller.position, right.controller.position, body) - this.neutralHandBank);
    }
    return {
      active: true,
      throttle,
      direction: direction.normalize(),
      roll,
    };
  }

  private updateXRFlight(dt: number, intent: XRFlightIntent): FlightTelemetry {
    // Both modes retain the same arm mapping; comfort changes the speed envelope.
    // The unrestricted value is intentionally superhero-fast.
    const maxSpeed = this.settings.comfortMode ? 70 : 140;
    const targetSpeed = intent.active ? maxSpeed * intent.throttle : 0;
    const response = targetSpeed > this.speed ? 8 : 18;
    this.speed = intent.active
      ? Scalar.Lerp(this.speed, targetSpeed, 1 - Math.exp(-dt * response))
      : 0;
    this.throttle = intent.throttle;

    let directionTurn = 0;
    if (intent.active && intent.direction.lengthSquared() > 0.001) {
      const desiredDirection = intent.direction.clone().normalize();
      directionTurn = Math.acos(Scalar.Clamp(Vector3.Dot(this.flightDirection, desiredDirection), -1, 1));
      // One short spherical response (95% in 120 ms), without a second velocity filter.
      // A quaternion arc also handles complete reversals without a zero-vector stall.
      if (this.lastSpeed < 0.01 || directionTurn < 0.0001) {
        this.flightDirection.copyFrom(desiredDirection);
      } else {
        let axis = Vector3.Cross(this.flightDirection, desiredDirection);
        if (axis.lengthSquared() < 1e-8) {
          axis = Vector3.Cross(this.flightDirection, Math.abs(this.flightDirection.y) < 0.9 ? Vector3.Up() : Vector3.Right());
        }
        const turn = Quaternion.RotationAxis(axis.normalize(), directionTurn * (1 - Math.exp(-25 * dt)));
        this.flightDirection.rotateByQuaternionToRef(turn, this.flightDirection);
        this.flightDirection.normalize();
      }
    }

    const requestedRoll = intent.active ? Scalar.Clamp(intent.roll ?? 0, -1, 1) : 0;
    const axis = intent.active && intent.direction.lengthSquared() > 0.001 ? intent.direction.normalizeToNew() : this.flightDirection.normalizeToNew();
    const bank = this.measureBank(axis) ?? this.xrBank;
    const rollDelta = this.rollControl.update(dt, bank, requestedRoll, {
      active: intent.active, mode: "assisted", comfort: this.settings.comfortMode,
      fullRolls: false, gestureStunts: false,
    });
    this.xrBank = Math.atan2(Math.sin(bank + rollDelta), Math.cos(bank + rollDelta));
    this.rollRate = dt > 0 ? rollDelta / dt : 0;
    if (rollDelta !== 0) {
      // Rotate about the requested arm direction, which leaves that direction intact.
      // Sample the next frame's head/hands in tracking space so the generated roll
      // cannot feed back into the gesture and accelerate itself.
      const roll = Quaternion.RotationAxis(axis, -rollDelta);
      const before = Vector3.Zero();
      this.camera.position.rotateByQuaternionToRef(this.rig.rotationQuaternion!, before);
      this.rig.rotationQuaternion!.copyFrom(roll.multiply(this.rig.rotationQuaternion!).normalize());
      const after = Vector3.Zero();
      this.camera.position.rotateByQuaternionToRef(this.rig.rotationQuaternion!, after);
      // Pivot at the headset, not at the floor: roll must not swing the player in an arc.
      this.rig.position.addInPlace(before.subtract(after));
      this.flightDirection.rotateByQuaternionToRef(roll, this.flightDirection);
    }
    this.moveWithinBounds(this.flightDirection.scale(this.speed * dt));

    const acceleration = Math.abs(this.speed - this.lastSpeed) / Math.max(dt, 0.001);
    this.lastSpeed = this.speed;
    return {
      speed: this.speed,
      speedRatio: this.speed / maxSpeed,
      turnIntensity: Scalar.Clamp(Math.max(directionTurn / 1.1, Math.abs(this.rollRate) / (Math.PI / 2)), 0, 1),
      accelerationIntensity: Scalar.Clamp(acceleration / 9, 0, 1),
    };
  }

  private mergeIntent(desktop: Intent, gamepad?: Gamepad): Intent {
    if (!gamepad) return desktop;
    const axes = gamepad.axes;
    const deadzone = (value: number) => Math.abs(value) < 0.16 ? 0 : value;
    const trigger = Math.max(gamepad.buttons[0]?.value ?? 0, gamepad.buttons[4]?.value ?? 0);
    const brake = Math.max(gamepad.buttons[1]?.value ?? 0, gamepad.buttons[5]?.value ?? 0);
    return {
      ...desktop,
      throttle: Math.max(desktop.throttle, trigger),
      brake: Math.max(desktop.brake, brake),
      yaw: Scalar.Clamp(desktop.yaw + deadzone(axes[2] ?? axes[0] ?? 0), -1, 1),
      pitch: Scalar.Clamp(desktop.pitch + deadzone(axes[3] ?? axes[1] ?? 0), -1, 1),
    };
  }

  private measureBank(axis: Vector3): number | null {
    const up = Vector3.Up();
    up.rotateByQuaternionToRef(this.rig.rotationQuaternion!.multiply(this.neutralHeadRotation ?? Quaternion.Identity()), up);
    const reference = this.rollReferenceUp.subtract(axis.scale(Vector3.Dot(this.rollReferenceUp, axis)));
    const projected = up.subtract(axis.scale(Vector3.Dot(up, axis)));
    // Near vertical there is no meaningful horizon to level toward.
    if (reference.lengthSquared() < 0.001 || projected.lengthSquared() < 0.001) return null;
    reference.normalize(); projected.normalize();
    return Math.atan2(Vector3.Dot(axis, Vector3.Cross(projected, reference)), Vector3.Dot(projected, reference));
  }

  private moveWithinBounds(displacement: Vector3): void {
    let movement = displacement;
    if (this.resolveCollision && displacement.lengthSquared() > 1e-8) {
      this.rig.computeWorldMatrix(true);
      this.camera.computeWorldMatrix();
      const collision = this.resolveCollision(this.camera.globalPosition.clone(), displacement);
      if (collision) {
        movement = collision.displacement;
        const normal = collision.normal.normalizeToNew();
        const incoming = this.flightDirection;
        this.flightDirection = incoming.subtract(normal.scale(2 * Vector3.Dot(incoming, normal))).normalize();
        this.speed *= collision.speedScale;
      }
    }
    const nextPosition = this.rig.position.add(movement);
    if (this.bounds) {
      const fromCenter = nextPosition.subtract(this.bounds.center);
      const distance = fromCenter.length();
      if (distance > this.bounds.radius) {
        const outward = fromCenter.scale(1 / distance);
        nextPosition.copyFrom(this.bounds.center).addInPlace(outward.scale(this.bounds.radius - 0.5));
        this.flightDirection = this.flightDirection.subtract(outward.scale(2 * Vector3.Dot(this.flightDirection, outward))).normalize();
        this.speed *= 0.35;
      }
    }
    this.rig.position.copyFrom(nextPosition);
  }

}

export type { Intent as FlightIntent };
