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
  hasBomb?: boolean;
  team: number; // 2=T, 3=CT
  active?: string;
  weapons?: string[];
};

export type BombState = {
  x: number;
  y: number;
  z: number;
  status: "carried" | "dropped" | "planted";
  carrier?: number;
};

export type ProjectilePos = {
  id: number;
  type: string;
  x: number;
  y: number;
  z: number;
  thrower?: number;
};

export type Frame = {
  t: number;
  players: PlayerPos[];
  bomb?: BombState;
  projectiles?: ProjectilePos[];
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
  freezeEndTick?: number;
  endTick: number;
  duration: number;
  winner: Team;
  winnerName?: string;
  scoreA?: number;
  scoreB?: number;
  frames: Frame[];
  events: MatchEvent[];
  effects?: UtilityEffect[];
};

export type UtilityEffect = {
  id?: number;
  type: "smoke" | "flash" | "he" | "fire" | "decoy" | "bomb_planted";
  start: number;
  end: number;
  x: number;
  y: number;
  z: number;
};

export type MatchData = {
  meta: MatchMeta;
  players: Player[];
  rounds: Round[];
};
