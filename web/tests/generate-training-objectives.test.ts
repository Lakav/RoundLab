import { describe, expect, it } from "vitest";
import { aggregatePlayerHistory } from "@/lib/analysis/aggregate-player-history";
import { analyzeRecurringPlayerErrors } from "@/lib/analysis/analyze-recurring-errors";
import { generatePlayerTrainingObjectives } from "@/lib/analysis/generate-training-objectives";
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
  adr = 100,
  deaths = 5,
): BenchmarkPlayerSideSample {
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
    roundsPlayed: 10,
    metrics: {
      roundsPlayed: 10,
      kills: 10,
      deaths,
      assists: 2,
      kdRatio: 2,
      headshotKills: 5,
      headshotRate: 0.5,
      damageHealth: adr * 10,
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

function distributions(): BenchmarkDistribution[] {
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
    values: Array.from({ length: 100 }, () => medians[metric]),
    sampleCount: 100,
    excludedSampleCount: 0,
  }));
}

function analyze(
  samples: BenchmarkPlayerSideSample[],
  references = distributions(),
) {
  const history = aggregatePlayerHistory("p1", samples);
  const recurring = analyzeRecurringPlayerErrors(history, references);
  return {
    recurring,
    objectives: generatePlayerTrainingObjectives(
      history,
      recurring,
      references,
    ),
  };
}

describe("training objectives", () => {
  it("turns a recurring ADR weakness into a median benchmark target", () => {
    const { objectives } = analyze(
      Array.from({ length: 5 }, (_, index) => sample(index, 50)),
    );

    expect(objectives.objectives).toEqual([{
      objectiveId:
        "de_test:level-1:T:adr:recurring:objective",
      map: "de_test",
      level: "level-1",
      side: "T",
      metric: "adr",
      orientation: "higher_is_better",
      baselineMeanValue: 50,
      targetValue: 100,
      targetComparator: "at_least",
      evaluationWindowSampleCount: 5,
      requiredSuccessCount: 3,
      benchmarkSampleCount: 100,
      sourceErrorId: "de_test:level-1:T:adr:recurring",
      sourceWeakRate: 1,
      evidenceSampleIds: [
        "m0:p1:T",
        "m1:p1:T",
        "m2:p1:T",
        "m3:p1:T",
        "m4:p1:T",
      ],
    }]);
  });

  it("sets an at-most target for excessive deaths", () => {
    const { objectives } = analyze(
      Array.from({ length: 5 }, (_, index) => sample(index, 100, 10)),
    );
    const deaths = objectives.objectives.find(
      (objective) => objective.metric === "deaths_per_round",
    );

    expect(deaths).toMatchObject({
      baselineMeanValue: 1,
      targetValue: 0.5,
      targetComparator: "at_most",
      orientation: "lower_is_better",
    });
  });

  it("reports an objective whose benchmark disappeared", () => {
    const samples = Array.from(
      { length: 5 },
      (_, index) => sample(index, 50),
    );
    const references = distributions();
    const history = aggregatePlayerHistory("p1", samples);
    const recurring = analyzeRecurringPlayerErrors(history, references);
    const withoutAdr = references.filter(
      (distribution) => distribution.metric !== "adr",
    );
    const result = generatePlayerTrainingObjectives(
      history,
      recurring,
      withoutAdr,
    );

    expect(result.objectives).toEqual([]);
    expect(result.unavailableErrorIds).toEqual([
      "de_test:level-1:T:adr:recurring",
    ]);
  });

  it("reports an empty history", () => {
    const { objectives } = analyze([]);

    expect(objectives).toMatchObject({
      objectives: [],
      unavailableReasons: ["empty_player_history"],
    });
  });
});
