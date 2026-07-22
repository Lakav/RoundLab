import { describe, expect, it } from "vitest";
import {
  browserParserMemoryError,
  browserParserQualityForSize,
  LARGE_DEMO_HIGH_QUALITY_THRESHOLD,
} from "@/lib/parser-memory";

describe("browser parser memory policy", () => {
  it("keeps normal demos at full quality and samples exceptional demos safely", () => {
    expect(browserParserQualityForSize(LARGE_DEMO_HIGH_QUALITY_THRESHOLD - 1)).toBe("full");
    expect(browserParserQualityForSize(LARGE_DEMO_HIGH_QUALITY_THRESHOLD)).toBe("high");
    expect(browserParserQualityForSize(569_931_815)).toBe("high");
  });

  it("turns opaque WebAssembly traps into an actionable error", () => {
    expect(browserParserMemoryError(new Error("unreachable")).message).toContain("browser parser memory");
    const original = new Error("invalid demo header");
    expect(browserParserMemoryError(original)).toBe(original);
  });
});
