import type {
  FlashMetrics,
  GrenadeCounts,
  UtilityDamageMetrics,
} from "./types.ts";

export const EFFECTIVE_FLASH_MIN_DURATION_SECONDS = 1.1;

export function utilityQuantityRating(
  grenades: GrenadeCounts | null,
  roundsPlayed: number,
): number | null {
  if (grenades === null || roundsPlayed <= 0) return null;
  const thrownWithoutDecoys = Math.max(0, grenades.total - grenades.decoy);
  const ratioToThreePerRound = Math.min(
    1,
    thrownWithoutDecoys / roundsPlayed / 3,
  );
  return Math.pow(ratioToThreePerRound, 2 / 3) * 100;
}

export function flashMetrics(
  enemiesFlashed: number,
  teammatesFlashed: number,
  effectiveEnemiesFlashed: number,
  effectiveTeammatesFlashed: number,
  enemyBlindDuration: number,
  teammateBlindDuration: number,
  enemyBlindFlashCount: number,
  longestEnemyBlindDuration: number,
  flashesLeadingToKills: number,
): FlashMetrics {
  return {
    enemiesFlashed,
    teammatesFlashed,
    effectiveEnemiesFlashed,
    effectiveTeammatesFlashed,
    enemyBlindDuration,
    teammateBlindDuration,
    enemyBlindFlashCount,
    longestEnemyBlindDuration,
    flashesLeadingToKills,
    averageEnemyBlindDuration: enemyBlindFlashCount === 0
      ? null
      : longestEnemyBlindDuration / enemyBlindFlashCount,
    averageTeammateBlindDuration: teammatesFlashed === 0
      ? null
      : teammateBlindDuration / teammatesFlashed,
  };
}

export function utilityDamageMetrics(
  heDamage: number,
  fireDamage: number,
  teammateHeDamage: number,
  teammateFireDamage: number,
): UtilityDamageMetrics {
  return { heDamage, fireDamage, teammateHeDamage, teammateFireDamage };
}

export type GrenadeKind = Exclude<keyof GrenadeCounts, "total">;

export function grenadeKind(weapon: string | undefined): GrenadeKind | null {
  const normalized = weapon?.toLowerCase().replace(/^weapon_/, "").replaceAll("-", "_");
  if (normalized === "flashbang" || normalized === "flash") return "flash";
  if (normalized === "smokegrenade" || normalized === "smoke") return "smoke";
  if (normalized === "hegrenade" || normalized === "he") return "he";
  if (normalized === "molotov") return "molotov";
  if (
    normalized === "incgrenade" ||
    normalized === "incendiary" ||
    normalized === "incendiarygrenade"
  ) return "incendiary";
  if (normalized === "decoy" || normalized === "decoygrenade") return "decoy";
  return null;
}

export function grenadeValue(kind: GrenadeKind): number {
  if (kind === "flash") return 200;
  if (kind === "smoke" || kind === "he") return 300;
  if (kind === "molotov") return 400;
  if (kind === "incendiary") return 500;
  return 50;
}

export function utilityDamageKind(
  weapon: string | undefined,
): "he" | "fire" | null {
  const normalized = weapon?.toLowerCase().replace(/^weapon_/, "").replaceAll("-", "_");
  if (normalized === "hegrenade" || normalized === "he") return "he";
  if (
    normalized === "molotov" ||
    normalized === "incgrenade" ||
    normalized === "incendiary" ||
    normalized === "inferno"
  ) return "fire";
  return null;
}
