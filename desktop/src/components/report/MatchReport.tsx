"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Activity,
  BarChart3,
  Crosshair,
  LayoutDashboard,
  Map as MapIcon,
  Swords,
  TableProperties,
} from "lucide-react";
import type {
  AnalysisEvidence,
  KeyMoment,
  MatchAnalysis,
} from "@/lib/analysis/types";
import type { MechanicsAnalysis } from "@/lib/analysis/mechanics-types";
import type { SpatialAnalysis } from "@/lib/analysis/spatial-types";

type ReportTab = "overview" | "details" | "headToHead" | "rating" | "mapZones";
type OverviewMetricSet = "general" | "aim" | "positioning" | "utility";
type DetailSection =
  | "general"
  | "timeline"
  | "aim"
  | "utility"
  | "activity"
  | "trades"
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

type PlayerMechanicsSummary = {
  shots: number | null;
  accuracy: number | null;
  headAccuracy: number | null;
  sprayAccuracy: number | null;
  counterStrafeRate: number | null;
  timeToDamageMs: number | null;
  crosshairErrorDegrees: number | null;
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function mechanicsForPlayer(
  mechanics: MechanicsAnalysis | null,
  playerId: string,
  hasRecordedKill: boolean,
): PlayerMechanicsSummary {
  if (!mechanics) {
    return {
      shots: null,
      accuracy: null,
      headAccuracy: null,
      sprayAccuracy: null,
      counterStrafeRate: null,
      timeToDamageMs: null,
      crosshairErrorDegrees: null,
    };
  }
  const rounds = mechanics.rounds;
  const shots = rounds.flatMap((round) => round.shots).filter(
    (shot) => shot.shooterId === playerId,
  );
  const hitShots = shots.filter((shot) => shot.damages.length > 0);
  const damages = shots.flatMap((shot) => shot.damages);
  const damageAssociationReliable = rounds.every(
    (round) =>
      round.unmatchedDamages.length === 0 &&
      round.excludedDamageEvents === 0,
  ) && !(hasRecordedKill && hitShots.length === 0);
  const headHits = damages.filter(
    (damage) => damage.hitgroup?.toLowerCase() === "head",
  );
  const sprayShotIds = new Set(
    rounds
      .flatMap((round) => round.firingSequences)
      .filter((sequence) => sequence.shooterId === playerId && sequence.kind === "spray")
      .flatMap((sequence) => sequence.shotIds),
  );
  const sprayShots = shots.filter((shot) => sprayShotIds.has(shot.shotId));
  const assessedMovements = rounds
    .flatMap((round) => round.shotMovements)
    .filter(
      (movement) =>
        movement.shooterId === playerId &&
        movement.counterStrafeAssessment !== "unavailable",
    );
  const timeToDamage = rounds
    .flatMap((round) => round.duels)
    .filter(
      (duel) =>
        duel.initiatorId === playerId &&
        duel.reactionTimeSeconds !== null &&
        duel.reactionTimeSeconds >= 0,
    )
    .map((duel) => duel.reactionTimeSeconds as number);
  const crosshairErrors = rounds
    .flatMap((round) => round.crosshairPlacements)
    .filter(
      (placement) =>
        placement.playerId === playerId &&
        placement.totalErrorDegrees !== null,
    )
    .map((placement) => placement.totalErrorDegrees as number);
  return {
    shots: shots.length,
    accuracy: !damageAssociationReliable || shots.length === 0
      ? null
      : hitShots.length / shots.length,
    headAccuracy: !damageAssociationReliable || damages.length === 0
      ? null
      : headHits.length / damages.length,
    sprayAccuracy: !damageAssociationReliable || sprayShots.length === 0
      ? null
      : sprayShots.filter((shot) => shot.damages.length > 0).length / sprayShots.length,
    counterStrafeRate: assessedMovements.length === 0
      ? null
      : assessedMovements.filter(
        (movement) => movement.counterStrafeAssessment === "compatible",
      ).length / assessedMovements.length,
    timeToDamageMs: (() => {
      const value = average(timeToDamage);
      return value === null ? null : value * 1000;
    })(),
    crosshairErrorDegrees: average(crosshairErrors),
  };
}

function zoneLabel(zoneId: string): string {
  return zoneId
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

function momentAccent(category: KeyMoment["primaryCategory"]): string {
  if (category === "opening_loss") return "bg-rose-400";
  if (category === "bomb_planted") return "bg-amber-300";
  if (category === "bomb_defused") return "bg-sky-300";
  if (category === "multikill") return "bg-violet-300";
  return "bg-emerald-300";
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
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="border-l-2 border-white/10 px-3 py-1">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-neutral-100">{value}</div>
      {detail && <div className="mt-1 text-xs text-neutral-500">{detail}</div>}
    </div>
  );
}

function MetricBar({
  label,
  value,
  max,
  display,
}: {
  label: string;
  value: number | null;
  max: number;
  display: string;
}) {
  const width = value === null || !Number.isFinite(value)
    ? 0
    : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
        <span className="text-neutral-400">{label}</span>
        <span className="font-semibold tabular-nums text-neutral-200">{display}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="h-full rounded-full bg-emerald-300"
          style={{ width: `${width}%` }}
        />
      </div>
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

function aimActions(analysis: MatchAnalysis) {
  const evidenceById = new Map(
    analysis.evidence.map((proof) => [proof.evidenceId, proof]),
  );
  const actions: Array<{
    evidence: AnalysisEvidence;
    playerId: string;
    playerName: string;
    kind: "headshot" | "opening_win" | "opening_loss" | "multikill";
  }> = [];
  for (const player of analysis.players) {
    const groups = [
      ["headshot", player.metricEvidence.headshotKills],
      ["opening_win", player.metricEvidence.openingWins],
      ["opening_loss", player.metricEvidence.openingLosses],
      ["multikill", player.metricEvidence.multiKills],
    ] as const;
    for (const [kind, evidenceIds] of groups) {
      for (const evidenceId of new Set(evidenceIds)) {
        const evidence = evidenceById.get(evidenceId);
        if (evidence) {
          actions.push({
            evidence,
            playerId: player.playerId,
            playerName: player.name,
            kind,
          });
        }
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

function momentLabel(moment: KeyMoment): string {
  const labels: Record<KeyMoment["primaryCategory"], string> = {
    clutch_win: "Clutch gagné",
    opening_win: "Opening gagné",
    opening_loss: "Opening perdu",
    multikill: "Multikill",
    trade_kill: "Trade kill",
    bomb_planted: "Bombe posée",
    bomb_defused: "Bombe désamorcée",
  };
  return labels[moment.primaryCategory];
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
  const selectedPlayer = analysis?.players.find(
    (player) => player.playerId === selectedPlayerId,
  ) ?? analysis?.players[0] ?? null;
  if (loading) {
    return (
      <div role="status" className="flex min-h-full items-center justify-center text-sm text-neutral-400">
        Analyse du match en cours…
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
  const availableFlashMetrics = analysis.players
    .map((player) => player.metrics.flashes)
    .filter((value): value is NonNullable<typeof value> => value !== null && value !== undefined);
  const totalEnemiesFlashed = availableFlashMetrics.length === analysis.players.length
    ? availableFlashMetrics.reduce((total, value) => total + value.enemiesFlashed, 0)
    : null;
  const totalEnemyBlindDuration = availableFlashMetrics.length === analysis.players.length
    ? availableFlashMetrics.reduce((total, value) => total + value.enemyBlindDuration, 0)
    : null;
  const averageEnemyBlindDuration =
    totalEnemiesFlashed === null ||
    totalEnemyBlindDuration === null ||
    totalEnemiesFlashed === 0
      ? null
      : totalEnemyBlindDuration / totalEnemiesFlashed;
  const replayableTradeActions = tradeActions(analysis);
  const replayableUtilityActions = utilityActions(analysis);
  const replayableAimActions = aimActions(analysis);
  const selectedRound = analysis.rounds.find(
    (round) => round.roundNumber === selectedRoundNumber,
  ) ?? analysis.rounds[0] ?? null;
  const roundDisplayOffset = analysis.rounds[0]?.roundNumber === 0 ? 1 : 0;
  const displayRound = (roundNumber: number) => roundNumber + roundDisplayOffset;
  const firstTeamPlayerIds = analysis.teams[0]?.playerIds ?? [];
  const secondTeamPlayerIds = analysis.teams[1]?.playerIds ?? [];
  const effectiveHeadToHeadPlayerAId = firstTeamPlayerIds.includes(headToHeadPlayerAId)
    ? headToHeadPlayerAId
    : firstTeamPlayerIds[0] ?? analysis.players[0]?.playerId ?? "";
  const effectiveHeadToHeadPlayerBId = secondTeamPlayerIds.includes(headToHeadPlayerBId)
    ? headToHeadPlayerBId
    : secondTeamPlayerIds[0] ?? analysis.players[1]?.playerId ?? "";
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
  const mechanicsByPlayer = new Map(
    analysis.players.map((player) => [
      player.playerId,
      mechanicsForPlayer(
        mechanics,
        player.playerId,
        (player.metrics.kills ?? 0) > 0,
      ),
    ]),
  );
  const selectedZoneVisits = spatial?.rounds
    .flatMap((round) => round.zoneVisits)
    .filter((visit) => visit.playerId === selectedPlayer?.playerId) ?? [];
  const selectedZoneTransitions = spatial?.rounds
    .flatMap((round) => round.zoneTransitions)
    .filter((transition) => transition.playerId === selectedPlayer?.playerId) ?? [];
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
  const selectedHabits = spatial?.repeatedTrajectoryHabits.filter(
    (habit) => habit.playerId === selectedPlayer?.playerId,
  ) ?? [];
  const navigation = [
    {
      value: "overview",
      label: "Synthèse",
      icon: LayoutDashboard,
    },
    {
      value: "details",
      label: "Détails du match",
      icon: TableProperties,
    },
    {
      value: "headToHead",
      label: "Face-à-face",
      icon: Swords,
    },
    {
      value: "rating",
      label: "Décomposition du rating",
      icon: BarChart3,
    },
    {
      value: "mapZones",
      label: "Zones de carte",
      icon: MapIcon,
    },
  ] as const;
  const detailNavigation = [
    {
      value: "general",
      label: "Général",
    },
    {
      value: "timeline",
      label: "Timeline",
    },
    {
      value: "aim",
      label: "Aim",
    },
    {
      value: "utility",
      label: "Utilitaires",
    },
    {
      value: "activity",
      label: "Activité",
    },
    {
      value: "trades",
      label: "Trades",
    },
    {
      value: "openings",
      label: "Opening duels",
    },
    {
      value: "clutches",
      label: "Clutches",
    },
  ] as const;

  return (
    <section
      aria-label="Rapport de partie"
      className="mx-auto flex min-h-full w-full max-w-[1480px] flex-col px-4 pb-16 pt-24 sm:px-6"
    >
      <header className="rounded-lg border border-white/8 bg-[#121515] px-5 py-5 shadow-[0_18px_60px_rgba(0,0,0,0.18)] sm:px-7">
        <div className="grid gap-6 md:grid-cols-[1fr_auto_1fr] md:items-center">
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
              {spatial?.map ? spatial.map.replace(/^de_/, "").toUpperCase() : "Rapport de match"}
            </span>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">
              Analyse du match
            </h1>
            <p className="mt-1 text-xs text-neutral-500">
              {analysis.rounds.length} rounds · {analysis.players.length} joueurs analysés
            </p>
          </div>
          <div className="flex items-center justify-start gap-5 md:justify-center">
            {analysis.teams.slice(0, 2).map((team, index) => {
              const won = (team.score ?? -1) === Math.max(
                ...analysis.teams.slice(0, 2).map((candidate) => candidate.score ?? -1),
              );
              return (
                <div key={team.logicalTeam} className="contents">
                  {index > 0 && <span className="text-sm font-semibold text-neutral-700">—</span>}
                  <div className={index === 1 ? "text-right" : undefined}>
                    <div className={[
                      "text-4xl font-semibold tabular-nums",
                      won ? "text-emerald-300" : "text-neutral-200",
                    ].join(" ")}>
                      {team.score ?? "—"}
                    </div>
                    <div className="mt-1 max-w-36 truncate text-xs font-medium text-neutral-400">
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
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-600">
              Résultat
            </div>
            <div className="mt-1 text-sm font-semibold text-neutral-200">
              {analysis.teams.slice(0, 2).every((team) => team.score !== null)
                ? "Match terminé"
                : "Score incomplet"}
            </div>
          </div>
        </div>
      </header>

      <nav
        aria-label="Sections du rapport"
        className="sticky top-0 z-20 mt-4 flex overflow-x-auto rounded-md border border-white/8 bg-[#101212]/95 p-1 shadow-xl shadow-black/10 backdrop-blur"
      >
        {navigation.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-current={tab === value ? "page" : undefined}
            onClick={() => setTab(value)}
            className={[
              "flex shrink-0 items-center gap-2 rounded-[4px] px-3.5 py-2.5 text-sm font-semibold transition-colors",
              tab === value
                ? "bg-white/[0.08] text-white shadow-sm"
                : "text-neutral-500 hover:bg-white/[0.035] hover:text-neutral-200",
            ].join(" ")}
          >
            <Icon className={["size-4", tab === value ? "text-emerald-300" : ""].join(" ")} />
            {label}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="mt-6 grid gap-6">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
              <div className="flex flex-col gap-3 border-b border-white/8 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-100">Tableau des joueurs</h2>
                  <p className="mt-0.5 text-xs text-neutral-500">Change de catégorie sans quitter la synthèse.</p>
                </div>
                <div className="flex overflow-x-auto rounded-[4px] bg-black/20 p-0.5">
                  {([
                    ["general", "Général", TableProperties],
                    ["aim", "Aim", Crosshair],
                    ["positioning", "Positionnement", Swords],
                    ["utility", "Utilitaires", Activity],
                  ] as const).map(([value, label, Icon]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={overviewMetricSet === value}
                      onClick={() => setOverviewMetricSet(value)}
                      className={[
                        "flex shrink-0 items-center gap-1.5 rounded-[3px] px-2.5 py-1.5 text-[11px] font-semibold",
                        overviewMetricSet === value
                          ? "bg-white/[0.09] text-neutral-100"
                          : "text-neutral-500 hover:text-neutral-200",
                      ].join(" ")}
                    >
                      <Icon className="size-3.5" />
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
                          <th className="px-3 py-2.5 text-right">K/D</th>
                          <th className="px-3 py-2.5 text-right">ADR</th>
                          <th className="px-4 py-2.5 text-right">KAST</th>
                        </>
                      )}
                      {overviewMetricSet === "aim" && (
                        <>
                          <th className="px-3 py-2.5 text-right">Tirs</th>
                          <th className="px-3 py-2.5 text-right">HS kill</th>
                          <th className="px-3 py-2.5 text-right">Précision</th>
                          <th className="px-3 py-2.5 text-right">Spray</th>
                          <th className="px-4 py-2.5 text-right">Counter-strafe</th>
                        </>
                      )}
                      {overviewMetricSet === "positioning" && (
                        <>
                          <th className="px-3 py-2.5 text-right">Openings</th>
                          <th className="px-3 py-2.5 text-right">Succès</th>
                          <th className="px-3 py-2.5 text-right">Trade kills</th>
                          <th className="px-3 py-2.5 text-right">Morts tradées</th>
                          <th className="px-4 py-2.5 text-right">Clutches</th>
                        </>
                      )}
                      {overviewMetricSet === "utility" && (
                        <>
                          <th className="px-3 py-2.5 text-right">Lancers</th>
                          <th className="px-3 py-2.5 text-right">Ennemis flashés</th>
                          <th className="px-3 py-2.5 text-right">Blind moyen</th>
                          <th className="px-3 py-2.5 text-right">Flash assists</th>
                          <th className="px-4 py-2.5 text-right">Non utilisés</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  {analysis.teams.map((team, teamIndex) => (
                    <tbody key={team.logicalTeam}>
                      <tr className={[
                        "border-t border-white/8",
                        teamIndex === 0 ? "bg-sky-400/[0.045]" : "bg-amber-300/[0.04]",
                      ].join(" ")}>
                        <th
                          colSpan={7}
                          className={[
                            "border-l-2 px-4 py-2 text-[11px] font-semibold",
                            teamIndex === 0
                              ? "border-sky-300 text-sky-200"
                              : "border-amber-300 text-amber-200",
                          ].join(" ")}
                        >
                          {teamLabel(team.name)} <span className="ml-1 text-neutral-500">{team.score ?? "—"}</span>
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
                                  <td className="px-3 py-3 text-right tabular-nums">{number(playerMechanics?.shots ?? null)}</td>
                                  <td className="px-3 py-3 text-right tabular-nums">{percent(player.metrics.headshotRate)}</td>
                                  <td className="px-3 py-3 text-right tabular-nums">{percent(playerMechanics?.accuracy ?? null)}</td>
                                  <td className="px-3 py-3 text-right tabular-nums">{percent(playerMechanics?.sprayAccuracy ?? null)}</td>
                                  <td className="px-4 py-3 text-right tabular-nums">{percent(playerMechanics?.counterStrafeRate ?? null)}</td>
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
                                  <td className="px-3 py-3 text-right tabular-nums">{player.metrics.grenadesThrown?.total ?? "—"}</td>
                                  <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.flashes?.enemiesFlashed ?? null)}</td>
                                  <td className="px-3 py-3 text-right tabular-nums">
                                    {player.metrics.flashes?.averageEnemyBlindDuration === null ||
                                    player.metrics.flashes?.averageEnemyBlindDuration === undefined
                                      ? "—"
                                      : `${player.metrics.flashes.averageEnemyBlindDuration.toFixed(1)} s`}
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

            <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
              <div className="border-b border-white/8 px-4 py-3">
                <h2 className="text-sm font-semibold text-neutral-100">Moments importants</h2>
                <p className="mt-0.5 text-xs text-neutral-500">Accès direct au replay.</p>
              </div>
              <div className="divide-y divide-white/5">
                {analysis.keyMoments.slice(0, 8).map((moment) => (
                  <button
                    key={moment.evidenceId}
                    type="button"
                    onClick={() => onOpenEvidence(moment.evidenceId)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-white/[0.035]"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className={["size-1.5 shrink-0 rounded-full", momentAccent(moment.primaryCategory)].join(" ")} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-neutral-200">
                          {momentLabel(moment)}
                        </span>
                        <span className="text-xs text-neutral-500">
                          Round {displayRound(moment.roundNumber)} · {moment.time.toFixed(1)} s
                        </span>
                      </span>
                    </span>
                    <span className="text-xs font-semibold text-emerald-300">Voir</span>
                  </button>
                ))}
                {analysis.keyMoments.length === 0 && (
                  <p className="px-4 py-5 text-sm text-neutral-500">Aucun moment important détecté.</p>
                )}
              </div>
            </article>
          </div>
        </div>
      )}

      {tab === "details" && (
        <div className="mt-5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-neutral-600">Analyse complète</span>
              <h2 className="mt-1 text-xl font-semibold text-white">Détails du match</h2>
            </div>
          </div>
          <nav
            aria-label="Sections des détails du match"
            className="mt-4 flex overflow-x-auto rounded-md border border-white/8 bg-[#121515] p-1"
          >
            {detailNavigation.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-label={label}
                aria-current={detailSection === value ? "page" : undefined}
                onClick={() => setDetailSection(value)}
                className={[
                  "shrink-0 rounded-[3px] px-3 py-2 text-xs font-semibold transition-colors",
                  detailSection === value
                    ? "bg-white/[0.08] text-neutral-100"
                    : "text-neutral-500 hover:bg-white/[0.03] hover:text-neutral-200",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>
      )}

      {tab === "details" && detailSection === "general" && (
        <div className="mt-6 grid gap-3">
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
            <span className="text-xs text-neutral-600">
              HLTV et rating restent indisponibles sans modèle calibré.
            </span>
          </div>
          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[76rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium">Kills</th>
                    <th className="px-3 py-3 text-right font-medium">Assists</th>
                    <th className="px-3 py-3 text-right font-medium">Morts</th>
                    <th className="px-3 py-3 text-right font-medium">K/D</th>
                    <th className="px-3 py-3 text-right font-medium">ADR</th>
                    <th className="px-3 py-3 text-right font-medium">KAST</th>
                    <th className="px-3 py-3 text-right font-medium">2K</th>
                    <th className="px-3 py-3 text-right font-medium">3K</th>
                    <th className="px-3 py-3 text-right font-medium">4K</th>
                    <th className="px-3 py-3 text-right font-medium">5K</th>
                    <th className="px-3 py-3 text-right font-medium">HLTV</th>
                    <th className="px-3 py-3 text-right font-medium">Rating</th>
                    <th className="px-4 py-3 text-right font-medium">Performance</th>
                  </tr>
                </thead>
                {analysis.teams.map((team, teamIndex) => (
                  <tbody key={team.logicalTeam}>
                    <tr className={[
                      "border-t border-white/10",
                      teamIndex === 0 ? "bg-sky-400/[0.045]" : "bg-amber-300/[0.04]",
                    ].join(" ")}>
                      <th
                        colSpan={14}
                        className={[
                          "border-l-2 px-4 py-2 text-xs font-semibold",
                          teamIndex === 0
                            ? "border-sky-300 text-sky-200"
                            : "border-amber-300 text-amber-200",
                        ].join(" ")}
                      >
                        {teamLabel(team.name)} · {team.score ?? "—"}
                      </th>
                    </tr>
                    {analysis.players
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
                            <td className="px-3 py-3 text-right text-neutral-600">—</td>
                            <td className="px-3 py-3 text-right text-neutral-600">—</td>
                            <td className="px-4 py-3 text-right text-neutral-600">—</td>
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
                  label="Actions clés"
                  value={String(selectedRound.keyMoments.length)}
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
                        {economyLabel(economy.category)}
                      </div>
                    </div>
                    <div className="text-right text-sm tabular-nums text-neutral-300">
                      {economy.averageEquipmentValue === null
                        ? "—"
                        : `${Math.round(economy.averageEquipmentValue).toLocaleString("fr-FR")} $`}
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
                      <th className="pb-2 font-medium">KAST</th>
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
                          <td className="py-3 font-semibold text-neutral-200">{player.name}</td>
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

            <article className="rounded-md border border-white/10 bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Moments du round</h3>
              <div className="mt-4 grid gap-2">
                {selectedRound.keyMoments.map((moment) => (
                  <button
                    key={moment.evidenceId}
                    type="button"
                    onClick={() => onOpenEvidence(moment.evidenceId)}
                    className="flex items-center justify-between gap-3 rounded-md border border-white/8 px-3 py-2 text-left hover:bg-white/[0.05]"
                  >
                    <span className="text-sm font-medium text-neutral-200">
                      {momentLabel(moment)}
                    </span>
                    <span className="text-xs tabular-nums text-neutral-500">
                      {moment.time.toFixed(1)} s · Voir dans le replay
                    </span>
                  </button>
                ))}
                {selectedRound.keyMoments.length === 0 && (
                  <p className="text-sm text-neutral-500">
                    Aucun moment important détecté dans ce round.
                  </p>
                )}
              </div>
            </article>
          </div>
        </div>
      )}

      {tab === "details" && detailSection === "activity" && (
        <div className="mt-6 grid gap-3">
          <p className="text-xs text-neutral-500">
            Les tirs proviennent des événements de tir de la démo. Les dégâts utilitaires et les chargeurs gaspillés restent indisponibles quand la démo ne permet pas de les attribuer sans ambiguïté.
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
                    <th className="px-3 py-3 text-right font-medium">Chargeurs gaspillés</th>
                    <th className="px-4 py-3 text-right font-medium">Rounds survécus</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedPlayers.map((player) => {
                    const playerMechanics = mechanicsByPlayer.get(player.playerId);
                    return (
                      <tr key={player.playerId} className="border-t border-white/8">
                        <td className="px-4 py-3 font-semibold text-neutral-200">{player.name}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.damageHealth)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.utilityDamage?.heDamage ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.utilityDamage?.fireDamage ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.flashes?.enemiesFlashed ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerMechanics?.shots ?? null)}</td>
                        <td className="px-3 py-3 text-right text-neutral-600">—</td>
                        <td className="px-4 py-3 text-right tabular-nums">{number(player.metrics.survivedRounds)}</td>
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

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              label="Tentatives"
              value={number(
                analysis.players.some((player) => player.metrics.tradeAttempts === null)
                  ? null
                  : analysis.players.reduce(
                    (total, player) => total + (player.metrics.tradeAttempts ?? 0),
                    0,
                  ),
              )}
              detail="Dégâts de réponse valides"
            />
            <Metric
              label="Trade kills"
              value={number(
                analysis.players.some((player) => player.metrics.tradeKills === null)
                  ? null
                  : analysis.players.reduce(
                    (total, player) => total + (player.metrics.tradeKills ?? 0),
                    0,
                  ),
              )}
            />
            <Metric
              label="Morts tradées"
              value={number(
                analysis.players.some((player) => player.metrics.tradeDeaths === null)
                  ? null
                  : analysis.players.reduce(
                    (total, player) => total + (player.metrics.tradeDeaths ?? 0),
                    0,
                  ),
              )}
            />
            <Metric
              label="Actions rejouables"
              value={String(replayableTradeActions.length)}
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
                      <th className="pb-2 font-medium">Tentatives</th>
                      <th className="pb-2 font-medium">Trade kills</th>
                      <th className="pb-2 font-medium">Morts tradées</th>
                      <th className="pb-2 font-medium">KAST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...analysis.players]
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
                          <td className="py-3 font-semibold text-neutral-200">{player.name}</td>
                          <td className="py-3">{number(player.metrics.tradeAttempts)}</td>
                          <td className="py-3">{number(player.metrics.tradeKills)}</td>
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

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Metric
              label="Grenades lancées"
              value={number(
                analysis.players.some((player) => player.metrics.grenadesThrown === null)
                  ? null
                  : analysis.players.reduce(
                    (total, player) => total + (player.metrics.grenadesThrown?.total ?? 0),
                    0,
                  ),
              )}
            />
            <Metric
              label="Ennemis flashés"
              value={number(totalEnemiesFlashed)}
            />
            <Metric
              label="Alliés flashés"
              value={number(
                availableFlashMetrics.length === analysis.players.length
                  ? availableFlashMetrics.reduce(
                    (total, value) => total + value.teammatesFlashed,
                    0,
                  )
                  : null,
              )}
            />
            <Metric
              label="Blind moyen"
              value={averageEnemyBlindDuration === null
                ? "—"
                : `${averageEnemyBlindDuration.toFixed(1)} s`}
            />
            <Metric
              label="Flash assists"
              value={number(
                analysis.players.some((player) => player.metrics.flashAssists === null)
                  ? null
                  : analysis.players.reduce(
                    (total, player) => total + (player.metrics.flashAssists ?? 0),
                    0,
                  ),
              )}
            />
            <Metric
              label="Utilitaires conservés"
              value={number(
                analysis.players.some(
                  (player) => player.metrics.utilitySavedOnDeath === null,
                )
                  ? null
                  : analysis.players.reduce(
                    (total, player) =>
                      total + (player.metrics.utilitySavedOnDeath?.total ?? 0),
                    0,
                  ),
              )}
              detail="Encore détenus à la mort"
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <article className="rounded-md border border-white/10 bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Usage par joueur</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[68rem] text-left text-sm">
                  <thead className="text-xs text-neutral-500">
                    <tr>
                      <th className="pb-2 font-medium">Joueur</th>
                      <th className="pb-2 font-medium">Total</th>
                      <th className="pb-2 font-medium">Flash</th>
                      <th className="pb-2 font-medium">Smoke</th>
                      <th className="pb-2 font-medium">HE</th>
                      <th className="pb-2 font-medium">Feu</th>
                      <th className="pb-2 font-medium">Ennemis flashés</th>
                      <th className="pb-2 font-medium">Alliés flashés</th>
                      <th className="pb-2 font-medium">Blind moyen</th>
                      <th className="pb-2 font-medium">Flash assists</th>
                      <th className="pb-2 font-medium">Conservés</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...analysis.players]
                      .sort(
                        (left, right) =>
                          (right.metrics.grenadesThrown?.total ?? -1) -
                            (left.metrics.grenadesThrown?.total ?? -1) ||
                          left.name.localeCompare(right.name),
                      )
                      .map((player) => {
                        const grenades = player.metrics.grenadesThrown;
                        return (
                          <tr key={player.playerId} className="border-t border-white/8">
                            <td className="py-3 font-semibold text-neutral-200">{player.name}</td>
                            <td className="py-3">{grenades?.total ?? "—"}</td>
                            <td className="py-3">{grenades?.flash ?? "—"}</td>
                            <td className="py-3">{grenades?.smoke ?? "—"}</td>
                            <td className="py-3">{grenades?.he ?? "—"}</td>
                            <td className="py-3">
                              {grenades === null
                                ? "—"
                                : grenades.molotov + grenades.incendiary}
                            </td>
                            <td className="py-3">{number(player.metrics.flashes?.enemiesFlashed ?? null)}</td>
                            <td className="py-3">{number(player.metrics.flashes?.teammatesFlashed ?? null)}</td>
                            <td className="py-3">
                              {player.metrics.flashes?.averageEnemyBlindDuration === null ||
                              player.metrics.flashes?.averageEnemyBlindDuration === undefined
                                ? "—"
                                : `${player.metrics.flashes.averageEnemyBlindDuration.toFixed(1)} s`}
                            </td>
                            <td className="py-3">{number(player.metrics.flashAssists)}</td>
                            <td className="py-3">
                              {player.metrics.utilitySavedOnDeath?.total ?? "—"}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="rounded-md border border-white/10 bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Répartition des lancers</h3>
              <div className="mt-5 grid gap-5">
                {([
                  ["flash", "Flash"],
                  ["smoke", "Smoke"],
                  ["he", "HE"],
                  ["fire", "Molotov / incendiaire"],
                  ["decoy", "Decoy"],
                ] as const).map(([kind, label]) => {
                  const count = analysis.players.reduce((total, player) => {
                    const grenades = player.metrics.grenadesThrown;
                    if (grenades === null) return total;
                    if (kind === "fire") return total + grenades.molotov + grenades.incendiary;
                    return total + grenades[kind];
                  }, 0);
                  const total = analysis.players.reduce(
                    (sum, player) => sum + (player.metrics.grenadesThrown?.total ?? 0),
                    0,
                  );
                  return (
                    <MetricBar
                      key={kind}
                      label={label}
                      value={count}
                      max={Math.max(1, total)}
                      display={String(count)}
                    />
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
              Précision, discipline de mouvement et vitesse de réaction mesurées directement dans la démo.
            </p>
          </article>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric
              label="Tirs enregistrés"
              value={number(
                mechanics
                  ? [...mechanicsByPlayer.values()].reduce(
                    (total, player) => total + (player.shots ?? 0),
                    0,
                  )
                  : null,
              )}
            />
            <Metric
              label="Précision moyenne"
              value={percent(average(
                [...mechanicsByPlayer.values()]
                  .map((player) => player.accuracy)
                  .filter((value): value is number => value !== null),
              ))}
            />
            <Metric
              label="Contre-strafe moyen"
              value={percent(average(
                [...mechanicsByPlayer.values()]
                  .map((player) => player.counterStrafeRate)
                  .filter((value): value is number => value !== null),
              ))}
            />
            <Metric
              label="Temps avant dégâts"
              value={number(average(
                [...mechanicsByPlayer.values()]
                  .map((player) => player.timeToDamageMs)
                  .filter((value): value is number => value !== null),
              ))}
              detail="ms · nécessite la géométrie de carte"
            />
          </div>

          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[72rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium">Spotted accuracy</th>
                    <th className="px-3 py-3 text-right font-medium">Time to damage</th>
                    <th className="px-3 py-3 text-right font-medium">Crosshair placement</th>
                    <th className="px-3 py-3 text-right font-medium">Head accuracy</th>
                    <th className="px-3 py-3 text-right font-medium">HS kill %</th>
                    <th className="px-3 py-3 text-right font-medium">Spray accuracy</th>
                    <th className="px-3 py-3 text-right font-medium">Counter-strafing</th>
                    <th className="px-4 py-3 text-right font-medium">Accuracy all</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedPlayers.map((player) => {
                    const playerMechanics = mechanicsByPlayer.get(player.playerId);
                    return (
                      <tr key={player.playerId} className="border-t border-white/8">
                        <td className="px-4 py-3 font-semibold text-neutral-200">{player.name}</td>
                        <td className="px-3 py-3 text-right text-neutral-600">—</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics?.timeToDamageMs === null || playerMechanics?.timeToDamageMs === undefined
                            ? "—"
                            : `${Math.round(playerMechanics.timeToDamageMs)} ms`}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics?.crosshairErrorDegrees === null || playerMechanics?.crosshairErrorDegrees === undefined
                            ? "—"
                            : `${playerMechanics.crosshairErrorDegrees.toFixed(1)}°`}
                        </td>
                        <td className="px-3 py-3 text-right">{percent(playerMechanics?.headAccuracy ?? null)}</td>
                        <td className="px-3 py-3 text-right">{percent(player.metrics.headshotRate)}</td>
                        <td className="px-3 py-3 text-right">{percent(playerMechanics?.sprayAccuracy ?? null)}</td>
                        <td className="px-3 py-3 text-right">{percent(playerMechanics?.counterStrafeRate ?? null)}</td>
                        <td className="px-4 py-3 text-right">{percent(playerMechanics?.accuracy ?? null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-white/8 px-4 py-3 text-xs text-neutral-500">
              « Spotted accuracy », le placement du viseur et le temps avant dégâts exigent une géométrie de carte fiable. Ils restent vides plutôt que d’afficher une estimation inventée.
            </p>
          </article>

          <article className="rounded-md border border-white/10 bg-[#121515] p-5">
            <h3 className="text-sm font-semibold text-white">Actions de combat</h3>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {replayableAimActions.slice(0, 60).map((action) => {
                const labels = {
                  headshot: "Headshot",
                  opening_win: "Opening gagné",
                  opening_loss: "Opening perdu",
                  multikill: "Action de multikill",
                } as const;
                const label = labels[action.kind];
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
              {replayableAimActions.length === 0 && (
                <p className="text-sm text-neutral-500">Aucune action de combat disponible.</p>
              )}
            </div>
          </article>
        </div>
      )}

      {tab === "details" && detailSection === "openings" && (
        <div className="mt-6 grid gap-6">
          <article className="overflow-hidden rounded-md border border-white/10 bg-[#121515]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium">Tentatives</th>
                    <th className="px-3 py-3 text-right font-medium">Succès</th>
                    <th className="px-3 py-3 text-right font-medium">Morts tradées</th>
                    <th className="px-3 py-3 text-right font-medium">Adversaire principal</th>
                    <th className="px-3 py-3 text-right font-medium">Meilleure arme</th>
                    <th className="px-4 py-3 text-right font-medium">Plus souvent tué par</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedPlayers.map((player) => {
                    const attempts = player.metrics.openingAttempts;
                    const openingWins = analysis.evidence.filter((proof) =>
                      player.metricEvidence.openingWins.includes(proof.evidenceId)
                    );
                    const openingLosses = analysis.evidence.filter((proof) =>
                      player.metricEvidence.openingLosses.includes(proof.evidenceId)
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
                      player.metricEvidence.openingLosses.filter((evidenceId) =>
                        player.metricEvidence.tradeDeaths.includes(evidenceId)
                      ),
                    ).size;
                    return (
                      <tr key={player.playerId} className="border-t border-white/8">
                        <td className="px-4 py-3 font-semibold text-neutral-200">{player.name}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(attempts)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {percent(
                            attempts === null || attempts === 0
                              ? null
                              : (player.metrics.openingWins ?? 0) / attempts,
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{tradedOpeningDeaths}</td>
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
                    <th className="px-3 py-2 font-medium">Temps</th>
                    <th className="px-4 py-2 text-right font-medium">Replay</th>
                  </tr>
                </thead>
                <tbody>
                  {openingEvents.map((proof) => (
                    <tr key={proof.evidenceId} className="border-t border-white/8">
                      <td className="px-4 py-3 tabular-nums">{displayRound(proof.roundNumber)}</td>
                      <td className="px-3 py-3">
                        {analysis.players.find((player) => player.playerId === proof.actors[0])?.name ?? "—"}
                      </td>
                      <td className="px-3 py-3">
                        {analysis.players.find((player) => player.playerId === proof.actors[1])?.name ?? "—"}
                      </td>
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
                    <th className="px-3 py-3 text-right font-medium">1v1</th>
                    <th className="px-3 py-3 text-right font-medium">1v2</th>
                    <th className="px-3 py-3 text-right font-medium">1v3</th>
                    <th className="px-3 py-3 text-right font-medium">1v4</th>
                    <th className="px-3 py-3 text-right font-medium">1v5+</th>
                    <th className="px-3 py-3 text-right font-medium">Opportunités</th>
                    <th className="px-4 py-3 text-right font-medium">Clutches gagnés</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedPlayers.map((player) => {
                    const opportunities = player.metrics.clutchOpportunities;
                    const wins = player.metrics.clutchWins;
                    const totalOpportunities = opportunities === null
                      ? null
                      : Object.values(opportunities).reduce((total, value) => total + value, 0);
                    const totalWins = wins === null
                      ? null
                      : Object.values(wins).reduce((total, value) => total + value, 0);
                    const clutchCell = (
                      opportunityCount: number | undefined,
                      winCount: number | undefined,
                    ) => opportunities === null || wins === null
                      ? "—"
                      : `${winCount ?? 0}/${opportunityCount ?? 0}`;
                    return (
                      <tr key={player.playerId} className="border-t border-white/8">
                        <td className="px-4 py-3 font-semibold text-neutral-200">{player.name}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsOne, wins?.oneVsOne)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsTwo, wins?.oneVsTwo)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsThree, wins?.oneVsThree)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsFour, wins?.oneVsFour)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsFivePlus, wins?.oneVsFivePlus)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(totalOpportunities)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{number(totalWins)}</td>
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
              {analysis.teams[0]?.name ? teamLabel(analysis.teams[0].name) : "Équipe A"}
              <select
                value={effectiveHeadToHeadPlayerAId}
                onChange={(event) => setHeadToHeadPlayerAId(event.target.value)}
                className="h-10 rounded-md border border-white/10 bg-[#121515] px-3 text-sm text-neutral-200"
              >
                {analysis.players
                  .filter((player) => firstTeamPlayerIds.includes(player.playerId))
                  .map((player) => <option key={player.playerId} value={player.playerId}>{player.name}</option>)}
              </select>
            </label>
            <span className="hidden pb-2 text-xs text-neutral-600 sm:block">contre</span>
            <label className="grid gap-1 text-xs text-neutral-500">
              {analysis.teams[1]?.name ? teamLabel(analysis.teams[1].name) : "Équipe B"}
              <select
                value={effectiveHeadToHeadPlayerBId}
                onChange={(event) => setHeadToHeadPlayerBId(event.target.value)}
                className="h-10 rounded-md border border-white/10 bg-[#121515] px-3 text-sm text-neutral-200"
              >
                {analysis.players
                  .filter((player) => secondTeamPlayerIds.includes(player.playerId))
                  .map((player) => <option key={player.playerId} value={player.playerId}>{player.name}</option>)}
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
                <div className="flex justify-between"><span className="text-neutral-500">Counter-strafing</span><span>{percent(mechanicsByPlayer.get(headToHeadPlayerA.playerId)?.counterStrafeRate ?? null)} / {percent(mechanicsByPlayer.get(headToHeadPlayerB.playerId)?.counterStrafeRate ?? null)}</span></div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Crosshair placement</span>
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
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Décomposition du rating</h2>
              <p className="mt-1 text-sm text-neutral-500">
                Le modèle de rating contextuel n’est pas encore calibré. Les contributions ci-dessous sont des comptes bruts.
              </p>
            </div>
            <select
              aria-label="Joueur pour la décomposition du rating"
              value={selectedPlayer.playerId}
              onChange={(event) => setSelectedPlayerId(event.target.value)}
              className="h-10 rounded-md border border-white/10 bg-[#121515] px-3 text-sm text-neutral-200"
            >
              {rankedPlayers.map((player) => (
                <option key={player.playerId} value={player.playerId}>{player.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Metric label="Rating global" value="—" />
            <Metric label="Rating T" value="—" />
            <Metric label="Rating CT" value="—" />
          </div>

          <article className="rounded-md border border-white/10 bg-[#121515] p-5">
            <h3 className="text-sm font-semibold text-white">Contributions mesurées</h3>
            <div className="mt-5 grid grid-cols-2 gap-5 md:grid-cols-4">
              <Metric label="Dégâts" value={number(selectedPlayer.metrics.damageHealth)} />
              <Metric label="Opening duels gagnés" value={number(selectedPlayer.metrics.openingWins)} />
              <Metric label="Trade kills" value={number(selectedPlayer.metrics.tradeKills)} />
              <Metric
                label="Clutches gagnés"
                value={number(
                  selectedPlayer.metrics.clutchWins === null
                    ? null
                    : Object.values(selectedPlayer.metrics.clutchWins).reduce((total, value) => total + value, 0),
                )}
              />
            </div>
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
                    <th className="px-4 py-2 text-right font-medium">KAST</th>
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
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Metric label="Zones visitées" value={spatial ? String(selectedZoneRows.length) : "—"} />
                  <Metric label="Transitions" value={spatial ? String(selectedZoneTransitions.length) : "—"} />
                  <Metric label="Rotations" value={spatial ? String(selectedRotations.length) : "—"} />
                  <Metric label="Habitudes répétées" value={spatial ? String(selectedHabits.length) : "—"} />
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
                          <td className="px-4 py-3 font-semibold text-neutral-200">{zoneLabel(zone.zoneId)}</td>
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
                  <h3 className="text-sm font-semibold text-white">Tradeability</h3>
                  <div className="mt-3 text-3xl font-semibold tabular-nums text-white">
                    {spatial ? selectedTradeability.length : "—"}
                  </div>
                  <p className="mt-2 text-xs text-neutral-500">
                    Morts ou couvertures où sa capacité de trade est analysable.
                  </p>
                </article>
                <article className="rounded-md border border-white/10 bg-[#121515] p-5">
                  <h3 className="text-sm font-semibold text-white">Lignes de vue</h3>
                  <div className="mt-3 text-3xl font-semibold text-neutral-600">—</div>
                  <p className="mt-2 text-xs text-neutral-500">
                    La géométrie 3D de la carte manque encore ; aucune valeur n’est estimée.
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
