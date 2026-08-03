import type {
  BenchmarkMetricId,
  PlayerFindingSummaryItem,
  PlayerFindingsSummary,
  PlayerMetricTrend,
  PlayerTrainingObjectiveAnalysis,
  PlayerTrendAnalysis,
  RecurringPlayerErrorAnalysis,
} from "./benchmark-types";

const METRIC_LABELS: Record<BenchmarkMetricId, string> = {
  kills_per_round: "kills par round",
  deaths_per_round: "morts par round",
  assists_per_round: "assists par round",
  kd_ratio: "ratio K/D",
  headshot_rate: "taux de headshots",
  adr: "ADR",
  opening_win_rate: "taux d'openings gagnés",
  survival_rate: "taux de survie",
  trade_kill_rate: "taux de trades réussis",
  kast_rate: "KAST",
  grenades_per_round: "grenades par round",
  flash_assists_per_round: "flash assists par round",
};

function number(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function trendText(trend: PlayerMetricTrend): string {
  const direction = trend.direction === "regressing"
    ? "régresse"
    : "progresse";
  return `${METRIC_LABELS[trend.metric]} ${direction} sur ${trend.sampleCount} `
    + `échantillons ${trend.map} ${trend.side} `
    + `(de ${number(trend.firstValue!)} à ${number(trend.lastValue!)}, `
    + `p=${number(trend.pValue!)}).`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function summarizePlayerFindings(
  trends: PlayerTrendAnalysis,
  recurringErrors: RecurringPlayerErrorAnalysis,
  objectives: PlayerTrainingObjectiveAnalysis,
): PlayerFindingsSummary {
  if (
    trends.playerId !== recurringErrors.playerId
    || trends.playerId !== objectives.playerId
  ) {
    throw new Error("Player finding analyses must reference the same player.");
  }

  const findings: PlayerFindingSummaryItem[] = [];
  for (const trend of trends.trends) {
    if (
      (trend.direction !== "regressing" && trend.direction !== "improving")
      || trend.firstValue === null
      || trend.lastValue === null
      || trend.pValue === null
    ) {
      continue;
    }
    findings.push({
      findingId: `summary:${trend.trendId}`,
      category: trend.direction === "regressing" ? "regression" : "improvement",
      sourceId: trend.trendId,
      text: trendText(trend),
      evidenceSampleIds: [...trend.evidenceSampleIds],
    });
  }
  for (const error of recurringErrors.errors) {
    findings.push({
      findingId: `summary:${error.errorId}`,
      category: "recurring_error",
      sourceId: error.errorId,
      text: `${METRIC_LABELS[error.metric]} est sous le 25e percentile dans `
        + `${error.weakSampleCount} des ${error.windowSampleCount} derniers `
        + `échantillons ${error.map} ${error.side} `
        + `(percentile orienté moyen ${number(error.meanOrientedPercentile)}).`,
      evidenceSampleIds: [...error.evidenceSampleIds],
    });
  }
  for (const objective of objectives.objectives) {
    const comparator = objective.targetComparator === "at_least"
      ? "au moins"
      : "au plus";
    findings.push({
      findingId: `summary:${objective.objectiveId}`,
      category: "objective",
      sourceId: objective.objectiveId,
      text: `Objectif ${METRIC_LABELS[objective.metric]} : atteindre ${comparator} `
        + `${number(objective.targetValue)} dans `
        + `${objective.requiredSuccessCount} des `
        + `${objective.evaluationWindowSampleCount} prochaines parties `
        + `${objective.map} ${objective.side}.`,
      evidenceSampleIds: [...objective.evidenceSampleIds],
    });
  }

  const regressions = findings.filter(
    (finding) => finding.category === "regression",
  ).length;
  const errors = recurringErrors.errors.length;
  const objectiveCount = objectives.objectives.length;
  const improvements = findings.filter(
    (finding) => finding.category === "improvement",
  ).length;
  const headline = findings.length === 0
    ? "Aucun constat exploitable avec les données disponibles."
    : `${regressions} régression(s), ${errors} faiblesse(s) récurrente(s), `
      + `${objectiveCount} objectif(s) et ${improvements} progression(s).`;

  return {
    summaryVersion: "roundlab.player-findings-summary.v1",
    playerId: trends.playerId,
    headline,
    findings,
    unavailableReasons: unique([
      ...trends.unavailableReasons,
      ...recurringErrors.unavailableReasons,
      ...objectives.unavailableReasons,
    ]),
  };
}
