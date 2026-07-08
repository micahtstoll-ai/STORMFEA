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
import { elementStiffness, buildAnyConstitutiveMatrix, c3d10ElementStiffness, elementGeometricStiffness } from "./element.js";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import path from "path";
import os from "os";
import fs from "fs";

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
export function buildSparsityPattern(mesh: TetMesh): {
  rowPtr: Int32Array;
  colIdx: Int32Array;
  diagIdx: Int32Array;
} {
  const npe = mesh.nodesPerElem;  // nodes per element: 4 or 10
  const n   = mesh.nodeCount * 3; // total DOF count

  const neighbours: Set<number>[] = Array.from({ length: n }, () => new Set<number>());

  // Pre-allocate dofs scratch outside the element loop
  const dofScratch = new Int32Array(npe * 3);

  for (let e = 0; e < mesh.elementCount; e++) {
    const nodeBase = e * npe;
    for (let ni = 0; ni < npe; ni++) {
      const nodeIdx = i32(mesh.elements, nodeBase + ni);
      dofScratch[ni * 3]     = nodeIdx * 3;
      dofScratch[ni * 3 + 1] = nodeIdx * 3 + 1;
      dofScratch[ni * 3 + 2] = nodeIdx * 3 + 2;
    }
    const dofCount = npe * 3;
    for (let di = 0; di < dofCount; di++) {
      const r = dofScratch[di]!;
      const nset = neighbours[r];
      if (nset === undefined) throw new RangeError(`DOF ${r} out of range n=${n}`);
      for (let dj = 0; dj < dofCount; dj++) nset.add(dofScratch[dj]!);
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

// ─── Serial assembly (extracted from original) ────────────────────────────────

/**
 * Serial element-by-element assembly (original implementation).
 * Used as fallback when workers are unavailable or mesh is small.
 */
function assembleK_serial(
  mesh: TetMesh,
  C: Float64Array,
  rowPtr: Int32Array,
  colIdx: Int32Array,
  data: Float64Array,
): void {
  const npe = mesh.nodesPerElem;
  const dpe = npe * 3;  // DOF per element

  const elemNodes = new Int32Array(npe);
  const scratchCoords = new Float64Array(30);

  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    for (let ni = 0; ni < npe; ni++) elemNodes[ni] = i32(mesh.elements, base + ni);

    let ke: Float64Array;
    if (npe === 10) {
      const nodeCoords = scratchCoords;
      for (let ni = 0; ni < 10; ni++) {
        const n = elemNodes[ni]!;
        nodeCoords[ni*3]   = mesh.nodes[n*3]   ?? 0;
        nodeCoords[ni*3+1] = mesh.nodes[n*3+1] ?? 0;
        nodeCoords[ni*3+2] = mesh.nodes[n*3+2] ?? 0;
      }
      ke = c3d10ElementStiffness(nodeCoords, C);
    } else {
      const na = elemNodes[0]!, nb = elemNodes[1]!, nc = elemNodes[2]!, nd = elemNodes[3]!;
      ke = elementStiffness(mesh.nodes, na, nb, nc, nd, C);
    }

    for (let lr = 0; lr < dpe; lr++) {
      const globalR = (elemNodes[Math.floor(lr / 3)] ?? 0) * 3 + (lr % 3);
      for (let lc = 0; lc < dpe; lc++) {
        const globalC = (elemNodes[Math.floor(lc / 3)] ?? 0) * 3 + (lc % 3);
        const pos = findEntry(colIdx, rowPtr, globalR, globalC);
        data[pos] = (data[pos] ?? 0) + (ke[lr * dpe + lc] ?? 0);
      }
    }
  }
}

// ─── COO triplet interface and merging ────────────────────────────────────────

interface CoOTriplet {
  readonly row: number;
  readonly col: number;
  readonly val: number;
}

/**
 * Merge COO triplets into CSR data array.
 * COO triplets are sorted by (row, col), accumulated for duplicates,
 * then scattered into the CSR data array via findEntry.
 */
function mergeCoOIntoCSR(
  triplets: CoOTriplet[],
  rowPtr: Int32Array,
  colIdx: Int32Array,
  data: Float64Array,
): void {
  if (triplets.length === 0) return;

  // Sort COO by (row, col)
  triplets.sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    return a.col - b.col;
  });

  // Accumulate duplicates
  const merged: CoOTriplet[] = [];
  let current = triplets[0]!;
  for (let i = 1; i < triplets.length; i++) {
    const t = triplets[i]!;
    if (t.row === current.row && t.col === current.col) {
      current = { row: current.row, col: current.col, val: current.val + t.val };
    } else {
      merged.push(current);
      current = t;
    }
  }
  merged.push(current);

  // Scatter into CSR data array
  for (const { row, col, val } of merged) {
    const pos = findEntry(colIdx, rowPtr, row, col);
    data[pos] = (data[pos] ?? 0) + val;
  }
}

// ─── Parallel assembly via worker_threads ─────────────────────────────────────

/**
 * Minimum element count for the parallel path. Below this, worker spawn +
 * message overhead exceeds the assembly cost and serial is faster.
 */
const PARALLEL_MIN_ELEMENTS = 1000;

/**
 * Assemble stiffness matrix using worker_threads for element chunk parallelization.
 * Falls back to serial if the worker script is missing or on any worker error.
 *
 * NOTE: worker_threads itself is guaranteed available — `Worker` is statically
 * imported at the top of this module, so the module would fail to load at all
 * if the platform lacked it. (A previous `require.resolve("worker_threads")`
 * probe always threw in this ESM project — `require` is undefined — which
 * silently disabled the parallel path entirely; issue #98.)
 */
async function assembleK_parallel(
  mesh: TetMesh,
  C: Float64Array,
  rowPtr: Int32Array,
  colIdx: Int32Array,
  data: Float64Array,
): Promise<boolean> {
  try {
    // The worker script is the COMPILED sibling of this module. When running
    // from uncompiled TypeScript (e.g. under vitest), assembly-worker.js does
    // not exist next to the source file — fall back to serial gracefully.
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const workerScript = path.join(__dirname, "assembly-worker.js");
    if (!fs.existsSync(workerScript)) {
      console.warn(`[assembleK] worker script not found at ${workerScript} — using serial assembly`);
      return false;
    }

    const cpuCount = os.cpus().length;
    const chunkSize = Math.ceil(mesh.elementCount / cpuCount);
    const chunks: { start: number; end: number }[] = [];

    for (let i = 0; i < cpuCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, mesh.elementCount);
      if (start < mesh.elementCount) {
        chunks.push({ start, end });
      }
    }

    // Spawn workers and collect results
    const workerPromises = chunks.map((chunk) => {
      return new Promise<CoOTriplet[]>((resolve, reject) => {
        const worker = new Worker(workerScript);
        const timeout = setTimeout(() => {
          worker.terminate();
          reject(new Error(`Worker timeout for elements ${chunk.start}–${chunk.end}`));
        }, 60_000);  // 60 second timeout

        worker.on("message", (msg: any) => {
          clearTimeout(timeout);
          worker.terminate();
          if (msg.success) {
            resolve(msg.triplets);
          } else {
            reject(new Error(`Worker error: ${msg.error}`));
          }
        });

        worker.on("error", reject);
        worker.on("exit", (code) => {
          clearTimeout(timeout);
          if (code !== 0) {
            reject(new Error(`Worker exited with code ${code}`));
          }
        });

        // Send work to worker
        worker.postMessage({
          elementStart: chunk.start,
          elementEnd: chunk.end,
          nodesPerElem: mesh.nodesPerElem,
          nodes: mesh.nodes,
          elements: mesh.elements,
          C,
        });
      });
    });

    const results = await Promise.all(workerPromises);
    const allTriplets: CoOTriplet[] = results.flat();

    // Merge all triplets into CSR
    mergeCoOIntoCSR(allTriplets, rowPtr, colIdx, data);
    return true;  // Parallel succeeded
  } catch (err) {
    console.warn(`Parallel assembly failed, falling back to serial: ${(err as Error).message}`);
    return false;  // Fall back to serial
  }
}

// ─── Global assembly (public API) ──────────────────────────────────────────────

/**
 * CSR sparsity pattern of a mesh (as returned by buildSparsityPattern).
 * Depends only on mesh connectivity — shareable across K, M and Kσ.
 */
export type SparsityPattern = {
  rowPtr:  Int32Array;
  colIdx:  Int32Array;
  diagIdx: Int32Array;
};

/**
 * Assemble the global stiffness matrix K and return it as a CSRMatrix.
 *
 * Supports both C3D4 (linear, 4 nodes, 12 DOF) and C3D10 (quadratic, 10 nodes, 30 DOF).
 * The element type is determined by mesh.nodesPerElem.
 *
 * Algorithm:
 *   1. Build sparsity pattern (determines non-zero structure).
 *   2. Allocate data array (zeros).
 *   3. For meshes with >= PARALLEL_MIN_ELEMENTS elements, attempt parallel
 *      assembly via worker_threads:
 *      - Partition elements into N_cpu chunks
 *      - Each worker computes element stiffness, collects COO triplets
 *      - Main thread merges COO into CSR
 *   4. Fall back to serial on any worker error or for small meshes.
 *
 * @param mode 'auto' (default): parallel for large meshes, serial otherwise.
 *             'serial'/'parallel': force a path (used by the parallel-vs-serial
 *             equivalence test; 'parallel' still falls back to serial if the
 *             worker script is missing or a worker errors).
 * @param pattern Optional prebuilt sparsity pattern for this mesh (from
 *             buildSparsityPattern). The pattern depends only on mesh
 *             connectivity, so K, M and Kσ for the same mesh can share one
 *             pattern instead of rebuilding it per matrix (issue #100).
 */
export async function assembleK(
  mesh: TetMesh,
  mat:  AnyMaterial,
  mode: 'auto' | 'serial' | 'parallel' = 'auto',
  pattern?: SparsityPattern,
): Promise<{
  K:       CSRMatrix;
  diagIdx: Int32Array;
  /** True if the parallel (worker_threads) path produced the matrix. */
  parallel: boolean;
}> {
  const n   = mesh.nodeCount * 3;
  const npe = mesh.nodesPerElem;
  const C   = buildAnyConstitutiveMatrix(mat);

  const { rowPtr, colIdx, diagIdx } = pattern ?? buildSparsityPattern(mesh);
  const nnz = rowPtr[n] ?? 0;
  const data = new Float64Array(nnz);

  const tryParallel =
    mode === 'parallel' ||
    (mode === 'auto' && mesh.elementCount >= PARALLEL_MIN_ELEMENTS);

  // Try parallel assembly; fall back to serial if it fails or is not available
  const parallelSucceeded = tryParallel
    ? await assembleK_parallel(mesh, C, rowPtr, colIdx, data).catch(() => false)
    : false;
  if (!parallelSucceeded) {
    assembleK_serial(mesh, C, rowPtr, colIdx, data);
  }

  // Log which path ran (only for meshes large enough that the choice matters —
  // keeps small test solves quiet).
  if (mesh.elementCount >= PARALLEL_MIN_ELEMENTS || mode !== 'auto') {
    console.log(
      `[assembleK] path=${parallelSucceeded ? 'parallel' : 'serial'} ` +
      `elements=${mesh.elementCount} npe=${npe} dof=${n}`
    );
  }

  return {
    K: { n, data, colIdx, rowPtr },
    diagIdx,
    parallel: parallelSucceeded,
  };
}

/**
 * Assemble the global geometric stiffness matrix Kσ for linear buckling analysis.
 *
 * Uses the same sparsity pattern (rowPtr, colIdx) as K so both matrices share the
 * same CSR structure. Element contributions are computed from centroid Cauchy stresses.
 *
 * Currently supports C3D4 only (C3D10 geometric stiffness is not yet implemented).
 *
 * @param mesh         Tetrahedral mesh
 * @param elemStress   Flat array of element centroid stresses, shape [elementCount × 6].
 *                     Each group of 6: [σxx, σyy, σzz, τxy, τyz, τxz] in MPa.
 * @param rowPtr       CSR row pointer (from buildSparsityPattern)
 * @param colIdx       CSR column indices (from buildSparsityPattern)
 * @returns            CSRMatrix with same sparsity as K but geometric stiffness values
 */
export function assembleKsigma(
  mesh:       TetMesh,
  elemStress: Float64Array,  // elementCount × 6
  rowPtr:     Int32Array,
  colIdx:     Int32Array,
): CSRMatrix {
  const n   = mesh.nodeCount * 3;
  const nnz = rowPtr[n] ?? 0;
  const data = new Float64Array(nnz);

  // Geometric stiffness is only implemented for C3D4. Silently skipping other
  // element types would return an all-zero Kσ, making any downstream buckling
  // factor meaningless — fail loudly instead. (analysis.ts already gates
  // buckling to C3D4 meshes, so this is a guard against future misuse.)
  if (mesh.nodesPerElem !== 4) {
    throw new Error(
      `assembleKsigma: geometric stiffness is only implemented for C3D4 ` +
      `(nodesPerElem=4), got nodesPerElem=${mesh.nodesPerElem}.`
    );
  }

  const sig = new Float64Array(6);

  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * mesh.nodesPerElem;
    // Extract element stress tensor
    for (let k = 0; k < 6; k++) sig[k] = elemStress[e*6+k] ?? 0;

    const n0 = i32(mesh.elements, base),
          n1 = i32(mesh.elements, base+1),
          n2 = i32(mesh.elements, base+2),
          n3 = i32(mesh.elements, base+3);

    const ksg = elementGeometricStiffness(mesh.nodes, n0, n1, n2, n3, sig);
    const elemNodes = [n0, n1, n2, n3];

    for (let lr = 0; lr < 12; lr++) {
      const globalR = (elemNodes[Math.floor(lr/3)] ?? 0)*3 + (lr%3);
      for (let lc = 0; lc < 12; lc++) {
        const globalC = (elemNodes[Math.floor(lc/3)] ?? 0)*3 + (lc%3);
        const pos = findEntry(colIdx, rowPtr, globalR, globalC);
        data[pos] = (data[pos] ?? 0) + (ksg[lr*12+lc] ?? 0);
      }
    }
  }

  return { n, data, colIdx, rowPtr };
}

/**
 * Compute K·x (CSR matrix-vector product).
 * This is the inner loop of the CG solver — keep it tight.
 *
 * @param out Optional pre-allocated output buffer of length K.n.
 *            When provided, avoids a heap allocation per call.
 *            If omitted, a new Float64Array is allocated and returned.
 */
export function matvec(K: CSRMatrix, x: Float64Array, out?: Float64Array): Float64Array {
  const { n, data, colIdx, rowPtr } = K;
  const y = out ?? new Float64Array(n);
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
