import { describe, expect, it } from "vitest";
import {
  browserParserMemoryError,
  browserParserQualityForSize,
  browserParserStrategy,
  LARGE_DEMO_HIGH_QUALITY_THRESHOLD,
} from "@/lib/parser-memory";

describe("browser parser memory policy", () => {
  it("keeps normal demos at full quality and samples exceptional demos safely", () => {
    expect(browserParserQualityForSize(LARGE_DEMO_HIGH_QUALITY_THRESHOLD - 1)).toBe("full");
    expect(browserParserQualityForSize(LARGE_DEMO_HIGH_QUALITY_THRESHOLD)).toBe("high");
    expect(browserParserQualityForSize(569_931_815)).toBe("high");
  });

  it("offers maximum precision only below the safe browser threshold", () => {
    expect(browserParserStrategy("precise", LARGE_DEMO_HIGH_QUALITY_THRESHOLD - 1)).toEqual({
      quality: "full",
      allowed: true,
    });
    expect(browserParserStrategy("precise", LARGE_DEMO_HIGH_QUALITY_THRESHOLD)).toEqual({
      quality: "full",
      allowed: false,
    });
    expect(browserParserStrategy("fast", 569_931_815)).toEqual({
      quality: "high",
      allowed: true,
    });
    expect(browserParserStrategy("fast", 64 * 1024 * 1024)).toEqual({
      quality: "high",
      allowed: true,
    });
  });

  it("turns opaque WebAssembly traps into an actionable error", () => {
    expect(browserParserMemoryError(new Error("unreachable")).message).toContain("browser parser memory");
    const original = new Error("invalid demo header");
    expect(browserParserMemoryError(original)).toBe(original);
  });
});
