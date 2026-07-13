/**
 * hill-utilization.test.ts
 * ------------------------
 * Analytical benchmark for the anisotropic utilization ratios U_XY and U_Z
 * (issue #63). Calls the ACTUAL implementation `computeUtilizationRatios`
 * exported from server/analysis.ts (extracted, behavior-preserving, from the
 * per-node loop that fills nodeUtilXY / nodeUtilZ).
 *
 * Definitions under test (dual criterion — layer-model audit A3):
 *   U_XY = sqrt(σxx² + σyy² − σxx·σyy + 3·τxy²) / yieldXY
 *   U_Z  = interface utilization of the layer-plane traction:
 *            σzz > 0:  sqrt( (σzz/S_zt)² + (τ_z/S_zs)² )
 *            σzz ≤ 0:  max(0, τ_z − μ·|σzz|) / S_zs   (friction credit)
 *          with τ_z = sqrt(τyz² + τxz²), S_zt = yieldZ, and the default
 *          S_zs = yieldZ/√3 — exactly the transverse-shear yield the legacy
 *          Hill coefficients L = M = 3/(2Z²) encoded, so tension-side pure
 *          states match the legacy U_Z.
 */

import { describe, it, expect } from "vitest";
import { computeUtilizationRatios } from "../../analysis.js";
import { fdmDualCriterionSF, INTERFACE_FRICTION_MU } from "../../solver/stress.js";

// Yield strengths used throughout (typical FDM PLA flat print, MPa)
const Y  = 50;                 // yieldXY (in-plane)
const Z  = 29;                 // yieldZ  (through-layer bond tension)
const ZS = Z / Math.sqrt(3);   // default interlaminar shear allowable

describe("U_XY: in-plane utilization against hand calculation", () => {
  it("combined in-plane state σxx=30, σyy=10, τxy=5 gives U_XY = sqrt(775)/50", () => {
    // Hand calculation:
    //   σxx² + σyy² − σxx·σyy + 3·τxy²
    //     = 30² + 10² − 30·10 + 3·5²
    //     = 900 + 100 − 300 + 75
    //     = 775
    //   sqrt(775) = 5·sqrt(31) = 27.8388218142
    //   U_XY = 27.8388218142 / 50 = 0.5567764363
    const { uXY, uZ } = computeUtilizationRatios(30, 10, 0, 5, 0, 0, Y, Z);
    expect(uXY).toBeCloseTo(0.5567764363, 8);
    // No out-of-plane stress at all → U_Z = 0 exactly
    expect(uZ).toBe(0);
  });

  it("uniaxial in-plane stress at yield gives U_XY = 1 exactly (algebraic)", () => {
    const { uXY } = computeUtilizationRatios(Y, 0, 0, 0, 0, 0, Y, Z);
    expect(uXY).toBe(1);
  });

  it("equibiaxial in-plane tension σxx=σyy=σ gives U_XY = σ/Y (von Mises property)", () => {
    const { uXY } = computeUtilizationRatios(40, 40, 0, 0, 0, 0, Y, Z);
    expect(uXY).toBeCloseTo(0.8, 12);
  });

  it("pure in-plane shear τxy = Y/√3 gives U_XY = 1 (shear yield = Y/√3)", () => {
    const { uXY } = computeUtilizationRatios(0, 0, 0, Y / Math.sqrt(3), 0, 0, Y, Z);
    expect(uXY).toBeCloseTo(1, 12);
  });
});

describe("U_Z: interlayer interface utilization against hand calculation", () => {
  it("COMPRESSIVE σzz=−12 with τyz=3, τxz=4: friction-credited shear only (audit A3)", () => {
    // Hand calculation (σzz ≤ 0 branch):
    //   τ_z = sqrt(9 + 16) = 5
    //   driving shear = max(0, 5 − 0.3·12) = 1.4
    //   U_Z = 1.4 / (29/√3) = 1.4 / 16.7431578061 = 0.0836162582
    // (Legacy |σzz| behavior would have said 12/29 = 0.414 — compression
    //  counted as bond failure. It no longer does.)
    const { uXY, uZ } = computeUtilizationRatios(0, 0, -12, 0, 3, 4, Y, Z);
    expect(uZ).toBeCloseTo((5 - INTERFACE_FRICTION_MU * 12) / ZS, 8);
    // No in-plane stress → U_XY = 0 exactly
    expect(uXY).toBe(0);
  });

  it("tension + shear state σzz=5, τyz=3, τxz=4: quadratic interaction", () => {
    // Hand calculation (σzz > 0 branch):
    //   uT = 5/29 = 0.1724137931
    //   uS = 5/16.7431578061 = 0.2986294496
    //   U_Z = hypot(uT, uS) = 0.3448355538
    const { uZ } = computeUtilizationRatios(0, 0, 5, 0, 3, 4, Y, Z);
    expect(uZ).toBeCloseTo(Math.hypot(5 / Z, 5 / ZS), 8);
  });

  it("through-layer normal stress at bond yield gives U_Z = 1 exactly", () => {
    const { uZ } = computeUtilizationRatios(0, 0, Z, 0, 0, 0, Y, Z);
    expect(uZ).toBe(1);
  });

  it("pure interlayer shear τxz = Z/√3 gives U_Z = 1 (default S_zs = Z/√3)", () => {
    const { uZ } = computeUtilizationRatios(0, 0, 0, 0, 0, Z / Math.sqrt(3), Y, Z);
    expect(uZ).toBeCloseTo(1, 12);
  });

  it("explicit yieldZShear overrides the default ratio", () => {
    const { uZ } = computeUtilizationRatios(0, 0, 0, 0, 0, 10, Y, Z, 20);
    expect(uZ).toBeCloseTo(0.5, 12);
  });
});

describe("U_Z consistency with the dual criterion's interface term", () => {
  // For interface-governed stress states, U_Z must equal 1/SF from the actual
  // fdmDualCriterionSF implementation (not a re-derived formula).

  it("pure σzz tension: U_Z = 1/SF", () => {
    const szz = 10;
    const { uZ } = computeUtilizationRatios(0, 0, szz, 0, 0, 0, Y, Z);
    const sf = fdmDualCriterionSF(0, 0, szz, 0, 0, 0, Y, Z, ZS);
    expect(uZ).toBeCloseTo(szz / Z, 10);
    expect(uZ).toBeCloseTo(1 / sf, 10);
  });

  it("pure interlayer shear τxz: U_Z = 1/SF", () => {
    const txz = 8;
    const { uZ } = computeUtilizationRatios(0, 0, 0, 0, 0, txz, Y, Z);
    const sf = fdmDualCriterionSF(0, 0, 0, 0, 0, txz, Y, Z, ZS);
    expect(uZ).toBeCloseTo(txz / ZS, 10);
    expect(uZ).toBeCloseTo(1 / sf, 10);
  });

  it("tension⊕shear interaction: U_Z = 1/SF while the interface governs", () => {
    const { uZ } = computeUtilizationRatios(0, 0, 12, 0, 6, 8, Y, Z);
    const sf = fdmDualCriterionSF(0, 0, 12, 0, 6, 8, Y, Z, ZS);
    expect(uZ).toBeCloseTo(1 / sf, 10);
  });
});
