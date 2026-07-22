export const LARGE_DEMO_HIGH_QUALITY_THRESHOLD = 384 * 1024 * 1024;

export type BrowserParserQuality = "full" | "high";
export type BrowserParseMode = "fast" | "precise";

export type BrowserParserStrategy = {
  quality: BrowserParserQuality;
  allowed: boolean;
};

/**
 * Full sampling on very large demos can exceed WebAssembly's 32-bit memory
 * ceiling even when the source file itself is valid. High keeps every event,
 * effect, weapon fire and projectile sample while reducing player-frame rows.
 */
export function browserParserQualityForSize(decompressedBytes: number): BrowserParserQuality {
  return decompressedBytes >= LARGE_DEMO_HIGH_QUALITY_THRESHOLD ? "high" : "full";
}

export function browserParserStrategy(mode: BrowserParseMode, decompressedBytes: number): BrowserParserStrategy {
  if (mode === "precise") {
    return {
      quality: "full",
      allowed: decompressedBytes < LARGE_DEMO_HIGH_QUALITY_THRESHOLD,
    };
  }
  return {
    quality: "high",
    allowed: true,
  };
}

export function browserParserMemoryError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/unreachable|out of memory|memory access out of bounds|allocation failed/i.test(message)) {
    return new Error(
      "This demo exhausted the browser parser memory. Close other heavy tabs and retry; " +
      "if it still fails, the demo is too large for the browser parser.",
    );
  }
  return error instanceof Error ? error : new Error(message);
}
