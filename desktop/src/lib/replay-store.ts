import { create } from "zustand";
import type { MatchData, Round, UtilityEffect } from "./types";

const LOADED_ROUND_RADIUS = 1;

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

function roundHasFrames(match: MatchData | null, roundIdx: number) {
  const frames = match?.rounds[roundIdx]?.frames;
  return Array.isArray(frames) && frames.length > 0;
}

function isLoadedRoundPayload(roundNumber: number, round: Round) {
  return round.number === roundNumber && Array.isArray(round.frames) && round.frames.length > 0;
}

function stripRoundPayload(round: Round): Round {
  if (round.frames.length === 0) return round;
  return {
    ...round,
    frames: [],
    events: [],
    effects: [],
    weaponFires: [],
    projectileFrames: [],
  };
}

function retainRoundPayloadWindow(match: MatchData, centerIdx: number): MatchData {
  let changed = false;
  const rounds = match.rounds.map((round, index) => {
    if (Math.abs(index - centerIdx) <= LOADED_ROUND_RADIUS || round.frames.length === 0) return round;
    changed = true;
    return stripRoundPayload(round);
  });
  return changed ? { ...match, rounds } : match;
}

function activeDuration(match: MatchData | null, roundIdx: number, durationOverride: number | null, fallback = 0) {
  const raw = durationOverride ?? match?.rounds[roundIdx]?.duration ?? fallback;
  return Number.isFinite(raw) ? Math.max(0, raw) : 0;
}

function clampReplayTime(value: number, match: MatchData | null, roundIdx: number, durationOverride: number | null) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(activeDuration(match, roundIdx, durationOverride), value));
}

function safeDurationOverride(duration: number | null) {
  return duration !== null && Number.isFinite(duration) ? Math.max(0, duration) : null;
}

function safeReplaySpeed(speed: number) {
  return [0.25, 0.5, 1, 2, 4].includes(speed) ? speed : 1;
}

export const useReplay = create<ReplayState>((set, get) => ({
  match: null,
  matchId: null,
  currentRoundIdx: 0,
  time: 0,
  playing: false,
  speed: 1,
  durationOverride: null,
  habitOverlay: null,
  setMatch: (id, m) => set({
    matchId: id,
    match: retainRoundPayloadWindow(m, 0),
    currentRoundIdx: 0,
    time: 0,
    playing: false,
    speed: 1,
    durationOverride: null,
    habitOverlay: null,
  }),
  setRoundData: (matchId, roundNumber, round) =>
    set((s) => {
      if (!s.match || s.matchId !== matchId) return s;
      if (!isLoadedRoundPayload(roundNumber, round)) return { playing: false };
      if (!s.match.rounds.some((r) => r.number === roundNumber)) return { playing: false };
      const nextMatch = {
        ...s.match,
        rounds: s.match.rounds.map((r) => (r.number === roundNumber ? round : r)),
      };
      return { match: retainRoundPayloadWindow(nextMatch, s.currentRoundIdx) };
    }),
  setHabitOverlay: (overlay) => set({ habitOverlay: overlay }),
  setDurationOverride: (duration) => set((s) => {
    const nextDuration = safeDurationOverride(duration);
    return {
      durationOverride: nextDuration,
      time: clampReplayTime(s.time, s.match, s.currentRoundIdx, nextDuration),
    };
  }),
  setRound: (idx) => set((s) => {
    if (!s.match || idx < 0 || idx >= s.match.rounds.length) return { playing: false };
    return {
      match: retainRoundPayloadWindow(s.match, idx),
      currentRoundIdx: idx,
      time: 0,
      playing: false,
    };
  }),
  setTime: (t) => set((s) => ({ time: clampReplayTime(t, s.match, s.currentRoundIdx, s.durationOverride) })),
  setPlaying: (p) => set((s) => ({ playing: p && roundHasFrames(s.match, s.currentRoundIdx) })),
  togglePlay: () => set((s) => {
    if (!roundHasFrames(s.match, s.currentRoundIdx)) return { playing: false };
    return { playing: !s.playing };
  }),
  setSpeed: (s) => set({ speed: safeReplaySpeed(s) }),
  step: (dt) => {
    const s = get();
    if (!Number.isFinite(dt) || dt <= 0) return;
    if (!s.playing || !s.match) return;
    const round = s.match.rounds[s.currentRoundIdx];
    if (!round || round.frames.length === 0) {
      if (s.playing) set({ playing: false });
      return;
    }
    const roundDuration = activeDuration(s.match, s.currentRoundIdx, null);
    const duration = activeDuration(s.match, s.currentRoundIdx, s.durationOverride);
    const next = clampReplayTime(s.time + dt * safeReplaySpeed(s.speed), s.match, s.currentRoundIdx, s.durationOverride);
    if (s.durationOverride !== null) {
      set({ time: next, playing: next < duration });
    } else if (next >= roundDuration) {
      const nextIdx = s.currentRoundIdx + 1;
      if (nextIdx < s.match.rounds.length) {
        const nextMatch = retainRoundPayloadWindow(s.match, nextIdx);
        set({ match: nextMatch, currentRoundIdx: nextIdx, time: 0, playing: roundHasFrames(nextMatch, nextIdx) });
      } else {
        set({ time: roundDuration, playing: false });
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
