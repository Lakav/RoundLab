import { assetPath } from "@/lib/paths";
import {
  type TacticalMapDefinition,
  validTacticalMapDefinition,
} from "./tactical-zones";

export class TacticalZoneLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TacticalZoneLoadError";
  }
}

export function tacticalZonePath(map: string): string {
  return assetPath(`/map-zones/${encodeURIComponent(map)}.json`);
}

export async function loadTacticalZones(
  map: string,
  request: typeof fetch = fetch,
): Promise<TacticalMapDefinition | null> {
  const response = await request(tacticalZonePath(map));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new TacticalZoneLoadError(
      `Unable to load tactical zones for ${map}: HTTP ${response.status}.`,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new TacticalZoneLoadError(`Tactical zone JSON for ${map} is invalid.`);
  }
  if (!validTacticalMapDefinition(payload)) {
    throw new TacticalZoneLoadError(
      `Tactical zones for ${map} do not match the expected schema.`,
    );
  }
  if (payload.map !== map) {
    throw new TacticalZoneLoadError(
      `Tactical zones declare ${payload.map}, expected ${map}.`,
    );
  }
  return payload;
}
