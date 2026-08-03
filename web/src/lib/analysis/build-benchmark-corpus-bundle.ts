import {
  assessBenchmarkCorpusReadiness,
  benchmarkReadinessPolicy,
} from "./assess-benchmark-corpus-readiness.ts";
import { buildBenchmarkCorpus } from "./build-benchmark-corpus.ts";
import type {
  BenchmarkCollectionManifest,
  BenchmarkCollectionManifestEntry,
  BenchmarkCorpusBundle,
} from "./benchmark-types.ts";
import type { MatchAnalysis } from "./types.ts";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function label(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function timestamp(value: unknown, field: string): string {
  const normalized = label(value, field);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a valid timestamp.`);
  }
  return new Date(parsed).toISOString();
}

function positiveInteger(
  value: unknown,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value as number;
}

function labels(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${field} must be an array.`);
  }
  const result = [...new Set(value.map((item) => label(item, field)))].sort();
  if (result.length === 0) throw new Error(`${field} must not be empty.`);
  return result;
}

function entry(value: unknown, index: number): BenchmarkCollectionManifestEntry {
  const source = record(value);
  if (!source) throw new Error(`entries[${index}] must be an object.`);
  const analysisPath = label(
    source.analysisPath,
    `entries[${index}].analysisPath`,
  );
  if (
    analysisPath.startsWith("/")
    || analysisPath.split(/[\\/]/u).includes("..")
  ) {
    throw new Error(
      `entries[${index}].analysisPath must stay inside the manifest directory.`,
    );
  }
  const provenance = record(source.provenance);
  if (!provenance) {
    throw new Error(`entries[${index}].provenance must be an object.`);
  }
  const sourceType = label(
    provenance.sourceType,
    `entries[${index}].provenance.sourceType`,
  );
  if (
    sourceType !== "player_upload"
    && sourceType !== "licensed_dataset"
    && sourceType !== "organization"
  ) {
    throw new Error(`entries[${index}].provenance.sourceType is invalid.`);
  }
  const authorizationBasis = label(
    provenance.authorizationBasis,
    `entries[${index}].provenance.authorizationBasis`,
  );
  if (
    authorizationBasis !== "player_consent"
    && authorizationBasis !== "dataset_license"
    && authorizationBasis !== "organization_agreement"
  ) {
    throw new Error(
      `entries[${index}].provenance.authorizationBasis is invalid.`,
    );
  }
  return {
    analysisPath,
    map: label(source.map, `entries[${index}].map`),
    level: label(source.level, `entries[${index}].level`),
    playedAt: timestamp(source.playedAt, `entries[${index}].playedAt`),
    provenance: {
      sourceType,
      sourceReference: label(
        provenance.sourceReference,
        `entries[${index}].provenance.sourceReference`,
      ),
      authorizationBasis,
      collectedAt: timestamp(
        provenance.collectedAt,
        `entries[${index}].provenance.collectedAt`,
      ),
    },
  };
}

export function parseBenchmarkCollectionManifest(
  value: unknown,
): BenchmarkCollectionManifest {
  const source = record(value);
  if (!source) throw new Error("Benchmark collection manifest must be an object.");
  if (
    source.manifestVersion
    !== "roundlab.benchmark-collection-manifest.v1"
  ) {
    throw new Error("Unsupported benchmark collection manifest version.");
  }
  const policy = record(source.policy);
  if (!policy) throw new Error("policy must be an object.");
  if (!Array.isArray(source.entries)) {
    throw new Error("entries must be an array.");
  }
  const entries = source.entries.map(entry);
  const paths = new Set<string>();
  for (const item of entries) {
    if (paths.has(item.analysisPath)) {
      throw new Error(`Duplicate analysisPath: ${item.analysisPath}`);
    }
    paths.add(item.analysisPath);
  }
  return {
    manifestVersion: source.manifestVersion,
    corpusGeneratedAt: timestamp(
      source.corpusGeneratedAt,
      "corpusGeneratedAt",
    ),
    policy: {
      maps: labels(policy.maps, "policy.maps"),
      levels: labels(policy.levels, "policy.levels"),
      minimumMatchCount: positiveInteger(
        policy.minimumMatchCount,
        "policy.minimumMatchCount",
      ),
      minimumPlayerCount: positiveInteger(
        policy.minimumPlayerCount,
        "policy.minimumPlayerCount",
      ),
      minimumPlayerSampleCount: positiveInteger(
        policy.minimumPlayerSampleCount,
        "policy.minimumPlayerSampleCount",
      ),
      minimumPlayerRounds: positiveInteger(
        policy.minimumPlayerRounds,
        "policy.minimumPlayerRounds",
      ),
      minimumRoundOutcomeCount: positiveInteger(
        policy.minimumRoundOutcomeCount,
        "policy.minimumRoundOutcomeCount",
      ),
    },
    entries,
  };
}

export function validMatchAnalysisPayload(
  value: unknown,
): value is MatchAnalysis {
  const source = record(value);
  return source?.specVersion === "roundlab.metrics.v1"
    && typeof source.matchId === "string"
    && source.matchId.trim().length > 0
    && typeof source.inputSchemaVersion === "string"
    && typeof source.parserVersion === "string"
    && Array.isArray(source.players)
    && Array.isArray(source.rounds);
}

export function buildBenchmarkCorpusBundle(
  manifest: BenchmarkCollectionManifest,
  analyses: ReadonlyMap<string, MatchAnalysis>,
): BenchmarkCorpusBundle {
  const inputs = manifest.entries.map((item) => {
    const analysis = analyses.get(item.analysisPath);
    if (!analysis) {
      throw new Error(`Missing analysis payload: ${item.analysisPath}`);
    }
    if (!validMatchAnalysisPayload(analysis)) {
      throw new Error(`Invalid analysis payload: ${item.analysisPath}`);
    }
    return {
      analysis,
      map: item.map,
      level: item.level,
      playedAt: item.playedAt,
    };
  });
  const corpus = buildBenchmarkCorpus(inputs, manifest.corpusGeneratedAt);
  const policy = benchmarkReadinessPolicy(
    manifest.policy.maps,
    manifest.policy.levels,
    {
      minimumMatchCount: manifest.policy.minimumMatchCount,
      minimumPlayerCount: manifest.policy.minimumPlayerCount,
      minimumPlayerSampleCount: manifest.policy.minimumPlayerSampleCount,
      minimumPlayerRounds: manifest.policy.minimumPlayerRounds,
      minimumRoundOutcomeCount: manifest.policy.minimumRoundOutcomeCount,
    },
  );
  return {
    bundleVersion: "roundlab.benchmark-corpus-bundle.v1",
    corpus,
    readiness: assessBenchmarkCorpusReadiness(corpus, policy),
    provenance: manifest.entries.map((item) => ({
      matchId: analyses.get(item.analysisPath)!.matchId,
      analysisPath: item.analysisPath,
      provenance: item.provenance,
    })),
  };
}
