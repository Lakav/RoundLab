import { describe, expect, it } from "vitest";
import {
  buildWinProbabilityModels,
  WIN_PROBABILITY_MIN_ROUND_SAMPLES,
} from "@/lib/analysis/build-win-probability-model";
import type {
  BenchmarkCorpus,
  BenchmarkRoundOutcomeSample,
} from "@/lib/analysis/benchmark-types";

function roundSamples(
  count: number,
  wins: number,
  map = "de_test",
  level = "level-1",
  side: "T" | "CT" = "T",
): BenchmarkRoundOutcomeSample[] {
  return Array.from({ length: count }, (_, index) => ({
    sampleId: `match-${index}:r1:${side}`,
    matchId: `match-${index}`,
    roundNumber: 1,
    map,
    level,
    side,
    won: index < wins,
    playedAt: "2026-07-27T09:00:00.000Z",
    metricsSpecVersion: "roundlab.metrics.v1",
    inputSchemaVersion: "roundlab.replay.v2",
    parserVersion: "test",
  }));
}

function corpus(
  roundOutcomeSamples: BenchmarkRoundOutcomeSample[],
): BenchmarkCorpus {
  return {
    specVersion: "roundlab.benchmarks.corpus.v1",
    generatedAt: "2026-07-27T10:00:00.000Z",
    samples: [],
    roundOutcomeSamples,
    audit: {
      matchCount: 0,
      playerCount: 0,
      sampleCount: 0,
      roundOutcomeSampleCount: roundOutcomeSamples.length,
      maps: [],
      levels: [],
      strata: [],
      unavailableReasons: [],
    },
  };
}

describe("win probability baseline", () => {
  it("estimates a balanced stratum with a Wilson interval", () => {
    const [model] = buildWinProbabilityModels(corpus(
      roundSamples(WIN_PROBABILITY_MIN_ROUND_SAMPLES, 15),
    ));

    expect(model).toMatchObject({
      modelVersion: "roundlab.win-probability.wilson.v1",
      sampleCount: 30,
      winCount: 15,
      probability: 0.5,
      unavailableReason: null,
      confidenceInterval: {
        confidenceLevel: 0.95,
        method: "wilson_score",
      },
    });
    expect(model.confidenceInterval?.lower).toBeLessThan(0.5);
    expect(model.confidenceInterval?.upper).toBeGreaterThan(0.5);
  });

  it("withholds a model below thirty round samples", () => {
    const [model] = buildWinProbabilityModels(corpus(
      roundSamples(WIN_PROBABILITY_MIN_ROUND_SAMPLES - 1, 20),
    ));

    expect(model).toMatchObject({
      probability: null,
      confidenceInterval: null,
      unavailableReason: "insufficient_round_samples",
    });
  });

  it("keeps extreme probabilities inside open finite bounds", () => {
    const [model] = buildWinProbabilityModels(corpus(roundSamples(30, 30)));

    expect(model.probability).toBeGreaterThan(0);
    expect(model.probability).toBeLessThan(1);
    expect(model.confidenceInterval?.lower).toBeGreaterThanOrEqual(0);
    expect(model.confidenceInterval?.upper).toBeLessThanOrEqual(1);
  });

  it("never mixes maps, levels or sides", () => {
    const models = buildWinProbabilityModels(corpus([
      ...roundSamples(30, 15, "de_a", "level-1", "T"),
      ...roundSamples(30, 20, "de_a", "level-1", "CT"),
      ...roundSamples(30, 10, "de_b", "level-2", "T"),
    ]));

    expect(models).toHaveLength(3);
    expect(models.map((model) => [
      model.map,
      model.level,
      model.side,
      model.winCount,
    ])).toEqual([
      ["de_a", "level-1", "CT", 20],
      ["de_a", "level-1", "T", 15],
      ["de_b", "level-2", "T", 10],
    ]);
  });
});
