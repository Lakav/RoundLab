import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { analyzeMatch } from "../src/lib/analysis/analyze-match.ts";
import type { MatchData, Round } from "../src/lib/types.ts";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required ${name}.`);
  }
  return value;
}

function timestamp(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a valid timestamp.`);
  }
  return new Date(parsed).toISOString();
}

function validMatchData(value: unknown): value is MatchData {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const source = value as Record<string, unknown>;
  return typeof source.meta === "object"
    && source.meta !== null
    && Array.isArray(source.players)
    && Array.isArray(source.rounds);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(path: string): Promise<unknown> {
  const bytes = await readFile(path);
  const decoded = extname(path) === ".gz" ? gunzipSync(bytes) : bytes;
  return JSON.parse(decoded.toString("utf8")) as unknown;
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
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.frames) ||
      !Array.isArray(payload.events)
    ) {
      throw new Error(`Invalid split round payload: ${splitRound.roundFile}`);
    }
    return payload as Round;
  }));
  return { ...match, rounds };
}

function assertFiniteJson(value: unknown, path = "$"): void {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`Non-finite number at ${path}.`);
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertFiniteJson(item, `${path}[${index}]`));
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) =>
      assertFiniteJson(item, `${path}.${key}`)
    );
  }
}

async function main(): Promise<void> {
  const inputPath = resolve(argument("--input"));
  const outputPath = resolve(argument("--output"));
  const matchId = argument("--match-id").trim();
  if (matchId.length === 0) throw new Error("--match-id must not be empty.");
  const generatedAt = timestamp(argument("--generated-at"), "--generated-at");
  const payload = await readJson(inputPath);
  if (!validMatchData(payload)) {
    throw new Error("Input must be a parsed RoundLab match or split manifest.");
  }
  const match = await hydrateSplitRounds(inputPath, payload);
  const analysis = analyzeMatch(match, { matchId, generatedAt });
  assertFiniteJson(analysis);
  await writeFile(outputPath, `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    outputPath,
    matchId: analysis.matchId,
    metricsSpecVersion: analysis.specVersion,
    inputSchemaVersion: analysis.inputSchemaVersion,
    parserVersion: analysis.parserVersion,
    playerCount: analysis.players.length,
    roundCount: analysis.rounds.length,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
