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
 *   1. Build shifted matrix Kσ = K - σ·M (σ=1.0)
 *   2. Initialize random subspace X (n×p) and M-orthonormalize
 *   3. Iterate:
 *      a. Solve Kσ·Y[:,j] = M·X[:,j] via PCG
 *      b. Compute reduced matrices: Ktilde = Yᵀ·K_orig·Y, Mtilde = Yᵀ·M·Y
 *         (K_orig·Y = Kσ·Y + σ·M·Y = MX + σ·MY -- no extra matvec)
 *      c. Solve dense p×p generalized eigenproblem
 *      d. Update X = Y·Z, re-orthonormalize
 *      e. Check convergence on first nModes eigenvalues
 *   4. Extract nModes smallest positive eigenvalues
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
  /** Spectral shift σ (rad²/s²). Default: 1.0 */
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
): { eigenvalues: Float64Array; eigenvectors: Float64Array; iterations: number; converged: boolean } {
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

    // Step f: Check convergence on first nModes eigenvalues
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
      converged = true;
      break;
    }
  }

  if (!converged) {
    console.warn(`[modal] Subspace iteration did not converge in ${iterations} iterations. maxRelChange may still be large. Returning best estimate.`);
  }

  // Extract first nModes columns of X as eigenvectors
  const finalEigvecs = new Float64Array(n * nModes);
  for (let j = 0; j < nModes; j++) {
    finalEigvecs.set(X.subarray(j * n, (j+1) * n), j * n);
  }

  return {
    eigenvalues: eigenvalues.slice(0, nModes),
    eigenvectors: finalEigvecs,
    iterations,
    converged,
  };
}

// ─── Participation factor ─────────────────────────────────────────────────────

function computeParticipationFactor(modeShape: Float64Array, M: CSRMatrix, n: number): number {
  // X-direction participation: φᵀ·M·r where r[i] = 1 if i%3===0, else 0
  const r = new Float64Array(n);
  for (let i = 0; i < n; i += 3) r[i] = 1.0;
  const Mr = new Float64Array(n);
  matvec(M, r, Mr);
  return dot(modeShape, Mr);
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
  const sigma   = input.sigma    ?? 1.0;

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

  // Build shifted matrix Kσ = K - σ·M
  const Ksigma    = buildShiftedMatrix(K, M, sigma);
  const diagIdxKs = buildDiagIdx(Ksigma);

  // Run subspace iteration
  const { eigenvalues, eigenvectors, iterations, converged } = subspaceIterate(
    Ksigma, K, M, diagIdxKs, n, p, nModes, sigma, maxIter, tol, cgTol
  );

  // Pack results
  const RIGID_BODY_THRESHOLD = 1e-3;
  let rigidBodyModeCount = 0;
  const modes: ModeResult[] = [];

  for (let j = 0; j < nModes; j++) {
    const omega2 = eigenvalues[j] ?? 0;
    const modeShape = new Float64Array(n);
    for (let i = 0; i < n; i++) modeShape[i] = eigenvectors[i + j*n] ?? 0;

    const frequencyHz = omega2 > 0 ? Math.sqrt(omega2) / (2 * Math.PI) : 0;
    const participationFactor = computeParticipationFactor(modeShape, M, n);

    if (omega2 < RIGID_BODY_THRESHOLD) rigidBodyModeCount++;

    modes.push({ frequencyHz, omega2, modeShape, participationFactor });
  }

  if (rigidBodyModeCount === nModes) {
    throw new Error(
      `Modal analysis found ${nModes} rigid-body modes (ω² < ${RIGID_BODY_THRESHOLD}). ` +
      `Apply boundary conditions before running modal analysis.`
    );
  }

  const modalMs = Date.now() - t0;
  console.log(`[modal] ${nModes} modes in ${modalMs}ms, converged=${converged}, iter=${iterations}, f1=${modes.find(m => m.frequencyHz > 1)?.frequencyHz.toFixed(1) ?? '?'}Hz`);

  return { modes, converged, iterations, rigidBodyModeCount, modalMs };
}
