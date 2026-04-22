export type Team = "CT" | "T" | "SPEC";

export type MatchMeta = {
  map: string;
  tickRate: number;
  sampleRate: number;
  durationSec: number;
  teamA: string;
  teamB: string;
  scoreA: number;
  scoreB: number;
};

export type Player = {
  steamId: number;
  name: string;
  team: Team;
};

export type PlayerPos = {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  armor: number;
  helmet?: boolean;
  kit?: boolean;
  team: number; // 2=T, 3=CT
  active?: string;
  weapons?: string[];
};

export type Frame = {
  t: number;
  players: PlayerPos[];
};

export type MatchEvent = {
  t: number;
  type:
    | "kill"
    | "bomb_planted"
    | "bomb_defused"
    | "bomb_exploded"
    | "round_end";
  killer?: number;
  victim?: number;
  assist?: number;
  weapon?: string;
  hs?: boolean;
  winner?: string;
};

export type Round = {
  number: number;
  startTick: number;
  endTick: number;
  duration: number;
  winner: Team;
  frames: Frame[];
  events: MatchEvent[];
};

export type MatchData = {
  meta: MatchMeta;
  players: Player[];
  rounds: Round[];
};
