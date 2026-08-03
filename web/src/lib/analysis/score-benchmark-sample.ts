import { benchmarkMetricValue } from "./build-benchmark-distributions";
import type {
  BenchmarkDistribution,
  BenchmarkMetricId,
  BenchmarkPlayerSideSample,
  BenchmarkScore,
  BenchmarkScoreContribution,
} from "./benchmark-types";

export const BENCHMARK_SCORE_VERSION =
  "roundlab.benchmark-score.v1" as const;
export const BENCHMARK_SCORE_MIN_DISTRIBUTION_SAMPLES = 100;
export const BENCHMARK_SCORE_BASE = 50 as const;

export const BENCHMARK_SCORE_METRICS: Array<{
  metric: BenchmarkMetricId;
  orientation: BenchmarkScoreContribution["orientation"];
}> = [
  { metric: "kills_per_round", orientation: "higher_is_better" },
  { metric: "deaths_per_round", orientation: "lower_is_better" },
  { metric: "adr", orientation: "higher_is_better" },
  { metric: "opening_win_rate", orientation: "higher_is_better" },
  { metric: "trade_kill_rate", orientation: "higher_is_better" },
  { metric: "kast_rate", orientation: "higher_is_better" },
];

function stableValue(value: number): number {
  return Number(value.toFixed(6));
}

function percentileRank(values: number[], value: number): number {
  let lower = 0;
  let equal = 0;
  for (const benchmark of values) {
    if (benchmark < value) lower++;
    else if (benchmark === value) equal++;
  }
  return ((lower + equal / 2) / values.length) * 100;
}

export function scoreBenchmarkSample(
  sample: BenchmarkPlayerSideSample,
  distributions: BenchmarkDistribution[],
): BenchmarkScore {
  const matching = new Map(
    distributions
      .filter(
        (distribution) =>
          distribution.map === sample.map &&
          distribution.level === sample.level &&
          distribution.side === sample.side,
      )
      .map((distribution) => [distribution.metric, distribution]),
  );
  const unavailableReasons: string[] = [];
  const contributions: BenchmarkScoreContribution[] = [];
  for (const definition of BENCHMARK_SCORE_METRICS) {
    const value = benchmarkMetricValue(sample, definition.metric);
    if (value === null || !Number.isFinite(value)) {
      unavailableReasons.push(`missing_metric:${definition.metric}`);
      continue;
    }
    const distribution = matching.get(definition.metric);
    if (distribution === undefined) {
      unavailableReasons.push(`missing_distribution:${definition.metric}`);
      continue;
    }
    const values = distribution.values.filter(Number.isFinite);
    if (values.length < BENCHMARK_SCORE_MIN_DISTRIBUTION_SAMPLES) {
      unavailableReasons.push(
        `insufficient_distribution_samples:${definition.metric}`,
      );
      continue;
    }
    const percentile = percentileRank(values, value);
    const orientedPercentile =
      definition.orientation === "higher_is_better"
        ? percentile
        : 100 - percentile;
    const points =
      (orientedPercentile - BENCHMARK_SCORE_BASE) /
      BENCHMARK_SCORE_METRICS.length;
    contributions.push({
      metric: definition.metric,
      orientation: definition.orientation,
      value: stableValue(value),
      benchmarkSampleCount: values.length,
      percentile: stableValue(percentile),
      orientedPercentile: stableValue(orientedPercentile),
      points: stableValue(points),
      impact:
        Math.abs(points) < 0.0000005
          ? "neutral"
          : points > 0
            ? "gain"
            : "loss",
    });
  }
  return {
    scoreVersion: BENCHMARK_SCORE_VERSION,
    playerId: sample.playerId,
    map: sample.map,
    level: sample.level,
    side: sample.side,
    score:
      unavailableReasons.length === 0
        ? stableValue(
            contributions.reduce(
              (total, contribution) =>
                total + contribution.orientedPercentile,
              0,
            ) / contributions.length,
          )
        : null,
    baseScore: BENCHMARK_SCORE_BASE,
    contributions,
    unavailableReasons,
  };
}
