import { describe, expect, it } from "vitest";
import { aggregatePlayerHistory } from "@/lib/analysis/aggregate-player-history";
import {
  analyzePlayerTrends,
  PLAYER_TREND_MIN_SAMPLE_COUNT,
} from "@/lib/analysis/analyze-player-trends";
import type { BenchmarkPlayerSideSample } from "@/lib/analysis/benchmark-types";
import type { PlayerAnalysisMetrics } from "@/lib/analysis/types";

function sample(
  index: number,
  overrides: Partial<PlayerAnalysisMetrics> = {},
  map = "de_test",
  side: "T" | "CT" = "T",
): BenchmarkPlayerSideSample {
  const roundsPlayed = 10;
  return {
    sampleId: `m${index}:p1:${side}`,
    matchId: `m${index}`,
    playerId: "p1",
    map,
    level: "level-1",
    side,
    playedAt: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
    metricsSpecVersion: "roundlab.metrics.v1",
    inputSchemaVersion: "roundlab.replay.v2",
    parserVersion: "test",
    roundsPlayed,
    metrics: {
      roundsPlayed,
      kills: 10,
      deaths: 5,
      assists: 2,
      kdRatio: 2,
      headshotKills: 5,
      headshotRate: 0.5,
      damageHealth: 800,
      adr: 80,
      openingAttempts: 2,
      openingWins: 1,
      openingLosses: 1,
      multiKillRounds: null,
      survivedRounds: 5,
      survivalRate: 0.5,
      clutchOpportunities: null,
      clutchWins: null,
      clutchOutcomes: null,
      tradeAttempts: 2,
      tradeKills: 1,
      tradeDeaths: 0,
      kastRounds: 7,
      kastRate: 0.7,
      grenadesThrown: null,
      flashAssists: 0,
      utilitySavedOnDeath: null,
      ...overrides,
    },
  };
}

function trend(
  samples: BenchmarkPlayerSideSample[],
  metric: string,
) {
  return analyzePlayerTrends(
    aggregatePlayerHistory("p1", samples),
  ).trends.find((item) => item.metric === metric);
}

describe("player trends", () => {
  it("detects a significant monotonic improvement", () => {
    const samples = Array.from(
      { length: PLAYER_TREND_MIN_SAMPLE_COUNT },
      (_, index) => {
        const adr = 50 + index * 10;
        return sample(index, {
          damageHealth: adr * 10,
          adr,
        });
      },
    );
    const adr = trend(samples, "adr");

    expect(adr).toMatchObject({
      sampleCount: 8,
      firstValue: 50,
      lastValue: 120,
      kendallTau: 1,
      direction: "improving",
      unavailableReason: null,
    });
    expect(adr?.pValue).toBeLessThanOrEqual(0.05);
    expect(adr?.evidenceSampleIds).toHaveLength(8);
  });

  it("classifies increasing deaths as a regression", () => {
    const samples = Array.from(
      { length: PLAYER_TREND_MIN_SAMPLE_COUNT },
      (_, index) => sample(index, { deaths: index + 1 }),
    );
    const deaths = trend(samples, "deaths_per_round");

    expect(deaths).toMatchObject({
      orientation: "lower_is_better",
      kendallTau: 1,
      direction: "regressing",
    });
  });

  it("keeps a constant metric stable", () => {
    const samples = Array.from(
      { length: PLAYER_TREND_MIN_SAMPLE_COUNT },
      (_, index) => sample(index),
    );
    const kast = trend(samples, "kast_rate");

    expect(kast).toMatchObject({
      kendallTau: 0,
      zScore: 0,
      pValue: 1,
      direction: "stable",
    });
  });

  it("refuses to infer a trend below eight observations", () => {
    const samples = Array.from(
      { length: PLAYER_TREND_MIN_SAMPLE_COUNT - 1 },
      (_, index) => sample(index),
    );
    const analysis = analyzePlayerTrends(
      aggregatePlayerHistory("p1", samples),
    );

    expect(analysis.trends).toHaveLength(6);
    expect(analysis.trends.every(
      (item) =>
        item.direction === "unavailable" &&
        item.unavailableReason === "insufficient_metric_samples",
    )).toBe(true);
  });

  it("does not mix maps or sides and reports an empty history", () => {
    const mixed = [
      ...Array.from({ length: 8 }, (_, index) => sample(index)),
      ...Array.from(
        { length: 8 },
        (_, index) => sample(index + 8, {}, "de_other", "CT"),
      ),
    ];
    expect(analyzePlayerTrends(
      aggregatePlayerHistory("p1", mixed),
    ).trends).toHaveLength(12);

    expect(analyzePlayerTrends(
      aggregatePlayerHistory("missing", mixed),
    )).toMatchObject({
      trends: [],
      unavailableReasons: ["empty_player_history"],
    });
  });
});
