import { ZSTDDecoder } from "zstddec";
import initParser, { parse_demo_bytes_to_json } from "../wasm/roundlab_parser/roundlab_parser.js";
import { saveParsedMatch } from "@/lib/backends/browser-store";
import type { MatchData } from "@/lib/types";

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const;
const MAX_DEMO_SIZE = 1024 * 1024 * 1024;

type ParseRequest = {
  type: "parse";
  name: string;
  size: number;
  buffer: ArrayBuffer;
};

let zstdDecoderPromise: Promise<ZSTDDecoder> | null = null;

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

async function getZstdDecoder(): Promise<ZSTDDecoder> {
  zstdDecoderPromise ??= (async () => {
    const decoder = new ZSTDDecoder();
    await decoder.init();
    return decoder;
  })();
  return zstdDecoderPromise;
}

async function decompressZstd(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const decoder = await getZstdDecoder();
  const output = decoder.decode(bytes);
  if (!output.byteLength) {
    throw new Error("The .zst file decompressed to an empty payload.");
  }
  const copy = new Uint8Array(output.byteLength);
  copy.set(output);
  return copy;
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

  postProgress(0.22, "Parsing demo locally...", "parsing", bytes.byteLength);
  const json = parse_demo_bytes_to_json(bytes, "full", false, false);

  postProgress(0.86, "Storing parsed match locally...", "storing");
  const data = JSON.parse(json) as MatchData;
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
      const message = error instanceof Error ? error.message : String(error);
      self.postMessage({
        type: "error",
        message,
      });
    });
};
