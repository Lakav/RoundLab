import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  locateTacticalZone,
  validTacticalMapDefinition,
  type TacticalMapDefinition,
} from "@/lib/analysis/tactical-zones";
import {
  MAP_CALIBRATION,
  worldToRadar,
} from "@/lib/maps";

const DEFINITION = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "public/map-zones/de_inferno.json"),
    "utf8",
  ),
) as TacticalMapDefinition;

function radarToWorld(x: number, y: number) {
  const calibration = MAP_CALIBRATION.de_inferno;
  return {
    x: calibration.posX + x * calibration.scale,
    y: calibration.posY - y * calibration.scale,
    z: 100,
  };
}

describe("Inferno tactical zones", () => {
  it("ships a valid versioned definition with unique tactical zones", () => {
    expect(validTacticalMapDefinition(DEFINITION)).toBe(true);
    expect(DEFINITION).toMatchObject({
      map: "de_inferno",
      zonesVersion: "roundlab.de_inferno.coarse.v1",
    });
    expect(new Set(DEFINITION.zones.map((zone) => zone.zoneId)).size).toBe(9);
  });

  it.each([
    ["a_site", 480, 220],
    ["a_rotation", 640, 300],
    ["b_site", 840, 300],
    ["west_approach", 300, 400],
    ["west_mid", 300, 600],
    ["t_spawn", 250, 800],
    ["middle", 560, 650],
    ["banana", 820, 530],
    ["ct_spawn", 820, 760],
  ])("assigns the %s reference point", (zoneId, radarX, radarY) => {
    expect(locateTacticalZone(
      DEFINITION,
      radarToWorld(radarX as number, radarY as number),
    )).toMatchObject({
      status: "assigned",
      zoneId,
    });
  });

  it("resolves a shared polygon boundary by explicit priority", () => {
    expect(locateTacticalZone(
      DEFINITION,
      radarToWorld(560, 200),
    )).toMatchObject({
      status: "assigned",
      zoneId: "a_site",
    });
  });

  it("uses the same calibration as the replay radar", () => {
    const world = radarToWorld(480, 220);
    const radar = worldToRadar(
      world.x,
      world.y,
      MAP_CALIBRATION.de_inferno,
    );
    expect(radar.x).toBeCloseTo(480, 10);
    expect(radar.y).toBeCloseTo(220, 10);
  });
});
