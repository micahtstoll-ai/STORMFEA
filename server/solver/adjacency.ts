/**
 * adjacency.ts
 * ------------
 * Node → element adjacency for tetrahedral meshes (C3D4 and C3D10).
 *
 * Built ONCE per mesh in O(elementCount × nodesPerElem), then any consumer can
 * look up "which elements touch node n" in O(1) + O(#adjacent elements).
 *
 * This replaces per-query scans over ALL elements (issue #104: the error-
 * estimate vertex mapping did an O(V × nodes × elements) brute-force search,
 * accounting for ~98% of analysis wall time on real meshes).
 */

import type { TetMesh } from "./types.js";

/** CSR-style node → element adjacency. */
export interface NodeElementAdjacency {
  /** ptr.length === nodeCount + 1. Elements adjacent to node n are list[ptr[n] .. ptr[n+1]-1]. */
  readonly ptr:  Int32Array;
  /** Element indices, grouped per node, ascending within each node's range. */
  readonly list: Int32Array;
}

/**
 * Build node → element adjacency in CSR form (typed arrays, two passes).
 *
 * @param nodesPerElemToUse Optionally restrict to the first k nodes of each
 *        element (e.g. 4 to consider only corner nodes of C3D10 elements).
 *        Defaults to all nodes per element.
 */
export function buildNodeElementAdjacency(
  mesh: TetMesh,
  nodesPerElemToUse?: number,
): NodeElementAdjacency {
  const npe = mesh.nodesPerElem ?? 4;
  const use = Math.min(nodesPerElemToUse ?? npe, npe);

  // Pass 1: count elements per node (shifted by one so counts becomes ptr in-place).
  const ptr = new Int32Array(mesh.nodeCount + 1);
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    for (let ni = 0; ni < use; ni++) {
      const slot = (mesh.elements[base + ni] ?? 0) + 1;
      ptr[slot] = (ptr[slot] ?? 0) + 1;
    }
  }
  for (let i = 0; i < mesh.nodeCount; i++) {
    ptr[i + 1] = (ptr[i + 1] ?? 0) + (ptr[i] ?? 0);
  }

  // Pass 2: fill list using a moving cursor per node. Iterating elements in
  // ascending order keeps each node's element list ascending too.
  const list = new Int32Array(ptr[mesh.nodeCount] ?? 0);
  const cursor = ptr.slice(0, mesh.nodeCount);
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    for (let ni = 0; ni < use; ni++) {
      const n = mesh.elements[base + ni] ?? 0;
      const at = cursor[n] ?? 0;
      list[at] = e;
      cursor[n] = at + 1;
    }
  }

  return { ptr, list };
}

/**
 * Map each mesh edge (a corner-node pair) to the mid-side node that sits on it,
 * for a C3D10 (10-node quadratic tet) mesh. Returns `null` for a linear C3D4
 * mesh (no mid-side nodes exist).
 *
 * STORMFEA's C3D10 local ordering pairs mid-side slots with corner edges as
 *   slot 4 = mid(0,1), 5 = mid(1,2), 6 = mid(0,2),
 *   slot 7 = mid(0,3), 8 = mid(1,3), 9 = mid(2,3)
 * (element.ts c3d10ShapeFunctions; tetgen.ts C3D10_REORDER). A conforming
 * quadratic mesh has exactly ONE mid-side node per geometric edge — both tets
 * sharing an edge reference the same global node — so this global map is
 * single-valued. Consumers that hold a boundary corner-triangle (a,b,c) can
 * therefore recover its 3 mid-side nodes by looking up edges (a,b),(b,c),(c,a),
 * which is all the T6 surface-load integral needs (load.ts).
 *
 * Key = lo·nodeCount + hi with lo<hi the sorted global corner indices (unique
 * for nodeCount up to ~9.4e7, well beyond any real mesh).
 */
export function buildEdgeMidsideMap(mesh: TetMesh): Map<number, number> | null {
  if ((mesh.nodesPerElem ?? 4) !== 10) return null;
  const { elements, elementCount, nodeCount } = mesh;
  // [cornerSlotA, cornerSlotB, midSlot] for the 6 edges of a C3D10 tet.
  const EDGES: readonly (readonly [number, number, number])[] = [
    [0, 1, 4], [1, 2, 5], [0, 2, 6], [0, 3, 7], [1, 3, 8], [2, 3, 9],
  ];
  const map = new Map<number, number>();
  for (let e = 0; e < elementCount; e++) {
    const base = e * 10;
    for (const [ca, cb, cm] of EDGES) {
      const a = elements[base + ca] ?? 0;
      const b = elements[base + cb] ?? 0;
      const lo = a < b ? a : b, hi = a < b ? b : a;
      map.set(lo * nodeCount + hi, elements[base + cm] ?? 0);
    }
  }
  return map;
}

/** CSR-style triangle → neighbouring-triangle adjacency over a surface. */
export interface TriangleAdjacency {
  /** ptr[t] .. ptr[t+1] indexes `list` for triangle t. Length triCount+1. */
  ptr:  Int32Array;
  /** Neighbouring triangle ids, grouped by triangle. */
  list: Int32Array;
}

/**
 * Edge adjacency over a boundary-triangle list — which triangles share an edge
 * with which.
 *
 * This is what makes "the same surface as this point" answerable without a
 * geodesic: a patch grown by EDGE ADJACENCY from a seed triangle cannot cross
 * to the far side of the material, because the far side is not edge-connected
 * to the near side except around the part's rim. A purely Euclidean ball has no
 * such property — it reaches straight through a thin part (`load.ts`,
 * `assembleContactPatchLoad`).
 *
 * Keyed on the two CORNER node indices of each edge (lo·nodeCount + hi, the same
 * scheme as `buildEdgeMidsideMap`), so it works for C3D4 and C3D10 alike — the
 * boundary-triangle list carries corners only in both cases. A non-manifold edge
 * (more than two triangles) links all of them; a degenerate triangle with a
 * repeated corner simply contributes a self-edge, which is filtered out.
 */
export function buildSurfaceTriangleAdjacency(
  faces:     Int32Array,
  nodeCount: number,
): TriangleAdjacency {
  const triCount = Math.floor(faces.length / 3);
  const key = (p: number, q: number): number => (p < q ? p * nodeCount + q : q * nodeCount + p);

  // edge → the triangles on it
  const edgeTris = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const a = faces[t*3] ?? 0, b = faces[t*3+1] ?? 0, c = faces[t*3+2] ?? 0;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      if (p === q) continue;                      // degenerate edge
      const k = key(p, q);
      const l = edgeTris.get(k);
      if (l) l.push(t); else edgeTris.set(k, [t]);
    }
  }

  const ptr = new Int32Array(triCount + 1);
  for (const tris of edgeTris.values()) {
    if (tris.length < 2) continue;
    for (const t of tris) ptr[t + 1] = (ptr[t + 1] ?? 0) + tris.length - 1;
  }
  for (let t = 0; t < triCount; t++) ptr[t + 1] = (ptr[t + 1] ?? 0) + (ptr[t] ?? 0);

  const list   = new Int32Array(ptr[triCount] ?? 0);
  const cursor = Int32Array.from(ptr.subarray(0, triCount));
  for (const tris of edgeTris.values()) {
    if (tris.length < 2) continue;
    for (const t of tris) {
      for (const u of tris) {
        if (u === t) continue;
        const at = cursor[t] ?? 0;
        list[at] = u;
        cursor[t] = at + 1;
      }
    }
  }

  return { ptr, list };
}

/**
 * Build node → element adjacency as plain arrays (number[][]).
 * Convenience form for consumers that iterate patches with for..of
 * (SPR patch recovery). Element ids within each node's list are ascending.
 */
export function buildNodeElementLists(mesh: TetMesh): number[][] {
  const npe = mesh.nodesPerElem ?? 4;
  const nodeElements: number[][] = Array.from({ length: mesh.nodeCount }, () => []);
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    for (let ni = 0; ni < npe; ni++) {
      const nodeIdx = mesh.elements[base + ni] ?? 0;
      nodeElements[nodeIdx]!.push(e);
    }
  }
  return nodeElements;
}
