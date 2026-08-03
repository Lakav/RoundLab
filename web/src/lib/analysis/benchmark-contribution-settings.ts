export const BENCHMARK_CONTRIBUTION_VERSION =
  "roundlab.benchmark-contribution.v1" as const;

export type BenchmarkContributionSettings = {
  selectedPlayerId: string;
  contributorId: string;
  level: string;
  levelSource: "self_reported_faceit" | "self_reported_premier";
  playedAt: string;
  consentedAt: string;
};

export function normalizeBenchmarkContributionSettings(
  value: unknown,
): BenchmarkContributionSettings | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  if (
    typeof source.selectedPlayerId !== "string"
    || !source.selectedPlayerId.trim()
    || typeof source.contributorId !== "string"
    || !source.contributorId.trim()
    || typeof source.level !== "string"
    || !source.level.trim()
    || (
      source.levelSource !== "self_reported_faceit"
      && source.levelSource !== "self_reported_premier"
    )
    || typeof source.playedAt !== "string"
    || !Number.isFinite(Date.parse(source.playedAt))
    || typeof source.consentedAt !== "string"
    || !Number.isFinite(Date.parse(source.consentedAt))
  ) {
    return null;
  }
  if (
    source.levelSource === "self_reported_faceit"
    && !/^faceit-level-(?:[1-9]|10)$/u.test(source.level.trim())
  ) {
    return null;
  }
  if (
    source.levelSource === "self_reported_premier"
    && !/^premier-(?:[0-9]+)-(?:[0-9]+)$/u.test(source.level.trim())
  ) {
    return null;
  }
  return {
    selectedPlayerId: source.selectedPlayerId.trim(),
    contributorId: source.contributorId.trim(),
    level: source.level.trim(),
    levelSource: source.levelSource,
    playedAt: new Date(Date.parse(source.playedAt)).toISOString(),
    consentedAt: new Date(Date.parse(source.consentedAt)).toISOString(),
  };
}

export function faceitBenchmarkLevel(level: number): string {
  if (!Number.isSafeInteger(level) || level < 1 || level > 10) {
    throw new Error("FACEIT level must be an integer from 1 to 10.");
  }
  return `faceit-level-${level}`;
}

export function premierBenchmarkLevel(rating: number): string {
  if (!Number.isSafeInteger(rating) || rating < 0 || rating > 50_000) {
    throw new Error("Premier rating must be an integer from 0 to 50000.");
  }
  const lower = Math.min(45_000, Math.floor(rating / 5_000) * 5_000);
  const upper = lower + 4_999;
  return `premier-${lower}-${upper}`;
}
