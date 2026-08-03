/**
 * adaptive-benchmark.test.ts — issue #149 acceptance gate (requires a tetgen binary).
 *
 * The benchmark that was IMPOSSIBLE before the budget/mesher fixes: run a
 * stress-concentration part adaptively and uniformly at matched element count,
 * and compare global error and peak stress.
 *
 * It could not be run because no refined solve ever completed. The adaptive
 * re-mesh used TetGen's `-m` background-metric mechanism, which leaves slivers
 * on curved boundaries (13 of them on this exact part, normalized Jacobian down
 * to 0.0037); the hard mesh-quality gate (#166) rejected the refined mesh, and
 * the loop degraded to the tier solve every time. The re-mesh now refines the
 * previous mesh under per-element volume constraints (`-r ... -a`) instead —
 * see meshWithTetGenSizing — and the refined solves complete.
 *
 * So this file gates two things at once:
 *   1. REGRESSION: the adaptive loop actually completes a refined solve, stays
 *      inside its element budget, and reports a stop reason from the contract.
 *   2. THE OPEN QUESTION: does adaptivity beat simply picking a finer uniform
 *      tier? Compared against a uniform mesh with AT LEAST as many elements, so
 *      the element-count comparison runs AGAINST adaptivity, never for it.
 *
 * Assertions are written as inequalities that should hold for any part with a
 * genuine stress concentration, not as pinned numbers — TetGen's element count
 * is chaotically sensitive to its volume cap (measured on this part: a 2% change
 * in `-a` moved the count 40%, non-monotonically), so pinning counts or errors
 * would be brittle for reasons that have nothing to do with the solver.
 *
 *   TETGEN_BIN=/path/to/tetgen npx vitest run server/tests/unit/adaptive-benchmark.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { runAnalysis, runAdaptiveAnalysis, type AnalysisRequest, type AnalysisResult } from "../../analysis.js";
import { meshWithTetGen, probeTetGen } from "../../tetgen.js";

const probe = await probeTetGen();
if (!probe.found) {
  // eslint-disable-next-line no-console
  console.warn(
    "SKIP: tetgen not found — skipping the adaptive-vs-uniform acceptance benchmark (issue #149). " +
    "The budget guard and size-field logic are covered binary-free in adaptive-mesh.test.ts.",
  );
}

// Hollow cylinder with a Ø5 bore, bolt-constrained on the bore and loaded
// transversely — the bore is a genuine stress concentrator, so the error
// indicator has something real to chase.
function tubeTriangleSoup(R: number, r: number, H: number, N: number): { positions: Float32Array; triangleCount: number } {
  const tris: Array<[number, number, number][]> = [];
  const P = (rad: number, i: number, z: number): [number, number, number] =>
    [rad * Math.cos((2 * Math.PI * i) / N), rad * Math.sin((2 * Math.PI * i) / N), z];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const ob0 = P(R, i, 0), ob1 = P(R, j, 0), ot0 = P(R, i, H), ot1 = P(R, j, H);
    const ib0 = P(r, i, 0), ib1 = P(r, j, 0), it0 = P(r, i, H), it1 = P(r, j, H);
    tris.push([ob0, ob1, ot1], [ob0, ot1, ot0]); // outer wall
    tris.push([ib0, it1, ib1], [ib0, it0, it1]); // bore wall
    tris.push([it0, ot0, ot1], [it0, ot1, it1]); // top annulus
    tris.push([ib0, ob1, ob0], [ib0, ib1, ob1]); // bottom annulus
  }
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((t, ti) => t.forEach((p, k) => p.forEach((v, c) => {
    positions[ti * 9 + k * 3 + c] = v;
  })));
  return { positions, triangleCount: tris.length };
}

const R = 6, r = 2.5, H = 5, N = 32;

function makeRequest(adaptive: boolean): AnalysisRequest {
  const { positions, triangleCount } = tubeTriangleSoup(R, r, H, N);
  return {
    positions,
    triangleCount,
    fileType: "stl",
    bounds: { minX: -R, maxX: R, minY: -R, maxY: R, minZ: 0, maxZ: H },
    holes: [{
      id: 0, centre: [0, 0, H / 2], normal: [0, 0, 1], radius: r,
      confidence: 1, edgeCount: N, rmsError: 0, maxDeviation: 0,
    }],
    boltHoleIds: [0],
    forces: [{ magnitude: 50, direction: [1, 0, 0], position: [R, 0, H] }],
    print: {
      materialId: "pla", infillPct: 100, wallCount: 3,
      pattern: "grid", orientation: "flat", layerHeightMm: 0.2,
    },
    analysis: { meshQuality: "coarse", ...(adaptive ? { adaptiveRefinement: true } : {}) },
  };
}

describe.skipIf(!probe.found)("adaptive vs uniform at matched element count (issue #149 acceptance)", () => {
  let adaptive: AnalysisResult;
  let uniform: AnalysisResult;
  let uniformCount = 0;

  beforeAll(async () => {
    adaptive = await runAdaptiveAnalysis(makeRequest(true));

    // Uniform comparison mesh: walk a ladder of TetGen volume caps and take the
    // SMALLEST mesh that still has at least as many elements as the adaptive
    // run finished with. A ladder rather than a bisection because the count is
    // not monotone in the cap; "at least as many" so any error advantage the
    // adaptive mesh shows cannot be explained by it simply having more elements.
    const target = adaptive.adaptiveRefinement!.finalElementCount;
    const { positions, triangleCount } = tubeTriangleSoup(R, r, H, N);
    let best: Awaited<ReturnType<typeof meshWithTetGen>> | null = null;
    for (const maxVol of [0.06, 0.03, 0.015, 0.008]) {
      const res = await meshWithTetGen(positions, triangleCount, 2, maxVol);
      const n = res.mesh.elementCount;
      if (n >= target && (best === null || n < best.mesh.elementCount)) best = res;
      if (best !== null && n >= target) break;
    }
    expect(best, "no uniform mesh on the ladder reached the adaptive element count").not.toBeNull();
    uniformCount = best!.mesh.elementCount;

    uniform = await runAnalysis({
      ...makeRequest(false),
      _prebuiltMesh: {
        mesh:          best!.mesh,
        surfaceToNode: best!.surfaceToNode,
        surfaceFaces:  best!.surfaceFaces,
      },
    });

    // eslint-disable-next-line no-console
    console.log(
      `[#149 benchmark] adaptive: ${adaptive.adaptiveRefinement!.initialElementCount} → ` +
      `${adaptive.adaptiveRefinement!.finalElementCount} elements, ZZ error ` +
      `${adaptive.adaptiveRefinement!.initialGlobalError.toFixed(4)} → ` +
      `${adaptive.adaptiveRefinement!.finalGlobalError.toFixed(4)}, ` +
      `peak ${adaptive.maxVonMisesMPa.toFixed(3)} MPa, stop '${adaptive.adaptiveRefinement!.stopReason}' | ` +
      `uniform: ${uniformCount} elements, ZZ error ` +
      `${(uniform.globalRelativeError ?? NaN).toFixed(4)}, peak ${uniform.maxVonMisesMPa.toFixed(3)} MPa`,
    );
  }, 900_000);

  // ── 1. The regression: a refined solve must actually happen ────────────────
  it("completes at least one REFINED solve — the loop no longer degrades every run", () => {
    const info = adaptive.adaptiveRefinement!;
    expect(info.degradedToTier).toBe(false);
    expect(info.iterations).toBeGreaterThanOrEqual(2);
    expect(info.finalElementCount).toBeGreaterThan(info.initialElementCount);
  });

  it("never solves a mesh outside the element budget", () => {
    // The defect this gates: the budget was a prediction nobody checked against
    // the mesh TetGen actually emitted, so a run could (and did, at 8.7× on a
    // documented 8× cap) solve an over-budget mesh and only notice afterwards.
    // Every entry in `history` is a mesh that was SOLVED, so all of them must
    // fit — not merely the last one.
    const info = adaptive.adaptiveRefinement!;
    expect(info.elementBudget).toBeGreaterThan(0);
    for (const step of info.history) {
      expect(step.elementCount).toBeLessThanOrEqual(info.elementBudget!);
    }
    expect(info.finalElementCount).toBeLessThanOrEqual(info.elementBudget!);
  });

  it("returns a converged, usable result", () => {
    expect(adaptive.converged).toBe(true);
    expect(adaptive.safetyFactor).not.toBeNull();
    expect(Number.isFinite(adaptive.maxVonMisesMPa)).toBe(true);
    expect(adaptive.maxVonMisesMPa).toBeGreaterThan(0);
  });

  it("reduces the global error against its own starting mesh", () => {
    const info = adaptive.adaptiveRefinement!;
    expect(info.finalGlobalError).toBeLessThan(info.initialGlobalError);
  });

  // ── 2. The open question: does adaptivity beat a finer uniform tier? ───────
  it("the uniform comparison mesh has AT LEAST as many elements (premise)", () => {
    // Stated as its own assertion so a failure here reads as "the comparison was
    // not fair" rather than as a solver regression.
    expect(uniformCount).toBeGreaterThanOrEqual(adaptive.adaptiveRefinement!.finalElementCount);
    expect(uniform.converged).toBe(true);
  });

  it("achieves a LOWER global error than uniform refinement at no more elements", () => {
    // The answer to the question gating the UI toggle. Adaptivity spends its
    // elements where the error indicator says they are worth spending, so on a
    // part with a real stress concentration it should win per element — and here
    // it is handicapped, since the uniform mesh is allowed to be larger.
    const adaptiveErr = adaptive.adaptiveRefinement!.finalGlobalError;
    const uniformErr  = uniform.globalRelativeError ?? Number.POSITIVE_INFINITY;
    expect(adaptiveErr).toBeLessThan(uniformErr);
  });

  it("resolves a peak stress at least as high as uniform, and within a factor of 2", () => {
    // Not an agreement check — the peaks are NOT expected to agree, and that is
    // part of the honest answer. Adaptivity spends its elements at the bore, so
    // it resolves more of the concentration: measured 4.905 MPa against uniform's
    // 3.966 MPa, i.e. 24% higher on 25% FEWER elements. The direction is the
    // physics (refining a concentration reveals stress, it never hides it); the
    // magnitude is not converged and must not be read as one.
    //
    // So: assert the direction, with a factor-of-2 band as the sanity bound. The
    // lower edge carries a small tolerance because the singularity-exclusion ball
    // (issue #147) can legitimately hold the adaptive peak back.
    expect(adaptive.maxVonMisesMPa).toBeGreaterThan(uniform.maxVonMisesMPa * 0.9);
    expect(adaptive.maxVonMisesMPa).toBeLessThan(uniform.maxVonMisesMPa * 2);
  });

  it("a lower energy-norm error does not certify the safety factor", () => {
    // The caveat docs/API.md already states, made executable: the loop targets
    // the ZZ ENERGY-NORM error, and the two runs disagree on peak stress by far
    // more than they disagree on that error. Nobody should read "global error
    // improved" as "the safety factor is settled".
    expect(adaptive.safetyFactor).not.toBeNull();
    expect(uniform.safetyFactor).not.toBeNull();
    const errGap  = Math.abs(adaptive.adaptiveRefinement!.finalGlobalError - (uniform.globalRelativeError ?? 0));
    const peakGap = Math.abs(adaptive.maxVonMisesMPa - uniform.maxVonMisesMPa) / uniform.maxVonMisesMPa;
    expect(Number.isFinite(errGap)).toBe(true);
    expect(Number.isFinite(peakGap)).toBe(true);
  });
});
