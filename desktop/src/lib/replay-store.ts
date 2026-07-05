import { create } from "zustand";
import type { MatchData, Round, UtilityEffect } from "./types";

export type HabitOverlayTrail = {
  id: string;
  roundNumber: number;
  thrower?: number;
  type: string;
  points: Array<{ x: number; y: number; z: number }>;
};

export type HabitReplayPlayerSample = {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  team: number;
};

export type HabitReplayProjectile = {
  id: string;
  roundNumber: number;
  projectileId: number;
  type: string;
  thrower?: number;
  samples: Array<{ t: number; x: number; y: number; z: number }>;
};

export type HabitReplayEffect = Pick<UtilityEffect, "id" | "type" | "variant" | "start" | "end" | "x" | "y" | "z" | "team">;

export type HabitReplayRound = {
  id: string;
  roundNumber: number;
  playerId: number;
  playerName: string;
  positions: HabitReplayPlayerSample[];
  death?: { t: number; x: number; y: number; z: number };
  projectiles: HabitReplayProjectile[];
  effects: HabitReplayEffect[];
};

export type HabitOverlay = {
  label: string;
  mode?: "trails" | "replay";
  trails: HabitOverlayTrail[];
  replays?: HabitReplayRound[];
};

type ReplayState = {
  match: MatchData | null;
  matchId: string | null;
  currentRoundIdx: number;
  time: number; // seconds within current round
  playing: boolean;
  speed: number; // 0.25, 0.5, 1, 2, 4
  durationOverride: number | null;
  habitOverlay: HabitOverlay | null;
  setMatch: (id: string, m: MatchData) => void;
  setRoundData: (matchId: string, roundNumber: number, round: Round) => void;
  setHabitOverlay: (overlay: HabitOverlay | null) => void;
  setDurationOverride: (duration: number | null) => void;
  setRound: (idx: number) => void;
  setTime: (t: number) => void;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  setSpeed: (s: number) => void;
  step: (dt: number) => void;
  currentRound: () => Round | null;
};

export const useReplay = create<ReplayState>((set, get) => ({
  match: null,
  matchId: null,
  currentRoundIdx: 0,
  time: 0,
  playing: false,
  speed: 1,
  durationOverride: null,
  habitOverlay: null,
  setMatch: (id, m) => set({ matchId: id, match: m, currentRoundIdx: 0, time: 0, playing: false, speed: 1, durationOverride: null, habitOverlay: null }),
  setRoundData: (matchId, roundNumber, round) =>
    set((s) => {
      if (!s.match || s.matchId !== matchId) return s;
      return {
        match: {
          ...s.match,
          rounds: s.match.rounds.map((r) => (r.number === roundNumber ? round : r)),
        },
      };
    }),
  setHabitOverlay: (overlay) => set({ habitOverlay: overlay }),
  setDurationOverride: (duration) => set((s) => ({ durationOverride: duration, time: Math.min(s.time, duration ?? s.time) })),
  setRound: (idx) => set({ currentRoundIdx: idx, time: 0, playing: false }),
  setTime: (t) => set({ time: t }),
  setPlaying: (p) => set({ playing: p }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setSpeed: (s) => set({ speed: s }),
  step: (dt) => {
    const s = get();
    if (!s.playing || !s.match) return;
    const round = s.match.rounds[s.currentRoundIdx];
    if (!round) return;
    const duration = s.durationOverride ?? round.duration;
    const next = s.time + dt * s.speed;
    if (s.durationOverride !== null) {
      set({ time: Math.min(duration, next), playing: next < duration });
    } else if (next >= round.duration) {
      const nextIdx = s.currentRoundIdx + 1;
      if (nextIdx < s.match.rounds.length) {
        set({ currentRoundIdx: nextIdx, time: 0, playing: true });
      } else {
        set({ time: round.duration, playing: false });
      }
    } else {
      set({ time: next });
    }
  },
  currentRound: () => {
    const s = get();
    return s.match?.rounds[s.currentRoundIdx] ?? null;
  },
}));
