import type { UtilityEffect } from "@/lib/types";

const SMOKE_BLAST_CLEAR_SECONDS = 3.0;
const SMOKE_BLAST_RADIUS_WORLD = 220;
const SMOKE_BLAST_CLEAR_ALPHA = 0.12;

export function smokeBlastClearAlpha(
  smoke: UtilityEffect,
  effects: UtilityEffect[],
  time: number,
): number {
  const clear = effects.some((effect) => {
    if (effect.type !== "he") return false;
    if (effect.start > time || time - effect.start > SMOKE_BLAST_CLEAR_SECONDS) return false;
    return Math.hypot(effect.x - smoke.x, effect.y - smoke.y) <= SMOKE_BLAST_RADIUS_WORLD;
  });
  return clear ? SMOKE_BLAST_CLEAR_ALPHA : 1;
}
