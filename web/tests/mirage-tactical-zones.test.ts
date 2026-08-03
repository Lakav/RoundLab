import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  locateTacticalZone,
  validTacticalMapDefinition,
  type TacticalMapDefinition,
} from "@/lib/analysis/tactical-zones";
import { MAP_CALIBRATION } from "@/lib/maps";

const DEFINITION = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "public/map-zones/de_mirage.json"),
    "utf8",
  ),
) as TacticalMapDefinition;

function radarToWorld(x: number, y: number) {
  const calibration = MAP_CALIBRATION.de_mirage;
  return {
    x: calibration.posX + x * calibration.scale,
    y: calibration.posY - y * calibration.scale,
    z: -160,
  };
}

describe("Mirage tactical zones", () => {
  it("ships a valid nine-zone definition", () => {
    expect(validTacticalMapDefinition(DEFINITION)).toBe(true);
    expect(DEFINITION.zones).toHaveLength(9);
  });

  it.each([
    ["b_site", 240, 310],
    ["b_approach", 250, 450],
    ["ct_spawn", 280, 740],
    ["north_route", 520, 200],
    ["middle", 520, 450],
    ["a_site", 550, 760],
    ["t_north", 820, 180],
    ["t_spawn", 900, 390],
    ["a_approach", 820, 720],
  ])("assigns the %s reference point", (zoneId, radarX, radarY) => {
    expect(locateTacticalZone(
      DEFINITION,
      radarToWorld(radarX as number, radarY as number),
    )).toMatchObject({ status: "assigned", zoneId });
  });
});
