import { readFile, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  buildBenchmarkCorpusBundle,
  parseBenchmarkCollectionManifest,
  validMatchAnalysisPayload,
} from "../src/lib/analysis/build-benchmark-corpus-bundle.ts";
import type { MatchAnalysis } from "../src/lib/analysis/types.ts";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`Missing required ${name}.`);
  }
  return value;
}

async function json(path: string): Promise<unknown> {
  const bytes = await readFile(path);
  const decoded = extname(path) === ".gz" ? gunzipSync(bytes) : bytes;
  return JSON.parse(decoded.toString("utf8")) as unknown;
}

async function main(): Promise<void> {
  const manifestPath = resolve(argument("--manifest"));
  const outputPath = resolve(argument("--output"));
  const manifestDirectory = dirname(manifestPath);
  const manifest = parseBenchmarkCollectionManifest(
    await json(manifestPath),
  );
  const analyses = new Map<string, MatchAnalysis>();
  for (const entry of manifest.entries) {
    const analysisPath = resolve(manifestDirectory, entry.analysisPath);
    const location = relative(manifestDirectory, analysisPath);
    if (location.startsWith("..") || location === "") {
      throw new Error(
        `Analysis path escapes or equals the manifest directory: ${entry.analysisPath}`,
      );
    }
    const payload = await json(analysisPath);
    if (!validMatchAnalysisPayload(payload)) {
      throw new Error(`Invalid analysis payload: ${entry.analysisPath}`);
    }
    analyses.set(entry.analysisPath, payload);
  }
  const bundle = buildBenchmarkCorpusBundle(manifest, analyses);
  await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({
    outputPath,
    matchCount: bundle.corpus.audit.matchCount,
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
