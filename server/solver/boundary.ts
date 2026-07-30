/**
 * boundary.ts
 * -----------
 * Apply Dirichlet boundary conditions to K·u = f.
 *
 * Three schemes are available (issue #154). The STATIC solve path uses
 * ELIMINATION; the penalty schemes are retained for the buckling/modal-adjacent
 * callers that depend on a penalty-inflated K, and for the measurement harness
 * (server/tests/unit/dirichlet-scheme-measurement.test.ts).
 *
 * ELIMINATION (default for the static path)
 * =========================================
 * For each constrained DOF i with prescribed displacement u_i = g_i:
 *   • move the known column to the RHS:  f_j −= K[j][i]·g_i   for every
 *     unconstrained row j  (uses symmetry K[j][i] = K[i][j]);
 *   • zero row i and column i (preserving symmetry) and set K[i][i] = d_i, the
 *     PRISTINE diagonal, with f_i = d_i·g_i  ⇒  u_i = g_i EXACTLY (to CG tol).
 * The constrained DOF is fully decoupled; the remaining unconstrained block is
 * the original SPD principal submatrix, so no conditioning damage is introduced
 * and the constraint is satisfied exactly rather than to K_ii/K_penalty ≈ 1e-8.
 *
 * PENALTY (global / per-row)
 * ==========================
 *   K[i][i] += K_penalty ,  f[i] += K_penalty·g_i
 * → u_i ≈ g_i to relative error K_ii/K_penalty. 'global-penalty' uses one
 * K_penalty = kMax·1e8 from the single largest diagonal in the whole matrix
 * (the legacy behaviour); 'row-penalty' uses K_penalty_i = |K_ii|·1e8 per
 * constrained DOF, which bounds the local inflation to a fixed 1e8 regardless
 * of the global stiffness spread.
 *
 * REACTIONS
 * =========
 * Whatever the scheme, this function snapshots the PRISTINE rows of every
 * constrained-node DOF before touching K, so the true support reaction
 *   R_i = (K0·u)_i − f_ext_i
 * is recoverable exactly (issue #136 intent), scheme-independently, without
 * retaining the whole pre-BC matrix. See computeBoltReactions in pipeline.ts.
 */

import type { CSRMatrix } from "./types.js";

/**
 * A fixed Dirichlet boundary condition on a set of nodes.
 * All three DOF are constrained to the prescribed displacement value.
 */
export interface FixedNodeSet {
  /** Node indices to constrain. */
  readonly nodeIndices: readonly number[];
  /**
   * Prescribed displacement values per node per DOF [ux, uy, uz].
   * If omitted, all DOF are constrained to zero.
   * If provided, length must equal nodeIndices.length.
   */
  readonly prescribedDisplacement?: readonly [number, number, number][];
  /**
   * Which axes to constrain: [constrainX, constrainY, constrainZ].
   * If omitted, all three DOF are constrained (default behaviour).
   * Use this to implement rollers (e.g. [false, false, true] constrains z only).
   */
  readonly fixedAxes?: readonly [boolean, boolean, boolean];
}

/** Dirichlet application scheme (issue #154). */
export type DirichletScheme = 'global-penalty' | 'row-penalty' | 'elimination';

/**
 * Result of applying Dirichlet BCs — enough to recover exact reactions and to
 * report which scheme ran. `pristineRows` maps each constrained-node global DOF
 * to its PRE-BC row values (aligned to K.rowPtr[dof]..rowPtr[dof+1]).
 */
export interface DirichletApplication {
  readonly scheme: DirichletScheme;
  /** The single penalty scalar for 'global-penalty'; undefined otherwise. */
  readonly penalty?: number;
  /** Pristine (pre-BC) rows of every constrained-node DOF, for reaction recovery. */
  readonly pristineRows: Map<number, Float64Array>;
}

/** Binary-search the position of column `col` within CSR row `row`; −1 if absent. */
function findInRow(K: CSRMatrix, row: number, col: number): number {
  let lo = K.rowPtr[row] ?? 0;
  let hi = (K.rowPtr[row + 1] ?? 0) - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = K.colIdx[mid] ?? -1;
    if (c === col) return mid;
    if (c < col) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

/**
 * Apply Dirichlet BCs to K and f in-place.
 *
 * @param scheme  Constraint scheme (issue #154). Defaults to 'global-penalty'
 *                so callers that require a penalty-inflated K (buckling, the
 *                modal-adjacent tests) are bit-identical to the legacy path; the
 *                static pipeline passes 'elimination'.
 * @returns       The scheme used, the penalty scalar (penalty schemes), and the
 *                pristine constrained rows for exact reaction recovery.
 */
export function applyDirichletBC(
  K:           CSRMatrix,
  f:           Float64Array,
  diagIdx:     Int32Array,
  constraints: readonly FixedNodeSet[],
  scheme:      DirichletScheme = 'global-penalty',
): DirichletApplication {
  // ── Snapshot pristine rows of every constrained-node DOF (all 3 axes) BEFORE
  //    modifying K, so reaction recovery reads K0, not the BC-modified matrix.
  const pristineRows = new Map<number, Float64Array>();
  const snapshot = (globalDOF: number): void => {
    if (pristineRows.has(globalDOF)) return;
    const s = K.rowPtr[globalDOF] ?? 0;
    const e = K.rowPtr[globalDOF + 1] ?? 0;
    pristineRows.set(globalDOF, K.data.slice(s, e));
  };
  for (const constraint of constraints) {
    for (const nodeIdx of constraint.nodeIndices) {
      if (nodeIdx === undefined) continue;
      for (let d = 0; d < 3; d++) {
        const g = nodeIdx * 3 + d;
        if (g < K.n) snapshot(g);
      }
    }
  }

  // Enumerate the constrained DOFs and their prescribed values (respect fixedAxes).
  const gVal = new Map<number, number>();
  for (const constraint of constraints) {
    for (let ni = 0; ni < constraint.nodeIndices.length; ni++) {
      const nodeIdx = constraint.nodeIndices[ni];
      if (nodeIdx === undefined) continue;
      const prescribed = constraint.prescribedDisplacement?.[ni] ?? [0, 0, 0];
      for (let dof = 0; dof < 3; dof++) {
        if (constraint.fixedAxes && !constraint.fixedAxes[dof]) continue;
        const globalDOF = nodeIdx * 3 + dof;
        if (globalDOF >= K.n) {
          throw new RangeError(
            `Constraint node ${nodeIdx} DOF ${dof} (global ${globalDOF}) out of range n=${K.n}`
          );
        }
        gVal.set(globalDOF, prescribed[dof] ?? 0);
      }
    }
  }

  if (scheme === 'elimination') {
    applyElimination(K, f, diagIdx, gVal, pristineRows);
    return { scheme, pristineRows };
  }

  // ── Penalty schemes ─────────────────────────────────────────────────────────
  let globalPenalty: number | undefined;
  if (scheme === 'global-penalty') {
    let kMax = 0;
    for (let i = 0; i < K.n; i++) {
      const dp = diagIdx[i];
      if (dp === undefined) throw new RangeError(`diagIdx[${i}] undefined`);
      const val = Math.abs(K.data[dp] ?? 0);
      if (val > kMax) kMax = val;
    }
    if (kMax < 1e-300) kMax = 1.0;
    globalPenalty = kMax * 1e8;
  }

  for (const [globalDOF, g] of gVal) {
    const dp = diagIdx[globalDOF];
    if (dp === undefined) throw new RangeError(`diagIdx[${globalDOF}] undefined`);
    let penalty: number;
    if (scheme === 'global-penalty') {
      penalty = globalPenalty!;
    } else {
      // row-penalty: local diagonal scaled by 1e8 (bounds inflation to 1e8).
      let kii = Math.abs(K.data[dp] ?? 0);
      if (kii < 1e-300) kii = 1.0;
      penalty = kii * 1e8;
    }
    (K.data as Float64Array)[dp] = (K.data[dp] ?? 0) + penalty;
    f[globalDOF] = (f[globalDOF] ?? 0) + penalty * g;
  }

  return { scheme, penalty: globalPenalty, pristineRows };
}

/**
 * Exact symmetric elimination of the constrained DOFs (issue #154).
 * Mutates K and f in place. `pristineRows` supplies the pre-BC row values used
 * for the RHS move and the diagonal replacement.
 */
function applyElimination(
  K:            CSRMatrix,
  f:            Float64Array,
  diagIdx:      Int32Array,
  gVal:         Map<number, number>,
  pristineRows: Map<number, Float64Array>,
): void {
  // Pristine diagonal d_i for each constrained DOF (kept > 0 so the eliminated
  // block stays SPD and the preconditioner sees a well-scaled diagonal).
  const dMap = new Map<number, number>();
  for (const i of gVal.keys()) {
    const row = pristineRows.get(i)!;
    const off = (diagIdx[i] ?? 0) - (K.rowPtr[i] ?? 0);
    let di = row[off] ?? 0;
    if (Math.abs(di) < 1e-300) di = 1.0;
    dMap.set(i, di);
  }

  // 1. Move known columns to the RHS: for a constrained DOF i with g_i ≠ 0,
  //    subtract K0[i][m]·g_i from every UNCONSTRAINED row m (K0[m][i] = K0[i][m]).
  for (const [i, gi] of gVal) {
    if (gi === 0) continue;
    const row = pristineRows.get(i)!;
    const s = K.rowPtr[i] ?? 0;
    for (let off = 0; off < row.length; off++) {
      const m = K.colIdx[s + off] ?? -1;
      if (m === i || gVal.has(m)) continue;   // skip self + other constrained DOFs
      f[m] = (f[m] ?? 0) - (row[off] ?? 0) * gi;
    }
  }

  // 2. Zero each constrained row and its symmetric column; set the diagonal and RHS.
  for (const [i, gi] of gVal) {
    const s = K.rowPtr[i] ?? 0;
    const e = K.rowPtr[i + 1] ?? 0;
    const di = dMap.get(i)!;
    for (let p = s; p < e; p++) {
      const j = K.colIdx[p] ?? -1;
      if (j === i) { K.data[p] = di; continue; }
      K.data[p] = 0;                              // zero row entry (i, j)
      const q = findInRow(K, j, i);               // zero symmetric column entry (j, i)
      if (q >= 0) K.data[q] = 0;
    }
    f[i] = di * gi;                                // u_i = g_i exactly
  }
}

// ─── Exact elimination on a generalized eigenproblem (shared, issue #155) ──────
//
// `applyElimination` above owns the STATIC path K·u = f: it moves the known
// columns of a possibly non-zero constraint g_i to the RHS and restores the
// PRISTINE diagonal, giving exact reactions. The modal generalized eigenproblem
// K·φ = ω²·M·φ is homogeneous (g_i ≡ 0) but must NOT restore the physical
// diagonal — a physical K_ii/M_ii ratio would place the constrained DOF as a
// REGULAR (in-band) mode. It instead decouples the DOF in K with a large
// ABSOLUTE stiffness so the DOF lands at the TOP of the spectrum, and leaves M
// positive-definite. It uses the two lower-level primitives below.
//
// The old modal path instead inflated each constrained diagonal (K_ii → K_ii·1e8)
// — a per-diagonal MULTIPLY, so a poorly-connected constrained DOF (tiny K_ii)
// stayed weakly constrained and could surface as a spurious low mode. Decoupling
// with an absolute stiffness fixes that; see runModalAnalysis for why M is left
// untouched (a semidefinite M breaks the shift-invert subspace iteration).
//
// (`applyElimination`'s static row-move could be re-expressed on top of these
// primitives later; it is left as-is here to avoid churning the #154 path.)

/**
 * Collect the set of constrained global DOFs implied by a list of Dirichlet
 * constraints, as a boolean mask over the n DOFs. Respects per-set `fixedAxes`
 * (roller supports constrain a subset of the three translational DOF).
 *
 * This is the single source of truth for "which DOFs are constrained", shared
 * by the static and modal constraint handling so they never diverge.
 */
export function constrainedDOFMask(
  n:           number,
  constraints: readonly FixedNodeSet[],
): Uint8Array {
  const mask = new Uint8Array(n);
  for (const constraint of constraints) {
    for (const nodeIdx of constraint.nodeIndices) {
      if (nodeIdx === undefined) continue;
      for (let dof = 0; dof < 3; dof++) {
        if (constraint.fixedAxes && !constraint.fixedAxes[dof]) continue;
        const globalDOF = nodeIdx * 3 + dof;
        if (globalDOF >= 0 && globalDOF < n) mask[globalDOF] = 1;
      }
    }
  }
  return mask;
}

/**
 * Exactly eliminate the masked DOFs from a symmetric CSR matrix, in-place:
 * zero every off-diagonal entry in the constrained rows AND columns, then set
 * each constrained diagonal to `diagValue`. Runs in a single O(nnz) sweep.
 *
 * For a homogeneous (zero-displacement) constraint this decouples every
 * constrained DOF into an independent 1×1 block `diagValue · uᵢ = …`.
 *
 * On the modal generalized eigenproblem K·φ = ω²·M·φ this is applied to K ONLY,
 * with `diagValue` a large ABSOLUTE stiffness κ = max|K_ii|·1e8. The constrained
 * DOF then sits at ω² ≈ κ/M_ii — the TOP of the spectrum, never in the reported
 * low band — while M is left positive-DEFINITE (untouched) so the shift-invert
 * subspace iteration stays well-posed. (Zeroing M's constrained mass would make M
 * only positive-SEMI-definite and, with rigid-body modes present, pollute the low
 * spectrum with spurious near-zero eigenvalues.) See runModalAnalysis.
 *
 * @param A         symmetric CSR matrix (K or M), modified in-place
 * @param diagIdx   CSR data index of each diagonal entry (A and K/M share it
 *                  when they share the sparsity pattern)
 * @param mask      constrained-DOF mask from {@link constrainedDOFMask}
 * @param diagValue value written to each constrained diagonal
 */
export function eliminateConstrainedRowsCols(
  A:         CSRMatrix,
  diagIdx:   Int32Array,
  mask:      Uint8Array,
  diagValue: number,
): void {
  if (mask.length !== A.n) {
    throw new RangeError(`eliminateConstrainedRowsCols: mask length ${mask.length} != matrix n ${A.n}`);
  }
  const data = A.data as Float64Array;
  // Single sweep: zero any entry whose row OR column is constrained.
  for (let row = 0; row < A.n; row++) {
    const rowConstrained = mask[row] === 1;
    const start = A.rowPtr[row] ?? 0;
    const end   = A.rowPtr[row + 1] ?? A.data.length;
    for (let k = start; k < end; k++) {
      if (rowConstrained || mask[A.colIdx[k] ?? 0] === 1) data[k] = 0;
    }
  }
  // Set the (now isolated) diagonal of each constrained DOF.
  for (let i = 0; i < A.n; i++) {
    if (mask[i] === 1) {
      const dp = diagIdx[i];
      if (dp === undefined) throw new RangeError(`eliminateConstrainedRowsCols: diagIdx[${i}] undefined`);
      data[dp] = diagValue;
    }
  }
}
