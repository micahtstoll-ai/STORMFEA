/**
 * assembly-worker.ts
 * ------------------
 * Worker thread for parallel element stiffness computation.
 *
 * Receives a chunk of elements plus the CSR sparsity pattern, computes each
 * element stiffness k_e, and scatters the contributions straight into a
 * full-nnz Float64Array slab keyed by CSR slot (the same scatter kernel the
 * serial path uses — csr.ts). The slab is posted back with a transfer list,
 * so the return trip is zero-copy; the main thread merges slabs by simple
 * addition in fixed chunk order.
 *
 * The worker stays alive listening for further jobs — pool management lives
 * in assembly-pool.ts. Imports are kept minimal (element kernels + csr
 * helpers only); never import assembly.js from here.
 */

import { parentPort } from "worker_threads";
import { elementStiffness, c3d10ElementStiffness } from "./element.js";
import { scatterElemMatrixIntoCSR } from "./csr.js";

export interface WorkerInput {
  readonly elementStart: number;
  readonly elementEnd: number;
  readonly nodesPerElem: number;
  readonly nodes: Float64Array;
  readonly elements: Int32Array;
  /** One or more constitutive matrices back to back (binCount × 36). */
  readonly C: Float64Array;
  /**
   * Per-element bin index into C (two-region material field), GLOBALLY
   * indexed — chunks address elements by global index. Null/absent = uniform
   * material (single 36-entry C).
   */
  readonly binOfElement?: Int32Array | null;
  /** CSR sparsity pattern (structured-clone copies of the main thread's
   *  arrays). The worker scatters into a Float64Array(colIdx.length) slab. */
  readonly rowPtr: Int32Array;
  readonly colIdx: Int32Array;
}

// ─── Helper: safe typed-array access ──────────────────────────────────────

function i32(arr: Int32Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`i32[${i}] out of bounds`);
  return v;
}

function f64(arr: Float64Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`f64[${i}] out of bounds`);
  return v;
}

// ─── Worker entry point ──────────────────────────────────────────────────────

/**
 * Main worker function: process an element chunk into a full-nnz CSR data
 * slab. Slots not touched by this chunk stay exactly 0.0, so slabs from all
 * chunks merge by plain addition.
 */
function processElementChunk(input: WorkerInput): Float64Array {
  const {
    elementStart,
    elementEnd,
    nodesPerElem,
    nodes,
    elements,
    C,
    binOfElement,
    rowPtr,
    colIdx,
  } = input;

  const dpe = nodesPerElem * 3;  // DOF per element
  const data = new Float64Array(colIdx.length);  // full-nnz slab, zeroed

  // Pre-allocate scratch arrays
  const elemNodes = new Int32Array(nodesPerElem);
  const scratchCoords = new Float64Array(30);  // Reused for C3D10

  // Per-bin constitutive views (relative-indexed, kernels use them unchanged)
  const binCount = C.length / 36;
  const Cviews: Float64Array[] = [];
  for (let b = 0; b < binCount; b++) Cviews.push(C.subarray(b * 36, b * 36 + 36));

  for (let e = elementStart; e < elementEnd; e++) {
    const base = e * nodesPerElem;

    // Extract node indices
    for (let ni = 0; ni < nodesPerElem; ni++) {
      elemNodes[ni] = i32(elements, base + ni);
    }

    const Ce = binOfElement ? Cviews[binOfElement[e] ?? 0]! : Cviews[0]!;

    // Compute element stiffness
    let ke: Float64Array;
    if (nodesPerElem === 10) {
      // C3D10: extract coordinates into scratch
      for (let ni = 0; ni < 10; ni++) {
        const n = elemNodes[ni]!;
        scratchCoords[ni * 3]     = f64(nodes, n * 3);
        scratchCoords[ni * 3 + 1] = f64(nodes, n * 3 + 1);
        scratchCoords[ni * 3 + 2] = f64(nodes, n * 3 + 2);
      }
      ke = c3d10ElementStiffness(scratchCoords, Ce);
    } else {
      // C3D4: use existing function
      const na = elemNodes[0]!;
      const nb = elemNodes[1]!;
      const nc = elemNodes[2]!;
      const nd = elemNodes[3]!;
      ke = elementStiffness(nodes, na, nb, nc, nd, Ce);
    }

    // Scatter into the CSR slab — same kernel as the serial path (csr.ts).
    scatterElemMatrixIntoCSR(elemNodes, dpe, ke, rowPtr, colIdx, data);
  }

  return data;
}

// ─── Worker message handler ───────────────────────────────────────────────────

if (parentPort) {
  parentPort.on("message", (input: WorkerInput) => {
    try {
      const data = processElementChunk(input);
      // Transfer the slab's buffer — zero-copy back to the main thread.
      // (`new Float64Array(n)` is always backed by a plain ArrayBuffer;
      // the cast narrows away the SharedArrayBuffer half of ArrayBufferLike.)
      parentPort!.postMessage({ success: true, data }, [data.buffer as ArrayBuffer]);
    } catch (err) {
      parentPort!.postMessage({
        success: false,
        error: (err as Error).message,
      });
    }
  });
}
