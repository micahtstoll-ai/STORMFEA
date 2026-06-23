/**
 * coupon_fea.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * FEA-in-the-loop calibration support.
 *
 * THE PROBLEM
 * -----------
 * Calibration converts a measured failure FORCE into a material STRENGTH.
 * The naive conversion is nominal stress: S = F / A. That is correct only when
 * the stress is uniform across the section the force passes through — which is
 * true for a well-designed tensile dog-bone failing mid-gauge, but NOT for the
 * lap-shear or bearing coupons, whose load paths concentrate stress at overlap
 * ends and hole edges.
 *
 * Why it matters: StressForm predicts real parts with FEA, which reports the
 * PEAK stress (including concentrations). If the material allowable was derived
 * from NOMINAL stress (F/A) but parts are checked against PEAK stress, the two
 * are measured differently and shear/bearing-governed predictions come out
 * biased non-conservative. To stay consistent, the allowable must be peak-based
 * too — i.e. extracted with the same solver that evaluates parts.
 *
 * THE METHOD
 * ----------
 * Run the coupon through the existing linear solver at a reference load, read
 * the peak von Mises in the failure region, and divide by the nominal von Mises
 * at that same load. Because the solver is LINEAR, stress scales with load, so
 * this ratio — the stress-concentration factor Kt — is a pure geometry/anisotropy
 * number, independent of the load magnitude:
 *
 *     Kt = peakVonMises(FEA) / nominalVonMises
 *
 * The peak-based allowable is then:
 *
 *     S_true = Kt · (F_fail / A_nominal)
 *
 * For a uniform tensile gauge Kt → 1 and this reduces exactly to F/A, which is
 * why the tensile coupon keeps the plain F/A path. lap-shear and bearing get
 * Kt > 1 from the solver.
 *
 * This module deliberately reuses runLinearStatic (the same entry point that
 * evaluates real parts) rather than re-deriving stresses by hand — that reuse
 * is the whole point: the calibration and the prediction share one stress engine.
 *
 * ACCURACY / NOISE FLOOR
 * ----------------------
 * The boundary-condition API only supports fully-fixed nodes (all 3 DOF), so the
 * gripped end is clamped rather than a free-contracting roller. Clamping blocks
 * Poisson contraction and leaves a small triaxial stress bump near the fixed end;
 * point-load application leaves another near the loaded end. Both decay inward
 * (Saint-Venant), so the gauge window must exclude the ends. Even so, a perfectly
 * uniform reference bar returns Kt ≈ 1.05 rather than 1.00 with the default mesh
 * density — that ~5% is the method's noise floor. Practical consequence: trust Kt
 * signals comfortably above the floor (bearing/lap-shear concentrations are
 * typically 1.3–2.5×); do NOT read meaning into Kt differences under ~10%.
 * Tightening this floor would require per-DOF (roller) constraints in the solver
 * core — a separate change, not done here.
 */

import type { AnyMaterial, TetMesh, FixedNodeSet, PointForce } from "./solver/types.js";
import { runLinearStatic } from "./solver/pipeline.js";
import { generateBoxMesh } from "./solver/meshgen.js";

/** Axis index: 0 = x, 1 = y, 2 = z. */
export type Axis = 0 | 1 | 2;

export interface AxialLoadCase {
  /** Total force (N) applied along `axis` at the high-coordinate end face. */
  totalForceN: number;
  /** Axis the force is applied along. */
  axis: Axis;
  /** Cross-sectional area (mm²) carrying the nominal stress. */
  nominalAreaMm2: number;
  /**
   * Fraction of the span (along `axis`) at each end treated as grip/load zone
   * and EXCLUDED from the peak-stress measurement, to avoid Saint-Venant
   * load-application artifacts. 0.2 keeps the central 60% as the gauge.
   */
  gripFraction: number;
  /**
   * If true the nominal stress is treated as pure shear (von Mises = √3·τ);
   * if false, as uniaxial normal stress (von Mises = σ). Tensile/bearing use
   * false; interlaminar lap-shear uses true.
   */
  shear: boolean;
}

/** Max von Mises over elements whose centroid lies within [lo, hi] on `axis`. */
export function regionalPeakVonMises(
  mesh: TetMesh,
  vonMises: Float64Array,
  axis: Axis,
  lo: number,
  hi: number,
): number {
  const npe = mesh.nodesPerElem;
  let peak = 0;
  for (let e = 0; e < mesh.elementCount; e++) {
    // Centroid coordinate on `axis` (corner nodes only — sufficient for C3D4/C3D10).
    let c = 0;
    for (let k = 0; k < 4; k++) {
      const node = mesh.elements[e * npe + k]!;
      c += mesh.nodes[node * 3 + axis]!;
    }
    c /= 4;
    if (c < lo || c > hi) continue;
    const vm = vonMises[e] ?? 0;
    if (vm > peak) peak = vm;
  }
  return peak;
}

/**
 * Build the constraint + force sets for an axial pull: fix the low-coordinate
 * end face on `axis`, apply `totalForceN` spread evenly over the high end face.
 */
export function buildAxialConstraintsAndForces(
  mesh: TetMesh,
  axis: Axis,
  totalForceN: number,
): { constraints: FixedNodeSet[]; forces: PointForce[]; loMin: number; loMax: number } {
  let amin = Infinity, amax = -Infinity;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const v = mesh.nodes[n * 3 + axis]!;
    if (v < amin) amin = v;
    if (v > amax) amax = v;
  }
  const span = amax - amin || 1;
  const tol = span * 1e-3;

  const fixedNodes: number[] = [];
  const loadNodes: number[] = [];
  for (let n = 0; n < mesh.nodeCount; n++) {
    const v = mesh.nodes[n * 3 + axis]!;
    if (v <= amin + tol) fixedNodes.push(n);
    else if (v >= amax - tol) loadNodes.push(n);
  }

  const perNode = loadNodes.length > 0 ? totalForceN / loadNodes.length : 0;
  const dir: [number, number, number] = [0, 0, 0];
  dir[axis] = 1;

  const forces: PointForce[] = loadNodes.map(n => ({
    nodeIndex: n,
    forceN: [dir[0] * perNode, dir[1] * perNode, dir[2] * perNode] as const,
  }));

  return {
    constraints: [{ nodeIndices: fixedNodes }],
    forces,
    loMin: amin,
    loMax: amax,
  };
}

export interface KtResult {
  Kt: number;
  peakVonMisesMPa: number;
  nominalVonMisesMPa: number;
  converged: boolean;
}

/**
 * Compute the stress-concentration factor Kt for a coupon mesh under an axial
 * load case, using the production solver. Kt = peak / nominal (von Mises).
 */
export function solveCouponKt(
  mesh: TetMesh,
  material: AnyMaterial,
  lc: AxialLoadCase,
): KtResult {
  const { constraints, forces, loMin, loMax } =
    buildAxialConstraintsAndForces(mesh, lc.axis, lc.totalForceN);

  const result = runLinearStatic({ mesh, material, constraints, forces });

  const span = loMax - loMin;
  const gaugeLo = loMin + span * lc.gripFraction;
  const gaugeHi = loMax - span * lc.gripFraction;
  const peakVM = regionalPeakVonMises(mesh, result.vonMises, lc.axis, gaugeLo, gaugeHi);

  // Nominal von Mises of the applied load at the carrying section.
  const nominalNormal = lc.totalForceN / lc.nominalAreaMm2;     // σ or τ
  const nominalVM = lc.shear ? Math.sqrt(3) * nominalNormal : nominalNormal;

  const Kt = nominalVM > 1e-9 ? peakVM / nominalVM : 1;
  return {
    Kt,
    peakVonMisesMPa: peakVM,
    nominalVonMisesMPa: nominalVM,
    converged: result.converged,
  };
}

/**
 * Canonical uniform reference: a straight prismatic gauge bar. Used both as a
 * test fixture (Kt must come out ≈ 1) and as the "what a perfectly uniform
 * coupon looks like" baseline. Loaded along Z.
 *
 *   width  → x   (mm)
 *   thick  → y   (mm)
 *   length → z   (mm)
 */
export function buildGaugeBoxMesh(
  widthMm: number,
  thickMm: number,
  lengthMm: number,
  divPerMmInv = 1.5,
): TetMesh {
  const nx = Math.max(2, Math.round(widthMm / divPerMmInv));
  const ny = Math.max(2, Math.round(thickMm / divPerMmInv));
  const nz = Math.max(6, Math.round(lengthMm / divPerMmInv));
  return generateBoxMesh(0, 0, 0, widthMm, thickMm, lengthMm, nx, ny, nz);
}
