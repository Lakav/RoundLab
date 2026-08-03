import { describe, expect, it } from "vitest";
import {
  evaluateTemporalVisibility,
} from "@/lib/analysis/temporal-visibility";
import type { MapGeometry } from "@/lib/analysis/visibility-geometry";
import type { PlayerPos, Round } from "@/lib/types";

const OPEN: MapGeometry = {
  map: "de_test",
  geometryId: "open-v1",
  triangles: [],
};

function player(
  id: string,
  x: number,
  yaw: number,
  overrides: Partial<PlayerPos> = {},
): PlayerPos {
  return {
    id,
    x,
    y: 0,
    z: 0,
    yaw,
    pitch: 0,
    hp: 100,
    armor: 0,
    team: id === "a" ? 2 : 3,
    flashLeft: 0,
    spottedBy: [],
    ...overrides,
  };
}

function sourceRound(overrides: Partial<Round> = {}): Round {
  return {
    number: 1,
    startTick: 0,
    endTick: 128,
    duration: 2,
    winner: "T",
    frames: [],
    events: [],
    effects: [],
    ...overrides,
  };
}

const eye = (value: PlayerPos) => ({
  x: value.x,
  y: value.y,
  z: value.z + 64,
});

describe("temporal visibility", () => {
  it("uses geometry, FOV, flash state and spottedBy as a secondary signal", () => {
    const result = evaluateTemporalVisibility(
      sourceRound(),
      1,
      OPEN,
      player("a", 0, 0),
      player("b", 100, 0, { spottedBy: ["a"] }),
      eye,
    );

    expect(result).toEqual({
      visible: true,
      method: "geometry_fov_smoke_flash",
      confidence: "medium",
      observerIds: ["a"],
      limitations: ["dynamic_obstacles_not_modeled"],
    });
  });

  it("blocks a line crossing an active smoke", () => {
    const result = evaluateTemporalVisibility(
      sourceRound({
        effects: [{
          type: "smoke",
          start: 0,
          end: 2,
          x: 50,
          y: 0,
          z: 64,
        }],
      }),
      1,
      OPEN,
      player("a", 0, 0),
      player("b", 100, 0, { spottedBy: ["a"] }),
      eye,
    );

    expect(result.visible).toBe(false);
    expect(result.observerIds).toEqual([]);
  });

  it("does not count a flashed observer as seeing the target", () => {
    const result = evaluateTemporalVisibility(
      sourceRound(),
      1,
      OPEN,
      player("a", 0, 0, { flashLeft: 1 }),
      player("b", 100, 0, { spottedBy: ["a"] }),
      eye,
    );

    expect(result.visible).toBe(false);
  });
});
