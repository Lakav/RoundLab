import type {
  BenchmarkCorpus,
  BenchmarkDistribution,
  BenchmarkMetricId,
  BenchmarkPlayerSideSample,
} from "./benchmark-types";

export const BENCHMARK_METRICS: BenchmarkMetricId[] = [
  "kills_per_round",
  "deaths_per_round",
  "assists_per_round",
  "kd_ratio",
  "headshot_rate",
  "adr",
  "opening_win_rate",
  "survival_rate",
  "trade_kill_rate",
  "kast_rate",
  "grenades_per_round",
  "flash_assists_per_round",
];

function safeRatio(
  numerator: number | null,
  denominator: number,
): number | null {
  if (
    numerator === null ||
    denominator <= 0 ||
    !Number.isFinite(numerator)
  ) {
    return null;
  }
  return numerator / denominator;
}

export function benchmarkMetricValue(
  sample: BenchmarkPlayerSideSample,
  metric: BenchmarkMetricId,
): number | null {
  const values = sample.metrics;
  switch (metric) {
    case "kills_per_round":
      return safeRatio(values.kills, sample.roundsPlayed);
    case "deaths_per_round":
      return safeRatio(values.deaths, sample.roundsPlayed);
    case "assists_per_round":
      return safeRatio(values.assists, sample.roundsPlayed);
    case "kd_ratio":
      return values.kdRatio;
    case "headshot_rate":
      return values.headshotRate;
    case "adr":
      return values.adr;
    case "opening_win_rate":
      return safeRatio(values.openingWins, values.openingAttempts ?? 0);
    case "survival_rate":
      return values.survivalRate;
    case "trade_kill_rate":
      return safeRatio(values.tradeKills, values.tradeAttempts ?? 0);
    case "kast_rate":
      return values.kastRate;
    case "grenades_per_round":
      return safeRatio(values.grenadesThrown?.total ?? null, sample.roundsPlayed);
    case "flash_assists_per_round":
      return safeRatio(values.flashAssists, sample.roundsPlayed);
  }
}

function stableValue(value: number): number {
  return Number(value.toFixed(6));
}

export function buildBenchmarkDistributions(
  corpus: BenchmarkCorpus,
): BenchmarkDistribution[] {
  const samplesByStratum = new Map<string, BenchmarkPlayerSideSample[]>();
  for (const sample of corpus.samples) {
    const key = `${sample.map}\u0000${sample.level}\u0000${sample.side}`;
    const samples = samplesByStratum.get(key) ?? [];
    samples.push(sample);
    samplesByStratum.set(key, samples);
  }
  const distributions: BenchmarkDistribution[] = [];
  for (const samples of samplesByStratum.values()) {
    const first = samples[0];
    for (const metric of BENCHMARK_METRICS) {
      const values = samples
        .map((sample) => benchmarkMetricValue(sample, metric))
        .filter(
          (value): value is number =>
            value !== null && Number.isFinite(value),
        )
        .map(stableValue)
        .sort((left, right) => left - right);
      distributions.push({
        distributionId:
          `${first.map}:${first.level}:${first.side}:${metric}`,
        map: first.map,
        level: first.level,
        side: first.side,
        metric,
        values,
        sampleCount: values.length,
        excludedSampleCount: samples.length - values.length,
      });
    }
  }
  return distributions.sort(
    (left, right) =>
      left.map.localeCompare(right.map) ||
      left.level.localeCompare(right.level) ||
      left.side.localeCompare(right.side) ||
      left.metric.localeCompare(right.metric),
  );
}
