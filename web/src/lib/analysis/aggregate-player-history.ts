import type {
  BenchmarkMetricId,
  BenchmarkPlayerSideSample,
  PlayerHistory,
  PlayerHistoryGroup,
  PlayerHistoryMetrics,
} from "./benchmark-types";

export const PLAYER_HISTORY_VERSION = "roundlab.player-history.v1" as const;

function stableValue(value: number): number {
  return Number(value.toFixed(6));
}

function sumOrNull(
  samples: BenchmarkPlayerSideSample[],
  value: (sample: BenchmarkPlayerSideSample) => number | null,
): number | null {
  let total = 0;
  for (const sample of samples) {
    const current = value(sample);
    if (current === null || !Number.isFinite(current)) return null;
    total += current;
  }
  return total;
}

function ratio(numerator: number | null, denominator: number): number | null {
  return numerator === null || denominator <= 0
    ? null
    : stableValue(numerator / denominator);
}

function aggregateMetrics(
  samples: BenchmarkPlayerSideSample[],
): PlayerHistoryMetrics {
  const roundsPlayed = samples.reduce(
    (total, sample) => total + sample.roundsPlayed,
    0,
  );
  const kills = sumOrNull(samples, (sample) => sample.metrics.kills);
  const deaths = sumOrNull(samples, (sample) => sample.metrics.deaths);
  const assists = sumOrNull(samples, (sample) => sample.metrics.assists);
  const damage = sumOrNull(samples, (sample) => sample.metrics.damageHealth);
  const headshotKills = sumOrNull(
    samples,
    (sample) => sample.metrics.headshotKills,
  );
  const openingWins = sumOrNull(
    samples,
    (sample) => sample.metrics.openingWins,
  );
  const openingAttempts = sumOrNull(
    samples,
    (sample) => sample.metrics.openingAttempts,
  );
  const survivedRounds = sumOrNull(
    samples,
    (sample) => sample.metrics.survivedRounds,
  );
  const tradeKills = sumOrNull(
    samples,
    (sample) => sample.metrics.tradeKills,
  );
  const tradeAttempts = sumOrNull(
    samples,
    (sample) => sample.metrics.tradeAttempts,
  );
  const kastRounds = sumOrNull(
    samples,
    (sample) => sample.metrics.kastRounds,
  );
  const grenades = sumOrNull(
    samples,
    (sample) => sample.metrics.grenadesThrown?.total ?? null,
  );
  const flashAssists = sumOrNull(
    samples,
    (sample) => sample.metrics.flashAssists,
  );
  const values: Record<BenchmarkMetricId, number | null> = {
    kills_per_round: ratio(kills, roundsPlayed),
    deaths_per_round: ratio(deaths, roundsPlayed),
    assists_per_round: ratio(assists, roundsPlayed),
    kd_ratio: ratio(kills, deaths ?? 0),
    headshot_rate: ratio(headshotKills, kills ?? 0),
    adr: ratio(damage, roundsPlayed),
    opening_win_rate: ratio(openingWins, openingAttempts ?? 0),
    survival_rate: ratio(survivedRounds, roundsPlayed),
    trade_kill_rate: ratio(tradeKills, tradeAttempts ?? 0),
    kast_rate: ratio(kastRounds, roundsPlayed),
    grenades_per_round: ratio(grenades, roundsPlayed),
    flash_assists_per_round: ratio(flashAssists, roundsPlayed),
  };
  return { roundsPlayed, values };
}

function aggregateGroup(
  groupId: string,
  samples: BenchmarkPlayerSideSample[],
): PlayerHistoryGroup {
  return {
    groupId,
    sampleCount: samples.length,
    matchCount: new Set(samples.map((sample) => sample.matchId)).size,
    metrics: aggregateMetrics(samples),
  };
}

export function aggregatePlayerHistory(
  playerId: string,
  corpusSamples: BenchmarkPlayerSideSample[],
): PlayerHistory {
  const samples = corpusSamples
    .filter((sample) => sample.playerId === playerId)
    .sort(
      (left, right) =>
        Date.parse(left.playedAt) - Date.parse(right.playedAt) ||
        left.matchId.localeCompare(right.matchId) ||
        left.side.localeCompare(right.side),
    );
  const byMap = new Map<string, BenchmarkPlayerSideSample[]>();
  const bySide = new Map<"T" | "CT", BenchmarkPlayerSideSample[]>();
  for (const sample of samples) {
    const mapSamples = byMap.get(sample.map) ?? [];
    mapSamples.push(sample);
    byMap.set(sample.map, mapSamples);
    const sideSamples = bySide.get(sample.side) ?? [];
    sideSamples.push(sample);
    bySide.set(sample.side, sideSamples);
  }
  return {
    historyVersion: PLAYER_HISTORY_VERSION,
    playerId,
    sampleCount: samples.length,
    matchCount: new Set(samples.map((sample) => sample.matchId)).size,
    firstPlayedAt: samples[0]?.playedAt ?? null,
    lastPlayedAt: samples.at(-1)?.playedAt ?? null,
    samples,
    overall: aggregateGroup("overall", samples),
    byMap: [...byMap.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([map, group]) => aggregateGroup(`map:${map}`, group)),
    bySide: [...bySide.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([side, group]) => aggregateGroup(`side:${side}`, group)),
    unavailableReasons:
      samples.length === 0 ? ["player_not_found_in_corpus"] : [],
  };
}
