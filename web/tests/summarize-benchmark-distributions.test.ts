import { describe, expect, it } from "vitest";
import {
  BENCHMARK_MIN_CONFIDENCE_SAMPLE_COUNT,
  summarizeBenchmarkDistributions,
} from "@/lib/analysis/summarize-benchmark-distributions";
import type { BenchmarkDistribution } from "@/lib/analysis/benchmark-types";

function distribution(values: number[]): BenchmarkDistribution {
  return {
    distributionId: "de_test:level-1:T:adr",
    map: "de_test",
    level: "level-1",
    side: "T",
    metric: "adr",
    values,
    sampleCount: values.length,
    excludedSampleCount: 2,
  };
}

describe("benchmark distribution summaries", () => {
  it("calculates an interpolated median and percentiles deterministically", () => {
    const source = distribution(
      Array.from({ length: 100 }, (_, index) => index + 1).reverse(),
    );
    const first = summarizeBenchmarkDistributions([source])[0];
    const second = summarizeBenchmarkDistributions([source])[0];

    expect(first).toEqual(second);
    expect(first.median.value).toBe(50.5);
    expect(first.percentiles.map((item) => item.value)).toEqual([
      10.9,
      25.75,
      75.25,
      90.1,
    ]);
    expect(first.median.confidenceInterval).toMatchObject({
      confidenceLevel: 0.95,
      method: "dkw_nonparametric",
    });
    expect(first.median.confidenceInterval?.lower).toBeLessThan(50.5);
    expect(first.median.confidenceInterval?.upper).toBeGreaterThan(50.5);
  });

  it("withholds confidence intervals below the minimum sample count", () => {
    const result = summarizeBenchmarkDistributions([
      distribution(
        Array.from(
          { length: BENCHMARK_MIN_CONFIDENCE_SAMPLE_COUNT - 1 },
          (_, index) => index + 1,
        ),
      ),
    ])[0];

    expect(result.median.value).toBe(10);
    expect(result.median.confidenceInterval).toBeNull();
    expect(result.median.unavailableReason).toBe(
      "insufficient_samples_for_confidence_interval",
    );
  });

  it("keeps empty distributions explicitly unavailable", () => {
    const result = summarizeBenchmarkDistributions([distribution([])])[0];

    expect(result.median).toEqual({
      percentile: 50,
      value: null,
      confidenceInterval: null,
      unavailableReason: "empty_distribution",
    });
    expect(result.percentiles.every(
      (item) => item.unavailableReason === "empty_distribution",
    )).toBe(true);
  });

  it("filters non-finite values and adds them to exclusions", () => {
    const result = summarizeBenchmarkDistributions([
      distribution([10, Number.NaN, 20, Number.POSITIVE_INFINITY]),
    ])[0];

    expect(result.sampleCount).toBe(2);
    expect(result.excludedSampleCount).toBe(4);
    expect(result.median.value).toBe(15);
  });
});
