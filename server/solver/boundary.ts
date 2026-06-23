/**
 * boundary.ts
 * -----------
 * Apply Dirichlet boundary conditions via the penalty method.
 *
 * PENALTY METHOD
 * ==============
 * For each constrained DOF i with prescribed displacement u_i = g_i:
 *   K[i][i] += K_penalty
 *   f[i]    += K_penalty × g_i
 *
 * The resulting equation: (K_ii + K_penalty) × u_i = f_i + K_penalty × g_i
 * → u_i ≈ K_penalty × g_i / K_penalty = g_i  (to relative error K_ii/K_penalty ≈ 1e-8)
 *
 * For zero displacement (g_i = 0): f[i] = 0 (no change to original f_i = 0).
 * For prescribed displacement (g_i ≠ 0): f[i] += K_penalty × g_i.
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
}

/**
 * Apply Dirichlet BCs to K and f in-place via the penalty method.
 * Supports both zero constraints (fixed) and prescribed non-zero displacements.
 * Returns the penalty value used.
 */
export function applyDirichletBC(
  K:           CSRMatrix,
  f:           Float64Array,
  diagIdx:     Int32Array,
  constraints: readonly FixedNodeSet[],
): number {
  // Calibrate penalty from max diagonal
  let kMax = 0;
  for (let i = 0; i < K.n; i++) {
    const dp = diagIdx[i];
    if (dp === undefined) throw new RangeError(`diagIdx[${i}] undefined`);
    const val = Math.abs(K.data[dp] ?? 0);
    if (val > kMax) kMax = val;
  }
  if (kMax < 1e-300) kMax = 1.0;
  const K_PENALTY = kMax * 1e8;

  for (const constraint of constraints) {
    for (let ni = 0; ni < constraint.nodeIndices.length; ni++) {
      const nodeIdx = constraint.nodeIndices[ni];
      if (nodeIdx === undefined) continue;

      // Prescribed displacement for this node (default: zero)
      const prescribed = constraint.prescribedDisplacement?.[ni] ?? [0, 0, 0];

      for (let dof = 0; dof < 3; dof++) {
        const globalDOF = nodeIdx * 3 + dof;
        if (globalDOF >= K.n) {
          throw new RangeError(
            `Constraint node ${nodeIdx} DOF ${dof} (global ${globalDOF}) out of range n=${K.n}`
          );
        }
        const dp = diagIdx[globalDOF];
        if (dp === undefined) throw new RangeError(`diagIdx[${globalDOF}] undefined`);

        const g = prescribed[dof] ?? 0;
        (K.data as Float64Array)[dp] = (K.data[dp] ?? 0) + K_PENALTY;
        f[globalDOF] = (f[globalDOF] ?? 0) + K_PENALTY * g;
      }
    }
  }

  return K_PENALTY;
}

