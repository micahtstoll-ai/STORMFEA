/**
 * c3d10-fold.test.ts
 * ------------------
 * Issue #162: an inverted/tangled curved C3D10 element must NOT be silently
 * accepted. buildB_c3d10 threw only on |detJ| < 1e-15, so a negative detJ (a
 * mapping folded by bad midside placement) slipped through and was integrated
 * with Math.abs(detJ) — contributing wrong-but-positive stiffness.
 *
 * Locks:
 *   1. A valid straight-sided C3D10 has all-positive Gauss detJ (integration is
 *      bit-identical: Math.abs(detJ) is a no-op) and is classified normal, with
 *      curved-element metrics present in the report.
 *   2. A midside node displaced enough to fold the mapping is flagged by BOTH
 *      element-level detection (c3d10GaussDetJ shows a sign flip) AND the quality
 *      report (curvedFolded / degenerate / hard violation).
 *   3. A gross midside displacement that the 4 interior Gauss points happen not
 *      to sample is still caught by the midside-offset screen.
 *   4. C3D4 elements carry no curved metrics (undefined).
 */

import { describe, it, expect } from "vitest";
import { computeMeshQuality, MIDSIDE_FOLD } from "../../solver/meshQuality.js";
import { c3d10GaussDetJ } from "../../solver/element.js";
import type { TetMesh } from "../../solver/types.js";

// Valid straight-sided C3D10 (STORMFEA midside ordering: 4=mid01,5=mid12,
// 6=mid02, 7=mid03, 8=mid13, 9=mid23).
const VALID: number[] = [
  2, 0, 0,  0, 2, 0,  0, 0, 2,  0, 0, 0,
  1, 1, 0,  0, 1, 1,  1, 0, 1,  1, 0, 0,  0, 1, 0,  0, 0, 1,
];

function mesh10(coords: number[]): TetMesh {
  return {
    nodes: new Float64Array(coords),
    elements: new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    nodeCount: 10,
    elementCount: 1,
    nodesPerElem: 10,
  };
}

function withNode(base: number[], node: number, xyz: [number, number, number]): number[] {
  const c = base.slice();
  c[node * 3] = xyz[0]; c[node * 3 + 1] = xyz[1]; c[node * 3 + 2] = xyz[2];
  return c;
}

describe("#162 valid C3D10 is accepted and bit-identical", () => {
  it("all Gauss detJ are positive ⇒ Math.abs(detJ) is a no-op for integration", () => {
    const detJ = c3d10GaussDetJ(new Float64Array(VALID));
    expect(detJ.length).toBe(4);
    for (const d of detJ) expect(d).toBeGreaterThan(0);
  });

  it("classified normal with curved metrics present in the report", () => {
    const q = computeMeshQuality(mesh10(VALID));
    expect(q.worstElement).not.toBeNull();
    expect(q.worstElement!.severity).toBe("normal");
    expect(q.worstElement!.curvedFolded).toBe(false);
    expect(q.curvedFoldedCount).toBe(0);
    expect(q.hardViolationCount).toBe(0);
    // Curved-element metrics are reported for C3D10.
    expect(typeof q.worstElement!.minGaussDetJ).toBe("number");
    expect(q.worstElement!.maxMidsideOffset).toBeCloseTo(0, 10);
  });
});

describe("#162 folded C3D10 flagged by element-level detection AND the report", () => {
  // Midside node 4 pulled to (0.1,0.1,0.1): the quadratic mapping inverts near
  // two Gauss points (mixed-sign detJ) while the midside offset stays below the
  // fold screen — so this exercises the Gauss-detJ path specifically.
  const foldedByGauss = withNode(VALID, 4, [0.1, 0.1, 0.1]);

  it("element-level: c3d10GaussDetJ has both signs (the mapping folds)", () => {
    const detJ = Array.from(c3d10GaussDetJ(new Float64Array(foldedByGauss)));
    expect(Math.min(...detJ)).toBeLessThan(0);
    expect(Math.max(...detJ)).toBeGreaterThan(0);
  });

  it("quality report: degenerate, curvedFolded, hard violation, via the Gauss path", () => {
    const q = computeMeshQuality(mesh10(foldedByGauss));
    expect(q.curvedFoldedCount).toBe(1);
    expect(q.degenerateCount).toBe(1);
    expect(q.hardViolationCount).toBe(1);
    expect(q.worstElement!.severity).toBe("degenerate");
    expect(q.worstElement!.curvedFolded).toBe(true);
    expect(q.worstElement!.minGaussDetJ).toBeLessThanOrEqual(0);
    // Proves this is the Gauss-detJ path, not the geometric midside screen.
    expect(q.worstElement!.maxMidsideOffset).toBeLessThan(MIDSIDE_FOLD);
  });
});

describe("#162 gross midside displacement caught by the offset screen", () => {
  // Node 4 pushed far along the edge line: all Gauss detJ stay one sign (the 4
  // interior points miss the inverted pocket) but the node is past half its edge
  // length, so the midside screen flags the tangle.
  const foldedByMidside = withNode(VALID, 4, [2.2, 2.2, 0]);

  it("all Gauss detJ share a sign yet the element is flagged folded", () => {
    const detJ = Array.from(c3d10GaussDetJ(new Float64Array(foldedByMidside)));
    const allPos = detJ.every((d) => d > 0);
    const allNeg = detJ.every((d) => d < 0);
    expect(allPos || allNeg).toBe(true); // Gauss path would NOT catch this
    const q = computeMeshQuality(mesh10(foldedByMidside));
    expect(q.worstElement!.maxMidsideOffset).toBeGreaterThanOrEqual(MIDSIDE_FOLD);
    expect(q.worstElement!.curvedFolded).toBe(true);
    expect(q.worstElement!.severity).toBe("degenerate");
    expect(q.hardViolationCount).toBe(1);
  });
});

describe("#162 C3D4 carries no curved metrics", () => {
  it("linear tets leave curvedFolded/minGaussDetJ/maxMidsideOffset undefined", () => {
    const c3d4: TetMesh = {
      nodes: new Float64Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
      elements: new Int32Array([0, 1, 2, 3]),
      nodeCount: 4,
      elementCount: 1,
      nodesPerElem: 4,
    };
    const q = computeMeshQuality(c3d4);
    expect(q.worstElement!.curvedFolded).toBeUndefined();
    expect(q.worstElement!.minGaussDetJ).toBeUndefined();
    expect(q.worstElement!.maxMidsideOffset).toBeUndefined();
    expect(q.curvedFoldedCount).toBe(0);
  });
});
