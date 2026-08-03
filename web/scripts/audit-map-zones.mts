import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  locateTacticalZone,
  validTacticalMapDefinition,
  type TacticalMapDefinition,
} from "../src/lib/analysis/tactical-zones.ts";

type ReplayPayload = {
  meta?: { map?: string };
  frames?: ReplayFrame[];
  rounds?: Array<{
    frames?: ReplayFrame[];
  }>;
};

type ReplayFrame = {
  players?: Array<{
    x?: number;
    y?: number;
    z?: number;
    hp?: number;
  }>;
};

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required ${name}.`);
  }
  return value;
}

async function main(): Promise<void> {
  const definitionPath = resolve(argument("--definition"));
  const parsedDirectory = resolve(argument("--parsed-dir"));
  const minimumCoverage = Number(
    process.argv.includes("--min-coverage")
      ? argument("--min-coverage")
      : "0",
  );
  if (
    !Number.isFinite(minimumCoverage) ||
    minimumCoverage < 0 ||
    minimumCoverage > 1
  ) {
    throw new Error("--min-coverage must be between 0 and 1.");
  }
  const definition = JSON.parse(
    await readFile(definitionPath, "utf8"),
  ) as TacticalMapDefinition;
  if (!validTacticalMapDefinition(definition)) {
    throw new Error("The tactical-zone definition is invalid.");
  }
  const files = (await readdir(parsedDirectory))
    .filter((file) => file.endsWith(".json.gz"))
    .sort();
  let matchCount = 0;
  let sourceFileCount = 0;
  let splitRoundFileCount = 0;
  let sampleCount = 0;
  let assignedSampleCount = 0;
  let outsideSampleCount = 0;
  let ambiguousSampleCount = 0;
  const zoneSamples: Record<string, number> = Object.fromEntries(
    definition.zones.map((zone) => [zone.zoneId, 0]),
  );
  const auditFrames = (frames: ReplayFrame[]): void => {
    for (const frame of frames) {
      for (const player of frame.players ?? []) {
        if (
          (player.hp ?? 0) <= 0 ||
          !Number.isFinite(player.x) ||
          !Number.isFinite(player.y) ||
          !Number.isFinite(player.z)
        ) {
          continue;
        }
        sampleCount++;
        const result = locateTacticalZone(definition, {
          x: player.x as number,
          y: player.y as number,
          z: player.z as number,
        });
        if (result.status === "assigned" && result.zoneId !== null) {
          assignedSampleCount++;
          zoneSamples[result.zoneId]++;
        } else if (result.status === "outside") {
          outsideSampleCount++;
        } else {
          ambiguousSampleCount++;
        }
      }
    }
  };
  for (const file of files) {
    const payload = JSON.parse(
      gunzipSync(await readFile(resolve(parsedDirectory, file))).toString(
        "utf8",
      ),
    ) as ReplayPayload;
    if (
      payload.meta?.map !== undefined &&
      payload.meta.map !== definition.map
    ) {
      continue;
    }
    sourceFileCount++;
    if (Array.isArray(payload.frames)) {
      splitRoundFileCount++;
      auditFrames(payload.frames);
      continue;
    }
    if (Array.isArray(payload.rounds)) {
      matchCount++;
      for (const round of payload.rounds) {
        auditFrames(round.frames ?? []);
      }
      const splitDirectory = resolve(
        parsedDirectory,
        file.replace(/\.json\.gz$/, ""),
      );
      const splitFiles = await readdir(splitDirectory).catch(() => []);
      for (const splitFile of splitFiles
        .filter((candidate) => candidate.endsWith(".json.gz"))
        .sort()) {
        const splitPayload = JSON.parse(
          gunzipSync(
            await readFile(resolve(splitDirectory, splitFile)),
          ).toString("utf8"),
        ) as ReplayPayload;
        if (!Array.isArray(splitPayload.frames)) continue;
        sourceFileCount++;
        splitRoundFileCount++;
        auditFrames(splitPayload.frames);
      }
    }
  }
  if (splitRoundFileCount > 0 && matchCount === 0) matchCount++;
  const coverage =
    sampleCount === 0 ? 0 : assignedSampleCount / sampleCount;
  const report = {
    map: definition.map,
    zonesVersion: definition.zonesVersion,
    matchCount,
    sourceFileCount,
    sampleCount,
    assignedSampleCount,
    outsideSampleCount,
    ambiguousSampleCount,
    coverage: Number(coverage.toFixed(6)),
    zoneSamples,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (coverage < minimumCoverage) {
    throw new Error(
      `Coverage ${coverage.toFixed(6)} is below ${minimumCoverage}.`,
    );
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
