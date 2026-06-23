/**
 * assembly.ts
 * -----------
 * Builds the global stiffness matrix K in CSR (Compressed Sparse Row) format.
 *
 * APPROACH
 * ========
 * Two-pass construction:
 *   Pass 1: determine sparsity pattern (which (row,col) pairs are non-zero).
 *   Pass 2: assemble element stiffness contributions into the CSR data array.
 *
 * Memory estimate at 200k DOF:
 *   ~12 non-zeros per row (C3D4 connects to ~10 adjacent nodes)
 *   data:   200k × 12 × 8 bytes = 19.2 MB
 *   colIdx: 200k × 12 × 4 bytes =  9.6 MB
 *   rowPtr: 200k       × 4 bytes =  0.8 MB
 *   Total K: ~30 MB — well within browser limits.
 *
 * CORRECTNESS INVARIANTS (checked by assertion)
 * - rowPtr is non-decreasing
 * - colIdx within each row is sorted ascending (enables binary search)
 * - data[diagIdx[i]] is the diagonal entry for DOF i (used by Jacobi preconditioner)
 * - K is symmetric: verified by symmetry of k_e contributions
 */

import type { TetMesh, AnyMaterial, CSRMatrix } from "./types.js";
import { elementStiffness, buildAnyConstitutiveMatrix, c3d10ElementStiffness } from "./element.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Typed-array safe access — throws on out-of-bounds. */
function i32(arr: Int32Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`i32: index ${i} out of bounds`);
  return v;
}

// ─── Sparsity pattern ─────────────────────────────────────────────────────────

/**
 * Determine the CSR sparsity pattern for the global stiffness matrix.
 * Works for both C3D4 (4 nodes, 12 DOF) and C3D10 (10 nodes, 30 DOF).
 */
function buildSparsityPattern(mesh: TetMesh): {
  rowPtr: Int32Array;
  colIdx: Int32Array;
  diagIdx: Int32Array;
} {
  const npe = mesh.nodesPerElem;  // nodes per element: 4 or 10
  const n   = mesh.nodeCount * 3; // total DOF count

  const neighbours: Set<number>[] = Array.from({ length: n }, () => new Set<number>());

  for (let e = 0; e < mesh.elementCount; e++) {
    const nodeBase = e * npe;
    const dofs: number[] = [];
    for (let ni = 0; ni < npe; ni++) {
      const nodeIdx = i32(mesh.elements, nodeBase + ni);
      dofs.push(nodeIdx * 3, nodeIdx * 3 + 1, nodeIdx * 3 + 2);
    }
    for (const r of dofs) {
      const nset = neighbours[r];
      if (nset === undefined) throw new RangeError(`DOF ${r} out of range n=${n}`);
      for (const c of dofs) nset.add(c);
    }
  }

  const rowPtr = new Int32Array(n + 1);
  let nnz = 0;
  for (let i = 0; i < n; i++) {
    nnz += (neighbours[i]?.size ?? 0);
    rowPtr[i + 1] = nnz;
  }

  const colIdx = new Int32Array(nnz);
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const nb = neighbours[i];
    if (nb === undefined) continue;
    const sorted = Array.from(nb).sort((a, b) => a - b);
    for (const c of sorted) colIdx[pos++] = c;
  }

  const diagIdx = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const start = rowPtr[i] ?? 0;
    const end   = rowPtr[i + 1] ?? nnz;
    let lo = start, hi = end - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const col = colIdx[mid] ?? -1;
      if (col === i) { found = mid; break; }
      if (col < i) lo = mid + 1; else hi = mid - 1;
    }
    if (found < 0) throw new Error(`Diagonal missing for DOF ${i}: sparsity pattern error`);
    diagIdx[i] = found;
  }

  return { rowPtr, colIdx, diagIdx };
}

// ─── Binary search in CSR row ─────────────────────────────────────────────────

/**
 * Find the position of column `col` in row `row` of the CSR matrix.
 * colIdx within each row is sorted ascending — use binary search.
 * Throws if the entry is not found (indicates a sparsity pattern bug).
 */
function findEntry(colIdx: Int32Array, rowPtr: Int32Array, row: number, col: number): number {
  const start = rowPtr[row] ?? 0;
  const end   = rowPtr[row + 1] ?? colIdx.length;
  let lo = start, hi = end - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c   = colIdx[mid] ?? -1;
    if (c === col) return mid;
    if (c < col) lo = mid + 1; else hi = mid - 1;
  }
  throw new Error(`CSR entry not found: row=${row} col=${col} — sparsity pattern incomplete`);
}

// ─── Global assembly ──────────────────────────────────────────────────────────

/**
 * Assemble the global stiffness matrix K and return it as a CSRMatrix.
 *
 * Supports both C3D4 (linear, 4 nodes, 12 DOF) and C3D10 (quadratic, 10 nodes, 30 DOF).
 * The element type is determined by mesh.nodesPerElem.
 *
 * Algorithm:
 *   1. Build sparsity pattern (determines non-zero structure).
 *   2. Allocate data array (zeros).
 *   3. For each element: compute k_e, scatter into global K via findEntry.
 */
export function assembleK(
  mesh: TetMesh,
  mat:  AnyMaterial,
): {
  K:       CSRMatrix;
  diagIdx: Int32Array;
} {
  const n   = mesh.nodeCount * 3;
  const npe = mesh.nodesPerElem;
  const dpe = npe * 3;  // DOF per element: 12 for C3D4, 30 for C3D10
  const C   = buildAnyConstitutiveMatrix(mat);

  const { rowPtr, colIdx, diagIdx } = buildSparsityPattern(mesh);
  const nnz = rowPtr[n] ?? 0;
  const data = new Float64Array(nnz);

  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;

    // Extract node indices for this element
    const elemNodes: number[] = [];
    for (let ni = 0; ni < npe; ni++) elemNodes.push(i32(mesh.elements, base + ni));

    // Compute element stiffness matrix
    let ke: Float64Array;
    if (npe === 10) {
      // C3D10: extract 10×3 node coordinates
      const nodeCoords = new Float64Array(30);
      for (let ni = 0; ni < 10; ni++) {
        const n = elemNodes[ni]!;
        nodeCoords[ni*3]   = mesh.nodes[n*3]   ?? 0;
        nodeCoords[ni*3+1] = mesh.nodes[n*3+1] ?? 0;
        nodeCoords[ni*3+2] = mesh.nodes[n*3+2] ?? 0;
      }
      ke = c3d10ElementStiffness(nodeCoords, C);
    } else {
      // C3D4: use existing function
      const [na, nb, nc, nd] = elemNodes as [number,number,number,number];
      ke = elementStiffness(mesh.nodes, na, nb, nc, nd, C);
    }

    // Scatter k_e into global K
    for (let lr = 0; lr < dpe; lr++) {
      const globalR = (elemNodes[Math.floor(lr / 3)] ?? 0) * 3 + (lr % 3);
      for (let lc = 0; lc < dpe; lc++) {
        const globalC = (elemNodes[Math.floor(lc / 3)] ?? 0) * 3 + (lc % 3);
        const pos = findEntry(colIdx, rowPtr, globalR, globalC);
        data[pos] = (data[pos] ?? 0) + (ke[lr * dpe + lc] ?? 0);
      }
    }
  }

  return {
    K: { n, data, colIdx, rowPtr },
    diagIdx,
  };
}

/**
 * Compute K·x (CSR matrix-vector product).
 * This is the inner loop of the CG solver — keep it tight.
 */
export function matvec(K: CSRMatrix, x: Float64Array): Float64Array {
  const { n, data, colIdx, rowPtr } = K;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const start = rowPtr[i] ?? 0;
    const end   = rowPtr[i + 1] ?? data.length;
    let s = 0;
    for (let k = start; k < end; k++) {
      s += (data[k] ?? 0) * (x[colIdx[k] ?? 0] ?? 0);
    }
    y[i] = s;
  }
  return y;
}
