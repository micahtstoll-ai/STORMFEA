/**
 * cg.ts
 * -----
 * Preconditioned Conjugate Gradient (PCG) solver for K·u = f.
 *
 * ALGORITHM
 * =========
 * The standard PCG algorithm (Saad, "Iterative Methods for Sparse Linear Systems", §6.7):
 *
 *   r₀ = f − K·u₀          (residual; u₀ = 0 → r₀ = f)
 *   z₀ = M⁻¹·r₀             (preconditioned residual)
 *   p₀ = z₀                  (initial search direction)
 *
 *   For k = 0, 1, 2, ...:
 *     αk  = (rk·zk) / (pk · K·pk)      (step length)
 *     uk₊₁ = uk + αk·pk                 (update solution)
 *     rk₊₁ = rk − αk·(K·pk)            (update residual)
 *
 *     if ‖rk₊₁‖ / ‖f‖ < tol: CONVERGED
 *
 *     zk₊₁ = M⁻¹·rk₊₁                  (apply preconditioner)
 *     βk   = (rk₊₁·zk₊₁) / (rk·zk)    (conjugate direction coefficient)
 *     pk₊₁ = zk₊₁ + βk·pk              (update search direction)
 *
 * JACOBI (DIAGONAL) PRECONDITIONER
 * ==================================
 * M = diag(K)     →    M⁻¹·v = v / diag(K)    (component-wise)
 *
 * For a well-assembled FEM system, the diagonal dominates. The Jacobi
 * preconditioner reduces the condition number approximately by the ratio
 * of max to min diagonal, which is 1 for a perfectly uniform mesh.
 *
 * After applying penalty BCs, the constrained diagonal entries are K_penalty
 * (≈ 1e8 × K_max_off_diagonal). The Jacobi preconditioner handles these
 * correctly: the constrained DOFs get very small z_i ≈ 0, making them
 * effectively transparent to the search direction update.
 *
 * CONVERGENCE
 * ===========
 * Convergence criterion: ‖rk‖₂ / ‖f‖₂ < TOLERANCE (relative residual).
 * TOLERANCE = 1e-8 is sufficient for engineering stress analysis.
 *
 * For 200k DOF with Jacobi preconditioning and a well-conditioned FEM system,
 * expect 200–500 iterations. Each iteration costs one CSR matvec O(nnz).
 *
 * NaN/Inf detection: if αk or βk become NaN/Inf the system is not SPD
 * (most likely due to: missing BCs leaving K singular, or negative E/ν).
 */

import type { CSRMatrix } from "./types.js";
import { matvec } from "./assembly.js";

// NOTE: axpby is kept for external callers that may import it, but is no longer
// used inside solvePCG (replaced by the in-place update below for zero allocation).

// ─── Vector operations ────────────────────────────────────────────────────────

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

function norm(a: Float64Array): number {
  return Math.sqrt(dot(a, a));
}

/** y = alpha*x + y (DAXPY) */
function daxpy(alpha: number, x: Float64Array, y: Float64Array): void {
  for (let i = 0; i < x.length; i++) {
    y[i] = (y[i] ?? 0) + alpha * (x[i] ?? 0);
  }
}

/** z = alpha*x + beta*y */
function axpby(alpha: number, x: Float64Array, beta: number, y: Float64Array): Float64Array {
  const z = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    z[i] = alpha * (x[i] ?? 0) + beta * (y[i] ?? 0);
  }
  return z;
}

// ─── PCG solver ──────────────────────────────────────────────────────────────

export interface CGResult {
  readonly u:          Float64Array; // solution vector
  readonly iterations: number;
  readonly converged:  boolean;
  readonly finalRelativeResidual: number;
}

/**
 * Solve K·u = f using Preconditioned Conjugate Gradient.
 *
 * @param K       Global stiffness matrix in CSR format (modified in-place by BCs).
 * @param f       Right-hand side force vector in Newtons.
 * @param diagIdx Diagonal entry positions in K.data, for Jacobi preconditioner.
 * @param tol     Relative residual tolerance (default 1e-8).
 * @param maxIter Maximum iterations (default 3 × DOF count).
 */
export function solvePCG(
  K:        CSRMatrix,
  f:        Float64Array,
  diagIdx:  Int32Array,
  tol       = 1e-8,
  maxIter?: number,
): CGResult {
  const n    = K.n;
  // Hard cap at 5 000 iterations regardless of DOF count.
  // Rationale: with Jacobi preconditioning on a well-conditioned FEM system,
  // convergence to 1e-8 typically takes 200–800 iterations for meshes up to
  // ~50 000 DOF. If the solver has not converged by 5 000 iterations it is
  // almost certainly not going to — the system is ill-conditioned (singular BCs,
  // degenerate mesh, bad material constants) and more iterations waste CPU and
  // hang the server. The old default of 3×n was unbounded: a fine C3D10 STEP
  // mesh with 24 000 DOF set imax=72 000, causing multi-minute hangs with no
  // timeout on the HTTP route.
  const imax = maxIter ?? Math.min(5000, Math.max(1000, 3 * n));

  // Build Jacobi preconditioner: M⁻¹_i = 1 / K[i][i]
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const diagPos = diagIdx[i] ?? 0;
    const kii = K.data[diagPos] ?? 0;
    Minv[i] = Math.abs(kii) > 1e-300 ? 1.0 / kii : 1.0;
  }

  // Initial guess u = 0
  const u = new Float64Array(n);

  // r = f − K·u = f  (since u = 0)
  const r = f.slice();

  const fNorm = norm(f);
  if (fNorm < 1e-300) {
    // Zero right-hand side → zero solution (trivially correct)
    return { u, iterations: 0, converged: true, finalRelativeResidual: 0 };
  }

  // z = M⁻¹·r
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) z[i] = (r[i] ?? 0) * (Minv[i] ?? 1);

  // p = z
  const p = z.slice();

  let rz = dot(r, z); // r·z scalar

  // Pre-allocate Ap once — reused every iteration to avoid per-iteration heap allocation.
  const Ap = new Float64Array(n);

  let iter = 0;
  let relRes = norm(r) / fNorm;

  // Wall-clock deadline: throw if the solve takes longer than 90 s.
  // The 5 000-iteration cap is the primary guard, but for very large systems
  // (or if a caller passes a custom maxIter) this catches runaway solves that
  // would otherwise hang the Node process and leave the browser waiting forever.
  const CG_DEADLINE_MS = 90_000;
  const cgDeadline = Date.now() + CG_DEADLINE_MS;

  // Diagnostic logging at geometrically-spaced checkpoints (1, 2, 4, 8, 16...
  // iterations, then every 256 past that). This is cheap — it doesn't run on
  // every iteration — but gives enough resolution to distinguish "diverging
  // immediately" (residual climbs from iteration 1) from "stuck/oscillating"
  // (residual plateaus or bounces) from "slow but steady convergence" (residual
  // shrinks monotonically, just needs more iterations than the cap allows).
  // These three failure shapes have different root causes and previously had
  // to be guessed at blind from a single final-residual number.
  // Diagnostic logging is opt-in (STORMFEA_DEBUG_CG=1) — off by default so
  // normal solves and the test suite stay quiet, but trivially enabled when
  // actually chasing a non-convergence/timeout in the field.
  const debugCG = process.env["STORMFEA_DEBUG_CG"] === "1";
  let nextLogIter = 1;
  const initialRelRes = relRes;

  for (iter = 0; iter < imax; iter++) {
    // Check convergence at start of iteration (initial r may already satisfy tol)
    if (relRes < tol) break;

    if (debugCG && iter === nextLogIter) {
      console.log(`[cg] iter ${iter}: relRes=${relRes.toExponential(3)} (initial=${initialRelRes.toExponential(3)})`);
      nextLogIter = iter < 256 ? iter * 2 : iter + 256;
    }

    // Deadline check every 100 iterations (cheap: one Date.now() call per 100 matvecs)
    if ((iter & 127) === 0 && Date.now() > cgDeadline) {
      throw new Error(
        `PCG solver exceeded ${CG_DEADLINE_MS / 1000}s wall-clock limit at iteration ${iter} ` +
        `(relRes=${relRes.toExponential(2)}, started at ${initialRelRes.toExponential(2)}). ` +
        `The system may be ill-conditioned — check constraints, mesh quality, and material constants. ` +
        `Try a coarser mesh or verify that bolt holes are correctly bolted.`
      );
    }

    // Ap = K·p  (written into pre-allocated buffer — no heap allocation per iteration)
    matvec(K, p, Ap);

    // α = (r·z) / (p·Ap)
    const pAp = dot(p, Ap);
    if (!isFinite(pAp) || Math.abs(pAp) < 1e-300) {
      throw new Error(
        `PCG breakdown at iteration ${iter}: p·Ap=${pAp}. ` +
        `System is likely singular (missing BCs?) or non-SPD.`
      );
    }
    const alpha = rz / pAp;
    if (!isFinite(alpha)) {
      throw new Error(`PCG: non-finite alpha=${alpha} at iteration ${iter}`);
    }

    // u = u + α·p
    daxpy(alpha, p, u);

    // r = r − α·Ap
    daxpy(-alpha, Ap, r);

    // Check convergence
    relRes = norm(r) / fNorm;
    if (relRes < tol) { iter++; break; }

    // z_new = M⁻¹·r
    for (let i = 0; i < n; i++) z[i] = (r[i] ?? 0) * (Minv[i] ?? 1);

    // β = (r_new·z_new) / (r·z)
    const rzNew = dot(r, z);
    if (!isFinite(rzNew)) {
      throw new Error(`PCG: non-finite r·z at iteration ${iter}`);
    }
    const beta = Math.abs(rz) > 1e-300 ? rzNew / rz : 0;
    rz = rzNew;

    // p = z + β·p  (in-place, no heap allocation)
    for (let i = 0; i < n; i++) p[i] = (z[i] ?? 0) + beta * (p[i] ?? 0);
  }

  return {
    u,
    iterations:             iter,
    converged:              relRes < tol,
    finalRelativeResidual:  relRes,
  };
}
