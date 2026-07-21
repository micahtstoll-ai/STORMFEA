/**
 * pipeline.ts
 * -----------
 * Orchestrates the complete linear static FEM solve.
 *
 * Call sequence:
 *   1. assembleK()         — build global stiffness matrix K (CSR)
 *   2. assembleForceVector() — build right-hand side f
 *   3. applyDirichletBC()  — apply fixed constraints via penalty method
 *   4. solvePCG()          — solve K·u = f
 *   5. buildSolverResult() — recover stresses and package output
 *
 * All errors propagate as thrown exceptions with descriptive messages.
 * No global state. No I/O. Pure functions throughout.
 */

import type {
  TetMesh,
  AnyMaterial,
  ElementMaterialField,
  WallBondField,
  PointForce,
  SolverResult,
  CSRMatrix,
} from "./types.js";

import type { FixedNodeSet } from "./boundary.js";
import { assembleK }           from "./assembly.js";
import { applyDirichletBC }    from "./boundary.js";
import { assembleForceVector } from "./load.js";
import { solvePCG, solvePCGStreaming } from "./cg.js";
import { buildSolverResult }   from "./stress.js";
import { computeMeshQuality, formatHardViolations }  from "./meshQuality.js";

export interface SolverInput {
  readonly mesh:        TetMesh;
  readonly material:    AnyMaterial;
  /**
   * Optional per-element material field (two-region shell/core model, issue:
   * walls vs infill). When present, `material` is the volume-weighted average
   * material (still used by scalar consumers like the ZZ error estimate); the
   * field overrides per-element stiffness and yields in assembly and recovery.
   */
  readonly materialField?: ElementMaterialField;
  /**
   * Optional wall-to-wall (bead-to-bead) bond field for the multi-loop
   * shell model (server/twoRegion.ts buildWallBondField). Criterion-only:
   * never enters assembly, only stress recovery. Absent = feature off,
   * bit-identical to today.
   */
  readonly wallBond?: WallBondField;
  /**
   * Failure criterion for orthotropic materials (default "fdm-interface" —
   * the decoupled bulk + interlayer-interface criterion). "hill-legacy"
   * keeps the Hill (1948) quadratic: used for comparison and for the
   * upright-no-bed scalar-swap fallback (see docs/layer-model-audit.md A1).
   */
  readonly criterion?:  import("./stress.js").CriterionKind;
  /**
   * Optional in-plane raster (bead-to-bead) anisotropy for the bulk term
   * (feature #6, opt-in + evidence-gated). Uniform across the part; absent ⇒
   * the bulk term is exactly isotropic von Mises (bit-identical legacy path).
   */
  readonly inPlaneAniso?: import("./stress.js").InPlaneAniso | null;
  readonly constraints: readonly FixedNodeSet[];
  readonly forces:      readonly PointForce[];
  readonly cgTolerance?:   number;
  readonly cgMaxIter?:     number;
  readonly preconditioner?: 'jacobi' | 'ic0';
  /**
   * Keep a pristine (pre-Dirichlet-penalty) copy of K's value array in the
   * returned StaticSolveIntermediate.K0data (issue #100). Downstream consumers
   * that need K WITHOUT the static penalty BCs — modal (diagonal-scaling
   * penalty) and buckling (fresh Dirichlet penalty on a copy) — reuse it
   * instead of re-assembling K from scratch. Off by default: it costs one
   * extra Float64Array(nnz) copy.
   */
  readonly keepPristineK?: boolean;
  /**
   * Mesh-quality hard gate policy (issue #166). Default 'throw': a hard shape
   * violation aborts the solve to protect user-facing results. Internal
   * calibration probes that run on a controlled, deliberately-graded structured
   * fixture (e.g. the coupon Kt plate-with-hole, whose hole-clustered O-grid
   * layers are graded on purpose and whose peak is read at the fine hole edge)
   * pass 'warn' — the hard-violation elements are logged but the solve proceeds,
   * since the fixture geometry and its extracted quantity are known-good. Never
   * expose this to the user analysis path.
   */
  readonly meshGate?: 'throw' | 'warn';
  /**
   * Optional abort signal (issue #109). Forwarded to solvePCG, which checks it
   * at CG iteration checkpoints and throws if the caller has cancelled.
   */
  readonly signal?: AbortSignal;
  /**
   * Optional CG progress callback (issue #109). Invoked at CG residual
   * checkpoints with (iteration, relativeResidual) for live progress streaming.
   */
  readonly onCgProgress?: (iteration: number, relativeResidual: number) => void;
}

/**
 * Run a linear static FEM analysis.
 *
 * @param input All problem definition data.
 * @returns     SolverResult with displacement, von Mises, safety factor, metadata.
 *
 * Throws SolverError on:
 * - Degenerate/inverted elements
 * - Singular system (missing constraints)
 * - CG non-convergence (if checkConvergence=true)
 * - NaN/Inf in any result
 */
// ─── Memory profiling helper ──────────────────────────────────────────────────
// Activated by STORMFEA_PROFILE_MEMORY=1 environment variable.
// Optionally calls gc() when --expose-gc is active.
const _profileMem = process.env["STORMFEA_PROFILE_MEMORY"] === "1";
let _lastHeapMB = 0;

function _snap(label: string): void {
  if (!_profileMem) return;
  if (typeof globalThis.gc === "function") globalThis.gc();
  const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
  const deltaMB = heapMB - _lastHeapMB;
  console.log(`[mem] ${label}: heap=${heapMB.toFixed(1)}MB delta=${deltaMB >= 0 ? "+" : ""}${deltaMB.toFixed(1)}MB`);
  _lastHeapMB = heapMB;
}

export async function runLinearStatic(input: SolverInput): Promise<SolverResult> {
  // Thin wrapper over runLinearStaticWithK — the full solve pipeline lives
  // there (single implementation; previously ~100 lines were duplicated here,
  // including a second copy of the bolt-reaction recovery).
  const { result } = await runLinearStaticWithK(input);
  return result;
}

// ─── StaticSolveIntermediate ──────────────────────────────────────────────────

export interface StaticSolveIntermediate {
  result:  SolverResult;
  /** K with Dirichlet penalty BCs applied (as solved). */
  K:       CSRMatrix;
  diagIdx: Int32Array;
  /**
   * Pristine K value array (NO boundary conditions), present only when
   * SolverInput.keepPristineK was set. Shares K's rowPtr/colIdx/diagIdx.
   */
  K0data?: Float64Array;
}

/**
 * Full linear static solve pipeline. Also returns K and diagIdx for downstream
 * reuse (e.g. modal analysis). K has Dirichlet BCs already applied via the
 * penalty method. runLinearStatic delegates here and discards K.
 */
export async function runLinearStaticWithK(input: SolverInput): Promise<StaticSolveIntermediate> {
  const t0 = Date.now();

  const { mesh, material, constraints, forces } = input;
  const tol            = input.cgTolerance ?? 1e-8;
  const maxIter        = input.cgMaxIter;
  const preconditioner = input.preconditioner ?? 'ic0';

  _snap("before mesh quality check");

  // Compute mesh quality metrics before assembly (issue #166).
  //
  // The gate keys on what actually predicts solution damage — the scale-invariant
  // sliver/aspect metrics and the stiffness-conditioning proxy (the normalized
  // Jacobian: the strain-displacement B ∝ 1/(6V), so a near-zero-volume sliver
  // inflates B and wrecks conditioning), plus the C3D10 curved-mapping fold flags
  // (issue #162) — NOT the raw Jacobian SIGN. The C3D4/C3D10 assemblers
  // auto-orient via Math.abs(sixV)/Math.abs(detJ), so a MIRROR-oriented but well
  // shaped mesh solves correctly and must pass the gate.
  const meshQualityReport = computeMeshQuality(mesh);

  // HARD gate: any element beyond a hard shape threshold (sliver
  // |normalizedJacobian| < 0.02, catastrophic aspect ratio > 100, a folded C3D10
  // mapping, or a non-finite metric) cannot be trusted — a handful (< 5%) is
  // enough to corrupt the solve, so percentages do NOT gate here. With no local
  // remesher on this path, fail with an actionable message naming the worst
  // elements' coordinates so the client can highlight them.
  if (meshQualityReport.hardViolationCount > 0) {
    if ((input.meshGate ?? 'throw') === 'warn') {
      // Internal calibration probe on a controlled fixture: log but proceed
      // (the extracted quantity is validated for this known geometry).
      console.warn(`[Mesh quality] ${formatHardViolations(meshQualityReport)}`);
    } else {
      throw new Error(formatHardViolations(meshQualityReport));
    }
  }

  // SOFT tier: advisory only. A broadly marginal mesh (> SOFT_POOR_WARN_PERCENT
  // of elements below the poor shape floor) still solves, but stress recovery may
  // be less accurate. Percentage thresholds belong to this soft tier alone.
  const SOFT_POOR_WARN_PERCENT = 1;
  const poorQualityPercent = (meshQualityReport.poorQualityCount / mesh.elementCount) * 100;
  if (poorQualityPercent > SOFT_POOR_WARN_PERCENT) {
    console.warn(
      `[Mesh quality] ${meshQualityReport.poorQualityCount} elements (${poorQualityPercent.toFixed(1)}%) ` +
      `have poor (but usable) shape. Stress recovery may be less accurate. ` +
      `Worst normalized Jacobian: ${meshQualityReport.worstNormalizedJacobian.toFixed(4)} (ideal 1.0), ` +
      `worst AR: ${meshQualityReport.worstAspectRatio.toFixed(1)}, ` +
      `dihedral range: ${meshQualityReport.worstMinDihedralDeg.toFixed(1)}°–${meshQualityReport.worstMaxDihedralDeg.toFixed(1)}°.`
    );
  }

  _snap("before assembleK");
  const { K, diagIdx } = await assembleK(mesh, material, 'auto', undefined, input.materialField);
  _snap("after assembleK");

  const f = assembleForceVector(mesh.nodeCount, forces);
  // Save a copy of f_ext BEFORE BC modification — needed for reaction recovery
  const f_ext = new Float64Array(f);

  // Save a pristine copy of K's values BEFORE BC modification when requested
  // (issue #100: reused by modal/buckling, which apply their own BC flavors).
  const K0data = input.keepPristineK ? K.data.slice() : undefined;

  // applyDirichletBC modifies K and f in-place. The static path uses EXACT
  // ELIMINATION (issue #154): constrained rows/cols are zeroed and the known
  // values moved to the RHS, so constraints are satisfied exactly and no penalty
  // conditioning is injected for the PCG to fight. The returned pristine rows let
  // computeBoltReactions recover true reactions R = K0·u − f_ext (issue #136).
  const bc = applyDirichletBC(K, f, diagIdx, constraints, 'elimination');
  _snap("after applyDirichletBC");

  // Use the cooperative (event-loop-yielding) solver on the streaming analysis
  // path so CG residuals stream live and a mid-solve abort is observed promptly
  // (issue #109); the blocking path keeps the tight synchronous solver.
  const cgOpts = { signal: input.signal, onProgress: input.onCgProgress };
  const cg = (input.signal || input.onCgProgress)
    ? await solvePCGStreaming(K, f, diagIdx, tol, maxIter, preconditioner, null, cgOpts)
    : solvePCG(K, f, diagIdx, tol, maxIter, preconditioner);
  _snap("after solvePCG");

  // Warn (but don't throw) if CG didn't converge — let caller inspect result
  if (!cg.converged) {
    console.warn(
      `[STORMFEA] CG did not converge after ${cg.iterations} iterations. ` +
      `Relative residual = ${cg.finalRelativeResidual.toExponential(3)}. ` +
      `Results may be inaccurate.`
    );
  }

  const solverMs = Date.now() - t0;
  _snap("before buildSolverResult");
  const result = buildSolverResult(mesh, cg.u, material, cg.iterations, cg.converged, solverMs, cg.residualCheckpoints, true, input.materialField, input.criterion, input.inPlaneAniso ?? null, input.wallBond, {
    trueRelativeResidual:       cg.trueRelativeResidual,
    recurrenceRelativeResidual: cg.recurrenceRelativeResidual,
    conditionEstimate:          cg.conditionEstimate,
    displacementErrorEstimate:  cg.displacementErrorEstimate,
  });
  _snap("after buildSolverResult");
  validateResult(result, mesh);

  const boltReactions = computeBoltReactions(K, cg.u, f_ext, constraints, bc.pristineRows);

  return {
    result: { ...result, boltReactions, meshQualityReport },
    K,
    diagIdx,
    K0data,
  };
}

/**
 * Per-constraint reaction forces via the residual method against the PRISTINE
 * stiffness (issue #136 intent, made scheme-independent by issue #154):
 *   R_i = (K0 × u)_i − f_ext_i
 * where K0 is the pre-boundary-condition matrix. This is the force the support
 * exerts on the structure — exact for the given u regardless of CG residual, and
 * independent of how the constraint was imposed (elimination or penalty).
 *
 * With ELIMINATION the constrained rows of the SOLVED K are zeroed, so the
 * modified matrix carries no usable reaction; instead we dot the PRISTINE rows
 * (snapshotted by applyDirichletBC) with u. `pristineRows` is keyed by global
 * DOF and aligned to K.rowPtr/colIdx (elimination preserves the sparsity
 * structure, only zeroing values). O(nnz_at_constrained_rows).
 */
function computeBoltReactions(
  K: CSRMatrix,
  u: Float64Array,
  f_ext: Float64Array,
  constraints: readonly import("./boundary.js").FixedNodeSet[],
  pristineRows: Map<number, Float64Array>,
): { nodeCount: number; Fx: number; Fy: number; Fz: number }[] {
  const boltReactions: { nodeCount: number; Fx: number; Fy: number; Fz: number }[] = [];
  const { colIdx, rowPtr } = K;

  for (const cs of constraints) {
    let Fx = 0, Fy = 0, Fz = 0;
    for (const nodeIdx of cs.nodeIndices) {
      for (let dof = 0; dof < 3; dof++) {
        const globalDof = nodeIdx * 3 + dof;
        if (globalDof >= K.n) continue;
        // Pristine (pre-BC) row for this DOF; if somehow absent, no reaction.
        const row = pristineRows.get(globalDof);
        if (row === undefined) continue;
        const rStart = rowPtr[globalDof] ?? 0;
        let Ku_i = 0;
        for (let off = 0; off < row.length; off++) {
          const col = colIdx[rStart + off];
          if (col === undefined) continue;
          Ku_i += (row[off] ?? 0) * (u[col] ?? 0);
        }
        const reaction = Ku_i - (f_ext[globalDof] ?? 0);
        if (dof === 0) Fx += reaction;
        else if (dof === 1) Fy += reaction;
        else Fz += reaction;
      }
    }
    boltReactions.push({ nodeCount: cs.nodeIndices.length, Fx, Fy, Fz });
  }
  return boltReactions;
}

function validateResult(result: SolverResult, mesh: TetMesh): void {
  // Check for NaN/Inf in displacement
  for (let i = 0; i < result.displacement.length; i++) {
    if (!isFinite(result.displacement[i] ?? NaN)) {
      throw new Error(
        `Non-finite displacement at DOF ${i}: ${result.displacement[i]}. ` +
        `Check that all constraints are applied and material constants are valid.`
      );
    }
  }

  // Check for NaN/Inf in stress
  for (let e = 0; e < mesh.elementCount; e++) {
    if (!isFinite(result.vonMises[e] ?? NaN)) {
      throw new Error(`Non-finite von Mises at element ${e}: ${result.vonMises[e]}`);
    }
  }
}
