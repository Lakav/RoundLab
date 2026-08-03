import { describe, expect, it } from "vitest";
import { summarizePlayerFindings } from "@/lib/analysis/summarize-player-findings";
import type {
  PlayerTrainingObjectiveAnalysis,
  PlayerTrendAnalysis,
  RecurringPlayerErrorAnalysis,
} from "@/lib/analysis/benchmark-types";

function trends(): PlayerTrendAnalysis {
  return {
    trendVersion: "roundlab.player-trends.mann-kendall.v1",
    playerId: "p1",
    minimumSampleCount: 8,
    significanceLevel: 0.05,
    trends: [{
      trendId: "trend-adr",
      map: "de_inferno",
      side: "T",
      metric: "adr",
      orientation: "higher_is_better",
      sampleCount: 8,
      firstPlayedAt: "2026-07-01T00:00:00.000Z",
      lastPlayedAt: "2026-07-08T00:00:00.000Z",
      firstValue: 90,
      lastValue: 70,
      kendallTau: -1,
      zScore: -3.1,
      pValue: 0.002,
      direction: "regressing",
      evidenceSampleIds: ["m1:p1:T", "m8:p1:T"],
      unavailableReason: null,
    }, {
      trendId: "trend-kast-stable",
      map: "de_inferno",
      side: "T",
      metric: "kast_rate",
      orientation: "higher_is_better",
      sampleCount: 8,
      firstPlayedAt: "2026-07-01T00:00:00.000Z",
      lastPlayedAt: "2026-07-08T00:00:00.000Z",
      firstValue: 0.7,
      lastValue: 0.7,
      kendallTau: 0,
      zScore: 0,
      pValue: 1,
      direction: "stable",
      evidenceSampleIds: ["m1:p1:T", "m8:p1:T"],
      unavailableReason: null,
    }],
    unavailableReasons: [],
  };
}

function errors(): RecurringPlayerErrorAnalysis {
  return {
    analysisVersion: "roundlab.recurring-errors.v1",
    playerId: "p1",
    windowSize: 5,
    minimumOccurrences: 3,
    maximumWeakPercentile: 25,
    errors: [{
      errorId: "error-adr",
      category: "benchmark_weakness",
      map: "de_inferno",
      level: "level-10",
      side: "T",
      metric: "adr",
      windowSampleCount: 5,
      weakSampleCount: 3,
      weakRate: 0.6,
      meanOrientedPercentile: 18.4567,
      firstPlayedAt: "2026-07-01T00:00:00.000Z",
      lastPlayedAt: "2026-07-08T00:00:00.000Z",
      evidenceSampleIds: ["m2:p1:T", "m4:p1:T", "m5:p1:T"],
    }],
    unavailableSeries: [],
    unavailableReasons: [],
  };
}

function objectives(): PlayerTrainingObjectiveAnalysis {
  return {
    objectiveVersion: "roundlab.training-objectives.v1",
    playerId: "p1",
    objectives: [{
      objectiveId: "objective-adr",
      map: "de_inferno",
      level: "level-10",
      side: "T",
      metric: "adr",
      orientation: "higher_is_better",
      baselineMeanValue: 68,
      targetValue: 80,
      targetComparator: "at_least",
      evaluationWindowSampleCount: 5,
      requiredSuccessCount: 3,
      benchmarkSampleCount: 120,
      sourceErrorId: "error-adr",
      sourceWeakRate: 0.6,
      evidenceSampleIds: ["m2:p1:T", "m4:p1:T", "m5:p1:T"],
    }],
    unavailableErrorIds: [],
    unavailableReasons: [],
  };
}

describe("player findings summary", () => {
  it("summarizes only calculated findings and keeps their evidence", () => {
    const summary = summarizePlayerFindings(
      trends(),
      errors(),
      objectives(),
    );

    expect(summary).toMatchObject({
      summaryVersion: "roundlab.player-findings-summary.v1",
      playerId: "p1",
      headline: "1 régression(s), 1 faiblesse(s) récurrente(s), 1 objectif(s) et 0 progression(s).",
      unavailableReasons: [],
    });
    expect(summary.findings).toHaveLength(3);
    expect(summary.findings[0]).toMatchObject({
      category: "regression",
      sourceId: "trend-adr",
      text: "ADR régresse sur 8 échantillons de_inferno T (de 90 à 70, p=0.002).",
      evidenceSampleIds: ["m1:p1:T", "m8:p1:T"],
    });
    expect(summary.findings[1].text).toContain(
      "3 des 5 derniers échantillons",
    );
    expect(summary.findings[2].text).toContain(
      "au moins 80 dans 3 des 5 prochaines parties",
    );
    expect(summary.findings.some(
      (finding) => finding.sourceId === "trend-kast-stable",
    )).toBe(false);
  });

  it("does not invent a finding when every analysis is unavailable", () => {
    const trendAnalysis = trends();
    trendAnalysis.trends = [];
    trendAnalysis.unavailableReasons = ["insufficient_history"];
    const errorAnalysis = errors();
    errorAnalysis.errors = [];
    errorAnalysis.unavailableReasons = ["benchmark_unavailable"];
    const objectiveAnalysis = objectives();
    objectiveAnalysis.objectives = [];
    objectiveAnalysis.unavailableReasons = ["benchmark_unavailable"];

    expect(summarizePlayerFindings(
      trendAnalysis,
      errorAnalysis,
      objectiveAnalysis,
    )).toMatchObject({
      headline: "Aucun constat exploitable avec les données disponibles.",
      findings: [],
      unavailableReasons: [
        "benchmark_unavailable",
        "insufficient_history",
      ],
    });
  });

  it("rejects analyses belonging to different players", () => {
    const objectiveAnalysis = objectives();
    objectiveAnalysis.playerId = "p2";

    expect(() => summarizePlayerFindings(
      trends(),
      errors(),
      objectiveAnalysis,
    )).toThrow("must reference the same player");
  });
});
