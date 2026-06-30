/**
 * meshgen.ts
 * ----------
 * Deterministic C3D4 tetrahedral mesh generator for a rectangular box.
 * Used exclusively for tests — no dependency on TetGen or any external library.
 *
 * SUBDIVISION STRATEGY
 * ====================
 * The box is divided into nx × ny × nz hexahedral cells.
 * Each hexahedral cell is split into 6 tetrahedra using a consistent
 * Delaunay-compatible decomposition (type-1 subdivision, see Dompierre et al. 1999).
 *
 * Type-1 hex → 6 tet decomposition (by node index parity):
 *   For each hex with local nodes [v0..v7] in the standard ordering:
 *     v0 = (i,   j,   k)
 *     v1 = (i+1, j,   k)
 *     v2 = (i+1, j+1, k)
 *     v3 = (i,   j+1, k)
 *     v4 = (i,   j,   k+1)
 *     v5 = (i+1, j,   k+1)
 *     v6 = (i+1, j+1, k+1)
 *     v7 = (i,   j+1, k+1)
 *
 *   The 6 tets (chosen so all have positive volume with this ordering):
 *     T0: [v0, v1, v3, v4]
 *     T1: [v1, v2, v3, v6]
 *     T2: [v1, v3, v4, v6]
 *     T3: [v1, v5, v4, v6]   (v4 and v5 on top face, v6 corner)
 *     T4: [v3, v4, v6, v7]
 *     T5: [v0, v1, v3, v4]   ← recheck
 *
 * We use the 6-tet split from Kossaczky (1994) / Bey (1995) which guarantees
 * all 6 tets have positive volume when nodes are in the canonical ordering:
 *   T0: v0 v1 v2 v5
 *   T1: v0 v2 v3 v7
 *   T2: v0 v5 v7 v4
 *   T3: v2 v5 v7 v6
 *   T4: v0 v2 v5 v7  ← this gives only 5 unique tets
 *
 * ACTUALLY: the correct and simplest 6-tet split that always gives
 * positive volumes is based on the diagonal chosen for each face.
 * We use the split from Figure 1 of Dompierre et al. (1999):
 *   v0-v6 is the "long diagonal"
 *   T0: [v0, v5, v1, v6]
 *   T1: [v0, v1, v2, v6]   (wrong order — let me use the standard one below)
 *
 * SIMPLEST CORRECT APPROACH (used here):
 * Split each hex into 5 or 6 tets. We use the 6-tet split with explicit
 * positive-volume ordering, verified analytically for the unit cube.
 *
 * For hex nodes ordered as:
 *   Bottom face (z=k):  v0=(i,j,k), v1=(i+1,j,k), v2=(i+1,j+1,k), v3=(i,j+1,k)
 *   Top face (z=k+1):   v4=(i,j,k+1), v5=(i+1,j,k+1), v6=(i+1,j+1,k+1), v7=(i,j+1,k+1)
 *
 * The 6 positive-volume tets (verified):
 *   T0: v0, v1, v3, v4
 *   T1: v1, v2, v3, v6
 *   T2: v1, v3, v4, v6
 *   T3: v1, v5, v4, v6
 *   T4: v3, v4, v6, v7
 *   T5: v0, v4, v1, v5   ← not needed if 5-tet split is used
 *
 * We use the 5-tet split (Courant 1943) which divides each hex into exactly 5 tets.
 * This gives a slightly more uniform mesh:
 *   T0: v0, v1, v2, v5
 *   T1: v0, v2, v7, v5
 *   T2: v0, v2, v3, v7
 *   T3: v0, v5, v7, v4
 *   T4: v2, v7, v5, v6
 * All 5 have positive volume for the standard node ordering above. (Verified analytically.)
 */

import type { TetMesh } from "./types.js";

/**
 * Generate a structured C3D4 tetrahedral mesh of a rectangular box.
 *
 * @param x0,y0,z0  Corner of the box (mm)
 * @param x1,y1,z1  Opposite corner (mm)
 * @param nx,ny,nz  Number of divisions along each axis (≥ 1)
 *
 * Returns a TetMesh without a surfaceToNode map (not needed for tests).
 * For the patch test, use nx=ny=nz=2 (minimum for mesh-independence).
 */
export function generateBoxMesh(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  nx: number, ny: number, nz: number,
): TetMesh & { surfaceToNode: Int32Array } {
  if (nx < 1 || ny < 1 || nz < 1) throw new Error("Division counts must be ≥ 1");

  const Nx = nx + 1; // node count along x
  const Ny = ny + 1;
  const Nz = nz + 1;
  const nodeCount = Nx * Ny * Nz;

  const dx = (x1 - x0) / nx;
  const dy = (y1 - y0) / ny;
  const dz = (z1 - z0) / nz;

  // Build node positions
  const nodes = new Float64Array(nodeCount * 3);
  let ni = 0;
  for (let k = 0; k < Nz; k++) {
    for (let j = 0; j < Ny; j++) {
      for (let i = 0; i < Nx; i++) {
        nodes[ni * 3]     = x0 + i * dx;
        nodes[ni * 3 + 1] = y0 + j * dy;
        nodes[ni * 3 + 2] = z0 + k * dz;
        ni++;
      }
    }
  }

  // Node index at grid position (i,j,k)
  const nodeIdx = (i: number, j: number, k: number): number =>
    k * Ny * Nx + j * Nx + i;

  // Each hex cell → 5 tetrahedra
  const elementCount = nx * ny * nz * 5;
  const elements = new Int32Array(elementCount * 4);
  let ei = 0;

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        // 8 hex corner nodes
        const v0 = nodeIdx(i,   j,   k);
        const v1 = nodeIdx(i+1, j,   k);
        const v2 = nodeIdx(i+1, j+1, k);
        const v3 = nodeIdx(i,   j+1, k);
        const v4 = nodeIdx(i,   j,   k+1);
        const v5 = nodeIdx(i+1, j,   k+1);
        const v6 = nodeIdx(i+1, j+1, k+1);
        const v7 = nodeIdx(i,   j+1, k+1);

        // 5-tet decomposition (all positive volume verified analytically)
        // T0: v0 v1 v2 v5
        elements[ei*4]   = v0; elements[ei*4+1] = v1;
        elements[ei*4+2] = v2; elements[ei*4+3] = v5; ei++;
        // T1: v0 v2 v7 v5
        elements[ei*4]   = v0; elements[ei*4+1] = v2;
        elements[ei*4+2] = v7; elements[ei*4+3] = v5; ei++;
        // T2: v0 v2 v3 v7
        elements[ei*4]   = v0; elements[ei*4+1] = v2;
        elements[ei*4+2] = v3; elements[ei*4+3] = v7; ei++;
        // T3: v0 v5 v7 v4
        elements[ei*4]   = v0; elements[ei*4+1] = v5;
        elements[ei*4+2] = v7; elements[ei*4+3] = v4; ei++;
        // T4: v2 v7 v5 v6
        elements[ei*4]   = v2; elements[ei*4+1] = v7;
        elements[ei*4+2] = v5; elements[ei*4+3] = v6; ei++;
      }
    }
  }

  // surfaceToNode is identity for tests (surface mesh = node list)
  const surfaceToNode = new Int32Array(nodeCount);
  for (let n = 0; n < nodeCount; n++) surfaceToNode[n] = n;

  return {
    nodes,
    elements,
    nodeCount,
    elementCount,
    nodesPerElem: 4,
    surfaceToNode,
  };
}

/**
 * Generate a structured C3D10 (10-node quadratic tet) mesh of a rectangular box.
 *
 * Uses a 6-tet body-diagonal split per hex cell.  All 6 tets share the v0-v6
 * body diagonal (from corner (i,j,k) to corner (i+1,j+1,k+1)).  This split is
 * globally conforming for C3D10: the face diagonal on every shared quad face is
 * the same from both adjacent hexes, so midpoint nodes on shared faces are
 * identical.  The 5-tet split used by generateBoxMesh is NOT conforming for
 * C3D10 (adjacent hexes pick different face diagonals).
 *
 * 6-tet split (body diagonal v0–v6, all tets have positive volume):
 *   T0: [v0, v6, v1, v2]
 *   T1: [v0, v6, v2, v3]
 *   T2: [v0, v6, v3, v7]
 *   T3: [v0, v6, v7, v4]
 *   T4: [v0, v6, v4, v5]
 *   T5: [v0, v6, v5, v1]
 *
 * STORMFEA C3D10 midpoint ordering for tet [n0,n1,n2,n3]:
 *   node 4 = mid(n0,n1), 5 = mid(n1,n2), 6 = mid(n0,n2)
 *   node 7 = mid(n0,n3), 8 = mid(n1,n3), 9 = mid(n2,n3)
 */
export function generateBoxMeshC3D10(
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
  nx: number, ny: number, nz: number,
): TetMesh & { surfaceToNode: Int32Array } {
  if (nx < 1 || ny < 1 || nz < 1) throw new Error("Division counts must be ≥ 1");

  const Nx = nx + 1;
  const Ny = ny + 1;
  const Nz = nz + 1;
  const cornerCount = Nx * Ny * Nz;

  const dx = (x1 - x0) / nx;
  const dy = (y1 - y0) / ny;
  const dz = (z1 - z0) / nz;

  const cornerNodes = new Float64Array(cornerCount * 3);
  let ni = 0;
  for (let k = 0; k < Nz; k++) {
    for (let j = 0; j < Ny; j++) {
      for (let i = 0; i < Nx; i++) {
        cornerNodes[ni * 3]     = x0 + i * dx;
        cornerNodes[ni * 3 + 1] = y0 + j * dy;
        cornerNodes[ni * 3 + 2] = z0 + k * dz;
        ni++;
      }
    }
  }

  const cornerIdx = (i: number, j: number, k: number): number =>
    k * Ny * Nx + j * Nx + i;

  const elementCount = nx * ny * nz * 6;
  const elemConnFlat = new Int32Array(elementCount * 10);
  let ei = 0;

  // Edge midpoint cache: sorted edge (lo,hi) → midpoint node index
  const midMap = new Map<number, number>();
  let nextMidIdx = cornerCount;
  const midXYZ: number[] = [];

  const getMid = (a: number, b: number): number => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const key = lo * (cornerCount + 1) + hi;
    let idx = midMap.get(key);
    if (idx !== undefined) return idx;
    idx = nextMidIdx++;
    midMap.set(key, idx);
    const ax = cornerNodes[a * 3]!,    ay = cornerNodes[a * 3 + 1]!,    az = cornerNodes[a * 3 + 2]!;
    const bx = cornerNodes[b * 3]!,    by = cornerNodes[b * 3 + 1]!,    bz = cornerNodes[b * 3 + 2]!;
    midXYZ.push((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    return idx;
  };

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v0 = cornerIdx(i,   j,   k);
        const v1 = cornerIdx(i+1, j,   k);
        const v2 = cornerIdx(i+1, j+1, k);
        const v3 = cornerIdx(i,   j+1, k);
        const v4 = cornerIdx(i,   j,   k+1);
        const v5 = cornerIdx(i+1, j,   k+1);
        const v6 = cornerIdx(i+1, j+1, k+1);
        const v7 = cornerIdx(i,   j+1, k+1);

        // 6-tet body-diagonal split — all share edge v0-v6
        const tets: [number, number, number, number][] = [
          [v0, v6, v1, v2],
          [v0, v6, v2, v3],
          [v0, v6, v3, v7],
          [v0, v6, v7, v4],
          [v0, v6, v4, v5],
          [v0, v6, v5, v1],
        ];

        for (const [n0, n1, n2, n3] of tets) {
          const base = ei * 10;
          // Corners
          elemConnFlat[base]     = n0;
          elemConnFlat[base + 1] = n1;
          elemConnFlat[base + 2] = n2;
          elemConnFlat[base + 3] = n3;
          // Edge midpoints: 4=mid(n0,n1), 5=mid(n1,n2), 6=mid(n0,n2)
          //                 7=mid(n0,n3), 8=mid(n1,n3), 9=mid(n2,n3)
          elemConnFlat[base + 4] = getMid(n0, n1);
          elemConnFlat[base + 5] = getMid(n1, n2);
          elemConnFlat[base + 6] = getMid(n0, n2);
          elemConnFlat[base + 7] = getMid(n0, n3);
          elemConnFlat[base + 8] = getMid(n1, n3);
          elemConnFlat[base + 9] = getMid(n2, n3);
          ei++;
        }
      }
    }
  }

  const midCount = midXYZ.length / 3;
  const nodeCount = cornerCount + midCount;
  const nodes = new Float64Array(nodeCount * 3);
  nodes.set(cornerNodes);
  for (let m = 0; m < midXYZ.length; m++) nodes[cornerCount * 3 + m] = midXYZ[m]!;

  const surfaceToNode = new Int32Array(nodeCount);
  for (let n = 0; n < nodeCount; n++) surfaceToNode[n] = n;

  return {
    nodes,
    elements: elemConnFlat,
    nodeCount,
    elementCount,
    nodesPerElem: 10,
    surfaceToNode,
  };
}

/**
 * Return all node indices where z ≈ target (within tolerance).
 * Used to identify the constrained face (z=z0) and loaded face (z=z1).
 */
export function getNodesAtZ(
  mesh: TetMesh,
  zTarget: number,
  tol = 1e-9,
): number[] {
  const result: number[] = [];
  for (let n = 0; n < mesh.nodeCount; n++) {
    const z = mesh.nodes[n * 3 + 2] ?? 0;
    if (Math.abs(z - zTarget) < tol) result.push(n);
  }
  return result;
}

/**
 * Return all node indices where z ≤ target (within tolerance).
 * Alias for the fixed face.
 */
export function getNodesOnFace(
  mesh:   TetMesh,
  axis:   "x" | "y" | "z",
  value:  number,
  tol     = 1e-9,
): number[] {
  const axisIdx = axis === "x" ? 0 : axis === "y" ? 1 : 2;
  const result: number[] = [];
  for (let n = 0; n < mesh.nodeCount; n++) {
    const v = mesh.nodes[n * 3 + axisIdx] ?? 0;
    if (Math.abs(v - value) < tol) result.push(n);
  }
  return result;
}
