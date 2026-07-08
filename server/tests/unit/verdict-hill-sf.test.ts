/**
 * verdict-hill-sf.test.ts
 * -----------------------
 * Issue #97: the verdict / "Bulk yield" safety factor must come from the
 * solver's Hill (1948) anisotropic minimum SF (SolverResult.minSafetyFactor),
 * not from the von Mises ratio effectiveYield / maxVM.
 *
 * Strategy: impose a uniform strain field on a box mesh chosen so the stress
 * state is EXACTLY uniaxial σzz (Z-dominated — the case where the two criteria
 * disagree most). Feed the recovered element stresses through computeBulkSF
 * and check the headline SF equals the hand-computed Hill value:
 *
 *   Pure σzz under Hill (transverse isotropy, F=G=1/(2Z²)):
 *     2f = (F+G)·σzz² = σzz²/Z²   →   σ_eq = Y·σzz/Z   →   SF = Z/σzz
 *
 *   With yieldXY = Y = 50, yieldZ = Z = 29, σzz = 20 MPa:
 *     Hill SF      = 29/20 = 1.45   (the correct, calibrated answer)
 *     von Mises SF = 50/20 = 2.50   (the pre-#97 headline — 72% optimistic)
 */

import { describe, it, expect } from "vitest";
import { generateBoxMesh } from "../../solver/meshgen.js";
import { recoverElementStress } from "../../solver/stress.js";
import { computeBulkSF, checkFailureModes, classifyHole } from "../../analysis.js";
import type { OrthotropicMaterial } from "../../solver/types.js";

const Y = 50, Z = 29;
const SIGMA_ZZ = 20;   // MPa, applied uniaxial through-thickness stress

const MAT: OrthotropicMaterial = {
  kind: "orthotropic",
  E_xy: 3500, E_z: 2275,
  nu_xy: 0.36, nu_xz: 0.30,
  G_xz: (3500 / (2 * 1.36)) * 0.4,
  yieldXY: Y, yieldZ: Z,
  label: "hill-verdict-test",
};

/**
 * Displacement field for uniform uniaxial σzz:
 *   ε_zz = σzz/E_z,   ε_xx = ε_yy = −ν_zx·σzz/E_z = −ν_xz·σzz/E_xy
 * (standard convention, see issue #102), shear strains zero.
 * u = [ε_xx·x, ε_yy·y, ε_zz·z] is exactly representable by linear elements,
 * so every element recovers the same stress with no discretisation error.
 */
function uniformSigmaZZDisplacement(nodes: Float64Array, nodeCount: number): Float64Array {
  const ezz = SIGMA_ZZ / MAT.E_z;
  const exx = -MAT.nu_xz * SIGMA_ZZ / MAT.E_xy;
  const u = new Float64Array(nodeCount * 3);
  for (let n = 0; n < nodeCount; n++) {
    u[n * 3]     = exx * (nodes[n * 3] ?? 0);
    u[n * 3 + 1] = exx * (nodes[n * 3 + 1] ?? 0);
    u[n * 3 + 2] = ezz * (nodes[n * 3 + 2] ?? 0);
  }
  return u;
}

describe("verdict SF uses the Hill criterion, not von Mises (issue #97)", () => {
  const mesh = generateBoxMesh(0, 0, 0, 10, 10, 10, 3, 3, 3);
  const u = uniformSigmaZZDisplacement(mesh.nodes, mesh.nodeCount);
  const rec = recoverElementStress(mesh, u, MAT);

  it("solver recovers the pure-σzz stress state (sanity)", () => {
    expect(rec.maxVonMises).toBeCloseTo(SIGMA_ZZ, 4);   // VM of pure uniaxial = |σzz|
    expect(rec.elemStress6[2]).toBeCloseTo(SIGMA_ZZ, 4);
    expect(rec.elemStress6[0]).toBeCloseTo(0, 4);
  });

  it("minSafetyFactor is the hand-computed Hill SF = yieldZ/σzz = 1.45", () => {
    expect(rec.minSF).toBeCloseTo(Z / SIGMA_ZZ, 3);
  });

  it("computeBulkSF returns the Hill SF as headline and von Mises for comparison", () => {
    const bulk = computeBulkSF({
      minSafetyFactor:   rec.minSF,
      maxVonMisesMPa:    rec.maxVonMises,
      effectiveYieldMPa: Y,   // literature yield × multipliers happens to equal yieldXY here
      material:          MAT,
    });
    expect(bulk.criterion).toBe("hill");
    expect(bulk.sf).toBeCloseTo(1.45, 3);          // NOT the von Mises 2.50
    expect(bulk.vonMisesSF).toBeCloseTo(2.50, 3);  // retained for display
    expect(bulk.sf).not.toBeCloseTo(bulk.vonMisesSF, 1);
  });

  it("falls back to von Mises for isotropic materials", () => {
    const bulk = computeBulkSF({
      minSafetyFactor:   3.1,
      maxVonMisesMPa:    20,
      effectiveYieldMPa: 50,
      material:          { E: 3500, nu: 0.36, yieldStrength: 50, label: "iso" },
    });
    expect(bulk.criterion).toBe("von-mises");
    expect(bulk.sf).toBeCloseTo(2.5, 6);
  });
});

describe("checkFailureModes bulk entry and calibrated yield plumbing (issue #97)", () => {
  const holeClass = classifyHole(1.6, 30);   // ~M3 clearance
  const base = {
    holeClass,
    plateThicknessMm: 4,
    edgeDistMm:       8,
    holeSeparationMm: 0,
    appliedForceN:    100,
    bulkSF:           1.45,
    orientation:      "flat",
    layerHeightMm:    0.2,
  };

  it("labels the Bulk yield mode with the Hill criterion when bulkCriterion='hill'", () => {
    const modes = checkFailureModes({ ...base, effectiveYieldMPa: 50, bulkCriterion: "hill" });
    const bulkMode = modes.find(m => m.mode === "Bulk yield")!;
    expect(bulkMode.sf).toBeCloseTo(1.45, 6);
    expect(bulkMode.note).toMatch(/Hill \(1948\)/);
    const modesVM = checkFailureModes({ ...base, effectiveYieldMPa: 50 });
    expect(modesVM.find(m => m.mode === "Bulk yield")!.note).toMatch(/Von Mises/);
  });

  it("analytic checks scale with the supplied (calibrated) yield, not a fixed literature value", () => {
    const at50 = checkFailureModes({ ...base, effectiveYieldMPa: 50 });
    const at40 = checkFailureModes({ ...base, effectiveYieldMPa: 40 });
    const net50 = at50.find(m => m.mode === "Net-section tension")!;
    const net40 = at40.find(m => m.mode === "Net-section tension")!;
    expect(net40.sf / net50.sf).toBeCloseTo(40 / 50, 3);
  });
});
