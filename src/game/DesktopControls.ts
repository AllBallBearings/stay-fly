import type { FlightIntent } from "./FlightController";

/** Browser-independent input state so bindings, focus loss and double taps are testable. */
export class DesktopControls {
  private keys = new Set<string>();
  private taps = new Map<string, number>();
  private speed = 0.2;
  private aim = {x: 0, y: 0};
  private look = {x: 0, y: 0};
  private stunt = 0;

  keyDown(code: string, time: number, repeat = false): void {
    if (!repeat && !this.keys.has(code) && (code === "KeyQ" || code === "KeyE")) {
      const previous = this.taps.get(code);
      if (previous !== undefined && time - previous <= 300) {
        this.stunt = code === "KeyQ" ? -1 : 1;
        this.taps.delete(code);
      } else this.taps.set(code, time);
    }
    this.keys.add(code);
  }
  keyUp(code: string): void { this.keys.delete(code); }
  clear(): void {
    this.keys.clear(); this.taps.clear(); this.stunt = 0;
    this.aim = {x: 0, y: 0}; this.look = {x: 0, y: 0};
  }
  reset(): void { this.clear(); this.speed = 0.2; }
  mouseMove(x: number, y: number): void {
    const target = this.pressed("AltLeft", "AltRight") ? this.look : this.aim;
    target.x += x * 0.0025;
    target.y += y * 0.0025;
  }
  read(dt: number): FlightIntent {
    this.speed = Math.max(0, Math.min(1, this.speed + (Number(this.pressed("KeyW")) - Number(this.pressed("KeyS"))) * dt * 0.55));
    const intent: FlightIntent = {
      throttle: this.pressed("ShiftLeft", "ShiftRight") ? 1 : this.speed,
      brake: this.pressed("Space") ? 1 : 0,
      yaw: Number(this.pressed("ArrowRight", "KeyD")) - Number(this.pressed("ArrowLeft", "KeyA")),
      pitch: Number(this.pressed("ArrowDown")) - Number(this.pressed("ArrowUp")),
      aimYaw: this.aim.x, aimPitch: this.aim.y,
      roll: Number(this.pressed("KeyE")) - Number(this.pressed("KeyQ")),
      stunt: this.stunt,
      freeLook: this.pressed("AltLeft", "AltRight"), lookYaw: this.look.x, lookPitch: this.look.y,
    };
    this.aim = {x: 0, y: 0}; this.look = {x: 0, y: 0}; this.stunt = 0;
    return intent;
  }
  private pressed(...codes: string[]): boolean { return codes.some((code) => this.keys.has(code)); }
}
