import type {
  DamageEvent,
  PlayerPos,
  Round,
  UtilityEffect,
} from "@/lib/types";
import {
  fireIsSmoked,
  fireRadiusWorld,
  SMOKE_RADIUS_WORLD,
} from "@/lib/utility-geometry";
import type {
  FireSpatialImpact,
  SmokeSpatialImpact,
  UtilitySideSamples,
} from "./spatial-types";
import {
  hasClearLineOfSight,
  type MapGeometry,
} from "./visibility-geometry";

export const FIRE_VERTICAL_TOLERANCE_WORLD = 64;
export const UTILITY_FRAME_MAX_AGE_SECONDS = 0.25;

type MutableFireImpact = FireSpatialImpact & {
  damagedPlayers: Set<string>;
};

function sideForTeam(team: number | undefined): "T" | "CT" | null {
  if (team === 2) return "T";
  if (team === 3) return "CT";
  return null;
}

function emptySideSamples(): UtilitySideSamples {
  return { T: 0, CT: 0, unknown: 0 };
}

function incrementSideSample(samples: UtilitySideSamples, team: number): void {
  const side = sideForTeam(team);
  if (side === null) samples.unknown++;
  else samples[side]++;
}

function eyePosition(player: PlayerPos): {
  x: number;
  y: number;
  z: number;
} {
  const duck = Math.min(1, Math.max(0, player.duckAmount ?? 0));
  return {
    x: player.x,
    y: player.y,
    z: player.z + 64 + (46 - 64) * duck,
  };
}

function distance3d(
  left: { x: number; y: number; z: number },
  right: { x: number; y: number; z: number },
): number {
  return Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z);
}

function pointToSegmentDistance(
  point: { x: number; y: number; z: number },
  start: { x: number; y: number; z: number },
  end: { x: number; y: number; z: number },
): number {
  const delta = {
    x: end.x - start.x,
    y: end.y - start.y,
    z: end.z - start.z,
  };
  const lengthSquared =
    delta.x * delta.x + delta.y * delta.y + delta.z * delta.z;
  if (lengthSquared === 0) return distance3d(point, start);
  const projection = Math.max(
    0,
    Math.min(
      1,
      (
        (point.x - start.x) * delta.x +
        (point.y - start.y) * delta.y +
        (point.z - start.z) * delta.z
      ) / lengthSquared,
    ),
  );
  return distance3d(point, {
    x: start.x + delta.x * projection,
    y: start.y + delta.y * projection,
    z: start.z + delta.z * projection,
  });
}

function effectId(round: Round, sourceIndex: number): string {
  return `r${round.number}-utility-effect-${String(sourceIndex).padStart(4, "0")}`;
}

function activeFrames(round: Round, effect: UtilityEffect): Round["frames"] {
  return round.frames.filter(
    (frame) => frame.t >= effect.start && frame.t <= effect.end,
  );
}

function smokeImpact(
  round: Round,
  effect: UtilityEffect,
  sourceIndex: number,
  geometry: MapGeometry | null,
  geometryReason: string | null,
): SmokeSpatialImpact {
  const insideSamplesBySide = emptySideSamples();
  const playerIdsInside = new Set<string>();
  let evaluatedSightlineSamples = geometry === null ? null : 0;
  let blockedSightlineSamples = geometry === null ? null : 0;
  for (const frame of activeFrames(round, effect)) {
    const alive = frame.players.filter((player) => player.hp > 0);
    for (const player of alive) {
      if (distance3d(eyePosition(player), effect) > SMOKE_RADIUS_WORLD) continue;
      incrementSideSample(insideSamplesBySide, player.team);
      playerIdsInside.add(String(player.id));
    }
    if (geometry === null) continue;
    for (let firstIndex = 0; firstIndex < alive.length; firstIndex++) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < alive.length;
        secondIndex++
      ) {
        const first = alive[firstIndex];
        const second = alive[secondIndex];
        const firstSide = sideForTeam(first.team);
        const secondSide = sideForTeam(second.team);
        if (
          firstSide === null ||
          secondSide === null ||
          firstSide === secondSide
        ) {
          continue;
        }
        const firstEye = eyePosition(first);
        const secondEye = eyePosition(second);
        if (!hasClearLineOfSight(firstEye, secondEye, geometry)) continue;
        evaluatedSightlineSamples = (evaluatedSightlineSamples ?? 0) + 1;
        if (
          pointToSegmentDistance(effect, firstEye, secondEye) <=
          SMOKE_RADIUS_WORLD
        ) {
          blockedSightlineSamples = (blockedSightlineSamples ?? 0) + 1;
        }
      }
    }
  }
  return {
    effectId: effectId(round, sourceIndex),
    roundNumber: round.number,
    startTime: effect.start,
    endTime: effect.end,
    radius: SMOKE_RADIUS_WORLD,
    center: { x: effect.x, y: effect.y, z: effect.z },
    insideSamplesBySide,
    playerIdsInside: [...playerIdsInside].sort(),
    evaluatedSightlineSamples,
    blockedSightlineSamples,
    unavailableReasons:
      geometry === null && geometryReason !== null ? [geometryReason] : [],
  };
}

function playerAtOrBefore(
  round: Round,
  playerId: string,
  time: number,
): PlayerPos | null {
  for (let index = round.frames.length - 1; index >= 0; index--) {
    const frame = round.frames[index];
    if (frame.t > time) continue;
    if (time - frame.t > UTILITY_FRAME_MAX_AGE_SECONDS) break;
    const player = frame.players.find(
      (candidate) => String(candidate.id) === playerId,
    );
    if (player !== undefined) return player;
  }
  return null;
}

function isFireDamage(damage: DamageEvent): boolean {
  const weapon = damage.weapon?.toLowerCase() ?? "";
  return /inferno|molotov|incendiary|incgrenade/.test(weapon);
}

function fireContainsPlayer(
  effect: UtilityEffect,
  player: PlayerPos,
): boolean {
  return (
    Math.hypot(player.x - effect.x, player.y - effect.y) <=
      fireRadiusWorld(effect) &&
    Math.abs(player.z - effect.z) <= FIRE_VERTICAL_TOLERANCE_WORLD
  );
}

export function analyzeUtilitySpatial(
  round: Round,
  geometry: MapGeometry | null,
  geometryReason: string | null,
): {
  smokeImpacts: SmokeSpatialImpact[];
  fireImpacts: FireSpatialImpact[];
  unmatchedFireDamageEvents: number;
  ambiguousFireDamageEvents: number;
  unavailableReasons: string[];
} {
  if (round.effects === undefined) {
    return {
      smokeImpacts: [],
      fireImpacts: [],
      unmatchedFireDamageEvents: 0,
      ambiguousFireDamageEvents: 0,
      unavailableReasons: ["missing_utility_effects"],
    };
  }
  const smokeEffects = round.effects
    .map((effect, sourceIndex) => ({ effect, sourceIndex }))
    .filter(({ effect }) => effect.type === "smoke");
  const fireEffects = round.effects
    .map((effect, sourceIndex) => ({ effect, sourceIndex }))
    .filter(({ effect }) => effect.type === "fire");
  const smokeImpacts = smokeEffects.map(({ effect, sourceIndex }) =>
    smokeImpact(
      round,
      effect,
      sourceIndex,
      geometry,
      geometryReason,
    )
  );
  const fireByEffect = new Map<UtilityEffect, MutableFireImpact>();
  for (const { effect, sourceIndex } of fireEffects) {
    const insideSamplesBySide = emptySideSamples();
    const playerIdsInside = new Set<string>();
    for (const frame of activeFrames(round, effect)) {
      for (const player of frame.players) {
        if (player.hp <= 0 || !fireContainsPlayer(effect, player)) continue;
        incrementSideSample(insideSamplesBySide, player.team);
        playerIdsInside.add(String(player.id));
      }
    }
    const overlappingSmokeEffectIds = smokeEffects
      .filter(
        ({ effect: smoke }) =>
          Math.max(effect.start, smoke.start) <=
            Math.min(effect.end, smoke.end) &&
          fireIsSmoked(effect, [smoke]),
      )
      .map(({ sourceIndex: smokeIndex }) => effectId(round, smokeIndex));
    fireByEffect.set(effect, {
      effectId: effectId(round, sourceIndex),
      roundNumber: round.number,
      variant: effect.variant ?? null,
      ownerSide: sideForTeam(effect.team),
      startTime: effect.start,
      endTime: effect.end,
      radius: fireRadiusWorld(effect),
      center: { x: effect.x, y: effect.y, z: effect.z },
      insideSamplesBySide,
      playerIdsInside: [...playerIdsInside].sort(),
      damageHealth: 0,
      damageArmor: 0,
      damagedPlayerIds: [],
      damagedPlayers: new Set<string>(),
      overlappingSmokeEffectIds,
      unavailableReasons:
        round.damages === undefined ? ["missing_damage_events"] : [],
    });
  }

  let unmatchedFireDamageEvents = 0;
  let ambiguousFireDamageEvents = 0;
  for (const damage of round.damages ?? []) {
    if (!isFireDamage(damage) || damage.victim === undefined) continue;
    const victimId = String(damage.victim);
    const victim = playerAtOrBefore(round, victimId, damage.t);
    if (victim === null) {
      unmatchedFireDamageEvents++;
      continue;
    }
    const candidates = fireEffects
      .filter(
        ({ effect }) =>
          damage.t >= effect.start &&
          damage.t <= effect.end &&
          fireContainsPlayer(effect, victim),
      )
      .map(({ effect }) => ({
        effect,
        distance: Math.hypot(
          victim.x - effect.x,
          victim.y - effect.y,
          victim.z - effect.z,
        ),
      }))
      .sort((left, right) => left.distance - right.distance);
    if (candidates.length === 0) {
      unmatchedFireDamageEvents++;
      continue;
    }
    if (
      candidates.length > 1 &&
      Math.abs(candidates[0].distance - candidates[1].distance) <= 1e-7
    ) {
      ambiguousFireDamageEvents++;
      continue;
    }
    const impact = fireByEffect.get(candidates[0].effect);
    if (impact === undefined) {
      unmatchedFireDamageEvents++;
      continue;
    }
    impact.damageHealth += damage.damageHealth;
    impact.damageArmor += damage.damageArmor;
    impact.damagedPlayers.add(victimId);
  }
  const fireImpacts = [...fireByEffect.values()].map((impact) => {
    const { damagedPlayers, ...result } = impact;
    return {
      ...result,
      damagedPlayerIds: [...damagedPlayers].sort(),
    };
  });
  return {
    smokeImpacts,
    fireImpacts,
    unmatchedFireDamageEvents,
    ambiguousFireDamageEvents,
    unavailableReasons: [],
  };
}
