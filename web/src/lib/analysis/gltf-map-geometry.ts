import type {
  GeometryTriangle,
  MapGeometry,
  Vector3,
} from "./visibility-geometry";

type GltfAccessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
};

type GltfBuffer = {
  uri?: string;
  byteLength: number;
};

type GltfBufferView = {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
};

type GltfPrimitive = {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
};

type GltfMesh = {
  primitives: GltfPrimitive[];
};

type GltfNode = {
  children?: number[];
  matrix?: number[];
  mesh?: number;
  rotation?: number[];
  scale?: number[];
  translation?: number[];
};

export type GltfDocument = {
  asset?: { version?: string };
  accessors?: GltfAccessor[];
  buffers?: GltfBuffer[];
  bufferViews?: GltfBufferView[];
  meshes?: GltfMesh[];
  nodes?: GltfNode[];
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
};

export type GltfGeometryImportOptions = {
  map: string;
  geometryId: string;
  convertYUpToSource?: boolean;
  scale?: number;
};

export type GltfGeometryImportResult = {
  geometry: MapGeometry;
  meshInstanceCount: number;
  primitiveCount: number;
  triangleCount: number;
};

type Matrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const GLTF_TRIANGLES_MODE = 4;
const GLTF_FLOAT_COMPONENT = 5126;

const IDENTITY_MATRIX: Matrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export class GltfGeometryImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GltfGeometryImportError";
  }
}

function matrixFromArray(values: number[]): Matrix4 {
  if (values.length !== 16 || values.some((value) => !Number.isFinite(value))) {
    throw new GltfGeometryImportError("A node matrix must contain 16 finite values.");
  }
  return [...values] as Matrix4;
}

function multiplyMatrices(left: Matrix4, right: Matrix4): Matrix4 {
  const output = Array<number>(16).fill(0);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      for (let index = 0; index < 4; index++) {
        output[column * 4 + row] +=
          left[index * 4 + row] * right[column * 4 + index];
      }
    }
  }
  return output as Matrix4;
}

function nodeMatrix(node: GltfNode): Matrix4 {
  if (node.matrix !== undefined) return matrixFromArray(node.matrix);
  const translation = node.translation ?? [0, 0, 0];
  const rotation = node.rotation ?? [0, 0, 0, 1];
  const scale = node.scale ?? [1, 1, 1];
  if (
    translation.length !== 3 ||
    rotation.length !== 4 ||
    scale.length !== 3 ||
    [...translation, ...rotation, ...scale].some(
      (value) => !Number.isFinite(value),
    )
  ) {
    throw new GltfGeometryImportError("A node contains an invalid TRS transform.");
  }
  const [x, y, z, w] = rotation;
  const [sx, sy, sz] = scale;
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    (2 * (x * y + z * w)) * sx,
    (2 * (x * z - y * w)) * sx,
    0,
    (2 * (x * y - z * w)) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    (2 * (y * z + x * w)) * sy,
    0,
    (2 * (x * z + y * w)) * sz,
    (2 * (y * z - x * w)) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    translation[0],
    translation[1],
    translation[2],
    1,
  ];
}

function transformPoint(matrix: Matrix4, point: Vector3): Vector3 {
  return {
    x:
      matrix[0] * point.x +
      matrix[4] * point.y +
      matrix[8] * point.z +
      matrix[12],
    y:
      matrix[1] * point.x +
      matrix[5] * point.y +
      matrix[9] * point.z +
      matrix[13],
    z:
      matrix[2] * point.x +
      matrix[6] * point.y +
      matrix[10] * point.z +
      matrix[14],
  };
}

function sourcePoint(
  point: Vector3,
  convertYUpToSource: boolean,
  scale: number,
): Vector3 {
  if (!convertYUpToSource) {
    return { x: point.x * scale, y: point.y * scale, z: point.z * scale };
  }
  return { x: point.x * scale, y: -point.z * scale, z: point.y * scale };
}

function dataViewFor(
  buffer: Uint8Array,
  byteOffset: number,
  byteLength: number,
): DataView {
  if (
    byteOffset < 0 ||
    byteLength < 0 ||
    byteOffset + byteLength > buffer.byteLength
  ) {
    throw new GltfGeometryImportError("An accessor points outside its buffer.");
  }
  return new DataView(
    buffer.buffer,
    buffer.byteOffset + byteOffset,
    byteLength,
  );
}

function accessorContext(
  document: GltfDocument,
  buffers: Uint8Array[],
  accessorIndex: number,
): {
  accessor: GltfAccessor;
  view: GltfBufferView;
  data: DataView;
  baseOffset: number;
} {
  const accessor = document.accessors?.[accessorIndex];
  if (accessor === undefined || accessor.bufferView === undefined) {
    throw new GltfGeometryImportError(`Accessor ${accessorIndex} is missing its buffer view.`);
  }
  const view = document.bufferViews?.[accessor.bufferView];
  if (view === undefined) {
    throw new GltfGeometryImportError(`Buffer view ${accessor.bufferView} does not exist.`);
  }
  const buffer = buffers[view.buffer];
  if (buffer === undefined) {
    throw new GltfGeometryImportError(`Buffer ${view.buffer} was not provided.`);
  }
  return {
    accessor,
    view,
    data: dataViewFor(buffer, view.byteOffset ?? 0, view.byteLength),
    baseOffset: accessor.byteOffset ?? 0,
  };
}

function readPositions(
  document: GltfDocument,
  buffers: Uint8Array[],
  accessorIndex: number,
): Vector3[] {
  const { accessor, view, data, baseOffset } = accessorContext(
    document,
    buffers,
    accessorIndex,
  );
  if (accessor.componentType !== GLTF_FLOAT_COMPONENT || accessor.type !== "VEC3") {
    throw new GltfGeometryImportError("POSITION must be a float32 VEC3 accessor.");
  }
  const stride = view.byteStride ?? 12;
  if (stride < 12) {
    throw new GltfGeometryImportError("POSITION byte stride is smaller than one VEC3.");
  }
  const positions: Vector3[] = [];
  for (let index = 0; index < accessor.count; index++) {
    const offset = baseOffset + index * stride;
    if (offset + 12 > data.byteLength) {
      throw new GltfGeometryImportError("A POSITION accessor exceeds its buffer view.");
    }
    positions.push({
      x: data.getFloat32(offset, true),
      y: data.getFloat32(offset + 4, true),
      z: data.getFloat32(offset + 8, true),
    });
  }
  return positions;
}

function indexComponentSize(componentType: number): number {
  if (componentType === 5121) return 1;
  if (componentType === 5123) return 2;
  if (componentType === 5125) return 4;
  throw new GltfGeometryImportError(
    `Unsupported index component type ${componentType}.`,
  );
}

function readIndices(
  document: GltfDocument,
  buffers: Uint8Array[],
  accessorIndex: number,
): number[] {
  const { accessor, view, data, baseOffset } = accessorContext(
    document,
    buffers,
    accessorIndex,
  );
  if (accessor.type !== "SCALAR") {
    throw new GltfGeometryImportError("Triangle indices must use a SCALAR accessor.");
  }
  const componentSize = indexComponentSize(accessor.componentType);
  const stride = view.byteStride ?? componentSize;
  if (stride < componentSize) {
    throw new GltfGeometryImportError("Index byte stride is too small.");
  }
  const indices: number[] = [];
  for (let index = 0; index < accessor.count; index++) {
    const offset = baseOffset + index * stride;
    if (offset + componentSize > data.byteLength) {
      throw new GltfGeometryImportError("An index accessor exceeds its buffer view.");
    }
    indices.push(
      componentSize === 1
        ? data.getUint8(offset)
        : componentSize === 2
          ? data.getUint16(offset, true)
          : data.getUint32(offset, true),
    );
  }
  return indices;
}

function primitiveTriangles(
  document: GltfDocument,
  buffers: Uint8Array[],
  primitive: GltfPrimitive,
  worldMatrix: Matrix4,
  options: Required<Pick<GltfGeometryImportOptions, "convertYUpToSource" | "scale">>,
): GeometryTriangle[] {
  if ((primitive.mode ?? GLTF_TRIANGLES_MODE) !== GLTF_TRIANGLES_MODE) {
    throw new GltfGeometryImportError("Only TRIANGLES glTF primitives are supported.");
  }
  const positionAccessor = primitive.attributes.POSITION;
  if (positionAccessor === undefined) {
    throw new GltfGeometryImportError("A mesh primitive has no POSITION accessor.");
  }
  const positions = readPositions(document, buffers, positionAccessor).map(
    (point) =>
      sourcePoint(
        transformPoint(worldMatrix, point),
        options.convertYUpToSource,
        options.scale,
      ),
  );
  const indices =
    primitive.indices === undefined
      ? positions.map((_, index) => index)
      : readIndices(document, buffers, primitive.indices);
  if (indices.length % 3 !== 0) {
    throw new GltfGeometryImportError("Triangle index count must be divisible by three.");
  }
  const triangles: GeometryTriangle[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    const a = positions[indices[index]];
    const b = positions[indices[index + 1]];
    const c = positions[indices[index + 2]];
    if (a === undefined || b === undefined || c === undefined) {
      throw new GltfGeometryImportError("A triangle index exceeds POSITION bounds.");
    }
    triangles.push({ a, b, c });
  }
  return triangles;
}

function rootNodes(document: GltfDocument): number[] {
  const scenes = document.scenes ?? [];
  if (scenes.length > 0) {
    const sceneIndex = document.scene ?? 0;
    const scene = scenes[sceneIndex];
    if (scene === undefined) {
      throw new GltfGeometryImportError(`Scene ${sceneIndex} does not exist.`);
    }
    return scene.nodes ?? [];
  }
  const childNodes = new Set(
    (document.nodes ?? []).flatMap((node) => node.children ?? []),
  );
  return (document.nodes ?? [])
    .map((_, index) => index)
    .filter((index) => !childNodes.has(index));
}

export function importMapGeometryFromGltf(
  document: GltfDocument,
  buffers: Uint8Array[],
  options: GltfGeometryImportOptions,
): GltfGeometryImportResult {
  if (document.asset?.version !== "2.0") {
    throw new GltfGeometryImportError("Only glTF 2.0 documents are supported.");
  }
  if (
    options.map.trim().length === 0 ||
    options.geometryId.trim().length === 0
  ) {
    throw new GltfGeometryImportError("Map and geometry identifiers are required.");
  }
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new GltfGeometryImportError("Geometry scale must be finite and positive.");
  }
  const resolvedOptions = {
    convertYUpToSource: options.convertYUpToSource ?? true,
    scale,
  };
  const triangles: GeometryTriangle[] = [];
  let meshInstanceCount = 0;
  let primitiveCount = 0;
  const visiting = new Set<number>();
  const visitNode = (nodeIndex: number, parentMatrix: Matrix4): void => {
    if (visiting.has(nodeIndex)) {
      throw new GltfGeometryImportError("The glTF node hierarchy contains a cycle.");
    }
    const node = document.nodes?.[nodeIndex];
    if (node === undefined) {
      throw new GltfGeometryImportError(`Node ${nodeIndex} does not exist.`);
    }
    visiting.add(nodeIndex);
    const worldMatrix = multiplyMatrices(parentMatrix, nodeMatrix(node));
    if (node.mesh !== undefined) {
      const mesh = document.meshes?.[node.mesh];
      if (mesh === undefined) {
        throw new GltfGeometryImportError(`Mesh ${node.mesh} does not exist.`);
      }
      meshInstanceCount++;
      for (const primitive of mesh.primitives) {
        primitiveCount++;
        triangles.push(
          ...primitiveTriangles(
            document,
            buffers,
            primitive,
            worldMatrix,
            resolvedOptions,
          ),
        );
      }
    }
    for (const child of node.children ?? []) visitNode(child, worldMatrix);
    visiting.delete(nodeIndex);
  };
  for (const root of rootNodes(document)) visitNode(root, IDENTITY_MATRIX);
  if (triangles.length === 0) {
    throw new GltfGeometryImportError("The glTF scene contains no triangles.");
  }
  return {
    geometry: {
      map: options.map,
      geometryId: options.geometryId,
      triangles,
    },
    meshInstanceCount,
    primitiveCount,
    triangleCount: triangles.length,
  };
}

export function parseGlb(bytes: Uint8Array): {
  document: GltfDocument;
  binaryChunk: Uint8Array;
} {
  if (bytes.byteLength < 20) {
    throw new GltfGeometryImportError("GLB payload is too short.");
  }
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (data.getUint32(0, true) !== GLB_MAGIC) {
    throw new GltfGeometryImportError("Invalid GLB magic.");
  }
  if (data.getUint32(4, true) !== 2) {
    throw new GltfGeometryImportError("Only GLB version 2 is supported.");
  }
  const declaredLength = data.getUint32(8, true);
  if (declaredLength !== bytes.byteLength) {
    throw new GltfGeometryImportError("GLB declared length does not match its payload.");
  }
  let offset = 12;
  let document: GltfDocument | null = null;
  let binaryChunk: Uint8Array = new Uint8Array();
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      throw new GltfGeometryImportError("GLB chunk header is truncated.");
    }
    const chunkLength = data.getUint32(offset, true);
    const chunkType = data.getUint32(offset + 4, true);
    offset += 8;
    if (offset + chunkLength > bytes.byteLength) {
      throw new GltfGeometryImportError("GLB chunk exceeds its payload.");
    }
    const chunk = bytes.subarray(offset, offset + chunkLength);
    if (chunkType === GLB_JSON_CHUNK) {
      if (document !== null) {
        throw new GltfGeometryImportError("GLB contains more than one JSON chunk.");
      }
      try {
        document = JSON.parse(new TextDecoder().decode(chunk).trim());
      } catch {
        throw new GltfGeometryImportError("GLB JSON chunk is invalid.");
      }
    } else if (chunkType === GLB_BIN_CHUNK && binaryChunk.byteLength === 0) {
      binaryChunk = chunk;
    }
    offset += chunkLength;
  }
  if (document === null) {
    throw new GltfGeometryImportError("GLB has no JSON chunk.");
  }
  return { document, binaryChunk };
}
