import { create } from "zustand";
import type { MatchData, Round } from "./types";

type ReplayState = {
  match: MatchData | null;
  currentRoundIdx: number;
  time: number; // seconds within current round
  playing: boolean;
  speed: number; // 0.25, 0.5, 1, 2, 4
  setMatch: (m: MatchData) => void;
  setRoundData: (roundNumber: number, round: Round) => void;
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
  currentRoundIdx: 0,
  time: 0,
  playing: false,
  speed: 1,
  setMatch: (m) => set({ match: m, currentRoundIdx: 0, time: 0, playing: false }),
  setRoundData: (roundNumber, round) =>
    set((s) => {
      if (!s.match) return s;
      return {
        match: {
          ...s.match,
          rounds: s.match.rounds.map((r) => (r.number === roundNumber ? round : r)),
        },
      };
    }),
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
    const next = s.time + dt * s.speed;
    if (next >= round.duration) {
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
