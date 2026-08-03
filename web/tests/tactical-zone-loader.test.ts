import { describe, expect, it, vi } from "vitest";
import {
  loadTacticalZones,
  TacticalZoneLoadError,
  tacticalZonePath,
} from "@/lib/analysis/tactical-zone-loader";

const PAYLOAD = {
  map: "de_nuke",
  zonesVersion: "nuke-zones-v1",
  zones: [{
    zoneId: "outside",
    label: "Outside",
    polygon: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ],
    altitudeMin: -100,
    altitudeMax: 100,
  }],
};

describe("tactical zone loading", () => {
  it("loads a valid map-specific definition", async () => {
    const request = vi.fn(async () =>
      new Response(JSON.stringify(PAYLOAD), { status: 200 })
    );
    await expect(loadTacticalZones("de_nuke", request)).resolves.toEqual(
      PAYLOAD,
    );
    expect(request).toHaveBeenCalledWith("/map-zones/de_nuke.json");
    expect(tacticalZonePath("de test")).toBe("/map-zones/de%20test.json");
  });

  it("returns null for an absent definition", async () => {
    await expect(loadTacticalZones(
      "de_nuke",
      async () => new Response(null, { status: 404 }),
    )).resolves.toBeNull();
  });

  it("rejects transport, schema and map errors", async () => {
    await expect(loadTacticalZones(
      "de_nuke",
      async () => new Response(null, { status: 500 }),
    )).rejects.toThrow(TacticalZoneLoadError);
    await expect(loadTacticalZones(
      "de_nuke",
      async () => new Response("{", { status: 200 }),
    )).rejects.toThrow("JSON");
    await expect(loadTacticalZones(
      "de_nuke",
      async () => new Response(JSON.stringify({
        ...PAYLOAD,
        map: "de_mirage",
      }), { status: 200 }),
    )).rejects.toThrow("expected de_nuke");
    await expect(loadTacticalZones(
      "de_nuke",
      async () => new Response(JSON.stringify({
        ...PAYLOAD,
        zonesVersion: "",
      }), { status: 200 }),
    )).rejects.toThrow("expected schema");
  });
});
