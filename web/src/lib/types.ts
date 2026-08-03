export type Team = "CT" | "T" | "SPEC";
/** V2 parser payloads use strings. Numbers remain accepted for legacy stored matches. */
export type PlayerId = string | number;

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
  steamId: PlayerId;
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
  id: PlayerId;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch?: number;
  speed?: number;
  velocityX?: number;
  velocityY?: number;
  velocityZ?: number;
  airborne?: boolean;
  walking?: boolean;
  duckAmount?: number;
  scoped?: boolean;
  hp: number;
  armor: number;
  money?: number;
  equipmentValue?: number;
  helmet?: boolean;
  kit?: boolean;
  hasBomb?: boolean;
  team: number; // 2=T, 3=CT
  active?: string;
  weapons?: string[];
  /** Approximate players currently spotting this pawn, as reported by the demo. */
  spottedBy?: PlayerId[];
  flashLeft?: number;
  flashTotal?: number;
  use?: boolean;
  activeAction?: ActiveAction;
};

/** A player's last known position in a round, even after death. The HUD
 *  uses this so dead players keep showing their final inventory/money
 *  rather than blanking out. */
export type BombState = {
  x: number;
  y: number;
  z: number;
  status: "carried" | "dropped" | "planted";
  carrier?: PlayerId;
};

export type ProjectilePos = {
  id: number;
  type: string;
  x: number;
  y: number;
  z: number;
  thrower?: PlayerId;
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
  /** Exact server tick in replay V2. Absent only in legacy stored matches. */
  tick?: number;
  /** Original event order, used to break same-tick ties deterministically. */
  sequence?: number;
  type:
    | "kill"
    | "bomb_planted"
    | "bomb_defuse_start"
    | "bomb_defuse_abort"
    | "bomb_defused"
    | "bomb_exploded"
    | "round_end";
  player?: PlayerId;
  hasKit?: boolean;
  killer?: PlayerId;
  victim?: PlayerId;
  assist?: PlayerId;
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
  /** Exact server tick in replay V2. Absent only in legacy stored matches. */
  tick?: number;
  /** Original event order, used to break same-tick ties deterministically. */
  sequence?: number;
  shooter?: PlayerId;
  weapon?: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  team?: number;
};

export type BulletImpactEvent = {
  t: number;
  tick: number;
  sequence?: number;
  shooter?: PlayerId;
  x: number;
  y: number;
  z: number;
};

export type DamageEvent = {
  t: number;
  tick: number;
  sequence?: number;
  attacker?: PlayerId;
  victim?: PlayerId;
  weapon?: string;
  damageHealth: number;
  damageArmor: number;
  healthAfter: number;
  armorAfter: number;
  hitgroup?: string;
};

export type DisconnectEvent = {
  t: number;
  tick: number;
  sequence?: number;
  player?: PlayerId;
};

export type FlashEvent = {
  t: number;
  tick: number;
  sequence?: number;
  thrower?: PlayerId;
  victim?: PlayerId;
  duration: number;
};

export type PurchaseEvent = {
  t: number;
  tick: number;
  sequence?: number;
  player?: PlayerId;
  item: string;
  cost?: number;
  inventorySlot?: number;
  wasSold?: boolean;
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
  damages?: DamageEvent[];
  disconnects?: DisconnectEvent[];
  flashes?: FlashEvent[];
  purchases?: PurchaseEvent[];
  effects?: UtilityEffect[];
  weaponFires?: WeaponFireEvent[];
  bulletImpacts?: BulletImpactEvent[];
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
  schemaVersion?: "roundlab.replay.v2";
  parserVersion?: string;
  /** Formula version selected when the import manifest was created. */
  mechanicsFormulaVersion?: string;
  /** Explicit import fidelity. Missing means a legacy, unversioned import. */
  importQuality?: "complete" | "partial" | "insufficient" | "legacy";
  /** Parser streams and sampling guarantees available to downstream analysis. */
  capabilities?: string[];
  /** Local geometry identifier, or null when no geometry was attached at import. */
  geometryVersion?: string | null;
  meta: MatchMeta;
  players: Player[];
  rounds: Round[];
};
