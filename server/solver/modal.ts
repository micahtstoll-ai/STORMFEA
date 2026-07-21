/**
 * modal.ts
 * --------
 * Modal eigensolver using subspace iteration (Bathe's method) with shift-invert.
 *
 * Solves the generalized eigenvalue problem: K·φ = ω²·M·φ
 * for the lowest nModes natural frequencies.
 *
 * Unit system: mm / N / MPa / tonne
 *   ω² in rad²/s²,  f_Hz = sqrt(ω²) / (2π)  [no extra factor]
 *
 * Algorithm:
 *   1. Build shifted matrix Kσ = K - σ·M. σ is problem-scaled by default
 *      (autoScaledShift: a fraction of the Rayleigh quotient of the static
 *      deflection under a uniform body load), not a fixed 1.0 (#160.3).
 *   2. Initialize random subspace X (n×p) and M-orthonormalize. p carries a
 *      guard block (p ≥ nModes+8) so clustered/degenerate pairs are resolved.
 *   3. Iterate:
 *      a. Solve Kσ·Y[:,j] = M·X[:,j] via PCG
 *      b. Compute reduced matrices: Ktilde = Yᵀ·K_orig·Y, Mtilde = Yᵀ·M·Y
 *         (K_orig·Y = Kσ·Y + σ·M·Y = MX + σ·MY -- no extra matvec)
 *      c. Solve dense p×p generalized eigenproblem
 *      d. Update X = Y·Z, re-orthonormalize
 *      e. Check convergence on first nModes eigenvalues
 *   4. Extract nModes smallest positive eigenvalues.
 *   5. Certify band-completeness (guard-block + per-mode residual, #160.1/.2),
 *      label rigid modes (#160.4), and form three-direction participation and
 *      effective modal mass (#161).
 */

import type { CSRMatrix, TetMesh, AnyMaterial, ElementMaterialField, ModalAnalysisResult, ModeResult } from "./types.js";
import { assembleK, matvec, type SparsityPattern } from "./assembly.js";
import { assembleM, assembleMass } from "./mass.js";
import { solvePCG, buildIC0, type IC0Factor } from "./cg.js";

// ─── Density lookup table (tonne/mm³) — FALLBACK ONLY ─────────────────────────
//
// Issue #99: this label-substring lookup is a legacy fallback used only when
// the material carries no massRho. It knows nothing about infill/walls (it
// returns SOLID density), so frequencies computed through it are wrong for
// sparse-infill parts. analysis.ts always sets massRho (solid density ×
// effective volume fraction); the proper path is assembleMass(mesh, material).
// Entries are ordered most-specific-first: "pa12" must precede "nylon" so
// "PA12 (Nylon)" resolves to the PA12 density, not generic nylon.

const DENSITY_T_MM3: Array<[string, number]> = [
  ["steel",  7.85e-9],
  ["iron",   7.87e-9],
  ["alum",   2.70e-9],
  ["titanium", 4.51e-9],
  ["ti-",    4.51e-9],
  ["copper", 8.96e-9],
  ["brass",  8.50e-9],
  ["pa12",   1.01e-9],   // before "nylon": "PA12 (Nylon)" must match pa12
  ["pa6",    1.13e-9],
  ["nylon",  1.15e-9],
  ["petg",   1.27e-9],
  ["abs",    1.05e-9],
  ["tpu",    1.20e-9],
  ["pla",    1.24e-9],
  ["peek",   1.32e-9],
  ["pc",     1.20e-9],
  ["asa",    1.07e-9],
  ["hips",   1.05e-9],
];

/** @deprecated Fallback for materials without massRho — assumes SOLID density. */
function getDensityFromLabel(label: string): number {
  const lower = label.toLowerCase();
  for (const [key, rho] of DENSITY_T_MM3) {
    if (lower.includes(key)) return rho;
  }
  console.warn(`[modal] Unknown material label "${label}"; defaulting to PLA density 1.24e-9 t/mm³`);
  return 1.24e-9;
}

// ─── Exported interface ───────────────────────────────────────────────────────

/**
 * Pristine (NO boundary conditions applied) prebuilt stiffness matrix pieces
 * for reuse across solves on the same mesh (issue #100). The static pipeline
 * applies Dirichlet penalties to ITS copy of the value array; modal applies
 * its own diagonal-scaling penalty to a fresh copy of Kdata, so the two BC
 * flavors never collide. rowPtr/colIdx/diagIdx depend only on connectivity
 * and are shared read-only (they double as the sparsity pattern for M).
 */
export interface ModalPrebuiltK {
  /** Pristine K value array — runModalAnalysis copies it before penalizing. */
  readonly Kdata:   Float64Array;
  readonly rowPtr:  Int32Array;
  readonly colIdx:  Int32Array;
  readonly diagIdx: Int32Array;
}

export interface ModalInput {
  readonly mesh:      TetMesh;
  readonly material:  AnyMaterial;
  /** Optional per-element material field (two-region shell/core model); see
   *  SolverInput.materialField. Applies to both the fallback K assembly and M.
   *  The prebuiltK path is field-consistent by construction — it reuses the
   *  static solve's K, which was assembled with the same field. */
  readonly materialField?: ElementMaterialField;
  /** Node indices where all 3 DOF are pinned (Dirichlet zero). */
  readonly fixedNodes: readonly number[];
  /** Number of modes to extract. Default: 10. */
  readonly nModes?:   number;
  /** Max outer iterations. Default: 300. */
  readonly maxIter?:  number;
  /** Eigenvalue convergence tolerance. Default: 1e-6. */
  readonly tolerance?: number;
  /** Inner PCG tolerance. Default: 1e-9. */
  readonly cgTol?:    number;
  /** Spectral shift σ (rad²/s²). Default: problem-scaled (autoScaledShift) —
   *  a fraction of the static-deflection Rayleigh quotient, kept below λ_min so
   *  Kσ stays SPD. Pass an explicit value to override (#160.3). */
  readonly sigma?:    number;
  /** Optional pristine prebuilt K — skips re-assembling K and rebuilding the
   *  sparsity pattern for M (issue #100). */
  readonly prebuiltK?: ModalPrebuiltK;
}

// ─── Vector helpers ───────────────────────────────────────────────────────────

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

function norm(a: Float64Array): number {
  return Math.sqrt(dot(a, a));
}

// ─── Build shifted matrix ─────────────────────────────────────────────────────

function buildShiftedMatrix(K: CSRMatrix, M: CSRMatrix, sigma: number): CSRMatrix {
  if (K.n !== M.n || K.data.length !== M.data.length) {
    throw new Error(`buildShiftedMatrix: K and M must have identical sparsity. K.n=${K.n} M.n=${M.n}, K.nnz=${K.data.length} M.nnz=${M.data.length}`);
  }
  const data = K.data.slice();
  for (let k = 0; k < data.length; k++) {
    data[k] = (K.data[k] ?? 0) - sigma * (M.data[k] ?? 0);
  }
  return { n: K.n, data, colIdx: K.colIdx, rowPtr: K.rowPtr };
}

function buildDiagIdx(A: CSRMatrix): Int32Array {
  const diagIdx = new Int32Array(A.n);
  for (let i = 0; i < A.n; i++) {
    const start = A.rowPtr[i] ?? 0;
    const end   = A.rowPtr[i+1] ?? A.data.length;
    for (let p = start; p < end; p++) {
      if ((A.colIdx[p] ?? -1) === i) { diagIdx[i] = p; break; }
    }
  }
  return diagIdx;
}

// ─── Deterministic pseudo-random initialization (LCG) ────────────────────────

function initRandomSubspace(n: number, p: number, seed: number): Float64Array {
  const X = new Float64Array(n * p);
  let state = seed >>> 0;
  for (let i = 0; i < n * p; i++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    X[i] = (state / 0x100000000) - 0.5;
  }
  return X;
}

// ─── M-orthonormalization (modified Gram-Schmidt with M inner product) ────────

function mOrthonormalize(
  X:  Float64Array,  // n×p column-major, modified in-place
  M:  CSRMatrix,
  n:  number,
  p:  number,
): Float64Array {  // returns MX: n×p column-major
  const MX = new Float64Array(n * p);
  const Mv = new Float64Array(n);

  for (let j = 0; j < p; j++) {
    const xj = X.subarray(j * n, (j+1) * n);

    // Two-pass modified Gram-Schmidt for stability
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < j; i++) {
        const xi  = X.subarray(i * n, (i+1) * n);
        const Mxi = MX.subarray(i * n, (i+1) * n);
        // alpha = x_i^T * M * x_j = x_i^T * (M*x_j)
        // We use already-computed M*x_i (Mxi) and x_j:
        // alpha = (M*x_i)^T * x_j = Mxi^T * xj  (since M is symmetric)
        const al = dot(Mxi, xj);
        for (let k = 0; k < n; k++) xj[k] = (xj[k] ?? 0) - al * (xi[k] ?? 0);
      }
    }

    // Compute M·xj and normalize
    matvec(M, xj, Mv);
    const mnorm2 = dot(xj, Mv);

    if (mnorm2 < 1e-28) {
      // Near-zero vector: replace with a fresh random direction
      let state = (j * 2654435761 + 1) >>> 0;
      for (let k = 0; k < n; k++) {
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        xj[k] = (state / 0x100000000) - 0.5;
      }
      matvec(M, xj, Mv);
      // Re-orthogonalize the new vector
      for (let i = 0; i < j; i++) {
        const xi  = X.subarray(i * n, (i+1) * n);
        const Mxi = MX.subarray(i * n, (i+1) * n);
        const al  = dot(Mxi, xj);
        for (let k = 0; k < n; k++) xj[k] = (xj[k] ?? 0) - al * (xi[k] ?? 0);
      }
      matvec(M, xj, Mv);
      const newNorm2 = dot(xj, Mv);
      const newNorm  = newNorm2 > 0 ? Math.sqrt(newNorm2) : 1.0;
      const inv = 1.0 / newNorm;
      for (let k = 0; k < n; k++) { xj[k] = (xj[k] ?? 0) * inv; Mv[k] = (Mv[k] ?? 0) * inv; }
    } else {
      const inv = 1.0 / Math.sqrt(mnorm2);
      for (let k = 0; k < n; k++) { xj[k] = (xj[k] ?? 0) * inv; Mv[k] = (Mv[k] ?? 0) * inv; }
    }

    MX.set(Mv, j * n);
  }

  return MX;
}

// ─── Dense p×p helpers (column-major) ────────────────────────────────────────

/** C = Aᵀ·B  (A: n×p, B: n×p, C: p×p, all column-major) */
function denseAtB(
  A: Float64Array, B: Float64Array,
  n: number, p: number,
  C: Float64Array,
): void {
  C.fill(0);
  for (let j = 0; j < p; j++) {
    for (let i = 0; i < p; i++) {
      let s = 0;
      for (let k = 0; k < n; k++) s += (A[k + i*n] ?? 0) * (B[k + j*n] ?? 0);
      C[i + j*p] = s;
    }
  }
}

/** In-place dense Cholesky: A → L (lower triangular), column-major, A = L·Lᵀ */
function denseCholesky(A: Float64Array, p: number): void {
  for (let j = 0; j < p; j++) {
    let diag = A[j + j*p] ?? 0;
    for (let k = 0; k < j; k++) {
      const L_jk = A[j + k*p] ?? 0;
      diag -= L_jk * L_jk;
    }
    if (diag <= 0) throw new Error(`denseCholesky: non-positive pivot at j=${j}, val=${diag}. Reduced mass matrix may be singular.`);
    const ljj = Math.sqrt(diag);
    A[j + j*p] = ljj;
    const inv = 1.0 / ljj;
    for (let i = j+1; i < p; i++) {
      let s = A[i + j*p] ?? 0;
      for (let k = 0; k < j; k++) s -= (A[i + k*p] ?? 0) * (A[j + k*p] ?? 0);
      A[i + j*p] = s * inv;
    }
  }
}

/** Solve L·X = B in-place (lower-triangular L, column-major), multiple RHS */
function denseLowerSolve(L: Float64Array, B: Float64Array, p: number, nrhs: number): void {
  for (let c = 0; c < nrhs; c++) {
    for (let i = 0; i < p; i++) {
      let s = B[i + c*p] ?? 0;
      for (let k = 0; k < i; k++) s -= (L[i + k*p] ?? 0) * (B[k + c*p] ?? 0);
      B[i + c*p] = s / (L[i + i*p] ?? 1);
    }
  }
}

/** Solve Lᵀ·X = B in-place (upper triangular solve), multiple RHS */
function denseUpperSolve(L: Float64Array, B: Float64Array, p: number, nrhs: number): void {
  for (let c = 0; c < nrhs; c++) {
    for (let i = p-1; i >= 0; i--) {
      let s = B[i + c*p] ?? 0;
      for (let k = i+1; k < p; k++) s -= (L[k + i*p] ?? 0) * (B[k + c*p] ?? 0);
      B[i + c*p] = s / (L[i + i*p] ?? 1);
    }
  }
}

/**
 * Symmetric Jacobi on A (p×p, column-major).
 * Returns Q (eigenvectors as columns); A is overwritten with eigenvalues on diagonal.
 *
 * Exported: the buckling solver (buckling.ts, #138) reuses this dense symmetric
 * eigensolver. Keep the signature stable.
 */
export function symmetricJacobi(A: Float64Array, p: number): Float64Array {
  const Q = new Float64Array(p * p);
  // Initialize Q = I
  for (let i = 0; i < p; i++) Q[i + i*p] = 1.0;

  const TOL = 1e-13;
  const MAX_SWEEPS = 60;

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let maxOff = 0;
    for (let i = 0; i < p; i++)
      for (let j = i+1; j < p; j++)
        maxOff = Math.max(maxOff, Math.abs(A[i + j*p] ?? 0));

    const maxDiag = (() => { let m = 0; for (let i = 0; i < p; i++) m = Math.max(m, Math.abs(A[i + i*p] ?? 0)); return m; })();
    if (maxOff < TOL * maxDiag) break;

    for (let i = 0; i < p-1; i++) {
      for (let j = i+1; j < p; j++) {
        const Aij = A[i + j*p] ?? 0;
        if (Math.abs(Aij) < 1e-15 * maxDiag) continue;

        const Aii = A[i + i*p] ?? 0;
        const Ajj = A[j + j*p] ?? 0;
        const theta = (Ajj - Aii) / (2 * Aij);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(1 + theta*theta));
        const c = 1 / Math.sqrt(1 + t*t);
        const s = t * c;

        // Apply rotation to A
        A[i + i*p] = Aii - t * Aij;
        A[j + j*p] = Ajj + t * Aij;
        A[i + j*p] = 0;
        A[j + i*p] = 0;

        for (let k = 0; k < p; k++) {
          if (k === i || k === j) continue;
          const Aki = A[k + i*p] ?? 0;
          const Akj = A[k + j*p] ?? 0;
          A[k + i*p] = c * Aki - s * Akj;
          A[i + k*p] = c * Aki - s * Akj;
          A[k + j*p] = s * Aki + c * Akj;
          A[j + k*p] = s * Aki + c * Akj;
        }

        // Apply rotation to Q
        for (let k = 0; k < p; k++) {
          const Qki = Q[k + i*p] ?? 0;
          const Qkj = Q[k + j*p] ?? 0;
          Q[k + i*p] = c * Qki - s * Qkj;
          Q[k + j*p] = s * Qki + c * Qkj;
        }
      }
    }
  }

  return Q;
}

/**
 * Solve dense p×p symmetric generalized eigenproblem: Ktilde·z = mu·Mtilde·z
 * Returns eigenvalues sorted ascending and eigenvectors as columns of Z.
 */
function solveDenseGeneralizedEig(
  Ktilde: Float64Array,
  Mtilde: Float64Array,
  p:      number,
): { eigenvalues: Float64Array; eigenvectors: Float64Array } {
  // 1. Cholesky: Mtilde = L·Lᵀ  (L stored in Mtilde)
  const L = Mtilde.slice();  // copy so we don't destroy input
  denseCholesky(L, p);

  // 2. Form B = L⁻¹·Ktilde·L⁻ᵀ
  // First: solve L·X = Ktilde  → X (p×p)
  const X = Ktilde.slice();
  denseLowerSolve(L, X, p, p);  // X is now L⁻¹·Ktilde (treating X as having p columns)

  // Now B = X·L⁻ᵀ = (L⁻¹·Ktilde)·L⁻ᵀ
  // B[i,j] = X[i,k] * L⁻ᵀ[k,j] = sum_k X[i,k] * (L⁻¹)[j,k]
  // Solve Lᵀ·Bᵀ = Xᵀ → Bᵀ  (treating Xᵀ as the RHS)
  // Equivalently: solve B·Lᵀ = X, i.e., for each row of B solve (Lᵀ)ᵀ·b = x
  // i.e., solve L·Bᵀ[:,j] = X[:,j] (no, that's not right)
  //
  // Actually: B = L⁻¹·K·L⁻ᵀ so Bᵀ = L⁻¹·Kᵀ·L⁻ᵀ = B (symmetric)
  // We need B[i,j] = sum_k L⁻¹[i,k] * K[k,l] * L⁻ᵀ[l,j]
  // X = L⁻¹·K means X[i,k] = (L⁻¹·K)[i,k], so
  // B[i,j] = sum_l X[i,l] * L⁻ᵀ[l,j]
  // L⁻ᵀ means (L⁻¹)ᵀ = (Lᵀ)⁻¹
  // So B = X·(Lᵀ)⁻¹, i.e. B·Lᵀ = X, solve for B by solving Lᵀ·Bᵀ = Xᵀ
  // Since K is symmetric and we want the symmetric B, symmetrize at the end.

  // B[:,j]: B·Lᵀ = X → for each column j of B, solve Lᵀ·B[:,j] = X[:,j] ... no
  //
  // Simplest correct approach: Bᵀ = L⁻¹·K·(L⁻¹)ᵀ
  // We have X = L⁻¹·K (p×p, X[i,j] = row i of L⁻¹ dotted with col j of K)
  // We need B = X·(Lᵀ)⁻¹ = X·(L⁻ᵀ)
  // B[:,j] = X·e_j where e_j is the j-th column of L⁻ᵀ
  // Solve Lᵀ·y = e_j → y = L⁻ᵀ·e_j, then B[:,j] = X·y  ... too complex
  //
  // Alternative: use the transpose. B[i,j] = sum_{k,l} L⁻¹[i,k] K[k,l] L⁻¹[j,l]
  // = sum_k X[i,k] * (L⁻¹)^T[k,j]
  // Since L⁻¹ is lower, (L⁻¹)ᵀ is upper. Let's compute this column by column:
  // B[:,j] = X · (L⁻¹[:,j])
  // L⁻¹[:,j] = j-th column of L⁻¹ = solution to L·y = e_j
  const B = new Float64Array(p * p);
  const ej = new Float64Array(p);
  const y  = new Float64Array(p);
  for (let j = 0; j < p; j++) {
    ej.fill(0); ej[j] = 1.0;
    y.set(ej);
    denseLowerSolve(L, y, p, 1);  // y = L⁻¹·e_j = j-th column of L⁻¹
    // B[:,j] = X·y
    for (let i = 0; i < p; i++) {
      let s = 0;
      for (let k = 0; k < p; k++) s += (X[i + k*p] ?? 0) * (y[k] ?? 0);
      B[i + j*p] = s;
    }
  }
  // Symmetrize B (should already be symmetric up to fp errors)
  for (let i = 0; i < p; i++)
    for (let j = i+1; j < p; j++) {
      const avg = 0.5 * ((B[i + j*p] ?? 0) + (B[j + i*p] ?? 0));
      B[i + j*p] = avg; B[j + i*p] = avg;
    }

  // 3. Symmetric Jacobi on B → eigenvalues on diagonal, Q = eigenvectors
  const Q = symmetricJacobi(B, p);

  // Extract eigenvalues from diagonal of B
  const eigenvalues = new Float64Array(p);
  for (let i = 0; i < p; i++) eigenvalues[i] = B[i + i*p] ?? 0;

  // 4. Recover generalized eigenvectors: Z = L⁻ᵀ·Q
  // Solve Lᵀ·Z = Q for Z
  const Z = Q.slice();
  denseUpperSolve(L, Z, p, p);

  // 5. Sort by ascending eigenvalue
  const order = Array.from({ length: p }, (_, i) => i).sort(
    (a, b) => (eigenvalues[a] ?? 0) - (eigenvalues[b] ?? 0)
  );
  const sortedEigenvalues = new Float64Array(p);
  const sortedEigenvectors = new Float64Array(p * p);
  for (let j = 0; j < p; j++) {
    sortedEigenvalues[j] = eigenvalues[order[j]!] ?? 0;
    for (let i = 0; i < p; i++) {
      sortedEigenvectors[i + j*p] = Z[i + (order[j]!) * p] ?? 0;
    }
  }

  return { eigenvalues: sortedEigenvalues, eigenvectors: sortedEigenvectors };
}

// ─── Subspace iteration ───────────────────────────────────────────────────────

function subspaceIterate(
  Ksigma:    CSRMatrix,
  K:         CSRMatrix,
  M:         CSRMatrix,
  diagIdxKs: Int32Array,
  n:         number,
  p:         number,
  nModes:    number,
  sigma:     number,
  maxIter:   number,
  tol:       number,
  cgTol:     number,
): {
  /** All p Ritz values (ascending). The lowest nModes are the reported modes;
   *  the remaining q = p − nModes are the guard block used for #160 certification. */
  eigenvalues:  Float64Array;
  /** n×p column-major M-orthonormal Ritz vectors (all p, not just nModes). */
  eigenvectors: Float64Array;
  /** n×p column-major M·(Ritz vectors), consistent with `eigenvectors`. */
  MX:           Float64Array;
  iterations:   number;
  /** Eigenvalue-change convergence only; per-mode residual gating is applied by
   *  the caller (runModalAnalysis) so it can also fold in guard-block certification. */
  converged:    boolean;
} {
  // Initialize random subspace X (n×p, column-major)
  let X = initRandomSubspace(n, p, 42);
  let MX = mOrthonormalize(X, M, n, p);

  const Y  = new Float64Array(n * p);
  const MY = new Float64Array(n * p);

  // Factor Kσ ONCE (issue #100). Kσ never changes across the p × maxIter inner
  // PCG solves, but solvePCG used to rebuild the IC(0) factorization on every
  // call — up to p × maxIter redundant factorizations per modal run.
  let ic0: IC0Factor | null = null;
  try {
    ic0 = buildIC0(Ksigma, diagIdxKs);
  } catch (e) {
    console.warn(`[modal] IC(0) factorization of Kσ failed (${e instanceof Error ? e.message : e}) — using Jacobi preconditioner`);
  }

  let prevEigvals: Float64Array = new Float64Array(nModes).fill(Infinity);
  let eigenvalues: Float64Array = new Float64Array(p);
  let eigenvectors: Float64Array = new Float64Array(p * p);
  const residWork = new Float64Array(n);   // scratch for the step-f residual check
  let converged = false;
  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;

    // Step a: Solve Ksigma·Y[:,j] = MX[:,j] for each j
    // (reusing the single IC(0) factor built before the iteration loop)
    for (let j = 0; j < p; j++) {
      const rhs = MX.subarray(j * n, (j+1) * n);
      let cgResult;
      try {
        cgResult = ic0
          ? solvePCG(Ksigma, rhs, diagIdxKs, cgTol, 5000, 'ic0', ic0)
          : solvePCG(Ksigma, rhs, diagIdxKs, cgTol, 5000, 'jacobi');
      } catch {
        // Fallback to Jacobi if the preconditioned solve fails
        try {
          cgResult = solvePCG(Ksigma, rhs, diagIdxKs, cgTol * 10, 5000, 'jacobi');
        } catch (e2) {
          throw new Error(`Modal subspace iteration: inner PCG failed at iter=${iter}, mode=${j}: ${e2}`);
        }
      }
      Y.set(cgResult.u, j * n);
    }

    // Step b: Compute MY = M·Y and projected matrices
    // K_orig·Y[:,j] = Ksigma·Y[:,j] + sigma·M·Y[:,j] = MX[:,j] + sigma·MY[:,j]
    for (let j = 0; j < p; j++) {
      const yj = Y.subarray(j * n, (j+1) * n);
      const Myj = MY.subarray(j * n, (j+1) * n);
      matvec(M, yj, Myj);
    }

    // KY_orig[:,j] = MX[:,j] + sigma*MY[:,j]
    const KY = new Float64Array(n * p);
    for (let j = 0; j < p; j++) {
      for (let i = 0; i < n; i++) {
        KY[i + j*n] = (MX[i + j*n] ?? 0) + sigma * (MY[i + j*n] ?? 0);
      }
    }

    // Ktilde = Yᵀ·KY_orig,  Mtilde = Yᵀ·MY
    const Ktilde = new Float64Array(p * p);
    const Mtilde = new Float64Array(p * p);
    denseAtB(Y, KY, n, p, Ktilde);
    denseAtB(Y, MY, n, p, Mtilde);

    // Step c: Solve dense generalized eigenproblem
    let eigenResult;
    try {
      eigenResult = solveDenseGeneralizedEig(Ktilde, Mtilde, p);
    } catch (e) {
      console.warn(`[modal] Dense eigenproblem failed at iter=${iter}: ${e}. Continuing with Jacobi preconditioner.`);
      // Try to continue with prev result if available
      if (iter === 0) throw e;
      break;
    }
    eigenvalues  = new Float64Array(eigenResult.eigenvalues);
    eigenvectors = new Float64Array(eigenResult.eigenvectors);

    // Step d: Update X = Y·Z (eigenvectors), column-major matrix multiply
    const Xnew = new Float64Array(n * p);
    for (let j = 0; j < p; j++) {
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = 0; k < p; k++) s += (Y[i + k*n] ?? 0) * (eigenvectors[k + j*p] ?? 0);
        Xnew[i + j*n] = s;
      }
    }
    X = Xnew;

    // Step e: M-orthonormalize
    MX = mOrthonormalize(X, M, n, p);

    // Step f: convergence — eigenvalue change AND per-mode residual (#160.2).
    // Eigenvalue-change alone freezes on clustered/degenerate pairs (their
    // eigenvalues coincide while the vectors are still mixing), so it can report
    // "converged" with mode shapes that are not yet true eigenvectors. Require
    // ‖Kφ − ω²Mφ‖/‖ω²Mφ‖ < MODAL_RESIDUAL_TOL on every non-rigid reported mode.
    let maxRelChange = 0;
    for (let j = 0; j < nModes; j++) {
      const prev = prevEigvals[j] ?? Infinity;
      const curr = eigenvalues[j] ?? 0;
      if (Math.abs(prev) > 1e-14) {
        maxRelChange = Math.max(maxRelChange, Math.abs(curr - prev) / Math.abs(prev));
      } else {
        maxRelChange = Math.max(maxRelChange, Math.abs(curr - prev));
      }
    }
    for (let j = 0; j < nModes; j++) prevEigvals[j] = eigenvalues[j] ?? 0;

    if (maxRelChange < tol) {
      // Eigenvalues have stabilized — verify the shapes are true eigenvectors
      // before declaring convergence (the extra K matvecs run only in this
      // stabilized tail, not every iteration).
      let maxResid = 0;
      for (let j = 0; j < nModes; j++) {
        const omega2 = eigenvalues[j] ?? 0;
        if (omega2 < 1e-3) continue;   // rigid/near-zero: relative residual undefined
        const xj  = X.subarray(j * n, (j + 1) * n);
        const Mxj = MX.subarray(j * n, (j + 1) * n);
        matvec(K, xj, residWork);
        maxResid = Math.max(maxResid, modeResidual(residWork, Mxj, omega2, n));
      }
      if (maxResid < MODAL_RESIDUAL_TOL) {
        converged = true;
        break;
      }
    }
  }

  if (!converged) {
    console.warn(`[modal] Subspace iteration did not converge in ${iterations} iterations. maxRelChange may still be large. Returning best estimate.`);
  }

  // Return the FULL p-dimensional Ritz space. X (updated + M-orthonormalized on
  // the last iteration) holds the M-orthonormal Ritz vectors and MX = M·X is the
  // matching product; eigenvalues holds all p Ritz values. The caller slices the
  // lowest nModes for reporting and uses the q = p − nModes guard vectors to
  // certify band-completeness (#160) — and reuses MX for participation (#161)
  // with no extra M matvecs.
  return {
    eigenvalues: eigenvalues.slice(),   // length p
    eigenvectors: X,                    // n×p
    MX,                                 // n×p
    iterations,
    converged,
  };
}

// ─── Participation factors & effective modal mass (#161) ──────────────────────

/**
 * Three-direction modal participation and effective mass for one mode.
 *
 *   Γd    = φᵀ·M·r_d          (r_d = unit rigid-body translation in direction d)
 *   meffd = Γd² / (φᵀ·M·φ)    (effective modal mass in direction d, tonne)
 *
 * The influence vectors r_x/r_y/r_z select the x/y/z DOFs (stride 3), so
 * Γd = Σ_{i: i%3==d} (M·φ)_i — a single M·φ (supplied as `Mphi`) yields all three
 * directions with no extra matvec. φᵀMφ likewise comes from Mphi.
 */
function computeParticipation(
  modeShape: Float64Array,
  Mphi:      Float64Array,   // M·modeShape (precomputed, shared with the residual check)
  n:         number,
): { gammaX: number; gammaY: number; gammaZ: number;
     meffX: number; meffY: number; meffZ: number; mNorm2: number } {
  let gammaX = 0, gammaY = 0, gammaZ = 0, mNorm2 = 0;
  for (let i = 0; i < n; i++) {
    const mi = Mphi[i] ?? 0;
    const d = i % 3;
    if (d === 0) gammaX += mi;
    else if (d === 1) gammaY += mi;
    else gammaZ += mi;
    mNorm2 += (modeShape[i] ?? 0) * mi;   // φᵀ·M·φ
  }
  const inv = mNorm2 > 1e-30 ? 1 / mNorm2 : 0;
  return {
    gammaX, gammaY, gammaZ,
    meffX: gammaX * gammaX * inv,
    meffY: gammaY * gammaY * inv,
    meffZ: gammaZ * gammaZ * inv,
    mNorm2,
  };
}

/**
 * Total translational mass per direction: rᵀd·M·rd = Σ over the direction-d rows
 * of the row-sums of M. Used as the denominator for cumulative effective-mass
 * fractions (they approach 1 as the modal basis becomes complete in direction d).
 */
function directionalTotalMass(M: CSRMatrix, n: number): { x: number; y: number; z: number } {
  // r_d[i] = 1 for i%3==d. rᵀd·M·rd = Σ_{i%3==d} Σ_{j%3==d} M[i,j] — three cheap
  // masked matvecs (once per solve).
  let x = 0, y = 0, z = 0;
  const rd = new Float64Array(n);
  const Mrd = new Float64Array(n);
  for (let d = 0; d < 3; d++) {
    rd.fill(0);
    for (let i = d; i < n; i += 3) rd[i] = 1.0;
    matvec(M, rd, Mrd);
    const m = dot(rd, Mrd);
    if (d === 0) x = m; else if (d === 1) y = m; else z = m;
  }
  return { x, y, z };
}

/**
 * Relative eigen-residual ‖K·φ − ω²·M·φ‖ / ‖ω²·M·φ‖ for one Ritz pair (#160.2).
 * Returns 0 for near-zero ω² (rigid modes), where the denominator vanishes.
 * `Kphi` and `Mphi` are precomputed matvecs.
 */
function modeResidual(Kphi: Float64Array, Mphi: Float64Array, omega2: number, n: number): number {
  let rr = 0, denom = 0;
  for (let i = 0; i < n; i++) {
    const t = (Kphi[i] ?? 0) - omega2 * (Mphi[i] ?? 0);
    rr += t * t;
    const dref = omega2 * (Mphi[i] ?? 0);
    denom += dref * dref;
  }
  if (denom < 1e-300) return 0;
  return Math.sqrt(rr / denom);
}

/** Per-mode relative eigen-residual tolerance — the true convergence gate
 *  (#160.2). Eigenvalue-change alone can freeze on clustered/degenerate pairs
 *  (equal eigenvalues, un-converged vectors); a mode counts as converged only
 *  once ‖Kφ−ω²Mφ‖/‖ω²Mφ‖ falls below this. */
const MODAL_RESIDUAL_TOL = 1e-3;

/**
 * Problem-scaled spectral shift (#160.3). A fixed σ = 1.0 rad²/s² is meaningless
 * against a stiff SI-mm part (ω² ~ 1e8) and — worse — a POSITIVE shift near the
 * spectrum makes Kσ = K − σM indefinite whenever the part carries rigid-body
 * modes (partial or full under-constraint), collapsing the reduced mass matrix.
 *
 * We use a NEGATIVE shift scaled to the problem: σ = −SHIFT_FRACTION·λ_est, so
 * Kσ = K + |σ|·M is symmetric positive-definite in EVERY case (well-constrained
 * or rigid-mode-bearing), which both keeps the SPD PCG/IC(0) path valid and
 * regularizes rigid modes to a small positive Kσ eigenvalue (the textbook fix).
 * Shift-invert still targets the lowest ω² (largest 1/(ω²+|σ|)).
 *
 * λ_est estimates the lowest-eigenvalue scale from a static deflection: solve
 * K·y = M·1 (deflection under a uniform body excitation — a smooth, fundamental-
 * dominated field) and take its Rayleigh quotient λ_est = (yᵀKy)/(yᵀMy) ≥ λ_min.
 * The raw RHS Rayleigh quotient Rg = (gᵀKg)/(gᵀMg) is an upper bound and a
 * guard: a good solve LOWERS the quotient (Ry ≤ Rg), so Ry > Rg means the solve
 * was unreliable (e.g. a singular K) and we fall back to Rg. Total failure →
 * σ = 0 (still SPD when K itself is SPD).
 */
function autoScaledShift(
  K: CSRMatrix, M: CSRMatrix, diagIdxK: Int32Array,
  fixedNodes: readonly number[], n: number,
): number {
  const SHIFT_FRACTION = 0.5;
  try {
    const g = new Float64Array(n).fill(1.0);
    // Keep the excitation off the penalized (constrained) DOFs.
    for (const ni of fixedNodes) {
      for (let d = 0; d < 3; d++) { const dof = ni * 3 + d; if (dof < n) g[dof] = 0; }
    }
    const Mg = new Float64Array(n);
    const Kg = new Float64Array(n);
    matvec(M, g, Mg);
    matvec(K, g, Kg);
    const gMg = dot(g, Mg);
    const Rg = gMg > 0 ? dot(g, Kg) / gMg : 0;   // upper bound on λ_min (Rayleigh)
    if (!(Rg > 0) || !isFinite(Rg)) return 0;

    // Static-deflection Rayleigh quotient — IC(0) with a Jacobi fallback.
    let lambdaEst = Rg;
    try {
      let ic0: IC0Factor | null = null;
      try { ic0 = buildIC0(K, diagIdxK); } catch { ic0 = null; }
      const y = ic0
        ? solvePCG(K, Mg, diagIdxK, 1e-8, 5000, 'ic0', ic0).u
        : solvePCG(K, Mg, diagIdxK, 1e-6, 5000, 'jacobi').u;
      const Ky = new Float64Array(n);
      const My = new Float64Array(n);
      matvec(K, y, Ky);
      matvec(M, y, My);
      const num = dot(y, Ky);   // yᵀ·K·y
      const den = dot(y, My);   // yᵀ·M·y
      const Ry = den > 0 ? num / den : Infinity;
      // Accept the refined estimate only if the solve genuinely improved it.
      if (isFinite(Ry) && Ry > 0 && Ry <= Rg * (1 + 1e-6)) lambdaEst = Ry;
    } catch {
      // keep lambdaEst = Rg
    }

    const sigma = -SHIFT_FRACTION * lambdaEst;
    return isFinite(sigma) ? sigma : 0;
  } catch {
    return 0;
  }
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Solve K·φ = ω²·M·φ for the lowest nModes natural frequencies.
 * Assembles K and M internally; applies Dirichlet BCs via penalty method.
 */
export async function runModalAnalysis(input: ModalInput): Promise<ModalAnalysisResult> {
  const t0 = Date.now();

  const nModes  = input.nModes  ?? 10;
  const maxIter = input.maxIter ?? 300;
  const tol     = input.tolerance ?? 1e-6;
  const cgTol   = input.cgTol    ?? 1e-9;
  // σ (#160.3): default is now problem-scaled (autoScaledShift, computed below
  // once K and M exist). An explicit input.sigma still wins for callers/tests.

  const { mesh, material, fixedNodes } = input;
  const n = mesh.nodeCount * 3;

  if (n === 0) throw new Error("runModalAnalysis: empty mesh");

  // Subspace size: p = max(2*nModes, nModes+8), capped by n
  const p = Math.min(Math.max(2 * nModes, nModes + 8), n);
  if (p <= nModes) throw new Error(`runModalAnalysis: subspace size p=${p} must be > nModes=${nModes}`);

  // Obtain K (pristine) and M.
  // K path (issue #100): when the caller already assembled K for the static
  // solve, reuse its pristine value array (copied — the penalty below must not
  // leak into the caller's copy) and its sparsity pattern instead of running a
  // full re-assembly + pattern rebuild.
  // Mass path (issue #99): use the material's massRho via assembleMass — set by
  // analysis.ts to solid density × effective volume fraction (infill + walls),
  // so mass tracks infill the same way stiffness does. The label-based lookup
  // is a legacy fallback that assumes SOLID density and is labelled as such.
  let K: CSRMatrix;
  let kDiagIdx: Int32Array;
  if (input.prebuiltK) {
    const pb = input.prebuiltK;
    if (pb.rowPtr.length - 1 !== n) {
      throw new Error(`runModalAnalysis: prebuiltK size mismatch — rowPtr implies n=${pb.rowPtr.length - 1}, mesh implies n=${n}`);
    }
    K = { n, data: pb.Kdata.slice(), colIdx: pb.colIdx, rowPtr: pb.rowPtr };
    kDiagIdx = pb.diagIdx;
  } else {
    const asm = await assembleK(mesh, material, 'auto', undefined, input.materialField);
    K = asm.K;
    kDiagIdx = asm.diagIdx;
  }
  // M shares K's sparsity pattern (same mesh connectivity) — build it once.
  const pattern: SparsityPattern = { rowPtr: K.rowPtr, colIdx: K.colIdx, diagIdx: kDiagIdx };
  let M: CSRMatrix;
  if ((material as { massRho?: number }).massRho !== undefined || input.materialField) {
    const massResult = assembleMass(mesh, material, 'consistent', pattern, input.materialField) as { M: CSRMatrix; diagIdx: Int32Array };
    M = massResult.M;
  } else {
    console.warn(
      `[modal] material "${material.label}" has no massRho — falling back to ` +
      `label-based SOLID density (infill/wall mass reduction NOT applied; ` +
      `frequencies will be underestimated for sparse-infill parts)`,
    );
    const rho = getDensityFromLabel(material.label);
    M = assembleM(mesh, rho, pattern).M;
  }

  // Apply penalty to constrained DOFs in K only.
  // For constrained DOF: ω²_constrained = K_penalty/M_diag = PENALTY*K_orig/M_orig >> structural modes.
  // Do NOT penalize M — that would keep ω² = PENALTY*K/PENALTY*M = K/M (unchanged).
  const PENALTY = 1e8;
  for (const ni of fixedNodes) {
    for (let d = 0; d < 3; d++) {
      const dof = ni * 3 + d;
      if (dof >= n) continue;
      const kPos = kDiagIdx[dof];
      if (kPos !== undefined) K.data[kPos] = (K.data[kPos] ?? 0) * PENALTY;
    }
  }

  // Spectral shift σ (#160.3): problem-scaled by default, explicit override honored.
  const sigma = input.sigma ?? autoScaledShift(K, M, kDiagIdx, fixedNodes, n);

  // Build shifted matrix Kσ = K - σ·M
  const Ksigma    = buildShiftedMatrix(K, M, sigma);
  const diagIdxKs = buildDiagIdx(Ksigma);

  // Run subspace iteration — returns the FULL p-dimensional Ritz space so we can
  // certify band-completeness (#160.1), gate on residuals (#160.2), and form
  // participation/effective mass (#161) here where K and M are in scope.
  const { eigenvalues, eigenvectors, MX, iterations, converged: eigenConverged } = subspaceIterate(
    Ksigma, K, M, diagIdxKs, n, p, nModes, sigma, maxIter, tol, cgTol
  );

  // ── Total translational mass per direction (rᵀd·M·rd) — #161 denominators. ──
  const totalMass = directionalTotalMass(M, n);

  // ── Per-Ritz-pair diagnostics for all p vectors: residual + rigid flag. ─────
  // Reused twice: reported modes (0..nModes) and guard block (nModes..p) for
  // #160 certification. K·φ needs a matvec; M·φ is already MX (no extra matvec).
  const RIGID_BODY_THRESHOLD = 1e-3;         // ω² threshold for a near-zero (rigid) mode
  const RESIDUAL_TOL = MODAL_RESIDUAL_TOL;   // relative eigen-residual gate for "converged"
  const CLUSTER_REL_GAP = 1e-4;              // boundary spectral-gap tolerance for certification

  const Kphi = new Float64Array(n);
  const residualsAll = new Float64Array(p);
  for (let j = 0; j < p; j++) {
    const omega2 = eigenvalues[j] ?? 0;
    const phij = eigenvectors.subarray(j * n, (j + 1) * n);
    const Mphij = MX.subarray(j * n, (j + 1) * n);
    matvec(K, phij, Kphi);
    residualsAll[j] = modeResidual(Kphi, Mphij, omega2, n);
  }

  // ── Pack the reported modes (lowest nModes), accumulating cumulative mass. ──
  let rigidBodyModeCount = 0;
  const modes: ModeResult[] = [];
  let cumX = 0, cumY = 0, cumZ = 0;
  let maxReportedResidual = 0;

  for (let j = 0; j < nModes; j++) {
    const omega2 = eigenvalues[j] ?? 0;
    const modeShape = new Float64Array(n);
    modeShape.set(eigenvectors.subarray(j * n, (j + 1) * n));
    const Mphi = MX.subarray(j * n, (j + 1) * n);

    const frequencyHz = omega2 > 0 ? Math.sqrt(omega2) / (2 * Math.PI) : 0;
    const rigid = omega2 < RIGID_BODY_THRESHOLD;
    if (rigid) rigidBodyModeCount++;

    const part = computeParticipation(modeShape, Mphi, n);
    cumX += part.meffX; cumY += part.meffY; cumZ += part.meffZ;
    const residual = residualsAll[j] ?? 0;
    if (!rigid) maxReportedResidual = Math.max(maxReportedResidual, residual);

    modes.push({
      frequencyHz, omega2, modeShape,
      participationFactor: part.gammaX,   // legacy alias
      participationX: part.gammaX, participationY: part.gammaY, participationZ: part.gammaZ,
      effectiveMassX: part.meffX, effectiveMassY: part.meffY, effectiveMassZ: part.meffZ,
      cumulativeMassFracX: totalMass.x > 1e-30 ? cumX / totalMass.x : 0,
      cumulativeMassFracY: totalMass.y > 1e-30 ? cumY / totalMass.y : 0,
      cumulativeMassFracZ: totalMass.z > 1e-30 ? cumZ / totalMass.z : 0,
      residual, rigid,
    });
  }

  // ── Missed-mode certification (#160.1): guard-block + residual. ──────────────
  // The working subspace carries q = p − nModes guard vectors above the reported
  // band. If every reported mode has a small residual AND there is a spectral gap
  // between the last reported eigenvalue and the first guard eigenvalue, then no
  // eigenvalue below the highest reported ω² was skipped — clustered/degenerate
  // pairs inside the band are resolved because the enlarged subspace has room for
  // both members. A cluster straddling the top boundary cannot be certified (one
  // member sits in the guard block, outside the reported set) → 'none' + warning.
  // A full sparse Sturm (LDLᵀ inertia count) is out of scope for this PCG solver,
  // so 'sturm' is never emitted — the marker stays honest.
  const warnings: string[] = [];
  const lastReported = eigenvalues[nModes - 1] ?? 0;
  const firstGuard   = eigenvalues[nModes] ?? Infinity;   // p > nModes guaranteed
  const boundaryRelGap = Math.abs(firstGuard - lastReported) /
                         Math.max(Math.abs(lastReported), 1e-30);
  const residualsPass = maxReportedResidual < RESIDUAL_TOL;
  const boundaryGapClear = boundaryRelGap > CLUSTER_REL_GAP;

  let certified: 'guard-block' | 'sturm' | 'none';
  if (residualsPass && boundaryGapClear) {
    certified = 'guard-block';
  } else {
    certified = 'none';
    if (!residualsPass) {
      warnings.push(
        `Missed-mode check not certified: peak reported eigen-residual ` +
        `${maxReportedResidual.toExponential(2)} exceeds ${RESIDUAL_TOL.toExponential(0)} ` +
        `— some reported modes are not fully converged eigenpairs.`
      );
    }
    if (residualsPass && !boundaryGapClear) {
      warnings.push(
        `Missed-mode check not certified: a clustered/degenerate pair straddles the ` +
        `top of the reported band (mode ${nModes} and ${nModes + 1} within ` +
        `${CLUSTER_REL_GAP.toExponential(0)} relative gap). Increase nModes to resolve ` +
        `the full cluster.`
      );
    }
  }

  // Residual gating (#160.2): the returned `converged` requires BOTH eigenvalue
  // convergence AND all reported (non-rigid) modes passing the residual check.
  const converged = eigenConverged && residualsPass;

  // All-rigid: still a hard error (no effective constraints → problem ill-posed).
  if (rigidBodyModeCount === nModes) {
    throw new Error(
      `Modal analysis found ${nModes} rigid-body modes (ω² < ${RIGID_BODY_THRESHOLD}). ` +
      `Apply boundary conditions before running modal analysis.`
    );
  }

  // Partial-rigid (#160.4): ANY near-zero mode while constraints ARE applied is a
  // red flag (under-constraint / mechanism), not a silent 0 Hz fundamental. The
  // modes are labeled per-mode (rigid:true); surface an aggregate warning too.
  if (rigidBodyModeCount > 0 && fixedNodes.length > 0) {
    warnings.push(
      `${rigidBodyModeCount} near-zero (rigid-body) mode(s) found despite ${fixedNodes.length} ` +
      `constrained node(s) — the structure may be under-constrained or contain a mechanism. ` +
      `Affected modes are labeled rigid:true; the reported fundamental may not be a true ` +
      `structural frequency.`
    );
  }

  if (!converged) {
    warnings.push(
      `Eigensolver did not fully converge (eigenvalue-converged=${eigenConverged}, ` +
      `residuals-pass=${residualsPass}). Frequencies are best estimates.`
    );
  }

  const modalMs = Date.now() - t0;
  console.log(
    `[modal] ${nModes} modes in ${modalMs}ms, converged=${converged}, certified=${certified}, ` +
    `iter=${iterations}, σ=${sigma.toExponential(2)}, ` +
    `f1=${modes.find(m => m.frequencyHz > 1)?.frequencyHz.toFixed(1) ?? '?'}Hz` +
    (warnings.length ? `, warnings=${warnings.length}` : '')
  );

  return {
    modes, converged, iterations, rigidBodyModeCount, modalMs,
    certified,
    ...(warnings.length ? { warnings } : {}),
    totalMassX: totalMass.x, totalMassY: totalMass.y, totalMassZ: totalMass.z,
  };
}
