import { describe, expect, it } from "vitest";
import {
  analyzeRepeatedTrajectoryHabits,
  REPEATED_HABIT_MAX_MEAN_DISTANCE,
  REPEATED_HABIT_MAX_PEAK_DISTANCE,
} from "@/lib/analysis/analyze-habits";
import type { TrajectoryComparison } from "@/lib/analysis/spatial-types";

function comparison(
  firstRound: number,
  secondRound: number,
  meanDistance3d = 20,
  maxDistance3d = 40,
  playerId = "p1",
  side: "T" | "CT" = "T",
): TrajectoryComparison {
  return {
    comparisonId: `comparison-${firstRound}-${secondRound}`,
    playerId,
    side,
    roundNumbers: [firstRound, secondRound],
    startDistance3d: 10,
    sampleCount: 20,
    meanDistance3d,
    medianDistance3d: meanDistance3d,
    maxDistance3d,
  };
}

describe("repeated trajectory habits", () => {
  it("requires three mutually similar rounds and summarizes every pair", () => {
    const result = analyzeRepeatedTrajectoryHabits([
      comparison(1, 2, 10, 20),
      comparison(1, 3, 20, 30),
      comparison(2, 3, 30, 40),
    ]);

    expect(result).toEqual([{
      habitId: "trajectory-habit-00000",
      playerId: "p1",
      side: "T",
      roundNumbers: [1, 2, 3],
      occurrenceCount: 3,
      comparisonCount: 3,
      meanPairDistance3d: 20,
      worstPairMeanDistance3d: 30,
      worstPairMaxDistance3d: 40,
    }]);
  });

  it("does not merge a similarity chain whose endpoints differ", () => {
    expect(analyzeRepeatedTrajectoryHabits([
      comparison(1, 2),
      comparison(2, 3),
    ])).toEqual([]);
  });

  it("uses inclusive similarity thresholds", () => {
    const boundary = [
      comparison(
        1,
        2,
        REPEATED_HABIT_MAX_MEAN_DISTANCE,
        REPEATED_HABIT_MAX_PEAK_DISTANCE,
      ),
      comparison(
        1,
        3,
        REPEATED_HABIT_MAX_MEAN_DISTANCE,
        REPEATED_HABIT_MAX_PEAK_DISTANCE,
      ),
      comparison(
        2,
        3,
        REPEATED_HABIT_MAX_MEAN_DISTANCE,
        REPEATED_HABIT_MAX_PEAK_DISTANCE,
      ),
    ];
    expect(analyzeRepeatedTrajectoryHabits(boundary)).toHaveLength(1);
    expect(analyzeRepeatedTrajectoryHabits([
      ...boundary.slice(0, 2),
      comparison(
        2,
        3,
        REPEATED_HABIT_MAX_MEAN_DISTANCE + 0.01,
        REPEATED_HABIT_MAX_PEAK_DISTANCE,
      ),
    ])).toEqual([]);
  });

  it("never combines different players or sides", () => {
    expect(analyzeRepeatedTrajectoryHabits([
      comparison(1, 2),
      comparison(1, 3, 20, 40, "p2"),
      comparison(2, 3, 20, 40, "p2", "CT"),
    ])).toEqual([]);
  });
});
