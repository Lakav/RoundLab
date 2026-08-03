import initParser, { parse_demo_bytes_to_json } from "../wasm/roundlab_parser/roundlab_parser.js";
import { saveParsedMatch } from "@/lib/backends/browser-store";
import { browserParserMemoryError, browserParserStrategy } from "@/lib/parser-memory";
import type { BrowserParseMode } from "@/lib/parser-memory";
import type { MatchData } from "@/lib/types";
import { versionCurrentImport } from "@/lib/import-version";

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const;
const MAX_DEMO_SIZE = 1024 * 1024 * 1024;

type ParseRequest = {
  type: "parse";
  name: string;
  size: number;
  buffer: ArrayBuffer;
  mode?: BrowserParseMode;
};

function postProgress(progress: number, message: string, phase = "parsing", effectiveBytes?: number): void {
  self.postMessage({
    type: "progress",
    payload: { phase, progress, message, effectiveBytes },
  });
}

function isZstd(bytes: Uint8Array, name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith(".zst") ||
    (bytes.length >= 4 && ZSTD_MAGIC.every((value, index) => bytes[index] === value))
  );
}

function displayName(name: string): string {
  return name.replace(/\.dem\.zst$/i, "").replace(/\.dem$/i, "").replace(/\.zst$/i, "") || "CS2 demo";
}

function validatePlayableMatch(data: MatchData): void {
  if (!Array.isArray(data.rounds) || data.rounds.length === 0) {
    throw new Error("This demo parsed successfully, but no playable rounds were found.");
  }
  const seenRoundNumbers = new Set<number>();
  for (const round of data.rounds) {
    if (seenRoundNumbers.has(round.number)) {
      throw new Error(`Parser output has duplicate round number ${round.number}.`);
    }
    seenRoundNumbers.add(round.number);
    if (!Array.isArray(round.frames) || round.frames.length === 0) {
      throw new Error(`Round ${round.number} has no frame data.`);
    }
  }
}

async function decompressZstd(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const worker = new Worker(new URL("./zstd-decompress.worker.ts", import.meta.url), { type: "module" });
  try {
    return await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<{ type: "done"; buffer: ArrayBuffer } | { type: "error"; message: string }>) => {
        if (event.data.type === "done") resolve(new Uint8Array(event.data.buffer));
        else reject(new Error(event.data.message));
      };
      worker.onerror = (event) => reject(new Error(event.message || "Local zstd decompression failed."));
      const transferable = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer
        : bytes.slice().buffer;
      worker.postMessage({ type: "decompress", buffer: transferable }, [transferable]);
    });
  } finally {
    // zstddec grows its own WebAssembly heap to hold both compressed and
    // decompressed bytes. Terminating this short-lived worker releases that
    // heap before the much larger parser WebAssembly instance starts.
    worker.terminate();
  }
}

async function parseDemo(request: ParseRequest): Promise<string> {
  if (request.size > MAX_DEMO_SIZE) {
    throw new Error("Demo file is larger than the 1 GB browser parser limit.");
  }

  postProgress(0.04, "Preparing demo bytes...", "starting");
  let bytes = new Uint8Array(request.buffer);
  if (isZstd(bytes, request.name)) {
    postProgress(0.08, "Loading local zstd decoder...", "decompressing");
    bytes = await decompressZstd(bytes);
    if (bytes.byteLength > MAX_DEMO_SIZE) {
      throw new Error("Decompressed demo is larger than the 1 GB browser parser limit.");
    }
    const mb = Math.max(1, Math.round(bytes.byteLength / 1024 / 1024));
    postProgress(0.13, `Decompressed to ${mb} MB locally...`, "decompressing", bytes.byteLength);
  }

  postProgress(0.16, "Loading WASM parser...", "starting", bytes.byteLength);
  await initParser();

  const mode = request.mode ?? "fast";
  const strategy = browserParserStrategy(mode, bytes.byteLength);
  if (!strategy.allowed) {
    const mb = Math.round(bytes.byteLength / 1024 / 1024);
    throw new Error(
      `Maximum precision is unavailable for this ${mb} MB decompressed demo because it would exceed ` +
      "the browser memory limit. Choose Fast / memory-safe mode instead.",
    );
  }

  const qualityMessage = mode === "precise"
    ? " at maximum precision"
    : strategy.quality === "high"
      ? " (memory-safe high sampling)"
      : "";
  postProgress(0.22, `Parsing demo locally${qualityMessage}...`, "parsing", bytes.byteLength);
  const json = parse_demo_bytes_to_json(bytes, strategy.quality, false, false);

  postProgress(0.86, "Storing parsed match locally...", "storing");
  const data = versionCurrentImport(
    JSON.parse(json) as MatchData,
    strategy.quality,
  );
  validatePlayableMatch(data);
  const id = crypto.randomUUID();
  await saveParsedMatch(id, displayName(request.name), request.size, data);
  postProgress(0.99, "Parser output stored.", "done");
  return id;
}

self.onmessage = (event: MessageEvent<ParseRequest>) => {
  const message = event.data;
  if (message.type !== "parse") return;

  parseDemo(message)
    .then((id) => self.postMessage({ type: "done", id }))
    .catch((error) => {
      console.error("[parser-worker] parse failed", error);
      const message = browserParserMemoryError(error).message;
      self.postMessage({
        type: "error",
        message,
      });
    });
};
