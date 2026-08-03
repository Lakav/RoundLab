import type {
  BenchmarkContributionPackage,
} from "./benchmark-contribution.ts";
import {
  parseBenchmarkCollectionManifest,
  validMatchAnalysisPayload,
} from "./build-benchmark-corpus-bundle.ts";

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseBenchmarkContributionPackage(
  value: unknown,
): BenchmarkContributionPackage {
  const source = record(value);
  if (
    !source
    || source.contributionVersion !== "roundlab.benchmark-contribution.v1"
  ) {
    throw new Error("Unsupported benchmark contribution version.");
  }
  const manifest = parseBenchmarkCollectionManifest({
    manifestVersion: "roundlab.benchmark-collection-manifest.v1",
    corpusGeneratedAt: "2000-01-01T00:00:00.000Z",
    policy: { maps: ["validation"], levels: ["validation"] },
    entries: [source.entry],
  });
  const entry = manifest.entries[0];
  if (!validMatchAnalysisPayload(source.analysis)) {
    throw new Error("Benchmark contribution analysis is invalid.");
  }
  const privacy = record(source.privacy);
  if (
    !privacy
    || privacy.scope !== "consenting_player_only"
    || privacy.identity !== "random_contributor_id"
    || privacy.otherPlayersRemoved !== true
    || privacy.steamIdsRemoved !== true
  ) {
    throw new Error("Benchmark contribution privacy declaration is invalid.");
  }
  if (
    source.levelSource !== "self_reported_faceit"
    && source.levelSource !== "self_reported_premier"
  ) {
    throw new Error("Benchmark contribution level source is invalid.");
  }
  if (
    (source.levelSource === "self_reported_faceit"
      && !entry.level.startsWith("faceit-level-"))
    || (source.levelSource === "self_reported_premier"
      && !entry.level.startsWith("premier-"))
  ) {
    throw new Error("Benchmark contribution level does not match its source.");
  }
  const analysis = source.analysis;
  if (
    analysis.matchId !== entry.provenance.sourceReference
    || entry.analysisPath !== `analyses/${analysis.matchId}.json`
  ) {
    throw new Error("Benchmark contribution identifiers do not match.");
  }
  if (
    analysis.players.length !== 1
    || analysis.players[0].name !== "Contributor"
    || !analysis.players[0].playerId.startsWith("contributor-")
    || analysis.teams.length !== 0
    || analysis.evidence.length !== 0
    || analysis.keyMoments.length !== 0
    || analysis.rounds.some((round) =>
      round.players.length !== 0
      || round.keyMoments.length !== 0
      || round.evidenceIds.length !== 0
    )
  ) {
    throw new Error("Benchmark contribution contains non-consenting player data.");
  }
  if (/7656119\d{10}/u.test(JSON.stringify(source))) {
    throw new Error("Benchmark contribution still contains a Steam ID.");
  }
  return {
    contributionVersion: source.contributionVersion,
    entry,
    analysis,
    privacy: {
      scope: "consenting_player_only",
      identity: "random_contributor_id",
      otherPlayersRemoved: true,
      steamIdsRemoved: true,
    },
    levelSource: source.levelSource,
  };
}
