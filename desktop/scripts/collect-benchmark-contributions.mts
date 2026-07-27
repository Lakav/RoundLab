import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildBenchmarkCorpusBundle } from "../src/lib/analysis/build-benchmark-corpus-bundle.ts";
import { parseBenchmarkContributionPackage } from "../src/lib/analysis/parse-benchmark-contribution.ts";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required ${name}.`);
  }
  return value;
}

function labels(name: string): string[] {
  const values = argument(name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) throw new Error(`${name} must not be empty.`);
  return [...new Set(values)].sort();
}

async function main(): Promise<void> {
  const inputDirectory = resolve(argument("--input-dir"));
  const outputPath = resolve(argument("--output"));
  const generatedAt = argument("--generated-at");
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("--generated-at must be a valid timestamp.");
  }
  const files = (await readdir(inputDirectory))
    .filter((file) => file.endsWith(".roundlab-benchmark.json"))
    .sort();
  if (files.length === 0) {
    throw new Error("No RoundLab benchmark contribution was found.");
  }
  const contributions = [];
  for (const file of files) {
    contributions.push(parseBenchmarkContributionPackage(
      JSON.parse(await readFile(resolve(inputDirectory, file), "utf8")) as unknown,
    ));
  }
  const manifest = {
    manifestVersion: "roundlab.benchmark-collection-manifest.v1" as const,
    corpusGeneratedAt: new Date(Date.parse(generatedAt)).toISOString(),
    policy: {
      maps: labels("--maps"),
      levels: labels("--levels"),
    },
    entries: contributions.map((contribution) => contribution.entry),
  };
  const analyses = new Map(
    contributions.map((contribution) => [
      contribution.entry.analysisPath,
      contribution.analysis,
    ]),
  );
  const bundle = buildBenchmarkCorpusBundle(manifest, analyses);
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    outputPath,
    contributionCount: contributions.length,
    matchCount: bundle.corpus.audit.matchCount,
    playerCount: bundle.corpus.audit.playerCount,
    sampleCount: bundle.corpus.audit.sampleCount,
    requiredStratumCount: bundle.readiness.requiredStratumCount,
    readyStratumCount: bundle.readiness.readyStratumCount,
    ready: bundle.readiness.ready,
    unavailableReasons: bundle.readiness.unavailableReasons,
  }, null, 2)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
