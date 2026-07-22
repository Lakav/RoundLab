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
  partial?: boolean;
  parseError?: string;
};

export type Player = {
  steamId: number;
  name: string;
  team: Team;
};

export type ActiveAction = {
  type: "plant" | "utility";
  item: string;
  elapsed: number;
  duration?: number;
};

export type PlayerPos = {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  armor: number;
  money?: number;
  helmet?: boolean;
  kit?: boolean;
  hasBomb?: boolean;
  team: number; // 2=T, 3=CT
  active?: string;
  weapons?: string[];
  flashLeft?: number;
  flashTotal?: number;
  use?: boolean;
  activeAction?: ActiveAction;
};

/** A player's last known position in a round, even after death. The HUD
 *  uses this so dead players keep showing their final inventory/money
 *  rather than blanking out. */
export type LastKnownPos = PlayerPos;

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

export type ProjectileFrame = {
  t: number;
  projectiles: ProjectilePos[];
};

export type MatchEvent = {
  t: number;
  type:
    | "kill"
    | "bomb_planted"
    | "bomb_defuse_start"
    | "bomb_defuse_abort"
    | "bomb_defused"
    | "bomb_exploded"
    | "round_end";
  player?: number;
  hasKit?: boolean;
  killer?: number;
  victim?: number;
  assist?: number;
  weapon?: string;
  hs?: boolean;
  flashAssist?: boolean;
  noScope?: boolean;
  throughSmoke?: boolean;
  attackerBlind?: boolean;
  penetrated?: number;
  dominated?: boolean;
  revenge?: boolean;
  winner?: string;
};

export type WeaponFireEvent = {
  t: number;
  shooter?: number;
  weapon?: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  team?: number;
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
  weaponFires?: WeaponFireEvent[];
  projectileFrames?: ProjectileFrame[];
};

export type UtilityEffect = {
  id?: number;
  type: "smoke" | "flash" | "he" | "fire" | "decoy" | "bomb_planted";
  variant?: "molotov" | "incendiary";
  start: number;
  end: number;
  x: number;
  y: number;
  z: number;
  team?: number; // 2=T, 3=CT
};

export type MatchData = {
  meta: MatchMeta;
  players: Player[];
  rounds: Round[];
};
