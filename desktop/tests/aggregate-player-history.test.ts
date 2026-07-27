import { describe, expect, it } from "vitest";
import { aggregatePlayerHistory } from "@/lib/analysis/aggregate-player-history";
import type { BenchmarkPlayerSideSample } from "@/lib/analysis/benchmark-types";
import type { PlayerAnalysisMetrics } from "@/lib/analysis/types";

function sample(
  matchId: string,
  playedAt: string,
  roundsPlayed: number,
  metrics: Partial<PlayerAnalysisMetrics>,
  map = "de_test",
  side: "T" | "CT" = "T",
  playerId = "p1",
): BenchmarkPlayerSideSample {
  return {
    sampleId: `${matchId}:${playerId}:${side}`,
    matchId,
    playerId,
    map,
    level: "level-1",
    side,
    playedAt,
    metricsSpecVersion: "roundlab.metrics.v1",
    inputSchemaVersion: "roundlab.replay.v2",
    parserVersion: "test",
    roundsPlayed,
    metrics: {
      roundsPlayed,
      kills: 0,
      deaths: 0,
      assists: 0,
      kdRatio: null,
      headshotKills: 0,
      headshotRate: null,
      damageHealth: 0,
      adr: 0,
      openingAttempts: 0,
      openingWins: 0,
      openingLosses: 0,
      multiKillRounds: null,
      survivedRounds: 0,
      survivalRate: 0,
      clutchOpportunities: null,
      clutchWins: null,
      tradeAttempts: 0,
      tradeKills: 0,
      tradeDeaths: 0,
      kastRounds: 0,
      kastRate: 0,
      grenadesThrown: {
        total: 0,
        flash: 0,
        smoke: 0,
        he: 0,
        molotov: 0,
        incendiary: 0,
        decoy: 0,
      },
      flashAssists: 0,
      utilitySavedOnDeath: null,
      ...metrics,
    },
  };
}

describe("player history aggregation", () => {
  it("recalculates ratios from totals instead of averaging match ratios", () => {
    const history = aggregatePlayerHistory("p1", [
      sample("m2", "2026-07-20T10:00:00.000Z", 20, {
        kills: 40,
        deaths: 10,
        assists: 4,
        headshotKills: 10,
        damageHealth: 1_000,
        openingAttempts: 10,
        openingWins: 9,
        survivedRounds: 10,
        tradeAttempts: 8,
        tradeKills: 4,
        kastRounds: 16,
        grenadesThrown: {
          total: 20,
          flash: 0,
          smoke: 0,
          he: 0,
          molotov: 0,
          incendiary: 0,
          decoy: 0,
        },
        flashAssists: 4,
      }, "de_b", "CT"),
      sample("m1", "2026-07-10T10:00:00.000Z", 10, {
        kills: 10,
        deaths: 10,
        assists: 2,
        headshotKills: 5,
        damageHealth: 1_000,
        openingAttempts: 2,
        openingWins: 1,
        survivedRounds: 5,
        tradeAttempts: 2,
        tradeKills: 1,
        kastRounds: 7,
        grenadesThrown: {
          total: 10,
          flash: 0,
          smoke: 0,
          he: 0,
          molotov: 0,
          incendiary: 0,
          decoy: 0,
        },
        flashAssists: 1,
      }),
    ]);

    expect(history).toMatchObject({
      historyVersion: "roundlab.player-history.v1",
      playerId: "p1",
      sampleCount: 2,
      matchCount: 2,
      firstPlayedAt: "2026-07-10T10:00:00.000Z",
      lastPlayedAt: "2026-07-20T10:00:00.000Z",
      unavailableReasons: [],
    });
    expect(history.samples.map((item) => item.matchId)).toEqual(["m1", "m2"]);
    expect(history.overall.metrics).toEqual({
      roundsPlayed: 30,
      values: {
        kills_per_round: 1.666667,
        deaths_per_round: 0.666667,
        assists_per_round: 0.2,
        kd_ratio: 2.5,
        headshot_rate: 0.3,
        adr: 66.666667,
        opening_win_rate: 0.833333,
        survival_rate: 0.5,
        trade_kill_rate: 0.5,
        kast_rate: 0.766667,
        grenades_per_round: 1,
        flash_assists_per_round: 0.166667,
      },
    });
    expect(history.byMap.map((group) => group.groupId)).toEqual([
      "map:de_b",
      "map:de_test",
    ]);
    expect(history.bySide.map((group) => group.groupId)).toEqual([
      "side:CT",
      "side:T",
    ]);
  });

  it("keeps dependent aggregates unavailable when a source total is missing", () => {
    const first = sample("m1", "2026-07-10T10:00:00.000Z", 10, {
      kills: null,
      headshotKills: null,
      damageHealth: 800,
    });
    const second = sample("m2", "2026-07-20T10:00:00.000Z", 10, {
      kills: 10,
      headshotKills: 5,
      damageHealth: 1_000,
    });
    const values = aggregatePlayerHistory("p1", [first, second])
      .overall.metrics.values;

    expect(values.kills_per_round).toBeNull();
    expect(values.kd_ratio).toBeNull();
    expect(values.headshot_rate).toBeNull();
    expect(values.adr).toBe(90);
  });

  it("reports a player absent from the corpus", () => {
    const history = aggregatePlayerHistory("missing", [
      sample("m1", "2026-07-10T10:00:00.000Z", 10, {}),
    ]);

    expect(history).toMatchObject({
      sampleCount: 0,
      matchCount: 0,
      firstPlayedAt: null,
      lastPlayedAt: null,
      unavailableReasons: ["player_not_found_in_corpus"],
    });
  });
});
