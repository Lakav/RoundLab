import type {
  RepeatedTrajectoryHabit,
  TrajectoryComparison,
} from "./spatial-types";

export const REPEATED_HABIT_MIN_ROUNDS = 3;
export const REPEATED_HABIT_MAX_MEAN_DISTANCE = 128;
export const REPEATED_HABIT_MAX_PEAK_DISTANCE = 256;

function stableMetric(value: number): number {
  return Number(value.toFixed(6));
}

function edgeKey(firstRound: number, secondRound: number): string {
  return firstRound < secondRound
    ? `${firstRound}\u0000${secondRound}`
    : `${secondRound}\u0000${firstRound}`;
}

function intersection(
  values: Set<number>,
  neighbors: Set<number>,
): Set<number> {
  return new Set([...values].filter((value) => neighbors.has(value)));
}

function maximalCliques(
  vertices: number[],
  adjacency: Map<number, Set<number>>,
): number[][] {
  const cliques: number[][] = [];
  const visit = (
    current: Set<number>,
    candidates: Set<number>,
    excluded: Set<number>,
  ): void => {
    if (candidates.size === 0 && excluded.size === 0) {
      if (current.size >= REPEATED_HABIT_MIN_ROUNDS) {
        cliques.push([...current].sort((left, right) => left - right));
      }
      return;
    }
    const pivot = [...candidates, ...excluded].sort(
      (left, right) =>
        intersection(candidates, adjacency.get(right) ?? new Set()).size -
          intersection(candidates, adjacency.get(left) ?? new Set()).size ||
        left - right,
    )[0];
    const pivotNeighbors = adjacency.get(pivot) ?? new Set<number>();
    const remaining = [...candidates]
      .filter((candidate) => !pivotNeighbors.has(candidate))
      .sort((left, right) => left - right);
    for (const candidate of remaining) {
      const neighbors = adjacency.get(candidate) ?? new Set<number>();
      visit(
        new Set([...current, candidate]),
        intersection(candidates, neighbors),
        intersection(excluded, neighbors),
      );
      candidates.delete(candidate);
      excluded.add(candidate);
    }
  };
  visit(new Set(), new Set(vertices), new Set());
  return cliques;
}

function isSimilar(comparison: TrajectoryComparison): boolean {
  return (
    comparison.meanDistance3d <= REPEATED_HABIT_MAX_MEAN_DISTANCE &&
    comparison.maxDistance3d <= REPEATED_HABIT_MAX_PEAK_DISTANCE
  );
}

export function analyzeRepeatedTrajectoryHabits(
  comparisons: TrajectoryComparison[],
): RepeatedTrajectoryHabit[] {
  const grouped = new Map<string, TrajectoryComparison[]>();
  for (const comparison of comparisons) {
    if (!isSimilar(comparison)) continue;
    const key = `${comparison.playerId}\u0000${comparison.side}`;
    const group = grouped.get(key) ?? [];
    group.push(comparison);
    grouped.set(key, group);
  }
  const habits: Omit<RepeatedTrajectoryHabit, "habitId">[] = [];
  for (const group of grouped.values()) {
    const adjacency = new Map<number, Set<number>>();
    const comparisonByRounds = new Map<string, TrajectoryComparison>();
    for (const comparison of group) {
      const [firstRound, secondRound] = comparison.roundNumbers;
      const firstNeighbors = adjacency.get(firstRound) ?? new Set<number>();
      const secondNeighbors = adjacency.get(secondRound) ?? new Set<number>();
      firstNeighbors.add(secondRound);
      secondNeighbors.add(firstRound);
      adjacency.set(firstRound, firstNeighbors);
      adjacency.set(secondRound, secondNeighbors);
      comparisonByRounds.set(edgeKey(firstRound, secondRound), comparison);
    }
    for (const roundNumbers of maximalCliques(
      [...adjacency.keys()].sort((left, right) => left - right),
      adjacency,
    )) {
      const cliqueComparisons: TrajectoryComparison[] = [];
      for (let firstIndex = 0; firstIndex < roundNumbers.length; firstIndex++) {
        for (
          let secondIndex = firstIndex + 1;
          secondIndex < roundNumbers.length;
          secondIndex++
        ) {
          const comparison = comparisonByRounds.get(
            edgeKey(roundNumbers[firstIndex], roundNumbers[secondIndex]),
          );
          if (comparison !== undefined) cliqueComparisons.push(comparison);
        }
      }
      const first = cliqueComparisons[0];
      habits.push({
        playerId: first.playerId,
        side: first.side,
        roundNumbers,
        occurrenceCount: roundNumbers.length,
        comparisonCount: cliqueComparisons.length,
        meanPairDistance3d: stableMetric(
          cliqueComparisons.reduce(
            (total, comparison) => total + comparison.meanDistance3d,
            0,
          ) / cliqueComparisons.length,
        ),
        worstPairMeanDistance3d: stableMetric(
          Math.max(
            ...cliqueComparisons.map(
              (comparison) => comparison.meanDistance3d,
            ),
          ),
        ),
        worstPairMaxDistance3d: stableMetric(
          Math.max(
            ...cliqueComparisons.map(
              (comparison) => comparison.maxDistance3d,
            ),
          ),
        ),
      });
    }
  }
  habits.sort(
    (left, right) =>
      left.playerId.localeCompare(right.playerId) ||
      left.side.localeCompare(right.side) ||
      left.roundNumbers[0] - right.roundNumbers[0] ||
      left.roundNumbers.length - right.roundNumbers.length,
  );
  return habits.map((habit, index) => ({
    ...habit,
    habitId: `trajectory-habit-${String(index).padStart(5, "0")}`,
  }));
}
