import { describe, expect, it } from "vitest";
import { analyzeSpatial } from "@/lib/analysis/analyze-spatial";
import {
  locateTacticalZone,
  validTacticalMapDefinition,
  type TacticalMapDefinition,
} from "@/lib/analysis/tactical-zones";
import type { MatchData, PlayerPos, Round } from "@/lib/types";
import type { MapGeometry } from "@/lib/analysis/visibility-geometry";

const ZONES: TacticalMapDefinition = {
  map: "de_test",
  zonesVersion: "test-zones-v1",
  zones: [
    {
      zoneId: "a",
      label: "Zone A",
      polygon: [
        { x: 0, y: 0 },
        { x: 9, y: 0 },
        { x: 9, y: 10 },
        { x: 0, y: 10 },
      ],
      altitudeMin: 0,
      altitudeMax: 100,
    },
    {
      zoneId: "b",
      label: "Zone B",
      polygon: [
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 10 },
        { x: 10, y: 10 },
      ],
      altitudeMin: 0,
      altitudeMax: 100,
    },
  ],
};

function player(
  id: string,
  x: number,
  hp = 100,
  team = id === "p2" ? 3 : 2,
): PlayerPos {
  return {
    id,
    x,
    y: 5,
    z: 10,
    yaw: 0,
    hp,
    armor: 0,
    team,
  };
}

function round(frames: Round["frames"]): Round {
  return {
    number: 1,
    startTick: 1_000,
    endTick: 2_000,
    duration: 10,
    winner: "T",
    frames,
    events: [],
  };
}

function match(sourceRound: Round): MatchData {
  return {
    schemaVersion: "roundlab.replay.v2",
    parserVersion: "test",
    meta: {
      map: "de_test",
      tickRate: 64,
      sampleRate: 16,
      durationSec: 10,
      teamA: "A",
      teamB: "B",
      scoreA: 1,
      scoreB: 0,
    },
    players: [
      { steamId: "p1", name: "One", team: "T" },
      { steamId: "p2", name: "Two", team: "CT" },
      { steamId: "p3", name: "Three", team: "T" },
    ],
    rounds: [sourceRound],
  };
}

const CONTEXT = {
  matchId: "spatial-match",
  generatedAt: "2026-07-27T08:00:00.000Z",
};

const OPEN_GEOMETRY: MapGeometry = {
  map: "de_test",
  geometryId: "open-v1",
  triangles: [],
};

describe("tactical zone definitions", () => {
  it("validates unique polygons and finite altitude ranges", () => {
    expect(validTacticalMapDefinition(ZONES)).toBe(true);
    expect(validTacticalMapDefinition({
      ...ZONES,
      zones: [ZONES.zones[0], ZONES.zones[0]],
    })).toBe(false);
    expect(validTacticalMapDefinition({
      ...ZONES,
      zones: [{ ...ZONES.zones[0], altitudeMax: 0 }],
    })).toBe(false);
  });

  it("includes polygon boundaries and uses a half-open altitude range", () => {
    expect(locateTacticalZone(ZONES, { x: 0, y: 5, z: 0 })).toMatchObject({
      status: "assigned",
      zoneId: "a",
    });
    expect(locateTacticalZone(ZONES, { x: 0, y: 5, z: 100 })).toEqual({
      status: "outside",
      zoneId: null,
      candidateZoneIds: [],
    });
  });

  it("reports equal-priority overlap and resolves an explicit higher priority", () => {
    const overlap = {
      ...ZONES,
      zones: [
        ZONES.zones[0],
        { ...ZONES.zones[0], zoneId: "overlay", label: "Overlay" },
      ],
    };
    expect(locateTacticalZone(overlap, { x: 5, y: 5, z: 10 })).toEqual({
      status: "ambiguous",
      zoneId: null,
      candidateZoneIds: ["a", "overlay"],
    });
    const prioritized = {
      ...overlap,
      zones: [
        ZONES.zones[0],
        { ...overlap.zones[1], priority: 10 },
      ],
    };
    expect(locateTacticalZone(prioritized, { x: 5, y: 5, z: 10 })).toEqual({
      status: "assigned",
      zoneId: "overlay",
      candidateZoneIds: ["overlay", "a"],
    });
  });
});

describe("spatial zone analysis", () => {
  it("compresses consecutive player samples into stable zone visits", () => {
    const result = analyzeSpatial(match(round([
      { t: 0, players: [player("p1", 5), player("p2", 50)] },
      { t: 1, players: [player("p1", 6)] },
      { t: 2, players: [player("p1", 15)] },
      { t: 3, players: [player("p1", 15, 0)] },
    ])), {
      ...CONTEXT,
      tacticalZones: ZONES,
    });

    expect(result).toMatchObject({
      specVersion: "roundlab.spatial.v1",
      map: "de_test",
      zonesVersion: "test-zones-v1",
    });
    expect(result.rounds[0]).toMatchObject({
      roundNumber: 1,
      zoneVisits: [
        {
          visitId: "r1-zone-visit-0000",
          roundNumber: 1,
          playerId: "p1",
          side: "T",
          zoneId: "a",
          startTime: 0,
          endTime: 1,
          startTick: 1_000,
          endTick: 1_064,
          sampleCount: 2,
        },
        {
          visitId: "r1-zone-visit-0001",
          roundNumber: 1,
          playerId: "p1",
          side: "T",
          zoneId: "b",
          startTime: 2,
          endTime: 2,
          startTick: 1_128,
          endTick: 1_128,
          sampleCount: 1,
        },
      ],
      outsideZoneSamples: 1,
      ambiguousZoneSamples: 0,
      unavailableReasons: [],
    });
    expect(result.rounds[0].zoneTransitions).toEqual([{
      transitionId: "r1-zone-transition-0000",
      roundNumber: 1,
      playerId: "p1",
      side: "T",
      fromVisitId: "r1-zone-visit-0000",
      toVisitId: "r1-zone-visit-0001",
      fromZoneId: "a",
      toZoneId: "b",
      time: 2,
      tick: 1_128,
    }]);
  });

  it("tracks contested intervals and a takeover by the last exclusive opponent", () => {
    const result = analyzeSpatial(match(round([
      { t: 0, players: [player("p1", 5), player("p2", 15)] },
      { t: 1, players: [player("p1", 5), player("p2", 5)] },
      { t: 2, players: [player("p2", 5)] },
    ])), {
      ...CONTEXT,
      tacticalZones: ZONES,
    }).rounds[0];

    expect(result.zoneControlIntervals.filter(
      (interval) => interval.zoneId === "a",
    ).map((interval) => interval.state)).toEqual([
      "T",
      "contested",
      "CT",
    ]);
    expect(result.zoneControlChanges).toEqual([
      expect.objectContaining({
        zoneId: "a",
        kind: "establish",
        previousController: null,
        newController: "T",
        playerIds: ["p1"],
        time: 0,
      }),
      expect.objectContaining({
        zoneId: "b",
        kind: "establish",
        previousController: null,
        newController: "CT",
        playerIds: ["p2"],
        time: 0,
      }),
      expect.objectContaining({
        zoneId: "a",
        kind: "takeover",
        previousController: "T",
        newController: "CT",
        playerIds: ["p2"],
        time: 2,
      }),
    ]);
  });

  it("does not create a direct transition across an unknown sample", () => {
    const result = analyzeSpatial(match(round([
      { t: 0, players: [player("p1", 5)] },
      { t: 1, players: [player("p1", 50)] },
      { t: 2, players: [player("p1", 15)] },
    ])), {
      ...CONTEXT,
      tacticalZones: ZONES,
    }).rounds[0];

    expect(result.zoneVisits).toHaveLength(2);
    expect(result.zoneTransitions).toEqual([]);
    expect(result.outsideZoneSamples).toBe(1);
  });

  it("detects a same-side rotation into one zone at the inclusive time boundary", () => {
    const result = analyzeSpatial(match(round([
      { t: 0, players: [player("p1", 5), player("p3", 5)] },
      { t: 1, players: [player("p1", 15), player("p3", 5)] },
      { t: 4, players: [player("p1", 15), player("p3", 15)] },
    ])), {
      ...CONTEXT,
      tacticalZones: ZONES,
    }).rounds[0];

    expect(result.rotations).toEqual([{
      rotationId: "r1-rotation-000",
      roundNumber: 1,
      side: "T",
      destinationZoneId: "b",
      playerIds: ["p1", "p3"],
      originZoneIds: ["a"],
      transitionIds: [
        "r1-zone-transition-0000",
        "r1-zone-transition-0001",
      ],
      startTime: 1,
      endTime: 4,
      startTick: 1_064,
      endTick: 1_256,
    }]);
  });

  it("does not call isolated or late arrivals a rotation", () => {
    const result = analyzeSpatial(match(round([
      { t: 0, players: [player("p1", 5), player("p3", 5)] },
      { t: 1, players: [player("p1", 15), player("p3", 5)] },
      { t: 4.01, players: [player("p1", 15), player("p3", 15)] },
    ])), {
      ...CONTEXT,
      tacticalZones: ZONES,
    }).rounds[0];

    expect(result.zoneTransitions).toHaveLength(2);
    expect(result.rotations).toEqual([]);
  });

  it("aggregates teammate spacing independently from tactical zones", () => {
    const sourceRound = round([
      { t: 0, players: [player("p1", 0), player("p3", 3)] },
      { t: 1, players: [player("p1", 0), player("p3", 4)] },
    ]);
    const result = analyzeSpatial(match(sourceRound), CONTEXT).rounds[0];

    expect(result.unavailableReasons).toEqual(["missing_tactical_zones"]);
    expect(result.spacing).toEqual([{
      spacingId: "r1-spacing-0000",
      roundNumber: 1,
      side: "T",
      playerIds: ["p1", "p3"],
      sampleCount: 2,
      meanDistance3d: 3.5,
      medianDistance3d: 3.5,
      minDistance3d: 3,
      maxDistance3d: 4,
      meanHorizontalDistance: 3.5,
    }]);
  });

  it("records a living teammate with static sight of the killer as covering", () => {
    const sourceRound = round([{
      t: 1,
      players: [
        player("p1", 0),
        player("p2", 100),
        { ...player("p3", 20), flashLeft: 0.5 },
      ],
    }]);
    sourceRound.events = [{
      t: 1.1,
      tick: 1_070,
      type: "kill",
      killer: "p2",
      victim: "p1",
      weapon: "ak47",
    }];
    const tradeability = analyzeSpatial(match(sourceRound), {
      ...CONTEXT,
      tacticalZones: ZONES,
      mapGeometry: OPEN_GEOMETRY,
    }).rounds[0].tradeability[0];

    expect(tradeability).toEqual({
      tradeabilityId: "r1-tradeability-0000",
      roundNumber: 1,
      killerId: "p2",
      victimId: "p1",
      victimSide: "T",
      time: 1.1,
      tick: 1_070,
      frameTime: 1,
      frameAgeSeconds: 0.10000000000000009,
      candidates: [{
        playerId: "p3",
        distanceToVictim: 20,
        distanceToKiller: 80,
        flashRemaining: 0.5,
        staticLineOfSightToKiller: true,
        unavailableReasons: [],
      }],
      coveringPlayerIds: ["p3"],
      unavailableReasons: [],
    });
  });

  it("distinguishes a blocked sight line from missing geometry", () => {
    const sourceRound = round([{
      t: 1,
      players: [
        player("p1", 0),
        player("p2", 100),
        player("p3", 20),
      ],
    }]);
    sourceRound.events = [{
      t: 1,
      tick: 1_064,
      type: "kill",
      killer: "p2",
      victim: "p1",
    }];
    const wallGeometry: MapGeometry = {
      map: "de_test",
      geometryId: "wall-v1",
      triangles: [
        {
          a: { x: 50, y: 0, z: 0 },
          b: { x: 50, y: 10, z: 0 },
          c: { x: 50, y: 10, z: 100 },
        },
        {
          a: { x: 50, y: 0, z: 0 },
          b: { x: 50, y: 10, z: 100 },
          c: { x: 50, y: 0, z: 100 },
        },
      ],
    };

    const blocked = analyzeSpatial(match(sourceRound), {
      ...CONTEXT,
      tacticalZones: ZONES,
      mapGeometry: wallGeometry,
    }).rounds[0].tradeability[0];
    const missing = analyzeSpatial(match(sourceRound), {
      ...CONTEXT,
      tacticalZones: ZONES,
    }).rounds[0].tradeability[0];

    expect(blocked.candidates[0]).toMatchObject({
      staticLineOfSightToKiller: false,
      unavailableReasons: [],
    });
    expect(blocked.coveringPlayerIds).toEqual([]);
    expect(missing.candidates[0]).toMatchObject({
      staticLineOfSightToKiller: null,
      unavailableReasons: ["missing_map_geometry"],
    });
    expect(missing.unavailableReasons).toEqual(["missing_map_geometry"]);
  });

  it("keeps a kill without a recent combat frame explicitly unavailable", () => {
    const sourceRound = round([{
      t: 0,
      players: [player("p1", 0), player("p2", 100)],
    }]);
    sourceRound.events = [{
      t: 1,
      tick: 1_064,
      type: "kill",
      killer: "p2",
      victim: "p1",
    }];

    expect(analyzeSpatial(match(sourceRound), {
      ...CONTEXT,
      tacticalZones: ZONES,
      mapGeometry: OPEN_GEOMETRY,
    }).rounds[0].tradeability[0]).toMatchObject({
      victimSide: null,
      frameTime: null,
      candidates: [],
      unavailableReasons: ["missing_combat_frame"],
    });
  });

  it("keeps missing, mismatched and unloaded zone analysis explicit", () => {
    const sourceMatch = match(round([{ t: 0, players: [player("p1", 5)] }]));
    expect(analyzeSpatial(sourceMatch, CONTEXT).rounds[0]).toMatchObject({
      zoneVisits: [],
      unavailableReasons: ["missing_tactical_zones"],
    });
    expect(analyzeSpatial(sourceMatch, {
      ...CONTEXT,
      tacticalZones: { ...ZONES, map: "de_other" },
    }).rounds[0].unavailableReasons).toEqual([
      "tactical_zone_map_mismatch",
    ]);
    expect(analyzeSpatial(match(round([])), {
      ...CONTEXT,
      tacticalZones: ZONES,
    }).rounds[0].unavailableReasons).toEqual(["missing_frame_payload"]);
  });
});
