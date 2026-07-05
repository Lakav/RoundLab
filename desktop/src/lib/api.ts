import type { MatchData, Round } from "@/lib/types";
import { getBackend } from "@/lib/backends";
import type { DemoSource, ParseProgress, ProgressListener } from "@/lib/backends/types";

export type { DemoSource, ParseProgress };

export type MatchSummary = {
  id: string;
  name: string;
  createdAt: number;
  size: number;
};

/** User-tunable parse options. Defaults mirror the Rust side (`full` quality,
 *  everything captured). Stored in localStorage under `roundlab.parseOptions`. */
export type ParseOptions = {
  quality?: "full" | "high" | "medium" | "low";
  skipProjectiles?: boolean;
  skipWeaponFires?: boolean;
};

export const DEFAULT_PARSE_OPTIONS: ParseOptions = {
  quality: "full",
  skipProjectiles: false,
  skipWeaponFires: false,
};

const PARSE_OPTIONS_KEY = "roundlab.parseOptions";

export function loadParseOptions(): ParseOptions {
  if (typeof window === "undefined") return { ...DEFAULT_PARSE_OPTIONS };
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PARSE_OPTIONS_KEY) ?? "null") as ParseOptions | null;
    return { ...DEFAULT_PARSE_OPTIONS, ...(parsed ?? {}) };
  } catch {
    return { ...DEFAULT_PARSE_OPTIONS };
  }
}

export function saveParseOptions(opts: ParseOptions): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PARSE_OPTIONS_KEY, JSON.stringify({ ...DEFAULT_PARSE_OPTIONS, ...opts }));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export async function listMatches(): Promise<MatchSummary[]> {
  return getBackend().matches.listMatches();
}

export async function getMatchMetadata(id: string): Promise<MatchData> {
  return getBackend().matches.getMatchMetadata(id);
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

/** Parse a local .dem or .dem.zst file. Returns the new match id. */
export async function parseDemo(
  source: DemoSource,
  options?: ParseOptions,
): Promise<string> {
  return getBackend().parser.parseDemo(source, {
    ...DEFAULT_PARSE_OPTIONS,
    ...options,
  });
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

export async function writeDebugLog(source: string, message: string): Promise<string> {
  return getBackend().diagnostics.writeDebugLog(source, message);
}

export async function getAppVersion(): Promise<string> {
  return getBackend().shell.getAppVersion();
}

export async function enterMatchFullscreen(): Promise<void> {
  return getBackend().shell.enterMatchFullscreen();
}

export async function exitMatchFullscreen(): Promise<void> {
  return getBackend().shell.exitMatchFullscreen();
}
