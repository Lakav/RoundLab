import type { QualityMetric } from "./metric-quality.ts";

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

/**
 * How a clutch situation ended, counted per player.
 *
 * A save is a lost round the clutcher survived: the equipment carries over to
 * the next round even though the round itself was lost. It is derived from the
 * round winner and the player's survival, never from a dedicated event, since
 * `round_end` carries no win reason.
 */
export type ClutchOutcomes = {
  /** Rounds won while in a clutch. */
  won: number;
  /** Rounds lost while in a clutch, whatever the player did. */
  lost: number;
  /** Lost rounds the clutcher survived, keeping their equipment. */
  saved: number;
  /** Lost clutches where the player died. */
  died: number;
  /** Clutches entered while the bomb was already planted. */
  afterPlant: number;
  /** Clutches won by defusing the bomb. */
  wonByDefuse: number;
  /** Clutches won by the bomb exploding. */
  wonByExplosion: number;
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
  effectiveEnemiesFlashed: number;
  effectiveTeammatesFlashed: number;
  enemyBlindDuration: number;
  teammateBlindDuration: number;
  enemyBlindFlashCount: number;
  longestEnemyBlindDuration: number;
  flashesLeadingToKills: number;
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
  clutchOutcomes: string[];
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
  clutchOutcomes: ClutchOutcomes | null;
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
  unusedUtilityValue?: number | null;
  averageUnusedUtilityValue?: number | null;
  /** Public Leetify-compatible quantity formula; excludes decoys. */
  utilityQuantityRating?: number | null;
};

export type PlayerAnalysis = {
  playerId: string;
  name: string;
  metrics: PlayerAnalysisMetrics;
  economy?: PlayerEconomyQualityAnalysis;
  utility?: PlayerUtilityQualityAnalysis;
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

export type PlayerUtilityQualityAnalysis = {
  grenadesThrown: QualityMetric<number>;
  flashGrenades: QualityMetric<number>;
  smokeGrenades: QualityMetric<number>;
  heGrenades: QualityMetric<number>;
  fireGrenades: QualityMetric<number>;
  utilityQuantityRating: QualityMetric<number>;
  effectiveEnemiesFlashed: QualityMetric<number>;
  effectiveTeammatesFlashed: QualityMetric<number>;
  flashesLeadingToKills: QualityMetric<number>;
  heDamage: QualityMetric<number>;
  teammateHeDamage: QualityMetric<number>;
  enemiesPerFlash: QualityMetric<number>;
  teammatesPerFlash: QualityMetric<number>;
  flashKillsPerFlash: QualityMetric<number>;
  averageEnemyBlindDuration: QualityMetric<number>;
  heDamagePerGrenade: QualityMetric<number>;
  teammateHeDamagePerGrenade: QualityMetric<number>;
  averageUnusedUtilityValue: QualityMetric<number>;
};

export type PlayerEconomyQualityAnalysis = {
  netSpend: QualityMetric<number>;
  equipmentValueLostOnDeath: QualityMetric<number>;
  averageEquipmentValueLostPerDeath: QualityMetric<number>;
  savedPrimaryWeaponRounds: QualityMetric<number>;
  valueLostEvidence: string[];
  savedWeaponEvidence: string[];
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
  quality: {
    averageEquipmentValue: QualityMetric<number>;
    category: QualityMetric<EconomyCategory>;
  };
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
  combat?: LogicalTeamCombatQualityAnalysis;
  economy?: LogicalTeamEconomyAnalysis;
  metricEvidence: PlayerMetricEvidence;
  unavailableReasons: string[];
};

export type LogicalTeamCombatQualityAnalysis = {
  advantageRounds: QualityMetric<number>;
  advantageWins: QualityMetric<number>;
  advantageConversionRate: QualityMetric<number>;
};

export type LogicalTeamEconomyAnalysis = {
  antiEcoRounds: QualityMetric<number>;
  antiEcoWins: QualityMetric<number>;
  antiEcoWinRate: QualityMetric<number>;
  lossesAgainstEco: QualityMetric<number>;
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
