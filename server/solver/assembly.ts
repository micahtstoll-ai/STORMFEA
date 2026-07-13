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

import type { TetMesh, AnyMaterial, CSRMatrix, ElementMaterialField } from "./types.js";
import { elementStiffness, buildAnyConstitutiveMatrix, c3d10ElementStiffness, elementGeometricStiffness, c3d10ElementGeometricStiffness } from "./element.js";
import { scatterElemMatrixIntoCSR } from "./csr.js";
import { runAssemblyJobs } from "./assembly-pool.js";
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

// ─── Serial assembly (extracted from original) ────────────────────────────────

/**
 * Serial element-by-element assembly (original implementation).
 * Used as fallback when workers are unavailable or mesh is small.
 *
 * `Cs` holds one or more 6×6 constitutive matrices back to back (binCount×36);
 * `binOfElement` selects the bin per element (null = single uniform bin).
 */
function assembleK_serial(
  mesh: TetMesh,
  Cs: Float64Array,
  binOfElement: Int32Array | null,
  rowPtr: Int32Array,
  colIdx: Int32Array,
  data: Float64Array,
): void {
  const npe = mesh.nodesPerElem;
  const dpe = npe * 3;  // DOF per element

  const elemNodes = new Int32Array(npe);
  const scratchCoords = new Float64Array(30);

  // Subarray views are relative-indexed, so element kernels use them unchanged.
  const binCount = Cs.length / 36;
  const Cviews: Float64Array[] = [];
  for (let b = 0; b < binCount; b++) Cviews.push(Cs.subarray(b * 36, b * 36 + 36));

  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    for (let ni = 0; ni < npe; ni++) elemNodes[ni] = i32(mesh.elements, base + ni);

    const C = binOfElement ? Cviews[binOfElement[e] ?? 0]! : Cviews[0]!;

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

    scatterElemMatrixIntoCSR(elemNodes, dpe, ke, rowPtr, colIdx, data);
  }
}

// ─── Parallel assembly via worker_threads ─────────────────────────────────────

/**
 * Minimum element count for the parallel path. Below this, worker message
 * overhead exceeds the assembly cost and serial is faster.
 */
const PARALLEL_MIN_ELEMENTS = 1000;

/** Per-job timeout. A job is one chunk of a mesh whose entire analysis is
 *  budgeted at 60 s (issue #108), so a healthy job finishes far sooner. */
const WORKER_JOB_TIMEOUT_MS = 60_000;

/**
 * Assemble stiffness matrix using the persistent worker pool
 * (assembly-pool.ts), one element chunk per worker. Each worker scatters its
 * chunk into a full-nnz Float64Array slab keyed by CSR slot (same scatter
 * kernel as serial — csr.ts) and posts the slab back with a transfer list;
 * the main thread merges slabs by plain addition in fixed chunk order, so
 * the result is deterministic run-to-run. Falls back to serial (returns
 * false) if the worker script is missing, the memory guard trips, or any
 * worker errors/times out — `data` is only written after every job succeeds,
 * so the fallback always starts from clean zeros.
 *
 * NOTE: worker_threads itself is guaranteed available — the pool module
 * imports `Worker` statically, so it could not even load if the platform
 * lacked it. (A previous `require.resolve("worker_threads")` probe always
 * threw in this ESM project — `require` is undefined — which silently
 * disabled the parallel path entirely; issue #98.)
 */
async function assembleK_parallel(
  mesh: TetMesh,
  Cs: Float64Array,
  binOfElement: Int32Array | null,
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

    // Memory guard: each worker holds a full-nnz slab (8 B/nnz) plus
    // structured-clone copies of colIdx (4 B/nnz) — ~12 B per non-zero per
    // worker. Cap the worker count so the pool stays within a fixed budget;
    // below 2 workers parallelism is pointless, so take the serial path.
    const nnz = colIdx.length;
    const perWorkerBytes = 12 * nnz;
    const budgetBytes = Math.min(1.5 * 2 ** 30, os.totalmem() / 4);
    const maxWorkers = Math.min(os.cpus().length, Math.floor(budgetBytes / perWorkerBytes));
    if (maxWorkers < 2) {
      console.warn(
        `[assembleK] parallel skipped: nnz=${nnz} needs ~${Math.round(perWorkerBytes / 2 ** 20)} MB/worker ` +
        `(budget ${Math.round(budgetBytes / 2 ** 20)} MB) — using serial assembly`
      );
      return false;
    }

    const chunkSize = Math.ceil(mesh.elementCount / maxWorkers);
    // binOfElement is globally indexed (chunks use global element indices),
    // so the whole array ships to each worker — 4 bytes/element, smaller
    // than the elements array already posted.
    const payloads: object[] = [];
    for (let i = 0; i < maxWorkers; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, mesh.elementCount);
      if (start >= mesh.elementCount) break;
      payloads.push({
        elementStart: start,
        elementEnd: end,
        nodesPerElem: mesh.nodesPerElem,
        nodes: mesh.nodes,
        elements: mesh.elements,
        C: Cs,
        binOfElement,
        rowPtr,
        colIdx,
      });
    }

    const results = await runAssemblyJobs(workerScript, payloads, WORKER_JOB_TIMEOUT_MS) as
      { data: Float64Array }[];

    // Merge slabs in fixed chunk order — untouched slots are exact 0.0, so
    // plain addition reconstructs the full matrix deterministically.
    for (const result of results) {
      const slab = result.data;
      if (!(slab instanceof Float64Array) || slab.length !== nnz) {
        throw new Error(`worker returned a bad slab (length ${slab?.length ?? "?"}, expected ${nnz})`);
      }
      for (let i = 0; i < nnz; i++) data[i] = (data[i] ?? 0) + (slab[i] ?? 0);
    }
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
 *      assembly on the persistent worker pool:
 *      - Partition elements into one chunk per worker (memory-guarded)
 *      - Each worker scatters its chunk into a full-nnz CSR slab and
 *        transfers the slab back zero-copy
 *      - Main thread adds the slabs in fixed chunk order
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
 * @param field Optional per-element material field (two-region shell/core
 *             model). When present, each element's constitutive matrix comes
 *             from field.C[binOfElement[e]]; `mat` is only the fallback for
 *             the uniform case. Absent = legacy single-material behavior.
 */
export async function assembleK(
  mesh: TetMesh,
  mat:  AnyMaterial,
  mode: 'auto' | 'serial' | 'parallel' = 'auto',
  pattern?: SparsityPattern,
  field?: ElementMaterialField,
): Promise<{
  K:       CSRMatrix;
  diagIdx: Int32Array;
  /** True if the parallel (worker_threads) path produced the matrix. */
  parallel: boolean;
}> {
  const n   = mesh.nodeCount * 3;
  const npe = mesh.nodesPerElem;
  const Cs  = field ? field.C : buildAnyConstitutiveMatrix(mat);
  const binOfElement = field ? field.binOfElement : null;
  if (field && field.binOfElement.length !== mesh.elementCount) {
    throw new Error(
      `assembleK: materialField.binOfElement length ${field.binOfElement.length} ` +
      `!= elementCount ${mesh.elementCount}`
    );
  }

  const { rowPtr, colIdx, diagIdx } = pattern ?? buildSparsityPattern(mesh);
  const nnz = rowPtr[n] ?? 0;
  const data = new Float64Array(nnz);

  const tryParallel =
    mode === 'parallel' ||
    (mode === 'auto' && mesh.elementCount >= PARALLEL_MIN_ELEMENTS);

  // Try parallel assembly; fall back to serial if it fails or is not available
  const parallelSucceeded = tryParallel
    ? await assembleK_parallel(mesh, Cs, binOfElement, rowPtr, colIdx, data).catch(() => false)
    : false;
  if (!parallelSucceeded) {
    assembleK_serial(mesh, Cs, binOfElement, rowPtr, colIdx, data);
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
 * same CSR structure. Element contributions are computed from element Cauchy stresses.
 *
 * Supports C3D4 (linear, 12 DOF) and C3D10 (quadratic, 30 DOF); the element type
 * is determined by mesh.nodesPerElem.
 *
 * @param mesh         Tetrahedral mesh
 * @param elemStress   Flat array of element stresses, shape [elementCount × 6].
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
  const npe = mesh.nodesPerElem;
  const dpe = npe * 3;  // DOF per element
  const nnz = rowPtr[n] ?? 0;
  const data = new Float64Array(nnz);

  if (npe !== 4 && npe !== 10) {
    throw new Error(
      `assembleKsigma: geometric stiffness is only implemented for C3D4 and ` +
      `C3D10, got nodesPerElem=${npe}.`
    );
  }

  const sig = new Float64Array(6);
  const elemNodes = new Int32Array(npe);
  const scratchCoords = new Float64Array(30);  // C3D10 local node coordinates

  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    for (let ni = 0; ni < npe; ni++) elemNodes[ni] = i32(mesh.elements, base + ni);
    for (let k = 0; k < 6; k++) sig[k] = elemStress[e*6+k] ?? 0;

    let ksg: Float64Array;
    if (npe === 10) {
      for (let ni = 0; ni < 10; ni++) {
        const nd = elemNodes[ni]!;
        scratchCoords[ni*3]   = mesh.nodes[nd*3]   ?? 0;
        scratchCoords[ni*3+1] = mesh.nodes[nd*3+1] ?? 0;
        scratchCoords[ni*3+2] = mesh.nodes[nd*3+2] ?? 0;
      }
      ksg = c3d10ElementGeometricStiffness(scratchCoords, sig);
    } else {
      ksg = elementGeometricStiffness(
        mesh.nodes, elemNodes[0]!, elemNodes[1]!, elemNodes[2]!, elemNodes[3]!, sig,
      );
    }

    scatterElemMatrixIntoCSR(elemNodes, dpe, ksg, rowPtr, colIdx, data);
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
