/**
 * buckling.ts
 * -----------
 * Linear buckling (eigenvalue) analysis.
 *
 * Solves: (K + λ·Kσ)·φ = 0
 * for the smallest positive λ (Buckling Load Factor, BLF).
 *
 * The elastic stiffness K must already have Dirichlet BCs applied via the
 * penalty method (same K used for the linear static solve).
 * Kσ is the geometric stiffness assembled from the pre-stress state.
 *
 * ALGORITHM
 * =========
 * Inverse power iteration on the operator K⁻¹·(-Kσ):
 *   For compressive loading Kσ < 0, so -Kσ > 0.
 *   The largest eigenvalue μ of K⁻¹·(-Kσ) corresponds to the smallest BLF λ = μ.
 *
 * Steps per iteration:
 *   1. v = -Kσ·x     (matvec with negated Kσ)
 *   2. Solve K·y = v  (PCG)
 *   3. λ = yᵀ·v / yᵀ·(-Kσ·y)   (Rayleigh quotient update)
 *   4. x = y / ‖y‖₂
 *
 * Convergence: |λ_new − λ_old| / (|λ_old| + ε) < tol
 *
 * A positive BLF means the applied load must be multiplied by λ before
 * buckling occurs. Negative or zero BLF indicates the pre-stress state is
 * tensile (no buckling possible from that mode).
 */

import type { CSRMatrix } from "./types.js";
import { matvec } from "./assembly.js";
import { solvePCG } from "./cg.js";

export interface BucklingResult {
  /** Buckling Load Factor: multiplier on applied load at which structure buckles. */
  readonly blf:        number;
  /** True if the power iteration converged within maxIter. */
  readonly converged:  boolean;
  /** Number of iterations performed. */
  readonly iterations: number;
  /** True if the stress state is predominantly tensile (no compressive Kσ energy). */
  readonly tensileDominated: boolean;
}

/**
 * Compute the smallest positive Buckling Load Factor via inverse power iteration.
 *
 * @param K      Global elastic stiffness (with Dirichlet BCs applied, n×n CSR)
 * @param Ksigma Global geometric stiffness (same sparsity as K, assembled from pre-stress)
 * @param diagIdx Diagonal index array for K (needed by PCG preconditioner)
 * @param maxIter Maximum power iterations (default 80)
 * @param tol     Relative convergence tolerance (default 1e-4)
 */
export async function runLinearBuckling(
  K:        CSRMatrix,
  Ksigma:   CSRMatrix,
  diagIdx:  Int32Array,
  maxIter = 80,
  tol     = 1e-4,
): Promise<BucklingResult> {
  const n = K.n;

  // Initial vector: must NOT be a rigid-body motion (uniform translation lies in
  // null(Kσ) because ΣβᵢNᵢ=0 by the partition-of-unity property of shape functions).
  // Use a pseudo-random pattern that excites bending/shear modes.
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // Mix of all DOF types with varying magnitudes per node to break symmetry.
    // The hash-based pattern is deterministic and cheap.
    const h = ((i * 1664525 + 1013904223) >>> 0) / 4294967296;
    x[i] = h - 0.5;   // values in [-0.5, 0.5]
  }
  let xNorm = 0;
  for (let i = 0; i < n; i++) xNorm += x[i]! * x[i]!;
  xNorm = Math.sqrt(xNorm);
  for (let i = 0; i < n; i++) x[i] = x[i]! / xNorm;

  // Scratch buffers
  const v    = new Float64Array(n);  // -Kσ·x
  const Ksy  = new Float64Array(n);  // Kσ·y

  let blf = 1.0;
  let converged = false;
  let iterations = 0;
  // Track whether we ever saw meaningful compressive Kσ energy during iteration.
  // (Cannot check pre-loop: K has penalty BCs that inflate ‖K·x‖ by ~1e8,
  //  making ‖Kσ·x‖/‖K·x‖ look negligible even for valid compressive Kσ.)
  let sawCompression = false;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;

    // Step 1: v = -Kσ·x
    matvec(Ksigma, x, v);
    let vNormSq = 0;
    for (let i = 0; i < n; i++) {
      v[i] = -(v[i] ?? 0);
      vNormSq += v[i]! * v[i]!;
    }
    if (vNormSq < 1e-40) break;  // Kσ·x ≈ 0 — no compressive mode excited
    sawCompression = true;

    // Step 2: Solve K·y = v
    const cg = solvePCG(K, new Float64Array(v), diagIdx, 1e-8, 2000);
    const y = cg.u;

    // Step 3: Rayleigh quotient λ = yᵀ·v / yᵀ·(-Kσ·y)
    //   yᵀ·v ≈ yᵀ·K·y (since K·y = v exactly at convergence)
    let yTv = 0;
    for (let i = 0; i < n; i++) yTv += (y[i]??0) * (v[i]??0);

    matvec(Ksigma, y, Ksy);
    let yTnKsy = 0;
    for (let i = 0; i < n; i++) yTnKsy += (y[i]??0) * (-(Ksy[i]??0));

    if (Math.abs(yTnKsy) < 1e-30) break;  // Kσ·y ≈ 0 — tensile mode

    const blf_new = yTv / yTnKsy;

    // Step 4: normalize x = y / ‖y‖₂
    let yNorm = 0;
    for (let i = 0; i < n; i++) yNorm += (y[i]??0)**2;
    yNorm = Math.sqrt(yNorm);
    if (yNorm < 1e-30) break;
    for (let i = 0; i < n; i++) x[i] = (y[i]??0) / yNorm;

    const err = Math.abs(blf_new - blf) / (Math.abs(blf) + 1e-10);
    blf = blf_new;

    if (err < tol) { converged = true; break; }
  }

  return { blf, converged, iterations, tensileDominated: !sawCompression };
}
