"use client";

import type { MatchAnalysis } from "@/lib/analysis/types";
import { teamLabel } from "./report-formatters";

export type ScopeSide = "all" | "T" | "CT";

/**
 * The filter state a report table narrows its rows with.
 *
 * The player is not part of it: the report keeps one global player selection,
 * shown here read-only so each table states its full scope in one place.
 */
export type ReportScope = {
  teamId: string;
  side: ScopeSide;
  roundNumber: string;
};

export const DEFAULT_REPORT_SCOPE: ReportScope = {
  teamId: "all",
  side: "all",
  roundNumber: "all",
};

const FIELD =
  "h-9 rounded-md border border-[var(--rl-border)] bg-[#0d0f0f] px-3 text-sm text-[var(--rl-fg)]";
const LABEL = "grid gap-1 text-[13px] font-medium text-[var(--rl-fg-dim)]";

/**
 * Builds the predicate a table applies to each row.
 *
 * `roundPlayerSide` maps `"<round>:<player>"` to the side that player held in
 * that round, so a side filter stays correct across the half-time switch. An
 * unknown side never satisfies a specific side filter, rather than being
 * silently counted on both sides.
 */
export function scopeMatcher(
  scope: ReportScope,
  analysis: MatchAnalysis,
  scopedPlayerIds: ReadonlySet<string>,
  roundPlayerSide: ReadonlyMap<string, "T" | "CT" | null>,
): (playerId: string, roundNumber: number) => boolean {
  const teamPlayerIds = scope.teamId === "all"
    ? null
    : new Set(
      analysis.teams.find((team) => team.logicalTeam === scope.teamId)?.playerIds ?? [],
    );
  return (playerId, roundNumber) =>
    scopedPlayerIds.has(playerId) &&
    (teamPlayerIds === null || teamPlayerIds.has(playerId)) &&
    (scope.side === "all" ||
      roundPlayerSide.get(`${roundNumber}:${playerId}`) === scope.side) &&
    (scope.roundNumber === "all" || roundNumber === Number(scope.roundNumber));
}

export function ReportScopeFilters({
  analysis,
  scope,
  onChange,
  playerName,
  displayRound,
}: {
  analysis: MatchAnalysis;
  scope: ReportScope;
  onChange: (scope: ReportScope) => void;
  playerName: string | null;
  /** Maps a stored round number to the number shown to the viewer. */
  displayRound: (roundNumber: number) => number;
}) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className={LABEL}>
        Joueur
        <span className="flex h-9 items-center rounded-md border border-[var(--rl-border)] bg-[#0d0f0f] px-3 text-sm font-semibold text-[var(--rl-fg)]">
          {playerName ?? "—"}
        </span>
      </label>
      <label className={LABEL}>
        Équipe
        <select
          value={scope.teamId}
          onChange={(event) => onChange({ ...scope, teamId: event.target.value })}
          className={FIELD}
        >
          <option value="all">Toutes les équipes</option>
          {analysis.teams.map((team) => (
            <option key={team.logicalTeam} value={team.logicalTeam}>
              {teamLabel(team.name)}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        Côté
        <select
          value={scope.side}
          onChange={(event) =>
            onChange({ ...scope, side: event.target.value as ScopeSide })}
          className={FIELD}
        >
          <option value="all">T + CT</option>
          <option value="T">Terroristes</option>
          <option value="CT">Contre-terroristes</option>
        </select>
      </label>
      <label className={LABEL}>
        Round
        <select
          value={scope.roundNumber}
          onChange={(event) => onChange({ ...scope, roundNumber: event.target.value })}
          className={FIELD}
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
  );
}
