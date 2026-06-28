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
 * Compliance matrix S = C⁻¹:
 *   [ 1/E_xy   -nu_xy/E_xy  -nu_xz/E_z   0        0        0     ]
 *   [-nu_xy/E_xy  1/E_xy    -nu_xz/E_z   0        0        0     ]
 *   [-nu_zx/E_xy -nu_zx/E_xy  1/E_z      0        0        0     ]
 *   [  0          0           0        1/G_xy    0        0     ]
 *   [  0          0           0          0      1/G_xz    0     ]
 *   [  0          0           0          0        0      1/G_xz]
 *
 * Where nu_zx = nu_xz × E_xy / E_z  (Maxwell reciprocal relation)
 * And   G_xy  = E_xy / (2 × (1 + nu_xy))
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

  // Derived quantities
  const G_xy  = E_xy / (2 * (1 + nu_xy));   // in-plane shear modulus
  const nu_zx = nu_xz * E_xy / E_z;          // reciprocal Poisson (Maxwell relation)

  // Check stability: denominator Δ must be > 0
  // For transverse isotropy: Δ = (1 - nu_xy²) × (1 - 2×nu_xz×nu_zx) - 2×nu_xz×nu_zx×(1 + nu_xy)
  // Simplified: Δ = 1 - nu_xy² - 2×nu_xz²×(E_xy/E_z) - 2×nu_xy×nu_xz²×(E_xy/E_z)
  const delta = (1 - nu_xy*nu_xy) - (2 * nu_xz * nu_zx) - (2 * nu_xy * nu_xz * nu_zx);
  if (delta <= 0) {
    throw new Error(
      `Orthotropic material is not positive definite (Δ=${delta.toFixed(6)}). ` +
      `Check that E_z, nu_xy, nu_xz satisfy thermodynamic stability conditions.`
    );
  }

  // Stiffness matrix entries (from inversion of compliance, Reddy §2.4):
  //
  // C11 = C22 = E_xy × (1 - nu_xz × nu_zx) / (Δ × E_z)
  // C33       = E_z  × (1 - nu_xy²)         / (Δ × E_xy) × E_xy  [simplifies]
  // C12       = E_xy × (nu_xy + nu_xz × nu_zx) / (Δ × E_z)
  // C13 = C23 = E_z  × (nu_xz + nu_xy × nu_xz) / Δ × (E_xy/E_z) [simplifies]
  //
  // Let's derive directly from the compliance inverse for clarity.
  // Compliance block for normal stresses (3×3 submatrix):
  //   S = [ 1/E_xy      -nu_xy/E_xy  -nu_zx/E_xy ]
  //       [-nu_xy/E_xy   1/E_xy      -nu_zx/E_xy ]
  //       [-nu_xz/E_z   -nu_xz/E_z    1/E_z      ]
  //
  // Inverted using cofactor expansion:

  const s11 =  1 / E_xy;
  const s12 = -nu_xy / E_xy;
  const s13 = -nu_zx / E_xy;   // = -nu_xz / E_z  by reciprocal
  const s33 =  1 / E_z;

  // Cofactors of the 3×3 compliance block:
  const A11 = s33 * s11 - s13 * s13;           // cofactor (1,1) for S symmetric
  const A22 = s33 * s11 - s13 * s13;           // = A11 (transverse isotropy)
  const A33 = s11 * s11 - s12 * s12;           // cofactor (3,3)
  const A12 = s12 * s33 - s13 * s13;           // no wait — correct formula below
  // Using full 3×3 inverse:
  // det = s11²×s33 + 2×s12×s13×s13 - s11×s13² - s12²×s33 - s13²×s11
  // For transverse isotropy (s11=s22, s13=s23, s12=s21):
  const det = s11*s11*s33 + 2*s12*s13*s13 - s11*s13*s13 - s12*s12*s33 - s11*s13*s13;
  // Which simplifies to: (s11+s12)(s11-s12)s33 - 2×s13²×(s11-s12)... let me just compute numerically
  // Actually for numerical robustness, build the 3×3 and invert directly:
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

  return C;
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
 * Reference: Birosz et al. (2022), power-law lattice degradation.
 */
export function buildGyroidConstitutiveMatrix(mat: GyroidOrthotropic): Float64Array {
  const { density, nu_xy, nu_xz, yieldXY, yieldZ, label } = mat;

  if (density < 0 || density > 1.0) {
    throw new Error(`Gyroid density must be in [0, 1.0], got ${density}`);
  }

  // Power-law degradation formulas for PLA gyroid (based on empirical data)
  // Exponents: E_xy^1.75, E_z^2.1, G_xz^2.3 with linear correction factors
  const rho = density;
  const one_minus_rho = 1 - rho;

  const E_xy = 3500 * Math.pow(rho, 1.75) * (1 - 0.12 * one_minus_rho);
  const E_z  = 2275 * Math.pow(rho, 2.1)  * (1 - 0.18 * one_minus_rho);
  const G_xz = 1143 * Math.pow(rho, 2.3)  * (1 - 0.22 * one_minus_rho);

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
  // Sign pattern: cofactor(i,2) = (-1)^(i+2), giving signs [+,-,+,-] for i=0,1,2,3.
  const γ0 = -s * ((x1*(z2-z3)) + (x2*(z3-z1)) + (x3*(z1-z2)));
  const γ1 =  s * ((x0*(z2-z3)) + (x2*(z3-z0)) + (x3*(z0-z2)));
  const γ2 = -s * ((x0*(z1-z3)) + (x1*(z3-z0)) + (x3*(z0-z1)));
  const γ3 =  s * ((x0*(z1-z2)) + (x1*(z2-z0)) + (x2*(z0-z1)));

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

// ─── Module-level scratch arrays for C3D10 ────────────────────────────────────
/**
 * These scratch arrays are reused across every Gauss-point evaluation to avoid
 * per-call heap allocations in the inner assembly/stress loops.
 *
 * WARNING: NOT reentrant. Safe because the server is single-threaded Node.js
 * and all FEM operations are synchronous within a single request.
 * Do not use these in concurrent/async contexts.
 */
const _C3D10_SCRATCH = {
  dNdxi:   new Float64Array(10),
  dNdeta:  new Float64Array(10),
  dNdzeta: new Float64Array(10),
  B:       new Float64Array(6 * 30),   // 6×30 strain-displacement matrix
  CB:      new Float64Array(6 * 30),   // 6×30 C·B product
};

/** 4-point Gauss quadrature points and weights for tetrahedron */
const C3D10_GAUSS = [
  // [ξ, η, ζ, weight×6] — standard tetrahedral quadrature
  { xi:0.1381966, eta:0.1381966, zeta:0.1381966, w:0.0416667 },
  { xi:0.5854102, eta:0.1381966, zeta:0.1381966, w:0.0416667 },
  { xi:0.1381966, eta:0.5854102, zeta:0.1381966, w:0.0416667 },
  { xi:0.1381966, eta:0.1381966, zeta:0.5854102, w:0.0416667 },
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
 *
 * Uses module-level scratch buffers (_C3D10_SCRATCH) to avoid heap allocation.
 * NOT reentrant — see scratch-array warning above.
 */
export function c3d10ShapeDerivatives(xi: number, eta: number, zeta: number): [Float64Array, Float64Array, Float64Array] {
  const delta = 1 - xi - eta - zeta;
  const dNdxi   = _C3D10_SCRATCH.dNdxi;
  const dNdeta  = _C3D10_SCRATCH.dNdeta;
  const dNdzeta = _C3D10_SCRATCH.dNdzeta;

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

  // B matrix: 6×30 — reuse module-level scratch; zero it first (sparsely written)
  const B = _C3D10_SCRATCH.B;
  B.fill(0);
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

  for (const gp of C3D10_GAUSS) {
    const { B, detJ } = buildB_c3d10(nodes, gp.xi, gp.eta, gp.zeta);
    const vol = Math.abs(detJ) * gp.w;

    // Ke += Bᵀ C B × vol
    // CB = C × B (6×30) — reuse module-level scratch; zero it first (accumulator)
    const CB = _C3D10_SCRATCH.CB;
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
