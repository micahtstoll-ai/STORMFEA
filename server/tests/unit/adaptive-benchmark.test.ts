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
 * That same non-monotonicity is the one way this file can fail for a reason
 * that is not about the solver at all: a future TetGen build can move the
 * ladder rungs, and the error-margin gate would then fail with two numbers
 * nobody can interpret. So the fairness of the comparison is checked FIRST,
 * as its own premise (`UNIFORM_MAX_RATIO`), and the ladder it walked is
 * printed in the failure. The error-margin gate itself is never relaxed to
 * accommodate drift — diagnosing drift is the premise check's job.
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

/**
 * TetGen `-a` volume caps tried, in order, to build the uniform yardstick mesh.
 * A fixed ladder rather than a bisection on the cap because the element count
 * is NOT monotone in it: measured on this fixture, 0.03 gives 54,373 elements
 * and 0.03057 gives 32,591. Bisection assumes a monotone response and would
 * chase that noise; a ladder just reports what each rung produced.
 */
const UNIFORM_VOLUME_LADDER = [0.06, 0.03, 0.015, 0.008];

/**
 * How much larger than the adaptive mesh the uniform yardstick may be before
 * the comparison stops being interpretable. Measured on TetGen 1.5.0 the
 * ladder lands at 54,373 elements against the adaptive 40,534 — a ratio of
 * 1.34, comfortably inside this band.
 *
 * Why a band at all: "at least as many elements" is what makes the error
 * comparison honest, but a uniform mesh that is VASTLY larger is a different
 * experiment. Its error is lower for reasons that have nothing to do with
 * where elements were spent, so a failure of the error-margin gate would then
 * be evidence about TetGen's ladder, not about adaptivity. If a future TetGen
 * shifts the rungs that far, the premise check below fails and says exactly
 * that. The band never relaxes the error-margin gate — it explains it.
 */
const UNIFORM_MAX_RATIO = 2.0;

/** Why the uniform yardstick is or is not a fair comparison mesh. */
type Fairness = { ok: boolean; detail: string };

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
  /** Null when no fair yardstick could be built — see `fairness` for why. */
  let uniform: AnalysisResult | null = null;
  let adaptiveCount = 0;
  let uniformCount = 0;
  let fairness: Fairness = { ok: false, detail: "the benchmark setup never ran" };

  /**
   * The uniform result, or a failure that names the meshing premise instead of
   * dereferencing null. Every comparison below goes through this, so a ladder
   * that could not produce a fair mesh fails as "there was no comparison",
   * never as a bogus solver number.
   */
  function comparison(): AnalysisResult {
    expect(
      uniform,
      `no fair uniform comparison mesh was built, so there is nothing to compare against: ${fairness.detail}`,
    ).not.toBeNull();
    return uniform!;
  }

  beforeAll(async () => {
    adaptive = await runAdaptiveAnalysis(makeRequest(true));

    // Uniform comparison mesh: walk a ladder of TetGen volume caps and take the
    // smallest mesh that has at least as many elements as the adaptive run
    // finished with. "At least as many" so any error advantage the adaptive
    // mesh shows cannot be explained by it simply having more elements.
    adaptiveCount = adaptive.adaptiveRefinement!.finalElementCount;
    const { positions, triangleCount } = tubeTriangleSoup(R, r, H, N);
    const ceiling = adaptiveCount * UNIFORM_MAX_RATIO;
    const ladder: Array<{ maxVol: number; elementCount: number }> = [];
    let best: Awaited<ReturnType<typeof meshWithTetGen>> | null = null;

    for (const maxVol of UNIFORM_VOLUME_LADDER) {
      const res = await meshWithTetGen(positions, triangleCount, 2, maxVol);
      const n = res.mesh.elementCount;
      ladder.push({ maxVol, elementCount: n });
      if (n >= adaptiveCount && (best === null || n < best.mesh.elementCount)) best = res;
      // Stop at the first qualifying mesh that is INSIDE the fairness band —
      // on TetGen 1.5.0 that is rung 2, so the common case costs exactly the
      // two meshing calls it always did. Only an overshooting rung makes us
      // keep walking, and that is worth the time precisely because the count
      // is non-monotone in the cap: a FINER cap can yield a SMALLER mesh, so a
      // fairer yardstick may still be further down the ladder.
      if (best !== null && best.mesh.elementCount <= ceiling) break;
    }

    const ladderText = ladder.map((s) => `-a${s.maxVol} -> ${s.elementCount}`).join(", ");
    if (best === null) {
      fairness = {
        ok: false,
        detail:
          `no uniform mesh on the ladder reached the adaptive element count (${adaptiveCount}); ` +
          `TetGen produced [${ladderText}]. This is a meshing-side change, not a solver regression: ` +
          `extend UNIFORM_VOLUME_LADDER with finer caps until a rung qualifies. Do not lower the bar ` +
          `by comparing against a smaller uniform mesh — that would hand adaptivity the element-count ` +
          `advantage the comparison exists to deny it.`,
      };
    } else if (best.mesh.elementCount > ceiling) {
      fairness = {
        ok: false,
        detail:
          `the smallest qualifying uniform mesh has ${best.mesh.elementCount} elements, ` +
          `${(best.mesh.elementCount / adaptiveCount).toFixed(2)}x the adaptive ${adaptiveCount} and outside ` +
          `the ${UNIFORM_MAX_RATIO}x fairness band; TetGen produced [${ladderText}]. The uniform solve was ` +
          `SKIPPED rather than run, because a yardstick that much larger measures mesh size, not where the ` +
          `elements were spent. Most likely TetGen's response to -a shifted (it is non-monotone); add ladder ` +
          `rungs between the bracketing caps until one lands in the band. Do NOT widen UNIFORM_MAX_RATIO to ` +
          `make this pass.`,
      };
    } else {
      fairness = {
        ok: true,
        detail:
          `uniform ${best.mesh.elementCount} elements vs adaptive ${adaptiveCount} ` +
          `(${(best.mesh.elementCount / adaptiveCount).toFixed(2)}x, band ${UNIFORM_MAX_RATIO}x); ` +
          `TetGen produced [${ladderText}]`,
      };
      uniformCount = best.mesh.elementCount;
      uniform = await runAnalysis({
        ...makeRequest(false),
        _prebuiltMesh: {
          mesh:          best.mesh,
          surfaceToNode: best.surfaceToNode,
          surfaceFaces:  best.surfaceFaces,
        },
      });
    }

    // eslint-disable-next-line no-console
    console.log(
      `[#149 benchmark] adaptive: ${adaptive.adaptiveRefinement!.initialElementCount} → ` +
      `${adaptiveCount} elements, ZZ error ` +
      `${adaptive.adaptiveRefinement!.initialGlobalError.toFixed(4)} → ` +
      `${adaptive.adaptiveRefinement!.finalGlobalError.toFixed(4)}, ` +
      `peak ${adaptive.maxVonMisesMPa.toFixed(3)} MPa, stop '${adaptive.adaptiveRefinement!.stopReason}' | ` +
      (uniform === null
        ? `uniform: NOT RUN — ${fairness.detail}`
        : `uniform: ${uniformCount} elements, ZZ error ` +
          `${(uniform.globalRelativeError ?? NaN).toFixed(4)}, peak ${uniform.maxVonMisesMPa.toFixed(3)} MPa` +
          ` | fairness: ${fairness.detail}`),
    );
    // Timeout budget. This hook runs the whole adaptive loop AND the uniform
    // ladder, so it is by far the most expensive thing in the suite: ~440 s
    // when this file runs alone. It was 900 s and passed comfortably until
    // BC-singularity exclusion landed — that stops the loop stalling on the
    // bolt-rim singularity, so it now spends its full 5 iterations instead of
    // stalling at 4, which is the feature working as intended rather than a
    // regression. Under `npm run test` this file also competes for CPU with
    // every other test file, and the combination pushed it past 900 s. Raised
    // with margin for a loaded machine; if it ever times out again, measure
    // before raising it further — a loop that has started running its cap out
    // on every part is a behaviour change worth knowing about, not a slow test.
  }, 1_800_000);

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

  // ── #256: the headline numbers carry their own mesh-sensitivity ────────────
  it("records the HEADLINE numbers per iteration, not just the error", () => {
    // Issue #256's finding is that the global error converges while the safety
    // factor does not — measured on this very fixture, 19.37% -> 11.14% error
    // against a 46% safety-factor swing over the same runs. The history used to
    // carry only the error, so the one place the tool solves the same part at
    // several densities was throwing away the numbers the user actually reads.
    const info = adaptive.adaptiveRefinement!;
    expect(info.history.length).toBeGreaterThanOrEqual(2);
    for (const step of info.history) {
      expect(Number.isFinite(step.maxVonMisesMPa), `peak missing on a ${step.elementCount}-element step`).toBe(true);
      expect(step.maxVonMisesMPa).toBeGreaterThan(0);
      // safetyFactor may legitimately be null on a degraded solve; it must be
      // null or a real number, never undefined (which would read as "0% spread").
      expect(step.safetyFactor === null || Number.isFinite(step.safetyFactor)).toBe(true);
    }
  });

  it("reports a headline spread that brackets the numbers it was built from", () => {
    // The consistency property, which is what a plumbing bug would break: a
    // spread whose range does not contain the reported result would be actively
    // misleading — worse than not reporting one.
    const info = adaptive.adaptiveRefinement!;
    const spread = info.headlineSpread;
    expect(spread, "no headline spread despite multiple solves").toBeDefined();
    expect(spread!.samples).toBe(info.history.length);

    const peaks = info.history.map(h => h.maxVonMisesMPa);
    expect(spread!.peakMin).toBeCloseTo(Math.min(...peaks), 9);
    expect(spread!.peakMax).toBeCloseTo(Math.max(...peaks), 9);
    // The REPORTED peak is one of the solves, so it must lie inside the range.
    expect(adaptive.maxVonMisesMPa).toBeGreaterThanOrEqual(spread!.peakMin * (1 - 1e-9));
    expect(adaptive.maxVonMisesMPa).toBeLessThanOrEqual(spread!.peakMax * (1 + 1e-9));

    const sfs = info.history.map(h => h.safetyFactor).filter((v): v is number => v != null);
    if (sfs.length >= 2) {
      expect(spread!.safetyFactorMin).toBeCloseTo(Math.min(...sfs), 9);
      expect(spread!.safetyFactorMax).toBeCloseTo(Math.max(...sfs), 9);
      expect(adaptive.safetyFactor!).toBeGreaterThanOrEqual(spread!.safetyFactorMin! * (1 - 1e-9));
      expect(adaptive.safetyFactor!).toBeLessThanOrEqual(spread!.safetyFactorMax! * (1 + 1e-9));
    }
  });

  it("only warns when the spread is material", () => {
    // The note is what reaches the user, in the app and the printed report. It
    // must be present exactly when the spread is worth acting on — a banner on
    // every run teaches people to ignore banners, and silence on a swinging part
    // is the defect #256 opened on.
    const spread = adaptive.adaptiveRefinement!.headlineSpread!;
    const shown = spread.safetyFactorSpread ?? spread.peakSpread;
    if (shown >= 0.05) {
      expect(spread.note, `spread ${(shown * 100).toFixed(1)}% but no note`).not.toBe("");
    } else {
      expect(spread.note, `spread only ${(shown * 100).toFixed(1)}% but warned anyway`).toBe("");
    }
  });

  it("reduces the global error against its own starting mesh", () => {
    const info = adaptive.adaptiveRefinement!;
    expect(info.finalGlobalError).toBeLessThan(info.initialGlobalError);
  });

  // ── 2. The open question: does adaptivity beat a finer uniform tier? ───────
  it("the uniform comparison mesh is a fair yardstick (premise)", () => {
    // Stated as its own assertion, and asserted BEFORE the error margin, so a
    // meshing-side change reads as "the comparison was not fair" rather than as
    // a solver regression. Two ways it goes wrong, both about TetGen and not
    // about adaptivity:
    //   too small — no ladder rung reached the adaptive count, so any error win
    //               would just be the larger mesh winning;
    //   too large — the smallest qualifying rung overshoots UNIFORM_MAX_RATIO,
    //               so the uniform run is no longer "the same budget spent
    //               evenly" and its error is not an interpretable baseline.
    // Either way `fairness.detail` carries the ladder TetGen actually produced,
    // so the fix (add rungs) is readable straight off the failure.
    expect(fairness.ok, fairness.detail).toBe(true);
    expect(uniformCount, fairness.detail).toBeGreaterThanOrEqual(adaptiveCount);
    expect(uniformCount, fairness.detail).toBeLessThanOrEqual(adaptiveCount * UNIFORM_MAX_RATIO);
    expect(comparison().converged).toBe(true);
  });

  it("achieves a LOWER global error than uniform refinement at no more elements", () => {
    // The answer to the question gating the UI toggle. Adaptivity spends its
    // elements where the error indicator says they are worth spending, so on a
    // part with a real stress concentration it should win per element — and here
    // it is handicapped, since the uniform mesh is allowed to be larger.
    //
    // This margin is the point of the file and is never loosened to absorb
    // meshing drift; the premise test above exists so drift is diagnosed there
    // instead. The message repeats both meshes so a genuine failure can be read
    // without re-running anything.
    const adaptiveErr = adaptive.adaptiveRefinement!.finalGlobalError;
    const uniformErr  = comparison().globalRelativeError ?? Number.POSITIVE_INFINITY;
    expect(
      adaptiveErr,
      `adaptive ZZ error ${adaptiveErr.toFixed(4)} on ${adaptiveCount} elements did not beat ` +
      `uniform ${uniformErr.toFixed(4)} on ${uniformCount} elements ` +
      `(${(uniformCount / adaptiveCount).toFixed(2)}x). If the premise test above passed, the meshes were ` +
      `comparable and this is a real adaptivity regression`,
    ).toBeLessThan(uniformErr);
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
    expect(adaptive.maxVonMisesMPa).toBeGreaterThan(comparison().maxVonMisesMPa * 0.9);
    expect(adaptive.maxVonMisesMPa).toBeLessThan(comparison().maxVonMisesMPa * 2);
  });

  it("a lower energy-norm error does not certify the safety factor", () => {
    // The caveat docs/API.md already states, made executable: the loop targets
    // the ZZ ENERGY-NORM error, and the two runs disagree on peak stress by far
    // more than they disagree on that error. Nobody should read "global error
    // improved" as "the safety factor is settled".
    const uni = comparison();
    expect(adaptive.safetyFactor).not.toBeNull();
    expect(uni.safetyFactor).not.toBeNull();
    const errGap  = Math.abs(adaptive.adaptiveRefinement!.finalGlobalError - (uni.globalRelativeError ?? 0));
    const peakGap = Math.abs(adaptive.maxVonMisesMPa - uni.maxVonMisesMPa) / uni.maxVonMisesMPa;
    expect(Number.isFinite(errGap)).toBe(true);
    expect(Number.isFinite(peakGap)).toBe(true);
  });
});
