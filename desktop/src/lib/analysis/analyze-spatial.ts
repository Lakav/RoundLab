import type { MatchData, PlayerPos, Round } from "@/lib/types";
import {
  locateTacticalZone,
  type TacticalMapDefinition,
  validTacticalMapDefinition,
} from "./tactical-zones";
import {
  SPATIAL_ANALYSIS_SPEC_VERSION,
  type PlayerZoneVisit,
  type PlayerZoneTransition,
  type RoundSpatialAnalysis,
  type SpatialAnalysis,
  type TeamSpacing,
  type TeamRotation,
  type TradeabilityEvent,
  type ZoneControlChange,
  type ZoneControlInterval,
  type ZoneControlState,
} from "./spatial-types";
import {
  hasClearLineOfSight,
  type MapGeometry,
  validMapGeometry,
} from "./visibility-geometry";
import { analyzeUtilitySpatial } from "./analyze-utility-spatial";
import { analyzeTrajectoryComparisons } from "./analyze-trajectories";
import { analyzeRepeatedTrajectoryHabits } from "./analyze-habits";

export const ROTATION_WINDOW_SECONDS = 3;
export const TRADEABILITY_FRAME_MAX_AGE_SECONDS = 0.25;
const PLAYER_EYE_HEIGHT_STANDING = 64;
const PLAYER_EYE_HEIGHT_CROUCHED = 46;

export type AnalyzeSpatialContext = {
  matchId: string;
  generatedAt: string;
  tacticalZones?: TacticalMapDefinition;
  mapGeometry?: MapGeometry;
};

type MutableZoneVisit = Omit<
  PlayerZoneVisit,
  "visitId" | "startTick" | "endTick"
>;

type MutableZoneTransition = {
  playerId: string;
  side: "T" | "CT" | null;
  fromVisit: MutableZoneVisit;
  toVisit: MutableZoneVisit;
  time: number;
};

type MutableControlInterval = Omit<
  ZoneControlInterval,
  "controlIntervalId" | "startTick" | "endTick"
>;

type MutableControlChange = Omit<
  ZoneControlChange,
  "controlChangeId" | "tick"
>;

function sideForTeam(team: number): "T" | "CT" | null {
  if (team === 2) return "T";
  if (team === 3) return "CT";
  return null;
}

function zoneControlState(
  occupancy: { T: Set<string>; CT: Set<string> } | undefined,
): ZoneControlState {
  if (occupancy === undefined || (occupancy.T.size === 0 && occupancy.CT.size === 0)) {
    return "empty";
  }
  if (occupancy.T.size > 0 && occupancy.CT.size > 0) return "contested";
  return occupancy.T.size > 0 ? "T" : "CT";
}

function analyzeRotations(
  round: Round,
  transitions: PlayerZoneTransition[],
): TeamRotation[] {
  const grouped = new Map<string, PlayerZoneTransition[]>();
  for (const transition of transitions) {
    if (transition.side === null) continue;
    const key = `${transition.side}\u0000${transition.toZoneId}`;
    const group = grouped.get(key) ?? [];
    group.push(transition);
    grouped.set(key, group);
  }
  const candidates: Omit<TeamRotation, "rotationId">[] = [];
  for (const group of grouped.values()) {
    group.sort(
      (left, right) =>
        left.time - right.time ||
        left.playerId.localeCompare(right.playerId) ||
        left.transitionId.localeCompare(right.transitionId),
    );
    let cluster: PlayerZoneTransition[] = [];
    const finalize = (): void => {
      const playerIds = [...new Set(cluster.map((item) => item.playerId))].sort();
      if (playerIds.length < 2) return;
      const first = cluster[0];
      const last = cluster[cluster.length - 1];
      candidates.push({
        roundNumber: round.number,
        side: first.side as "T" | "CT",
        destinationZoneId: first.toZoneId,
        playerIds,
        originZoneIds: [
          ...new Set(cluster.map((item) => item.fromZoneId)),
        ].sort(),
        transitionIds: cluster.map((item) => item.transitionId),
        startTime: first.time,
        endTime: last.time,
        startTick: first.tick,
        endTick: last.tick,
      });
    };
    for (const transition of group) {
      if (
        cluster.length > 0 &&
        transition.time - cluster[0].time > ROTATION_WINDOW_SECONDS
      ) {
        finalize();
        cluster = [];
      }
      cluster.push(transition);
    }
    if (cluster.length > 0) finalize();
  }
  candidates.sort(
    (left, right) =>
      left.startTime - right.startTime ||
      left.side.localeCompare(right.side) ||
      left.destinationZoneId.localeCompare(right.destinationZoneId),
  );
  return candidates.map((rotation, index) => ({
    ...rotation,
    rotationId: `r${round.number}-rotation-${String(index).padStart(3, "0")}`,
  }));
}

function distance3d(left: PlayerPos, right: PlayerPos): number {
  return Math.hypot(
    left.x - right.x,
    left.y - right.y,
    left.z - right.z,
  );
}

function horizontalDistance(left: PlayerPos, right: PlayerPos): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function eyePosition(player: PlayerPos): {
  x: number;
  y: number;
  z: number;
} {
  const duckAmount = Math.min(1, Math.max(0, player.duckAmount ?? 0));
  const height =
    PLAYER_EYE_HEIGHT_STANDING +
    (PLAYER_EYE_HEIGHT_CROUCHED - PLAYER_EYE_HEIGHT_STANDING) * duckAmount;
  return { x: player.x, y: player.y, z: player.z + height };
}

function analyzeSpacing(round: Round): TeamSpacing[] {
  type SpacingSamples = {
    side: "T" | "CT";
    playerIds: [string, string];
    distance3d: number[];
    horizontalDistance: number[];
  };
  const samplesByPair = new Map<string, SpacingSamples>();
  for (const frame of round.frames) {
    const playersBySide = new Map<"T" | "CT", PlayerPos[]>();
    for (const player of frame.players) {
      const side = sideForTeam(player.team);
      if (side === null || player.hp <= 0) continue;
      const players = playersBySide.get(side) ?? [];
      players.push(player);
      playersBySide.set(side, players);
    }
    for (const [side, players] of playersBySide) {
      players.sort((left, right) =>
        String(left.id).localeCompare(String(right.id))
      );
      for (let firstIndex = 0; firstIndex < players.length; firstIndex++) {
        for (
          let secondIndex = firstIndex + 1;
          secondIndex < players.length;
          secondIndex++
        ) {
          const first = players[firstIndex];
          const second = players[secondIndex];
          const playerIds: [string, string] = [
            String(first.id),
            String(second.id),
          ];
          const key = `${side}\u0000${playerIds[0]}\u0000${playerIds[1]}`;
          const samples = samplesByPair.get(key) ?? {
            side,
            playerIds,
            distance3d: [],
            horizontalDistance: [],
          };
          samples.distance3d.push(distance3d(first, second));
          samples.horizontalDistance.push(horizontalDistance(first, second));
          samplesByPair.set(key, samples);
        }
      }
    }
  }
  const aggregates = [...samplesByPair.values()].sort(
    (left, right) =>
      left.side.localeCompare(right.side) ||
      left.playerIds[0].localeCompare(right.playerIds[0]) ||
      left.playerIds[1].localeCompare(right.playerIds[1]),
  );
  return aggregates.map((samples, index) => {
    const sortedDistances = [...samples.distance3d].sort(
      (left, right) => left - right,
    );
    const middle = Math.floor(sortedDistances.length / 2);
    const medianDistance3d =
      sortedDistances.length % 2 === 0
        ? (sortedDistances[middle - 1] + sortedDistances[middle]) / 2
        : sortedDistances[middle];
    return {
      spacingId: `r${round.number}-spacing-${String(index).padStart(4, "0")}`,
      roundNumber: round.number,
      side: samples.side,
      playerIds: samples.playerIds,
      sampleCount: samples.distance3d.length,
      meanDistance3d:
        samples.distance3d.reduce((total, value) => total + value, 0) /
        samples.distance3d.length,
      medianDistance3d,
      minDistance3d: sortedDistances[0],
      maxDistance3d: sortedDistances[sortedDistances.length - 1],
      meanHorizontalDistance:
        samples.horizontalDistance.reduce(
          (total, value) => total + value,
          0,
        ) / samples.horizontalDistance.length,
    };
  });
}

function combatFrame(
  round: Round,
  time: number,
  killerId: string,
  victimId: string,
): { frame: Round["frames"][number]; killer: PlayerPos; victim: PlayerPos } | null {
  for (let index = round.frames.length - 1; index >= 0; index--) {
    const frame = round.frames[index];
    if (frame.t > time) continue;
    if (time - frame.t > TRADEABILITY_FRAME_MAX_AGE_SECONDS) break;
    const killer = frame.players.find(
      (player) => String(player.id) === killerId,
    );
    const victim = frame.players.find(
      (player) => String(player.id) === victimId,
    );
    if (killer !== undefined && victim !== undefined) {
      return { frame, killer, victim };
    }
  }
  return null;
}

function analyzeTradeability(
  round: Round,
  geometry: MapGeometry | null,
  geometryReason: string | null,
): TradeabilityEvent[] {
  const events: TradeabilityEvent[] = [];
  for (const [eventIndex, event] of round.events.entries()) {
    if (
      event.type !== "kill" ||
      event.killer === undefined ||
      event.victim === undefined
    ) {
      continue;
    }
    const killerId = String(event.killer);
    const victimId = String(event.victim);
    if (killerId === victimId) continue;
    const sampled = combatFrame(round, event.t, killerId, victimId);
    if (sampled === null) {
      events.push({
        tradeabilityId:
          `r${round.number}-tradeability-${String(eventIndex).padStart(4, "0")}`,
        roundNumber: round.number,
        killerId,
        victimId,
        victimSide: null,
        time: event.t,
        tick: event.tick ?? null,
        frameTime: null,
        frameAgeSeconds: null,
        candidates: [],
        coveringPlayerIds: [],
        unavailableReasons: ["missing_combat_frame"],
      });
      continue;
    }
    const killerSide = sideForTeam(sampled.killer.team);
    const victimSide = sideForTeam(sampled.victim.team);
    if (
      killerSide === null ||
      victimSide === null ||
      killerSide === victimSide
    ) {
      continue;
    }
    const candidates = sampled.frame.players
      .filter(
        (player) =>
          String(player.id) !== victimId &&
          player.hp > 0 &&
          sideForTeam(player.team) === victimSide,
      )
      .sort((left, right) =>
        String(left.id).localeCompare(String(right.id))
      )
      .map((player) => {
        const staticLineOfSightToKiller =
          geometry === null
            ? null
            : hasClearLineOfSight(
                eyePosition(player),
                eyePosition(sampled.killer),
                geometry,
              );
        return {
          playerId: String(player.id),
          distanceToVictim: distance3d(player, sampled.victim),
          distanceToKiller: distance3d(player, sampled.killer),
          flashRemaining: player.flashLeft ?? null,
          staticLineOfSightToKiller,
          unavailableReasons:
            staticLineOfSightToKiller === null && geometryReason !== null
              ? [geometryReason]
              : [],
        };
      });
    events.push({
      tradeabilityId:
        `r${round.number}-tradeability-${String(eventIndex).padStart(4, "0")}`,
      roundNumber: round.number,
      killerId,
      victimId,
      victimSide,
      time: event.t,
      tick: event.tick ?? null,
      frameTime: sampled.frame.t,
      frameAgeSeconds: event.t - sampled.frame.t,
      candidates,
      coveringPlayerIds: candidates
        .filter((candidate) => candidate.staticLineOfSightToKiller === true)
        .map((candidate) => candidate.playerId),
      unavailableReasons:
        candidates.length > 0 && geometryReason !== null
          ? [geometryReason]
          : [],
    });
  }
  return events;
}

function analyzeRoundZones(
  round: Round,
  tickRate: number,
  definition: TacticalMapDefinition | null,
  unavailableReason: string | null,
  geometry: MapGeometry | null,
  geometryReason: string | null,
): RoundSpatialAnalysis {
  if (round.frames.length === 0) {
    return {
      roundNumber: round.number,
      zoneVisits: [],
      zoneTransitions: [],
      zoneControlIntervals: [],
      zoneControlChanges: [],
      rotations: [],
      spacing: [],
      tradeability: [],
      smokeImpacts: [],
      fireImpacts: [],
      unmatchedFireDamageEvents: 0,
      ambiguousFireDamageEvents: 0,
      utilityUnavailableReasons: ["missing_frame_payload"],
      outsideZoneSamples: 0,
      ambiguousZoneSamples: 0,
      unavailableReasons: ["missing_frame_payload"],
    };
  }
  const spacing = analyzeSpacing(round);
  const tradeability = analyzeTradeability(
    round,
    geometry,
    geometryReason,
  );
  const utility = analyzeUtilitySpatial(
    round,
    geometry,
    geometryReason,
  );
  if (definition === null || unavailableReason !== null) {
    return {
      roundNumber: round.number,
      zoneVisits: [],
      zoneTransitions: [],
      zoneControlIntervals: [],
      zoneControlChanges: [],
      rotations: [],
      spacing,
      tradeability,
      smokeImpacts: utility.smokeImpacts,
      fireImpacts: utility.fireImpacts,
      unmatchedFireDamageEvents: utility.unmatchedFireDamageEvents,
      ambiguousFireDamageEvents: utility.ambiguousFireDamageEvents,
      utilityUnavailableReasons: utility.unavailableReasons,
      outsideZoneSamples: 0,
      ambiguousZoneSamples: 0,
      unavailableReasons: [
        unavailableReason ?? "missing_tactical_zones",
      ],
    };
  }

  const visits: MutableZoneVisit[] = [];
  const transitions: MutableZoneTransition[] = [];
  const controlIntervals: MutableControlInterval[] = [];
  const controlChanges: MutableControlChange[] = [];
  const activeByPlayer = new Map<string, MutableZoneVisit>();
  const activeControlByZone = new Map<string, MutableControlInterval>();
  const lastExclusiveController = new Map<string, "T" | "CT">();
  let outsideZoneSamples = 0;
  let ambiguousZoneSamples = 0;
  for (const frame of round.frames) {
    const presentPlayers = new Set<string>();
    const occupancyByZone = new Map<
      string,
      { T: Set<string>; CT: Set<string> }
    >();
    for (const player of frame.players) {
      const playerId = String(player.id);
      if (player.hp <= 0) {
        activeByPlayer.delete(playerId);
        continue;
      }
      presentPlayers.add(playerId);
      const lookup = locateTacticalZone(definition, player);
      if (lookup.status !== "assigned" || lookup.zoneId === null) {
        activeByPlayer.delete(playerId);
        if (lookup.status === "outside") outsideZoneSamples++;
        else ambiguousZoneSamples++;
        continue;
      }
      const side = sideForTeam(player.team);
      if (side !== null) {
        const occupancy = occupancyByZone.get(lookup.zoneId) ?? {
          T: new Set<string>(),
          CT: new Set<string>(),
        };
        occupancy[side].add(playerId);
        occupancyByZone.set(lookup.zoneId, occupancy);
      }
      const active = activeByPlayer.get(playerId);
      if (active?.zoneId === lookup.zoneId) {
        active.endTime = frame.t;
        active.sampleCount++;
        continue;
      }
      const next: MutableZoneVisit = {
        roundNumber: round.number,
        playerId,
        side,
        zoneId: lookup.zoneId,
        startTime: frame.t,
        endTime: frame.t,
        sampleCount: 1,
      };
      visits.push(next);
      if (active !== undefined) {
        transitions.push({
          playerId,
          side,
          fromVisit: active,
          toVisit: next,
          time: frame.t,
        });
      }
      activeByPlayer.set(playerId, next);
    }
    for (const playerId of activeByPlayer.keys()) {
      if (!presentPlayers.has(playerId)) activeByPlayer.delete(playerId);
    }
    for (const zone of definition.zones) {
      const occupancy = occupancyByZone.get(zone.zoneId);
      const state = zoneControlState(occupancy);
      const active = activeControlByZone.get(zone.zoneId);
      if (active?.state === state) {
        active.endTime = frame.t;
        active.sampleCount++;
      } else {
        const next: MutableControlInterval = {
          roundNumber: round.number,
          zoneId: zone.zoneId,
          state,
          startTime: frame.t,
          endTime: frame.t,
          sampleCount: 1,
        };
        controlIntervals.push(next);
        activeControlByZone.set(zone.zoneId, next);
      }
      if (state === "T" || state === "CT") {
        const previousController =
          lastExclusiveController.get(zone.zoneId) ?? null;
        if (previousController !== state) {
          controlChanges.push({
            roundNumber: round.number,
            zoneId: zone.zoneId,
            kind: previousController === null ? "establish" : "takeover",
            previousController,
            newController: state,
            playerIds: [...(occupancy?.[state] ?? [])].sort(),
            time: frame.t,
          });
          lastExclusiveController.set(zone.zoneId, state);
        }
      }
    }
  }
  visits.sort(
    (left, right) =>
      left.startTime - right.startTime ||
      left.playerId.localeCompare(right.playerId) ||
      left.zoneId.localeCompare(right.zoneId),
  );
  const finalizedVisits = visits.map((visit, index) => ({
    ...visit,
    visitId: `r${round.number}-zone-visit-${String(index).padStart(4, "0")}`,
    startTick: Math.round(round.startTick + visit.startTime * tickRate),
    endTick: Math.round(round.startTick + visit.endTime * tickRate),
  }));
  const finalizedVisitByMutable = new Map(
    visits.map((visit, index) => [visit, finalizedVisits[index]]),
  );
  transitions.sort(
    (left, right) =>
      left.time - right.time ||
      left.playerId.localeCompare(right.playerId) ||
      left.toVisit.zoneId.localeCompare(right.toVisit.zoneId),
  );
  const finalizedTransitions = transitions.map((transition, index) => {
    const fromVisit = finalizedVisitByMutable.get(transition.fromVisit);
    const toVisit = finalizedVisitByMutable.get(transition.toVisit);
    if (fromVisit === undefined || toVisit === undefined) {
      throw new Error("Cannot finalize a zone transition without both visits.");
    }
    return {
      transitionId:
        `r${round.number}-zone-transition-${String(index).padStart(4, "0")}`,
      roundNumber: round.number,
      playerId: transition.playerId,
      side: transition.side,
      fromVisitId: fromVisit.visitId,
      toVisitId: toVisit.visitId,
      fromZoneId: fromVisit.zoneId,
      toZoneId: toVisit.zoneId,
      time: transition.time,
      tick: Math.round(round.startTick + transition.time * tickRate),
    };
  });
  controlIntervals.sort(
    (left, right) =>
      left.startTime - right.startTime ||
      left.zoneId.localeCompare(right.zoneId) ||
      left.state.localeCompare(right.state),
  );
  controlChanges.sort(
    (left, right) =>
      left.time - right.time ||
      left.zoneId.localeCompare(right.zoneId) ||
      left.newController.localeCompare(right.newController),
  );
  return {
    roundNumber: round.number,
    zoneVisits: finalizedVisits,
    zoneTransitions: finalizedTransitions,
    zoneControlIntervals: controlIntervals.map((interval, index) => ({
      ...interval,
      controlIntervalId:
        `r${round.number}-zone-control-${String(index).padStart(4, "0")}`,
      startTick: Math.round(round.startTick + interval.startTime * tickRate),
      endTick: Math.round(round.startTick + interval.endTime * tickRate),
    })),
    zoneControlChanges: controlChanges.map((change, index) => ({
      ...change,
      controlChangeId:
        `r${round.number}-zone-change-${String(index).padStart(4, "0")}`,
      tick: Math.round(round.startTick + change.time * tickRate),
    })),
    rotations: analyzeRotations(round, finalizedTransitions),
    spacing,
    tradeability,
    smokeImpacts: utility.smokeImpacts,
    fireImpacts: utility.fireImpacts,
    unmatchedFireDamageEvents: utility.unmatchedFireDamageEvents,
    ambiguousFireDamageEvents: utility.ambiguousFireDamageEvents,
    utilityUnavailableReasons: utility.unavailableReasons,
    outsideZoneSamples,
    ambiguousZoneSamples,
    unavailableReasons: [],
  };
}

export function analyzeSpatial(
  match: MatchData,
  context: AnalyzeSpatialContext,
): SpatialAnalysis {
  const definition = context.tacticalZones;
  const unavailableReason =
    definition === undefined
      ? "missing_tactical_zones"
      : !validTacticalMapDefinition(definition)
        ? "invalid_tactical_zones"
        : definition.map !== match.meta.map
          ? "tactical_zone_map_mismatch"
          : null;
  const usableDefinition =
    unavailableReason === null && definition !== undefined
      ? definition
      : null;
  const suppliedGeometry = context.mapGeometry;
  const geometryReason =
    suppliedGeometry === undefined
      ? "missing_map_geometry"
      : !validMapGeometry(suppliedGeometry)
        ? "invalid_map_geometry"
        : suppliedGeometry.map !== match.meta.map
          ? "map_geometry_mismatch"
          : null;
  const usableGeometry =
    geometryReason === null && suppliedGeometry !== undefined
      ? suppliedGeometry
      : null;
  const trajectoryComparisons = analyzeTrajectoryComparisons(match);
  return {
    specVersion: SPATIAL_ANALYSIS_SPEC_VERSION,
    inputSchemaVersion: match.schemaVersion ?? "roundlab.replay.legacy",
    parserVersion: match.parserVersion ?? "unknown",
    matchId: context.matchId,
    generatedAt: context.generatedAt,
    map: match.meta.map,
    zonesVersion: usableDefinition?.zonesVersion ?? null,
    rounds: match.rounds.map((round) =>
      analyzeRoundZones(
        round,
        match.meta.tickRate,
        usableDefinition,
        unavailableReason,
        usableGeometry,
        geometryReason,
      )
    ),
    trajectoryComparisons,
    repeatedTrajectoryHabits:
      analyzeRepeatedTrajectoryHabits(trajectoryComparisons),
  };
}
