import type { MatchData, Round } from "@/lib/types";

export function replayRound(number: number, duration = 10): Round {
  return {
    number,
    startTick: 0,
    endTick: 640,
    duration,
    winner: number % 2 ? "T" : "CT",
    frames: [
      {
        t: 0,
        players: [
          { id: 1, x: 10, y: 20, z: 30, yaw: 90, hp: 100, armor: 100, team: 2 },
        ],
      },
    ],
    events: [],
    effects: [],
    weaponFires: [],
    projectileFrames: [],
  };
}

export function replayMatch(rounds: Round[] = [replayRound(1), replayRound(2)]): MatchData {
  return {
    meta: {
      map: "de_nuke",
      tickRate: 64,
      sampleRate: 16,
      durationSec: rounds.reduce((total, round) => total + round.duration, 0),
      teamA: "Alpha",
      teamB: "Bravo",
      scoreA: 1,
      scoreB: 1,
    },
    players: [{ steamId: 1, name: "Player One", team: "T" }],
    rounds,
  };
}
