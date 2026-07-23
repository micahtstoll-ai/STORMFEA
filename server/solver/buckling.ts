/**
 * buckling.ts
 * -----------
 * Linear buckling (eigenvalue) analysis.
 *
 * Solves the generalized eigenproblem:  (K + λ·Kσ)·φ = 0
 *   ⇔  K·φ = λ·(−Kσ)·φ
 * for the SMALLEST POSITIVE λ (Buckling Load Factor, BLF).
 *
 * The elastic stiffness K must already have Dirichlet BCs applied via the
 * penalty method (same K used for the linear static solve). Kσ is the geometric
 * stiffness assembled from the pre-stress state.
 *
 * ALGORITHM (issue #138)
 * ======================
 * Block subspace (Rayleigh–Ritz) inverse iteration on the operator K⁻¹·(−Kσ):
 * plain power iteration converges to the LARGEST-MAGNITUDE eigenvalue of that
 * operator, which under mixed tension/compression pre-stress can be a NEGATIVE
 * (tension-driven, non-physical) mode even when a physical positive buckling
 * mode exists. A single deflation of one previously-found eigenvector (the old
 * mitigation) still misses the governing smallest-positive BLF when ≥2 dominant
 * tensile modes or a clustered spectrum are present.
 *
 * A block of p vectors is iterated instead, converging to the invariant
 * subspace of the p eigenvalues of SMALLEST |λ| (both signs). Because inverse
 * iteration captures the smallest-magnitude eigenvalues, once the block has
 * converged the smallest POSITIVE λ inside it is provably the global smallest
 * positive BLF: any positive eigenvalue smaller than it would have |λ| smaller
 * still and would therefore already be inside the captured block. This yields a
 * certificate (`certified`) rather than a hope.
 *
 * Per outer iteration:
 *   1. Solve K·X̄[:,j] = (−Kσ)·X[:,j]      (PCG, one shared IC(0) factor of K)
 *   2. K-orthonormalize X̄ → X̂             (so X̂ᵀK X̂ = I)
 *   3. Reduced M̂ = X̂ᵀ·(−Kσ)·X̂ (p×p, symmetric); Θ = eig(M̂) = 1/λ
 *   4. X ← X̂·Q  (Ritz vectors); convergence on the smallest-|λ| Ritz values
 *
 * A positive BLF means the applied load must be multiplied by λ before buckling
 * occurs. All eigenvalues negative → tension-driven, no physical buckling mode.
 *
 * This module returns the BLF plus the lowest few positive modes and a
 * certification flag. The FAIL/MARGINAL/PASS verdict is applied by the caller
 * (server/analysis.ts, "Linear buckling (BLF)" failure mode) using design-basis
 * thresholds documented in the client SOURCES tab ("blf_thresholds").
 */

import type { CSRMatrix } from "./types.js";
import { matvec } from "./assembly.js";
import { solvePCG, buildIC0, type IC0Factor } from "./cg.js";
import { symmetricJacobi } from "./modal.js";

export interface BucklingResult {
  /** Buckling Load Factor: multiplier on applied load at which structure buckles. */
  readonly blf:        number;
  /** True if the block iteration converged within maxIter. */
  readonly converged:  boolean;
  /** Number of outer subspace iterations performed. */
  readonly iterations: number;
  /** True if the stress state carries no compressive geometric energy (Kσ≈0). */
  readonly tensileDominated: boolean;
  /**
   * True if the iteration could not find any POSITIVE eigenvalue even though the
   * pre-stress carries geometric energy (every captured mode is tension-driven).
   * When true, `blf` must NOT be reported to the user as a buckling factor.
   */
  readonly indeterminate: boolean;
  /**
   * Converged (normalized) buckling mode eigenvector φ, length nodeCount·3,
   * corresponding to the reported `blf`. Only physically meaningful when a
   * positive BLF was found (not tensileDominated and not indeterminate).
   */
  readonly modeShape: Float64Array;
  /**
   * Lowest positive BLFs found, ascending (up to ~3). `positiveBLFs[0] === blf`
   * when a positive mode exists. Empty when none was found. (issue #138)
   */
  readonly positiveBLFs: readonly number[];
  /**
   * Certification that the reported smallest positive BLF is the GLOBAL smallest
   * positive eigenvalue — i.e. no smaller positive mode was skipped. True when
   * the block converged AND the captured spectrum brackets `blf` (a mode of
   * larger |λ| was also captured, or the whole spectrum was solved). When false,
   * treat `blf` as an unverified estimate. (issue #138)
   */
  readonly certified: boolean;
}

// ─── Small vector helpers ─────────────────────────────────────────────────────

function dot(a: Float64Array, b: Float64Array, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

/** Deterministic pseudo-random fill in [-0.5, 0.5) (LCG), avoiding rigid modes. */
function fillRandom(v: Float64Array, off: number, n: number, seed: number): void {
  let state = seed >>> 0;
  for (let i = 0; i < n; i++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    v[off + i] = (state / 0x100000000) - 0.5;
  }
}

/**
 * K-orthonormalize the columns of X (n×p, column-major) IN PLACE using modified
 * Gram-Schmidt in the K inner product, so that X̂ᵀ·K·X̂ = I. Returns KX (=K·X̂,
 * column-major) so the caller can reuse the matvecs.
 */
function kOrthonormalize(X: Float64Array, K: CSRMatrix, n: number, p: number): Float64Array {
  const KX = new Float64Array(n * p);
  const Kv = new Float64Array(n);
  for (let j = 0; j < p; j++) {
    const xj = X.subarray(j * n, (j + 1) * n);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < j; i++) {
        const xi  = X.subarray(i * n, (i + 1) * n);
        const Kxi = KX.subarray(i * n, (i + 1) * n);
        const a = dot(Kxi, xj, n);           // xiᵀ·K·xj
        for (let k = 0; k < n; k++) xj[k] = (xj[k] ?? 0) - a * (xi[k] ?? 0);
      }
    }
    matvec(K, xj, Kv);
    let knorm2 = dot(xj, Kv, n);
    if (knorm2 < 1e-28) {
      // Degenerate direction — replace with a fresh random vector and re-project.
      fillRandom(xj, 0, n, (j * 2654435761 + 12345) >>> 0);
      for (let i = 0; i < j; i++) {
        const xi  = X.subarray(i * n, (i + 1) * n);
        const Kxi = KX.subarray(i * n, (i + 1) * n);
        const a = dot(Kxi, xj, n);
        for (let k = 0; k < n; k++) xj[k] = (xj[k] ?? 0) - a * (xi[k] ?? 0);
      }
      matvec(K, xj, Kv);
      knorm2 = dot(xj, Kv, n);
      if (knorm2 < 1e-28) knorm2 = 1;
    }
    const inv = 1 / Math.sqrt(knorm2);
    for (let k = 0; k < n; k++) { xj[k] = (xj[k] ?? 0) * inv; Kv[k] = (Kv[k] ?? 0) * inv; }
    KX.set(Kv, j * n);
  }
  return KX;
}

/**
 * Compute the smallest positive Buckling Load Factor via block subspace
 * iteration on the generalized pencil (−Kσ, K); see the file header.
 *
 * @param K      Global elastic stiffness (with Dirichlet BCs applied, n×n CSR)
 * @param Ksigma Global geometric stiffness (same sparsity as K)
 * @param diagIdx Diagonal index array for K (needed by PCG preconditioner)
 * @param maxIter Maximum outer subspace iterations (default 60)
 * @param tol     Relative convergence tolerance on the smallest-|λ| Ritz values (default 1e-4)
 */
export async function runLinearBuckling(
  K:        CSRMatrix,
  Ksigma:   CSRMatrix,
  diagIdx:  Int32Array,
  maxIter = 60,
  tol     = 1e-4,
): Promise<BucklingResult> {
  const n = K.n;

  // How many low modes to resolve, and the block (subspace) size. A block wider
  // than the number of wanted modes is what lets us bracket clustered spectra
  // and certify the smallest positive against skipped modes.
  const nWanted = Math.min(3, n);
  const p = Math.min(n, Math.max(2 * nWanted + 2, 8));

  // Shared IC(0) factor of K — reused across every inner PCG solve (K is SPD
  // after penalty BCs, same matrix every solve).
  let ic0: IC0Factor | null = null;
  try { ic0 = buildIC0(K, diagIdx); }
  catch (e) { console.warn(`[buckling] IC(0) of K failed (${e instanceof Error ? e.message : e}) — Jacobi preconditioner`); }

  // Initial subspace: deterministic pseudo-random, then K-orthonormalized.
  const X = new Float64Array(n * p);
  for (let j = 0; j < p; j++) fillRandom(X, j * n, n, (j + 1) * 1013904223);
  kOrthonormalize(X, K, n, p);

  const Xbar = new Float64Array(n * p);   // X̄ = K⁻¹(−Kσ)X, then K-orthonormalized → X̂
  const rhs  = new Float64Array(n);
  const nKsX = new Float64Array(n * p);   // (−Kσ)·X̂ for the reduced projection
  const Mr   = new Float64Array(p * p);   // reduced M̂ = X̂ᵀ(−Kσ)X̂
  const tmp  = new Float64Array(n);
  const Xnew = new Float64Array(n * p);

  const theta = new Float64Array(p);      // Θ = 1/λ (Ritz)
  const prevKey = new Float64Array(nWanted).fill(Infinity);
  let converged = false;
  let iterations = 0;
  let maxAbsMr = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;

    // Step 1: X̄[:,j] = K⁻¹·(−Kσ)·X[:,j]
    for (let j = 0; j < p; j++) {
      const xj = X.subarray(j * n, (j + 1) * n);
      matvec(Ksigma, xj, tmp);
      for (let i = 0; i < n; i++) rhs[i] = -(tmp[i] ?? 0);
      const cg = ic0
        ? solvePCG(K, new Float64Array(rhs), diagIdx, 1e-9, 3000, 'ic0', ic0)
        : solvePCG(K, new Float64Array(rhs), diagIdx, 1e-9, 3000, 'jacobi');
      Xbar.set(cg.u, j * n);
    }

    // Step 2: K-orthonormalize X̄ → X̂ (stored back into Xbar).
    kOrthonormalize(Xbar, K, n, p);

    // Step 3: reduced M̂ = X̂ᵀ·(−Kσ)·X̂  (symmetric p×p).
    for (let j = 0; j < p; j++) {
      const xj = Xbar.subarray(j * n, (j + 1) * n);
      matvec(Ksigma, xj, tmp);
      const col = nKsX.subarray(j * n, (j + 1) * n);
      for (let i = 0; i < n; i++) col[i] = -(tmp[i] ?? 0);
    }
    maxAbsMr = 0;
    for (let i = 0; i < p; i++) {
      const xi = Xbar.subarray(i * n, (i + 1) * n);
      for (let j = i; j < p; j++) {
        const s = dot(xi, nKsX.subarray(j * n, (j + 1) * n), n);
        Mr[i + j * p] = s; Mr[j + i * p] = s;
        if (Math.abs(s) > maxAbsMr) maxAbsMr = Math.abs(s);
      }
    }

    // Reduced eigenproblem: eig(M̂) → Θ = 1/λ, eigenvectors Q (columns).
    const MrEig = Mr.slice();
    const Q = symmetricJacobi(MrEig, p);
    for (let i = 0; i < p; i++) theta[i] = MrEig[i + i * p] ?? 0;

    // Step 4: Ritz vectors X ← X̂·Q.
    for (let j = 0; j < p; j++) {
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = 0; k < p; k++) s += (Xbar[i + k * n] ?? 0) * (Q[k + j * p] ?? 0);
        Xnew[i + j * n] = s;
      }
    }
    X.set(Xnew);

    // Convergence: watch the nWanted smallest-|λ| Ritz values (largest |Θ|).
    const order = Array.from({ length: p }, (_, i) => i)
      .sort((a, b) => Math.abs(theta[b] ?? 0) - Math.abs(theta[a] ?? 0));
    let maxRel = 0;
    for (let w = 0; w < nWanted; w++) {
      const th = theta[order[w]!] ?? 0;
      const lam = Math.abs(th) > 1e-300 ? 1 / th : Infinity;
      const prev = prevKey[w] ?? Infinity;
      const denom = Math.abs(prev) > 1e-30 && Number.isFinite(prev) ? Math.abs(prev) : 1;
      maxRel = Math.max(maxRel, Math.abs(lam - prev) / denom);
      prevKey[w] = lam;
    }
    if (iter > 0 && maxRel < tol) { converged = true; break; }
  }

  // ── Interpret the converged Ritz spectrum ───────────────────────────────────
  // λ_i = 1/Θ_i. Ritz vector for mode i is column i of X (= X̂·Q). Ignore Θ≈0
  // (λ→∞: rigid/penalty modes) relative to the dominant Ritz value.
  let maxAbsTheta = 0;
  for (let i = 0; i < p; i++) maxAbsTheta = Math.max(maxAbsTheta, Math.abs(theta[i] ?? 0));
  const thetaFloor = 1e-9 * maxAbsTheta;

  // No compressive geometric energy at all → nothing can buckle (BLF ≈ ∞).
  const tensileDominated = maxAbsMr < 1e-25;

  const finite: Array<{ lam: number; idx: number }> = [];
  for (let i = 0; i < p; i++) {
    const th = theta[i] ?? 0;
    if (Math.abs(th) <= thetaFloor) continue;
    finite.push({ lam: 1 / th, idx: i });
  }
  const positives = finite.filter(e => e.lam > 0).sort((a, b) => a.lam - b.lam);
  const positiveBLFs = positives.map(e => e.lam).slice(0, nWanted);

  const extractMode = (idx: number): Float64Array => {
    const mode = new Float64Array(n);
    let nrm = 0;
    for (let i = 0; i < n; i++) { const v = X[i + idx * n] ?? 0; mode[i] = v; nrm += v * v; }
    nrm = Math.sqrt(nrm);
    if (nrm > 1e-300) for (let i = 0; i < n; i++) mode[i] = (mode[i] ?? 0) / nrm;
    return mode;
  };

  if (tensileDominated) {
    return {
      blf: positives[0]?.lam ?? Infinity, converged, iterations,
      tensileDominated: true, indeterminate: false,
      modeShape: positives[0] ? extractMode(positives[0].idx) : new Float64Array(n),
      positiveBLFs, certified: false,
    };
  }

  if (positives.length === 0) {
    // Geometric energy present but no positive eigenvalue: tension-driven only.
    // Report indeterminate (converged forced false) rather than quote a number.
    const leastNeg = finite.length ? [...finite].sort((a, b) => b.lam - a.lam)[0]!.lam : 0;
    return {
      blf: leastNeg,
      converged: false, iterations,
      tensileDominated: false, indeterminate: true,
      modeShape: new Float64Array(n),
      positiveBLFs: [], certified: false,
    };
  }

  const gov = positives[0]!;
  // Certificate: the block captures the p smallest-|λ| eigenvalues, so the
  // smallest positive is the global one PROVIDED the captured window extends
  // past it — either we solved the whole spectrum (p===n) or some captured mode
  // has strictly larger |λ|. Otherwise the governing mode sits at the ragged
  // edge of the window and a clustered smaller-positive could hide just outside.
  let maxAbsLamCaptured = 0;
  for (const e of finite) maxAbsLamCaptured = Math.max(maxAbsLamCaptured, Math.abs(e.lam));
  const brackets = p >= n || maxAbsLamCaptured > gov.lam * (1 + 1e-9);
  const certified = converged && brackets;

  return {
    blf: gov.lam, converged, iterations,
    tensileDominated: false, indeterminate: false,
    modeShape: extractMode(gov.idx),
    positiveBLFs, certified,
  };
}
