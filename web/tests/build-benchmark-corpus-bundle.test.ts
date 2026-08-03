import { describe, expect, it } from "vitest";
import {
  buildBenchmarkCorpusBundle,
  parseBenchmarkCollectionManifest,
  validMatchAnalysisPayload,
} from "@/lib/analysis/build-benchmark-corpus-bundle";
import type { MatchAnalysis } from "@/lib/analysis/types";

function manifest(overrides: Record<string, unknown> = {}): unknown {
  return {
    manifestVersion: "roundlab.benchmark-collection-manifest.v1",
    corpusGeneratedAt: "2026-07-27T12:00:00+02:00",
    policy: {
      maps: ["de_inferno"],
      levels: ["level-10"],
    },
    entries: [{
      analysisPath: "analyses/match-1.json",
      map: "de_inferno",
      level: "level-10",
      playedAt: "2026-07-26T21:00:00+02:00",
      provenance: {
        sourceType: "player_upload",
        sourceReference: "upload-1",
        authorizationBasis: "player_consent",
        collectedAt: "2026-07-27T10:00:00Z",
      },
    }],
    ...overrides,
  };
}

function analysis(matchId = "match-1"): MatchAnalysis {
  return {
    specVersion: "roundlab.metrics.v1",
    inputSchemaVersion: "roundlab.replay.v2",
    parserVersion: "test",
    matchId,
    generatedAt: "2026-07-27T10:00:00.000Z",
    players: [],
    teams: [],
    rounds: [],
    economyRounds: [],
    keyMoments: [],
    evidence: [],
  };
}

describe("benchmark corpus collection bundle", () => {
  it("normalizes a versioned manifest and keeps auditable provenance", () => {
    const parsed = parseBenchmarkCollectionManifest(manifest());
    const bundle = buildBenchmarkCorpusBundle(
      parsed,
      new Map([["analyses/match-1.json", analysis()]]),
    );

    expect(parsed.corpusGeneratedAt).toBe("2026-07-27T10:00:00.000Z");
    expect(parsed.entries[0].playedAt).toBe("2026-07-26T19:00:00.000Z");
    expect(bundle).toMatchObject({
      bundleVersion: "roundlab.benchmark-corpus-bundle.v1",
      corpus: {
        audit: {
          matchCount: 1,
          sampleCount: 0,
          unavailableReasons: ["missing_player_side_samples"],
        },
      },
      readiness: {
        ready: false,
        requiredStratumCount: 2,
        readyStratumCount: 0,
      },
      provenance: [{
        matchId: "match-1",
        analysisPath: "analyses/match-1.json",
        provenance: {
          sourceReference: "upload-1",
          authorizationBasis: "player_consent",
        },
      }],
    });
  });

  it("rejects duplicate and escaping analysis paths", () => {
    const duplicated = manifest();
    (duplicated as { entries: unknown[] }).entries.push(
      (duplicated as { entries: unknown[] }).entries[0],
    );
    expect(() => parseBenchmarkCollectionManifest(duplicated))
      .toThrow("Duplicate analysisPath");

    const escaping = manifest();
    (
      (escaping as { entries: Array<{ analysisPath: string }> }).entries[0]
    ).analysisPath = "../private.json";
    expect(() => parseBenchmarkCollectionManifest(escaping))
      .toThrow("must stay inside the manifest directory");
  });

  it("requires explicit provenance and authorization", () => {
    const source = manifest();
    delete (
      source as {
        entries: Array<{ provenance?: unknown }>;
      }
    ).entries[0].provenance;
    expect(() => parseBenchmarkCollectionManifest(source))
      .toThrow("provenance must be an object");

    const invalidAuthorization = manifest() as {
      entries: Array<{
        provenance: { authorizationBasis: string };
      }>;
    };
    invalidAuthorization.entries[0].provenance.authorizationBasis = "unknown";
    expect(() => parseBenchmarkCollectionManifest(invalidAuthorization))
      .toThrow("authorizationBasis is invalid");
  });

  it("reports a missing or invalid analysis payload", () => {
    const parsed = parseBenchmarkCollectionManifest(manifest());
    expect(() => buildBenchmarkCorpusBundle(parsed, new Map()))
      .toThrow("Missing analysis payload");
    expect(validMatchAnalysisPayload({ specVersion: "other" })).toBe(false);
  });

  it("rejects duplicate match identifiers across different files", () => {
    const source = manifest() as {
      entries: Array<Record<string, unknown>>;
    };
    source.entries.push({
      ...source.entries[0],
      analysisPath: "analyses/match-2.json",
    });
    const parsed = parseBenchmarkCollectionManifest(source);

    expect(() => buildBenchmarkCorpusBundle(
      parsed,
      new Map([
        ["analyses/match-1.json", analysis("same")],
        ["analyses/match-2.json", analysis("same")],
      ]),
    )).toThrow("Duplicate benchmark matchId");
  });
});
