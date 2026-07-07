/**
 * hill-utilization.test.ts
 * ------------------------
 * Analytical benchmark for the anisotropic utilization ratios U_XY and U_Z
 * (issue #63). Calls the ACTUAL implementation `computeUtilizationRatios`
 * exported from server/analysis.ts (extracted, behavior-preserving, from the
 * per-node loop that fills nodeUtilXY / nodeUtilZ).
 *
 * Definitions under test:
 *   U_XY = sqrt(σxx² + σyy² − σxx·σyy + 3·τxy²) / yieldXY
 *   U_Z  = max(|σzz|, √3·sqrt(τyz² + τxz²)) / yieldZ
 *
 * The √3 factor on the interlayer shear comes from the Hill (1948)
 * coefficients L = M = 3/(2Z²): pure transverse shear τ yields when
 * 2·L·τ² = 1, i.e. τ_yield = Z/√3, so utilization = √3·τ/Z.
 */

import { describe, it, expect } from "vitest";
import { computeUtilizationRatios } from "../../analysis.js";
import { hillEquivalentStress } from "../../solver/stress.js";

// Yield strengths used throughout (typical FDM PLA flat print, MPa)
const Y = 50;   // yieldXY (in-plane)
const Z = 29;   // yieldZ  (through-layer bond)

describe("U_XY: in-plane utilization against hand calculation", () => {
  it("combined in-plane state σxx=30, σyy=10, τxy=5 gives U_XY = sqrt(775)/50", () => {
    // Hand calculation:
    //   σxx² + σyy² − σxx·σyy + 3·τxy²
    //     = 30² + 10² − 30·10 + 3·5²
    //     = 900 + 100 − 300 + 75
    //     = 775
    //   sqrt(775) = sqrt(25·31) = 5·sqrt(31) = 5 × 5.5677643628 = 27.8388218142
    //   U_XY = 27.8388218142 / 50 = 0.5567764363
    const { uXY, uZ } = computeUtilizationRatios(30, 10, 0, 5, 0, 0, Y, Z);
    expect(uXY).toBeCloseTo(0.5567764363, 8);
    // No out-of-plane stress at all → U_Z = 0 exactly
    expect(uZ).toBe(0);
  });

  it("uniaxial in-plane stress at yield gives U_XY = 1 exactly (algebraic)", () => {
    // σxx = Y, everything else 0:
    //   U_XY = sqrt(Y² + 0 − 0 + 0)/Y = Y/Y = 1
    const { uXY } = computeUtilizationRatios(Y, 0, 0, 0, 0, 0, Y, Z);
    expect(uXY).toBe(1);
  });

  it("equibiaxial in-plane tension σxx=σyy=σ gives U_XY = σ/Y (von Mises property)", () => {
    // σxx = σyy = 40, τxy = 0:
    //   σxx² + σyy² − σxx·σyy = 1600 + 1600 − 1600 = 1600 → sqrt = 40
    //   U_XY = 40/50 = 0.8 exactly
    const { uXY } = computeUtilizationRatios(40, 40, 0, 0, 0, 0, Y, Z);
    expect(uXY).toBeCloseTo(0.8, 12);
  });

  it("pure in-plane shear τxy = Y/√3 gives U_XY = 1 (shear yield = Y/√3)", () => {
    // τxy = 50/√3 = 28.8675134595:
    //   U_XY = sqrt(3·τxy²)/Y = √3·τxy/Y = √3·(Y/√3)/Y = 1
    const { uXY } = computeUtilizationRatios(0, 0, 0, Y / Math.sqrt(3), 0, 0, Y, Z);
    expect(uXY).toBeCloseTo(1, 12);
  });
});

describe("U_Z: through-layer utilization against hand calculation", () => {
  it("normal-dominated state σzz=−12, τyz=3, τxz=4 gives U_Z = 12/29", () => {
    // Hand calculation:
    //   normal term:  |σzz| = |−12| = 12
    //   shear term:   √3·sqrt(τyz² + τxz²) = √3·sqrt(9 + 16) = √3·5
    //               = 1.7320508076 × 5 = 8.6602540378
    //   max(12, 8.6602540378) = 12  → normal governs
    //   U_Z = 12/29 = 0.4137931034
    const { uXY, uZ } = computeUtilizationRatios(0, 0, -12, 0, 3, 4, Y, Z);
    expect(uZ).toBeCloseTo(0.4137931034, 8);
    // No in-plane stress → U_XY = 0 exactly
    expect(uXY).toBe(0);
  });

  it("shear-dominated state σzz=5, τyz=3, τxz=4 gives U_Z = 5√3/29", () => {
    // Hand calculation:
    //   normal term:  |σzz| = 5
    //   shear term:   √3·sqrt(3² + 4²) = √3·5 = 8.6602540378
    //   max(5, 8.6602540378) = 8.6602540378  → interlayer shear governs
    //   U_Z = 8.6602540378/29 = 0.2986294496
    const { uZ } = computeUtilizationRatios(0, 0, 5, 0, 3, 4, Y, Z);
    expect(uZ).toBeCloseTo(0.2986294496, 8);
  });

  it("through-layer normal stress at bond yield gives U_Z = 1 exactly", () => {
    // σzz = Z → U_Z = |Z|/Z = 1
    const { uZ } = computeUtilizationRatios(0, 0, Z, 0, 0, 0, Y, Z);
    expect(uZ).toBe(1);
  });

  it("pure interlayer shear τxz = Z/√3 gives U_Z = 1 (Hill shear yield in Z-planes)", () => {
    // τxz = 29/√3 = 16.7431578061:
    //   U_Z = √3·τxz/Z = √3·(Z/√3)/Z = 1
    const { uZ } = computeUtilizationRatios(0, 0, 0, 0, 0, Z / Math.sqrt(3), Y, Z);
    expect(uZ).toBeCloseTo(1, 12);
  });
});

describe("U_Z consistency with the Hill (1948) equivalent stress", () => {
  // For stress states where the Hill quadratic reduces to a single term, the
  // utilization U_Z must equal σ_Hill/Y (= 1/SF). Verified against the actual
  // hillEquivalentStress implementation, not a re-derived formula.

  it("pure σzz: U_Z equals σ_Hill/Y", () => {
    // σzz only: 2f = (F+G)·σzz² = σzz²/Z² → σ_Hill = Y·σzz/Z
    //   → σ_Hill/Y = σzz/Z = U_Z
    // With σzz = 10: U_Z = 10/29 = 0.3448275862
    const szz = 10;
    const { uZ } = computeUtilizationRatios(0, 0, szz, 0, 0, 0, Y, Z);
    const sigHill = hillEquivalentStress(0, 0, szz, 0, 0, 0, Y, Z);
    expect(uZ).toBeCloseTo(0.3448275862, 8);
    expect(uZ).toBeCloseTo(sigHill / Y, 10);
  });

  it("pure interlayer shear τxz: U_Z equals σ_Hill/Y", () => {
    // τxz only: 2f = 2M·τxz² = 3τxz²/Z² → σ_Hill = Y·√3·τxz/Z
    //   → σ_Hill/Y = √3·τxz/Z = U_Z
    // With τxz = 8: U_Z = √3·8/29 = 13.8564064606/29 = 0.4778071193
    const txz = 8;
    const { uZ } = computeUtilizationRatios(0, 0, 0, 0, 0, txz, Y, Z);
    const sigHill = hillEquivalentStress(0, 0, 0, 0, 0, txz, Y, Z);
    expect(uZ).toBeCloseTo(0.4778071193, 8);
    expect(uZ).toBeCloseTo(sigHill / Y, 10);
  });
});
