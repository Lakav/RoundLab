import { describe, expect, it } from "vitest";
import {
  analyzeMatch,
  utilityQuantityRating,
} from "@/lib/analysis/analyze-match";
import type { Frame, MatchData, PlayerId, Round } from "@/lib/types";

const P1 = "76561198000000001";
const P2 = "76561198000000002";
const P3 = "76561198000000003";
const P4 = "76561198000000004";
const P5 = "76561198000000005";
const CONTEXT = { matchId: "match-1", generatedAt: "2026-07-23T10:00:00.000Z" };

function frame(t: number): Frame {
  return {
    t,
    players: [
      { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 2 },
      { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 3 },
      { id: P3, x: 10, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 2 },
    ],
  };
}

function round(number: number, overrides: Partial<Round> = {}): Round {
  return {
    number,
    startTick: number * 1_000,
    endTick: number * 1_000 + 640,
    duration: 10,
    winner: number % 2 ? "T" : "CT",
    frames: [frame(0)],
    events: [],
    damages: [],
    disconnects: [],
    ...overrides,
  };
}

function match(rounds: Round[]): MatchData {
  return {
    schemaVersion: "roundlab.replay.v2",
    parserVersion: "0.1.0",
    meta: {
      map: "de_nuke",
      tickRate: 64,
      sampleRate: 16,
      durationSec: rounds.reduce((total, item) => total + item.duration, 0),
      teamA: "Alpha",
      teamB: "Bravo",
      scoreA: 1,
      scoreB: 1,
    },
    players: [
      { steamId: P1, name: "One", team: "T" },
      { steamId: P2, name: "Two", team: "CT" },
      { steamId: P3, name: "Three", team: "T" },
      { steamId: P4, name: "Four", team: "CT" },
      { steamId: P5, name: "Five", team: "CT" },
    ],
    rounds,
  };
}

function player(result: ReturnType<typeof analyzeMatch>, id: PlayerId) {
  const found = result.players.find((item) => item.playerId === String(id));
  if (!found) throw new Error(`Missing player ${id}`);
  return found;
}

describe("deterministic MatchAnalysis V1", () => {
  it("calculates enemy and teammate flash effectiveness", () => {
    const result = analyzeMatch(match([
      round(1, {
        events: [{ t: 10, tick: 1_640, type: "round_end", winner: "T" }],
        damages: [
          { t: 1, tick: 1_064, attacker: P1, victim: P2, weapon: "hegrenade", damageHealth: 40, damageArmor: 0, healthAfter: 60, armorAfter: 100 },
          { t: 1.5, tick: 1_096, attacker: P1, victim: P3, weapon: "molotov", damageHealth: 5, damageArmor: 0, healthAfter: 95, armorAfter: 100 },
        ],
        flashes: [
          { t: 2, tick: 1_128, thrower: P1, victim: P2, duration: 2.5 },
          { t: 3, tick: 1_192, thrower: P1, victim: P3, duration: 1.25 },
          { t: 4, tick: 1_256, thrower: P1, victim: P1, duration: 3 },
        ],
      }),
    ]), CONTEXT);

    expect(player(result, P1).metrics.flashes).toEqual({
      enemiesFlashed: 1,
      teammatesFlashed: 1,
      effectiveEnemiesFlashed: 1,
      effectiveTeammatesFlashed: 2,
      enemyBlindDuration: 2.5,
      teammateBlindDuration: 1.25,
      enemyBlindFlashCount: 1,
      longestEnemyBlindDuration: 2.5,
      flashesLeadingToKills: 0,
      averageEnemyBlindDuration: 2.5,
      averageTeammateBlindDuration: 1.25,
    });
    expect(player(result, P1).metricEvidence.flashes).toHaveLength(3);
    expect(player(result, P1).metrics.utilityDamage).toEqual({
      heDamage: 40,
      fireDamage: 0,
      teammateHeDamage: 0,
      teammateFireDamage: 5,
    });
  });

  it("excludes half-blinds and counts team kills during an effective flash", () => {
    const result = analyzeMatch(match([
      round(1, {
        frames: [{
          ...frame(0),
          players: [
            ...frame(0).players,
            { id: P4, x: 110, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 3 },
          ],
        }],
        events: [
          { t: 3, tick: 1_192, type: "kill", killer: P3, victim: P2, weapon: "ak47" },
          { t: 10, tick: 1_640, type: "round_end", winner: "T" },
        ],
        flashes: [
          { t: 2, tick: 1_128, sequence: 0, thrower: P1, victim: P2, duration: 2.5 },
          { t: 2, tick: 1_128, sequence: 1, thrower: P1, victim: P4, duration: 1.1 },
        ],
      }),
    ]), CONTEXT);

    expect(player(result, P1).metrics.flashes).toMatchObject({
      enemiesFlashed: 2,
      effectiveEnemiesFlashed: 1,
      enemyBlindFlashCount: 1,
      longestEnemyBlindDuration: 2.5,
      averageEnemyBlindDuration: 2.5,
      flashesLeadingToKills: 1,
    });
  });

  it("calculates K/D/A, headshots, ADR and stable replay evidence", () => {
    const input = match([
      round(1, {
        events: [
          { t: 2, tick: 1_128, type: "kill", killer: P1, victim: P2, assist: P3, weapon: "ak47", hs: true },
          { t: 3, tick: 1_192, type: "kill", killer: P2, victim: P2, weapon: "world" },
          { t: 10, tick: 1_640, type: "round_end", winner: "T" },
        ],
        damages: [
          { t: 1, tick: 1_064, attacker: P1, victim: P2, weapon: "ak47", damageHealth: 80, damageArmor: 10, healthAfter: 20, armorAfter: 90, hitgroup: "chest" },
          { t: 1.5, tick: 1_096, attacker: P3, victim: P2, weapon: "glock", damageHealth: 20, damageArmor: 0, healthAfter: 0, armorAfter: 90, hitgroup: "head" },
          { t: 1.75, tick: 1_112, attacker: P1, victim: P3, weapon: "ak47", damageHealth: 5, damageArmor: 0, healthAfter: 95, armorAfter: 100, hitgroup: "chest" },
        ],
      }),
      round(2, {
        events: [
          { t: 2, tick: 2_128, type: "kill", killer: P2, victim: P1, weapon: "m4a1", hs: false },
          { t: 5, tick: 2_320, type: "kill", victim: P3, weapon: "world" },
          { t: 10, tick: 2_640, type: "round_end", winner: "CT" },
        ],
        damages: [
          { t: 1, tick: 2_064, attacker: P2, victim: P1, weapon: "m4a1", damageHealth: 100, damageArmor: 20, healthAfter: 0, armorAfter: 80, hitgroup: "chest" },
        ],
      }),
    ]);

    const result = analyzeMatch(input, CONTEXT);

    expect(result).toMatchObject({
      specVersion: "roundlab.metrics.v1",
      inputSchemaVersion: "roundlab.replay.v2",
      parserVersion: "0.1.0",
      matchId: "match-1",
      generatedAt: CONTEXT.generatedAt,
    });
    expect(player(result, P1).metrics).toMatchObject({
      roundsPlayed: 2,
      kills: 1,
      deaths: 1,
      assists: 0,
      kdRatio: 1,
      headshotKills: 1,
      headshotRate: 1,
      damageHealth: 80,
      adr: 40,
    });
    expect(player(result, P2).metrics).toMatchObject({
      roundsPlayed: 2,
      kills: 1,
      deaths: 2,
      assists: 0,
      kdRatio: 0.5,
      headshotKills: 0,
      headshotRate: 0,
      damageHealth: 100,
      adr: 50,
    });
    expect(player(result, P3).metrics).toMatchObject({
      roundsPlayed: 2,
      kills: 0,
      deaths: 1,
      assists: 1,
      kdRatio: 0,
      headshotKills: 0,
      headshotRate: null,
      damageHealth: 20,
      adr: 10,
    });
    expect(player(result, P1).metricEvidence).toMatchObject({
      kills: ["r1-kill-0000"],
      deaths: ["r2-kill-0000"],
      headshotKills: ["r1-kill-0000"],
      damageHealth: ["r1-damage-0000"],
    });
    expect(player(result, P3).metricEvidence.assists).toEqual(["r1-kill-0000"]);
    expect(result.evidence.find((item) => item.evidenceId === "r1-kill-0000")).toEqual({
      evidenceId: "r1-kill-0000",
      roundNumber: 1,
      tick: 1_128,
      time: 2,
      type: "kill",
      actors: [P1, P2, P3],
      sequence: null,
      weapon: "ak47",
    });
    expect(player(result, P1).metrics).toMatchObject({
      openingAttempts: 2,
      openingWins: 1,
      openingLosses: 1,
      survivedRounds: 1,
      survivalRate: 0.5,
    });
    expect(player(result, P2).metrics).toMatchObject({
      openingAttempts: 2,
      openingWins: 1,
      openingLosses: 1,
      clutchOpportunities: {
        oneVsOne: 0,
        oneVsTwo: 2,
        oneVsThree: 0,
        oneVsFour: 0,
        oneVsFivePlus: 0,
      },
      clutchWins: {
        oneVsOne: 0,
        oneVsTwo: 1,
        oneVsThree: 0,
        oneVsFour: 0,
        oneVsFivePlus: 0,
      },
    });
  });

  it("marks ADR unavailable instead of treating missing damage events as zero", () => {
    const legacyRound = round(1);
    delete legacyRound.damages;

    const result = analyzeMatch(match([legacyRound]), CONTEXT);

    expect(player(result, P1).metrics).toMatchObject({ damageHealth: null, adr: null });
    expect(player(result, P1).unavailableReasons).toContain("missing_damage_events");
  });

  it("excludes teamkills from kills but still counts the victim's death", () => {
    const result = analyzeMatch(match([
      round(1, {
        events: [{ t: 1, tick: 1_064, type: "kill", killer: P1, victim: P3, weapon: "ak47" }],
      }),
    ]), CONTEXT);

    expect(player(result, P1).metrics.kills).toBe(0);
    expect(player(result, P3).metrics.deaths).toBe(1);
  });

  it("returns null instead of partial ADR when team context is missing", () => {
    const incompleteContext = round(1, {
      frames: [{
        t: 0,
        players: [{ id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 }],
      }],
      damages: [{
        t: 1,
        tick: 1_064,
        attacker: P1,
        victim: P2,
        damageHealth: 50,
        damageArmor: 0,
        healthAfter: 50,
        armorAfter: 0,
      }],
    });

    const result = analyzeMatch(match([incompleteContext]), CONTEXT);

    expect(player(result, P1).metrics.adr).toBeNull();
    expect(player(result, P1).unavailableReasons).toContain("missing_damage_team_context");
  });

  it("uses null for ratios with a zero denominator", () => {
    const result = analyzeMatch(match([round(1)]), CONTEXT);
    expect(player(result, P1).metrics).toMatchObject({
      kills: 0,
      deaths: 0,
      kdRatio: null,
      headshotRate: null,
      damageHealth: 0,
      adr: 0,
    });
  });

  it("classifies multikill rounds without overlapping buckets", () => {
    const source = round(1, {
      frames: [{
        t: 0,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P2, x: 1, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
          { id: P4, x: 2, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
          { id: P5, x: 3, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
        ],
      }],
      events: [
        { t: 1, tick: 1_064, sequence: 1, type: "kill", killer: P1, victim: P2, weapon: "ak47" },
        { t: 2, tick: 1_128, sequence: 2, type: "kill", killer: P1, victim: P4, weapon: "ak47" },
        { t: 3, tick: 1_192, sequence: 3, type: "kill", killer: P1, victim: P5, weapon: "ak47" },
      ],
    });

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(player(result, P1).metrics.multiKillRounds).toEqual({
      two: 0,
      three: 1,
      four: 0,
      fivePlus: 0,
    });
    expect(player(result, P1).metricEvidence.multiKills).toEqual([
      "r1-kill-0000",
      "r1-kill-0001",
      "r1-kill-0002",
    ]);
  });

  it("detects and wins a 1v2 clutch from the exact death sequence", () => {
    const source = round(1, {
      winner: "T",
      frames: [{
        t: 0,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P3, x: 1, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P2, x: 2, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
          { id: P4, x: 3, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
        ],
      }],
      events: [
        { t: 1, tick: 1_064, sequence: 1, type: "kill", killer: P2, victim: P3, weapon: "m4a1" },
        { t: 2, tick: 1_128, sequence: 2, type: "kill", killer: P1, victim: P2, weapon: "ak47" },
        { t: 3, tick: 1_192, sequence: 3, type: "kill", killer: P1, victim: P4, weapon: "ak47" },
        { t: 4, tick: 1_256, sequence: 4, type: "round_end", winner: "T" },
      ],
    });

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(player(result, P1).metrics.clutchOpportunities?.oneVsTwo).toBe(1);
    expect(player(result, P1).metrics.clutchWins?.oneVsTwo).toBe(1);
    expect(player(result, P1).metricEvidence.clutchOpportunities).toEqual(["r1-kill-0000"]);
    expect(player(result, P1).metricEvidence.clutchWins).toEqual([
      "r1-kill-0000",
      "r1-round-end",
    ]);
  });

  it("uses sequence rather than JSON array order for same-tick openings", () => {
    const source = round(1, {
      frames: [{
        t: 0,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P3, x: 1, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P2, x: 2, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
          { id: P4, x: 3, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
        ],
      }],
      events: [
        { t: 1, tick: 1_064, sequence: 20, type: "kill", killer: P1, victim: P2, weapon: "ak47" },
        { t: 1, tick: 1_064, sequence: 10, type: "kill", killer: P2, victim: P3, weapon: "m4a1" },
        { t: 4, tick: 1_256, sequence: 30, type: "round_end", winner: "T" },
      ],
    });

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(player(result, P2).metrics.openingWins).toBe(1);
    expect(player(result, P3).metrics.openingLosses).toBe(1);
    expect(player(result, P1).metrics.openingAttempts).toBe(0);
    expect(player(result, P2).metricEvidence.openingWins).toEqual(["r1-kill-0000"]);
  });

  it("does not call an alive disconnected player a survivor", () => {
    const source = round(1, {
      frames: [{
        t: 0,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P3, x: 1, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P2, x: 2, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
          { id: P4, x: 3, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
        ],
      }],
      disconnects: [{ t: 1, tick: 1_064, sequence: 1, player: P3 }],
      events: [{ t: 4, tick: 1_256, sequence: 2, type: "round_end", winner: "CT" }],
    });

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(player(result, P3).metrics.survivalRate).toBeNull();
    expect(player(result, P3).metrics.kastRate).toBeNull();
    expect(player(result, P3).unavailableReasons).toContain("player_disconnected_alive");
    expect(player(result, P3).unavailableReasons).toContain("incomplete_kast_context");
    expect(player(result, P1).metrics.clutchOpportunities?.oneVsTwo).toBe(1);
  });

  it("calculates trade attempts, trade kills, traded deaths and KAST", () => {
    const source = round(1, {
      winner: "T",
      frames: [{
        t: 0,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P3, x: 1, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P5, x: 2, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P2, x: 3, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
          { id: P4, x: 4, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
        ],
      }],
      events: [
        { t: 1, tick: 1_064, sequence: 1, type: "kill", killer: P2, victim: P3, weapon: "m4a1" },
        { t: 6, tick: 1_384, sequence: 3, type: "kill", killer: P1, victim: P2, weapon: "ak47" },
        { t: 10, tick: 1_640, sequence: 4, type: "round_end", winner: "T" },
      ],
      damages: [{
        t: 5.5,
        tick: 1_352,
        sequence: 2,
        attacker: P1,
        victim: P2,
        weapon: "ak47",
        damageHealth: 50,
        damageArmor: 0,
        healthAfter: 50,
        armorAfter: 0,
      }],
    });

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(player(result, P1).metrics).toMatchObject({
      tradeAttempts: 1,
      tradeKills: 1,
      tradeDeaths: 0,
      kastRounds: 1,
      kastRate: 1,
    });
    expect(player(result, P3).metrics).toMatchObject({
      tradeAttempts: 0,
      tradeKills: 0,
      tradeDeaths: 1,
      kastRounds: 1,
      kastRate: 1,
    });
    expect(player(result, P1).metricEvidence.tradeAttempts).toEqual(["r1-damage-0000"]);
    expect(player(result, P1).metricEvidence.tradeKills).toEqual(["r1-kill-0001"]);
    expect(player(result, P3).metricEvidence.tradeDeaths).toEqual([
      "r1-kill-0000",
      "r1-kill-0001",
    ]);
    expect(player(result, P3).metricEvidence.kastRounds).toEqual([
      "r1-kill-0000",
      "r1-kill-0001",
    ]);
  });

  it("keeps trade kills calculable when damage events needed for attempts are absent", () => {
    const source = round(1, {
      frames: [{
        t: 0,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P3, x: 1, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P2, x: 2, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
        ],
      }],
      events: [
        { t: 1, tick: 1_064, type: "kill", killer: P2, victim: P3, weapon: "m4a1" },
        { t: 2, tick: 1_128, type: "kill", killer: P1, victim: P2, weapon: "ak47" },
        { t: 10, tick: 1_640, type: "round_end", winner: "T" },
      ],
    });
    delete source.damages;

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(player(result, P1).metrics.tradeAttempts).toBeNull();
    expect(player(result, P1).metrics.tradeKills).toBe(1);
    expect(player(result, P3).metrics.tradeDeaths).toBe(1);
    expect(player(result, P3).metrics.kastRate).toBe(1);
  });

  it("does not trade a death after the inclusive five-second window", () => {
    const source = round(1, {
      frames: [{
        t: 0,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P3, x: 1, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
          { id: P2, x: 2, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
        ],
      }],
      events: [
        { t: 1, tick: 1_064, type: "kill", killer: P2, victim: P3, weapon: "m4a1" },
        { t: 6.01, tick: 1_385, type: "kill", killer: P1, victim: P2, weapon: "ak47" },
        { t: 10, tick: 1_640, type: "round_end", winner: "T" },
      ],
    });

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(player(result, P1).metrics.tradeKills).toBe(0);
    expect(player(result, P3).metrics.tradeDeaths).toBe(0);
    expect(player(result, P3).metrics.kastRate).toBe(0);
  });

  it("counts explicit grenade throws by type and flash assists", () => {
    const source = round(1, {
      events: [
        {
          t: 4,
          tick: 1_256,
          sequence: 4,
          type: "kill",
          killer: P1,
          victim: P2,
          assist: P3,
          flashAssist: true,
          weapon: "ak47",
        },
        { t: 10, tick: 1_640, sequence: 5, type: "round_end", winner: "T" },
      ],
      weaponFires: [
        { t: 3, tick: 1_192, sequence: 3, shooter: P3, weapon: "weapon_incgrenade", x: 0, y: 0, z: 0, yaw: 0 },
        { t: 1, tick: 1_064, sequence: 1, shooter: P1, weapon: "smokegrenade", x: 0, y: 0, z: 0, yaw: 0 },
        { t: 2, tick: 1_128, sequence: 2, shooter: P1, weapon: "flashbang", x: 0, y: 0, z: 0, yaw: 0 },
        { t: 2.5, tick: 1_160, shooter: P1, weapon: "ak47", x: 0, y: 0, z: 0, yaw: 0 },
      ],
    });

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(player(result, P1).metrics.grenadesThrown).toEqual({
      total: 2,
      flash: 1,
      smoke: 1,
      he: 0,
      molotov: 0,
      incendiary: 0,
      decoy: 0,
    });
    expect(player(result, P3).metrics.grenadesThrown).toMatchObject({
      total: 1,
      incendiary: 1,
    });
    expect(player(result, P3).metrics.flashAssists).toBe(1);
    expect(player(result, P1).metrics.utilityQuantityRating).toBeCloseTo(
      Math.pow(2 / 3, 2 / 3) * 100,
    );
    expect(player(result, P1).metricEvidence.grenadesThrown).toEqual([
      "r1-grenade-0000",
      "r1-grenade-0001",
    ]);
    expect(player(result, P3).metricEvidence.flashAssists).toEqual(["r1-kill-0000"]);
  });

  it("caps utility quantity at 100 and excludes decoys", () => {
    expect(utilityQuantityRating({
      total: 5,
      flash: 1,
      smoke: 1,
      he: 1,
      molotov: 1,
      incendiary: 0,
      decoy: 1,
    }, 1)).toBe(100);
    expect(utilityQuantityRating({
      total: 3,
      flash: 0,
      smoke: 0,
      he: 0,
      molotov: 0,
      incendiary: 0,
      decoy: 3,
    }, 1)).toBe(0);
    expect(utilityQuantityRating(null, 1)).toBeNull();
  });

  it("does not publish partial grenade totals when weapon-fire events are absent", () => {
    const source = round(1);
    delete source.weaponFires;

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(player(result, P1).metrics.grenadesThrown).toBeNull();
    expect(player(result, P1).unavailableReasons).toContain("missing_weapon_fire_events");
  });

  it("recalculates metrics and evidence on each side after a team switch", () => {
    const terroristRound = round(1, {
      winner: "T",
      events: [
        { t: 2, tick: 1_128, sequence: 2, type: "kill", killer: P1, victim: P2, weapon: "ak47", hs: true },
        { t: 10, tick: 1_640, sequence: 3, type: "round_end", winner: "T" },
      ],
      damages: [{
        t: 1,
        tick: 1_064,
        sequence: 1,
        attacker: P1,
        victim: P2,
        weapon: "ak47",
        damageHealth: 100,
        damageArmor: 0,
        healthAfter: 0,
        armorAfter: 0,
      }],
      weaponFires: [
        { t: 0.5, tick: 1_032, sequence: 0, shooter: P1, weapon: "smokegrenade", x: 0, y: 0, z: 0, yaw: 0 },
      ],
    });
    const counterTerroristRound = round(2, {
      winner: "T",
      frames: [{
        t: 0,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 3 },
          { id: P3, x: 10, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 3 },
          { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 2 },
        ],
      }],
      events: [
        { t: 2, tick: 2_128, sequence: 2, type: "kill", killer: P2, victim: P1, weapon: "ak47" },
        { t: 10, tick: 2_640, sequence: 3, type: "round_end", winner: "T" },
      ],
      damages: [{
        t: 1,
        tick: 2_064,
        sequence: 1,
        attacker: P2,
        victim: P1,
        weapon: "ak47",
        damageHealth: 100,
        damageArmor: 0,
        healthAfter: 0,
        armorAfter: 0,
      }],
      weaponFires: [
        { t: 0.5, tick: 2_032, sequence: 0, shooter: P1, weapon: "flashbang", x: 0, y: 0, z: 0, yaw: 0 },
      ],
    });

    const result = analyzeMatch(match([terroristRound, counterTerroristRound]), CONTEXT);
    const one = player(result, P1);

    expect(one.bySide.T?.metrics).toMatchObject({
      roundsPlayed: 1,
      kills: 1,
      deaths: 0,
      headshotRate: 1,
      damageHealth: 100,
      adr: 100,
      kastRate: 1,
      grenadesThrown: { total: 1, smoke: 1 },
    });
    expect(one.bySide.CT?.metrics).toMatchObject({
      roundsPlayed: 1,
      kills: 0,
      deaths: 1,
      damageHealth: 0,
      adr: 0,
      kastRate: 0,
      grenadesThrown: { total: 1, flash: 1 },
    });
    expect(one.bySide.T?.metricEvidence.kills).toEqual(["r1-kill-0000"]);
    expect(one.bySide.CT?.metricEvidence.deaths).toEqual(["r2-kill-0000"]);
    expect(player(result, P4).bySide).toEqual({ T: null, CT: null });
    expect(result.rounds.map((item) =>
      item.players.find((roundPlayer) => roundPlayer.playerId === P1)?.side
    )).toEqual(["T", "CT"]);
    expect(result.rounds[0].evidenceIds).not.toContain("r2-kill-0000");
    expect(result.rounds[1].evidenceIds).not.toContain("r1-kill-0000");
  });

  it("keeps logical team aggregates stable across a side switch", () => {
    const firstHalf = round(1, {
      winner: "T",
      scoreA: 1,
      scoreB: 0,
      frames: [{
        t: 0,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 2 },
          { id: P3, x: 10, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 2 },
          { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 3 },
          { id: P4, x: 110, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 3 },
        ],
      }],
      events: [
        { t: 2, tick: 1_128, sequence: 2, type: "kill", killer: P1, victim: P2, weapon: "ak47" },
        { t: 10, tick: 1_640, sequence: 3, type: "round_end", winner: "T" },
      ],
      damages: [{
        t: 1,
        tick: 1_064,
        sequence: 1,
        attacker: P1,
        victim: P2,
        weapon: "ak47",
        damageHealth: 100,
        damageArmor: 0,
        healthAfter: 0,
        armorAfter: 0,
      }],
      weaponFires: [],
    });
    const secondHalf = round(2, {
      winner: "T",
      scoreA: 1,
      scoreB: 1,
      frames: [{
        t: 0,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 3 },
          { id: P3, x: 10, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 3 },
          { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 2 },
          { id: P4, x: 110, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 2 },
        ],
      }],
      events: [
        { t: 2, tick: 2_128, sequence: 2, type: "kill", killer: P2, victim: P1, weapon: "ak47" },
        { t: 10, tick: 2_640, sequence: 3, type: "round_end", winner: "T" },
      ],
      damages: [{
        t: 1,
        tick: 2_064,
        sequence: 1,
        attacker: P2,
        victim: P1,
        weapon: "ak47",
        damageHealth: 100,
        damageArmor: 0,
        healthAfter: 0,
        armorAfter: 0,
      }],
      weaponFires: [],
    });

    const result = analyzeMatch(match([firstHalf, secondHalf]), CONTEXT);
    const alpha = result.teams.find((team) => team.logicalTeam === "A");
    const bravo = result.teams.find((team) => team.logicalTeam === "B");

    expect(alpha).toMatchObject({
      name: "Alpha",
      score: 1,
      playerIds: [P1, P3],
      metrics: {
        roundsPlayed: 2,
        roundsWon: 1,
        winRate: 0.5,
        playerRounds: 4,
        kills: 1,
        deaths: 1,
        damageHealth: 100,
        adr: 50,
      },
    });
    expect(bravo).toMatchObject({
      name: "Bravo",
      score: 1,
      playerIds: [P2, P4],
      metrics: {
        roundsPlayed: 2,
        roundsWon: 1,
        winRate: 0.5,
        playerRounds: 4,
        kills: 1,
        deaths: 1,
        damageHealth: 100,
        adr: 50,
      },
    });
    expect(result.rounds.map((item) => item.logicalWinner)).toEqual(["A", "B"]);
    expect(result.rounds.map((item) =>
      item.players.find((roundPlayer) => roundPlayer.playerId === P1)?.logicalTeam
    )).toEqual(["A", "A"]);
    expect(result.rounds.map((item) =>
      item.players.find((roundPlayer) => roundPlayer.playerId === P1)?.side
    )).toEqual(["T", "CT"]);
  });

  it("does not guess logical team aggregates without score history", () => {
    const source = round(2, {
      events: [{ t: 10, tick: 2_640, type: "round_end", winner: "CT" }],
      weaponFires: [],
    });

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(result.teams).toHaveLength(2);
    for (const team of result.teams) {
      expect(team.metrics).toBeNull();
      expect(team.playerIds).toEqual([]);
      expect(team.unavailableReasons).toContain("missing_logical_team_context");
    }
    expect(result.rounds[0].logicalWinner).toBeNull();
    expect(result.rounds[0].players.every((roundPlayer) => roundPlayer.logicalTeam === null)).toBe(
      true,
    );
  });

  it("accepts zero-based numbering when establishing the initial logical teams", () => {
    const source = round(0, {
      winner: "T",
      scoreA: 0,
      scoreB: 1,
      events: [{ t: 10, tick: 640, type: "round_end", winner: "T" }],
      weaponFires: [],
    });

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(result.rounds[0].logicalWinner).toBe("B");
    expect(result.rounds[0].players.find((roundPlayer) =>
      roundPlayer.playerId === P1
    )?.logicalTeam).toBe("B");
    expect(result.teams.find((team) => team.logicalTeam === "B")).toMatchObject({
      playerIds: [P1, P3],
      metrics: { roundsPlayed: 1, roundsWon: 1, winRate: 1 },
    });
  });

  it("keeps side availability independent when one side has incomplete damage data", () => {
    const incompleteT = round(1, {
      events: [{ t: 10, tick: 1_640, type: "round_end", winner: "T" }],
      weaponFires: [],
    });
    delete incompleteT.damages;
    const completeCt = round(2, {
      frames: [{
        t: 0,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 3 },
          { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 2 },
        ],
      }],
      events: [{ t: 10, tick: 2_640, type: "round_end", winner: "CT" }],
      damages: [],
      weaponFires: [],
    });

    const result = analyzeMatch(match([incompleteT, completeCt]), CONTEXT);
    const one = player(result, P1);

    expect(one.metrics.adr).toBeNull();
    expect(one.bySide.T?.metrics.adr).toBeNull();
    expect(one.bySide.CT?.metrics.adr).toBe(0);
    expect(one.bySide.T?.unavailableReasons).toContain("missing_damage_events");
    expect(one.bySide.CT?.unavailableReasons).not.toContain("missing_damage_events");
  });

  it("counts utility still held at death and removes a grenade already thrown", () => {
    const source = round(1, {
      frames: [
        frame(0),
        {
          t: 1,
          players: [
            {
              id: P1,
              x: 0,
              y: 0,
              z: 0,
              yaw: 0,
              hp: 100,
              armor: 100,
              team: 2,
              weapons: ["weapon_flashbang", "flashbang", "smokegrenade", "ak47"],
            },
            { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 3, weapons: ["m4a1"] },
          ],
        },
      ],
      events: [
        { t: 2, tick: 1_128, sequence: 2, type: "kill", killer: P2, victim: P1, weapon: "m4a1" },
        { t: 10, tick: 1_640, sequence: 3, type: "round_end", winner: "CT" },
      ],
      weaponFires: [
        { t: 2, tick: 1_128, sequence: 1, shooter: P1, weapon: "flashbang", x: 0, y: 0, z: 0, yaw: 0 },
      ],
    });

    const result = analyzeMatch(match([source]), CONTEXT);
    const one = player(result, P1);

    expect(one.metrics.utilitySavedOnDeath).toEqual({
      total: 2,
      flash: 1,
      smoke: 1,
      he: 0,
      molotov: 0,
      incendiary: 0,
      decoy: 0,
    });
    expect(one.metrics.unusedUtilityValue).toBe(500);
    expect(one.metrics.averageUnusedUtilityValue).toBe(500);
    expect(one.bySide.T?.metrics.utilitySavedOnDeath).toEqual(one.metrics.utilitySavedOnDeath);
    expect(one.metricEvidence.utilitySavedOnDeath).toEqual([
      `r1-inventory-${P1}-0001`,
      "r1-kill-0000",
    ]);
  });

  it("marks saved utility unavailable when the pre-death inventory is missing", () => {
    const source = round(1, {
      events: [
        { t: 2, tick: 1_128, type: "kill", killer: P2, victim: P1, weapon: "m4a1" },
        { t: 10, tick: 1_640, type: "round_end", winner: "CT" },
      ],
      weaponFires: [],
    });

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(player(result, P1).metrics.utilitySavedOnDeath).toBeNull();
    expect(player(result, P1).metrics.unusedUtilityValue).toBeNull();
    expect(player(result, P1).metrics.averageUnusedUtilityValue).toBeNull();
    expect(player(result, P1).unavailableReasons).toContain("missing_predeath_inventory");
  });

  it("classifies each side's freeze-time economy with explicit V1 boundaries", () => {
    const source = round(1, {
      freezeEndTick: 1_064,
      frames: [{
        t: 1,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 2, equipmentValue: 1_500 },
          { id: P3, x: 10, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 2, equipmentValue: 2_500 },
          { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 3, equipmentValue: 3_500 },
          { id: P4, x: 110, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 3, equipmentValue: 3_500 },
        ],
      }],
      events: [
        { t: 2, tick: 1_128, type: "kill", killer: P1, victim: P2, weapon: "ak47" },
        { t: 10, tick: 1_640, type: "round_end", winner: "T" },
      ],
      weaponFires: [],
    });

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(result.economyRounds).toEqual([
      {
        roundNumber: 1,
        side: "T",
        averageEquipmentValue: 2_000,
        category: "force_buy",
        evidenceId: "r1-economy-t",
        unavailableReason: null,
      },
      {
        roundNumber: 1,
        side: "CT",
        averageEquipmentValue: 3_500,
        category: "full_buy",
        evidenceId: "r1-economy-ct",
        unavailableReason: null,
      },
    ]);
    expect(result.evidence.filter((item) => item.type === "economy_snapshot")).toHaveLength(2);
    expect(player(result, P1).byEconomy.forceBuy?.metrics).toMatchObject({
      roundsPlayed: 1,
      kills: 1,
      deaths: 0,
    });
    expect(player(result, P1).byEconomy.forceBuy?.economyEvidence).toEqual(["r1-economy-t"]);
    expect(player(result, P1).byEconomy.fullBuy).toBeNull();
    expect(player(result, P1).byEconomy.unavailableRounds).toBe(0);
    expect(player(result, P2).byEconomy.fullBuy?.metrics).toMatchObject({
      roundsPlayed: 1,
      kills: 0,
      deaths: 1,
    });
    expect(player(result, P2).byEconomy.fullBuy?.economyEvidence).toEqual(["r1-economy-ct"]);
  });

  it("keeps economy categories unavailable when freeze-time equipment is incomplete", () => {
    const source = round(1, {
      freezeEndTick: 1_064,
      frames: [{
        t: 1,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 2 },
          { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 3, equipmentValue: 1_999 },
        ],
      }],
    });

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(result.economyRounds[0]).toMatchObject({
      side: "T",
      category: null,
      unavailableReason: "missing_equipment_values",
    });
    expect(result.economyRounds[1]).toMatchObject({
      side: "CT",
      averageEquipmentValue: 1_999,
      category: "eco",
    });
    expect(player(result, P1).byEconomy.unavailableRounds).toBe(1);
    expect(player(result, P1).byEconomy.eco).toBeNull();
    expect(player(result, P2).byEconomy.eco?.metrics.roundsPlayed).toBe(1);
    expect(player(result, P2).byEconomy.unavailableRounds).toBe(0);
  });

  it("keeps legacy key-moment fields empty instead of selecting replay moments", () => {
    const source = round(1, {
      winner: "T",
      frames: [{
        t: 0,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 2 },
          { id: P3, x: 10, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 2 },
          { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 3 },
          { id: P4, x: 110, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 3 },
          { id: P5, x: 120, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 3 },
        ],
      }],
      events: [
        { t: 1, tick: 1_064, sequence: 1, type: "kill", killer: P2, victim: P3, weapon: "m4a1" },
        { t: 1.5, tick: 1_096, sequence: 2, type: "bomb_planted", player: P1 },
        { t: 2, tick: 1_128, sequence: 3, type: "kill", killer: P1, victim: P4, weapon: "ak47" },
        { t: 3, tick: 1_192, sequence: 4, type: "kill", killer: P1, victim: P5, weapon: "ak47" },
        { t: 4, tick: 1_256, sequence: 5, type: "kill", killer: P1, victim: P2, weapon: "ak47" },
        { t: 10, tick: 1_640, sequence: 6, type: "round_end", winner: "T" },
      ],
      weaponFires: [],
    });

    const result = analyzeMatch(match([source]), CONTEXT);

    expect(result.keyMoments).toEqual([]);
    expect(result.rounds[0].keyMoments).toEqual([]);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("produces a self-contained overtime round card with unavailable metrics preserved", () => {
    const source = round(30, {
      freezeEndTick: 30_064,
      scoreA: 16,
      scoreB: 15,
      winner: "CT",
      frames: [{
        t: 1,
        players: [
          { id: P1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 100, team: 3, equipmentValue: 3_600 },
          { id: P2, x: 100, y: 0, z: 0, yaw: 180, hp: 100, armor: 100, team: 2, equipmentValue: 1_000 },
        ],
      }],
      events: [{ t: 10, tick: 30_640, sequence: 1, type: "round_end", winner: "CT" }],
      weaponFires: [],
    });
    delete source.damages;

    const result = analyzeMatch(match([source]), CONTEXT);
    const card = result.rounds[0];
    const one = card.players.find((roundPlayer) => roundPlayer.playerId === P1);

    expect(card).toMatchObject({
      roundNumber: 30,
      winner: "CT",
      scoreA: 16,
      scoreB: 15,
    });
    expect(one).toMatchObject({
      side: "CT",
      economyCategory: "full_buy",
      metrics: { roundsPlayed: 1, adr: null },
    });
    expect(one?.unavailableReasons).toContain("missing_damage_events");
    expect(card.economy.find((item) => item.side === "T")?.category).toBe("eco");
    expect(card.evidenceIds).toContain("r30-economy-ct");
    expect(card.evidenceIds).toContain("r30-round-end");
  });

  it("accepts legacy numeric player IDs without coercing V2 IDs to numbers", () => {
    const input = match([
      round(1, {
        frames: [{
          t: 0,
          players: [
            { id: 1, x: 0, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 2 },
            { id: 2, x: 1, y: 0, z: 0, yaw: 0, hp: 100, armor: 0, team: 3 },
          ],
        }],
        events: [{ t: 1, type: "kill", killer: 1, victim: 2, weapon: "ak47" }],
        damages: [{ t: 0.5, tick: 1_032, attacker: 1, victim: 2, damageHealth: 100, damageArmor: 0, healthAfter: 0, armorAfter: 0 }],
      }),
    ]);
    input.schemaVersion = undefined;
    input.players = [
      { steamId: 1, name: "Legacy One", team: "T" },
      { steamId: 2, name: "Legacy Two", team: "CT" },
    ];

    const result = analyzeMatch(input, CONTEXT);

    expect(result.inputSchemaVersion).toBe("roundlab.replay.legacy");
    expect(player(result, 1).metrics).toMatchObject({ kills: 1, damageHealth: 100, adr: 100 });
    expect(result.evidence.find((item) => item.type === "kill")?.tick).toBeNull();
  });

  it("is deterministic for identical input and context", () => {
    const input = match([round(1)]);
    expect(analyzeMatch(input, CONTEXT)).toEqual(analyzeMatch(input, CONTEXT));
  });

  it("refuses metadata-only rounds", () => {
    const unloaded = round(1, { frames: [] });
    expect(() => analyzeMatch(match([unloaded]), CONTEXT)).toThrow(
      "Cannot analyze round 1 without its frame payload.",
    );
  });
});
