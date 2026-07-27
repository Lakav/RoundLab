export const MECHANICS_ANALYSIS_SPEC_VERSION = "roundlab.mechanics.v1" as const;

export type MechanicsEvidence = {
  evidenceId: string;
  roundNumber: number;
  tick: number | null;
  sequence: number | null;
  time: number;
  type: "weapon_fire" | "bullet_impact" | "damage" | "kill" | "visibility";
  actors: string[];
};

export type ShotImpact = {
  evidenceId: string;
  tick: number;
  time: number;
  x: number;
  y: number;
  z: number;
};

export type ShotDamage = {
  evidenceId: string;
  tick: number;
  time: number;
  victimId: string;
  damageHealth: number;
  damageArmor: number;
  hitgroup: string | null;
};

export type ShotAssociation = {
  shotId: string;
  roundNumber: number;
  shooterId: string;
  weapon: string;
  fireEvidenceId: string;
  tick: number | null;
  time: number;
  origin: { x: number; y: number; z: number };
  yaw: number;
  impacts: ShotImpact[];
  damages: ShotDamage[];
  unavailableReasons: string[];
};

export type FiringSequenceKind = "tap" | "burst" | "spray";

export type FiringSequence = {
  firingSequenceId: string;
  roundNumber: number;
  shooterId: string;
  weapon: string;
  kind: FiringSequenceKind;
  startTick: number | null;
  endTick: number | null;
  startTime: number;
  endTime: number;
  shotCount: number;
  shotIds: string[];
  fireEvidenceIds: string[];
};

export type ShotMovementAnalysis = {
  shotId: string;
  shooterId: string;
  sampleTime: number | null;
  sampleAgeSeconds: number | null;
  horizontalSpeed: number | null;
  speedSource: "velocity_components" | "speed" | null;
  movementState: "stationary" | "moving" | "unavailable";
  counterStrafeAssessment: "compatible" | "not_observed" | "unavailable";
  referenceTime: number | null;
  referenceSpeed: number | null;
  unavailableReasons: string[];
};

export type UnmatchedShotFactReason =
  | "missing_shooter"
  | "missing_weapon"
  | "no_matching_fire"
  | "ambiguous_fire";

export type UnmatchedShotFact = {
  evidenceId: string;
  reason: UnmatchedShotFactReason;
};

export type EngagementDamage = {
  playerId: string;
  damageHealth: number;
};

export type EngagementKill = {
  killerId: string;
  victimId: string;
  evidenceId: string;
};

export type Engagement = {
  engagementId: string;
  roundNumber: number;
  participants: [string, string];
  initiatorId: string;
  startTime: number;
  endTime: number;
  startTick: number | null;
  endTick: number | null;
  damageByPlayer: EngagementDamage[];
  kill: EngagementKill | null;
  evidenceIds: string[];
  unavailableReasons: string[];
};

export type FirstVisibility = {
  visibilityId: string;
  engagementId: string;
  participants: [string, string];
  time: number | null;
  tick: number | null;
  geometryId: string | null;
  evidenceId: string | null;
  unavailableReasons: string[];
};

export type CrosshairPlacement = {
  placementId: string;
  visibilityId: string;
  playerId: string;
  targetId: string;
  time: number | null;
  tick: number | null;
  yawErrorDegrees: number | null;
  pitchErrorDegrees: number | null;
  totalErrorDegrees: number | null;
  evidenceId: string | null;
  unavailableReasons: string[];
};

export type DuelPlayerContext = {
  playerId: string;
  damageHealth: number;
  shotIds: string[];
  firingSequenceIds: string[];
  movementShotIds: string[];
  crosshairPlacementId: string | null;
};

export type DuelAnalysis = {
  duelId: string;
  engagementId: string;
  participants: [string, string];
  initiatorId: string;
  firstVisibilityId: string;
  reactionTimeSeconds: number | null;
  startTime: number;
  endTime: number;
  players: DuelPlayerContext[];
  kill: EngagementKill | null;
  evidenceIds: string[];
  unavailableReasons: string[];
};

export type RoundMechanicsAnalysis = {
  roundNumber: number;
  engagements: Engagement[];
  firstVisibilities: FirstVisibility[];
  crosshairPlacements: CrosshairPlacement[];
  duels: DuelAnalysis[];
  shots: ShotAssociation[];
  firingSequences: FiringSequence[];
  shotMovements: ShotMovementAnalysis[];
  unmatchedImpacts: UnmatchedShotFact[];
  unmatchedDamages: UnmatchedShotFact[];
  excludedWeaponFireEvents: number;
  excludedDamageEvents: number;
  excludedKillEvents: number;
  unavailableReasons: string[];
};

export type MechanicsAnalysis = {
  specVersion: typeof MECHANICS_ANALYSIS_SPEC_VERSION;
  inputSchemaVersion: string;
  parserVersion: string;
  matchId: string;
  generatedAt: string;
  rounds: RoundMechanicsAnalysis[];
  evidence: MechanicsEvidence[];
};
