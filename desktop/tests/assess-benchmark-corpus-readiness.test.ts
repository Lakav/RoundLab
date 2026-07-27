import { describe, expect, it } from "vitest";
import {
  assessBenchmarkCorpusReadiness,
  benchmarkReadinessPolicy,
} from "@/lib/analysis/assess-benchmark-corpus-readiness";
import type {
  BenchmarkCorpus,
  BenchmarkCorpusAudit,
  BenchmarkRoundOutcomeSample,
} from "@/lib/analysis/benchmark-types";

function corpus(
  strata: BenchmarkCorpusAudit["strata"],
  roundOutcomeSamples: BenchmarkRoundOutcomeSample[] = [],
  unavailableReasons: string[] = [],
): BenchmarkCorpus {
  return {
    specVersion: "roundlab.benchmarks.corpus.v1",
    generatedAt: "2026-07-27T10:00:00.000Z",
    samples: [],
    roundOutcomeSamples,
    audit: {
      matchCount: 20,
      playerCount: 50,
      sampleCount: 200,
      roundOutcomeSampleCount: roundOutcomeSamples.length,
      maps: ["de_test"],
      levels: ["level-10"],
      strata,
      unavailableReasons,
    },
  };
}

function outcomes(side: "T" | "CT", count: number): BenchmarkRoundOutcomeSample[] {
  return Array.from({ length: count }, (_, index) => ({
    sampleId: `match-${index}:r1:${side}`,
    matchId: `match-${index}`,
    roundNumber: 1,
    map: "de_test",
    level: "level-10",
    side,
    won: index % 2 === 0,
    playedAt: "2026-07-27T09:00:00.000Z",
    metricsSpecVersion: "roundlab.metrics.v1",
    inputSchemaVersion: "roundlab.replay.v2",
    parserVersion: "test",
  }));
}

describe("benchmark corpus readiness", () => {
  const policy = benchmarkReadinessPolicy(["de_test"], ["level-10"]);

  it("accepts only when every required side reaches every threshold", () => {
    const strata = (["CT", "T"] as const).map((side) => ({
      map: "de_test",
      level: "level-10",
      side,
      matchCount: 20,
      playerCount: 50,
      sampleCount: 100,
      playerRounds: 1_000,
    }));
    const result = assessBenchmarkCorpusReadiness(
      corpus(strata, [...outcomes("CT", 30), ...outcomes("T", 30)]),
      policy,
    );

    expect(result).toMatchObject({
      readinessVersion: "roundlab.benchmark-readiness.v1",
      ready: true,
      requiredStratumCount: 2,
      readyStratumCount: 2,
      unavailableReasons: [],
    });
    expect(result.strata.every((stratum) => stratum.ready)).toBe(true);
  });

  it("lists every failed threshold for a present but undersized stratum", () => {
    const result = assessBenchmarkCorpusReadiness(
      corpus([{
        map: "de_test",
        level: "level-10",
        side: "T",
        matchCount: 2,
        playerCount: 8,
        sampleCount: 10,
        playerRounds: 90,
      }], outcomes("T", 12)),
      policy,
    );

    expect(result.ready).toBe(false);
    expect(result.readyStratumCount).toBe(0);
    expect(result.strata.find((stratum) => stratum.side === "T"))
      .toMatchObject({
        unavailableReasons: [
          "insufficient_matches",
          "insufficient_players",
          "insufficient_player_samples",
          "insufficient_player_rounds",
          "insufficient_round_outcomes",
        ],
      });
  });

  it("materializes missing map, level and side combinations", () => {
    const expandedPolicy = benchmarkReadinessPolicy(
      ["de_test", "de_other"],
      ["level-10", "level-5"],
    );
    const result = assessBenchmarkCorpusReadiness(
      corpus([]),
      expandedPolicy,
    );

    expect(result.requiredStratumCount).toBe(8);
    expect(result.strata).toHaveLength(8);
    expect(result.strata[0]).toMatchObject({
      matchCount: 0,
      roundOutcomeCount: 0,
      incompatibleAnalysisSampleCount: 0,
      ready: false,
      unavailableReasons: expect.arrayContaining(["missing_stratum"]),
    });
  });

  it("rejects empty labels and invalid thresholds", () => {
    expect(() => benchmarkReadinessPolicy([], ["level-10"]))
      .toThrow("maps must contain non-empty labels");
    expect(() => benchmarkReadinessPolicy(
      ["de_test"],
      ["level-10"],
      { minimumMatchCount: 0 },
    )).toThrow("minimumMatchCount must be a positive integer");
  });

  it("preserves a corpus-wide unavailability reason", () => {
    const result = assessBenchmarkCorpusReadiness(
      corpus([], [], ["empty_corpus"]),
      policy,
    );

    expect(result.unavailableReasons).toEqual([
      "empty_corpus",
      "incomplete_required_strata",
    ]);
  });

  it("rejects legacy schemas and unknown parser versions", () => {
    const legacy = outcomes("T", 30);
    legacy[0].inputSchemaVersion = "roundlab.replay.legacy";
    legacy[0].parserVersion = "unknown";
    const result = assessBenchmarkCorpusReadiness(
      corpus([], legacy),
      policy,
    );

    expect(result.ready).toBe(false);
    expect(result.unavailableReasons).toContain(
      "incompatible_analysis_versions",
    );
    expect(result.strata.find((stratum) => stratum.side === "T"))
      .toMatchObject({
        incompatibleAnalysisSampleCount: 1,
        unavailableReasons: expect.arrayContaining([
          "incompatible_analysis_versions",
        ]),
      });
  });
});
