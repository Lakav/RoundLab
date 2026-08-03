import { beforeEach, describe, expect, it, vi } from "vitest";
import { replayMatch } from "./fixtures";

const mocks = vi.hoisted(() => ({
  initParser: vi.fn(),
  parse: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/wasm/roundlab_parser/roundlab_parser.js", () => ({
  default: mocks.initParser,
  parse_demo_bytes_to_json: mocks.parse,
}));
vi.mock("@/lib/backends/browser-store", () => ({ saveParsedMatch: mocks.save }));

type WorkerScope = {
  onmessage?: (event: MessageEvent) => void;
  postMessage: ReturnType<typeof vi.fn>;
};

async function loadWorker(): Promise<WorkerScope> {
  const scope: WorkerScope = { postMessage: vi.fn() };
  vi.stubGlobal("self", scope);
  await import("@/workers/web-parser.worker");
  return scope;
}

describe("web parser worker", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.initParser.mockResolvedValue(undefined);
    mocks.parse.mockReturnValue(JSON.stringify(replayMatch()));
    mocks.save.mockResolvedValue(undefined);
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "worker-match-id") });
  });

  it("loads WASM, validates the replay and stores it before reporting done", async () => {
    const scope = await loadWorker();
    scope.onmessage?.({ data: {
      type: "parse",
      name: "licensed.dem",
      size: 4,
      buffer: new Uint8Array([1, 2, 3, 4]).buffer,
      mode: "fast",
    } } as MessageEvent);

    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith({ type: "done", id: "worker-match-id" }));
    expect(mocks.initParser).toHaveBeenCalledOnce();
    expect(mocks.parse).toHaveBeenCalledWith(expect.any(Uint8Array), expect.any(String), false, false);
    expect(mocks.save).toHaveBeenCalledWith("worker-match-id", "licensed", 4, expect.objectContaining({ rounds: expect.any(Array) }));
    expect(scope.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "progress",
      payload: expect.objectContaining({ phase: "storing", progress: 0.86 }),
    }));
  });

  it("reports WASM failures as worker errors", async () => {
    mocks.parse.mockImplementation(() => { throw new Error("WASM parser exploded"); });
    const scope = await loadWorker();
    scope.onmessage?.({ data: {
      type: "parse",
      name: "broken.dem",
      size: 1,
      buffer: new Uint8Array([1]).buffer,
    } } as MessageEvent);

    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith({ type: "error", message: "WASM parser exploded" }));
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("rejects parser output without playable frames before IndexedDB", async () => {
    const invalid = replayMatch();
    invalid.rounds[0].frames = [];
    mocks.parse.mockReturnValue(JSON.stringify(invalid));
    const scope = await loadWorker();
    scope.onmessage?.({ data: {
      type: "parse",
      name: "empty.dem",
      size: 1,
      buffer: new Uint8Array([1]).buffer,
    } } as MessageEvent);

    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "Round 1 has no frame data.",
    }));
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("decompresses zstd in a short-lived worker before loading the parser", async () => {
    vi.stubGlobal("URL", class URLDouble {
      href: string;
      constructor(value: string) { this.href = value; }
      toString() { return this.href; }
    });
    class DecompressionWorkerDouble {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      terminate = vi.fn();
      postMessage = vi.fn(() => {
        queueMicrotask(() => this.onmessage?.({
          data: { type: "done", buffer: new Uint8Array([1, 2, 3]).buffer },
        } as MessageEvent));
      });
    }
    vi.stubGlobal("Worker", DecompressionWorkerDouble);
    const scope = await loadWorker();
    scope.onmessage?.({ data: {
      type: "parse",
      name: "licensed.dem.zst",
      size: 4,
      buffer: new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]).buffer,
    } } as MessageEvent);

    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledWith({ type: "done", id: "worker-match-id" }));
    expect(mocks.parse).toHaveBeenCalledWith(expect.objectContaining({ byteLength: 3 }), expect.any(String), false, false);
  });
});
