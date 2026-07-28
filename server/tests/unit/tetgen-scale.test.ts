/**
 * tetgen-scale.test.ts — issue #168.
 * ----------------------------------
 * STL files carry no units. The TetGen import path used to hard-code a fixed
 * weld tolerance (1e-6 unit) and a fixed default element volume (10 mm³), so a
 * metre- or inch-scale STL silently meshed at the wrong effective resolution.
 * Both are now derived from the model's bounding box, which these tests pin:
 *
 *   1. weldVertices topology is SCALE- and POSITION-invariant (same triangle
 *      soup scaled ×k or translated welds to the same vertices/faces).
 *   2. weldVertices still merges coincident duplicates and keeps genuinely
 *      distinct mm-scale vertices apart (backward-compatible behaviour).
 *   3. targetElementVolume reproduces the historical ~10 mm³ for the canonical
 *      50 mm cube (mm backward-compat) and scales as ×k³ so the element COUNT
 *      is unit-independent for a given shape.
 *   4. unitScaleWarning fires only outside a plausible mm range.
 */

import { describe, it, expect } from "vitest";
import { weldVertices, targetElementVolume, unitScaleWarning } from "../../tetgen.js";

// A little closed triangle soup: two triangles sharing an edge → 6 vertex slots
// but only 4 unique welded vertices. Shared-edge vertices are byte-identical, so
// they must weld at every scale.
function twoTriSoup(scale: number, tx = 0, ty = 0, tz = 0): { pos: Float32Array; triCount: number } {
  const v = (x: number, y: number, z: number) => [x * scale + tx, y * scale + ty, z * scale + tz];
  const p = [
    ...v(0, 0, 0), ...v(1, 0, 0), ...v(0, 1, 0),   // tri A
    ...v(1, 0, 0), ...v(1, 1, 0), ...v(0, 1, 0),   // tri B (shares edge 1-0 / 0-1)
  ];
  return { pos: new Float32Array(p), triCount: 2 };
}

describe("weldVertices — scale/position invariance (issue #168)", () => {
  it("welds the shared edge to 4 unique vertices at every scale and offset", () => {
    for (const s of [1, 1000, 0.0254, 1e-3]) {
      const { pos, triCount } = twoTriSoup(s);
      const w = weldVertices(pos, triCount);
      expect(w.vertCount).toBe(4);       // 6 slots → 4 unique
      expect(w.triCount).toBe(2);
    }
  });

  it("produces identical connectivity for mm vs a ×10 (and translated) copy", () => {
    const mm  = twoTriSoup(1);
    const big = twoTriSoup(10, 500, -300, 42);   // scaled AND shifted far off-origin
    const wA = weldVertices(mm.pos, mm.triCount);
    const wB = weldVertices(big.pos, big.triCount);
    expect(wB.vertCount).toBe(wA.vertCount);
    // Face index arrays (the topology) must match exactly — welding groups the
    // same slots regardless of scale/position.
    expect(Array.from(wB.faces)).toEqual(Array.from(wA.faces));
    expect(Array.from(wB.slotToWeld)).toEqual(Array.from(wA.slotToWeld));
  });
});

describe("weldVertices — mm backward-compatible merging (issue #168)", () => {
  it("merges byte-coincident duplicate vertices but keeps 0.1 mm-apart vertices distinct", () => {
    // One triangle (~10 mm), plus a second triangle whose first vertex is an
    // EXACT duplicate of the first triangle's first vertex, and whose other two
    // vertices are a clear 0.1 mm away from anything else.
    const pos = new Float32Array([
      0, 0, 0,   10, 0, 0,   0, 10, 0,        // tri 1
      0, 0, 0,   5, 0.1, 0,   5, 5, 0,        // tri 2 — vertex 0 duplicates tri1 vertex 0
    ]);
    const w = weldVertices(pos, 2);
    // 6 slots, one exact duplicate collapsed → 5 unique vertices.
    expect(w.vertCount).toBe(5);
    expect(w.slotToWeld[0]).toBe(w.slotToWeld[3]); // the coincident pair welded together
  });
});

describe("targetElementVolume — mm backward-compat + scale invariance (issue #168)", () => {
  it("reproduces the historical ~10 mm³ default for the canonical 50 mm cube (standard)", () => {
    const v = targetElementVolume(50, 50, 50, "standard");
    // diag = 86.6 mm, edge = 86.6/22 = 3.94 mm, V ≈ h³/6 ≈ 10.2 mm³.
    expect(v).toBeGreaterThan(9);
    expect(v).toBeLessThan(11.5);
  });

  it("orders the tiers coarse > standard > fine", () => {
    const c = targetElementVolume(50, 50, 50, "coarse");
    const s = targetElementVolume(50, 50, 50, "standard");
    const f = targetElementVolume(50, 50, 50, "fine");
    expect(c).toBeGreaterThan(s);
    expect(s).toBeGreaterThan(f);
  });

  it("scales as ×k³ under a ×k geometry scaling (⇒ same element count for same shape)", () => {
    for (const q of ["coarse", "standard", "fine"] as const) {
      const v1  = targetElementVolume(50, 30, 20, q);
      const v10 = targetElementVolume(500, 300, 200, q);
      // bbox volume scales ×1000; if maxVol also scales ×1000 the element count
      // (bboxVol / maxVol) is identical → unit-independent resolution.
      expect(v10 / v1).toBeCloseTo(1000, 3);
    }
  });
});

describe("unitScaleWarning (issue #168)", () => {
  it("stays silent for plausible mm-scale parts", () => {
    expect(unitScaleWarning(50)).toBeNull();
    expect(unitScaleWarning(1.5)).toBeNull();
    expect(unitScaleWarning(500)).toBeNull();
  });
  it("warns for sub-millimetre (likely metres) and huge (likely inches/other) diagonals", () => {
    expect(unitScaleWarning(0.08)).toContain("millimetres");   // 80 mm exported in metres
    expect(unitScaleWarning(5000)).toContain("millimetres");
  });
});
