import { readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { analyzeMechanics } from "../src/lib/analysis/analyze-mechanics.ts";
import { summarizePlayerMechanics } from "../src/lib/analysis/summarize-player-mechanics.ts";
import type { MatchData, Round } from "../src/lib/types.ts";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required ${name}.`);
  }
  return value;
}

async function readJson(path: string): Promise<unknown> {
  const bytes = await readFile(path);
  const decoded = extname(path) === ".gz" ? gunzipSync(bytes) : bytes;
  return JSON.parse(decoded.toString("utf8")) as unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMatchData(value: unknown): value is MatchData {
  return isRecord(value)
    && isRecord(value.meta)
    && Array.isArray(value.players)
    && Array.isArray(value.rounds);
}

function isRound(value: unknown): value is Round {
  return isRecord(value)
    && typeof value.number === "number"
    && Array.isArray(value.frames)
    && Array.isArray(value.events);
}

async function hydrateSplitRounds(
  inputPath: string,
  match: MatchData,
): Promise<MatchData> {
  const rounds = await Promise.all(match.rounds.map(async (round) => {
    const splitRound = round as Round & { roundFile?: string };
    if (round.frames.length > 0 || splitRound.roundFile === undefined) {
      return round;
    }
    const payload = await readJson(
      resolve(dirname(inputPath), splitRound.roundFile),
    );
    if (!isRound(payload)) {
      throw new Error(`Invalid split round payload: ${splitRound.roundFile}`);
    }
    return payload;
  }));
  return { ...match, rounds };
}

function assertFiniteJson(value: unknown, path = "$"): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Non-finite number at ${path}.`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteJson(item, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      assertFiniteJson(item, `${path}.${key}`);
    }
  }
}

async function main(): Promise<void> {
  const inputPath = resolve(argument("--input"));
  const payload = await readJson(inputPath);
  if (!isMatchData(payload)) {
    throw new Error("Input must be a RoundLab match or split manifest.");
  }
  const match = await hydrateSplitRounds(inputPath, payload);
  const mechanics = analyzeMechanics(match, {
    matchId: inputPath,
    generatedAt: new Date(0).toISOString(),
  });
  const shots = mechanics.rounds.flatMap((round) => round.shots);
  const statuses = {
    reliable_hit: shots.filter(
      (shot) => shot.associationStatus === "reliable_hit",
    ).length,
    reliable_miss: shots.filter(
      (shot) => shot.associationStatus === "reliable_miss",
    ).length,
    ambiguous: shots.filter(
      (shot) => shot.associationStatus === "ambiguous",
    ).length,
    incomplete: shots.filter(
      (shot) => shot.associationStatus === "incomplete",
    ).length,
  };
  const reliable = statuses.reliable_hit + statuses.reliable_miss;
  const playerMetrics = match.players.map((player) => {
    const playerId = String(player.steamId);
    const hasRecordedKill = match.rounds.some((round) =>
      round.events.some((event) =>
        event.type === "kill" && String(event.killer) === playerId
      )
    );
    return {
      playerId,
      metrics: summarizePlayerMechanics(
        mechanics,
        playerId,
        hasRecordedKill,
      ).metrics,
    };
  });
  const report = {
    inputPath,
    map: match.meta.map,
    parserVersion: match.parserVersion ?? null,
    mechanicsFormulaVersion: mechanics.specVersion,
    importQuality: match.importQuality ?? "legacy",
    capabilities: match.capabilities ?? [],
    roundCount: match.rounds.length,
    playerCount: match.players.length,
    shots: {
      total: shots.length,
      ...statuses,
      reliableCoverage: shots.length === 0 ? null : reliable / shots.length,
    },
    unmatched: {
      impacts: mechanics.rounds.reduce(
        (total, round) => total + round.unmatchedImpacts.length,
        0,
      ),
      damages: mechanics.rounds.reduce(
        (total, round) => total + round.unmatchedDamages.length,
        0,
      ),
      kills: mechanics.rounds.reduce(
        (total, round) => total + (round.unmatchedKills?.length ?? 0),
        0,
      ),
    },
    dataQuality: mechanics.dataQuality,
    playerMetrics,
  };
  assertFiniteJson(report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
