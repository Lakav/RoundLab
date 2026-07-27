import {
  BENCHMARK_SCORE_METRICS,
  scoreBenchmarkSample,
} from "./score-benchmark-sample";
import type {
  BenchmarkDistribution,
  BenchmarkPlayerSideSample,
  BenchmarkScoreContribution,
  PlayerHistory,
  RecurringPlayerErrorAnalysis,
} from "./benchmark-types";

export const RECURRING_ERROR_VERSION =
  "roundlab.recurring-errors.v1" as const;
export const RECURRING_ERROR_WINDOW_SIZE = 5 as const;
export const RECURRING_ERROR_MIN_OCCURRENCES = 3 as const;
export const RECURRING_ERROR_MAX_PERCENTILE = 25 as const;

type ObservedContribution = {
  sample: BenchmarkPlayerSideSample;
  contribution: BenchmarkScoreContribution;
};

function stableValue(value: number): number {
  return Number(value.toFixed(6));
}

export function analyzeRecurringPlayerErrors(
  history: PlayerHistory,
  distributions: BenchmarkDistribution[],
): RecurringPlayerErrorAnalysis {
  const observations = new Map<string, ObservedContribution[]>();
  const expectedSeries = new Set<string>();
  for (const sample of history.samples) {
    for (const definition of BENCHMARK_SCORE_METRICS) {
      expectedSeries.add(
        `${sample.map}\u0000${sample.level}\u0000${sample.side}` +
          `\u0000${definition.metric}`,
      );
    }
    const score = scoreBenchmarkSample(sample, distributions);
    for (const contribution of score.contributions) {
      const key =
        `${sample.map}\u0000${sample.level}\u0000${sample.side}` +
        `\u0000${contribution.metric}`;
      const series = observations.get(key) ?? [];
      series.push({ sample, contribution });
      observations.set(key, series);
    }
  }
  const errors = [...observations.entries()].flatMap(([key, series]) => {
    if (series.length < RECURRING_ERROR_WINDOW_SIZE) return [];
    const recent = series.slice(-RECURRING_ERROR_WINDOW_SIZE);
    const weak = recent.filter(
      (item) =>
        item.contribution.orientedPercentile <=
        RECURRING_ERROR_MAX_PERCENTILE,
    );
    if (weak.length < RECURRING_ERROR_MIN_OCCURRENCES) return [];
    const [map, level, side, metric] = key.split("\u0000") as [
      string,
      string,
      "T" | "CT",
      BenchmarkScoreContribution["metric"],
    ];
    return [{
      errorId: `${map}:${level}:${side}:${metric}:recurring`,
      category: "benchmark_weakness" as const,
      map,
      level,
      side,
      metric,
      windowSampleCount: recent.length,
      weakSampleCount: weak.length,
      weakRate: stableValue(weak.length / recent.length),
      meanOrientedPercentile: stableValue(
        recent.reduce(
          (total, item) =>
            total + item.contribution.orientedPercentile,
          0,
        ) / recent.length,
      ),
      firstPlayedAt: recent[0].sample.playedAt,
      lastPlayedAt: recent[recent.length - 1].sample.playedAt,
      evidenceSampleIds: weak.map((item) => item.sample.sampleId),
    }];
  });
  errors.sort(
    (left, right) =>
      right.weakRate - left.weakRate ||
      left.meanOrientedPercentile - right.meanOrientedPercentile ||
      left.errorId.localeCompare(right.errorId),
  );
  const unavailableSeries = [...expectedSeries]
    .filter(
      (key) =>
        (observations.get(key)?.length ?? 0) <
        RECURRING_ERROR_WINDOW_SIZE,
    )
    .map((key) => key.replaceAll("\u0000", ":"))
    .sort();
  return {
    analysisVersion: RECURRING_ERROR_VERSION,
    playerId: history.playerId,
    windowSize: RECURRING_ERROR_WINDOW_SIZE,
    minimumOccurrences: RECURRING_ERROR_MIN_OCCURRENCES,
    maximumWeakPercentile: RECURRING_ERROR_MAX_PERCENTILE,
    errors,
    unavailableSeries,
    unavailableReasons:
      history.samples.length === 0 ? ["empty_player_history"] : [],
  };
}
