import type { PlayerPos, Round, UtilityEffect } from "../types.ts";
import { SMOKE_RADIUS_WORLD } from "../utility-geometry.ts";
import {
  hasClearLineOfSight,
  type MapGeometry,
  type Vector3,
} from "./visibility-geometry.ts";

export const ASSUMED_HORIZONTAL_FOV_DEGREES = 106;
export const ASSUMED_VERTICAL_FOV_DEGREES = 74;
export const FLASH_VISIBILITY_THRESHOLD_SECONDS = 0.1;

export type TemporalVisibilityResult = {
  visible: boolean;
  method: "geometry_fov_smoke_flash";
  confidence: "medium" | "low";
  observerIds: string[];
  limitations: string[];
};

function angleDifference(left: number, right: number): number {
  return Math.abs(((left - right + 540) % 360) - 180);
}

function pointToSegmentDistance(
  point: Vector3,
  start: Vector3,
  end: Vector3,
): number {
  const direction = {
    x: end.x - start.x,
    y: end.y - start.y,
    z: end.z - start.z,
  };
  const lengthSquared =
    direction.x ** 2 + direction.y ** 2 + direction.z ** 2;
  if (lengthSquared === 0) {
    return Math.hypot(
      point.x - start.x,
      point.y - start.y,
      point.z - start.z,
    );
  }
  const projection = Math.max(0, Math.min(1, (
    (point.x - start.x) * direction.x +
    (point.y - start.y) * direction.y +
    (point.z - start.z) * direction.z
  ) / lengthSquared));
  return Math.hypot(
    point.x - (start.x + direction.x * projection),
    point.y - (start.y + direction.y * projection),
    point.z - (start.z + direction.z * projection),
  );
}

function activeSmokeBlocks(
  effects: UtilityEffect[] | undefined,
  time: number,
  start: Vector3,
  end: Vector3,
): boolean {
  return effects?.some(
    (effect) =>
      effect.type === "smoke" &&
      time >= effect.start &&
      time <= effect.end &&
      pointToSegmentDistance(effect, start, end) <= SMOKE_RADIUS_WORLD,
  ) ?? false;
}

function inFieldOfView(
  observer: PlayerPos,
  observerEye: Vector3,
  targetHead: Vector3,
): { visible: boolean; pitchAvailable: boolean } {
  const dx = targetHead.x - observerEye.x;
  const dy = targetHead.y - observerEye.y;
  const dz = targetHead.z - observerEye.z;
  const targetYaw = Math.atan2(dy, dx) * 180 / Math.PI;
  if (
    angleDifference(observer.yaw, targetYaw) >
    ASSUMED_HORIZONTAL_FOV_DEGREES / 2
  ) {
    return { visible: false, pitchAvailable: observer.pitch !== undefined };
  }
  if (!Number.isFinite(observer.pitch)) {
    return { visible: true, pitchAvailable: false };
  }
  const targetPitch =
    -Math.atan2(dz, Math.hypot(dx, dy)) * 180 / Math.PI;
  return {
    visible:
      angleDifference(observer.pitch ?? 0, targetPitch) <=
      ASSUMED_VERTICAL_FOV_DEGREES / 2,
    pitchAvailable: true,
  };
}

export function evaluateTemporalVisibility(
  round: Round,
  time: number,
  geometry: MapGeometry,
  first: PlayerPos,
  second: PlayerPos,
  eyePosition: (player: PlayerPos) => Vector3,
): TemporalVisibilityResult {
  const limitations = new Set<string>(["dynamic_obstacles_not_modeled"]);
  if (round.effects === undefined) limitations.add("missing_utility_effects");
  const observerIds: string[] = [];
  for (const [observer, target] of [[first, second], [second, first]] as const) {
    const observerEye = eyePosition(observer);
    const targetHead = eyePosition(target);
    if (!hasClearLineOfSight(observerEye, targetHead, geometry)) continue;
    if (activeSmokeBlocks(round.effects, time, observerEye, targetHead)) continue;
    if (observer.flashLeft === undefined) {
      limitations.add("missing_flash_state");
    } else if (observer.flashLeft > FLASH_VISIBILITY_THRESHOLD_SECONDS) {
      continue;
    }
    const fov = inFieldOfView(observer, observerEye, targetHead);
    if (!fov.pitchAvailable) limitations.add("missing_pitch");
    if (!fov.visible) continue;
    if (target.spottedBy === undefined) {
      limitations.add("missing_spotted_by");
    }
    observerIds.push(String(observer.id));
  }
  return {
    visible: observerIds.length > 0,
    method: "geometry_fov_smoke_flash",
    confidence: limitations.size === 1 ? "medium" : "low",
    observerIds: observerIds.sort(),
    limitations: [...limitations].sort(),
  };
}
