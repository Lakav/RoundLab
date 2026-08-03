import type {
  BenchmarkDistribution,
  BenchmarkDistributionSummary,
  BenchmarkPercentile,
  BenchmarkQuantileEstimate,
} from "./benchmark-types";

export const BENCHMARK_CONFIDENCE_LEVEL = 0.95 as const;
export const BENCHMARK_MIN_CONFIDENCE_SAMPLE_COUNT = 20;
const REPORTED_PERCENTILES: BenchmarkPercentile[] = [10, 25, 50, 75, 90];
const NON_MEDIAN_PERCENTILES: BenchmarkPercentile[] = [10, 25, 75, 90];

function stableValue(value: number): number {
  return Number(value.toFixed(6));
}

function quantile(sortedValues: number[], probability: number): number {
  if (sortedValues.length === 1) return sortedValues[0];
  const boundedProbability = Math.min(1, Math.max(0, probability));
  const index = (sortedValues.length - 1) * boundedProbability;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const weight = index - lowerIndex;
  return (
    sortedValues[lowerIndex] * (1 - weight) +
    sortedValues[upperIndex] * weight
  );
}

function estimate(
  sortedValues: number[],
  percentile: BenchmarkPercentile,
): BenchmarkQuantileEstimate {
  if (sortedValues.length === 0) {
    return {
      percentile,
      value: null,
      confidenceInterval: null,
      unavailableReason: "empty_distribution",
    };
  }
  const probability = percentile / 100;
  const value = stableValue(quantile(sortedValues, probability));
  if (sortedValues.length < BENCHMARK_MIN_CONFIDENCE_SAMPLE_COUNT) {
    return {
      percentile,
      value,
      confidenceInterval: null,
      unavailableReason: "insufficient_samples_for_confidence_interval",
    };
  }
  const alpha = 1 - BENCHMARK_CONFIDENCE_LEVEL;
  const epsilon = Math.sqrt(
    Math.log(2 / alpha) / (2 * sortedValues.length),
  );
  return {
    percentile,
    value,
    confidenceInterval: {
      confidenceLevel: BENCHMARK_CONFIDENCE_LEVEL,
      lower: stableValue(
        quantile(sortedValues, Math.max(0, probability - epsilon)),
      ),
      upper: stableValue(
        quantile(sortedValues, Math.min(1, probability + epsilon)),
      ),
      method: "dkw_nonparametric",
    },
    unavailableReason: null,
  };
}

export function summarizeBenchmarkDistributions(
  distributions: BenchmarkDistribution[],
): BenchmarkDistributionSummary[] {
  return [...distributions]
    .sort((left, right) =>
      left.distributionId.localeCompare(right.distributionId)
    )
    .map((distribution) => {
      const sortedValues = [...distribution.values]
        .filter(Number.isFinite)
        .sort((left, right) => left - right);
      const estimates = new Map(
        REPORTED_PERCENTILES.map((percentile) => [
          percentile,
          estimate(sortedValues, percentile),
        ]),
      );
      return {
        summaryId: `${distribution.distributionId}:summary`,
        distributionId: distribution.distributionId,
        map: distribution.map,
        level: distribution.level,
        side: distribution.side,
        metric: distribution.metric,
        sampleCount: sortedValues.length,
        excludedSampleCount:
          distribution.excludedSampleCount +
          distribution.values.length -
          sortedValues.length,
        median: estimates.get(50) as BenchmarkQuantileEstimate,
        percentiles: NON_MEDIAN_PERCENTILES.map(
          (percentile) =>
            estimates.get(percentile) as BenchmarkQuantileEstimate,
        ),
      };
    });
}
