import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  locateTacticalZone,
  validTacticalMapDefinition,
  type TacticalMapDefinition,
} from "@/lib/analysis/tactical-zones";
import { MAP_CALIBRATION } from "@/lib/maps";

type MapCase = {
  map:
    | "de_ancient"
    | "de_anubis"
    | "de_cache"
    | "de_dust2"
    | "de_nuke"
    | "de_overpass"
    | "de_train"
    | "de_vertigo";
  altitude: number;
  references: Array<[string, number, number, number?]>;
};

const MAP_CASES: MapCase[] = [
  {
    map: "de_ancient",
    altitude: 0,
    references: [
      ["b_site", 200, 190],
      ["b_approach", 200, 490],
      ["t_west", 200, 800],
      ["ct_spawn", 525, 130],
      ["middle", 525, 450],
      ["t_spawn", 525, 837],
      ["a_site", 837, 260],
      ["a_approach", 837, 610],
      ["t_east", 837, 862],
    ],
  },
  {
    map: "de_anubis",
    altitude: 0,
    references: [
      ["ct_west", 215, 150],
      ["a_site", 215, 450],
      ["a_approach", 215, 812],
      ["ct_spawn", 540, 160],
      ["middle", 540, 510],
      ["t_spawn", 540, 862],
      ["b_site", 837, 215],
      ["b_approach", 837, 540],
      ["t_east", 837, 837],
    ],
  },
  {
    map: "de_cache",
    altitude: 1700,
    references: [
      ["b_site", 215, 175],
      ["ct_spawn", 215, 500],
      ["a_site", 215, 837],
      ["b_approach", 565, 175],
      ["middle", 565, 525],
      ["a_approach", 565, 862],
      ["t_spawn", 862, 512],
    ],
  },
  {
    map: "de_dust2",
    altitude: 0,
    references: [
      ["b_site", 200, 175],
      ["b_approach", 200, 475],
      ["t_west", 200, 812],
      ["ct_spawn", 525, 150],
      ["middle", 525, 500],
      ["t_spawn", 525, 862],
      ["a_site", 837, 175],
      ["a_approach", 837, 500],
      ["t_east", 837, 837],
    ],
  },
  {
    map: "de_overpass",
    altitude: 200,
    references: [
      ["north_route", 200, 150],
      ["west_middle", 200, 500],
      ["t_west", 200, 850],
      ["a_site_ct", 525, 150],
      ["middle", 525, 500],
      ["t_center", 525, 850],
      ["b_site", 837, 200],
      ["b_approach", 837, 500],
      ["t_spawn", 837, 850],
    ],
  },
  {
    map: "de_nuke",
    altitude: 0,
    references: [
      ["t_side", 150, 500],
      ["upper_yard", 500, 200],
      ["lower_north", 500, 200, -700],
      ["a_site_upper", 500, 550, -400],
      ["b_site_lower", 500, 550, -700],
      ["upper_south", 500, 850, -400],
      ["ct_side", 850, 500],
    ],
  },
  {
    map: "de_train",
    altitude: -200,
    references: [
      ["upper_interior", 500, 500, 0],
      ["t_spawn", 150, 150],
      ["north_yard", 600, 150],
      ["west_route", 150, 500],
      ["b_site", 550, 500],
      ["east_route", 850, 500],
      ["south_west", 150, 850],
      ["a_site", 480, 850],
      ["south_center", 650, 850],
    ],
  },
  {
    map: "de_vertigo",
    altitude: 11_800,
    references: [
      ["lower_north", 500, 300, 11_500],
      ["lower_t_spawn", 500, 750, 11_500],
      ["a_site", 200, 200],
      ["ct_spawn", 600, 200],
      ["a_approach", 200, 700],
      ["middle", 520, 700],
      ["b_site", 800, 700],
    ],
  },
];

function definition(map: string): TacticalMapDefinition {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `public/map-zones/${map}.json`),
      "utf8",
    ),
  ) as TacticalMapDefinition;
}

describe.each(MAP_CASES)("$map tactical zones", (mapCase) => {
  const source = definition(mapCase.map);

  it("ships a valid versioned definition", () => {
    expect(validTacticalMapDefinition(source)).toBe(true);
    expect(source.map).toBe(mapCase.map);
    expect(source.zonesVersion).toBe(
      `roundlab.${mapCase.map}.coarse.v1`,
    );
  });

  it.each(mapCase.references)(
    "assigns the %s reference point",
    (zoneId, radarX, radarY, altitude) => {
      const calibration = MAP_CALIBRATION[mapCase.map];
      expect(locateTacticalZone(source, {
        x: calibration.posX + radarX * calibration.scale,
        y: calibration.posY - radarY * calibration.scale,
        z: altitude ?? mapCase.altitude,
      })).toMatchObject({ status: "assigned", zoneId });
    },
  );
});

it("ships a tactical-zone definition for every calibrated map", () => {
  for (const map of Object.keys(MAP_CALIBRATION)) {
    const source = definition(map);
    expect(source.map).toBe(map);
    expect(validTacticalMapDefinition(source)).toBe(true);
  }
});
