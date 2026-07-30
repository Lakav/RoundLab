import { describe, expect, it } from "vitest";
import {
  summarizePlayerMechanics,
} from "@/lib/analysis/summarize-player-mechanics";
import type {
  MechanicsAnalysis,
  RoundMechanicsAnalysis,
  ShotAssociation,
} from "@/lib/analysis/mechanics-types";

const PLAYER = "player-1";
const OTHER = "player-2";

function shot(
  shotId: string,
  weapon: string,
  hitgroup?: string,
  enemySpotted?: boolean | null,
): ShotAssociation {
  return {
    shotId,
    roundNumber: 1,
    shooterId: PLAYER,
    weapon,
    fireEvidenceId: `${shotId}-fire`,
    tick: 100,
    time: 1,
    origin: { x: 0, y: 0, z: 64 },
    yaw: 0,
    enemySpotted,
    associationStatus: hitgroup === undefined
      ? "reliable_miss"
      : "reliable_hit",
    impacts: [],
    damages: hitgroup === undefined
      ? []
      : [{
        evidenceId: `${shotId}-damage`,
        tick: 100,
        time: 1,
        victimId: OTHER,
        damageHealth: 20,
        damageArmor: 0,
        hitgroup,
        distanceWorld: 100,
      }],
    unavailableReasons: [],
  };
}

function round(
  overrides: Partial<RoundMechanicsAnalysis> = {},
): RoundMechanicsAnalysis {
  return {
    roundNumber: 1,
    engagements: [],
    firstVisibilities: [],
    crosshairPlacements: [],
    duels: [],
    shots: [],
    firingSequences: [],
    shotMovements: [],
    unmatchedImpacts: [],
    unmatchedDamages: [],
    excludedWeaponFireEvents: 0,
    excludedDamageEvents: 0,
    excludedKillEvents: 0,
    unavailableReasons: [],
    ...overrides,
  };
}

function mechanics(
  sourceRound: RoundMechanicsAnalysis,
  evidence: MechanicsAnalysis["evidence"] = [],
): MechanicsAnalysis {
  return {
    specVersion: "roundlab.mechanics.v2",
    inputSchemaVersion: "roundlab.replay.v2",
    parserVersion: "test",
    matchId: "match-1",
    generatedAt: "2026-07-27T00:00:00.000Z",
    rounds: [sourceRound],
    evidence,
  };
}

describe("summarizePlayerMechanics", () => {
  it("does not invalidate one player because another player has unmatched damage", () => {
    const source = mechanics(
      round({
        shots: [shot("shot-1", "ak47", "chest"), shot("shot-2", "ak47")],
        unmatchedDamages: [{
          evidenceId: "other-damage",
          reason: "no_matching_fire",
        }],
      }),
      [{
        evidenceId: "other-damage",
        roundNumber: 1,
        tick: 100,
        sequence: 1,
        time: 1,
        type: "damage",
        actors: [OTHER, PLAYER],
      }],
    );

    const summary = summarizePlayerMechanics(source, PLAYER, true);
    expect(summary.accuracy).toBe(0.5);
    expect(summary.metrics.accuracy).toMatchObject({
      value: 0.5,
      unit: "ratio",
      sampleCount: 2,
      usableSampleCount: 2,
      coverage: 1,
      provenance: "reconstructed",
      confidence: "high",
      formulaVersion: "roundlab.aim.v3.accuracy",
    });
  });

  it("keeps accuracy unavailable when this player's own damage is unmatched", () => {
    const source = mechanics(
      round({
        shots: [shot("shot-1", "ak47", "chest")],
        unmatchedDamages: [{
          evidenceId: "player-damage",
          reason: "no_matching_fire",
        }],
      }),
      [{
        evidenceId: "player-damage",
        roundNumber: 1,
        tick: 100,
        sequence: 1,
        time: 1,
        type: "damage",
        actors: [PLAYER, OTHER],
      }],
    );

    const summary = summarizePlayerMechanics(source, PLAYER, true);
    expect(summary.accuracy).toBeNull();
    expect(summary.metrics.accuracy).toMatchObject({
      value: null,
      usableSampleCount: 0,
      coverage: 0,
      confidence: "unavailable",
    });
    expect(summary.metrics.accuracy.unavailableReasons).toContain(
      "unmatched_player_damage_events",
    );
  });

  it("excludes AWP hits from head accuracy", () => {
    const source = mechanics(round({
      shots: [
        shot("shot-1", "awp", "head"),
        shot("shot-2", "ak47", "head"),
        shot("shot-3", "ak47", "chest"),
      ],
    }));

    const summary = summarizePlayerMechanics(source, PLAYER, true);
    expect(summary.accuracy).toBe(1);
    expect(summary.headAccuracy).toBe(0.5);
    expect(summary.hitShots).toBe(3);
    expect(summary.damage).toBe(60);
    expect(summary.headHits).toBe(2);
    expect(summary.bodyHits).toBe(1);
    expect(summary.averageDamagePerHit).toBe(20);
  });

  it("calculates accuracy only from shots fired while an enemy is spotted", () => {
    const source = mechanics(round({
      shots: [
        shot("shot-1", "ak47", "chest", true),
        shot("shot-2", "ak47", undefined, true),
        shot("shot-3", "ak47", undefined, false),
      ],
    }));

    expect(
      summarizePlayerMechanics(source, PLAYER, false).spottedAccuracy,
    ).toBe(0.5);
  });

  it("does not mix legacy shots with demo spotted-mask shots", () => {
    const source = mechanics(round({
      shots: [
        shot("shot-1", "ak47", "chest", true),
        shot("shot-2", "ak47"),
      ],
    }));

    expect(
      summarizePlayerMechanics(source, PLAYER, false).spottedAccuracy,
    ).toBeNull();
  });

  it("measures rifle spray accuracy independently from spotted accuracy", () => {
    const rifleShots = [
      shot("rifle-1", "ak47", "chest", true),
      shot("rifle-2", "ak47", undefined, true),
      shot("rifle-3", "ak47", "chest", false),
    ];
    const smgShots = [
      shot("smg-1", "mp9", "chest", true),
      shot("smg-2", "mp9", "chest", true),
      shot("smg-3", "mp9", "chest", true),
    ];
    const source = mechanics(round({
      shots: [...rifleShots, ...smgShots],
      firingSequences: [
        {
          firingSequenceId: "rifle-spray",
          roundNumber: 1,
          shooterId: PLAYER,
          weapon: "ak47",
          kind: "spray",
          startTick: 100,
          endTick: 102,
          startTime: 1,
          endTime: 1.2,
          shotCount: 3,
          shotIds: rifleShots.map((item) => item.shotId),
          fireEvidenceIds: rifleShots.map((item) => item.fireEvidenceId),
        },
        {
          firingSequenceId: "smg-spray",
          roundNumber: 1,
          shooterId: PLAYER,
          weapon: "mp9",
          kind: "spray",
          startTick: 110,
          endTick: 112,
          startTime: 2,
          endTime: 2.2,
          shotCount: 3,
          shotIds: smgShots.map((item) => item.shotId),
          fireEvidenceIds: smgShots.map((item) => item.fireEvidenceId),
        },
      ],
    }));

    const summary = summarizePlayerMechanics(source, PLAYER, false);
    expect(summary.sprayAccuracy).toBeCloseTo(2 / 3);
    expect(summary.spraySequences).toBe(2);
    expect(summary.tapSequences).toBe(0);
    expect(summary.burstSequences).toBe(0);
    expect(summary.firstBulletAccuracy).toBe(1);
    expect(summary.accuracyByWeapon.ak47.value).toBeCloseTo(2 / 3);
    expect(summary.accuracyByWeapon.mp9.value).toBe(1);
    expect(summary.hitgroupDistribution.chest.value).toBe(1);
  });

  it("uses medians and excludes time-to-damage values of one second or more", () => {
    const source = mechanics(round({
      duels: [0.1, 0.3, 0.9, 1.2].map((reactionTimeSeconds, index) => ({
        duelId: `duel-${index}`,
        engagementId: `engagement-${index}`,
        participants: [PLAYER, OTHER],
        initiatorId: PLAYER,
        firstVisibilityId: `visibility-${index}`,
        reactionTimeSeconds,
        startTime: 1,
        endTime: 2,
        players: [],
        kill: null,
        evidenceIds: [],
        unavailableReasons: [],
      })),
      crosshairPlacements: [1, 9, 3].map((totalErrorDegrees, index) => ({
        placementId: `placement-${index}`,
        visibilityId: `visibility-${index}`,
        playerId: PLAYER,
        targetId: OTHER,
        time: 1,
        tick: 100,
        yawErrorDegrees: totalErrorDegrees,
        pitchErrorDegrees: 0,
        totalErrorDegrees,
        evidenceId: null,
        unavailableReasons: [],
      })),
    }));

    const summary = summarizePlayerMechanics(source, PLAYER, false);
    expect(summary.timeToDamageMs).toBeCloseTo(300);
    expect(summary.timeToDamageSamples).toBe(3);
    expect(summary.crosshairErrorDegrees).toBe(3);
    expect(summary.crosshairSamples).toBe(3);
    expect(summary.duels).toBe(4);
  });

  it("reports movement volume and counter-strafe sample coverage", () => {
    const source = mechanics(round({
      shotMovements: [
        {
          shotId: "shot-1",
          shooterId: PLAYER,
          sampleTime: 1,
          sampleAgeSeconds: 0,
          horizontalSpeed: 0,
          speedSource: "speed",
          duckAmount: 1,
          scoped: true,
          scopedSampleTime: 0.99,
          scopedSampleAgeSeconds: 0.01,
          stance: "crouched",
          movementState: "stationary",
          counterStrafeAssessment: "compatible",
          referenceTime: 0.9,
          referenceSpeed: 120,
          unavailableReasons: [],
        },
        {
          shotId: "shot-2",
          shooterId: PLAYER,
          sampleTime: 2,
          sampleAgeSeconds: 0,
          horizontalSpeed: 90,
          speedSource: "speed",
          duckAmount: 0,
          scoped: false,
          scopedSampleTime: 1.99,
          scopedSampleAgeSeconds: 0.01,
          stance: "standing",
          movementState: "moving",
          counterStrafeAssessment: "not_observed",
          referenceTime: 1.9,
          referenceSpeed: 100,
          unavailableReasons: [],
        },
      ],
    }));

    const summary = summarizePlayerMechanics(source, PLAYER, false);
    expect(summary.stationaryShots).toBe(1);
    expect(summary.movingShots).toBe(1);
    expect(summary.movementSamples).toBe(2);
    expect(summary.crouchedShots).toBe(1);
    expect(summary.scopedShots).toBe(1);
    expect(summary.metrics.scopedShots).toMatchObject({
      value: 1,
      sampleCount: 2,
      usableSampleCount: 2,
      coverage: 1,
      provenance: "estimated",
      confidence: "medium",
      unavailableReasons: [],
      formulaVersion: "roundlab.aim.v3.scopedShots",
    });
    expect(summary.counterStrafeRate).toBe(0.5);
    expect(summary.counterStrafeSamples).toBe(2);
  });

  it("keeps scoped-shot count unavailable when scoped samples are incomplete", () => {
    const baseMovement = {
      shooterId: PLAYER,
      sampleTime: 1,
      sampleAgeSeconds: 0,
      horizontalSpeed: 0,
      speedSource: "speed" as const,
      duckAmount: 0,
      scopedSampleTime: 0.99,
      scopedSampleAgeSeconds: 0.01,
      stance: "standing" as const,
      movementState: "stationary" as const,
      counterStrafeAssessment: "not_observed" as const,
      referenceTime: null,
      referenceSpeed: null,
      unavailableReasons: [],
    };
    const source = mechanics(round({
      shotMovements: [
        { ...baseMovement, shotId: "shot-1", scoped: true },
        { ...baseMovement, shotId: "shot-2", scoped: null },
      ],
    }));

    const summary = summarizePlayerMechanics(source, PLAYER, false);

    expect(summary.scopedShots).toBeNull();
    expect(summary.metrics.scopedShots).toMatchObject({
      value: null,
      sampleCount: 2,
      usableSampleCount: 1,
      coverage: 0.5,
      provenance: "estimated",
      confidence: "unavailable",
      unavailableReasons: ["incomplete_scoped_samples"],
    });
  });

  it("reports wallbangs, sampled duel distance and exposure before first shot", () => {
    const wallbang = shot("shot-1", "ak47", "head", true);
    wallbang.kills = [{
      evidenceId: "kill-1",
      tick: 101,
      time: 1.01,
      victimId: OTHER,
      headshot: true,
      penetratedSurfaces: 1,
    }];
    const source = mechanics(round({
      shots: [wallbang],
      firingSequences: [{
        firingSequenceId: "tap-1",
        roundNumber: 1,
        shooterId: PLAYER,
        weapon: "ak47",
        kind: "tap",
        startTick: 100,
        endTick: 100,
        startTime: 1,
        endTime: 1,
        shotCount: 1,
        shotIds: ["shot-1"],
        fireEvidenceIds: ["shot-1-fire"],
      }],
      firstVisibilities: [{
        visibilityId: "visibility-1",
        engagementId: "engagement-1",
        participants: [PLAYER, OTHER],
        time: 0.75,
        tick: 75,
        geometryId: "test",
        method: "geometry_fov_smoke_flash",
        confidence: "medium",
        observerIds: [PLAYER],
        limitations: ["dynamic_obstacles_not_modeled"],
        evidenceId: "visibility-evidence",
        unavailableReasons: [],
      }],
      duels: [{
        duelId: "duel-1",
        engagementId: "engagement-1",
        participants: [PLAYER, OTHER],
        initiatorId: PLAYER,
        firstVisibilityId: "visibility-1",
        reactionTimeSeconds: 0.25,
        startTime: 1,
        endTime: 1.01,
        players: [{
          playerId: PLAYER,
          damageHealth: 20,
          shotIds: ["shot-1"],
          firingSequenceIds: ["tap-1"],
          movementShotIds: [],
          crosshairPlacementId: null,
        }],
        kill: null,
        evidenceIds: [],
        unavailableReasons: [],
      }],
    }));

    const summary = summarizePlayerMechanics(source, PLAYER, false);
    expect(summary.wallbangKills).toBe(1);
    expect(summary.averageDuelDistance).toBe(100);
    expect(summary.timeToFirstShotMs).toBe(250);
    expect(summary.exposureBeforeShotMs).toBe(250);
    expect(summary.tapAccuracy).toBe(1);
    expect(summary.firstBulletAccuracy).toBe(1);
  });
});
