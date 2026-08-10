/**
 * tet-sizing.test.ts — issue #295
 *
 * The STL/TetGen path has been scale-relative since issue #168, but only
 * against an element COUNT. A count is a budget for the WHOLE part, so a large
 * thin plate could spend its elements on plan area and carry two of them
 * through the wall — the same under-resolution the STEP/Gmsh path had, arrived
 * at from the opposite direction. These lock the resolved sizing: count budget,
 * through-thickness floor, one reported overshoot clamp, and parity with the
 * Gmsh path against the same constants.
 *
 * Pure functions, no TetGen or Gmsh binary required.
 */

import { describe, it, expect } from "vitest";
import { tetSizingForTier, tetMaxVolumeForTier } from "../../tetgen.js";
import { gmshSizingForTier } from "../../gmsh_mesh.js";
import {
  MESH_TARGET_ELEMENTS,
  MESH_MAX_BUDGET_OVERSHOOT,
  MIN_ELEMENTS_THROUGH_THICKNESS,
  regularTetEdgeForCount,
  achievedResolution,
} from "../../meshSizing.js";

const box = (dx: number, dy: number, dz: number) =>
  ({ minX: 0, maxX: dx, minY: 0, maxY: dy, minZ: 0, maxZ: dz });

const TIERS = ["coarse", "standard", "fine"] as const;

describe("tetSizingForTier", () => {
  it("meets the through-thickness floor on the plate the count budget under-resolved", () => {
    // 60x30x6 mm plate at the STANDARD tier is the concrete defect: the count
    // budget alone gives 10800/12000 = 0.9 units³ per element, a 1.97 mm
    // regular-tet edge, and 3.0 elements through the 6 mm section.
    const b = box(60, 30, 6);
    const budgetOnly = tetMaxVolumeForTier(60 * 30 * 6, "standard");
    expect(budgetOnly).toBeCloseTo(0.9, 9);
    expect(6 / regularTetEdgeForCount(budgetOnly, 1)).toBeCloseTo(3.047, 2);
    expect(6 / regularTetEdgeForCount(budgetOnly, 1)).toBeLessThan(MIN_ELEMENTS_THROUGH_THICKNESS);

    const s = tetSizingForTier(b, "standard");
    expect(s.thicknessFloorBinding).toBe(true);
    expect(s.budgetClamped).toBe(false);
    expect(s.elementsThroughThickness).toBeGreaterThanOrEqual(MIN_ELEMENTS_THROUGH_THICKNESS - 1e-9);
  });

  it("leaves the count budget alone where it already clears the floor", () => {
    // The same plate at FINE reaches 4.55 through thickness on the budget
    // alone, so the floor must not bind and the historical volume must survive.
    const s = tetSizingForTier(box(60, 30, 6), "fine");
    expect(s.thicknessFloorBinding).toBe(false);
    expect(s.maxVolume).toBeCloseTo(tetMaxVolumeForTier(60 * 30 * 6, "fine"), 12);
    expect(s.elementsThroughThickness).toBeGreaterThan(MIN_ELEMENTS_THROUGH_THICKNESS);
  });

  it("can only refine relative to the historical count budget", () => {
    // The floor is combined with min(), so it is never allowed to COARSEN the
    // mesh — except through the overshoot clamp, which reports itself.
    for (const tier of TIERS) {
      for (const d of [[60, 30, 6], [100, 40, 4], [10, 10, 10], [200, 120, 20], [40, 20, 4]] as const) {
        const s = tetSizingForTier(box(d[0], d[1], d[2]), tier);
        if (s.budgetClamped) continue;
        expect(s.maxVolume).toBeLessThanOrEqual(tetMaxVolumeForTier(d[0] * d[1] * d[2], tier) + 1e-12);
      }
    }
  });

  it("stays scale-invariant — the floor scales with the part (issue #168 preserved)", () => {
    // A floor expressed in elements-across-a-dimension is scale-free by
    // construction; this is the property #168 bought and #295 must not spend.
    for (const tier of TIERS) {
      const counts = [0.1, 1, 10, 100].map((k) => {
        const s = tetSizingForTier(box(60 * k, 30 * k, 6 * k), tier);
        return { predicted: s.predictedElements, through: s.elementsThroughThickness };
      });
      for (const c of counts) {
        expect(c.predicted).toBeCloseTo(counts[0]!.predicted, 6);
        expect(c.through).toBeCloseTo(counts[0]!.through, 9);
      }
    }
  });

  it("reports the overshoot clamp rather than silently building an unsolvable mesh", () => {
    // A large, very thin sheet is the pathological case: the floor demands far
    // more elements than the tier budgets. The clamp must fire, must be
    // reported, and must leave the section BELOW the floor (that is the whole
    // reason it is reported).
    const s = tetSizingForTier(box(400, 400, 1), "coarse");
    expect(s.budgetClamped).toBe(true);
    expect(s.predictedElements).toBeLessThanOrEqual(
      MESH_TARGET_ELEMENTS.coarse * MESH_MAX_BUDGET_OVERSHOOT + 1e-6,
    );
    expect(s.elementsThroughThickness).toBeLessThan(MIN_ELEMENTS_THROUGH_THICKNESS);
  });

  it("falls back to the count budget on a degenerate bbox instead of inventing a size", () => {
    // Includes the non-finite case: `Math.max(NaN, floor)` is NaN, so the floor
    // in tetMaxVolumeForTier has to test finiteness or a malformed STL yields a
    // NaN `-a` switch.
    expect(tetMaxVolumeForTier(NaN, "standard")).toBeGreaterThan(0);
    for (const b of [box(0, 10, 10), box(10, 10, 0), box(NaN, 10, 10)]) {
      const s = tetSizingForTier(b, "standard");
      expect(s.maxVolume).toBeGreaterThan(0);
      expect(s.thicknessFloorBinding).toBe(false);
      expect(s.budgetClamped).toBe(false);
    }
  });

  it("never returns a non-positive volume bound for TetGen -a", () => {
    for (const tier of TIERS) {
      for (const d of [[1e-4, 1e-4, 1e-4], [1e6, 1e6, 1e6], [100, 100, 1e-3]] as const) {
        const s = tetSizingForTier(box(d[0], d[1], d[2]), tier);
        expect(s.maxVolume).toBeGreaterThan(0);
        expect(Number.isFinite(s.maxVolume)).toBe(true);
      }
    }
  });
});

describe("the two mesher paths make the same promise (issue #295)", () => {
  it("agree on elements-through-thickness for the same part and tier", () => {
    // This is the issue in one assertion: "fine" meant 40,000 elements for an
    // STL and 2 mm elements for a STEP. Both paths now resolve the same tier to
    // the same through-thickness resolution, within the tolerance of the two
    // caps being expressed in different units (a volume vs a length).
    for (const tier of TIERS) {
      for (const d of [[60, 30, 6], [100, 40, 4], [40, 20, 4]] as const) {
        const b = box(d[0], d[1], d[2]);
        const tet  = tetSizingForTier(b, tier);
        const gmsh = gmshSizingForTier(b, tier);
        if (tet.budgetClamped || gmsh.budgetClamped) continue;
        // Both clear the floor, which is the promise a tier actually makes.
        expect(tet.elementsThroughThickness).toBeGreaterThanOrEqual(MIN_ELEMENTS_THROUGH_THICKNESS - 1e-9);
        expect(gmsh.elementsThroughThickness).toBeGreaterThanOrEqual(MIN_ELEMENTS_THROUGH_THICKNESS - 1e-9);
      }
    }
  });

  it("size against the same element targets", () => {
    // One definition, re-exported — not two tables that happen to agree today.
    for (const tier of TIERS) {
      expect(tetSizingForTier(box(60, 30, 6), tier).targetElements)
        .toBe(gmshSizingForTier(box(60, 30, 6), tier).targetElements);
      expect(tetSizingForTier(box(60, 30, 6), tier).targetElements)
        .toBe(MESH_TARGET_ELEMENTS[tier]);
    }
  });
});

describe("achievedResolution", () => {
  const b = box(60, 30, 6);

  it("reports what the mesher delivered, not what it was asked for", () => {
    // 30,000 elements in the plate's 10,800 mm³ -> 0.36 mm³ each -> 1.45 mm
    // edge -> 4.1 through the 6 mm section.
    const r = achievedResolution(b, "standard", 30_000, 10_800)!;
    expect(r).not.toBeNull();
    expect(r.achievedElements).toBe(30_000);
    expect(r.targetElements).toBe(MESH_TARGET_ELEMENTS.standard);
    expect(r.budgetRatio).toBeCloseTo(2.5, 9);
    expect(r.elementsThroughThickness).toBeCloseTo(4.14, 1);
    expect(r.belowThroughThicknessFloor).toBe(false);
    expect(r.warning).toBeNull();
  });

  it("flags an under-resolved section even when the element COUNT looks healthy", () => {
    // The failure mode the count alone cannot see: a big thin plate that hits
    // its element target on plan area. 12,000 elements is exactly the standard
    // target, so a budget-only readout reports success.
    const wide = box(400, 400, 3);
    const r = achievedResolution(wide, "standard", 12_000, 400 * 400 * 3)!;
    expect(r.budgetRatio).toBeCloseTo(1.0, 9);
    expect(r.belowThroughThicknessFloor).toBe(true);
    expect(r.warning).toMatch(/thinnest section/);
  });

  it("ranks the section warning above the count warning", () => {
    // Both conditions true at once; the correctness problem must be the one
    // reported, not the budget observation.
    const wide = box(400, 400, 3);
    const r = achievedResolution(wide, "standard", 2_000, 400 * 400 * 3)!;
    expect(r.budgetRatio).toBeLessThan(0.5);
    expect(r.belowThroughThicknessFloor).toBe(true);
    expect(r.warning).toMatch(/thinnest section/);
    expect(r.warning).not.toMatch(/could not honour/);
  });

  it("flags a large count shortfall on a part whose section is fine", () => {
    // A chunky part starved of elements: 2,000 in a 50 mm cube still leaves
    // 6.2 through the section (a cube has no thin direction to under-resolve),
    // so the count warning is the one that applies.
    const cube = box(50, 50, 50);
    const r = achievedResolution(cube, "fine", 2_000, 125_000)!;
    expect(r.belowThroughThicknessFloor).toBe(false);
    expect(r.budgetRatio).toBeLessThan(0.5);
    expect(r.warning).toMatch(/could not honour/);
  });

  it("does not warn about an overshoot — a finer mesh costs time, not truth", () => {
    const r = achievedResolution(b, "coarse", 40_000, 10_800)!;
    expect(r.budgetRatio).toBeGreaterThan(1);
    expect(r.warning).toBeNull();
  });

  it("falls back to the bounding box when no meshed volume is available", () => {
    // Conservative by construction: the bbox is >= the part, so the mean
    // element volume is overestimated and the resolution UNDER-reported.
    const solid = achievedResolution(b, "standard", 20_000, 10_800)!;
    const hollow = achievedResolution(b, "standard", 20_000, 5_400)!;
    const unknown = achievedResolution(b, "standard", 20_000, 0)!;
    expect(unknown.elementsThroughThickness).toBeCloseTo(solid.elementsThroughThickness, 9);
    expect(hollow.elementsThroughThickness).toBeGreaterThan(unknown.elementsThroughThickness);
  });

  it("returns null rather than a bogus report on unusable input", () => {
    expect(achievedResolution(b, "standard", 0, 10_800)).toBeNull();
    expect(achievedResolution(box(10, 10, 0), "standard", 1_000, 0)).toBeNull();
    expect(achievedResolution(b, "standard", NaN, 10_800)).toBeNull();
  });
});
