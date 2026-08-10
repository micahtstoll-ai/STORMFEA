/**
 * gmsh-sizing.test.ts — issue #295
 *
 * The STEP/Gmsh path sized itself in absolute millimetres while the STL/TetGen
 * path sized itself scale-relatively against an element-count target, so a mesh
 * tier meant two different things depending on how the part arrived. These lock
 * the resolved sizing: scale-relative, floored on the thinnest section, and
 * never coarser than the historical absolute value except through the reported
 * overshoot clamp.
 *
 * Pure function, no Gmsh binary required.
 */

import { describe, it, expect } from "vitest";
import {
  gmshSizingForTier,
  GMSH_TIER_ABSOLUTE,
  GMSH_TARGET_ELEMENTS,
  GMSH_MAX_BUDGET_OVERSHOOT,
  MIN_ELEMENTS_THROUGH_THICKNESS,
} from "../../gmsh_mesh.js";

const box = (dx: number, dy: number, dz: number) =>
  ({ minX: 0, maxX: dx, minY: 0, maxY: dy, minZ: 0, maxZ: dz });

describe("gmshSizingForTier", () => {
  it("never returns a clMax coarser than the tier's absolute cap (unclamped)", () => {
    // The three bounds are combined with min(), so absolute is an upper bound.
    for (const tier of ["coarse", "standard", "fine"] as const) {
      for (const d of [[100, 40, 8], [50, 20, 5], [10, 10, 10], [200, 120, 20]] as const) {
        const s = gmshSizingForTier(box(d[0], d[1], d[2]), tier);
        if (s.budgetClamped) continue;         // the clamp is allowed to coarsen
        expect(s.clMax).toBeLessThanOrEqual(GMSH_TIER_ABSOLUTE[tier].clMax + 1e-12);
      }
    }
  });

  it("meets the through-thickness floor on a thin plate, where the absolute cap did not", () => {
    // 100 x 40 x 4 mm plate. The historical fine clMax of 2.0 mm gives 2
    // elements through the 4 mm wall; the floor requires MIN_ELEMENTS.
    const s = gmshSizingForTier(box(100, 40, 4), "fine");
    expect(4 / GMSH_TIER_ABSOLUTE.fine.clMax).toBeLessThan(MIN_ELEMENTS_THROUGH_THICKNESS);
    expect(s.elementsThroughThickness).toBeGreaterThanOrEqual(MIN_ELEMENTS_THROUGH_THICKNESS - 1e-9);
  });

  it("refines a SMALL part that the absolute cap under-resolved outright", () => {
    // A 10 mm cube at the fine absolute clMax of 2.0 mm is a handful of
    // elements. The count budget must pull clMax well below the absolute.
    const s = gmshSizingForTier(box(10, 10, 10), "fine");
    expect(s.clMax).toBeLessThan(GMSH_TIER_ABSOLUTE.fine.clMax);
    // and land within the overshoot band of the tier target
    expect(s.predictedElements).toBeGreaterThan(GMSH_TARGET_ELEMENTS.fine / 8);
  });

  it("keeps the absolute cap binding on a large part, so small features stay resolved", () => {
    // On a big part the count budget alone would permit a coarser element than
    // the tier's absolute cap; the cap is what preserves fillet/bore resolution
    // there. 100x40x20 is large enough that hBudget (2.57 mm) exceeds the fine
    // cap of 2.0 mm, and small enough that the overshoot clamp does not fire.
    const s = gmshSizingForTier(box(100, 40, 20), "fine");
    expect(s.budgetClamped).toBe(false);
    expect(s.clMax).toBeCloseTo(GMSH_TIER_ABSOLUTE.fine.clMax, 12);
  });

  it("clamps a pathological geometry to the overshoot ceiling and reports it", () => {
    // Large AND thin: the thickness floor demands far more elements than the
    // budget wants. The clamp must fire, be reported, and respect the ceiling.
    const s = gmshSizingForTier(box(400, 400, 2), "fine");
    expect(s.budgetClamped).toBe(true);
    expect(s.predictedElements).toBeLessThanOrEqual(
      GMSH_TARGET_ELEMENTS.fine * GMSH_MAX_BUDGET_OVERSHOOT * 1.0001,
    );
  });

  it("orders the tiers monotonically: coarser tier, coarser or equal element", () => {
    const dims = box(100, 40, 8);
    const c = gmshSizingForTier(dims, "coarse");
    const s = gmshSizingForTier(dims, "standard");
    const f = gmshSizingForTier(dims, "fine");
    expect(c.clMax).toBeGreaterThanOrEqual(s.clMax);
    expect(s.clMax).toBeGreaterThanOrEqual(f.clMax);
    expect(c.predictedElements).toBeLessThanOrEqual(s.predictedElements);
    expect(s.predictedElements).toBeLessThanOrEqual(f.predictedElements);
  });

  it("is scale-relative: geometrically similar parts get similar element counts", () => {
    // The defect being fixed. Absolute sizing made the count scale with volume;
    // scale-relative sizing keeps it roughly constant across a 4x size range,
    // as long as the absolute cap is not the binding bound.
    const small = gmshSizingForTier(box(25, 10, 5), "fine");
    const big   = gmshSizingForTier(box(100, 40, 20), "fine");
    const ratio = big.predictedElements / small.predictedElements;
    expect(ratio).toBeGreaterThan(1 / 8);
    expect(ratio).toBeLessThan(8);
    // Under the OLD absolute sizing the same pair differed by the volume ratio,
    // which is 4^3 = 64x — far outside the band asserted above.
  });

  it("keeps clMin strictly below clMax", () => {
    for (const d of [[100, 40, 8], [10, 10, 10], [400, 400, 2], [3, 3, 3]] as const) {
      for (const tier of ["coarse", "standard", "fine"] as const) {
        const s = gmshSizingForTier(box(d[0], d[1], d[2]), tier);
        expect(s.clMin).toBeLessThan(s.clMax);
        expect(s.clMin).toBeGreaterThan(0);
      }
    }
  });

  it("falls back to the absolute sizing on a degenerate bbox rather than inventing one", () => {
    for (const d of [[0, 40, 8], [100, 40, 0], [-1, 5, 5]] as const) {
      const s = gmshSizingForTier(box(d[0], d[1], d[2]), "fine");
      expect(s.clMin).toBe(GMSH_TIER_ABSOLUTE.fine.clMin);
      expect(s.clMax).toBe(GMSH_TIER_ABSOLUTE.fine.clMax);
      expect(s.budgetClamped).toBe(false);
    }
  });

  it("carries clCurv through unchanged — curvature refinement is not the defect", () => {
    for (const tier of ["coarse", "standard", "fine"] as const) {
      expect(gmshSizingForTier(box(100, 40, 8), tier).clCurv)
        .toBe(GMSH_TIER_ABSOLUTE[tier].clCurv);
    }
  });

  it("returns finite, positive sizing for every tier on a representative bracket", () => {
    for (const tier of ["coarse", "standard", "fine"] as const) {
      const s = gmshSizingForTier(box(80, 40, 6), tier);
      expect(Number.isFinite(s.clMax)).toBe(true);
      expect(Number.isFinite(s.predictedElements)).toBe(true);
      expect(s.clMax).toBeGreaterThan(0);
      expect(s.predictedElements).toBeGreaterThan(0);
      expect(s.targetElements).toBe(GMSH_TARGET_ELEMENTS[tier]);
    }
  });
});
