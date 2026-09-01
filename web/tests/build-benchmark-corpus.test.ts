import { describe, expect, it } from "vitest";
import { buildBenchmarkCorpus } from "@/lib/analysis/build-benchmark-corpus";
import type { BenchmarkMatchInput } from "@/lib/analysis/benchmark-types";
import type {
  MatchAnalysis,
  PlayerAnalysisMetrics,
} from "@/lib/analysis/types";

function metrics(roundsPlayed: number): PlayerAnalysisMetrics {
  return {
    roundsPlayed,
    kills: 10,
    deaths: 8,
    assists: 3,
    kdRatio: 1.25,
    headshotKills: 5,
    headshotRate: 0.5,
    damageHealth: 900,
    adr: 90,
    openingAttempts: 2,
    openingWins: 1,
    openingLosses: 1,
    multiKillRounds: { two: 1, three: 0, four: 0, fivePlus: 0 },
    survivedRounds: 4,
    survivalRate: 0.4,
    clutchOpportunities: {
      oneVsOne: 0,
      oneVsTwo: 0,
      oneVsThree: 0,
      oneVsFour: 0,
      oneVsFivePlus: 0,
    },
    clutchWins: {
      oneVsOne: 0,
      oneVsTwo: 0,
      oneVsThree: 0,
      oneVsFour: 0,
      oneVsFivePlus: 0,
    },
    clutchOutcomes: {
      won: 0,
      lost: 0,
      saved: 0,
      died: 0,
      afterPlant: 0,
      wonByDefuse: 0,
      wonByExplosion: 0,
    },
    tradeAttempts: 1,
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
      incendiary: 0,
      decoy: 1,
    },
    flashAssists: 1,
    utilitySavedOnDeath: {
      total: 0,
      flash: 0,
      smoke: 0,
      he: 0,
      molotov: 0,
      incendiary: 0,
      decoy: 0,
    },
  };
}

function input(matchId: string): BenchmarkMatchInput {
  const analysis = {
    specVersion: "roundlab.metrics.v1",
    inputSchemaVersion: "roundlab.replay.v2",
    parserVersion: "test",
    matchId,
    generatedAt: "2026-07-27T00:00:00.000Z",
    players: [{
      playerId: "p1",
      name: "One",
      metrics: metrics(20),
      metricEvidence: {},
      unavailableReasons: [],
      bySide: {
        T: {
          metrics: metrics(10),
          metricEvidence: {},
          unavailableReasons: [],
        },
        CT: {
          metrics: metrics(10),
          metricEvidence: {},
          unavailableReasons: [],
        },
      },
      byEconomy: {},
    }],
    teams: [],
    rounds: [],
    economyRounds: [],
    keyMoments: [],
    evidence: [],
  } as unknown as MatchAnalysis;
  return {
    analysis,
    map: "de_test",
    level: "level-10",
    playedAt: "2026-07-27T09:00:00.000Z",
  };
}

describe("benchmark corpus", () => {
  it("creates one auditable sample per player, match and side", () => {
    const corpus = buildBenchmarkCorpus(
      [input("match-2"), input("match-1")],
      "2026-07-27T10:00:00.000Z",
    );

    expect(corpus.specVersion).toBe("roundlab.benchmarks.corpus.v1");
    expect(corpus.samples).toHaveLength(4);
    expect(corpus.audit).toMatchObject({
      matchCount: 2,
      playerCount: 1,
      sampleCount: 4,
      roundOutcomeSampleCount: 0,
      maps: ["de_test"],
      levels: ["level-10"],
      unavailableReasons: [],
    });
    expect(corpus.audit.strata).toEqual([
      {
        map: "de_test",
        level: "level-10",
        side: "CT",
        matchCount: 2,
        playerCount: 1,
        sampleCount: 2,
        playerRounds: 20,
      },
      {
        map: "de_test",
        level: "level-10",
        side: "T",
        matchCount: 2,
        playerCount: 1,
        sampleCount: 2,
        playerRounds: 20,
      },
    ]);
  });

  it("rejects duplicate matches and empty stratification labels", () => {
    expect(() => buildBenchmarkCorpus(
      [input("same"), input("same")],
      "2026-07-27T10:00:00.000Z",
    )).toThrow("Duplicate benchmark matchId");
    expect(() => buildBenchmarkCorpus(
      [{ ...input("match"), level: " " }],
      "2026-07-27T10:00:00.000Z",
    )).toThrow("Benchmark level must not be empty");
    expect(() => buildBenchmarkCorpus(
      [{ ...input("match-date"), playedAt: "not-a-date" }],
      "2026-07-27T10:00:00.000Z",
    )).toThrow("Benchmark playedAt must be a valid timestamp");
  });

  it("creates complementary T and CT outcomes for valid rounds", () => {
    const source = input("match-rounds");
    source.analysis.rounds = [{
      roundNumber: 1,
      winner: "CT",
    }] as MatchAnalysis["rounds"];
    const corpus = buildBenchmarkCorpus(
      [source],
      "2026-07-27T10:00:00.000Z",
    );

    expect(corpus.roundOutcomeSamples).toMatchObject([
      {
        sampleId: "match-rounds:r1:CT",
        side: "CT",
        won: true,
      },
      {
        sampleId: "match-rounds:r1:T",
        side: "T",
        won: false,
      },
    ]);
    expect(corpus.audit.roundOutcomeSampleCount).toBe(2);
  });

  it("normalizes playedAt to UTC before storing corpus samples", () => {
    const source = input("match-timezone");
    source.playedAt = "2026-07-27T11:00:00+02:00";
    const corpus = buildBenchmarkCorpus(
      [source],
      "2026-07-27T10:00:00.000Z",
    );

    expect(corpus.samples[0].playedAt).toBe("2026-07-27T09:00:00.000Z");
  });

  it("reports an empty corpus instead of presenting it as usable", () => {
    expect(buildBenchmarkCorpus(
      [],
      "2026-07-27T10:00:00.000Z",
    ).audit).toMatchObject({
      matchCount: 0,
      sampleCount: 0,
      unavailableReasons: ["empty_corpus"],
    });
  });
});
