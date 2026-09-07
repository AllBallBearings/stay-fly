import { Vector3 } from "@babylonjs/core/Maths/math.vector";

/** All districts are permanent neighbors in one scene, not interchangeable maps. */
export const WORLD_REGIONS = [
  { id: "neon-city", name: "Neon City", position: new Vector3(0, 5, 550), radius: 875, signHeight: 230, color: "#80eaff" },
  { id: "quiet-grove", name: "Quiet Forest", position: new Vector3(1550, 11, 700), radius: 800, signHeight: 250, color: "#b9ef98" },
  { id: "azure-falls", name: "Azure Falls", position: new Vector3(-1200, 50, 400), radius: 700, signHeight: 250, color: "#a3e8ff" },
  { id: "sky-harbor", name: "Sky Harbor", position: new Vector3(550, 3, 2100), radius: 750, signHeight: 230, color: "#ffd995" },
  { id: "little-garden", name: "Wild Gardens", position: new Vector3(-1100, 25, 2000), radius: 700, signHeight: 250, color: "#c6efaa" },
] as const;

export type RegionId = typeof WORLD_REGIONS[number]["id"];
export const REGION_CONNECTIONS: readonly (readonly [RegionId, RegionId])[] = [
  ["neon-city", "quiet-grove"], ["neon-city", "azure-falls"], ["neon-city", "sky-harbor"],
  ["azure-falls", "little-garden"], ["little-garden", "sky-harbor"], ["quiet-grove", "sky-harbor"],
];

export function getWorldNavigation(position: Vector3, forward: Vector3): { region: string; directions: string } {
  const heading = Math.atan2(forward.x, forward.z);
  const nearby = WORLD_REGIONS.map((region) => ({
    ...region,
    distance: Math.hypot(region.position.x - position.x, region.position.z - position.z),
  })).sort((a, b) => a.distance - b.distance);
  const current = nearby.find((region) => region.distance <= region.radius);
  const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
  const directions = nearby.filter((region) => region.id !== current?.id).slice(0, 2).map((region) => {
    const bearing = Math.atan2(region.position.x - position.x, region.position.z - position.z) - heading;
    const arrow = arrows[(Math.round(bearing / (Math.PI / 4)) % 8 + 8) % 8];
    const distance = region.distance >= 1000 ? `${(region.distance / 1000).toFixed(1)} km` : `${Math.round(region.distance / 10) * 10} m`;
    return `${arrow} ${region.name} · ${distance}`;
  }).join("    /    ");
  return { region: current?.name ?? "Between districts", directions };
}
