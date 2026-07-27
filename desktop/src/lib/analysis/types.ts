export const MATCH_ANALYSIS_SPEC_VERSION = "roundlab.metrics.v1" as const;

export type AnalysisEvidence = {
  evidenceId: string;
  roundNumber: number;
  tick: number | null;
  sequence: number | null;
  time: number;
  type:
    | "kill"
    | "damage"
    | "disconnect"
    | "flash"
    | "grenade_throw"
    | "inventory_snapshot"
    | "economy_snapshot"
    | "bomb_planted"
    | "bomb_defused"
    | "round_start"
    | "round_end";
  actors: string[];
  weapon?: string;
};

export type MultiKillRoundCounts = {
  two: number;
  three: number;
  four: number;
  fivePlus: number;
};

export type ClutchCounts = {
  oneVsOne: number;
  oneVsTwo: number;
  oneVsThree: number;
  oneVsFour: number;
  oneVsFivePlus: number;
};

export type GrenadeCounts = {
  total: number;
  flash: number;
  smoke: number;
  he: number;
  molotov: number;
  incendiary: number;
  decoy: number;
};

export type FlashMetrics = {
  enemiesFlashed: number;
  teammatesFlashed: number;
  enemyBlindDuration: number;
  teammateBlindDuration: number;
  averageEnemyBlindDuration: number | null;
  averageTeammateBlindDuration: number | null;
};

export type UtilityDamageMetrics = {
  heDamage: number;
  fireDamage: number;
  teammateHeDamage: number;
  teammateFireDamage: number;
};

export type PlayerMetricEvidence = {
  kills: string[];
  deaths: string[];
  assists: string[];
  headshotKills: string[];
  damageHealth: string[];
  openingWins: string[];
  openingLosses: string[];
  multiKills: string[];
  survivedRounds: string[];
  clutchOpportunities: string[];
  clutchWins: string[];
  tradeAttempts: string[];
  tradeKills: string[];
  tradeDeaths: string[];
  kastRounds: string[];
  grenadesThrown: string[];
  flashes: string[];
  flashAssists: string[];
  utilitySavedOnDeath: string[];
};

export type PlayerAnalysisMetrics = {
  roundsPlayed: number;
  kills: number | null;
  deaths: number;
  assists: number | null;
  kdRatio: number | null;
  headshotKills: number | null;
  headshotRate: number | null;
  damageHealth: number | null;
  adr: number | null;
  openingAttempts: number | null;
  openingWins: number | null;
  openingLosses: number | null;
  multiKillRounds: MultiKillRoundCounts | null;
  survivedRounds: number | null;
  survivalRate: number | null;
  clutchOpportunities: ClutchCounts | null;
  clutchWins: ClutchCounts | null;
  tradeAttempts: number | null;
  tradeKills: number | null;
  tradeDeaths: number | null;
  kastRounds: number | null;
  kastRate: number | null;
  grenadesThrown: GrenadeCounts | null;
  flashes?: FlashMetrics | null;
  utilityDamage?: UtilityDamageMetrics | null;
  flashAssists: number | null;
  utilitySavedOnDeath: GrenadeCounts | null;
};

export type PlayerAnalysis = {
  playerId: string;
  name: string;
  metrics: PlayerAnalysisMetrics;
  metricEvidence: PlayerMetricEvidence;
  unavailableReasons: string[];
  bySide: {
    T: PlayerSideAnalysis | null;
    CT: PlayerSideAnalysis | null;
  };
  byEconomy: {
    eco: PlayerEconomyAnalysis | null;
    forceBuy: PlayerEconomyAnalysis | null;
    fullBuy: PlayerEconomyAnalysis | null;
    unavailableRounds: number;
  };
};

export type PlayerSideAnalysis = {
  metrics: PlayerAnalysisMetrics;
  metricEvidence: PlayerMetricEvidence;
  unavailableReasons: string[];
};

export type PlayerEconomyAnalysis = PlayerSideAnalysis & {
  economyEvidence: string[];
};

export type EconomyCategory = "eco" | "force_buy" | "full_buy";

export type RoundEconomyAnalysis = {
  roundNumber: number;
  side: "T" | "CT";
  averageEquipmentValue: number | null;
  category: EconomyCategory | null;
  evidenceId: string | null;
  unavailableReason: string | null;
};

export type KeyMomentCategory =
  | "clutch_win"
  | "opening_win"
  | "opening_loss"
  | "multikill"
  | "trade_kill"
  | "bomb_planted"
  | "bomb_defused";

export type KeyMoment = {
  evidenceId: string;
  roundNumber: number;
  tick: number | null;
  sequence: number | null;
  time: number;
  primaryCategory: KeyMomentCategory;
  categories: KeyMomentCategory[];
  players: string[];
};

export type RoundPlayerAnalysis = {
  playerId: string;
  name: string;
  side: "T" | "CT" | null;
  logicalTeam: LogicalTeamId | null;
  economyCategory: EconomyCategory | null;
  metrics: PlayerAnalysisMetrics;
  metricEvidence: PlayerMetricEvidence;
  unavailableReasons: string[];
};

export type RoundAnalysis = {
  roundNumber: number;
  winner: "T" | "CT" | "SPEC";
  logicalWinner: LogicalTeamId | null;
  scoreA: number | null;
  scoreB: number | null;
  players: RoundPlayerAnalysis[];
  economy: RoundEconomyAnalysis[];
  keyMoments: KeyMoment[];
  evidenceIds: string[];
};

export type LogicalTeamId = "A" | "B";

export type LogicalTeamMetrics = Omit<
  PlayerAnalysisMetrics,
  "roundsPlayed" | "adr" | "survivalRate" | "kastRate"
> & {
  roundsPlayed: number;
  roundsWon: number;
  winRate: number | null;
  playerRounds: number;
  adr: number | null;
  survivalRate: number | null;
  kastRate: number | null;
};

export type LogicalTeamAnalysis = {
  logicalTeam: LogicalTeamId;
  name: string;
  score: number | null;
  playerIds: string[];
  metrics: LogicalTeamMetrics | null;
  metricEvidence: PlayerMetricEvidence;
  unavailableReasons: string[];
};

export type MatchAnalysis = {
  specVersion: typeof MATCH_ANALYSIS_SPEC_VERSION;
  inputSchemaVersion: string;
  parserVersion: string;
  matchId: string;
  generatedAt: string;
  players: PlayerAnalysis[];
  teams: LogicalTeamAnalysis[];
  rounds: RoundAnalysis[];
  economyRounds: RoundEconomyAnalysis[];
  keyMoments: KeyMoment[];
  evidence: AnalysisEvidence[];
};
