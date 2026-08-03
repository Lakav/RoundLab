export type Vector3 = {
  x: number;
  y: number;
  z: number;
};

export type GeometryTriangle = {
  a: Vector3;
  b: Vector3;
  c: Vector3;
};

export type MapGeometry = {
  map: string;
  geometryId: string;
  triangles: GeometryTriangle[];
};

const INTERSECTION_EPSILON = 1e-7;
const BVH_LEAF_TRIANGLE_COUNT = 8;

type AxisAlignedBounds = {
  min: Vector3;
  max: Vector3;
};

type BvhEntry = {
  triangle: GeometryTriangle;
  bounds: AxisAlignedBounds;
  centroid: Vector3;
};

type BvhNode = {
  bounds: AxisAlignedBounds;
  left: BvhNode | null;
  right: BvhNode | null;
  triangles: GeometryTriangle[];
};

export type MapGeometryIndexStats = {
  triangleCount: number;
  nodeCount: number;
  leafCount: number;
  maxDepth: number;
};

const geometryIndexCache = new WeakMap<MapGeometry, BvhNode | null>();

function subtract(left: Vector3, right: Vector3): Vector3 {
  return {
    x: left.x - right.x,
    y: left.y - right.y,
    z: left.z - right.z,
  };
}

function cross(left: Vector3, right: Vector3): Vector3 {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function dot(left: Vector3, right: Vector3): number {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function finiteVector(vector: Vector3): boolean {
  return (
    Number.isFinite(vector.x) &&
    Number.isFinite(vector.y) &&
    Number.isFinite(vector.z)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isVector3(value: unknown): value is Vector3 {
  return (
    isRecord(value) &&
    typeof value.x === "number" &&
    typeof value.y === "number" &&
    typeof value.z === "number" &&
    finiteVector(value as Vector3)
  );
}

export function validMapGeometry(geometry: unknown): geometry is MapGeometry {
  return (
    isRecord(geometry) &&
    typeof geometry.map === "string" &&
    geometry.map.trim().length > 0 &&
    typeof geometry.geometryId === "string" &&
    geometry.geometryId.trim().length > 0 &&
    Array.isArray(geometry.triangles) &&
    geometry.triangles.every(
      (triangle) =>
        isRecord(triangle) &&
        isVector3(triangle.a) &&
        isVector3(triangle.b) &&
        isVector3(triangle.c),
    )
  );
}

export function segmentIntersectsTriangle(
  start: Vector3,
  end: Vector3,
  triangle: GeometryTriangle,
): boolean {
  const direction = subtract(end, start);
  const edge1 = subtract(triangle.b, triangle.a);
  const edge2 = subtract(triangle.c, triangle.a);
  const directionCrossEdge2 = cross(direction, edge2);
  const determinant = dot(edge1, directionCrossEdge2);
  if (Math.abs(determinant) <= INTERSECTION_EPSILON) return false;

  const inverseDeterminant = 1 / determinant;
  const startOffset = subtract(start, triangle.a);
  const u = dot(startOffset, directionCrossEdge2) * inverseDeterminant;
  if (u < -INTERSECTION_EPSILON || u > 1 + INTERSECTION_EPSILON) return false;

  const startOffsetCrossEdge1 = cross(startOffset, edge1);
  const v = dot(direction, startOffsetCrossEdge1) * inverseDeterminant;
  if (v < -INTERSECTION_EPSILON || u + v > 1 + INTERSECTION_EPSILON) {
    return false;
  }

  const distanceAlongSegment =
    dot(edge2, startOffsetCrossEdge1) * inverseDeterminant;
  return (
    distanceAlongSegment > INTERSECTION_EPSILON &&
    distanceAlongSegment < 1 - INTERSECTION_EPSILON
  );
}

function triangleBounds(triangle: GeometryTriangle): AxisAlignedBounds {
  return {
    min: {
      x: Math.min(triangle.a.x, triangle.b.x, triangle.c.x),
      y: Math.min(triangle.a.y, triangle.b.y, triangle.c.y),
      z: Math.min(triangle.a.z, triangle.b.z, triangle.c.z),
    },
    max: {
      x: Math.max(triangle.a.x, triangle.b.x, triangle.c.x),
      y: Math.max(triangle.a.y, triangle.b.y, triangle.c.y),
      z: Math.max(triangle.a.z, triangle.b.z, triangle.c.z),
    },
  };
}

function combinedBounds(entries: BvhEntry[]): AxisAlignedBounds {
  const first = entries[0].bounds;
  const bounds: AxisAlignedBounds = {
    min: { ...first.min },
    max: { ...first.max },
  };
  for (let index = 1; index < entries.length; index++) {
    const entry = entries[index].bounds;
    bounds.min.x = Math.min(bounds.min.x, entry.min.x);
    bounds.min.y = Math.min(bounds.min.y, entry.min.y);
    bounds.min.z = Math.min(bounds.min.z, entry.min.z);
    bounds.max.x = Math.max(bounds.max.x, entry.max.x);
    bounds.max.y = Math.max(bounds.max.y, entry.max.y);
    bounds.max.z = Math.max(bounds.max.z, entry.max.z);
  }
  return bounds;
}

function longestAxis(bounds: AxisAlignedBounds): keyof Vector3 {
  const x = bounds.max.x - bounds.min.x;
  const y = bounds.max.y - bounds.min.y;
  const z = bounds.max.z - bounds.min.z;
  if (x >= y && x >= z) return "x";
  return y >= z ? "y" : "z";
}

function buildBvh(entries: BvhEntry[]): BvhNode {
  const bounds = combinedBounds(entries);
  if (entries.length <= BVH_LEAF_TRIANGLE_COUNT) {
    return {
      bounds,
      left: null,
      right: null,
      triangles: entries.map((entry) => entry.triangle),
    };
  }
  const axis = longestAxis(bounds);
  entries.sort(
    (left, right) =>
      left.centroid[axis] - right.centroid[axis],
  );
  const middle = Math.floor(entries.length / 2);
  return {
    bounds,
    left: buildBvh(entries.slice(0, middle)),
    right: buildBvh(entries.slice(middle)),
    triangles: [],
  };
}

function geometryIndex(geometry: MapGeometry): BvhNode | null {
  const cached = geometryIndexCache.get(geometry);
  if (cached !== undefined || geometryIndexCache.has(geometry)) return cached ?? null;
  if (geometry.triangles.length === 0) {
    geometryIndexCache.set(geometry, null);
    return null;
  }
  const entries = geometry.triangles.map((triangle) => {
    const bounds = triangleBounds(triangle);
    return {
      triangle,
      bounds,
      centroid: {
        x: (bounds.min.x + bounds.max.x) / 2,
        y: (bounds.min.y + bounds.max.y) / 2,
        z: (bounds.min.z + bounds.max.z) / 2,
      },
    };
  });
  const root = buildBvh(entries);
  geometryIndexCache.set(geometry, root);
  return root;
}

function segmentIntersectsBounds(
  start: Vector3,
  end: Vector3,
  bounds: AxisAlignedBounds,
): boolean {
  let minimum = 0;
  let maximum = 1;
  for (const axis of ["x", "y", "z"] as const) {
    const direction = end[axis] - start[axis];
    if (Math.abs(direction) <= INTERSECTION_EPSILON) {
      if (
        start[axis] < bounds.min[axis] ||
        start[axis] > bounds.max[axis]
      ) {
        return false;
      }
      continue;
    }
    const inverse = 1 / direction;
    let near = (bounds.min[axis] - start[axis]) * inverse;
    let far = (bounds.max[axis] - start[axis]) * inverse;
    if (near > far) [near, far] = [far, near];
    minimum = Math.max(minimum, near);
    maximum = Math.min(maximum, far);
    if (minimum > maximum) return false;
  }
  return true;
}

export function prepareMapGeometry(
  geometry: MapGeometry,
): MapGeometryIndexStats {
  const root = geometryIndex(geometry);
  if (root === null) {
    return {
      triangleCount: 0,
      nodeCount: 0,
      leafCount: 0,
      maxDepth: 0,
    };
  }
  let nodeCount = 0;
  let leafCount = 0;
  let maxDepth = 0;
  const pending: Array<{ node: BvhNode; depth: number }> = [{
    node: root,
    depth: 1,
  }];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    nodeCount++;
    maxDepth = Math.max(maxDepth, current.depth);
    if (current.node.left === null && current.node.right === null) {
      leafCount++;
    }
    if (current.node.left !== null) {
      pending.push({ node: current.node.left, depth: current.depth + 1 });
    }
    if (current.node.right !== null) {
      pending.push({ node: current.node.right, depth: current.depth + 1 });
    }
  }
  return {
    triangleCount: geometry.triangles.length,
    nodeCount,
    leafCount,
    maxDepth,
  };
}

export function hasClearLineOfSight(
  start: Vector3,
  end: Vector3,
  geometry: MapGeometry,
): boolean {
  const root = geometryIndex(geometry);
  if (root === null) return true;
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (
      node === undefined ||
      !segmentIntersectsBounds(start, end, node.bounds)
    ) {
      continue;
    }
    for (const triangle of node.triangles) {
      if (segmentIntersectsTriangle(start, end, triangle)) return false;
    }
    if (node.left !== null) pending.push(node.left);
    if (node.right !== null) pending.push(node.right);
  }
  return true;
}
