import { describe, expect, it } from "vitest";
import {
  MAP_CALIBRATION,
  RADAR_SIZE,
  cropFor,
  radarImagePath,
  radarLayerForPositions,
  radarLayerForZ,
  worldToRadar,
} from "@/lib/maps";

describe("map projection and radar layers", () => {
  it("projects Valve world coordinates into radar pixels", () => {
    const calibration = MAP_CALIBRATION.de_mirage;
    expect(worldToRadar(calibration.posX, calibration.posY, calibration)).toEqual({ x: 0, y: 0 });
    expect(worldToRadar(calibration.posX + calibration.scale * 100, calibration.posY - calibration.scale * 50, calibration))
      .toEqual({ x: 100, y: 50 });
  });

  it("uses a safe full-map crop for unknown maps", () => {
    expect(cropFor("de_unknown")).toEqual({ x: 0, y: 0, size: RADAR_SIZE });
    expect(cropFor("de_nuke")).toEqual({ x: 28, y: 28, size: 968 });
    const anubis = cropFor("de_anubis");
    expect(anubis).toEqual({ x: 14, y: 14, size: 996 });
    expect(anubis.y + anubis.size - 978).toBeGreaterThanOrEqual(32);
  });

  it("selects lower layers only inside configured altitude bounds", () => {
    expect(radarLayerForZ("de_nuke", -496)).toBe("lower");
    expect(radarLayerForZ("de_nuke", -495)).toBe("default");
    expect(radarLayerForZ("de_unknown", -999)).toBe("default");
    expect(radarLayerForZ("de_nuke", Number.NaN)).toBe("default");
  });

  it("chooses the majority layer and preserves the fallback without samples", () => {
    expect(radarLayerForPositions("de_nuke", [{ z: -600 }, { z: -700 }, { z: 0 }])).toBe("lower");
    expect(radarLayerForPositions("de_nuke", [{ z: -600 }, { z: 0 }])).toBe("default");
    expect(radarLayerForPositions("de_nuke", [{ z: Number.NaN }], "lower")).toBe("lower");
    expect(radarLayerForPositions("de_mirage", [{ z: -1000 }], "lower")).toBe("default");
  });

  it("builds only radar image paths that have a committed layer contract", () => {
    expect(radarImagePath("de_nuke", "lower")).toBe("/cs2lens-maps/de_nuke_lower.png");
    expect(radarImagePath("de_mirage", "lower")).toBe("/cs2lens-maps/de_mirage.png");
    expect(radarImagePath("de_nuke")).toBe("/cs2lens-maps/de_nuke.png");
  });
});
