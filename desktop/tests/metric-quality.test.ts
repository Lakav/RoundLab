import { describe, expect, it } from "vitest";
import {
  qualityMetric,
  unavailableMetric,
} from "@/lib/analysis/metric-quality";

describe("metric quality contract", () => {
  it("records coverage, provenance, confidence and formula version", () => {
    expect(qualityMetric({
      value: 0.5,
      unit: "ratio",
      sampleCount: 10,
      usableSampleCount: 8,
      provenance: "reconstructed",
      confidence: "medium",
      formulaVersion: "roundlab.test.v1",
    })).toEqual({
      value: 0.5,
      unit: "ratio",
      sampleCount: 10,
      usableSampleCount: 8,
      coverage: 0.8,
      provenance: "reconstructed",
      confidence: "medium",
      unavailableReasons: [],
      formulaVersion: "roundlab.test.v1",
    });
  });

  it("never exposes NaN or infinity", () => {
    expect(qualityMetric({
      value: Number.NaN,
      unit: "ratio",
      sampleCount: 1,
      usableSampleCount: 1,
      provenance: "estimated",
      confidence: "low",
      formulaVersion: "roundlab.test.v1",
    })).toMatchObject({
      value: null,
      confidence: "unavailable",
      unavailableReasons: ["non_finite_metric_value"],
    });
  });

  it("keeps a missing value distinct from a measured zero", () => {
    const unavailable = unavailableMetric<number>({
      unit: "shots",
      sampleCount: 0,
      usableSampleCount: 0,
      provenance: "observed",
      formulaVersion: "roundlab.test.v1",
      reasons: ["missing_weapon_fire_events"],
    });
    const measuredZero = qualityMetric({
      value: 0,
      unit: "shots",
      sampleCount: 0,
      usableSampleCount: 0,
      provenance: "observed",
      confidence: "high",
      formulaVersion: "roundlab.test.v1",
    });

    expect(unavailable.value).toBeNull();
    expect(unavailable.unavailableReasons).toEqual([
      "missing_weapon_fire_events",
    ]);
    expect(measuredZero.value).toBe(0);
    expect(measuredZero.unavailableReasons).toEqual([]);
  });

  it("rejects impossible sample counts", () => {
    expect(() => qualityMetric({
      value: 1,
      unit: "count",
      sampleCount: 1,
      usableSampleCount: 2,
      provenance: "observed",
      confidence: "high",
      formulaVersion: "roundlab.test.v1",
    })).toThrow("usableSampleCount cannot exceed sampleCount");
  });
});
