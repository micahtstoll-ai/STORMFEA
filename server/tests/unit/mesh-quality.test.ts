/**
 * mesh-quality.test.ts
 * --------------------
 * Scale-invariant mesh-quality classification (issue #165), C3D10 tangling
 * detection (issue #162), and the re-keyed gating semantics (issue #166).
 */

import { describe, it, expect } from "vitest";
import { computeMeshQuality, tetDihedralAnglesDeg } from "../../solver/meshQuality.js";
import { generateBoxMesh } from "../../solver/meshgen.js";
import type { TetMesh } from "../../solver/types.js";

const mk = (nodes: number[], elements: number[], npe: number): TetMesh => ({
  nodes: Float64Array.from(nodes),
  elements: Int32Array.from(elements),
  nodeCount: nodes.length / 3,
  elementCount: elements.length / npe,
  nodesPerElem: npe,
});

// Straight-sided C3D10 tet: corners + exact edge midpoints (EDGE_PAIRS order).
const C3D10_STRAIGHT = [
  2,0,0, 0,2,0, 0,0,2, 0,0,0,
  1,1,0, 0,1,1, 1,0,1, 1,0,0, 0,1,0, 0,0,1,
];
const C3D10_ELEMS = [0,1,2,3,4,5,6,7,8,9];

describe("mesh quality — scale invariance (issue #165)", () => {
  it("same box at 0.1×/1×/10× → identical classification and normalized Jacobian", () => {
    const q01 = computeMeshQuality(generateBoxMesh(0,0,0, 1,1,1, 3,3,3));
    const q1  = computeMeshQuality(generateBoxMesh(0,0,0, 10,10,10, 3,3,3));
    const q10 = computeMeshQuality(generateBoxMesh(0,0,0, 100,100,100, 3,3,3));
    for (const q of [q01, q1, q10]) {
      expect(q.degenerateCount).toBe(0);
      expect(q.poorQualityCount).toBe(0);
    }
    // scaledJacobian is dimensionless → identical to many digits across scales
    expect(q01.worstScaledJacobian).toBeCloseTo(q1.worstScaledJacobian, 10);
    expect(q10.worstScaledJacobian).toBeCloseTo(q1.worstScaledJacobian, 10);
  });

  it("a sub-millimetre well-shaped mesh is NOT flagged (old absolute-mm³ metric would)", () => {
    // Every element here has a tiny volume (~1e-7 mm³) but a perfect shape.
    const q = computeMeshQuality(generateBoxMesh(0,0,0, 0.01,0.01,0.01, 2,2,2));
    expect(q.degenerateCount).toBe(0);
    expect(q.poorQualityCount).toBe(0);
    expect(Math.abs(q.worstScaledJacobian)).toBeGreaterThan(0.1);
  });

  it("a genuine sliver is flagged degenerate at every scale", () => {
    const sliver = [0,0,0, 10,0,0, 5,0.02,0, 5,3,0.01];
    const q1  = computeMeshQuality(mk(sliver, [0,1,2,3], 4));
    const q10 = computeMeshQuality(mk(sliver.map(v => v*10), [0,1,2,3], 4));
    expect(q1.degenerateCount).toBe(1);
    expect(q10.degenerateCount).toBe(1);
    expect(Math.abs(q1.worstScaledJacobian)).toBeCloseTo(Math.abs(q10.worstScaledJacobian), 10);
  });
});

describe("mesh quality — true dihedral range [0,180]° (issue #165)", () => {
  it("regular tetrahedron reports the classic 70.53° dihedral", () => {
    const rt = [1,1,1, 1,-1,-1, -1,1,-1, -1,-1,1];
    const angs = tetDihedralAnglesDeg(
      [rt[0]!,rt[1]!,rt[2]!],[rt[3]!,rt[4]!,rt[5]!],[rt[6]!,rt[7]!,rt[8]!],[rt[9]!,rt[10]!,rt[11]!]);
    for (const a of angs) expect(a).toBeCloseTo(70.5288, 2);
  });

  it("an obtuse sliver reports its true (>90°) dihedral, not the acute supplement", () => {
    const angs = tetDihedralAnglesDeg([0,0,0],[10,0,0],[9,1,0],[5,0.3,0.2]);
    const maxA = Math.max(...angs);
    expect(maxA).toBeGreaterThan(90);   // folded code (min(a,180-a)) would cap at 90
    expect(maxA).toBeLessThanOrEqual(180);
  });
});

describe("mesh quality — degenerate keys on damage, not Jacobian sign (issue #166)", () => {
  it("a mirror-oriented but well-shaped C3D4 element is NOT degenerate", () => {
    // Regular tet with two nodes swapped → negative raw Jacobian, perfect shape.
    const rt = [1,1,1, 1,-1,-1, -1,1,-1, -1,-1,1];
    const q = computeMeshQuality(mk(rt, [0,2,1,3], 4));
    expect(q.degenerateCount).toBe(0);
    expect(Math.abs(q.worstScaledJacobian)).toBeGreaterThan(0.5);
  });
});

describe("mesh quality — C3D10 tangling detection (issue #162)", () => {
  it("a straight C3D10 element is clean", () => {
    const q = computeMeshQuality(mk(C3D10_STRAIGHT, C3D10_ELEMS, 10));
    expect(q.degenerateCount).toBe(0);
    expect(q.tangledCount).toBe(0);
  });

  it("a mildly-curved C3D10 element (small midside offset) stays valid", () => {
    const mild = C3D10_STRAIGHT.slice(); mild[4*3] = 1.2; // 7% edge deviation
    const q = computeMeshQuality(mk(mild, C3D10_ELEMS, 10));
    expect(q.degenerateCount).toBe(0);
    expect(q.tangledCount).toBe(0);
    expect(q.worstElement?.midsideMaxDev ?? 0).toBeGreaterThan(0);
  });

  it("a folded C3D10 element (midside driven far past ¼-edge) is flagged degenerate + tangled", () => {
    const folded = C3D10_STRAIGHT.slice(); folded[4*3] = -3; folded[4*3+1] = -3;
    const q = computeMeshQuality(mk(folded, C3D10_ELEMS, 10));
    expect(q.degenerateCount).toBe(1);
    expect(q.tangledCount).toBe(1);
  });
});
