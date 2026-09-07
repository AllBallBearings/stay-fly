import { Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import type { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { TargetCamera } from "@babylonjs/core/Cameras/targetCamera";
import type { FlightTelemetry, GameSettings } from "./types";

interface Intent {
  throttle: number;
  brake: number;
  yaw: number;
  pitch: number;
}

export interface XRFlightIntent {
  active: boolean;
  throttle: number;
  direction: Vector3;
}

export interface XRControllerPose {
  position: Vector3;
  handedness: "left" | "right" | "none";
}

export interface FlightBounds {
  center: Vector3;
  radius: number;
}

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
  private baseRigRotation = Quaternion.Identity();
  private restDirections = new Map<string, Vector3>();
  private armLengths = new Map<string, number>();
  private flightDirection = Vector3.Forward();

  constructor(
    private readonly rig: TransformNode,
    private camera: TargetCamera,
    private readonly settings: GameSettings,
    private readonly bounds?: FlightBounds,
  ) {
    this.rig.rotationQuaternion = Quaternion.Identity();
  }

  setCamera(camera: TargetCamera): void {
    this.camera = camera;
    this.neutralHeadRotation = null;
  }

  calibrate(controllers: ReadonlyArray<XRControllerPose> = []): void {
    const rotation = this.camera.rotationQuaternion;
    this.neutralHeadRotation = rotation ? rotation.clone() : Quaternion.FromEulerAngles(
      this.camera.rotation.x,
      this.camera.rotation.y,
      this.camera.rotation.z,
    );
    this.baseRigRotation.copyFrom(this.rig.rotationQuaternion!);
    this.restDirections.clear();
    this.armLengths.clear();
    for (const controller of controllers) {
      const arm = controller.position.subtract(this.getShoulderPosition(controller.handedness));
      if (arm.length() < 0.25) continue;
      this.armLengths.set(controller.handedness, Scalar.Clamp(arm.length(), 0.45, 0.8));
      this.restDirections.set(controller.handedness, arm.normalize());
    }
    this.speed = 0;
    this.lastSpeed = 0;
  }

  reset(position: Vector3, direction: Vector3): void {
    this.rig.position.copyFrom(position);
    const yaw = Math.atan2(direction.x, direction.z);
    const horizontal = Math.sqrt(direction.x ** 2 + direction.z ** 2);
    const pitch = -Math.atan2(direction.y, horizontal);
    this.rig.rotationQuaternion = Quaternion.FromEulerAngles(pitch, yaw, 0);
    this.baseRigRotation = this.rig.rotationQuaternion.clone();
    this.restDirections.clear();
    this.armLengths.clear();
    Vector3.Forward().rotateByQuaternionToRef(this.baseRigRotation, this.flightDirection);
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
    const headIntent = this.readHeadIntent();

    // Desktop has its own speed envelope; do not raise headset speeds implicitly.
    const maxSpeed = this.settings.comfortMode ? 100 : 160;
    const cruiseSpeed = this.settings.comfortMode ? 22 : 32;
    const maxYaw = this.settings.comfortMode ? 1.15 : 1.6;
    const maxPitch = this.settings.comfortMode ? 0.8 : 1.1;

    const requestedThrottle = Scalar.Clamp(intent.throttle, 0, 1);
    this.throttle = Scalar.Lerp(this.throttle, requestedThrottle, 1 - Math.exp(-dt * 7));
    const targetSpeed = intent.brake > 0.1
      ? 2.5
      : Scalar.Lerp(cruiseSpeed, maxSpeed, this.throttle);
    const speedResponse = targetSpeed > this.speed ? 3.5 : 6;
    this.speed = Scalar.Lerp(this.speed, targetSpeed, 1 - Math.exp(-dt * speedResponse));

    const requestedYaw = Scalar.Clamp(intent.yaw + headIntent.x * 0.72, -1, 1) * maxYaw;
    const requestedPitch = Scalar.Clamp(intent.pitch + headIntent.y * 0.72, -1, 1) * maxPitch;
    this.yawRate = Scalar.Lerp(this.yawRate, requestedYaw, 1 - Math.exp(-dt * 8));
    this.pitchRate = Scalar.Lerp(this.pitchRate, requestedPitch, 1 - Math.exp(-dt * 8));

    const turn = Quaternion.FromEulerAngles(this.pitchRate * dt, this.yawRate * dt, 0);
    this.rig.rotationQuaternion = this.rig.rotationQuaternion!.multiply(turn).normalize();

    const forward = Vector3.Zero();
    Vector3.Forward().rotateByQuaternionToRef(this.rig.rotationQuaternion, forward);
    this.moveWithinBounds(forward.scale(this.speed * dt));

    const acceleration = Math.abs(this.speed - this.lastSpeed) / Math.max(dt, 0.001);
    this.lastSpeed = this.speed;
    return {
      speed: this.speed,
      speedRatio: this.speed / maxSpeed,
      turnIntensity: Scalar.Clamp((Math.abs(this.yawRate) + Math.abs(this.pitchRate)) / (maxYaw + maxPitch), 0, 1),
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
        const fullReach = this.armLengths.get(controller.handedness) ?? 0.65;
        // Resting straight arms have full length too. Lift away from the recorded rest
        // pose AND extension determine thrust; there is no minimum moving speed.
        const lift = smoothstep((liftAngle - 0.10) / (Math.PI / 2 - 0.10));
        const reach = smoothstep((extension - 0.10) / (fullReach - 0.10));
        return {
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
    return {
      active: true,
      throttle,
      direction: direction.normalize(),
    };
  }

  private updateXRFlight(dt: number, intent: XRFlightIntent): FlightTelemetry {
    const maxSpeed = this.settings.comfortMode ? 42 : 60;
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

    // Do not rotate the XR rig toward the flight vector. The headset already supplies
    // the user's view orientation; rotating its parent made the world swing and also
    // made the visible hands disagree with the tracking-space steering pose.
    this.rig.rotationQuaternion!.copyFrom(this.baseRigRotation);
    this.moveWithinBounds(this.flightDirection.scale(this.speed * dt));

    const acceleration = Math.abs(this.speed - this.lastSpeed) / Math.max(dt, 0.001);
    this.lastSpeed = this.speed;
    return {
      speed: this.speed,
      speedRatio: this.speed / maxSpeed,
      turnIntensity: Scalar.Clamp(directionTurn / 1.1, 0, 1),
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
      throttle: Math.max(desktop.throttle, trigger),
      brake: Math.max(desktop.brake, brake),
      yaw: Scalar.Clamp(desktop.yaw + deadzone(axes[2] ?? axes[0] ?? 0), -1, 1),
      pitch: Scalar.Clamp(desktop.pitch + deadzone(axes[3] ?? axes[1] ?? 0), -1, 1),
    };
  }

  private readHeadIntent(): Vector3 {
    if (!this.neutralHeadRotation || !this.camera.rotationQuaternion) return Vector3.Zero();
    const delta = this.neutralHeadRotation.conjugate().multiply(this.camera.rotationQuaternion).normalize();
    const forward = Vector3.Zero();
    Vector3.Forward().rotateByQuaternionToRef(delta, forward);
    return new Vector3(
      Scalar.Clamp(forward.x * 1.8, -1, 1),
      Scalar.Clamp(-forward.y * 1.8, -1, 1),
      0,
    );
  }

  private moveWithinBounds(displacement: Vector3): void {
    const nextPosition = this.rig.position.add(displacement);
    if (this.bounds) {
      const fromCenter = nextPosition.subtract(this.bounds.center);
      const distance = fromCenter.length();
      if (distance > this.bounds.radius) {
        nextPosition.copyFrom(this.bounds.center).addInPlace(fromCenter.scale(this.bounds.radius / distance));
      }
    }
    this.rig.position.copyFrom(nextPosition);
  }

}

export type { Intent as FlightIntent };
