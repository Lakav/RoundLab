import { describe, expect, it } from "vitest";
import {
  AwpyTriGeometryError,
  importMapGeometryFromAwpyTri,
} from "@/lib/analysis/awpy-tri-map-geometry";

function triBytes(values: number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

describe("Awpy .tri geometry import", () => {
  it("decodes consecutive little-endian float32 triangles deterministically", () => {
    const geometry = importMapGeometryFromAwpyTri(
      triBytes([
        0, 1, 2, 3, 4, 5, 6, 7, 8,
        -1, -2, -3, 10.5, 11.5, 12.5, 20, 21, 22,
      ]),
      { map: "de_nuke", geometryId: "awpy-client-2000873" },
    );

    expect(geometry).toEqual({
      map: "de_nuke",
      geometryId: "awpy-client-2000873",
      triangles: [
        {
          a: { x: 0, y: 1, z: 2 },
          b: { x: 3, y: 4, z: 5 },
          c: { x: 6, y: 7, z: 8 },
        },
        {
          a: { x: -1, y: -2, z: -3 },
          b: { x: 10.5, y: 11.5, z: 12.5 },
          c: { x: 20, y: 21, z: 22 },
        },
      ],
    });
  });

  it("rejects truncated and non-finite payloads", () => {
    expect(() => importMapGeometryFromAwpyTri(
      new Uint8Array(35),
      { map: "de_nuke", geometryId: "bad" },
    )).toThrow(AwpyTriGeometryError);

    expect(() => importMapGeometryFromAwpyTri(
      triBytes([0, 0, 0, 1, 0, 0, 0, 1, Number.NaN]),
      { map: "de_nuke", geometryId: "bad" },
    )).toThrow("non-finite");
  });
});
