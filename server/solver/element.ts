/**
 * element.ts
 * ----------
 * C3D4 linear tetrahedral element stiffness matrix.
 *
 * MATHEMATICAL DERIVATION
 * =======================
 * C3D4: 4-node, 12-DOF, constant-strain tetrahedral element.
 * Shape functions are linear → B matrix is constant → no numerical integration.
 * Element stiffness: k_e = V · Bᵀ · C · B  (single evaluation at centroid).
 *
 * Voigt strain ordering:  [εxx, εyy, εzz, γxy, γyz, γxz]
 * DOF ordering per node:  [ux, uy, uz]
 * Full DOF ordering:      [u0x,u0y,u0z, u1x,u1y,u1z, u2x,u2y,u2z, u3x,u3y,u3z]
 *
 * Shape function derivatives for node i:
 *   ∂Ni/∂x = bi/(6V),  ∂Ni/∂y = ci/(6V),  ∂Ni/∂z = di/(6V)
 *
 * B matrix (6×12), node-i 3-column block:
 *   row 0 (εxx):  [bi,  0,   0 ]
 *   row 1 (εyy):  [0,   ci,  0 ]
 *   row 2 (εzz):  [0,   0,   di]
 *   row 3 (γxy):  [ci,  bi,  0 ]
 *   row 4 (γyz):  [0,   di,  ci]
 *   row 5 (γxz):  [di,  0,   bi]
 * (all scaled by 1/(6V))
 */

import type { IsotropicMaterial, OrthotropicMaterial, GyroidOrthotropic, AnyMaterial } from "./types.js";
import { gibsonAshbyModulus, LATTICE_PARAMS } from "./lattice.js";

// ─── Safe typed-array access ──────────────────────────────────────────────────
function f64(arr: Float64Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`f64[${i}] out of bounds (len=${arr.length})`);
  return v;
}

// ─── Constitutive matrix ──────────────────────────────────────────────────────

/**
 * Build the 6×6 isotropic constitutive matrix C in Voigt notation.
 * Stored as a flat Float64Array (36 entries), row-major.
 *
 * λ = E·ν/((1+ν)(1−2ν)),  μ = E/(2(1+ν))
 * Special case ν=0: λ=0, diagonal normal components = E.
 */
export function buildConstitutiveMatrix(mat: IsotropicMaterial): Float64Array {
  const { E, nu } = mat;
  if (E <= 0)          throw new Error(`E must be > 0, got ${E}`);
  if (nu < 0 || nu >= 0.5) throw new Error(`nu must be in [0,0.5), got ${nu}`);

  const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu));
  const mu  = E / (2 * (1 + nu));
  const l2m = lam + 2 * mu;

  const C = new Float64Array(36);
  C[0]  = l2m; C[1]  = lam; C[2]  = lam;
  C[6]  = lam; C[7]  = l2m; C[8]  = lam;
  C[12] = lam; C[13] = lam; C[14] = l2m;
  C[21] = mu;
  C[28] = mu;
  C[35] = mu;
  return C;
}

/**
 * Build the 6×6 constitutive matrix for a transversely isotropic material.
 *
 * The XY plane is the isotropic plane (layers lie in XY, Z is through-thickness).
 * Voigt ordering: [εxx, εyy, εzz, γxy, γyz, γxz]
 *
 * POISSON-RATIO CONVENTION (issue #102)
 * -------------------------------------
 * Input `nu_xz` follows the STANDARD engineering convention:
 *   ν_ij = −ε_j / ε_i under uniaxial stress along i, so S_ij = −ν_ij / E_i.
 * `nu_xz` is therefore the contraction along Z per unit strain along an
 * in-plane (X) load direction, and its compliance entry is
 *   s13 = −ν_xz / E_xy      (load in the isotropy plane, E_x = E_xy).
 * The reciprocal ratio is derived from symmetry of S (Maxwell relation
 * ν_ij/E_i = ν_ji/E_j):
 *   ν_zx = ν_xz × E_z / E_xy   (so s31 = −ν_zx/E_z = s13).
 * This matches the convention of the cited measurement (Casavola et al. 2016)
 * from which FDM_ORTHO_RATIOS.nu_xz = 0.30 is taken.
 *
 * Compliance matrix S = C⁻¹:
 *   [ 1/E_xy   -nu_xy/E_xy  -nu_xz/E_xy   0        0        0     ]
 *   [-nu_xy/E_xy  1/E_xy    -nu_xz/E_xy   0        0        0     ]
 *   [-nu_xz/E_xy -nu_xz/E_xy  1/E_z       0        0        0     ]
 *   [  0          0           0        1/G_xy    0        0     ]
 *   [  0          0           0          0      1/G_xz    0     ]
 *   [  0          0           0          0        0      1/G_xz]
 *
 * When G_xy is absent: G_xy = E_xy / (2 × (1 + nu_xy))
 *
 * We invert S analytically to get C.
 *
 * Reference: Lekhnitskii (1963), Anisotropic Plates §1.
 *            Reddy (2004), Mechanics of Laminated Composite Plates §2.4.
 */
export function buildOrthotropicConstitutiveMatrix(mat: OrthotropicMaterial): Float64Array {
  const { E_xy, E_z, nu_xy, nu_xz, G_xz } = mat;

  if (E_xy <= 0) throw new Error(`E_xy must be > 0, got ${E_xy}`);
  if (E_z  <= 0) throw new Error(`E_z must be > 0, got ${E_z}`);
  if (G_xz <= 0) throw new Error(`G_xz must be > 0, got ${G_xz}`);

  // Use explicitly set G_xy (e.g. from CLT 1/A66) when available; fall back to isotropic approximation.
  const G_xy = mat.G_xy ?? E_xy / (2 * (1 + nu_xy));
  // Reciprocal (minor) Poisson ratio from compliance symmetry:
  //   ν_zx / E_z = ν_xz / E_xy   →   ν_zx = ν_xz × E_z / E_xy
  const nu_zx = nu_xz * E_z / E_xy;

  // Thermodynamic stability (positive-definite S) for transverse isotropy with
  // the standard convention. The 3×3 normal-block determinant factors as
  //   det(S) = (1+ν_xy) / (E_xy²·E_z) × [ (1−ν_xy) − 2·ν_xz·ν_zx ]
  // Since (1+ν_xy) > 0 for ν_xy ∈ [0, 0.5), positive-definiteness reduces to Δ > 0:
  const delta = (1 - nu_xy) - 2 * nu_xz * nu_zx;
  if (delta <= 0) {
    throw new Error(
      `Orthotropic material is not positive definite (Δ=${delta.toFixed(6)}). ` +
      `Check that E_z, nu_xy, nu_xz satisfy thermodynamic stability conditions.`
    );
  }

  // Derive C directly from the compliance inverse.
  // Compliance block for normal stresses (3×3 submatrix), standard convention:
  //   S = [ 1/E_xy      -nu_xy/E_xy  -nu_xz/E_xy ]
  //       [-nu_xy/E_xy   1/E_xy      -nu_xz/E_xy ]
  //       [-nu_xz/E_xy  -nu_xz/E_xy   1/E_z      ]
  // (row 3 uses s31 = s13 = -nu_xz/E_xy = -nu_zx/E_z by the Maxwell relation)
  //
  // Inverted using cofactor expansion:

  const s11 =  1 / E_xy;
  const s12 = -nu_xy / E_xy;
  const s13 = -nu_xz / E_xy;   // standard convention: = -nu_zx / E_z  by reciprocity
  const s33 =  1 / E_z;

  // Invert the 3×3 normal-stress compliance block directly (transverse isotropy):
  // [a b c]   [s11 s12 s13]
  // [b a c] = [s12 s11 s13]
  // [c c d]   [s13 s13 s33]
  const a=s11, b=s12, c=s13, d=s33;
  const det3 = a*(a*d - c*c) - b*(b*d - c*c) + c*(b*c - a*c);

  if (Math.abs(det3) < 1e-20) throw new Error("Compliance matrix singular — check material constants");

  const inv = 1 / det3;

  // Cofactor matrix (for symmetric S):
  const C11 = inv * (a*d - c*c);
  const C12 = inv * (c*c - b*d);
  const C13 = inv * (b*c - a*c);
  const C33 = inv * (a*a - b*b);

  // Assemble full 6×6 constitutive matrix
  const C = new Float64Array(36);

  // Normal stress block [3×3] top-left:
  //   [C11  C12  C13]
  //   [C12  C11  C13]   (transverse isotropy: C22=C11, C23=C13)
  //   [C13  C13  C33]
  C[ 0] = C11;  C[ 1] = C12;  C[ 2] = C13;
  C[ 6] = C12;  C[ 7] = C11;  C[ 8] = C13;
  C[12] = C13;  C[13] = C13;  C[14] = C33;

  // Shear block [3×3] bottom-right (decoupled from normal block):
  //   [G_xy   0     0  ]
  //   [  0   G_xz   0  ]
  //   [  0     0   G_xz]
  C[21] = G_xy;
  C[28] = G_xz;
  C[35] = G_xz;

  // If a non-Z weak axis is requested, rotate the (weak-along-local-Z) tensor so
  // its weak axis aligns with `weakAxis` in the global frame (Bond transform for
  // upright/angled prints, issue #101). weakAxis ≈ +Z is the identity.
  if (mat.weakAxis && !isPlusZ(mat.weakAxis)) {
    return rotateC6(C, rotationAligningZTo(mat.weakAxis));
  }
  return C;
}

// ─── Tensor rotation utilities (Bond transform for arbitrary weak axis) ────────
//
// STORMFEA Voigt order is [xx, yy, zz, xy, yz, xz]; the map below converts
// between a 6×6 (flat 36) elasticity matrix and its 4th-order tensor C_ijkl.
// For a STIFFNESS matrix with engineering shear strains, the Voigt entries equal
// the tensor components directly (the factor-of-two lives on the compliance
// side), so a plain index expansion + R⊗R⊗R⊗R rotation is exact.

const VOIGT_OF: readonly (readonly number[])[] = [[0,3,5],[3,1,4],[5,4,2]]; // [i][j] → voigt
const IJ_OF: readonly (readonly [number, number])[] = [[0,0],[1,1],[2,2],[0,1],[1,2],[0,2]];

function isPlusZ(a: readonly [number, number, number]): boolean {
  const n = Math.hypot(a[0], a[1], a[2]) || 1;
  return a[2] / n > 1 - 1e-12;
}

/**
 * Row-major 3×3 rotation R (local→global) whose third column is the unit
 * `axis`, i.e. R·ẑ = axis. In-plane rotation about the axis is arbitrary
 * (immaterial for a transversely-isotropic material). Rodrigues from ẑ to axis.
 */
export function rotationAligningZTo(axis: readonly [number, number, number]): Float64Array {
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const ux = axis[0]/n, uy = axis[1]/n, uz = axis[2]/n;
  const R = new Float64Array(9);
  const c = uz;                         // ẑ · u
  if (c > 1 - 1e-12) { R.set([1,0,0, 0,1,0, 0,0,1]); return R; }
  if (c < -1 + 1e-12) { R.set([1,0,0, 0,-1,0, 0,0,-1]); return R; } // 180° about x
  // v = ẑ × u = (−uy, ux, 0); K = [v]_×; R = I + K + K²·(1−c)/|v|²
  const vx = -uy, vy = ux;
  const s2 = vx*vx + vy*vy;             // = sin²θ = 1 − c²
  const k  = (1 - c) / s2;
  const K = [0,0,vy, 0,0,-vx, -vy,vx,0]; // row-major [v]_× (vz=0)
  // K²
  const K2 = new Float64Array(9);
  for (let i=0;i<3;i++) for (let j=0;j<3;j++) {
    let s=0; for (let m=0;m<3;m++) s += K[i*3+m]! * K[m*3+j]!;
    K2[i*3+j] = s;
  }
  for (let i=0;i<9;i++) R[i] = (i%4===0?1:0) + K[i]! + k*K2[i]!;
  return R;
}

/**
 * Rotate a 6×6 stiffness matrix (STORMFEA Voigt order) by the row-major 3×3
 * rotation R (local→global): C_global = R⊗R⊗R⊗R : C_local.
 */
export function rotateC6(C6: Float64Array, R: Float64Array): Float64Array {
  const Ce = new Float64Array(81);
  for (let i=0;i<3;i++) for (let j=0;j<3;j++) for (let k=0;k<3;k++) for (let l=0;l<3;l++)
    Ce[((i*3+j)*3+k)*3+l] = C6[VOIGT_OF[i]![j]! * 6 + VOIGT_OF[k]![l]!]!;
  const Cr = new Float64Array(81);
  for (let i=0;i<3;i++) for (let j=0;j<3;j++) for (let k=0;k<3;k++) for (let l=0;l<3;l++) {
    let s = 0;
    for (let p=0;p<3;p++) for (let q=0;q<3;q++) for (let r=0;r<3;r++) for (let t=0;t<3;t++)
      s += R[i*3+p]! * R[j*3+q]! * R[k*3+r]! * R[l*3+t]! * Ce[((p*3+q)*3+r)*3+t]!;
    Cr[((i*3+j)*3+k)*3+l] = s;
  }
  const out = new Float64Array(36);
  for (let a=0;a<6;a++) for (let b=0;b<6;b++) {
    const [i,j] = IJ_OF[a]!, [k,l] = IJ_OF[b]!;
    out[a*6+b] = Cr[((i*3+j)*3+k)*3+l]!;
  }
  return out;
}

/**
 * Express a global Cauchy stress [σxx,σyy,σzz,τxy,τyz,τxz] in the material's
 * local frame (weak axis → local Z): σ_local = Rᵀ · σ_global · R.
 */
export function rotateStress6ToLocal(
  s6: readonly number[] | Float64Array,
  R:  Float64Array,
): [number, number, number, number, number, number] {
  const S = [s6[0]!,s6[3]!,s6[5]!, s6[3]!,s6[1]!,s6[4]!, s6[5]!,s6[4]!,s6[2]!]; // 3×3 row-major
  // L = Rᵀ S R
  const RtS = new Float64Array(9);
  for (let i=0;i<3;i++) for (let j=0;j<3;j++) {
    let s=0; for (let m=0;m<3;m++) s += R[m*3+i]! * S[m*3+j]!; // Rᵀ[i][m]=R[m][i]
    RtS[i*3+j]=s;
  }
  const L = new Float64Array(9);
  for (let i=0;i<3;i++) for (let j=0;j<3;j++) {
    let s=0; for (let m=0;m<3;m++) s += RtS[i*3+m]! * R[m*3+j]!;
    L[i*3+j]=s;
  }
  return [L[0]!, L[4]!, L[8]!, L[1]!, L[5]!, L[2]!]; // [xx,yy,zz,xy,yz,xz]
}

/**
 * Build the 6×6 constitutive matrix for gyroid infill with density-based scaling.
 *
 * Gyroid lattice properties degrade non-linearly with relative density ρ ∈ [0, 1].
 * Uses power-law model with correction factors for directional anisotropy.
 *
 * Formulas (base material is PLA):
 *   E_xy(ρ) = 3500 × ρ^1.75 × (1 − 0.12(1 − ρ))  [in-plane modulus, MPa]
 *   E_z(ρ)  = 2275 × ρ^2.1  × (1 − 0.18(1 − ρ))  [through-thickness modulus, MPa]
 *   G_xz(ρ) = 1143 × ρ^2.3  × (1 − 0.22(1 − ρ))  [shear modulus, MPa]
 *   G_xy derived from E_xy via: G_xy = E_xy / (2(1 + ν_xy))
 *   ν_xy and ν_xz held constant from input
 *
 * The material is treated as orthotropic after density-scaling.
 *
 * NOTE: The exponents (1.75, 2.1, 2.3) and linear correction factors are NOT traceable
 * to Birosz et al. (2022) or any other cited paper. Birosz (2022) is a qualitative pattern
 * comparison study, not a source of density-modulus power-law coefficients. These values
 * are unverified empirical parameters; treat results with caution until a source is found.
 */
export function buildGyroidConstitutiveMatrix(mat: GyroidOrthotropic): Float64Array {
  const { density, nu_xy, nu_xz, yieldXY, yieldZ, label } = mat;

  if (density < 0 || density > 1.0) {
    throw new Error(`Gyroid density must be in [0, 1.0], got ${density}`);
  }

  // Power-law degradation — generalized Gibson-Ashby form shared with the
  // two-region core homogenization (solver/lattice.ts, tpms3d family); the
  // PLA base moduli (3500/2275/1143) are this material kind's historical
  // hardcoded solids. Exponents and correction factors are engineering
  // estimates (confidence LOW, regression-locked by gyroid-formula.test.ts).
  const rho = density;
  const ga = LATTICE_PARAMS.tpms3d;

  const E_xy = gibsonAshbyModulus(3500, rho, ga.stiffExpXY,  ga.stiffCorrXY);
  const E_z  = gibsonAshbyModulus(2275, rho, ga.stiffExpZ,   ga.stiffCorrZ);
  const G_xz = gibsonAshbyModulus(1143, rho, ga.stiffExpGxz, ga.stiffCorrGxz);

  // Handle edge case: ρ ≈ 0 (very low density → very small stiffness)
  if (rho < 0.01 && (E_xy < 1 || E_z < 1 || G_xz < 1)) {
    console.warn(`Gyroid density ${(rho*100).toFixed(1)}% produces very small stiffness (E_xy=${E_xy.toFixed(2)} MPa)`);
  }

  // Create an orthotropic material with the scaled elastic properties
  const scaledOrthotropic: OrthotropicMaterial = {
    kind: "orthotropic",
    E_xy,
    E_z,
    nu_xy,
    nu_xz,
    G_xz,
    yieldXY,
    yieldZ,
    label: `${label} (ρ=${(density * 100).toFixed(1)}%)`,
  };

  // Use the standard orthotropic builder to assemble the constitutive matrix
  return buildOrthotropicConstitutiveMatrix(scaledOrthotropic);
}

/**
 * Build the correct constitutive matrix for either material type.
 * Routes to isotropic, orthotropic, or gyroid builders based on material kind.
 */
export function buildAnyConstitutiveMatrix(mat: AnyMaterial): Float64Array {
  if ('kind' in mat) {
    if (mat.kind === 'gyroid-orthotropic') {
      return buildGyroidConstitutiveMatrix(mat as GyroidOrthotropic);
    }
    if (mat.kind === 'orthotropic') {
      return buildOrthotropicConstitutiveMatrix(mat as OrthotropicMaterial);
    }
  }
  return buildConstitutiveMatrix(mat as IsotropicMaterial);
}

// ─── Element geometry ─────────────────────────────────────────────────────────

/** Shape-function derivative coefficients and volume for one C3D4 element. */
export interface ElementGeometry {
  /** Element volume (always positive, mm³). */
  readonly V: number;
  /** ∂N/∂x numerators [β0,β1,β2,β3] such that ∂Ni/∂x = βi/(6V). */
  readonly beta:  [number, number, number, number];
  /** ∂N/∂y numerators [γ0,γ1,γ2,γ3]. */
  readonly gamma: [number, number, number, number];
  /** ∂N/∂z numerators [δ0,δ1,δ2,δ3]. */
  readonly delta: [number, number, number, number];
}

/**
 * Compute element geometry (volume + shape-function derivative numerators).
 *
 * Uses Cook et al. (4th ed.) §3.6 cofactor formulas.
 * Signed volume is computed via the scalar triple product of edge vectors.
 * If the result is negative, all coefficients are negated to keep V > 0.
 */
export function computeGeometry(
  nodes: Float64Array,
  n0: number, n1: number, n2: number, n3: number,
): ElementGeometry {
  const x0 = f64(nodes, n0*3),   y0 = f64(nodes, n0*3+1), z0 = f64(nodes, n0*3+2);
  const x1 = f64(nodes, n1*3),   y1 = f64(nodes, n1*3+1), z1 = f64(nodes, n1*3+2);
  const x2 = f64(nodes, n2*3),   y2 = f64(nodes, n2*3+1), z2 = f64(nodes, n2*3+2);
  const x3 = f64(nodes, n3*3),   y3 = f64(nodes, n3*3+1), z3 = f64(nodes, n3*3+2);

  // Scalar triple product of edges from node 0
  const a1=x1-x0, b1=y1-y0, c1=z1-z0;
  const a2=x2-x0, b2=y2-y0, c2=z2-z0;
  const a3=x3-x0, b3=y3-y0, c3=z3-z0;
  const sixV = a1*(b2*c3-b3*c2) - b1*(a2*c3-a3*c2) + c1*(a2*b3-a3*b2);

  if (Math.abs(sixV) < 1e-30)
    throw new Error(`Degenerate element nodes=[${n0},${n1},${n2},${n3}]: 6V=${sixV}`);

  const s = sixV > 0 ? 1 : -1; // orientation sign

  // β coefficients (∂N/∂x numerators) — cofactors of column 1 (x) of the 4×4 coord matrix.
  // Sign pattern: cofactor(i,1) = (-1)^(i+1) × minor, giving signs [-,+,-,+] for i=0,1,2,3.
  // The row-expansion formula produces the correct minor; the leading sign flips per row.
  const β0 = -s * ((y1*(z2-z3)) + (y2*(z3-z1)) + (y3*(z1-z2)));
  const β1 =  s * ((y0*(z2-z3)) + (y2*(z3-z0)) + (y3*(z0-z2)));
  const β2 = -s * ((y0*(z1-z3)) + (y1*(z3-z0)) + (y3*(z0-z1)));
  const β3 =  s * ((y0*(z1-z2)) + (y1*(z2-z0)) + (y2*(z0-z1)));

  // γ coefficients (∂N/∂y numerators) — cofactors of column 2 (y).
  // Sign pattern: cofactor(i,2) = (-1)^(i+2), giving signs [+,-,+,-] for i=0,1,2,3
  // — the OPPOSITE of the β/δ rows (the y column sits between x and z, so its
  // cofactor sign alternation is shifted by one).
  //
  // REGRESSION NOTE (found during #97): these four signs were previously
  // [-,+,-,+] (copy of the β pattern), which negated every ∂N/∂y. Because the
  // same B is used for assembly and recovery, the error conjugates away for
  // loads confined to y-only or xz-only (K_wrong = P·K·P with P flipping uy
  // DOFs, and D·C·D = C for block-diagonal C), which is why pure-axis
  // validation tests passed. Mixed-direction loads and imposed strain fields
  // were wrong, and C3D4 disagreed with the (correct, isoparametric) C3D10
  // path. Hand check, canonical tet (0,0,0),(1,0,0),(0,1,0),(0,0,1):
  // N0 = 1-x-y-z → ∂N0/∂y = -1 = γ0/(6V) with 6V = 1.
  // See tests/unit/b-matrix-sign.test.ts.
  const γ0 =  s * ((x1*(z2-z3)) + (x2*(z3-z1)) + (x3*(z1-z2)));
  const γ1 = -s * ((x0*(z2-z3)) + (x2*(z3-z0)) + (x3*(z0-z2)));
  const γ2 =  s * ((x0*(z1-z3)) + (x1*(z3-z0)) + (x3*(z0-z1)));
  const γ3 = -s * ((x0*(z1-z2)) + (x1*(z2-z0)) + (x2*(z0-z1)));

  // δ coefficients (∂N/∂z numerators) — cofactors of column 3 (z).
  // Sign pattern: cofactor(i,3) = (-1)^(i+3), giving signs [-,+,-,+] for i=0,1,2,3.
  const δ0 = -s * ((x1*(y2-y3)) + (x2*(y3-y1)) + (x3*(y1-y2)));
  const δ1 =  s * ((x0*(y2-y3)) + (x2*(y3-y0)) + (x3*(y0-y2)));
  const δ2 = -s * ((x0*(y1-y3)) + (x1*(y3-y0)) + (x3*(y0-y1)));
  const δ3 =  s * ((x0*(y1-y2)) + (x1*(y2-y0)) + (x2*(y0-y1)));

  return {
    V:     Math.abs(sixV) / 6,
    beta:  [β0, β1, β2, β3],
    gamma: [γ0, γ1, γ2, γ3],
    delta: [δ0, δ1, δ2, δ3],
  };
}

// ─── B matrix ─────────────────────────────────────────────────────────────────

/**
 * Build the 6×12 strain-displacement matrix B (flat Float64Array, row-major).
 * B is CONSTANT for a linear tet element.
 *
 * Column layout: [u0x,u0y,u0z, u1x,u1y,u1z, u2x,u2y,u2z, u3x,u3y,u3z]
 * Row layout:    [εxx, εyy, εzz, γxy, γyz, γxz]
 */
export function buildB(geom: ElementGeometry): Float64Array {
  const inv6V = 1 / (6 * geom.V);
  const [β0,β1,β2,β3] = geom.beta;
  const [γ0,γ1,γ2,γ3] = geom.gamma;
  const [δ0,δ1,δ2,δ3] = geom.delta;

  const B = new Float64Array(72); // 6 rows × 12 cols

  // Row 0: εxx = ∑ βi·uix / (6V)
  B[ 0] = β0*inv6V; B[ 3] = β1*inv6V; B[ 6] = β2*inv6V; B[ 9] = β3*inv6V;
  // Row 1: εyy = ∑ γi·uiy / (6V)
  B[13] = γ0*inv6V; B[16] = γ1*inv6V; B[19] = γ2*inv6V; B[22] = γ3*inv6V;
  // Row 2: εzz = ∑ δi·uiz / (6V)
  B[26] = δ0*inv6V; B[29] = δ1*inv6V; B[32] = δ2*inv6V; B[35] = δ3*inv6V;
  // Row 3: γxy = ∑ (γi·uix + βi·uiy) / (6V)
  B[36] = γ0*inv6V; B[37] = β0*inv6V;
  B[39] = γ1*inv6V; B[40] = β1*inv6V;
  B[42] = γ2*inv6V; B[43] = β2*inv6V;
  B[45] = γ3*inv6V; B[46] = β3*inv6V;
  // Row 4: γyz = ∑ (δi·uiy + γi·uiz) / (6V)
  B[49] = δ0*inv6V; B[50] = γ0*inv6V;
  B[52] = δ1*inv6V; B[53] = γ1*inv6V;
  B[55] = δ2*inv6V; B[56] = γ2*inv6V;
  B[58] = δ3*inv6V; B[59] = γ3*inv6V;
  // Row 5: γxz = ∑ (δi·uix + βi·uiz) / (6V)
  B[60] = δ0*inv6V; B[62] = β0*inv6V;
  B[63] = δ1*inv6V; B[65] = β1*inv6V;
  B[66] = δ2*inv6V; B[68] = β2*inv6V;
  B[69] = δ3*inv6V; B[71] = β3*inv6V;

  return B;
}

// ─── Element stiffness ────────────────────────────────────────────────────────

/**
 * Compute the 12×12 symmetric element stiffness matrix k_e = V · Bᵀ·C·B.
 * Returns a flat Float64Array (144 entries), row-major.
 *
 * Steps:
 *   1. Compute BᵀC (12×6) — avoids forming Bᵀ explicitly
 *   2. Compute k_e = V · (BᵀC) · B (12×12)
 *   3. Symmetrise to eliminate floating-point asymmetry
 */
export function elementStiffness(
  nodes: Float64Array,
  n0: number, n1: number, n2: number, n3: number,
  C: Float64Array,   // 6×6, row-major
): Float64Array {
  const geom = computeGeometry(nodes, n0, n1, n2, n3);
  const B    = buildB(geom);
  const V    = geom.V;

  // BᵀC (12×6): row i = Bᵀ row i = B column i = B[k*12+i] for k in 0..5
  const BtC = new Float64Array(72);
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += (B[k*12+i] ?? 0) * (C[k*6+j] ?? 0);
      BtC[i*6+j] = s;
    }
  }

  // k_e = V · (BᵀC) · B  →  12×12
  const ke = new Float64Array(144);
  for (let i = 0; i < 12; i++) {
    for (let j = 0; j < 12; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += (BtC[i*6+k] ?? 0) * (B[k*12+j] ?? 0);
      ke[i*12+j] = V * s;
    }
  }

  // Symmetrise
  for (let i = 0; i < 12; i++) {
    for (let j = i+1; j < 12; j++) {
      const avg = 0.5 * ((ke[i*12+j] ?? 0) + (ke[j*12+i] ?? 0));
      ke[i*12+j] = avg;
      ke[j*12+i] = avg;
    }
  }

  return ke;
}


// ─── Geometric stiffness matrix (for linear buckling) ────────────────────────

/**
 * Compute the 12×12 element geometric stiffness matrix Kσ_e for a C3D4 element.
 *
 * Kσ_e = V · Gᵀ · S · G
 *
 * where G (9×12) is the displacement-gradient matrix and S (9×9) is the
 * block-diagonal initial-stress matrix (Cauchy stress tensor repeated 3×).
 *
 * For C3D4, ∂Ni/∂x = βi/(6V), so the (i,j) 3×3 block of Kσ_e simplifies to:
 *   scalar_ij = (1/(36V)) · [βi,γi,δi] · σ · [βj,γj,δj]ᵀ
 *   Kσ_e[3i+k, 3j+k] = scalar_ij   for k = 0,1,2
 *
 * Reference: Zienkiewicz & Taylor Vol. 2 §7.3.
 *
 * @param nodes  Flat node coordinate array [x0,y0,z0, ...]
 * @param n0..n3 Node indices for this element
 * @param sig    Cauchy stress [σxx, σyy, σzz, τxy, τyz, τxz] in MPa (Voigt)
 * @returns      12×12 symmetric geometric stiffness (flat, row-major)
 */
export function elementGeometricStiffness(
  nodes: Float64Array,
  n0: number, n1: number, n2: number, n3: number,
  sig: Float64Array,  // length 6: [σxx, σyy, σzz, τxy, τyz, τxz]
): Float64Array {
  const geom = computeGeometry(nodes, n0, n1, n2, n3);
  const V = geom.V;
  const [β0,β1,β2,β3] = geom.beta;
  const [γ0,γ1,γ2,γ3] = geom.gamma;
  const [δ0,δ1,δ2,δ3] = geom.delta;

  const sxx = sig[0]??0, syy = sig[1]??0, szz = sig[2]??0;
  const txy = sig[3]??0, tyz = sig[4]??0, txz = sig[5]??0;

  // ∇Ni vectors (before 1/(6V) factor): [βi, γi, δi]
  const grads = [
    [β0, γ0, δ0],
    [β1, γ1, δ1],
    [β2, γ2, δ2],
    [β3, γ3, δ3],
  ] as const;

  const scale = 1.0 / (36.0 * V);
  const ksg = new Float64Array(144); // 12×12

  for (let i = 0; i < 4; i++) {
    const [bxi, byi, bzi] = grads[i]!;
    // σ · ∇Ni  (stress tensor applied to gradient of node i)
    const sGi_x = sxx*bxi + txy*byi + txz*bzi;
    const sGi_y = txy*bxi + syy*byi + tyz*bzi;
    const sGi_z = txz*bxi + tyz*byi + szz*bzi;

    for (let j = 0; j < 4; j++) {
      const [bxj, byj, bzj] = grads[j]!;
      // scalar = (∇Nj)ᵀ · σ · ∇Ni  (note: scalar_ij = scalar_ji since σ is symmetric)
      const s = scale * (bxj*sGi_x + byj*sGi_y + bzj*sGi_z);
      // Place s on the diagonal of the 3×3 block (i,j): Kσ[3i+k, 3j+k] = s for k=0,1,2
      ksg[(3*i)  *12 + (3*j)]   = (ksg[(3*i)  *12 + (3*j)]   ?? 0) + s;
      ksg[(3*i+1)*12 + (3*j+1)] = (ksg[(3*i+1)*12 + (3*j+1)] ?? 0) + s;
      ksg[(3*i+2)*12 + (3*j+2)] = (ksg[(3*i+2)*12 + (3*j+2)] ?? 0) + s;
    }
  }

  return ksg;
}

// ─── C3D10 Second-order tetrahedral element ───────────────────────────────────
/**
 * 10-node quadratic tetrahedral element (C3D10 in Abaqus notation).
 *
 * Node numbering (barycentric coordinates ξ,η,ζ,δ where ξ+η+ζ+δ=1):
 *   Corner nodes: 0=(1,0,0,0), 1=(0,1,0,0), 2=(0,0,1,0), 3=(0,0,0,1)
 *   Edge midpoints: 4=(½,½,0,0), 5=(0,½,½,0), 6=(½,0,½,0),
 *                   7=(½,0,0,½), 8=(0,½,0,½), 9=(0,0,½,½)
 *
 * Shape functions (quadratic, complete):
 *   N0 = ξ(2ξ-1), N1 = η(2η-1), N2 = ζ(2ζ-1), N3 = δ(2δ-1)
 *   N4 = 4ξη, N5 = 4ηζ, N6 = 4ξζ, N7 = 4ξδ, N8 = 4ηδ, N9 = 4ζδ
 *   where δ = 1 - ξ - η - ζ
 *
 * Advantages over C3D4:
 *   - No shear locking (quadratic displacement field)
 *   - ~3× more accurate at stress concentrations
 *   - Better captures bending behavior
 *
 * Disadvantages:
 *   - 3× more DOF (30 vs 12 per element)
 *   - Requires quadratic mesher (Gmsh can generate C3D10)
 *   - Assembly takes longer
 *
 * Integration: 4-point Gauss quadrature on tetrahedron
 */


/**
 * 4-point Gauss quadrature points and weights for the reference tetrahedron.
 *
 * Closed forms (degree-2 exact rule, Hammer-Marlowe-Stroud):
 *   a = (5 − √5)/20 ≈ 0.138196601...   (three barycentric coords)
 *   b = (5 + 3√5)/20 ≈ 0.585410196...  (the fourth coord)
 *   w = 1/24 per point (Σw = 1/6 = reference tet volume)
 *
 * Exported so stress recovery (stress.ts) uses the identical point set —
 * do not duplicate these constants elsewhere.
 */
const TET4_GP_A = (5 - Math.sqrt(5)) / 20;
const TET4_GP_B = (5 + 3 * Math.sqrt(5)) / 20;
const TET4_GP_W = 1 / 24;

export const C3D10_GAUSS = [
  { xi: TET4_GP_A, eta: TET4_GP_A, zeta: TET4_GP_A, w: TET4_GP_W },
  { xi: TET4_GP_B, eta: TET4_GP_A, zeta: TET4_GP_A, w: TET4_GP_W },
  { xi: TET4_GP_A, eta: TET4_GP_B, zeta: TET4_GP_A, w: TET4_GP_W },
  { xi: TET4_GP_A, eta: TET4_GP_A, zeta: TET4_GP_B, w: TET4_GP_W },
] as const;

/**
 * Evaluate C3D10 shape functions at point (xi, eta, zeta).
 * Returns array of 10 shape function values.
 */
export function c3d10ShapeFunctions(xi: number, eta: number, zeta: number): Float64Array {
  const delta = 1 - xi - eta - zeta;
  const N = new Float64Array(10);
  // Corner nodes (quadratic, = 0 at opposite corner, = 1 at own corner)
  N[0] = xi    * (2*xi    - 1);
  N[1] = eta   * (2*eta   - 1);
  N[2] = zeta  * (2*zeta  - 1);
  N[3] = delta * (2*delta - 1);
  // Edge midpoint nodes
  N[4] = 4 * xi * eta;
  N[5] = 4 * eta * zeta;
  N[6] = 4 * xi * zeta;
  N[7] = 4 * xi * delta;
  N[8] = 4 * eta * delta;
  N[9] = 4 * zeta * delta;
  return N;
}

/**
 * Evaluate C3D10 shape function derivatives dN/dξ, dN/dη, dN/dζ.
 * Returns [dNdxi[10], dNdeta[10], dNdzeta[10]].
 */
export function c3d10ShapeDerivatives(xi: number, eta: number, zeta: number): [Float64Array, Float64Array, Float64Array] {
  const delta = 1 - xi - eta - zeta;
  const dNdxi   = new Float64Array(10);
  const dNdeta  = new Float64Array(10);
  const dNdzeta = new Float64Array(10);

  // Corner nodes — dN/dξ
  dNdxi[0] = 4*xi - 1;     dNdxi[1] = 0;         dNdxi[2] = 0;        dNdxi[3] = -(4*delta-1);
  dNdxi[4] = 4*eta;         dNdxi[5] = 0;          dNdxi[6] = 4*zeta;   dNdxi[7] = 4*(delta-xi);
  dNdxi[8] = -4*eta;        dNdxi[9] = -4*zeta;

  // Corner nodes — dN/dη
  dNdeta[0] = 0;            dNdeta[1] = 4*eta-1;   dNdeta[2] = 0;       dNdeta[3] = -(4*delta-1);
  dNdeta[4] = 4*xi;         dNdeta[5] = 4*zeta;    dNdeta[6] = 0;       dNdeta[7] = -4*xi;
  dNdeta[8] = 4*(delta-eta); dNdeta[9] = -4*zeta;

  // Corner nodes — dN/dζ
  dNdzeta[0] = 0;           dNdzeta[1] = 0;        dNdzeta[2] = 4*zeta-1; dNdzeta[3] = -(4*delta-1);
  dNdzeta[4] = 0;           dNdzeta[5] = 4*eta;    dNdzeta[6] = 4*xi;   dNdzeta[7] = -4*xi;
  dNdzeta[8] = -4*eta;      dNdzeta[9] = 4*(delta-zeta);

  return [dNdxi, dNdeta, dNdzeta];
}

/**
 * Compute the 6×30 B matrix (strain-displacement) for C3D10 at a Gauss point.
 * The B matrix maps the 30 DOF (10 nodes × 3) to 6 strain components.
 *
 * Stored as a Float64Array of length 6×30=180, row-major.
 */
export function buildB_c3d10(
  nodes: Float64Array,  // 10×3 node coordinates for this element
  xi: number, eta: number, zeta: number,
): { B: Float64Array; detJ: number } {
  const [dNdxi, dNdeta, dNdzeta] = c3d10ShapeDerivatives(xi, eta, zeta);

  // Jacobian J = ∂x/∂ξ (3×3 matrix)
  let J00=0,J01=0,J02=0, J10=0,J11=0,J12=0, J20=0,J21=0,J22=0;
  for (let i=0; i<10; i++) {
    const x=nodes[i*3]??0, y=nodes[i*3+1]??0, z=nodes[i*3+2]??0;
    J00+=dNdxi[i]!*x;   J01+=dNdxi[i]!*y;   J02+=dNdxi[i]!*z;
    J10+=dNdeta[i]!*x;  J11+=dNdeta[i]!*y;  J12+=dNdeta[i]!*z;
    J20+=dNdzeta[i]!*x; J21+=dNdzeta[i]!*y; J22+=dNdzeta[i]!*z;
  }

  const detJ = J00*(J11*J22-J12*J21) - J01*(J10*J22-J12*J20) + J02*(J10*J21-J11*J20);
  if (Math.abs(detJ) < 1e-15) throw new Error(`C3D10: degenerate Jacobian det=${detJ}`);

  // Inverse Jacobian
  const invDetJ = 1/detJ;
  const Jinv = [
    (J11*J22-J12*J21)*invDetJ, -(J01*J22-J02*J21)*invDetJ, (J01*J12-J02*J11)*invDetJ,
   -(J10*J22-J12*J20)*invDetJ,  (J00*J22-J02*J20)*invDetJ, -(J00*J12-J02*J10)*invDetJ,
    (J10*J21-J11*J20)*invDetJ, -(J00*J21-J01*J20)*invDetJ,  (J00*J11-J01*J10)*invDetJ,
  ];

  const B = new Float64Array(6 * 30);
  for (let i=0; i<10; i++) {
    // dN/dx = Jinv·[dN/dξ, dN/dη, dN/dζ]ᵀ
    const dNdx = (Jinv[0]??0)*(dNdxi[i]??0) + (Jinv[1]??0)*(dNdeta[i]??0) + (Jinv[2]??0)*(dNdzeta[i]??0);
    const dNdy = (Jinv[3]??0)*(dNdxi[i]??0) + (Jinv[4]??0)*(dNdeta[i]??0) + (Jinv[5]??0)*(dNdzeta[i]??0);
    const dNdz = (Jinv[6]??0)*(dNdxi[i]??0) + (Jinv[7]??0)*(dNdeta[i]??0) + (Jinv[8]??0)*(dNdzeta[i]??0);

    const col = i*3; // First DOF column for node i
    // ε_xx = dNdx * u_x
    B[0*30 + col]   = dNdx;
    // ε_yy = dNdy * u_y
    B[1*30 + col+1] = dNdy;
    // ε_zz = dNdz * u_z
    B[2*30 + col+2] = dNdz;
    // γ_xy = dNdy * u_x + dNdx * u_y
    B[3*30 + col]   = dNdy;
    B[3*30 + col+1] = dNdx;
    // γ_yz = dNdz * u_y + dNdy * u_z
    B[4*30 + col+1] = dNdz;
    B[4*30 + col+2] = dNdy;
    // γ_xz = dNdz * u_x + dNdx * u_z
    B[5*30 + col]   = dNdz;
    B[5*30 + col+2] = dNdx;
  }

  return { B, detJ };
}

/**
 * Compute the 30×30 element stiffness matrix for C3D10.
 * Uses 4-point Gauss quadrature.
 *
 * Ke = ∫ Bᵀ C B dV ≈ Σ_g (Bᵀ C B × detJ × w_g)
 */
export function c3d10ElementStiffness(
  nodes: Float64Array,  // 10×3 node coordinates
  C:     Float64Array,  // 6×6 constitutive matrix
): Float64Array {
  const Ke = new Float64Array(30*30);
  const CB = new Float64Array(6 * 30);

  for (const gp of C3D10_GAUSS) {
    const { B, detJ } = buildB_c3d10(nodes, gp.xi, gp.eta, gp.zeta);
    const vol = Math.abs(detJ) * gp.w;

    // Ke += Bᵀ C B × vol
    CB.fill(0);
    for (let row=0; row<6; row++) {
      for (let col=0; col<30; col++) {
        let sum = 0;
        for (let k=0; k<6; k++) sum += (C[row*6+k]??0) * (B[k*30+col]??0);
        CB[row*30+col] = sum;
      }
    }
    // Ke += Bᵀ × CB × vol
    for (let i=0; i<30; i++) {
      for (let j=0; j<30; j++) {
        let sum = 0;
        for (let k=0; k<6; k++) sum += (B[k*30+i]??0) * (CB[k*30+j]??0);
        (Ke as Float64Array)[i*30+j] = (Ke[i*30+j]??0) + sum * vol;
      }
    }
  }

  return Ke;
}

/**
 * Compute the 30×30 element geometric (stress) stiffness matrix Kσ for C3D10,
 * used in linear buckling. This is the quadratic-tet analogue of
 * elementGeometricStiffness (C3D4).
 *
 * Kσ = ∫ Gᵀ S G dV, which for the displacement-gradient formulation reduces to a
 * block-diagonal matrix whose (i,j) 3×3 block is g_ij·I₃ with the scalar
 *   g_ij = ∫ (∇Nᵢ)ᵀ · σ · (∇Nⱼ) dV
 * (σ the 3×3 Cauchy stress tensor). Integrated with the same 4-point Gauss rule
 * as the stiffness. The per-node physical gradients ∇Nᵢ = [dNᵢ/dx, dNᵢ/dy,
 * dNᵢ/dz] are read from the B matrix already assembled by buildB_c3d10, so the
 * (tested) Jacobian inversion is reused rather than duplicated.
 *
 * @param nodes 10×3 node coordinates for this element
 * @param sig   Element Cauchy stress [σxx, σyy, σzz, τxy, τyz, τxz] in MPa
 */
export function c3d10ElementGeometricStiffness(
  nodes: Float64Array,
  sig:   Float64Array,
): Float64Array {
  const sxx = sig[0]??0, syy = sig[1]??0, szz = sig[2]??0;
  const txy = sig[3]??0, tyz = sig[4]??0, txz = sig[5]??0;

  const ksg  = new Float64Array(30 * 30);
  const grad = new Float64Array(10 * 3);  // per-node [dN/dx, dN/dy, dN/dz]

  for (const gp of C3D10_GAUSS) {
    const { B, detJ } = buildB_c3d10(nodes, gp.xi, gp.eta, gp.zeta);
    const vol = Math.abs(detJ) * gp.w;

    // Physical shape-function gradients live on the diagonal entries of B.
    for (let i = 0; i < 10; i++) {
      grad[i*3]   = B[0*30 + i*3]   ?? 0;   // dNᵢ/dx (ε_xx row)
      grad[i*3+1] = B[1*30 + i*3+1] ?? 0;   // dNᵢ/dy (ε_yy row)
      grad[i*3+2] = B[2*30 + i*3+2] ?? 0;   // dNᵢ/dz (ε_zz row)
    }

    for (let i = 0; i < 10; i++) {
      const bxi = grad[i*3]!, byi = grad[i*3+1]!, bzi = grad[i*3+2]!;
      // σ · ∇Nᵢ
      const sGi_x = sxx*bxi + txy*byi + txz*bzi;
      const sGi_y = txy*bxi + syy*byi + tyz*bzi;
      const sGi_z = txz*bxi + tyz*byi + szz*bzi;
      for (let j = 0; j < 10; j++) {
        const bxj = grad[j*3]!, byj = grad[j*3+1]!, bzj = grad[j*3+2]!;
        const s = vol * (bxj*sGi_x + byj*sGi_y + bzj*sGi_z);
        // Diagonal of the (i,j) 3×3 block.
        ksg[(3*i)  *30 + (3*j)]   = (ksg[(3*i)  *30 + (3*j)]   ?? 0) + s;
        ksg[(3*i+1)*30 + (3*j+1)] = (ksg[(3*i+1)*30 + (3*j+1)] ?? 0) + s;
        ksg[(3*i+2)*30 + (3*j+2)] = (ksg[(3*i+2)*30 + (3*j+2)] ?? 0) + s;
      }
    }
  }

  return ksg;
}
