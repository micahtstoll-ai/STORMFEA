/**
 * delamination-dfm.test.ts
 * ------------------------
 * Locks for computeDelaminationDFM (feature #5) — the interface-aware design
 * advice. Advisory only; these pin the classification and the grounded strength
 * ratio: (a) through-layer tension → "tension" sub-mode, ~0° traction, gain =
 * yieldXY/S_zt; (b) through-layer shear → "shear" sub-mode, ~90° traction, gain
 * = yieldXY/S_zs; (c) the flat-orientation branch adds the upright hint.
 */

import { describe, it, expect } from "vitest";
import { computeDelaminationDFM } from "../../analysis.js";

const YXY = 50, YZ = 29, YZS = YZ / Math.sqrt(3);

describe("computeDelaminationDFM", () => {
  it("pure through-layer tension → tension sub-mode, ~0° traction, yieldXY/S_zt gain", () => {
    const d = computeDelaminationDFM(20, 0, 0, YXY, YZ, YZS, "flat");
    expect(d.governingSubMode).toBe("tension");
    expect(d.interfaceLoadAngleDeg).toBeCloseTo(0, 1);
    expect(d.inPlaneGainX).toBeCloseTo(YXY / YZ, 2);
    expect(d.currentOrientation).toBe("flat");
    // flat branch adds the upright hint
    expect(d.suggestions.length).toBeGreaterThanOrEqual(2);
    expect(d.suggestions.join(" ")).toMatch(/upright|on-edge/i);
  });

  it("pure interlayer shear → shear sub-mode, ~90° traction, yieldXY/S_zs gain", () => {
    const d = computeDelaminationDFM(0, 8, 0, YXY, YZ, YZS, "upright");
    expect(d.governingSubMode).toBe("shear");
    expect(d.interfaceLoadAngleDeg).toBeCloseTo(90, 1);
    expect(d.inPlaneGainX).toBeCloseTo(YXY / YZS, 2);
    expect(d.suggestions.join(" ")).toMatch(/wall/i);
  });

  it("compression with shear routes to the shear sub-mode (interface does not open)", () => {
    const d = computeDelaminationDFM(-15, 6, 0, YXY, YZ, YZS, "flat");
    expect(d.governingSubMode).toBe("shear");
    // szz clamped at 0 for the angle → pure sliding
    expect(d.interfaceLoadAngleDeg).toBeCloseTo(90, 1);
  });

  it("mixed state picks the larger interface utilization as the sub-mode", () => {
    // tension util = 20/29 = 0.69; shear util = 5/16.7 = 0.30 → tension wins
    const d = computeDelaminationDFM(20, 5, 0, YXY, YZ, YZS, "angled");
    expect(d.governingSubMode).toBe("tension");
    expect(d.interfaceLoadAngleDeg).toBeGreaterThan(0);
    expect(d.interfaceLoadAngleDeg).toBeLessThan(90);
  });
});
