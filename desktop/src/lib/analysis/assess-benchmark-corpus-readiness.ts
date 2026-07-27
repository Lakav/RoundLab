import type {
  BenchmarkCorpus,
  BenchmarkCorpusReadiness,
  BenchmarkReadinessPolicy,
  BenchmarkStratumReadiness,
} from "./benchmark-types.ts";

export const BENCHMARK_READINESS_DEFAULTS = {
  minimumMatchCount: 20,
  minimumPlayerCount: 50,
  minimumPlayerSampleCount: 100,
  minimumPlayerRounds: 1_000,
  minimumRoundOutcomeCount: 30,
} as const;

function requiredLabels(values: string[], field: "maps" | "levels"): string[] {
  const labels = [...new Set(values.map((value) => value.trim()))].sort();
  if (labels.length === 0 || labels.some((value) => value.length === 0)) {
    throw new Error(`Benchmark readiness ${field} must contain non-empty labels.`);
  }
  return labels;
}

function requiredPositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Benchmark readiness ${field} must be a positive integer.`);
  }
  return value;
}

export function benchmarkReadinessPolicy(
  maps: string[],
  levels: string[],
  thresholds: Partial<Pick<
    BenchmarkReadinessPolicy,
    | "minimumMatchCount"
    | "minimumPlayerCount"
    | "minimumPlayerSampleCount"
    | "minimumPlayerRounds"
    | "minimumRoundOutcomeCount"
  >> = {},
): BenchmarkReadinessPolicy {
  const merged = {
    ...BENCHMARK_READINESS_DEFAULTS,
    ...Object.fromEntries(
      Object.entries(thresholds).filter(([, value]) => value !== undefined),
    ),
  };
  return {
    maps: requiredLabels(maps, "maps"),
    levels: requiredLabels(levels, "levels"),
    minimumMatchCount: requiredPositiveInteger(
      merged.minimumMatchCount,
      "minimumMatchCount",
    ),
    minimumPlayerCount: requiredPositiveInteger(
      merged.minimumPlayerCount,
      "minimumPlayerCount",
    ),
    minimumPlayerSampleCount: requiredPositiveInteger(
      merged.minimumPlayerSampleCount,
      "minimumPlayerSampleCount",
    ),
    minimumPlayerRounds: requiredPositiveInteger(
      merged.minimumPlayerRounds,
      "minimumPlayerRounds",
    ),
    minimumRoundOutcomeCount: requiredPositiveInteger(
      merged.minimumRoundOutcomeCount,
      "minimumRoundOutcomeCount",
    ),
  };
}

function stratumKey(map: string, level: string, side: "T" | "CT"): string {
  return `${map}\u0000${level}\u0000${side}`;
}

export function assessBenchmarkCorpusReadiness(
  corpus: BenchmarkCorpus,
  policy: BenchmarkReadinessPolicy,
): BenchmarkCorpusReadiness {
  const coverageByStratum = new Map(
    corpus.audit.strata.map((stratum) => [
      stratumKey(stratum.map, stratum.level, stratum.side),
      stratum,
    ]),
  );
  const roundOutcomeCounts = new Map<string, number>();
  const incompatibleAnalysisCounts = new Map<string, number>();
  const compatibleAnalysis = (sample: {
    metricsSpecVersion: string;
    inputSchemaVersion: string;
    parserVersion: string;
  }): boolean =>
    sample.metricsSpecVersion === "roundlab.metrics.v1"
    && sample.inputSchemaVersion === "roundlab.replay.v2"
    && sample.parserVersion.trim().length > 0
    && sample.parserVersion !== "unknown";
  for (const sample of corpus.samples) {
    if (compatibleAnalysis(sample)) continue;
    const key = stratumKey(sample.map, sample.level, sample.side);
    incompatibleAnalysisCounts.set(
      key,
      (incompatibleAnalysisCounts.get(key) ?? 0) + 1,
    );
  }
  for (const sample of corpus.roundOutcomeSamples) {
    const key = stratumKey(sample.map, sample.level, sample.side);
    roundOutcomeCounts.set(key, (roundOutcomeCounts.get(key) ?? 0) + 1);
    if (!compatibleAnalysis(sample)) {
      incompatibleAnalysisCounts.set(
        key,
        (incompatibleAnalysisCounts.get(key) ?? 0) + 1,
      );
    }
  }

  const strata: BenchmarkStratumReadiness[] = [];
  for (const map of policy.maps) {
    for (const level of policy.levels) {
      for (const side of ["CT", "T"] as const) {
        const key = stratumKey(map, level, side);
        const coverage = coverageByStratum.get(key);
        const stratum = {
          map,
          level,
          side,
          matchCount: coverage?.matchCount ?? 0,
          playerCount: coverage?.playerCount ?? 0,
          sampleCount: coverage?.sampleCount ?? 0,
          playerRounds: coverage?.playerRounds ?? 0,
          roundOutcomeCount: roundOutcomeCounts.get(key) ?? 0,
          incompatibleAnalysisSampleCount:
            incompatibleAnalysisCounts.get(key) ?? 0,
        };
        const unavailableReasons: BenchmarkStratumReadiness["unavailableReasons"] = [];
        if (!coverage) unavailableReasons.push("missing_stratum");
        if (stratum.matchCount < policy.minimumMatchCount) {
          unavailableReasons.push("insufficient_matches");
        }
        if (stratum.playerCount < policy.minimumPlayerCount) {
          unavailableReasons.push("insufficient_players");
        }
        if (stratum.sampleCount < policy.minimumPlayerSampleCount) {
          unavailableReasons.push("insufficient_player_samples");
        }
        if (stratum.playerRounds < policy.minimumPlayerRounds) {
          unavailableReasons.push("insufficient_player_rounds");
        }
        if (stratum.roundOutcomeCount < policy.minimumRoundOutcomeCount) {
          unavailableReasons.push("insufficient_round_outcomes");
        }
        if (stratum.incompatibleAnalysisSampleCount > 0) {
          unavailableReasons.push("incompatible_analysis_versions");
        }
        strata.push({
          ...stratum,
          ready: unavailableReasons.length === 0,
          unavailableReasons,
        });
      }
    }
  }

  const readyStratumCount = strata.filter((stratum) => stratum.ready).length;
  const unavailableReasons = [...corpus.audit.unavailableReasons];
  if ([...incompatibleAnalysisCounts.values()].some((count) => count > 0)) {
    unavailableReasons.push("incompatible_analysis_versions");
  }
  if (readyStratumCount < strata.length) {
    unavailableReasons.push("incomplete_required_strata");
  }
  return {
    readinessVersion: "roundlab.benchmark-readiness.v1",
    ready: unavailableReasons.length === 0,
    policy,
    requiredStratumCount: strata.length,
    readyStratumCount,
    strata,
    unavailableReasons,
  };
}
