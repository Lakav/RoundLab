// Desktop build: all backend calls go through Tauri `invoke`.
// Components should use these helpers rather than `invoke` directly so the
// native command boundary stays centralized.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { MatchData, Round } from "@/lib/types";

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
  return { ...DEFAULT_PARSE_OPTIONS };
}

export function saveParseOptions(opts: ParseOptions): void {
  void opts;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PARSE_OPTIONS_KEY, JSON.stringify(DEFAULT_PARSE_OPTIONS));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export async function listMatches(): Promise<MatchSummary[]> {
  return invoke<MatchSummary[]>("list_matches");
}

export async function getMatchMetadata(id: string): Promise<MatchData> {
  return invoke<MatchData>("get_match_metadata", { id });
}

export async function getRound(
  id: string,
  number: number,
  debugProjectiles = false,
): Promise<Round> {
  return invoke<Round>("get_round", { id, number, debugProjectiles });
}

export async function deleteMatch(id: string): Promise<void> {
  await invoke("delete_match", { id });
}

export async function renameMatch(
  id: string,
  name: string,
): Promise<MatchSummary> {
  return invoke<MatchSummary>("rename_match", { id, name });
}

/** Parse a local .dem or .dem.zst file. Returns the new match id. */
export async function parseDemo(
  srcPath: string,
  options?: ParseOptions,
): Promise<string> {
  void options;
  return invoke<string>("parse_demo", {
    srcPath,
    options: DEFAULT_PARSE_OPTIONS,
  });
}

export async function cancelParse(): Promise<void> {
  await invoke("cancel_parse");
}

export async function getDebugInfo(): Promise<Record<string, unknown>> {
  return invoke<Record<string, unknown>>("get_debug_info");
}

export async function getLogFilePath(): Promise<string> {
  return invoke<string>("get_log_file_path");
}

export async function readLogTail(lines = 200): Promise<string> {
  return invoke<string>("read_log_tail", { lines });
}

export type ProjectileDebugLogScan = {
  lines: string;
  rawTail: string;
  scannedLines: number;
  matchedLines: number;
  paths: string[];
  writtenPath: string;
  projectilePath: string;
  projectileSizeBytes: number;
  projectileLines: number;
};

export async function readProjectileDebugLogs(lines = 2000): Promise<ProjectileDebugLogScan> {
  return invoke<ProjectileDebugLogScan>("read_projectile_debug_logs", { lines });
}

export type ProjectileLogInfo = {
  path: string;
  sizeBytes: number;
  lines: number;
};

export async function getProjectileLogInfo(): Promise<ProjectileLogInfo> {
  return invoke<ProjectileLogInfo>("get_projectile_log_info");
}

export async function openLogsFolder(): Promise<void> {
  await invoke("open_logs_folder");
}

export async function openProjectileLogsFolder(): Promise<void> {
  await invoke("open_projectile_logs_folder");
}

export async function openProjectileLogFile(): Promise<void> {
  await invoke("open_projectile_log_file");
}

export async function writeDebugLog(source: string, message: string): Promise<string> {
  return invoke<string>("write_debug_log", { source, message });
}

/** Prompt the user for a demo file. Returns null if cancelled. */
export async function pickDemoFile(): Promise<string | null> {
  const res = await openDialog({
    multiple: false,
    directory: false,
    filters: [
      // `zst` covers both `.zst` and the common `.dem.zst` naming.
      { name: "CS2 Demo", extensions: ["dem", "zst"] },
    ],
  });
  return typeof res === "string" ? res : null;
}
