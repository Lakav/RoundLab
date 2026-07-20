import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserBackend } from "@/lib/backends/browser";

class WorkerDouble {
  static instances: WorkerDouble[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  constructor() {
    WorkerDouble.instances.push(this);
  }
}

function source(name = "demo.dem", size = 12) {
  return {
    kind: "file" as const,
    file: {
      name,
      size,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(size)),
    } as unknown as File,
  };
}

async function latestWorker(): Promise<WorkerDouble> {
  await Promise.resolve();
  await Promise.resolve();
  const worker = WorkerDouble.instances.at(-1);
  if (!worker) throw new Error("worker was not created");
  return worker;
}

describe("browser-only backend", () => {
  const backend = createBrowserBackend();

  beforeEach(() => {
    WorkerDouble.instances = [];
    vi.stubGlobal("Worker", WorkerDouble);
  });

  afterEach(async () => {
    await backend.parser.cancelParse();
    vi.unstubAllGlobals();
  });

  it("transfers demo bytes to a module worker and resolves only its stored id", async () => {
    const parse = backend.parser.parseDemo(source());
    const worker = await latestWorker();
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "parse", name: "demo.dem", size: 12 }),
      [expect.any(ArrayBuffer)],
    );
    worker.onmessage?.({ data: { type: "done", id: "stored-id" } } as MessageEvent);
    await expect(parse).resolves.toBe("stored-id");
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects unsupported and oversized files before reading bytes", async () => {
    const wrong = source("notes.txt");
    await expect(backend.parser.parseDemo(wrong)).rejects.toThrow("Choose a .dem or .dem.zst file");
    expect(wrong.file.arrayBuffer).not.toHaveBeenCalled();

    const huge = source("huge.dem", 1024 * 1024 * 1024 + 1);
    await expect(backend.parser.parseDemo(huge)).rejects.toThrow("larger than the 1 GB");
    expect(huge.file.arrayBuffer).not.toHaveBeenCalled();
  });

  it("forwards progress and user-safe worker errors", async () => {
    const listener = vi.fn();
    const unsubscribe = await backend.parser.onProgress(listener);
    const parse = backend.parser.parseDemo(source("demo.dem.zst"));
    const worker = await latestWorker();
    worker.onmessage?.({
      data: { type: "progress", payload: { phase: "parsing", progress: 0.5, message: "Local" } },
    } as MessageEvent);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ progress: 0.5 }));
    worker.onmessage?.({ data: { type: "error", message: "invalid demo" } } as MessageEvent);
    await expect(parse).rejects.toThrow("invalid demo");
    unsubscribe();
  });

  it("turns native worker failures into parse errors", async () => {
    const parse = backend.parser.parseDemo(source("demo.zst"));
    const worker = await latestWorker();
    worker.onerror?.({ message: "worker crashed" } as ErrorEvent);
    await expect(parse).rejects.toThrow("worker crashed");
  });

  it("cancels an active parse and terminates its worker", async () => {
    const listener = vi.fn();
    await backend.parser.onProgress(listener);
    const parse = backend.parser.parseDemo(source());
    const worker = await latestWorker();
    await backend.parser.cancelParse();
    await expect(parse).rejects.toThrow("Browser parse cancelled");
    expect(worker.terminate).toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ phase: "cancelled" }));
  });

  it("reports local diagnostics and guards fullscreen transitions", async () => {
    expect(await backend.diagnostics.getDebugInfo()).toEqual({ runtime: "browser", storage: "indexeddb" });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await backend.diagnostics.writeDebugLog("test", "message");
    expect(log).toHaveBeenCalledWith("[test] message");

    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: requestFullscreen });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
    await backend.shell.enterMatchFullscreen();
    expect(requestFullscreen).toHaveBeenCalledOnce();

    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: document.documentElement });
    await backend.shell.exitMatchFullscreen();
    expect(exitFullscreen).toHaveBeenCalledOnce();
  });
});
