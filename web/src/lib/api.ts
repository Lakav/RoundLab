// Desktop build: all backend calls go through Tauri `invoke`.
//
// In a pure web dev context (vite/next dev without Tauri), `invoke` is still
// importable but will throw at call time. Components should use these helpers
// rather than `invoke` directly so we can swap implementations if needed.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { MatchData, Round } from "@/lib/types";

export type MatchSummary = {
  id: string;
  createdAt: number;
  size: number;
};

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

/** Parse a local .dem file. Returns the new match id. */
export async function parseDemo(srcPath: string): Promise<string> {
  return invoke<string>("parse_demo", { srcPath });
}

/** Prompt the user for a demo file. Returns null if cancelled. */
export async function pickDemoFile(): Promise<string | null> {
  const res = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: "CS2 Demo", extensions: ["dem"] }],
  });
  return typeof res === "string" ? res : null;
}
