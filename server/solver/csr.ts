/**
 * csr.ts
 * ------
 * Dependency-light CSR helpers shared by the serial assembly paths
 * (assembly.ts), the mass matrix (mass.ts), and the parallel assembly
 * worker (assembly-worker.ts).
 *
 * This module must import nothing: the worker keeps its module closure
 * minimal, and sharing one scatter kernel guarantees the serial and
 * parallel paths produce numerically identical per-element contributions
 * by construction (only cross-chunk summation order can differ).
 */

/**
 * Find the position of column `col` in row `row` of the CSR matrix.
 * colIdx within each row is sorted ascending — use binary search.
 * Throws if the entry is not found (indicates a sparsity pattern bug).
 */
export function findEntry(colIdx: Int32Array, rowPtr: Int32Array, row: number, col: number): number {
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

/**
 * Scatter a dense dpe×dpe element matrix into the global CSR data array.
 *
 * Local DOF `l` maps to global DOF `elemNodes[⌊l/3⌋]*3 + l%3`; each entry is
 * accumulated (`+=`) at its CSR slot located via findEntry. Throws (via
 * findEntry) if the pattern is missing an entry — a worker converts that into
 * a `{success: false}` reply and the caller falls back to serial, never
 * silently corrupting the matrix.
 *
 * @param elemNodes Global node indices of the element (length npe)
 * @param dpe       DOF per element: 12 for C3D4, 30 for C3D10
 * @param ke        Dense element matrix, row-major dpe×dpe
 */
export function scatterElemMatrixIntoCSR(
  elemNodes: Int32Array,
  dpe:       number,
  ke:        Float64Array,
  rowPtr:    Int32Array,
  colIdx:    Int32Array,
  data:      Float64Array,
): void {
  for (let lr = 0; lr < dpe; lr++) {
    const globalR = (elemNodes[Math.floor(lr / 3)] ?? 0) * 3 + (lr % 3);
    for (let lc = 0; lc < dpe; lc++) {
      const globalC = (elemNodes[Math.floor(lc / 3)] ?? 0) * 3 + (lc % 3);
      const pos = findEntry(colIdx, rowPtr, globalR, globalC);
      data[pos] = (data[pos] ?? 0) + (ke[lr * dpe + lc] ?? 0);
    }
  }
}
