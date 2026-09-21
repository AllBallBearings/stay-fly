export type RollMode = "assisted" | "free";
const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x));
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Shared bank/stunt state machine. Angles and returned increments are right-positive. */
export class RollController {
  private armed = true;
  private held = 0;
  private heldSign = 0;
  private stuntTime = 0;
  private stuntSign = 0;
  private rate = 0;
  private previousMode: RollMode = "assisted";

  reset(): void {
    this.armed = true;
    this.held = this.heldSign = this.stuntTime = this.stuntSign = this.rate = 0;
  }

  update(dt: number, bank: number, gesture: number, options: {
    active: boolean; mode: RollMode; comfort: boolean; fullRolls: boolean;
    gestureStunts: boolean; stunt?: number;
  }): number {
    const input = options.active ? clamp(gesture, -1, 1) : 0;
    if (options.mode !== this.previousMode) {
      this.reset();
      this.armed = false;
      this.previousMode = options.mode;
    }
    if (Math.abs(input) < 0.15 && this.stuntSign === 0) this.armed = true;
    if (!options.active || !options.fullRolls) {
      this.stuntSign = 0;
      this.held = 0;
      this.armed = Math.abs(input) < 0.15;
    }

    if (options.mode === "free" && options.active && options.fullRolls) {
      const maxRate = options.comfort ? Math.PI / 4 : Math.PI / 2;
      this.rate = input === 0 ? 0 : this.rate + (input * maxRate - this.rate) * (1 - Math.exp(-dt * 10));
      return this.rate * dt;
    }
    this.rate = 0;
    const strong = options.fullRolls && options.gestureStunts && Math.abs(input) >= 0.85;
    const sign = Math.sign(input);
    this.held = strong && sign === this.heldSign ? this.held + dt : 0;
    this.heldSign = strong ? sign : 0;
    const trigger = options.stunt || (this.held >= 0.25 ? sign : 0);
    if (options.active && options.fullRolls && this.armed && !this.stuntSign && trigger) {
      this.stuntSign = Math.sign(trigger);
      this.stuntTime = 0;
      this.armed = false;
      this.held = 0;
    }
    if (this.stuntSign) {
      // Smooth acceleration and deceleration, exactly one full revolution.
      const duration = options.comfort ? 4 : 2.8;
      const smooth = (t: number) => t * t * (3 - 2 * t);
      const before = this.stuntTime;
      this.stuntTime = Math.min(1, before + dt / duration);
      const delta = this.stuntSign * Math.PI * 2 * (smooth(this.stuntTime) - smooth(before));
      if (this.stuntTime === 1) this.stuntSign = 0;
      return delta;
    }
    const maxBank = (options.comfort ? 20 : 35) * Math.PI / 180;
    const target = input * maxBank;
    const error = wrap(target - bank);
    const maxRate = options.comfort ? Math.PI / 3 : Math.PI / 2;
    // Also used for hover recovery and disabling full rolls; never snap upright.
    return clamp(error * (1 - Math.exp(-dt * 8)), -maxRate * dt, maxRate * dt);
  }
}
