import { assetPath } from "@/lib/paths";

export type MapCalibration = {
  posX: number;
  posY: number;
  scale: number;
};

export type RadarLayer = "default" | "lower";

export type MapVerticalSection = {
  layer: RadarLayer;
  altitudeMin: number;
  altitudeMax: number;
};

export const MAP_CALIBRATION: Record<string, MapCalibration> = {
  de_inferno: { posX: -2087, posY: 3870, scale: 4.9 },
  de_mirage: { posX: -3230, posY: 1713, scale: 5.0 },
  de_dust2: { posX: -2476, posY: 3239, scale: 4.4 },
  de_nuke: { posX: -3453, posY: 2887, scale: 7 },
  de_overpass: { posX: -4831, posY: 1781, scale: 5.2 },
  de_ancient: { posX: -2953, posY: 2164, scale: 5 },
  de_anubis: { posX: -2796, posY: 3328, scale: 5.22 },
  // CS2Lens stores Cache as (world - x) * 4.58 / 256. Converted to
  // this renderer's Valve-style pixel formula, that is a 5.4585 scale.
  de_cache: { posX: -1964, posY: 3250, scale: 5.458515283842795 },
  de_train: { posX: -2308, posY: 2078, scale: 4.082077 },
  de_vertigo: { posX: -3168, posY: 1762, scale: 4.0 },
};

export const RADAR_SIZE = 1024;

// Values come from the official CS2 overview verticalsections. The upper
// section uses the base radar image; the lower section uses `<map>_lower.png`.
export const MAP_VERTICAL_SECTIONS: Partial<Record<string, MapVerticalSection[]>> = {
  de_nuke: [
    { layer: "default", altitudeMin: -495, altitudeMax: 10000 },
    { layer: "lower", altitudeMin: -10000, altitudeMax: -495 },
  ],
  de_vertigo: [
    { layer: "default", altitudeMin: 11700, altitudeMax: 20000 },
    { layer: "lower", altitudeMin: -10000, altitudeMax: 11700 },
  ],
  de_train: [
    { layer: "default", altitudeMin: -50, altitudeMax: 20000 },
    { layer: "lower", altitudeMin: -5000, altitudeMax: -50 },
  ],
};

// Crop region in radar pixels (0..RADAR_SIZE) for each map, trimming the
// empty black borders around the actual playable area. x/y is the top-left
// of the crop, size is a square side.
export type MapCrop = { x: number; y: number; size: number };

// Per-map safe crops. These keep the useful radar area large without letting
// player markers and labels touch the viewport edge. Unknown maps deliberately
// fall back to the complete 1024px radar below.
export const MAP_CROP: Record<string, MapCrop> = {
  de_inferno: { x: 0, y: 0, size: 1024 },
  de_mirage: { x: 36, y: 36, size: 952 },
  de_dust2: { x: 0, y: 0, size: 1024 },
  de_nuke: { x: 28, y: 28, size: 968 },
  de_overpass: { x: 0, y: 0, size: 1024 },
  de_ancient: { x: 34, y: 34, size: 956 },
  // Anubis reaches y=978 in the replay fixtures. A 14px inset leaves 32px
  // below the lowest player before labels are considered.
  de_anubis: { x: 14, y: 14, size: 996 },
  // Cache and Train use the native radar edges in real matches. Cropping
  // either map would hide valid positions, so the complete overview is used.
  de_cache: { x: 0, y: 0, size: 1024 },
  de_train: { x: 0, y: 0, size: 1024 },
  de_vertigo: { x: 28, y: 28, size: 968 },
};

export function cropFor(map: string): MapCrop {
  return MAP_CROP[map] ?? { x: 0, y: 0, size: RADAR_SIZE };
}

export function worldToRadar(
  worldX: number,
  worldY: number,
  calib: MapCalibration
): { x: number; y: number } {
  return {
    x: (worldX - calib.posX) / calib.scale,
    y: (calib.posY - worldY) / calib.scale,
  };
}

export function radarLayerForZ(map: string, z: number): RadarLayer {
  const sections = MAP_VERTICAL_SECTIONS[map];
  if (!sections || !Number.isFinite(z)) return "default";
  const lower = sections.find((section) => section.layer === "lower");
  if (lower && z >= lower.altitudeMin && z < lower.altitudeMax) return "lower";
  return "default";
}

export function radarLayerForPositions(
  map: string,
  positions: Array<{ z: number }>,
  fallback: RadarLayer = "default"
): RadarLayer {
  const sections = MAP_VERTICAL_SECTIONS[map];
  if (!sections) return "default";
  let lower = 0;
  let upper = 0;
  for (const position of positions) {
    if (!Number.isFinite(position.z)) continue;
    if (radarLayerForZ(map, position.z) === "lower") lower += 1;
    else upper += 1;
  }
  if (lower === 0 && upper === 0) return fallback;
  return lower > upper ? "lower" : "default";
}

export function radarImagePath(map: string, layer: RadarLayer = "default"): string {
  const hasLayer = MAP_VERTICAL_SECTIONS[map]?.some((section) => section.layer === layer);
  const suffix = layer === "lower" && hasLayer ? "_lower" : "";
  return assetPath(`/cs2lens-maps/${map}${suffix}.png`);
}
