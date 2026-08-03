import { assetPath } from "@/lib/paths";
import {
  type MapGeometry,
  validMapGeometry,
} from "./visibility-geometry";

export class MapGeometryLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MapGeometryLoadError";
  }
}

export function mapGeometryPath(map: string): string {
  return assetPath(`/map-geometry/${encodeURIComponent(map)}.json`);
}

export async function loadMapGeometry(
  map: string,
  request: typeof fetch = fetch,
): Promise<MapGeometry | null> {
  const response = await request(mapGeometryPath(map));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new MapGeometryLoadError(
      `Unable to load geometry for ${map}: HTTP ${response.status}.`,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MapGeometryLoadError(`Geometry JSON for ${map} is invalid.`);
  }
  if (!validMapGeometry(payload)) {
    throw new MapGeometryLoadError(
      `Geometry payload for ${map} does not match the expected schema.`,
    );
  }
  if (payload.map !== map) {
    throw new MapGeometryLoadError(
      `Geometry payload declares ${payload.map}, expected ${map}.`,
    );
  }
  return payload;
}
