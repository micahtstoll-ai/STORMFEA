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
  /**
   * Mass density in kg/m³ (SI). Default: 1240 (PLA).
   * Solver converts to t/mm³ via ×1e-12: 1 kg/m³ = 1e-12 t/mm³.
   * In the N·mm system (force N, mass tonne): 1 N = 1 t·mm/s², so
   * eigenvalues ω² have units rad²/s² directly.
   */
  readonly massRho?:      number;   // kg/m³; default 1240
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
 *   nu_xz — out-of-plane Poisson's ratio (STANDARD engineering convention:
 *           ν_xz = −ε_z/ε_x under uniaxial IN-PLANE stress along x, so the
 *           compliance entry is S13 = −ν_xz/E_xy. The reciprocal ratio
 *           ν_zx = ν_xz·E_z/E_xy is derived internally for symmetry.
 *           Matches the convention of Casavola et al. 2016, the source of
 *           the default value 0.30. See issue #102.)
 *   G_xz  — out-of-plane shear modulus (~35-45% of in-plane)
 *
 * In-plane shear modulus G_xy: when G_xy is explicitly set (e.g. from CLT 1/A₆₆
 * inversion), that value is used. When absent, the constitutive builder derives it
 * as G_xy = E_xy / (2(1 + nu_xy)) — the isotropic approximation.
 *
 * Source: Ahn et al. 2002, Casavola et al. 2016, Rodriguez et al. 2001.
 */
export interface OrthotropicMaterial {
  readonly kind:          "orthotropic";
  readonly E_xy:          number;   // MPa — in-plane modulus
  readonly E_z:           number;   // MPa — through-thickness modulus
  readonly nu_xy:         number;   // in-plane Poisson's ratio
  readonly nu_xz:         number;   // out-of-plane Poisson's ratio (standard convention: S13 = −ν_xz/E_xy)
  readonly G_xz:          number;   // MPa — out-of-plane shear modulus
  /** When set, used as-is. When absent, derived as E_xy/(2(1+nu_xy)). */
  readonly G_xy?:         number;   // MPa — in-plane shear (explicit or derived)
  /** Yield strength in XY (in-layer). Used for failure comparison. */
  readonly yieldXY:       number;   // MPa
  /** Yield strength in Z (inter-layer). ~50-60% of yieldXY for FDM. */
  readonly yieldZ:        number;   // MPa
  /**
   * Interlaminar shear allowable S_zs (MPa) — the shear strength of the layer
   * interface itself, measured directly by the lap-shear coupon. Independent
   * of yieldZ so a bond that is strong in shear but weak in tension (or vice
   * versa) is representable. Absent → yieldZ/√3, the Hill (1948) transverse-
   * shear equivalence the legacy criterion hard-wired (L = M = 3/(2Z²) ⇒
   * τ_z,yield = Z/√3), so old materials reproduce legacy behavior.
   */
  readonly yieldZShear?:  number;   // MPa
  readonly label:         string;
  /**
   * Unit vector (global frame) giving the material's weak / through-layer axis —
   * the FDM layer normal. Absent or [0,0,1] means the local model axes coincide
   * with global axes (transverse isotropy about global Z, the historical flat
   * case). When it points elsewhere (e.g. horizontal for an upright print) the
   * constitutive matrix is rotated to align the local 3-axis with it (Bond
   * transform), and the Hill criterion is evaluated in that rotated frame. This
   * replaces the scalar-swap upright approximation (issue #101) with an exact
   * tensor rotation. In-plane azimuth about the weak axis is irrelevant (the
   * material is isotropic in the layer plane), so only the direction matters.
   */
  readonly weakAxis?:     readonly [number, number, number];
  /**
   * Mass density in kg/m³ (SI). Default: 1240 (PLA).
   * Solver converts to t/mm³ via ×1e-12: 1 kg/m³ = 1e-12 t/mm³.
   */
  readonly massRho?:      number;   // kg/m³; default 1240
}

/**
 * Gyroid infill material with density-based constitutive matrix scaling.
 *
 * Gyroid is a space-filling cubic lattice structure optimized for FDM printing.
 * Elastic properties degrade non-linearly with relative density ρ (0=empty, 1=solid).
 *
 * Power-law degradation model:
 *   E_xy(ρ) = 3500 × ρ^1.75 × (1 − 0.12(1 − ρ))  [in-plane modulus]
 *   E_z(ρ)  = 2275 × ρ^2.1  × (1 − 0.18(1 − ρ))  [through-thickness modulus]
 *   G_xz(ρ) = 1143 × ρ^2.3  × (1 − 0.22(1 − ρ))  [shear modulus]
 *   G_xy(ρ) = E_xy(ρ) / (2(1 + ν_xy))              [derived]
 *   ν_xy and ν_xz are constant across densities
 *
 * Gibson-Ashby (1997) lattice scaling: E ∝ ρ^n with n ∈ [1.5, 2.5] for open-cell solids.
 * The power-law FORM is cited (Gibson & Ashby; see the SOURCES tab entry
 * "gibson_ashby1997"). The specific exponents (1.75, 2.1, 2.3) and small linear
 * correction factors (0.12, 0.18, 0.22) are STORMFEA engineering estimates
 * chosen WITHIN that cited range — no paper reports gyroid-specific coefficients
 * (Birosz et al. 2022 is a qualitative pattern comparison, not a density-modulus
 * fit). They are confidence-labelled LOW, locked by regression tests
 * (server/tests/unit/gyroid-formula.test.ts), and can be replaced with
 * printer-specific values via coupon calibration. Treat as bounded estimates.
 */
export interface GyroidOrthotropic {
  readonly kind:          "gyroid-orthotropic";
  readonly density:       number;           // [0, 1] relative infill density
  readonly E_xy:          number;           // MPa — in-plane modulus (computed from density)
  readonly E_z:           number;           // MPa — through-thickness modulus (computed from density)
  readonly nu_xy:         number;           // in-plane Poisson's ratio (constant)
  readonly nu_xz:         number;           // out-of-plane Poisson's ratio (constant)
  readonly G_xz:          number;           // MPa — out-of-plane shear modulus (computed from density)
  readonly yieldXY:       number;           // MPa — yield strength in XY
  readonly yieldZ:        number;           // MPa — yield strength in Z
  /** Interlaminar shear allowable S_zs; absent → yieldZ/√3 (see OrthotropicMaterial). */
  readonly yieldZShear?:  number;           // MPa
  readonly label:         string;
  /** Mass density in kg/m³ (SI); see IsotropicMaterial.massRho. */
  readonly massRho?:      number;
}

/** Union type accepted by the solver. */
export type AnyMaterial = IsotropicMaterial | OrthotropicMaterial | GyroidOrthotropic;

export function isOrthotropic(m: AnyMaterial): m is OrthotropicMaterial {
  return (m as OrthotropicMaterial).kind === "orthotropic";
}

export function isGyroidOrthotropic(m: AnyMaterial): m is GyroidOrthotropic {
  return (m as GyroidOrthotropic).kind === "gyroid-orthotropic";
}

export function isOrthotropicLike(m: AnyMaterial): m is OrthotropicMaterial | GyroidOrthotropic {
  return isOrthotropic(m) || isGyroidOrthotropic(m);
}

/**
 * Per-element quantized material field for the two-region (shell/core) FDM
 * model. Elements are binned by their wall-band volume fraction; each bin
 * carries a prebuilt constitutive matrix and blended strength/density so the
 * assembly and recovery hot loops only pay an Int32Array lookup per element.
 *
 * Absent everywhere = uniform material (legacy behavior, bit-identical).
 * When present, `SolverInput.material` is the volume-weighted AVERAGE material
 * and keeps feeding scalar consumers (error-estimate energy norm, criterion
 * routing); the field overrides per-element stiffness, yield, and density.
 */
export interface ElementMaterialField {
  readonly binCount:     number;
  /** length = elementCount, values in [0, binCount) */
  readonly binOfElement: Int32Array;
  /** binCount × 36 prebuilt constitutive matrices (weakAxis rotation baked in) */
  readonly C:            Float64Array;
  /** In-plane yield per bin, MPa */
  readonly yieldXY:      Float64Array;
  /** Through-layer yield per bin, MPa */
  readonly yieldZ:       Float64Array;
  /** Interlaminar shear allowable per bin, MPa (endpoint absent → yieldZ/√3) */
  readonly yieldZShear:  Float64Array;
  /** Mass density per bin, kg/m³ (SI, converted at assembly time) */
  readonly massRho:      Float64Array;
  /** Representative shell (wall) volume fraction per bin, for reporting */
  readonly shellFrac:    Float64Array;
}

/**
 * Per-element wall-to-wall (bead-to-bead) bond field for the multi-loop
 * shell model: unlike interlayer (Z) bonding, which uses one global weak
 * axis for the whole solve, adjacent perimeter loops are fused along a
 * LOCAL radial direction that varies continuously around the part's
 * contour. This is a criterion-only, opt-in addition — it never enters the
 * constitutive matrix or the assembly-worker payload (post-solve stress
 * recovery only), so it does not interact with `ElementMaterialField`'s
 * shell/core stiffness blend.
 *
 * Absent = feature off (bit-identical to today). Requires `wallCount >= 2`
 * (no internal loop-to-loop boundary exists at wallCount=1).
 */
export interface WallBondField {
  /** length = elementCount*3, per-element unit radial (wall-normal) direction, global frame. Zero where undefined (no interface here). */
  readonly wallNormal: Float64Array;
  /** length = elementCount, in [0,1]: how much of this element sits at an internal loop-to-loop boundary (bonded on both sides). */
  readonly wallInteriorFrac: Float64Array;
  /** Wall-to-wall tension allowable, MPa (post bond-model relStrength scaling). */
  readonly yieldWallMPa: number;
  /** Wall-to-wall shear allowable, MPa (post bond-model relStrength scaling). */
  readonly yieldWallShearMPa: number;
}

export function validateGyroidOrthotropic(mat: GyroidOrthotropic): void {
  if (mat.density < 0 || mat.density > 1.0) {
    throw new Error(`Density must be in [0, 1.0], got ${mat.density}`);
  }
  if (mat.E_xy <= 0) throw new Error(`E_xy must be > 0, got ${mat.E_xy}`);
  if (mat.E_z <= 0) throw new Error(`E_z must be > 0, got ${mat.E_z}`);
  if (mat.G_xz <= 0) throw new Error(`G_xz must be > 0, got ${mat.G_xz}`);
  if (mat.nu_xy < 0 || mat.nu_xy >= 0.5) throw new Error(`nu_xy invalid: ${mat.nu_xy}`);
  if (mat.nu_xz < 0 || mat.nu_xz >= 0.5) throw new Error(`nu_xz invalid: ${mat.nu_xz}`);
  if (mat.yieldXY <= 0) throw new Error(`yieldXY must be > 0, got ${mat.yieldXY}`);
  if (mat.yieldZ <= 0) throw new Error(`yieldZ must be > 0, got ${mat.yieldZ}`);
  if (!mat.label || mat.label.trim() === "") throw new Error("Label cannot be empty");
}

// ─── Boundary conditions ─────────────────────────────────────────────────────

/**
 * A Dirichlet (fixed displacement) constraint on a set of nodes.
 * Import from boundary.ts directly.
 */
export interface FixedNodeSet {
  readonly nodeIndices: readonly number[];
  readonly prescribedDisplacement?: readonly [number, number, number][];
  /** Which axes to constrain [x,y,z]. Omit to constrain all three. */
  readonly fixedAxes?: readonly [boolean, boolean, boolean];
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

  /**
   * Index of the element with the minimum safety factor (the governing
   * hotspot). Lets region-aware consumers (e.g. fatigue under the two-region
   * material model) read the governing element's local yield.
   */
  readonly governingElement?: number;

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

  /**
   * Present when modal analysis was requested alongside the linear static solve.
   * Undefined for a pure static run.
   */
  readonly modalResult?: ModalAnalysisResult;

  /**
   * CG solver residual checkpoints at geometric iteration intervals,
   * for convergence monitoring and visualization.
   * Array of { iteration, relativeResidual } points.
   */
  readonly residualCheckpoints?: readonly { iteration: number; relativeResidual: number }[];

  /**
   * Zienkiewicz-Zhu error estimates η_e at each element centroid (0–1 fraction).
   * Computed from ‖σ_SPR − σ_centroid‖_energy,e / ‖σ_global‖_energy.
   * High values indicate under-resolved elements. Length = elementCount.
   */
  readonly errorEstimate?: Float32Array;

  /**
   * Global relative error η = sqrt(Σ η_e²) / sqrt(Σ ‖σ_e‖²) as a fraction 0–1.
   * Values < 0.05 indicate acceptable mesh quality; 0.05–0.10 suggest refinement.
   */
  readonly globalRelativeError?: number;

  /**
   * Top-20 element centroids of highest error estimates for refinement guidance.
   * Array of { x, y, z (mm), errorEstimate (0–1) }. Present only if errorEstimate is computed.
   */
  readonly topErrorElements?: readonly { x: number; y: number; z: number; errorEstimate: number }[];

  /**
   * Mesh quality report: element counts by severity, worst-case values, global score.
   * Computed before assembling K; may inform UI warnings.
   */
  readonly meshQualityReport?: MeshQualityReport;

  /**
   * Element centroid Cauchy stress tensors [σxx,σyy,σzz,τxy,τyz,τxz] per element.
   * Flat array, length = elementCount × 6. Used by the linear buckling solver
   * to assemble the geometric stiffness matrix Kσ.
   * Not serialised to the client — internal to the solver pipeline.
   */
  readonly elemStress6?: Float64Array;
}

// ─── Modal analysis types ─────────────────────────────────────────────────────

/**
 * A single natural frequency mode.
 * modeShape length = nodeCount * 3 (same DOF ordering as displacement).
 * Mass-normalised: φᵀ·M·φ = 1.
 */
export interface ModeResult {
  readonly frequencyHz:          number;        // Hz = sqrt(omega2) / (2π)
  readonly omega2:               number;        // rad²/s² (eigenvalue of K·φ = ω²·M·φ)
  readonly modeShape:            Float64Array;  // length = nodeCount * 3
  readonly participationFactor:  number;        // φᵀ·M·r, r = X-direction unit excitation
}

/**
 * Full result from a modal analysis run.
 * Returned by runModalAnalysis; embedded in SolverResult when analysisType === 'modal'.
 */
export interface ModalAnalysisResult {
  readonly modes:               ModeResult[];    // sorted ascending by frequencyHz
  readonly converged:           boolean;
  readonly iterations:          number;
  readonly rigidBodyModeCount:  number;
  readonly modalMs:             number;          // wall-clock ms for eigensolver only
}

// ─── Mesh Quality Types ───────────────────────────────────────────────────────

/**
 * Quality severity: degenerate (J < 0), poor (J < 0.01 or AR > 20 or dihedral < 5°), normal.
 */
export type ElementQualitySeverity = "degenerate" | "poor" | "normal";

/**
 * Per-element quality metrics.
 */
export interface ElementQualityMetrics {
  readonly elementIdx:       number;
  readonly jacobianMin:      number;        // minimum determinant (J_min)
  readonly aspectRatio:      number;        // longest edge / shortest altitude
  readonly minDihedralDeg:   number;        // minimum dihedral angle in degrees
  readonly severity:         ElementQualitySeverity;
}

/**
 * Aggregated mesh quality report.
 * Computed before assembly; attached to SolverResult.
 */
export interface MeshQualityReport {
  readonly totalElements:           number;
  readonly degenerateCount:         number;   // J_min < 0 (inverted)
  readonly poorQualityCount:        number;   // J_min < 0.01 or AR > 20 or dihedral < 5°
  readonly normalCount:             number;
  readonly qualityScore:            number;   // [0, 1] where 1 = all elements perfect
  readonly worstJacobianMin:        number;
  readonly worstAspectRatio:        number;
  readonly worstMinDihedralDeg:     number;
  readonly worstElement:            ElementQualityMetrics | null;
}
