import { benchmarkMetricValue } from "./build-benchmark-distributions";
import { BENCHMARK_SCORE_METRICS } from "./score-benchmark-sample";
import type {
  BenchmarkPlayerSideSample,
  PlayerHistory,
  PlayerMetricTrend,
  PlayerTrendAnalysis,
} from "./benchmark-types";

export const PLAYER_TREND_VERSION =
  "roundlab.player-trends.mann-kendall.v1" as const;
export const PLAYER_TREND_MIN_SAMPLE_COUNT = 8;
export const PLAYER_TREND_SIGNIFICANCE_LEVEL = 0.05 as const;

function stableValue(value: number): number {
  return Number(value.toFixed(6));
}

function errorFunction(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * x);
  const approximation =
    1 -
    (
      (
        (
          (
            1.061405429 * t -
            1.453152027
          ) * t +
          1.421413741
        ) * t -
        0.284496736
      ) * t +
      0.254829592
    ) *
      t *
      Math.exp(-x * x);
  return sign * approximation;
}

function twoSidedNormalPValue(zScore: number): number {
  return Math.max(
    0,
    Math.min(
      1,
      1 - errorFunction(Math.abs(zScore) / Math.sqrt(2)),
    ),
  );
}

function mannKendall(values: number[]): {
  tau: number;
  zScore: number;
  pValue: number;
} {
  let score = 0;
  for (let first = 0; first < values.length - 1; first++) {
    for (let second = first + 1; second < values.length; second++) {
      score += Math.sign(values[second] - values[first]);
    }
  }
  const tieCounts = new Map<number, number>();
  for (const value of values) {
    tieCounts.set(value, (tieCounts.get(value) ?? 0) + 1);
  }
  const sampleCount = values.length;
  const tieCorrection = [...tieCounts.values()].reduce(
    (total, count) =>
      total + count * (count - 1) * (2 * count + 5),
    0,
  );
  const variance =
    (
      sampleCount *
        (sampleCount - 1) *
        (2 * sampleCount + 5) -
      tieCorrection
    ) / 18;
  const zScore =
    variance === 0
      ? 0
      : score > 0
        ? (score - 1) / Math.sqrt(variance)
        : score < 0
          ? (score + 1) / Math.sqrt(variance)
          : 0;
  return {
    tau: stableValue(
      score / (sampleCount * (sampleCount - 1) / 2),
    ),
    zScore: stableValue(zScore),
    pValue: stableValue(twoSidedNormalPValue(zScore)),
  };
}

function analyzeGroup(
  map: string,
  side: "T" | "CT",
  samples: BenchmarkPlayerSideSample[],
): PlayerMetricTrend[] {
  return BENCHMARK_SCORE_METRICS.map((definition) => {
    const observed = samples
      .map((sample) => ({
        sample,
        value: benchmarkMetricValue(sample, definition.metric),
      }))
      .filter(
        (
          item,
        ): item is { sample: BenchmarkPlayerSideSample; value: number } =>
          item.value !== null && Number.isFinite(item.value),
      );
    const base = {
      trendId: `${map}:${side}:${definition.metric}`,
      map,
      side,
      metric: definition.metric,
      orientation: definition.orientation,
      sampleCount: observed.length,
      firstPlayedAt: observed[0]?.sample.playedAt ?? null,
      lastPlayedAt: observed.at(-1)?.sample.playedAt ?? null,
      firstValue:
        observed.length > 0 ? stableValue(observed[0].value) : null,
      lastValue:
        observed.length > 0 ? stableValue(observed.at(-1)!.value) : null,
      evidenceSampleIds: observed.map((item) => item.sample.sampleId),
    };
    if (observed.length < PLAYER_TREND_MIN_SAMPLE_COUNT) {
      return {
        ...base,
        kendallTau: null,
        zScore: null,
        pValue: null,
        direction: "unavailable",
        unavailableReason: "insufficient_metric_samples",
      };
    }
    const statistics = mannKendall(observed.map((item) => item.value));
    const significant =
      statistics.pValue <= PLAYER_TREND_SIGNIFICANCE_LEVEL;
    const improving =
      definition.orientation === "higher_is_better"
        ? statistics.tau > 0
        : statistics.tau < 0;
    return {
      ...base,
      kendallTau: statistics.tau,
      zScore: statistics.zScore,
      pValue: statistics.pValue,
      direction:
        !significant || statistics.tau === 0
          ? "stable"
          : improving
            ? "improving"
            : "regressing",
      unavailableReason: null,
    };
  });
}

export function analyzePlayerTrends(
  history: PlayerHistory,
): PlayerTrendAnalysis {
  const grouped = new Map<string, BenchmarkPlayerSideSample[]>();
  for (const sample of history.samples) {
    const key = `${sample.map}\u0000${sample.side}`;
    const group = grouped.get(key) ?? [];
    group.push(sample);
    grouped.set(key, group);
  }
  const trends = [...grouped.values()]
    .flatMap((samples) => analyzeGroup(
      samples[0].map,
      samples[0].side,
      samples,
    ))
    .sort(
      (left, right) =>
        left.map.localeCompare(right.map) ||
        left.side.localeCompare(right.side) ||
        left.metric.localeCompare(right.metric),
    );
  return {
    trendVersion: PLAYER_TREND_VERSION,
    playerId: history.playerId,
    minimumSampleCount: PLAYER_TREND_MIN_SAMPLE_COUNT,
    significanceLevel: PLAYER_TREND_SIGNIFICANCE_LEVEL,
    trends,
    unavailableReasons:
      history.samples.length === 0 ? ["empty_player_history"] : [],
  };
}
