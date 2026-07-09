/**
 * hole-constraint.test.ts
 * -----------------------
 * Regression tests for the STL bolt-constraint node selection (issue #105).
 *
 * The old implementation selected nodes by 2-D radial distance only
 * (0.9r < r_xy < 1.15r) with NO bound along the hole axis: on a tall part,
 * every node whose XY projection landed in the annulus was rigidly fixed,
 * no matter how far it was from the hole. The fix unifies the STL path on
 * the bounded 3-D cylinder test (findHoleWallNodes: axial ±2.5r, radial ±tol).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { findHoleWallNodes, findStlBoltConstraintNodes } from "../../analysis.js";
import type { HoleFeature } from "../../holes.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeHole(over: Partial<HoleFeature> = {}): HoleFeature {
  return {
    id: 0,
    centre: [0, 0, 5],
    normal: [0, 0, 1],
    radius: 2.5,
    confidence: 1,
    edgeCount: 32,
    rmsError: 0.05,
    maxDeviation: 0.1,
    ...over,
  };
}

/**
 * Build a tall test part: rings of nodes at exactly the hole-wall radius
 * around (0,0), stacked from z=0 to z=100 every 2mm, plus some off-ring
 * body nodes. The hole itself is SHORT: centre z=5, radius 2.5 → the bounded
 * cylinder test should only grab rings with |z-5| <= 6.25.
 */
function makeTallPartNodes(radius: number): { nodes: Float64Array; nodeCount: number; ringZ: number[] } {
  const coords: number[] = [];
  const ringZ: number[] = [];
  const RING_N = 8;
  for (let z = 0; z <= 100; z += 2) {
    for (let k = 0; k < RING_N; k++) {
      const th = (2 * Math.PI * k) / RING_N;
      coords.push(radius * Math.cos(th), radius * Math.sin(th), z);
      ringZ.push(z);
    }
  }
  // Off-ring body nodes (far from the hole radially) — never constrained.
  for (let z = 0; z <= 100; z += 10) {
    coords.push(20, 20, z);
    ringZ.push(-1); // marker: not a ring node
  }
  return { nodes: new Float64Array(coords), nodeCount: coords.length / 3, ringZ };
}

/** Old pre-fix behaviour: XY annulus with no axial bound (for count comparison). */
function oldXyAnnulusSelection(
  nodes: Float64Array, nodeCount: number, hx: number, hy: number, r: number,
): number[] {
  const selected: number[] = [];
  for (let n = 0; n < nodeCount; n++) {
    const x = nodes[n*3] ?? 0, y = nodes[n*3+1] ?? 0;
    const radDist = Math.sqrt((x-hx)**2 + (y-hy)**2);
    if (radDist >= r * 0.9 && radDist < r * 1.15) selected.push(n);
  }
  return selected;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("findStlBoltConstraintNodes (issue #105)", () => {
  it("bounds the constraint axially: distant same-XY-ring nodes remain free", () => {
    const hole = makeHole(); // centre z=5, r=2.5 → axial bound ±6.25
    const { nodes, nodeCount, ringZ } = makeTallPartNodes(hole.radius);

    const constrained = new Set(findStlBoltConstraintNodes(nodes, nodeCount, hole));
    expect(constrained.size).toBeGreaterThan(0);

    for (let n = 0; n < nodeCount; n++) {
      const z = ringZ[n]!;
      if (z < 0) {
        // Off-ring body node — must never be constrained
        expect(constrained.has(n)).toBe(false);
      } else if (Math.abs(z - 5) <= hole.radius * 2.5) {
        // Ring node within the bounded cylinder — must be constrained
        expect(constrained.has(n)).toBe(true);
      } else {
        // Ring node far from the hole along its axis — must remain FREE
        expect(constrained.has(n)).toBe(false);
      }
    }
  });

  it("constrains far fewer nodes than the old unbounded XY annulus", () => {
    const hole = makeHole();
    const { nodes, nodeCount } = makeTallPartNodes(hole.radius);

    const oldCount = oldXyAnnulusSelection(nodes, nodeCount, 0, 0, hole.radius).length;
    const newCount = findStlBoltConstraintNodes(nodes, nodeCount, hole).length;

    // Old: all 51 rings × 8 nodes = 408. New: rings with z in [0, 11.25] → 6 rings × 8 = 48.
    expect(oldCount).toBe(408);
    expect(newCount).toBe(48);
    expect(newCount).toBeLessThan(oldCount * 0.2);
  });

  it("handles a non-Z hole axis correctly and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // X-axis hole centred at origin: wall ring in the YZ plane.
    const hole = makeHole({ centre: [0, 0, 0], normal: [1, 0, 0] });
    const coords: number[] = [];
    for (let x = -50; x <= 50; x += 2) {
      for (let k = 0; k < 8; k++) {
        const th = (2 * Math.PI * k) / 8;
        coords.push(x, hole.radius * Math.cos(th), hole.radius * Math.sin(th));
      }
    }
    const nodes = new Float64Array(coords);
    const nodeCount = coords.length / 3;

    const constrained = new Set(findStlBoltConstraintNodes(nodes, nodeCount, hole));
    for (let n = 0; n < nodeCount; n++) {
      const x = nodes[n*3] ?? 0;
      expect(constrained.has(n)).toBe(Math.abs(x) <= hole.radius * 2.5);
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("non-Z axis"));
  });

  it("falls back to Z for a degenerate (zero-length) axis, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const hole = makeHole({ normal: [0, 0, 0] });
    const { nodes, nodeCount, ringZ } = makeTallPartNodes(hole.radius);

    const constrained = new Set(findStlBoltConstraintNodes(nodes, nodeCount, hole));
    // Same result as the Z-axis case
    for (let n = 0; n < nodeCount; n++) {
      const z = ringZ[n]!;
      if (z >= 0 && Math.abs(z - 5) <= hole.radius * 2.5) {
        expect(constrained.has(n)).toBe(true);
      } else {
        expect(constrained.has(n)).toBe(false);
      }
    }
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("degenerate axis"));
  });

  it("falls back to bounded interior nodes when the wall band is empty", () => {
    const hole = makeHole({ centre: [0, 0, 0] });
    // Nodes on the hole axis only (radDist = 0 < 0.9r): z = -20..20
    const coords: number[] = [];
    for (let z = -20; z <= 20; z += 1) coords.push(0, 0, z);
    const nodes = new Float64Array(coords);
    const nodeCount = coords.length / 3;

    const constrained = findStlBoltConstraintNodes(nodes, nodeCount, hole);
    // Axial bound ±6.25 → z in [-6, 6] → 13 nodes
    expect(constrained.length).toBe(13);
    for (const n of constrained) {
      expect(Math.abs(nodes[n*3+2] ?? 0)).toBeLessThanOrEqual(hole.radius * 2.5);
    }
  });

  it("falls back to the single closest node when nothing is inside the cylinder", () => {
    const hole = makeHole({ centre: [0, 0, 0] });
    // All nodes far away from the hole
    const nodes = new Float64Array([50, 50, 50, 60, 60, 60, 70, 70, 70]);
    const constrained = findStlBoltConstraintNodes(nodes, 3, hole);
    expect(constrained).toEqual([0]);
  });
});

describe("findHoleWallNodes", () => {
  it("applies both the axial and radial bounds", () => {
    const hole = makeHole({ centre: [0, 0, 0] });
    const r = hole.radius;
    const nodes = new Float64Array([
      r, 0, 0,        // on wall, at centre plane → in
      r, 0, 6,        // on wall, |t|=6 < 6.25 → in
      r, 0, 7,        // on wall, |t|=7 > 6.25 → out (axial)
      r * 1.3, 0, 0,  // off wall radially → out
      0, 0, 0,        // hole axis → out (radial)
    ]);
    const found = findHoleWallNodes(nodes, 5, hole, r * 0.15);
    expect(found).toEqual([0, 1]);
  });
});
