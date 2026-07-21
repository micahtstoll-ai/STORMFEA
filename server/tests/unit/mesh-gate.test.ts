/**
 * mesh-gate.test.ts
 * -----------------
 * Issue #166: the pre-assembly quality gate must key on what predicts solution
 * damage — scale-invariant sliver/aspect metrics and the conditioning proxy plus
 * the C3D10 fold flags — NOT the raw Jacobian sign. A handful (<5%) of extreme
 * slivers must block; a mirror-oriented well-shaped mesh must pass; and the
 * failure message must name the worst elements' coordinates.
 */

import { describe, it, expect } from "vitest";
import { computeMeshQuality, formatHardViolations, isHardViolation, HARD_AR } from "../../solver/meshQuality.js";
import { generateBoxMesh } from "../../solver/meshgen.js";
import type { TetMesh } from "../../solver/types.js";

describe("#166 hard gate blocks real accuracy killers, not sign", () => {
  it("a few extreme slivers (<5%) are hard violations", () => {
    const mesh = generateBoxMesh(0, 0, 0, 10, 10, 10, 3, 3, 3); // 135 elements
    const n = 3;
    for (let e = 0; e < n; e++) mesh.elements[e * 4 + 3] = mesh.elements[e * 4]!;
    const q = computeMeshQuality(mesh);
    expect(q.hardViolationCount).toBe(n);
    expect(q.hardViolationCount / q.totalElements).toBeLessThan(0.05);
  });

  it("a mirror-oriented well-shaped mesh has ZERO hard violations", () => {
    const mesh = generateBoxMesh(0, 0, 0, 10, 10, 10, 2, 2, 2);
    for (let e = 0; e < mesh.elementCount; e++) {
      const i = e * 4;
      const a = mesh.elements[i + 1]!, b = mesh.elements[i + 2]!;
      mesh.elements[i + 1] = b; mesh.elements[i + 2] = a; // reflect: negates sign, keeps shape
    }
    const q = computeMeshQuality(mesh);
    expect(q.hardViolationCount).toBe(0);
    expect(q.degenerateCount).toBe(0);
    // Raw signed Jacobian IS negative (mirror) — proving the gate ignores sign.
    expect(q.worstJacobianMin).toBeLessThan(0);
  });

  it("a catastrophic aspect ratio is a hard violation independent of scale", () => {
    // A needle: one very long edge, otherwise fine.
    const needle: TetMesh = {
      nodes: new Float64Array([0, 0, 0, 1000, 0, 0, 0, 1, 0, 0, 0, 1]),
      elements: new Int32Array([0, 1, 2, 3]),
      nodeCount: 4, elementCount: 1, nodesPerElem: 4,
    };
    const q = computeMeshQuality(needle);
    expect(q.worstAspectRatio).toBeGreaterThan(HARD_AR);
    expect(q.hardViolationCount).toBe(1);
    expect(isHardViolation(q.worstElement!)).toBe(true);
  });
});

describe("#166 actionable message names worst-element coordinates", () => {
  it("lists element ids, mm coordinates, and a physical reason", () => {
    const mesh = generateBoxMesh(0, 0, 0, 10, 10, 10, 3, 3, 3);
    for (let e = 0; e < 4; e++) mesh.elements[e * 4 + 3] = mesh.elements[e * 4]!;
    const q = computeMeshQuality(mesh);
    const msg = formatHardViolations(q);
    expect(msg).toContain("Mesh quality error");
    expect(msg).toMatch(/element \d+ at \(-?\d+\.\d+, -?\d+\.\d+, -?\d+\.\d+\) mm/);
    expect(msg.toLowerCase()).toContain("sliver");
  });
});
