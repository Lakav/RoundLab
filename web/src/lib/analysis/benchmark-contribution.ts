import { analyzeMatch } from "./analyze-match.ts";
import type {
  BenchmarkCollectionManifestEntry,
} from "./benchmark-types.ts";
import type { MatchAnalysis } from "./types.ts";
import type { MatchData, PlayerId } from "../types.ts";
import {
  BENCHMARK_CONTRIBUTION_VERSION,
  normalizeBenchmarkContributionSettings,
  type BenchmarkContributionSettings,
} from "./benchmark-contribution-settings.ts";

export {
  BENCHMARK_CONTRIBUTION_VERSION,
  faceitBenchmarkLevel,
  normalizeBenchmarkContributionSettings,
  premierBenchmarkLevel,
  type BenchmarkContributionSettings,
} from "./benchmark-contribution-settings.ts";

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
