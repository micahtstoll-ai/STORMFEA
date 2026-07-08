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
 * IC(0) PRECONDITIONER
 * ====================
 * Incomplete Cholesky factorization with zero fill-in (IC(0)):
 * Computes a sparse lower-triangular L such that K ≈ L·Lᵀ, keeping only
 * entries where K is non-zero (no new fill). The preconditioner applies
 * M⁻¹·v = L⁻ᵀ·(L⁻¹·v) via forward and backward triangular solves.
 *
 * IC(0) typically reduces iteration count by 3-10x compared to Jacobi for
 * well-conditioned FEM systems. Falls back to Jacobi if a negative pivot
 * is encountered (non-positive-definite subproblem).
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

// ─── IC(0) incomplete Cholesky factorization ─────────────────────────────────

export interface IC0Factor {
  readonly Ldata:   Float64Array;
  readonly LcolIdx: Int32Array;
  readonly LrowPtr: Int32Array;
  readonly diagIdx: Int32Array;
}

/**
 * Build IC(0) incomplete Cholesky factor of K.
 *
 * Computes a sparse lower-triangular factor L (same sparsity as lower
 * triangle of K) such that K ≈ L·Lᵀ. Uses a dense scratch array for O(1)
 * access during inner-product accumulation.
 *
 * @param K       Symmetric SPD stiffness matrix in CSR format.
 * @param diagIdx Positions of diagonal entries in K.data.
 * @throws Error with message containing "IC0_NONPOSDEF" if a negative or
 *         near-zero pivot is encountered (system not SPD).
 */
export function buildIC0(K: CSRMatrix, diagIdx: Int32Array): IC0Factor {
  const n = K.n;
  // Copy K.data — we modify Ldata in-place while computing the factorization.
  const Ldata   = K.data.slice();
  const LcolIdx = K.colIdx;
  const LrowPtr = K.rowPtr;

  // Dense scratch array: scratch[j] = L[i,j] for the current row i being processed.
  // Initialized to zero; zeroed out at end of each row.
  const scratch = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    const rowStart = LrowPtr[i]       ?? 0;
    const rowEnd   = LrowPtr[i + 1]   ?? 0;
    const dPos     = diagIdx[i]       ?? 0; // position of L[i,i] in Ldata

    // ── Off-diagonal lower triangle: L[i,j] for j < i ────────────────────
    // First pass: fill scratch with the K values for row i (already in Ldata).
    // We will overwrite them with the IC(0) values as we compute them.
    for (let p = rowStart; p < dPos; p++) {
      const j = LcolIdx[p] ?? 0;
      scratch[j] = Ldata[p] ?? 0; // initialize scratch[j] = K[i,j]
    }

    // Second pass: compute L[i,j] = (K[i,j] - sum_{k<j} L[i,k]*L[j,k]) / L[j,j]
    for (let p = rowStart; p < dPos; p++) {
      const j      = LcolIdx[p] ?? 0;
      const jStart = LrowPtr[j]     ?? 0;
      const jDPos  = diagIdx[j]     ?? 0; // position of L[j,j]

      // Subtract sum_{k<j} L[i,k]*L[j,k] from scratch[j].
      // scratch[k] already holds L[i,k] for all k < j that have been computed.
      for (let q = jStart; q < jDPos; q++) {
        const k = LcolIdx[q] ?? 0;
        scratch[j] = (scratch[j] ?? 0) - (scratch[k] ?? 0) * (Ldata[q] ?? 0);
      }

      // L[i,j] = scratch[j] / L[j,j]
      const ljj = Ldata[jDPos] ?? 0;
      const lij = Math.abs(ljj) > 1e-300 ? (scratch[j] ?? 0) / ljj : 0;
      scratch[j] = lij;
      Ldata[p]   = lij;
    }

    // ── Diagonal: L[i,i] = sqrt(K[i,i] - sum_{k<i} L[i,k]^2) ────────────
    let pivotSq = Ldata[dPos] ?? 0; // starts as K[i,i]
    for (let p = rowStart; p < dPos; p++) {
      const lij = Ldata[p] ?? 0;
      pivotSq -= lij * lij;
    }

    if (pivotSq < 1e-14) {
      throw new Error(
        `IC0_NONPOSDEF: negative or near-zero pivot at row ${i} (pivotSq=${pivotSq.toExponential(3)}). ` +
        `System may not be positive definite — check constraints and mesh quality.`
      );
    }
    Ldata[dPos] = Math.sqrt(pivotSq);

    // ── Zero out scratch entries used in this row ──────────────────────────
    for (let p = rowStart; p < dPos; p++) {
      scratch[LcolIdx[p] ?? 0] = 0;
    }
  }

  return { Ldata, LcolIdx, LrowPtr: K.rowPtr, diagIdx };
}

// ─── Triangular solves ────────────────────────────────────────────────────────

/**
 * Forward substitution: solve L·x = b.
 * L is lower-triangular in CSR format (same sparsity as lower triangle of K).
 * Result is written into x in-place.
 */
export function forwardSolve(
  Ldata:   Float64Array,
  LcolIdx: Int32Array,
  LrowPtr: Int32Array,
  diagIdx: Int32Array,
  b:       Float64Array,
  x:       Float64Array,
): void {
  const n = LrowPtr.length - 1;
  for (let i = 0; i < n; i++) {
    const rowStart = LrowPtr[i]  ?? 0;
    const dPos     = diagIdx[i]  ?? 0;
    let sum = 0;
    for (let p = rowStart; p < dPos; p++) {
      sum += (Ldata[p] ?? 0) * (x[LcolIdx[p] ?? 0] ?? 0);
    }
    const lii = Ldata[dPos] ?? 1;
    x[i] = ((b[i] ?? 0) - sum) / lii;
  }
}

/**
 * Backward substitution: solve Lᵀ·x = b.
 * Uses scatter approach: initializes x = b, then processes rows in reverse,
 * scattering contributions to already-computed x values.
 */
export function backwardSolve(
  Ldata:   Float64Array,
  LcolIdx: Int32Array,
  LrowPtr: Int32Array,
  diagIdx: Int32Array,
  b:       Float64Array,
  x:       Float64Array,
): void {
  const n = LrowPtr.length - 1;
  // Initialize x = b
  for (let i = 0; i < n; i++) x[i] = b[i] ?? 0;

  for (let i = n - 1; i >= 0; i--) {
    const rowStart = LrowPtr[i]  ?? 0;
    const dPos     = diagIdx[i]  ?? 0;
    const lii      = Ldata[dPos] ?? 1;
    x[i] = (x[i] ?? 0) / lii;
    const xi = x[i] ?? 0;
    for (let p = rowStart; p < dPos; p++) {
      const jj = LcolIdx[p] ?? 0;
      x[jj] = (x[jj] ?? 0) - (Ldata[p] ?? 0) * xi;
    }
  }
}

// ─── PCG solver ──────────────────────────────────────────────────────────────

export interface CGCheckpoint {
  readonly iteration: number;
  readonly relativeResidual: number;
}

export interface CGResult {
  readonly u:          Float64Array; // solution vector
  readonly iterations: number;
  readonly converged:  boolean;
  readonly finalRelativeResidual: number;
  readonly preconditionerUsed: 'ic0' | 'jacobi';
  readonly residualCheckpoints: readonly CGCheckpoint[];
}

/**
 * Optional progress/abort hooks (issue #109). Passed only by the streaming
 * analysis path; all other callers (modal, buckling, tests) omit it and are
 * unaffected.
 */
export interface SolvePCGOpts {
  /** Checked at CG checkpoints; when aborted, solvePCG throws (name === 'AnalysisAbortError'). */
  signal?: AbortSignal;
  /** Invoked at CG residual checkpoints with (iteration, relativeResidual). */
  onProgress?: (iteration: number, relativeResidual: number) => void;
}

/** Progress emitted at each CG residual checkpoint. */
type CGProgress = { iteration: number; relativeResidual: number };

/**
 * Core PCG iteration as a generator (issue #109). It yields a { iteration,
 * relativeResidual } at each residual checkpoint and returns the final
 * CGResult. This is the SINGLE source of the CG numerics: the synchronous
 * driver (solvePCG) drains it in a tight loop, and the cooperative async driver
 * (solvePCGStreaming) drives it while yielding the event loop between
 * checkpoints — so the blocking and streaming solve paths can never drift.
 */
function* pcgSolve(
  K:        CSRMatrix,
  f:        Float64Array,
  diagIdx:  Int32Array,
  tol:      number,
  maxIter:  number | undefined,
  preconditioner: 'jacobi' | 'ic0',
  prebuiltFactor: IC0Factor | null | undefined,
): Generator<CGProgress, CGResult, void> {
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

  const debugCG     = process.env["STORMFEA_DEBUG_CG"]      === "1";
  const benchPrecond = process.env["STORMFEA_BENCH_PRECOND"] === "1" || debugCG;

  // ── Build preconditioner ─────────────────────────────────────────────────────
  let useIC0 = preconditioner === 'ic0';
  let Ldata:   Float64Array | null = null;
  let LcolIdx: Int32Array   | null = null;
  let LrowPtr: Int32Array   | null = null;
  let LdiagIdx: Int32Array  | null = null;

  if (useIC0 && prebuiltFactor) {
    // Reuse a caller-supplied factorization — the matrix is unchanged across
    // solves, so re-factorizing per RHS would be pure waste (issue #100).
    Ldata    = prebuiltFactor.Ldata;
    LcolIdx  = prebuiltFactor.LcolIdx;
    LrowPtr  = prebuiltFactor.LrowPtr;
    LdiagIdx = prebuiltFactor.diagIdx;
  } else if (useIC0) {
    try {
      const tFactor = benchPrecond ? Date.now() : 0;
      const L = buildIC0(K, diagIdx);
      Ldata    = L.Ldata;
      LcolIdx  = L.LcolIdx;
      LrowPtr  = L.LrowPtr;
      LdiagIdx = L.diagIdx;
      if (benchPrecond) {
        console.log(`[cg:bench] ic0-factor: n=${n} nnz_L=${K.data.length} elapsed=${Date.now() - tFactor}ms`);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('IC0_NONPOSDEF')) {
        console.warn(`[cg] IC(0) negative pivot — falling back to Jacobi preconditioner`);
        useIC0 = false;
      } else {
        throw e;
      }
    }
  }

  // Always build Jacobi Minv as fallback
  const Minv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const kii = K.data[diagIdx[i] ?? 0] ?? 0;
    Minv[i] = Math.abs(kii) > 1e-300 ? 1.0 / kii : 1.0;
  }

  // Scratch buffer for IC(0) triangular solves (forward solve output → backward solve input)
  const tmp = new Float64Array(n);

  // Initial guess u = 0
  const u = new Float64Array(n);

  // r = f − K·u = f  (since u = 0)
  const r = f.slice();

  const fNorm = norm(f);
  if (fNorm < 1e-300) {
    // Zero right-hand side → zero solution (trivially correct)
    return {
      u,
      iterations: 0,
      converged: true,
      finalRelativeResidual: 0,
      preconditionerUsed: preconditioner === 'ic0' ? 'ic0' : 'jacobi',
      residualCheckpoints: [],
    };
  }

  // z = M⁻¹·r  (initial preconditioned residual)
  const z = new Float64Array(n);
  if (useIC0 && Ldata && LcolIdx && LrowPtr && LdiagIdx) {
    forwardSolve(Ldata, LcolIdx, LrowPtr, LdiagIdx, r, tmp);
    backwardSolve(Ldata, LcolIdx, LrowPtr, LdiagIdx, tmp, z);
  } else {
    for (let i = 0; i < n; i++) z[i] = (r[i] ?? 0) * (Minv[i] ?? 1);
  }

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
  let nextLogIter = 1;
  const initialRelRes = relRes;
  const residualCheckpoints: CGCheckpoint[] = [];

  // Benchmark timing for the solve loop
  const tSolveStart = Date.now();

  for (iter = 0; iter < imax; iter++) {
    // Check convergence at start of iteration (initial r may already satisfy tol)
    if (relRes < tol) break;

    if (iter === nextLogIter) {
      residualCheckpoints.push({ iteration: iter, relativeResidual: relRes });
      if (debugCG) {
        console.log(`[cg] iter ${iter}: relRes=${relRes.toExponential(3)} (initial=${initialRelRes.toExponential(3)})`);
      }
      // Checkpoint boundary: hand control to the driver so it can stream live
      // progress and observe an abort (issue #109). The sync driver resumes
      // immediately; the streaming driver yields the event loop here first.
      yield { iteration: iter, relativeResidual: relRes };
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
    if (useIC0 && Ldata && LcolIdx && LrowPtr && LdiagIdx) {
      forwardSolve(Ldata, LcolIdx, LrowPtr, LdiagIdx, r, tmp);
      backwardSolve(Ldata, LcolIdx, LrowPtr, LdiagIdx, tmp, z);
    } else {
      for (let i = 0; i < n; i++) z[i] = (r[i] ?? 0) * (Minv[i] ?? 1);
    }

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

  if (benchPrecond) {
    console.log(
      `[cg:bench] preconditioner=${useIC0 ? 'ic0' : 'jacobi'} iters=${iter} ` +
      `relRes=${relRes.toExponential(3)} n=${n} nnz=${K.data.length} ` +
      `elapsed=${Date.now() - tSolveStart}ms`
    );
  }

  return {
    u,
    iterations:             iter,
    converged:              relRes < tol,
    finalRelativeResidual:  relRes,
    preconditionerUsed:     useIC0 ? 'ic0' as const : 'jacobi' as const,
    residualCheckpoints:    residualCheckpoints,
  };
}

// Apply the caller's progress callback and abort check at a checkpoint. Shared
// by both drivers so streaming and blocking solves handle opts identically.
function _applyPCGProgress(p: CGProgress, opts?: SolvePCGOpts): void {
  if (opts?.onProgress) opts.onProgress(p.iteration, p.relativeResidual);
  if (opts?.signal?.aborted) {
    const e = new Error(`PCG aborted by caller at iteration ${p.iteration}`);
    e.name = 'AnalysisAbortError';
    throw e;
  }
}

/**
 * Solve K·u = f using Preconditioned Conjugate Gradient (synchronous).
 *
 * @param K              Global stiffness matrix in CSR format.
 * @param f              Right-hand side force vector in Newtons.
 * @param diagIdx        Diagonal entry positions in K.data, for preconditioner.
 * @param tol            Relative residual tolerance (default 1e-8).
 * @param maxIter        Maximum iterations (default min(5000, max(1000, 3×DOF))).
 * @param preconditioner 'ic0' (default) or 'jacobi'.
 * @param prebuiltFactor Optional prebuilt IC(0) factor (issue #100).
 * @param opts           Optional progress/abort hooks (issue #109).
 */
export function solvePCG(
  K:        CSRMatrix,
  f:        Float64Array,
  diagIdx:  Int32Array,
  tol       = 1e-8,
  maxIter?: number,
  preconditioner: 'jacobi' | 'ic0' = 'ic0',
  prebuiltFactor?: IC0Factor | null,
  opts?: SolvePCGOpts,
): CGResult {
  const gen = pcgSolve(K, f, diagIdx, tol, maxIter, preconditioner, prebuiltFactor ?? null);
  let step = gen.next();
  while (!step.done) {
    _applyPCGProgress(step.value, opts);
    step = gen.next();
  }
  return step.value;
}

/**
 * Cooperative-yielding twin of solvePCG (issue #109). Numerically identical —
 * both drive the same pcgSolve generator — but between residual checkpoints it
 * awaits setImmediate so the event loop can flush streamed progress events and
 * observe a mid-solve abort (tab close / Cancel), which a fully synchronous
 * solve would block until completion. Used only by the SSE analysis path;
 * equivalence with solvePCG is guarded by server/tests/unit/cg-streaming.test.ts.
 */
export async function solvePCGStreaming(
  K:        CSRMatrix,
  f:        Float64Array,
  diagIdx:  Int32Array,
  tol       = 1e-8,
  maxIter?: number,
  preconditioner: 'jacobi' | 'ic0' = 'ic0',
  prebuiltFactor?: IC0Factor | null,
  opts?: SolvePCGOpts,
): Promise<CGResult> {
  const gen = pcgSolve(K, f, diagIdx, tol, maxIter, preconditioner, prebuiltFactor ?? null);
  let step = gen.next();
  while (!step.done) {
    _applyPCGProgress(step.value, opts);
    await new Promise<void>(resolve => setImmediate(resolve));
    step = gen.next();
  }
  return step.value;
}
