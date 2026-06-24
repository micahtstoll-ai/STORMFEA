/**
 * types.ts
 * --------
 * All type definitions for the Phase 1 FEM kernel.
 *
 * Units throughout: millimetres (mm), Newtons (N), Megapascals (MPa = N/mm²).
 * All solver arithmetic uses Float64 (JavaScript's native number type).
 */

// ─── Mesh ────────────────────────────────────────────────────────────────────

/**
 * Linear or quadratic tetrahedral mesh consumed by the solver.
 *
 * nodes:          flat [x0,y0,z0, x1,y1,z1, ...], length = nodeCount × 3, in mm
 * elements:       flat node indices per element, length = elementCount × nodesPerElem
 * nodesPerElem:   4 for C3D4 (linear), 10 for C3D10 (quadratic)
 *
 * For C3D4:  elements = [n0,n1,n2,n3, ...]
 * For C3D10: elements = [n0..n9, ...] in Gmsh node ordering
 *   Corner nodes: 0–3 (same as C3D4)
 *   Edge midpoints: 4=(0-1), 5=(1-2), 6=(0-2), 7=(0-3), 8=(1-3), 9=(2-3)
 */
export interface TetMesh {
  readonly nodes:          Float64Array;
  readonly elements:       Int32Array;
  readonly nodeCount:      number;
  readonly elementCount:   number;
  readonly nodesPerElem:   number;   // 4 = linear C3D4, 10 = quadratic C3D10
}

// ─── Material ────────────────────────────────────────────────────────────────

/**
 * Isotropic linear elastic material.
 * E in MPa, ν dimensionless, yieldStrength in MPa.
 */
export interface IsotropicMaterial {
  readonly E:             number;
  readonly nu:            number;
  readonly yieldStrength: number;
  readonly label:         string;
}

/**
 * Transversely isotropic linear elastic material.
 *
 * The XY plane is the isotropic plane (parallel to print bed).
 * Z is the through-thickness direction (perpendicular to layers).
 *
 * 5 independent elastic constants:
 *   E_xy  — in-plane Young's modulus (along filament direction)
 *   E_z   — through-thickness Young's modulus (~40-55% of E_xy for FDM)
 *   nu_xy — in-plane Poisson's ratio
 *   nu_xz — out-of-plane Poisson's ratio
 *   G_xz  — out-of-plane shear modulus (~35-45% of in-plane)
 *
 * In-plane shear modulus is derived: G_xy = E_xy / (2 × (1 + nu_xy))
 *
 * Source: Ahn et al. 2002, Casavola et al. 2016, Rodriguez et al. 2001.
 */
export interface OrthotropicMaterial {
  readonly kind:          "orthotropic";
  readonly E_xy:          number;   // MPa — in-plane modulus
  readonly E_z:           number;   // MPa — through-thickness modulus
  readonly nu_xy:         number;   // in-plane Poisson's ratio
  readonly nu_xz:         number;   // out-of-plane Poisson's ratio
  readonly G_xz:          number;   // MPa — out-of-plane shear modulus
  /** Yield strength in XY (in-layer). Used for failure comparison. */
  readonly yieldXY:       number;   // MPa
  /** Yield strength in Z (inter-layer). ~50-60% of yieldXY for FDM. */
  readonly yieldZ:        number;   // MPa
  readonly label:         string;
}

/** Union type accepted by the solver. */
export type AnyMaterial = IsotropicMaterial | OrthotropicMaterial;

export function isOrthotropic(m: AnyMaterial): m is OrthotropicMaterial {
  return (m as OrthotropicMaterial).kind === "orthotropic";
}

// ─── Boundary conditions ─────────────────────────────────────────────────────

/**
 * A Dirichlet (fixed displacement) constraint on a set of nodes.
 * Import from boundary.ts directly.
 */
export interface FixedNodeSet {
  readonly nodeIndices: readonly number[];
  readonly prescribedDisplacement?: readonly [number, number, number][];
}

/**
 * A point force applied to a single node.
 * forceN[0..2] = [fx, fy, fz] in Newtons.
 */
export interface PointForce {
  readonly nodeIndex: number;
  readonly forceN:    readonly [number, number, number];
}

// ─── CSR sparse matrix ───────────────────────────────────────────────────────

/**
 * Compressed Sparse Row matrix (symmetric, only stores all entries but uses
 * symmetry for performance in the matvec product).
 *
 * K × u = f  where K is n×n SPD after applying BCs.
 *
 * data[k]   = value of the k-th stored non-zero
 * colIdx[k] = column index of the k-th stored non-zero
 * rowPtr[i] = index in data/colIdx where row i begins
 * rowPtr[n] = total number of stored non-zeros (nnz)
 */
export interface CSRMatrix {
  readonly n:      number;
  readonly data:   Float64Array;
  readonly colIdx: Int32Array;
  readonly rowPtr: Int32Array;
}

// ─── Solver result ───────────────────────────────────────────────────────────

/**
 * Everything the solver produces.
 * All arrays are in volumetric-mesh space (indexed by tet-mesh node / element).
 */
export interface SolverResult {
  /** Nodal displacements [ux0,uy0,uz0, ux1,uy1,uz1, ...] in mm. Length = nodeCount × 3. */
  readonly displacement:    Float64Array;

  /** Von Mises stress at each element centroid, in MPa. Length = elementCount. */
  readonly vonMises:        Float64Array;

  /** Safety factor = yieldStrength / vonMises, clamped to [0, 999]. Length = elementCount. */
  readonly safetyFactor:    Float64Array;

  /** Maximum displacement magnitude across all nodes, mm. */
  readonly maxDisplacementMm: number;

  /** Maximum von Mises stress across all elements, MPa. */
  readonly maxVonMisesMPa:    number;

  /** Minimum safety factor across all elements. */
  readonly minSafetyFactor:   number;

  /** Number of CG iterations taken. */
  readonly cgIterations:    number;

  /** Whether CG converged within the iteration limit. */
  readonly converged:       boolean;

  /** Wall-clock time for the full pipeline, ms. */
  readonly solverMs:        number;

  /**
   * Per-constraint reaction force vector [Fx, Fy, Fz] in Newtons.
   * constraints[i] corresponds to constraints array passed to runLinearStatic.
   * Length = number of FixedNodeSets. Computed from f_reaction = K×u - f_ext at constrained DOFs.
   */
  readonly boltReactions?: readonly { nodeCount: number; Fx: number; Fy: number; Fz: number }[];

  /**
   * Principal stresses (σ1 ≥ σ2 ≥ σ3) averaged to nodes, in MPa.
   * Flat layout: [σ1₀, σ2₀, σ3₀, σ1₁, σ2₁, σ3₁, ...]. Length = nodeCount × 3.
   */
  readonly nodePrincipalStress?: Float64Array;
}
