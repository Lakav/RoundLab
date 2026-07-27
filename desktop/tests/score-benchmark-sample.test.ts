import { describe, expect, it } from "vitest";
import {
  BENCHMARK_SCORE_MIN_DISTRIBUTION_SAMPLES,
  scoreBenchmarkSample,
} from "@/lib/analysis/score-benchmark-sample";
import type {
  BenchmarkDistribution,
  BenchmarkMetricId,
  BenchmarkPlayerSideSample,
} from "@/lib/analysis/benchmark-types";
import type { PlayerAnalysisMetrics } from "@/lib/analysis/types";

const SCORE_METRICS: BenchmarkMetricId[] = [
  "kills_per_round",
  "deaths_per_round",
  "adr",
  "opening_win_rate",
  "trade_kill_rate",
  "kast_rate",
];

function sample(): BenchmarkPlayerSideSample {
  return {
    sampleId: "target:p1:T",
    matchId: "target",
    playerId: "p1",
    map: "de_test",
    level: "level-1",
    side: "T",
    playedAt: "2026-07-27T09:00:00.000Z",
    metricsSpecVersion: "roundlab.metrics.v1",
    inputSchemaVersion: "roundlab.replay.v2",
    parserVersion: "test",
    roundsPlayed: 10,
    metrics: {
      roundsPlayed: 10,
      kills: 10,
      deaths: 5,
      assists: 2,
      kdRatio: 2,
      headshotKills: 5,
      headshotRate: 0.5,
      damageHealth: 1_000,
      adr: 100,
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
    } satisfies PlayerAnalysisMetrics,
  };
}

function distributions(
  benchmarkValues: Partial<Record<BenchmarkMetricId, number>>,
  sampleCount = BENCHMARK_SCORE_MIN_DISTRIBUTION_SAMPLES,
): BenchmarkDistribution[] {
  return SCORE_METRICS.map((metric) => ({
    distributionId: `de_test:level-1:T:${metric}`,
    map: "de_test",
    level: "level-1",
    side: "T",
    metric,
    values: Array.from(
      { length: sampleCount },
      () => benchmarkValues[metric] ?? 0,
    ),
    sampleCount,
    excludedSampleCount: 0,
  }));
}

describe("benchmark score explanations", () => {
  it("returns a neutral score and neutral contributions at every median", () => {
    const result = scoreBenchmarkSample(sample(), distributions({
      kills_per_round: 1,
      deaths_per_round: 0.5,
      adr: 100,
      opening_win_rate: 0.5,
      trade_kill_rate: 0.5,
      kast_rate: 0.7,
    }));

    expect(result.score).toBe(50);
    expect(result.unavailableReasons).toEqual([]);
    expect(result.contributions).toHaveLength(6);
    expect(result.contributions.every(
      (contribution) =>
        contribution.percentile === 50 &&
        contribution.points === 0 &&
        contribution.impact === "neutral",
    )).toBe(true);
  });

  it("explains gains and correctly reverses deaths per round", () => {
    const result = scoreBenchmarkSample(sample(), distributions({
      kills_per_round: 0.5,
      deaths_per_round: 1,
      adr: 50,
      opening_win_rate: 0.25,
      trade_kill_rate: 0.25,
      kast_rate: 0.5,
    }));

    expect(result.score).toBe(100);
    expect(result.contributions.every(
      (contribution) =>
        contribution.orientedPercentile === 100 &&
        contribution.points > 0 &&
        contribution.impact === "gain",
    )).toBe(true);
    expect(result.contributions.find(
      (contribution) => contribution.metric === "deaths_per_round",
    )?.orientation).toBe("lower_is_better");
  });

  it("refuses a score when one distribution is missing", () => {
    const source = distributions({});
    source.pop();
    const result = scoreBenchmarkSample(sample(), source);

    expect(result.score).toBeNull();
    expect(result.unavailableReasons).toEqual([
      "missing_distribution:kast_rate",
    ]);
    expect(result.contributions).toHaveLength(5);
  });

  it("refuses weak distributions instead of fabricating a score", () => {
    const result = scoreBenchmarkSample(
      sample(),
      distributions({}, BENCHMARK_SCORE_MIN_DISTRIBUTION_SAMPLES - 1),
    );

    expect(result.score).toBeNull();
    expect(result.contributions).toEqual([]);
    expect(result.unavailableReasons).toHaveLength(6);
    expect(result.unavailableReasons.every(
      (reason) => reason.startsWith("insufficient_distribution_samples:"),
    )).toBe(true);
  });

  it("reports a missing source metric explicitly", () => {
    const target = sample();
    target.metrics.openingAttempts = 0;
    target.metrics.openingWins = 0;
    const result = scoreBenchmarkSample(target, distributions({}));

    expect(result.score).toBeNull();
    expect(result.unavailableReasons).toContain(
      "missing_metric:opening_win_rate",
    );
  });
});
