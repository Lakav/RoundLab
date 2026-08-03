import { benchmarkMetricValue } from "./build-benchmark-distributions";
import { BENCHMARK_SCORE_METRICS } from "./score-benchmark-sample";
import type {
  BenchmarkDistribution,
  PlayerHistory,
  PlayerTrainingObjectiveAnalysis,
  RecurringPlayerErrorAnalysis,
} from "./benchmark-types";

export const TRAINING_OBJECTIVE_VERSION =
  "roundlab.training-objectives.v1" as const;
export const TRAINING_OBJECTIVE_WINDOW_SIZE = 5 as const;
export const TRAINING_OBJECTIVE_REQUIRED_SUCCESSES = 3 as const;

function stableValue(value: number): number {
  return Number(value.toFixed(6));
}

function median(values: number[]): number | null {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return stableValue(
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle],
  );
}

export function generatePlayerTrainingObjectives(
  history: PlayerHistory,
  recurring: RecurringPlayerErrorAnalysis,
  distributions: BenchmarkDistribution[],
): PlayerTrainingObjectiveAnalysis {
  const unavailableErrorIds: string[] = [];
  const objectives = recurring.errors.flatMap((error) => {
    const definition = BENCHMARK_SCORE_METRICS.find(
      (candidate) => candidate.metric === error.metric,
    );
    const distribution = distributions.find(
      (candidate) =>
        candidate.map === error.map &&
        candidate.level === error.level &&
        candidate.side === error.side &&
        candidate.metric === error.metric,
    );
    const targetValue =
      distribution === undefined ? null : median([...distribution.values]);
    const recentValues = history.samples
      .filter(
        (sample) =>
          sample.map === error.map &&
          sample.level === error.level &&
          sample.side === error.side,
      )
      .map((sample) => benchmarkMetricValue(sample, error.metric))
      .filter(
        (value): value is number =>
          value !== null && Number.isFinite(value),
      )
      .slice(-TRAINING_OBJECTIVE_WINDOW_SIZE);
    if (
      definition === undefined ||
      distribution === undefined ||
      targetValue === null ||
      recentValues.length < TRAINING_OBJECTIVE_WINDOW_SIZE
    ) {
      unavailableErrorIds.push(error.errorId);
      return [];
    }
    return [{
      objectiveId: `${error.errorId}:objective`,
      map: error.map,
      level: error.level,
      side: error.side,
      metric: error.metric,
      orientation: definition.orientation,
      baselineMeanValue: stableValue(
        recentValues.reduce((total, value) => total + value, 0) /
          recentValues.length,
      ),
      targetValue,
      targetComparator:
        definition.orientation === "higher_is_better"
          ? "at_least" as const
          : "at_most" as const,
      evaluationWindowSampleCount: TRAINING_OBJECTIVE_WINDOW_SIZE,
      requiredSuccessCount: TRAINING_OBJECTIVE_REQUIRED_SUCCESSES,
      benchmarkSampleCount: distribution.values.filter(Number.isFinite).length,
      sourceErrorId: error.errorId,
      sourceWeakRate: error.weakRate,
      evidenceSampleIds: [...error.evidenceSampleIds],
    }];
  });
  objectives.sort(
    (left, right) =>
      right.sourceWeakRate - left.sourceWeakRate ||
      left.objectiveId.localeCompare(right.objectiveId),
  );
  return {
    objectiveVersion: TRAINING_OBJECTIVE_VERSION,
    playerId: history.playerId,
    objectives,
    unavailableErrorIds: unavailableErrorIds.sort(),
    unavailableReasons:
      history.samples.length === 0 ? ["empty_player_history"] : [],
  };
}
