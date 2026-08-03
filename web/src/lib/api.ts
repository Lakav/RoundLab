import type { MatchData, Round } from "@/lib/types";
import type { BenchmarkContributionSettings } from "@/lib/analysis/benchmark-contribution";
import { getBackend } from "@/lib/backends";
import type { DemoSource, ParseOptions, ParseProgress, ProgressListener } from "@/lib/backends/types";

export type { DemoSource, ParseOptions, ParseProgress };

export type MatchSummary = {
  id: string;
  name: string;
  createdAt: number;
  size: number;
  benchmarkContribution?: BenchmarkContributionSettings;
};

export async function listMatches(): Promise<MatchSummary[]> {
  return getBackend().matches.listMatches();
}

export async function getMatchMetadata(id: string): Promise<MatchData> {
  return getBackend().matches.getMatchMetadata(id);
}

export async function getCompleteMatch(id: string): Promise<MatchData> {
  return getBackend().matches.getCompleteMatch(id);
}

export async function getRound(
  id: string,
  number: number,
  debugProjectiles = false,
): Promise<Round> {
  return getBackend().matches.getRound(id, number, debugProjectiles);
}

export async function deleteMatch(id: string): Promise<void> {
  await getBackend().matches.deleteMatch(id);
}

export async function renameMatch(
  id: string,
  name: string,
): Promise<MatchSummary> {
  return getBackend().matches.renameMatch(id, name);
}

export async function saveBenchmarkContribution(
  id: string,
  settings: BenchmarkContributionSettings,
): Promise<MatchSummary> {
  return getBackend().matches.saveBenchmarkContribution(id, settings);
}

/** Parse a local .dem or .dem.zst file. Returns the new match id. */
export async function parseDemo(source: DemoSource, options?: ParseOptions): Promise<string> {
  return options
    ? getBackend().parser.parseDemo(source, options)
    : getBackend().parser.parseDemo(source);
}

export async function cancelParse(): Promise<void> {
  await getBackend().parser.cancelParse();
}

export async function onParseProgress(listener: ProgressListener): Promise<() => void> {
  return getBackend().parser.onProgress(listener);
}

export async function getDebugInfo(): Promise<Record<string, unknown>> {
  return getBackend().diagnostics.getDebugInfo();
}

export async function writeDebugLog(source: string, message: string): Promise<void> {
  await getBackend().diagnostics.writeDebugLog(source, message);
}

export async function enterMatchFullscreen(): Promise<void> {
  return getBackend().shell.enterMatchFullscreen();
}

export async function exitMatchFullscreen(): Promise<void> {
  return getBackend().shell.exitMatchFullscreen();
}
