import {
  BENCHMARK_CORPUS_SPEC_VERSION,
  type BenchmarkCorpus,
  type BenchmarkCorpusAudit,
  type BenchmarkMatchInput,
  type BenchmarkPlayerSideSample,
  type BenchmarkRoundOutcomeSample,
  type BenchmarkStratumCoverage,
} from "./benchmark-types.ts";

function requiredLabel(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Benchmark ${field} must not be empty.`);
  }
  return normalized;
}

function requiredTimestamp(value: string): string {
  const normalized = value.trim();
  const timestamp = Date.parse(normalized);
  if (normalized.length === 0 || !Number.isFinite(timestamp)) {
    throw new Error("Benchmark playedAt must be a valid timestamp.");
  }
  return new Date(timestamp).toISOString();
}

function sampleId(
  matchId: string,
  playerId: string,
  side: "T" | "CT",
): string {
  return `${matchId}:${playerId}:${side}`;
}

function auditCorpus(
  samples: BenchmarkPlayerSideSample[],
  roundOutcomeSamples: BenchmarkRoundOutcomeSample[],
  matchCount: number,
): BenchmarkCorpusAudit {
  const strata = new Map<
    string,
    BenchmarkStratumCoverage & {
      matchIds: Set<string>;
      playerIds: Set<string>;
    }
  >();
  for (const sample of samples) {
    const key = `${sample.map}\u0000${sample.level}\u0000${sample.side}`;
    const stratum = strata.get(key) ?? {
      map: sample.map,
      level: sample.level,
      side: sample.side,
      matchCount: 0,
      playerCount: 0,
      sampleCount: 0,
      playerRounds: 0,
      matchIds: new Set<string>(),
      playerIds: new Set<string>(),
    };
    stratum.matchIds.add(sample.matchId);
    stratum.playerIds.add(sample.playerId);
    stratum.sampleCount++;
    stratum.playerRounds += sample.roundsPlayed;
    strata.set(key, stratum);
  }
  const finalizedStrata = [...strata.values()]
    .map(({ matchIds, playerIds, ...stratum }) => ({
      ...stratum,
      matchCount: matchIds.size,
      playerCount: playerIds.size,
    }))
    .sort(
      (left, right) =>
        left.map.localeCompare(right.map) ||
        left.level.localeCompare(right.level) ||
        left.side.localeCompare(right.side),
    );
  const unavailableReasons: string[] = [];
  if (matchCount === 0) unavailableReasons.push("empty_corpus");
  if (samples.length === 0 && matchCount > 0) {
    unavailableReasons.push("missing_player_side_samples");
  }
  return {
    matchCount,
    playerCount: new Set(samples.map((sample) => sample.playerId)).size,
    sampleCount: samples.length,
    roundOutcomeSampleCount: roundOutcomeSamples.length,
    maps: [...new Set(samples.map((sample) => sample.map))].sort(),
    levels: [...new Set(samples.map((sample) => sample.level))].sort(),
    strata: finalizedStrata,
    unavailableReasons,
  };
}

export function buildBenchmarkCorpus(
  inputs: BenchmarkMatchInput[],
  generatedAt: string,
): BenchmarkCorpus {
  const seenMatchIds = new Set<string>();
  const samples: BenchmarkPlayerSideSample[] = [];
  const roundOutcomeSamples: BenchmarkRoundOutcomeSample[] = [];
  for (const input of inputs) {
    const matchId = requiredLabel(input.analysis.matchId, "matchId");
    if (seenMatchIds.has(matchId)) {
      throw new Error(`Duplicate benchmark matchId: ${matchId}`);
    }
    seenMatchIds.add(matchId);
    const map = requiredLabel(input.map, "map");
    const level = requiredLabel(input.level, "level");
    const playedAt = requiredTimestamp(input.playedAt);
    for (const round of input.analysis.rounds) {
      if (round.winner !== "T" && round.winner !== "CT") continue;
      for (const side of ["T", "CT"] as const) {
        roundOutcomeSamples.push({
          sampleId: `${matchId}:r${round.roundNumber}:${side}`,
          matchId,
          roundNumber: round.roundNumber,
          map,
          level,
          side,
          won: round.winner === side,
          playedAt,
          metricsSpecVersion: input.analysis.specVersion,
          inputSchemaVersion: input.analysis.inputSchemaVersion,
          parserVersion: input.analysis.parserVersion,
        });
      }
    }
    for (const player of input.analysis.players) {
      for (const side of ["T", "CT"] as const) {
        const sideAnalysis = player.bySide[side];
        if (
          sideAnalysis === null ||
          sideAnalysis.metrics.roundsPlayed <= 0
        ) {
          continue;
        }
        samples.push({
          sampleId: sampleId(matchId, player.playerId, side),
          matchId,
          playerId: player.playerId,
          map,
          level,
          side,
          playedAt,
          metricsSpecVersion: input.analysis.specVersion,
          inputSchemaVersion: input.analysis.inputSchemaVersion,
          parserVersion: input.analysis.parserVersion,
          roundsPlayed: sideAnalysis.metrics.roundsPlayed,
          metrics: sideAnalysis.metrics,
        });
      }
    }
  }
  samples.sort(
    (left, right) =>
      left.map.localeCompare(right.map) ||
      left.level.localeCompare(right.level) ||
      left.side.localeCompare(right.side) ||
      left.playedAt.localeCompare(right.playedAt) ||
      left.matchId.localeCompare(right.matchId) ||
      left.playerId.localeCompare(right.playerId),
  );
  roundOutcomeSamples.sort(
    (left, right) =>
      left.map.localeCompare(right.map) ||
      left.level.localeCompare(right.level) ||
      left.side.localeCompare(right.side) ||
      left.playedAt.localeCompare(right.playedAt) ||
      left.matchId.localeCompare(right.matchId) ||
      left.roundNumber - right.roundNumber,
  );
  return {
    specVersion: BENCHMARK_CORPUS_SPEC_VERSION,
    generatedAt,
    samples,
    roundOutcomeSamples,
    audit: auditCorpus(samples, roundOutcomeSamples, seenMatchIds.size),
  };
}
