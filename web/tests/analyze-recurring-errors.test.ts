import { describe, expect, it } from "vitest";
import { aggregatePlayerHistory } from "@/lib/analysis/aggregate-player-history";
import {
  analyzeRecurringPlayerErrors,
  RECURRING_ERROR_WINDOW_SIZE,
} from "@/lib/analysis/analyze-recurring-errors";
import {
  BENCHMARK_SCORE_MIN_DISTRIBUTION_SAMPLES,
} from "@/lib/analysis/score-benchmark-sample";
import type {
  BenchmarkDistribution,
  BenchmarkMetricId,
  BenchmarkPlayerSideSample,
} from "@/lib/analysis/benchmark-types";

const METRICS: BenchmarkMetricId[] = [
  "kills_per_round",
  "deaths_per_round",
  "adr",
  "opening_win_rate",
  "trade_kill_rate",
  "kast_rate",
];

function sample(
  index: number,
  overrides: { adr?: number; deaths?: number } = {},
): BenchmarkPlayerSideSample {
  const roundsPlayed = 10;
  const adr = overrides.adr ?? 100;
  return {
    sampleId: `m${index}:p1:T`,
    matchId: `m${index}`,
    playerId: "p1",
    map: "de_test",
    level: "level-1",
    side: "T",
    playedAt: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
    metricsSpecVersion: "roundlab.metrics.v1",
    inputSchemaVersion: "roundlab.replay.v2",
    parserVersion: "test",
    roundsPlayed,
    metrics: {
      roundsPlayed,
      kills: 10,
      deaths: overrides.deaths ?? 5,
      assists: 2,
      kdRatio: 2,
      headshotKills: 5,
      headshotRate: 0.5,
      damageHealth: adr * roundsPlayed,
      adr,
      openingAttempts: 2,
      openingWins: 1,
      openingLosses: 1,
      multiKillRounds: null,
      survivedRounds: 5,
      survivalRate: 0.5,
      clutchOpportunities: null,
      clutchWins: null,
      tradeAttempts: 2,
      tradeKills: 1,
      tradeDeaths: 0,
      kastRounds: 7,
      kastRate: 0.7,
      grenadesThrown: null,
      flashAssists: 0,
      utilitySavedOnDeath: null,
    },
  };
}

function distributions(
  sampleCount = BENCHMARK_SCORE_MIN_DISTRIBUTION_SAMPLES,
): BenchmarkDistribution[] {
  const medians: Record<string, number> = {
    kills_per_round: 1,
    deaths_per_round: 0.5,
    adr: 100,
    opening_win_rate: 0.5,
    trade_kill_rate: 0.5,
    kast_rate: 0.7,
  };
  return METRICS.map((metric) => ({
    distributionId: `de_test:level-1:T:${metric}`,
    map: "de_test",
    level: "level-1",
    side: "T",
    metric,
    values: Array.from({ length: sampleCount }, () => medians[metric]),
    sampleCount,
    excludedSampleCount: 0,
  }));
}

describe("recurring player errors", () => {
  it("detects three weak results in the last five comparable samples", () => {
    const samples = Array.from({ length: 7 }, (_, index) =>
      sample(index, { adr: index < 5 ? 50 : 100 })
    );
    const analysis = analyzeRecurringPlayerErrors(
      aggregatePlayerHistory("p1", samples),
      distributions(),
    );

    expect(analysis.errors).toEqual([{
      errorId: "de_test:level-1:T:adr:recurring",
      category: "benchmark_weakness",
      map: "de_test",
      level: "level-1",
      side: "T",
      metric: "adr",
      windowSampleCount: RECURRING_ERROR_WINDOW_SIZE,
      weakSampleCount: 3,
      weakRate: 0.6,
      meanOrientedPercentile: 20,
      firstPlayedAt: "2026-07-03T10:00:00.000Z",
      lastPlayedAt: "2026-07-07T10:00:00.000Z",
      evidenceSampleIds: ["m2:p1:T", "m3:p1:T", "m4:p1:T"],
    }]);
    expect(analysis.unavailableSeries).toEqual([]);
  });

  it("does not call two weak matches a recurring error", () => {
    const samples = Array.from({ length: 7 }, (_, index) =>
      sample(index, { adr: index >= 5 ? 50 : 100 })
    );

    expect(analyzeRecurringPlayerErrors(
      aggregatePlayerHistory("p1", samples),
      distributions(),
    ).errors).toEqual([]);
  });

  it("uses the reversed orientation for repeated excessive deaths", () => {
    const samples = Array.from({ length: 5 }, (_, index) =>
      sample(index, { deaths: 10 })
    );
    const [error] = analyzeRecurringPlayerErrors(
      aggregatePlayerHistory("p1", samples),
      distributions(),
    ).errors;

    expect(error).toMatchObject({
      metric: "deaths_per_round",
      weakSampleCount: 5,
      meanOrientedPercentile: 0,
    });
  });

  it("reports series unavailable when benchmarks are too small", () => {
    const samples = Array.from({ length: 5 }, (_, index) => sample(index));
    const analysis = analyzeRecurringPlayerErrors(
      aggregatePlayerHistory("p1", samples),
      distributions(BENCHMARK_SCORE_MIN_DISTRIBUTION_SAMPLES - 1),
    );

    expect(analysis.errors).toEqual([]);
    expect(analysis.unavailableSeries).toHaveLength(6);
  });

  it("reports an empty history", () => {
    expect(analyzeRecurringPlayerErrors(
      aggregatePlayerHistory("missing", []),
      distributions(),
    )).toMatchObject({
      errors: [],
      unavailableSeries: [],
      unavailableReasons: ["empty_player_history"],
    });
  });
});
