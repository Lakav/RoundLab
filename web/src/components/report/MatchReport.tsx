"use client";

import { useState } from "react";
import Link from "next/link";
import type {
  AnalysisEvidence,
  MatchAnalysis,
} from "@/lib/analysis/types";
import type { MechanicsAnalysis } from "@/lib/analysis/mechanics-types";
import type { SpatialAnalysis } from "@/lib/analysis/spatial-types";
import {
  summarizePlayerMechanics,
} from "@/lib/analysis/summarize-player-mechanics";
import {
  qualityMetric,
  type QualityMetric,
} from "@/lib/analysis/metric-quality";
import {
  DefinitionTerm,
  STAT_DEFINITIONS,
} from "@/components/ui/definition-term";

type ReportTab = "overview" | "details" | "headToHead" | "rating" | "mapZones";
type OverviewMetricSet = "general" | "aim" | "positioning" | "utility";
type DetailSection =
  | "general"
  | "timeline"
  | "aim"
  | "utility"
  | "activity"
  | "trades"
  | "weapons"
  | "openings"
  | "clutches";

type MatchReportProps = {
  analysis: MatchAnalysis | null;
  mechanics: MechanicsAnalysis | null;
  spatial: SpatialAnalysis | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onOpenEvidence: (evidenceId: string) => void;
  onOpenPositioning: (playerId: string) => void;
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function zoneLabel(
  zoneId: string,
  labels: Record<string, string> | undefined,
): string {
  return labels?.[zoneId] ?? zoneId
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function teamLabel(name: string): string {
  if (name.startsWith("team_")) return `Équipe ${name.slice(5)}`;
  return name;
}

function performanceColor(value: number | null): string {
  if (value === null) return "text-neutral-500";
  if (value >= 1.1) return "text-emerald-300";
  if (value < 0.8) return "text-rose-300";
  return "text-neutral-200";
}

function mostFrequent(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )[0]?.[0] ?? null;
}

function weaponLabel(weapon: string | null): string {
  if (weapon === null) return "—";
  return weapon.replace(/^weapon_/, "").replaceAll("_", " ").toUpperCase();
}

function number(value: number | null, digits = 0): string {
  return value === null ? "—" : value.toFixed(digits);
}

function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function ratio(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}

function Metric({
  label,
  value,
  detail,
  quality,
}: {
  label: string;
  value: string;
  detail?: string;
  quality?: QualityMetric<number>;
}) {
  return (
    <div
      className="report-metric group relative min-h-[6.25rem] overflow-hidden rounded-lg border border-white/[0.075] px-4 py-3.5"
      title={quality ? metricQualityTitle(quality) : undefined}
      tabIndex={quality ? 0 : undefined}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-200/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="text-[10px] font-semibold uppercase tracking-[0.11em] text-neutral-500">
        <DefinitionTerm label={label} />
      </div>
      <div className="mt-2 text-[1.65rem] font-semibold leading-none tracking-[-0.035em] tabular-nums text-neutral-100">
        {value}
      </div>
      {detail && <div className="mt-2 text-[11px] leading-snug text-neutral-500">{detail}</div>}
      {quality && (
        <div className="mt-2 text-[9px] leading-snug text-neutral-500">
          {quality.usableSampleCount}/{quality.sampleCount} ·{" "}
          {QUALITY_PROVENANCE_LABELS[quality.provenance]}
        </div>
      )}
    </div>
  );
}

function CoverageBadge({
  label,
  available,
  total,
}: {
  label: string;
  available: number;
  total: number;
}) {
  const complete = total > 0 && available === total;
  const empty = available === 0;
  return (
    <div
      className={[
        "flex items-center gap-2 rounded-[4px] border px-2.5 py-1.5 text-[11px]",
        complete
          ? "border-emerald-300/15 bg-emerald-300/[0.05] text-emerald-200"
          : empty
            ? "border-rose-300/12 bg-rose-300/[0.04] text-rose-200"
            : "border-amber-300/15 bg-amber-300/[0.045] text-amber-200",
      ].join(" ")}
    >
      <span className={[
        "size-1.5 rounded-full",
        complete ? "bg-emerald-300" : empty ? "bg-rose-300" : "bg-amber-300",
      ].join(" ")} />
      <span className="font-semibold">{label}</span>
      <span className="tabular-nums opacity-60">{available}/{total}</span>
    </div>
  );
}

const DATA_QUALITY_LABELS: Record<string, string> = {
  shots: "Tirs",
  bulletImpacts: "Impacts",
  damages: "Dégâts",
  hitgroups: "Hitgroups",
  pitchYaw: "Pitch / yaw",
  velocity: "Vélocité",
  spottedBy: "spottedBy",
  scopedState: "État scoped",
  usableEngagements: "Engagements exploitables",
  shotDamageAssociation: "Association tirs-dégâts",
  geometry: "Géométrie",
  economyFreezePlayers: "Équipement au freeze",
  numericalAdvantageContexts: "Contextes d’avantage",
  predeathEquipment: "Équipement pré-mort",
  lostRoundInventories: "Inventaires de rounds perdus",
  purchaseSemantics: "Achats exploitables",
  tacticalZoneAssignments: "Attribution des zones",
  teammateSpacing: "Distances équipiers",
  utilityInputs: "Flux utilitaires",
  utilityEffectiveness: "Efficacité utilitaire",
};

const QUALITY_REASON_LABELS: Record<string, string> = {
  missing_weapon_fire_events: "Événements weapon_fire absents",
  missing_bullet_impact_events: "Événements bullet_impact absents",
  missing_damage_events: "Événements player_hurt absents",
  missing_hitgroups: "Hitgroups absents sur une partie des dégâts",
  missing_pitch_or_yaw: "Pitch ou yaw absent sur une partie des positions",
  missing_velocity: "Vélocité absente sur une partie des positions",
  missing_spotted_by: "Masque spottedBy absent sur une partie des positions",
  incomplete_engagement_context: "Contexte de combat incomplet",
  incomplete_shot_association: "Certains tirs ne peuvent pas être classés fiablement",
  missing_map_geometry: "Aucune géométrie locale valide pour cette map",
  map_geometry_mismatch: "La géométrie chargée appartient à une autre map",
  invalid_map_geometry: "La géométrie chargée est invalide",
  missing_player_frame: "Frame joueur absente au moment du tir",
  incomplete_spotted_by_samples: "Échantillons spottedBy incomplets",
  no_spotted_shots: "Aucun tir avec cible repérée",
  no_usable_spray_shots: "Aucun tir de spray exploitable",
  unmatched_player_damage_events: "Dégâts du joueur sans tir associé",
  incomplete_shot_associations: "Associations de tirs incomplètes",
  recorded_kill_without_associated_damage: "Kill enregistré sans dégât associé",
  no_counter_strafe_samples: "Aucun arrêt avant tir exploitable",
  no_usable_visibility_duels: "Aucun duel avec visibilité exploitable",
  no_usable_crosshair_samples: "Aucune visibilité exploitable pour le viseur",
  no_associated_hits: "Aucun impact de dégâts associé",
  no_shots: "Aucun tir",
  no_non_awp_hits: "Aucun impact hors AWP",
  no_usable_tap_shots: "Aucun tap exploitable",
  no_usable_burst_shots: "Aucun burst exploitable",
  no_usable_first_bullets: "Aucune première balle exploitable",
  incomplete_stance_samples: "Posture absente sur une partie des tirs",
  missing_scoped_state: "État scoped non extrait de la démo",
  incomplete_scoped_samples: "État scoped incomplet sur certains tirs",
  missing_freeze_end_tick: "Tick de fin de freeze absent",
  missing_freeze_end_frame: "Frame de fin de freeze absente",
  missing_equipment_values: "Valeur d’équipement absente pour certains joueurs",
  incomplete_position_samples: "Positions absentes sur une partie des impacts",
  no_usable_first_shot_duels: "Aucun duel avec premier tir exploitable",
  missing_mechanics_analysis: "Analyse mécanique absente",
  no_samples: "Aucun échantillon",
  no_usable_samples: "Aucun échantillon exploitable",
  incomplete_advantage_context: "Roster, déconnexions ou issue incomplets",
  incomplete_predeath_equipment_values: "Valeur d’équipement absente avant certaines morts",
  incomplete_round_end_inventory: "Inventaire de fin de round absent",
  incomplete_round_outcomes: "Issue de certains rounds absente",
  missing_non_aim_quality_analysis: "Contrat de qualité non-Aim absent",
  missing_purchase_events: "Flux d’achats absent",
  unvalidated_purchase_event_semantics: "Chronologie et répétitions des achats non validées",
  missing_flash_events: "Événements de flash absents",
  no_flash_grenades: "Aucune flash lancée",
  no_enemy_blind_flashes: "Aucun flash ennemi avec durée exploitable",
  no_he_grenades: "Aucune HE lancée",
  incomplete_predeath_inventory: "Inventaire absent avant certaines morts",
};

function qualityReasonLabel(reason: string): string {
  return QUALITY_REASON_LABELS[reason] ??
    reason.replaceAll("_", " ");
}

const QUALITY_PROVENANCE_LABELS = {
  observed: "observé",
  reconstructed: "reconstruit",
  estimated: "estimé",
} as const;

const QUALITY_CONFIDENCE_LABELS = {
  high: "haute",
  medium: "moyenne",
  low: "faible",
  unavailable: "indisponible",
} as const;

function metricQualityTitle(metric: QualityMetric<unknown>): string {
  const coverage = metric.coverage === null
    ? "couverture indéfinie"
    : `${Math.round(metric.coverage * 100)} % de couverture`;
  const reasons = metric.unavailableReasons.length === 0
    ? ""
    : ` — ${metric.unavailableReasons.map(qualityReasonLabel).join("; ")}`;
  return `${metric.usableSampleCount}/${metric.sampleCount} échantillons, ${coverage}, `
    + `${QUALITY_PROVENANCE_LABELS[metric.provenance]}, confiance `
    + `${QUALITY_CONFIDENCE_LABELS[metric.confidence]}, ${metric.formulaVersion}${reasons}`;
}

function QualityMetricCell({
  metric,
  format,
}: {
  metric: QualityMetric<number>;
  format: (value: number | null) => string;
}) {
  const qualityDescription = metricQualityTitle(metric);
  return (
    <span
      className="inline-flex flex-col items-end"
      title={qualityDescription}
      aria-label={`${format(metric.value)}. ${qualityDescription}`}
      tabIndex={0}
    >
      <span>{format(metric.value)}</span>
      <span className="text-[9px] font-normal text-neutral-400">
        {metric.usableSampleCount}/{metric.sampleCount} ·{" "}
        {QUALITY_PROVENANCE_LABELS[metric.provenance]}
      </span>
    </span>
  );
}

function DataQualityPanel({
  analysis,
  mechanics,
  spatial,
}: {
  analysis: MatchAnalysis;
  mechanics: MechanicsAnalysis | null;
  spatial: SpatialAnalysis | null;
}) {
  const quality = mechanics?.dataQuality;
  const coverageSignal = (
    metrics: QualityMetric<unknown>[],
    formulaVersion: string,
  ): QualityMetric<number> => {
    const sampleCount = metrics.reduce(
      (total, metric) => total + metric.sampleCount,
      0,
    );
    const usableSampleCount = metrics.reduce(
      (total, metric) => total + metric.usableSampleCount,
      0,
    );
    const unavailableReasons = [...new Set(
      metrics.flatMap((metric) => metric.unavailableReasons),
    )];
    return qualityMetric({
      value: sampleCount === 0 ? null : usableSampleCount,
      unit: "samples",
      sampleCount,
      usableSampleCount,
      provenance: "reconstructed",
      confidence:
        sampleCount === 0
          ? "unavailable"
          : usableSampleCount === sampleCount
            ? "high"
            : usableSampleCount > 0
              ? "medium"
              : "low",
      unavailableReasons:
        sampleCount === 0 && unavailableReasons.length === 0
          ? ["missing_non_aim_quality_analysis"]
          : unavailableReasons,
      formulaVersion,
    });
  };
  const nonAimSignals: Record<string, QualityMetric<number>> = {
    economyFreezePlayers: coverageSignal(
      analysis.economyRounds.map((round) => round.quality.category),
      "roundlab.data-quality.v2.economyFreezePlayers",
    ),
    numericalAdvantageContexts: coverageSignal(
      analysis.teams.flatMap((team) =>
        team.combat ? [team.combat.advantageRounds] : []
      ),
      "roundlab.data-quality.v2.numericalAdvantageContexts",
    ),
    predeathEquipment: coverageSignal(
      analysis.players.flatMap((player) =>
        player.economy ? [player.economy.equipmentValueLostOnDeath] : []
      ),
      "roundlab.data-quality.v2.predeathEquipment",
    ),
    lostRoundInventories: coverageSignal(
      analysis.players.flatMap((player) =>
        player.economy ? [player.economy.savedPrimaryWeaponRounds] : []
      ),
      "roundlab.data-quality.v2.lostRoundInventories",
    ),
    purchaseSemantics: coverageSignal(
      analysis.players.flatMap((player) =>
        player.economy ? [player.economy.netSpend] : []
      ),
      "roundlab.data-quality.v2.purchaseSemantics",
    ),
    tacticalZoneAssignments: coverageSignal(
      Object.values(spatial?.players ?? {}).map(
        (player) => player.zoneAssignmentRate,
      ),
      "roundlab.data-quality.v2.tacticalZoneAssignments",
    ),
    teammateSpacing: coverageSignal(
      Object.values(spatial?.players ?? {}).map(
        (player) => player.meanTeammateDistance,
      ),
      "roundlab.data-quality.v2.teammateSpacing",
    ),
    utilityInputs: coverageSignal(
      analysis.players.flatMap((player) =>
        player.utility ? [player.utility.grenadesThrown] : []
      ),
      "roundlab.data-quality.v2.utilityInputs",
    ),
    utilityEffectiveness: coverageSignal(
      analysis.players.flatMap((player) =>
        player.utility
          ? [
            player.utility.enemiesPerFlash,
            player.utility.heDamagePerGrenade,
            player.utility.averageUnusedUtilityValue,
          ]
          : []
      ),
      "roundlab.data-quality.v2.utilityEffectiveness",
    ),
  };
  const signals = {
    ...(quality?.signals ?? {}),
    ...nonAimSignals,
  };
  if (!quality && Object.values(nonAimSignals).every((signal) => signal.sampleCount === 0)) {
    return (
      <article className="rounded-md border border-amber-300/15 bg-amber-300/[0.035] p-4">
        <h3 className="text-sm font-semibold text-amber-100">Qualité des données</h3>
        <p className="mt-1 text-xs text-amber-100/65">
          Diagnostic absent : ce rapport provient d’un ancien calcul. Réimporte la démo pour obtenir
          les couvertures et raisons d’indisponibilité.
        </p>
      </article>
    );
  }
  return (
    <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-neutral-100">Qualité des données</h3>
          <p className="mt-1 text-xs text-neutral-500">
            Parseur {quality?.parserVersion ?? analysis.parserVersion} · schéma{" "}
            {quality?.replaySchemaVersion ?? analysis.inputSchemaVersion} · formules{" "}
            {quality?.mechanicsFormulaVersion ?? "non-Aim uniquement"} · géométrie{" "}
            {" "}{quality?.geometryVersion ?? "absente"}
          </p>
        </div>
        <span className="rounded border border-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
          Import {quality?.importQuality ?? "non diagnostiqué"}
        </span>
      </div>
      {quality?.importQuality === "legacy" && (
        <div className="border-b border-amber-300/12 bg-amber-300/[0.035] px-4 py-3 text-xs text-amber-100/70">
          Import ancien ou manifeste incomplet. Les données existantes sont conservées, mais une{" "}
          <Link href="/" className="font-semibold text-amber-200 hover:underline">
            réimportation de la démo originale
          </Link>{" "}
          est nécessaire pour distinguer les flux absents des vrais zéros.
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-left text-xs">
          <thead className="bg-white/[0.02] text-[10px] uppercase tracking-wide text-neutral-600">
            <tr>
              <th className="px-4 py-2 font-medium">Donnée</th>
              <th className="px-3 py-2 text-right font-medium">Valeur</th>
              <th className="px-3 py-2 text-right font-medium">Exploitable</th>
              <th className="px-3 py-2 text-right font-medium">Couverture</th>
              <th className="px-3 py-2 font-medium">Provenance</th>
              <th className="px-4 py-2 font-medium">Limite</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(signals).map(([signalId, signal]) => (
              <tr key={signalId} className="border-t border-white/8">
                <td className="px-4 py-2.5 font-semibold text-neutral-300">
                  {DATA_QUALITY_LABELS[signalId] ?? signalId}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-300">
                  {signal.value === null ? "—" : number(signal.value)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-400">
                  {signal.usableSampleCount}/{signal.sampleCount}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-neutral-400">
                  {signal.coverage === null ? "—" : percent(signal.coverage)}
                </td>
                <td className="px-3 py-2.5 text-neutral-400">
                  {QUALITY_PROVENANCE_LABELS[signal.provenance]} · confiance{" "}
                  {QUALITY_CONFIDENCE_LABELS[signal.confidence]}
                </td>
                <td className="max-w-[24rem] px-4 py-2.5 text-neutral-500">
                  {signal.unavailableReasons.length === 0
                    ? "Aucune limite détectée"
                    : signal.unavailableReasons.map(qualityReasonLabel).join("; ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function tradeActions(analysis: MatchAnalysis) {
  const evidenceById = new Map(
    analysis.evidence.map((proof) => [proof.evidenceId, proof]),
  );
  const actions: Array<{
    evidence: AnalysisEvidence;
    playerId: string;
    playerName: string;
    kind: "trade_kill" | "traded_death";
  }> = [];
  for (const player of analysis.players) {
    for (const evidenceId of new Set(player.metricEvidence.tradeKills)) {
      const evidence = evidenceById.get(evidenceId);
      if (evidence) {
        actions.push({
          evidence,
          playerId: player.playerId,
          playerName: player.name,
          kind: "trade_kill",
        });
      }
    }
    const deathEvidence = new Set(player.metricEvidence.deaths);
    for (const evidenceId of new Set(player.metricEvidence.tradeDeaths)) {
      if (!deathEvidence.has(evidenceId)) continue;
      const evidence = evidenceById.get(evidenceId);
      if (evidence) {
        actions.push({
          evidence,
          playerId: player.playerId,
          playerName: player.name,
          kind: "traded_death",
        });
      }
    }
  }
  return actions.sort(
    (left, right) =>
      left.evidence.roundNumber - right.evidence.roundNumber ||
      (left.evidence.tick ?? Number.MAX_SAFE_INTEGER) -
        (right.evidence.tick ?? Number.MAX_SAFE_INTEGER) ||
      left.playerId.localeCompare(right.playerId) ||
      left.kind.localeCompare(right.kind),
  );
}

function utilityActions(analysis: MatchAnalysis) {
  const evidenceById = new Map(
    analysis.evidence.map((proof) => [proof.evidenceId, proof]),
  );
  const actions: Array<{
    evidence: AnalysisEvidence;
    playerId: string;
    playerName: string;
    kind: "grenade_throw" | "flash_assist" | "utility_saved";
  }> = [];
  for (const player of analysis.players) {
    for (const evidenceId of new Set(player.metricEvidence.grenadesThrown)) {
      const evidence = evidenceById.get(evidenceId);
      if (evidence) {
        actions.push({
          evidence,
          playerId: player.playerId,
          playerName: player.name,
          kind: "grenade_throw",
        });
      }
    }
    for (const evidenceId of new Set(player.metricEvidence.flashAssists)) {
      const evidence = evidenceById.get(evidenceId);
      if (evidence) {
        actions.push({
          evidence,
          playerId: player.playerId,
          playerName: player.name,
          kind: "flash_assist",
        });
      }
    }
    const deathEvidence = new Set(player.metricEvidence.deaths);
    for (const evidenceId of new Set(player.metricEvidence.utilitySavedOnDeath)) {
      if (!deathEvidence.has(evidenceId)) continue;
      const evidence = evidenceById.get(evidenceId);
      if (evidence) {
        actions.push({
          evidence,
          playerId: player.playerId,
          playerName: player.name,
          kind: "utility_saved",
        });
      }
    }
  }
  return actions.sort(
    (left, right) =>
      left.evidence.roundNumber - right.evidence.roundNumber ||
      (left.evidence.tick ?? Number.MAX_SAFE_INTEGER) -
        (right.evidence.tick ?? Number.MAX_SAFE_INTEGER) ||
      left.playerId.localeCompare(right.playerId) ||
      left.kind.localeCompare(right.kind),
  );
}

function economyLabel(category: string | null): string {
  if (category === "eco") return "Eco";
  if (category === "force_buy") return "Force-buy";
  if (category === "full_buy") return "Full-buy";
  return "Indisponible";
}

export function MatchReport({
  analysis,
  mechanics,
  spatial,
  loading,
  error,
  onRetry,
  onOpenEvidence,
  onOpenPositioning,
}: MatchReportProps) {
  const [tab, setTab] = useState<ReportTab>("overview");
  const [overviewMetricSet, setOverviewMetricSet] = useState<OverviewMetricSet>("general");
  const [detailSection, setDetailSection] = useState<DetailSection>("general");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [selectedRoundNumber, setSelectedRoundNumber] = useState<number | null>(null);
  const [headToHeadPlayerAId, setHeadToHeadPlayerAId] = useState("");
  const [headToHeadPlayerBId, setHeadToHeadPlayerBId] = useState("");
  const [weaponTeamId, setWeaponTeamId] = useState("all");
  const [weaponSide, setWeaponSide] = useState<"all" | "T" | "CT">("all");
  const [weaponRoundNumber, setWeaponRoundNumber] = useState("all");
  const [openingSide, setOpeningSide] = useState<"all" | "T" | "CT">("all");
  const selectedPlayer = analysis?.players.find(
    (player) => player.playerId === selectedPlayerId,
  ) ?? analysis?.players[0] ?? null;
  if (loading) {
    return (
      <div role="status" className="flex min-h-full items-center justify-center text-sm text-neutral-400">
        Calcul des statistiques en cours…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 text-sm">
        <p className="max-w-lg text-center text-red-300">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-white/10 bg-white/[0.04] px-4 py-2 font-semibold text-neutral-100"
        >
          Réessayer
        </button>
      </div>
    );
  }
  if (!analysis) return null;

  const rankedPlayers = [...analysis.players].sort(
    (left, right) => (right.metrics.adr ?? -1) - (left.metrics.adr ?? -1),
  );
  const scopedPlayers = selectedPlayer ? [selectedPlayer] : [];
  const scopedPlayerIds = new Set(scopedPlayers.map((player) => player.playerId));
  const totalDeaths = scopedPlayers.reduce(
    (total, player) => total + player.metrics.deaths,
    0,
  );
  const totalTradeAttempts = scopedPlayers.some(
    (player) => player.metrics.tradeAttempts === null,
  )
    ? null
    : scopedPlayers.reduce(
      (total, player) => total + (player.metrics.tradeAttempts ?? 0),
      0,
    );
  const totalTradeKills = scopedPlayers.some(
    (player) => player.metrics.tradeKills === null,
  )
    ? null
    : scopedPlayers.reduce(
      (total, player) => total + (player.metrics.tradeKills ?? 0),
      0,
    );
  const totalTradeDeaths = scopedPlayers.some(
    (player) => player.metrics.tradeDeaths === null,
  )
    ? null
    : scopedPlayers.reduce(
      (total, player) => total + (player.metrics.tradeDeaths ?? 0),
      0,
    );
  const replayableTradeActions = tradeActions(analysis).filter(
    (action) => scopedPlayerIds.has(action.playerId),
  );
  const replayableUtilityActions = utilityActions(analysis).filter(
    (action) => scopedPlayerIds.has(action.playerId),
  );
  const selectedRound = analysis.rounds.find(
    (round) => round.roundNumber === selectedRoundNumber,
  ) ?? analysis.rounds[0] ?? null;
  const roundDisplayOffset = analysis.rounds[0]?.roundNumber === 0 ? 1 : 0;
  const displayRound = (roundNumber: number) => roundNumber + roundDisplayOffset;
  const firstTeamPlayerIds = analysis.teams[0]?.playerIds ?? [];
  const secondTeamPlayerIds = analysis.teams[1]?.playerIds ?? [];
  const assignedPlayerIds = new Set(
    analysis.teams.flatMap((team) => team.playerIds),
  );
  const unassignedPlayerIds = analysis.players
    .map((player) => player.playerId)
    .filter((playerId) => !assignedPlayerIds.has(playerId));
  const overviewPlayerGroups = [
    ...analysis.teams
      .map((team, index) => ({
        key: team.logicalTeam,
        name: team.name,
        score: team.score,
        playerIds: team.playerIds,
        accent: index === 0 ? "sky" as const : "amber" as const,
      }))
      .filter((team) => team.playerIds.length > 0),
    ...(unassignedPlayerIds.length > 0
      ? [{
          key: "unassigned",
          name: "Équipe non déterminée",
          score: null,
          playerIds: unassignedPlayerIds,
          accent: "neutral" as const,
        }]
      : []),
  ];
  const playerIdentity = (playerId: string, name: string) => (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className={[
        "size-1.5 shrink-0 rounded-full",
        firstTeamPlayerIds.includes(playerId)
          ? "bg-sky-300"
          : secondTeamPlayerIds.includes(playerId)
            ? "bg-amber-300"
            : "bg-neutral-600",
      ].join(" ")} />
      <span className="truncate">{name}</span>
    </span>
  );
  const completeScore = analysis.teams.slice(0, 2).every(
    (team) => team.score !== null,
  ) && analysis.teams.slice(0, 2).reduce(
    (total, team) => total + (team.score ?? 0),
    0,
  ) === analysis.rounds.length;
  const reportMapAsset = spatial?.map && /^de_[a-z0-9_]+$/.test(spatial.map)
    ? `/cs2lens-maps/${spatial.map}.png`
    : null;
  const allPlayerIds = analysis.players.map((player) => player.playerId);
  const effectiveHeadToHeadPlayerAId = allPlayerIds.includes(headToHeadPlayerAId)
    ? headToHeadPlayerAId
    : analysis.players[0]?.playerId ?? "";
  const effectiveHeadToHeadPlayerBId =
    allPlayerIds.includes(headToHeadPlayerBId) &&
    headToHeadPlayerBId !== effectiveHeadToHeadPlayerAId
    ? headToHeadPlayerBId
    : analysis.players.find(
        (player) => player.playerId !== effectiveHeadToHeadPlayerAId,
      )?.playerId ?? "";
  const headToHeadOptionLabel = (playerId: string, playerName: string) => {
    const firstRoundPlayer = analysis.rounds
      .flatMap((round) => round.players)
      .find((player) => player.playerId === playerId);
    const team = analysis.teams.find(
      (candidate) => candidate.logicalTeam === firstRoundPlayer?.logicalTeam,
    );
    return team
      ? `${playerName} · ${teamLabel(team.name)}`
      : firstRoundPlayer?.side
        ? `${playerName} · côté ${firstRoundPlayer.side} au premier round`
        : playerName;
  };
  const headToHeadPlayerA = analysis.players.find(
    (player) => player.playerId === effectiveHeadToHeadPlayerAId,
  ) ?? null;
  const headToHeadPlayerB = analysis.players.find(
    (player) => player.playerId === effectiveHeadToHeadPlayerBId,
  ) ?? null;
  const headToHeadKills = (killerId: string, victimId: string) =>
    analysis.evidence.filter(
      (proof) =>
        proof.type === "kill" &&
        proof.actors[0] === killerId &&
        proof.actors[1] === victimId,
    );
  const headToHeadWeaponSummary = (killerId: string, victimId: string) => {
    const weapons = headToHeadKills(killerId, victimId)
      .map((proof) => proof.weapon)
      .filter((weapon): weapon is string => Boolean(weapon));
    const counts = new Map<string, number>();
    for (const weapon of weapons) counts.set(weapon, (counts.get(weapon) ?? 0) + 1);
    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 3);
  };
  const headToHeadFlashes = (throwerId: string, victimId: string) =>
    analysis.evidence.filter(
      (proof) =>
        proof.type === "flash" &&
        proof.actors[0] === throwerId &&
        proof.actors[1] === victimId,
    ).length;
  const headToHeadDamage = (attackerId: string, victimId: string): number | null => {
    if (!mechanics) return null;
    return mechanics.rounds
      .flatMap((round) => round.engagements)
      .filter(
        (engagement) =>
          engagement.participants.includes(attackerId) &&
          engagement.participants.includes(victimId),
      )
      .reduce(
        (total, engagement) =>
          total +
          (engagement.damageByPlayer.find(
            (damage) => damage.playerId === attackerId,
          )?.damageHealth ?? 0),
        0,
      );
  };
  const openingEvidenceIds = new Set(
    analysis.players.flatMap((player) => player.metricEvidence.openingWins),
  );
  const openingEvents = analysis.evidence
    .filter((proof) => openingEvidenceIds.has(proof.evidenceId))
    .sort(
      (left, right) =>
        left.roundNumber - right.roundNumber ||
        left.time - right.time ||
      left.evidenceId.localeCompare(right.evidenceId),
    );
  const roundPlayerSide = new Map(
    analysis.rounds.flatMap((round) =>
      round.players.map((player) => [
        `${round.roundNumber}:${player.playerId}`,
        player.side,
      ] as const),
    ),
  );
  const filteredOpeningEvents = openingEvents.filter(
    (proof) =>
      proof.actors.some((playerId) => scopedPlayerIds.has(playerId)) &&
      (
        openingSide === "all" ||
        roundPlayerSide.get(`${proof.roundNumber}:${proof.actors[0]}`) === openingSide
      ),
  );
  const weaponTeamPlayerIds = weaponTeamId === "all"
    ? null
    : new Set(
      analysis.teams.find((team) => team.logicalTeam === weaponTeamId)?.playerIds ?? [],
    );
  const weaponScopeIncludes = (playerId: string, roundNumber: number) =>
    scopedPlayerIds.has(playerId) &&
    (weaponTeamPlayerIds === null || weaponTeamPlayerIds.has(playerId)) &&
    (weaponSide === "all" || roundPlayerSide.get(`${roundNumber}:${playerId}`) === weaponSide) &&
    (weaponRoundNumber === "all" || roundNumber === Number(weaponRoundNumber));
  const headshotEvidenceIds = new Set(
    analysis.players.flatMap((player) => player.metricEvidence.headshotKills),
  );
  const weaponStats = new Map<string, {
    weapon: string;
    shots: number;
    reliableShots: number;
    hitShots: number;
    damage: number;
    kills: number;
    headshotKills: number;
  }>();
  const weaponRow = (weapon: string) => {
    const normalized = weapon.toLowerCase().replace(/^weapon_/, "");
    const current = weaponStats.get(normalized) ?? {
      weapon: normalized,
      shots: 0,
      reliableShots: 0,
      hitShots: 0,
      damage: 0,
      kills: 0,
      headshotKills: 0,
    };
    weaponStats.set(normalized, current);
    return current;
  };
  for (const round of mechanics?.rounds ?? []) {
    for (const shot of round.shots) {
      if (!weaponScopeIncludes(shot.shooterId, round.roundNumber)) continue;
      const row = weaponRow(shot.weapon);
      row.shots += 1;
      if (
        shot.associationStatus !== "reliable_hit" &&
        shot.associationStatus !== "reliable_miss"
      ) {
        continue;
      }
      row.reliableShots += 1;
      if (shot.associationStatus === "reliable_hit") row.hitShots += 1;
      row.damage += shot.damages.reduce(
        (total, damage) => total + damage.damageHealth,
        0,
      );
    }
  }
  for (const proof of analysis.evidence) {
    const killerId = proof.actors[0];
    if (
      proof.type !== "kill" ||
      !proof.weapon ||
      !killerId ||
      ["world", "planted_c4", "c4"].includes(
        proof.weapon.toLowerCase().replace(/^weapon_/, ""),
      ) ||
      !weaponScopeIncludes(killerId, proof.roundNumber)
    ) {
      continue;
    }
    const row = weaponRow(proof.weapon);
    row.kills += 1;
    if (headshotEvidenceIds.has(proof.evidenceId)) row.headshotKills += 1;
  }
  const weaponRows = [...weaponStats.values()].sort(
    (left, right) =>
      right.kills - left.kills ||
      right.damage - left.damage ||
      right.shots - left.shots ||
      left.weapon.localeCompare(right.weapon),
  );
  const weaponAssociationSamples = weaponRows.reduce(
    (total, row) => total + row.shots,
    0,
  );
  const weaponAssociationUsable = weaponRows.reduce(
    (total, row) => total + row.reliableShots,
    0,
  );
  const mechanicsByPlayer = new Map(
    analysis.players.map((player) => [
      player.playerId,
      summarizePlayerMechanics(
        mechanics,
        player.playerId,
        (player.metrics.kills ?? 0) > 0,
      ),
    ]),
  );
  const mechanicsSummaries = scopedPlayers
    .map((player) => mechanicsByPlayer.get(player.playerId))
    .filter((summary): summary is NonNullable<typeof summary> => summary !== undefined);
  const totalAimShots = mechanics
    ? mechanicsSummaries.reduce((total, player) => total + (player.shots ?? 0), 0)
    : null;
  const completeHitAssociation = mechanics !== null &&
    mechanicsSummaries.every((player) => player.hitShots !== null);
  const totalAimHitShots = completeHitAssociation
    ? mechanicsSummaries.reduce((total, player) => total + (player.hitShots ?? 0), 0)
    : null;
  const totalSpottedShots = mechanics
    ? mechanicsSummaries.reduce((total, player) => total + (player.spottedShots ?? 0), 0)
    : null;
  const spottedAccuracy = totalSpottedShots === null || totalSpottedShots === 0
    ? null
    : mechanicsSummaries.reduce(
      (total, player) =>
        total + (player.spottedAccuracy ?? 0) * (player.spottedShots ?? 0),
      0,
    ) / totalSpottedShots;
  const averageTimeToDamage = average(
    mechanicsSummaries
      .map((player) => player.timeToDamageMs)
      .filter((value): value is number => value !== null),
  );
  const averageCrosshairError = average(
    mechanicsSummaries
      .map((player) => player.crosshairErrorDegrees)
      .filter((value): value is number => value !== null),
  );
  const averageSprayAccuracy = average(
    mechanicsSummaries
      .map((player) => player.sprayAccuracy)
      .filter((value): value is number => value !== null),
  );
  const averageCounterStrafe = average(
    mechanicsSummaries
      .map((player) => player.counterStrafeRate)
      .filter((value): value is number => value !== null),
  );
  const selectedZoneVisits = spatial?.rounds
    .flatMap((round) => round.zoneVisits)
    .filter((visit) => visit.playerId === selectedPlayer?.playerId) ?? [];
  const selectedZoneRows = [...selectedZoneVisits.reduce(
    (zones, visit) => {
      const current = zones.get(visit.zoneId) ?? {
        zoneId: visit.zoneId,
        duration: 0,
        rounds: new Set<number>(),
        visits: 0,
      };
      current.duration += Math.max(0, visit.endTime - visit.startTime);
      current.rounds.add(visit.roundNumber);
      current.visits += 1;
      zones.set(visit.zoneId, current);
      return zones;
    },
    new Map<string, {
      zoneId: string;
      duration: number;
      rounds: Set<number>;
      visits: number;
    }>(),
  ).values()].sort(
    (left, right) => right.duration - left.duration || left.zoneId.localeCompare(right.zoneId),
  );
  const selectedRotations = spatial?.rounds
    .flatMap((round) => round.rotations)
    .filter((rotation) => rotation.playerIds.includes(selectedPlayer?.playerId ?? "")) ?? [];
  const selectedTradeability = spatial?.rounds
    .flatMap((round) => round.tradeability)
    .filter(
      (event) =>
        event.victimId === selectedPlayer?.playerId ||
        event.coveringPlayerIds.includes(selectedPlayer?.playerId ?? ""),
    ) ?? [];
  const selectedSpatialQuality = selectedPlayer
    ? spatial?.players?.[selectedPlayer.playerId]
    : undefined;
  const selectedUtilityQuality = selectedPlayer?.utility;
  const selectedSpacing = spatial?.rounds
    .flatMap((round) => round.spacing)
    .filter((spacing) => spacing.playerIds.includes(selectedPlayer?.playerId ?? "")) ?? [];
  const closestTeammateDistance = selectedSpacing.length === 0
    ? null
    : Math.min(...selectedSpacing.map((spacing) => spacing.minDistance3d));
  const farthestTeammateDistance = selectedSpacing.length === 0
    ? null
    : Math.max(...selectedSpacing.map((spacing) => spacing.maxDistance3d));
  const playerSectionActive =
    tab === "rating" ||
    tab === "headToHead" ||
    tab === "mapZones" ||
    (tab === "details" && detailSection !== "timeline");
  const primaryNavigation = [
    {
      value: "overview",
      label: "Résumé",
      active: tab === "overview",
      onSelect: () => setTab("overview"),
    },
    {
      value: "players",
      label: "Joueurs",
      active: playerSectionActive,
      onSelect: () => setTab("rating"),
    },
    {
      value: "rounds",
      label: "Rounds",
      active: tab === "details" && detailSection === "timeline",
      onSelect: () => {
        setDetailSection("timeline");
        setTab("details");
      },
    },
  ] as const;
  const analysisNavigation = [
    {
      value: "profile",
      label: "Profil",
      active: tab === "rating",
      onSelect: () => setTab("rating"),
    },
    {
      value: "compare",
      label: "Comparer",
      active: tab === "headToHead",
      onSelect: () => setTab("headToHead"),
    },
    {
      value: "positioning",
      label: "Positionnement",
      active: tab === "mapZones",
      onSelect: () => setTab("mapZones"),
    },
    {
      value: "general",
      label: "Général",
      active: tab === "details" && detailSection === "general",
      onSelect: () => {
        setDetailSection("general");
        setTab("details");
      },
    },
    {
      value: "aim",
      label: "Aim",
      active: tab === "details" && detailSection === "aim",
      onSelect: () => {
        setDetailSection("aim");
        setTab("details");
      },
    },
    {
      value: "utility",
      label: "Utilitaires",
      active: tab === "details" && detailSection === "utility",
      onSelect: () => {
        setDetailSection("utility");
        setTab("details");
      },
    },
    {
      value: "activity",
      label: "Activité",
      active: tab === "details" && detailSection === "activity",
      onSelect: () => {
        setDetailSection("activity");
        setTab("details");
      },
    },
    {
      value: "trades",
      label: "Trades",
      active: tab === "details" && detailSection === "trades",
      onSelect: () => {
        setDetailSection("trades");
        setTab("details");
      },
    },
    {
      value: "weapons",
      label: "Armes",
      active: tab === "details" && detailSection === "weapons",
      onSelect: () => {
        setDetailSection("weapons");
        setTab("details");
      },
    },
    {
      value: "openings",
      label: "Opening duels",
      active: tab === "details" && detailSection === "openings",
      onSelect: () => {
        setDetailSection("openings");
        setTab("details");
      },
    },
    {
      value: "clutches",
      label: "Clutches",
      active: tab === "details" && detailSection === "clutches",
      onSelect: () => {
        setDetailSection("clutches");
        setTab("details");
      },
    },
  ] as const;

  return (
    <section
      aria-label="Rapport de partie"
      className="report-shell mx-auto flex min-h-full w-full max-w-[1480px] flex-col px-4 pb-16 pt-24 sm:px-6"
    >
      <header className="report-hero relative min-h-[11rem] overflow-hidden rounded-xl border border-white/8 bg-[#121515] px-5 py-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)] sm:px-8 sm:py-7">
        {reportMapAsset && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[length:38rem] bg-[position:84%_48%] bg-no-repeat opacity-[0.16]"
            style={{ backgroundImage: `url("${reportMapAsset}")` }}
          />
        )}
        <div className="absolute inset-0 bg-[linear-gradient(90deg,#111514_0%,rgba(17,21,20,0.82)_46%,rgba(17,21,20,0.94)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-200/20 to-transparent" />
        <div className="relative grid min-h-[7.5rem] gap-7 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-emerald-200/15 bg-emerald-200/[0.07] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-emerald-200">
                Analyse terminée
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
                {spatial?.map ? spatial.map.replace(/^de_/, "").toUpperCase() : "Rapport de match"}
              </span>
            </div>
            <h1 className="mt-3 text-[1.75rem] font-semibold tracking-[-0.035em] text-white sm:text-3xl">
              Rapport du match
            </h1>
            <p className="mt-2 text-xs text-neutral-500">
              {analysis.rounds.length} round{analysis.rounds.length > 1 ? "s" : ""} · {analysis.players.length} joueurs analysés
            </p>
          </div>
          <div className="flex items-center justify-start gap-5 rounded-xl border border-white/[0.07] bg-black/20 px-6 py-4 backdrop-blur-sm md:justify-center">
            {analysis.teams.slice(0, 2).map((team, index) => {
              const won = (team.score ?? -1) === Math.max(
                ...analysis.teams.slice(0, 2).map((candidate) => candidate.score ?? -1),
              );
              return (
                <div key={team.logicalTeam} className="contents">
                  {index > 0 && <span className="text-xl font-light text-neutral-700">:</span>}
                  <div className={index === 1 ? "text-right" : undefined}>
                    <div className={[
                      "text-5xl font-semibold leading-none tracking-[-0.06em] tabular-nums",
                      won ? "text-emerald-300" : "text-neutral-200",
                    ].join(" ")}>
                      {team.score ?? "—"}
                    </div>
                    <div className="mt-2 max-w-36 truncate text-[11px] font-semibold text-neutral-400">
                      <span
                        className={[
                          "mr-1.5 inline-block size-1.5 rounded-full align-middle",
                          index === 0 ? "bg-sky-300" : "bg-amber-300",
                        ].join(" ")}
                      />
                      {teamLabel(team.name)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="hidden justify-self-end text-right md:block">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-600">
              État des données
            </div>
            <div className="mt-2 text-sm font-semibold text-neutral-200">
              {completeScore
                ? "Score complet"
                : analysis.teams.slice(0, 2).every((team) => team.score !== null)
                  ? "Score observé"
                  : "Score incomplet"}
            </div>
            <div className="mt-1 text-[11px] text-neutral-500">Calculé localement</div>
          </div>
        </div>
      </header>

      <nav
        aria-label="Sections du rapport"
        className="report-primary-nav sticky top-0 z-20 mt-4 flex overflow-x-auto rounded-lg border border-white/[0.075] bg-[#111413]/95 p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.18)] backdrop-blur-xl"
      >
        {primaryNavigation.map(({ value, label, active, onSelect }) => (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-current={active ? "page" : undefined}
            onClick={onSelect}
            className={[
              "relative flex h-10 shrink-0 items-center rounded-md px-4 text-[13px] font-semibold transition-all",
              active
                ? "bg-white/[0.085] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04),0_4px_14px_rgba(0,0,0,0.15)] after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-emerald-300"
                : "text-neutral-500 enabled:hover:bg-white/[0.03] enabled:hover:text-neutral-200 disabled:cursor-not-allowed disabled:opacity-30",
            ].join(" ")}
          >
            {label}
          </button>
        ))}
      </nav>

      {playerSectionActive && (
        <>
          <nav
            aria-label="Analyses des joueurs"
            className="report-secondary-nav mt-3 flex overflow-x-auto border-b border-white/[0.075] px-1"
          >
            {analysisNavigation.map(({ value, label, active, onSelect }) => (
              <button
                key={value}
                type="button"
                aria-label={label}
                title={STAT_DEFINITIONS[label]}
                aria-current={active ? "page" : undefined}
                onClick={onSelect}
                className={[
                  "relative h-11 shrink-0 px-3.5 text-xs font-semibold transition-colors",
                  active
                    ? "text-neutral-100 after:absolute after:inset-x-3.5 after:bottom-0 after:h-0.5 after:rounded-full after:bg-emerald-300"
                    : "text-neutral-500 hover:text-neutral-200",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab !== "headToHead" && selectedPlayer && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-emerald-200/10 bg-emerald-200/[0.035] px-3 py-2">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] text-emerald-300/70">
                  Joueur analysé
                </div>
                <div className="mt-0.5 text-xs text-neutral-500">
                  Ce choix reste actif dans toutes les sections du rapport.
                </div>
              </div>
              <select
                aria-label="Joueur analysé dans toutes les statistiques"
                value={selectedPlayer.playerId}
                onChange={(event) => setSelectedPlayerId(event.target.value)}
                className="h-9 min-w-44 rounded-md border border-white/10 bg-[#121515] px-3 text-sm font-semibold text-neutral-100"
              >
                {rankedPlayers.map((player) => (
                  <option key={player.playerId} value={player.playerId}>{player.name}</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {tab === "overview" && (
        <div className="mt-6 grid gap-6">
          <div className="grid gap-6">
            <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
              <div className="flex flex-col gap-4 border-b border-white/8 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-emerald-300/60">
                    Vue d’ensemble
                  </span>
                  <h2 className="mt-1 text-base font-semibold tracking-[-0.02em] text-neutral-100">Joueurs</h2>
                  <p className="mt-1 text-xs text-neutral-500">Compare les deux équipes sans changer de page.</p>
                </div>
                <div className="flex overflow-x-auto rounded-md border border-white/[0.055] bg-black/25 p-1">
                  {([
                    ["general", "Général"],
                    ["aim", "Aim"],
                    ["positioning", "Positionnement"],
                    ["utility", "Utilitaires"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={overviewMetricSet === value}
                      onClick={() => setOverviewMetricSet(value)}
                      className={[
                        "shrink-0 rounded-[4px] px-3 py-1.5 text-[11px] font-semibold transition-colors",
                        overviewMetricSet === value
                          ? "bg-emerald-300/[0.12] text-emerald-100 shadow-[inset_0_0_0_1px_rgba(110,231,183,0.08)]"
                          : "text-neutral-500 hover:bg-white/[0.035] hover:text-neutral-200",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[50rem] text-left text-sm">
                  <thead className="bg-white/[0.018] text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-600">
                    <tr>
                      <th className="px-4 py-2.5">Joueur</th>
                      {overviewMetricSet === "general" && (
                        <>
                          <th className="px-3 py-2.5 text-right">K</th>
                          <th className="px-3 py-2.5 text-right">A</th>
                          <th className="px-3 py-2.5 text-right">D</th>
                          <th className="px-3 py-2.5 text-right"><DefinitionTerm label="K/D" /></th>
                          <th className="px-3 py-2.5 text-right"><DefinitionTerm label="ADR" /></th>
                          <th className="px-4 py-2.5 text-right"><DefinitionTerm label="KAST" /></th>
                        </>
                      )}
                      {overviewMetricSet === "aim" && (
                        <>
                          <th className="px-3 py-2.5 text-right">Tirs</th>
                          <th className="px-3 py-2.5 text-right"><DefinitionTerm label="HS kill %" /></th>
                          <th className="px-3 py-2.5 text-right">
                            <DefinitionTerm label="Précision tous tirs" />
                          </th>
                          <th className="px-3 py-2.5 text-right"><DefinitionTerm label="Spray accuracy" /></th>
                          <th className="px-4 py-2.5 text-right"><DefinitionTerm label="Arrêt avant tir" /></th>
                        </>
                      )}
                      {overviewMetricSet === "positioning" && (
                        <>
                          <th className="px-3 py-2.5 text-right">Openings</th>
                          <th className="px-3 py-2.5 text-right">Succès</th>
                          <th className="px-3 py-2.5 text-right"><DefinitionTerm label="Trade kills" /></th>
                          <th className="px-3 py-2.5 text-right"><DefinitionTerm label="Morts tradées" /></th>
                          <th className="px-4 py-2.5 text-right">Clutches</th>
                        </>
                      )}
                      {overviewMetricSet === "utility" && (
                        <>
                          <th className="px-3 py-2.5 text-right">Lancers</th>
                          <th className="px-3 py-2.5 text-right">Ennemis flashés</th>
                          <th className="px-3 py-2.5 text-right"><DefinitionTerm label="Blind moyen" /></th>
                          <th className="px-3 py-2.5 text-right">Flash assists</th>
                          <th className="px-4 py-2.5 text-right">Non utilisés</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  {overviewPlayerGroups.map((team) => (
                    <tbody key={team.key}>
                      <tr className={[
                        "border-t border-white/8",
                        team.accent === "sky"
                          ? "bg-sky-400/[0.045]"
                          : team.accent === "amber"
                            ? "bg-amber-300/[0.04]"
                            : "bg-white/[0.025]",
                      ].join(" ")}>
                        <th
                          colSpan={7}
                          className={[
                            "border-l-2 px-4 py-2 text-[11px] font-semibold",
                            team.accent === "sky"
                              ? "border-sky-300 text-sky-200"
                              : team.accent === "amber"
                                ? "border-amber-300 text-amber-200"
                                : "border-neutral-500 text-neutral-300",
                          ].join(" ")}
                        >
                          {teamLabel(team.name)}
                          {team.score !== null && (
                            <span className="ml-1 text-neutral-500">{team.score}</span>
                          )}
                        </th>
                      </tr>
                      {analysis.players
                        .filter((player) => team.playerIds.includes(player.playerId))
                        .sort((left, right) => (right.metrics.kills ?? -1) - (left.metrics.kills ?? -1))
                        .map((player) => {
                          const playerMechanics = mechanicsByPlayer.get(player.playerId);
                          const clutchWins = player.metrics.clutchWins === null
                            ? null
                            : Object.values(player.metrics.clutchWins).reduce((total, value) => total + value, 0);
                          return (
                            <tr key={player.playerId} className="border-t border-white/[0.055] hover:bg-white/[0.025]">
                              <td className="px-4 py-3">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedPlayerId(player.playerId);
                                    setTab("rating");
                                  }}
                                  className="font-semibold text-neutral-200 hover:text-emerald-300"
                                >
                                  {player.name}
                                </button>
                              </td>
                              {overviewMetricSet === "general" && (
                                <>
                                  <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.kills)}</td>
                                  <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.assists)}</td>
                                  <td className="px-3 py-3 text-right tabular-nums">{player.metrics.deaths}</td>
                                  <td className={[
                                    "px-3 py-3 text-right font-semibold tabular-nums",
                                    performanceColor(player.metrics.kdRatio),
                                  ].join(" ")}>{ratio(player.metrics.kdRatio)}</td>
                                  <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.adr, 1)}</td>
                                  <td className="px-4 py-3 text-right tabular-nums">{percent(player.metrics.kastRate)}</td>
                                </>
                              )}
                              {overviewMetricSet === "aim" && (
                                <>
                                  <td className="px-3 py-3 text-right tabular-nums">
                                    {playerMechanics && (
                                      <QualityMetricCell metric={playerMechanics.metrics.shots} format={number} />
                                    )}
                                  </td>
                                  <td className="px-3 py-3 text-right tabular-nums">{percent(player.metrics.headshotRate)}</td>
                                  <td className="px-3 py-3 text-right tabular-nums">
                                    {playerMechanics && (
                                      <QualityMetricCell metric={playerMechanics.metrics.accuracy} format={percent} />
                                    )}
                                  </td>
                                  <td className="px-3 py-3 text-right tabular-nums">
                                    {playerMechanics && (
                                      <QualityMetricCell metric={playerMechanics.metrics.sprayAccuracy} format={percent} />
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right tabular-nums">
                                    {playerMechanics && (
                                      <QualityMetricCell metric={playerMechanics.metrics.counterStrafeRate} format={percent} />
                                    )}
                                  </td>
                                </>
                              )}
                              {overviewMetricSet === "positioning" && (
                                <>
                                  <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.openingAttempts)}</td>
                                  <td className="px-3 py-3 text-right tabular-nums">
                                    {percent(
                                      player.metrics.openingAttempts
                                        ? (player.metrics.openingWins ?? 0) / player.metrics.openingAttempts
                                        : null,
                                    )}
                                  </td>
                                  <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.tradeKills)}</td>
                                  <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.tradeDeaths)}</td>
                                  <td className="px-4 py-3 text-right tabular-nums">{number(clutchWins)}</td>
                                </>
                              )}
                              {overviewMetricSet === "utility" && (
                                <>
                                  <td className="px-3 py-3 text-right tabular-nums">
                                    {player.utility
                                      ? <QualityMetricCell metric={player.utility.grenadesThrown} format={number} />
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-3 text-right tabular-nums">
                                    {player.utility
                                      ? <QualityMetricCell metric={player.utility.effectiveEnemiesFlashed} format={number} />
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-3 text-right tabular-nums">
                                    {player.utility
                                      ? (
                                        <QualityMetricCell
                                          metric={player.utility.averageEnemyBlindDuration}
                                          format={(value) => value === null ? "—" : `${value.toFixed(1)} s`}
                                        />
                                      )
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.flashAssists)}</td>
                                  <td className="px-4 py-3 text-right tabular-nums">{player.metrics.utilitySavedOnDeath?.total ?? "—"}</td>
                                </>
                              )}
                            </tr>
                          );
                        })}
                    </tbody>
                  ))}
                </table>
              </div>
            </article>

          </div>
        </div>
      )}

      {tab === "details" && detailSection === "general" && (
        <div className="mt-6 grid gap-3">
          <DataQualityPanel analysis={analysis} mechanics={mechanics} spatial={spatial} />
          {analysis.players.every(
            (player) => player.metrics.adr === null && player.metrics.flashes == null,
          ) && (
            <div className="rounded-md border border-amber-300/15 bg-amber-300/[0.045] px-4 py-3">
              <div className="text-sm font-semibold text-amber-200">
                Événements avancés absents de cette importation
              </div>
              <p className="mt-1 text-xs leading-relaxed text-neutral-400">
                Les kills ont été conservés, mais pas les dégâts, les flashes et certains états de fin de round nécessaires à l’ADR et au KAST. La démo originale doit être réimportée avec le parseur actuel pour récupérer ces valeurs ; elles ne peuvent pas être reconstruites fidèlement depuis les seuls kills.
              </p>
              <Link
                href="/"
                className="mt-2 inline-flex text-xs font-semibold text-amber-200 hover:text-amber-100 hover:underline"
              >
                Réimporter la démo
              </Link>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-neutral-600">
              Couverture des données
            </span>
            <CoverageBadge
              label="ADR"
              available={analysis.players.filter((player) => player.metrics.adr !== null).length}
              total={analysis.players.length}
            />
            <CoverageBadge
              label="KAST"
              available={analysis.players.filter((player) => player.metrics.kastRate !== null).length}
              total={analysis.players.length}
            />
            <CoverageBadge
              label="Flashes"
              available={analysis.players.filter((player) => player.metrics.flashes != null).length}
              total={analysis.players.length}
            />
            <CoverageBadge
              label="Précision"
              available={[...mechanicsByPlayer.values()].filter((value) => value.accuracy !== null).length}
              total={analysis.players.length}
            />
          </div>
          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="border-b border-white/8 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-100">Conversion des avantages</h3>
              <p className="mt-1 text-xs text-neutral-500">
                Avantage numérique acquis après une mort ou une déconnexion pendant le round.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Équipe</th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Rounds en avantage" />
                    </th>
                    <th className="px-3 py-3 text-right font-medium">Victoires</th>
                    <th className="px-4 py-3 text-right font-medium">
                      <DefinitionTerm label="Conversion de l’avantage" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.teams.map((team) => (
                    <tr key={team.logicalTeam} className="border-t border-white/8">
                      <td className="px-4 py-3 font-semibold text-neutral-200">
                        {teamLabel(team.name)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {team.combat
                          ? <QualityMetricCell metric={team.combat.advantageRounds} format={number} />
                          : "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {team.combat
                          ? <QualityMetricCell metric={team.combat.advantageWins} format={number} />
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {team.combat
                          ? (
                            <QualityMetricCell
                              metric={team.combat.advantageConversionRate}
                              format={percent}
                            />
                          )
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-white/8 px-4 py-3 text-xs text-neutral-500">
              Chaque équipe compte au plus une opportunité par round, même si l’avantage change
              plusieurs fois de camp. Un contexte de roster ou de fin de round incomplet invalide l’agrégat.
            </p>
          </article>
          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="border-b border-white/8 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-100">Performance anti-eco</h3>
              <p className="mt-1 text-xs text-neutral-500">
                La catégorie adverse vient du snapshot d’équipement à la fin du freeze time.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Équipe</th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Rounds anti-eco" />
                    </th>
                    <th className="px-3 py-3 text-right font-medium">Victoires</th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Conversion anti-eco" />
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <DefinitionTerm label="Pertes contre eco" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.teams.map((team) => (
                    <tr key={team.logicalTeam} className="border-t border-white/8">
                      <td className="px-4 py-3 font-semibold text-neutral-200">
                        {teamLabel(team.name)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {team.economy
                          ? <QualityMetricCell metric={team.economy.antiEcoRounds} format={number} />
                          : "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {team.economy
                          ? <QualityMetricCell metric={team.economy.antiEcoWins} format={number} />
                          : "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {team.economy
                          ? <QualityMetricCell metric={team.economy.antiEcoWinRate} format={percent} />
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {team.economy
                          ? <QualityMetricCell metric={team.economy.lossesAgainstEco} format={number} />
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-white/8 px-4 py-3 text-xs text-neutral-500">
              Si une économie adverse ou l’issue d’un round manque, RoundLab laisse les agrégats
              concernés indisponibles au lieu de publier un total partiel.
            </p>
          </article>
          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="border-b border-white/8 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-100">Économie du joueur</h3>
              <p className="mt-1 text-xs text-neutral-500">
                Équipement observé avant la mort et inventaire conservé à la fin des rounds perdus.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Dépenses nettes" />
                    </th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Valeur perdue à la mort" />
                    </th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Valeur moyenne perdue" />
                    </th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Armes principales sauvegardées" />
                    </th>
                    <th className="px-4 py-3 text-right font-medium">Preuve</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedPlayers.map((player) => {
                    const economy = player.economy;
                    const evidenceId =
                      economy?.valueLostEvidence[0] ??
                      economy?.savedWeaponEvidence[0];
                    return (
                      <tr key={player.playerId} className="border-t border-white/8">
                        <td className="px-4 py-3 font-semibold text-neutral-200">
                          {player.name}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {economy
                            ? (
                              <QualityMetricCell
                                metric={economy.netSpend}
                                format={(value) => value === null
                                  ? "—"
                                  : `${Math.round(value).toLocaleString("fr-FR")} $`}
                              />
                            )
                            : "—"}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {economy
                            ? (
                              <QualityMetricCell
                                metric={economy.equipmentValueLostOnDeath}
                                format={(value) => value === null
                                  ? "—"
                                  : `${Math.round(value).toLocaleString("fr-FR")} $`}
                              />
                            )
                            : "—"}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {economy
                            ? (
                              <QualityMetricCell
                                metric={economy.averageEquipmentValueLostPerDeath}
                                format={(value) => value === null
                                  ? "—"
                                  : `${Math.round(value).toLocaleString("fr-FR")} $`}
                              />
                            )
                            : "—"}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {economy
                            ? (
                              <QualityMetricCell
                                metric={economy.savedPrimaryWeaponRounds}
                                format={number}
                              />
                            )
                            : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {evidenceId
                            ? (
                              <button
                                type="button"
                                onClick={() => onOpenEvidence(evidenceId)}
                                className="text-xs font-semibold text-emerald-300 hover:text-emerald-200 hover:underline"
                              >
                                Ouvrir
                              </button>
                            )
                            : <span className="text-neutral-600">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-white/8 px-4 py-3 text-xs text-neutral-500">
              La valeur correspond à <code>current_equip_value</code>, pas au prix d’achat historique.
              Une arme sauvegardée signifie ici une arme principale conservée en vie lors d’un round perdu.
            </p>
          </article>
          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[58rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium">Kills</th>
                    <th className="px-3 py-3 text-right font-medium">Assists</th>
                    <th className="px-3 py-3 text-right font-medium">Morts</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="K/D" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="ADR" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="KAST" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="2K" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="3K" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="4K" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="5K" /></th>
                  </tr>
                </thead>
                {analysis.teams
                  .filter((team) => team.playerIds.some((playerId) => scopedPlayerIds.has(playerId)))
                  .map((team) => (
                  <tbody key={team.logicalTeam}>
                    <tr className={[
                      "border-t border-white/10",
                      team.playerIds.some((playerId) => firstTeamPlayerIds.includes(playerId))
                        ? "bg-sky-400/[0.045]"
                        : "bg-amber-300/[0.04]",
                    ].join(" ")}>
                      <th
                        colSpan={11}
                        className={[
                          "border-l-2 px-4 py-2 text-xs font-semibold",
                          team.playerIds.some((playerId) => firstTeamPlayerIds.includes(playerId))
                            ? "border-sky-300 text-sky-200"
                            : "border-amber-300 text-amber-200",
                        ].join(" ")}
                      >
                        {teamLabel(team.name)} · {team.score ?? "—"}
                      </th>
                    </tr>
                    {scopedPlayers
                      .filter((player) => team.playerIds.includes(player.playerId))
                      .sort(
                        (left, right) =>
                          (right.metrics.kills ?? -1) - (left.metrics.kills ?? -1) ||
                          left.name.localeCompare(right.name),
                      )
                      .map((player) => {
                        const multi = player.metrics.multiKillRounds;
                        return (
                          <tr key={player.playerId} className="border-t border-white/8 hover:bg-white/[0.025]">
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPlayerId(player.playerId);
                                  setTab("rating");
                                }}
                                className="font-semibold text-neutral-200 hover:text-emerald-300"
                              >
                                {player.name}
                              </button>
                            </td>
                            <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.kills)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.assists)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{player.metrics.deaths}</td>
                            <td className={[
                              "px-3 py-3 text-right font-semibold tabular-nums",
                              performanceColor(player.metrics.kdRatio),
                            ].join(" ")}>{ratio(player.metrics.kdRatio)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.adr, 1)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{percent(player.metrics.kastRate)}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{multi?.two ?? "—"}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{multi?.three ?? "—"}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{multi?.four ?? "—"}</td>
                            <td className="px-3 py-3 text-right tabular-nums">{multi?.fivePlus ?? "—"}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                ))}
              </table>
            </div>
          </article>
        </div>
      )}

      {tab === "details" && detailSection === "timeline" && selectedRound && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[18rem_1fr]">
          <aside className="max-h-[calc(100vh-13rem)] overflow-y-auto rounded-md border border-white/10 bg-[#121515] p-2">
            {analysis.rounds.map((round) => {
              const selected = selectedRound.roundNumber === round.roundNumber;
              const winnerName = round.logicalWinner === null
                ? round.winner
                : (() => {
                  const name = analysis.teams.find(
                    (team) => team.logicalTeam === round.logicalWinner,
                  )?.name;
                  return name ? teamLabel(name) : `Équipe ${round.logicalWinner}`;
                })();
              return (
                <button
                  key={round.roundNumber}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Round ${displayRound(round.roundNumber)}, ${winnerName}`}
                  onClick={() => setSelectedRoundNumber(round.roundNumber)}
                  className={[
                    "grid w-full grid-cols-[2.5rem_1fr_auto] items-center gap-2 rounded-md px-3 py-2 text-left text-sm",
                    selected
                      ? "bg-white text-neutral-950"
                      : "text-neutral-300 hover:bg-white/[0.05]",
                  ].join(" ")}
                >
                  <span className="font-semibold tabular-nums">
                    {String(displayRound(round.roundNumber)).padStart(2, "0")}
                  </span>
                  <span className="truncate">{winnerName}</span>
                  <span className={selected ? "text-neutral-600" : "text-neutral-500"}>
                    {round.scoreA ?? "—"}–{round.scoreB ?? "—"}
                  </span>
                </button>
              );
            })}
          </aside>

          <div className="grid min-w-0 gap-6">
            <article>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <span className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
                    Analyse du round
                  </span>
                  <h2 className="mt-1 text-2xl font-semibold text-white">
                    Round {displayRound(selectedRound.roundNumber)}
                  </h2>
                </div>
                <div className="text-right">
                  <div className="text-xs text-neutral-500">Score après le round</div>
                  <div className="text-2xl font-semibold tabular-nums text-white">
                    {selectedRound.scoreA ?? "—"} – {selectedRound.scoreB ?? "—"}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric
                  label="Gagnant"
                  value={
                    selectedRound.logicalWinner === null
                      ? selectedRound.winner
                      : (() => {
                        const name = analysis.teams.find(
                          (team) => team.logicalTeam === selectedRound.logicalWinner,
                        )?.name;
                        return name ? teamLabel(name) : `Équipe ${selectedRound.logicalWinner}`;
                      })()
                  }
                />
                <Metric
                  label="Côté gagnant"
                  value={selectedRound.winner}
                />
                <Metric
                  label="Joueurs"
                  value={String(selectedRound.players.length)}
                />
              </div>
            </article>

            <article className="rounded-md border border-white/10 bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Économie au départ</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {selectedRound.economy.map((economy) => (
                  <div
                    key={economy.side}
                    className="flex items-center justify-between rounded-md border border-white/8 bg-white/[0.02] px-4 py-3"
                  >
                    <div>
                      <div className="text-xs font-semibold text-neutral-500">{economy.side}</div>
                      <div className="mt-1 text-sm font-semibold text-neutral-200">
                        <span
                          title={metricQualityTitle(economy.quality.category)}
                          tabIndex={0}
                        >
                          {economyLabel(economy.category)}
                        </span>
                      </div>
                    </div>
                    <div className="text-right text-sm tabular-nums text-neutral-300">
                      <QualityMetricCell
                        metric={economy.quality.averageEquipmentValue}
                        format={(value) => value === null
                          ? "—"
                          : `${Math.round(value).toLocaleString("fr-FR")} $`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-md border border-white/10 bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Joueurs du round</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[42rem] text-left text-sm">
                  <thead className="text-xs text-neutral-500">
                    <tr>
                      <th className="pb-2 font-medium">Joueur</th>
                      <th className="pb-2 font-medium">Équipe</th>
                      <th className="pb-2 font-medium">Côté</th>
                      <th className="pb-2 font-medium">K / D / A</th>
                      <th className="pb-2 font-medium">Dégâts</th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="KAST" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...selectedRound.players]
                      .sort(
                        (left, right) =>
                          (right.metrics.kills ?? -1) - (left.metrics.kills ?? -1) ||
                          (right.metrics.damageHealth ?? -1) - (left.metrics.damageHealth ?? -1) ||
                          left.name.localeCompare(right.name),
                      )
                      .map((player) => (
                        <tr key={player.playerId} className="border-t border-white/8">
                          <td className="py-3 font-semibold text-neutral-200">
                            {playerIdentity(player.playerId, player.name)}
                          </td>
                          <td className="py-3">
                            {player.logicalTeam === null ? "—" : `Équipe ${player.logicalTeam}`}
                          </td>
                          <td className="py-3">{player.side ?? "—"}</td>
                          <td className="py-3 tabular-nums">
                            {number(player.metrics.kills)} / {player.metrics.deaths} / {number(player.metrics.assists)}
                          </td>
                          <td className="py-3 tabular-nums">
                            {number(player.metrics.damageHealth)}
                          </td>
                          <td className="py-3">{percent(player.metrics.kastRate)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </article>

          </div>
        </div>
      )}

      {tab === "details" && detailSection === "activity" && (
        <div className="mt-6 grid gap-3">
          <p className="text-xs text-neutral-500">
            Les tirs proviennent des événements de tir de la démo. Les dégâts utilitaires restent vides quand la démo ne permet pas de les attribuer sans ambiguïté.
          </p>
          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[58rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium">Dégâts</th>
                    <th className="px-3 py-3 text-right font-medium">Dégâts HE</th>
                    <th className="px-3 py-3 text-right font-medium">Dégâts molotov</th>
                    <th className="px-3 py-3 text-right font-medium">Ennemis flashés</th>
                    <th className="px-3 py-3 text-right font-medium">Tirs</th>
                    <th className="px-4 py-3 text-right font-medium"><DefinitionTerm label="Survie" /></th>
                  </tr>
                </thead>
                <tbody>
                  {scopedPlayers.map((player) => {
                    const playerMechanics = mechanicsByPlayer.get(player.playerId);
                    return (
                      <tr key={player.playerId} className="border-t border-white/8">
                        <td className="px-4 py-3 font-semibold text-neutral-200">
                          {playerIdentity(player.playerId, player.name)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.damageHealth)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.utilityDamage?.heDamage ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.utilityDamage?.fireDamage ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.flashes?.effectiveEnemiesFlashed ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerMechanics?.shots ?? null)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {number(player.metrics.survivedRounds)}
                          {player.metrics.survivalRate !== null && (
                            <span className="ml-1 text-[10px] text-neutral-600">
                              ({percent(player.metrics.survivalRate)})
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      )}

      {tab === "details" && detailSection === "trades" && (
        <div className="mt-6 grid gap-6">
          <article>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
              Réponse collective
            </span>
            <h2 className="mt-1 text-2xl font-semibold text-white">Trades</h2>
            <p className="mt-1 max-w-2xl text-sm text-neutral-500">
              Trades tentés, réussis et morts tradées.
            </p>
          </article>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Metric
              label="Tentatives de trade"
              value={number(totalTradeAttempts)}
              detail="Dégâts de réponse valides"
            />
            <Metric
              label="Trade kills"
              value={number(totalTradeKills)}
            />
            <Metric
              label="Réussite des trades"
              value={percent(
                totalTradeAttempts === null ||
                    totalTradeAttempts === 0 ||
                    totalTradeKills === null
                  ? null
                  : totalTradeKills / totalTradeAttempts,
              )}
            />
            <Metric
              label="Morts tradées"
              value={number(totalTradeDeaths)}
            />
            <Metric
              label="Morts tradées / morts"
              value={percent(
                totalTradeDeaths === null || totalDeaths === 0
                  ? null
                  : totalTradeDeaths / totalDeaths,
              )}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <article className="rounded-md border border-white/10 bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Bilan par joueur</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[38rem] text-left text-sm">
                  <thead className="text-xs text-neutral-500">
                    <tr>
                      <th className="pb-2 font-medium">Joueur</th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Tentatives de trade" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Trade kills" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Réussite des trades" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Morts tradées" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="KAST" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...scopedPlayers]
                      .sort(
                        (left, right) =>
                          (right.metrics.tradeKills ?? -1) -
                            (left.metrics.tradeKills ?? -1) ||
                          (right.metrics.tradeDeaths ?? -1) -
                            (left.metrics.tradeDeaths ?? -1) ||
                          left.name.localeCompare(right.name),
                      )
                      .map((player) => (
                        <tr key={player.playerId} className="border-t border-white/8">
                          <td className="py-3 font-semibold text-neutral-200">
                            {playerIdentity(player.playerId, player.name)}
                          </td>
                          <td className="py-3">{number(player.metrics.tradeAttempts)}</td>
                          <td className="py-3">{number(player.metrics.tradeKills)}</td>
                          <td className="py-3">
                            {percent(
                              player.metrics.tradeAttempts === null ||
                                  player.metrics.tradeAttempts === 0 ||
                                  player.metrics.tradeKills === null
                                ? null
                                : player.metrics.tradeKills / player.metrics.tradeAttempts,
                            )}
                          </td>
                          <td className="py-3">{number(player.metrics.tradeDeaths)}</td>
                          <td className="py-3">{percent(player.metrics.kastRate)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="rounded-md border border-white/10 bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Actions de trade</h3>
              <p className="mt-1 text-xs text-neutral-500">
                Les morts tradées ouvrent la mort initiale ; les trade kills ouvrent l’élimination de réponse.
              </p>
              <div className="mt-4 max-h-[28rem] overflow-y-auto">
                <div className="grid gap-2">
                  {replayableTradeActions.map((action) => {
                    const label = action.kind === "trade_kill" ? "Trade kill" : "Mort tradée";
                    return (
                      <button
                        key={`${action.kind}-${action.playerId}-${action.evidence.evidenceId}`}
                        type="button"
                        aria-label={`${label}, ${action.playerName}, round ${displayRound(action.evidence.roundNumber)}, ouvrir dans le replay`}
                        onClick={() => onOpenEvidence(action.evidence.evidenceId)}
                        className="flex items-center justify-between gap-3 rounded-md border border-white/8 px-3 py-2 text-left hover:bg-white/[0.05]"
                      >
                        <span>
                          <span className="block text-sm font-semibold text-neutral-200">{label}</span>
                          <span className="text-xs text-neutral-500">{action.playerName}</span>
                        </span>
                        <span className="text-xs tabular-nums text-neutral-500">
                          R{displayRound(action.evidence.roundNumber)} · {action.evidence.time.toFixed(1)} s
                        </span>
                      </button>
                    );
                  })}
                  {replayableTradeActions.length === 0 && (
                    <p className="text-sm text-neutral-500">Aucune action de trade détectée.</p>
                  )}
                </div>
              </div>
            </article>
          </div>
        </div>
      )}

      {tab === "details" && detailSection === "utility" && (
        <div className="mt-6 grid gap-6">
          <article>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
              Usage vérifiable
            </span>
            <h2 className="mt-1 text-2xl font-semibold text-white">Utilitaires</h2>
            <p className="mt-1 max-w-2xl text-sm text-neutral-500">
              Lancers, efficacité des flashes et utilitaires conservés à la mort.
            </p>
          </article>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Metric
              label="Quantité"
              value={number(selectedUtilityQuality?.utilityQuantityRating.value ?? null)}
              detail="Score 0–100"
              quality={selectedUtilityQuality?.utilityQuantityRating}
            />
            <Metric
              label="Ennemis / flash"
              value={number(selectedUtilityQuality?.enemiesPerFlash.value ?? null, 2)}
              quality={selectedUtilityQuality?.enemiesPerFlash}
            />
            <Metric
              label="Alliés / flash"
              value={number(selectedUtilityQuality?.teammatesPerFlash.value ?? null, 2)}
              quality={selectedUtilityQuality?.teammatesPerFlash}
            />
            <Metric
              label="Kills / flash"
              value={number(selectedUtilityQuality?.flashKillsPerFlash.value ?? null, 2)}
              quality={selectedUtilityQuality?.flashKillsPerFlash}
            />
            <Metric
              label="Blind moyen"
              value={selectedUtilityQuality?.averageEnemyBlindDuration.value === null ||
                  selectedUtilityQuality?.averageEnemyBlindDuration.value === undefined
                ? "—"
                : `${selectedUtilityQuality.averageEnemyBlindDuration.value.toFixed(1)} s`}
              quality={selectedUtilityQuality?.averageEnemyBlindDuration}
            />
            <Metric
              label="Dégâts / HE"
              value={number(selectedUtilityQuality?.heDamagePerGrenade.value ?? null, 1)}
              quality={selectedUtilityQuality?.heDamagePerGrenade}
            />
            <Metric
              label="Dégâts alliés / HE"
              value={number(
                selectedUtilityQuality?.teammateHeDamagePerGrenade.value ?? null,
                1,
              )}
              quality={selectedUtilityQuality?.teammateHeDamagePerGrenade}
            />
            <Metric
              label="Inutilisés / mort"
              value={selectedUtilityQuality?.averageUnusedUtilityValue.value === null ||
                  selectedUtilityQuality?.averageUnusedUtilityValue.value === undefined
                ? "—"
                : `$${number(selectedUtilityQuality.averageUnusedUtilityValue.value)}`}
              detail="Valeur moyenne"
              quality={selectedUtilityQuality?.averageUnusedUtilityValue}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <article className="rounded-md border border-white/10 bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Usage par joueur</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[88rem] text-left text-sm">
                  <thead className="text-xs text-neutral-500">
                    <tr>
                      <th className="pb-2 font-medium">Joueur</th>
                      <th className="pb-2 font-medium">Quantité</th>
                      <th className="pb-2 font-medium">Total</th>
                      <th className="pb-2 font-medium">Flash</th>
                      <th className="pb-2 font-medium">Smoke</th>
                      <th className="pb-2 font-medium">HE</th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Dégâts / HE" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Alliés / HE" /></th>
                      <th className="pb-2 font-medium">Feu</th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Ennemis / flash" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Alliés / flash" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Blind moyen" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Kills / flash" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Inutilisés / mort" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...scopedPlayers]
                      .sort(
                        (left, right) =>
                          (right.metrics.grenadesThrown?.total ?? -1) -
                            (left.metrics.grenadesThrown?.total ?? -1) ||
                          left.name.localeCompare(right.name),
                      )
                      .map((player) => {
                        const utility = player.utility;
                        return (
                          <tr key={player.playerId} className="border-t border-white/8">
                            <td className="py-3 font-semibold text-neutral-200">
                              {playerIdentity(player.playerId, player.name)}
                            </td>
                            <td className="py-3">
                              {utility
                                ? (
                                  <QualityMetricCell
                                    metric={utility.utilityQuantityRating}
                                    format={(value) => number(value)}
                                  />
                                )
                                : "—"}
                            </td>
                            <td className="py-3">
                              {utility
                                ? (
                                  <QualityMetricCell
                                    metric={utility.grenadesThrown}
                                    format={(value) => number(value)}
                                  />
                                )
                                : "—"}
                            </td>
                            <td className="py-3">
                              {utility
                                ? <QualityMetricCell metric={utility.flashGrenades} format={number} />
                                : "—"}
                            </td>
                            <td className="py-3">
                              {utility
                                ? <QualityMetricCell metric={utility.smokeGrenades} format={number} />
                                : "—"}
                            </td>
                            <td className="py-3">
                              {utility
                                ? <QualityMetricCell metric={utility.heGrenades} format={number} />
                                : "—"}
                            </td>
                            <td className="py-3">
                              {utility
                                ? (
                                  <QualityMetricCell
                                    metric={utility.heDamagePerGrenade}
                                    format={(value) => number(value, 1)}
                                  />
                                )
                                : "—"}
                            </td>
                            <td className="py-3">
                              {utility
                                ? (
                                  <QualityMetricCell
                                    metric={utility.teammateHeDamagePerGrenade}
                                    format={(value) => number(value, 1)}
                                  />
                                )
                                : "—"}
                            </td>
                            <td className="py-3">
                              {utility
                                ? <QualityMetricCell metric={utility.fireGrenades} format={number} />
                                : "—"}
                            </td>
                            <td className="py-3">
                              {utility
                                ? (
                                  <QualityMetricCell
                                    metric={utility.enemiesPerFlash}
                                    format={(value) => number(value, 2)}
                                  />
                                )
                                : "—"}
                            </td>
                            <td className="py-3">
                              {utility
                                ? (
                                  <QualityMetricCell
                                    metric={utility.teammatesPerFlash}
                                    format={(value) => number(value, 2)}
                                  />
                                )
                                : "—"}
                            </td>
                            <td className="py-3">
                              {utility
                                ? (
                                  <QualityMetricCell
                                    metric={utility.averageEnemyBlindDuration}
                                    format={(value) =>
                                      value === null ? "—" : `${value.toFixed(1)} s`}
                                  />
                                )
                                : "—"}
                            </td>
                            <td className="py-3">
                              {utility
                                ? (
                                  <QualityMetricCell
                                    metric={utility.flashKillsPerFlash}
                                    format={(value) => number(value, 2)}
                                  />
                                )
                                : "—"}
                            </td>
                            <td className="py-3">
                              {utility
                                ? (
                                  <QualityMetricCell
                                    metric={utility.averageUnusedUtilityValue}
                                    format={(value) =>
                                      value === null ? "—" : `$${number(value)}`}
                                  />
                                )
                                : "—"}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
              <div className="border-b border-white/8 px-4 py-3">
                <h3 className="text-sm font-semibold text-white">
                  Répartition de {selectedPlayer?.name ?? "ce joueur"}
                </h3>
                <p className="mt-1 text-xs text-neutral-500">
                  Volume total et composition des lancers, sans score propriétaire.
                </p>
              </div>
              <div className="grid gap-px bg-white/8">
                {overviewPlayerGroups
                  .filter((team) => team.playerIds.some((playerId) => scopedPlayerIds.has(playerId)))
                  .map((team) => {
                  const players = scopedPlayers.filter((player) =>
                    team.playerIds.includes(player.playerId)
                  );
                  const complete = players.every(
                    (player) => player.metrics.grenadesThrown !== null,
                  );
                  const counts = players.reduce(
                    (total, player) => {
                      const grenades = player.metrics.grenadesThrown;
                      if (grenades === null) return total;
                      total.flash += grenades.flash;
                      total.smoke += grenades.smoke;
                      total.he += grenades.he;
                      total.fire += grenades.molotov + grenades.incendiary;
                      return total;
                    },
                    { flash: 0, smoke: 0, he: 0, fire: 0 },
                  );
                  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
                  const segments = [
                    ["Flash", counts.flash, "bg-violet-300"],
                    ["Smoke", counts.smoke, "bg-sky-300"],
                    ["HE", counts.he, "bg-amber-300"],
                    ["Feu", counts.fire, "bg-rose-300"],
                  ] as const;
                  return (
                    <section key={team.key} className="bg-[#121515] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className={[
                            "size-1.5 rounded-full",
                            team.accent === "sky"
                              ? "bg-sky-300"
                              : team.accent === "amber"
                                ? "bg-amber-300"
                                : "bg-neutral-500",
                          ].join(" ")} />
                          <span className="text-sm font-semibold text-neutral-200">
                            {teamLabel(team.name)}
                          </span>
                        </div>
                        <span className="text-lg font-semibold tabular-nums text-white">
                          {complete ? total : "—"}
                        </span>
                      </div>
                      <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                        {segments.map(([label, count, color]) => (
                          <span
                            key={label}
                            className={color}
                            style={{ width: `${total === 0 ? 0 : (count / total) * 100}%` }}
                          />
                        ))}
                      </div>
                      <div className="mt-3 grid grid-cols-4 gap-2">
                        {segments.map(([label, count, color]) => (
                          <div key={label}>
                            <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
                              <span className={["size-1 rounded-full", color].join(" ")} />
                              {label}
                            </div>
                            <div className="mt-0.5 text-sm font-semibold tabular-nums text-neutral-200">
                              {complete ? count : "—"}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </article>
          </div>

          <article className="rounded-md border border-white/10 bg-[#121515] p-5">
            <h3 className="text-sm font-semibold text-white">Actions utilitaires</h3>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {replayableUtilityActions.slice(0, 60).map((action) => {
                const label = action.kind === "grenade_throw"
                  ? "Grenade lancée"
                  : action.kind === "flash_assist"
                  ? "Flash assist"
                  : "Utilitaire conservé à la mort";
                return (
                  <button
                    key={`${action.kind}-${action.playerId}-${action.evidence.evidenceId}`}
                    type="button"
                    aria-label={`${label}, ${action.playerName}, round ${displayRound(action.evidence.roundNumber)}, ouvrir dans le replay`}
                    onClick={() => onOpenEvidence(action.evidence.evidenceId)}
                    className="flex items-center justify-between gap-3 rounded-md border border-white/8 px-3 py-2 text-left hover:bg-white/[0.05]"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-neutral-200">{label}</span>
                      <span className="text-xs text-neutral-500">{action.playerName}</span>
                    </span>
                    <span className="text-xs tabular-nums text-neutral-500">
                      R{displayRound(action.evidence.roundNumber)} · {action.evidence.time.toFixed(1)} s
                    </span>
                  </button>
                );
              })}
              {replayableUtilityActions.length === 0 && (
                <p className="text-sm text-neutral-500">Aucune action utilitaire disponible.</p>
              )}
            </div>
          </article>
        </div>
      )}

      {tab === "details" && detailSection === "aim" && (
        <div className="mt-6 grid gap-6">
          <article>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
              Mécaniques de tir
            </span>
            <h2 className="mt-1 text-2xl font-semibold text-white">Aim</h2>
            <p className="mt-1 max-w-3xl text-sm text-neutral-500">
              Mesures observées, reconstruites ou estimées depuis la démo, avec couverture et limites explicites.
            </p>
          </article>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Metric
              label="Précision tous tirs"
              value={percent(
                totalAimShots === null ||
                totalAimShots === 0 ||
                totalAimHitShots === null
                  ? null
                  : totalAimHitShots / totalAimShots,
              )}
            />
            <Metric
              label="Précision sur ennemi repéré"
              value={percent(spottedAccuracy)}
              detail={totalSpottedShots === null ? undefined : `${totalSpottedShots} tirs évalués`}
            />
            <Metric
              label="Temps avant dégâts"
              value={averageTimeToDamage === null ? "—" : `${number(averageTimeToDamage)} ms`}
              detail="Nécessite la géométrie de carte"
            />
            <Metric
              label="Erreur initiale du viseur"
              value={averageCrosshairError === null ? "—" : `${number(averageCrosshairError, 1)}°`}
            />
            <Metric
              label="Spray accuracy"
              value={percent(averageSprayAccuracy)}
            />
            <Metric
              label="Arrêt avant tir"
              value={percent(averageCounterStrafe)}
            />
          </div>

          <details className="group overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 hover:bg-white/[0.025]">
              <span>
                <span className="block text-sm font-semibold text-neutral-100">Données brutes de tir</span>
                <span className="mt-1 block text-xs text-neutral-500">
                  Volumes, zones d’impact et séquences utilisés pour calculer les métriques.
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-neutral-500 group-open:hidden">Afficher</span>
              <span className="hidden shrink-0 text-xs font-semibold text-neutral-500 group-open:inline">Masquer</span>
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[80rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium">Tirs</th>
                    <th className="px-3 py-3 text-right font-medium">Touchés</th>
                    <th className="px-3 py-3 text-right font-medium">Dégâts</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Dégâts / impact" /></th>
                    <th className="px-3 py-3 text-right font-medium">Tête</th>
                    <th className="px-3 py-3 text-right font-medium">Corps</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Tap" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Burst" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Spray" /></th>
                    <th className="px-4 py-3 text-right font-medium">
                      <DefinitionTerm label="Tirs en mouvement" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scopedPlayers.map((player) => {
                    const playerMechanics = mechanicsByPlayer.get(player.playerId);
                    return (
                      <tr key={player.playerId} className="border-t border-white/8">
                        <td className="px-4 py-3 font-semibold text-neutral-200">
                          <span className={[
                            "mr-2 inline-block size-1.5 rounded-full align-middle",
                            firstTeamPlayerIds.includes(player.playerId)
                              ? "bg-sky-300"
                              : secondTeamPlayerIds.includes(player.playerId)
                                ? "bg-amber-300"
                                : "bg-neutral-500",
                          ].join(" ")} />
                          {player.name}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics && <QualityMetricCell metric={playerMechanics.metrics.shots} format={number} />}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics && <QualityMetricCell metric={playerMechanics.metrics.hitShots} format={number} />}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics && <QualityMetricCell metric={playerMechanics.metrics.damage} format={number} />}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics && (
                            <QualityMetricCell
                              metric={playerMechanics.metrics.averageDamagePerHit}
                              format={(value) => number(value, 1)}
                            />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics && <QualityMetricCell metric={playerMechanics.metrics.headHits} format={number} />}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics && <QualityMetricCell metric={playerMechanics.metrics.bodyHits} format={number} />}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics && <QualityMetricCell metric={playerMechanics.metrics.tapSequences} format={number} />}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics && <QualityMetricCell metric={playerMechanics.metrics.burstSequences} format={number} />}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics && <QualityMetricCell metric={playerMechanics.metrics.spraySequences} format={number} />}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {playerMechanics && <QualityMetricCell metric={playerMechanics.metrics.movingShots} format={number} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-white/8 px-4 py-3 text-xs text-neutral-500">
              Toutes les valeurs utilisent le contrat Aim V3. Les impacts et dégâts restent vides si
              leur association aux tirs n’est pas assez fiable.
            </p>
          </details>

          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="border-b border-white/8 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-100">Métriques avancées</h3>
              <p className="mt-1 text-xs text-neutral-500">
                Chaque valeur affiche son nombre d’échantillons lorsqu’il est disponible.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[96rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Tirs ennemi repéré" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Précision sur ennemi repéré" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Time to damage" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Erreur initiale du viseur" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Head accuracy" /></th>
                    <th className="px-3 py-3 text-right font-medium">Première balle</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Spray accuracy" /></th>
                    <th className="px-3 py-3 text-right font-medium">Tirs accroupis</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Tirs scoped" /></th>
                    <th className="px-3 py-3 text-right font-medium">Wallbangs</th>
                    <th className="px-3 py-3 text-right font-medium">Distance / hit</th>
                    <th className="px-3 py-3 text-right font-medium">Exposition avant tir</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Arrêt avant tir" /></th>
                    <th className="px-4 py-3 text-right font-medium"><DefinitionTerm label="Accuracy all" /></th>
                  </tr>
                </thead>
                <tbody>
                  {scopedPlayers.map((player) => {
                    const playerMechanics = mechanicsByPlayer.get(player.playerId);
                    return (
                      <tr key={player.playerId} className="border-t border-white/8">
                        <td className="px-4 py-3 font-semibold text-neutral-200">
                          <span className={[
                            "mr-2 inline-block size-1.5 rounded-full align-middle",
                            firstTeamPlayerIds.includes(player.playerId)
                              ? "bg-sky-300"
                              : secondTeamPlayerIds.includes(player.playerId)
                                ? "bg-amber-300"
                                : "bg-neutral-500",
                          ].join(" ")} />
                          {player.name}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics && (
                            <QualityMetricCell metric={playerMechanics.metrics.spottedShots} format={number} />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {playerMechanics && (
                            <QualityMetricCell metric={playerMechanics.metrics.spottedAccuracy} format={percent} />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics && (
                            <QualityMetricCell
                              metric={playerMechanics.metrics.timeToDamageMs}
                              format={(value) => value === null ? "—" : `${Math.round(value)} ms`}
                            />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics && (
                            <QualityMetricCell
                              metric={playerMechanics.metrics.crosshairErrorDegrees}
                              format={(value) => value === null ? "—" : `${value.toFixed(1)}°`}
                            />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {playerMechanics && (
                            <QualityMetricCell metric={playerMechanics.metrics.headAccuracy} format={percent} />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {playerMechanics && (
                            <QualityMetricCell metric={playerMechanics.metrics.firstBulletAccuracy} format={percent} />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {playerMechanics && (
                            <QualityMetricCell metric={playerMechanics.metrics.sprayAccuracy} format={percent} />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {playerMechanics && (
                            <QualityMetricCell metric={playerMechanics.metrics.crouchedShots} format={number} />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {playerMechanics && (
                            <QualityMetricCell metric={playerMechanics.metrics.scopedShots} format={number} />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {playerMechanics && (
                            <QualityMetricCell metric={playerMechanics.metrics.wallbangKills} format={number} />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {playerMechanics && (
                            <QualityMetricCell
                              metric={playerMechanics.metrics.averageDuelDistance}
                              format={(value) => number(value, 0)}
                            />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {playerMechanics && (
                            <QualityMetricCell
                              metric={playerMechanics.metrics.exposureBeforeShotMs}
                              format={(value) => value === null ? "—" : `${Math.round(value)} ms`}
                            />
                          )}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {playerMechanics && (
                            <QualityMetricCell metric={playerMechanics.metrics.counterStrafeRate} format={percent} />
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {playerMechanics && (
                            <QualityMetricCell metric={playerMechanics.metrics.accuracy} format={percent} />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-white/8 px-4 py-3 text-xs text-neutral-500">
              La précision sur ennemi repéré utilise le masque réseau comme signal secondaire. Les délais,
              distances, postures et erreurs angulaires sont des estimations dépendantes de l’échantillonnage GOTV.
              « Erreur initiale du viseur » mesure l’angle à notre première visibilité combinée ; « Arrêt avant tir »
              détecte un freinage cinématique rapide, pas une touche clavier. « Tirs scoped » utilise la dernière
              frame strictement antérieure au tir dans une fenêtre de 250 ms ; cette valeur reste donc une estimation.
            </p>
          </article>

        </div>
      )}

      {tab === "details" && detailSection === "weapons" && (
        <div className="mt-6 grid gap-4">
          <article className="rounded-md border border-white/10 bg-[#121515] p-4">
            <h3 className="text-sm font-semibold text-neutral-100">Périmètre</h3>
            <p className="mt-1 text-xs text-neutral-500">
              Les filtres s’appliquent aux tirs, dégâts et kills du tableau.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="grid gap-1 text-[11px] font-medium text-neutral-500">
                Joueur
                <span className="flex h-9 items-center rounded-md border border-white/10 bg-[#0d0f0f] px-3 text-sm font-semibold text-neutral-200">
                  {selectedPlayer?.name ?? "—"}
                </span>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-neutral-500">
                Équipe
                <select
                  value={weaponTeamId}
                  onChange={(event) => setWeaponTeamId(event.target.value)}
                  className="h-9 rounded-md border border-white/10 bg-[#0d0f0f] px-3 text-sm text-neutral-200"
                >
                  <option value="all">Toutes les équipes</option>
                  {analysis.teams.map((team) => (
                    <option key={team.logicalTeam} value={team.logicalTeam}>
                      {teamLabel(team.name)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-neutral-500">
                Côté
                <select
                  value={weaponSide}
                  onChange={(event) => setWeaponSide(event.target.value as "all" | "T" | "CT")}
                  className="h-9 rounded-md border border-white/10 bg-[#0d0f0f] px-3 text-sm text-neutral-200"
                >
                  <option value="all">T + CT</option>
                  <option value="T">Terroristes</option>
                  <option value="CT">Contre-terroristes</option>
                </select>
              </label>
              <label className="grid gap-1 text-[11px] font-medium text-neutral-500">
                Round
                <select
                  value={weaponRoundNumber}
                  onChange={(event) => setWeaponRoundNumber(event.target.value)}
                  className="h-9 rounded-md border border-white/10 bg-[#0d0f0f] px-3 text-sm text-neutral-200"
                >
                  <option value="all">Tous les rounds</option>
                  {analysis.rounds.map((round) => (
                    <option key={round.roundNumber} value={round.roundNumber}>
                      Round {displayRound(round.roundNumber)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </article>

          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/8 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-neutral-100">Statistiques par arme</h3>
                <p className="mt-1 text-xs text-neutral-500">
                  Un tir touché est un tir associé à au moins un événement de dégâts.
                </p>
              </div>
              <span className={[
                "rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide",
                weaponAssociationSamples > 0 &&
                  weaponAssociationUsable === weaponAssociationSamples
                  ? "bg-emerald-300/[0.08] text-emerald-200"
                  : "bg-amber-300/[0.08] text-amber-200",
              ].join(" ")}>
                Association {weaponAssociationUsable}/{weaponAssociationSamples}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Arme</th>
                    <th className="px-3 py-3 text-right font-medium">Tirs</th>
                    <th className="px-3 py-3 text-right font-medium">Tirs touchés</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Précision tous tirs" /></th>
                    <th className="px-3 py-3 text-right font-medium">Dégâts</th>
                    <th className="px-3 py-3 text-right font-medium">Kills</th>
                    <th className="px-4 py-3 text-right font-medium">HS kills</th>
                  </tr>
                </thead>
                <tbody>
                  {weaponRows.map((row) => {
                    const accuracyMetric = qualityMetric({
                      value: row.reliableShots === 0
                        ? null
                        : row.hitShots / row.reliableShots,
                      unit: "ratio",
                      sampleCount: row.shots,
                      usableSampleCount: row.reliableShots,
                      provenance: "reconstructed",
                      confidence:
                        row.reliableShots === 0
                          ? "unavailable"
                          : row.reliableShots === row.shots
                            ? "high"
                            : "medium",
                      unavailableReasons:
                        row.shots === 0
                          ? ["no_shots"]
                          : row.reliableShots < row.shots
                            ? ["incomplete_shot_associations"]
                            : [],
                      formulaVersion: "roundlab.aim.v3.accuracyByWeapon.filtered",
                    });
                    return (
                      <tr key={row.weapon} className="border-t border-white/8">
                        <td className="px-4 py-3 font-semibold text-neutral-200">
                          {weaponLabel(row.weapon)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{mechanics ? row.shots : "—"}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {row.reliableShots > 0 ? row.hitShots : "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-emerald-200">
                          <QualityMetricCell metric={accuracyMetric} format={percent} />
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {row.reliableShots > 0 ? row.damage : "—"}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{row.kills}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.headshotKills}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {weaponRows.length === 0 && (
              <p className="border-t border-white/8 px-4 py-5 text-sm text-neutral-500">
                Aucune donnée d’arme ne correspond à ces filtres.
              </p>
            )}
            {mechanics && weaponRows.length > 0 &&
              weaponAssociationUsable < weaponAssociationSamples && (
              <p className="border-t border-amber-300/10 bg-amber-300/[0.025] px-4 py-3 text-xs leading-relaxed text-amber-100/70">
                Les lignes calculent la précision uniquement sur les tirs fiables et affichent leur
                couverture. Une ligne sans tir fiable reste volontairement vide.
              </p>
            )}
          </article>
        </div>
      )}

      {tab === "details" && detailSection === "openings" && (
        <div className="mt-6 grid gap-6">
          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-neutral-100">Opening duels</h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Fréquence d’engagement, réussite et réponse de l’équipe après une mort d’ouverture.
                </p>
              </div>
              <div className="flex rounded-[4px] bg-black/25 p-0.5" aria-label="Filtrer les openings par côté">
                {([
                  ["all", "Global"],
                  ["T", "T"],
                  ["CT", "CT"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={value === "all" ? "Openings tous côtés" : `Openings côté ${value}`}
                    aria-pressed={openingSide === value}
                    onClick={() => setOpeningSide(value)}
                    className={[
                      "min-w-12 rounded-[3px] px-3 py-1.5 text-[11px] font-semibold transition-colors",
                      openingSide === value
                        ? "bg-white/[0.1] text-neutral-100"
                        : "text-neutral-500 hover:text-neutral-200",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Tentatives d'opening" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Réussite opening" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Morts tradées" /></th>
                    <th className="px-3 py-3 text-right font-medium">Adversaire principal</th>
                    <th className="px-3 py-3 text-right font-medium">Meilleure arme</th>
                    <th className="px-4 py-3 text-right font-medium">Plus souvent tué par</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedPlayers.map((player) => {
                    const scopedPlayer = openingSide === "all"
                      ? player
                      : player.bySide[openingSide];
                    const scopedMetrics = scopedPlayer?.metrics ?? null;
                    const scopedEvidence = scopedPlayer?.metricEvidence ?? null;
                    const attempts = scopedMetrics?.openingAttempts ?? null;
                    const openingWins = analysis.evidence.filter((proof) =>
                      scopedEvidence?.openingWins.includes(proof.evidenceId) ?? false
                    );
                    const openingLosses = analysis.evidence.filter((proof) =>
                      scopedEvidence?.openingLosses.includes(proof.evidenceId) ?? false
                    );
                    const mainVictimId = mostFrequent(
                      openingWins.map((proof) => proof.actors[1]).filter(Boolean),
                    );
                    const mainKillerId = mostFrequent(
                      openingLosses.map((proof) => proof.actors[0]).filter(Boolean),
                    );
                    const bestWeapon = mostFrequent(
                      openingWins.map((proof) => proof.weapon).filter(
                        (weapon): weapon is string => Boolean(weapon),
                      ),
                    );
                    const tradedOpeningDeaths = new Set(
                      (scopedEvidence?.openingLosses ?? []).filter((evidenceId) =>
                        scopedEvidence?.tradeDeaths.includes(evidenceId)
                      ),
                    ).size;
                    const roundsPlayed = scopedMetrics?.roundsPlayed ?? 0;
                    const openingWinsCount = scopedMetrics?.openingWins ?? null;
                    return (
                      <tr key={player.playerId} className="border-t border-white/8">
                        <td className="px-4 py-3 font-semibold text-neutral-200">
                          {playerIdentity(player.playerId, player.name)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {number(attempts)}
                          {attempts !== null && roundsPlayed > 0 && (
                            <span className="ml-1 text-[10px] text-neutral-600">
                              ({percent(attempts / roundsPlayed)})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {number(openingWinsCount)}
                          {attempts !== null && attempts > 0 && openingWinsCount !== null && (
                            <span className="ml-1 text-[10px] text-emerald-300/70">
                              ({percent(openingWinsCount / attempts)})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {tradedOpeningDeaths}
                          {openingLosses.length > 0 && (
                            <span className="ml-1 text-[10px] text-neutral-600">
                              ({percent(tradedOpeningDeaths / openingLosses.length)})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right text-neutral-400">
                          {analysis.players.find((candidate) => candidate.playerId === mainVictimId)?.name ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-right text-neutral-400">{weaponLabel(bestWeapon)}</td>
                        <td className="px-4 py-3 text-right text-neutral-400">
                          {analysis.players.find((candidate) => candidate.playerId === mainKillerId)?.name ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>

          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="border-b border-white/8 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-200">Détail par round</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <thead className="text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Round</th>
                    <th className="px-3 py-2 font-medium">Attaquant</th>
                    <th className="px-3 py-2 font-medium">Victime</th>
                    <th className="px-3 py-2 font-medium">Côté</th>
                    <th className="px-3 py-2 font-medium">Arme</th>
                    <th className="px-3 py-2 font-medium">Temps</th>
                    <th className="px-4 py-2 text-right font-medium">Replay</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOpeningEvents.map((proof) => (
                    <tr key={proof.evidenceId} className="border-t border-white/8">
                      <td className="px-4 py-3 tabular-nums">{displayRound(proof.roundNumber)}</td>
                      <td className="px-3 py-3">
                        {analysis.players.find((player) => player.playerId === proof.actors[0])?.name ?? "—"}
                      </td>
                      <td className="px-3 py-3">
                        {analysis.players.find((player) => player.playerId === proof.actors[1])?.name ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-neutral-400">
                        {roundPlayerSide.get(`${proof.roundNumber}:${proof.actors[0]}`) ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-neutral-400">{weaponLabel(proof.weapon ?? null)}</td>
                      <td className="px-3 py-3 tabular-nums">{proof.time.toFixed(1)} s</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onOpenEvidence(proof.evidenceId)}
                          className="font-semibold text-emerald-300 hover:underline"
                        >
                          Voir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      )}

      {tab === "details" && detailSection === "clutches" && (
        <div className="mt-6 grid gap-6">
          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[54rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="1v1" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="1v2" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="1v3" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="1v4" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="1v5+" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Opportunités" /></th>
                    <th className="px-3 py-3 text-right font-medium">Gagnés</th>
                    <th className="px-3 py-3 text-right font-medium">Perdus</th>
                    <th className="px-4 py-3 text-right font-medium">Réussite</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedPlayers.map((player) => {
                    const opportunities = player.metrics.clutchOpportunities;
                    const wins = player.metrics.clutchWins;
                    const totalOpportunities = opportunities === null
                      ? null
                      : Object.values(opportunities).reduce((total, value) => total + value, 0);
                    const totalWins = wins === null
                      ? null
                      : Object.values(wins).reduce((total, value) => total + value, 0);
                    const totalLosses = totalOpportunities === null || totalWins === null
                      ? null
                      : Math.max(0, totalOpportunities - totalWins);
                    const successRate = totalOpportunities === null || totalOpportunities === 0 || totalWins === null
                      ? null
                      : totalWins / totalOpportunities;
                    const clutchCell = (
                      opportunityCount: number | undefined,
                      winCount: number | undefined,
                    ) => opportunities === null || wins === null
                      ? "—"
                      : `${winCount ?? 0}/${opportunityCount ?? 0}`;
                    return (
                      <tr key={player.playerId} className="border-t border-white/8">
                        <td className="px-4 py-3 font-semibold text-neutral-200">
                          {playerIdentity(player.playerId, player.name)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsOne, wins?.oneVsOne)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsTwo, wins?.oneVsTwo)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsThree, wins?.oneVsThree)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsFour, wins?.oneVsFour)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsFivePlus, wins?.oneVsFivePlus)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(totalOpportunities)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-emerald-200">{number(totalWins)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-rose-200">{number(totalLosses)}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{percent(successRate)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      )}

      {tab === "headToHead" && headToHeadPlayerA && headToHeadPlayerB && (
        <div className="mt-6 grid gap-6">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
            <label className="grid gap-1 text-xs text-neutral-500">
              Joueur A
              <select
                aria-label="Joueur A à comparer"
                value={effectiveHeadToHeadPlayerAId}
                onChange={(event) => setHeadToHeadPlayerAId(event.target.value)}
                className="h-10 rounded-md border border-white/10 bg-[#121515] px-3 text-sm text-neutral-200"
              >
                {analysis.players
                  .filter((player) => player.playerId !== effectiveHeadToHeadPlayerBId)
                  .map((player) => (
                    <option key={player.playerId} value={player.playerId}>
                      {headToHeadOptionLabel(player.playerId, player.name)}
                    </option>
                  ))}
              </select>
            </label>
            <span className="hidden pb-2 text-xs text-neutral-600 sm:block">contre</span>
            <label className="grid gap-1 text-xs text-neutral-500">
              Joueur B
              <select
                aria-label="Joueur B à comparer"
                value={effectiveHeadToHeadPlayerBId}
                onChange={(event) => setHeadToHeadPlayerBId(event.target.value)}
                className="h-10 rounded-md border border-white/10 bg-[#121515] px-3 text-sm text-neutral-200"
              >
                {analysis.players
                  .filter((player) => player.playerId !== effectiveHeadToHeadPlayerAId)
                  .map((player) => (
                    <option key={player.playerId} value={player.playerId}>
                      {headToHeadOptionLabel(player.playerId, player.name)}
                    </option>
                  ))}
              </select>
            </label>
          </div>

          <article className="grid gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 md:grid-cols-[1fr_12rem_1fr]">
            <div className="bg-[#121515] p-5">
              <h2 className="text-lg font-semibold text-white">{headToHeadPlayerA.name}</h2>
              <p className="mt-1 text-sm text-neutral-500">
                {number(headToHeadPlayerA.metrics.kills)} / {number(headToHeadPlayerA.metrics.assists)} / {headToHeadPlayerA.metrics.deaths}
              </p>
            </div>
            <div className="grid grid-cols-2 bg-[#0e1010] p-5 text-center">
              <div>
                <div className="text-2xl font-semibold text-white">
                  {headToHeadKills(headToHeadPlayerA.playerId, headToHeadPlayerB.playerId).length}
                </div>
                <div className="text-[10px] uppercase text-neutral-600">Kills</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-white">
                  {headToHeadKills(headToHeadPlayerB.playerId, headToHeadPlayerA.playerId).length}
                </div>
                <div className="text-[10px] uppercase text-neutral-600">Kills</div>
              </div>
            </div>
            <div className="bg-[#121515] p-5 text-right">
              <h2 className="text-lg font-semibold text-white">{headToHeadPlayerB.name}</h2>
              <p className="mt-1 text-sm text-neutral-500">
                {number(headToHeadPlayerB.metrics.kills)} / {number(headToHeadPlayerB.metrics.assists)} / {headToHeadPlayerB.metrics.deaths}
              </p>
            </div>
          </article>

          <div className="grid gap-6 lg:grid-cols-3">
            <article className="rounded-md border border-white/10 bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Aim</h3>
              <div className="mt-4 grid gap-3 text-sm">
                <div className="flex justify-between"><span className="text-neutral-500">Dégâts directs</span><span>{number(headToHeadDamage(headToHeadPlayerA.playerId, headToHeadPlayerB.playerId))} / {number(headToHeadDamage(headToHeadPlayerB.playerId, headToHeadPlayerA.playerId))}</span></div>
                <div className="flex justify-between"><span className="text-neutral-500">HS kill %</span><span>{percent(headToHeadPlayerA.metrics.headshotRate)} / {percent(headToHeadPlayerB.metrics.headshotRate)}</span></div>
                <div className="flex justify-between"><span className="text-neutral-500">Accuracy all</span><span>{percent(mechanicsByPlayer.get(headToHeadPlayerA.playerId)?.accuracy ?? null)} / {percent(mechanicsByPlayer.get(headToHeadPlayerB.playerId)?.accuracy ?? null)}</span></div>
                <div className="flex justify-between"><span className="text-neutral-500">Arrêt avant tir</span><span>{percent(mechanicsByPlayer.get(headToHeadPlayerA.playerId)?.counterStrafeRate ?? null)} / {percent(mechanicsByPlayer.get(headToHeadPlayerB.playerId)?.counterStrafeRate ?? null)}</span></div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Erreur initiale du viseur</span>
                  <span>
                    {number(mechanicsByPlayer.get(headToHeadPlayerA.playerId)?.crosshairErrorDegrees ?? null, 1)}° / {number(mechanicsByPlayer.get(headToHeadPlayerB.playerId)?.crosshairErrorDegrees ?? null, 1)}°
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Time to damage</span>
                  <span>
                    {number(mechanicsByPlayer.get(headToHeadPlayerA.playerId)?.timeToDamageMs ?? null)} ms / {number(mechanicsByPlayer.get(headToHeadPlayerB.playerId)?.timeToDamageMs ?? null)} ms
                  </span>
                </div>
              </div>
            </article>
            <article className="rounded-md border border-white/10 bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Armes du duel</h3>
              <div className="mt-4 grid gap-3 text-sm">
                <div>
                  <div className="text-xs font-semibold text-sky-200">{headToHeadPlayerA.name}</div>
                  <div className="mt-1 text-neutral-400">
                    {headToHeadWeaponSummary(headToHeadPlayerA.playerId, headToHeadPlayerB.playerId)
                      .map(([weapon, count]) => `${weaponLabel(weapon)} ×${count}`)
                      .join(" · ") || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-amber-200">{headToHeadPlayerB.name}</div>
                  <div className="mt-1 text-neutral-400">
                    {headToHeadWeaponSummary(headToHeadPlayerB.playerId, headToHeadPlayerA.playerId)
                      .map(([weapon, count]) => `${weaponLabel(weapon)} ×${count}`)
                      .join(" · ") || "—"}
                  </div>
                </div>
              </div>
            </article>
            <article className="rounded-md border border-white/10 bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Flashes</h3>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="font-semibold text-sky-200">{headToHeadPlayerA.name}</span>
                <span className="tabular-nums text-neutral-300">
                  {headToHeadFlashes(headToHeadPlayerA.playerId, headToHeadPlayerB.playerId)}
                  <span className="mx-2 text-neutral-700">/</span>
                  {headToHeadFlashes(headToHeadPlayerB.playerId, headToHeadPlayerA.playerId)}
                </span>
                <span className="font-semibold text-amber-200">{headToHeadPlayerB.name}</span>
              </div>
              <p className="mt-3 text-xs text-neutral-500">Aveuglements directs entre les deux joueurs.</p>
            </article>
          </div>
        </div>
      )}

      {tab === "rating" && selectedPlayer && (
        <div className="mt-6 grid gap-6">
          <div>
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-neutral-600">
                Profil joueur
              </span>
              <h2 className="mt-1 text-xl font-semibold text-white">{selectedPlayer.name}</h2>
              <p className="mt-1 text-sm text-neutral-500">
                Synthèse de ses contributions mesurées et détail round par round.
              </p>
            </div>
          </div>

          <article className="grid overflow-hidden border-y border-white/10 bg-[#121515] md:grid-cols-2 xl:grid-cols-4">
            <section className="p-5">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.13em] text-neutral-600">
                Combat
              </h3>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Metric label="K/D" value={ratio(selectedPlayer.metrics.kdRatio)} />
                <Metric label="ADR" value={number(selectedPlayer.metrics.adr, 1)} />
                <Metric label="KAST" value={percent(selectedPlayer.metrics.kastRate)} />
                <Metric label="Dégâts" value={number(selectedPlayer.metrics.damageHealth)} />
              </div>
            </section>
            <section className="border-t border-white/8 p-5 md:border-l md:border-t-0">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.13em] text-neutral-600">
                Aim
              </h3>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Metric label="Précision" value={percent(mechanicsByPlayer.get(selectedPlayer.playerId)?.accuracy ?? null)} />
                <Metric label="Spray" value={percent(mechanicsByPlayer.get(selectedPlayer.playerId)?.sprayAccuracy ?? null)} />
                <Metric label="HS kill" value={percent(selectedPlayer.metrics.headshotRate)} />
                <Metric label="Arrêt avant tir" value={percent(mechanicsByPlayer.get(selectedPlayer.playerId)?.counterStrafeRate ?? null)} />
              </div>
            </section>
            <section className="border-t border-white/8 p-5 xl:border-l xl:border-t-0">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.13em] text-neutral-600">
                Utilitaires
              </h3>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Metric
                  label="Lancers"
                  value={number(selectedUtilityQuality?.grenadesThrown.value ?? null)}
                  quality={selectedUtilityQuality?.grenadesThrown}
                />
                <Metric
                  label="Quantité"
                  value={number(selectedUtilityQuality?.utilityQuantityRating.value ?? null)}
                  quality={selectedUtilityQuality?.utilityQuantityRating}
                />
                <Metric
                  label="Ennemis flashés"
                  value={number(selectedUtilityQuality?.effectiveEnemiesFlashed.value ?? null)}
                  quality={selectedUtilityQuality?.effectiveEnemiesFlashed}
                />
                <Metric
                  label="Dégâts HE"
                  value={number(selectedUtilityQuality?.heDamage.value ?? null)}
                  quality={selectedUtilityQuality?.heDamage}
                />
              </div>
            </section>
            <section className="border-t border-white/8 p-5 md:border-l xl:border-t-0">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.13em] text-neutral-600">
                Jeu collectif
              </h3>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Metric label="Openings gagnés" value={number(selectedPlayer.metrics.openingWins)} />
                <Metric label="Trade kills" value={number(selectedPlayer.metrics.tradeKills)} />
                <Metric label="Rotations" value={spatial ? String(selectedRotations.length) : "—"} />
                <Metric
                  label="Clutches"
                  value={number(
                    selectedPlayer.metrics.clutchWins === null
                      ? null
                      : Object.values(selectedPlayer.metrics.clutchWins).reduce((total, value) => total + value, 0),
                  )}
                />
              </div>
            </section>
          </article>

          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="border-b border-white/8 px-4 py-3">
              <h3 className="text-sm font-semibold text-neutral-200">Performance par round</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Round</th>
                    <th className="px-3 py-2 text-right font-medium">K</th>
                    <th className="px-3 py-2 text-right font-medium">A</th>
                    <th className="px-3 py-2 text-right font-medium">D</th>
                    <th className="px-3 py-2 text-right font-medium">Dégâts</th>
                    <th className="px-4 py-2 text-right font-medium"><DefinitionTerm label="KAST" /></th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.rounds.map((round) => {
                    const playerRound = round.players.find((player) => player.playerId === selectedPlayer.playerId);
                    return (
                      <tr key={round.roundNumber} className="border-t border-white/8">
                        <td className="px-4 py-3 tabular-nums">{displayRound(round.roundNumber)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerRound?.metrics.kills ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerRound?.metrics.assists ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{playerRound?.metrics.deaths ?? "—"}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerRound?.metrics.damageHealth ?? null)}</td>
                        <td className="px-4 py-3 text-right">{percent(playerRound?.metrics.kastRate ?? null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
        </div>
      )}

      {tab === "mapZones" && selectedPlayer && (
        <div className="mt-6 grid gap-6">
          <article>
            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-neutral-500">
              Lecture visuelle
            </span>
            <h2 className="mt-1 text-2xl font-semibold text-white">Positionnement</h2>
            <p className="mt-1 max-w-3xl text-sm text-neutral-500">
              Trajectoires et positions enregistrées dans la démo.
            </p>
          </article>

          <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
            <aside className="rounded-md border border-white/10 bg-[#121515] p-2">
              {rankedPlayers.map((player) => (
                <button
                  key={player.playerId}
                  type="button"
                  aria-pressed={selectedPlayer.playerId === player.playerId}
                  onClick={() => setSelectedPlayerId(player.playerId)}
                  className={[
                    "flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm",
                    selectedPlayer.playerId === player.playerId
                      ? "bg-white text-neutral-950"
                      : "text-neutral-300 hover:bg-white/[0.05]",
                  ].join(" ")}
                >
                  <span className="truncate font-medium">{player.name}</span>
                  <span className="text-xs tabular-nums">
                    {player.metrics.roundsPlayed} R
                  </span>
                </button>
              ))}
            </aside>

            <div className="grid min-w-0 gap-6">
              <article className="rounded-md border border-white/10 bg-[#121515] p-5">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{selectedPlayer.name}</h3>
                    <p className="mt-1 max-w-xl text-sm text-neutral-500">
                      La vue condensée superpose les déplacements, le point de mort et les trajectoires d’utilitaires de tous ses rounds.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenPositioning(selectedPlayer.playerId)}
                    className="rounded-md bg-emerald-300 px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-emerald-200"
                  >
                    Voir les trajectoires de {selectedPlayer.name}
                  </button>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Metric
                    label="Zones visitées"
                    value={number(selectedSpatialQuality?.uniqueZonesVisited.value ?? null)}
                    quality={selectedSpatialQuality?.uniqueZonesVisited}
                  />
                  <Metric
                    label="Transitions"
                    value={number(selectedSpatialQuality?.zoneTransitions.value ?? null)}
                    quality={selectedSpatialQuality?.zoneTransitions}
                  />
                  <Metric
                    label="Rotations"
                    value={number(selectedSpatialQuality?.rotations.value ?? null)}
                    quality={selectedSpatialQuality?.rotations}
                  />
                  <Metric
                    label="Habitudes répétées"
                    value={number(selectedSpatialQuality?.repeatedTrajectoryHabits.value ?? null)}
                    quality={selectedSpatialQuality?.repeatedTrajectoryHabits}
                  />
                  <Metric
                    label="Distance équipiers"
                    value={
                      selectedSpatialQuality?.meanTeammateDistance.value === null ||
                        selectedSpatialQuality?.meanTeammateDistance.value === undefined
                        ? "—"
                        : `${selectedSpatialQuality.meanTeammateDistance.value.toFixed(0)} u`
                    }
                    detail="moyenne horizontale"
                    quality={selectedSpatialQuality?.meanTeammateDistance}
                  />
                  <Metric
                    label="Échantillons spacing"
                    value={number(selectedSpatialQuality?.spacingSamples.value ?? null)}
                    quality={selectedSpatialQuality?.spacingSamples}
                  />
                </div>
              </article>

              <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
                <div className="border-b border-white/8 px-4 py-3">
                  <h3 className="text-sm font-semibold text-neutral-200">Occupation par zone</h3>
                  <p className="mt-1 text-xs text-neutral-500">
                    Temps passé calculé à partir des positions enregistrées dans chaque round.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[38rem] text-left text-sm">
                    <thead className="text-[11px] text-neutral-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">Zone</th>
                        <th className="px-3 py-2 text-right font-medium">Rounds</th>
                        <th className="px-3 py-2 text-right font-medium">Visites</th>
                        <th className="px-4 py-2 text-right font-medium">Temps cumulé</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedZoneRows.slice(0, 16).map((zone) => (
                        <tr key={zone.zoneId} className="border-t border-white/8">
                          <td className="px-4 py-3 font-semibold text-neutral-200">
                            {zoneLabel(zone.zoneId, spatial?.zoneLabels)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums">{zone.rounds.size}</td>
                          <td className="px-3 py-3 text-right tabular-nums">{zone.visits}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{zone.duration.toFixed(1)} s</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {selectedZoneRows.length === 0 && (
                  <p className="border-t border-white/8 px-4 py-4 text-sm text-neutral-500">
                    Aucune zone tactique n’a pu être attribuée pour cette carte.
                  </p>
                )}
              </article>

              <div className="grid gap-6 md:grid-cols-3">
                <article className="rounded-md border border-white/10 bg-[#121515] p-5">
                  <h3 className="text-sm font-semibold text-white">Rotations</h3>
                  <div className="mt-3 text-3xl font-semibold tabular-nums text-white">
                    {spatial ? selectedRotations.length : "—"}
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    Déplacements collectifs auxquels le joueur participe.
                  </p>
                </article>
                <article className="rounded-md border border-white/10 bg-[#121515] p-5">
                  <h3 className="text-sm font-semibold text-white"><DefinitionTerm label="Tradeability" /></h3>
                  <div className="mt-3 text-3xl font-semibold tabular-nums text-white">
                    {spatial ? selectedTradeability.length : "—"}
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    Morts ou couvertures où sa capacité de trade est analysable.
                  </p>
                </article>
                <article className="rounded-md border border-white/10 bg-[#121515] p-5">
                  <h3 className="text-sm font-semibold text-white">Espacement</h3>
                  <div className="mt-3 text-3xl font-semibold tabular-nums text-white">
                    {closestTeammateDistance === null ? "—" : `${closestTeammateDistance.toFixed(0)} u`}
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    Distance 3D minimale observée avec un équipier.
                    {farthestTeammateDistance !== null && ` Maximum : ${farthestTeammateDistance.toFixed(0)} u.`}
                  </p>
                </article>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
