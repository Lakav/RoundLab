import { analyzeMatch } from "./analyze-match.ts";
import type {
  BenchmarkCollectionManifestEntry,
} from "./benchmark-types.ts";
import type { MatchAnalysis } from "./types.ts";
import type { MatchData, PlayerId } from "../types.ts";

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

export type BenchmarkContributionPackage = {
  contributionVersion: typeof BENCHMARK_CONTRIBUTION_VERSION;
  entry: BenchmarkCollectionManifestEntry;
  analysis: MatchAnalysis;
  privacy: {
    scope: "consenting_player_only";
    identity: "random_contributor_id";
    otherPlayersRemoved: true;
    steamIdsRemoved: true;
  };
  levelSource: BenchmarkContributionSettings["levelSource"];
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

function requiredTimestamp(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a valid timestamp.`);
  }
  return new Date(parsed).toISOString();
}

function requiredLabel(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty.`);
  return normalized;
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

function samePlayer(left: PlayerId, right: string): boolean {
  return String(left) === right;
}

function sanitizedAnalysis(
  match: MatchData,
  selectedPlayerId: string,
  contributorId: string,
  contributionId: string,
  generatedAt: string,
): MatchAnalysis {
  const source = analyzeMatch(match, {
    matchId: contributionId,
    generatedAt,
  });
  const player = source.players.find((item) =>
    samePlayer(item.playerId, selectedPlayerId)
  );
  if (!player) {
    throw new Error("Selected player is not present in this match.");
  }
  return {
    ...source,
    matchId: contributionId,
    players: [{
      ...player,
      playerId: contributorId,
      name: "Contributor",
    }],
    teams: [],
    rounds: source.rounds.map((round) => ({
      ...round,
      players: [],
      economy: [],
      keyMoments: [],
      evidenceIds: [],
    })),
    economyRounds: [],
    keyMoments: [],
    evidence: [],
  };
}

export function buildBenchmarkContributionPackage(
  match: MatchData,
  settings: BenchmarkContributionSettings,
  contributionId: string,
  generatedAt: string,
): BenchmarkContributionPackage {
  if (
    match.schemaVersion !== "roundlab.replay.v2"
    || !match.parserVersion
    || match.parserVersion === "unknown"
  ) {
    throw new Error(
      "Benchmark contributions require a modern replay and a known parser version.",
    );
  }
  const normalizedSettings = normalizeBenchmarkContributionSettings(settings);
  if (!normalizedSettings) {
    throw new Error("Benchmark contribution settings are invalid.");
  }
  const normalizedContributionId = requiredLabel(
    contributionId,
    "contributionId",
  );
  const normalizedGeneratedAt = requiredTimestamp(generatedAt, "generatedAt");
  const selectedPlayerId = requiredLabel(
    normalizedSettings.selectedPlayerId,
    "selectedPlayerId",
  );
  const contributorId = requiredLabel(
    normalizedSettings.contributorId,
    "contributorId",
  );
  const level = requiredLabel(normalizedSettings.level, "level");
  const playedAt = requiredTimestamp(normalizedSettings.playedAt, "playedAt");
  const consentedAt = requiredTimestamp(
    normalizedSettings.consentedAt,
    "consentedAt",
  );
  const analysis = sanitizedAnalysis(
    match,
    selectedPlayerId,
    contributorId,
    normalizedContributionId,
    normalizedGeneratedAt,
  );
  return {
    contributionVersion: BENCHMARK_CONTRIBUTION_VERSION,
    entry: {
      analysisPath: `analyses/${normalizedContributionId}.json`,
      map: requiredLabel(match.meta.map, "map"),
      level,
      playedAt,
      provenance: {
        sourceType: "player_upload",
        sourceReference: normalizedContributionId,
        authorizationBasis: "player_consent",
        collectedAt: consentedAt,
      },
    },
    analysis,
    privacy: {
      scope: "consenting_player_only",
      identity: "random_contributor_id",
      otherPlayersRemoved: true,
      steamIdsRemoved: true,
    },
    levelSource: normalizedSettings.levelSource,
  };
}
