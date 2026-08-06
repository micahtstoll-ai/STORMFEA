/**
 * mesh-guard-retry.test.ts
 * ------------------------
 * The response to a mesh REJECTED by the C3D10 ordering guard, as distinct from
 * a mesh that failed to GENERATE (issue #265).
 *
 * Before this, both produced a bounding box — a solid block with no bore, no
 * fillets and no stress concentrations, i.e. none of the features the analysis
 * exists to resolve. The rejection was also observed to be transient (once in
 * three otherwise identical suite runs, same binary, same geometry), so the
 * first response should be to try again, not to throw the part away.
 *
 * The mesher is injected, so these pin the LADDER'S POLICY without a binary:
 * how many attempts, at which element order, and what the reader is told.
 */

import { describe, it, expect, vi } from "vitest";
import { meshWithGuardRetry, type MeshOrderDowngrade } from "../../analysis.js";
import { C3D10OrderingError } from "../../c3d10_ordering.js";

/** The guard's rejection, as `verifyC3D10MidsideOrdering` raises it. */
function orderingRejection(): C3D10OrderingError {
  return new C3D10OrderingError("[C3D10 node order] ... 0 affine witnesses ...", {
    affineWitnesses: 0,
    bestElemMaxDev:  0.40,     // the 40%-of-edge-length signature from the report
    source:          "TetGen (-o2, after C3D10_REORDER)",
  });
}

/**
 * A mesher that rejects its first `rejectCount` C3D10 attempts and then
 * succeeds. Records the order requested on every call so the ladder's sequence
 * is observable.
 */
function fakeMesher(rejectCount: number) {
  const orders: (1 | 2)[] = [];
  let c3d10Attempts = 0;
  const attempt = async (order: 1 | 2): Promise<string> => {
    orders.push(order);
    if (order === 2) {
      c3d10Attempts++;
      if (c3d10Attempts <= rejectCount) throw orderingRejection();
      return "c3d10-mesh";
    }
    return "c3d4-mesh";
  };
  return { attempt, orders };
}

describe("guard-rejected mesh — the happy path is untouched (issue #265)", () => {
  it("a mesh that passes the guard is returned from one attempt", async () => {
    const { attempt, orders } = fakeMesher(0);
    const downgrades: MeshOrderDowngrade[] = [];
    const mesh = await meshWithGuardRetry(2, attempt, d => downgrades.push(d));

    expect(mesh).toBe("c3d10-mesh");
    expect(orders).toEqual([2]);      // no speculative retry on success
    expect(downgrades).toHaveLength(0);
  });

  it("a LINEAR request bypasses the ladder entirely", async () => {
    // C3D4 has no midside nodes, so there is no ordering to reject and no
    // reason for this code to be in the path at all.
    const { attempt, orders } = fakeMesher(99);
    const downgrades: MeshOrderDowngrade[] = [];
    const mesh = await meshWithGuardRetry(1, attempt, d => downgrades.push(d));

    expect(mesh).toBe("c3d4-mesh");
    expect(orders).toEqual([1]);
    expect(downgrades).toHaveLength(0);
  });
});

describe("guard-rejected mesh — a transient rejection is retried (issue #265)", () => {
  it("re-meshes once and recovers the full C3D10 analysis", async () => {
    // This is the observed failure: rejected once, fine on a fresh mesh. The
    // old code degraded to a bounding box here and lost every feature.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { attempt, orders } = fakeMesher(1);
    const downgrades: MeshOrderDowngrade[] = [];

    const mesh = await meshWithGuardRetry(2, attempt, d => downgrades.push(d));

    expect(mesh).toBe("c3d10-mesh");
    expect(orders).toEqual([2, 2]);   // rejected, re-meshed, accepted
    expect(downgrades).toHaveLength(0); // nothing was downgraded — order kept
    warn.mockRestore();
  });

  it("retries exactly ONCE — a retry loop would hide a real build mismatch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { attempt, orders } = fakeMesher(99);
    await meshWithGuardRetry(2, attempt, () => {});

    // Two C3D10 attempts, then the linear fallback. Never a third at order 2.
    expect(orders.filter(o => o === 2)).toHaveLength(2);
    warn.mockRestore();
  });
});

describe("guard-rejected mesh — a REPRODUCIBLE rejection keeps the geometry (issue #265)", () => {
  it("falls back to LINEAR elements, not to a bounding box", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { attempt, orders } = fakeMesher(99);
    const downgrades: MeshOrderDowngrade[] = [];

    const mesh = await meshWithGuardRetry(2, attempt, d => downgrades.push(d));

    // The point of the whole change: the part is still the part. A C3D4 tet
    // mesh has the bore and the fillets; the bounding box has neither.
    expect(mesh).toBe("c3d4-mesh");
    expect(orders).toEqual([2, 2, 1]);
    warn.mockRestore();
  });

  it("reports the downgrade with what it costs the reader", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const downgrades: MeshOrderDowngrade[] = [];
    await meshWithGuardRetry(2, fakeMesher(99).attempt, d => downgrades.push(d));

    expect(downgrades).toHaveLength(1);
    const d = downgrades[0]!;
    expect(d.requestedOrder).toBe(2);
    expect(d.actualOrder).toBe(1);
    expect(d.rejectedAttempts).toBe(2);
    expect(d.bestElemMaxDev).toBeCloseTo(0.40, 6);
    // The caveat must name the direction of the error. C3D4 shear-locks in
    // bending, so a silent downgrade would make a part look stiffer and
    // stronger than it is — the dangerous direction for a structural tool.
    expect(d.note).toMatch(/LINEAR/);
    expect(d.note).toMatch(/UNDERPREDICTED/);
    expect(d.note).toMatch(/geometry is intact/);
  });
});

describe("guard-rejected mesh — other failures are NOT retried (issue #265)", () => {
  it("a genuine meshing failure propagates on the first attempt", async () => {
    // "TetGen cannot mesh this geometry" is a property of the INPUT: re-running
    // gets the same refusal, and the caller's box fallback is the right answer.
    // Retrying it would just double the cost of every broken STL.
    const orders: (1 | 2)[] = [];
    const attempt = async (order: 1 | 2): Promise<string> => {
      orders.push(order);
      throw new Error("TetGen failed to mesh this geometry. The STL may have self-intersections.");
    };
    const downgrades: MeshOrderDowngrade[] = [];

    await expect(meshWithGuardRetry(2, attempt, d => downgrades.push(d)))
      .rejects.toThrow(/failed to mesh this geometry/);

    expect(orders).toEqual([2]);        // no retry, no linear fallback
    expect(downgrades).toHaveLength(0);
  });

  it("a non-ordering failure on the RETRY propagates too", async () => {
    // The retry is for the ordering guard only. If the second mesh dies for an
    // unrelated reason, that reason must reach the caller unaltered rather than
    // being reclassified as a build mismatch.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const attempt = async (): Promise<string> => {
      n++;
      if (n === 1) throw orderingRejection();
      throw new Error("out of memory");
    };
    const downgrades: MeshOrderDowngrade[] = [];

    await expect(meshWithGuardRetry(2, attempt, d => downgrades.push(d)))
      .rejects.toThrow(/out of memory/);
    expect(downgrades).toHaveLength(0);
    warn.mockRestore();
  });
});

describe("the guard's error is typed, so callers can tell the two cases apart (issue #265)", () => {
  it("C3D10OrderingError carries the measurement and is an Error", () => {
    const e = orderingRejection();
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(C3D10OrderingError);
    expect(e.name).toBe("C3D10OrderingError");
    expect(e.affineWitnesses).toBe(0);
    expect(e.source).toMatch(/TetGen/);
  });

  it("a plain meshing failure is NOT a C3D10OrderingError", () => {
    expect(new Error("TetGen failed to mesh this geometry")).not.toBeInstanceOf(C3D10OrderingError);
  });
});
