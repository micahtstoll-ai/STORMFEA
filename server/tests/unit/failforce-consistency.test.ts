/**
 * failforce-consistency.test.ts
 * ------------------------------
 * Issue #279 / #283 ("Method notes worth keeping"): bearing's `failForceN`
 * used to divide by `bearingStressMult` a second time (sf was measured
 * against the peak bearing stress, F·mult/area, so F·sf already lands on the
 * force at which that peak reaches the allowable — dividing by mult again
 * disagreed with sf and with every other mode's own F·sf). Fixed in PR #287.
 *
 * This is the invariant the bug violated, generalized to a standing gate: for
 * EVERY checked row `checkFailureModes` returns, its own `sf` and
 * `failForceN` must agree with each other and with the force that was
 * actually applied —
 *
 *     |failForceN - appliedForceN * sf| <= 1 N
 *
 * -- one assertion, run across every row from inputs built to exercise all
 * five analytic modes at once (net-section tension, shear-out, thread
 * strip-out, bearing, bulk yield). The 1 N tolerance matches the rounding
 * `checkFailureModes` itself applies (`sf` to 3 decimals, `failForceN` to the
 * nearest N — see server/analysis.ts:428-429 etc.); it is not a slack bound,
 * it is exactly the rounding error the source already introduces.
 */

import { describe, it, expect } from "vitest";
import { checkFailureModes, classifyHole, type FailureModeResult } from "../../analysis.js";

const TOLERANCE_N = 1;

function assertRowsConsistent(appliedForceN: number, modes: FailureModeResult[]) {
  for (const m of modes) {
    if (!m.checked) continue; // an unchecked row is sf=0/failForceN=0 by construction — nothing to relate
    const expected = appliedForceN * m.sf;
    const diff = Math.abs(m.failForceN - expected);
    expect(
      diff,
      `${m.mode}: failForceN=${m.failForceN} should be within ${TOLERANCE_N} N of ` +
        `appliedForceN(${appliedForceN}) * sf(${m.sf}) = ${expected}, was off by ${diff}`,
    ).toBeLessThanOrEqual(TOLERANCE_N);
  }
}

describe("issue #279/#283 — failForceN is consistent with appliedForceN * sf on every checked row", () => {
  it("issue #278's worked example (tapped M6, flat, FDM-interface bulk criterion)", () => {
    // Exact reproduction of the call in issue #278's body: an M6 tapped hole
    // (classifyHole(2.5, 40) resolves to bolt=M6/type=tapped_75 on its own —
    // the explicit overrides just pin the shape down for the reader) with a
    // realistic 200 N load. Exercises all five modes: edgeDistMm=9 > 0 gives
    // Net-section tension, edgeDistMm=9 > d/2=2.5 gives Shear-out, the tapped
    // classification with minorDiamMm gives Thread strip-out, the resolved
    // bolt gives Bearing, and Bulk yield always runs.
    const modes = checkFailureModes({
      holeClass: { ...classifyHole(2.5, 40), type: "tapped_75", minorDiamMm: 5.0 },
      plateThicknessMm: 4,
      edgeDistMm: 9,
      holeSeparationMm: 0,
      appliedForceN: 200,
      effectiveYieldMPa: 39,
      bulkSF: 3.0,
      bulkCriterion: "fdm-interface",
      orientation: "flat",
      layerHeightMm: 0.2,
    });

    const seenModes = new Set(modes.filter((m) => m.checked).map((m) => m.mode));
    expect(seenModes).toEqual(
      new Set(["Bulk yield", "Net-section tension", "Shear-out", "Thread strip-out", "Bearing (hole wall)"]),
    );

    assertRowsConsistent(200, modes);
  });

  it("a second geometry/material combo (upright, hole-separation ligament, cosine-bearing peak, calibrated bearing) — same invariant, different code paths", () => {
    // Deliberately different from the first case in every dimension that
    // changes a formula: holeSeparationMm (not edgeDistMm) drives the
    // net-section ligament, orientation "upright" changes the shear-out base
    // ratio and layerHeightFactor, bearingStressMult > 1 exercises the
    // cosine-bearing peak-stress path that #279 actually broke, and a
    // calibrated bearing strength is supplied so that branch of the bearing
    // check runs too.
    const holeClass = {
      type: "tapped_75" as const,
      bolt: { label: "M6", nominalMm: 6, clearanceClose: 6.4, clearanceFree: 6.6,
               tapDrill75: 5.0, tapDrill50: 5.25, pitch: 1.0, system: "metric" as const },
      detectedDiamMm: 5.0,
      warning: null,
      minorDiamMm: 5.0,
    };

    const modes = checkFailureModes({
      holeClass,
      plateThicknessMm: 8,
      edgeDistMm: 20,
      holeSeparationMm: 12,
      appliedForceN: 1000,
      effectiveYieldMPa: 45,
      bulkSF: 2.4,
      bulkCriterion: "hill",
      orientation: "upright",
      layerHeightMm: 0.28,
      bearingStressMult: 1.35, // cosine-bearing peak concentration — the exact factor #279 double-applied
      calibratedBearingStrMPa: 30,
      interlayerShearMPa: 14,
    });

    const seenModes = new Set(modes.filter((m) => m.checked).map((m) => m.mode));
    expect(seenModes).toEqual(
      new Set(["Bulk yield", "Net-section tension", "Shear-out", "Thread strip-out", "Bearing (hole wall)"]),
    );

    assertRowsConsistent(1000, modes);
  });

  it("bearing's unchecked branch (non-standard hole, no bolt match) is trivially consistent (sf=0, failForceN=0)", () => {
    const modes = checkFailureModes({
      holeClass: { type: "nonstandard", bolt: null, detectedDiamMm: 5.0, warning: "does not match a standard size" },
      plateThicknessMm: 4,
      edgeDistMm: 9,
      holeSeparationMm: 0,
      appliedForceN: 200,
      effectiveYieldMPa: 39,
      bulkSF: 3.0,
      orientation: "flat",
      layerHeightMm: 0.2,
    });

    const bearing = modes.find((m) => m.mode === "Bearing (hole wall)")!;
    expect(bearing.checked).toBe(false);
    expect(bearing.sf).toBe(0);
    expect(bearing.failForceN).toBe(0);

    assertRowsConsistent(200, modes);
  });
});
