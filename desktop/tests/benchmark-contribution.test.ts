import { describe, expect, it } from "vitest";
import {
  buildBenchmarkContributionPackage,
  faceitBenchmarkLevel,
  premierBenchmarkLevel,
} from "@/lib/analysis/benchmark-contribution";
import {
  buildBenchmarkCorpusBundle,
  parseBenchmarkCollectionManifest,
} from "@/lib/analysis/build-benchmark-corpus-bundle";
import { parseBenchmarkContributionPackage } from "@/lib/analysis/parse-benchmark-contribution";
import type { MatchData } from "@/lib/types";
import { replayMatch, replayRound } from "./fixtures";

function modernMatch(): MatchData {
  const selected = "76561198000000001";
  const other = "76561198000000002";
  const round = replayRound(1);
  round.frames[0].players = [
    {
      id: selected,
      x: 10,
      y: 20,
      z: 30,
      yaw: 90,
      hp: 100,
      armor: 100,
      team: 2,
    },
    {
      id: other,
      x: 40,
      y: 50,
      z: 60,
      yaw: 180,
      hp: 100,
      armor: 100,
      team: 3,
    },
  ];
  return {
    ...replayMatch([round]),
    schemaVersion: "roundlab.replay.v2",
    parserVersion: "roundlab-parser-1.0.0",
    players: [
      { steamId: selected, name: "Selected Player", team: "T" },
      { steamId: other, name: "Other Player", team: "CT" },
    ],
  };
}

describe("benchmark contribution package", () => {
  it("normalizes supported self-reported level systems", () => {
    expect(faceitBenchmarkLevel(10)).toBe("faceit-level-10");
    expect(premierBenchmarkLevel(18_450)).toBe("premier-15000-19999");
    expect(premierBenchmarkLevel(50_000)).toBe("premier-45000-49999");
    expect(() => faceitBenchmarkLevel(11)).toThrow("from 1 to 10");
    expect(() => premierBenchmarkLevel(-1)).toThrow("from 0 to 50000");
  });

  it("exports only the consenting player under a random contributor id", () => {
    const contribution = buildBenchmarkContributionPackage(
      modernMatch(),
      {
        selectedPlayerId: "76561198000000001",
        contributorId: "contributor-random-id",
        level: faceitBenchmarkLevel(10),
        levelSource: "self_reported_faceit",
        playedAt: "2026-07-26T20:00:00+02:00",
        consentedAt: "2026-07-27T12:00:00Z",
      },
      "contribution-random-id",
      "2026-07-27T12:01:00Z",
    );

    expect(contribution).toMatchObject({
      contributionVersion: "roundlab.benchmark-contribution.v1",
      entry: {
        analysisPath: "analyses/contribution-random-id.json",
        map: "de_nuke",
        level: "faceit-level-10",
        playedAt: "2026-07-26T18:00:00.000Z",
        provenance: {
          sourceType: "player_upload",
          sourceReference: "contribution-random-id",
          authorizationBasis: "player_consent",
        },
      },
      privacy: {
        scope: "consenting_player_only",
        identity: "random_contributor_id",
        otherPlayersRemoved: true,
        steamIdsRemoved: true,
      },
      levelSource: "self_reported_faceit",
    });
    expect(contribution.analysis.players).toHaveLength(1);
    expect(contribution.analysis.players[0]).toMatchObject({
      playerId: "contributor-random-id",
      name: "Contributor",
    });
    expect(contribution.analysis.rounds[0]).toMatchObject({
      winner: "T",
      players: [],
      keyMoments: [],
      evidenceIds: [],
    });
    const exported = JSON.stringify(contribution);
    expect(exported).not.toContain("76561198000000001");
    expect(exported).not.toContain("76561198000000002");
    expect(exported).not.toContain("Selected Player");
    expect(exported).not.toContain("Other Player");
  });

  it("feeds the existing corpus builder without exposing other players", () => {
    const contribution = buildBenchmarkContributionPackage(
      modernMatch(),
      {
        selectedPlayerId: "76561198000000001",
        contributorId: "contributor-random-id",
        level: "faceit-level-10",
        levelSource: "self_reported_faceit",
        playedAt: "2026-07-26T18:00:00Z",
        consentedAt: "2026-07-27T12:00:00Z",
      },
      "contribution-random-id",
      "2026-07-27T12:01:00Z",
    );
    const manifest = parseBenchmarkCollectionManifest({
      manifestVersion: "roundlab.benchmark-collection-manifest.v1",
      corpusGeneratedAt: "2026-07-27T12:02:00Z",
      policy: {
        maps: ["de_nuke"],
        levels: ["faceit-level-10"],
      },
      entries: [contribution.entry],
    });
    const bundle = buildBenchmarkCorpusBundle(
      manifest,
      new Map([[contribution.entry.analysisPath, contribution.analysis]]),
    );

    expect(bundle.corpus.audit.playerCount).toBe(1);
    expect(bundle.corpus.samples.every(
      (sample) => sample.playerId === "contributor-random-id",
    )).toBe(true);
    expect(bundle.provenance[0].provenance.authorizationBasis)
      .toBe("player_consent");
  });

  it("rejects legacy matches and unknown selected players", () => {
    expect(() => buildBenchmarkContributionPackage(
      replayMatch(),
      {
        selectedPlayerId: "1",
        contributorId: "contributor",
        level: "faceit-level-5",
        levelSource: "self_reported_faceit",
        playedAt: "2026-07-26T18:00:00Z",
        consentedAt: "2026-07-27T12:00:00Z",
      },
      "contribution",
      "2026-07-27T12:01:00Z",
    )).toThrow("require a modern replay");
    expect(() => buildBenchmarkContributionPackage(
      modernMatch(),
      {
        selectedPlayerId: "missing",
        contributorId: "contributor",
        level: "faceit-level-5",
        levelSource: "self_reported_faceit",
        playedAt: "2026-07-26T18:00:00Z",
        consentedAt: "2026-07-27T12:00:00Z",
      },
      "contribution",
      "2026-07-27T12:01:00Z",
    )).toThrow("not present");
  });

  it("rejects collected packages that reintroduce identities or break ids", () => {
    const contribution = buildBenchmarkContributionPackage(
      modernMatch(),
      {
        selectedPlayerId: "76561198000000001",
        contributorId: "contributor-random-id",
        level: "faceit-level-10",
        levelSource: "self_reported_faceit",
        playedAt: "2026-07-26T18:00:00Z",
        consentedAt: "2026-07-27T12:00:00Z",
      },
      "contribution-random-id",
      "2026-07-27T12:01:00Z",
    );
    expect(parseBenchmarkContributionPackage(contribution)).toEqual(
      contribution,
    );

    const leaked = structuredClone(contribution);
    leaked.analysis.players[0].name = "76561198000000001";
    expect(() => parseBenchmarkContributionPackage(leaked))
      .toThrow("non-consenting player data");

    const mismatched = structuredClone(contribution);
    mismatched.entry.provenance.sourceReference = "other";
    expect(() => parseBenchmarkContributionPackage(mismatched))
      .toThrow("identifiers do not match");
  });
});
