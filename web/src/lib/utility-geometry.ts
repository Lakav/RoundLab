import type { UtilityEffect } from "./types.ts";

export const SMOKE_RADIUS_WORLD = 144;
export const MOLOTOV_RADIUS_WORLD = 116;
export const INCENDIARY_RADIUS_WORLD = 104;
export const FIRE_SMOKE_EXTINGUISH_OVERLAP_RATIO = 0.25;

export function circleOverlapArea(
  firstRadius: number,
  secondRadius: number,
  distance: number,
): number {
  if (distance >= firstRadius + secondRadius) return 0;
  if (distance <= Math.abs(firstRadius - secondRadius)) {
    const radius = Math.min(firstRadius, secondRadius);
    return Math.PI * radius * radius;
  }
  const firstArea =
    firstRadius *
    firstRadius *
    Math.acos(
      (distance * distance +
        firstRadius * firstRadius -
        secondRadius * secondRadius) /
        (2 * distance * firstRadius),
    );
  const secondArea =
    secondRadius *
    secondRadius *
    Math.acos(
      (distance * distance +
        secondRadius * secondRadius -
        firstRadius * firstRadius) /
        (2 * distance * secondRadius),
    );
  const overlapTriangle =
    0.5 *
    Math.sqrt(
      Math.max(
        0,
        (-distance + firstRadius + secondRadius) *
          (distance + firstRadius - secondRadius) *
          (distance - firstRadius + secondRadius) *
          (distance + firstRadius + secondRadius),
      ),
    );
  return firstArea + secondArea - overlapTriangle;
}

export function fireRadiusWorld(effect: UtilityEffect): number {
  const isIncendiary =
    effect.variant === "incendiary" || (!effect.variant && effect.team === 3);
  return isIncendiary ? INCENDIARY_RADIUS_WORLD : MOLOTOV_RADIUS_WORLD;
}

export function fireIsSmoked(
  fire: UtilityEffect,
  activeEffects: UtilityEffect[],
): boolean {
  const fireRadius = fireRadiusWorld(fire);
  const fireArea = Math.PI * fireRadius * fireRadius;
  return activeEffects.some((effect) => {
    if (effect.type !== "smoke") return false;
    const dx = fire.x - effect.x;
    const dy = fire.y - effect.y;
    const overlap = circleOverlapArea(
      fireRadius,
      SMOKE_RADIUS_WORLD,
      Math.hypot(dx, dy),
    );
    return overlap / fireArea > FIRE_SMOKE_EXTINGUISH_OVERLAP_RATIO;
  });
}
