import { describe, expect, it } from "vitest";
import {
  GltfGeometryImportError,
  importMapGeometryFromGltf,
  parseGlb,
  type GltfDocument,
} from "@/lib/analysis/gltf-map-geometry";

function floatBuffer(values: number[]): Uint8Array {
  const buffer = new ArrayBuffer(values.length * 4);
  const view = new DataView(buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return new Uint8Array(buffer);
}

function triangleDocument(overrides: Partial<GltfDocument> = {}): GltfDocument {
  return {
    asset: { version: "2.0" },
    buffers: [{ byteLength: 36 }],
    bufferViews: [{ buffer: 0, byteLength: 36 }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
    }],
    meshes: [{
      primitives: [{ attributes: { POSITION: 0 } }],
    }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
    ...overrides,
  };
}

function glb(document: GltfDocument, binary: Uint8Array): Uint8Array {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(jsonBytes.length / 4) * 4;
  const binaryLength = Math.ceil(binary.length / 4) * 4;
  const output = new Uint8Array(12 + 8 + jsonLength + 8 + binaryLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(jsonBytes, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}

describe("glTF map geometry import", () => {
  it("applies node transforms and converts glTF Y-up coordinates to Source Z-up", () => {
    const document = triangleDocument({
      nodes: [{ mesh: 0, translation: [10, 20, 30] }],
    });
    const result = importMapGeometryFromGltf(
      document,
      [floatBuffer([0, 0, 0, 1, 0, 0, 0, 1, 0])],
      { map: "de_test", geometryId: "test-v1" },
    );

    expect(result).toMatchObject({
      meshInstanceCount: 1,
      primitiveCount: 1,
      triangleCount: 1,
      geometry: {
        map: "de_test",
        geometryId: "test-v1",
      },
    });
    expect(result.geometry.triangles[0]).toEqual({
      a: { x: 10, y: -30, z: 20 },
      b: { x: 11, y: -30, z: 20 },
      c: { x: 10, y: -30, z: 21 },
    });
  });

  it("reads interleaved positions and uint16 indices", () => {
    const buffer = new Uint8Array(54);
    const view = new DataView(buffer.buffer);
    const positions = [
      [0, 0, 0],
      [2, 0, 0],
      [0, 2, 0],
    ];
    positions.forEach((position, index) => {
      const offset = index * 16;
      position.forEach((value, component) =>
        view.setFloat32(offset + component * 4, value, true)
      );
      view.setFloat32(offset + 12, 999, true);
    });
    view.setUint16(48, 2, true);
    view.setUint16(50, 1, true);
    view.setUint16(52, 0, true);
    const document = triangleDocument({
      buffers: [{ byteLength: buffer.length }],
      bufferViews: [
        { buffer: 0, byteLength: 48, byteStride: 16 },
        { buffer: 0, byteOffset: 48, byteLength: 6 },
      ],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
      ],
      meshes: [{
        primitives: [{ attributes: { POSITION: 0 }, indices: 1 }],
      }],
    });

    const result = importMapGeometryFromGltf(document, [buffer], {
      map: "de_test",
      geometryId: "indexed-v1",
      convertYUpToSource: false,
    });

    expect(result.geometry.triangles[0]).toEqual({
      a: { x: 0, y: 2, z: 0 },
      b: { x: 2, y: 0, z: 0 },
      c: { x: 0, y: 0, z: 0 },
    });
  });

  it("composes parent and child transforms for mesh instances", () => {
    const document = triangleDocument({
      nodes: [
        { translation: [10, 0, 0], children: [1] },
        { mesh: 0, scale: [2, 2, 2] },
      ],
      scenes: [{ nodes: [0] }],
    });
    const result = importMapGeometryFromGltf(
      document,
      [floatBuffer([1, 0, 0, 0, 1, 0, 0, 0, 1])],
      {
        map: "de_test",
        geometryId: "hierarchy-v1",
        convertYUpToSource: false,
      },
    );

    expect(result.geometry.triangles[0].a).toEqual({ x: 12, y: 0, z: 0 });
    expect(result.geometry.triangles[0].b).toEqual({ x: 10, y: 2, z: 0 });
  });

  it("parses a GLB JSON and binary chunk", () => {
    const document = triangleDocument();
    const binary = floatBuffer([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const parsed = parseGlb(glb(document, binary));
    const result = importMapGeometryFromGltf(
      parsed.document,
      [parsed.binaryChunk],
      { map: "de_test", geometryId: "glb-v1" },
    );

    expect(result.triangleCount).toBe(1);
    expect(parsed.binaryChunk.slice(0, binary.length)).toEqual(binary);
  });

  it("rejects unsupported primitives, invalid indices and cyclic nodes", () => {
    const positions = floatBuffer([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(() =>
      importMapGeometryFromGltf(
        triangleDocument({
          meshes: [{
            primitives: [{ attributes: { POSITION: 0 }, mode: 5 }],
          }],
        }),
        [positions],
        { map: "de_test", geometryId: "strip" },
      )
    ).toThrow("Only TRIANGLES");

    const invalidIndexBuffer = new Uint8Array(39);
    invalidIndexBuffer.set(positions);
    invalidIndexBuffer.set([0, 1, 3], 36);
    expect(() =>
      importMapGeometryFromGltf(
        triangleDocument({
          buffers: [{ byteLength: 39 }],
          bufferViews: [
            { buffer: 0, byteLength: 36 },
            { buffer: 0, byteOffset: 36, byteLength: 3 },
          ],
          accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
            { bufferView: 1, componentType: 5121, count: 3, type: "SCALAR" },
          ],
          meshes: [{
            primitives: [{ attributes: { POSITION: 0 }, indices: 1 }],
          }],
        }),
        [invalidIndexBuffer],
        { map: "de_test", geometryId: "invalid-index" },
      )
    ).toThrow("exceeds POSITION bounds");

    expect(() =>
      importMapGeometryFromGltf(
        triangleDocument({
          nodes: [{ mesh: 0, children: [0] }],
        }),
        [positions],
        { map: "de_test", geometryId: "cycle" },
      )
    ).toThrow("contains a cycle");
  });

  it("rejects malformed GLB payloads with an explicit import error", () => {
    const malformed = new Uint8Array(20);
    expect(() => parseGlb(malformed)).toThrow(GltfGeometryImportError);
    expect(() => parseGlb(malformed)).toThrow("Invalid GLB magic");
  });
});
