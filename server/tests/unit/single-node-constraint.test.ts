/**
 * single-node-constraint.test.ts
 * -------------------------------
 * A ONE-NODE constraint fixes three translational DOF and nothing else: the
 * body is free to rotate about every axis through that point. The model is
 * unrestrained and no number from it means anything.
 *
 * `detectUnconstrainedRigidBodyMode` used to return null for it. Its opening
 * guard was `if (constrainedIdx.length < 2) return null` — "I cannot compute an
 * axis" reported as "no problem" — which left the detector NON-MONOTONE in
 * severity:
 *
 *   0 nodes  -> null      (nothing restrained at all)
 *   1 node   -> null      (all three rotations free)
 *   2 nodes  -> DETECTED  (free to spin about the line through them)
 *   3+ spread-> null      (correct; genuinely restrained)
 *
 * It warned about the mild case and stayed silent on the strictly worse ones.
 *
 * This is reachable in production, not a synthetic worry.
 * `findStlBoltConstraintNodes` deliberately falls back to `[closestNode(...)]`
 * — exactly one node — when it cannot find a hole wall, which happens when the
 * mesh is too coarse to place nodes on a small bore. Measured on a Ø2.4 mm bore
 * meshed at 4 797 elements: 1 wall node, peak stress 75 423 MPa, safety factor
 * 0.00, and NO warning of any kind. A user analysing a part with a small
 * fastener hole at a coarse mesh quality gets a catastrophically wrong number
 * that is presented exactly like a correct one.
 *
 * Zero constraints is deliberately still null here — see the note at that guard
 * in analysis.ts. It is a different claim and is caught downstream by a singular
 * system failing to converge.
 */

import { describe, it, expect } from "vitest";
import { detectUnconstrainedRigidBodyMode } from "../../analysis.js";

/** 2x2x2 block of 8 nodes, 2mm apart, spanning [0,2]^3. */
function block(): { nodes: Float64Array; nodeCount: number } {
  const pts: number[] = [];
  for (const z of [0, 2]) for (const y of [0, 2]) for (const x of [0, 2]) pts.push(x, y, z);
  return { nodes: Float64Array.from(pts), nodeCount: 8 };
}

/** Node 7 is the far corner (2,2,2); node 0 is the origin corner. */
const FAR_CORNER = 7;
const load = (fz: number) => [{ nodeIndex: FAR_CORNER, forceN: [0, 0, fz] as [number, number, number] }];

describe("a single constrained node is an unrestrained model", () => {
  const mesh = block();

  it("is DETECTED, where it used to return null", () => {
    const w = detectUnconstrainedRigidBodyMode([{ nodeIndices: [0] }], load(-10), mesh);
    expect(w).not.toBeNull();
    expect(w!.detected).toBe(true);
  });

  it("reports the constrained point itself as the axis point", () => {
    const w = detectUnconstrainedRigidBodyMode([{ nodeIndices: [0] }], load(-10), mesh)!;
    // Node 0 is at the origin.
    expect(w.axisPoint[0]).toBeCloseTo(0, 9);
    expect(w.axisPoint[1]).toBeCloseTo(0, 9);
    expect(w.axisPoint[2]).toBeCloseTo(0, 9);
  });

  it("reports the torque the load actually drives about that point", () => {
    // r = (2,2,2) from node 0, F = (0,0,-10). tau = r x F = (2,2,2) x (0,0,-10)
    //   = (2*-10 - 2*0, 2*0 - 2*-10, 0) = (-20, 20, 0), |tau| = 28.284
    const w = detectUnconstrainedRigidBodyMode([{ nodeIndices: [0] }], load(-10), mesh)!;
    expect(w.drivingTorqueNmm).toBeCloseTo(Math.sqrt(800), 6);
    // Axis is the torque direction, normalised.
    const [ax, ay, az] = w.axisDirection;
    expect(Math.hypot(ax, ay, az)).toBeCloseTo(1, 9);
    expect(ax).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(ay).toBeCloseTo(Math.SQRT1_2, 6);
    expect(az).toBeCloseTo(0, 9);
  });

  it("fires REGARDLESS of how small the driving torque is", () => {
    // Unlike the collinear branch, a one-point constraint is not a borderline
    // modelling choice that a light load makes acceptable. It is an invalid
    // restraint and the result is meaningless at any load.
    for (const fz of [-1000, -1, -1e-6]) {
      const w = detectUnconstrainedRigidBodyMode([{ nodeIndices: [0] }], load(fz), mesh);
      expect(w, `load ${fz} N`).not.toBeNull();
      expect(w!.detected).toBe(true);
    }
  });

  it("fires even with NO load at all, where the torque is exactly zero", () => {
    // Nothing is driving the free modes, but the model is still unrestrained,
    // and a zero torque must not be read as "harmless" the way it is for the
    // collinear case.
    const w = detectUnconstrainedRigidBodyMode([{ nodeIndices: [0] }], [], mesh);
    expect(w).not.toBeNull();
    expect(w!.drivingTorqueNmm).toBe(0);
  });

  it("blames the mesh/hole size, not the user's bolt layout", () => {
    // The actionable cause is almost always a bore too small for the mesh, so
    // the advice must point there rather than at bolt placement (which is what
    // the collinear message says, and would be misleading here).
    const w = detectUnconstrainedRigidBodyMode([{ nodeIndices: [0] }], load(-10), mesh)!;
    expect(w.message).toMatch(/one node/i);
    expect(w.message).toMatch(/finer mesh|too coarse/i);
    expect(w.message).not.toMatch(/reposition one of the existing bolts/i);
  });

  it("counts nodes across ALL constraint sets, not per set", () => {
    // Two separate bolt holes that each degraded to a single fallback node is
    // two points, not one — a different (and less severe) situation, correctly
    // handled by the collinear branch rather than this one.
    const w = detectUnconstrainedRigidBodyMode(
      [{ nodeIndices: [0] }, { nodeIndices: [1] }], load(-10), mesh);
    // Whatever it decides, it must NOT be the single-node message.
    if (w !== null) expect(w.message).not.toMatch(/only one node/i);
  });

  it("leaves genuinely restrained models alone", () => {
    // A well-spread four-node face must stay silent — the fix must not turn
    // into a blanket warning.
    const w = detectUnconstrainedRigidBodyMode(
      [{ nodeIndices: [0, 1, 2, 3] }], load(-10), mesh);
    expect(w).toBeNull();
  });
});
