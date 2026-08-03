import type { QualityMetric } from "./metric-quality";

export const SPATIAL_ANALYSIS_SPEC_VERSION = "roundlab.spatial.v1" as const;

export type PlayerZoneVisit = {
  visitId: string;
  roundNumber: number;
  playerId: string;
  side: "T" | "CT" | null;
  zoneId: string;
  startTime: number;
  endTime: number;
  startTick: number;
  endTick: number;
  sampleCount: number;
};

export type PlayerZoneTransition = {
  transitionId: string;
  roundNumber: number;
  playerId: string;
  side: "T" | "CT" | null;
  fromVisitId: string;
  toVisitId: string;
  fromZoneId: string;
  toZoneId: string;
  time: number;
  tick: number;
};

export type ZoneControlState = "empty" | "T" | "CT" | "contested";

export type ZoneControlInterval = {
  controlIntervalId: string;
  roundNumber: number;
  zoneId: string;
  state: ZoneControlState;
  startTime: number;
  endTime: number;
  startTick: number;
  endTick: number;
  sampleCount: number;
};

export type ZoneControlChange = {
  controlChangeId: string;
  roundNumber: number;
  zoneId: string;
  kind: "establish" | "takeover";
  previousController: "T" | "CT" | null;
  newController: "T" | "CT";
  playerIds: string[];
  time: number;
  tick: number;
};

export type TeamRotation = {
  rotationId: string;
  roundNumber: number;
  side: "T" | "CT";
  destinationZoneId: string;
  playerIds: string[];
  originZoneIds: string[];
  transitionIds: string[];
  startTime: number;
  endTime: number;
  startTick: number;
  endTick: number;
};

export type TeamSpacing = {
  spacingId: string;
  roundNumber: number;
  side: "T" | "CT";
  playerIds: [string, string];
  sampleCount: number;
  meanDistance3d: number;
  medianDistance3d: number;
  minDistance3d: number;
  maxDistance3d: number;
  meanHorizontalDistance: number;
};

export type TradeabilityCandidate = {
  playerId: string;
  distanceToVictim: number;
  distanceToKiller: number;
  flashRemaining: number | null;
  staticLineOfSightToKiller: boolean | null;
  unavailableReasons: string[];
};

export type TradeabilityEvent = {
  tradeabilityId: string;
  roundNumber: number;
  killerId: string;
  victimId: string;
  victimSide: "T" | "CT" | null;
  time: number;
  tick: number | null;
  frameTime: number | null;
  frameAgeSeconds: number | null;
  candidates: TradeabilityCandidate[];
  coveringPlayerIds: string[];
  unavailableReasons: string[];
};

export type UtilitySideSamples = {
  T: number;
  CT: number;
  unknown: number;
};

export type SmokeSpatialImpact = {
  effectId: string;
  roundNumber: number;
  startTime: number;
  endTime: number;
  radius: number;
  center: { x: number; y: number; z: number };
  insideSamplesBySide: UtilitySideSamples;
  playerIdsInside: string[];
  evaluatedSightlineSamples: number | null;
  blockedSightlineSamples: number | null;
  blockedPlayerPairs: Array<{
    playerIds: [string, string];
    sampleCount: number;
    firstTime: number;
    lastTime: number;
  }>;
  unavailableReasons: string[];
};

export type FireSpatialImpact = {
  effectId: string;
  roundNumber: number;
  variant: "molotov" | "incendiary" | null;
  ownerSide: "T" | "CT" | null;
  startTime: number;
  endTime: number;
  radius: number;
  center: { x: number; y: number; z: number };
  insideSamplesBySide: UtilitySideSamples;
  playerIdsInside: string[];
  damageHealth: number;
  damageArmor: number;
  damagedPlayerIds: string[];
  overlappingSmokeEffectIds: string[];
  unavailableReasons: string[];
};

export type TrajectoryComparison = {
  comparisonId: string;
  playerId: string;
  side: "T" | "CT";
  roundNumbers: [number, number];
  startDistance3d: number;
  sampleCount: number;
  meanDistance3d: number;
  medianDistance3d: number;
  maxDistance3d: number;
};

export type RepeatedTrajectoryHabit = {
  habitId: string;
  playerId: string;
  side: "T" | "CT";
  roundNumbers: number[];
  occurrenceCount: number;
  comparisonCount: number;
  meanPairDistance3d: number;
  worstPairMeanDistance3d: number;
  worstPairMaxDistance3d: number;
};

export type RoundSpatialAnalysis = {
  roundNumber: number;
  zoneVisits: PlayerZoneVisit[];
  zoneTransitions: PlayerZoneTransition[];
  zoneControlIntervals: ZoneControlInterval[];
  zoneControlChanges: ZoneControlChange[];
  rotations: TeamRotation[];
  spacing: TeamSpacing[];
  tradeability: TradeabilityEvent[];
  smokeImpacts: SmokeSpatialImpact[];
  fireImpacts: FireSpatialImpact[];
  unmatchedFireDamageEvents: number;
  ambiguousFireDamageEvents: number;
  utilityUnavailableReasons: string[];
  outsideZoneSamples: number;
  ambiguousZoneSamples: number;
  unavailableReasons: string[];
};

export type SpatialAnalysis = {
  specVersion: typeof SPATIAL_ANALYSIS_SPEC_VERSION;
  inputSchemaVersion: string;
  parserVersion: string;
  matchId: string;
  generatedAt: string;
  map: string;
  zonesVersion: string | null;
  zoneLabels: Record<string, string>;
  players: Record<string, PlayerSpatialQualityAnalysis>;
  rounds: RoundSpatialAnalysis[];
  trajectoryComparisons: TrajectoryComparison[];
  repeatedTrajectoryHabits: RepeatedTrajectoryHabit[];
};

export type PlayerSpatialQualityAnalysis = {
  zoneAssignmentRate: QualityMetric<number>;
  uniqueZonesVisited: QualityMetric<number>;
  zoneTransitions: QualityMetric<number>;
  rotations: QualityMetric<number>;
  meanTeammateDistance: QualityMetric<number>;
  spacingSamples: QualityMetric<number>;
  repeatedTrajectoryHabits: QualityMetric<number>;
};
