import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ init: vi.fn(), decode: vi.fn() }));

vi.mock("zstddec", () => ({
  ZSTDDecoder: class ZstdDecoderDouble {
    init = mocks.init;
    decode = mocks.decode;
  },
}));

type WorkerScope = {
  onmessage?: (event: MessageEvent) => void;
  postMessage: ReturnType<typeof vi.fn>;
};

async function loadWorker(): Promise<WorkerScope> {
  const scope: WorkerScope = { postMessage: vi.fn() };
  vi.stubGlobal("self", scope);
  await import("@/workers/zstd-decompress.worker");
  return scope;
}

describe("zstd decompression worker", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.init.mockResolvedValue(undefined);
  });

  it("transfers a non-empty decompressed buffer", async () => {
    mocks.decode.mockReturnValue(new Uint8Array([9, 8, 7]));
    const scope = await loadWorker();
    scope.onmessage?.({ data: { type: "decompress", buffer: new Uint8Array([1]).buffer } } as MessageEvent);
    await vi.waitFor(() => expect(scope.postMessage).toHaveBeenCalledOnce());
    expect(scope.postMessage.mock.calls[0][0]).toMatchObject({ type: "done", buffer: expect.any(ArrayBuffer) });
    expect(scope.postMessage.mock.calls[0][1]).toHaveLength(1);
  });

  it("turns decoder failures and empty output into error messages", async () => {
    mocks.decode.mockReturnValue(new Uint8Array());
    const emptyScope = await loadWorker();
    emptyScope.onmessage?.({ data: { type: "decompress", buffer: new Uint8Array([1]).buffer } } as MessageEvent);
    await vi.waitFor(() => expect(emptyScope.postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "The .zst file decompressed to an empty payload.",
    }));

    vi.resetModules();
    mocks.decode.mockImplementation(() => { throw new Error("corrupt zstd stream"); });
    const corruptScope = await loadWorker();
    corruptScope.onmessage?.({ data: { type: "decompress", buffer: new Uint8Array([2]).buffer } } as MessageEvent);
    await vi.waitFor(() => expect(corruptScope.postMessage).toHaveBeenCalledWith({
      type: "error",
      message: "corrupt zstd stream",
    }));
  });
});
