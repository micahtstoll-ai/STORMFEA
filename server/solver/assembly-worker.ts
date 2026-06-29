/**
 * assembly-worker.ts
 * ------------------
 * Worker thread for parallel element stiffness computation.
 *
 * Receives a chunk of elements and computes element stiffness k_e for each,
 * extracting COO (row, col, value) triplets that are sent back to the main thread.
 *
 * No worker pool management here — the main thread orchestrates the pool.
 */

import { parentPort, workerData } from "worker_threads";
import { elementStiffness, c3d10ElementStiffness } from "./element.js";

export interface WorkerInput {
  readonly elementStart: number;
  readonly elementEnd: number;
  readonly nodesPerElem: number;
  readonly nodes: Float64Array;
  readonly elements: Int32Array;
  readonly C: Float64Array;
}

export interface CoOTriplet {
  readonly row: number;
  readonly col: number;
  readonly val: number;
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
 * Extract COO triplets from element k_e matrices.
 * Each element k_e[i,j] becomes a triplet (globalRow, globalCol, k_e[i,j]).
 *
 * globalRow = elemNodes[i/3] * 3 + (i % 3)
 * globalCol = elemNodes[j/3] * 3 + (j % 3)
 */
function extractCoOFromKe(
  elemIdx: number,
  elemNodes: Int32Array,
  ke: Float64Array,
  dpe: number,  // DOF per element: 12 for C3D4, 30 for C3D10
): CoOTriplet[] {
  const triplets: CoOTriplet[] = [];

  for (let lr = 0; lr < dpe; lr++) {
    const globalR = (elemNodes[Math.floor(lr / 3)] ?? 0) * 3 + (lr % 3);
    for (let lc = 0; lc < dpe; lc++) {
      const globalC = (elemNodes[Math.floor(lc / 3)] ?? 0) * 3 + (lc % 3);
      const val = f64(ke, lr * dpe + lc);
      if (Math.abs(val) > 1e-16) {  // Skip near-zero entries
        triplets.push({ row: globalR, col: globalC, val });
      }
    }
  }

  return triplets;
}

/**
 * Main worker function: process element chunk and return COO triplets.
 */
function processElementChunk(input: WorkerInput): CoOTriplet[] {
  const {
    elementStart,
    elementEnd,
    nodesPerElem,
    nodes,
    elements,
    C,
  } = input;

  const dpe = nodesPerElem * 3;  // DOF per element
  const allTriplets: CoOTriplet[] = [];

  // Pre-allocate scratch arrays
  const elemNodes = new Int32Array(nodesPerElem);
  const scratchCoords = new Float64Array(30);  // Reused for C3D10

  for (let e = elementStart; e < elementEnd; e++) {
    const base = e * nodesPerElem;

    // Extract node indices
    for (let ni = 0; ni < nodesPerElem; ni++) {
      elemNodes[ni] = i32(elements, base + ni);
    }

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
      ke = c3d10ElementStiffness(scratchCoords, C);
    } else {
      // C3D4: use existing function
      const na = elemNodes[0]!;
      const nb = elemNodes[1]!;
      const nc = elemNodes[2]!;
      const nd = elemNodes[3]!;
      ke = elementStiffness(nodes, na, nb, nc, nd, C);
    }

    // Extract COO triplets
    const triplets = extractCoOFromKe(e, elemNodes, ke, dpe);
    allTriplets.push(...triplets);
  }

  return allTriplets;
}

// ─── Worker message handler ───────────────────────────────────────────────────

if (parentPort) {
  parentPort.on("message", (input: WorkerInput) => {
    try {
      const triplets = processElementChunk(input);
      parentPort!.postMessage({ success: true, triplets });
    } catch (err) {
      parentPort!.postMessage({
        success: false,
        error: (err as Error).message,
      });
    }
  });
}
