/**
 * mesh-quality-scale.test.ts
 * --------------------------
 * Issue #165: mesh-quality metrics must be SCALE-INVARIANT and report the TRUE
 * dihedral over [0,180].
 *
 * Locks:
 *   1. The same physical element classified identically at 0.1×/1×/10×.
 *   2. A genuine sliver is flagged at every scale; a small (sub-mm) well-shaped
 *      element is flagged at none — the old raw-mm³ Jacobian did the reverse.
 *   3. An obtuse (>90°) near-flat sliver reports its true, near-180° dihedral
 *      (the old |n1·n2| + min(a,180−a) collapse capped it at 90°).
 *   4. worstJacobianMin is not capped at its old init value of 1.
 */

import { describe, it, expect } from "vitest";
import { computeMeshQuality, HARD_SLIVER_NJ } from "../../solver/meshQuality.js";
import type { TetMesh } from "../../solver/types.js";

function tet(coords: number[]): TetMesh {
  return {
    nodes: new Float64Array(coords),
    elements: new Int32Array([0, 1, 2, 3]),
    nodeCount: 4,
    elementCount: 1,
    nodesPerElem: 4,
  };
}

function scaleCoords(coords: number[], s: number): number[] {
  return coords.map((c) => c * s);
}

// Regular tetrahedron, edge = 1 (well-shaped: normalizedJacobian ≈ 1).
const REGULAR: number[] = [
  0, 0, 0,
  1, 0, 0,
  0.5, Math.sqrt(3) / 2, 0,
  0.5, Math.sqrt(3) / 6, Math.sqrt(2 / 3),
];

// Planar unit square as a tet with one corner nudged out of plane by 0.02:
// a genuine flat sliver whose diagonal-edge dihedral is ≈178° (obtuse).
const OBTUSE_SLIVER: number[] = [
  0, 0, 0,
  1, 0, 0,
  1, 1, 0,
  0, 1, 0.02,
];

describe("#165 scale-invariant normalized Jacobian", () => {
  it("regular tet has normalizedJacobian ≈ 1 and is normal", () => {
    const q = computeMeshQuality(tet(REGULAR));
    expect(q.worstElement === null || q.worstElement.severity === "normal").toBe(true);
    const el = computeMeshQuality(tet(REGULAR));
    expect(el.worstNormalizedJacobian).toBeCloseTo(1, 6);
    expect(el.normalCount).toBe(1);
  });

  it("classification is identical at 0.1×, 1×, 10× (well-shaped)", () => {
    const scales = [0.1, 1, 10];
    const njs: number[] = [];
    for (const s of scales) {
      const q = computeMeshQuality(tet(scaleCoords(REGULAR, s)));
      expect(q.normalCount).toBe(1);
      expect(q.degenerateCount).toBe(0);
      njs.push(q.worstNormalizedJacobian);
    }
    // normalizedJacobian numerically identical across scales
    expect(njs[1]).toBeCloseTo(njs[0]!, 10);
    expect(njs[2]).toBeCloseTo(njs[0]!, 10);
  });

  it("a genuine sliver is flagged (degenerate) at every scale", () => {
    for (const s of [0.1, 1, 10, 100]) {
      const q = computeMeshQuality(tet(scaleCoords(OBTUSE_SLIVER, s)));
      expect(q.degenerateCount).toBe(1);
      expect(q.worstNormalizedJacobian).toBeLessThan(HARD_SLIVER_NJ);
    }
  });

  it("a small (sub-mm) well-shaped element is flagged at NO scale", () => {
    // 0.05 mm regular tet — the old raw-mm³ metric flagged this for being small.
    for (const s of [0.02, 0.05, 0.1]) {
      const q = computeMeshQuality(tet(scaleCoords(REGULAR, s)));
      expect(q.normalCount).toBe(1);
      expect(q.poorQualityCount).toBe(0);
      expect(q.degenerateCount).toBe(0);
    }
  });
});

describe("#165 true dihedral over [0,180]", () => {
  it("obtuse sliver reports its true near-180° dihedral, not the acute complement", () => {
    const q = computeMeshQuality(tet(OBTUSE_SLIVER));
    // Old collapse min(a,180−a) could never exceed 90°.
    expect(q.worstMaxDihedralDeg).toBeGreaterThan(90);
    expect(q.worstMaxDihedralDeg).toBeGreaterThan(175);
    expect(q.worstMaxDihedralDeg).toBeLessThanOrEqual(180);
  });

  it("obtuse dihedral is scale-invariant", () => {
    const a = computeMeshQuality(tet(scaleCoords(OBTUSE_SLIVER, 0.1))).worstMaxDihedralDeg;
    const b = computeMeshQuality(tet(scaleCoords(OBTUSE_SLIVER, 10))).worstMaxDihedralDeg;
    expect(a).toBeCloseTo(b, 8);
  });

  it("regular tet dihedral ≈ 70.53° (arccos 1/3)", () => {
    const q = computeMeshQuality(tet(REGULAR));
    const expected = (Math.acos(1 / 3) * 180) / Math.PI;
    expect(q.worstMinDihedralDeg).toBeCloseTo(expected, 4);
    expect(q.worstMaxDihedralDeg).toBeCloseTo(expected, 4);
  });
});

describe("#165 worstJacobianMin init fix", () => {
  it("does not cap at the old init value of 1 for a large element", () => {
    // Regular tet edge 10 → 6V ≈ 707, far above the old init of 1.
    const q = computeMeshQuality(tet(scaleCoords(REGULAR, 10)));
    expect(q.worstJacobianMin).toBeGreaterThan(100);
  });
});
