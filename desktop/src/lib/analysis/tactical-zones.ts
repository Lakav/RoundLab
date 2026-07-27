export type TacticalZonePoint = {
  x: number;
  y: number;
};

export type TacticalZoneDefinition = {
  zoneId: string;
  label: string;
  polygon: TacticalZonePoint[];
  altitudeMin: number;
  altitudeMax: number;
  priority?: number;
};

export type TacticalMapDefinition = {
  map: string;
  zonesVersion: string;
  zones: TacticalZoneDefinition[];
};

export type TacticalZoneLookup = {
  status: "assigned" | "outside" | "ambiguous";
  zoneId: string | null;
  candidateZoneIds: string[];
};

const POINT_EPSILON = 1e-7;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finitePoint(value: unknown): value is TacticalZonePoint {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y)
  );
}

export function validTacticalMapDefinition(
  value: unknown,
): value is TacticalMapDefinition {
  if (
    !isRecord(value) ||
    typeof value.map !== "string" ||
    value.map.trim().length === 0 ||
    typeof value.zonesVersion !== "string" ||
    value.zonesVersion.trim().length === 0 ||
    !Array.isArray(value.zones)
  ) {
    return false;
  }
  const zoneIds = new Set<string>();
  for (const zone of value.zones) {
    if (
      !isRecord(zone) ||
      typeof zone.zoneId !== "string" ||
      zone.zoneId.trim().length === 0 ||
      zoneIds.has(zone.zoneId) ||
      typeof zone.label !== "string" ||
      zone.label.trim().length === 0 ||
      !Array.isArray(zone.polygon) ||
      zone.polygon.length < 3 ||
      !zone.polygon.every(finitePoint) ||
      typeof zone.altitudeMin !== "number" ||
      typeof zone.altitudeMax !== "number" ||
      !Number.isFinite(zone.altitudeMin) ||
      !Number.isFinite(zone.altitudeMax) ||
      zone.altitudeMin >= zone.altitudeMax ||
      (
        zone.priority !== undefined &&
        (
          typeof zone.priority !== "number" ||
          !Number.isFinite(zone.priority)
        )
      )
    ) {
      return false;
    }
    zoneIds.add(zone.zoneId);
  }
  return true;
}

function pointOnSegment(
  point: TacticalZonePoint,
  start: TacticalZonePoint,
  end: TacticalZonePoint,
): boolean {
  const cross =
    (point.y - start.y) * (end.x - start.x) -
    (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > POINT_EPSILON) return false;
  const dot =
    (point.x - start.x) * (end.x - start.x) +
    (point.y - start.y) * (end.y - start.y);
  if (dot < -POINT_EPSILON) return false;
  const lengthSquared =
    (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  return dot <= lengthSquared + POINT_EPSILON;
}

function pointInPolygon(
  point: TacticalZonePoint,
  polygon: TacticalZonePoint[],
): boolean {
  let inside = false;
  for (
    let index = 0, previous = polygon.length - 1;
    index < polygon.length;
    previous = index++
  ) {
    const start = polygon[previous];
    const end = polygon[index];
    if (pointOnSegment(point, start, end)) return true;
    const crosses =
      (start.y > point.y) !== (end.y > point.y) &&
      point.x <
        (end.x - start.x) * (point.y - start.y) /
          (end.y - start.y) +
          start.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function locateTacticalZone(
  definition: TacticalMapDefinition,
  position: { x: number; y: number; z: number },
): TacticalZoneLookup {
  const candidates = definition.zones
    .filter(
      (zone) =>
        position.z >= zone.altitudeMin &&
        position.z < zone.altitudeMax &&
        pointInPolygon(position, zone.polygon),
    )
    .sort(
      (left, right) =>
        (right.priority ?? 0) - (left.priority ?? 0) ||
        left.zoneId.localeCompare(right.zoneId),
    );
  if (candidates.length === 0) {
    return { status: "outside", zoneId: null, candidateZoneIds: [] };
  }
  const highestPriority = candidates[0].priority ?? 0;
  const highest = candidates.filter(
    (zone) => (zone.priority ?? 0) === highestPriority,
  );
  if (highest.length > 1) {
    return {
      status: "ambiguous",
      zoneId: null,
      candidateZoneIds: highest.map((zone) => zone.zoneId),
    };
  }
  return {
    status: "assigned",
    zoneId: candidates[0].zoneId,
    candidateZoneIds: candidates.map((zone) => zone.zoneId),
  };
}
