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

export class FlightController {
  private speed = 0;
  private throttle = 0;
  private yawRate = 0;
  private pitchRate = 0;
  private lastSpeed = 0;
  private neutralHeadRotation: Quaternion | null = null;

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
  }

  reset(position: Vector3, direction: Vector3): void {
    this.rig.position.copyFrom(position);
    const yaw = Math.atan2(direction.x, direction.z);
    const horizontal = Math.sqrt(direction.x ** 2 + direction.z ** 2);
    const pitch = -Math.atan2(direction.y, horizontal);
    this.rig.rotationQuaternion = Quaternion.FromEulerAngles(pitch, yaw, 0);
    this.speed = 0;
    this.throttle = 0;
    this.yawRate = 0;
    this.pitchRate = 0;
    this.lastSpeed = 0;
  }

  update(deltaSeconds: number, desktopIntent: Intent, gamepad?: Gamepad): FlightTelemetry {
    const dt = Math.min(deltaSeconds, 0.05);
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
}

export type { Intent as FlightIntent };
