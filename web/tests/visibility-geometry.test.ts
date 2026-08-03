import { describe, expect, it } from "vitest";
import {
  hasClearLineOfSight,
  prepareMapGeometry,
  segmentIntersectsTriangle,
  validMapGeometry,
  type GeometryTriangle,
} from "@/lib/analysis/visibility-geometry";

const WALL: GeometryTriangle = {
  a: { x: 5, y: -5, z: -5 },
  b: { x: 5, y: 5, z: -5 },
  c: { x: 5, y: 0, z: 5 },
};

describe("3D line-of-sight geometry", () => {
  it("detects an obstacle strictly inside a sight segment", () => {
    expect(segmentIntersectsTriangle(
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      WALL,
    )).toBe(true);
    expect(hasClearLineOfSight(
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { map: "synthetic", geometryId: "wall-v1", triangles: [WALL] },
    )).toBe(false);
  });

  it("keeps a segment clear when it misses or only touches an endpoint", () => {
    expect(segmentIntersectsTriangle(
      { x: 0, y: 10, z: 0 },
      { x: 10, y: 10, z: 0 },
      WALL,
    )).toBe(false);
    expect(segmentIntersectsTriangle(
      { x: 5, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      WALL,
    )).toBe(false);
  });

  it("rejects non-finite geometry", () => {
    expect(validMapGeometry({
      map: "synthetic",
      geometryId: "invalid",
      triangles: [{
        ...WALL,
        a: { x: Number.NaN, y: 0, z: 0 },
      }],
    })).toBe(false);
  });

  it("indexes a large mesh and preserves direct intersection results", () => {
    const triangles = Array.from({ length: 512 }, (_, index) => ({
      a: { x: index * 4, y: -1, z: -1 },
      b: { x: index * 4, y: 1, z: -1 },
      c: { x: index * 4, y: 0, z: 1 },
    }));
    const geometry = {
      map: "synthetic",
      geometryId: "indexed-v1",
      triangles,
    };
    const stats = prepareMapGeometry(geometry);

    expect(stats).toMatchObject({
      triangleCount: 512,
      leafCount: 64,
      maxDepth: 7,
    });
    expect(stats.nodeCount).toBe(127);

    const rays = [
      [{ x: -2, y: 0, z: 0 }, { x: 2_100, y: 0, z: 0 }],
      [{ x: -2, y: 10, z: 0 }, { x: 2_100, y: 10, z: 0 }],
      [{ x: 3, y: 0, z: 0 }, { x: 3.5, y: 0, z: 0 }],
      [{ x: 1_000, y: -2, z: 0 }, { x: 1_000, y: 2, z: 0 }],
    ] as const;
    for (const [start, end] of rays) {
      const direct = !triangles.some((triangle) =>
        segmentIntersectsTriangle(start, end, triangle)
      );
      expect(hasClearLineOfSight(start, end, geometry)).toBe(direct);
    }
    expect(prepareMapGeometry(geometry)).toEqual(stats);
  });
});
