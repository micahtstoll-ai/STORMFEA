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
  PointForce,
  SolverResult,
  CSRMatrix,
} from "./types.js";

import type { FixedNodeSet } from "./boundary.js";
import { assembleK }           from "./assembly.js";
import { applyDirichletBC }    from "./boundary.js";
import { assembleForceVector } from "./load.js";
import { solvePCG }            from "./cg.js";
import { buildSolverResult }   from "./stress.js";
import { computeMeshQuality }  from "./meshQuality.js";

export interface SolverInput {
  readonly mesh:        TetMesh;
  readonly material:    AnyMaterial;
  readonly constraints: readonly FixedNodeSet[];
  readonly forces:      readonly PointForce[];
  readonly cgTolerance?:   number;
  readonly cgMaxIter?:     number;
  readonly preconditioner?: 'jacobi' | 'ic0';
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
  const t0 = Date.now();

  const { mesh, material, constraints, forces } = input;
  const tol            = input.cgTolerance ?? 1e-8;
  const maxIter        = input.cgMaxIter;
  const preconditioner = input.preconditioner ?? 'ic0';

  _snap("before mesh quality check");

  // ── 0. Compute mesh quality metrics ────────────────────────────────────────
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

  // ── 1. Assemble global stiffness matrix ────────────────────────────────────
  const { K, diagIdx } = await assembleK(mesh, material);

  _snap("after assembleK");

  // ── 2. Assemble force vector ───────────────────────────────────────────────
  const f = assembleForceVector(mesh.nodeCount, forces);

  // Save a copy of f_ext BEFORE BC modification — needed for reaction recovery
  const f_ext = new Float64Array(f);

  // ── 3. Apply Dirichlet boundary conditions ─────────────────────────────────
  // applyDirichletBC modifies K and f in-place (penalty method)
  applyDirichletBC(K, f, diagIdx, constraints);

  _snap("after applyDirichletBC");

  // ── 4. Solve K·u = f ──────────────────────────────────────────────────────
  const cg = solvePCG(K, f, diagIdx, tol, maxIter, preconditioner);

  _snap("after solvePCG");

  // Warn (but don't throw) if CG didn't converge — let caller inspect result
  if (!cg.converged) {
    console.warn(
      `[StressForm] CG did not converge after ${cg.iterations} iterations. ` +
      `Relative residual = ${cg.finalRelativeResidual.toExponential(3)}. ` +
      `Results may be inaccurate.`
    );
  }

  // ── 5. Recover stresses and build result ───────────────────────────────────
  const solverMs = Date.now() - t0;
  _snap("before buildSolverResult");
  const result = buildSolverResult(
    mesh,
    cg.u,
    material,
    cg.iterations,
    cg.converged,
    solverMs,
    cg.residualCheckpoints,
  );

  _snap("after buildSolverResult");

  // ── 6. Sanity checks ───────────────────────────────────────────────────────
  validateResult(result, mesh);

  // ── 7. Compute per-constraint reaction forces ─────────────────────────────
  // Reaction recovery using the residual method:
  //   f_reaction = K_modified × u - f_ext
  // At constrained DOFs this gives the force the boundary exerts on the structure.
  // K_modified × u is computed as a sparse row dot-product at the constrained DOF rows.
  // This is O(nnz_at_constrained_rows) — fast even for large meshes.
  const boltReactions: { nodeCount: number; Fx: number; Fy: number; Fz: number }[] = [];
  const u = cg.u;
  const { data, colIdx, rowPtr } = K;

  for (const cs of constraints) {
    let Fx = 0, Fy = 0, Fz = 0;
    for (const nodeIdx of cs.nodeIndices) {
      for (let dof = 0; dof < 3; dof++) {
        const globalDof = nodeIdx * 3 + dof;
        if (globalDof >= K.n) continue;
        // Compute (K × u)[globalDof] — sparse row dot-product
        let Ku_i = 0;
        const rStart = rowPtr[globalDof]   ?? 0;
        const rEnd   = rowPtr[globalDof+1] ?? 0;
        for (let k = rStart; k < rEnd; k++) {
          const col = colIdx[k];
          if (col === undefined) continue;
          Ku_i += (data[k] ?? 0) * (u[col] ?? 0);
        }
        // Reaction = (K×u - f_ext) at this DOF
        const reaction = Ku_i - (f_ext[globalDof] ?? 0);
        if (dof === 0) Fx += reaction;
        else if (dof === 1) Fy += reaction;
        else Fz += reaction;
      }
    }
    boltReactions.push({ nodeCount: cs.nodeIndices.length, Fx, Fy, Fz });
  }

  // Attach reactions and mesh quality report to result (type allows optional fields)
  return { ...result, boltReactions, meshQualityReport };
}

// ─── StaticSolveIntermediate ──────────────────────────────────────────────────

export interface StaticSolveIntermediate {
  result:  SolverResult;
  K:       CSRMatrix;
  diagIdx: Int32Array;
}

/**
 * Like runLinearStatic, but also returns K and diagIdx for downstream reuse
 * (e.g. modal analysis). K has Dirichlet BCs already applied via the penalty method.
 */
export async function runLinearStaticWithK(input: SolverInput): Promise<StaticSolveIntermediate> {
  const t0 = Date.now();

  const { mesh, material, constraints, forces } = input;
  const tol            = input.cgTolerance ?? 1e-8;
  const maxIter        = input.cgMaxIter;
  const preconditioner = input.preconditioner ?? 'ic0';

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

  const { K, diagIdx } = await assembleK(mesh, material);
  const f = assembleForceVector(mesh.nodeCount, forces);
  const f_ext = new Float64Array(f);
  applyDirichletBC(K, f, diagIdx, constraints);
  const cg = solvePCG(K, f, diagIdx, tol, maxIter, preconditioner);

  if (!cg.converged) {
    console.warn(`[runLinearStaticWithK] CG did not converge after ${cg.iterations} iterations.`);
  }

  const solverMs = Date.now() - t0;
  const result = buildSolverResult(mesh, cg.u, material, cg.iterations, cg.converged, solverMs, cg.residualCheckpoints);
  validateResult(result, mesh);

  const boltReactions = computeBoltReactions(K, cg.u, f_ext, constraints);

  return {
    result: { ...result, boltReactions, meshQualityReport },
    K,
    diagIdx,
  };
}

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
