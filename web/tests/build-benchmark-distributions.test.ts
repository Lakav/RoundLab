import { describe, expect, it } from "vitest";
import { buildBenchmarkDistributions } from "@/lib/analysis/build-benchmark-distributions";
import type {
  BenchmarkCorpus,
  BenchmarkPlayerSideSample,
} from "@/lib/analysis/benchmark-types";
import type { PlayerAnalysisMetrics } from "@/lib/analysis/types";

function sample(
  sampleId: string,
  map: string,
  level: string,
  side: "T" | "CT",
  overrides: Partial<PlayerAnalysisMetrics> = {},
): BenchmarkPlayerSideSample {
  return {
    sampleId,
    matchId: sampleId.split(":")[0],
    playerId: sampleId,
    map,
    level,
    side,
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
      grenadesThrown: {
        total: 5,
        flash: 1,
        smoke: 1,
        he: 1,
        molotov: 1,
        incendiary: 1,
        decoy: 0,
      },
      flashAssists: 1,
      utilitySavedOnDeath: null,
      ...overrides,
    },
  };
}

function corpus(samples: BenchmarkPlayerSideSample[]): BenchmarkCorpus {
  return {
    specVersion: "roundlab.benchmarks.corpus.v1",
    generatedAt: "2026-07-27T10:00:00.000Z",
    samples,
    roundOutcomeSamples: [],
    audit: {
      matchCount: 2,
      playerCount: 2,
      sampleCount: samples.length,
      roundOutcomeSampleCount: 0,
      maps: [],
      levels: [],
      strata: [],
      unavailableReasons: [],
    },
  };
}

describe("benchmark distributions", () => {
  it("separates values by map, level and side", () => {
    const distributions = buildBenchmarkDistributions(corpus([
      sample("m1:p1:T", "de_a", "level-1", "T", { kills: 5 }),
      sample("m2:p2:T", "de_a", "level-1", "T", { kills: 15 }),
      sample("m3:p3:CT", "de_a", "level-1", "CT", { kills: 20 }),
      sample("m4:p4:T", "de_b", "level-2", "T", { kills: 30 }),
    ]));

    expect(distributions.find(
      (item) =>
        item.map === "de_a" &&
        item.level === "level-1" &&
        item.side === "T" &&
        item.metric === "kills_per_round",
    )).toMatchObject({
      values: [0.5, 1.5],
      sampleCount: 2,
      excludedSampleCount: 0,
    });
    expect(distributions.filter(
      (item) => item.metric === "kills_per_round",
    )).toHaveLength(3);
  });

  it("excludes unavailable ratios instead of replacing them with zero", () => {
    const [openingDistribution] = buildBenchmarkDistributions(corpus([
      sample("m1:p1:T", "de_a", "level-1", "T", {
        openingAttempts: 0,
        openingWins: 0,
      }),
    ])).filter((item) => item.metric === "opening_win_rate");

    expect(openingDistribution).toMatchObject({
      values: [],
      sampleCount: 0,
      excludedSampleCount: 1,
    });
  });
});
