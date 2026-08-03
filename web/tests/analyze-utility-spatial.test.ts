import { describe, expect, it } from "vitest";
import { analyzeUtilitySpatial } from "@/lib/analysis/analyze-utility-spatial";
import type { MapGeometry } from "@/lib/analysis/visibility-geometry";
import type { PlayerPos, Round, UtilityEffect } from "@/lib/types";

const OPEN_GEOMETRY: MapGeometry = {
  map: "de_test",
  geometryId: "open-v1",
  triangles: [],
};

function player(id: string, x: number, team: number): PlayerPos {
  return {
    id,
    x,
    y: 0,
    z: 0,
    yaw: 0,
    hp: 100,
    armor: 0,
    team,
  };
}

function effect(overrides: Partial<UtilityEffect>): UtilityEffect {
  return {
    type: "smoke",
    start: 0,
    end: 5,
    x: 0,
    y: 0,
    z: 0,
    ...overrides,
  };
}

function round(overrides: Partial<Round> = {}): Round {
  return {
    number: 1,
    startTick: 1_000,
    endTick: 2_000,
    duration: 10,
    winner: "T",
    frames: [],
    events: [],
    damages: [],
    effects: [],
    ...overrides,
  };
}

describe("spatial utility impact", () => {
  it("counts only sight lines that were statically open before crossing a smoke", () => {
    const source = round({
      frames: [{
        t: 1,
        players: [
          player("t", -200, 2),
          player("ct", 200, 3),
        ],
      }],
      effects: [effect({ type: "smoke" })],
    });
    const open = analyzeUtilitySpatial(source, OPEN_GEOMETRY, null)
      .smokeImpacts[0];
    const wallGeometry: MapGeometry = {
      map: "de_test",
      geometryId: "wall-v1",
      triangles: [
        {
          a: { x: -50, y: -10, z: 0 },
          b: { x: -50, y: 10, z: 0 },
          c: { x: -50, y: 10, z: 100 },
        },
        {
          a: { x: -50, y: -10, z: 0 },
          b: { x: -50, y: 10, z: 100 },
          c: { x: -50, y: -10, z: 100 },
        },
      ],
    };
    const walled = analyzeUtilitySpatial(source, wallGeometry, null)
      .smokeImpacts[0];

    expect(open).toMatchObject({
      radius: 144,
      evaluatedSightlineSamples: 1,
      blockedSightlineSamples: 1,
      blockedPlayerPairs: [{
        playerIds: ["ct", "t"],
        sampleCount: 1,
        firstTime: 1,
        lastTime: 1,
      }],
      unavailableReasons: [],
    });
    expect(walled).toMatchObject({
      evaluatedSightlineSamples: 0,
      blockedSightlineSamples: 0,
      blockedPlayerPairs: [],
    });
  });

  it("distinguishes missing geometry from a smoke that blocks no line", () => {
    const source = round({
      frames: [{
        t: 1,
        players: [player("t", -200, 2), player("ct", 200, 3)],
      }],
      effects: [effect({ type: "smoke", x: 1_000 })],
    });

    const missing = analyzeUtilitySpatial(
      source,
      null,
      "missing_map_geometry",
    ).smokeImpacts[0];

    expect(missing).toMatchObject({
      evaluatedSightlineSamples: null,
      blockedSightlineSamples: null,
      blockedPlayerPairs: [],
      unavailableReasons: ["missing_map_geometry"],
    });
  });

  it("measures fire occupancy, actual damage and overlapping smoke", () => {
    const source = round({
      frames: [{
        t: 1,
        players: [
          player("owner", 0, 2),
          player("victim", 50, 3),
        ],
      }],
      effects: [
        effect({
          type: "fire",
          variant: "molotov",
          team: 2,
          start: 0,
          end: 5,
        }),
        effect({
          type: "smoke",
          start: 2,
          end: 3,
        }),
      ],
      damages: [{
        t: 1,
        tick: 1_064,
        attacker: "owner",
        victim: "victim",
        weapon: "inferno",
        damageHealth: 30,
        damageArmor: 5,
        healthAfter: 70,
        armorAfter: 0,
      }],
    });

    const result = analyzeUtilitySpatial(source, OPEN_GEOMETRY, null);

    expect(result.fireImpacts).toEqual([{
      effectId: "r1-utility-effect-0000",
      roundNumber: 1,
      variant: "molotov",
      ownerSide: "T",
      startTime: 0,
      endTime: 5,
      radius: 116,
      center: { x: 0, y: 0, z: 0 },
      insideSamplesBySide: { T: 1, CT: 1, unknown: 0 },
      playerIdsInside: ["owner", "victim"],
      damageHealth: 30,
      damageArmor: 5,
      damagedPlayerIds: ["victim"],
      overlappingSmokeEffectIds: ["r1-utility-effect-0001"],
      unavailableReasons: [],
    }]);
    expect(result.unmatchedFireDamageEvents).toBe(0);
    expect(result.ambiguousFireDamageEvents).toBe(0);
  });

  it("refuses to assign fire damage between equidistant overlapping effects", () => {
    const source = round({
      frames: [{
        t: 1,
        players: [player("victim", 0, 3)],
      }],
      effects: [
        effect({ type: "fire", variant: "molotov" }),
        effect({ type: "fire", variant: "incendiary" }),
      ],
      damages: [{
        t: 1,
        tick: 1_064,
        victim: "victim",
        weapon: "molotov",
        damageHealth: 10,
        damageArmor: 0,
        healthAfter: 90,
        armorAfter: 0,
      }],
    });

    const result = analyzeUtilitySpatial(source, OPEN_GEOMETRY, null);

    expect(result.ambiguousFireDamageEvents).toBe(1);
    expect(result.fireImpacts.every((impact) => impact.damageHealth === 0)).toBe(
      true,
    );
  });

  it("preserves missing effect and damage streams explicitly", () => {
    const missingEffects = round();
    delete missingEffects.effects;
    expect(analyzeUtilitySpatial(
      missingEffects,
      OPEN_GEOMETRY,
      null,
    ).unavailableReasons).toEqual(["missing_utility_effects"]);

    const missingDamage = round({
      effects: [effect({ type: "fire" })],
    });
    delete missingDamage.damages;
    expect(analyzeUtilitySpatial(
      missingDamage,
      OPEN_GEOMETRY,
      null,
    ).fireImpacts[0].unavailableReasons).toEqual([
      "missing_damage_events",
    ]);
  });
});
