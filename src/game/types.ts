export type GamePhase = "landing" | "calibrating" | "flying" | "paused";

export interface FlightTelemetry {
  speed: number;
  speedRatio: number;
  turnIntensity: number;
  accelerationIntensity: number;
}

export interface GameSettings {
  comfortMode: boolean;
  vignette: boolean;
}
