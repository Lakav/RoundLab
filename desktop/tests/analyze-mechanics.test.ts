import { describe, expect, it } from "vitest";
import {
  analyzeMechanics,
  COUNTER_STRAFE_REFERENCE_SPEED_MIN,
  ENGAGEMENT_GAP_SECONDS,
  FIRING_SEQUENCE_MAX_GAP_SECONDS,
  MOVEMENT_SAMPLE_MAX_AGE_SECONDS,
  STATIONARY_SPEED_MAX,
} from "@/lib/analysis/analyze-mechanics";
import type { DamageEvent, MatchData, Round } from "@/lib/types";
import type { MapGeometry } from "@/lib/analysis/visibility-geometry";

const P1 = "76561198000000001";
const P2 = "76561198000000002";
const P3 = "76561198000000003";
const CONTEXT = {
  matchId: "mechanics-match",
  generatedAt: "2026-07-23T15:00:00.000Z",
};
const OPEN_GEOMETRY: MapGeometry = {
  map: "de_nuke",
  geometryId: "synthetic-open-v1",
  triangles: [],
};

function damage(
  t: number,
  tick: number,
  attacker: string,
  victim: string,
  damageHealth: number,
  sequence?: number,
): DamageEvent {
  return {
    t,
    tick,
    sequence,
    attacker,
    victim,
    weapon: "ak47",
    damageHealth,
    damageArmor: 0,
    healthAfter: Math.max(0, 100 - damageHealth),
    armorAfter: 0,
  };
}

function sourceRound(overrides: Partial<Round> = {}): Round {
  return {
    number: 1,
    startTick: 1_000,
    endTick: 2_000,
    duration: 15,
    winner: "T",
    frames: [{
      t: 0,
      players: [
        { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
        { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 0, team: 3 },
        { id: P3, x: 10, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
      ],
    }],
    events: [],
    damages: [],
    disconnects: [],
    ...overrides,
  };
}

function sourceMatch(rounds: Round[]): MatchData {
  return {
    schemaVersion: "roundlab.replay.v2",
    parserVersion: "0.1.0",
    meta: {
      map: "de_nuke",
      tickRate: 64,
      sampleRate: 16,
      durationSec: rounds.reduce((total, round) => total + round.duration, 0),
      teamA: "Alpha",
      teamB: "Bravo",
      scoreA: 1,
      scoreB: 0,
    },
    players: [
      { steamId: P1, name: "One", team: "T" },
      { steamId: P2, name: "Two", team: "CT" },
      { steamId: P3, name: "Three", team: "T" },
    ],
    rounds,
  };
}

describe("deterministic mechanics engagement detection", () => {
  it("groups bilateral damage and a kill for the same pair", () => {
    const round = sourceRound({
      damages: [
        damage(2, 1_128, P2, P1, 30, 2),
        damage(1, 1_064, P1, P2, 60, 1),
      ],
      events: [{
        t: 3,
        tick: 1_192,
        sequence: 3,
        type: "kill",
        killer: P1,
        victim: P2,
        weapon: "ak47",
      }],
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);
    const engagement = result.rounds[0].engagements[0];

    expect(result).toMatchObject({
      specVersion: "roundlab.mechanics.v1",
      inputSchemaVersion: "roundlab.replay.v2",
      parserVersion: "0.1.0",
      matchId: CONTEXT.matchId,
      generatedAt: CONTEXT.generatedAt,
    });
    expect(engagement).toEqual({
      engagementId: "r1-engagement-000",
      roundNumber: 1,
      participants: [P1, P2],
      initiatorId: P1,
      startTime: 1,
      endTime: 3,
      startTick: 1_064,
      endTick: 1_192,
      damageByPlayer: [
        { playerId: P1, damageHealth: 60 },
        { playerId: P2, damageHealth: 30 },
      ],
      kill: {
        killerId: P1,
        victimId: P2,
        evidenceId: "r1-mechanics-kill-0000",
      },
      evidenceIds: [
        "r1-mechanics-damage-0001",
        "r1-mechanics-damage-0000",
        "r1-mechanics-kill-0000",
      ],
      unavailableReasons: [],
    });
    expect(result.evidence.map((proof) => proof.evidenceId)).toEqual(
      engagement.evidenceIds,
    );
  });

  it("starts a new engagement after the explicit inactivity window", () => {
    const round = sourceRound({
      damages: [
        damage(1, 1_064, P1, P2, 20, 1),
        damage(1 + ENGAGEMENT_GAP_SECONDS + 0.01, 1_385, P2, P1, 30, 2),
      ],
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0].engagements).toHaveLength(2);
    expect(result.rounds[0].engagements.map((engagement) => engagement.initiatorId)).toEqual([
      P1,
      P2,
    ]);
  });

  it("uses event sequence to determine the initiator at the same tick", () => {
    const round = sourceRound({
      damages: [
        damage(1, 1_064, P1, P2, 20, 2),
        damage(1, 1_064, P2, P1, 30, 1),
      ],
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0].engagements[0].initiatorId).toBe(P2);
    expect(result.rounds[0].engagements[0].evidenceIds).toEqual([
      "r1-mechanics-damage-0001",
      "r1-mechanics-damage-0000",
    ]);
  });

  it("excludes team damage, teamkills and events with missing team context", () => {
    const round = sourceRound({
      damages: [
        damage(1, 1_064, P1, P3, 20, 1),
        damage(2, 1_128, P1, "unknown", 20, 2),
      ],
      events: [{
        t: 3,
        tick: 1_192,
        sequence: 3,
        type: "kill",
        killer: P1,
        victim: P3,
        weapon: "ak47",
      }],
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0]).toMatchObject({
      engagements: [],
      excludedDamageEvents: 2,
      excludedKillEvents: 1,
    });
    expect(result.evidence).toEqual([]);
  });

  it("keeps a kill-only engagement but marks its missing damage stream", () => {
    const round = sourceRound({
      events: [{
        t: 3,
        tick: 1_192,
        sequence: 3,
        type: "kill",
        killer: P1,
        victim: P2,
        weapon: "ak47",
      }],
    });
    delete round.damages;

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0].unavailableReasons).toContain("missing_damage_events");
    expect(result.rounds[0].engagements[0]).toMatchObject({
      damageByPlayer: [],
      kill: { killerId: P1, victimId: P2 },
      unavailableReasons: ["missing_damage_events"],
    });
  });

  it("associates a fire with its impact and damage using shooter, order and weapon", () => {
    const round = sourceRound({
      weaponFires: [{
        t: 1,
        tick: 1_064,
        sequence: 1,
        shooter: P1,
        weapon: "weapon_ak47",
        x: 0,
        y: 0,
        z: 64,
        yaw: 0,
      }],
      bulletImpacts: [{
        t: 1.01,
        tick: 1_064,
        sequence: 2,
        shooter: P1,
        x: 100,
        y: 0,
        z: 64,
      }],
      damages: [damage(1.02, 1_064, P1, P2, 40, 3)],
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0].shots).toEqual([{
      shotId: "r1-shot-0000",
      roundNumber: 1,
      shooterId: P1,
      weapon: "ak47",
      fireEvidenceId: "r1-mechanics-fire-0000",
      tick: 1_064,
      time: 1,
      origin: { x: 0, y: 0, z: 64 },
      yaw: 0,
      enemySpotted: null,
      impacts: [{
        evidenceId: "r1-mechanics-impact-0000",
        tick: 1_064,
        time: 1.01,
        x: 100,
        y: 0,
        z: 64,
      }],
      damages: [{
        evidenceId: "r1-mechanics-damage-0000",
        tick: 1_064,
        time: 1.02,
        victimId: P2,
        damageHealth: 40,
        damageArmor: 0,
        hitgroup: null,
      }],
      unavailableReasons: [],
    }]);
    expect(result.rounds[0].unmatchedImpacts).toEqual([]);
    expect(result.rounds[0].unmatchedDamages).toEqual([]);
    expect(result.evidence.map((proof) => proof.type)).toEqual([
      "weapon_fire",
      "bullet_impact",
      "damage",
    ]);
  });

  it("reads the demo spotted mask at the exact weapon-fire frame", () => {
    const round = sourceRound({
      frames: [{
        t: 1,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2, spottedBy: [] },
          { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 0, team: 3, spottedBy: [P1] },
        ],
      }],
      weaponFires: [{
        t: 1,
        tick: 1_064,
        shooter: P1,
        weapon: "ak47",
        x: 0,
        y: 0,
        z: 64,
        yaw: 0,
      }],
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0].shots[0].enemySpotted).toBe(true);
  });

  it("keeps spotted state unavailable for legacy frames without the mask", () => {
    const round = sourceRound({
      frames: [{
        t: 1,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 0, team: 3 },
        ],
      }],
      weaponFires: [{
        t: 1,
        tick: 1_064,
        shooter: P1,
        weapon: "ak47",
        x: 0,
        y: 0,
        z: 64,
        yaw: 0,
      }],
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0].shots[0].enemySpotted).toBeNull();
  });

  it("assigns same-tick facts to the latest fire ordered before them", () => {
    const round = sourceRound({
      weaponFires: [
        {
          t: 1,
          tick: 1_064,
          sequence: 1,
          shooter: P1,
          weapon: "ak47",
          x: 0,
          y: 0,
          z: 64,
          yaw: 0,
        },
        {
          t: 1,
          tick: 1_064,
          sequence: 3,
          shooter: P1,
          weapon: "ak47",
          x: 0,
          y: 0,
          z: 64,
          yaw: 1,
        },
      ],
      bulletImpacts: [
        { t: 1, tick: 1_064, sequence: 2, shooter: P1, x: 100, y: 0, z: 64 },
        { t: 1, tick: 1_064, sequence: 4, shooter: P1, x: 100, y: 2, z: 64 },
      ],
      damages: [damage(1, 1_064, P1, P2, 30, 5)],
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);
    const [first, second] = result.rounds[0].shots;

    expect(first.impacts.map((impact) => impact.evidenceId)).toEqual([
      "r1-mechanics-impact-0000",
    ]);
    expect(first.damages).toEqual([]);
    expect(second.impacts.map((impact) => impact.evidenceId)).toEqual([
      "r1-mechanics-impact-0001",
    ]);
    expect(second.damages.map((item) => item.evidenceId)).toEqual([
      "r1-mechanics-damage-0000",
    ]);
  });

  it("refuses to choose between indistinguishable simultaneous fires", () => {
    const round = sourceRound({
      weaponFires: [
        { t: 1, tick: 1_064, shooter: P1, weapon: "ak47", x: 0, y: 0, z: 64, yaw: 0 },
        { t: 1, tick: 1_064, shooter: P1, weapon: "ak47", x: 0, y: 0, z: 64, yaw: 0 },
      ],
      bulletImpacts: [{
        t: 1,
        tick: 1_064,
        shooter: P1,
        x: 100,
        y: 0,
        z: 64,
      }],
      damages: [],
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0].shots.every((shot) => shot.impacts.length === 0)).toBe(true);
    expect(result.rounds[0].unmatchedImpacts).toEqual([{
      evidenceId: "r1-mechanics-impact-0000",
      reason: "ambiguous_fire",
    }]);
  });

  it("does not attach damage to a shot from another weapon or beyond two ticks", () => {
    const round = sourceRound({
      weaponFires: [{
        t: 1,
        tick: 1_064,
        sequence: 1,
        shooter: P1,
        weapon: "ak47",
        x: 0,
        y: 0,
        z: 64,
        yaw: 0,
      }],
      bulletImpacts: [{
        t: 1.05,
        tick: 1_067,
        sequence: 2,
        shooter: P1,
        x: 100,
        y: 0,
        z: 64,
      }],
      damages: [{
        ...damage(1.02, 1_064, P1, P2, 40, 3),
        weapon: "awp",
      }],
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0].shots[0]).toMatchObject({ impacts: [], damages: [] });
    expect(result.rounds[0].unmatchedImpacts).toEqual([{
      evidenceId: "r1-mechanics-impact-0000",
      reason: "no_matching_fire",
    }]);
    expect(result.rounds[0].unmatchedDamages).toEqual([{
      evidenceId: "r1-mechanics-damage-0000",
      reason: "no_matching_fire",
    }]);
  });

  it("preserves missing shot streams as explicit unavailability", () => {
    const round = sourceRound();
    delete round.weaponFires;
    delete round.bulletImpacts;

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0].shots).toEqual([]);
    expect(result.rounds[0].unavailableReasons).toEqual([
      "missing_bullet_impact_events",
      "missing_weapon_fire_events",
    ]);
  });

  it("classifies one, two and three-or-more continuous shots", () => {
    const shotTimes = [1, 1.5, 1.7, 2.2, 2.3, 2.4];
    const round = sourceRound({
      weaponFires: shotTimes.map((t, sequence) => ({
        t,
        tick: 1_000 + Math.round(t * 64),
        sequence,
        shooter: P1,
        weapon: "ak47",
        x: 0,
        y: 0,
        z: 64,
        yaw: 0,
      })),
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0].firingSequences.map((sequence) => ({
      kind: sequence.kind,
      shotCount: sequence.shotCount,
      shotIds: sequence.shotIds,
    }))).toEqual([
      {
        kind: "tap",
        shotCount: 1,
        shotIds: ["r1-shot-0000"],
      },
      {
        kind: "burst",
        shotCount: 2,
        shotIds: ["r1-shot-0001", "r1-shot-0002"],
      },
      {
        kind: "spray",
        shotCount: 3,
        shotIds: [
          "r1-shot-0003",
          "r1-shot-0004",
          "r1-shot-0005",
        ],
      },
    ]);
  });

  it("includes the sequence gap boundary and splits immediately beyond it", () => {
    const beyondBoundary = 1 + FIRING_SEQUENCE_MAX_GAP_SECONDS * 2 + 0.001;
    const round = sourceRound({
      weaponFires: [
        1,
        1 + FIRING_SEQUENCE_MAX_GAP_SECONDS,
        beyondBoundary,
      ].map((t, sequence) => ({
        t,
        tick: 1_000 + Math.round(t * 1_000),
        sequence,
        shooter: P1,
        weapon: "ak47",
        x: 0,
        y: 0,
        z: 64,
        yaw: 0,
      })),
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0].firingSequences.map((sequence) => sequence.kind)).toEqual([
      "burst",
      "tap",
    ]);
    expect(result.rounds[0].firingSequences.map((sequence) => sequence.shotCount)).toEqual([
      2,
      1,
    ]);
  });

  it("splits firing sequences when the shooter changes weapon", () => {
    const round = sourceRound({
      weaponFires: ["ak47", "glock", "ak47"].map((weapon, sequence) => ({
        t: 1 + sequence * 0.1,
        tick: 1_064 + sequence * 6,
        sequence,
        shooter: P1,
        weapon,
        x: 0,
        y: 0,
        z: 64,
        yaw: 0,
      })),
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0].firingSequences.map((sequence) => ({
      weapon: sequence.weapon,
      kind: sequence.kind,
    }))).toEqual([
      { weapon: "ak47", kind: "tap" },
      { weapon: "glock", kind: "tap" },
      { weapon: "ak47", kind: "tap" },
    ]);
  });

  it("detects a rapid stop compatible with a counter-strafe", () => {
    const round = sourceRound({
      frames: [
        {
          t: 1 - MOVEMENT_SAMPLE_MAX_AGE_SECONDS,
          players: [{
            id: P1,
            x: 0,
            y: 0,
            z: 0,
            yaw: 0,
            hp: 100,
            armor: 0,
            team: 2,
            velocityX: COUNTER_STRAFE_REFERENCE_SPEED_MIN,
            velocityY: 0,
          }],
        },
        {
          t: 1,
          players: [{
            id: P1,
            x: 0,
            y: 0,
            z: 0,
            yaw: 0,
            hp: 100,
            armor: 0,
            team: 2,
            velocityX: STATIONARY_SPEED_MAX,
            velocityY: 0,
          }],
        },
      ],
      weaponFires: [{
        t: 1,
        tick: 1_064,
        shooter: P1,
        weapon: "ak47",
        x: 0,
        y: 0,
        z: 64,
        yaw: 0,
      }],
    });

    const result = analyzeMechanics(sourceMatch([round]), CONTEXT);

    expect(result.rounds[0].shotMovements).toEqual([{
      shotId: "r1-shot-0000",
      shooterId: P1,
      sampleTime: 1,
      sampleAgeSeconds: 0,
      horizontalSpeed: STATIONARY_SPEED_MAX,
      speedSource: "velocity_components",
      movementState: "stationary",
      counterStrafeAssessment: "compatible",
      referenceTime: 1 - MOVEMENT_SAMPLE_MAX_AGE_SECONDS,
      referenceSpeed: COUNTER_STRAFE_REFERENCE_SPEED_MIN,
      unavailableReasons: [],
    }]);
  });

  it("marks a shot above the stationary threshold as moving", () => {
    const round = sourceRound({
      frames: [{
        t: 1,
        players: [{
          id: P1,
          x: 0,
          y: 0,
          z: 0,
          yaw: 0,
          hp: 100,
          armor: 0,
          team: 2,
          speed: STATIONARY_SPEED_MAX + 0.01,
        }],
      }],
      weaponFires: [{
        t: 1,
        tick: 1_064,
        shooter: P1,
        weapon: "ak47",
        x: 0,
        y: 0,
        z: 64,
        yaw: 0,
      }],
    });

    const movement = analyzeMechanics(sourceMatch([round]), CONTEXT)
      .rounds[0].shotMovements[0];

    expect(movement).toMatchObject({
      horizontalSpeed: STATIONARY_SPEED_MAX + 0.01,
      speedSource: "speed",
      movementState: "moving",
      counterStrafeAssessment: "not_observed",
      unavailableReasons: [],
    });
  });

  it("keeps movement unavailable when the sampled frame has no velocity", () => {
    const round = sourceRound({
      frames: [{
        t: 1,
        players: [{
          id: P1,
          x: 0,
          y: 0,
          z: 0,
          yaw: 0,
          hp: 100,
          armor: 0,
          team: 2,
        }],
      }],
      weaponFires: [{
        t: 1,
        tick: 1_064,
        shooter: P1,
        weapon: "ak47",
        x: 0,
        y: 0,
        z: 64,
        yaw: 0,
      }],
    });

    const movement = analyzeMechanics(sourceMatch([round]), CONTEXT)
      .rounds[0].shotMovements[0];

    expect(movement).toMatchObject({
      horizontalSpeed: null,
      movementState: "unavailable",
      counterStrafeAssessment: "unavailable",
      unavailableReasons: ["missing_velocity"],
    });
  });

  it("finds the first frame with a clear line of sight before an engagement", () => {
    const wall: MapGeometry = {
      map: "de_nuke",
      geometryId: "synthetic-wall-v1",
      triangles: [
        {
          a: { x: 50, y: -10, z: 0 },
          b: { x: 50, y: 10, z: 0 },
          c: { x: 50, y: 10, z: 100 },
        },
        {
          a: { x: 50, y: -10, z: 0 },
          b: { x: 50, y: 10, z: 100 },
          c: { x: 50, y: -10, z: 100 },
        },
      ],
    };
    const round = sourceRound({
      frames: [
        {
          t: 0,
          players: [
            { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
            { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 0, team: 3 },
          ],
        },
        {
          t: 1,
          players: [
            { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
            { id: P2, x: 100, y: 50, z: 0, yaw: 180, hp: 100, armor: 0, team: 3 },
          ],
        },
      ],
      damages: [damage(2, 1_128, P1, P2, 20)],
    });

    const result = analyzeMechanics(sourceMatch([round]), {
      ...CONTEXT,
      mapGeometry: wall,
    });

    expect(result.rounds[0].firstVisibilities).toEqual([{
      visibilityId: "r1-engagement-000-first-visibility",
      engagementId: "r1-engagement-000",
      participants: [P1, P2],
      time: 1,
      tick: 1_064,
      geometryId: "synthetic-wall-v1",
      evidenceId: "r1-engagement-000-visibility",
      unavailableReasons: [],
    }]);
    expect(result.evidence.map((proof) => proof.type)).toEqual([
      "visibility",
      "damage",
    ]);
  });

  it("uses the earliest frame when the sight line is already clear", () => {
    const round = sourceRound({
      damages: [damage(1, 1_064, P1, P2, 20)],
    });

    const visibility = analyzeMechanics(sourceMatch([round]), {
      ...CONTEXT,
      mapGeometry: OPEN_GEOMETRY,
    }).rounds[0].firstVisibilities[0];

    expect(visibility).toMatchObject({
      time: 0,
      tick: 1_000,
      geometryId: "synthetic-open-v1",
      unavailableReasons: [],
    });
  });

  it("keeps first visibility unavailable without matching map geometry", () => {
    const round = sourceRound({
      damages: [damage(1, 1_064, P1, P2, 20)],
    });

    const missing = analyzeMechanics(sourceMatch([round]), CONTEXT)
      .rounds[0].firstVisibilities[0];
    const mismatched = analyzeMechanics(sourceMatch([round]), {
      ...CONTEXT,
      mapGeometry: { ...OPEN_GEOMETRY, map: "de_mirage" },
    }).rounds[0].firstVisibilities[0];

    expect(missing).toMatchObject({
      time: null,
      evidenceId: null,
      unavailableReasons: ["missing_map_geometry"],
    });
    expect(mismatched).toMatchObject({
      time: null,
      evidenceId: null,
      unavailableReasons: ["map_geometry_mismatch"],
    });
  });

  it("measures yaw and pitch error for both players at first visibility", () => {
    const round = sourceRound({
      frames: [{
        t: 0,
        players: [
          {
            id: P1,
            x: 0,
            y: 0,
            z: 0,
            yaw: 0,
            pitch: -40,
            hp: 100,
            armor: 0,
            team: 2,
          },
          {
            id: P2,
            x: 100,
            y: 0,
            z: 100,
            yaw: 180,
            pitch: 40,
            hp: 100,
            armor: 0,
            team: 3,
          },
        ],
      }],
      damages: [damage(1, 1_064, P1, P2, 20)],
    });

    const placements = analyzeMechanics(sourceMatch([round]), {
      ...CONTEXT,
      mapGeometry: OPEN_GEOMETRY,
    }).rounds[0].crosshairPlacements;

    expect(placements).toHaveLength(2);
    expect(placements[0]).toMatchObject({
      playerId: P1,
      targetId: P2,
      time: 0,
      yawErrorDegrees: 0,
      pitchErrorDegrees: 5,
      totalErrorDegrees: 5,
      unavailableReasons: [],
    });
    expect(placements[1]).toMatchObject({
      playerId: P2,
      targetId: P1,
      yawErrorDegrees: 0,
      pitchErrorDegrees: 5,
      totalErrorDegrees: 5,
      unavailableReasons: [],
    });
  });

  it("keeps yaw measurable but marks placement incomplete when pitch is absent", () => {
    const round = sourceRound({
      damages: [damage(1, 1_064, P1, P2, 20)],
    });

    const placements = analyzeMechanics(sourceMatch([round]), {
      ...CONTEXT,
      mapGeometry: OPEN_GEOMETRY,
    }).rounds[0].crosshairPlacements;

    expect(placements[0]).toMatchObject({
      yawErrorDegrees: 0,
      pitchErrorDegrees: null,
      totalErrorDegrees: null,
      unavailableReasons: ["missing_pitch"],
    });
    expect(placements[1]).toMatchObject({
      yawErrorDegrees: 0,
      pitchErrorDegrees: null,
      totalErrorDegrees: null,
      unavailableReasons: ["missing_pitch"],
    });
  });

  it("propagates unavailable visibility to crosshair placement", () => {
    const round = sourceRound({
      damages: [damage(1, 1_064, P1, P2, 20)],
    });

    const placements = analyzeMechanics(sourceMatch([round]), CONTEXT)
      .rounds[0].crosshairPlacements;

    expect(placements).toHaveLength(2);
    expect(placements.every(
      (placement) =>
        placement.totalErrorDegrees === null &&
        placement.unavailableReasons[0] === "missing_map_geometry",
    )).toBe(true);
  });

  it("assembles visibility, shots, movement, placement, damage and outcome into a duel", () => {
    const playersAt = (t: number) => ({
      t,
      players: [
        {
          id: P1,
          x: 0,
          y: 0,
          z: 0,
          yaw: 0,
          pitch: 0,
          hp: 100,
          armor: 0,
          team: 2,
          speed: 0,
        },
        {
          id: P2,
          x: 100,
          y: 0,
          z: 0,
          yaw: 180,
          pitch: 0,
          hp: 100,
          armor: 0,
          team: 3,
          speed: 0,
        },
      ],
    });
    const round = sourceRound({
      frames: [playersAt(0), playersAt(0.5), playersAt(1.5)],
      damages: [damage(1, 1_064, P1, P2, 20, 2)],
      events: [{
        t: 2,
        tick: 1_128,
        sequence: 4,
        type: "kill",
        killer: P1,
        victim: P2,
        weapon: "ak47",
      }],
      weaponFires: [
        {
          t: 0.5,
          tick: 1_032,
          sequence: 1,
          shooter: P1,
          weapon: "ak47",
          x: 0,
          y: 0,
          z: 64,
          yaw: 0,
        },
        {
          t: 1.5,
          tick: 1_096,
          sequence: 3,
          shooter: P2,
          weapon: "ak47",
          x: 100,
          y: 0,
          z: 64,
          yaw: 180,
        },
      ],
    });

    const duel = analyzeMechanics(sourceMatch([round]), {
      ...CONTEXT,
      mapGeometry: OPEN_GEOMETRY,
    }).rounds[0].duels[0];

    expect(duel).toMatchObject({
      duelId: "r1-duel-000",
      engagementId: "r1-engagement-000",
      participants: [P1, P2],
      initiatorId: P1,
      firstVisibilityId: "r1-engagement-000-first-visibility",
      reactionTimeSeconds: 1,
      startTime: 1,
      endTime: 2,
      kill: { killerId: P1, victimId: P2 },
      unavailableReasons: [],
    });
    expect(duel.players).toEqual([
      {
        playerId: P1,
        damageHealth: 20,
        shotIds: ["r1-shot-0000"],
        firingSequenceIds: ["r1-firing-sequence-0000"],
        movementShotIds: ["r1-shot-0000"],
        crosshairPlacementId:
          `r1-engagement-000-first-visibility-${P1}`,
      },
      {
        playerId: P2,
        damageHealth: 0,
        shotIds: ["r1-shot-0001"],
        firingSequenceIds: ["r1-firing-sequence-0001"],
        movementShotIds: ["r1-shot-0001"],
        crosshairPlacementId:
          `r1-engagement-000-first-visibility-${P2}`,
      },
    ]);
  });

  it("keeps a duel usable but explicitly incomplete without geometry and shots", () => {
    const round = sourceRound({
      damages: [damage(1, 1_064, P1, P2, 20)],
    });
    delete round.weaponFires;

    const duel = analyzeMechanics(sourceMatch([round]), CONTEXT)
      .rounds[0].duels[0];

    expect(duel).toMatchObject({
      reactionTimeSeconds: null,
      players: [
        { playerId: P1, damageHealth: 20, shotIds: [] },
        { playerId: P2, damageHealth: 0, shotIds: [] },
      ],
      unavailableReasons: [
        "missing_map_geometry",
        "missing_weapon_fire_events",
      ],
    });
  });

  it("is stable and refuses metadata-only rounds", () => {
    const match = sourceMatch([sourceRound()]);
    expect(analyzeMechanics(match, CONTEXT)).toEqual(analyzeMechanics(match, CONTEXT));

    const unloaded = sourceMatch([sourceRound({ frames: [] })]);
    expect(() => analyzeMechanics(unloaded, CONTEXT)).toThrow(
      "Cannot analyze mechanics for round 1 without its frame payload.",
    );
  });
});
