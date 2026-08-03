import type { AnalysisEvidence, MatchAnalysis } from "@/lib/analysis/types";

export type TradeAction = {
  evidence: AnalysisEvidence;
  playerId: string;
  playerName: string;
  kind: "trade_kill" | "traded_death";
};

export type UtilityAction = {
  evidence: AnalysisEvidence;
  playerId: string;
  playerName: string;
  kind: "grenade_throw" | "flash_assist" | "utility_saved";
};

function compareActions(
  left: TradeAction | UtilityAction,
  right: TradeAction | UtilityAction,
): number {
  return left.evidence.roundNumber - right.evidence.roundNumber ||
    (left.evidence.tick ?? Number.MAX_SAFE_INTEGER) -
      (right.evidence.tick ?? Number.MAX_SAFE_INTEGER) ||
    left.playerId.localeCompare(right.playerId) ||
    left.kind.localeCompare(right.kind);
}

export function tradeActions(analysis: MatchAnalysis): TradeAction[] {
  const evidenceById = new Map(
    analysis.evidence.map((proof) => [proof.evidenceId, proof]),
  );
  const actions: TradeAction[] = [];
  for (const player of analysis.players) {
    for (const evidenceId of new Set(player.metricEvidence.tradeKills)) {
      const evidence = evidenceById.get(evidenceId);
      if (evidence) actions.push({ evidence, playerId: player.playerId, playerName: player.name, kind: "trade_kill" });
    }
    const deathEvidence = new Set(player.metricEvidence.deaths);
    for (const evidenceId of new Set(player.metricEvidence.tradeDeaths)) {
      if (!deathEvidence.has(evidenceId)) continue;
      const evidence = evidenceById.get(evidenceId);
      if (evidence) actions.push({ evidence, playerId: player.playerId, playerName: player.name, kind: "traded_death" });
    }
  }
  return actions.sort(compareActions);
}

export function utilityActions(analysis: MatchAnalysis): UtilityAction[] {
  const evidenceById = new Map(
    analysis.evidence.map((proof) => [proof.evidenceId, proof]),
  );
  const actions: UtilityAction[] = [];
  for (const player of analysis.players) {
    for (const evidenceId of new Set(player.metricEvidence.grenadesThrown)) {
      const evidence = evidenceById.get(evidenceId);
      if (evidence) actions.push({ evidence, playerId: player.playerId, playerName: player.name, kind: "grenade_throw" });
    }
    for (const evidenceId of new Set(player.metricEvidence.flashAssists)) {
      const evidence = evidenceById.get(evidenceId);
      if (evidence) actions.push({ evidence, playerId: player.playerId, playerName: player.name, kind: "flash_assist" });
    }
    const deathEvidence = new Set(player.metricEvidence.deaths);
    for (const evidenceId of new Set(player.metricEvidence.utilitySavedOnDeath)) {
      if (!deathEvidence.has(evidenceId)) continue;
      const evidence = evidenceById.get(evidenceId);
      if (evidence) actions.push({ evidence, playerId: player.playerId, playerName: player.name, kind: "utility_saved" });
    }
  }
  return actions.sort(compareActions);
}
