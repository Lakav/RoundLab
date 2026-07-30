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
    specVersion: "roundlab.mechanics.v1",
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

    expect(summarizePlayerMechanics(source, PLAYER, true).accuracy).toBe(0.5);
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

    expect(summarizePlayerMechanics(source, PLAYER, true).accuracy).toBeNull();
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

  it("limits spray accuracy to spotted rifle spray bullets", () => {
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
    expect(summary.sprayAccuracy).toBe(0.5);
    expect(summary.spraySequences).toBe(2);
    expect(summary.tapSequences).toBe(0);
    expect(summary.burstSequences).toBe(0);
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
    expect(summary.counterStrafeRate).toBe(0.5);
    expect(summary.counterStrafeSamples).toBe(2);
  });
});
