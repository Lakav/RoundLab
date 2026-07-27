import type {
  BenchmarkCorpus,
  WinProbabilityModel,
} from "./benchmark-types";

export const WIN_PROBABILITY_MODEL_VERSION =
  "roundlab.win-probability.wilson.v1" as const;
export const WIN_PROBABILITY_MIN_ROUND_SAMPLES = 30;
const CONFIDENCE_LEVEL = 0.95 as const;
const Z_95 = 1.959963984540054;

function stableValue(value: number): number {
  return Number(value.toFixed(6));
}

export function buildWinProbabilityModels(
  corpus: BenchmarkCorpus,
): WinProbabilityModel[] {
  const grouped = new Map<
    string,
    typeof corpus.roundOutcomeSamples
  >();
  for (const sample of corpus.roundOutcomeSamples) {
    const key = `${sample.map}\u0000${sample.level}\u0000${sample.side}`;
    const group = grouped.get(key) ?? [];
    group.push(sample);
    grouped.set(key, group);
  }
  const models: WinProbabilityModel[] = [];
  for (const samples of grouped.values()) {
    const first = samples[0];
    const sampleCount = samples.length;
    const winCount = samples.filter((sample) => sample.won).length;
    const base = {
      modelId: `${first.map}:${first.level}:${first.side}:round-win`,
      modelVersion: WIN_PROBABILITY_MODEL_VERSION,
      map: first.map,
      level: first.level,
      side: first.side,
      sampleCount,
      winCount,
    };
    if (sampleCount < WIN_PROBABILITY_MIN_ROUND_SAMPLES) {
      models.push({
        ...base,
        probability: null,
        confidenceInterval: null,
        unavailableReason: "insufficient_round_samples",
      });
      continue;
    }
    const observedProbability = winCount / sampleCount;
    const zSquared = Z_95 * Z_95;
    const denominator = 1 + zSquared / sampleCount;
    const center =
      (observedProbability + zSquared / (2 * sampleCount)) / denominator;
    const margin =
      Z_95 *
      Math.sqrt(
        (observedProbability * (1 - observedProbability)) / sampleCount +
          zSquared / (4 * sampleCount * sampleCount),
      ) /
      denominator;
    models.push({
      ...base,
      probability: stableValue(center),
      confidenceInterval: {
        confidenceLevel: CONFIDENCE_LEVEL,
        lower: stableValue(Math.max(0, center - margin)),
        upper: stableValue(Math.min(1, center + margin)),
        method: "wilson_score",
      },
      unavailableReason: null,
    });
  }
  return models.sort(
    (left, right) =>
      left.map.localeCompare(right.map) ||
      left.level.localeCompare(right.level) ||
      left.side.localeCompare(right.side),
  );
}
