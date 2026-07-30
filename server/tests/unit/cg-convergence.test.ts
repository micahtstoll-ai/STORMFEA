/**
 * cg-convergence.test.ts
 * ----------------------
 * Issue #153 — CG stopping-criterion audit.
 *
 * Guards three defects fixed in cg.ts:
 *  1. TRUE-residual convergence: the recurrence residual (r ← r − α·Kp) drifts
 *     optimistically low in finite precision; `converged` is now keyed to the
 *     measured residual ‖f − K·u‖/‖f‖ from one final SpMV. We construct an
 *     ill-conditioned system where the two diverge and prove that a tolerance
 *     sitting between them yields converged === false (no false convergence).
 *  2. Condition estimate: the Lanczos tridiagonal implied by the CG (α,β)
 *     scalars estimates λmin/λmax of the preconditioned operator. Checked
 *     against a matrix with an analytically-known spectrum.
 *  3. (documented, not asserted) DOF-scaled maxIter.
 */

import { describe, it, expect } from 'vitest';
import { solvePCG, tridiagExtremeEigs } from '../../solver/cg.js';
import type { CSRMatrix } from '../../solver/types.js';

// ─── Test matrices ────────────────────────────────────────────────────────────

/** 1-D Dirichlet Laplacian tridiag(−1, 2, −1), size m. Constant diagonal (2). */
function laplacian(m: number): { K: CSRMatrix; diagIdx: Int32Array } {
  const data: number[] = [], colIdx: number[] = [], rowPtr: number[] = [0];
  const diagIdx = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    if (i > 0)     { data.push(-1); colIdx.push(i - 1); }
    diagIdx[i] = data.length;      data.push(2); colIdx.push(i);
    if (i < m - 1) { data.push(-1); colIdx.push(i + 1); }
    rowPtr.push(data.length);
  }
  return { K: { n: m, data: new Float64Array(data), colIdx: new Int32Array(colIdx), rowPtr: new Int32Array(rowPtr) }, diagIdx };
}

/**
 * Symmetric tridiagonal "graded diffusion" chain: edge conductances span
 * `grade` decades, a_j = 10^(grade·j/m). SPD, and severely ill-conditioned —
 * exactly the regime where the CG recurrence residual under-reports the true
 * residual after many iterations (the penalty-inflated-conditioning analogue).
 */
function gradedChain(m: number, grade: number): { K: CSRMatrix; diagIdx: Int32Array } {
  const a = Array.from({ length: m + 1 }, (_, j) => Math.pow(10, (grade * j) / m));
  const data: number[] = [], colIdx: number[] = [], rowPtr: number[] = [0];
  const diagIdx = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    if (i > 0)     { data.push(-a[i]!);     colIdx.push(i - 1); }
    diagIdx[i] = data.length; data.push(a[i]! + a[i + 1]!); colIdx.push(i);
    if (i < m - 1) { data.push(-a[i + 1]!); colIdx.push(i + 1); }
    rowPtr.push(data.length);
  }
  return { K: { n: m, data: new Float64Array(data), colIdx: new Int32Array(colIdx), rowPtr: new Int32Array(rowPtr) }, diagIdx };
}

// ─── Defect 2: condition estimate sane on a known matrix ───────────────────────

describe('#153 condition estimate — known spectrum', () => {
  it('tridiagExtremeEigs reproduces the analytic Laplacian spectrum', () => {
    const m = 20;
    const d = new Array(m).fill(2);
    const e = new Array(m - 1).fill(-1);
    const ex = tridiagExtremeEigs(d, e)!;
    // Analytic eigenvalues: 2 − 2cos(kπ/(m+1)), k = 1..m.
    const lmin = 2 - 2 * Math.cos(Math.PI / (m + 1));
    const lmax = 2 - 2 * Math.cos((m * Math.PI) / (m + 1));
    expect(ex.min).toBeCloseTo(lmin, 8);
    expect(ex.max).toBeCloseTo(lmax, 8);
  });

  it('CG-derived κ estimate matches analytic κ of the preconditioned operator', () => {
    const m = 40;
    const { K, diagIdx } = laplacian(m);
    const f = new Float64Array(m).fill(1);
    const r = solvePCG(K, f, diagIdx, 1e-12, 5000, 'jacobi');
    // Jacobi M = 2·I (constant diagonal) ⇒ preconditioned operator = K/2, whose
    // extreme eigenvalues are the analytic λ(K)/2 and whose κ equals κ(K).
    const lmin = 2 - 2 * Math.cos(Math.PI / (m + 1));
    const lmax = 2 - 2 * Math.cos((m * Math.PI) / (m + 1));
    const kappaAnalytic = lmax / lmin;
    expect(r.conditionEstimate).toBeDefined();
    // Extreme Ritz values converge from the outside; a few % is the honest bar.
    expect(r.conditionEstimate!).toBeGreaterThan(0.9 * kappaAnalytic);
    expect(r.conditionEstimate!).toBeLessThan(1.1 * kappaAnalytic);
    // Preconditioned operator = K/2, so the Ritz extremes bracket λ(K)/2:
    // λmax-Ritz approaches from below, λmin-Ritz from above, both within ~few %.
    expect(r.ritzValueMax!).toBeGreaterThan(0.95 * (lmax / 2));
    expect(r.ritzValueMax!).toBeLessThanOrEqual(1.001 * (lmax / 2));
    expect(r.ritzValueMin!).toBeLessThan(1.05 * (lmin / 2));
    expect(r.ritzValueMin!).toBeGreaterThanOrEqual(0.999 * (lmin / 2));
  });
});

// ─── Defect 1: true residual gates `converged` ─────────────────────────────────

describe('#153 true-residual convergence', () => {
  it('recurrence residual diverges from the true residual on an ill-conditioned system', () => {
    const { K, diagIdx } = gradedChain(200, 10);
    const f = new Float64Array(K.n).fill(1);
    f[0] = 0.5;
    // Loose tol both residuals clear: exposes the drift without stopping early.
    const r = solvePCG(K, f.slice(), diagIdx, 1e-9, 5000, 'jacobi');
    expect(r.converged).toBe(true);
    // finalRelativeResidual is the TRUE residual, and it is orders of magnitude
    // above the CG recurrence residual — the drift the fix exists to catch.
    expect(r.finalRelativeResidual).toBe(r.trueRelativeResidual);
    expect(r.trueRelativeResidual).toBeGreaterThan(10 * r.recurrenceRelativeResidual);
  });

  it('a tolerance between recurrence and true residual does NOT falsely converge', () => {
    const { K, diagIdx } = gradedChain(200, 10);
    const f = new Float64Array(K.n).fill(1);
    f[0] = 0.5;
    // On this system the recurrence residual bottoms out ~1e-15 while the true
    // residual stalls ~1e-12. tol = 1e-13 sits squarely between them.
    const tol = 1e-13;
    const r = solvePCG(K, f.slice(), diagIdx, tol, 5000, 'jacobi');

    // The recurrence residual (what the OLD criterion tested) is below tol …
    expect(r.recurrenceRelativeResidual).toBeLessThan(tol);
    // … yet the TRUE residual is above it — so the honest verdict is NOT converged.
    expect(r.trueRelativeResidual).toBeGreaterThan(tol);
    expect(r.converged).toBe(false);

    // Core invariant: converged ⟺ trueRelativeResidual < tol, at every tolerance.
    for (const t of [1e-9, 1e-11, 1e-12, 1e-13]) {
      const rr = solvePCG(K, f.slice(), diagIdx, t, 5000, 'jacobi');
      expect(rr.converged).toBe(rr.trueRelativeResidual < t);
    }
  });

  it('a well-conditioned solve converges with a trustworthy true residual + finite κ', () => {
    const { K, diagIdx } = laplacian(50);
    const f = new Float64Array(K.n).fill(1);
    // IC(0) on a tridiagonal matrix is EXACT Cholesky (no fill), so use Jacobi
    // here to exercise a non-trivial preconditioned spectrum (κ > 1).
    const r = solvePCG(K, f, diagIdx, 1e-10, 5000, 'jacobi');
    expect(r.converged).toBe(true);
    expect(r.trueRelativeResidual).toBeLessThan(1e-10);
    expect(r.conditionEstimate).toBeGreaterThan(1);
    expect(Number.isFinite(r.conditionEstimate!)).toBe(true);
    // Displacement-error order-of-magnitude is exposed and non-negative.
    expect(r.displacementErrorEstimate!).toBeGreaterThanOrEqual(0);

    // IC(0) === exact Cholesky on a tridiagonal ⇒ preconditioned operator is the
    // identity ⇒ κ ≈ 1 (and it must never be reported as < 1).
    const rIc0 = solvePCG(K, f, diagIdx, 1e-10, 5000, 'ic0');
    expect(rIc0.converged).toBe(true);
    expect(rIc0.conditionEstimate!).toBeGreaterThanOrEqual(1 - 1e-6);
    expect(rIc0.conditionEstimate!).toBeLessThan(1.01);
  });
});
