import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { analyzeMatch } from "../src/lib/analysis/analyze-match.ts";
import type { MatchData } from "../src/lib/types.ts";

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

async function main(): Promise<void> {
  const inputPath = resolve(argument("--input"));
  const outputPath = resolve(argument("--output"));
  const matchId = argument("--match-id").trim();
  if (matchId.length === 0) throw new Error("--match-id must not be empty.");
  const generatedAt = timestamp(argument("--generated-at"), "--generated-at");
  const bytes = await readFile(inputPath);
  const decoded = extname(inputPath) === ".gz" ? gunzipSync(bytes) : bytes;
  const payload = JSON.parse(decoded.toString("utf8")) as unknown;
  if (!validMatchData(payload)) {
    throw new Error("Input must be a complete parsed RoundLab match.");
  }
  const analysis = analyzeMatch(payload, { matchId, generatedAt });
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
