/**
 * Classical Laminate Theory (CLT) — effective in-plane stiffness for FDM infill.
 *
 * Model: each printed layer is a stack of parallel beads treated as a unidirectional
 * ply.  Each ply is rotated to its deposition angle, the per-ply reduced stiffness
 * Q̄ is accumulated into the extensional A-matrix, and the A-matrix is inverted to
 * recover effective in-plane E*, ν*, G*.  Out-of-plane (Z) properties are kept from
 * the bond-strength model and are NOT changed by CLT.
 *
 * References:
 *   Jones (1999), Mechanics of Composite Materials, 2nd ed., §2 & §4.
 *   Ahn et al. (2002), Anisotropic material properties of fused deposition modeling
 *     ABS plastic, Rapid Prototyping Journal 8(4).
 */

import type { OrthotropicMaterial } from "./types.js";

/** Single-bead (unidirectional) elastic constants.  All in MPa. */
export interface BeadProperties {
  E1:   number;   // longitudinal (along bead axis)
  E2:   number;   // transverse (across bead)
  nu12: number;   // major Poisson's ratio
  G12:  number;   // in-plane shear modulus
}

/**
 * Build the plane-stress reduced stiffness matrix Q for a UD ply in its
 * own (1-2) coordinate frame.
 *
 * Q = [ Q11  Q12   0  ]
 *     [ Q12  Q22   0  ]
 *     [  0    0   Q66 ]
 *
 * Returns as a flat 9-element row-major array.
 */
function buildQMatrix(p: BeadProperties): Float64Array {
  const { E1, E2, nu12, G12 } = p;
  const nu21 = nu12 * E2 / E1;
  const denom = 1 - nu12 * nu21;

  const Q = new Float64Array(9);
  Q[0] = E1  / denom;           // Q11
  Q[1] = nu12 * E2 / denom;    // Q12
  Q[3] = Q[1];                  // Q21 = Q12
  Q[4] = E2  / denom;           // Q22
  Q[8] = G12;                   // Q66
  return Q;
}

/**
 * Rotate the plane-stress Q matrix from ply coordinates (1-2) to laminate
 * coordinates (x-y) by angle θ (degrees, CCW from x-axis).
 *
 * Q̄ = T⁻¹ · Q · Tᵀ   (Reuter's convention)
 *
 * Returns flat 9-element row-major 3×3 array for [σx, σy, τxy].
 */
function rotateQMatrix(Q: Float64Array, thetaDeg: number): Float64Array {
  const th = (thetaDeg * Math.PI) / 180;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const c2 = c * c, s2 = s * s, cs = c * s;
  const c4 = c2*c2, s4 = s2*s2;
  const c2s2 = c2 * s2;

  const Q11 = Q[0]!, Q12 = Q[1]!, Q22 = Q[4]!, Q66 = Q[8]!;

  // Standard CLT transformation (Jones eq. 2.82):
  const Qb = new Float64Array(9);
  Qb[0] = Q11*c4 + 2*(Q12 + 2*Q66)*c2s2 + Q22*s4;
  Qb[1] = (Q11 + Q22 - 4*Q66)*c2s2 + Q12*(c4 + s4);
  Qb[2] = (Q11 - Q12 - 2*Q66)*c2*cs + (Q12 - Q22 + 2*Q66)*s2*cs;
  Qb[3] = Qb[1]!;
  Qb[4] = Q11*s4 + 2*(Q12 + 2*Q66)*c2s2 + Q22*c4;
  Qb[5] = (Q11 - Q12 - 2*Q66)*s2*cs + (Q12 - Q22 + 2*Q66)*c2*cs;
  Qb[6] = Qb[2]!;
  Qb[7] = Qb[5]!;
  Qb[8] = (Q11 + Q22 - 2*Q12 - 2*Q66)*c2s2 + Q66*(c4 + s4);
  return Qb;
}

/**
 * Accumulate A-matrix: A_ij = Σ_k Q̄_ij(k) · t_k
 * where t_k is the fractional thickness of ply k (sum = 1).
 */
function buildAMatrix(
  Q: Float64Array,
  plyAngles: number[],
  plyThicknesses: number[],
): Float64Array {
  const A = new Float64Array(9);
  for (let k = 0; k < plyAngles.length; k++) {
    const Qbar = rotateQMatrix(Q, plyAngles[k]!);
    const t = plyThicknesses[k]!;
    for (let i = 0; i < 9; i++) A[i] = A[i]! + Qbar[i]! * t;
  }
  return A;
}

/**
 * Invert a symmetric 3×3 matrix (flat row-major).
 * Returns null if singular.
 */
function invert3x3(M: Float64Array): Float64Array | null {
  const a = M[0]!, b = M[1]!, c = M[2]!;
  const d = M[4]!, e = M[5]!, f = M[8]!;
  // Symmetric 3×3: M[3]=b, M[6]=c, M[7]=e
  const det = a*(d*f - e*e) - b*(b*f - e*c) + c*(b*e - d*c);
  if (Math.abs(det) < 1e-30) return null;
  const inv = new Float64Array(9);
  const id = 1/det;
  inv[0] = (d*f - e*e)*id;
  inv[1] = (c*e - b*f)*id;
  inv[2] = (b*e - d*c)*id;
  inv[3] = inv[1]!;
  inv[4] = (a*f - c*c)*id;
  inv[5] = (c*b - a*e)*id;
  inv[6] = inv[2]!;
  inv[7] = inv[5]!;
  inv[8] = (a*d - b*b)*id;
  return inv;
}

/**
 * Derive effective in-plane engineering constants from the extensional compliance
 * a = A⁻¹ (per unit total thickness).
 *
 *   E_x*  = 1 / a11
 *   E_y*  = 1 / a22
 *   nu_xy* = -a12 / a11   (in-plane Poisson)
 *   G_xy* = 1 / a66
 *
 * We return the mean of E_x* and E_y* as E_xy for the isotropic-plane
 * approximation used by the existing OrthotropicMaterial model, plus G_xy*.
 */
interface InPlaneProps {
  E_xy: number;
  nu_xy: number;
  G_xy: number;
}

function effectiveInPlaneProps(A: Float64Array): InPlaneProps {
  const a = invert3x3(A);
  if (!a) throw new Error("CLT: A-matrix is singular — check ply angles and thicknesses");

  const E_x  = 1 / a[0]!;
  const E_y  = 1 / a[4]!;
  const nu_xy = -a[1]! / a[0]!;
  const G_xy  = 1 / a[8]!;

  // Average E_x and E_y for the transverse-isotropic approximation
  const E_xy = (E_x + E_y) / 2;

  return { E_xy, nu_xy: Math.max(0.01, Math.min(0.49, nu_xy)), G_xy };
}

/**
 * Build an OrthotropicMaterial using Classical Laminate Theory for in-plane
 * stiffness and the bond-strength model for through-thickness (Z) properties.
 *
 * @param beadProps    Single-bead elastic constants (from coupon calibration or literature)
 * @param plyAngles    Deposition angles in degrees, e.g. [45, -45] for ±45° rectilinear
 * @param plyFractions Fractional thickness of each ply (must sum to 1)
 * @param infillFraction Volumetric infill fraction 0–1 (scales A-matrix by ρ)
 * @param E_z          Through-thickness modulus (MPa) — from bond-strength model
 * @param nu_xz        Out-of-plane Poisson's ratio
 * @param G_xz         Out-of-plane shear modulus (MPa) — from bond-strength model
 * @param yieldXY      In-plane yield strength (MPa)
 * @param yieldZ       Through-thickness yield strength (MPa)
 * @param label        Human-readable label for the material
 */
export function buildLaminateCMatrix(
  beadProps:     BeadProperties,
  plyAngles:     number[],
  plyFractions:  number[],
  infillFraction: number,
  E_z:           number,
  nu_xz:         number,
  G_xz:          number,
  yieldXY:       number,
  yieldZ:        number,
  label:         string,
): OrthotropicMaterial {
  if (plyAngles.length !== plyFractions.length) {
    throw new Error("CLT: plyAngles and plyFractions must have the same length");
  }
  const totalFrac = plyFractions.reduce((s, v) => s + v, 0);
  if (Math.abs(totalFrac - 1) > 1e-6) {
    throw new Error(`CLT: plyFractions must sum to 1, got ${totalFrac}`);
  }

  const rho = Math.max(0.05, Math.min(1.0, infillFraction));

  const Q = buildQMatrix(beadProps);
  const A = buildAMatrix(Q, plyAngles, plyFractions);

  // Scale A-matrix by infill density — a void-rule-of-mixtures approximation
  for (let i = 0; i < 9; i++) A[i] = A[i]! * rho;

  const ip = effectiveInPlaneProps(A);

  return {
    kind:    "orthotropic",
    E_xy:    ip.E_xy,
    E_z,
    nu_xy:   ip.nu_xy,
    nu_xz,
    G_xz,
    G_xy:    ip.G_xy,   // CLT: 1/A66; more accurate than isotropic E_xy/(2(1+ν_xy))
    yieldXY,
    yieldZ,
    label,
  };
}

/**
 * Map FDM infill pattern names to representative ply angle stacks.
 *
 * Each entry is [angles[], fractions[]] where fractions sum to 1.
 * These are first-order approximations:
 *   - rectilinear (grid): alternating 0°/90° in equal shares
 *   - rectilinear ±45°: classic ±45° balanced laminate
 *   - lines: unidirectional 0°
 *   - gyroid/cubic/honeycomb: quasi-isotropic [0/60/-60] approximation
 *   - concentric: 0° only (outermost ring dominates)
 *   - lightning/adaptive: treated as quasi-isotropic
 */
export const PATTERN_PLY_ANGLES: Record<string, { angles: number[]; fracs: number[] }> = {
  grid:        { angles: [0, 90],           fracs: [0.5, 0.5] },
  lines:       { angles: [0],               fracs: [1.0] },
  gyroid:      { angles: [0, 60, -60],      fracs: [1/3, 1/3, 1/3] },
  cubic:       { angles: [0, 60, -60],      fracs: [1/3, 1/3, 1/3] },
  honeycomb:   { angles: [0, 60, -60],      fracs: [1/3, 1/3, 1/3] },
  trihexagon:  { angles: [0, 60, -60],      fracs: [1/3, 1/3, 1/3] },
  concentric:  { angles: [0],               fracs: [1.0] },
  lightning:   { angles: [0, 90],           fracs: [0.5, 0.5] },
  adaptive:    { angles: [0, 60, -60],      fracs: [1/3, 1/3, 1/3] },
};

/**
 * Default single-bead properties derived from Ahn et al. (2002) coupon data,
 * representing a typical FDM thermoplastic bead (PLA-like).
 * E1 is the along-bead modulus at 100% infill, E2 is the transverse modulus.
 */
export const DEFAULT_BEAD_PROPS: Record<string, BeadProperties> = {
  pla:   { E1: 3700, E2: 2200, nu12: 0.36, G12: 1350 },
  petg:  { E1: 2300, E2: 1400, nu12: 0.38, G12:  830 },
  abs:   { E1: 2500, E2: 1500, nu12: 0.35, G12:  920 },
  tpu:   { E1:  250, E2:  150, nu12: 0.48, G12:   85 },
  pa12:  { E1: 1900, E2: 1200, nu12: 0.40, G12:  700 },
  asa:   { E1: 2300, E2: 1400, nu12: 0.35, G12:  850 },
  pa6cf: { E1: 8000, E2: 2500, nu12: 0.30, G12: 1800 },
  petgcf:{ E1: 6500, E2: 2000, nu12: 0.32, G12: 1500 },
};
