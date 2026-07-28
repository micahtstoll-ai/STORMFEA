/**
 * c3d10-node-order.test.ts
 * ------------------------
 * Unit tests for the runtime C3D10 midside-ordering self-check (issue #167),
 * exercising the pure detection logic without a mesher binary.
 */

import { describe, it, expect } from "vitest";
import {
  analyzeC3D10MidsideOrdering,
  verifyC3D10MidsideOrdering,
  C3D10_MIDSIDE_EDGES,
} from "../../c3d10_ordering.js";

// Straight C3D10 tet in STORMFEA's convention: corners then the 6 edge
// midpoints in slot order 4=mid(0,1),5=mid(1,2),6=mid(0,2),7=mid(0,3),
// 8=mid(1,3),9=mid(2,3).
const CORNERS: [number, number, number][] = [
  [2, 0, 0], [0, 2, 0], [0, 0, 2], [0, 0, 0],
];
function midpoint(a: number, b: number): [number, number, number] {
  const p = CORNERS[a]!, q = CORNERS[b]!;
  return [(p[0]+q[0])/2, (p[1]+q[1])/2, (p[2]+q[2])/2];
}
function buildCorrectMesh(): { nodes: Float64Array; elements: Int32Array } {
  const coords: number[] = [];
  for (const c of CORNERS) coords.push(...c);
  for (const [a, b] of C3D10_MIDSIDE_EDGES) coords.push(...midpoint(a, b));
  return {
    nodes: Float64Array.from(coords),
    elements: Int32Array.from([0,1,2,3,4,5,6,7,8,9]),
  };
}

describe("C3D10 midside ordering — correct mesh accepted (issue #167)", () => {
  it("a correctly-ordered straight element is an affine witness", () => {
    const { nodes, elements } = buildCorrectMesh();
    const a = analyzeC3D10MidsideOrdering(nodes, elements, 1);
    expect(a.ok).toBe(true);
    expect(a.affineWitnesses).toBe(1);
    expect(a.bestElemMaxDev).toBeLessThan(1e-9);
  });

  it("verify does not throw for a correctly-ordered mesh", () => {
    const { nodes, elements } = buildCorrectMesh();
    expect(() => verifyC3D10MidsideOrdering(nodes, elements, 1, 10, "unit")).not.toThrow();
  });

  it("is a no-op for C3D4 meshes (nodesPerElem !== 10)", () => {
    const nodes = Float64Array.from([0,0,0, 1,0,0, 0,1,0, 0,0,1]);
    const elements = Int32Array.from([0,1,2,3]);
    expect(() => verifyC3D10MidsideOrdering(nodes, elements, 1, 4, "unit")).not.toThrow();
  });
});

describe("C3D10 midside ordering — scrambled ordering rejected (issue #167)", () => {
  it("a wrong midside permutation has zero affine witnesses and is rejected", () => {
    const { nodes, elements } = buildCorrectMesh();
    // Cyclically rotate the 6 midside slots → every slot now references the
    // wrong corner pair, mimicking a mesher whose emission order differs.
    const scrambled = Int32Array.from(elements);
    const mids = [4,5,6,7,8,9].map(k => elements[k]!);
    for (let k = 0; k < 6; k++) scrambled[4 + k] = mids[(k + 1) % 6]!;

    const a = analyzeC3D10MidsideOrdering(nodes, scrambled, 1);
    expect(a.affineWitnesses).toBe(0);
    expect(a.bestElemMaxDev).toBeGreaterThan(0.1); // ~half-edge signature
    expect(a.ok).toBe(false);
  });

  it("verify throws an actionable, source-named error on a scrambled mesh", () => {
    const { nodes, elements } = buildCorrectMesh();
    const scrambled = Int32Array.from(elements);
    const t = scrambled[4]!; scrambled[4] = scrambled[9]!; scrambled[9] = t; // swap slot 4 and 9
    expect(() => verifyC3D10MidsideOrdering(nodes, scrambled, 1, 10, "TetGen (unit)"))
      .toThrow(/midside node ordering from TetGen \(unit\) does not match/);
  });
});

describe("C3D10 midside ordering — curved (valid) meshes not false-rejected", () => {
  it("a mildly-curved element paired with an affine interior element passes", () => {
    // Element 0: correctly-ordered straight (affine witness).
    // Element 1: same but with a midside displaced (a curved boundary element).
    const { nodes: n0, elements: e0 } = buildCorrectMesh();
    const coords = Array.from(n0);
    const nodeOffset = coords.length / 3;
    // Duplicate the geometry shifted, then curve one midside.
    for (let i = 0; i < n0.length; i += 3) coords.push(n0[i]! + 10, n0[i+1]!, n0[i+2]!);
    const curvedMidIdx = nodeOffset + 4; // slot-4 midside of element 1
    coords[curvedMidIdx*3] = (coords[curvedMidIdx*3] ?? 0) + 0.15; // 7.5%+ curvature
    const elements = Int32Array.from([
      ...Array.from(e0),
      ...Array.from(e0).map(k => k + nodeOffset),
    ]);
    const a = analyzeC3D10MidsideOrdering(Float64Array.from(coords), elements, 2);
    expect(a.ok).toBe(true);               // the affine witness vouches for the ordering
    expect(a.affineWitnesses).toBeGreaterThanOrEqual(1);
  });
});
