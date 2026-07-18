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
import { computeMeshQuality }  from "./meshQuality.js";

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

  // Compute mesh quality metrics before assembly
  const meshQualityReport = computeMeshQuality(mesh);
  const degeneratePercent = (meshQualityReport.degenerateCount / mesh.elementCount) * 100;
  const poorQualityPercent = (meshQualityReport.poorQualityCount / mesh.elementCount) * 100;

  if (degeneratePercent > 5) {
    throw new Error(
      `Mesh quality error: ${meshQualityReport.degenerateCount} elements (${degeneratePercent.toFixed(1)}%) ` +
      `are degenerate (inverted or zero-volume). ` +
      `Worst Jacobian: ${meshQualityReport.worstJacobianMin.toFixed(6)}. ` +
      `Please re-mesh with higher quality settings or verify element connectivity.`
    );
  }

  if (poorQualityPercent > 1) {
    console.warn(
      `[Mesh quality] ${meshQualityReport.poorQualityCount} elements (${poorQualityPercent.toFixed(1)}%) ` +
      `have poor quality. Stress recovery may be less accurate. ` +
      `Worst J_min: ${meshQualityReport.worstJacobianMin.toFixed(6)}, ` +
      `worst AR: ${meshQualityReport.worstAspectRatio.toFixed(1)}, ` +
      `worst dihedral: ${meshQualityReport.worstMinDihedralDeg.toFixed(1)}°.`
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

  // applyDirichletBC modifies K and f in-place (penalty method)
  applyDirichletBC(K, f, diagIdx, constraints);
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
  const result = buildSolverResult(mesh, cg.u, material, cg.iterations, cg.converged, solverMs, cg.residualCheckpoints, true, input.materialField, input.criterion, input.inPlaneAniso ?? null);
  _snap("after buildSolverResult");
  validateResult(result, mesh);

  const boltReactions = computeBoltReactions(K, cg.u, f_ext, constraints);

  return {
    result: { ...result, boltReactions, meshQualityReport },
    K,
    diagIdx,
    K0data,
  };
}

/**
 * Per-constraint reaction forces via the residual method:
 *   f_reaction = K_modified × u − f_ext
 * At constrained DOFs this gives the force the boundary exerts on the structure.
 * K_modified × u is computed as a sparse row dot-product at the constrained DOF
 * rows only — O(nnz_at_constrained_rows), fast even for large meshes.
 */
function computeBoltReactions(
  K: CSRMatrix,
  u: Float64Array,
  f_ext: Float64Array,
  constraints: readonly import("./boundary.js").FixedNodeSet[],
): { nodeCount: number; Fx: number; Fy: number; Fz: number }[] {
  const boltReactions: { nodeCount: number; Fx: number; Fy: number; Fz: number }[] = [];
  const { data, colIdx, rowPtr } = K;

  for (const cs of constraints) {
    let Fx = 0, Fy = 0, Fz = 0;
    for (const nodeIdx of cs.nodeIndices) {
      for (let dof = 0; dof < 3; dof++) {
        const globalDof = nodeIdx * 3 + dof;
        if (globalDof >= K.n) continue;
        let Ku_i = 0;
        const rStart = rowPtr[globalDof]   ?? 0;
        const rEnd   = rowPtr[globalDof+1] ?? 0;
        for (let k = rStart; k < rEnd; k++) {
          const col = colIdx[k];
          if (col === undefined) continue;
          Ku_i += (data[k] ?? 0) * (u[col] ?? 0);
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
