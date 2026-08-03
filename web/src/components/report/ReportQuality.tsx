import Link from "next/link";
import { DefinitionTerm } from "@/components/ui/definition-term";
import type { MatchAnalysis } from "@/lib/analysis/types";
import type { MechanicsAnalysis } from "@/lib/analysis/mechanics-types";
import type { SpatialAnalysis } from "@/lib/analysis/spatial-types";
import {
  qualityMetric,
  type QualityMetric,
} from "@/lib/analysis/metric-quality";
import { number, percent } from "./report-formatters";

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

function qualityReasonLabel(reason: string): string {
  return QUALITY_REASON_LABELS[reason] ?? reason.replaceAll("_", " ");
}

export function metricQualityTitle(metric: QualityMetric<unknown>): string {
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

export function Metric({
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

export function CoverageBadge({
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

export function QualityMetricCell({
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

function coverageSignal(
  metrics: QualityMetric<unknown>[],
  formulaVersion: string,
): QualityMetric<number> {
  const sampleCount = metrics.reduce((total, metric) => total + metric.sampleCount, 0);
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
}

export function DataQualityPanel({
  analysis,
  mechanics,
  spatial,
}: {
  analysis: MatchAnalysis;
  mechanics: MechanicsAnalysis | null;
  spatial: SpatialAnalysis | null;
}) {
  const quality = mechanics?.dataQuality;
  const nonAimSignals: Record<string, QualityMetric<number>> = {
    economyFreezePlayers: coverageSignal(
      analysis.economyRounds.map((round) => round.quality.category),
      "roundlab.data-quality.v2.economyFreezePlayers",
    ),
    numericalAdvantageContexts: coverageSignal(
      analysis.teams.flatMap((team) => (team.combat ? [team.combat.advantageRounds] : [])),
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
      analysis.players.flatMap((player) => player.economy ? [player.economy.netSpend] : []),
      "roundlab.data-quality.v2.purchaseSemantics",
    ),
    tacticalZoneAssignments: coverageSignal(
      Object.values(spatial?.players ?? {}).map((player) => player.zoneAssignmentRate),
      "roundlab.data-quality.v2.tacticalZoneAssignments",
    ),
    teammateSpacing: coverageSignal(
      Object.values(spatial?.players ?? {}).map((player) => player.meanTeammateDistance),
      "roundlab.data-quality.v2.teammateSpacing",
    ),
    utilityInputs: coverageSignal(
      analysis.players.flatMap((player) => player.utility ? [player.utility.grenadesThrown] : []),
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
  const signals = { ...(quality?.signals ?? {}), ...nonAimSignals };

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
            {quality?.geometryVersion ?? "absente"}
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
