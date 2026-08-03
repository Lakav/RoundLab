import { describe, expect, it } from "vitest";
import {
  analyzeTrajectoryComparisons,
  SIMILAR_ROUND_START_MAX_DISTANCE,
  TRAJECTORY_SAMPLE_COUNT,
} from "@/lib/analysis/analyze-trajectories";
import type { MatchData, Round } from "@/lib/types";

function trajectoryRound(
  number: number,
  startX: number,
  team = 2,
  times = [0, 1, 2],
): Round {
  return {
    number,
    startTick: number * 1_000,
    endTick: number * 1_000 + 500,
    duration: times[times.length - 1],
    winner: "T",
    frames: times.map((time, index) => ({
      t: time,
      players: [{
        id: "p1",
        x: startX + index * 10,
        y: 0,
        z: 0,
        yaw: 0,
        hp: 100,
        armor: 0,
        team,
      }],
    })),
    events: [],
  };
}

function match(rounds: Round[]): MatchData {
  return {
    schemaVersion: "roundlab.replay.v2",
    parserVersion: "test",
    meta: {
      map: "de_test",
      tickRate: 64,
      sampleRate: 16,
      durationSec: 100,
      teamA: "A",
      teamB: "B",
      scoreA: 0,
      scoreB: 0,
    },
    players: [{ steamId: "p1", name: "One", team: "T" }],
    rounds,
  };
}

describe("trajectory comparisons", () => {
  it("compares same-side rounds with nearby starts on normalized progress", () => {
    const result = analyzeTrajectoryComparisons(match([
      trajectoryRound(1, 0),
      trajectoryRound(2, 5, 2, [0, 2, 4]),
      trajectoryRound(3, 300),
      trajectoryRound(4, 0, 3),
    ]));

    expect(result).toEqual([{
      comparisonId: "trajectory-comparison-00000",
      playerId: "p1",
      side: "T",
      roundNumbers: [1, 2],
      startDistance3d: 5,
      sampleCount: TRAJECTORY_SAMPLE_COUNT,
      meanDistance3d: 5,
      medianDistance3d: 5,
      maxDistance3d: 5,
    }]);
  });

  it("includes the start-distance boundary and excludes immediately beyond it", () => {
    const atBoundary = analyzeTrajectoryComparisons(match([
      trajectoryRound(1, 0),
      trajectoryRound(2, SIMILAR_ROUND_START_MAX_DISTANCE),
    ]));
    const beyond = analyzeTrajectoryComparisons(match([
      trajectoryRound(1, 0),
      trajectoryRound(2, SIMILAR_ROUND_START_MAX_DISTANCE + 0.01),
    ]));

    expect(atBoundary).toHaveLength(1);
    expect(atBoundary[0].startDistance3d).toBe(
      SIMILAR_ROUND_START_MAX_DISTANCE,
    );
    expect(beyond).toEqual([]);
  });

  it("requires two valid time samples and a stable side", () => {
    const oneFrame = trajectoryRound(1, 0);
    oneFrame.frames = oneFrame.frames.slice(0, 1);
    const sideChange = trajectoryRound(2, 0);
    sideChange.frames[1].players[0].team = 3;

    expect(analyzeTrajectoryComparisons(match([
      oneFrame,
      sideChange,
      trajectoryRound(3, 0),
    ]))).toEqual([]);
  });
});
