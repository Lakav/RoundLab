import type {
  MechanicsAnalysis,
  MechanicsEvidence,
} from "./mechanics-types.ts";
import {
  qualityMetric,
  unavailableMetric,
  type MetricConfidence,
  type MetricProvenance,
  type QualityMetric,
} from "./metric-quality.ts";

export const AIM_FORMULA_VERSION = "roundlab.aim.v3" as const;

type PlayerMechanicsValues = {
  shots: number | null;
  hitShots: number | null;
  damage: number | null;
  headHits: number | null;
  bodyHits: number | null;
  averageDamagePerHit: number | null;
  accuracy: number | null;
  spottedAccuracy: number | null;
  spottedShots: number | null;
  headAccuracy: number | null;
  sprayAccuracy: number | null;
  tapAccuracy: number | null;
  burstAccuracy: number | null;
  firstBulletAccuracy: number | null;
  tapSequences: number | null;
  burstSequences: number | null;
  spraySequences: number | null;
  stationaryShots: number | null;
  movingShots: number | null;
  crouchedShots: number | null;
  scopedShots: number | null;
  movementSamples: number | null;
  counterStrafeRate: number | null;
  counterStrafeSamples: number | null;
  timeToDamageMs: number | null;
  timeToDamageSamples: number | null;
  crosshairErrorDegrees: number | null;
  crosshairSamples: number | null;
  wallbangKills: number | null;
  averageDuelDistance: number | null;
  timeToFirstShotMs: number | null;
  exposureBeforeShotMs: number | null;
  duels: number | null;
};

export type PlayerAimMetricId = keyof PlayerMechanicsValues;

export type PlayerAimMetrics = {
  [Metric in PlayerAimMetricId]: QualityMetric<number>;
};

export type PlayerMechanicsSummary = PlayerMechanicsValues & {
  metrics: PlayerAimMetrics;
  accuracyByWeapon: Record<string, QualityMetric<number>>;
  hitgroupDistribution: Record<string, QualityMetric<number>>;
};

type MetricDefinition = {
  unit: string;
  provenance: MetricProvenance;
};

const AIM_METRIC_DEFINITIONS: Record<PlayerAimMetricId, MetricDefinition> = {
  shots: { unit: "shots", provenance: "observed" },
  hitShots: { unit: "shots", provenance: "reconstructed" },
  damage: { unit: "health_points", provenance: "reconstructed" },
  headHits: { unit: "hits", provenance: "reconstructed" },
  bodyHits: { unit: "hits", provenance: "reconstructed" },
  averageDamagePerHit: {
    unit: "health_points_per_hit",
    provenance: "reconstructed",
  },
  accuracy: { unit: "ratio", provenance: "reconstructed" },
  spottedAccuracy: { unit: "ratio", provenance: "estimated" },
  spottedShots: { unit: "shots", provenance: "estimated" },
  headAccuracy: { unit: "ratio", provenance: "reconstructed" },
  sprayAccuracy: { unit: "ratio", provenance: "estimated" },
  tapAccuracy: { unit: "ratio", provenance: "reconstructed" },
  burstAccuracy: { unit: "ratio", provenance: "reconstructed" },
  firstBulletAccuracy: { unit: "ratio", provenance: "reconstructed" },
  tapSequences: { unit: "sequences", provenance: "reconstructed" },
  burstSequences: { unit: "sequences", provenance: "reconstructed" },
  spraySequences: { unit: "sequences", provenance: "reconstructed" },
  stationaryShots: { unit: "shots", provenance: "estimated" },
  movingShots: { unit: "shots", provenance: "estimated" },
  crouchedShots: { unit: "shots", provenance: "estimated" },
  scopedShots: { unit: "shots", provenance: "estimated" },
  movementSamples: { unit: "shots", provenance: "estimated" },
  counterStrafeRate: { unit: "ratio", provenance: "estimated" },
  counterStrafeSamples: { unit: "shots", provenance: "estimated" },
  timeToDamageMs: { unit: "milliseconds", provenance: "estimated" },
  timeToDamageSamples: { unit: "duels", provenance: "estimated" },
  crosshairErrorDegrees: { unit: "degrees", provenance: "estimated" },
  crosshairSamples: { unit: "visibilities", provenance: "estimated" },
  wallbangKills: { unit: "kills", provenance: "reconstructed" },
  averageDuelDistance: { unit: "hammer_units", provenance: "estimated" },
  timeToFirstShotMs: { unit: "milliseconds", provenance: "estimated" },
  exposureBeforeShotMs: { unit: "milliseconds", provenance: "estimated" },
  duels: { unit: "duels", provenance: "reconstructed" },
};

function metricConfidence(
  provenance: MetricProvenance,
  sampleCount: number,
  usableSampleCount: number,
): MetricConfidence {
  if (sampleCount === 0 || usableSampleCount === 0) return "low";
  if (provenance === "observed") return "high";
  if (provenance === "estimated") {
    return usableSampleCount === sampleCount ? "medium" : "low";
  }
  return usableSampleCount === sampleCount ? "high" : "medium";
}

function unavailableAimMetrics(reason: string): PlayerAimMetrics {
  return Object.fromEntries(
    (Object.keys(AIM_METRIC_DEFINITIONS) as PlayerAimMetricId[]).map((metricId) => {
      const definition = AIM_METRIC_DEFINITIONS[metricId];
      return [
        metricId,
        unavailableMetric<number>({
          unit: definition.unit,
          sampleCount: 0,
          usableSampleCount: 0,
          provenance: definition.provenance,
          formulaVersion: `${AIM_FORMULA_VERSION}.${metricId}`,
          reasons: [reason],
        }),
      ];
    }),
  ) as PlayerAimMetrics;
}

function aimMetric(
  metricId: PlayerAimMetricId,
  value: number | null,
  sampleCount: number,
  usableSampleCount: number,
  unavailableReasons: string[] = [],
): QualityMetric<number> {
  const definition = AIM_METRIC_DEFINITIONS[metricId];
  return qualityMetric({
    value,
    unit: definition.unit,
    sampleCount,
    usableSampleCount,
    provenance: definition.provenance,
    confidence: metricConfidence(
      definition.provenance,
      sampleCount,
      usableSampleCount,
    ),
    unavailableReasons,
    formulaVersion: `${AIM_FORMULA_VERSION}.${metricId}`,
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function isRifle(weapon: string): boolean {
  return new Set([
    "ak47",
    "aug",
    "famas",
    "galilar",
    "m4a1",
    "m4a1_silencer",
    "sg556",
  ]).has(weapon);
}

function evidenceById(
  mechanics: MechanicsAnalysis,
): Map<string, MechanicsEvidence> {
  return new Map(
    mechanics.evidence.map((evidence) => [evidence.evidenceId, evidence]),
  );
}

export function summarizePlayerMechanics(
  mechanics: MechanicsAnalysis | null,
  playerId: string,
  hasRecordedKill: boolean,
): PlayerMechanicsSummary {
  if (!mechanics) {
    return {
      metrics: unavailableAimMetrics("missing_mechanics_analysis"),
      shots: null,
      hitShots: null,
      damage: null,
      headHits: null,
      bodyHits: null,
      averageDamagePerHit: null,
      accuracy: null,
      spottedAccuracy: null,
      spottedShots: null,
      headAccuracy: null,
      sprayAccuracy: null,
      tapAccuracy: null,
      burstAccuracy: null,
      firstBulletAccuracy: null,
      tapSequences: null,
      burstSequences: null,
      spraySequences: null,
      stationaryShots: null,
      movingShots: null,
      crouchedShots: null,
      scopedShots: null,
      movementSamples: null,
      counterStrafeRate: null,
      counterStrafeSamples: null,
      timeToDamageMs: null,
      timeToDamageSamples: null,
      crosshairErrorDegrees: null,
      crosshairSamples: null,
      wallbangKills: null,
      averageDuelDistance: null,
      timeToFirstShotMs: null,
      exposureBeforeShotMs: null,
      duels: null,
      accuracyByWeapon: {},
      hitgroupDistribution: {},
    };
  }

  const rounds = mechanics.rounds;
  const shots = rounds.flatMap((round) => round.shots).filter(
    (shot) => shot.shooterId === playerId,
  );
  const associatedHitShots = shots.filter((shot) => shot.damages.length > 0);
  const proofById = evidenceById(mechanics);
  const hasMissingFireStream = rounds.some((round) =>
    round.unavailableReasons.includes("missing_weapon_fire_events")
  );
  const hasMissingDamageStream = shots.some((shot) =>
    shot.unavailableReasons.includes("missing_damage_events")
  );
  const hasUnmatchedPlayerDamage = rounds.some((round) =>
    round.unmatchedDamages.some((unmatched) => {
      const proof = proofById.get(unmatched.evidenceId);
      return proof?.actors[0] === playerId;
    })
  );
  const associationContradiction =
    hasUnmatchedPlayerDamage ||
    (hasRecordedKill && associatedHitShots.length === 0);
  const reliableShots = associationContradiction
    ? []
    : shots.filter(
      (shot) =>
        shot.associationStatus === "reliable_hit" ||
        shot.associationStatus === "reliable_miss",
    );
  const hitShots = reliableShots.filter(
    (shot) => shot.associationStatus === "reliable_hit",
  );
  const damageAssociationUsable =
    !hasMissingFireStream &&
    !hasMissingDamageStream &&
    reliableShots.length > 0;
  const spottedStateReliable =
    shots.length > 0 &&
    shots.every((shot) => typeof shot.enemySpotted === "boolean");
  const spottedShots = shots.filter((shot) => shot.enemySpotted === true);
  const reliableSpottedShots = reliableShots.filter(
    (shot) => shot.enemySpotted === true,
  );
  const associatedDamages = hitShots.flatMap((shot) => shot.damages);
  const totalDamage = associatedDamages.reduce(
    (total, damage) => total + damage.damageHealth,
    0,
  );
  const allHeadHits = associatedDamages.filter(
    (damage) => damage.hitgroup?.toLowerCase() === "head",
  ).length;
  const allBodyHits = associatedDamages.filter(
    (damage) => {
      const hitgroup = damage.hitgroup?.toLowerCase();
      return hitgroup !== undefined && hitgroup !== null && hitgroup !== "head";
    },
  ).length;

  // Leetify excludes AWP hits from head accuracy.
  const headAccuracyDamages = hitShots
    .filter((shot) => shot.weapon !== "awp")
    .flatMap((shot) => shot.damages);
  const headHits = headAccuracyDamages.filter(
    (damage) => damage.hitgroup?.toLowerCase() === "head",
  );

  const sprayShotIds = new Set(
    rounds
      .flatMap((round) => round.firingSequences)
      .filter(
        (sequence) =>
          sequence.shooterId === playerId &&
          sequence.kind === "spray" &&
          isRifle(sequence.weapon),
      )
      .flatMap((sequence) => sequence.shotIds),
  );
  const rifleSprayShots = reliableShots.filter((shot) =>
    sprayShotIds.has(shot.shotId)
  );
  const playerSequences = rounds
    .flatMap((round) => round.firingSequences)
    .filter((sequence) => sequence.shooterId === playerId);
  const shotById = new Map(shots.map((shot) => [shot.shotId, shot]));
  const sequenceShotIds = (kind: "tap" | "burst" | "spray") =>
    new Set(
      playerSequences
        .filter((sequence) => sequence.kind === kind)
        .flatMap((sequence) => sequence.shotIds),
    );
  const tapShotIds = sequenceShotIds("tap");
  const burstShotIds = sequenceShotIds("burst");
  const firstBulletShotIds = new Set(
    playerSequences
      .map((sequence) => sequence.shotIds[0])
      .filter((shotId): shotId is string => shotId !== undefined),
  );
  const reliableTapShots = reliableShots.filter((shot) => tapShotIds.has(shot.shotId));
  const reliableBurstShots = reliableShots.filter((shot) => burstShotIds.has(shot.shotId));
  const reliableFirstBullets = reliableShots.filter((shot) =>
    firstBulletShotIds.has(shot.shotId)
  );
  const assessedMovements = rounds
    .flatMap((round) => round.shotMovements)
    .filter(
      (movement) =>
        movement.shooterId === playerId &&
        movement.counterStrafeAssessment !== "unavailable",
    );
  const playerMovements = rounds
    .flatMap((round) => round.shotMovements)
    .filter((movement) => movement.shooterId === playerId);
  const movementSamples = rounds
    .flatMap((round) => round.shotMovements)
    .filter(
      (movement) =>
        movement.shooterId === playerId &&
        movement.movementState !== "unavailable",
    );
  const scopedSamples = playerMovements.filter(
    (movement) => movement.scoped !== null,
  );
  const playerDuels = rounds
    .flatMap((round) => round.duels)
    .filter((duel) => duel.participants.includes(playerId));
  const visibilityById = new Map(
    rounds
      .flatMap((round) => round.firstVisibilities)
      .map((visibility) => [visibility.visibilityId, visibility]),
  );
  const firstShotDelays = playerDuels.flatMap((duel) => {
    const visibility = visibilityById.get(duel.firstVisibilityId);
    if (visibility?.time === null || visibility?.time === undefined) return [];
    const context = duel.players.find((player) => player.playerId === playerId);
    const times = (context?.shotIds ?? [])
      .map((shotId) => shotById.get(shotId)?.time)
      .filter((time): time is number => time !== undefined && time >= visibility.time!);
    if (times.length === 0) return [];
    return [Math.min(...times) - visibility.time];
  });
  const timeToDamage = rounds
    .flatMap((round) => round.duels)
    .filter(
      (duel) =>
        duel.initiatorId === playerId &&
        duel.reactionTimeSeconds !== null &&
        duel.reactionTimeSeconds >= 0 &&
        duel.reactionTimeSeconds < 1,
    )
    .map((duel) => duel.reactionTimeSeconds as number);
  const crosshairErrors = rounds
    .flatMap((round) => round.crosshairPlacements)
    .filter(
      (placement) =>
        placement.playerId === playerId &&
        placement.totalErrorDegrees !== null,
    )
    .map((placement) => placement.totalErrorDegrees as number);

  const ttdMedian = median(timeToDamage);
  const fireReasons = hasMissingFireStream
    ? ["missing_weapon_fire_events"]
    : [];
  const damageReasons = [
    ...fireReasons,
    ...(hasMissingDamageStream ? ["missing_damage_events"] : []),
    ...(hasUnmatchedPlayerDamage ? ["unmatched_player_damage_events"] : []),
    ...(reliableShots.length < shots.length
      ? ["incomplete_shot_associations"]
      : []),
    ...(associationContradiction
      ? ["recorded_kill_without_associated_damage"]
      : []),
  ];
  const spottedReasons = [
    ...damageReasons,
    ...(!spottedStateReliable ? ["incomplete_spotted_by_samples"] : []),
    ...(spottedShots.length === 0 ? ["no_spotted_shots"] : []),
  ];
  const sprayReasons = [
    ...damageReasons,
    ...(rifleSprayShots.length === 0 ? ["no_usable_spray_shots"] : []),
  ];
  const movementReasons = [
    ...fireReasons,
    ...new Set(
      playerMovements
        .flatMap((movement) => movement.unavailableReasons),
    ),
  ];
  const counterStrafeReasons = [
    ...movementReasons,
    ...(assessedMovements.length === 0
      ? ["no_counter_strafe_samples"]
      : []),
  ];
  const timeToDamageCandidates = playerDuels.filter(
    (duel) => duel.initiatorId === playerId,
  );
  const timeToDamageReasons = [
    ...new Set(
      timeToDamageCandidates.flatMap((duel) => duel.unavailableReasons),
    ),
    ...(timeToDamage.length === 0 ? ["no_usable_visibility_duels"] : []),
  ];
  const placementCandidates = rounds
    .flatMap((round) => round.crosshairPlacements)
    .filter((placement) => placement.playerId === playerId);
  const crosshairReasons = [
    ...new Set(
      placementCandidates.flatMap((placement) => placement.unavailableReasons),
    ),
    ...(crosshairErrors.length === 0
      ? ["no_usable_crosshair_samples"]
      : []),
  ];
  const values: PlayerMechanicsValues = {
    shots: hasMissingFireStream ? null : shots.length,
    hitShots: damageAssociationUsable ? hitShots.length : null,
    damage: damageAssociationUsable ? totalDamage : null,
    headHits: damageAssociationUsable ? allHeadHits : null,
    bodyHits: damageAssociationUsable ? allBodyHits : null,
    averageDamagePerHit:
      !damageAssociationUsable || associatedDamages.length === 0
        ? null
        : totalDamage / associatedDamages.length,
    accuracy: !damageAssociationUsable
      ? null
      : hitShots.length / reliableShots.length,
    spottedAccuracy:
      !damageAssociationUsable ||
      !spottedStateReliable ||
      reliableSpottedShots.length === 0
        ? null
        : reliableSpottedShots.filter(
          (shot) => shot.associationStatus === "reliable_hit",
        ).length /
          reliableSpottedShots.length,
    spottedShots: spottedStateReliable ? spottedShots.length : null,
    headAccuracy:
      !damageAssociationUsable || headAccuracyDamages.length === 0
        ? null
        : headHits.length / headAccuracyDamages.length,
    sprayAccuracy:
      !damageAssociationUsable ||
      rifleSprayShots.length === 0
        ? null
        : rifleSprayShots.filter(
          (shot) => shot.associationStatus === "reliable_hit",
        ).length / rifleSprayShots.length,
    tapAccuracy: !damageAssociationUsable || reliableTapShots.length === 0
      ? null
      : reliableTapShots.filter((shot) => shot.associationStatus === "reliable_hit").length /
        reliableTapShots.length,
    burstAccuracy: !damageAssociationUsable || reliableBurstShots.length === 0
      ? null
      : reliableBurstShots.filter((shot) => shot.associationStatus === "reliable_hit").length /
        reliableBurstShots.length,
    firstBulletAccuracy:
      !damageAssociationUsable || reliableFirstBullets.length === 0
        ? null
        : reliableFirstBullets.filter(
          (shot) => shot.associationStatus === "reliable_hit",
        ).length / reliableFirstBullets.length,
    tapSequences: hasMissingFireStream
      ? null
      : playerSequences.filter((sequence) => sequence.kind === "tap").length,
    burstSequences: hasMissingFireStream
      ? null
      : playerSequences.filter((sequence) => sequence.kind === "burst").length,
    spraySequences: hasMissingFireStream
      ? null
      : playerSequences.filter((sequence) => sequence.kind === "spray").length,
    stationaryShots: hasMissingFireStream ? null : movementSamples.filter(
      (movement) => movement.movementState === "stationary",
    ).length,
    movingShots: hasMissingFireStream ? null : movementSamples.filter(
      (movement) => movement.movementState === "moving",
    ).length,
    crouchedShots: hasMissingFireStream ? null : playerMovements.filter(
      (movement) => movement.stance === "crouched",
    ).length,
    scopedShots:
      hasMissingFireStream || scopedSamples.length !== playerMovements.length
        ? null
        : scopedSamples.filter((movement) => movement.scoped).length,
    movementSamples: hasMissingFireStream ? null : movementSamples.length,
    counterStrafeRate: hasMissingFireStream || assessedMovements.length === 0
      ? null
      : assessedMovements.filter(
        (movement) => movement.counterStrafeAssessment === "compatible",
      ).length / assessedMovements.length,
    counterStrafeSamples: hasMissingFireStream ? null : assessedMovements.length,
    timeToDamageMs: ttdMedian === null ? null : ttdMedian * 1000,
    timeToDamageSamples: timeToDamage.length,
    crosshairErrorDegrees: median(crosshairErrors),
    crosshairSamples: crosshairErrors.length,
    wallbangKills: damageAssociationUsable
      ? reliableShots.reduce(
        (total, shot) =>
          total +
          (shot.kills?.filter((kill) => kill.penetratedSurfaces > 0).length ?? 0),
        0,
      )
      : null,
    averageDuelDistance: (() => {
      const distances = associatedDamages
        .map((damage) => damage.distanceWorld)
        .filter((distance): distance is number => distance !== null);
      return distances.length === 0
        ? null
        : distances.reduce((total, distance) => total + distance, 0) /
          distances.length;
    })(),
    timeToFirstShotMs: median(firstShotDelays) === null
      ? null
      : (median(firstShotDelays) ?? 0) * 1000,
    exposureBeforeShotMs: median(firstShotDelays) === null
      ? null
      : (median(firstShotDelays) ?? 0) * 1000,
    duels: playerDuels.length,
  };
  const metrics: PlayerAimMetrics = {
    shots: aimMetric(
      "shots",
      values.shots,
      shots.length,
      hasMissingFireStream ? 0 : shots.length,
      fireReasons,
    ),
    hitShots: aimMetric(
      "hitShots",
      values.hitShots,
      shots.length,
      damageAssociationUsable ? reliableShots.length : 0,
      damageReasons,
    ),
    damage: aimMetric(
      "damage",
      values.damage,
      shots.length,
      damageAssociationUsable ? reliableShots.length : 0,
      damageReasons,
    ),
    headHits: aimMetric(
      "headHits",
      values.headHits,
      associatedDamages.length,
      damageAssociationUsable ? associatedDamages.length : 0,
      damageReasons,
    ),
    bodyHits: aimMetric(
      "bodyHits",
      values.bodyHits,
      associatedDamages.length,
      damageAssociationUsable ? associatedDamages.length : 0,
      damageReasons,
    ),
    averageDamagePerHit: aimMetric(
      "averageDamagePerHit",
      values.averageDamagePerHit,
      associatedDamages.length,
      damageAssociationUsable ? associatedDamages.length : 0,
      [
        ...damageReasons,
        ...(associatedDamages.length === 0 ? ["no_associated_hits"] : []),
      ],
    ),
    accuracy: aimMetric(
      "accuracy",
      values.accuracy,
      shots.length,
      damageAssociationUsable ? reliableShots.length : 0,
      [
        ...damageReasons,
        ...(shots.length === 0 ? ["no_shots"] : []),
      ],
    ),
    spottedAccuracy: aimMetric(
      "spottedAccuracy",
      values.spottedAccuracy,
      spottedShots.length,
      values.spottedAccuracy === null ? 0 : reliableSpottedShots.length,
      spottedReasons,
    ),
    spottedShots: aimMetric(
      "spottedShots",
      values.spottedShots,
      shots.length,
      spottedStateReliable ? shots.length : 0,
      spottedStateReliable ? [] : ["incomplete_spotted_by_samples"],
    ),
    headAccuracy: aimMetric(
      "headAccuracy",
      values.headAccuracy,
      headAccuracyDamages.length,
      damageAssociationUsable ? headAccuracyDamages.length : 0,
      [
        ...damageReasons,
        ...(headAccuracyDamages.length === 0 ? ["no_non_awp_hits"] : []),
      ],
    ),
    sprayAccuracy: aimMetric(
      "sprayAccuracy",
      values.sprayAccuracy,
      rifleSprayShots.length,
      rifleSprayShots.length,
      sprayReasons,
    ),
    tapAccuracy: aimMetric(
      "tapAccuracy",
      values.tapAccuracy,
      shots.filter((shot) => tapShotIds.has(shot.shotId)).length,
      reliableTapShots.length,
      [
        ...damageReasons,
        ...(reliableTapShots.length === 0 ? ["no_usable_tap_shots"] : []),
      ],
    ),
    burstAccuracy: aimMetric(
      "burstAccuracy",
      values.burstAccuracy,
      shots.filter((shot) => burstShotIds.has(shot.shotId)).length,
      reliableBurstShots.length,
      [
        ...damageReasons,
        ...(reliableBurstShots.length === 0 ? ["no_usable_burst_shots"] : []),
      ],
    ),
    firstBulletAccuracy: aimMetric(
      "firstBulletAccuracy",
      values.firstBulletAccuracy,
      shots.filter((shot) => firstBulletShotIds.has(shot.shotId)).length,
      reliableFirstBullets.length,
      [
        ...damageReasons,
        ...(reliableFirstBullets.length === 0
          ? ["no_usable_first_bullets"]
          : []),
      ],
    ),
    tapSequences: aimMetric(
      "tapSequences",
      values.tapSequences,
      playerSequences.length,
      hasMissingFireStream ? 0 : playerSequences.length,
      fireReasons,
    ),
    burstSequences: aimMetric(
      "burstSequences",
      values.burstSequences,
      playerSequences.length,
      hasMissingFireStream ? 0 : playerSequences.length,
      fireReasons,
    ),
    spraySequences: aimMetric(
      "spraySequences",
      values.spraySequences,
      playerSequences.length,
      hasMissingFireStream ? 0 : playerSequences.length,
      fireReasons,
    ),
    stationaryShots: aimMetric(
      "stationaryShots",
      values.stationaryShots,
      playerMovements.length,
      hasMissingFireStream ? 0 : movementSamples.length,
      movementReasons,
    ),
    movingShots: aimMetric(
      "movingShots",
      values.movingShots,
      playerMovements.length,
      hasMissingFireStream ? 0 : movementSamples.length,
      movementReasons,
    ),
    crouchedShots: aimMetric(
      "crouchedShots",
      values.crouchedShots,
      playerMovements.length,
      playerMovements.filter((movement) => movement.stance !== "unavailable").length,
      [
        ...fireReasons,
        ...(playerMovements.some((movement) => movement.stance === "unavailable")
          ? ["incomplete_stance_samples"]
          : []),
      ],
    ),
    scopedShots: aimMetric(
      "scopedShots",
      values.scopedShots,
      playerMovements.length,
      hasMissingFireStream ? 0 : scopedSamples.length,
      [
        ...fireReasons,
        ...(scopedSamples.length === playerMovements.length
          ? []
          : ["incomplete_scoped_samples"]),
      ],
    ),
    movementSamples: aimMetric(
      "movementSamples",
      values.movementSamples,
      playerMovements.length,
      hasMissingFireStream ? 0 : movementSamples.length,
      movementReasons,
    ),
    counterStrafeRate: aimMetric(
      "counterStrafeRate",
      values.counterStrafeRate,
      playerMovements.length,
      hasMissingFireStream ? 0 : assessedMovements.length,
      counterStrafeReasons,
    ),
    counterStrafeSamples: aimMetric(
      "counterStrafeSamples",
      values.counterStrafeSamples,
      playerMovements.length,
      hasMissingFireStream ? 0 : assessedMovements.length,
      counterStrafeReasons,
    ),
    timeToDamageMs: aimMetric(
      "timeToDamageMs",
      values.timeToDamageMs,
      timeToDamageCandidates.length,
      timeToDamage.length,
      timeToDamageReasons,
    ),
    timeToDamageSamples: aimMetric(
      "timeToDamageSamples",
      values.timeToDamageSamples,
      timeToDamageCandidates.length,
      timeToDamage.length,
      timeToDamageReasons,
    ),
    crosshairErrorDegrees: aimMetric(
      "crosshairErrorDegrees",
      values.crosshairErrorDegrees,
      placementCandidates.length,
      crosshairErrors.length,
      crosshairReasons,
    ),
    crosshairSamples: aimMetric(
      "crosshairSamples",
      values.crosshairSamples,
      placementCandidates.length,
      crosshairErrors.length,
      crosshairReasons,
    ),
    wallbangKills: aimMetric(
      "wallbangKills",
      values.wallbangKills,
      shots.length,
      damageAssociationUsable ? reliableShots.length : 0,
      damageReasons,
    ),
    averageDuelDistance: aimMetric(
      "averageDuelDistance",
      values.averageDuelDistance,
      associatedDamages.length,
      associatedDamages.filter((damage) => damage.distanceWorld !== null).length,
      [
        ...damageReasons,
        ...(associatedDamages.some((damage) => damage.distanceWorld === null)
          ? ["incomplete_position_samples"]
          : []),
        ...(associatedDamages.length === 0 ? ["no_associated_hits"] : []),
      ],
    ),
    timeToFirstShotMs: aimMetric(
      "timeToFirstShotMs",
      values.timeToFirstShotMs,
      playerDuels.length,
      firstShotDelays.length,
      [
        ...(firstShotDelays.length === 0
          ? ["no_usable_first_shot_duels"]
          : []),
      ],
    ),
    exposureBeforeShotMs: aimMetric(
      "exposureBeforeShotMs",
      values.exposureBeforeShotMs,
      playerDuels.length,
      firstShotDelays.length,
      [
        ...(firstShotDelays.length === 0
          ? ["no_usable_first_shot_duels"]
          : []),
      ],
    ),
    duels: aimMetric(
      "duels",
      values.duels,
      playerDuels.length,
      playerDuels.length,
    ),
  };
  const accuracyByWeapon = Object.fromEntries(
    [...new Set(shots.map((shot) => shot.weapon))].sort().map((weapon) => {
      const weaponShots = shots.filter((shot) => shot.weapon === weapon);
      const usable = reliableShots.filter((shot) => shot.weapon === weapon);
      const hits = usable.filter(
        (shot) => shot.associationStatus === "reliable_hit",
      );
      return [weapon, qualityMetric({
        value: usable.length === 0 ? null : hits.length / usable.length,
        unit: "ratio",
        sampleCount: weaponShots.length,
        usableSampleCount: usable.length,
        provenance: "reconstructed",
        confidence: metricConfidence(
          "reconstructed",
          weaponShots.length,
          usable.length,
        ),
        unavailableReasons: usable.length === 0
          ? [...damageReasons, "no_usable_weapon_shots"]
          : damageReasons,
        formulaVersion: `${AIM_FORMULA_VERSION}.accuracyByWeapon`,
      })];
    }),
  );
  const hitgroupSamples = associatedDamages.filter(
    (damage) => damage.hitgroup !== null && damage.hitgroup.trim().length > 0,
  );
  const hitgroups = [
    "head",
    "chest",
    "stomach",
    "left_arm",
    "right_arm",
    "left_leg",
    "right_leg",
    "generic",
  ];
  const hitgroupDistribution = Object.fromEntries(
    hitgroups.map((hitgroup) => {
      const count = hitgroupSamples.filter(
        (damage) => damage.hitgroup?.toLowerCase() === hitgroup,
      ).length;
      return [hitgroup, qualityMetric({
        value: hitgroupSamples.length === 0
          ? null
          : count / hitgroupSamples.length,
        unit: "ratio",
        sampleCount: associatedDamages.length,
        usableSampleCount: hitgroupSamples.length,
        provenance: "observed",
        confidence: metricConfidence(
          "observed",
          associatedDamages.length,
          hitgroupSamples.length,
        ),
        unavailableReasons: hitgroupSamples.length === associatedDamages.length
          ? damageReasons
          : [...damageReasons, "missing_hitgroups"],
        formulaVersion: `${AIM_FORMULA_VERSION}.hitgroupDistribution`,
      })];
    }),
  );
  return {
    ...values,
    metrics,
    accuracyByWeapon,
    hitgroupDistribution,
  };
}
