import type {
  GeometryTriangle,
  MapGeometry,
} from "./visibility-geometry";

const FLOATS_PER_TRIANGLE = 9;
const BYTES_PER_FLOAT32 = 4;
const BYTES_PER_TRIANGLE = FLOATS_PER_TRIANGLE * BYTES_PER_FLOAT32;
const MAX_TRIANGLES = 5_000_000;

export class AwpyTriGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AwpyTriGeometryError";
  }
}

/**
 * Reads Awpy's legacy `.tri` interchange format: consecutive little-endian
 * float32 tuples (ax, ay, az, bx, by, bz, cx, cy, cz), without a header.
 */
export function importMapGeometryFromAwpyTri(
  bytes: Uint8Array,
  options: { map: string; geometryId: string },
): MapGeometry {
  const map = options.map.trim();
  const geometryId = options.geometryId.trim();
  if (map.length === 0 || geometryId.length === 0) {
    throw new AwpyTriGeometryError("Map and geometry id must not be empty.");
  }
  if (bytes.byteLength === 0) {
    throw new AwpyTriGeometryError("Awpy .tri input is empty.");
  }
  if (bytes.byteLength % BYTES_PER_TRIANGLE !== 0) {
    throw new AwpyTriGeometryError(
      `Awpy .tri byte length must be a multiple of ${BYTES_PER_TRIANGLE}.`,
    );
  }
  const triangleCount = bytes.byteLength / BYTES_PER_TRIANGLE;
  if (triangleCount > MAX_TRIANGLES) {
    throw new AwpyTriGeometryError(
      `Awpy .tri input exceeds the ${MAX_TRIANGLES} triangle safety limit.`,
    );
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangles: GeometryTriangle[] = [];
  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
    const values: number[] = [];
    const base = triangleIndex * BYTES_PER_TRIANGLE;
    for (let component = 0; component < FLOATS_PER_TRIANGLE; component++) {
      const value = view.getFloat32(
        base + component * BYTES_PER_FLOAT32,
        true,
      );
      if (!Number.isFinite(value)) {
        throw new AwpyTriGeometryError(
          `Awpy .tri triangle ${triangleIndex} contains a non-finite coordinate.`,
        );
      }
      values.push(value);
    }
    triangles.push({
      a: { x: values[0], y: values[1], z: values[2] },
      b: { x: values[3], y: values[4], z: values[5] },
      c: { x: values[6], y: values[7], z: values[8] },
    });
  }
  return { map, geometryId, triangles };
}
