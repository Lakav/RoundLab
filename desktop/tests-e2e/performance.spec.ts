import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

type RunMetrics = {
  demo: string;
  compressedBytes: number;
  repetition: number;
  decompressionMs: number;
  wasmLoadMs: number;
  parsingMs: number;
  storageMs: number;
  totalImportMs: number;
  roundOpenMs: number;
  rendererJsHeapPeakBytes: number | null;
  rendererJsHeapIsCompleteProcessMemory: false;
  browserProcessRssPeakBytes: number | null;
  browserProcessRssIncludesChromiumDescendants: true;
  frameIntervalMedianMs: number;
  frameIntervalMinMs: number;
  frameIntervalMaxMs: number;
  frameIntervalP95Ms: number;
};

type WorkerBenchmarkEvent = {
  type: string;
  phase?: string;
  progress?: number;
  time: number;
};

const configuredDemos = (process.env.ROUNDLAB_BENCHMARK_DEMOS ?? "")
  .split(path.delimiter)
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => path.resolve(entry));
const repetitions = Math.max(1, Number(process.env.ROUNDLAB_BENCHMARK_REPETITIONS ?? "3"));
const outputDirectory = path.resolve("./benchmark-results");
const outputStem = process.env.ROUNDLAB_BENCHMARK_OUTPUT_STEM ?? "browser-benchmark-raw";
const execFileAsync = promisify(execFile);

if (!/^[a-z0-9-]+$/.test(outputStem)) {
  throw new Error("ROUNDLAB_BENCHMARK_OUTPUT_STEM must contain only lowercase letters, digits and hyphens");
}

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] ?? 0;
}

async function deleteBenchmarkDatabase(page: Page): Promise<void> {
  await page.goto("./");
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("roundlab-web");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("roundlab-web database deletion was blocked"));
  }));
}

async function chromiumProcessTreeRssBytes(): Promise<number> {
  const { stdout } = await execFileAsync("/bin/ps", ["-axo", "pid=,ppid=,rss=,command="]);
  const rows = stdout.split("\n").flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) return [];
    return [{ pid: Number(match[1]), ppid: Number(match[2]), rssKb: Number(match[3]), command: match[4] }];
  });
  const included = new Set(rows
    .filter((row) => row.command.includes("playwright_chromiumdev_profile"))
    .map((row) => row.pid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (included.has(row.pid) || !included.has(row.ppid)) continue;
      included.add(row.pid);
      changed = true;
    }
  }
  return rows
    .filter((row) => included.has(row.pid))
    .reduce((total, row) => total + row.rssKb * 1024, 0);
}

async function writeBenchmarkResults(runs: RunMetrics[]): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  const jsonPath = path.join(outputDirectory, `${outputStem}.json`);
  const csvPath = path.join(outputDirectory, `${outputStem}.csv`);
  await writeFile(jsonPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    repetitions,
    configuredDemos: configuredDemos.map((demo) => path.basename(demo)),
    completedRuns: runs.length,
    runs,
  }, null, 2)}\n`);
  if (runs.length === 0) return;
  const columns = Object.keys(runs[0]) as Array<keyof RunMetrics>;
  const csv = [columns.join(","), ...runs.map((run) => columns.map((column) => String(run[column])).join(","))].join("\n");
  await writeFile(csvPath, `${csv}\n`);
}

test.describe("reproducible local browser performance", () => {
  test.describe.configure({ retries: 0 });
  test.skip(configuredDemos.length === 0, "Set ROUNDLAB_BENCHMARK_DEMOS to real local demo paths.");
  test.setTimeout(30 * 60_000);

  test("measures real demo import and replay rendering", async ({ page }) => {
    const runs: RunMetrics[] = [];
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      const events: WorkerBenchmarkEvent[] = [];
      Object.defineProperty(window, "__roundlabBenchmarkEvents", {
        configurable: true,
        value: events,
      });
      window.Worker = class BenchmarkWorker extends NativeWorker {
        constructor(scriptURL: string | URL, options?: WorkerOptions) {
          super(scriptURL, options);
          this.addEventListener("message", (event: MessageEvent) => {
            const data = event.data as {
              type?: string;
              payload?: { phase?: string; progress?: number };
            };
            events.push({
              type: data.type ?? "unknown",
              phase: data.payload?.phase,
              progress: data.payload?.progress,
              time: performance.now(),
            });
          });
        }
      };
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    await cdp.send("Network.enable");

    for (const demo of configuredDemos) {
      const file = await stat(demo);
      for (let repetition = 1; repetition <= repetitions; repetition++) {
        await deleteBenchmarkDatabase(page);
        await cdp.send("Network.clearBrowserCache");
        let heapPeak = 0;
        let browserRssPeak = 0;
        let sampling = true;
        const sampleMemory = async () => {
          while (sampling) {
            const response = await cdp.send("Performance.getMetrics").catch(() => null);
            const used = response?.metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value ?? 0;
            heapPeak = Math.max(heapPeak, used);
            const browserRss = await chromiumProcessTreeRssBytes().catch(() => 0);
            browserRssPeak = Math.max(browserRssPeak, browserRss);
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        };
        const memorySampler = sampleMemory();

        const startedAt = await page.evaluate(() => performance.now());
        await page.getByTestId("demo-file-input").setInputFiles(demo);
        const parseDialog = page.getByRole("dialog", { name: "Parsing demo" });
        await expect(parseDialog).toBeVisible();
        const parsedDialog = page.getByRole("dialog", { name: "Match parsed" });
        await expect(parsedDialog).toBeVisible({ timeout: 10 * 60_000 });
        const phaseEvents = await page.evaluate(() => (
          (window as Window & { __roundlabBenchmarkEvents?: WorkerBenchmarkEvent[] }).__roundlabBenchmarkEvents ?? []
        ));
        const progressTime = (progress: number) => {
          const value = phaseEvents.find((entry) => entry.type === "progress" && entry.progress === progress)?.time;
          if (value === undefined) throw new Error(`Missing benchmark progress event: ${progress}`);
          return value;
        };
        const decompressionStartedAt = progressTime(0.08);
        const decompressionEndedAt = progressTime(0.13);
        const wasmStartedAt = progressTime(0.16);
        const wasmEndedAt = progressTime(0.22);
        const parsingEndedAt = progressTime(0.86);
        const storageEndedAt = phaseEvents.find((entry) => entry.type === "done")?.time;
        if (storageEndedAt === undefined) throw new Error("Missing benchmark worker done event");
        sampling = false;
        await memorySampler;

        const openStartedAt = await page.evaluate(() => performance.now());
        await parsedDialog.getByRole("button", { name: "Save & open" }).click();
        await expect(page.getByRole("img", { name: "Interactive replay radar" })).toBeVisible({ timeout: 2 * 60_000 });
        await expect(page.getByTitle("Play/Pause (Space)")).toBeEnabled();
        const roundOpenEndedAt = await page.evaluate(() => performance.now());

        const intervals = await page.evaluate(async () => {
          const timestamps: number[] = [];
          await new Promise<void>((resolve) => {
            const tick = (time: number) => {
              timestamps.push(time);
              if (timestamps.length >= 121) resolve();
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          });
          return timestamps.slice(1).map((time, index) => time - timestamps[index]);
        });

        runs.push({
          demo: path.basename(demo),
          compressedBytes: file.size,
          repetition,
          decompressionMs: decompressionEndedAt - decompressionStartedAt,
          wasmLoadMs: wasmEndedAt - wasmStartedAt,
          parsingMs: parsingEndedAt - wasmEndedAt,
          storageMs: storageEndedAt - parsingEndedAt,
          totalImportMs: storageEndedAt - startedAt,
          roundOpenMs: roundOpenEndedAt - openStartedAt,
          rendererJsHeapPeakBytes: heapPeak || null,
          rendererJsHeapIsCompleteProcessMemory: false,
          browserProcessRssPeakBytes: browserRssPeak || null,
          browserProcessRssIncludesChromiumDescendants: true,
          frameIntervalMedianMs: percentile(intervals, 0.5),
          frameIntervalMinMs: Math.min(...intervals),
          frameIntervalMaxMs: Math.max(...intervals),
          frameIntervalP95Ms: percentile(intervals, 0.95),
        });
        await writeBenchmarkResults(runs);
      }
    }

    expect(runs).toHaveLength(configuredDemos.length * repetitions);
  });
});
