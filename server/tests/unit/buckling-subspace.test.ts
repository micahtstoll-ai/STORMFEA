/**
 * buckling-subspace.test.ts
 * -------------------------
 * Issue #138: the buckling eigensolver must return the SMALLEST POSITIVE BLF
 * even under mixed tension/compression pre-stress with ≥2 dominant tensile
 * modes or a clustered spectrum. Plain power iteration converges to the
 * largest-|μ| eigenvalue of K⁻¹(−Kσ); a single deflation of one tensile mode
 * (the old mitigation) is not enough when two (or more) tensile modes dominate
 * the smallest positive one — the governing BLF is then missed and reported
 * far too high (non-conservative). The block subspace solver captures the p
 * smallest-|λ| modes at once and certifies the smallest positive against skips.
 *
 * References are independent: closed-form for diagonal pencils, and a small
 * dense generalized eigensolve (Cholesky + Jacobi, written here) for a
 * non-diagonal pencil.
 */

import { describe, it, expect } from "vitest";
import { runLinearBuckling } from "../../solver/buckling.js";
import type { CSRMatrix } from "../../solver/types.js";

/** n×n diagonal CSR. */
function diagCSR(values: number[]): { M: CSRMatrix; diagIdx: Int32Array } {
  const n = values.length;
  const rowPtr = new Int32Array(n + 1);
  const colIdx = new Int32Array(n);
  const data = new Float64Array(n);
  const diagIdx = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    rowPtr[i + 1] = i + 1; colIdx[i] = i; data[i] = values[i] ?? 0; diagIdx[i] = i;
  }
  return { M: { n, data, colIdx, rowPtr }, diagIdx };
}

/** Full (dense-pattern) CSR from a symmetric n×n matrix; K and Kσ share pattern. */
function denseCSR(A: number[][]): { M: CSRMatrix; diagIdx: Int32Array } {
  const n = A.length;
  const rowPtr = new Int32Array(n + 1);
  const colIdx = new Int32Array(n * n);
  const data = new Float64Array(n * n);
  const diagIdx = new Int32Array(n);
  let p = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      colIdx[p] = j; data[p] = A[i]![j] ?? 0;
      if (j === i) diagIdx[i] = p;
      p++;
    }
    rowPtr[i + 1] = p;
  }
  return { M: { n, data, colIdx, rowPtr }, diagIdx };
}

// ─── Independent dense reference: smallest positive λ of (K + λ·Kσ)φ = 0 ───────
// K SPD → Cholesky K = L·Lᵀ. Buckling: K φ = λ·(−Kσ)·φ ⇒ eigenvalues 1/λ of
// A = L⁻¹·(−Kσ)·L⁻ᵀ (symmetric). Jacobi on A → μ = 1/λ → λ = 1/μ.
function denseSmallestPositiveBLF(K: number[][], Ksigma: number[][]): number[] {
  const n = K.length;
  // Cholesky (lower L)
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let j = 0; j < n; j++) {
    let d = K[j]![j]!;
    for (let k = 0; k < j; k++) d -= L[j]![k]! * L[j]![k]!;
    L[j]![j] = Math.sqrt(d);
    for (let i = j + 1; i < n; i++) {
      let s = K[i]![j]!;
      for (let k = 0; k < j; k++) s -= L[i]![k]! * L[j]![k]!;
      L[i]![j] = s / L[j]![j]!;
    }
  }
  // B = -Ksigma
  const B = Ksigma.map(row => row.map(v => -v));
  // Y = L⁻¹ B  (forward solve per column)
  const Y = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let c = 0; c < n; c++) {
    for (let i = 0; i < n; i++) {
      let s = B[i]![c]!;
      for (let k = 0; k < i; k++) s -= L[i]![k]! * Y[k]![c]!;
      Y[i]![c] = s / L[i]![i]!;
    }
  }
  // A = Y L⁻ᵀ  ⇒ solve Lᵀ over the columns of Yᵀ: A[i,:] via forward solve of L on Y[i,:]
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let r = 0; r < n; r++) {
    for (let i = 0; i < n; i++) {
      let s = Y[r]![i]!;
      for (let k = 0; k < i; k++) s -= L[i]![k]! * A[r]![k]!;
      A[r]![i] = s / L[i]![i]!;
    }
  }
  // Symmetrize (guard fp) and Jacobi eigenvalues
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    const avg = 0.5 * (A[i]![j]! + A[j]![i]!); A[i]![j] = avg; A[j]![i] = avg;
  }
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off = Math.max(off, Math.abs(A[i]![j]!));
    if (off < 1e-14) break;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const aij = A[i]![j]!; if (Math.abs(aij) < 1e-16) continue;
      const theta = (A[j]![j]! - A[i]![i]!) / (2 * aij);
      const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(1 + theta * theta));
      const c = 1 / Math.sqrt(1 + t * t), s = t * c;
      const aii = A[i]![i]!, ajj = A[j]![j]!;
      A[i]![i] = aii - t * aij; A[j]![j] = ajj + t * aij; A[i]![j] = 0; A[j]![i] = 0;
      for (let k = 0; k < n; k++) {
        if (k === i || k === j) continue;
        const aki = A[k]![i]!, akj = A[k]![j]!;
        A[k]![i] = c * aki - s * akj; A[i]![k] = A[k]![i]!;
        A[k]![j] = s * aki + c * akj; A[j]![k] = A[k]![j]!;
      }
    }
  }
  const lambdas: number[] = [];
  for (let i = 0; i < n; i++) { const mu = A[i]![i]!; if (Math.abs(mu) > 1e-12) lambdas.push(1 / mu); }
  return lambdas.filter(l => l > 0).sort((a, b) => a - b);
}

describe("runLinearBuckling — smallest-positive guarantee (issue #138)", () => {
  it("finds the smallest positive BLF with TWO dominant tensile modes (breaks single-deflation)", async () => {
    // Kσ = diag(3, 2.5, -1, -0.5, -0.4).  For K=I: λ_i = -1/Kσ_ii =
    //   {-0.333, -0.4, +1, +2, +2.5}.  Operator K⁻¹(−Kσ) = diag(-3,-2.5,1,0.5,0.4):
    // the TWO largest-|μ| modes are BOTH tensile (μ=-3, μ=-2.5), so a single
    // deflation cannot expose the physical smallest positive BLF = 1.
    const { M: K, diagIdx } = diagCSR([1, 1, 1, 1, 1]);
    const { M: Ksigma } = diagCSR([3, 2.5, -1, -0.5, -0.4]);

    const r = await runLinearBuckling(K, Ksigma, diagIdx, 200, 1e-8);
    expect(r.indeterminate).toBe(false);
    expect(r.tensileDominated).toBe(false);
    expect(r.converged).toBe(true);
    expect(r.certified).toBe(true);          // full spectrum (p===n) captured
    expect(r.blf).toBeCloseTo(1.0, 4);
    // Lowest positive modes reported, ascending.
    expect(r.positiveBLFs.length).toBeGreaterThanOrEqual(3);
    expect(r.positiveBLFs[0]).toBeCloseTo(1.0, 4);
    expect(r.positiveBLFs[1]).toBeCloseTo(2.0, 4);
    expect(r.positiveBLFs[2]).toBeCloseTo(2.5, 4);
  });

  it("matches an independent dense generalized eigensolve (non-diagonal pencil)", async () => {
    // Small SPD K (tridiagonal) and an indefinite Kσ with mixed signs.
    const Kdense = [
      [ 2, -1,  0,  0],
      [-1,  2, -1,  0],
      [ 0, -1,  2, -1],
      [ 0,  0, -1,  2],
    ];
    const Ksdense = [
      [ 1.0, 0.5, 0.0, 0.0],
      [ 0.5, -1.2, 0.3, 0.0],
      [ 0.0, 0.3, -2.0, 0.4],
      [ 0.0, 0.0, 0.4, -1.5],
    ];
    const ref = denseSmallestPositiveBLF(Kdense, Ksdense);
    expect(ref.length).toBeGreaterThan(0);   // the constructed pencil has a positive mode

    const { M: K, diagIdx } = denseCSR(Kdense);
    const { M: Ksigma } = denseCSR(Ksdense);
    const r = await runLinearBuckling(K, Ksigma, diagIdx, 200, 1e-9);

    expect(r.indeterminate).toBe(false);
    expect(r.converged).toBe(true);
    expect(r.certified).toBe(true);
    expect(r.blf).toBeCloseTo(ref[0]!, 4);
  });

  it("still returns the positive mode with a single dominant tensile mode (issue #103 case)", async () => {
    // K⁻¹(−Kσ) eigenvalues {−2, 1, 1, 1}: dominant is tensile, physical BLF = 1.
    const { M: K, diagIdx } = diagCSR([1, 1, 1, 1]);
    const { M: Ksigma } = diagCSR([2, -1, -1, -1]);
    const r = await runLinearBuckling(K, Ksigma, diagIdx, 200, 1e-8);
    expect(r.indeterminate).toBe(false);
    expect(r.blf).toBeCloseTo(1.0, 4);
    expect(r.certified).toBe(true);
  });

  it("flags indeterminate when the pre-stress has geometric energy but no positive mode", async () => {
    const { M: K, diagIdx } = diagCSR([1, 1, 1]);
    const { M: Ksigma } = diagCSR([2, 2, 2]);   // all tensile
    const r = await runLinearBuckling(K, Ksigma, diagIdx, 200, 1e-6);
    expect(r.indeterminate).toBe(true);
    expect(r.converged).toBe(false);
    expect(r.certified).toBe(false);
    expect(r.positiveBLFs.length).toBe(0);
  });
});
