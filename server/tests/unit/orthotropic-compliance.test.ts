/**
 * orthotropic-compliance.test.ts
 * ------------------------------
 * Issue #102: audit of the Poisson-ratio convention in the orthotropic
 * compliance matrix (buildOrthotropicConstitutiveMatrix, server/solver/element.ts).
 *
 * Convention under test (standard engineering convention):
 *   ν_ij = −ε_j/ε_i under uniaxial stress along i, so S_ij = −ν_ij/E_i.
 *   The input `nu_xz` is the through-thickness contraction per unit in-plane
 *   strain (load in the isotropy plane), hence
 *     s13 = −ν_xz / E_xy
 *   and the reciprocal (minor) ratio is ν_zx = ν_xz·E_z/E_xy.
 *
 * The pre-#102 code effectively used s13 = −ν_xz/E_z, i.e. treated the input
 * as what most references call ν_zx. For E_z/E_xy = 0.5 the two
 * interpretations differ by 2× in the coupling entry — the isotropic limit
 * (E_xy = E_z) cannot distinguish them, so every test here uses E_xy ≠ E_z.
 */

import { describe, it, expect } from "vitest";
import { buildOrthotropicConstitutiveMatrix, buildConstitutiveMatrix } from "../../solver/element.js";
import type { OrthotropicMaterial } from "../../solver/types.js";

// ─── Hand computation (documented) ─────────────────────────────────────────────
//
// Material: E_xy = 2000 MPa, E_z = 1000 MPa (ratio 0.5 — strongly anisotropic),
//           ν_xy = 0.3, ν_xz = 0.3, G_xz = 400 MPa, G_xy explicit = 700 MPa.
//
// Normal-stress compliance block (standard convention):
//   a = s11 = 1/E_xy        =  5.0e-4
//   b = s12 = −ν_xy/E_xy    = −1.5e-4
//   c = s13 = −ν_xz/E_xy    = −1.5e-4
//   d = s33 = 1/E_z         =  1.0e-3
//
//   S = [ a b c ]
//       [ b a c ]
//       [ c c d ]
//
// Determinant (factorised for this symmetric pattern):
//   det = (a − b) · [ d·(a + b) − 2c² ]
//       = (5.0e-4 + 1.5e-4) · [ 1.0e-3·(5.0e-4 − 1.5e-4) − 2·(1.5e-4)² ]
//       = 6.5e-4 · (3.5e-7 − 4.5e-8)
//       = 6.5e-4 · 3.05e-7 = 1.9825e-10
//
// Cofactor inversion (C = S⁻¹):
//   C11 = (a·d − c²)/det = (5.0e-7 − 2.25e-8)/1.9825e-10 = 4.775e-7/1.9825e-10
//       = 2408.575032... MPa
//   C12 = (c² − b·d)/det = (2.25e-8 + 1.5e-7)/1.9825e-10 = 1.725e-7/1.9825e-10
//       =  870.113493... MPa
//   C13 = c·(b − a)/det  = (−1.5e-4)·(−6.5e-4)/1.9825e-10 = 9.75e-8/1.9825e-10
//       =  491.803278... MPa
//   C33 = (a² − b²)/det  = (2.5e-7 − 2.25e-8)/1.9825e-10 = 2.275e-7/1.9825e-10
//       = 1147.540983... MPa
const MAT: OrthotropicMaterial = {
  kind: "orthotropic",
  E_xy: 2000, E_z: 1000,
  nu_xy: 0.3, nu_xz: 0.3,
  G_xz: 400, G_xy: 700,
  yieldXY: 50, yieldZ: 25,
  label: "compliance-convention-test",
};

const C11_HAND = 4.775e-7  / 1.9825e-10;
const C12_HAND = 1.725e-7  / 1.9825e-10;
const C13_HAND = 9.75e-8   / 1.9825e-10;
const C33_HAND = 2.275e-7  / 1.9825e-10;

// Generic dense 6×6 inversion via Gauss-Jordan (independent of the code under test)
function invert6(Cin: Float64Array): Float64Array {
  const n = 6;
  const A = Array.from({ length: n }, (_, i) =>
    Array.from({ length: 2 * n }, (_, j) =>
      j < n ? (Cin[i * n + j] ?? 0) : (j - n === i ? 1 : 0)));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(A[r]![col]!) > Math.abs(A[piv]![col]!)) piv = r;
    [A[col], A[piv]] = [A[piv]!, A[col]!];
    const p = A[col]![col]!;
    if (Math.abs(p) < 1e-30) throw new Error("singular");
    for (let j = 0; j < 2 * n; j++) A[col]![j] = A[col]![j]! / p;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r]![col]!;
      for (let j = 0; j < 2 * n; j++) A[r]![j] = A[r]![j]! - f * A[col]![j]!;
    }
  }
  const out = new Float64Array(36);
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) out[i * 6 + j] = A[i]![j + n]!;
  return out;
}

describe("orthotropic compliance — Poisson convention (issue #102)", () => {
  const C = buildOrthotropicConstitutiveMatrix(MAT);

  it("normal-stress block matches the hand-computed inversion (E_xy ≠ E_z)", () => {
    expect(C[0]).toBeCloseTo(C11_HAND, 6);   // C11
    expect(C[7]).toBeCloseTo(C11_HAND, 6);   // C22 = C11
    expect(C[1]).toBeCloseTo(C12_HAND, 6);   // C12
    expect(C[2]).toBeCloseTo(C13_HAND, 6);   // C13
    expect(C[8]).toBeCloseTo(C13_HAND, 6);   // C23 = C13
    expect(C[14]).toBeCloseTo(C33_HAND, 6);  // C33
  });

  it("does NOT reproduce the pre-#102 (swapped-convention) coupling entry", () => {
    // Old code: s13 = −ν_xz/E_z = −3.0e-4 (2× the standard-convention value here).
    // Old det  = (a−b)·[d(a+b) − 2c²] with c = −3e-4:
    //          = 6.5e-4 · (3.5e-7 − 1.8e-7) = 6.5e-4 · 1.7e-7 = 1.105e-10
    // Old C13  = c(b−a)/det = (−3e-4)(−6.5e-4)/1.105e-10 = 1.95e-7/1.105e-10
    //          = 1764.71 MPa  — ~3.6× the correct 491.80 MPa.
    const OLD_C13 = 1.95e-7 / 1.105e-10;
    expect(Math.abs((C[2] ?? 0) - OLD_C13)).toBeGreaterThan(100);
  });

  it("recovered compliance obeys the standard convention: S13 = −ν_xz/E_xy and S31 = −ν_zx/E_z", () => {
    const S = invert6(C);
    expect(S[0 * 6 + 0]).toBeCloseTo(1 / MAT.E_xy, 10);        // s11 = 1/E_xy
    expect(S[2 * 6 + 2]).toBeCloseTo(1 / MAT.E_z, 10);         // s33 = 1/E_z
    expect(S[0 * 6 + 2]).toBeCloseTo(-MAT.nu_xz / MAT.E_xy, 10); // s13 = −ν_xz/E_xy
    // symmetry & Maxwell relation: s31 = −ν_zx/E_z with ν_zx = ν_xz·E_z/E_xy
    const nu_zx = MAT.nu_xz * MAT.E_z / MAT.E_xy;
    expect(S[2 * 6 + 0]).toBeCloseTo(-nu_zx / MAT.E_z, 10);
    expect(S[2 * 6 + 0]).toBeCloseTo(S[0 * 6 + 2]!, 12);
  });

  it("C is symmetric and its normal block is positive definite (leading minors > 0)", () => {
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++)
        expect(C[i * 6 + j]).toBeCloseTo(C[j * 6 + i] ?? 0, 8);
    // Leading principal minors of the 3×3 normal block
    const c11 = C[0]!, c12 = C[1]!, c13 = C[2]!, c33 = C[14]!;
    const m1 = c11;
    const m2 = c11 * c11 - c12 * c12;
    const m3 = c11 * (c11 * c33 - c13 * c13) - c12 * (c12 * c33 - c13 * c13)
             + c13 * (c12 * c13 - c11 * c13);
    expect(m1).toBeGreaterThan(0);
    expect(m2).toBeGreaterThan(0);
    expect(m3).toBeGreaterThan(0);
    // Shear diagonal
    expect(C[21]).toBeCloseTo(700, 8);  // explicit G_xy
    expect(C[28]).toBeCloseTo(400, 8);  // G_xz
    expect(C[35]).toBeCloseTo(400, 8);  // G_xz
  });

  it("uniaxial in-plane stress produces strain ratio −ε_z/ε_x = ν_xz (physical meaning)", () => {
    // Apply σxx = 10 MPa: ε = S·σ; check the contraction ratio directly.
    const S = invert6(C);
    const ex = S[0]! * 10;          // ε_x = s11·σxx
    const ez = S[2 * 6 + 0]! * 10;  // ε_z = s31·σxx
    expect(-ez / ex).toBeCloseTo(MAT.nu_xz, 10);
  });

  it("isotropic limit still collapses to the isotropic matrix", () => {
    const E = 3500, nu = 0.36, G = E / (2 * (1 + nu));
    const iso = buildConstitutiveMatrix({ E, nu, yieldStrength: 50, label: "iso" });
    const orth = buildOrthotropicConstitutiveMatrix({
      kind: "orthotropic", E_xy: E, E_z: E, nu_xy: nu, nu_xz: nu, G_xz: G,
      yieldXY: 50, yieldZ: 50, label: "orth",
    });
    for (let i = 0; i < 36; i++)
      expect(orth[i]).toBeCloseTo(iso[i] ?? 0, 5);
  });
});
