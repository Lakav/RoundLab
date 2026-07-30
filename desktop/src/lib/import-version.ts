import { MECHANICS_ANALYSIS_SPEC_VERSION } from "./analysis/mechanics-types.ts";
import type { MatchData } from "./types.ts";

export const IMPORT_MANIFEST_VERSION = "roundlab.import.v1" as const;

export type CurrentParserQuality = "full" | "high";

const BASE_CAPABILITIES = [
  "round_events",
  "damage_events",
  "hitgroups",
  "weapon_fires",
  "player_positions",
  "pitch_yaw",
  "velocity",
  "spotted_by",
  "scoped_state",
  "flash_events",
  "purchase_events",
  "utility_effects",
  "projectile_positions",
] as const;

/**
 * Adds the manifest facts known by the browser import pipeline. This must run
 * immediately after parsing: empty event arrays alone cannot distinguish
 * "observed zero" from "stream skipped".
 */
export function versionCurrentImport(
  match: MatchData,
  parserQuality: CurrentParserQuality,
): MatchData {
  return {
    ...match,
    mechanicsFormulaVersion: MECHANICS_ANALYSIS_SPEC_VERSION,
    // Current demoparser2 does not expose CS2 bullet_impact on the reference
    // corpus. Even full frame sampling is therefore analytically partial.
    importQuality: "partial",
    capabilities: [
      ...BASE_CAPABILITIES,
      parserQuality === "full" ? "full_frame_sampling" : "reduced_frame_sampling",
    ],
    geometryVersion: null,
  };
}

export function isLegacyImport(match: MatchData): boolean {
  return (
    match.schemaVersion !== "roundlab.replay.v2" ||
    !match.parserVersion ||
    !match.mechanicsFormulaVersion ||
    !match.importQuality ||
    !Array.isArray(match.capabilities) ||
    match.geometryVersion === undefined
  );
}
