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
