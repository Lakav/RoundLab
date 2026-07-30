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
    <div className="report-metric group relative min-h-[6.25rem] overflow-hidden rounded-lg border border-white/[0.075] px-4 py-3.5">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-200/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="text-[10px] font-semibold uppercase tracking-[0.11em] text-neutral-500">
        <DefinitionTerm label={label} />
      </div>
      <div className="mt-2 text-[1.65rem] font-semibold leading-none tracking-[-0.035em] tabular-nums text-neutral-100">
        {value}
      </div>
      {detail && <div className="mt-2 text-[11px] leading-snug text-neutral-500">{detail}</div>}
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
  const [weaponPlayerId, setWeaponPlayerId] = useState("all");
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
  const availableFlashMetrics = analysis.players
    .map((player) => player.metrics.flashes)
    .filter((value): value is NonNullable<typeof value> => value !== null && value !== undefined);
  const totalEnemiesFlashed = availableFlashMetrics.length === analysis.players.length
    ? availableFlashMetrics.reduce(
      (total, value) => total + value.effectiveEnemiesFlashed,
      0,
    )
    : null;
  const totalTeammatesFlashed = availableFlashMetrics.length === analysis.players.length
    ? availableFlashMetrics.reduce(
      (total, value) => total + value.effectiveTeammatesFlashed,
      0,
    )
    : null;
  const totalEnemyBlindDuration = availableFlashMetrics.length === analysis.players.length
    ? availableFlashMetrics.reduce(
      (total, value) => total + value.longestEnemyBlindDuration,
      0,
    )
    : null;
  const totalEnemyBlindFlashes = availableFlashMetrics.length === analysis.players.length
    ? availableFlashMetrics.reduce(
      (total, value) => total + value.enemyBlindFlashCount,
      0,
    )
    : null;
  const averageEnemyBlindDuration =
    totalEnemyBlindFlashes === null ||
    totalEnemyBlindDuration === null ||
    totalEnemyBlindFlashes === 0
      ? null
      : totalEnemyBlindDuration / totalEnemyBlindFlashes;
  const totalFlashGrenades = analysis.players.some(
    (player) => player.metrics.grenadesThrown === null,
  )
    ? null
    : analysis.players.reduce(
      (total, player) => total + (player.metrics.grenadesThrown?.flash ?? 0),
      0,
    );
  const totalHeGrenades = analysis.players.some(
    (player) => player.metrics.grenadesThrown === null,
  )
    ? null
    : analysis.players.reduce(
      (total, player) => total + (player.metrics.grenadesThrown?.he ?? 0),
      0,
    );
  const totalHeDamage = analysis.players.some(
    (player) =>
      player.metrics.utilityDamage === null ||
      player.metrics.utilityDamage === undefined,
  )
    ? null
    : analysis.players.reduce(
      (total, player) => total + (player.metrics.utilityDamage?.heDamage ?? 0),
      0,
    );
  const totalUnusedUtilityValue = analysis.players.some(
    (player) =>
      player.metrics.unusedUtilityValue === null ||
      player.metrics.unusedUtilityValue === undefined,
  )
    ? null
    : analysis.players.reduce(
      (total, player) => total + (player.metrics.unusedUtilityValue ?? 0),
      0,
    );
  const totalDeaths = analysis.players.reduce(
    (total, player) => total + player.metrics.deaths,
    0,
  );
  const totalTradeAttempts = analysis.players.some(
    (player) => player.metrics.tradeAttempts === null,
  )
    ? null
    : analysis.players.reduce(
      (total, player) => total + (player.metrics.tradeAttempts ?? 0),
      0,
    );
  const totalTradeKills = analysis.players.some(
    (player) => player.metrics.tradeKills === null,
  )
    ? null
    : analysis.players.reduce(
      (total, player) => total + (player.metrics.tradeKills ?? 0),
      0,
    );
  const totalTradeDeaths = analysis.players.some(
    (player) => player.metrics.tradeDeaths === null,
  )
    ? null
    : analysis.players.reduce(
      (total, player) => total + (player.metrics.tradeDeaths ?? 0),
      0,
    );
  const replayableTradeActions = tradeActions(analysis);
  const replayableUtilityActions = utilityActions(analysis);
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
      openingSide === "all" ||
      roundPlayerSide.get(`${proof.roundNumber}:${proof.actors[0]}`) === openingSide,
  );
  const weaponTeamPlayerIds = weaponTeamId === "all"
    ? null
    : new Set(
      analysis.teams.find((team) => team.logicalTeam === weaponTeamId)?.playerIds ?? [],
    );
  const weaponScopeIncludes = (playerId: string, roundNumber: number) =>
    (weaponPlayerId === "all" || playerId === weaponPlayerId) &&
    (weaponTeamPlayerIds === null || weaponTeamPlayerIds.has(playerId)) &&
    (weaponSide === "all" || roundPlayerSide.get(`${roundNumber}:${playerId}`) === weaponSide) &&
    (weaponRoundNumber === "all" || roundNumber === Number(weaponRoundNumber));
  const headshotEvidenceIds = new Set(
    analysis.players.flatMap((player) => player.metricEvidence.headshotKills),
  );
  const weaponHitDataAvailable = Boolean(
    mechanics?.rounds.some((round) =>
      round.shots.some((shot) => shot.damages.length > 0),
    ),
  );
  const weaponStats = new Map<string, {
    weapon: string;
    shots: number;
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
      if (shot.damages.length > 0) row.hitShots += 1;
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
  const mechanicsSummaries = [...mechanicsByPlayer.values()];
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
  const selectedSpacing = spatial?.rounds
    .flatMap((round) => round.spacing)
    .filter((spacing) => spacing.playerIds.includes(selectedPlayer?.playerId ?? "")) ?? [];
  const spacingSampleCount = selectedSpacing.reduce(
    (total, spacing) => total + spacing.sampleCount,
    0,
  );
  const meanTeammateDistance = spacingSampleCount === 0
    ? null
    : selectedSpacing.reduce(
      (total, spacing) => total + spacing.meanHorizontalDistance * spacing.sampleCount,
      0,
    ) / spacingSampleCount;
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
                                  <td className="px-3 py-3 text-right tabular-nums">{number(player.metrics.flashes?.effectiveEnemiesFlashed ?? null)}</td>
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

          </div>
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
          </div>
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
                {analysis.teams.map((team, teamIndex) => (
                  <tbody key={team.logicalTeam}>
                    <tr className={[
                      "border-t border-white/10",
                      teamIndex === 0 ? "bg-sky-400/[0.045]" : "bg-amber-300/[0.04]",
                    ].join(" ")}>
                      <th
                        colSpan={11}
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
                  {rankedPlayers.map((player) => {
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
              value={number(average(
                analysis.players
                  .map((player) => player.metrics.utilityQuantityRating)
                  .filter((value): value is number => value !== null && value !== undefined),
              ))}
              detail="Score 0–100"
            />
            <Metric
              label="Ennemis / flash"
              value={number(
                totalEnemiesFlashed === null ||
                    totalFlashGrenades === null ||
                    totalFlashGrenades === 0
                  ? null
                  : totalEnemiesFlashed / totalFlashGrenades,
                2,
              )}
            />
            <Metric
              label="Alliés / flash"
              value={number(
                totalTeammatesFlashed === null ||
                    totalFlashGrenades === null ||
                    totalFlashGrenades === 0
                  ? null
                  : totalTeammatesFlashed / totalFlashGrenades,
                2,
              )}
            />
            <Metric
              label="Kills / flash"
              value={number(
                availableFlashMetrics.length !== analysis.players.length ||
                    totalFlashGrenades === null ||
                    totalFlashGrenades === 0
                  ? null
                  : availableFlashMetrics.reduce(
                    (total, value) => total + value.flashesLeadingToKills,
                    0,
                  ) / totalFlashGrenades,
                2,
              )}
            />
            <Metric
              label="Blind moyen"
              value={averageEnemyBlindDuration === null
                ? "—"
                : `${averageEnemyBlindDuration.toFixed(1)} s`}
            />
            <Metric
              label="Dégâts / HE"
              value={number(
                totalHeDamage === null ||
                    totalHeGrenades === null ||
                    totalHeGrenades === 0
                  ? null
                  : totalHeDamage / totalHeGrenades,
                1,
              )}
            />
            <Metric
              label="Dégâts alliés / HE"
              value={number(
                totalHeGrenades === null ||
                    totalHeGrenades === 0 ||
                    analysis.players.some(
                      (player) => player.metrics.utilityDamage == null,
                    )
                  ? null
                  : analysis.players.reduce(
                    (total, player) =>
                      total +
                      (player.metrics.utilityDamage?.teammateHeDamage ?? 0),
                    0,
                  ) / totalHeGrenades,
                1,
              )}
            />
            <Metric
              label="Inutilisés / mort"
              value={
                totalUnusedUtilityValue === null || totalDeaths === 0
                  ? "—"
                  : `$${number(totalUnusedUtilityValue / totalDeaths)}`
              }
              detail="Valeur moyenne"
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
                            <td className="py-3 font-semibold text-neutral-200">
                              {playerIdentity(player.playerId, player.name)}
                            </td>
                            <td className="py-3">
                              {number(player.metrics.utilityQuantityRating ?? null)}
                            </td>
                            <td className="py-3">{grenades?.total ?? "—"}</td>
                            <td className="py-3">{grenades?.flash ?? "—"}</td>
                            <td className="py-3">{grenades?.smoke ?? "—"}</td>
                            <td className="py-3">{grenades?.he ?? "—"}</td>
                            <td className="py-3">
                              {number(
                                grenades === null ||
                                    grenades.he === 0 ||
                                    player.metrics.utilityDamage === null ||
                                    player.metrics.utilityDamage === undefined
                                  ? null
                                  : (player.metrics.utilityDamage?.heDamage ?? 0) /
                                    grenades.he,
                                1,
                              )}
                            </td>
                            <td className="py-3">
                              {number(
                                grenades === null ||
                                    grenades.he === 0 ||
                                    player.metrics.utilityDamage == null
                                  ? null
                                  : player.metrics.utilityDamage.teammateHeDamage /
                                    grenades.he,
                                1,
                              )}
                            </td>
                            <td className="py-3">
                              {grenades === null
                                ? "—"
                                : grenades.molotov + grenades.incendiary}
                            </td>
                            <td className="py-3">
                              {number(
                                grenades === null ||
                                    grenades.flash === 0 ||
                                    player.metrics.flashes === null ||
                                    player.metrics.flashes === undefined
                                  ? null
                                  : (player.metrics.flashes?.effectiveEnemiesFlashed ?? 0) /
                                    grenades.flash,
                                2,
                              )}
                            </td>
                            <td className="py-3">
                              {number(
                                grenades === null ||
                                    grenades.flash === 0 ||
                                    player.metrics.flashes === null ||
                                    player.metrics.flashes === undefined
                                  ? null
                                  : (player.metrics.flashes?.effectiveTeammatesFlashed ?? 0) /
                                    grenades.flash,
                                2,
                              )}
                            </td>
                            <td className="py-3">
                              {player.metrics.flashes?.averageEnemyBlindDuration === null ||
                              player.metrics.flashes?.averageEnemyBlindDuration === undefined
                                ? "—"
                                : `${player.metrics.flashes.averageEnemyBlindDuration.toFixed(1)} s`}
                            </td>
                            <td className="py-3">
                              {number(
                                grenades === null ||
                                    grenades.flash === 0 ||
                                    player.metrics.flashes == null
                                  ? null
                                  : player.metrics.flashes.flashesLeadingToKills /
                                    grenades.flash,
                                2,
                              )}
                            </td>
                            <td className="py-3">
                              {player.metrics.averageUnusedUtilityValue === null ||
                              player.metrics.averageUnusedUtilityValue === undefined
                                ? "—"
                                : `$${number(player.metrics.averageUnusedUtilityValue)}`}
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
                <h3 className="text-sm font-semibold text-white">Répartition par équipe</h3>
                <p className="mt-1 text-xs text-neutral-500">
                  Volume total et composition des lancers, sans score propriétaire.
                </p>
              </div>
              <div className="grid gap-px bg-white/8">
                {overviewPlayerGroups.map((team) => {
                  const players = analysis.players.filter((player) =>
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
              Précision, discipline de mouvement et vitesse de réaction mesurées directement dans la démo.
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
                  {rankedPlayers.map((player) => {
                    const playerMechanics = mechanicsByPlayer.get(player.playerId);
                    const movementRate =
                      playerMechanics?.movementSamples === null ||
                      playerMechanics?.movementSamples === undefined ||
                      playerMechanics.movementSamples === 0 ||
                      playerMechanics.movingShots === null
                        ? null
                        : playerMechanics.movingShots / playerMechanics.movementSamples;
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
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerMechanics?.shots ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerMechanics?.hitShots ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerMechanics?.damage ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerMechanics?.averageDamagePerHit ?? null, 1)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerMechanics?.headHits ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerMechanics?.bodyHits ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerMechanics?.tapSequences ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerMechanics?.burstSequences ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(playerMechanics?.spraySequences ?? null)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {percent(movementRate)}
                          {playerMechanics?.movementSamples
                            ? <span className="ml-1 text-[10px] text-neutral-600">({playerMechanics.movementSamples})</span>
                            : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-white/8 px-4 py-3 text-xs text-neutral-500">
              Les impacts et dégâts restent vides si leur association aux tirs n’est pas assez fiable.
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
              <table className="w-full min-w-[72rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[11px] text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Tirs ennemi repéré" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Précision sur ennemi repéré" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Time to damage" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Erreur initiale du viseur" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Head accuracy" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="HS kill %" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Spray accuracy" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Arrêt avant tir" /></th>
                    <th className="px-4 py-3 text-right font-medium"><DefinitionTerm label="Accuracy all" /></th>
                  </tr>
                </thead>
                <tbody>
                  {rankedPlayers.map((player) => {
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
                          {number(playerMechanics?.spottedShots ?? null)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {percent(playerMechanics?.spottedAccuracy ?? null)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics?.timeToDamageMs === null || playerMechanics?.timeToDamageMs === undefined
                            ? "—"
                            : (
                              <>
                                {Math.round(playerMechanics.timeToDamageMs)} ms
                                <span className="ml-1 text-[10px] text-neutral-600">
                                  ({playerMechanics.timeToDamageSamples})
                                </span>
                              </>
                            )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {playerMechanics?.crosshairErrorDegrees === null || playerMechanics?.crosshairErrorDegrees === undefined
                            ? "—"
                            : (
                              <>
                                {playerMechanics.crosshairErrorDegrees.toFixed(1)}°
                                <span className="ml-1 text-[10px] text-neutral-600">
                                  ({playerMechanics.crosshairSamples})
                                </span>
                              </>
                            )}
                        </td>
                        <td className="px-3 py-3 text-right">{percent(playerMechanics?.headAccuracy ?? null)}</td>
                        <td className="px-3 py-3 text-right">{percent(player.metrics.headshotRate)}</td>
                        <td className="px-3 py-3 text-right">{percent(playerMechanics?.sprayAccuracy ?? null)}</td>
                        <td className="px-3 py-3 text-right">
                          {percent(playerMechanics?.counterStrafeRate ?? null)}
                          {playerMechanics?.counterStrafeSamples
                            ? <span className="ml-1 text-[10px] text-neutral-600">({playerMechanics.counterStrafeSamples})</span>
                            : null}
                        </td>
                        <td className="px-4 py-3 text-right">{percent(playerMechanics?.accuracy ?? null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-white/8 px-4 py-3 text-xs text-neutral-500">
              La précision sur ennemi repéré et la précision de spray utilisent le masque de visibilité fourni par
              la démo. Elles peuvent différer de Leetify et restent vides sur les anciens imports. « Erreur initiale
              du viseur » mesure l’angle à la première visibilité, pas le mouvement du viseur jusqu’au premier dégât
              utilisé par Leetify. « Arrêt avant tir » est notre détection de freinage rapide, pas leur formule à
              34 % de la vitesse maximale de chaque arme.
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
                <select
                  value={weaponPlayerId}
                  onChange={(event) => setWeaponPlayerId(event.target.value)}
                  className="h-9 rounded-md border border-white/10 bg-[#0d0f0f] px-3 text-sm text-neutral-200"
                >
                  <option value="all">Tous les joueurs</option>
                  {analysis.players.map((player) => (
                    <option key={player.playerId} value={player.playerId}>{player.name}</option>
                  ))}
                </select>
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
                weaponHitDataAvailable
                  ? "bg-emerald-300/[0.08] text-emerald-200"
                  : "bg-amber-300/[0.08] text-amber-200",
              ].join(" ")}>
                {weaponHitDataAvailable ? "Dégâts associés" : "Dégâts non associés"}
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
                  {weaponRows.map((row) => (
                    <tr key={row.weapon} className="border-t border-white/8">
                      <td className="px-4 py-3 font-semibold text-neutral-200">
                        {weaponLabel(row.weapon)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{mechanics ? row.shots : "—"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {weaponHitDataAvailable ? row.hitShots : "—"}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums text-emerald-200">
                        {weaponHitDataAvailable && row.shots > 0 ? percent(row.hitShots / row.shots) : "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        {weaponHitDataAvailable ? row.damage : "—"}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">{row.kills}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{row.headshotKills}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {weaponRows.length === 0 && (
              <p className="border-t border-white/8 px-4 py-5 text-sm text-neutral-500">
                Aucune donnée d’arme ne correspond à ces filtres.
              </p>
            )}
            {!weaponHitDataAvailable && mechanics && weaponRows.length > 0 && (
              <p className="border-t border-amber-300/10 bg-amber-300/[0.025] px-4 py-3 text-xs leading-relaxed text-amber-100/70">
                Les tirs et les kills sont présents, mais cette importation ne permet pas de relier les dégâts
                à chaque tir. La précision, les tirs touchés et les dégâts par arme restent donc volontairement vides.
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
                  {rankedPlayers.map((player) => {
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
                  {rankedPlayers.map((player) => {
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
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.13em] text-neutral-600">
                Profil joueur
              </span>
              <h2 className="mt-1 text-xl font-semibold text-white">{selectedPlayer.name}</h2>
              <p className="mt-1 text-sm text-neutral-500">
                Synthèse de ses contributions mesurées et détail round par round.
              </p>
            </div>
            <select
              aria-label="Joueur analysé"
              value={selectedPlayer.playerId}
              onChange={(event) => setSelectedPlayerId(event.target.value)}
              className="h-10 rounded-md border border-white/10 bg-[#121515] px-3 text-sm text-neutral-200"
            >
              {rankedPlayers.map((player) => (
                <option key={player.playerId} value={player.playerId}>{player.name}</option>
              ))}
            </select>
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
                <Metric label="Lancers" value={number(selectedPlayer.metrics.grenadesThrown?.total ?? null)} />
                <Metric label="Quantity" value={number(selectedPlayer.metrics.utilityQuantityRating ?? null)} />
                <Metric label="Ennemis flashés" value={number(selectedPlayer.metrics.flashes?.effectiveEnemiesFlashed ?? null)} />
                <Metric label="Dégâts HE" value={number(selectedPlayer.metrics.utilityDamage?.heDamage ?? null)} />
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
                  <Metric label="Zones visitées" value={spatial ? String(selectedZoneRows.length) : "—"} />
                  <Metric label="Transitions" value={spatial ? String(selectedZoneTransitions.length) : "—"} />
                  <Metric label="Rotations" value={spatial ? String(selectedRotations.length) : "—"} />
                  <Metric label="Habitudes répétées" value={spatial ? String(selectedHabits.length) : "—"} />
                  <Metric
                    label="Distance équipiers"
                    value={meanTeammateDistance === null ? "—" : `${meanTeammateDistance.toFixed(0)} u`}
                    detail="moyenne horizontale"
                  />
                  <Metric
                    label="Échantillons spacing"
                    value={spatial ? String(spacingSampleCount) : "—"}
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
