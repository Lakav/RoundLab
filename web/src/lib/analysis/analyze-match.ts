import type {
  DamageEvent,
  DisconnectEvent,
  FlashEvent,
  MatchData,
  MatchEvent,
  PlayerId,
  Round,
  WeaponFireEvent,
} from "../types.ts";
import {
  MATCH_ANALYSIS_SPEC_VERSION,
  type AnalysisEvidence,
  type ClutchCounts,
  type EconomyCategory,
  type FlashMetrics,
  type GrenadeCounts,
  type LogicalTeamAnalysis,
  type LogicalTeamCombatQualityAnalysis,
  type LogicalTeamEconomyAnalysis,
  type LogicalTeamId,
  type LogicalTeamMetrics,
  type MatchAnalysis,
  type MultiKillRoundCounts,
  type PlayerAnalysis,
  type PlayerAnalysisMetrics,
  type PlayerEconomyQualityAnalysis,
  type PlayerUtilityQualityAnalysis,
  type PlayerEconomyAnalysis,
  type PlayerMetricEvidence,
  type PlayerSideAnalysis,
  type RoundAnalysis,
  type RoundEconomyAnalysis,
  type UtilityDamageMetrics,
} from "./types.ts";
import { qualityMetric } from "./metric-quality.ts";

const EFFECTIVE_FLASH_MIN_DURATION_SECONDS = 1.1;
const ECONOMY_FORMULA_VERSION = "roundlab.economy.v2.freeze-equipment";
const COMBAT_FORMULA_VERSION = "roundlab.combat.v2.numerical-advantage";
const UTILITY_FORMULA_VERSION = "roundlab.utility.v2.quality";

type AnalyzeMatchContext = {
  matchId: string;
  generatedAt: string;
};

type MutablePlayerAnalysis = {
  playerId: string;
  name: string;
  roundsPlayed: number;
  kills: number;
  deaths: number;
  assists: number;
  headshotKills: number;
  damageHealth: number;
  combatAvailable: boolean;
  damageAvailable: boolean;
  openingAvailable: boolean;
  openingAttempts: number;
  openingWins: number;
  openingLosses: number;
  multiKillRounds: MultiKillRoundCounts;
  survivalAvailable: boolean;
  survivedRounds: number;
  clutchAvailable: boolean;
  clutchOpportunities: ClutchCounts;
  clutchWins: ClutchCounts;
  tradeAttemptsAvailable: boolean;
  tradeAvailable: boolean;
  tradeAttempts: number;
  tradeKills: number;
  tradeDeaths: number;
  kastAvailable: boolean;
  kastRounds: number;
  grenadesAvailable: boolean;
  grenadesThrown: GrenadeCounts;
  flashesAvailable: boolean;
  enemiesFlashed: number;
  teammatesFlashed: number;
  effectiveEnemiesFlashed: number;
  effectiveTeammatesFlashed: number;
  enemyBlindDuration: number;
  teammateBlindDuration: number;
  enemyBlindFlashCount: number;
  longestEnemyBlindDuration: number;
  flashesLeadingToKills: number;
  heDamage: number;
  fireDamage: number;
  teammateHeDamage: number;
  teammateFireDamage: number;
  flashAssists: number;
  utilitySavedAvailable: boolean;
  utilitySavedOnDeath: GrenadeCounts;
  unusedUtilityValue: number;
  tradeKillEvidenceSeen: Set<string>;
  metricEvidence: PlayerMetricEvidence;
  unavailableReasons: Set<string>;
};

type ValidKillRecord = {
  event: MatchEvent;
  proof: AnalysisEvidence;
  killerId: string;
  victimId: string;
  killerTeam: number;
  victimTeam: number;
};

type BasePlayerAnalysis = Omit<PlayerAnalysis, "bySide" | "byEconomy">;
type BaseMatchAnalysis = Omit<MatchAnalysis, "players" | "teams" | "rounds"> & {
  players: BasePlayerAnalysis[];
};

function playerId(value: PlayerId): string {
  return String(value);
}

function emptyEvidence(): PlayerMetricEvidence {
  return {
    kills: [],
    deaths: [],
    assists: [],
    headshotKills: [],
    damageHealth: [],
    openingWins: [],
    openingLosses: [],
    multiKills: [],
    survivedRounds: [],
    clutchOpportunities: [],
    clutchWins: [],
    tradeAttempts: [],
    tradeKills: [],
    tradeDeaths: [],
    kastRounds: [],
    grenadesThrown: [],
    flashes: [],
    flashAssists: [],
    utilitySavedOnDeath: [],
  };
}

function emptyMultiKillCounts(): MultiKillRoundCounts {
  return { two: 0, three: 0, four: 0, fivePlus: 0 };
}

function emptyClutchCounts(): ClutchCounts {
  return { oneVsOne: 0, oneVsTwo: 0, oneVsThree: 0, oneVsFour: 0, oneVsFivePlus: 0 };
}

function emptyGrenadeCounts(): GrenadeCounts {
  return { total: 0, flash: 0, smoke: 0, he: 0, molotov: 0, incendiary: 0, decoy: 0 };
}

export function utilityQuantityRating(
  grenades: GrenadeCounts | null,
  roundsPlayed: number,
): number | null {
  if (grenades === null || roundsPlayed <= 0) return null;
  const thrownWithoutDecoys = Math.max(0, grenades.total - grenades.decoy);
  const ratioToThreePerRound = Math.min(
    1,
    thrownWithoutDecoys / roundsPlayed / 3,
  );
  return Math.pow(ratioToThreePerRound, 2 / 3) * 100;
}

function flashMetrics(
  enemiesFlashed: number,
  teammatesFlashed: number,
  effectiveEnemiesFlashed: number,
  effectiveTeammatesFlashed: number,
  enemyBlindDuration: number,
  teammateBlindDuration: number,
  enemyBlindFlashCount: number,
  longestEnemyBlindDuration: number,
  flashesLeadingToKills: number,
): FlashMetrics {
  return {
    enemiesFlashed,
    teammatesFlashed,
    effectiveEnemiesFlashed,
    effectiveTeammatesFlashed,
    enemyBlindDuration,
    teammateBlindDuration,
    enemyBlindFlashCount,
    longestEnemyBlindDuration,
    flashesLeadingToKills,
    averageEnemyBlindDuration: enemyBlindFlashCount === 0
      ? null
      : longestEnemyBlindDuration / enemyBlindFlashCount,
    averageTeammateBlindDuration: teammatesFlashed === 0
      ? null
      : teammateBlindDuration / teammatesFlashed,
  };
}

function utilityDamageMetrics(
  heDamage: number,
  fireDamage: number,
  teammateHeDamage: number,
  teammateFireDamage: number,
): UtilityDamageMetrics {
  return { heDamage, fireDamage, teammateHeDamage, teammateFireDamage };
}

type GrenadeKind = Exclude<keyof GrenadeCounts, "total">;

function grenadeKind(weapon: string | undefined): GrenadeKind | null {
  const normalized = weapon?.toLowerCase().replace(/^weapon_/, "").replaceAll("-", "_");
  if (normalized === "flashbang" || normalized === "flash") return "flash";
  if (normalized === "smokegrenade" || normalized === "smoke") return "smoke";
  if (normalized === "hegrenade" || normalized === "he") return "he";
  if (normalized === "molotov") return "molotov";
  if (
    normalized === "incgrenade" ||
    normalized === "incendiary" ||
    normalized === "incendiarygrenade"
  ) return "incendiary";
  if (normalized === "decoy" || normalized === "decoygrenade") return "decoy";
  return null;
}

function grenadeValue(kind: GrenadeKind): number {
  if (kind === "flash") return 200;
  if (kind === "smoke" || kind === "he") return 300;
  if (kind === "molotov") return 400;
  if (kind === "incendiary") return 500;
  return 50;
}

function utilityDamageKind(weapon: string | undefined): "he" | "fire" | null {
  const normalized = weapon?.toLowerCase().replace(/^weapon_/, "").replaceAll("-", "_");
  if (normalized === "hegrenade" || normalized === "he") return "he";
  if (
    normalized === "molotov" ||
    normalized === "incgrenade" ||
    normalized === "incendiary" ||
    normalized === "inferno"
  ) return "fire";
  return null;
}

function playerTeamAtOrBefore(round: Round, id: string, time: number): number | null {
  for (let index = round.frames.length - 1; index >= 0; index--) {
    const frame = round.frames[index];
    if (frame.t > time) continue;
    const player = frame.players.find((candidate) => playerId(candidate.id) === id);
    if (player) return player.team;
  }
  // Some demos emit a combat event a few ticks before the first sampled frame.
  // A player's side cannot change during a live round, so a later frame from
  // the same round is valid team context and avoids discarding the whole ADR.
  for (const frame of round.frames) {
    const player = frame.players.find((candidate) => playerId(candidate.id) === id);
    if (player) return player.team;
  }
  return null;
}

function evidenceId(round: Round, type: "kill" | "damage" | "disconnect", index: number): string {
  return `r${round.number}-${type}-${String(index).padStart(4, "0")}`;
}

function killEvidence(round: Round, event: MatchEvent, index: number): AnalysisEvidence {
  return {
    evidenceId: evidenceId(round, "kill", index),
    roundNumber: round.number,
    tick: event.tick ?? null,
    sequence: event.sequence ?? null,
    time: event.t,
    type: "kill",
    actors: [event.killer, event.victim, event.assist]
      .filter((value): value is PlayerId => value !== undefined)
      .map(playerId),
    ...(event.weapon ? { weapon: event.weapon } : {}),
  };
}

function damageEvidence(round: Round, damage: DamageEvent, index: number): AnalysisEvidence {
  return {
    evidenceId: evidenceId(round, "damage", index),
    roundNumber: round.number,
    tick: damage.tick,
    sequence: damage.sequence ?? null,
    time: damage.t,
    type: "damage",
    actors: [damage.attacker, damage.victim]
      .filter((value): value is PlayerId => value !== undefined)
      .map(playerId),
  };
}

function disconnectEvidence(round: Round, disconnect: DisconnectEvent, index: number): AnalysisEvidence {
  return {
    evidenceId: evidenceId(round, "disconnect", index),
    roundNumber: round.number,
    tick: disconnect.tick,
    sequence: disconnect.sequence ?? null,
    time: disconnect.t,
    type: "disconnect",
    actors: disconnect.player === undefined ? [] : [playerId(disconnect.player)],
  };
}

function grenadeEvidence(round: Round, fire: WeaponFireEvent, index: number): AnalysisEvidence {
  return {
    evidenceId: `r${round.number}-grenade-${String(index).padStart(4, "0")}`,
    roundNumber: round.number,
    tick: fire.tick ?? null,
    sequence: fire.sequence ?? null,
    time: fire.t,
    type: "grenade_throw",
    actors: fire.shooter === undefined ? [] : [playerId(fire.shooter)],
  };
}

function flashEvidence(round: Round, flash: FlashEvent, index: number): AnalysisEvidence {
  return {
    evidenceId: `r${round.number}-flash-${String(index).padStart(4, "0")}`,
    roundNumber: round.number,
    tick: flash.tick,
    sequence: flash.sequence ?? null,
    time: flash.t,
    type: "flash",
    actors: [flash.thrower, flash.victim]
      .filter((value): value is PlayerId => value !== undefined)
      .map(playerId),
  };
}

function inventoryEvidence(
  round: Round,
  player: string,
  frameIndex: number,
  time: number,
  tickRate: number,
): AnalysisEvidence {
  return {
    evidenceId: `r${round.number}-inventory-${player}-${String(frameIndex).padStart(4, "0")}`,
    roundNumber: round.number,
    tick: Math.round(round.startTick + time * tickRate),
    sequence: null,
    time,
    type: "inventory_snapshot",
    actors: [player],
  };
}

function economyEvidence(
  round: Round,
  side: "T" | "CT",
  tick: number,
  time: number,
  actors: string[],
): AnalysisEvidence {
  return {
    evidenceId: `r${round.number}-economy-${side.toLowerCase()}`,
    roundNumber: round.number,
    tick,
    sequence: null,
    time,
    type: "economy_snapshot",
    actors,
  };
}

function bombEvidence(
  round: Round,
  event: MatchEvent,
  index: number,
): AnalysisEvidence {
  return {
    evidenceId: `r${round.number}-bomb-${String(index).padStart(4, "0")}`,
    roundNumber: round.number,
    tick: event.tick ?? null,
    sequence: event.sequence ?? null,
    time: event.t,
    type: event.type === "bomb_planted" ? "bomb_planted" : "bomb_defused",
    actors: event.player === undefined ? [] : [playerId(event.player)],
  };
}

function economyCategory(averageEquipmentValue: number): EconomyCategory {
  if (averageEquipmentValue < 2_000) return "eco";
  if (averageEquipmentValue < 3_500) return "force_buy";
  return "full_buy";
}

function economyQuality(
  averageEquipmentValue: number | null,
  category: EconomyCategory | null,
  sampleCount: number,
  usableSampleCount: number,
  unavailableReason: string | null,
): RoundEconomyAnalysis["quality"] {
  const unavailableReasons = unavailableReason === null ? [] : [unavailableReason];
  return {
    averageEquipmentValue: qualityMetric({
      value: averageEquipmentValue,
      unit: "equipment_value",
      sampleCount,
      usableSampleCount,
      provenance: "observed",
      confidence: "high",
      unavailableReasons,
      formulaVersion: `${ECONOMY_FORMULA_VERSION}.averageEquipmentValue`,
    }),
    category: qualityMetric({
      value: category,
      unit: "category",
      sampleCount,
      usableSampleCount,
      provenance: "reconstructed",
      confidence: "high",
      unavailableReasons,
      formulaVersion: `${ECONOMY_FORMULA_VERSION}.category`,
    }),
  };
}

function logicalTeamEconomyAnalysis(
  rounds: RoundAnalysis[],
  logicalTeam: LogicalTeamId,
): LogicalTeamEconomyAnalysis {
  const teamRounds = rounds.map((round) => {
    const sides = new Set(
      round.players
        .filter((player) => player.logicalTeam === logicalTeam && player.side !== null)
        .map((player) => player.side as "T" | "CT"),
    );
    if (sides.size !== 1) {
      return {
        round,
        opponentCategory: null as EconomyCategory | null,
      };
    }
    const side = [...sides][0];
    const opponentSide = side === "T" ? "CT" : "T";
    const opponentEconomy = round.economy.find(
      (economy) => economy.side === opponentSide,
    );
    return {
      round,
      opponentCategory: opponentEconomy?.category ?? null,
    };
  });
  const classifiedRounds = teamRounds.filter(
    (sample) => sample.opponentCategory !== null,
  );
  const classificationComplete =
    teamRounds.length > 0 && classifiedRounds.length === teamRounds.length;
  const classificationReasons = teamRounds.length === 0
    ? ["no_logical_team_rounds"]
    : classificationComplete
      ? []
      : ["incomplete_opponent_economy"];
  const antiEcoRounds = classifiedRounds.filter(
    (sample) => sample.opponentCategory === "eco",
  );
  const outcomeRounds = antiEcoRounds.filter(
    (sample) => sample.round.logicalWinner !== null,
  );
  const outcomesComplete =
    classificationComplete && outcomeRounds.length === antiEcoRounds.length;
  const outcomeReasons = !classificationComplete
    ? classificationReasons
    : outcomesComplete
      ? []
      : ["incomplete_anti_eco_outcomes"];
  const wins = outcomeRounds.filter(
    (sample) => sample.round.logicalWinner === logicalTeam,
  ).length;
  const losses = outcomeRounds.filter(
    (sample) => sample.round.logicalWinner !== logicalTeam,
  ).length;
  const countMetric = (
    metricId: string,
    value: number | null,
    sampleCount: number,
    usableSampleCount: number,
    unavailableReasons: string[],
  ) => qualityMetric({
    value,
    unit: "rounds",
    sampleCount,
    usableSampleCount,
    provenance: "reconstructed" as const,
    confidence: "high" as const,
    unavailableReasons,
    formulaVersion: `${ECONOMY_FORMULA_VERSION}.${metricId}`,
  });

  return {
    antiEcoRounds: countMetric(
      "antiEcoRounds",
      classificationComplete ? antiEcoRounds.length : null,
      teamRounds.length,
      classifiedRounds.length,
      classificationReasons,
    ),
    antiEcoWins: countMetric(
      "antiEcoWins",
      outcomesComplete ? wins : null,
      antiEcoRounds.length,
      outcomeRounds.length,
      outcomeReasons,
    ),
    antiEcoWinRate: qualityMetric({
      value:
        outcomesComplete && antiEcoRounds.length > 0
          ? wins / antiEcoRounds.length
          : null,
      unit: "ratio",
      sampleCount: antiEcoRounds.length,
      usableSampleCount: outcomeRounds.length,
      provenance: "reconstructed",
      confidence: "high",
      unavailableReasons:
        outcomesComplete && antiEcoRounds.length === 0
          ? ["no_anti_eco_rounds"]
          : outcomeReasons,
      formulaVersion: `${ECONOMY_FORMULA_VERSION}.antiEcoWinRate`,
    }),
    lossesAgainstEco: countMetric(
      "lossesAgainstEco",
      outcomesComplete ? losses : null,
      antiEcoRounds.length,
      outcomeRounds.length,
      outcomeReasons,
    ),
  };
}

function logicalTeamAdvantageAnalysis(
  match: MatchData,
  rounds: RoundAnalysis[],
  logicalTeam: LogicalTeamId,
): LogicalTeamCombatQualityAnalysis {
  const samples = match.rounds.map((round, index) => {
    const analysis = rounds[index];
    if (
      analysis === undefined ||
      round.disconnects === undefined ||
      !round.events.some((event) => event.type === "round_end") ||
      analysis.players.some((player) => player.logicalTeam === null)
    ) {
      return { usable: false, opportunity: false, won: false };
    }
    const logicalTeamByPlayer = new Map(
      analysis.players.map((player) => [player.playerId, player.logicalTeam]),
    );
    const alive: Record<LogicalTeamId, Set<string>> = {
      A: new Set(),
      B: new Set(),
    };
    for (const player of analysis.players) {
      if (player.logicalTeam !== null) {
        alive[player.logicalTeam].add(player.playerId);
      }
    }
    const roundEnd = round.events
      .filter((event) => event.type === "round_end")
      .at(-1);
    if (roundEnd === undefined) {
      return { usable: false, opportunity: false, won: false };
    }
    const stateChanges = [
      ...canonicalFacts(round.events, round, match.meta.tickRate)
        .filter((event) =>
          event.type === "kill" &&
          event.victim !== undefined &&
          event.t <= roundEnd.t
        )
        .map((event) => ({
          time: event.t,
          sequence: event.sequence ?? Number.MAX_SAFE_INTEGER,
          playerId: playerId(event.victim as PlayerId),
        })),
      ...canonicalFacts(round.disconnects, round, match.meta.tickRate)
        .filter((event) => event.player !== undefined && event.t <= roundEnd.t)
        .map((event) => ({
          time: event.t,
          sequence: event.sequence ?? Number.MAX_SAFE_INTEGER,
          playerId: playerId(event.player as PlayerId),
        })),
    ].sort((left, right) =>
      left.time - right.time ||
      left.sequence - right.sequence ||
      left.playerId.localeCompare(right.playerId)
    );
    let opportunity = false;
    for (const change of stateChanges) {
      const team = logicalTeamByPlayer.get(change.playerId);
      if (team === undefined || team === null) {
        return { usable: false, opportunity: false, won: false };
      }
      alive[team].delete(change.playerId);
      if (alive[logicalTeam].size > alive[oppositeLogicalTeam(logicalTeam)].size) {
        opportunity = true;
      }
    }
    return {
      usable: analysis.logicalWinner !== null,
      opportunity,
      won: analysis.logicalWinner === logicalTeam,
    };
  });
  const usableSamples = samples.filter((sample) => sample.usable);
  const complete = samples.length > 0 && usableSamples.length === samples.length;
  const opportunities = usableSamples.filter((sample) => sample.opportunity);
  const wins = opportunities.filter((sample) => sample.won).length;
  const classificationReasons = samples.length === 0
    ? ["no_logical_team_rounds"]
    : complete
      ? []
      : ["incomplete_advantage_context"];
  const countMetric = (
    metricId: string,
    value: number | null,
    sampleCount: number,
    usableSampleCount: number,
    unavailableReasons: string[],
  ) => qualityMetric({
    value,
    unit: "rounds",
    sampleCount,
    usableSampleCount,
    provenance: "reconstructed" as const,
    confidence: "high" as const,
    unavailableReasons,
    formulaVersion: `${COMBAT_FORMULA_VERSION}.${metricId}`,
  });

  return {
    advantageRounds: countMetric(
      "advantageRounds",
      complete ? opportunities.length : null,
      samples.length,
      usableSamples.length,
      classificationReasons,
    ),
    advantageWins: countMetric(
      "advantageWins",
      complete ? wins : null,
      opportunities.length,
      complete ? opportunities.length : 0,
      classificationReasons,
    ),
    advantageConversionRate: qualityMetric({
      value:
        complete && opportunities.length > 0
          ? wins / opportunities.length
          : null,
      unit: "ratio",
      sampleCount: opportunities.length,
      usableSampleCount: complete ? opportunities.length : 0,
      provenance: "reconstructed",
      confidence: "high",
      unavailableReasons:
        complete && opportunities.length === 0
          ? ["no_numerical_advantage_rounds"]
          : classificationReasons,
      formulaVersion: `${COMBAT_FORMULA_VERSION}.advantageConversionRate`,
    }),
  };
}

const PRIMARY_WEAPONS = new Set([
  "ak47",
  "m4a1",
  "m4a1s",
  "m4a1silencer",
  "famas",
  "galilar",
  "aug",
  "sg553",
  "awp",
  "ssg08",
  "scar20",
  "g3sg1",
  "mac10",
  "mp9",
  "mp7",
  "mp5sd",
  "ump45",
  "p90",
  "bizon",
  "nova",
  "xm1014",
  "mag7",
  "sawedoff",
  "m249",
  "negev",
]);

function normalizedEquipmentName(value: string): string {
  return value
    .toLowerCase()
    .replace(/^weapon_/, "")
    .replace(/[^a-z0-9]/g, "");
}

function hasPrimaryWeapon(weapons: string[]): boolean {
  return weapons.some((weapon) =>
    PRIMARY_WEAPONS.has(normalizedEquipmentName(weapon))
  );
}

type PlayerEconomyAccumulator = {
  purchaseEvents: number;
  purchaseStreamIncomplete: boolean;
  deaths: number;
  usableDeaths: number;
  equipmentValueLost: number;
  lostRounds: number;
  usableLostRounds: number;
  savedPrimaryWeaponRounds: number;
  incompleteRoundOutcomes: boolean;
  valueLostEvidence: Set<string>;
  savedWeaponEvidence: Set<string>;
};

function playerEconomyAnalyses(
  match: MatchData,
  recordEvidence: (proof: AnalysisEvidence) => void,
): Map<string, PlayerEconomyQualityAnalysis> {
  const accumulators = new Map<string, PlayerEconomyAccumulator>(
    match.players.map((player) => [
      playerId(player.steamId),
      {
        purchaseEvents: 0,
        purchaseStreamIncomplete: false,
        deaths: 0,
        usableDeaths: 0,
        equipmentValueLost: 0,
        lostRounds: 0,
        usableLostRounds: 0,
        savedPrimaryWeaponRounds: 0,
        incompleteRoundOutcomes: false,
        valueLostEvidence: new Set<string>(),
        savedWeaponEvidence: new Set<string>(),
      },
    ]),
  );

  for (const round of match.rounds) {
    if (round.purchases === undefined) {
      for (const accumulator of accumulators.values()) {
        accumulator.purchaseStreamIncomplete = true;
      }
    } else {
      for (const purchase of round.purchases) {
        if (purchase.player === undefined) continue;
        const accumulator = accumulators.get(playerId(purchase.player));
        if (accumulator) accumulator.purchaseEvents++;
      }
    }
    const canonicalEvents = canonicalFacts(round.events, round, match.meta.tickRate);
    const deaths = new Map<string, string>();
    let killIndex = 0;
    for (const event of canonicalEvents) {
      if (event.type !== "kill") continue;
      const deathEvidenceId = evidenceId(round, "kill", killIndex++);
      if (event.victim === undefined) continue;
      const victimId = playerId(event.victim);
      const accumulator = accumulators.get(victimId);
      if (!accumulator) continue;
      deaths.set(victimId, deathEvidenceId);
      accumulator.deaths++;
      accumulator.valueLostEvidence.add(deathEvidenceId);

      let snapshotIndex = -1;
      let snapshotTime = Number.NEGATIVE_INFINITY;
      let equipmentValue: number | undefined;
      for (const [frameIndex, frame] of round.frames.entries()) {
        if (frame.t >= event.t || frame.t < snapshotTime) continue;
        const position = frame.players.find(
          (candidate) => playerId(candidate.id) === victimId,
        );
        if (!position) continue;
        snapshotIndex = frameIndex;
        snapshotTime = frame.t;
        equipmentValue = position.equipmentValue;
      }
      if (
        snapshotIndex < 0 ||
        equipmentValue === undefined ||
        !Number.isFinite(equipmentValue) ||
        equipmentValue < 0
      ) continue;
      const proof = inventoryEvidence(
        round,
        victimId,
        snapshotIndex,
        snapshotTime,
        match.meta.tickRate,
      );
      recordEvidence(proof);
      accumulator.valueLostEvidence.add(proof.evidenceId);
      accumulator.usableDeaths++;
      accumulator.equipmentValueLost += equipmentValue;
    }

    const participants = new Set(
      round.frames.flatMap((frame) => frame.players.map(
        (player) => playerId(player.id),
      )),
    );
    const teams = participantTeams(round, participants);
    const winnerTeam = roundWinnerTeam(round);
    const roundEnd = round.events
      .filter((event) => event.type === "round_end")
      .at(-1);

    for (const id of participants) {
      const accumulator = accumulators.get(id);
      if (!accumulator) continue;
      const team = teams.get(id);
      if (winnerTeam === null || team === undefined) {
        accumulator.incompleteRoundOutcomes = true;
        continue;
      }
      if (team === winnerTeam) continue;
      accumulator.lostRounds++;
      const deathEvidenceId = deaths.get(id);
      if (deathEvidenceId !== undefined) {
        accumulator.usableLostRounds++;
        accumulator.savedWeaponEvidence.add(deathEvidenceId);
        continue;
      }
      if (roundEnd === undefined) continue;

      let snapshotIndex = -1;
      let snapshotTime = Number.NEGATIVE_INFINITY;
      let hp: number | undefined;
      let weapons: string[] | undefined;
      for (const [frameIndex, frame] of round.frames.entries()) {
        if (frame.t > roundEnd.t || frame.t < snapshotTime) continue;
        const position = frame.players.find(
          (candidate) => playerId(candidate.id) === id,
        );
        if (!position) continue;
        snapshotIndex = frameIndex;
        snapshotTime = frame.t;
        hp = position.hp;
        weapons = position.weapons;
      }
      if (snapshotIndex < 0 || hp === undefined) continue;
      if (hp > 0 && weapons === undefined) continue;

      const proof = inventoryEvidence(
        round,
        id,
        snapshotIndex,
        snapshotTime,
        match.meta.tickRate,
      );
      recordEvidence(proof);
      accumulator.savedWeaponEvidence.add(`r${round.number}-round-end`);
      accumulator.savedWeaponEvidence.add(proof.evidenceId);
      accumulator.usableLostRounds++;
      if (hp > 0 && weapons !== undefined && hasPrimaryWeapon(weapons)) {
        accumulator.savedPrimaryWeaponRounds++;
      }
    }
  }

  return new Map(
    [...accumulators.entries()].map(([id, accumulator]) => {
      const deathCoverageComplete =
        accumulator.usableDeaths === accumulator.deaths;
      const deathReasons = deathCoverageComplete
        ? []
        : ["incomplete_predeath_equipment_values"];
      const saveCoverageComplete =
        !accumulator.incompleteRoundOutcomes &&
        accumulator.usableLostRounds === accumulator.lostRounds;
      const saveReasons = accumulator.incompleteRoundOutcomes
        ? ["incomplete_round_outcomes"]
        : saveCoverageComplete
          ? []
          : ["incomplete_round_end_inventory"];
      const metric = (
        metricId: string,
        value: number | null,
        unit: string,
        sampleCount: number,
        usableSampleCount: number,
        unavailableReasons: string[],
      ) => qualityMetric({
        value,
        unit,
        sampleCount,
        usableSampleCount,
        provenance: "reconstructed" as const,
        confidence: "high" as const,
        unavailableReasons,
        formulaVersion: `${ECONOMY_FORMULA_VERSION}.${metricId}`,
      });
      const analysis: PlayerEconomyQualityAnalysis = {
        netSpend: metric(
          "netSpend",
          null,
          "currency",
          accumulator.purchaseEvents,
          0,
          accumulator.purchaseStreamIncomplete
            ? ["missing_purchase_events"]
            : ["unvalidated_purchase_event_semantics"],
        ),
        equipmentValueLostOnDeath: metric(
          "equipmentValueLostOnDeath",
          deathCoverageComplete ? accumulator.equipmentValueLost : null,
          "equipment_value",
          accumulator.deaths,
          accumulator.usableDeaths,
          deathReasons,
        ),
        averageEquipmentValueLostPerDeath: metric(
          "averageEquipmentValueLostPerDeath",
          deathCoverageComplete && accumulator.deaths > 0
            ? accumulator.equipmentValueLost / accumulator.deaths
            : null,
          "equipment_value_per_death",
          accumulator.deaths,
          accumulator.usableDeaths,
          deathCoverageComplete && accumulator.deaths === 0
            ? ["no_deaths"]
            : deathReasons,
        ),
        savedPrimaryWeaponRounds: metric(
          "savedPrimaryWeaponRounds",
          saveCoverageComplete ? accumulator.savedPrimaryWeaponRounds : null,
          "rounds",
          accumulator.lostRounds,
          accumulator.usableLostRounds,
          saveReasons,
        ),
        valueLostEvidence: [...accumulator.valueLostEvidence].sort(),
        savedWeaponEvidence: [...accumulator.savedWeaponEvidence].sort(),
      };
      return [id, analysis];
    }),
  );
}

function playerUtilityQuality(
  player: BasePlayerAnalysis,
): PlayerUtilityQualityAnalysis {
  const metrics = player.metrics;
  const grenades = metrics.grenadesThrown;
  const flashes = metrics.flashes;
  const damage = metrics.utilityDamage;
  const rounds = metrics.roundsPlayed;
  const deaths = metrics.deaths;
  const metric = (
    metricId: string,
    value: number | null,
    unit: string,
    sampleCount: number,
    usableSampleCount: number,
    unavailableReasons: string[],
  ) => qualityMetric({
    value,
    unit,
    sampleCount,
    usableSampleCount,
    provenance: "reconstructed" as const,
    confidence: "high" as const,
    unavailableReasons,
    formulaVersion: `${UTILITY_FORMULA_VERSION}.${metricId}`,
  });
  const grenadeReasons = grenades === null
    ? ["missing_weapon_fire_events"]
    : rounds === 0
      ? ["no_rounds"]
      : [];
  const flashSamples = grenades?.flash ?? 0;
  const flashReasons = grenades === null
    ? ["missing_weapon_fire_events"]
    : flashes === null || flashes === undefined
      ? ["missing_flash_events"]
      : flashSamples === 0
        ? ["no_flash_grenades"]
        : [];
  const heSamples = grenades?.he ?? 0;
  const heReasons = grenades === null
    ? ["missing_weapon_fire_events"]
    : damage === null || damage === undefined
      ? ["missing_damage_events"]
      : heSamples === 0
        ? ["no_he_grenades"]
        : [];
  const savedReasons =
    metrics.averageUnusedUtilityValue !== null &&
      metrics.averageUnusedUtilityValue !== undefined
      ? []
      : deaths === 0
        ? ["no_deaths"]
        : ["incomplete_predeath_inventory"];
  return {
    grenadesThrown: metric(
      "grenadesThrown",
      grenades?.total ?? null,
      "grenades",
      rounds,
      grenades === null ? 0 : rounds,
      grenadeReasons,
    ),
    flashGrenades: metric(
      "flashGrenades",
      grenades?.flash ?? null,
      "grenades",
      rounds,
      grenades === null ? 0 : rounds,
      grenadeReasons,
    ),
    smokeGrenades: metric(
      "smokeGrenades",
      grenades?.smoke ?? null,
      "grenades",
      rounds,
      grenades === null ? 0 : rounds,
      grenadeReasons,
    ),
    heGrenades: metric(
      "heGrenades",
      grenades?.he ?? null,
      "grenades",
      rounds,
      grenades === null ? 0 : rounds,
      grenadeReasons,
    ),
    fireGrenades: metric(
      "fireGrenades",
      grenades === null ? null : grenades.molotov + grenades.incendiary,
      "grenades",
      rounds,
      grenades === null ? 0 : rounds,
      grenadeReasons,
    ),
    utilityQuantityRating: metric(
      "utilityQuantityRating",
      metrics.utilityQuantityRating ?? null,
      "score_0_100",
      rounds,
      metrics.utilityQuantityRating === null ||
          metrics.utilityQuantityRating === undefined
        ? 0
        : rounds,
      grenadeReasons,
    ),
    effectiveEnemiesFlashed: metric(
      "effectiveEnemiesFlashed",
      flashes?.effectiveEnemiesFlashed ?? null,
      "players",
      flashSamples,
      flashes === null || flashes === undefined ? 0 : flashSamples,
      flashes === null || flashes === undefined ? ["missing_flash_events"] : [],
    ),
    effectiveTeammatesFlashed: metric(
      "effectiveTeammatesFlashed",
      flashes?.effectiveTeammatesFlashed ?? null,
      "players",
      flashSamples,
      flashes === null || flashes === undefined ? 0 : flashSamples,
      flashes === null || flashes === undefined ? ["missing_flash_events"] : [],
    ),
    flashesLeadingToKills: metric(
      "flashesLeadingToKills",
      flashes?.flashesLeadingToKills ?? null,
      "kills",
      flashSamples,
      flashes === null || flashes === undefined ? 0 : flashSamples,
      flashes === null || flashes === undefined ? ["missing_flash_events"] : [],
    ),
    heDamage: metric(
      "heDamage",
      damage?.heDamage ?? null,
      "damage",
      heSamples,
      damage === null || damage === undefined ? 0 : heSamples,
      damage === null || damage === undefined ? ["missing_damage_events"] : [],
    ),
    teammateHeDamage: metric(
      "teammateHeDamage",
      damage?.teammateHeDamage ?? null,
      "damage",
      heSamples,
      damage === null || damage === undefined ? 0 : heSamples,
      damage === null || damage === undefined ? ["missing_damage_events"] : [],
    ),
    enemiesPerFlash: metric(
      "enemiesPerFlash",
      flashReasons.length === 0
        ? (flashes?.effectiveEnemiesFlashed ?? 0) / flashSamples
        : null,
      "players_per_grenade",
      flashSamples,
      flashReasons.length === 0 ? flashSamples : 0,
      flashReasons,
    ),
    teammatesPerFlash: metric(
      "teammatesPerFlash",
      flashReasons.length === 0
        ? (flashes?.effectiveTeammatesFlashed ?? 0) / flashSamples
        : null,
      "players_per_grenade",
      flashSamples,
      flashReasons.length === 0 ? flashSamples : 0,
      flashReasons,
    ),
    flashKillsPerFlash: metric(
      "flashKillsPerFlash",
      flashReasons.length === 0
        ? (flashes?.flashesLeadingToKills ?? 0) / flashSamples
        : null,
      "kills_per_grenade",
      flashSamples,
      flashReasons.length === 0 ? flashSamples : 0,
      flashReasons,
    ),
    averageEnemyBlindDuration: metric(
      "averageEnemyBlindDuration",
      flashes?.averageEnemyBlindDuration ?? null,
      "seconds",
      flashes?.enemyBlindFlashCount ?? 0,
      flashes?.enemyBlindFlashCount ?? 0,
      flashes === null || flashes === undefined
        ? ["missing_flash_events"]
        : flashes.enemyBlindFlashCount === 0
          ? ["no_enemy_blind_flashes"]
          : [],
    ),
    heDamagePerGrenade: metric(
      "heDamagePerGrenade",
      heReasons.length === 0
        ? (damage?.heDamage ?? 0) / heSamples
        : null,
      "damage_per_grenade",
      heSamples,
      heReasons.length === 0 ? heSamples : 0,
      heReasons,
    ),
    teammateHeDamagePerGrenade: metric(
      "teammateHeDamagePerGrenade",
      heReasons.length === 0
        ? (damage?.teammateHeDamage ?? 0) / heSamples
        : null,
      "damage_per_grenade",
      heSamples,
      heReasons.length === 0 ? heSamples : 0,
      heReasons,
    ),
    averageUnusedUtilityValue: metric(
      "averageUnusedUtilityValue",
      metrics.averageUnusedUtilityValue ?? null,
      "currency_per_death",
      deaths,
      savedReasons.length === 0 ? deaths : 0,
      savedReasons,
    ),
  };
}

function roundEndEvidence(round: Round): AnalysisEvidence {
  let event: MatchEvent | undefined;
  for (let index = round.events.length - 1; index >= 0; index--) {
    if (round.events[index].type === "round_end") {
      event = round.events[index];
      break;
    }
  }
  return {
    evidenceId: `r${round.number}-round-end`,
    roundNumber: round.number,
    tick: event?.tick ?? null,
    sequence: event?.sequence ?? null,
    time: event?.t ?? round.duration,
    type: "round_end",
    actors: [],
  };
}

function roundStartEvidence(round: Round): AnalysisEvidence {
  return {
    evidenceId: `r${round.number}-round-start`,
    roundNumber: round.number,
    tick: round.startTick,
    sequence: null,
    time: 0,
    type: "round_start",
    actors: [],
  };
}

function addUnavailable(player: MutablePlayerAnalysis, reason: string): void {
  player.unavailableReasons.add(reason);
}

function validEnemyKill(round: Round, event: MatchEvent): boolean | null {
  if (event.type !== "kill" || event.killer === undefined || event.victim === undefined) return false;
  const killer = playerId(event.killer);
  const victim = playerId(event.victim);
  if (killer === victim) return false;
  const killerTeam = playerTeamAtOrBefore(round, killer, event.t);
  const victimTeam = playerTeamAtOrBefore(round, victim, event.t);
  if (killerTeam === null || victimTeam === null) return null;
  return killerTeam !== victimTeam;
}

function incrementMultiKill(counts: MultiKillRoundCounts, kills: number): void {
  if (kills === 2) counts.two++;
  else if (kills === 3) counts.three++;
  else if (kills === 4) counts.four++;
  else if (kills >= 5) counts.fivePlus++;
}

function incrementClutch(counts: ClutchCounts, opponents: number): void {
  if (opponents === 1) counts.oneVsOne++;
  else if (opponents === 2) counts.oneVsTwo++;
  else if (opponents === 3) counts.oneVsThree++;
  else if (opponents === 4) counts.oneVsFour++;
  else if (opponents >= 5) counts.oneVsFivePlus++;
}

function roundWinnerTeam(round: Round): number | null {
  if (round.winner === "T") return 2;
  if (round.winner === "CT") return 3;
  return null;
}

function participantTeams(round: Round, participants: Set<string>): Map<string, number> {
  const teams = new Map<string, number>();
  for (const frame of round.frames) {
    for (const player of frame.players) {
      const id = playerId(player.id);
      if (participants.has(id) && !teams.has(id)) teams.set(id, player.team);
    }
  }
  return teams;
}

function canonicalFacts<T extends { t: number; tick?: number; sequence?: number }>(
  facts: T[],
  round: Round,
  tickRate: number,
): T[] {
  return facts
    .map((fact, index) => ({ fact, index }))
    .sort((left, right) => {
      const leftTick = left.fact.tick ?? Math.round(round.startTick + left.fact.t * tickRate);
      const rightTick = right.fact.tick ?? Math.round(round.startTick + right.fact.t * tickRate);
      return leftTick - rightTick ||
        (left.fact.sequence ?? left.index) - (right.fact.sequence ?? right.index) ||
        left.index - right.index;
    })
    .map(({ fact }) => fact);
}

function ensureFullyLoaded(match: MatchData): void {
  for (const round of match.rounds) {
    if (!round.frames.length) {
      throw new Error(`Cannot analyze round ${round.number} without its frame payload.`);
    }
  }
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

function sumMultiKills(analyses: BasePlayerAnalysis[]): MultiKillRoundCounts | null {
  const total = emptyMultiKillCounts();
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
  const total = emptyClutchCounts();
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
  const total = emptyGrenadeCounts();
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

function sumUtilityDamage(
  analyses: BasePlayerAnalysis[],
): UtilityDamageMetrics | null {
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
  return utilityDamageMetrics(
    heDamage,
    fireDamage,
    teammateHeDamage,
    teammateFireDamage,
  );
}

function aggregateSide(analyses: BasePlayerAnalysis[]): PlayerSideAnalysis | null {
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
  const unusedUtilityValue = sumNullableMetric(
    analyses,
    "unusedUtilityValue",
  );
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
      averageUnusedUtilityValue:
        unusedUtilityValue === null || deaths === 0
          ? null
          : unusedUtilityValue / deaths,
      utilityQuantityRating: utilityQuantityRating(
        grenadesThrown,
        roundsPlayed,
      ),
    },
    metricEvidence,
    unavailableReasons: [...new Set(analyses.flatMap((analysis) => analysis.unavailableReasons))].sort(),
  };
}

function aggregateEconomy(
  analyses: BasePlayerAnalysis[],
  economyEvidence: string[],
): PlayerEconomyAnalysis | null {
  const aggregate = aggregateSide(analyses);
  return aggregate === null ? null : { ...aggregate, economyEvidence };
}

function oppositeLogicalTeam(team: LogicalTeamId): LogicalTeamId {
  return team === "A" ? "B" : "A";
}

function aggregateLogicalTeam(
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

function compareEvidence(left: AnalysisEvidence, right: AnalysisEvidence): number {
  return left.roundNumber - right.roundNumber ||
    (left.tick ?? Number.MAX_SAFE_INTEGER) - (right.tick ?? Number.MAX_SAFE_INTEGER) ||
    (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER) ||
    left.evidenceId.localeCompare(right.evidenceId);
}

function analyzeMatchBase(match: MatchData, context: AnalyzeMatchContext): BaseMatchAnalysis {
  ensureFullyLoaded(match);

  const players = new Map<string, MutablePlayerAnalysis>();
  for (const player of match.players) {
    const id = playerId(player.steamId);
    players.set(id, {
      playerId: id,
      name: player.name,
      roundsPlayed: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      headshotKills: 0,
      damageHealth: 0,
      combatAvailable: true,
      damageAvailable: true,
      openingAvailable: true,
      openingAttempts: 0,
      openingWins: 0,
      openingLosses: 0,
      multiKillRounds: emptyMultiKillCounts(),
      survivalAvailable: true,
      survivedRounds: 0,
      clutchAvailable: true,
      clutchOpportunities: emptyClutchCounts(),
      clutchWins: emptyClutchCounts(),
      tradeAttemptsAvailable: true,
      tradeAvailable: true,
      tradeAttempts: 0,
      tradeKills: 0,
      tradeDeaths: 0,
      kastAvailable: true,
      kastRounds: 0,
      grenadesAvailable: true,
      grenadesThrown: emptyGrenadeCounts(),
      flashesAvailable: true,
      enemiesFlashed: 0,
      teammatesFlashed: 0,
      effectiveEnemiesFlashed: 0,
      effectiveTeammatesFlashed: 0,
      enemyBlindDuration: 0,
      teammateBlindDuration: 0,
      enemyBlindFlashCount: 0,
      longestEnemyBlindDuration: 0,
      flashesLeadingToKills: 0,
      heDamage: 0,
      fireDamage: 0,
      teammateHeDamage: 0,
      teammateFireDamage: 0,
      flashAssists: 0,
      utilitySavedAvailable: true,
      utilitySavedOnDeath: emptyGrenadeCounts(),
      unusedUtilityValue: 0,
      tradeKillEvidenceSeen: new Set(),
      metricEvidence: emptyEvidence(),
      unavailableReasons: new Set(),
    });
  }

  const evidence: AnalysisEvidence[] = [];
  const economyRounds: RoundEconomyAnalysis[] = [];
  const evidenceIds = new Set<string>();
  const recordEvidence = (proof: AnalysisEvidence) => {
    if (evidenceIds.has(proof.evidenceId)) return;
    evidenceIds.add(proof.evidenceId);
    evidence.push(proof);
  };

  for (const round of match.rounds) {
    const canonicalEvents = canonicalFacts(round.events, round, match.meta.tickRate);
    const canonicalDamages = canonicalFacts(round.damages ?? [], round, match.meta.tickRate);
    const canonicalDisconnects = canonicalFacts(round.disconnects ?? [], round, match.meta.tickRate);
    const canonicalFlashes = canonicalFacts(round.flashes ?? [], round, match.meta.tickRate);
    const canonicalWeaponFires = canonicalFacts(round.weaponFires ?? [], round, match.meta.tickRate);
    const participants = new Set(
      round.frames.flatMap((frame) => frame.players.map((player) => playerId(player.id))),
    );
    for (const id of participants) {
      const player = players.get(id);
      if (player) player.roundsPlayed++;
    }

    for (const [side, team] of [["T", 2], ["CT", 3]] as const) {
      const unavailable = (
        reason: string,
        sampleCount = 0,
        usableSampleCount = 0,
      ): RoundEconomyAnalysis => ({
        roundNumber: round.number,
        side,
        averageEquipmentValue: null,
        category: null,
        quality: economyQuality(
          null,
          null,
          sampleCount,
          usableSampleCount,
          reason,
        ),
        evidenceId: null,
        unavailableReason: reason,
      });
      if (round.freezeEndTick === undefined) {
        economyRounds.push(unavailable("missing_freeze_end_tick"));
        continue;
      }
      const freezeFrame = round.frames.find((frame) =>
        Math.round(round.startTick + frame.t * match.meta.tickRate) === round.freezeEndTick
      );
      if (!freezeFrame) {
        economyRounds.push(unavailable("missing_freeze_end_frame"));
        continue;
      }
      const teamPlayers = freezeFrame.players.filter((player) => player.team === team);
      if (
        teamPlayers.length === 0 ||
        teamPlayers.some((player) => player.equipmentValue === undefined)
      ) {
        economyRounds.push(unavailable(
          "missing_equipment_values",
          teamPlayers.length,
          teamPlayers.filter((player) => player.equipmentValue !== undefined).length,
        ));
        continue;
      }
      const averageEquipmentValue = teamPlayers.reduce(
        (total, player) => total + (player.equipmentValue ?? 0),
        0,
      ) / teamPlayers.length;
      const proof = economyEvidence(
        round,
        side,
        round.freezeEndTick,
        freezeFrame.t,
        teamPlayers.map((player) => playerId(player.id)),
      );
      recordEvidence(proof);
      economyRounds.push({
        roundNumber: round.number,
        side,
        averageEquipmentValue,
        category: economyCategory(averageEquipmentValue),
        quality: economyQuality(
          averageEquipmentValue,
          economyCategory(averageEquipmentValue),
          teamPlayers.length,
          teamPlayers.length,
          null,
        ),
        evidenceId: proof.evidenceId,
        unavailableReason: null,
      });
    }

    if (round.damages === undefined) {
      for (const id of participants) {
        const player = players.get(id);
        if (!player) continue;
        player.damageAvailable = false;
        player.tradeAttemptsAvailable = false;
        addUnavailable(player, "missing_damage_events");
        addUnavailable(player, "missing_trade_damage_events");
      }
    }

    if (round.weaponFires === undefined) {
      for (const id of participants) {
        const participant = players.get(id);
        if (!participant) continue;
        participant.grenadesAvailable = false;
        addUnavailable(participant, "missing_weapon_fire_events");
      }
    }

    const validRoundKills = new Map<string, string[]>();
    const validKills: ValidKillRecord[] = [];
    const roundAssists = new Set<string>();
    const roundAssistProofs = new Map<string, string[]>();
    const roundCombatUnknown = new Set<string>();
    const killProofs = new Map<MatchEvent, AnalysisEvidence>();
    let bombIndex = 0;
    for (const event of canonicalEvents) {
      if (event.type !== "bomb_planted" && event.type !== "bomb_defused") continue;
      recordEvidence(bombEvidence(round, event, bombIndex++));
    }
    let openingResolved = false;
    let killIndex = 0;
    for (const event of canonicalEvents) {
      if (event.type !== "kill") continue;
      const proof = killEvidence(round, event, killIndex++);
      recordEvidence(proof);
      killProofs.set(event, proof);

      const victim = event.victim === undefined ? undefined : players.get(playerId(event.victim));
      if (victim) {
        victim.deaths++;
        victim.metricEvidence.deaths.push(proof.evidenceId);
      }

      const isValid = validEnemyKill(round, event);
      const killer = event.killer === undefined ? undefined : players.get(playerId(event.killer));
      const assist = event.assist === undefined ? undefined : players.get(playerId(event.assist));
      if (isValid === null) {
        if (event.killer !== undefined) roundCombatUnknown.add(playerId(event.killer));
        if (event.victim !== undefined) roundCombatUnknown.add(playerId(event.victim));
        if (event.assist !== undefined) roundCombatUnknown.add(playerId(event.assist));
        if (!openingResolved) {
          for (const id of participants) {
            const participant = players.get(id);
            if (!participant) continue;
            participant.openingAvailable = false;
            addUnavailable(participant, "missing_opening_team_context");
          }
        }
        if (killer) {
          killer.combatAvailable = false;
          addUnavailable(killer, "missing_kill_team_context");
        }
        if (assist) {
          assist.combatAvailable = false;
          addUnavailable(assist, "missing_kill_team_context");
        }
        continue;
      }
      if (!isValid) continue;

      const killerId = event.killer === undefined ? null : playerId(event.killer);
      const victimId = event.victim === undefined ? null : playerId(event.victim);
      const killerTeam = killerId === null ? null : playerTeamAtOrBefore(round, killerId, event.t);
      const victimTeam = victimId === null ? null : playerTeamAtOrBefore(round, victimId, event.t);
      if (killerId !== null && victimId !== null && killerTeam !== null && victimTeam !== null) {
        validKills.push({ event, proof, killerId, victimId, killerTeam, victimTeam });
      }

      if (killer) {
        killer.kills++;
        killer.metricEvidence.kills.push(proof.evidenceId);
        const roundKills = validRoundKills.get(killer.playerId) ?? [];
        roundKills.push(proof.evidenceId);
        validRoundKills.set(killer.playerId, roundKills);
        if (event.hs) {
          killer.headshotKills++;
          killer.metricEvidence.headshotKills.push(proof.evidenceId);
        }
      }
      if (assist) {
        assist.assists++;
        assist.metricEvidence.assists.push(proof.evidenceId);
        if (event.flashAssist) {
          assist.flashAssists++;
          assist.metricEvidence.flashAssists.push(proof.evidenceId);
        }
        roundAssists.add(assist.playerId);
        const proofs = roundAssistProofs.get(assist.playerId) ?? [];
        proofs.push(proof.evidenceId);
        roundAssistProofs.set(assist.playerId, proofs);
      }
      if (!openingResolved) {
        openingResolved = true;
        if (killer) {
          killer.openingAttempts++;
          killer.openingWins++;
          killer.metricEvidence.openingWins.push(proof.evidenceId);
        }
        if (victim) {
          victim.openingAttempts++;
          victim.openingLosses++;
          victim.metricEvidence.openingLosses.push(proof.evidenceId);
        }
      }
    }

    for (const [index, fire] of canonicalWeaponFires.entries()) {
      const kind = grenadeKind(fire.weapon);
      if (kind === null || fire.shooter === undefined) continue;
      const thrower = players.get(playerId(fire.shooter));
      if (!thrower || !participants.has(thrower.playerId)) continue;
      const proof = grenadeEvidence(round, fire, index);
      recordEvidence(proof);
      thrower.grenadesThrown.total++;
      thrower.grenadesThrown[kind]++;
      thrower.metricEvidence.grenadesThrown.push(proof.evidenceId);
    }

    if (round.flashes === undefined) {
      for (const id of participants) {
        const participant = players.get(id);
        if (!participant) continue;
        participant.flashesAvailable = false;
        addUnavailable(participant, "missing_flash_events");
      }
    } else {
      const flashGroups = new Map<string, {
        throwerId: string;
        throwerTeam: number;
        time: number;
        longestEnemyDuration: number;
        effectiveEnemies: Map<string, number>;
        effectiveTeammates: Set<string>;
      }>();
      for (const [index, flash] of canonicalFlashes.entries()) {
        if (
          flash.thrower === undefined ||
          flash.victim === undefined ||
          flash.duration <= 0
        ) continue;
        const throwerId = playerId(flash.thrower);
        const victimId = playerId(flash.victim);
        const thrower = players.get(throwerId);
        if (!thrower || !participants.has(throwerId)) continue;
        const throwerTeam = playerTeamAtOrBefore(round, throwerId, flash.t);
        const victimTeam = playerTeamAtOrBefore(round, victimId, flash.t);
        if (throwerTeam === null || victimTeam === null) {
          thrower.flashesAvailable = false;
          addUnavailable(thrower, "missing_flash_team_context");
          continue;
        }
        const proof = flashEvidence(round, flash, index);
        recordEvidence(proof);
        thrower.metricEvidence.flashes.push(proof.evidenceId);
        const groupKey = `${throwerId}:${flash.tick}`;
        const group = flashGroups.get(groupKey) ?? {
          throwerId,
          throwerTeam,
          time: flash.t,
          longestEnemyDuration: 0,
          effectiveEnemies: new Map<string, number>(),
          effectiveTeammates: new Set<string>(),
        };
        if (throwerTeam !== victimTeam) {
          thrower.enemiesFlashed++;
          thrower.enemyBlindDuration += flash.duration;
          group.longestEnemyDuration = Math.max(
            group.longestEnemyDuration,
            flash.duration,
          );
          if (flash.duration > EFFECTIVE_FLASH_MIN_DURATION_SECONDS) {
            group.effectiveEnemies.set(
              victimId,
              Math.max(
                group.effectiveEnemies.get(victimId) ?? 0,
                flash.duration,
              ),
            );
          }
        } else {
          if (throwerId !== victimId) {
            thrower.teammatesFlashed++;
            thrower.teammateBlindDuration += flash.duration;
          }
          if (flash.duration > EFFECTIVE_FLASH_MIN_DURATION_SECONDS) {
            group.effectiveTeammates.add(victimId);
          }
        }
        flashGroups.set(groupKey, group);
      }

      for (const group of flashGroups.values()) {
        const thrower = players.get(group.throwerId);
        if (!thrower) continue;
        thrower.effectiveEnemiesFlashed += group.effectiveEnemies.size;
        thrower.effectiveTeammatesFlashed += group.effectiveTeammates.size;
        if (group.longestEnemyDuration > 0) {
          thrower.enemyBlindFlashCount++;
          thrower.longestEnemyBlindDuration += group.longestEnemyDuration;
        }
        for (const [victimId, duration] of group.effectiveEnemies) {
          const qualifyingKill = canonicalEvents.find((event) => {
            if (
              event.type !== "kill" ||
              event.victim === undefined ||
              event.killer === undefined ||
              playerId(event.victim) !== victimId ||
              event.t < group.time ||
              event.t > group.time + duration
            ) {
              return false;
            }
            const killerTeam = playerTeamAtOrBefore(
              round,
              playerId(event.killer),
              event.t,
            );
            return killerTeam === group.throwerTeam;
          });
          if (qualifyingKill) thrower.flashesLeadingToKills++;
        }
      }
    }

    for (const event of canonicalEvents) {
      if (event.type !== "kill" || event.victim === undefined) continue;
      const victimId = playerId(event.victim);
      const victim = players.get(victimId);
      const deathProof = killProofs.get(event);
      if (!victim || !deathProof) continue;

      let snapshotIndex = -1;
      let snapshotTime = Number.NEGATIVE_INFINITY;
      let snapshotWeapons: string[] | undefined;
      for (const [frameIndex, frame] of round.frames.entries()) {
        if (frame.t >= event.t || frame.t < snapshotTime) continue;
        const position = frame.players.find((candidate) => playerId(candidate.id) === victimId);
        if (!position) continue;
        snapshotIndex = frameIndex;
        snapshotTime = frame.t;
        snapshotWeapons = position.weapons;
      }
      if (snapshotIndex < 0 || snapshotWeapons === undefined) {
        victim.utilitySavedAvailable = false;
        addUnavailable(victim, "missing_predeath_inventory");
        continue;
      }

      const saved = emptyGrenadeCounts();
      for (const weapon of snapshotWeapons) {
        const kind = grenadeKind(weapon);
        if (kind === null) continue;
        saved.total++;
        saved[kind]++;
      }
      if (saved.total > 0 && round.weaponFires === undefined) {
        victim.utilitySavedAvailable = false;
        addUnavailable(victim, "missing_predeath_weapon_fire_events");
        continue;
      }

      for (const fire of canonicalWeaponFires) {
        if (fire.shooter === undefined || playerId(fire.shooter) !== victimId) continue;
        const kind = grenadeKind(fire.weapon);
        if (kind === null || fire.t <= snapshotTime || fire.t > event.t) continue;
        if (
          fire.tick !== undefined &&
          event.tick !== undefined &&
          (fire.tick > event.tick ||
            fire.tick === event.tick &&
              fire.sequence !== undefined &&
              event.sequence !== undefined &&
              fire.sequence >= event.sequence)
        ) continue;
        if (saved[kind] > 0) {
          saved[kind]--;
          saved.total--;
        }
      }

      const proof = inventoryEvidence(
        round,
        victimId,
        snapshotIndex,
        snapshotTime,
        match.meta.tickRate,
      );
      recordEvidence(proof);
      victim.utilitySavedOnDeath.total += saved.total;
      victim.utilitySavedOnDeath.flash += saved.flash;
      victim.utilitySavedOnDeath.smoke += saved.smoke;
      victim.utilitySavedOnDeath.he += saved.he;
      victim.utilitySavedOnDeath.molotov += saved.molotov;
      victim.utilitySavedOnDeath.incendiary += saved.incendiary;
      victim.utilitySavedOnDeath.decoy += saved.decoy;
      victim.unusedUtilityValue +=
        saved.flash * grenadeValue("flash") +
        saved.smoke * grenadeValue("smoke") +
        saved.he * grenadeValue("he") +
        saved.molotov * grenadeValue("molotov") +
        saved.incendiary * grenadeValue("incendiary") +
        saved.decoy * grenadeValue("decoy");
      victim.metricEvidence.utilitySavedOnDeath.push(proof.evidenceId, deathProof.evidenceId);
    }

    for (const [id, proofs] of validRoundKills) {
      if (proofs.length < 2) continue;
      const player = players.get(id);
      if (!player) continue;
      incrementMultiKill(player.multiKillRounds, proofs.length);
      player.metricEvidence.multiKills.push(...proofs);
    }

    const damageProofs = new Map<DamageEvent, AnalysisEvidence>();
    for (const [index, damage] of canonicalDamages.entries()) {
      if (damage.attacker === undefined || damage.victim === undefined) continue;
      const attackerId = playerId(damage.attacker);
      const victimId = playerId(damage.victim);
      if (attackerId === victimId) continue;
      const attacker = players.get(attackerId);
      if (!attacker) continue;

      const attackerTeam = playerTeamAtOrBefore(round, attackerId, damage.t);
      const victimTeam = playerTeamAtOrBefore(round, victimId, damage.t);
      if (attackerTeam === null || victimTeam === null) {
        attacker.damageAvailable = false;
        attacker.tradeAttemptsAvailable = false;
        addUnavailable(attacker, "missing_damage_team_context");
        addUnavailable(attacker, "missing_trade_damage_team_context");
        continue;
      }
      const utilityKind = utilityDamageKind(damage.weapon);
      if (attackerTeam === victimTeam) {
        if (utilityKind === "he") attacker.teammateHeDamage += damage.damageHealth;
        if (utilityKind === "fire") attacker.teammateFireDamage += damage.damageHealth;
        continue;
      }
      if (utilityKind === "he") attacker.heDamage += damage.damageHealth;
      if (utilityKind === "fire") attacker.fireDamage += damage.damageHealth;

      const proof = damageEvidence(round, damage, index);
      recordEvidence(proof);
      damageProofs.set(damage, proof);
      attacker.damageHealth += damage.damageHealth;
      attacker.metricEvidence.damageHealth.push(proof.evidenceId);
    }

    const roundEnd = roundEndEvidence(round);
    recordEvidence(roundEnd);
    const hasRoundEnd = round.events.some((event) => event.type === "round_end");
    const teams = participantTeams(round, participants);
    const missingTeamContext = [...participants].some((id) => !teams.has(id));
    const missingDisconnectEvents = round.disconnects === undefined;
    const winnerTeam = roundWinnerTeam(round);

    for (const id of participants) {
      const participant = players.get(id);
      if (!participant) continue;
      if (!hasRoundEnd) {
        participant.survivalAvailable = false;
        participant.clutchAvailable = false;
        addUnavailable(participant, "missing_round_end_event");
      }
      if (missingDisconnectEvents) {
        participant.survivalAvailable = false;
        participant.clutchAvailable = false;
        addUnavailable(participant, "missing_disconnect_events");
      }
      if (missingTeamContext || winnerTeam === null) {
        participant.clutchAvailable = false;
        addUnavailable(participant, "missing_clutch_team_context");
      }
    }

    const alive = new Set(participants);
    const uncertainSurvival = new Set<string>();
    const clutchOpportunities = new Map<string, { opponents: number; proofId: string }>();
    const inspectClutches = (proof: AnalysisEvidence) => {
      if (missingTeamContext || winnerTeam === null || missingDisconnectEvents) return;
      for (const team of [2, 3]) {
        const teammates = [...alive].filter((id) => teams.get(id) === team);
        if (teammates.length !== 1) continue;
        const opponents = [...alive].filter((id) => teams.get(id) !== team).length;
        if (opponents < 1) continue;
        const id = teammates[0];
        if (clutchOpportunities.has(id)) continue;
        const participant = players.get(id);
        if (!participant) continue;
        clutchOpportunities.set(id, { opponents, proofId: proof.evidenceId });
        incrementClutch(participant.clutchOpportunities, opponents);
        participant.metricEvidence.clutchOpportunities.push(proof.evidenceId);
        recordEvidence(proof);
      }
    };

    inspectClutches(roundStartEvidence(round));

    const stateEvents = [
      ...canonicalEvents.flatMap((event, index) => {
        if (event.type !== "kill" || event.victim === undefined) return [];
        const proof = killProofs.get(event);
        if (!proof) return [];
        return [{
          tick: event.tick ?? Math.round(round.startTick + event.t * match.meta.tickRate),
          sequence: event.sequence ?? 1_000_000 + index,
          kind: "death" as const,
          player: playerId(event.victim),
          proof,
        }];
      }),
      ...canonicalDisconnects.flatMap((disconnect, index) => {
        if (disconnect.player === undefined) return [];
        const proof = disconnectEvidence(round, disconnect, index);
        recordEvidence(proof);
        return [{
          tick: disconnect.tick,
          sequence: disconnect.sequence ?? 2_000_000 + index,
          kind: "disconnect" as const,
          player: playerId(disconnect.player),
          proof,
        }];
      }),
    ].sort((left, right) => left.tick - right.tick || left.sequence - right.sequence);

    const tradeRoundUnknown = roundCombatUnknown.size > 0;
    if (tradeRoundUnknown) {
      for (const id of participants) {
        const participant = players.get(id);
        if (!participant) continue;
        participant.tradeAvailable = false;
        addUnavailable(participant, "missing_trade_team_context");
      }
    }

    const removalByPlayer = new Map<string, { tick: number; sequence: number }>();
    for (const stateEvent of stateEvents) {
      if (!removalByPlayer.has(stateEvent.player)) {
        removalByPlayer.set(stateEvent.player, {
          tick: stateEvent.tick,
          sequence: stateEvent.sequence,
        });
      }
    }
    const roundTradeDeaths = new Set<string>();
    const roundTradeDeathProofs = new Map<string, string[]>();

    for (const [deathIndex, death] of validKills.entries()) {
      const killerDeath = validKills.slice(deathIndex + 1).find((candidate) =>
        candidate.victimId === death.killerId
      );
      const trade = killerDeath?.killerTeam === death.victimTeam &&
        killerDeath.event.t - death.event.t <= 5.0
        ? killerDeath
        : undefined;
      if (trade) {
        const trader = players.get(trade.killerId);
        const victim = players.get(death.victimId);
        if (trader && !trader.tradeKillEvidenceSeen.has(trade.proof.evidenceId)) {
          trader.tradeKillEvidenceSeen.add(trade.proof.evidenceId);
          trader.tradeKills++;
          trader.metricEvidence.tradeKills.push(trade.proof.evidenceId);
        }
        if (victim) {
          victim.tradeDeaths++;
          victim.metricEvidence.tradeDeaths.push(death.proof.evidenceId, trade.proof.evidenceId);
          roundTradeDeaths.add(victim.playerId);
          roundTradeDeathProofs.set(victim.playerId, [death.proof.evidenceId, trade.proof.evidenceId]);
        }
      }

      if (round.damages === undefined) continue;
      const deathTick = death.event.tick ?? Math.round(round.startTick + death.event.t * match.meta.tickRate);
      const deathSequence = death.event.sequence ?? Number.MAX_SAFE_INTEGER;
      for (const candidateId of participants) {
        if (candidateId === death.victimId || teams.get(candidateId) !== death.victimTeam) continue;
        const removal = removalByPlayer.get(candidateId);
        if (removal && (
          removal.tick < deathTick ||
          removal.tick === deathTick && removal.sequence <= deathSequence
        )) continue;

        const attempt = canonicalDamages.find((damage) => {
          if (
            damage.attacker === undefined ||
            damage.victim === undefined ||
            playerId(damage.attacker) !== candidateId ||
            playerId(damage.victim) !== death.killerId
          ) return false;
          if (damage.t - death.event.t > 5.0 || damage.t < death.event.t) return false;
          if (damage.tick !== deathTick) return damage.tick > deathTick;
          if (damage.sequence !== undefined && death.event.sequence !== undefined) {
            return damage.sequence > death.event.sequence;
          }
          return damage.t > death.event.t;
        });
        if (!attempt) continue;
        const proof = damageProofs.get(attempt);
        const candidate = players.get(candidateId);
        if (!proof || !candidate) continue;
        candidate.tradeAttempts++;
        candidate.metricEvidence.tradeAttempts.push(proof.evidenceId);
      }
    }

    for (const stateEvent of stateEvents) {
      if (!alive.has(stateEvent.player)) continue;
      if (stateEvent.kind === "disconnect") uncertainSurvival.add(stateEvent.player);
      alive.delete(stateEvent.player);
      inspectClutches(stateEvent.proof);
    }

    for (const id of participants) {
      const participant = players.get(id);
      if (!participant) continue;
      if (uncertainSurvival.has(id)) {
        participant.survivalAvailable = false;
        addUnavailable(participant, "player_disconnected_alive");
      } else if (hasRoundEnd && !missingDisconnectEvents && alive.has(id)) {
        participant.survivedRounds++;
        participant.metricEvidence.survivedRounds.push(roundEnd.evidenceId);
      }
    }

    for (const [id, opportunity] of clutchOpportunities) {
      const participant = players.get(id);
      if (!participant || !participant.clutchAvailable) continue;
      if (alive.has(id) && teams.get(id) === winnerTeam) {
        incrementClutch(participant.clutchWins, opportunity.opponents);
        participant.metricEvidence.clutchWins.push(opportunity.proofId, roundEnd.evidenceId);
      }
    }

    for (const id of participants) {
      const participant = players.get(id);
      if (!participant) continue;
      const killProofIds = validRoundKills.get(id) ?? [];
      const assistProofIds = roundAssistProofs.get(id) ?? [];
      const tradeProofIds = roundTradeDeathProofs.get(id) ?? [];
      const survived = hasRoundEnd &&
        !missingDisconnectEvents &&
        !uncertainSurvival.has(id) &&
        alive.has(id);
      const satisfied = killProofIds.length > 0 ||
        roundAssists.has(id) ||
        roundTradeDeaths.has(id) ||
        survived;
      if (satisfied) {
        participant.kastRounds++;
        const proofs = [
          ...killProofIds,
          ...assistProofIds,
          ...tradeProofIds,
          ...(survived ? [roundEnd.evidenceId] : []),
        ];
        participant.metricEvidence.kastRounds.push(...new Set(proofs));
      } else if (
        !hasRoundEnd ||
        missingDisconnectEvents ||
        uncertainSurvival.has(id) ||
        tradeRoundUnknown ||
        roundCombatUnknown.has(id)
      ) {
        participant.kastAvailable = false;
        addUnavailable(participant, "incomplete_kast_context");
      }
    }
  }

  const resultPlayers: BasePlayerAnalysis[] = [...players.values()]
    .sort((left, right) => left.playerId.localeCompare(right.playerId))
    .map((player) => {
      const kills = player.combatAvailable ? player.kills : null;
      const assists = player.combatAvailable ? player.assists : null;
      const headshotKills = player.combatAvailable ? player.headshotKills : null;
      const damageHealth = player.damageAvailable ? player.damageHealth : null;
      const openingAttempts = player.openingAvailable ? player.openingAttempts : null;
      const survivedRounds = player.survivalAvailable ? player.survivedRounds : null;
      return {
        playerId: player.playerId,
        name: player.name,
        metrics: {
          roundsPlayed: player.roundsPlayed,
          kills,
          deaths: player.deaths,
          assists,
          kdRatio: kills === null || player.deaths === 0 ? null : kills / player.deaths,
          headshotKills,
          headshotRate: kills === null || headshotKills === null || kills === 0
            ? null
            : headshotKills / kills,
          damageHealth,
          adr: damageHealth === null || player.roundsPlayed === 0
            ? null
            : damageHealth / player.roundsPlayed,
          openingAttempts,
          openingWins: player.openingAvailable ? player.openingWins : null,
          openingLosses: player.openingAvailable ? player.openingLosses : null,
          multiKillRounds: player.combatAvailable ? player.multiKillRounds : null,
          survivedRounds,
          survivalRate: survivedRounds === null || player.roundsPlayed === 0
            ? null
            : survivedRounds / player.roundsPlayed,
          clutchOpportunities: player.clutchAvailable ? player.clutchOpportunities : null,
          clutchWins: player.clutchAvailable ? player.clutchWins : null,
          tradeAttempts: player.tradeAttemptsAvailable ? player.tradeAttempts : null,
          tradeKills: player.tradeAvailable ? player.tradeKills : null,
          tradeDeaths: player.tradeAvailable ? player.tradeDeaths : null,
          kastRounds: player.kastAvailable ? player.kastRounds : null,
          kastRate: player.kastAvailable && player.roundsPlayed > 0
            ? player.kastRounds / player.roundsPlayed
            : null,
          grenadesThrown: player.grenadesAvailable ? player.grenadesThrown : null,
          flashes: player.flashesAvailable
            ? flashMetrics(
              player.enemiesFlashed,
              player.teammatesFlashed,
              player.effectiveEnemiesFlashed,
              player.effectiveTeammatesFlashed,
              player.enemyBlindDuration,
              player.teammateBlindDuration,
              player.enemyBlindFlashCount,
              player.longestEnemyBlindDuration,
              player.flashesLeadingToKills,
            )
            : null,
          utilityDamage: player.damageAvailable
            ? utilityDamageMetrics(
              player.heDamage,
              player.fireDamage,
              player.teammateHeDamage,
              player.teammateFireDamage,
            )
            : null,
          flashAssists: player.combatAvailable ? player.flashAssists : null,
          utilitySavedOnDeath: player.utilitySavedAvailable
            ? player.utilitySavedOnDeath
            : null,
          unusedUtilityValue: player.utilitySavedAvailable
            ? player.unusedUtilityValue
            : null,
          averageUnusedUtilityValue:
            player.utilitySavedAvailable && player.deaths > 0
              ? player.unusedUtilityValue / player.deaths
              : null,
          utilityQuantityRating: utilityQuantityRating(
            player.grenadesAvailable ? player.grenadesThrown : null,
            player.roundsPlayed,
          ),
        },
        metricEvidence: player.metricEvidence,
        unavailableReasons: [...player.unavailableReasons].sort(),
      };
    });

  evidence.sort(compareEvidence);

  return {
    specVersion: MATCH_ANALYSIS_SPEC_VERSION,
    inputSchemaVersion: match.schemaVersion ?? "roundlab.replay.legacy",
    parserVersion: match.parserVersion ?? "unknown",
    matchId: context.matchId,
    generatedAt: context.generatedAt,
    players: resultPlayers,
    economyRounds,
    // Kept empty for schema compatibility: RoundLab no longer classifies
    // replay events into automatically selected "key moments".
    keyMoments: [],
    evidence,
  };
}

export function analyzeMatch(match: MatchData, context: AnalyzeMatchContext): MatchAnalysis {
  const base = analyzeMatchBase(match, context);
  const evidenceIds = new Set(base.evidence.map((proof) => proof.evidenceId));
  const playerEconomyById = playerEconomyAnalyses(match, (proof) => {
    if (evidenceIds.has(proof.evidenceId)) return;
    evidenceIds.add(proof.evidenceId);
    base.evidence.push(proof);
  });
  type EconomyBucket = { analyses: BasePlayerAnalysis[]; evidence: string[] };
  type LogicalTeamBucket = {
    analyses: BasePlayerAnalysis[];
    playerIds: Set<string>;
    roundNumbers: Set<number>;
    roundsWon: number;
    unavailableReasons: Set<string>;
  };
  type PlayerBuckets = {
    T: BasePlayerAnalysis[];
    CT: BasePlayerAnalysis[];
    eco: EconomyBucket;
    forceBuy: EconomyBucket;
    fullBuy: EconomyBucket;
    unavailableRounds: number;
  };
  const emptyBuckets = (): PlayerBuckets => ({
    T: [],
    CT: [],
    eco: { analyses: [], evidence: [] },
    forceBuy: { analyses: [], evidence: [] },
    fullBuy: { analyses: [], evidence: [] },
    unavailableRounds: 0,
  });
  const buckets = new Map<string, PlayerBuckets>();
  for (const player of base.players) buckets.set(player.playerId, emptyBuckets());
  const rounds: RoundAnalysis[] = [];
  const logicalTeamBuckets: Record<LogicalTeamId, LogicalTeamBucket> = {
    A: {
      analyses: [],
      playerIds: new Set(),
      roundNumbers: new Set(),
      roundsWon: 0,
      unavailableReasons: new Set(),
    },
    B: {
      analyses: [],
      playerIds: new Set(),
      roundNumbers: new Set(),
      roundsWon: 0,
      unavailableReasons: new Set(),
    },
  };
  const knownLogicalTeamByPlayer = new Map<string, LogicalTeamId>();
  let previousScoreA: number | null = null;
  let previousScoreB: number | null = null;

  for (const [roundIndex, round] of match.rounds.entries()) {
    const participants = new Set(
      round.frames.flatMap((frame) => frame.players.map((player) => playerId(player.id))),
    );
    const participantSides = participantTeams(round, participants);
    const scoreA = round.scoreA ?? null;
    const scoreB = round.scoreB ?? null;
    if (
      roundIndex === 0 &&
      (round.number === 0 || round.number === 1) &&
      previousScoreA === null &&
      previousScoreB === null
    ) {
      previousScoreA = 0;
      previousScoreB = 0;
    }
    let scoreWinner: LogicalTeamId | null = null;
    if (
      scoreA !== null &&
      scoreB !== null &&
      previousScoreA !== null &&
      previousScoreB !== null
    ) {
      const deltaA = scoreA - previousScoreA;
      const deltaB = scoreB - previousScoreB;
      if (deltaA === 1 && deltaB === 0) scoreWinner = "A";
      if (deltaA === 0 && deltaB === 1) scoreWinner = "B";
    }
    if (scoreA !== null && scoreB !== null) {
      previousScoreA = scoreA;
      previousScoreB = scoreB;
    } else {
      previousScoreA = null;
      previousScoreB = null;
    }

    const winnerSide = roundWinnerTeam(round);
    const sideToLogicalTeam = new Map<number, LogicalTeamId>();
    if (scoreWinner !== null && winnerSide !== null) {
      sideToLogicalTeam.set(winnerSide, scoreWinner);
      sideToLogicalTeam.set(winnerSide === 2 ? 3 : 2, oppositeLogicalTeam(scoreWinner));
    }
    for (const side of [2, 3]) {
      if (sideToLogicalTeam.has(side)) continue;
      const knownTeams = new Set(
        [...participants]
          .filter((id) => participantSides.get(id) === side)
          .map((id) => knownLogicalTeamByPlayer.get(id))
          .filter((team): team is LogicalTeamId => team !== undefined),
      );
      if (knownTeams.size === 1) {
        sideToLogicalTeam.set(side, [...knownTeams][0]);
      }
    }
    if (sideToLogicalTeam.size === 1) {
      const [knownSide, knownTeam] = [...sideToLogicalTeam.entries()][0];
      sideToLogicalTeam.set(knownSide === 2 ? 3 : 2, oppositeLogicalTeam(knownTeam));
    }
    const conflictingIdentity = [...participants].some((id) => {
      const knownTeam = knownLogicalTeamByPlayer.get(id);
      const side = participantSides.get(id);
      const mappedTeam = side === undefined ? undefined : sideToLogicalTeam.get(side);
      return knownTeam !== undefined && mappedTeam !== undefined && knownTeam !== mappedTeam;
    });
    if (conflictingIdentity) sideToLogicalTeam.clear();
    const completeLogicalContext = [...participants].every((id) => {
      const side = participantSides.get(id);
      return side !== undefined && sideToLogicalTeam.has(side);
    });
    if (completeLogicalContext) {
      for (const id of participants) {
        const side = participantSides.get(id);
        const logicalTeam = side === undefined ? undefined : sideToLogicalTeam.get(side);
        if (logicalTeam !== undefined) knownLogicalTeamByPlayer.set(id, logicalTeam);
      }
    } else {
      logicalTeamBuckets.A.unavailableReasons.add("missing_logical_team_context");
      logicalTeamBuckets.B.unavailableReasons.add("missing_logical_team_context");
    }
    const logicalWinner = scoreWinner ??
      (winnerSide === null ? null : sideToLogicalTeam.get(winnerSide) ?? null);
    if (logicalWinner === null) {
      logicalTeamBuckets.A.unavailableReasons.add("missing_logical_round_winner");
      logicalTeamBuckets.B.unavailableReasons.add("missing_logical_round_winner");
    } else {
      logicalTeamBuckets[logicalWinner].roundsWon++;
    }

    const roundAnalysis = analyzeMatchBase({ ...match, rounds: [round] }, context);
    const roundPlayers = [...participants]
      .map((id) => {
        const analysis = roundAnalysis.players.find((player) => player.playerId === id);
        if (!analysis) return null;
        const participantSide = participantSides.get(id);
        const side: "T" | "CT" | null = participantSide === 2
          ? "T"
          : participantSide === 3
          ? "CT"
          : null;
        const logicalTeam = participantSide === undefined
          ? null
          : sideToLogicalTeam.get(participantSide) ?? null;
        const economyCategory = side === null
          ? null
          : roundAnalysis.economyRounds.find((item) => item.side === side)?.category ?? null;
        if (logicalTeam !== null) {
          const logicalBucket = logicalTeamBuckets[logicalTeam];
          logicalBucket.analyses.push(analysis);
          logicalBucket.playerIds.add(id);
          logicalBucket.roundNumbers.add(round.number);
        }
        return {
          ...analysis,
          side,
          logicalTeam,
          economyCategory,
        };
      })
      .filter((player): player is NonNullable<typeof player> => player !== null)
      .sort((left, right) => left.playerId.localeCompare(right.playerId));
    rounds.push({
      roundNumber: round.number,
      winner: round.winner,
      logicalWinner,
      scoreA,
      scoreB,
      players: roundPlayers,
      economy: roundAnalysis.economyRounds,
      keyMoments: [],
      evidenceIds: roundAnalysis.evidence.map((proof) => proof.evidenceId),
    });
    for (const id of participants) {
      const side = participantSides.get(id) === 2
        ? "T"
        : participantSides.get(id) === 3
        ? "CT"
        : null;
      if (side === null) continue;
      const analysis = roundAnalysis.players.find((player) => player.playerId === id);
      const playerBuckets = buckets.get(id);
      if (!analysis || !playerBuckets) continue;
      playerBuckets[side].push(analysis);
      const economy = roundAnalysis.economyRounds.find((item) => item.side === side);
      if (!economy || economy.category === null || economy.evidenceId === null) {
        playerBuckets.unavailableRounds++;
        continue;
      }
      const category = economy.category === "force_buy"
        ? "forceBuy"
        : economy.category === "full_buy"
        ? "fullBuy"
        : "eco";
      playerBuckets[category].analyses.push(analysis);
      playerBuckets[category].evidence.push(economy.evidenceId);
    }
  }

  const players: PlayerAnalysis[] = base.players.map((player) => {
    const playerBuckets = buckets.get(player.playerId) ?? emptyBuckets();
    return {
      ...player,
      economy: playerEconomyById.get(player.playerId),
      utility: playerUtilityQuality(player),
      bySide: {
        T: aggregateSide(playerBuckets.T),
        CT: aggregateSide(playerBuckets.CT),
      },
      byEconomy: {
        eco: aggregateEconomy(playerBuckets.eco.analyses, playerBuckets.eco.evidence),
        forceBuy: aggregateEconomy(
          playerBuckets.forceBuy.analyses,
          playerBuckets.forceBuy.evidence,
        ),
        fullBuy: aggregateEconomy(playerBuckets.fullBuy.analyses, playerBuckets.fullBuy.evidence),
        unavailableRounds: playerBuckets.unavailableRounds,
      },
    };
  });

  const lastRoundWithScore = [...match.rounds].reverse().find(
    (round) => round.scoreA !== undefined && round.scoreB !== undefined,
  );
  const teams: LogicalTeamAnalysis[] = (["A", "B"] as const).map((logicalTeam) => {
    const bucket = logicalTeamBuckets[logicalTeam];
    const score = logicalTeam === "A"
      ? lastRoundWithScore?.scoreA ?? match.meta.scoreA ?? null
      : lastRoundWithScore?.scoreB ?? match.meta.scoreB ?? null;
    const name = logicalTeam === "A" ? match.meta.teamA : match.meta.teamB;
    const team = aggregateLogicalTeam(
      logicalTeam,
      name,
      score,
      bucket.analyses,
      bucket.playerIds,
      bucket.roundNumbers,
      bucket.roundsWon,
      bucket.unavailableReasons,
    );
    return {
      ...team,
      combat: logicalTeamAdvantageAnalysis(match, rounds, logicalTeam),
      economy: logicalTeamEconomyAnalysis(rounds, logicalTeam),
    };
  });

  return { ...base, players, teams, rounds };
}
