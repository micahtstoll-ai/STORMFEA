/**
 * gyroid-formula.test.ts
 * ----------------------
 * Verifies the GyroidOrthotropic power-law formula in element.ts against:
 *   1. The formula's own internal consistency (ρ=1 gives base values)
 *   2. The "expected" reference values from density-matrix.test.ts's
 *      checkElasticConstants(), which are NEVER CALLED in that file
 *   3. Gibson-Ashby bounds for cellular solids
 *
 * Infrastructure note (Phase 2 Batch D audit, PR #36):
 * The existing density-matrix.test.ts defines checkElasticConstants() with
 * reference values (E_xy=112.5 MPa at 20% density, etc.) but never calls it.
 * This file exposes that gap by actually running the formula and comparing
 * against those dead-code reference values.
 *
 * Citation under review:
 *   Birosz MT, Ledenyák D, Andó M. Effect of FDM infill patterns on mechanical
 *   properties. Polymer Testing. 2022;113:107654.
 *   DOI: 10.1016/j.polymertesting.2022.107654
 *
 * The paper is about comparing infill pattern strength (qualitative ranking),
 * not providing power-law exponents for density-dependent modulus.
 * The exponents 1.75, 2.1, 2.3 and the correction factors are not traceable
 * to this citation from the paper's title/abstract alone.
 */

import { describe, it, expect } from "vitest";
import { buildGyroidConstitutiveMatrix } from "../../solver/element.js";
import type { GyroidOrthotropic } from "../../solver/types.js";

// Helper: reconstruct E_xy from the constitutive C matrix.
// For orthotropic (transversely isotropic) material the compliance is:
//   S11 = 1/E_xy (from the C[0,0] dominant term)
// We recover E_xy by inverting the 3×3 upper-left block of C.
function backComputeExy(C: Float64Array): number {
  // Upper-left 3×3 of C (normal stress block):
  // [C11  C12  C13]
  // [C12  C11  C13]
  // [C13  C13  C33]
  const C11 = C[0]!;
  const C12 = C[1]!;
  const C13 = C[2]!;
  const C33 = C[14]!;

  // 3×3 determinant:
  const det = C11*(C11*C33 - C13*C13) - C12*(C12*C33 - C13*C13) + C13*(C12*C13 - C11*C13);

  // S11 = cofactor(0,0) / det = (C11*C33 - C13²) / det
  const cof00 = C11*C33 - C13*C13;
  const S11 = cof00 / det;
  return 1 / S11;
}

// Helper: reconstruct E_z from C matrix.
function backComputeEz(C: Float64Array): number {
  const C11 = C[0]!;
  const C12 = C[1]!;
  const C13 = C[2]!;
  const C33 = C[14]!;
  const det = C11*(C11*C33 - C13*C13) - C12*(C12*C33 - C13*C13) + C13*(C12*C13 - C11*C13);
  // S33 = cofactor(2,2) / det = (C11² - C12²) / det
  const cof22 = C11*C11 - C12*C12;
  return det / cof22;
}

// Helper: reconstruct G_xz from C matrix (= C[5,5] = C[35] in flat 6×6).
function backComputeGxz(C: Float64Array): number {
  return C[35]!;  // G_xz is directly in C[5,5]
}

// ─── Test group 1: Self-consistency at ρ = 1 ───────────────────────────────────
//
// At ρ = 1 (solid): (1-α(1-ρ)) = 1, ρ^n = 1, so all formulas should return
// their base coefficient (3500, 2275, 1143).
describe("GyroidOrthotropic formula: ρ=1.0 solid reference (must match base values)", () => {
  const solid: GyroidOrthotropic = {
    kind: "gyroid-orthotropic",
    density: 1.0,
    E_xy: 3500, E_z: 2275, nu_xy: 0.38, nu_xz: 0.28, G_xz: 1143,
    yieldXY: 56, yieldZ: 33, label: "solid",
  };
  const C = buildGyroidConstitutiveMatrix(solid);

  it("E_xy at ρ=1 back-computes to 3500 MPa (formula base value)", () => {
    const E_xy = backComputeExy(C);
    expect(E_xy).toBeCloseTo(3500, 0);
  });

  it("E_z at ρ=1 back-computes to 2275 MPa (formula base value)", () => {
    const E_z = backComputeEz(C);
    expect(E_z).toBeCloseTo(2275, 0);
  });

  it("G_xz at ρ=1 back-computes to 1143 MPa (formula base value)", () => {
    const G_xz = backComputeGxz(C);
    expect(G_xz).toBeCloseTo(1143, 0);
  });
});

// ─── Test group 2: Formula output at ρ=0.2 vs dead-code reference values ────────
//
// density-matrix.test.ts declares expected values:
//   E_xy ≈ 112.5 MPa, E_z ≈ 52.4 MPa, G_xz ≈ 19.5 MPa at ρ=0.2
// But buildGyroidConstitutiveMatrix ignores stored E_xy/E_z/G_xz and recomputes
// from the power-law formula: E_xy = 3500 × ρ^1.75 × (1 − 0.12(1−ρ)).
//
// This test records what the formula ACTUALLY produces and verifies it against
// the dead-code reference values. A MISMATCH HERE IS AN AUDIT FINDING.
describe("GyroidOrthotropic formula at ρ=0.2: formula vs dead-code reference values", () => {
  // Material with density=0.2; builder will ignore the stored E_xy/E_z/G_xz
  const mat20: GyroidOrthotropic = {
    kind: "gyroid-orthotropic",
    density: 0.2,
    E_xy: 112.5,   // "expected" value from density-matrix.test.ts checkElasticConstants (never called)
    E_z: 52.4,     // "expected" value (never validated)
    nu_xy: 0.38,
    nu_xz: 0.28,
    G_xz: 19.5,    // "expected" value (never validated)
    yieldXY: 10,
    yieldZ: 6,
    label: "20%",
  };

  // What the formula actually produces (computed analytically for documentation):
  // E_xy = 3500 × 0.2^1.75 × (1 − 0.12×0.8) = 3500 × 0.05980 × 0.904 ≈ 189 MPa
  // E_z  = 2275 × 0.2^2.1  × (1 − 0.18×0.8) = 2275 × 0.03390 × 0.856 ≈ 66 MPa
  // G_xz = 1143 × 0.2^2.3  × (1 − 0.22×0.8) = 1143 × 0.02472 × 0.824 ≈ 23 MPa

  const C20 = buildGyroidConstitutiveMatrix(mat20);
  const E_xy_actual = backComputeExy(C20);
  const E_z_actual  = backComputeEz(C20);
  const G_xz_actual = backComputeGxz(C20);

  // The formula's own output at ρ=0.2 — recorded here for traceability.
  // These tests PASS by definition (the formula does what the formula does),
  // but they document what the formula produces vs. what was stated as expected.
  it("formula E_xy at ρ=0.2 is approximately 189 MPa (NOT the 112.5 reference value)", () => {
    // The reference value 112.5 corresponds to a different power-law exponent (~2.14)
    // than what is implemented (1.75). This is an audit finding — see test below.
    expect(E_xy_actual).toBeCloseTo(189, 0);
  });

  it("formula E_z at ρ=0.2 is approximately 66 MPa (NOT the 52.4 reference value)", () => {
    expect(E_z_actual).toBeCloseTo(66, 0);
  });

  it("formula G_xz at ρ=0.2 is approximately 23 MPa (NOT the 19.5 reference value)", () => {
    expect(G_xz_actual).toBeCloseTo(23, 0);
  });

  // The critical finding: formula output does NOT match the dead-code reference values.
  it("AUDIT FINDING: formula E_xy at ρ=0.2 differs from density-matrix.test.ts reference by >40%", () => {
    const referenceExy = 112.5;  // from checkElasticConstants(), which is never called
    const pctDiff = Math.abs(E_xy_actual - referenceExy) / referenceExy;
    // The formula (exponent 1.75) produces ~189 MPa vs reference 112.5 MPa (68% higher)
    // This suggests either: (a) the formula exponents were changed without updating reference
    // values, or (b) the formula exponents were not correctly transcribed from Birosz 2022.
    expect(pctDiff).toBeGreaterThan(0.40);  // confirms the discrepancy is large (>40%)
  });
});

// ─── Test group 3: Gibson-Ashby bounds ─────────────────────────────────────────
//
// Gibson-Ashby (1997) establishes that for open-cell cellular solids:
//   E ∝ ρ^2 (for open-cell foam)
// For gyroid lattices, the scaling exponent is typically 1.5–2.5.
// The implemented exponents (1.75, 2.1, 2.3) are within this range physically,
// even if the specific values need citation support.
describe("GyroidOrthotropic formula: Gibson-Ashby physical bounds", () => {
  function makeGyroid(density: number): GyroidOrthotropic {
    const rho = density;
    return {
      kind: "gyroid-orthotropic",
      density: rho,
      E_xy: 3500 * Math.pow(rho, 1.75) * (1 - 0.12*(1-rho)),
      E_z:  2275 * Math.pow(rho, 2.1)  * (1 - 0.18*(1-rho)),
      nu_xy: 0.38, nu_xz: 0.28,
      G_xz: 1143 * Math.pow(rho, 2.3)  * (1 - 0.22*(1-rho)),
      yieldXY: 56*rho, yieldZ: 33*rho,
      label: `${(rho*100).toFixed(0)}%`,
    };
  }

  it("E_xy is sub-linear in density (power-law exponent > 1)", () => {
    // If exponent > 1, E(0.5)/E(1.0) < 0.5
    const C50  = buildGyroidConstitutiveMatrix(makeGyroid(0.5));
    const C100 = buildGyroidConstitutiveMatrix(makeGyroid(1.0));
    const ratio = backComputeExy(C50) / backComputeExy(C100);
    expect(ratio).toBeLessThan(0.5);
  });

  it("E_z degrades faster than E_xy (exponent 2.1 > 1.75)", () => {
    const C20  = buildGyroidConstitutiveMatrix(makeGyroid(0.2));
    const C100 = buildGyroidConstitutiveMatrix(makeGyroid(1.0));
    const ratioExy = backComputeExy(C20) / backComputeExy(C100);
    const ratioEz  = backComputeEz(C20)  / backComputeEz(C100);
    // E_z degrades more steeply (higher exponent), so ratio_Ez < ratio_Exy
    expect(ratioEz).toBeLessThan(ratioExy);
  });

  it("G_xz degrades fastest (exponent 2.3 > 2.1 > 1.75)", () => {
    const C20  = buildGyroidConstitutiveMatrix(makeGyroid(0.2));
    const C100 = buildGyroidConstitutiveMatrix(makeGyroid(1.0));
    const ratioEz  = backComputeEz(C20)  / backComputeEz(C100);
    const ratioGxz = backComputeGxz(C20) / backComputeGxz(C100);
    expect(ratioGxz).toBeLessThan(ratioEz);
  });
});
