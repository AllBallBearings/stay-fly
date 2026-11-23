import type { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import type { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { FlightBounds, FlightCollision } from "./FlightController";

export type WorldId = "sky-islands" | "starfall-lake";

export interface WorldChoice {
  id: WorldId;
  name: string;
  tagline: string;
  /** One sentence shown under the play buttons once this world is selected. */
  guide: string;
}

/** Every world the player can pick from the main menu, in menu order. */
export const WORLD_CHOICES: readonly WorldChoice[] = [
  {
    id: "sky-islands",
    name: "Sky Islands",
    tagline: "Five connected districts above the clouds",
    guide: "One connected world: city ahead, forest to the right, waterfalls to the left, harbor beyond the city. Fly toward the district signs—no map switching.",
  },
  {
    id: "starfall-lake",
    name: "Starfall Lake",
    tagline: "A retro-future valley under a starry sky",
    guide: "A hand-painted 1980s anime valley: the sphere dome is to your left, the twin spires stand on the mountains ahead and colossal monoliths guard both shores.",
  },
];

export const DEFAULT_WORLD: WorldId = "sky-islands";

export const isWorldId = (value: unknown): value is WorldId =>
  WORLD_CHOICES.some((choice) => choice.id === value);

/** Scene-wide lighting and post settings each world applies when it becomes active. */
export interface WorldEnvironment {
  clearColor: Color4;
  ambientColor: Color3;
  fogColor: Color3;
  fogDensity: number;
  skyLight: { direction: Vector3; diffuse: Color3; ground: Color3; intensity: number };
  sunLight: { direction: Vector3; diffuse: Color3; intensity: number };
  /** False keeps painted colors exactly as authored (no filmic curve). */
  toneMapping: boolean;
  exposure: number;
  contrast: number;
  glowIntensity: number;
  /** Resting image-processing vignette; motion adds to it in comfort mode. */
  vignette: number;
}

export interface WorldNavigation {
  region: string;
  directions: string;
}

/** A selectable, self-contained flight world sharing the game's single Babylon scene. */
export interface GameWorld {
  readonly id: WorldId;
  readonly flightBounds: FlightBounds;
  readonly startPosition: Vector3;
  /** Desktop opening view direction. Headsets always start level. */
  readonly startDirection: Vector3;
  /**
   * Optional vertical lens shift (normalized device units) for the desktop opening view,
   * used to frame a painted composition with two-point perspective. It eases to zero as
   * flight begins and is never applied in a headset.
   */
  readonly openingLensShift?: number;
  readonly environment: WorldEnvironment;
  update(timeSeconds: number): void;
  resolveFlightMotion(position: Vector3, displacement: Vector3): FlightCollision | null;
  navigate(position: Vector3, forward: Vector3): WorldNavigation;
  setEnabled(enabled: boolean): void;
}
