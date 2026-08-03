import type { RoundLabBackend, DemoSource, ParseOptions, ParseProgress, ProgressListener } from "@/lib/backends/types";
import {
  deleteStoredMatch,
  listStoredMatches,
  readStoredMetadata,
  readCompleteStoredMatch,
  readStoredRound,
  renameStoredMatch,
  saveStoredBenchmarkContribution,
  createLibraryBackup,
  restoreLibraryBackup,
} from "@/lib/backends/browser-store";
import { readStorageStatus, requestPersistentStorage } from "@/lib/storage-safety";

class BrowserProgressBus {
  private listeners = new Set<ProgressListener>();

  emit(progress: ParseProgress): void {
    for (const listener of this.listeners) listener(progress);
  }

  subscribe(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const progressBus = new BrowserProgressBus();
let activeWorker: Worker | null = null;
let activeReject: ((error: Error) => void) | null = null;
let activeParseRun = 0;

function isDemoFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return lower.endsWith(".dem") || lower.endsWith(".dem.zst") || lower.endsWith(".zst");
}

export function createBrowserBackend(): RoundLabBackend {
  return {
    parser: {
      async parseDemo(source: DemoSource, options: ParseOptions = { mode: "fast" }): Promise<string> {
        activeWorker?.terminate();
        activeReject?.(new Error("Browser parse cancelled."));
        activeWorker = null;
        activeReject = null;
        const runId = activeParseRun + 1;
        activeParseRun = runId;
        if (!isDemoFile(source.file)) {
          throw new Error("Choose a .dem or .dem.zst file.");
        }
        progressBus.emit({
          phase: "starting",
          progress: 0.02,
          message: "Starting browser parser worker...",
        });
        if (source.file.size > 1024 * 1024 * 1024) {
          throw new Error("Demo file is larger than the 1 GB browser parser limit.");
        }
        const worker = new Worker(new URL("../../workers/web-parser.worker.ts", import.meta.url), {
          type: "module",
        });
        activeWorker = worker;
        try {
          const buffer = await source.file.arrayBuffer();
          if (activeParseRun !== runId || activeWorker !== worker) {
            throw new Error("Browser parse cancelled.");
          }
          return await new Promise<string>((resolve, reject) => {
            activeReject = reject;
            worker.onmessage = (event: MessageEvent) => {
              if (activeParseRun !== runId || activeWorker !== worker) return;
              const data = event.data as
                | { type: "progress"; payload: ParseProgress }
                | { type: "done"; id: string }
                | { type: "error"; message: string };
              if (data.type === "progress") progressBus.emit(data.payload);
              else if (data.type === "done") resolve(data.id);
              else if (data.type === "error") reject(new Error(data.message));
            };
            worker.onerror = (event) => {
              if (activeParseRun !== runId || activeWorker !== worker) return;
              reject(new Error(event.message));
            };
            worker.postMessage(
              {
                type: "parse",
                name: source.file.name,
                size: source.file.size,
                buffer,
                mode: options.mode,
              },
              [buffer],
            );
          });
        } finally {
          if (activeParseRun === runId) {
            activeWorker = null;
            activeReject = null;
          }
          worker.terminate();
        }
      },
      async cancelParse(): Promise<void> {
        activeParseRun += 1;
        activeWorker?.terminate();
        activeReject?.(new Error("Browser parse cancelled."));
        activeWorker = null;
        activeReject = null;
        progressBus.emit({ phase: "cancelled", progress: 0, message: "Cancelled." });
      },
      async onProgress(listener: ProgressListener): Promise<() => void> {
        return progressBus.subscribe(listener);
      },
    },
    matches: {
      listMatches: listStoredMatches,
      getMatchMetadata: readStoredMetadata,
      getCompleteMatch: readCompleteStoredMatch,
      getRound: readStoredRound,
      deleteMatch: deleteStoredMatch,
      renameMatch: renameStoredMatch,
      saveBenchmarkContribution: saveStoredBenchmarkContribution,
    },
    storage: {
      getStatus: readStorageStatus,
      requestPersistence: requestPersistentStorage,
      exportLibrary: createLibraryBackup,
      restoreLibrary: restoreLibraryBackup,
    },
    diagnostics: {
      async getDebugInfo() {
        return { runtime: "browser", storage: "indexeddb" };
      },
      async writeDebugLog(source: string, message: string) {
        console.log(`[${source}] ${message}`);
      },
    },
    shell: {
      async enterMatchFullscreen() {
        if (typeof document === "undefined") return;
        if (document.fullscreenElement) return;
        await document.documentElement.requestFullscreen?.();
      },
      async exitMatchFullscreen() {
        if (typeof document === "undefined") return;
        if (!document.fullscreenElement) return;
        await document.exitFullscreen?.();
      },
    },
  };
}
