import type {
  MechanicsAnalysis,
  MechanicsEvidence,
} from "./mechanics-types";

export type PlayerMechanicsSummary = {
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
  tapSequences: number | null;
  burstSequences: number | null;
  spraySequences: number | null;
  stationaryShots: number | null;
  movingShots: number | null;
  movementSamples: number | null;
  counterStrafeRate: number | null;
  counterStrafeSamples: number | null;
  timeToDamageMs: number | null;
  timeToDamageSamples: number | null;
  crosshairErrorDegrees: number | null;
  crosshairSamples: number | null;
  duels: number | null;
};

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
      tapSequences: null,
      burstSequences: null,
      spraySequences: null,
      stationaryShots: null,
      movingShots: null,
      movementSamples: null,
      counterStrafeRate: null,
      counterStrafeSamples: null,
      timeToDamageMs: null,
      timeToDamageSamples: null,
      crosshairErrorDegrees: null,
      crosshairSamples: null,
      duels: null,
    };
  }

  const rounds = mechanics.rounds;
  const shots = rounds.flatMap((round) => round.shots).filter(
    (shot) => shot.shooterId === playerId,
  );
  const hitShots = shots.filter((shot) => shot.damages.length > 0);
  const proofById = evidenceById(mechanics);
  const hasMissingDamageStream = shots.some((shot) =>
    shot.unavailableReasons.includes("missing_damage_events")
  );
  const hasUnmatchedPlayerDamage = rounds.some((round) =>
    round.unmatchedDamages.some((unmatched) => {
      const proof = proofById.get(unmatched.evidenceId);
      return proof?.actors[0] === playerId;
    })
  );
  const damageAssociationReliable =
    !hasMissingDamageStream &&
    !hasUnmatchedPlayerDamage &&
    !(hasRecordedKill && hitShots.length === 0);
  const spottedStateReliable =
    shots.length > 0 &&
    shots.every((shot) => typeof shot.enemySpotted === "boolean");
  const spottedShots = shots.filter((shot) => shot.enemySpotted === true);
  const associatedDamages = shots.flatMap((shot) => shot.damages);
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
  const headAccuracyDamages = shots
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
  const rifleSprayShots = shots.filter((shot) =>
    sprayShotIds.has(shot.shotId)
  );
  const sprayStateReliable =
    rifleSprayShots.length > 0 &&
    rifleSprayShots.every((shot) => typeof shot.enemySpotted === "boolean");
  const sprayShots = rifleSprayShots.filter(
    (shot) => shot.enemySpotted === true,
  );
  const playerSequences = rounds
    .flatMap((round) => round.firingSequences)
    .filter((sequence) => sequence.shooterId === playerId);
  const assessedMovements = rounds
    .flatMap((round) => round.shotMovements)
    .filter(
      (movement) =>
        movement.shooterId === playerId &&
        movement.counterStrafeAssessment !== "unavailable",
    );
  const movementSamples = rounds
    .flatMap((round) => round.shotMovements)
    .filter(
      (movement) =>
        movement.shooterId === playerId &&
        movement.movementState !== "unavailable",
    );
  const playerDuels = rounds
    .flatMap((round) => round.duels)
    .filter((duel) => duel.participants.includes(playerId));
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
  return {
    shots: shots.length,
    hitShots: damageAssociationReliable ? hitShots.length : null,
    damage: damageAssociationReliable ? totalDamage : null,
    headHits: damageAssociationReliable ? allHeadHits : null,
    bodyHits: damageAssociationReliable ? allBodyHits : null,
    averageDamagePerHit:
      !damageAssociationReliable || associatedDamages.length === 0
        ? null
        : totalDamage / associatedDamages.length,
    accuracy: !damageAssociationReliable || shots.length === 0
      ? null
      : hitShots.length / shots.length,
    spottedAccuracy:
      !damageAssociationReliable ||
      !spottedStateReliable ||
      spottedShots.length === 0
        ? null
        : spottedShots.filter((shot) => shot.damages.length > 0).length /
          spottedShots.length,
    spottedShots: spottedStateReliable ? spottedShots.length : null,
    headAccuracy:
      !damageAssociationReliable || headAccuracyDamages.length === 0
        ? null
        : headHits.length / headAccuracyDamages.length,
    sprayAccuracy:
      !damageAssociationReliable ||
      !sprayStateReliable ||
      sprayShots.length === 0
        ? null
        : sprayShots.filter((shot) => shot.damages.length > 0).length /
          sprayShots.length,
    tapSequences: playerSequences.filter((sequence) => sequence.kind === "tap").length,
    burstSequences: playerSequences.filter((sequence) => sequence.kind === "burst").length,
    spraySequences: playerSequences.filter((sequence) => sequence.kind === "spray").length,
    stationaryShots: movementSamples.filter(
      (movement) => movement.movementState === "stationary",
    ).length,
    movingShots: movementSamples.filter(
      (movement) => movement.movementState === "moving",
    ).length,
    movementSamples: movementSamples.length,
    counterStrafeRate: assessedMovements.length === 0
      ? null
      : assessedMovements.filter(
        (movement) => movement.counterStrafeAssessment === "compatible",
      ).length / assessedMovements.length,
    counterStrafeSamples: assessedMovements.length,
    timeToDamageMs: ttdMedian === null ? null : ttdMedian * 1000,
    timeToDamageSamples: timeToDamage.length,
    crosshairErrorDegrees: median(crosshairErrors),
    crosshairSamples: crosshairErrors.length,
    duels: playerDuels.length,
  };
}
