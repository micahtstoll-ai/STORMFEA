/**
 * per-failure-mode-yield.test.ts
 * ------------------------------
 * Issue #175: bearing / thread strip-out on WALL-LINED holes must consume the
 * dense-perimeter SHELL allowable, not the volume-averaged shell/core blend.
 * Slicers line every hole with perimeters, so the bolt shank / thread bears on
 * shell material — the average blend drags a low-infill part's bolt-region
 * margins down for core it never touches (CLAUDE.md invariant #6: per-feature
 * consumers read the shell endpoint; whole-part consumers read the average).
 *
 * These tests drive checkFailureModes directly with explicit blended vs shell
 * allowables so the selection logic is locked independently of the mesher.
 */

import { describe, it, expect } from "vitest";
import { checkFailureModes, type HoleClassification } from "../../analysis.js";

// A tapped M6 hole, built directly so BOTH the bearing and thread strip-out
// modes are exercised (constructed rather than classified so it lands
// unambiguously as tapped_75 with a minor diameter).
const tappedM6: HoleClassification = {
  type: "tapped_75",
  bolt: { label: "M6", nominalMm: 6, clearanceClose: 6.4, clearanceFree: 6.6,
          tapDrill75: 5.0, tapDrill50: 5.25, pitch: 1.0, system: "metric" },
  detectedDiamMm: 5.0,
  warning: null,
  minorDiamMm: 5.0,
};

const BLEND_YIELD = 20;   // 20%-infill volume-averaged in-plane yield (MPa)
const SHELL_YIELD = 50;   // solid perimeter (shell) yield (MPa)
const BLEND_SHEAR = 8;    // averaged interlaminar shear allowable (MPa)
const SHELL_SHEAR = 21;   // shell interlaminar shear allowable (MPa)

function run(extra: Record<string, unknown>) {
  return checkFailureModes({
    holeClass:         tappedM6,
    plateThicknessMm:  8,
    edgeDistMm:        20,
    holeSeparationMm:  0,
    appliedForceN:     1000,
    effectiveYieldMPa: BLEND_YIELD,
    bulkSF:            2,
    orientation:       "flat",
    layerHeightMm:     0.2,
    interlayerShearMPa: BLEND_SHEAR,
    ...extra,
  });
}

const sfOf = (modes: ReturnType<typeof run>, mode: string) =>
  modes.find(m => m.mode === mode)!;

describe("issue #175 — wall-lined-hole bolt-region checks use shell yield", () => {
  it("bearing uses the SHELL yield when wall-lined (higher than the blend)", () => {
    const blend = sfOf(run({}), "Bearing (hole wall)");
    const wall  = sfOf(run({ wallShellYieldMPa: SHELL_YIELD, wallShellInterlayerShearMPa: SHELL_SHEAR }), "Bearing (hole wall)");
    // SF is linear in bearing strength ⇒ ratio equals the yield ratio.
    expect(wall.sf).toBeGreaterThan(blend.sf);
    expect(wall.sf / blend.sf).toBeCloseTo(SHELL_YIELD / BLEND_YIELD, 1);
    expect(wall.note).toMatch(/wall \(shell\) yield/i);
  });

  it("thread strip-out uses the SHELL interlaminar allowable when wall-lined", () => {
    const blend = sfOf(run({}), "Thread strip-out");
    const wall  = sfOf(run({ wallShellYieldMPa: SHELL_YIELD, wallShellInterlayerShearMPa: SHELL_SHEAR }), "Thread strip-out");
    expect(wall.sf).toBeGreaterThan(blend.sf);
    expect(wall.sf / blend.sf).toBeCloseTo(SHELL_SHEAR / BLEND_SHEAR, 1);
    expect(wall.note).toMatch(/wall \(shell\) interlaminar/i);
  });

  it("a calibrated bearing strength still wins over the shell yield", () => {
    const cal = sfOf(run({ wallShellYieldMPa: SHELL_YIELD, calibratedBearingStrMPa: 30 }), "Bearing (hole wall)");
    // Uses 30 (calibrated), not 50 (shell) or 20 (blend).
    const blendCal = sfOf(run({ calibratedBearingStrMPa: 30 }), "Bearing (hole wall)");
    expect(cal.sf).toBeCloseTo(blendCal.sf, 9);
    expect(cal.note).toMatch(/CALIBRATED/);
  });

  it("20%-infill wall-lined margins MATCH the 100%-infill part at equal wall count", () => {
    // 20% infill: blend yield 20, but shell (50) passed for the wall-lined hole.
    const lowInfill = run({ wallShellYieldMPa: SHELL_YIELD, wallShellInterlayerShearMPa: SHELL_SHEAR });
    // 100% infill: two-region collapses, average == shell == 50 / 21, no wall
    // params passed (field undefined) — bolt-region checks see 50 / 21 directly.
    const fullInfill = checkFailureModes({
      holeClass: tappedM6, plateThicknessMm: 8, edgeDistMm: 20, holeSeparationMm: 0,
      appliedForceN: 1000, effectiveYieldMPa: SHELL_YIELD, bulkSF: 2,
      orientation: "flat", layerHeightMm: 0.2, interlayerShearMPa: SHELL_SHEAR,
    });
    expect(sfOf(lowInfill, "Bearing (hole wall)").sf).toBeCloseTo(sfOf(fullInfill, "Bearing (hole wall)").sf, 6);
    expect(sfOf(lowInfill, "Thread strip-out").sf).toBeCloseTo(sfOf(fullInfill, "Thread strip-out").sf, 6);
  });

  it("single-material path (no shell params) is bit-identical to passing null", () => {
    const bare = run({});
    const nulled = run({ wallShellYieldMPa: null, wallShellInterlayerShearMPa: null });
    for (const m of bare) {
      const n = sfOf(nulled, m.mode);
      expect(n.sf).toBe(m.sf);
      expect(n.note).toBe(m.note);
    }
  });

  it("bulk / net-section / shear-out modes are UNCHANGED by the shell selection", () => {
    const blend = run({});
    const wall  = run({ wallShellYieldMPa: SHELL_YIELD, wallShellInterlayerShearMPa: SHELL_SHEAR });
    for (const mode of ["Bulk yield", "Net-section tension", "Shear-out"]) {
      expect(sfOf(wall, mode).sf).toBe(sfOf(blend, mode).sf);
    }
  });
});
