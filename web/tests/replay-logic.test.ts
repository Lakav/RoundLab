import { describe, expect, it } from "vitest";
import { smokeBlastClearAlpha } from "@/lib/replay-logic";
import type { UtilityEffect } from "@/lib/types";

const smoke: UtilityEffect = { type: "smoke", start: 0, end: 18, x: 0, y: 0, z: 0 };

describe("smoke blast clearing", () => {
  it("dims a smoke after a recent nearby HE detonation", () => {
    const he: UtilityEffect = { type: "he", start: 2, end: 2, x: 100, y: 100, z: 0 };
    expect(smokeBlastClearAlpha(smoke, [he], 4)).toBe(0.12);
  });

  it("ignores future, stale, distant and non-HE effects", () => {
    const base = { type: "he" as const, end: 0, z: 0 };
    expect(smokeBlastClearAlpha(smoke, [{ ...base, start: 5, x: 0, y: 0 }], 4)).toBe(1);
    expect(smokeBlastClearAlpha(smoke, [{ ...base, start: 0, x: 0, y: 0 }], 4)).toBe(1);
    expect(smokeBlastClearAlpha(smoke, [{ ...base, start: 2, x: 500, y: 0 }], 4)).toBe(1);
    expect(smokeBlastClearAlpha(smoke, [{ ...smoke, type: "flash" }], 4)).toBe(1);
  });
});
