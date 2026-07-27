import type { MatchData, PlayerPos, Round } from "@/lib/types";
import type { TrajectoryComparison } from "./spatial-types";

export const TRAJECTORY_SAMPLE_COUNT = 20;
export const SIMILAR_ROUND_START_MAX_DISTANCE = 256;

type TrajectoryPoint = {
  time: number;
  x: number;
  y: number;
  z: number;
};

type PlayerTrajectory = {
  playerId: string;
  roundNumber: number;
  side: "T" | "CT";
  points: TrajectoryPoint[];
};

function sideForTeam(team: number): "T" | "CT" | null {
  if (team === 2) return "T";
  if (team === 3) return "CT";
  return null;
}

function finitePosition(player: PlayerPos): boolean {
  return (
    Number.isFinite(player.x) &&
    Number.isFinite(player.y) &&
    Number.isFinite(player.z)
  );
}

function roundTrajectories(round: Round): PlayerTrajectory[] {
  const pointsByPlayer = new Map<string, TrajectoryPoint[]>();
  const sideByPlayer = new Map<string, "T" | "CT">();
  const invalidPlayers = new Set<string>();
  for (const frame of round.frames) {
    for (const player of frame.players) {
      if (player.hp <= 0 || !finitePosition(player)) continue;
      const playerId = String(player.id);
      const side = sideForTeam(player.team);
      if (side === null) {
        invalidPlayers.add(playerId);
        continue;
      }
      const knownSide = sideByPlayer.get(playerId);
      if (knownSide !== undefined && knownSide !== side) {
        invalidPlayers.add(playerId);
        continue;
      }
      sideByPlayer.set(playerId, side);
      const points = pointsByPlayer.get(playerId) ?? [];
      const previous = points.at(-1);
      if (previous?.time === frame.t) {
        previous.x = player.x;
        previous.y = player.y;
        previous.z = player.z;
      } else {
        points.push({
          time: frame.t,
          x: player.x,
          y: player.y,
          z: player.z,
        });
      }
      pointsByPlayer.set(playerId, points);
    }
  }
  return [...pointsByPlayer.entries()]
    .filter(
      ([playerId, points]) =>
        !invalidPlayers.has(playerId) &&
        sideByPlayer.has(playerId) &&
        points.length >= 2 &&
        points[0].time < points[points.length - 1].time,
    )
    .map(([playerId, points]) => ({
      playerId,
      roundNumber: round.number,
      side: sideByPlayer.get(playerId) as "T" | "CT",
      points,
    }));
}

function interpolate(
  points: TrajectoryPoint[],
  time: number,
): TrajectoryPoint {
  if (time <= points[0].time) return { ...points[0], time };
  const last = points[points.length - 1];
  if (time >= last.time) return { ...last, time };
  for (let index = 1; index < points.length; index++) {
    const next = points[index];
    if (next.time < time) continue;
    const previous = points[index - 1];
    const duration = next.time - previous.time;
    const progress = duration <= 0 ? 0 : (time - previous.time) / duration;
    return {
      time,
      x: previous.x + (next.x - previous.x) * progress,
      y: previous.y + (next.y - previous.y) * progress,
      z: previous.z + (next.z - previous.z) * progress,
    };
  }
  return { ...last, time };
}

function normalizedSamples(trajectory: PlayerTrajectory): TrajectoryPoint[] {
  const start = trajectory.points[0].time;
  const end = trajectory.points[trajectory.points.length - 1].time;
  return Array.from({ length: TRAJECTORY_SAMPLE_COUNT }, (_, index) => {
    const progress = index / (TRAJECTORY_SAMPLE_COUNT - 1);
    return interpolate(trajectory.points, start + (end - start) * progress);
  });
}

function distance(
  left: Pick<TrajectoryPoint, "x" | "y" | "z">,
  right: Pick<TrajectoryPoint, "x" | "y" | "z">,
): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function stableMetric(value: number): number {
  return Number(value.toFixed(6));
}

export function analyzeTrajectoryComparisons(
  match: MatchData,
): TrajectoryComparison[] {
  const trajectories = match.rounds.flatMap(roundTrajectories);
  const grouped = new Map<string, PlayerTrajectory[]>();
  for (const trajectory of trajectories) {
    const key = `${trajectory.playerId}\u0000${trajectory.side}`;
    const group = grouped.get(key) ?? [];
    group.push(trajectory);
    grouped.set(key, group);
  }
  const comparisons: Omit<TrajectoryComparison, "comparisonId">[] = [];
  for (const group of grouped.values()) {
    group.sort((left, right) => left.roundNumber - right.roundNumber);
    for (let firstIndex = 0; firstIndex < group.length; firstIndex++) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < group.length;
        secondIndex++
      ) {
        const first = group[firstIndex];
        const second = group[secondIndex];
        const startDistance3d = distance(first.points[0], second.points[0]);
        if (startDistance3d > SIMILAR_ROUND_START_MAX_DISTANCE) continue;
        const firstSamples = normalizedSamples(first);
        const secondSamples = normalizedSamples(second);
        const distances = firstSamples.map((point, index) =>
          distance(point, secondSamples[index])
        );
        const sortedDistances = [...distances].sort(
          (left, right) => left - right,
        );
        const middle = Math.floor(sortedDistances.length / 2);
        comparisons.push({
          playerId: first.playerId,
          side: first.side,
          roundNumbers: [first.roundNumber, second.roundNumber],
          startDistance3d: stableMetric(startDistance3d),
          sampleCount: distances.length,
          meanDistance3d: stableMetric(
            distances.reduce((total, value) => total + value, 0) /
              distances.length,
          ),
          medianDistance3d: stableMetric(
            sortedDistances.length % 2 === 0
              ? (sortedDistances[middle - 1] + sortedDistances[middle]) / 2
              : sortedDistances[middle],
          ),
          maxDistance3d: stableMetric(
            sortedDistances[sortedDistances.length - 1],
          ),
        });
      }
    }
  }
  comparisons.sort(
    (left, right) =>
      left.playerId.localeCompare(right.playerId) ||
      left.side.localeCompare(right.side) ||
      left.roundNumbers[0] - right.roundNumbers[0] ||
      left.roundNumbers[1] - right.roundNumbers[1],
  );
  return comparisons.map((comparison, index) => ({
    ...comparison,
    comparisonId: `trajectory-comparison-${String(index).padStart(5, "0")}`,
  }));
}
