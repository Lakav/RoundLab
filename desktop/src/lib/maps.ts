export type MapCalibration = {
  posX: number;
  posY: number;
  scale: number;
};

export const MAP_CALIBRATION: Record<string, MapCalibration> = {
  de_inferno: { posX: -2087, posY: 3870, scale: 4.9 },
  de_mirage: { posX: -3230, posY: 1713, scale: 5.0 },
  de_dust2: { posX: -2476, posY: 3239, scale: 4.4 },
  de_nuke: { posX: -3453, posY: 2887, scale: 7 },
  de_overpass: { posX: -4831, posY: 1781, scale: 5.2 },
  de_ancient: { posX: -2953, posY: 2164, scale: 5 },
  de_anubis: { posX: -2796, posY: 3328, scale: 5.22 },
  de_cache: { posX: -2000, posY: 3250, scale: 5.5 },
  de_train: { posX: -2308, posY: 2078, scale: 4.082077 },
  de_vertigo: { posX: -3168, posY: 1762, scale: 4.0 },
};

export const RADAR_SIZE = 1024;

// Crop region in radar pixels (0..RADAR_SIZE) for each map, trimming the
// empty black borders around the actual playable area. x/y is the top-left
// of the crop, size is a square side.
export type MapCrop = { x: number; y: number; size: number };

// ~1.08x crop: trim 8% of each side
export const MAP_CROP: Record<string, MapCrop> = {
  de_inferno: { x: 38, y: 38, size: 948 },
  de_mirage: { x: 38, y: 38, size: 948 },
  de_dust2: { x: 38, y: 38, size: 948 },
  de_nuke: { x: 38, y: 38, size: 948 },
  de_overpass: { x: 38, y: 38, size: 948 },
  de_ancient: { x: 38, y: 38, size: 948 },
  de_anubis: { x: 38, y: 38, size: 948 },
  de_cache: { x: 38, y: 38, size: 948 },
  de_train: { x: 38, y: 38, size: 948 },
  de_vertigo: { x: 38, y: 38, size: 948 },
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
