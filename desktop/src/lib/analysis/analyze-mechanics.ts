import type {
  BulletImpactEvent,
  DamageEvent,
  Frame,
  MatchData,
  MatchEvent,
  PlayerId,
  PlayerPos,
  Round,
  WeaponFireEvent,
} from "@/lib/types";
import {
  MECHANICS_ANALYSIS_SPEC_VERSION,
  type CrosshairPlacement,
  type DuelAnalysis,
  type Engagement,
  type FirstVisibility,
  type FiringSequence,
  type MechanicsAnalysis,
  type MechanicsEvidence,
  type RoundMechanicsAnalysis,
  type ShotAssociation,
  type ShotMovementAnalysis,
  type UnmatchedShotFact,
} from "./mechanics-types";
import {
  hasClearLineOfSight,
  type MapGeometry,
  validMapGeometry,
} from "./visibility-geometry";

export const ENGAGEMENT_GAP_SECONDS = 5;
export const SHOT_ASSOCIATION_MAX_TICKS = 2;
export const FIRING_SEQUENCE_MAX_GAP_SECONDS = 0.25;
export const MOVEMENT_SAMPLE_MAX_AGE_SECONDS = 0.25;
export const STATIONARY_SPEED_MAX = 5;
export const COUNTER_STRAFE_REFERENCE_SPEED_MIN = 30;
export const PLAYER_EYE_HEIGHT_STANDING = 64;
export const PLAYER_EYE_HEIGHT_CROUCHED = 46;

export type AnalyzeMechanicsContext = {
  matchId: string;
  generatedAt: string;
  mapGeometry?: MapGeometry;
};

type CombatFact = {
  kind: "damage" | "kill";
  attackerId: string;
  victimId: string;
  time: number;
  tick: number | null;
  sortTick: number;
  sequence: number | null;
  fallbackOrder: number;
  damageHealth: number;
  evidence: MechanicsEvidence;
};

type MutableEngagement = {
  participants: [string, string];
  initiatorId: string;
  facts: CombatFact[];
  unavailableReasons: Set<string>;
};

type OrderedFire = {
  sourceIndex: number;
  shooterId: string;
  weapon: string;
  fire: WeaponFireEvent;
  sortTick: number;
  evidence: MechanicsEvidence;
  shot: ShotAssociation;
};

type OrderedShotFact = {
  tick: number;
  sequence: number | null;
  time: number;
};

type MutableFiringSequence = {
  shooterId: string;
  weapon: string;
  shots: ShotAssociation[];
};

function id(value: PlayerId): string {
  return String(value);
}

function playerTeamAtOrBefore(
  round: Round,
  playerId: string,
  time: number,
): number | null {
  for (let frameIndex = round.frames.length - 1; frameIndex >= 0; frameIndex--) {
    const frame = round.frames[frameIndex];
    if (frame.t > time) continue;
    const player = frame.players.find((candidate) => id(candidate.id) === playerId);
    if (player) return player.team;
  }
  for (const frame of round.frames) {
    const player = frame.players.find((candidate) => id(candidate.id) === playerId);
    if (player) return player.team;
  }
  return null;
}

function opposingPlayers(
  round: Round,
  attackerId: string,
  victimId: string,
  time: number,
): boolean {
  if (attackerId === victimId) return false;
  const attackerTeam = playerTeamAtOrBefore(round, attackerId, time);
  const victimTeam = playerTeamAtOrBefore(round, victimId, time);
  return (
    (attackerTeam === 2 || attackerTeam === 3) &&
    (victimTeam === 2 || victimTeam === 3) &&
    attackerTeam !== victimTeam
  );
}

function pair(attackerId: string, victimId: string): [string, string] {
  return attackerId.localeCompare(victimId) <= 0
    ? [attackerId, victimId]
    : [victimId, attackerId];
}

function pairKey(participants: [string, string]): string {
  return `${participants[0]}\u0000${participants[1]}`;
}

function normalizedBallisticWeapon(weapon: string | undefined): string | null {
  if (weapon === undefined) return null;
  const normalized = weapon
    .toLowerCase()
    .replace(/^weapon_/, "")
    .replaceAll("-", "_")
    .trim();
  if (
    normalized.length === 0 ||
    /grenade|flash|smoke|molotov|incendiary|incgrenade|decoy/.test(normalized) ||
    /knife|bayonet|karambit|c4|bomb|world|fall|inferno|trigger_hurt/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function compareOrderedShotFacts(
  left: OrderedShotFact,
  right: OrderedShotFact,
): number {
  return (
    left.tick - right.tick ||
    (left.sequence ?? Number.MAX_SAFE_INTEGER) -
      (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
    left.time - right.time
  );
}

function firePrecedesFact(fire: OrderedFire, fact: OrderedShotFact): boolean {
  if (fire.sortTick !== fact.tick) return fire.sortTick < fact.tick;
  if (fire.fire.sequence !== undefined && fact.sequence !== null) {
    return fire.fire.sequence < fact.sequence;
  }
  return fire.fire.t <= fact.time;
}

function sameFireOrder(left: OrderedFire, right: OrderedFire): boolean {
  return (
    left.sortTick === right.sortTick &&
    (left.fire.sequence ?? null) === (right.fire.sequence ?? null) &&
    left.fire.t === right.fire.t
  );
}

function matchingFire(
  fires: OrderedFire[],
  fact: OrderedShotFact,
  weapon: string | null,
): { fire: OrderedFire | null; reason: UnmatchedShotFact["reason"] | null } {
  const candidates = fires
    .filter(
      (candidate) =>
        firePrecedesFact(candidate, fact) &&
        fact.tick - candidate.sortTick <= SHOT_ASSOCIATION_MAX_TICKS &&
        (weapon === null || candidate.weapon === weapon),
    )
    .sort((left, right) =>
      compareOrderedShotFacts(
        {
          tick: right.sortTick,
          sequence: right.fire.sequence ?? null,
          time: right.fire.t,
        },
        {
          tick: left.sortTick,
          sequence: left.fire.sequence ?? null,
          time: left.fire.t,
        },
      ) || right.sourceIndex - left.sourceIndex
    );
  if (candidates.length === 0) return { fire: null, reason: "no_matching_fire" };
  if (candidates.length > 1 && sameFireOrder(candidates[0], candidates[1])) {
    return { fire: null, reason: "ambiguous_fire" };
  }
  return { fire: candidates[0], reason: null };
}

function evidenceForDamage(
  round: Round,
  damage: DamageEvent,
  sourceIndex: number,
  attackerId: string,
  victimId: string,
): MechanicsEvidence {
  return {
    evidenceId: `r${round.number}-mechanics-damage-${String(sourceIndex).padStart(4, "0")}`,
    roundNumber: round.number,
    tick: damage.tick,
    sequence: damage.sequence ?? null,
    time: damage.t,
    type: "damage",
    actors: [attackerId, victimId],
  };
}

function evidenceForFire(
  round: Round,
  fire: WeaponFireEvent,
  sourceIndex: number,
  shooterId: string,
): MechanicsEvidence {
  return {
    evidenceId: `r${round.number}-mechanics-fire-${String(sourceIndex).padStart(4, "0")}`,
    roundNumber: round.number,
    tick: fire.tick ?? null,
    sequence: fire.sequence ?? null,
    time: fire.t,
    type: "weapon_fire",
    actors: [shooterId],
  };
}

function evidenceForImpact(
  round: Round,
  impact: BulletImpactEvent,
  sourceIndex: number,
  shooterId: string | null,
): MechanicsEvidence {
  return {
    evidenceId: `r${round.number}-mechanics-impact-${String(sourceIndex).padStart(4, "0")}`,
    roundNumber: round.number,
    tick: impact.tick,
    sequence: impact.sequence ?? null,
    time: impact.t,
    type: "bullet_impact",
    actors: shooterId === null ? [] : [shooterId],
  };
}

function evidenceForKill(
  round: Round,
  event: MatchEvent,
  sourceIndex: number,
  attackerId: string,
  victimId: string,
): MechanicsEvidence {
  return {
    evidenceId: `r${round.number}-mechanics-kill-${String(sourceIndex).padStart(4, "0")}`,
    roundNumber: round.number,
    tick: event.tick ?? null,
    sequence: event.sequence ?? null,
    time: event.t,
    type: "kill",
    actors: [attackerId, victimId],
  };
}

function evidenceForVisibility(
  round: Round,
  engagement: Engagement,
  time: number,
  tickRate: number,
): MechanicsEvidence {
  return {
    evidenceId: `${engagement.engagementId}-visibility`,
    roundNumber: round.number,
    tick: Math.round(round.startTick + time * tickRate),
    sequence: null,
    time,
    type: "visibility",
    actors: [...engagement.participants],
  };
}

function compareFacts(left: CombatFact, right: CombatFact): number {
  return (
    left.sortTick - right.sortTick ||
    (left.sequence ?? Number.MAX_SAFE_INTEGER) -
      (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
    left.time - right.time ||
    (left.kind === right.kind ? 0 : left.kind === "damage" ? -1 : 1) ||
    left.fallbackOrder - right.fallbackOrder ||
    left.evidence.evidenceId.localeCompare(right.evidence.evidenceId)
  );
}

function finalizeEngagement(
  roundNumber: number,
  index: number,
  mutable: MutableEngagement,
): Engagement {
  const first = mutable.facts[0];
  const last = mutable.facts[mutable.facts.length - 1];
  const damageTotals = new Map<string, number>();
  let kill: Engagement["kill"] = null;
  for (const fact of mutable.facts) {
    if (fact.kind === "damage") {
      damageTotals.set(
        fact.attackerId,
        (damageTotals.get(fact.attackerId) ?? 0) + fact.damageHealth,
      );
    } else {
      kill = {
        killerId: fact.attackerId,
        victimId: fact.victimId,
        evidenceId: fact.evidence.evidenceId,
      };
    }
  }
  return {
    engagementId: `r${roundNumber}-engagement-${String(index).padStart(3, "0")}`,
    roundNumber,
    participants: mutable.participants,
    initiatorId: first.attackerId,
    startTime: first.time,
    endTime: last.time,
    startTick: first.tick,
    endTick: last.tick,
    damageByPlayer: [...damageTotals.entries()]
      .map(([playerId, damageHealth]) => ({ playerId, damageHealth }))
      .sort((left, right) => left.playerId.localeCompare(right.playerId)),
    kill,
    evidenceIds: mutable.facts.map((fact) => fact.evidence.evidenceId),
    unavailableReasons: [...mutable.unavailableReasons].sort(),
  };
}

function analyzeShots(round: Round, tickRate: number): {
  shots: ShotAssociation[];
  unmatchedImpacts: UnmatchedShotFact[];
  unmatchedDamages: UnmatchedShotFact[];
  excludedWeaponFireEvents: number;
  evidence: MechanicsEvidence[];
} {
  const orderedFires: OrderedFire[] = [];
  const evidence: MechanicsEvidence[] = [];
  let excludedWeaponFireEvents = 0;

  for (const [sourceIndex, fire] of (round.weaponFires ?? []).entries()) {
    if (fire.shooter === undefined) {
      excludedWeaponFireEvents++;
      continue;
    }
    const weapon = normalizedBallisticWeapon(fire.weapon);
    if (weapon === null) {
      excludedWeaponFireEvents++;
      continue;
    }
    const shooterId = id(fire.shooter);
    const proof = evidenceForFire(round, fire, sourceIndex, shooterId);
    evidence.push(proof);
    const unavailableReasons: string[] = [];
    if (round.bulletImpacts === undefined) {
      unavailableReasons.push("missing_bullet_impact_events");
    }
    if (round.damages === undefined) unavailableReasons.push("missing_damage_events");
    orderedFires.push({
      sourceIndex,
      shooterId,
      weapon,
      fire,
      sortTick: fire.tick ?? Math.round(round.startTick + fire.t * tickRate),
      evidence: proof,
      shot: {
        shotId: `r${round.number}-shot-${String(sourceIndex).padStart(4, "0")}`,
        roundNumber: round.number,
        shooterId,
        weapon,
        fireEvidenceId: proof.evidenceId,
        tick: fire.tick ?? null,
        time: fire.t,
        origin: { x: fire.x, y: fire.y, z: fire.z },
        yaw: fire.yaw,
        impacts: [],
        damages: [],
        unavailableReasons,
      },
    });
  }

  orderedFires.sort((left, right) =>
    compareOrderedShotFacts(
      {
        tick: left.sortTick,
        sequence: left.fire.sequence ?? null,
        time: left.fire.t,
      },
      {
        tick: right.sortTick,
        sequence: right.fire.sequence ?? null,
        time: right.fire.t,
      },
    ) || left.sourceIndex - right.sourceIndex
  );
  const firesByShooter = new Map<string, OrderedFire[]>();
  for (const fire of orderedFires) {
    const shooterFires = firesByShooter.get(fire.shooterId) ?? [];
    shooterFires.push(fire);
    firesByShooter.set(fire.shooterId, shooterFires);
  }

  const unmatchedImpacts: UnmatchedShotFact[] = [];
  for (const [sourceIndex, impact] of (round.bulletImpacts ?? []).entries()) {
    const shooterId = impact.shooter === undefined ? null : id(impact.shooter);
    const proof = evidenceForImpact(round, impact, sourceIndex, shooterId);
    evidence.push(proof);
    if (shooterId === null) {
      unmatchedImpacts.push({ evidenceId: proof.evidenceId, reason: "missing_shooter" });
      continue;
    }
    const match = matchingFire(
      firesByShooter.get(shooterId) ?? [],
      {
        tick: impact.tick,
        sequence: impact.sequence ?? null,
        time: impact.t,
      },
      null,
    );
    if (match.fire === null) {
      unmatchedImpacts.push({
        evidenceId: proof.evidenceId,
        reason: match.reason ?? "no_matching_fire",
      });
      continue;
    }
    match.fire.shot.impacts.push({
      evidenceId: proof.evidenceId,
      tick: impact.tick,
      time: impact.t,
      x: impact.x,
      y: impact.y,
      z: impact.z,
    });
  }

  const unmatchedDamages: UnmatchedShotFact[] = [];
  for (const [sourceIndex, damage] of (round.damages ?? []).entries()) {
    if (damage.attacker === undefined || damage.victim === undefined) continue;
    const attackerId = id(damage.attacker);
    const victimId = id(damage.victim);
    if (!opposingPlayers(round, attackerId, victimId, damage.t)) continue;
    const proof = evidenceForDamage(round, damage, sourceIndex, attackerId, victimId);
    if (damage.weapon === undefined) {
      unmatchedDamages.push({ evidenceId: proof.evidenceId, reason: "missing_weapon" });
      continue;
    }
    const weapon = normalizedBallisticWeapon(damage.weapon);
    if (weapon === null) continue;
    const match = matchingFire(
      firesByShooter.get(attackerId) ?? [],
      {
        tick: damage.tick,
        sequence: damage.sequence ?? null,
        time: damage.t,
      },
      weapon,
    );
    if (match.fire === null) {
      unmatchedDamages.push({
        evidenceId: proof.evidenceId,
        reason: match.reason ?? "no_matching_fire",
      });
      continue;
    }
    match.fire.shot.damages.push({
      evidenceId: proof.evidenceId,
      tick: damage.tick,
      time: damage.t,
      victimId,
      damageHealth: damage.damageHealth,
      damageArmor: damage.damageArmor,
      hitgroup: damage.hitgroup ?? null,
    });
  }

  return {
    shots: orderedFires.map((fire) => fire.shot),
    unmatchedImpacts,
    unmatchedDamages,
    excludedWeaponFireEvents,
    evidence,
  };
}

function finalizeFiringSequence(
  roundNumber: number,
  index: number,
  sequence: MutableFiringSequence,
): FiringSequence {
  const first = sequence.shots[0];
  const last = sequence.shots[sequence.shots.length - 1];
  const shotCount = sequence.shots.length;
  return {
    firingSequenceId:
      `r${roundNumber}-firing-sequence-${String(index).padStart(4, "0")}`,
    roundNumber,
    shooterId: sequence.shooterId,
    weapon: sequence.weapon,
    kind: shotCount === 1 ? "tap" : shotCount <= 4 ? "burst" : "spray",
    startTick: first.tick,
    endTick: last.tick,
    startTime: first.time,
    endTime: last.time,
    shotCount,
    shotIds: sequence.shots.map((shot) => shot.shotId),
    fireEvidenceIds: sequence.shots.map((shot) => shot.fireEvidenceId),
  };
}

function analyzeFiringSequences(
  roundNumber: number,
  shots: ShotAssociation[],
): FiringSequence[] {
  const sequences: MutableFiringSequence[] = [];
  const activeByShooter = new Map<string, MutableFiringSequence>();
  for (const shot of shots) {
    const current = activeByShooter.get(shot.shooterId);
    const previousShot = current?.shots.at(-1);
    const continues =
      current !== undefined &&
      previousShot !== undefined &&
      current.weapon === shot.weapon &&
      shot.time - previousShot.time <= FIRING_SEQUENCE_MAX_GAP_SECONDS;
    if (!continues) {
      const next = {
        shooterId: shot.shooterId,
        weapon: shot.weapon,
        shots: [shot],
      };
      sequences.push(next);
      activeByShooter.set(shot.shooterId, next);
      continue;
    }
    current.shots.push(shot);
  }
  sequences.sort(
    (left, right) =>
      left.shots[0].time - right.shots[0].time ||
      left.shooterId.localeCompare(right.shooterId) ||
      left.shots[0].shotId.localeCompare(right.shots[0].shotId),
  );
  return sequences.map((sequence, index) =>
    finalizeFiringSequence(roundNumber, index, sequence)
  );
}

function playerInFrame(frame: Frame, playerId: string): PlayerPos | null {
  return frame.players.find((player) => id(player.id) === playerId) ?? null;
}

function horizontalSpeed(player: PlayerPos): {
  value: number;
  source: ShotMovementAnalysis["speedSource"];
} | null {
  if (
    Number.isFinite(player.velocityX) &&
    Number.isFinite(player.velocityY)
  ) {
    return {
      value: Math.hypot(player.velocityX ?? 0, player.velocityY ?? 0),
      source: "velocity_components",
    };
  }
  if (Number.isFinite(player.speed)) {
    return { value: Math.abs(player.speed ?? 0), source: "speed" };
  }
  return null;
}

function analyzeShotMovements(
  round: Round,
  shots: ShotAssociation[],
): ShotMovementAnalysis[] {
  return shots.map((shot) => {
    let sampleIndex = -1;
    for (let index = round.frames.length - 1; index >= 0; index--) {
      if (round.frames[index].t <= shot.time) {
        sampleIndex = index;
        break;
      }
    }
    if (sampleIndex < 0) {
      return {
        shotId: shot.shotId,
        shooterId: shot.shooterId,
        sampleTime: null,
        sampleAgeSeconds: null,
        horizontalSpeed: null,
        speedSource: null,
        movementState: "unavailable",
        counterStrafeAssessment: "unavailable",
        referenceTime: null,
        referenceSpeed: null,
        unavailableReasons: ["missing_player_frame"],
      };
    }
    const sample = round.frames[sampleIndex];
    const sampleAgeSeconds = shot.time - sample.t;
    const player = playerInFrame(sample, shot.shooterId);
    if (
      player === null ||
      sampleAgeSeconds > MOVEMENT_SAMPLE_MAX_AGE_SECONDS
    ) {
      return {
        shotId: shot.shotId,
        shooterId: shot.shooterId,
        sampleTime: sample.t,
        sampleAgeSeconds,
        horizontalSpeed: null,
        speedSource: null,
        movementState: "unavailable",
        counterStrafeAssessment: "unavailable",
        referenceTime: null,
        referenceSpeed: null,
        unavailableReasons: [
          player === null ? "missing_player_frame" : "stale_player_frame",
        ],
      };
    }
    const speed = horizontalSpeed(player);
    if (speed === null) {
      return {
        shotId: shot.shotId,
        shooterId: shot.shooterId,
        sampleTime: sample.t,
        sampleAgeSeconds,
        horizontalSpeed: null,
        speedSource: null,
        movementState: "unavailable",
        counterStrafeAssessment: "unavailable",
        referenceTime: null,
        referenceSpeed: null,
        unavailableReasons: ["missing_velocity"],
      };
    }
    const movementState =
      speed.value <= STATIONARY_SPEED_MAX ? "stationary" : "moving";
    if (movementState === "moving") {
      return {
        shotId: shot.shotId,
        shooterId: shot.shooterId,
        sampleTime: sample.t,
        sampleAgeSeconds,
        horizontalSpeed: speed.value,
        speedSource: speed.source,
        movementState,
        counterStrafeAssessment: "not_observed",
        referenceTime: null,
        referenceSpeed: null,
        unavailableReasons: [],
      };
    }

    let reference: { time: number; speed: number } | null = null;
    let hasPriorSpeed = false;
    for (let index = sampleIndex - 1; index >= 0; index--) {
      const frame = round.frames[index];
      if (shot.time - frame.t > MOVEMENT_SAMPLE_MAX_AGE_SECONDS) break;
      const priorPlayer = playerInFrame(frame, shot.shooterId);
      const priorSpeed = priorPlayer === null ? null : horizontalSpeed(priorPlayer);
      if (priorSpeed === null) continue;
      hasPriorSpeed = true;
      if (priorSpeed.value >= COUNTER_STRAFE_REFERENCE_SPEED_MIN) {
        reference = { time: frame.t, speed: priorSpeed.value };
        break;
      }
    }
    return {
      shotId: shot.shotId,
      shooterId: shot.shooterId,
      sampleTime: sample.t,
      sampleAgeSeconds,
      horizontalSpeed: speed.value,
      speedSource: speed.source,
      movementState,
      counterStrafeAssessment:
        reference !== null
          ? "compatible"
          : hasPriorSpeed
            ? "not_observed"
            : "unavailable",
      referenceTime: reference?.time ?? null,
      referenceSpeed: reference?.speed ?? null,
      unavailableReasons: hasPriorSpeed ? [] : ["missing_reference_velocity"],
    };
  });
}

function eyePosition(player: PlayerPos): {
  x: number;
  y: number;
  z: number;
} {
  const duckAmount = Math.min(1, Math.max(0, player.duckAmount ?? 0));
  const eyeHeight =
    PLAYER_EYE_HEIGHT_STANDING +
    (PLAYER_EYE_HEIGHT_CROUCHED - PLAYER_EYE_HEIGHT_STANDING) * duckAmount;
  return { x: player.x, y: player.y, z: player.z + eyeHeight };
}

function analyzeFirstVisibilities(
  round: Round,
  tickRate: number,
  engagements: Engagement[],
  mapName: string,
  geometry: MapGeometry | undefined,
): { visibilities: FirstVisibility[]; evidence: MechanicsEvidence[] } {
  const evidence: MechanicsEvidence[] = [];
  const geometryReason =
    geometry === undefined
      ? "missing_map_geometry"
      : geometry.map !== mapName
        ? "map_geometry_mismatch"
        : !validMapGeometry(geometry)
          ? "invalid_map_geometry"
          : null;
  const visibilities = engagements.map((engagement): FirstVisibility => {
    const base = {
      visibilityId: `${engagement.engagementId}-first-visibility`,
      engagementId: engagement.engagementId,
      participants: engagement.participants,
    };
    if (geometryReason !== null || geometry === undefined) {
      return {
        ...base,
        time: null,
        tick: null,
        geometryId: geometry?.geometryId ?? null,
        evidenceId: null,
        unavailableReasons: [geometryReason ?? "missing_map_geometry"],
      };
    }
    for (const frame of round.frames) {
      if (frame.t > engagement.startTime) break;
      const first = playerInFrame(frame, engagement.participants[0]);
      const second = playerInFrame(frame, engagement.participants[1]);
      if (
        first === null ||
        second === null ||
        first.hp <= 0 ||
        second.hp <= 0 ||
        first.team === second.team
      ) {
        continue;
      }
      if (
        hasClearLineOfSight(
          eyePosition(first),
          eyePosition(second),
          geometry,
        )
      ) {
        const proof = evidenceForVisibility(round, engagement, frame.t, tickRate);
        evidence.push(proof);
        return {
          ...base,
          time: frame.t,
          tick: proof.tick,
          geometryId: geometry.geometryId,
          evidenceId: proof.evidenceId,
          unavailableReasons: [],
        };
      }
    }
    return {
      ...base,
      time: null,
      tick: null,
      geometryId: geometry.geometryId,
      evidenceId: null,
      unavailableReasons: ["no_visible_frame_before_engagement"],
    };
  });
  return { visibilities, evidence };
}

function normalizedAngleDifference(left: number, right: number): number {
  return Math.abs(((left - right + 540) % 360) - 180);
}

function analyzeCrosshairPlacements(
  round: Round,
  visibilities: FirstVisibility[],
): CrosshairPlacement[] {
  return visibilities.flatMap((visibility) =>
    visibility.participants.map((playerId, participantIndex) => {
      const targetId = visibility.participants[participantIndex === 0 ? 1 : 0];
      const base = {
        placementId: `${visibility.visibilityId}-${playerId}`,
        visibilityId: visibility.visibilityId,
        playerId,
        targetId,
        time: visibility.time,
        tick: visibility.tick,
        evidenceId: visibility.evidenceId,
      };
      if (visibility.time === null) {
        return {
          ...base,
          yawErrorDegrees: null,
          pitchErrorDegrees: null,
          totalErrorDegrees: null,
          unavailableReasons: [...visibility.unavailableReasons],
        };
      }
      const frame = round.frames.find((candidate) => candidate.t === visibility.time);
      const player = frame === undefined ? null : playerInFrame(frame, playerId);
      const target = frame === undefined ? null : playerInFrame(frame, targetId);
      if (player === null || target === null) {
        return {
          ...base,
          yawErrorDegrees: null,
          pitchErrorDegrees: null,
          totalErrorDegrees: null,
          unavailableReasons: ["missing_player_frame"],
        };
      }
      const sourceEye = eyePosition(player);
      const targetEye = eyePosition(target);
      const deltaX = targetEye.x - sourceEye.x;
      const deltaY = targetEye.y - sourceEye.y;
      const deltaZ = targetEye.z - sourceEye.z;
      const horizontalDistance = Math.hypot(deltaX, deltaY);
      const targetYaw = Math.atan2(deltaY, deltaX) * 180 / Math.PI;
      const targetPitch =
        -Math.atan2(deltaZ, horizontalDistance) * 180 / Math.PI;
      const yawErrorDegrees = normalizedAngleDifference(player.yaw, targetYaw);
      if (!Number.isFinite(player.pitch)) {
        return {
          ...base,
          yawErrorDegrees,
          pitchErrorDegrees: null,
          totalErrorDegrees: null,
          unavailableReasons: ["missing_pitch"],
        };
      }
      const pitchErrorDegrees = Math.abs((player.pitch ?? 0) - targetPitch);
      return {
        ...base,
        yawErrorDegrees,
        pitchErrorDegrees,
        totalErrorDegrees: Math.hypot(yawErrorDegrees, pitchErrorDegrees),
        unavailableReasons: [],
      };
    })
  );
}

function analyzeDuels(
  round: Round,
  engagements: Engagement[],
  visibilities: FirstVisibility[],
  shots: ShotAssociation[],
  firingSequences: FiringSequence[],
  shotMovements: ShotMovementAnalysis[],
  crosshairPlacements: CrosshairPlacement[],
): DuelAnalysis[] {
  return engagements.map((engagement, index) => {
    const visibility = visibilities[index];
    const contextStart = visibility.time ?? engagement.startTime;
    const duelShots = shots.filter(
      (shot) => shot.time >= contextStart && shot.time <= engagement.endTime,
    );
    const duelShotIds = new Set(duelShots.map((shot) => shot.shotId));
    const duelSequences = firingSequences.filter((sequence) =>
      sequence.shotIds.some((shotId) => duelShotIds.has(shotId))
    );
    const duelMovementShotIds = new Set(
      shotMovements
        .filter((movement) => duelShotIds.has(movement.shotId))
        .map((movement) => movement.shotId),
    );
    const unavailableReasons = new Set([
      ...engagement.unavailableReasons,
      ...visibility.unavailableReasons,
    ]);
    if (round.weaponFires === undefined) {
      unavailableReasons.add("missing_weapon_fire_events");
    }
    const evidenceIds = new Set(engagement.evidenceIds);
    if (visibility.evidenceId !== null) evidenceIds.add(visibility.evidenceId);
    for (const shot of duelShots) evidenceIds.add(shot.fireEvidenceId);
    return {
      duelId: `r${round.number}-duel-${String(index).padStart(3, "0")}`,
      engagementId: engagement.engagementId,
      participants: engagement.participants,
      initiatorId: engagement.initiatorId,
      firstVisibilityId: visibility.visibilityId,
      reactionTimeSeconds:
        visibility.time === null
          ? null
          : engagement.startTime - visibility.time,
      startTime: engagement.startTime,
      endTime: engagement.endTime,
      players: engagement.participants.map((playerId) => ({
        playerId,
        damageHealth:
          engagement.damageByPlayer.find(
            (damage) => damage.playerId === playerId,
          )?.damageHealth ?? 0,
        shotIds: duelShots
          .filter((shot) => shot.shooterId === playerId)
          .map((shot) => shot.shotId),
        firingSequenceIds: duelSequences
          .filter((sequence) => sequence.shooterId === playerId)
          .map((sequence) => sequence.firingSequenceId),
        movementShotIds: duelShots
          .filter(
            (shot) =>
              shot.shooterId === playerId &&
              duelMovementShotIds.has(shot.shotId),
          )
          .map((shot) => shot.shotId),
        crosshairPlacementId:
          crosshairPlacements.find(
            (placement) =>
              placement.visibilityId === visibility.visibilityId &&
              placement.playerId === playerId,
          )?.placementId ?? null,
      })),
      kill: engagement.kill,
      evidenceIds: [...evidenceIds],
      unavailableReasons: [...unavailableReasons].sort(),
    };
  });
}

function compareMechanicsEvidence(
  round: Round,
  tickRate: number,
  left: MechanicsEvidence,
  right: MechanicsEvidence,
): number {
  const leftTick = left.tick ?? Math.round(round.startTick + left.time * tickRate);
  const rightTick = right.tick ?? Math.round(round.startTick + right.time * tickRate);
  return (
    leftTick - rightTick ||
    (left.sequence ?? Number.MAX_SAFE_INTEGER) -
      (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
    left.time - right.time ||
    left.evidenceId.localeCompare(right.evidenceId)
  );
}

function analyzeRound(
  round: Round,
  tickRate: number,
  mapName: string,
  geometry: MapGeometry | undefined,
): {
  analysis: RoundMechanicsAnalysis;
  evidence: MechanicsEvidence[];
} {
  if (round.frames.length === 0) {
    throw new Error(`Cannot analyze mechanics for round ${round.number} without its frame payload.`);
  }

  const facts: CombatFact[] = [];
  let excludedDamageEvents = 0;
  let excludedKillEvents = 0;

  for (const [sourceIndex, damage] of (round.damages ?? []).entries()) {
    if (damage.attacker === undefined || damage.victim === undefined) {
      excludedDamageEvents++;
      continue;
    }
    const attackerId = id(damage.attacker);
    const victimId = id(damage.victim);
    if (!opposingPlayers(round, attackerId, victimId, damage.t)) {
      excludedDamageEvents++;
      continue;
    }
    const proof = evidenceForDamage(round, damage, sourceIndex, attackerId, victimId);
    facts.push({
      kind: "damage",
      attackerId,
      victimId,
      time: damage.t,
      tick: damage.tick,
      sortTick: damage.tick,
      sequence: damage.sequence ?? null,
      fallbackOrder: sourceIndex,
      damageHealth: damage.damageHealth,
      evidence: proof,
    });
  }

  for (const [sourceIndex, event] of round.events.entries()) {
    if (
      event.type !== "kill" ||
      event.killer === undefined ||
      event.victim === undefined
    ) {
      continue;
    }
    const attackerId = id(event.killer);
    const victimId = id(event.victim);
    if (!opposingPlayers(round, attackerId, victimId, event.t)) {
      excludedKillEvents++;
      continue;
    }
    const proof = evidenceForKill(round, event, sourceIndex, attackerId, victimId);
    facts.push({
      kind: "kill",
      attackerId,
      victimId,
      time: event.t,
      tick: event.tick ?? null,
      sortTick: event.tick ?? Math.round(round.startTick + event.t * tickRate),
      sequence: event.sequence ?? null,
      fallbackOrder: sourceIndex,
      damageHealth: 0,
      evidence: proof,
    });
  }

  facts.sort(compareFacts);
  const active = new Map<string, MutableEngagement>();
  const completed: MutableEngagement[] = [];
  for (const fact of facts) {
    const participants = pair(fact.attackerId, fact.victimId);
    const key = pairKey(participants);
    const current = active.get(key);
    const lastFact = current?.facts.at(-1);
    const withinWindow = lastFact !== undefined &&
      fact.time - lastFact.time <= ENGAGEMENT_GAP_SECONDS;
    let engagement = current;
    if (!engagement || !withinWindow) {
      if (current) completed.push(current);
      engagement = {
        participants,
        initiatorId: fact.attackerId,
        facts: [],
        unavailableReasons: new Set(),
      };
      if (round.damages === undefined) {
        engagement.unavailableReasons.add("missing_damage_events");
      }
      active.set(key, engagement);
    }
    engagement.facts.push(fact);
    if (fact.kind === "kill") {
      completed.push(engagement);
      active.delete(key);
    }
  }
  completed.push(...active.values());
  completed.sort((left, right) => compareFacts(left.facts[0], right.facts[0]));
  const engagements = completed.map((engagement, index) =>
    finalizeEngagement(round.number, index, engagement)
  );

  const shotAnalysis = analyzeShots(round, tickRate);
  const firingSequences = analyzeFiringSequences(
    round.number,
    shotAnalysis.shots,
  );
  const shotMovements = analyzeShotMovements(round, shotAnalysis.shots);
  const visibilityAnalysis = analyzeFirstVisibilities(
    round,
    tickRate,
    engagements,
    mapName,
    geometry,
  );
  const crosshairPlacements = analyzeCrosshairPlacements(
    round,
    visibilityAnalysis.visibilities,
  );
  const duels = analyzeDuels(
    round,
    engagements,
    visibilityAnalysis.visibilities,
    shotAnalysis.shots,
    firingSequences,
    shotMovements,
    crosshairPlacements,
  );
  const unavailableReasons = new Set<string>();
  if (round.damages === undefined) unavailableReasons.add("missing_damage_events");
  if (round.weaponFires === undefined) {
    unavailableReasons.add("missing_weapon_fire_events");
  }
  if (round.bulletImpacts === undefined) {
    unavailableReasons.add("missing_bullet_impact_events");
  }
  const roundEvidence = [
    ...facts.map((fact) => fact.evidence),
    ...shotAnalysis.evidence,
    ...visibilityAnalysis.evidence,
  ];
  const evidenceById = new Map(
    roundEvidence.map((proof) => [proof.evidenceId, proof]),
  );
  return {
    analysis: {
      roundNumber: round.number,
      engagements,
      firstVisibilities: visibilityAnalysis.visibilities,
      crosshairPlacements,
      duels,
      shots: shotAnalysis.shots,
      firingSequences,
      shotMovements,
      unmatchedImpacts: shotAnalysis.unmatchedImpacts,
      unmatchedDamages: shotAnalysis.unmatchedDamages,
      excludedWeaponFireEvents: shotAnalysis.excludedWeaponFireEvents,
      excludedDamageEvents,
      excludedKillEvents,
      unavailableReasons: [...unavailableReasons].sort(),
    },
    evidence: [...evidenceById.values()].sort((left, right) =>
      compareMechanicsEvidence(round, tickRate, left, right)
    ),
  };
}

export function analyzeMechanics(
  match: MatchData,
  context: AnalyzeMechanicsContext,
): MechanicsAnalysis {
  const rounds: RoundMechanicsAnalysis[] = [];
  const evidence: MechanicsEvidence[] = [];
  for (const round of match.rounds) {
    const result = analyzeRound(
      round,
      match.meta.tickRate,
      match.meta.map,
      context.mapGeometry,
    );
    rounds.push(result.analysis);
    evidence.push(...result.evidence);
  }
  return {
    specVersion: MECHANICS_ANALYSIS_SPEC_VERSION,
    inputSchemaVersion: match.schemaVersion ?? "roundlab.replay.legacy",
    parserVersion: match.parserVersion ?? "unknown",
    matchId: context.matchId,
    generatedAt: context.generatedAt,
    rounds,
    evidence,
  };
}
