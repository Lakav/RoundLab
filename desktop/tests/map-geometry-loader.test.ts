import { describe, expect, it, vi } from "vitest";
import {
  loadMapGeometry,
  MapGeometryLoadError,
  mapGeometryPath,
} from "@/lib/analysis/map-geometry-loader";

describe("map geometry loading", () => {
  it("loads a valid geometry payload from the map-specific public path", async () => {
    const payload = {
      map: "de_nuke",
      geometryId: "nuke-v1",
      triangles: [{
        a: { x: 0, y: 0, z: 0 },
        b: { x: 1, y: 0, z: 0 },
        c: { x: 0, y: 1, z: 0 },
      }],
    };
    const request = vi.fn(async () =>
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(loadMapGeometry("de_nuke", request)).resolves.toEqual(payload);
    expect(request).toHaveBeenCalledWith("/map-geometry/de_nuke.json");
    expect(mapGeometryPath("de_test map")).toBe(
      "/map-geometry/de_test%20map.json",
    );
  });

  it("returns null only when the map geometry is absent", async () => {
    const request = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(loadMapGeometry("de_nuke", request)).resolves.toBeNull();
  });

  it("rejects HTTP errors, malformed payloads and map mismatches", async () => {
    await expect(loadMapGeometry(
      "de_nuke",
      async () => new Response(null, { status: 500 }),
    )).rejects.toThrow(MapGeometryLoadError);
    await expect(loadMapGeometry(
      "de_nuke",
      async () => new Response("{", { status: 200 }),
    )).rejects.toThrow("JSON");
    await expect(loadMapGeometry(
      "de_nuke",
      async () => new Response(JSON.stringify({
        map: "de_mirage",
        geometryId: "wrong-map",
        triangles: [],
      }), { status: 200 }),
    )).rejects.toThrow("expected de_nuke");
    await expect(loadMapGeometry(
      "de_nuke",
      async () => new Response(JSON.stringify({
        map: "de_nuke",
        geometryId: "",
        triangles: [],
      }), { status: 200 }),
    )).rejects.toThrow("expected schema");
  });
});
