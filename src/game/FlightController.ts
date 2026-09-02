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

export class FlightController {
  private speed = 0;
  private throttle = 0;
  private yawRate = 0;
  private pitchRate = 0;
  private lastSpeed = 0;
  private neutralHeadRotation: Quaternion | null = null;
  private baseRigRotation = Quaternion.Identity();
  private controlFrameRotation = Quaternion.Identity();
  private flightDirection = Vector3.Forward();
  private visualRoll = 0;

  constructor(
    private readonly rig: TransformNode,
    private camera: TargetCamera,
    private readonly settings: GameSettings,
  ) {
    this.rig.rotationQuaternion = Quaternion.Identity();
  }

  setCamera(camera: TargetCamera): void {
    this.camera = camera;
    this.neutralHeadRotation = null;
  }

  calibrate(): void {
    const rotation = this.camera.rotationQuaternion;
    this.neutralHeadRotation = rotation ? rotation.clone() : Quaternion.FromEulerAngles(
      this.camera.rotation.x,
      this.camera.rotation.y,
      this.camera.rotation.z,
    );
    this.controlFrameRotation = this.baseRigRotation.clone();
  }

  reset(position: Vector3, direction: Vector3): void {
    this.rig.position.copyFrom(position);
    const yaw = Math.atan2(direction.x, direction.z);
    const horizontal = Math.sqrt(direction.x ** 2 + direction.z ** 2);
    const pitch = -Math.atan2(direction.y, horizontal);
    this.rig.rotationQuaternion = Quaternion.FromEulerAngles(pitch, yaw, 0);
    this.baseRigRotation = this.rig.rotationQuaternion.clone();
    this.controlFrameRotation = this.baseRigRotation.clone();
    Vector3.Forward().rotateByQuaternionToRef(this.baseRigRotation, this.flightDirection);
    this.speed = 0;
    this.throttle = 0;
    this.yawRate = 0;
    this.pitchRate = 0;
    this.lastSpeed = 0;
    this.visualRoll = 0;
  }

  update(deltaSeconds: number, desktopIntent: Intent, gamepad?: Gamepad, xrIntent?: XRFlightIntent): FlightTelemetry {
    const dt = Math.min(deltaSeconds, 0.05);
    if (xrIntent) return this.updateXRFlight(dt, xrIntent);
    const intent = this.mergeIntent(desktopIntent, gamepad);
    const headIntent = this.readHeadIntent();

    const maxSpeed = this.settings.comfortMode ? 18 : 27;
    const cruiseSpeed = this.settings.comfortMode ? 8 : 11;
    const maxYaw = this.settings.comfortMode ? 0.48 : 0.72;
    const maxPitch = this.settings.comfortMode ? 0.32 : 0.48;

    const requestedThrottle = Math.max(intent.throttle, 0.22);
    this.throttle = Scalar.Lerp(this.throttle, requestedThrottle, 1 - Math.exp(-dt * 3.2));
    const targetSpeed = intent.brake > 0.1
      ? 2.5
      : Scalar.Lerp(cruiseSpeed, maxSpeed, this.throttle);
    const speedResponse = targetSpeed > this.speed ? 1.2 : 2.3;
    this.speed = Scalar.Lerp(this.speed, targetSpeed, 1 - Math.exp(-dt * speedResponse));

    const requestedYaw = Scalar.Clamp(intent.yaw + headIntent.x * 0.72, -1, 1) * maxYaw;
    const requestedPitch = Scalar.Clamp(intent.pitch + headIntent.y * 0.72, -1, 1) * maxPitch;
    this.yawRate = Scalar.Lerp(this.yawRate, requestedYaw, 1 - Math.exp(-dt * 4));
    this.pitchRate = Scalar.Lerp(this.pitchRate, requestedPitch, 1 - Math.exp(-dt * 4));

    const turn = Quaternion.FromEulerAngles(this.pitchRate * dt, this.yawRate * dt, 0);
    this.rig.rotationQuaternion = this.rig.rotationQuaternion!.multiply(turn).normalize();

    const forward = Vector3.Zero();
    Vector3.Forward().rotateByQuaternionToRef(this.rig.rotationQuaternion, forward);
    this.rig.position.addInPlace(forward.scale(this.speed * dt));

    // Keep free flight forgiving: prevent accidental deep dives.
    if (this.rig.position.y < -8) this.rig.position.y = Scalar.Lerp(this.rig.position.y, -8, dt * 2);
    if (this.rig.position.y > 60) this.rig.position.y = Scalar.Lerp(this.rig.position.y, 60, dt * 2);

    const acceleration = Math.abs(this.speed - this.lastSpeed) / Math.max(dt, 0.001);
    this.lastSpeed = this.speed;
    return {
      speed: this.speed,
      speedRatio: this.speed / maxSpeed,
      turnIntensity: Scalar.Clamp((Math.abs(this.yawRate) + Math.abs(this.pitchRate)) / (maxYaw + maxPitch), 0, 1),
      accelerationIntensity: Scalar.Clamp(acceleration / 9, 0, 1),
    };
  }

  createXRIntent(controllers: ReadonlyArray<{ position: Vector3 }>): XRFlightIntent {
    // These positions are local to the flight rig. That keeps arm steering independent
    // of the virtual world rotating around the player.
    const headPosition = this.camera.position;
    const activeArms = controllers
      .map((controller) => {
        const arm = controller.position.subtract(headPosition);
        const extension = arm.length();
        return {
          ...controller,
          heading: arm.scale(1 / Math.max(extension, 0.0001)),
          extension,
          verticalOffset: arm.y,
        };
      })
      // Hands hanging at the player's sides are below head height. Any deliberate reach
      // around the player is valid, including to either side or fully behind.
      .filter((arm) => arm.extension > 0.34 && arm.verticalOffset > -0.45);

    if (!activeArms.length) {
      return { active: false, throttle: 0, direction: this.flightDirection.clone() };
    }

    // The most extended arm is the steering reference; two hands close together add speed.
    const leader = activeArms.reduce((furthest, arm) => arm.extension > furthest.extension ? arm : furthest);
    let throttle = Scalar.Clamp((leader.extension - 0.3) / 0.42, 0.3, 0.72);
    if (activeArms.length > 1) {
      const separation = Vector3.Distance(activeArms[0].position, activeArms[1].position);
      const handsTogether = 1 - Scalar.Clamp((separation - 0.12) / 0.7, 0, 1);
      throttle = Scalar.Lerp(0.38, 1, handsTogether);
    }
    const direction = Vector3.Zero();
    leader.heading.rotateByQuaternionToRef(this.controlFrameRotation, direction);
    return {
      active: true,
      throttle,
      // Your extended arm lays down the next piece of the flight path in 3D space.
      direction: direction.normalize(),
    };
  }

  private updateXRFlight(dt: number, intent: XRFlightIntent): FlightTelemetry {
    const maxSpeed = this.settings.comfortMode ? 42 : 60;
    const targetSpeed = intent.active ? maxSpeed * intent.throttle : 0;
    const response = intent.active ? 5.5 : 12;
    this.speed = Scalar.Lerp(this.speed, targetSpeed, 1 - Math.exp(-dt * response));
    this.throttle = intent.throttle;

    let directionTurn = 0;
    if (intent.active && intent.direction.lengthSquared() > 0.001) {
      const desiredDirection = intent.direction.normalize();
      directionTurn = Math.acos(Scalar.Clamp(Vector3.Dot(this.flightDirection, desiredDirection), -1, 1));
      const maxTurnRate = this.settings.comfortMode ? 10 : 15;
      this.flightDirection = this.turnToward(desiredDirection, directionTurn, maxTurnRate * dt);
      this.baseRigRotation = this.rotationForDirection(this.flightDirection);
    }

    // Head tilt is visual roll only. Looking left/right or up/down never redirects flight.
    const desiredRoll = Scalar.Clamp(this.readHeadRoll(), -0.58, 0.58);
    this.visualRoll = Scalar.Lerp(this.visualRoll, desiredRoll, 1 - Math.exp(-dt * 7));
    this.rig.rotationQuaternion = this.baseRigRotation
      .multiply(Quaternion.FromEulerAngles(0, 0, this.visualRoll))
      .normalize();
    this.rig.position.addInPlace(this.flightDirection.scale(this.speed * dt));

    if (this.rig.position.y < -8) this.rig.position.y = Scalar.Lerp(this.rig.position.y, -8, dt * 2);
    if (this.rig.position.y > 60) this.rig.position.y = Scalar.Lerp(this.rig.position.y, 60, dt * 2);

    const acceleration = Math.abs(this.speed - this.lastSpeed) / Math.max(dt, 0.001);
    this.lastSpeed = this.speed;
    return {
      speed: this.speed,
      speedRatio: this.speed / maxSpeed,
      turnIntensity: Scalar.Clamp(directionTurn / 1.1 + Math.abs(this.visualRoll) / 1.2, 0, 1),
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

  private readHeadRoll(): number {
    if (!this.neutralHeadRotation || !this.camera.rotationQuaternion) return 0;
    const delta = this.neutralHeadRotation.conjugate().multiply(this.camera.rotationQuaternion).normalize();
    return delta.toEulerAngles().z;
  }

  private turnToward(desiredDirection: Vector3, angle: number, maximumStep: number): Vector3 {
    if (angle < 0.002) return desiredDirection.clone();
    const turnStep = Math.min(angle, maximumStep);
    let axis = Vector3.Cross(this.flightDirection, desiredDirection);
    if (axis.lengthSquared() < 0.0001) {
      axis = Math.abs(this.flightDirection.y) < 0.9 ? Vector3.Up() : Vector3.Right();
    } else {
      axis.normalize();
    }
    const turned = Vector3.Zero();
    this.flightDirection.rotateByQuaternionToRef(Quaternion.RotationAxis(axis, turnStep), turned);
    return turned.normalize();
  }

  private rotationForDirection(direction: Vector3): Quaternion {
    const yaw = Math.atan2(direction.x, direction.z);
    const horizontal = Math.hypot(direction.x, direction.z);
    const pitch = -Math.atan2(direction.y, horizontal);
    return Quaternion.FromEulerAngles(pitch, yaw, 0);
  }

}

export type { Intent as FlightIntent };
