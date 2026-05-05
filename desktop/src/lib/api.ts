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

export async function getRound(id: string, number: number): Promise<Round> {
  return invoke<Round>("get_round", { id, number });
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

export async function getDebugInfo(): Promise<Record<string, any>> {
  return invoke<Record<string, any>>("get_debug_info");
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
