export type MetricProvenance = "observed" | "reconstructed" | "estimated";

export type MetricConfidence = "high" | "medium" | "low" | "unavailable";

export type QualityMetric<T> = {
  value: T | null;
  unit: string;
  sampleCount: number;
  usableSampleCount: number;
  coverage: number | null;
  provenance: MetricProvenance;
  confidence: MetricConfidence;
  unavailableReasons: string[];
  formulaVersion: string;
};

export type QualityMetricInput<T> = Omit<
  QualityMetric<T>,
  "coverage" | "unavailableReasons"
> & {
  unavailableReasons?: string[];
};

function validSampleCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
  return value;
}

function finiteMetricValue<T>(value: T | null): boolean {
  return typeof value !== "number" || Number.isFinite(value);
}

export function qualityMetric<T>(
  input: QualityMetricInput<T>,
): QualityMetric<T> {
  const sampleCount = validSampleCount(input.sampleCount, "sampleCount");
  const usableSampleCount = validSampleCount(
    input.usableSampleCount,
    "usableSampleCount",
  );
  if (usableSampleCount > sampleCount) {
    throw new Error("usableSampleCount cannot exceed sampleCount.");
  }
  const reasons = new Set(
    (input.unavailableReasons ?? []).filter((reason) => reason.trim().length > 0),
  );
  let value = input.value;
  if (!finiteMetricValue(value)) {
    value = null;
    reasons.add("non_finite_metric_value");
  }
  if (value === null && reasons.size === 0) {
    reasons.add(sampleCount === 0 ? "no_samples" : "no_usable_samples");
  }
  const available = value !== null;
  return {
    value,
    unit: input.unit,
    sampleCount,
    usableSampleCount,
    coverage: sampleCount === 0 ? null : usableSampleCount / sampleCount,
    provenance: input.provenance,
    confidence: available ? input.confidence : "unavailable",
    unavailableReasons: [...reasons].sort(),
    formulaVersion: input.formulaVersion,
  };
}

export function unavailableMetric<T>(
  input: Omit<
    QualityMetricInput<T>,
    "value" | "confidence"
  > & {
    reasons: string[];
  },
): QualityMetric<T> {
  return qualityMetric<T>({
    ...input,
    value: null,
    confidence: "unavailable",
    unavailableReasons: input.reasons,
  });
}
