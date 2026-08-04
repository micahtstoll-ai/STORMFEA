/**
 * stress.ts
 * ---------
 * Recover element stresses from the displacement solution and compute
 * von Mises stress and safety factor per element.
 *
 * ELEMENT STRESS RECOVERY
 * =======================
 * For a C3D4 element, stress is CONSTANT throughout the element (because B is constant).
 * The element stress is evaluated at the element centroid (which is just the average
 * of the 4 node positions — for constant-strain elements this equals the average stress).
 *
 *   u_e = [ux0, uy0, uz0, ux1, uy1, uz1, ux2, uy2, uz2, ux3, uy3, uz3]
 *   ε   = B · u_e       (6-component Voigt strain vector)
 *   σ   = C · ε         (6-component Voigt stress vector [σxx, σyy, σzz, τxy, τyz, τxz])
 *
 * VON MISES STRESS
 * ================
 * The von Mises equivalent stress for a 3D stress state in Voigt notation:
 *
 *   σ_vm = √(½ · [(σxx−σyy)² + (σyy−σzz)² + (σzz−σxx)² + 6(τxy² + τyz² + τxz²)])
 *
 * This equals the yield criterion: yielding occurs when σ_vm ≥ σ_yield.
 *
 * SAFETY FACTOR
 * =============
 *   SF = σ_yield / σ_vm
 *
 * Clamped to [0, 999] to avoid Infinity for unloaded elements (σ_vm ≈ 0).
 *
 * NODE-AVERAGED STRESS (for display)
 * ===================================
 * C3D4 produces piecewise-constant element stresses. For smooth display,
 * we average element stresses at shared nodes (simple nodal averaging).
 * This is the "direct averaging" method — adequate for a decision-support tool.
 * More accurate methods (SPR, ZZ) would improve accuracy at stress concentrations
 * but require additional solver infrastructure and are a future improvement.
 */

import type { TetMesh, IsotropicMaterial, AnyMaterial, SolverResult, ElementMaterialField, WallBondField } from "./types.js";
import { isOrthotropic } from "./types.js";
import { buildAnyConstitutiveMatrix, computeGeometry, buildB, buildB_c3d10, c3d10ShapeFunctions, C3D10_GAUSS, rotationAligningZTo, rotateStress6ToLocal } from "./element.js";
import { buildNodeElementLists } from "./adjacency.js";

// True when a vector points along +Z (within tolerance), i.e. no rotation needed.
function _isPlusZUnit(a: readonly [number, number, number]): boolean {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return a[2] / n > 1 - 1e-12;
}

// ─── Typed-array helper ────────────────────────────────────────────────────────
function f64(arr: Float64Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`f64: index ${i} out of bounds`);
  return v;
}
function i32(arr: Int32Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`i32: index ${i} out of bounds`);
  return v;
}

// ─── Principal stress eigenvalues (analytic 3×3 symmetric) ───────────────────
/**
 * Compute the three principal stresses (eigenvalues of the symmetric stress tensor)
 * using the trigonometric solution to the depressed cubic characteristic polynomial.
 *
 * Returns [σ1, σ2, σ3] sorted descending (σ1 = max tensile, σ3 = max compressive).
 * σ3 may be negative for compressive stress states.
 *
 * Reference: Smith (1961), Kopp (2008) "Efficient numerical diagonalization of
 * hermitian 3×3 matrices", Int J Mod Phys C 19(3).
 */
export function computePrincipalStresses(
  sxx: number, syy: number, szz: number,
  txy: number, tyz: number, txz: number,
): [number, number, number] {
  // Stress invariants
  const I1 = sxx + syy + szz;
  const I2 = sxx*syy + syy*szz + szz*sxx - txy*txy - tyz*tyz - txz*txz;
  const I3 = sxx*(syy*szz - tyz*tyz)
           - txy*(txy*szz - tyz*txz)
           + txz*(txy*tyz - syy*txz);

  // Depressed cubic substitution: μ³ + q·μ + r = 0, λ = μ + I1/3
  const q = I2 - I1*I1/3;
  const r = -2*I1*I1*I1/27 + I1*I2/3 - I3;

  if (Math.abs(q) < 1e-20) {
    const e = I1/3;
    return [e, e, e];
  }

  // Trigonometric solution (valid since q ≤ 0 for real symmetric matrices)
  const m = 2 * Math.sqrt(-q/3);
  const cosArg = Math.max(-1, Math.min(1, -4*r / (m*m*m)));
  const theta = Math.acos(cosArg) / 3;
  const PI23 = 2*Math.PI/3;
  const shift = I1/3;

  const e0 = m * Math.cos(theta)        + shift;
  const e1 = m * Math.cos(theta - PI23) + shift;
  const e2 = m * Math.cos(theta + PI23) + shift;

  // Sort descending: σ1 ≥ σ2 ≥ σ3
  let s0 = e0, s1 = e1, s2 = e2;
  if (s0 < s1) { const t=s0; s0=s1; s1=t; }
  if (s0 < s2) { const t=s0; s0=s2; s2=t; }
  if (s1 < s2) { const t=s1; s1=s2; s2=t; }
  return [s0, s1, s2];
}

// ─── Hill (1948) anisotropic yield criterion ─────────────────────────────────
/**
 * Hill's 1948 quadratic yield criterion, specialised to the transverse
 * isotropy of an FDM part (isotropic XY layer plane, weak Z through-layer).
 *
 * The general criterion is a single quadratic form in the six stress
 * components:
 *
 *   2·f(σ) = F(σyy−σzz)² + G(σzz−σxx)² + H(σxx−σyy)²
 *            + 2L·τyz² + 2M·τxz² + 2N·τxy²
 *
 * Yielding occurs when f(σ) = 1. We return an equivalent stress σ_eq scaled
 * so that a uniaxial in-plane stress equal to yieldXY gives σ_eq = yieldXY;
 * the safety factor is then yieldXY / σ_eq, directly comparable to the
 * isotropic von Mises SF.
 *
 * COEFFICIENTS FOR TRANSVERSE ISOTROPY
 * ------------------------------------
 * Let Y = yieldXY (in-plane uniaxial yield), Z = yieldZ (through-layer yield).
 * Matching uniaxial yields in x, y, z and the layer-plane / transverse shears:
 *   F = G = 1/(2Z²)
 *   H     = 1/Y² − 1/(2Z²)
 *   N     = 3/(2Y²)        in-plane (layer-plane) shear, governed by Y
 *   L = M = 3/(2Z²)        transverse shear across layers, governed by Z
 *
 * In the isotropic limit Y = Z this collapses exactly to von Mises
 * (F=G=H=1/(2Y²), L=M=N=3/(2Y²)), which the validation suite checks.
 *
 * Reference: Hill R. The Mathematical Theory of Plasticity. OUP 1950, §III.
 */
export function hillEquivalentStress(
  sxx: number, syy: number, szz: number,
  txy: number, tyz: number, txz: number,
  yieldXY: number, yieldZ: number,
): number {
  const Y2 = yieldXY * yieldXY;
  const Z2 = yieldZ  * yieldZ;

  const F = 1 / (2 * Z2);
  const G = 1 / (2 * Z2);
  const H = 1 / Y2 - 1 / (2 * Z2);
  const N = 3 / (2 * Y2);
  const L = 3 / (2 * Z2);
  const M = 3 / (2 * Z2);

  const twoF =
      F * (syy - szz) ** 2
    + G * (szz - sxx) ** 2
    + H * (sxx - syy) ** 2
    + 2 * L * tyz ** 2
    + 2 * M * txz ** 2
    + 2 * N * txy ** 2;

  // At uniaxial σxx = Y: 2f = (G+H)·Y² = 1 ⇒ √(2f) = 1 ⇒ σ_eq = Y.
  return yieldXY * Math.sqrt(Math.max(0, twoF));
}

// ─── FDM dual criterion: bulk (bead) yield + interlayer interface failure ────
/**
 * Which failure criterion the recovery pass evaluates for orthotropic-like
 * materials. "fdm-interface" is the default; "hill-legacy" keeps the Hill
 * (1948) quadratic for comparison and for the upright-no-bed scalar-swap
 * fallback (the interface criterion needs a known weak axis; the swap
 * deliberately has none).
 */
export type CriterionKind = "fdm-interface" | "hill-legacy";

/**
 * Optional in-plane raster (bead-to-bead) anisotropy for the BULK mechanism
 * (feature #6). A cross-bead tension⊕shear bond check added as a SEPARATE
 * minimum on the bulk term — the interlayer interface (delamination) term is
 * untouched, so azimuth invariance about the weak axis is preserved for the
 * criterion this augments. Only supplied when there is real evidence for
 * in-plane anisotropy (a measured cross-bead ratio or a declared unidirectional
 * raster); absent ⇒ the bulk term is exactly isotropic von Mises. All fields
 * are in the MATERIAL (layer) frame: the raster lies in the local XY plane.
 *
 * NOTE (alternating rasters): a single raster direction models a UNIDIRECTIONAL
 * or dominant raster. Typical slicers alternate ±45° per layer, which
 * homogenizes toward isotropic — for those the cross-bead allowable should stay
 * at yieldXY (no anisotropy), which is why this is opt-in and evidence-gated.
 */
export interface InPlaneAniso {
  /** Bead (raster) direction in the layer plane, degrees from the material +X axis. */
  rasterAngleDeg:  number;
  /**
   * Cross-bead in-plane tensile allowable as a FRACTION of the in-plane yield
   * (0 < r ≤ 1). Applied against the local (per-bin) yieldXY, so it stays
   * consistent under the two-region field. r = 1 ⇒ isotropic (no penalty).
   */
  crossBeadRatio:  number;
}

/**
 * Friction coefficient for the Mohr–Coulomb enhancement of interlayer shear
 * capacity under through-layer COMPRESSION. Polymer-on-polymer sliding
 * friction ~0.2–0.4; 0.3 is a LOW-confidence engineering default (locked by
 * fdm-criterion.test.ts, overridable in a future calibration hook).
 */
export const INTERFACE_FRICTION_MU = 0.3;

/**
 * FDM dual failure criterion — safety factor for a stress state expressed in
 * the MATERIAL frame (weak/layer-normal axis = local z). Replaces the Hill
 * (1948) quadratic (layer-model audit A1–A3):
 *
 * 1. BULK (bead) yield — von Mises against the in-plane yield Y:
 *      SF_bulk = Y / σ_vm
 *    Azimuth-invariant by construction (fixes A1: the calibrated Hill form
 *    with N = 3/(2Y²) ≠ F+2H was not rotationally symmetric about the layer
 *    normal — a 45° azimuth rotation of the same in-plane shear state moved
 *    yield from 0.577·Y to ≈0.99·Y at Z = 0.58Y). A norm cannot go negative,
 *    which also fixes A2 (the clamped-negative quadratic form that reported
 *    SF = 999 for in-plane tension–compression states when Z < Y/2).
 *
 * 2. INTERFACE (layer-bond) failure — quadratic interaction of the layer-
 *    plane traction (Brewer & Lagace 1988 / Hashin 1980 interlaminar form),
 *    tension-only normal term (fixes A3):
 *      σzz > 0:  U = √( (σzz/S_zt)² + (τ_z/S_zs)² ),  SF_int = 1/U
 *      σzz ≤ 0:  Mohr–Coulomb friction credit — the compressive normal
 *                carries part of the shear:
 *                SF_int = τ_z > μ·|σzz|  ?  S_zs / (τ_z − μ·|σzz|)  :  999
 *    with τ_z = √(τyz² + τxz²), S_zt = yieldZ (through-layer tension) and
 *    S_zs = yieldZShear (interlaminar shear, default yieldZ/√3 = the exact
 *    transverse-shear yield the legacy Hill coefficients L = M = 3/(2Z²)
 *    encoded — so through-layer results match legacy at the defaults).
 *
 * SF = min(SF_bulk, SF_int). Both mechanisms scale linearly with load, so
 * the SFs are exact closed forms. In the isotropic limit (S_zt = Y,
 * S_zs = Y/√3) the criterion reproduces von Mises for every uniaxial, shear,
 * and normal+transverse-shear state; hydrostatic-tension-dominated states are
 * intentionally interface-governed (a bonded interface separates under
 * triaxial tension; von Mises is blind to it).
 */
export function fdmDualCriterionSF(
  sxx: number, syy: number, szz: number,
  txy: number, tyz: number, txz: number,
  yieldXY: number, yieldZ: number, yieldZShear: number,
  mu: number = INTERFACE_FRICTION_MU,
  aniso: InPlaneAniso | null = null,
  /**
   * Deshpande–Fleck–Ashby pressure-sensitivity α of the BULK term (issue #171).
   * 0 (default) ⇒ the bulk equivalent stress is exactly von Mises and this
   * function is bit-identical to the pre-DFA path — every non-core element and
   * the flag-off path pass 0. Positive (homogenized infill core) ⇒ the foam
   * criterion σ̂² = (σ_vm² + α²σ_m²)/(1 + (α/3)²), which yields hydrostatically.
   * Only the bulk term changes; the interlayer/cross-bead interface checks
   * (delamination) are unchanged.
   */
  dfaAlpha: number = 0,
): number {
  const vm = Math.sqrt(
    0.5 * ((sxx - syy) ** 2 + (syy - szz) ** 2 + (szz - sxx) ** 2)
    + 3 * (txy * txy + tyz * tyz + txz * txz),
  );
  // DFA foam equivalent stress. α = 0 ⇒ sigEq = vm EXACTLY (the branch is
  // skipped, no sqrt(vm²) round-trip), preserving bit-identity for every
  // non-core / flag-off element. The (1 + (α/3)²) normalization keeps the
  // UNIAXIAL yield at yieldXY for any α (σ_vm = σ, σ_m = σ/3 ⇒ σ̂ = σ), so DFA
  // never disturbs the in-plane coupon anchor — it only adds hydrostatic yield.
  let sigEq = vm;
  if (dfaAlpha > 0) {
    const sm = (sxx + syy + szz) / 3;                       // hydrostatic mean stress
    const a2 = dfaAlpha * dfaAlpha;
    sigEq = Math.sqrt((vm * vm + a2 * sm * sm) / (1 + a2 / 9));
  }
  const sfBulk = sigEq > 1e-12 ? yieldXY / sigEq : 999;

  const tau = Math.hypot(tyz, txz);
  let sfInt = 999;
  if (szz > 0) {
    const u = Math.sqrt((szz / yieldZ) ** 2 + (tau / yieldZShear) ** 2);
    if (u > 1e-12) sfInt = 1 / u;
  } else {
    const tEff = tau + mu * szz;   // szz ≤ 0 ⇒ friction reduces the driving shear
    if (tEff > 1e-12) sfInt = yieldZShear / tEff;
  }

  // Optional in-plane raster (bead-to-bead) bond — a tension⊕shear check on the
  // cross-bead plane (normal ⟂ the raster, in the layer plane). Tension-only
  // across the beads (Macaulay), mirroring the interlayer interface but rotated
  // into the layer plane. Only present with real anisotropy evidence; absent ⇒
  // this branch is skipped and the bulk term is exactly isotropic von Mises.
  let sfCross = 999;
  if (aniso) {
    const yCross = aniso.crossBeadRatio * yieldXY;   // cross-bead tensile allowable
    const sCross = yCross / Math.sqrt(3);             // in-plane bead-shear allowable
    const th = aniso.rasterAngleDeg * Math.PI / 180;
    const c = Math.cos(th), s = Math.sin(th);
    const sPerp = s * s * sxx + c * c * syy - 2 * c * s * txy;      // across-bead normal
    const tRp   = -c * s * sxx + c * s * syy + (c * c - s * s) * txy; // in-plane bead-interface shear
    if (sPerp > 0) {
      const u = Math.sqrt((sPerp / yCross) ** 2 + (tRp / sCross) ** 2);
      if (u > 1e-12) sfCross = 1 / u;
    } else {
      // Compression across beads doesn't open the in-plane bond; shear still can.
      const t = Math.abs(tRp);
      if (t > 1e-12) sfCross = sCross / t;
    }
  }
  return Math.min(sfBulk, sfInt, sfCross);
}

/**
 * Interface-utilization split for heatmaps and failure-mode reporting, in the
 * MATERIAL frame. Same physics as fdmDualCriterionSF's interface term:
 *   uTension = ⟨σzz⟩₊ / S_zt              (delamination-onset opening)
 *   uShear   = tension: τ_z / S_zs; compression: ⟨τ_z − μ|σzz|⟩₊ / S_zs
 *   combined = tension: √(uTension² + uShear²); compression: uShear
 * combined = 1 ⇔ SF_int = 1.
 */
export function fdmInterfaceUtilization(
  szz: number, tyz: number, txz: number,
  yieldZ: number, yieldZShear: number,
  mu: number = INTERFACE_FRICTION_MU,
): { uTension: number; uShear: number; combined: number } {
  const tau = Math.hypot(tyz, txz);
  if (szz > 0) {
    const uTension = szz / yieldZ;
    const uShear = tau / yieldZShear;
    return { uTension, uShear, combined: Math.hypot(uTension, uShear) };
  }
  const uShear = Math.max(0, tau + mu * szz) / yieldZShear;
  return { uTension: 0, uShear, combined: uShear };
}

/** Interlaminar shear allowable of a material: explicit, or the yieldZ/√3 legacy-Hill equivalence. */
export function interlaminarShearOf(mat: { yieldZ: number; yieldZShear?: number }): number {
  return mat.yieldZShear ?? mat.yieldZ / Math.sqrt(3);
}

// ─── Per-element stress recovery ─────────────────────────────────────────────

/**
 * Compute von Mises stress at each element.
 *
 * Returns { vonMises, safetyFactor } arrays of length elementCount.
 */
export function recoverElementStress(
  mesh:         TetMesh,
  displacement: Float64Array,
  mat:          AnyMaterial,
  field?:       ElementMaterialField,
  criterion:    CriterionKind = "fdm-interface",
  inPlaneAniso: InPlaneAniso | null = null,
  wallBond?:    WallBondField,
): {
  vonMises:      Float64Array;
  safetyFactor:  Float64Array;
  elemPrincipal: Float64Array;
  maxVonMises:   number;
  minSF:         number;
  /** Index of the argmin-SF element (governing hotspot). */
  governingElement: number;
  /** Cauchy stress tensor per element: [σxx,σyy,σzz,τxy,τyz,τxz] × elementCount. */
  elemStress6:   Float64Array;
} {
  // Two-region material field: per-bin constitutive matrices and yields,
  // selected per element below. Absent = single uniform material (legacy).
  const Cs = field ? field.C : buildAnyConstitutiveMatrix(mat);
  const binCount = Cs.length / 36;
  const Cviews: Float64Array[] = [];
  for (let b = 0; b < binCount; b++) Cviews.push(Cs.subarray(b * 36, b * 36 + 36));
  const binOfElement = field ? field.binOfElement : null;
  const yieldStr = 'kind' in mat ? (mat as import("./types.js").OrthotropicMaterial).yieldXY
                                 : (mat as IsotropicMaterial).yieldStrength;
  // Both criteria are defined in the material frame (weak axis = local Z).
  // For a rotated weak axis (upright/angled prints, issue #101) the global
  // stress must be expressed in that frame first. weakR = null for the common
  // weak-along-Z case, so the hot loop pays nothing there.
  const weakR = (isOrthotropic(mat) && mat.weakAxis && !_isPlusZUnit(mat.weakAxis))
    ? rotationAligningZTo(mat.weakAxis) : null;
  // Uniform-material interlaminar shear allowable (per-bin values override).
  const matZShear = isOrthotropic(mat) ? interlaminarShearOf(mat) : 0;
  // Uniform-material DFA pressure sensitivity (per-bin values override). Only
  // set when the (field-null) material is itself a homogenized core — e.g. the
  // two-region pure-core degenerate, whose averageMaterial carries α. A normal
  // solid/flag-off material has no dfaAlpha ⇒ 0 ⇒ von Mises (bit-identical).
  const matDfaAlpha = isOrthotropic(mat) ? (mat.dfaAlpha ?? 0) : 0;
  const anisoSF = (
    sxx: number, syy: number, szz: number, txy: number, tyz: number, txz: number,
    yieldXY: number, yieldZ: number, yieldZShear: number,
    dfaAlpha: number = 0,
  ): number => {
    let a = sxx, b = syy, c = szz, d = txy, e2 = tyz, f = txz;
    if (weakR) {
      const L = rotateStress6ToLocal([sxx, syy, szz, txy, tyz, txz], weakR);
      a = L[0]; b = L[1]; c = L[2]; d = L[3]; e2 = L[4]; f = L[5];
    }
    if (criterion === "hill-legacy") {
      // hill-legacy has no interface term and no pressure sensitivity; the DFA
      // core criterion is only defined alongside the fdm-interface path.
      const sigHill = hillEquivalentStress(a, b, c, d, e2, f, yieldXY, yieldZ);
      return sigHill > 1e-12 ? yieldXY / sigHill : 999;
    }
    return fdmDualCriterionSF(a, b, c, d, e2, f, yieldXY, yieldZ, yieldZShear, INTERFACE_FRICTION_MU, inPlaneAniso, dfaAlpha);
  };
  const vonMises     = new Float64Array(mesh.elementCount);
  const safetyFactor = new Float64Array(mesh.elementCount);
  const elemPrincipal = new Float64Array(mesh.elementCount * 3);
  const elemStress6   = new Float64Array(mesh.elementCount * 6);

  let maxVM = 0;
  let minSF = 999;

  // 4-point Gauss quadrature points for tetrahedron — shared with element
  // stiffness integration (single source of truth in element.ts).
  const GAUSS_PTS = C3D10_GAUSS;

  let _lastSig: [number, number, number] = [0, 0, 0];

  // Pre-allocate per-element scratch arrays outside the element loop.
  // Each is zeroed before use as needed (noted per array below).
  const _ue30        = new Float64Array(30);  // C3D10: element displacements
  const _nodeCoords  = new Float64Array(30);  // C3D10: element node coordinates
  const _sigAvg      = new Float64Array(6);   // C3D10: accumulated Gauss-point stress (zeroed per element)
  const _eps         = new Float64Array(6);   // strain vector (overwritten each Gauss pt)
  const _ue12        = new Float64Array(12);  // C3D4: element displacements
  const _eps4        = new Float64Array(6);   // C3D4: strain vector
  const _sig4        = new Float64Array(6);   // C3D4: stress vector

  let governingElement = 0;

  for (let e = 0; e < mesh.elementCount; e++) {
    const npe  = mesh.nodesPerElem ?? 4;
    const base = e * npe;

    const bin = binOfElement ? (binOfElement[e] ?? 0) : 0;
    const C   = Cviews[bin]!;
    const eYieldXY = field ? (field.yieldXY[bin] ?? yieldStr) : 0;
    const eYieldZ  = field ? (field.yieldZ[bin]  ?? yieldStr) : 0;
    const eYieldZS = field ? (field.yieldZShear[bin] ?? (eYieldZ / Math.sqrt(3))) : 0;
    // Per-bin DFA pressure sensitivity (issue #171). field.dfaAlpha absent (old
    // or hand-built fields) ⇒ 0 ⇒ von Mises, so those fields stay bit-identical.
    const eDfaAlpha = field ? (field.dfaAlpha ? (field.dfaAlpha[bin] ?? 0) : 0) : matDfaAlpha;

    let vm = 0, sf = 999;

    if (npe === 10) {
      // ── C3D10: proper Gauss-point stress recovery ───────────────────────────
      // Evaluate B at each Gauss point, compute σ = C·B·u_e, average.
      // This is the superconvergent recovery location for quadratic elements.
      // Result is significantly more accurate than the C3D4 corner-node fallback,
      // especially at stress concentrations near holes.

      // Gather all 10 node displacements (30 entries) into pre-allocated scratch
      const ue30 = _ue30;
      for (let ni = 0; ni < 10; ni++) {
        const nodeIdx = i32(mesh.elements, base + ni);
        ue30[ni*3]   = f64(displacement, nodeIdx*3);
        ue30[ni*3+1] = f64(displacement, nodeIdx*3+1);
        ue30[ni*3+2] = f64(displacement, nodeIdx*3+2);
      }

      // Extract 10×3 node coordinates for this element into pre-allocated scratch
      const nodeCoords = _nodeCoords;
      for (let ni = 0; ni < 10; ni++) {
        const nodeIdx = i32(mesh.elements, base + ni);
        nodeCoords[ni*3]   = mesh.nodes[nodeIdx*3]   ?? 0;
        nodeCoords[ni*3+1] = mesh.nodes[nodeIdx*3+1] ?? 0;
        nodeCoords[ni*3+2] = mesh.nodes[nodeIdx*3+2] ?? 0;
      }

      // Average stress over 4 Gauss points (zero sigAvg before accumulating)
      const sigAvg = _sigAvg;
      sigAvg.fill(0);
      let nValidGP = 0;

      for (const gp of GAUSS_PTS) {
        try {
          const { B: B30 } = buildB_c3d10(nodeCoords, gp.xi, gp.eta, gp.zeta);

          // ε = B · u_e  (6×30 × 30 → 6) — reuse scratch eps
          const eps = _eps;
          for (let r = 0; r < 6; r++) {
            let s = 0;
            for (let c = 0; c < 30; c++) s += (B30[r*30+c]??0) * (ue30[c]??0);
            eps[r] = s;
          }

          // σ = C · ε (accumulate into sigAvg)
          for (let r = 0; r < 6; r++) {
            let s = 0;
            for (let c = 0; c < 6; c++) s += (C[r*6+c]??0) * (eps[c]??0);
            sigAvg[r] = (sigAvg[r] ?? 0) + s;
          }
          nValidGP++;
        } catch { /* degenerate Gauss point — skip */ }
      }

      if (nValidGP === 0) {
        // All 4 Gauss points had degenerate Jacobians — the element itself is
        // degenerate (inverted, collapsed, or near-zero volume). This means the
        // mesh is broken; silently reporting vm=0 / sf=999 would hide the problem
        // and potentially inflate the safety factor. Throw so the error surfaces
        // in the UI as a solver failure rather than a misleadingly safe result.
        throw new Error(
          `C3D10 element ${e}: all 4 Gauss points degenerate (zero Jacobian). ` +
          `The mesh may contain inverted or collapsed tetrahedra. ` +
          `Re-export the STL (check for non-manifold edges) and re-run.`
        );
      }
      for (let k = 0; k < 6; k++) sigAvg[k] = (sigAvg[k]??0) / nValidGP;

      const sxx=sigAvg[0]??0, syy=sigAvg[1]??0, szz=sigAvg[2]??0;
      const txy=sigAvg[3]??0, tyz=sigAvg[4]??0, txz=sigAvg[5]??0;

      elemStress6[e*6]   = sxx; elemStress6[e*6+1] = syy; elemStress6[e*6+2] = szz;
      elemStress6[e*6+3] = txy; elemStress6[e*6+4] = tyz; elemStress6[e*6+5] = txz;

      _lastSig = computePrincipalStresses(sxx, syy, szz, txy, tyz, txz);
      vm = Math.sqrt(0.5*((sxx-syy)**2+(syy-szz)**2+(szz-sxx)**2+6*(txy**2+tyz**2+txz**2)));

      if (isOrthotropic(mat)) {
        sf = anisoSF(sxx, syy, szz, txy, tyz, txz,
                     field ? eYieldXY : mat.yieldXY, field ? eYieldZ : mat.yieldZ,
                     field ? eYieldZS : matZShear, eDfaAlpha);
      } else {
        sf = vm > 1e-12 ? (field ? eYieldXY : yieldStr)/vm : 999;
      }

    } else {
      // ── C3D4: existing constant-strain formulation ──────────────────────────
      const n0 = i32(mesh.elements, base);
      const n1 = i32(mesh.elements, base + 1);
      const n2 = i32(mesh.elements, base + 2);
      const n3 = i32(mesh.elements, base + 3);

      const geom = computeGeometry(mesh.nodes, n0, n1, n2, n3);
      const B    = buildB(geom);

      // Use pre-allocated scratch arrays — no per-element heap allocations
      const ue = _ue12;
      const cornerNodes = [n0, n1, n2, n3] as const;
      for (let ni = 0; ni < 4; ni++) {
        const nodeIdx = cornerNodes[ni] ?? 0;
        ue[ni*3]   = f64(displacement, nodeIdx*3);
        ue[ni*3+1] = f64(displacement, nodeIdx*3+1);
        ue[ni*3+2] = f64(displacement, nodeIdx*3+2);
      }

      const eps = _eps4;
      for (let r = 0; r < 6; r++) {
        let s = 0;
        for (let c = 0; c < 12; c++) s += (B[r*12+c]??0) * (ue[c]??0);
        eps[r] = s;
      }

      const sig = _sig4;
      for (let r = 0; r < 6; r++) {
        let s = 0;
        for (let c = 0; c < 6; c++) s += (C[r*6+c]??0) * (eps[c]??0);
        sig[r] = s;
      }

      const sxx=sig[0]??0, syy=sig[1]??0, szz=sig[2]??0;
      const txy=sig[3]??0, tyz=sig[4]??0, txz=sig[5]??0;

      elemStress6[e*6]   = sxx; elemStress6[e*6+1] = syy; elemStress6[e*6+2] = szz;
      elemStress6[e*6+3] = txy; elemStress6[e*6+4] = tyz; elemStress6[e*6+5] = txz;

      _lastSig = computePrincipalStresses(sxx, syy, szz, txy, tyz, txz);
      vm = Math.sqrt(0.5*((sxx-syy)**2+(syy-szz)**2+(szz-sxx)**2+6*(txy**2+tyz**2+txz**2)));

      if (!isFinite(vm)) {
        throw new Error(`Non-finite von Mises at element ${e}: σ=[${sxx},${syy},${szz},${txy},${tyz},${txz}]`);
      }

      if (isOrthotropic(mat)) {
        sf = anisoSF(sxx, syy, szz, txy, tyz, txz,
                     field ? eYieldXY : mat.yieldXY, field ? eYieldZ : mat.yieldZ,
                     field ? eYieldZS : matZShear, eDfaAlpha);
      } else {
        sf = vm > 1e-12 ? (field ? eYieldXY : yieldStr)/vm : 999;
      }
    }

    // Wall-to-wall (bead-to-bead) bond check: a SECOND, independent interface
    // criterion evaluated in the LOCAL per-element wall-normal frame (unlike
    // the global-Z interlayer check above), governing via min() alongside
    // the bulk/interlayer safety factors. No-op when wallBond is absent or
    // this element has no internal loop-to-loop boundary.
    if (wallBond && isOrthotropic(mat)) {
      const interior = wallBond.wallInteriorFrac[e] ?? 0;
      if (interior > 1e-6) {
        const wnx = wallBond.wallNormal[e * 3] ?? 0;
        const wny = wallBond.wallNormal[e * 3 + 1] ?? 0;
        const wnz = wallBond.wallNormal[e * 3 + 2] ?? 0;
        if (Math.hypot(wnx, wny, wnz) > 1e-9) {
          const sxx = elemStress6[e * 6] ?? 0, syy = elemStress6[e * 6 + 1] ?? 0, szz = elemStress6[e * 6 + 2] ?? 0;
          const txy = elemStress6[e * 6 + 3] ?? 0, tyz = elemStress6[e * 6 + 4] ?? 0, txz = elemStress6[e * 6 + 5] ?? 0;
          const wallR = rotationAligningZTo([wnx, wny, wnz]);
          const L = rotateStress6ToLocal([sxx, syy, szz, txy, tyz, txz], wallR);
          const util = fdmInterfaceUtilization(L[2], L[4], L[5], wallBond.yieldWallMPa, wallBond.yieldWallShearMPa);
          // Blend in UTILIZATION space (proportional to driving stress),
          // not SF space: SF is 1/utilization, so blending SF directly
          // toward "unconstrained" washes out a real failure signal for any
          // interior fraction short of 1 (e.g. interior=0.7 would nearly
          // cancel a utilization of 30). Scaling the utilization by the
          // interior weight before inverting keeps the effective SF
          // proportional to how much of the element actually sits at the
          // internal loop boundary.
          const utilEff = interior * util.combined;
          const sfWallEff = utilEff > 1e-12 ? 1 / utilEff : 999;
          sf = Math.min(sf, sfWallEff);
        }
      }
    }

    sf = Math.min(Math.max(sf, 0), 999);
    if (!isFinite(vm)) vm = 0;

    vonMises[e]     = vm;
    safetyFactor[e] = sf;
    if (vm > maxVM) maxVM = vm;
    if (sf < minSF) { minSF = sf; governingElement = e; }

    // Principal stresses — re-read sxx/syy/szz/txy/tyz/txz from the sig/sigAvg
    // arrays computed above. We store them as a closure variable set per-branch.
    const [ps1, ps2, ps3] = _lastSig;
    elemPrincipal[e*3]   = ps1;
    elemPrincipal[e*3+1] = ps2;
    elemPrincipal[e*3+2] = ps3;
  }

  return { vonMises, safetyFactor, elemPrincipal, maxVonMises: maxVM, minSF, governingElement, elemStress6 };
}

// ─── SPR (Superconvergent Patch Recovery) stress smoothing ───────────────────

/**
 * Shared SPR patch geometry: the node-centred, radius-scaled normal matrix.
 * Built ONCE per node and reused across stress components.
 *
 * Why centred and scaled. The recovery fits σ = a0 + a1·x + a2·y + a3·z to the
 * patch's element-centroid stresses. Doing that in RAW GLOBAL coordinates makes
 * the normal-matrix entries scale like the coordinate magnitudes squared
 * (~1e4–1e6 mm² for an ordinary part, far worse for a part modelled away from
 * the origin — the issue #156 offset phenomenon). Two consequences: the fit is
 * needlessly ill-conditioned, and a rank check written as an ABSOLUTE pivot
 * threshold (`|pivot| < 1e-12`) is a test against zero rather than against the
 * matrix's own scale, so it can never fire.
 *
 * Taking coordinates relative to the node and dividing by the patch radius makes
 * the basis O(1), makes the leading normal-matrix entry exactly the patch size,
 * and turns the rank test into a RELATIVE one. It also removes an evaluation
 * error: because the fit is centred ON the node and the polynomial is evaluated
 * AT the node, the recovered value is simply a0 — no cancellation from evaluating
 * a globally-referenced polynomial far from where its coefficients were fitted.
 *
 * This is a pure conditioning improvement: for a well-posed patch it is
 * algebraically the same fit, so SPR's exact reproduction of a linear stress
 * field (locked by solver_validation groups 20 and 31) is preserved.
 */
interface SprPatchFit {
  /** Node-centred, radius-scaled nTerms×nTerms normal matrix (row-major, symmetric). */
  readonly A: Float64Array;
  /** Inverse patch radius; multiply a centred coordinate by this to scale it. */
  readonly invH: number;
  /** Number of polynomial terms this fit was built for (4 linear, 10 quadratic). */
  readonly nTerms: number;
  /**
   * False when the fit must not be used: the patch is degenerate, it has fewer
   * samples than unknowns, or it would amplify data error by more than the
   * basis's SPR_MAX_AMPLIFICATION. The caller falls back — to a lower-order
   * basis where one is available, and to averaging otherwise.
   */
  readonly usable: boolean;
}

// ─── SPR sample sets ─────────────────────────────────────────────────────────

/**
 * The point cloud an SPR patch fit is built from.
 *
 * Two shapes exist, and the difference is the whole point of this change:
 *
 *  • **Centroid sampling** (`perElem = 1`) — one value per element at its
 *    corner-average centroid. This is what C3D4 has (its stress genuinely IS
 *    constant per element) and what C3D10 used to have, because
 *    `recoverElementStress` averaged its four Gauss-point tensors into one.
 *  • **Gauss sampling** (`perElem = 4`) — the four superconvergent points of
 *    each C3D10, at their real isoparametric positions, un-averaged.
 *
 * Samples are stored ELEMENT-MAJOR: element `e` owns sample indices
 * `[e*perElem, (e+1)*perElem)`. A patch is a list of element indices, so its
 * sample indices follow without any extra indirection.
 */
export interface SprSamples {
  /** Samples per element. */
  readonly perElem: number;
  /** Physical coordinates, 3 per sample. */
  readonly xyz: Float64Array;
  /** Cauchy stress (Voigt6) at each sample, 6 per sample. */
  readonly stress6: Float64Array;
  /**
   * |detJ|·w per sample — the quadrature weight `computeZZErrorEstimate`
   * integrates with. Also the validity flag: a degenerate Gauss point leaves
   * this at 0 and is excluded from both the patch fit and the integral.
   */
  readonly volWeight: Float64Array;
}

/**
 * Evaluate σ = C·B·u at all four C3D10 Gauss points of every element and keep
 * them, along with each point's physical position x(ξ) = Σ Nᵢ(ξ)·xᵢ.
 *
 * This is deliberately NOT folded into `recoverElementStress`: that function's
 * `elemStress6` (the four-point average) is what the failure criterion, safety
 * factor and per-element heatmap want, and several locks depend on it. This is
 * the same arithmetic kept at full resolution for the recovery/estimator path.
 *
 * Returns null for C3D4 meshes, whose stress is constant per element — there is
 * nothing to un-average, and the centroid IS the correct single sample point.
 */
export function buildGaussSamples(
  mesh:         TetMesh,
  displacement: Float64Array,
  mat:          AnyMaterial,
  field?:       ElementMaterialField,
): SprSamples | null {
  if ((mesh.nodesPerElem ?? 4) !== 10) return null;

  const nGP = C3D10_GAUSS.length;
  const nEl = mesh.elementCount;
  const xyz       = new Float64Array(nEl * nGP * 3);
  const stress6   = new Float64Array(nEl * nGP * 6);
  const volWeight = new Float64Array(nEl * nGP);

  const Cs = field ? field.C : buildAnyConstitutiveMatrix(mat);
  const binCount = Cs.length / 36;
  const Cviews: Float64Array[] = [];
  for (let b = 0; b < binCount; b++) Cviews.push(Cs.subarray(b * 36, b * 36 + 36));
  const binOf = field ? field.binOfElement : null;

  // Shape functions at the four Gauss points are fixed geometry — hoist them.
  const Ngp = C3D10_GAUSS.map(gp => c3d10ShapeFunctions(gp.xi, gp.eta, gp.zeta));

  const nodeCoords = new Float64Array(30);
  const ue         = new Float64Array(30);
  const eps        = new Float64Array(6);

  for (let e = 0; e < nEl; e++) {
    const base = e * 10;
    const C = Cviews[binOf ? (binOf[e] ?? 0) : 0]!;
    for (let ni = 0; ni < 10; ni++) {
      const n = mesh.elements[base + ni] ?? 0;
      nodeCoords[ni * 3]     = mesh.nodes[n * 3]     ?? 0;
      nodeCoords[ni * 3 + 1] = mesh.nodes[n * 3 + 1] ?? 0;
      nodeCoords[ni * 3 + 2] = mesh.nodes[n * 3 + 2] ?? 0;
      ue[ni * 3]     = displacement[n * 3]     ?? 0;
      ue[ni * 3 + 1] = displacement[n * 3 + 1] ?? 0;
      ue[ni * 3 + 2] = displacement[n * 3 + 2] ?? 0;
    }

    for (let g = 0; g < nGP; g++) {
      const gp = C3D10_GAUSS[g]!;
      let B: Float64Array, detJ: number;
      // Degenerate Gauss point: leave volWeight at 0, which excludes this sample
      // from the patch fit AND from the energy integral. `recoverElementStress`
      // is the place that throws when an element has no usable point at all.
      try { ({ B, detJ } = buildB_c3d10(nodeCoords, gp.xi, gp.eta, gp.zeta)); }
      catch { continue; }

      const s = e * nGP + g;
      volWeight[s] = Math.abs(detJ) * gp.w;

      const N = Ngp[g]!;
      let px = 0, py = 0, pz = 0;
      for (let ni = 0; ni < 10; ni++) {
        const wN = N[ni] ?? 0;
        px += wN * (nodeCoords[ni * 3]     ?? 0);
        py += wN * (nodeCoords[ni * 3 + 1] ?? 0);
        pz += wN * (nodeCoords[ni * 3 + 2] ?? 0);
      }
      xyz[s * 3] = px; xyz[s * 3 + 1] = py; xyz[s * 3 + 2] = pz;

      for (let r = 0; r < 6; r++) { let a = 0; for (let c = 0; c < 30; c++) a += (B[r * 30 + c] ?? 0) * (ue[c] ?? 0); eps[r] = a; }
      for (let r = 0; r < 6; r++) { let a = 0; for (let c = 0; c < 6;  c++) a += (C[r * 6 + c] ?? 0) * (eps[c] ?? 0); stress6[s * 6 + r] = a; }
    }
  }

  return { perElem: nGP, xyz, stress6, volWeight };
}

/**
 * Centroid sample set — one sample per element, at the corner-average centroid,
 * carrying the per-element stress. This is the legacy SPR input, and remains
 * correct for C3D4 (constant strain ⇒ the element stress genuinely is a single
 * value, and the centroid is where it belongs).
 */
export function buildCentroidSamples(mesh: TetMesh, elemStress6: Float64Array): SprSamples {
  const npe = mesh.nodesPerElem ?? 4;
  const nEl = mesh.elementCount;
  const xyz = new Float64Array(nEl * 3);
  for (let e = 0; e < nEl; e++) {
    const base = e * npe;
    let cx = 0, cy = 0, cz = 0;
    // Corner-node average: the first 4 entries for both C3D4 and C3D10 (midside
    // nodes are linear combinations of the corners), strided by npe — issue #96.
    for (let ni = 0; ni < 4; ni++) {
      const n = mesh.elements[base + ni] ?? 0;
      cx += mesh.nodes[n * 3]     ?? 0;
      cy += mesh.nodes[n * 3 + 1] ?? 0;
      cz += mesh.nodes[n * 3 + 2] ?? 0;
    }
    xyz[e * 3] = cx / 4; xyz[e * 3 + 1] = cy / 4; xyz[e * 3 + 2] = cz / 4;
  }
  // volWeight is unused on this path (no integration, no degenerate samples);
  // an all-ones array keeps the validity test uniform with the Gauss path.
  return { perElem: 1, xyz, stress6: elemStress6, volWeight: new Float64Array(nEl).fill(1) };
}

/** Linear recovery basis [1, x, y, z] — the right order for C3D4. */
const SPR_BASIS_LINEAR = 4;
/**
 * Full quadratic recovery basis [1, x, y, z, x², y², z², xy, yz, zx] — the
 * right order for C3D10. SPR's accuracy argument (Zienkiewicz–Zhu 1992 §3)
 * wants the recovery polynomial to match the element's own order; with a linear
 * recovery a quadratic element's within-element stress variation cannot be
 * represented no matter how the samples are placed.
 */
const SPR_BASIS_QUADRATIC = 10;

/**
 * Evaluate the recovery basis at a node-centred, radius-scaled point.
 * The quadratic terms extend the linear ones, so the linear basis is exactly
 * the first 4 entries — which is why a quadratic fit contains the linear space
 * and solver_validation group 20's exactness claim survives the upgrade.
 */
function sprBasis(p: Float64Array, X: number, Y: number, Z: number, nTerms: number): void {
  p[0] = 1; p[1] = X; p[2] = Y; p[3] = Z;
  if (nTerms > SPR_BASIS_LINEAR) {
    p[4] = X * X; p[5] = Y * Y; p[6] = Z * Z;
    p[7] = X * Y; p[8] = Y * Z; p[9] = Z * X;
  }
}

/**
 * Largest noise amplification an SPR patch fit may have, relative to the plain
 * average it would otherwise fall back to, before the fit is rejected.
 *
 * The recovered value at the node is a0 = wᵀs, a fixed linear functional of the
 * patch's element stresses s. Its sensitivity to perturbations in s is ‖w‖, and
 * because the basis is centred on the node, w = (AᵀA)⁻¹Aᵀe₀ gives the identity
 *   ‖w‖² = [(AᵀA)⁻¹]₀₀
 * — one entry of the inverse normal matrix, available from a single solve. The
 * fallback (averaging) has ‖w_avg‖ = 1/√n for a patch of n elements, so
 *   G = √(n · [(AᵀA)⁻¹]₀₀)
 * is the dimensionless factor by which the fit amplifies data error compared with
 * averaging. This is the quantity that actually matters — SPR exists to improve
 * on averaging, so a fit that amplifies error by more than this factor is not
 * worth having — and unlike a pivot threshold it is scale- and
 * position-invariant.
 *
 * G diverges exactly when a patch cannot resolve a direction. The pathological
 * cases are patches whose element centroids are (nearly) coplanar: on a C3D10
 * mesh every MIDSIDE node's patch is the ring of tets sharing ONE EDGE, and some
 * corner patches are flat too — e.g. at the corners of a Kuhn (body-diagonal)
 * subdivision, where all six patch centroids lie on one x+y+z = const plane. The
 * old guard was an ABSOLUTE `|pivot| < 1e-12` test on a normal matrix built in
 * raw global mm coordinates (entries ~1e6), so it was a test against zero rather
 * than against the matrix's own scale and could never fire. Those patches were
 * therefore solved anyway, and the resulting spurious gradient is what drove
 * recovered stresses far above the data.
 *
 * The value is calibrated against measurement, not taste. Over the structured
 * fixtures whose linear-field exactness solver_validation group 20 asserts, the
 * largest G at any checked node is 12.2. Over real unstructured TetGen meshes,
 * corner patches that are genuinely well-posed reach G ≈ 97, while the degenerate
 * ones reach G ≈ 1e8 — a gap of six orders of magnitude. 30 sits above every node
 * the suite requires to stay exact and far below the degenerate population, so it
 * separates them without straddling either.
 */
const SPR_MAX_AMPLIFICATION = 30;

/**
 * The same budget for the 10-term quadratic basis.
 *
 * G is basis-dependent: a higher-order fit necessarily amplifies data noise
 * more than a lower-order one on the same cloud, because it spends more degrees
 * of freedom on the same data. Reusing the linear budget would therefore reject
 * quadratic fits that are perfectly well posed, silently demoting them and
 * giving back the accuracy this change exists to gain.
 *
 * Measured G over Gauss-sampled CORNER patches: median 4.2 with p90 = 9.5 on
 * the structured C3D10 box, median 4.3 with p90 = 5.8 on an unstructured TetGen
 * cylinder, with a thin tail reaching ~170. 60 sits ~6× above the well-posed
 * population and below that tail.
 *
 * It is deliberately NOT a sensitive knob, and the measurement says so: sweeping
 * it from 8 to 1e6 moves the manufactured-solution effectivity index θ only in
 * the third decimal (1.3767 → 1.3487 at worst, on the coarse TetGen cube MMS).
 * The reason is the cascade. A rejected quadratic fit does not fall through to
 * averaging; it retries the LINEAR basis on the same Gauss cloud, and that fit
 * is well posed essentially everywhere — max G of 3.56 (structured) and 2.89
 * (TetGen), with not one non-finite case at any node of either mesh. So the
 * budget chooses between two good options, where its linear sibling chooses
 * between a fit and plain averaging. Do not read the two constants as
 * comparable risks.
 */
const SPR_MAX_AMPLIFICATION_QUADRATIC = 60;

/** Iterate the valid sample indices of `patch`, in element-major order. */
function forEachPatchSample(
  patch:   readonly number[],
  samples: SprSamples,
  visit:   (s: number) => void,
): void {
  const { perElem, volWeight } = samples;
  for (const e of patch) {
    const s0 = e * perElem;
    for (let s = s0; s < s0 + perElem; s++) {
      if (!((volWeight[s] ?? 0) > 0)) continue;
      visit(s);
    }
  }
}

/**
 * Build the centred + scaled normal matrix for one patch. Pure geometry —
 * independent of the stress component being recovered, so the 6-component
 * recovery builds it once and reuses it six times.
 */
function buildSprPatchFit(
  patch:   readonly number[],
  samples: SprSamples,
  nx: number, ny: number, nz: number,
  nTerms:  number,
): SprPatchFit {
  const A = new Float64Array(nTerms * nTerms);
  const xyz = samples.xyz;

  let h = 0, nSamples = 0;
  forEachPatchSample(patch, samples, s => {
    nSamples++;
    h = Math.max(h, Math.hypot((xyz[s * 3] ?? 0) - nx, (xyz[s * 3 + 1] ?? 0) - ny, (xyz[s * 3 + 2] ?? 0) - nz));
  });
  // A degenerate patch (every sample on the node) carries no gradient
  // information at all — average instead of dividing by zero. Fewer samples
  // than unknowns is underdetermined outright.
  if (!(h > 0) || nSamples < nTerms) return { A, invH: 0, nTerms, usable: false };
  const invH = 1 / h;

  const p = new Float64Array(nTerms);
  forEachPatchSample(patch, samples, s => {
    sprBasis(p, ((xyz[s * 3] ?? 0) - nx) * invH, ((xyz[s * 3 + 1] ?? 0) - ny) * invH, ((xyz[s * 3 + 2] ?? 0) - nz) * invH, nTerms);
    for (let i = 0; i < nTerms; i++) for (let j = 0; j < nTerms; j++) A[i * nTerms + j] = (A[i * nTerms + j] ?? 0) + p[i]! * p[j]!;
  });

  // Amplification verdict: solve A·y = e₀ so that y₀ = [(AᵀA)⁻¹]₀₀, then compare
  // G = √(n·y₀) against the basis's budget. Gaussian elimination with partial
  // pivoting on an nTerms×(nTerms+1) scratch copy.
  const W = nTerms + 1;
  const M = new Float64Array(nTerms * W);
  for (let i = 0; i < nTerms; i++) {
    for (let j = 0; j < nTerms; j++) M[i * W + j] = A[i * nTerms + j] ?? 0;
    M[i * W + nTerms] = i === 0 ? 1 : 0;
  }
  if (!gaussEliminate(M, nTerms)) return { A, invH, nTerms, usable: false };
  const y = backSubstitute(M, nTerms);

  // y₀ = [(AᵀA)⁻¹]₀₀ ≥ 1/n for any patch; a non-finite or non-positive value
  // means the solve degenerated, which is itself a rejection.
  const g2 = y[0]!;
  const gMax = nTerms > SPR_BASIS_LINEAR ? SPR_MAX_AMPLIFICATION_QUADRATIC : SPR_MAX_AMPLIFICATION;
  // G = √(nSamples·g2) is the amplification itself; the comparison is squared to
  // avoid the square root. Reinstate G as a returned field if it ever needs
  // measuring again — that is how the two budgets above were calibrated.
  const usable = Number.isFinite(g2) && g2 > 0 && nSamples * g2 <= gMax * gMax;

  return { A, invH, nTerms, usable };
}

/**
 * In-place forward elimination with partial pivoting on an n×(n+1) augmented
 * matrix. Returns false if a column is exactly singular.
 */
function gaussEliminate(M: Float64Array, n: number): boolean {
  const W = n + 1;
  for (let col = 0; col < n; col++) {
    let maxRow = col, maxVal = Math.abs(M[col * W + col] ?? 0);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row * W + col] ?? 0);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }
    if (maxVal === 0) return false;
    if (maxRow !== col) {
      for (let k = col; k <= n; k++) {
        const t = M[col * W + k] ?? 0;
        M[col * W + k] = M[maxRow * W + k] ?? 0;
        M[maxRow * W + k] = t;
      }
    }
    const pivot = M[col * W + col] ?? 0;
    for (let row = col + 1; row < n; row++) {
      const factor = (M[row * W + col] ?? 0) / pivot;
      for (let k = col; k <= n; k++) M[row * W + k] = (M[row * W + k] ?? 0) - factor * (M[col * W + k] ?? 0);
    }
  }
  return true;
}

/** Back-substitution on an already-eliminated n×(n+1) augmented matrix. */
function backSubstitute(M: Float64Array, n: number): Float64Array {
  const W = n + 1;
  const a = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let sum = M[row * W + n] ?? 0;
    for (let col = row + 1; col < n; col++) sum -= (M[row * W + col] ?? 0) * a[col]!;
    a[row] = sum / (M[row * W + row] ?? 1);
  }
  return a;
}

/**
 * Solve one component's centred+scaled patch fit and return its value AT the
 * node. Because the basis is centred on the node, that value is exactly a0, so
 * no polynomial is evaluated away from the patch centre.
 *
 * Rank and conditioning are already screened by buildSprPatchFit; this returns
 * null only if the solve still degenerates, so the caller can fall back to
 * averaging.
 */
function solveSprValueAtNode(
  fit:       SprPatchFit,
  patch:     readonly number[],
  samples:   SprSamples,
  nx: number, ny: number, nz: number,
  valueOf:   (s: number) => number,
  scratch:   Float64Array,   // ≥ nTerms×(nTerms+1) slots
  basis:     Float64Array,   // ≥ nTerms slots
): number | null {
  const nTerms = fit.nTerms;
  const W = nTerms + 1;
  const M = scratch;
  for (let i = 0; i < nTerms; i++) {
    for (let j = 0; j < nTerms; j++) M[i * W + j] = fit.A[i * nTerms + j] ?? 0;
    M[i * W + nTerms] = 0;
  }
  const invH = fit.invH;
  const xyz = samples.xyz;
  forEachPatchSample(patch, samples, s => {
    const sv = valueOf(s);
    sprBasis(basis, ((xyz[s * 3] ?? 0) - nx) * invH, ((xyz[s * 3 + 1] ?? 0) - ny) * invH, ((xyz[s * 3 + 2] ?? 0) - nz) * invH, nTerms);
    for (let i = 0; i < nTerms; i++) M[i * W + nTerms] = (M[i * W + nTerms] ?? 0) + sv * basis[i]!;
  });

  // Rank is screened by buildSprPatchFit; this only catches an exact zero.
  if (!gaussEliminate(M, nTerms)) return null;
  // Back-substitution for a0 — the value at the node (the local origin).
  const v0 = backSubstitute(M, nTerms)[0]!;
  return Number.isFinite(v0) ? v0 : null;
}

/**
 * Mask of C3D10 midside nodes (1 = midside). Null for C3D4 meshes, which have
 * none — callers treat null as "every node is a corner node".
 */
function midsideNodeMask(mesh: TetMesh): Uint8Array | null {
  if ((mesh.nodesPerElem ?? 4) !== 10) return null;
  const mask = new Uint8Array(mesh.nodeCount);
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * 10;
    for (let k = 4; k < 10; k++) mask[mesh.elements[base + k] ?? 0] = 1;
  }
  return mask;
}

/**
 * C3D10 midside nodes: recover by linear interpolation from the two corner nodes
 * of their edge, rather than by fitting their own patch.
 *
 * A midside node's element patch is the ring of tets sharing ONE EDGE — typically
 * 4–5 elements whose centroids are nearly coplanar. Fitting a 3-D linear
 * polynomial to them is genuinely underdetermined along the edge direction, and
 * the near-null direction is what makes the solve explode: a huge fitted gradient
 * multiplied by the small offset between the node and the ring's centroid mean.
 * On a smooth cylinder in bending this produced a recovered σ* of 105 MPa where
 * the true peak stress is 1.27 MPa, driving the reported ZZ global relative error
 * to 80.6% on the FINEST mesh (and the displayed heatmap peak to 18× the real
 * peak stress).
 *
 * Interpolating from the two corners is the standard construction — SPR patches
 * are assembled at vertex nodes, and midside values follow from them — and it is
 * unconditionally well-posed: corner patches are 3-D balls of ~20 elements, so
 * they are well-conditioned. It also preserves SPR's exact reproduction of a
 * linear stress field, since linear interpolation between two exact corner values
 * IS the exact value at the edge midpoint.
 *
 * Applies to every component uniformly (scalar von Mises or the 6 tensor
 * components), and is a no-op for C3D4 meshes, which have no midside nodes.
 *
 * KEPT UNDER GAUSS SAMPLING, and the decision was measured rather than assumed
 * The hope was that four samples per element would spread an edge
 * ring's cloud enough in 3-D to make a direct midside fit well posed. It does
 * not: the amplification G at midside nodes under the QUADRATIC basis has a
 * median of 2.2e8 on the structured C3D10 box and reaches non-finite (outright
 * rank-deficient) at 913 of 1854 midside nodes there, and 946 of 4245 on an
 * unstructured TetGen cylinder. A ring of tets around one edge is simply not a
 * 3-D neighbourhood, however densely each tet is sampled.
 *
 * A LINEAR midside fit on the same cloud IS well posed (max G = 2.45), but it
 * would be a step DOWN: the corner values it would replace now come from a
 * quadratic fit, and interpolating between two quadratic-recovered corners
 * carries that order to the edge midpoint, while a local linear fit would not.
 */
function interpolateMidsideFromCorners(
  mesh:      TetMesh,
  values:    Float64Array,
  stride:    number,   // 1 for scalar von Mises, 6 for the stress tensor
): void {
  if ((mesh.nodesPerElem ?? 4) !== 10) return;
  // [cornerSlotA, cornerSlotB, midSlot] for the 6 edges of a C3D10 tet.
  const EDGES: readonly (readonly [number, number, number])[] = [
    [0, 1, 4], [1, 2, 5], [0, 2, 6], [0, 3, 7], [1, 3, 8], [2, 3, 9],
  ];
  const done = new Uint8Array(mesh.nodeCount);
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * 10;
    for (const [ca, cb, cm] of EDGES) {
      const m = mesh.elements[base + cm] ?? 0;
      if (done[m]) continue;
      done[m] = 1;
      const a = mesh.elements[base + ca] ?? 0;
      const b = mesh.elements[base + cb] ?? 0;
      for (let k = 0; k < stride; k++) {
        values[m * stride + k] = 0.5 * ((values[a * stride + k] ?? 0) + (values[b * stride + k] ?? 0));
      }
    }
  }
}

/**
 * Zienkiewicz-Zhu SPR stress recovery for C3D4 elements.
 *
 * For each node n, collect the patch P(n) = all elements sharing node n.
 * Fit a linear polynomial to the element centroid stresses in the patch:
 *   σ(x,y,z) = a0 + a1·x + a2·y + a3·z
 * using least-squares. Evaluate the fitted polynomial at the node location
 * to get a smoothed nodal stress.
 *
 * This is more accurate than direct averaging for stress concentrations
 * (typically 10-20% improvement for C3D4, Zienkiewicz & Zhu 1992).
 *
 * For patches with < 4 elements (boundary nodes), falls back to direct averaging
 * since the least-squares system is underdetermined.
 *
 * Reference: Zienkiewicz OC, Zhu JZ. The superconvergent patch recovery
 * and a posteriori error estimates. Int J Numer Methods Eng. 1992;33(7).
 */
export function sprSmoothedStress(
  mesh:     TetMesh,
  vonMises: Float64Array,
): Float64Array {
  const nodeStress = new Float64Array(mesh.nodeCount);
  const nodeCount  = new Int32Array(mesh.nodeCount);

  // Build node → element connectivity (shared helper — issue #104).
  // Uses all nodes (corner + midside) — SPR handles small patches via fallback.
  const nodeElements = buildNodeElementLists(mesh);

  // Scalar von Mises recovery stays on CENTROID sampling with the LINEAR basis,
  // for both C3D4 and C3D10. This is the display heatmap's field; von Mises is a
  // nonlinear functional of σ, so Gauss-sampling it is not the same operation as
  // Gauss-sampling the tensor, and it would move every heatmap value under the
  // user. The tensor path (sprSmoothedStress6), which feeds the ZZ estimator,
  // is where Gauss sampling applies.
  const samples = buildCentroidSamples(mesh, vonMises);

  // Pre-allocated augmented scratch — fully overwritten per node/component.
  const _sprM  = new Float64Array(SPR_BASIS_LINEAR * (SPR_BASIS_LINEAR + 1));
  const _basis = new Float64Array(SPR_BASIS_LINEAR);

  // C3D10 midside nodes are skipped here and interpolated from their corners
  // afterwards (see interpolateMidsideFromCorners) — their edge-ring patch
  // cannot support a 3-D linear fit. Empty for C3D4.
  const isMidside = midsideNodeMask(mesh);

  // For each corner node: SPR fit or fallback to averaging
  for (let n = 0; n < mesh.nodeCount; n++) {
    if (isMidside && isMidside[n]) continue;
    const patch = nodeElements[n]!;
    if (patch.length === 0) continue;

    const nx = mesh.nodes[n * 3]     ?? 0;
    const ny = mesh.nodes[n * 3 + 1] ?? 0;
    const nz = mesh.nodes[n * 3 + 2] ?? 0;

    const average = (): void => {
      let sum = 0;
      for (const e of patch) sum += vonMises[e] ?? 0;
      nodeStress[n] = Math.max(0, sum / patch.length);
      nodeCount[n]  = patch.length;
    };

    const fit = buildSprPatchFit(patch, samples, nx, ny, nz, SPR_BASIS_LINEAR);
    if (!fit.usable) { average(); continue; }

    const smoothed = solveSprValueAtNode(
      fit, patch, samples, nx, ny, nz,
      s => vonMises[s] ?? 0, _sprM, _basis);
    if (smoothed === null) { average(); continue; }

    // Clamp to non-negative (stress can't be negative in von Mises sense)
    nodeStress[n] = Math.max(0, smoothed);
    nodeCount[n]  = patch.length;
  }

  interpolateMidsideFromCorners(mesh, nodeStress, 1);

  return nodeStress;
}

/**
 * SPR-smooth all 6 stress tensor components [σxx,σyy,σzz,τxy,τyz,τxz]
 * independently and return nodeStress6: Float64Array(nodeCount * 6).
 *
 * `samples` selects the recovery's fidelity, and is the substance of this change:
 *
 *  • **Omitted** (or a `perElem = 1` set) — legacy centroid recovery with the
 *    linear basis. Correct for C3D4, and the shape every existing caller and
 *    lock uses. Bit-identical to the pre-Gauss-sampling implementation.
 *  • **A C3D10 Gauss set** (`buildGaussSamples`, `perElem = 4`) — fits the full
 *    quadratic basis to the four superconvergent points of every patch element,
 *    at their real isoparametric positions.
 *
 * Why the Gauss set matters is sharper than "more data". A C3D10 patch's
 * centroid cloud is one point per element; at a re-entrant or convex model
 * CORNER a patch can hold as few as 2–3 elements, which is fewer points than a
 * 3-D linear fit has unknowns. Those patches fell back to plain averaging — and
 * averaging over a one-sided patch is biased by O(h·|∇σ|) even when the FE
 * solution is EXACT. That bias, not any within-element averaging, is what put a
 * floor of 1.46%/0.53%/0.26% under the ZZ estimate on a manufactured field a
 * C3D10 mesh reproduces to 1e-13. Four samples per element turn the same
 * 2-element corner patch into an 8-point cloud that genuinely spans 3-D, so the
 * fit is well posed and the floor collapses to round-off.
 *
 * The basis cascades: quadratic → linear → averaging. A patch that cannot
 * support 10 terms is far better served by a linear fit on the same Gauss cloud
 * than by an average, so demotion never skips a rung.
 */
export function sprSmoothedStress6(
  mesh:        TetMesh,
  elemStress6: Float64Array,
  samples?:    SprSamples | null,
): Float64Array {
  const NC = mesh.nodeCount;
  const nodeStress6 = new Float64Array(NC * 6);

  // Build node → element connectivity (all nodes, same as sprSmoothedStress)
  const nodeElements = buildNodeElementLists(mesh);

  const set = samples ?? buildCentroidSamples(mesh, elemStress6);
  // Only a multi-sample set can support the quadratic basis; a centroid set has
  // one point per element and must stay on the linear fit it was calibrated for.
  const topBasis = set.perElem > 1 ? SPR_BASIS_QUADRATIC : SPR_BASIS_LINEAR;
  const sv6 = set.stress6;

  // Pre-allocated augmented scratch — fully overwritten per node/component.
  const _sprM  = new Float64Array(topBasis * (topBasis + 1));
  const _basis = new Float64Array(topBasis);

  // C3D10 midside nodes are interpolated from their corners afterwards; see
  // interpolateMidsideFromCorners. Empty for C3D4.
  const isMidside = midsideNodeMask(mesh);

  for (let n = 0; n < NC; n++) {
    if (isMidside && isMidside[n]) continue;
    const patch = nodeElements[n]!;
    if (patch.length === 0) continue;

    const nx = mesh.nodes[n * 3]     ?? 0;
    const ny = mesh.nodes[n * 3 + 1] ?? 0;
    const nz = mesh.nodes[n * 3 + 2] ?? 0;

    const averageComponent = (c: number): void => {
      let sum = 0, cnt = 0;
      forEachPatchSample(patch, set, s => { sum += sv6[s * 6 + c] ?? 0; cnt++; });
      nodeStress6[n * 6 + c] = cnt > 0 ? sum / cnt : 0;
    };

    // Patch geometry is component-independent: build the centred + scaled normal
    // matrix ONCE, then reuse it for all six components. Cascade down a basis
    // order rather than straight to averaging when the top order is rejected.
    let fit = buildSprPatchFit(patch, set, nx, ny, nz, topBasis);
    if (!fit.usable && topBasis !== SPR_BASIS_LINEAR) {
      fit = buildSprPatchFit(patch, set, nx, ny, nz, SPR_BASIS_LINEAR);
    }
    if (!fit.usable) {
      for (let c = 0; c < 6; c++) averageComponent(c);
      continue;
    }

    for (let c = 0; c < 6; c++) {
      const v = solveSprValueAtNode(
        fit, patch, set, nx, ny, nz,
        s => sv6[s * 6 + c] ?? 0, _sprM, _basis);
      if (v === null) averageComponent(c);
      else nodeStress6[n * 6 + c] = v;
    }
  }

  interpolateMidsideFromCorners(mesh, nodeStress6, 6);

  return nodeStress6;
}

/**
 * Average element von Mises stresses at nodes (direct averaging — fallback).
 * Used when SPR is not appropriate (e.g. very coarse meshes).
 */
export function nodeAveragedStress(
  mesh:      TetMesh,
  vonMises:  Float64Array,
): Float64Array {
  const nodeStress = new Float64Array(mesh.nodeCount);
  const nodeCount  = new Int32Array(mesh.nodeCount);

  const npeAvg = mesh.nodesPerElem ?? 4;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npeAvg;
    const vm   = vonMises[e] ?? 0;
    for (let ni = 0; ni < npeAvg; ni++) {
      const nodeIdx = mesh.elements[base + ni] ?? 0;
      nodeStress[nodeIdx] = (nodeStress[nodeIdx] ?? 0) + vm;
      nodeCount[nodeIdx]  = (nodeCount[nodeIdx]  ?? 0) + 1;
    }
  }

  for (let i = 0; i < mesh.nodeCount; i++) {
    const cnt = nodeCount[i] ?? 0;
    if (cnt > 0) nodeStress[i] = (nodeStress[i] ?? 0) / cnt;
  }

  return nodeStress;
}

// ─── Max displacement ─────────────────────────────────────────────────────────

export function maxDisplacement(displacement: Float64Array): number {
  const n = displacement.length / 3;
  let maxD = 0;
  for (let i = 0; i < n; i++) {
    const ux = displacement[i * 3]     ?? 0;
    const uy = displacement[i * 3 + 1] ?? 0;
    const uz = displacement[i * 3 + 2] ?? 0;
    const d  = Math.sqrt(ux * ux + uy * uy + uz * uz);
    if (d > maxD) maxD = d;
  }
  return maxD;
}

// ─── Node-averaged principal stress ──────────────────────────────────────────

/**
 * Average element principal stresses (σ1, σ2, σ3) at shared nodes.
 * Returns a flat Float64Array of length nodeCount×3: [σ1₀,σ2₀,σ3₀, σ1₁,...].
 */
export function nodeAveragedPrincipalStress(
  mesh:         TetMesh,
  elemPrincipal: Float64Array,
): Float64Array {
  const nodePrincipal = new Float64Array(mesh.nodeCount * 3);
  const nodeCount     = new Int32Array(mesh.nodeCount);
  const npe = mesh.nodesPerElem ?? 4;

  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    const ps1 = elemPrincipal[e*3]   ?? 0;
    const ps2 = elemPrincipal[e*3+1] ?? 0;
    const ps3 = elemPrincipal[e*3+2] ?? 0;
    for (let ni = 0; ni < npe; ni++) {
      const n = mesh.elements[base + ni] ?? 0;
      nodePrincipal[n*3]   = (nodePrincipal[n*3]   ?? 0) + ps1;
      nodePrincipal[n*3+1] = (nodePrincipal[n*3+1] ?? 0) + ps2;
      nodePrincipal[n*3+2] = (nodePrincipal[n*3+2] ?? 0) + ps3;
      nodeCount[n] = (nodeCount[n] ?? 0) + 1;
    }
  }

  for (let n = 0; n < mesh.nodeCount; n++) {
    const cnt = nodeCount[n] ?? 0;
    if (cnt > 0) {
      nodePrincipal[n*3]   = (nodePrincipal[n*3]   ?? 0) / cnt;
      nodePrincipal[n*3+1] = (nodePrincipal[n*3+1] ?? 0) / cnt;
      nodePrincipal[n*3+2] = (nodePrincipal[n*3+2] ?? 0) / cnt;
    }
  }

  return nodePrincipal;
}

// ─── Zienkiewicz-Zhu error estimation ──────────────────────────────────────

/**
 * Invert a 6×6 matrix stored row-major flat (36 entries) via Gauss-Jordan with
 * partial pivoting. Used to obtain the compliance S = C⁻¹ of a constitutive
 * matrix for the energy-norm error estimate. Called once per material bin —
 * never per element (see computeZZErrorEstimate).
 */
export function invert6x6(M: Float64Array): Float64Array {
  const n = 6, w = 2 * n;
  const a = new Float64Array(n * w); // augmented [M | I]
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) a[i * w + j] = M[i * n + j] ?? 0;
    a[i * w + n + i] = 1;
  }
  for (let col = 0; col < n; col++) {
    // Partial pivot on the largest sub-column entry.
    let piv = col, maxv = Math.abs(a[col * w + col] ?? 0);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(a[r * w + col] ?? 0);
      if (v > maxv) { maxv = v; piv = r; }
    }
    if (maxv < 1e-300) throw new Error("invert6x6: singular constitutive matrix");
    if (piv !== col) {
      for (let k = 0; k < w; k++) {
        const t = a[col * w + k]!; a[col * w + k] = a[piv * w + k]!; a[piv * w + k] = t;
      }
    }
    const pv = a[col * w + col]!;
    for (let k = 0; k < w; k++) a[col * w + k] = a[col * w + k]! / pv;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r * w + col]!;
      if (f === 0) continue;
      for (let k = 0; k < w; k++) a[r * w + k] = a[r * w + k]! - f * a[col * w + k]!;
    }
  }
  const inv = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) inv[i * n + j] = a[i * w + n + j]!;
  return inv;
}

/**
 * Energy inner product σᵀ · S · σ for a Voigt-6 stress and a 36-flat compliance
 * S = C⁻¹ (STORMFEA Voigt order [xx,yy,zz,xy,yz,xz], engineering shear). Because
 * the stiffness C uses engineering shear strains, σᵀ C⁻¹ σ equals twice the
 * complementary strain-energy density — the correct energy norm for the ZZ
 * estimator, exact for both isotropic and (rotated) orthotropic materials.
 */
export function stressEnergyDensity(s: ArrayLike<number>, S: Float64Array): number {
  let acc = 0;
  for (let i = 0; i < 6; i++) {
    let row = 0;
    for (let j = 0; j < 6; j++) row += (S[i * 6 + j] ?? 0) * (s[j] ?? 0);
    acc += (s[i] ?? 0) * row;
  }
  return acc;
}

/**
 * Compute per-element Zienkiewicz-Zhu error estimates as a TRUE energy-norm
 * integral (issues #143 / #144 / #145). For each element:
 *
 *   η_e² = Σ_gauss w_g · |detJ_g| · (σ*(x_g) − σ_h(x_g))ᵀ C⁻¹ (σ*(x_g) − σ_h(x_g))
 *
 *   σ*   — the RECOVERED field: the 6-component SPR nodal stress
 *          (sprSmoothedStress6) interpolated to Gauss points with the element's
 *          OWN shape functions (midside nodes included for C3D10, linear
 *          barycentric for C3D4). No distance weights, no dimensional constants.
 *   σ_h  — the ELEMENT field: σ = C·B·u recomputed at each Gauss point (exact
 *          per-point stress for C3D10; constant = elemStress6 for C3D4).
 *   C⁻¹  — per-element compliance: a single 6×6 inverse per material BIN. With
 *          no material field this is the one (rotated) material C; with a
 *          two-region ElementMaterialField it is the per-bin blended C already
 *          used by assembly, selected via binOfElement.
 *
 * Volume weighting (#144) falls out of the Gauss factor w_g·|detJ_g|; the full
 * tensor energy norm (#143) makes soft directions dominate (through-thickness
 * error ranks above an equal-magnitude in-plane one when E_z ≪ E_xy); and the
 * shape-function interpolation (#145) is exact and scale-invariant.
 *
 * The global norm ‖σ‖² uses the same integral of σ_hᵀ C⁻¹ σ_h. Returned
 * errorEstimate[e] = η_e / ‖σ‖_global keeps the previous per-element ranking
 * semantics (a monotone map of η_e), so downstream wiring is unchanged.
 *
 * Reference: Zienkiewicz OC, Zhu JZ. The superconvergent patch recovery
 * and a posteriori error estimates. Int J Numer Methods Eng. 1992;33(7):1331–64.
 */
export function computeZZErrorEstimate(
  mesh:           TetMesh,
  displacement:   Float64Array,
  elemStress6:    Float64Array,   // recovered per-element σ_h (Voigt6) — also SPR6 input
  mat:            AnyMaterial,
  field?:         ElementMaterialField,
): {
  errorEstimate:      Float32Array;
  globalRelativeError: number;
  topErrorElements:   Array<{ x: number; y: number; z: number; errorEstimate: number }>;
} {
  const npe = mesh.nodesPerElem ?? 4;
  const errorEstimate = new Float32Array(mesh.elementCount);

  // ── Per-bin constitutive matrix C_b and its compliance S_b = C_b⁻¹ ──────────
  // One 6×6 inversion per material bin (binCount is 1 for a single material, a
  // handful for a two-region field). Never inverted per element.
  const Cs = field ? field.C : buildAnyConstitutiveMatrix(mat);
  const binCount = Cs.length / 36;
  const Sinv:   Float64Array[] = [];
  for (let b = 0; b < binCount; b++) Sinv.push(invert6x6(Cs.subarray(b * 36, b * 36 + 36)));
  const binOf = field ? field.binOfElement : null;

  // ── Recovered field σ*: 6-component SPR nodal stress ────────────────────────
  // On C3D10 the recovery is fed the four un-averaged Gauss-point tensors per
  // element rather than one centroid value. The same samples then
  // serve as σ_h in the energy loop below, so σ = C·B·u is evaluated ONCE per
  // Gauss point instead of once here and again there.
  const samples = buildGaussSamples(mesh, displacement, mat, field);
  const nodeStress6 = sprSmoothedStress6(mesh, elemStress6, samples);

  // Centroids (corner-node average) for topErrorElements reporting.
  const elemCentX = new Float64Array(mesh.elementCount);
  const elemCentY = new Float64Array(mesh.elementCount);
  const elemCentZ = new Float64Array(mesh.elementCount);

  // Per-element scratch (no per-element heap allocations in the hot loop).
  // B and u are no longer gathered here: on C3D10 σ_h comes from `samples`
  // (built once above) and on C3D4 it is elemStress6, so neither branch
  // re-derives C·B·u.
  const sigH       = new Float64Array(6);
  const sigStar    = new Float64Array(6);
  const dsig       = new Float64Array(6);

  let errorSum2      = 0; // Σ η_e²
  let stressNormSum2 = 0; // Σ ‖σ_e‖²_energy

  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    const bin  = binOf ? (binOf[e] ?? 0) : 0;
    const S    = Sinv[bin]!;

    // Corner-node centroid, for topErrorElements reporting.
    let cx = 0, cy = 0, cz = 0;
    for (let ni = 0; ni < 4; ni++) {
      const n = mesh.elements[base + ni] ?? 0;
      cx += mesh.nodes[n * 3] ?? 0; cy += mesh.nodes[n * 3 + 1] ?? 0; cz += mesh.nodes[n * 3 + 2] ?? 0;
    }
    elemCentX[e] = cx / 4; elemCentY[e] = cy / 4; elemCentZ[e] = cz / 4;

    let eErr2 = 0, eNorm2 = 0;

    if (npe === 10) {
      // ── C3D10: σ_h read back from the Gauss samples built above (same
      // σ = C·B·u, evaluated once); σ* from the 10 quadratic shape functions
      // (midside SPR values included). ────────────────────────────────────────
      const gs = samples!;
      for (let g = 0; g < C3D10_GAUSS.length; g++) {
        const gp = C3D10_GAUSS[g]!;
        const sIdx = e * gs.perElem + g;
        const vol = gs.volWeight[sIdx] ?? 0;
        if (!(vol > 0)) continue; // degenerate Gauss point — skip (mesh handled upstream)
        for (let r = 0; r < 6; r++) sigH[r] = gs.stress6[sIdx * 6 + r] ?? 0;

        const N = c3d10ShapeFunctions(gp.xi, gp.eta, gp.zeta);
        sigStar.fill(0);
        for (let ni = 0; ni < 10; ni++) {
          const n = mesh.elements[base + ni] ?? 0;
          const wN = N[ni] ?? 0;
          for (let k = 0; k < 6; k++) sigStar[k] = (sigStar[k] ?? 0) + wN * (nodeStress6[n * 6 + k] ?? 0);
        }
        for (let k = 0; k < 6; k++) dsig[k] = (sigStar[k] ?? 0) - (sigH[k] ?? 0);
        eErr2  += vol * stressEnergyDensity(dsig, S);
        eNorm2 += vol * stressEnergyDensity(sigH, S);
      }
    } else {
      // ── C3D4: σ_h is constant (= elemStress6); σ* linearly interpolated from
      // the 4 corner nodes. |detJ| = 6V is constant, so the 4-point tet rule
      // integrates the (quadratic) energy integrand exactly. ──────────────────
      for (let k = 0; k < 6; k++) sigH[k] = elemStress6[e * 6 + k] ?? 0;
      const n0 = mesh.elements[base] ?? 0, n1 = mesh.elements[base + 1] ?? 0,
            n2 = mesh.elements[base + 2] ?? 0, n3 = mesh.elements[base + 3] ?? 0;
      let detJ: number;
      try { detJ = 6 * computeGeometry(mesh.nodes, n0, n1, n2, n3).V; }
      catch { errorEstimate[e] = 0; continue; }

      for (const gp of C3D10_GAUSS) {
        const vol = gp.w * detJ;
        const L0 = gp.xi, L1 = gp.eta, L2 = gp.zeta, L3 = 1 - gp.xi - gp.eta - gp.zeta;
        sigStar.fill(0);
        const Ls = [L0, L1, L2, L3];
        for (let ni = 0; ni < 4; ni++) {
          const n  = mesh.elements[base + ni] ?? 0;
          const wN = Ls[ni]!;
          for (let k = 0; k < 6; k++) sigStar[k] = (sigStar[k] ?? 0) + wN * (nodeStress6[n * 6 + k] ?? 0);
        }
        for (let k = 0; k < 6; k++) dsig[k] = (sigStar[k] ?? 0) - (sigH[k] ?? 0);
        eErr2  += vol * stressEnergyDensity(dsig, S);
        eNorm2 += vol * stressEnergyDensity(sigH, S);
      }
    }

    errorSum2      += eErr2;
    stressNormSum2 += eNorm2;
    errorEstimate[e] = Math.sqrt(Math.max(0, eErr2)); // unnormalized η_e; normalized below
  }

  // Global energy norm and relative error.
  const globalNorm = Math.sqrt(Math.max(1e-30, stressNormSum2));
  const globalRelativeError = globalNorm > 0 ? Math.sqrt(Math.max(0, errorSum2)) / globalNorm : 0;

  // Normalize per-element η_e by the global norm (per-element share of ‖σ‖).
  for (let e = 0; e < mesh.elementCount; e++) {
    errorEstimate[e] = globalNorm > 0 ? (errorEstimate[e]! / globalNorm) : 0;
  }

  const indexedErrors = Array.from({ length: mesh.elementCount }, (_, i) => ({
    index: i,
    error: errorEstimate[i] ?? 0,
  }));
  indexedErrors.sort((a, b) => b.error - a.error);

  const topErrorElements = indexedErrors.slice(0, 20).map(({ index }) => ({
    x: elemCentX[index]!,
    y: elemCentY[index]!,
    z: elemCentZ[index]!,
    errorEstimate: errorEstimate[index]!,
  }));

  return { errorEstimate, globalRelativeError, topErrorElements };
}

// ─── Package stress results ───────────────────────────────────────────────────

/**
 * Build the final SolverResult from raw displacement and CG metadata.
 */
export function buildSolverResult(
  mesh:         TetMesh,
  displacement: Float64Array,
  mat:          AnyMaterial,
  cgIterations: number,
  converged:    boolean,
  solverMs:     number,
  residualCheckpoints?: readonly { iteration: number; relativeResidual: number }[],
  computeErrorEstimate: boolean = true,
  field?:       ElementMaterialField,
  criterion:    CriterionKind = "fdm-interface",
  inPlaneAniso: InPlaneAniso | null = null,
  wallBond?:    WallBondField,
  /** Optional CG convergence diagnostics (issue #153) — surfaced on the result. */
  cgMeta?: {
    trueRelativeResidual?:       number;
    recurrenceRelativeResidual?: number;
    conditionEstimate?:          number;
    displacementErrorEstimate?:  number;
  },
): SolverResult {
  const { vonMises, safetyFactor, elemPrincipal, maxVonMises, minSF, governingElement, elemStress6 } =
    recoverElementStress(mesh, displacement, mat, field, criterion, inPlaneAniso, wallBond);

  // Compute Zienkiewicz-Zhu error estimates if requested
  let errorEstimate: Float32Array | undefined;
  let globalRelativeError: number | undefined;
  let topErrorElements: Array<{ x: number; y: number; z: number; errorEstimate: number }> | undefined;

  if (computeErrorEstimate) {
    // True energy-norm ZZ estimator: full tensor σ*, volume-weighted Gauss
    // integral, per-bin C⁻¹ (issues #143/#144/#145). σ* is recovered internally
    // via SPR6 from elemStress6; σ_h is recomputed from `displacement`.
    const { errorEstimate: ee, globalRelativeError: gre, topErrorElements: tee } =
      computeZZErrorEstimate(mesh, displacement, elemStress6, mat, field);
    errorEstimate = ee;
    globalRelativeError = gre;
    topErrorElements = tee;
  }

  return {
    displacement,
    vonMises,
    safetyFactor,
    maxDisplacementMm:   maxDisplacement(displacement),
    maxVonMisesMPa:      maxVonMises,
    minSafetyFactor:     minSF,
    governingElement,
    cgIterations,
    converged,
    solverMs,
    nodePrincipalStress: nodeAveragedPrincipalStress(mesh, elemPrincipal),
    residualCheckpoints,
    trueRelativeResidual:       cgMeta?.trueRelativeResidual,
    recurrenceRelativeResidual: cgMeta?.recurrenceRelativeResidual,
    conditionEstimate:          cgMeta?.conditionEstimate,
    displacementErrorEstimate:  cgMeta?.displacementErrorEstimate,
    errorEstimate,
    globalRelativeError,
    topErrorElements,
    elemStress6,
  };
}

// Re-export buildB so stress.ts is the only external consumer of element internals
export { buildB as buildStrainDisplacementMatrix };
