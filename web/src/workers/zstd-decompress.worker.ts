import { ZSTDDecoder } from "zstddec";

type DecompressRequest = { type: "decompress"; buffer: ArrayBuffer };

self.onmessage = (event: MessageEvent<DecompressRequest>) => {
  if (event.data.type !== "decompress") return;
  void (async () => {
    const decoder = new ZSTDDecoder();
    await decoder.init();
    const output = decoder.decode(new Uint8Array(event.data.buffer));
    if (!output.byteLength) throw new Error("The .zst file decompressed to an empty payload.");
    const buffer = output.buffer instanceof ArrayBuffer ? output.buffer : output.slice().buffer;
    const workerScope = self as unknown as {
      postMessage(message: unknown, transfer: Transferable[]): void;
    };
    workerScope.postMessage({ type: "done", buffer }, [buffer]);
  })().catch((error) => {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  });
};
