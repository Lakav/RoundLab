"use client";

import { useState } from "react";
import Link from "next/link";
import { qualityMetric } from "@/lib/analysis/metric-quality";
import {
  summarizePlayerMechanics,
} from "@/lib/analysis/summarize-player-mechanics";
import {
  DefinitionTerm,
} from "@/components/ui/definition-term";
import { tradeActions, utilityActions } from "./report-actions";
import { GlobalPlayerSelector } from "./GlobalPlayerSelector";
import {
  ReportPrimaryNavigation,
  ReportSecondaryNavigation,
} from "./ReportNavigation";
import { ReportHero } from "./ReportHero";
import {
  CoverageBadge,
  CoverageStrip,
  DataQualityPanel,
  Metric,
  QualityMetricCell,
  metricQualityTitle,
  ReportEmptyState,
} from "./ReportQuality";
import {
  average,
  economyLabel,
  mostFrequent,
  number,
  percent,
  performanceColor,
  ratio,
  teamLabel,
  weaponLabel,
  zoneLabel,
} from "./report-formatters";
import {
  DEFAULT_REPORT_SCOPE,
  ReportScopeFilters,
  scopeMatcher,
  type ReportScope,
} from "./ReportScopeFilters";
import type { PlayerAnalysis } from "@/lib/analysis/types";
import type {
  DetailSection,
  MatchReportProps,
  OverviewMetricSet,
  ReportTab,
} from "./report-types";

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
  const [weaponScope, setWeaponScope] = useState<ReportScope>(DEFAULT_REPORT_SCOPE);
  const [clutchScope, setClutchScope] = useState<ReportScope>(DEFAULT_REPORT_SCOPE);
  const [openingSide, setOpeningSide] = useState<"all" | "T" | "CT">("all");
  const selectedPlayer = analysis?.players.find(
    (player) => player.playerId === selectedPlayerId,
  ) ?? analysis?.players[0] ?? null;
  if (loading) {
    return (
      <div role="status" className="flex min-h-full items-center justify-center text-sm text-[var(--rl-fg-muted)]">
        Calcul des statistiques en cours…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 text-sm">
        <p className="max-w-lg text-center text-[var(--rl-critical)]">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-[var(--rl-border)] bg-white/[0.04] px-4 py-2 font-semibold text-[var(--rl-fg)]"
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
          ? "bg-[var(--rl-ct)]"
          : secondTeamPlayerIds.includes(playerId)
            ? "bg-[var(--rl-t)]"
            : "bg-neutral-600",
      ].join(" ")} />
      <span className="truncate">{name}</span>
    </span>
  );
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
  // Evidence ids resolve back to their round, so a filtered table can recount
  // metrics whose per-size totals were computed for the whole match.
  const evidenceRound = new Map<string, number>(
    analysis.evidence.map((proof) => [proof.evidenceId, proof.roundNumber]),
  );
  const weaponScopeIncludes = scopeMatcher(
    weaponScope,
    analysis,
    scopedPlayerIds,
    roundPlayerSide,
  );
  const clutchScopeIncludes = scopeMatcher(
    clutchScope,
    analysis,
    scopedPlayerIds,
    roundPlayerSide,
  );
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
  const playerSectionActive =
    tab === "rating" ||
    tab === "headToHead" ||
    tab === "mapZones" ||
    (tab === "details" && detailSection !== "timeline");
  // One entry per family of metrics the report can show. The hero states how
  // many of them this demo actually carries so a sparse import is never
  // mistaken for a complete one. Player-level tables reuse the same counts.
  const totalPlayers = analysis.players.length;
  const countPlayers = (predicate: (player: PlayerAnalysis) => boolean) =>
    analysis.players.filter(predicate).length;
  // A player counts as covered for Aim as soon as the demo recorded shots for
  // them; precision may still be null when damage association is missing.
  const mechanicsCount = [...mechanicsByPlayer.values()].filter((value) => (value.shots ?? 0) > 0).length;
  const dataCoverage = [
    { key: "kills", label: "Kills", available: countPlayers((player) => player.metrics.kills !== null) },
    { key: "damage", label: "Damage", available: countPlayers((player) => player.metrics.adr !== null) },
    { key: "kast", label: "KAST", available: countPlayers((player) => player.metrics.kastRate !== null) },
    { key: "aim", label: "Shots", available: mechanicsCount },
    { key: "openings", label: "Openings", available: countPlayers((player) => player.metrics.openingAttempts !== null) },
    { key: "trades", label: "Trade kills", available: countPlayers((player) => player.metrics.tradeKills !== null) },
    { key: "clutches", label: "Clutches", available: countPlayers((player) => player.metrics.clutchOpportunities !== null) },
    { key: "utility", label: "Utility", available: countPlayers((player) => player.utility !== null && player.utility !== undefined) },
  ] as const;
  const coverageOf = (key: (typeof dataCoverage)[number]["key"]) =>
    dataCoverage.find((entry) => entry.key === key)?.available ?? 0;
  const sectionUnavailable = (
    key: (typeof dataCoverage)[number]["key"],
    reason: string,
  ): string | undefined => (totalPlayers > 0 && coverageOf(key) === 0 ? reason : undefined);
  const aimUnavailable = sectionUnavailable("aim", "aucun événement de tir dans cette démo");
  const utilityUnavailable = sectionUnavailable("utility", "aucun flux utilitaire dans cette démo");
  const tradesUnavailable = sectionUnavailable("trades", "aucun événement de dégâts pour mesurer les trades");
  const openingsUnavailable = sectionUnavailable("openings", "aucun opening exploitable dans cette démo");
  const clutchesUnavailable = sectionUnavailable("clutches", "aucune situation de clutch détectée");
  const overviewEmptyState = (() => {
    if (totalPlayers === 0) return null;
    if (overviewMetricSet === "aim" && aimUnavailable) {
      return {
        title: "Aim indisponible pour cette démo",
        description: "Aucun événement de tir n’a été enregistré : précision, sprays et arrêts avant tir ne peuvent pas être calculés. Les kills et headshots restent disponibles dans l’onglet Général.",
      };
    }
    if (overviewMetricSet === "utility" && utilityUnavailable) {
      return {
        title: "Utility indisponible pour cette démo",
        description: "Aucun lancer de grenade ni événement de flash n’a été enregistré. Rien n’est estimé à leur place.",
      };
    }
    if (overviewMetricSet === "positioning" && openingsUnavailable && tradesUnavailable && clutchesUnavailable) {
      return {
        title: "Openings, trades et clutches indisponibles",
        description: "Cette démo ne contient pas les événements nécessaires pour reconstruire les duels d’ouverture, les trades ni les clutchs.",
      };
    }
    return null;
  })();
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
      unavailableReason: aimUnavailable,
      label: "Aim",
      active: tab === "details" && detailSection === "aim",
      onSelect: () => {
        setDetailSection("aim");
        setTab("details");
      },
    },
    {
      value: "utility",
      unavailableReason: utilityUnavailable,
      label: "Utility",
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
      unavailableReason: tradesUnavailable,
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
      unavailableReason: openingsUnavailable,
      label: "Openings",
      active: tab === "details" && detailSection === "openings",
      onSelect: () => {
        setDetailSection("openings");
        setTab("details");
      },
    },
    {
      value: "clutches",
      unavailableReason: clutchesUnavailable,
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
      <ReportHero analysis={analysis} spatial={spatial} coverage={dataCoverage} />

      <ReportPrimaryNavigation items={primaryNavigation} />

      {playerSectionActive && (
        <>
          <ReportSecondaryNavigation items={analysisNavigation} />
          {tab !== "headToHead" && selectedPlayer && (
            <GlobalPlayerSelector
              players={rankedPlayers}
              selectedPlayerId={selectedPlayer.playerId}
              onChange={setSelectedPlayerId}
            />
          )}
        </>
      )}

      {tab === "overview" && (
        <div className="mt-6 grid gap-6">
          <div className="grid gap-6">
            <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
              <div className="flex flex-col gap-4 border-b border-[var(--rl-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="mt-1 text-base font-semibold tracking-[-0.02em] text-[var(--rl-fg)]"><DefinitionTerm label="Joueurs" definition="Compare les deux équipes sans changer de page." /></h2>
                </div>
                <div className="flex overflow-x-auto rounded-md border border-white/[0.055] bg-black/25 p-1">
                  {([
                    ["general", "Général"],
                    ["aim", "Aim"],
                    ["positioning", "Positionnement"],
                    ["utility", "Utility"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={overviewMetricSet === value}
                      onClick={() => setOverviewMetricSet(value)}
                      className={[
                        "shrink-0 rounded-[4px] px-3 py-1.5 text-[13px] font-semibold transition-colors",
                        overviewMetricSet === value
                          ? "bg-emerald-300/[0.12] text-[var(--rl-positive)] shadow-[inset_0_0_0_1px_rgba(110,231,183,0.08)]"
                          : "text-[var(--rl-fg-dim)] hover:bg-white/[0.035] hover:text-[var(--rl-fg)]",
                      ].join(" ")}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {overviewEmptyState ? (
                <ReportEmptyState
                  title={overviewEmptyState.title}
                  description={overviewEmptyState.description}
                />
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[50rem] text-left text-sm">
                  <thead className="bg-white/[0.018] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--rl-fg-dim)]">
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
                          <th className="px-3 py-2.5 text-right">Shots</th>
                          <th className="px-3 py-2.5 text-right"><DefinitionTerm label="HS%" /></th>
                          <th className="px-3 py-2.5 text-right">
                            <DefinitionTerm label="Accuracy" />
                          </th>
                          <th className="px-3 py-2.5 text-right"><DefinitionTerm label="Spray accuracy" /></th>
                          <th className="px-4 py-2.5 text-right"><DefinitionTerm label="Counter-strafing" /></th>
                        </>
                      )}
                      {overviewMetricSet === "positioning" && (
                        <>
                          <th className="px-3 py-2.5 text-right">Openings</th>
                          <th className="px-3 py-2.5 text-right">Success</th>
                          <th className="px-3 py-2.5 text-right"><DefinitionTerm label="Trade kills" /></th>
                          <th className="px-3 py-2.5 text-right"><DefinitionTerm label="Traded deaths" /></th>
                          <th className="px-4 py-2.5 text-right">Clutches</th>
                        </>
                      )}
                      {overviewMetricSet === "utility" && (
                        <>
                          <th className="px-3 py-2.5 text-right">Utility thrown</th>
                          <th className="px-3 py-2.5 text-right">Enemies flashed</th>
                          <th className="px-3 py-2.5 text-right"><DefinitionTerm label="Flash blind duration" /></th>
                          <th className="px-3 py-2.5 text-right">Flash assists</th>
                          <th className="px-4 py-2.5 text-right">Unused utility</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  {overviewPlayerGroups.map((team) => (
                    <tbody key={team.key}>
                      {!(team.key === "unassigned" && overviewPlayerGroups.length === 1) && (
                      <tr className={[
                        "border-t border-[var(--rl-border)]",
                        team.accent === "sky"
                          ? "bg-sky-400/[0.045]"
                          : team.accent === "amber"
                            ? "bg-[color-mix(in_oklab,var(--rl-t)_7%,transparent)]"
                            : "bg-white/[0.025]",
                      ].join(" ")}>
                        <th
                          colSpan={7}
                          className={[
                            "border-l-2 px-4 py-2 text-[13px] font-semibold",
                            team.accent === "sky"
                              ? "border-[var(--rl-ct)] text-[var(--rl-ct)]"
                              : team.accent === "amber"
                                ? "border-[var(--rl-t)] text-[var(--rl-t)]"
                                : "border-neutral-500 text-[var(--rl-fg-muted)]",
                          ].join(" ")}
                        >
                          {teamLabel(team.name)}
                          {team.score !== null && (
                            <span className="ml-1 text-[var(--rl-fg-dim)]">{team.score}</span>
                          )}
                        </th>
                      </tr>
                      )}
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
                                  className="font-semibold text-[var(--rl-fg)] hover:text-[var(--rl-positive)]"
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
              )}
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
            <div className="rounded-md border border-[color-mix(in_oklab,var(--rl-warning)_22%,transparent)] bg-[color-mix(in_oklab,var(--rl-warning)_7%,transparent)] px-4 py-3">
              <div className="text-sm font-semibold text-[var(--rl-warning)]">
                <DefinitionTerm
                  label="Dégâts, flashes et KAST absents de cette importation"
                  definition="Les kills ont été conservés, mais pas les dégâts, les flashes ni certains états de fin de round. Réimporte la démo originale avec le parseur actuel pour les récupérer ; ils ne peuvent pas être reconstruits depuis les seuls kills."
                />
              </div>
              <Link
                href="/"
                className="mt-2 inline-flex text-xs font-semibold text-[var(--rl-warning)] hover:text-[var(--rl-warning)] hover:underline"
              >
                Réimporter la démo
              </Link>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--rl-fg-dim)]">
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
              label="Accuracy"
              available={[...mechanicsByPlayer.values()].filter((value) => value.accuracy !== null).length}
              total={analysis.players.length}
            />
          </div>
          <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
            <div className="border-b border-[var(--rl-border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--rl-fg)]"><DefinitionTerm label="Advantage conversion" definition="Avantage numérique acquis après une mort ou une déconnexion pendant le round." /></h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[13px] text-[var(--rl-fg-dim)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Équipe</th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Man-advantage rounds" />
                    </th>
                    <th className="px-3 py-3 text-right font-medium">Wins</th>
                    <th className="px-4 py-3 text-right font-medium">
                      <DefinitionTerm label="Advantage conversion" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.teams.map((team) => (
                    <tr key={team.logicalTeam} className="border-t border-[var(--rl-border)]">
                      <td className="px-4 py-3 font-semibold text-[var(--rl-fg)]">
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
          </article>
          <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
            <div className="border-b border-[var(--rl-border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--rl-fg)]"><DefinitionTerm label="Performance anti-eco" definition="La catégorie adverse vient du snapshot d’équipement à la fin du freeze time." /></h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[13px] text-[var(--rl-fg-dim)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Équipe</th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Anti-eco rounds" />
                    </th>
                    <th className="px-3 py-3 text-right font-medium">Wins</th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Anti-eco conversion" />
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      <DefinitionTerm label="Losses vs eco" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.teams.map((team) => (
                    <tr key={team.logicalTeam} className="border-t border-[var(--rl-border)]">
                      <td className="px-4 py-3 font-semibold text-[var(--rl-fg)]">
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
          </article>
          <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
            <div className="border-b border-[var(--rl-border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--rl-fg)]"><DefinitionTerm label="Économie du joueur" definition="Équipement observé avant la mort et inventaire conservé à la fin des rounds perdus." /></h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[13px] text-[var(--rl-fg-dim)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Net spend" />
                    </th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Equipment value lost on death" />
                    </th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Avg value lost" />
                    </th>
                    <th className="px-3 py-3 text-right font-medium">
                      <DefinitionTerm label="Saved weapons" />
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
                      <tr key={player.playerId} className="border-t border-[var(--rl-border)]">
                        <td className="px-4 py-3 font-semibold text-[var(--rl-fg)]">
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
                                className="text-xs font-semibold text-[var(--rl-positive)] hover:text-[var(--rl-positive)] hover:underline"
                              >
                                Ouvrir
                              </button>
                            )
                            : <span className="text-[var(--rl-fg-dim)]">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>
          <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[58rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[13px] text-[var(--rl-fg-dim)]">
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
                      "border-t border-[var(--rl-border)]",
                      team.playerIds.some((playerId) => firstTeamPlayerIds.includes(playerId))
                        ? "bg-sky-400/[0.045]"
                        : "bg-[color-mix(in_oklab,var(--rl-t)_7%,transparent)]",
                    ].join(" ")}>
                      <th
                        colSpan={11}
                        className={[
                          "border-l-2 px-4 py-2 text-xs font-semibold",
                          team.playerIds.some((playerId) => firstTeamPlayerIds.includes(playerId))
                            ? "border-[var(--rl-ct)] text-[var(--rl-ct)]"
                            : "border-[var(--rl-t)] text-[var(--rl-t)]",
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
                          <tr key={player.playerId} className="border-t border-[var(--rl-border)] hover:bg-white/[0.025]">
                            <td className="px-4 py-3">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPlayerId(player.playerId);
                                  setTab("rating");
                                }}
                                className="font-semibold text-[var(--rl-fg)] hover:text-[var(--rl-positive)]"
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
          <aside className="max-h-[calc(100vh-13rem)] overflow-y-auto rounded-md border border-[var(--rl-border)] bg-[#121515] p-2">
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
                      : "text-[var(--rl-fg-muted)] hover:bg-white/[0.05]",
                  ].join(" ")}
                >
                  <span className="font-semibold tabular-nums">
                    {String(displayRound(round.roundNumber)).padStart(2, "0")}
                  </span>
                  <span className="truncate">{winnerName}</span>
                  <span className={selected ? "text-[var(--rl-fg-dim)]" : "text-[var(--rl-fg-dim)]"}>
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
                  <h2 className="mt-1 text-2xl font-semibold text-white">
                    Round {displayRound(selectedRound.roundNumber)}
                  </h2>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[var(--rl-fg-dim)]">Score après le round</div>
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
                  value={selectedRound.winner === "T" || selectedRound.winner === "CT" ? selectedRound.winner : "—"}
                />
                <Metric
                  label="Joueurs"
                  value={String(selectedRound.players.length)}
                />
              </div>
            </article>

            <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Économie au départ</h3>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {selectedRound.economy.map((economy) => (
                  <div
                    key={economy.side}
                    className="flex items-center justify-between rounded-md border border-[var(--rl-border)] bg-white/[0.02] px-4 py-3"
                  >
                    <div>
                      <div className="text-xs font-semibold text-[var(--rl-fg-dim)]">{economy.side}</div>
                      <div className="mt-1 text-sm font-semibold text-[var(--rl-fg)]">
                        <span
                          title={metricQualityTitle(economy.quality.category)}
                          tabIndex={0}
                        >
                          {economyLabel(economy.category)}
                        </span>
                      </div>
                    </div>
                    <div className="text-right text-sm tabular-nums text-[var(--rl-fg-muted)]">
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

            <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Joueurs du round</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[42rem] text-left text-sm">
                  <thead className="text-xs text-[var(--rl-fg-dim)]">
                    <tr>
                      <th className="pb-2 font-medium">Joueur</th>
                      <th className="pb-2 font-medium">Équipe</th>
                      <th className="pb-2 font-medium">Côté</th>
                      <th className="pb-2 font-medium">K / D / A</th>
                      <th className="pb-2 font-medium">Damage</th>
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
                        <tr key={player.playerId} className="border-t border-[var(--rl-border)]">
                          <td className="py-3 font-semibold text-[var(--rl-fg)]">
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
          <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[58rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[13px] text-[var(--rl-fg-dim)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium">Damage</th>
                    <th className="px-3 py-3 text-right font-medium">HE damage</th>
                    <th className="px-3 py-3 text-right font-medium">Molotov damage</th>
                    <th className="px-3 py-3 text-right font-medium">Enemies flashed</th>
                    <th className="px-3 py-3 text-right font-medium">Shots</th>
                    <th className="px-4 py-3 text-right font-medium"><DefinitionTerm label="Survival" /></th>
                  </tr>
                </thead>
                <tbody>
                  {scopedPlayers.map((player) => {
                    const playerMechanics = mechanicsByPlayer.get(player.playerId);
                    return (
                      <tr key={player.playerId} className="border-t border-[var(--rl-border)]">
                        <td className="px-4 py-3 font-semibold text-[var(--rl-fg)]">
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
                            <span className="ml-1 text-xs text-[var(--rl-fg-dim)]">
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
          {tradesUnavailable && (
            <div className="rounded-md border border-[color-mix(in_oklab,var(--rl-warning)_22%,transparent)] bg-[#121515]">
              <ReportEmptyState
                title="Trades indisponibles pour cette démo"
                description="Les trades se mesurent à partir des dégâts infligés après la mort d’un coéquipier ; cette démo n’en contient pas. Les tableaux ci-dessous restent vides plutôt que remplis de zéros."
              />
            </div>
          )}
          <CoverageStrip
            total={scopedPlayers.length}
            entries={[
                { label: "Trade kills", available: scopedPlayers.filter((player) => player.metrics.tradeKills !== null).length },
                { label: "Trade kill opportunities", available: scopedPlayers.filter((player) => player.metrics.tradeAttempts !== null).length },
              ]}
          />
          <article>
            <h2 className="mt-1 text-2xl font-semibold text-white"><DefinitionTerm label="Trades" definition="Trades tentés, réussis et morts tradées." /></h2>
          </article>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <Metric
              label="Trade kill attempts"
              value={number(totalTradeAttempts)}
            />
            <Metric
              label="Trade kills"
              value={number(totalTradeKills)}
            />
            <Metric
              label="Trade kill success"
              value={percent(
                totalTradeAttempts === null ||
                    totalTradeAttempts === 0 ||
                    totalTradeKills === null
                  ? null
                  : totalTradeKills / totalTradeAttempts,
              )}
            />
            <Metric
              label="Traded deaths"
              value={number(totalTradeDeaths)}
            />
            <Metric
              label="Traded deaths %"
              value={percent(
                totalTradeDeaths === null || totalDeaths === 0
                  ? null
                  : totalTradeDeaths / totalDeaths,
              )}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Bilan par joueur</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[38rem] text-left text-sm">
                  <thead className="text-xs text-[var(--rl-fg-dim)]">
                    <tr>
                      <th className="pb-2 font-medium">Joueur</th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Trade kill attempts" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Trade kills" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Trade kill success" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Traded deaths" /></th>
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
                        <tr key={player.playerId} className="border-t border-[var(--rl-border)]">
                          <td className="py-3 font-semibold text-[var(--rl-fg)]">
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

            <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white"><DefinitionTerm label="Trade actions" definition="Les morts tradées ouvrent la mort initiale ; les trade kills ouvrent l’élimination de réponse." /></h3>
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
                        className="flex items-center justify-between gap-3 rounded-md border border-[var(--rl-border)] px-3 py-2 text-left hover:bg-white/[0.05]"
                      >
                        <span>
                          <span className="block text-sm font-semibold text-[var(--rl-fg)]">{label}</span>
                          <span className="text-xs text-[var(--rl-fg-dim)]">{action.playerName}</span>
                        </span>
                        <span className="text-xs tabular-nums text-[var(--rl-fg-dim)]">
                          R{displayRound(action.evidence.roundNumber)} · {action.evidence.time.toFixed(1)} s
                        </span>
                      </button>
                    );
                  })}
                  {replayableTradeActions.length === 0 && (
                    <p className="text-sm text-[var(--rl-fg-dim)]">Aucune action de trade détectée.</p>
                  )}
                </div>
              </div>
            </article>
          </div>
        </div>
      )}

      {tab === "details" && detailSection === "utility" && (
        <div className="mt-6 grid gap-6">
          {utilityUnavailable && (
            <div className="rounded-md border border-[color-mix(in_oklab,var(--rl-warning)_22%,transparent)] bg-[#121515]">
              <ReportEmptyState
                title="Utility indisponible pour cette démo"
                description="Aucun lancer de grenade ni événement de flash n’a été enregistré. Rien n’est estimé à leur place."
              />
            </div>
          )}
          <CoverageStrip
            total={scopedPlayers.length}
            entries={[
                { label: "Utility", available: scopedPlayers.filter((player) => player.metrics.grenadesThrown !== null).length },
                { label: "Flashes", available: scopedPlayers.filter((player) => player.metrics.flashes != null).length },
              ]}
          />
          <article>
            <h2 className="mt-1 text-2xl font-semibold text-white"><DefinitionTerm label="Utility" definition="Lancers, efficacité des flashes et utilitaires conservés à la mort." /></h2>
          </article>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Metric
              label="Utility quantity"
              value={number(selectedUtilityQuality?.utilityQuantityRating.value ?? null)}
              quality={selectedUtilityQuality?.utilityQuantityRating}
            />
            <Metric
              label="Enemies flashed per flash"
              value={number(selectedUtilityQuality?.enemiesPerFlash.value ?? null, 2)}
              quality={selectedUtilityQuality?.enemiesPerFlash}
            />
            <Metric
              label="Teammates flashed per flash"
              value={number(selectedUtilityQuality?.teammatesPerFlash.value ?? null, 2)}
              quality={selectedUtilityQuality?.teammatesPerFlash}
            />
            <Metric
              label="Flashbangs leading to kills"
              value={number(selectedUtilityQuality?.flashKillsPerFlash.value ?? null, 2)}
              quality={selectedUtilityQuality?.flashKillsPerFlash}
            />
            <Metric
              label="Flash blind duration"
              value={selectedUtilityQuality?.averageEnemyBlindDuration.value === null ||
                  selectedUtilityQuality?.averageEnemyBlindDuration.value === undefined
                ? "—"
                : `${selectedUtilityQuality.averageEnemyBlindDuration.value.toFixed(1)} s`}
              quality={selectedUtilityQuality?.averageEnemyBlindDuration}
            />
            <Metric
              label="HE damage per grenade"
              value={number(selectedUtilityQuality?.heDamagePerGrenade.value ?? null, 1)}
              quality={selectedUtilityQuality?.heDamagePerGrenade}
            />
            <Metric
              label="Teammate HE damage"
              value={number(
                selectedUtilityQuality?.teammateHeDamagePerGrenade.value ?? null,
                1,
              )}
              quality={selectedUtilityQuality?.teammateHeDamagePerGrenade}
            />
            <Metric
              label="Unused utility on death"
              value={selectedUtilityQuality?.averageUnusedUtilityValue.value === null ||
                  selectedUtilityQuality?.averageUnusedUtilityValue.value === undefined
                ? "—"
                : `$${number(selectedUtilityQuality.averageUnusedUtilityValue.value)}`}
              quality={selectedUtilityQuality?.averageUnusedUtilityValue}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Usage par joueur</h3>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[88rem] text-left text-sm">
                  <thead className="text-xs text-[var(--rl-fg-dim)]">
                    <tr>
                      <th className="pb-2 font-medium">Joueur</th>
                      <th className="pb-2 font-medium">Utility quantity</th>
                      <th className="pb-2 font-medium">Total</th>
                      <th className="pb-2 font-medium">Flash</th>
                      <th className="pb-2 font-medium">Smoke</th>
                      <th className="pb-2 font-medium">HE</th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="HE damage per grenade" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Teammate HE damage per grenade" /></th>
                      <th className="pb-2 font-medium">Feu</th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Enemies flashed per flash" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Teammates flashed per flash" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Flash blind duration" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Flashbangs leading to kills" /></th>
                      <th className="pb-2 font-medium"><DefinitionTerm label="Unused utility on death" /></th>
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
                          <tr key={player.playerId} className="border-t border-[var(--rl-border)]">
                            <td className="py-3 font-semibold text-[var(--rl-fg)]">
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

            <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
              <div className="border-b border-[var(--rl-border)] px-4 py-3">
                <h3 className="text-sm font-semibold text-white">
                  Répartition de {selectedPlayer?.name ?? "ce joueur"}
                </h3>
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
                    ["Smoke", counts.smoke, "bg-[var(--rl-info)]"],
                    ["HE", counts.he, "bg-[var(--rl-warning)]"],
                    ["Feu", counts.fire, "bg-[var(--rl-critical)]"],
                  ] as const;
                  return (
                    <section key={team.key} className="bg-[#121515] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className={[
                            "size-1.5 rounded-full",
                            team.accent === "sky"
                              ? "bg-[var(--rl-ct)]"
                              : team.accent === "amber"
                                ? "bg-[var(--rl-t)]"
                                : "bg-neutral-500",
                          ].join(" ")} />
                          <span className="text-sm font-semibold text-[var(--rl-fg)]">
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
                            <div className="flex items-center gap-1.5 text-xs text-[var(--rl-fg-dim)]">
                              <span className={["size-1 rounded-full", color].join(" ")} />
                              {label}
                            </div>
                            <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--rl-fg)]">
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

          <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-5">
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
                    className="flex items-center justify-between gap-3 rounded-md border border-[var(--rl-border)] px-3 py-2 text-left hover:bg-white/[0.05]"
                  >
                    <span>
                      <span className="block text-sm font-semibold text-[var(--rl-fg)]">{label}</span>
                      <span className="text-xs text-[var(--rl-fg-dim)]">{action.playerName}</span>
                    </span>
                    <span className="text-xs tabular-nums text-[var(--rl-fg-dim)]">
                      R{displayRound(action.evidence.roundNumber)} · {action.evidence.time.toFixed(1)} s
                    </span>
                  </button>
                );
              })}
              {replayableUtilityActions.length === 0 && (
                <p className="text-sm text-[var(--rl-fg-dim)]">Aucune action utilitaire disponible.</p>
              )}
            </div>
          </article>
        </div>
      )}

      {tab === "details" && detailSection === "aim" && (
        <div className="mt-6 grid gap-6">
          {aimUnavailable && (
            <div className="rounded-md border border-[color-mix(in_oklab,var(--rl-warning)_22%,transparent)] bg-[#121515]">
              <ReportEmptyState
                title="Aim indisponible pour cette démo"
                description="Aucun événement de tir n’a été enregistré : précision, sprays et arrêts avant tir ne peuvent pas être calculés. Les tableaux ci-dessous restent vides plutôt que remplis de zéros."
              />
            </div>
          )}
          <CoverageStrip
            total={scopedPlayers.length}
            entries={[
                { label: "Accuracy", available: [...mechanicsByPlayer.values()].filter((value) => value.accuracy !== null).length },
                { label: "Time to damage", available: [...mechanicsByPlayer.values()].filter((value) => value.timeToDamageMs !== null).length },
              ]}
          />
          <article>
            <h2 className="mt-1 text-2xl font-semibold text-white"><DefinitionTerm label="Aim" definition="Mesures observées, reconstruites ou estimées depuis la démo, avec couverture et limites explicites." /></h2>
          </article>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <Metric
              label="Accuracy"
              value={percent(
                totalAimShots === null ||
                totalAimShots === 0 ||
                totalAimHitShots === null
                  ? null
                  : totalAimHitShots / totalAimShots,
              )}
            />
            <Metric
              label="Accuracy (enemy spotted)"
              value={percent(spottedAccuracy)}
            />
            <Metric
              label="Time to damage"
              value={averageTimeToDamage === null ? "—" : `${number(averageTimeToDamage)} ms`}
            />
            <Metric
              label="Crosshair placement"
              value={averageCrosshairError === null ? "—" : `${number(averageCrosshairError, 1)}°`}
            />
            <Metric
              label="Spray accuracy"
              value={percent(averageSprayAccuracy)}
            />
            <Metric
              label="Counter-strafing"
              value={percent(averageCounterStrafe)}
            />
          </div>

          <details className="group overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 hover:bg-white/[0.025]">
              <span>
                <span className="block text-sm font-semibold text-[var(--rl-fg)]">Données brutes de tir</span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-[var(--rl-fg-dim)] group-open:hidden">Afficher</span>
              <span className="hidden shrink-0 text-xs font-semibold text-[var(--rl-fg-dim)] group-open:inline">Masquer</span>
            </summary>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[80rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[13px] text-[var(--rl-fg-dim)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium">Shots</th>
                    <th className="px-3 py-3 text-right font-medium">Hits</th>
                    <th className="px-3 py-3 text-right font-medium">Damage</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Damage per hit" /></th>
                    <th className="px-3 py-3 text-right font-medium">Head</th>
                    <th className="px-3 py-3 text-right font-medium">Body</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Tap" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Burst" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Spray" /></th>
                    <th className="px-4 py-3 text-right font-medium">
                      <DefinitionTerm label="Shots while moving" />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {scopedPlayers.map((player) => {
                    const playerMechanics = mechanicsByPlayer.get(player.playerId);
                    return (
                      <tr key={player.playerId} className="border-t border-[var(--rl-border)]">
                        <td className="px-4 py-3 font-semibold text-[var(--rl-fg)]">
                          <span className={[
                            "mr-2 inline-block size-1.5 rounded-full align-middle",
                            firstTeamPlayerIds.includes(player.playerId)
                              ? "bg-[var(--rl-ct)]"
                              : secondTeamPlayerIds.includes(player.playerId)
                                ? "bg-[var(--rl-t)]"
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
          </details>

          <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
            <div className="border-b border-[var(--rl-border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--rl-fg)]"><DefinitionTerm label="Métriques avancées" definition="Chaque valeur affiche son nombre d’échantillons lorsqu’il est disponible." /></h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[96rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[13px] text-[var(--rl-fg-dim)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Shots (enemy spotted)" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Accuracy (enemy spotted)" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Time to damage" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Crosshair placement" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Headshot accuracy" /></th>
                    <th className="px-3 py-3 text-right font-medium">First bullet accuracy</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Spray accuracy" /></th>
                    <th className="px-3 py-3 text-right font-medium">Crouched shots</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Scoped shots" /></th>
                    <th className="px-3 py-3 text-right font-medium">Wallbangs</th>
                    <th className="px-3 py-3 text-right font-medium">Distance per hit</th>
                    <th className="px-3 py-3 text-right font-medium">Exposition avant tir</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Counter-strafing" /></th>
                    <th className="px-4 py-3 text-right font-medium"><DefinitionTerm label="Accuracy" /></th>
                  </tr>
                </thead>
                <tbody>
                  {scopedPlayers.map((player) => {
                    const playerMechanics = mechanicsByPlayer.get(player.playerId);
                    return (
                      <tr key={player.playerId} className="border-t border-[var(--rl-border)]">
                        <td className="px-4 py-3 font-semibold text-[var(--rl-fg)]">
                          <span className={[
                            "mr-2 inline-block size-1.5 rounded-full align-middle",
                            firstTeamPlayerIds.includes(player.playerId)
                              ? "bg-[var(--rl-ct)]"
                              : secondTeamPlayerIds.includes(player.playerId)
                                ? "bg-[var(--rl-t)]"
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
          </article>

        </div>
      )}

      {tab === "details" && detailSection === "weapons" && (
        <div className="mt-6 grid gap-4">
          <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-4">
            <h3 className="text-sm font-semibold text-[var(--rl-fg)]"><DefinitionTerm label="Périmètre" definition="Les filtres s’appliquent aux tirs, dégâts et kills du tableau." /></h3>
            <ReportScopeFilters
              analysis={analysis}
              scope={weaponScope}
              onChange={setWeaponScope}
              playerName={selectedPlayer?.name ?? null}
              displayRound={displayRound}
            />
          </article>

          <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--rl-border)] px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-[var(--rl-fg)]"><DefinitionTerm label="Statistiques par arme" definition="Un tir touché est un tir associé à au moins un événement de dégâts." /></h3>
              </div>
              <span className={[
                "rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide",
                weaponAssociationSamples > 0 &&
                  weaponAssociationUsable === weaponAssociationSamples
                  ? "bg-emerald-300/[0.08] text-[var(--rl-positive)]"
                  : "bg-amber-300/[0.08] text-[var(--rl-warning)]",
              ].join(" ")}>
                Association {weaponAssociationUsable}/{weaponAssociationSamples}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[13px] text-[var(--rl-fg-dim)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Arme</th>
                    <th className="px-3 py-3 text-right font-medium">Shots</th>
                    <th className="px-3 py-3 text-right font-medium">Shots hit</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Accuracy" /></th>
                    <th className="px-3 py-3 text-right font-medium">Damage</th>
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
                      <tr key={row.weapon} className="border-t border-[var(--rl-border)]">
                        <td className="px-4 py-3 font-semibold text-[var(--rl-fg)]">
                          {weaponLabel(row.weapon)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{mechanics ? row.shots : "—"}</td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {row.reliableShots > 0 ? row.hitShots : "—"}
                        </td>
                        <td className="px-3 py-3 text-right font-semibold tabular-nums text-[var(--rl-positive)]">
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
              <p className="border-t border-[var(--rl-border)] px-4 py-5 text-sm text-[var(--rl-fg-dim)]">
                Aucune donnée d’arme ne correspond à ces filtres.
              </p>
            )}
          </article>
        </div>
      )}

      {tab === "details" && detailSection === "openings" && (
        <div className="mt-6 grid gap-6">
          {openingsUnavailable && (
            <div className="rounded-md border border-[color-mix(in_oklab,var(--rl-warning)_22%,transparent)] bg-[#121515]">
              <ReportEmptyState
                title="Openings indisponibles pour cette démo"
                description="Aucun duel d’ouverture exploitable n’a pu être reconstruit à partir des kills de cette démo."
              />
            </div>
          )}
          <CoverageStrip
            total={scopedPlayers.length}
            entries={[
                { label: "Openings", available: scopedPlayers.filter((player) => player.metrics.openingAttempts !== null).length },
              ]}
          />
          <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
            <div className="flex flex-col gap-3 border-b border-[var(--rl-border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--rl-fg)]"><DefinitionTerm label="Openings" definition="Fréquence d’engagement, réussite et réponse de l’équipe après une mort d’ouverture." /></h2>
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
                      "min-w-12 rounded-[3px] px-3 py-1.5 text-[13px] font-semibold transition-colors",
                      openingSide === value
                        ? "bg-white/[0.1] text-[var(--rl-fg)]"
                        : "text-[var(--rl-fg-dim)] hover:text-[var(--rl-fg)]",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[13px] text-[var(--rl-fg-dim)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Opening attempts" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Opening success" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Traded deaths" /></th>
                    <th className="px-3 py-3 text-right font-medium">Main opponent</th>
                    <th className="px-3 py-3 text-right font-medium">Best weapon</th>
                    <th className="px-4 py-3 text-right font-medium">Most killed by</th>
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
                      <tr key={player.playerId} className="border-t border-[var(--rl-border)]">
                        <td className="px-4 py-3 font-semibold text-[var(--rl-fg)]">
                          {playerIdentity(player.playerId, player.name)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {number(attempts)}
                          {attempts !== null && roundsPlayed > 0 && (
                            <span className="ml-1 text-xs text-[var(--rl-fg-dim)]">
                              ({percent(attempts / roundsPlayed)})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {number(openingWinsCount)}
                          {attempts !== null && attempts > 0 && openingWinsCount !== null && (
                            <span className="ml-1 text-xs text-[var(--rl-positive)]">
                              ({percent(openingWinsCount / attempts)})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {tradedOpeningDeaths}
                          {openingLosses.length > 0 && (
                            <span className="ml-1 text-xs text-[var(--rl-fg-dim)]">
                              ({percent(tradedOpeningDeaths / openingLosses.length)})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3 text-right text-[var(--rl-fg-muted)]">
                          {analysis.players.find((candidate) => candidate.playerId === mainVictimId)?.name ?? "—"}
                        </td>
                        <td className="px-3 py-3 text-right text-[var(--rl-fg-muted)]">{weaponLabel(bestWeapon)}</td>
                        <td className="px-4 py-3 text-right text-[var(--rl-fg-muted)]">
                          {analysis.players.find((candidate) => candidate.playerId === mainKillerId)?.name ?? "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>

          <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
            <div className="border-b border-[var(--rl-border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--rl-fg)]">Détail par round</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-left text-sm">
                <thead className="text-[13px] text-[var(--rl-fg-dim)]">
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
                    <tr key={proof.evidenceId} className="border-t border-[var(--rl-border)]">
                      <td className="px-4 py-3 tabular-nums">{displayRound(proof.roundNumber)}</td>
                      <td className="px-3 py-3">
                        {analysis.players.find((player) => player.playerId === proof.actors[0])?.name ?? "—"}
                      </td>
                      <td className="px-3 py-3">
                        {analysis.players.find((player) => player.playerId === proof.actors[1])?.name ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-[var(--rl-fg-muted)]">
                        {roundPlayerSide.get(`${proof.roundNumber}:${proof.actors[0]}`) ?? "—"}
                      </td>
                      <td className="px-3 py-3 text-[var(--rl-fg-muted)]">{weaponLabel(proof.weapon ?? null)}</td>
                      <td className="px-3 py-3 tabular-nums">{proof.time.toFixed(1)} s</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => onOpenEvidence(proof.evidenceId)}
                          className="font-semibold text-[var(--rl-positive)] hover:underline"
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
          {clutchesUnavailable && (
            <div className="rounded-md border border-[color-mix(in_oklab,var(--rl-warning)_22%,transparent)] bg-[#121515]">
              <ReportEmptyState
                title="Clutches indisponibles pour cette démo"
                description="Aucune situation où un joueur reste seul face à l’adversaire n’a été détectée dans cette démo."
              />
            </div>
          )}
          <CoverageStrip
            total={scopedPlayers.length}
            entries={[
                { label: "Clutches", available: scopedPlayers.filter((player) => player.metrics.clutchOpportunities !== null).length },
                { label: "Clutch outcomes", available: scopedPlayers.filter((player) => player.metrics.clutchOutcomes !== null).length },
              ]}
          />
          <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] px-4 py-4">
            <h3 className="text-sm font-semibold text-[var(--rl-fg)]"><DefinitionTerm label="Portée" definition="Restreint les clutchs comptés ci-dessous." /></h3>
            <ReportScopeFilters
              analysis={analysis}
              scope={clutchScope}
              onChange={setClutchScope}
              playerName={selectedPlayer?.name ?? null}
              displayRound={displayRound}
            />
          </article>

          <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[62rem] text-left text-sm">
                <thead className="bg-white/[0.02] text-[13px] text-[var(--rl-fg-dim)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Joueur</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="1v1" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="1v2" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="1v3" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="1v4" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="1v5+" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Trade kill opportunities" /></th>
                    <th className="px-3 py-3 text-right font-medium">Won</th>
                    <th className="px-3 py-3 text-right font-medium">Lost</th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Saves" /></th>
                    <th className="px-3 py-3 text-right font-medium"><DefinitionTerm label="Post-plant" /></th>
                    <th className="px-4 py-3 text-right font-medium">Success</th>
                  </tr>
                </thead>
                <tbody>
                  {scopedPlayers.map((player) => {
                    const opportunities = player.metrics.clutchOpportunities;
                    const wins = player.metrics.clutchWins;
                    const outcomes = player.metrics.clutchOutcomes;
                    // Per-size counts are precomputed for the whole match, so
                    // the totals are recounted from evidence whenever a filter
                    // narrows the scope. Without evidence the row states its
                    // unavailability rather than showing a filtered zero.
                    const scopeNarrowed =
                      clutchScope.teamId !== "all" ||
                      clutchScope.side !== "all" ||
                      clutchScope.roundNumber !== "all";
                    const countScoped = (evidenceIds: string[]) => {
                      const rounds = new Set<number>();
                      for (const id of evidenceIds) {
                        const round = evidenceRound.get(id);
                        if (round !== undefined && clutchScopeIncludes(player.playerId, round)) {
                          rounds.add(round);
                        }
                      }
                      return rounds.size;
                    };
                    const totalOpportunities = opportunities === null
                      ? null
                      : scopeNarrowed
                        ? countScoped(player.metricEvidence.clutchOpportunities)
                        : Object.values(opportunities).reduce((total, value) => total + value, 0);
                    const totalWins = wins === null
                      ? null
                      : scopeNarrowed
                        ? countScoped(player.metricEvidence.clutchWins)
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
                      <tr key={player.playerId} className="border-t border-[var(--rl-border)]">
                        <td className="px-4 py-3 font-semibold text-[var(--rl-fg)]">
                          {playerIdentity(player.playerId, player.name)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsOne, wins?.oneVsOne)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsTwo, wins?.oneVsTwo)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsThree, wins?.oneVsThree)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsFour, wins?.oneVsFour)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{clutchCell(opportunities?.oneVsFivePlus, wins?.oneVsFivePlus)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(totalOpportunities)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-[var(--rl-positive)]">{number(totalWins)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-[var(--rl-critical)]">{number(totalLosses)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(outcomes?.saved ?? null)}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{number(outcomes?.afterPlant ?? null)}</td>
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
            <label className="grid gap-1 text-xs text-[var(--rl-fg-dim)]">
              Joueur A
              <select
                aria-label="Joueur A à comparer"
                value={effectiveHeadToHeadPlayerAId}
                onChange={(event) => setHeadToHeadPlayerAId(event.target.value)}
                className="h-10 rounded-md border border-[var(--rl-border)] bg-[#121515] px-3 text-sm text-[var(--rl-fg)]"
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
            <span className="hidden pb-2 text-xs text-[var(--rl-fg-dim)] sm:block">contre</span>
            <label className="grid gap-1 text-xs text-[var(--rl-fg-dim)]">
              Joueur B
              <select
                aria-label="Joueur B à comparer"
                value={effectiveHeadToHeadPlayerBId}
                onChange={(event) => setHeadToHeadPlayerBId(event.target.value)}
                className="h-10 rounded-md border border-[var(--rl-border)] bg-[#121515] px-3 text-sm text-[var(--rl-fg)]"
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

          <article className="grid gap-px overflow-hidden rounded-md border border-[var(--rl-border)] bg-white/10 md:grid-cols-[1fr_12rem_1fr]">
            <div className="bg-[#121515] p-5">
              <h2 className="text-lg font-semibold text-white">{headToHeadPlayerA.name}</h2>
              <p className="mt-1 text-sm text-[var(--rl-fg-dim)]">
                {number(headToHeadPlayerA.metrics.kills)} / {number(headToHeadPlayerA.metrics.assists)} / {headToHeadPlayerA.metrics.deaths}
              </p>
            </div>
            <div className="grid grid-cols-2 bg-[#0e1010] p-5 text-center">
              <div>
                <div className="text-2xl font-semibold text-white">
                  {headToHeadKills(headToHeadPlayerA.playerId, headToHeadPlayerB.playerId).length}
                </div>
                <div className="text-xs uppercase text-[var(--rl-fg-dim)]">Kills</div>
              </div>
              <div>
                <div className="text-2xl font-semibold text-white">
                  {headToHeadKills(headToHeadPlayerB.playerId, headToHeadPlayerA.playerId).length}
                </div>
                <div className="text-xs uppercase text-[var(--rl-fg-dim)]">Kills</div>
              </div>
            </div>
            <div className="bg-[#121515] p-5 text-right">
              <h2 className="text-lg font-semibold text-white">{headToHeadPlayerB.name}</h2>
              <p className="mt-1 text-sm text-[var(--rl-fg-dim)]">
                {number(headToHeadPlayerB.metrics.kills)} / {number(headToHeadPlayerB.metrics.assists)} / {headToHeadPlayerB.metrics.deaths}
              </p>
            </div>
          </article>

          <div className="grid gap-6 lg:grid-cols-3">
            <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Aim</h3>
              <div className="mt-4 grid gap-3 text-sm">
                <div className="flex justify-between"><span className="text-[var(--rl-fg-dim)]">Dégâts directs</span><span>{number(headToHeadDamage(headToHeadPlayerA.playerId, headToHeadPlayerB.playerId))} / {number(headToHeadDamage(headToHeadPlayerB.playerId, headToHeadPlayerA.playerId))}</span></div>
                <div className="flex justify-between"><span className="text-[var(--rl-fg-dim)]">HS kill %</span><span>{percent(headToHeadPlayerA.metrics.headshotRate)} / {percent(headToHeadPlayerB.metrics.headshotRate)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--rl-fg-dim)]">Accuracy all</span><span>{percent(mechanicsByPlayer.get(headToHeadPlayerA.playerId)?.accuracy ?? null)} / {percent(mechanicsByPlayer.get(headToHeadPlayerB.playerId)?.accuracy ?? null)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--rl-fg-dim)]">Counter-strafing</span><span>{percent(mechanicsByPlayer.get(headToHeadPlayerA.playerId)?.counterStrafeRate ?? null)} / {percent(mechanicsByPlayer.get(headToHeadPlayerB.playerId)?.counterStrafeRate ?? null)}</span></div>
                <div className="flex justify-between">
                  <span className="text-[var(--rl-fg-dim)]">Crosshair placement</span>
                  <span>
                    {number(mechanicsByPlayer.get(headToHeadPlayerA.playerId)?.crosshairErrorDegrees ?? null, 1)}° / {number(mechanicsByPlayer.get(headToHeadPlayerB.playerId)?.crosshairErrorDegrees ?? null, 1)}°
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--rl-fg-dim)]">Time to damage</span>
                  <span>
                    {number(mechanicsByPlayer.get(headToHeadPlayerA.playerId)?.timeToDamageMs ?? null)} ms / {number(mechanicsByPlayer.get(headToHeadPlayerB.playerId)?.timeToDamageMs ?? null)} ms
                  </span>
                </div>
              </div>
            </article>
            <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Armes du duel</h3>
              <div className="mt-4 grid gap-3 text-sm">
                <div>
                  <div className="text-xs font-semibold text-[var(--rl-info)]">{headToHeadPlayerA.name}</div>
                  <div className="mt-1 text-[var(--rl-fg-muted)]">
                    {headToHeadWeaponSummary(headToHeadPlayerA.playerId, headToHeadPlayerB.playerId)
                      .map(([weapon, count]) => `${weaponLabel(weapon)} ×${count}`)
                      .join(" · ") || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs font-semibold text-[var(--rl-warning)]">{headToHeadPlayerB.name}</div>
                  <div className="mt-1 text-[var(--rl-fg-muted)]">
                    {headToHeadWeaponSummary(headToHeadPlayerB.playerId, headToHeadPlayerA.playerId)
                      .map(([weapon, count]) => `${weaponLabel(weapon)} ×${count}`)
                      .join(" · ") || "—"}
                  </div>
                </div>
              </div>
            </article>
            <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-5">
              <h3 className="text-sm font-semibold text-white">Flashes</h3>
              <div className="mt-4 flex items-center justify-between text-sm">
                <span className="font-semibold text-[var(--rl-info)]">{headToHeadPlayerA.name}</span>
                <span className="tabular-nums text-[var(--rl-fg-muted)]">
                  {headToHeadFlashes(headToHeadPlayerA.playerId, headToHeadPlayerB.playerId)}
                  <span className="mx-2 text-[var(--rl-fg-dim)]">/</span>
                  {headToHeadFlashes(headToHeadPlayerB.playerId, headToHeadPlayerA.playerId)}
                </span>
                <span className="font-semibold text-[var(--rl-warning)]">{headToHeadPlayerB.name}</span>
              </div>
              <p className="mt-3 text-xs text-[var(--rl-fg-dim)]">Aveuglements directs entre les deux joueurs.</p>
            </article>
          </div>
        </div>
      )}

      {tab === "rating" && selectedPlayer && (
        <div className="mt-6 grid gap-6">
          <div>
            <div>
              <h2 className="mt-1 text-xl font-semibold text-white">{selectedPlayer.name}</h2>
            </div>
          </div>

          <article className="grid overflow-hidden border-y border-[var(--rl-border)] bg-[#121515] md:grid-cols-2 xl:grid-cols-4">
            <section className="p-5">
              <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--rl-fg-dim)]">
                Combat
              </h3>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Metric label="K/D" value={ratio(selectedPlayer.metrics.kdRatio)} />
                <Metric label="ADR" value={number(selectedPlayer.metrics.adr, 1)} />
                <Metric label="KAST" value={percent(selectedPlayer.metrics.kastRate)} />
                <Metric label="Damage" value={number(selectedPlayer.metrics.damageHealth)} />
              </div>
            </section>
            <section className="border-t border-[var(--rl-border)] p-5 md:border-l md:border-t-0">
              <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--rl-fg-dim)]">
                Aim
              </h3>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Metric label="Accuracy" value={percent(mechanicsByPlayer.get(selectedPlayer.playerId)?.accuracy ?? null)} />
                <Metric label="Spray" value={percent(mechanicsByPlayer.get(selectedPlayer.playerId)?.sprayAccuracy ?? null)} />
                <Metric label="HS%" value={percent(selectedPlayer.metrics.headshotRate)} />
                <Metric label="Counter-strafing" value={percent(mechanicsByPlayer.get(selectedPlayer.playerId)?.counterStrafeRate ?? null)} />
              </div>
            </section>
            <section className="border-t border-[var(--rl-border)] p-5 xl:border-l xl:border-t-0">
              <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--rl-fg-dim)]">
                Utility
              </h3>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Metric
                  label="Utility thrown"
                  value={number(selectedUtilityQuality?.grenadesThrown.value ?? null)}
                  quality={selectedUtilityQuality?.grenadesThrown}
                />
                <Metric
                  label="Utility quantity"
                  value={number(selectedUtilityQuality?.utilityQuantityRating.value ?? null)}
                  quality={selectedUtilityQuality?.utilityQuantityRating}
                />
                <Metric
                  label="Enemies flashed"
                  value={number(selectedUtilityQuality?.effectiveEnemiesFlashed.value ?? null)}
                  quality={selectedUtilityQuality?.effectiveEnemiesFlashed}
                />
                <Metric
                  label="HE damage"
                  value={number(selectedUtilityQuality?.heDamage.value ?? null)}
                  quality={selectedUtilityQuality?.heDamage}
                />
              </div>
            </section>
            <section className="border-t border-[var(--rl-border)] p-5 md:border-l xl:border-t-0">
              <h3 className="text-xs font-semibold uppercase tracking-[0.13em] text-[var(--rl-fg-dim)]">
                Teamplay
              </h3>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <Metric label="Opening kills" value={number(selectedPlayer.metrics.openingWins)} />
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

          <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
            <div className="border-b border-[var(--rl-border)] px-4 py-3">
              <h3 className="text-sm font-semibold text-[var(--rl-fg)]">Performance par round</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="text-[13px] text-[var(--rl-fg-dim)]">
                  <tr>
                    <th className="px-4 py-2 font-medium">Round</th>
                    <th className="px-3 py-2 text-right font-medium">K</th>
                    <th className="px-3 py-2 text-right font-medium">A</th>
                    <th className="px-3 py-2 text-right font-medium">D</th>
                    <th className="px-3 py-2 text-right font-medium">Damage</th>
                    <th className="px-4 py-2 text-right font-medium"><DefinitionTerm label="KAST" /></th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.rounds.map((round) => {
                    const playerRound = round.players.find((player) => player.playerId === selectedPlayer.playerId);
                    return (
                      <tr key={round.roundNumber} className="border-t border-[var(--rl-border)]">
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
            <h2 className="mt-1 text-2xl font-semibold text-white"><DefinitionTerm label="Positionnement" definition="Trajectoires et positions enregistrées dans la démo." /></h2>
          </article>

          <div className="grid gap-6 lg:grid-cols-[16rem_1fr]">
            <aside className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-2">
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
                      : "text-[var(--rl-fg-muted)] hover:bg-white/[0.05]",
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
              <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-5">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{selectedPlayer.name}</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenPositioning(selectedPlayer.playerId)}
                    className="rounded-md bg-[var(--rl-accent)] px-4 py-2 text-sm font-semibold text-neutral-950 hover:bg-[color-mix(in_oklab,var(--rl-accent)_82%,white)]"
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
                    label="Teammate distance"
                    value={
                      selectedSpatialQuality?.meanTeammateDistance.value === null ||
                        selectedSpatialQuality?.meanTeammateDistance.value === undefined
                        ? "—"
                        : `${selectedSpatialQuality.meanTeammateDistance.value.toFixed(0)} u`
                    }
                    quality={selectedSpatialQuality?.meanTeammateDistance}
                  />
                  <Metric
                    label="Échantillons spacing"
                    value={number(selectedSpatialQuality?.spacingSamples.value ?? null)}
                    quality={selectedSpatialQuality?.spacingSamples}
                  />
                </div>
              </article>

              <article className="overflow-hidden rounded-md border border-[var(--rl-border)] bg-[#121515]">
                <div className="border-b border-[var(--rl-border)] px-4 py-3">
                  <h3 className="text-sm font-semibold text-[var(--rl-fg)]"><DefinitionTerm label="Occupation par zone" definition="Temps passé calculé à partir des positions enregistrées dans chaque round." /></h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[38rem] text-left text-sm">
                    <thead className="text-[13px] text-[var(--rl-fg-dim)]">
                      <tr>
                        <th className="px-4 py-2 font-medium">Zone</th>
                        <th className="px-3 py-2 text-right font-medium">Rounds</th>
                        <th className="px-3 py-2 text-right font-medium">Visites</th>
                        <th className="px-4 py-2 text-right font-medium">Total time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedZoneRows.slice(0, 16).map((zone) => (
                        <tr key={zone.zoneId} className="border-t border-[var(--rl-border)]">
                          <td className="px-4 py-3 font-semibold text-[var(--rl-fg)]">
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
                  <p className="border-t border-[var(--rl-border)] px-4 py-4 text-sm text-[var(--rl-fg-dim)]">
                    Aucune zone tactique n’a pu être attribuée pour cette carte.
                  </p>
                )}
              </article>

              <div className="grid gap-6 md:grid-cols-3">
                <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-5">
                  <h3 className="text-sm font-semibold text-white"><DefinitionTerm label="Rotations" definition="Déplacements collectifs auxquels le joueur participe." /></h3>
                  <div className="mt-3 text-3xl font-semibold tabular-nums text-white">
                    {spatial ? selectedRotations.length : "—"}
                  </div>
                </article>
                <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-5">
                  <h3 className="text-sm font-semibold text-white"><DefinitionTerm label="Tradeability" /></h3>
                  <div className="mt-3 text-3xl font-semibold tabular-nums text-white">
                    {spatial ? selectedTradeability.length : "—"}
                  </div>
                </article>
                <article className="rounded-md border border-[var(--rl-border)] bg-[#121515] p-5">
                  <h3 className="text-sm font-semibold text-white"><DefinitionTerm label="Spacing" definition="Distance 3D minimale observée avec un équipier." /></h3>
                  <div className="mt-3 text-3xl font-semibold tabular-nums text-white">
                    {closestTeammateDistance === null ? "—" : `${closestTeammateDistance.toFixed(0)} u`}
                  </div>
                </article>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
