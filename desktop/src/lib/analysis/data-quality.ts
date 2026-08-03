import type { MatchData } from "../types.ts";
import { isLegacyImport } from "../import-version.ts";
import type { RoundMechanicsAnalysis } from "./mechanics-types.ts";
import {
  qualityMetric,
  type QualityMetric,
} from "./metric-quality.ts";
import {
  validMapGeometry,
  type MapGeometry,
} from "./visibility-geometry.ts";

export const DATA_QUALITY_SCHEMA_VERSION =
  "roundlab.data-quality.v1" as const;

export type DataQualitySignalId =
  | "shots"
  | "bulletImpacts"
  | "damages"
  | "hitgroups"
  | "pitchYaw"
  | "velocity"
  | "spottedBy"
  | "scopedState"
  | "usableEngagements"
  | "shotDamageAssociation"
  | "geometry";

export type ImportQuality =
  | "complete"
  | "partial"
  | "insufficient"
  | "legacy";

export type DataQualityReport = {
  schemaVersion: typeof DATA_QUALITY_SCHEMA_VERSION;
  parserVersion: string;
  replaySchemaVersion: string;
  mechanicsFormulaVersion: string;
  importQuality: ImportQuality;
  capabilities: string[];
  geometryVersion: string | null;
  signals: Record<DataQualitySignalId, QualityMetric<number>>;
};

function streamMetric(
  value: number,
  availableRounds: number,
  roundCount: number,
  unit: string,
  reason: string,
): QualityMetric<number> {
  return qualityMetric({
    value: availableRounds === 0 && roundCount > 0 ? null : value,
    unit,
    sampleCount: roundCount,
    usableSampleCount: availableRounds,
    provenance: "observed",
    confidence: availableRounds === roundCount ? "high" : "low",
    unavailableReasons:
      availableRounds === roundCount ? [] : [reason],
    formulaVersion: DATA_QUALITY_SCHEMA_VERSION,
  });
}

function sampledMetric(
  value: number,
  sampleCount: number,
  usableSampleCount: number,
  unit: string,
  provenance: "observed" | "reconstructed",
  reason: string,
): QualityMetric<number> {
  return qualityMetric({
    value: sampleCount === 0 || usableSampleCount === 0 ? null : value,
    unit,
    sampleCount,
    usableSampleCount,
    provenance,
    confidence:
      sampleCount === 0
        ? "unavailable"
        : usableSampleCount === sampleCount
        ? "high"
        : usableSampleCount > 0
          ? "medium"
          : "low",
    unavailableReasons:
      sampleCount > 0 && usableSampleCount === sampleCount ? [] : [reason],
    formulaVersion: DATA_QUALITY_SCHEMA_VERSION,
  });
}

export function buildDataQualityReport(
  match: MatchData,
  mechanicsRounds: RoundMechanicsAnalysis[],
  geometry: MapGeometry | undefined,
  mechanicsFormulaVersion: string,
): DataQualityReport {
  const roundCount = match.rounds.length;
  const playerSamples = match.rounds.flatMap((round) =>
    round.frames.flatMap((frame) => frame.players)
  );
  const damages = match.rounds.flatMap((round) => round.damages ?? []);
  const shots = mechanicsRounds.flatMap((round) => round.shots);
  const engagements = mechanicsRounds.flatMap((round) => round.engagements);
  const reliableShots = shots.filter(
    (shot) =>
      shot.associationStatus === "reliable_hit" ||
      shot.associationStatus === "reliable_miss",
  );
  const geometryAvailable =
    geometry !== undefined &&
    geometry.map === match.meta.map &&
    validMapGeometry(geometry);
  const declaredCapabilities = match.capabilities;
  const streamAvailable = (capability: string, legacyFallback: boolean) =>
    declaredCapabilities === undefined
      ? legacyFallback
      : declaredCapabilities.includes(capability);
  const signals: DataQualityReport["signals"] = {
    shots: streamMetric(
      match.rounds.reduce(
        (total, round) => total + (round.weaponFires?.length ?? 0),
        0,
      ),
      streamAvailable(
        "weapon_fires",
        match.rounds.every((round) => round.weaponFires !== undefined),
      )
        ? roundCount
        : 0,
      roundCount,
      "events",
      "missing_weapon_fire_events",
    ),
    bulletImpacts: streamMetric(
      match.rounds.reduce(
        (total, round) => total + (round.bulletImpacts?.length ?? 0),
        0,
      ),
      streamAvailable(
        "bullet_impacts",
        match.rounds.every((round) => round.bulletImpacts !== undefined),
      )
        ? roundCount
        : 0,
      roundCount,
      "events",
      "missing_bullet_impact_events",
    ),
    damages: streamMetric(
      damages.length,
      streamAvailable(
        "damage_events",
        match.rounds.every((round) => round.damages !== undefined),
      )
        ? roundCount
        : 0,
      roundCount,
      "events",
      "missing_damage_events",
    ),
    hitgroups: sampledMetric(
      damages.filter(
        (damage) =>
          typeof damage.hitgroup === "string" &&
          damage.hitgroup.trim().length > 0,
      ).length,
      damages.length,
      damages.filter(
        (damage) =>
          typeof damage.hitgroup === "string" &&
          damage.hitgroup.trim().length > 0,
      ).length,
      "damage_events",
      "observed",
      "missing_hitgroups",
    ),
    pitchYaw: sampledMetric(
      playerSamples.filter(
        (player) =>
          Number.isFinite(player.pitch) && Number.isFinite(player.yaw),
      ).length,
      playerSamples.length,
      playerSamples.filter(
        (player) =>
          Number.isFinite(player.pitch) && Number.isFinite(player.yaw),
      ).length,
      "player_samples",
      "observed",
      "missing_pitch_or_yaw",
    ),
    velocity: sampledMetric(
      playerSamples.filter(
        (player) =>
          (
            Number.isFinite(player.velocityX) &&
            Number.isFinite(player.velocityY)
          ) ||
          Number.isFinite(player.speed),
      ).length,
      playerSamples.length,
      playerSamples.filter(
        (player) =>
          (
            Number.isFinite(player.velocityX) &&
            Number.isFinite(player.velocityY)
          ) ||
          Number.isFinite(player.speed),
      ).length,
      "player_samples",
      "observed",
      "missing_velocity",
    ),
    spottedBy: sampledMetric(
      playerSamples.filter((player) => player.spottedBy !== undefined).length,
      playerSamples.length,
      playerSamples.filter((player) => player.spottedBy !== undefined).length,
      "player_samples",
      "observed",
      "missing_spotted_by",
    ),
    scopedState: sampledMetric(
      playerSamples.filter((player) => player.scoped !== undefined).length,
      playerSamples.length,
      playerSamples.filter((player) => player.scoped !== undefined).length,
      "player_samples",
      "observed",
      "missing_scoped_state",
    ),
    usableEngagements: sampledMetric(
      engagements.filter(
        (engagement) => engagement.unavailableReasons.length === 0,
      ).length,
      engagements.length,
      engagements.filter(
        (engagement) => engagement.unavailableReasons.length === 0,
      ).length,
      "engagements",
      "reconstructed",
      "incomplete_engagement_context",
    ),
    shotDamageAssociation: sampledMetric(
      reliableShots.length,
      shots.length,
      reliableShots.length,
      "shots",
      "reconstructed",
      "incomplete_shot_association",
    ),
    geometry: qualityMetric({
      value: geometryAvailable ? 1 : null,
      unit: "availability",
      sampleCount: 1,
      usableSampleCount: geometryAvailable ? 1 : 0,
      provenance: "observed",
      confidence: geometryAvailable ? "high" : "unavailable",
      unavailableReasons: geometryAvailable
        ? []
        : [
          geometry === undefined
            ? "missing_map_geometry"
            : geometry.map !== match.meta.map
              ? "map_geometry_mismatch"
              : "invalid_map_geometry",
        ],
      formulaVersion: DATA_QUALITY_SCHEMA_VERSION,
    }),
  };
  const capabilities = (Object.entries(signals) as Array<
    [DataQualitySignalId, QualityMetric<number>]
  >)
    .filter(([, metric]) => metric.value !== null && metric.usableSampleCount > 0)
    .map(([signal]) => signal)
    .sort();
  const coverages = Object.values(signals)
    .map((signal) => signal.coverage)
    .filter((coverage): coverage is number => coverage !== null);
  const averageCoverage = coverages.length === 0
    ? 0
    : coverages.reduce((total, coverage) => total + coverage, 0) /
      coverages.length;
  const declaredImportQuality = match.importQuality;
  const importQuality: ImportQuality = isLegacyImport(match)
    ? "legacy"
    : declaredImportQuality === "complete" && averageCoverage < 0.5
      ? "insufficient"
      : declaredImportQuality ?? "insufficient";
  return {
    schemaVersion: DATA_QUALITY_SCHEMA_VERSION,
    parserVersion: match.parserVersion ?? "unknown",
    replaySchemaVersion: match.schemaVersion ?? "roundlab.replay.legacy",
    mechanicsFormulaVersion:
      match.mechanicsFormulaVersion ?? mechanicsFormulaVersion,
    importQuality,
    capabilities: match.capabilities ?? capabilities,
    geometryVersion: match.geometryVersion ?? null,
    signals,
  };
}
