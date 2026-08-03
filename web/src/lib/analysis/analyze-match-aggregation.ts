import type {
  ClutchCounts,
  FlashMetrics,
  GrenadeCounts,
  LogicalTeamAnalysis,
  LogicalTeamId,
  LogicalTeamMetrics,
  PlayerAnalysis,
  PlayerAnalysisMetrics,
  PlayerEconomyAnalysis,
  PlayerMetricEvidence,
  PlayerSideAnalysis,
  UtilityDamageMetrics,
} from "./types.ts";
import {
  flashMetrics,
  utilityDamageMetrics,
  utilityQuantityRating,
} from "./analyze-match-utility.ts";

type BasePlayerAnalysis = Omit<PlayerAnalysis, "bySide" | "byEconomy">;

function emptyEvidence(): PlayerMetricEvidence {
  return {
    kills: [], deaths: [], assists: [], headshotKills: [], damageHealth: [],
    openingWins: [], openingLosses: [], multiKills: [], survivedRounds: [],
    clutchOpportunities: [], clutchWins: [], tradeAttempts: [], tradeKills: [],
    tradeDeaths: [], kastRounds: [], grenadesThrown: [], flashes: [],
    flashAssists: [], utilitySavedOnDeath: [],
  };
}

function sumNullableMetric(
  analyses: BasePlayerAnalysis[],
  key: keyof PlayerAnalysisMetrics,
): number | null {
  let total = 0;
  for (const analysis of analyses) {
    const value = analysis.metrics[key];
    if (typeof value !== "number") return null;
    total += value;
  }
  return total;
}

function sumMultiKills(analyses: BasePlayerAnalysis[]): PlayerAnalysisMetrics["multiKillRounds"] {
  const total = { two: 0, three: 0, four: 0, fivePlus: 0 };
  for (const analysis of analyses) {
    const value = analysis.metrics.multiKillRounds;
    if (value === null || value === undefined) return null;
    total.two += value.two;
    total.three += value.three;
    total.four += value.four;
    total.fivePlus += value.fivePlus;
  }
  return total;
}

function sumClutches(
  analyses: BasePlayerAnalysis[],
  key: "clutchOpportunities" | "clutchWins",
): ClutchCounts | null {
  const total = {
    oneVsOne: 0, oneVsTwo: 0, oneVsThree: 0, oneVsFour: 0, oneVsFivePlus: 0,
  };
  for (const analysis of analyses) {
    const value = analysis.metrics[key];
    if (value === null) return null;
    total.oneVsOne += value.oneVsOne;
    total.oneVsTwo += value.oneVsTwo;
    total.oneVsThree += value.oneVsThree;
    total.oneVsFour += value.oneVsFour;
    total.oneVsFivePlus += value.oneVsFivePlus;
  }
  return total;
}

function sumGrenades(
  analyses: BasePlayerAnalysis[],
  key: "grenadesThrown" | "utilitySavedOnDeath",
): GrenadeCounts | null {
  const total = { total: 0, flash: 0, smoke: 0, he: 0, molotov: 0, incendiary: 0, decoy: 0 };
  for (const analysis of analyses) {
    const value = analysis.metrics[key];
    if (value === null) return null;
    total.total += value.total;
    total.flash += value.flash;
    total.smoke += value.smoke;
    total.he += value.he;
    total.molotov += value.molotov;
    total.incendiary += value.incendiary;
    total.decoy += value.decoy;
  }
  return total;
}

function sumFlashes(analyses: BasePlayerAnalysis[]): FlashMetrics | null {
  let enemiesFlashed = 0;
  let teammatesFlashed = 0;
  let effectiveEnemiesFlashed = 0;
  let effectiveTeammatesFlashed = 0;
  let enemyBlindDuration = 0;
  let teammateBlindDuration = 0;
  let enemyBlindFlashCount = 0;
  let longestEnemyBlindDuration = 0;
  let flashesLeadingToKills = 0;
  for (const analysis of analyses) {
    const value = analysis.metrics.flashes;
    if (value === null || value === undefined) return null;
    enemiesFlashed += value.enemiesFlashed;
    teammatesFlashed += value.teammatesFlashed;
    effectiveEnemiesFlashed += value.effectiveEnemiesFlashed;
    effectiveTeammatesFlashed += value.effectiveTeammatesFlashed;
    enemyBlindDuration += value.enemyBlindDuration;
    teammateBlindDuration += value.teammateBlindDuration;
    enemyBlindFlashCount += value.enemyBlindFlashCount;
    longestEnemyBlindDuration += value.longestEnemyBlindDuration;
    flashesLeadingToKills += value.flashesLeadingToKills;
  }
  return flashMetrics(
    enemiesFlashed,
    teammatesFlashed,
    effectiveEnemiesFlashed,
    effectiveTeammatesFlashed,
    enemyBlindDuration,
    teammateBlindDuration,
    enemyBlindFlashCount,
    longestEnemyBlindDuration,
    flashesLeadingToKills,
  );
}

function sumUtilityDamage(analyses: BasePlayerAnalysis[]): UtilityDamageMetrics | null {
  let heDamage = 0;
  let fireDamage = 0;
  let teammateHeDamage = 0;
  let teammateFireDamage = 0;
  for (const analysis of analyses) {
    const value = analysis.metrics.utilityDamage;
    if (value === null || value === undefined) return null;
    heDamage += value.heDamage;
    fireDamage += value.fireDamage;
    teammateHeDamage += value.teammateHeDamage;
    teammateFireDamage += value.teammateFireDamage;
  }
  return utilityDamageMetrics(heDamage, fireDamage, teammateHeDamage, teammateFireDamage);
}

export function aggregateSide(analyses: BasePlayerAnalysis[]): PlayerSideAnalysis | null {
  if (analyses.length === 0) return null;
  const roundsPlayed = analyses.reduce((total, analysis) => total + analysis.metrics.roundsPlayed, 0);
  const kills = sumNullableMetric(analyses, "kills");
  const deaths = analyses.reduce((total, analysis) => total + analysis.metrics.deaths, 0);
  const assists = sumNullableMetric(analyses, "assists");
  const headshotKills = sumNullableMetric(analyses, "headshotKills");
  const damageHealth = sumNullableMetric(analyses, "damageHealth");
  const openingAttempts = sumNullableMetric(analyses, "openingAttempts");
  const survivedRounds = sumNullableMetric(analyses, "survivedRounds");
  const kastRounds = sumNullableMetric(analyses, "kastRounds");
  const unusedUtilityValue = sumNullableMetric(analyses, "unusedUtilityValue");
  const grenadesThrown = sumGrenades(analyses, "grenadesThrown");
  const metricEvidence = emptyEvidence();
  for (const analysis of analyses) {
    for (const key of Object.keys(metricEvidence) as (keyof PlayerMetricEvidence)[]) {
      metricEvidence[key].push(...analysis.metricEvidence[key]);
    }
  }

  return {
    metrics: {
      roundsPlayed,
      kills,
      deaths,
      assists,
      kdRatio: kills === null || deaths === 0 ? null : kills / deaths,
      headshotKills,
      headshotRate: kills === null || headshotKills === null || kills === 0
        ? null
        : headshotKills / kills,
      damageHealth,
      adr: damageHealth === null || roundsPlayed === 0 ? null : damageHealth / roundsPlayed,
      openingAttempts,
      openingWins: sumNullableMetric(analyses, "openingWins"),
      openingLosses: sumNullableMetric(analyses, "openingLosses"),
      multiKillRounds: sumMultiKills(analyses),
      survivedRounds,
      survivalRate: survivedRounds === null || roundsPlayed === 0
        ? null
        : survivedRounds / roundsPlayed,
      clutchOpportunities: sumClutches(analyses, "clutchOpportunities"),
      clutchWins: sumClutches(analyses, "clutchWins"),
      tradeAttempts: sumNullableMetric(analyses, "tradeAttempts"),
      tradeKills: sumNullableMetric(analyses, "tradeKills"),
      tradeDeaths: sumNullableMetric(analyses, "tradeDeaths"),
      kastRounds,
      kastRate: kastRounds === null || roundsPlayed === 0 ? null : kastRounds / roundsPlayed,
      grenadesThrown,
      flashes: sumFlashes(analyses),
      utilityDamage: sumUtilityDamage(analyses),
      flashAssists: sumNullableMetric(analyses, "flashAssists"),
      utilitySavedOnDeath: sumGrenades(analyses, "utilitySavedOnDeath"),
      unusedUtilityValue,
      averageUnusedUtilityValue: unusedUtilityValue === null || deaths === 0
        ? null
        : unusedUtilityValue / deaths,
      utilityQuantityRating: utilityQuantityRating(grenadesThrown, roundsPlayed),
    },
    metricEvidence,
    unavailableReasons: [...new Set(
      analyses.flatMap((analysis) => analysis.unavailableReasons),
    )].sort(),
  };
}

export function aggregateEconomy(
  analyses: BasePlayerAnalysis[],
  economyEvidence: string[],
): PlayerEconomyAnalysis | null {
  const aggregate = aggregateSide(analyses);
  return aggregate === null ? null : { ...aggregate, economyEvidence };
}

export function aggregateLogicalTeam(
  logicalTeam: LogicalTeamId,
  name: string,
  score: number | null,
  analyses: BasePlayerAnalysis[],
  playerIds: Set<string>,
  roundNumbers: Set<number>,
  roundsWon: number,
  unavailableReasons: Set<string>,
): LogicalTeamAnalysis {
  const aggregate = aggregateSide(analyses);
  if (aggregate === null || unavailableReasons.size > 0) {
    if (aggregate === null) unavailableReasons.add("missing_logical_team_rounds");
    return {
      logicalTeam,
      name,
      score,
      playerIds: [...playerIds].sort(),
      metrics: null,
      metricEvidence: emptyEvidence(),
      unavailableReasons: [...unavailableReasons].sort(),
    };
  }

  const playerRounds = aggregate.metrics.roundsPlayed;
  const roundsPlayed = roundNumbers.size;
  const metrics: LogicalTeamMetrics = {
    ...aggregate.metrics,
    roundsPlayed,
    roundsWon,
    winRate: roundsPlayed === 0 ? null : roundsWon / roundsPlayed,
    playerRounds,
    adr: aggregate.metrics.damageHealth === null || roundsPlayed === 0
      ? null
      : aggregate.metrics.damageHealth / roundsPlayed,
    survivalRate: aggregate.metrics.survivedRounds === null || playerRounds === 0
      ? null
      : aggregate.metrics.survivedRounds / playerRounds,
    kastRate: aggregate.metrics.kastRounds === null || playerRounds === 0
      ? null
      : aggregate.metrics.kastRounds / playerRounds,
  };
  return {
    logicalTeam,
    name,
    score,
    playerIds: [...playerIds].sort(),
    metrics,
    metricEvidence: aggregate.metricEvidence,
    unavailableReasons: aggregate.unavailableReasons,
  };
}
