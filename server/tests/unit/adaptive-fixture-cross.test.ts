/**
 * adaptive-fixture-cross.test.ts — issue #261, the SECOND adaptive fixture.
 *
 * Every adaptive-refinement claim the project has made rests on one part: the
 * Ø5-bore tube in `adaptive-benchmark.test.ts`. That part has one constraint
 * type (a full-bore rigid clamp), one concentration (the bore), an axisymmetric
 * geometry, and — measured while fixing #257 — a governing singularity that is
 * the POINT LOAD rather than the constraint. Calibration derived from a single
 * part is how a constant that is really fixture-specific ends up looking like a
 * physical one, so this file exists to give the load-bearing claims a second
 * data point on a part chosen to differ along the axes that matter.
 *
 * How this part differs, deliberately:
 *
 *   1. NOT A FULL-BORE CLAMP. `findStlBoltConstraintNodes` bounds the clamp's
 *      axial extent to ±2.5·radius about the hole centre. With H = 8 and
 *      r = 1.2 the clamp covers z ∈ [1, 7] of an 8 mm bore, so its rim lies
 *      INSIDE the bore wall rather than at the bore mouth. That is a genuine
 *      partial constraint reached through the existing API — a "partial bearing
 *      arc" would mean implementing #260, which is a physics change this file
 *      has no business making.
 *   2. RE-ENTRANT GEOMETRY. The plus outline has four 270° corners at
 *      (±b, ±b). Unlike the tube's convex outer rim (bounded, ~0.3% of the
 *      error energy) these are genuinely singular, so the error indicator has a
 *      non-BC target to chase.
 *   3. NON-AXISYMMETRIC, so refinement is not spread uniformly by symmetry.
 *   4. DISTRIBUTED LOAD. A surface pressure on the +x arm end face, not a nodal
 *      point force. On the tube the peak sits exactly on the loaded node, which
 *      means its governing singularity is the load application — an axis #261
 *      did not originally list, and the reason the tube cannot demonstrate a
 *      constraint-edge singularity at all.
 *
 * Assertions are inequalities and behavioural facts, never pinned numbers:
 * TetGen's element count is chaotically sensitive to its volume cap (a 2% change
 * in `-a` moved the tube's count 40%, non-monotonically), so pinned values would
 * be brittle for reasons that have nothing to do with the solver. The measured
 * values are recorded in the comments as the calibration this was written
 * against, and printed on every run.
 *
 * COST — measured, 212 s standalone (three uniform tiers at 32k / 45k / 74k
 * elements, plus one capped adaptive run). #261 asks that suite runtime stay
 * within budget or that the increase be justified, so:
 *
 *   • It is a SEPARATE file from adaptive-benchmark.test.ts (~450 s), so under
 *     `npm run test` the two run in parallel rather than in series.
 *   • The adaptive loop is the expensive part. Left uncapped on this part it
 *     re-meshed to 186k then 216k elements; capped at maxElementGrowth 3 /
 *     maxIterations 3 the informative result is still visible (see the
 *     budget-overshoot test), at a fraction of the cost.
 *   • Three uniform tiers rather than two is deliberate and not padding: the
 *     safety-factor swing is NON-MONOTONE, and two points cannot show that.
 *
 * The part cannot simply be scaled down to save more. At a = 5, b = 2.0,
 * r = 1.1, H = 7 the concentration ratio at the clamp rim fell under the
 * detector's 3.0 threshold and `singularity` came back null — losing the one
 * property this fixture exists to provide. See the note on A/B/R/H below.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { runAnalysis, runAdaptiveAnalysis, type AnalysisRequest, type AnalysisResult } from "../../analysis.js";
import { probeTetGen } from "../../tetgen.js";

const probe = await probeTetGen();
if (!probe.found) {
  // eslint-disable-next-line no-console
  console.warn("SKIP: tetgen not found — skipping the #261 second adaptive fixture.");
}

type P3 = [number, number, number];

/**
 * Plus/cross-shaped plate, half-arm-length `a`, half-arm-width `b`, thickness
 * `H`, with a central bore of radius `r`.
 *
 * The outline is star-shaped about the origin, which is what makes the top and
 * bottom faces triangulable as a purely RADIAL strip: each perimeter sample is
 * paired with the bore sample at the SAME polar angle, so the strip quads can
 * never self-intersect regardless of how the perimeter is subdivided. Edges are
 * subdivided so the twelve polygon corners always land exactly on sample
 * points — the four re-entrant ones are the feature under test and must not be
 * rounded off by the sampling.
 */
export function crossPlateSoup(
  a: number, b: number, r: number, H: number, seg: number,
): { positions: Float32Array; triangleCount: number } {
  const corners: Array<[number, number]> = [
    [a, b], [b, b], [b, a], [-b, a], [-b, b], [-a, b],
    [-a, -b], [-b, -b], [-b, -a], [b, -a], [b, -b], [a, -b],
  ];

  const rim: Array<[number, number]> = [];
  for (let i = 0; i < corners.length; i++) {
    const [x0, y0] = corners[i]!;
    const [x1, y1] = corners[(i + 1) % corners.length]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const k = Math.max(1, Math.round(len / seg));
    for (let s = 0; s < k; s++) {
      const t = s / k;
      rim.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }

  const M = rim.length;
  const bore: Array<[number, number]> = rim.map(([x, y]) => {
    const th = Math.atan2(y, x);
    return [r * Math.cos(th), r * Math.sin(th)];
  });

  const tris: P3[][] = [];
  const O = (i: number, z: number): P3 => [rim[i]![0], rim[i]![1], z];
  const I = (i: number, z: number): P3 => [bore[i]![0], bore[i]![1], z];

  for (let i = 0; i < M; i++) {
    const j = (i + 1) % M;
    tris.push([O(i, 0), O(j, 0), O(j, H)], [O(i, 0), O(j, H), O(i, H)]);   // outer wall
    tris.push([I(i, 0), I(j, H), I(j, 0)], [I(i, 0), I(i, H), I(j, H)]);   // bore wall
    tris.push([I(i, H), O(i, H), O(j, H)], [I(i, H), O(j, H), I(j, H)]);   // top
    tris.push([I(i, 0), O(j, 0), O(i, 0)], [I(i, 0), I(j, 0), O(j, 0)]);   // bottom
  }

  const positions = new Float32Array(tris.length * 9);
  tris.forEach((t, ti) => t.forEach((p, k) => p.forEach((v, c) => {
    positions[ti * 9 + k * 3 + c] = v;
  })));
  return { positions, triangleCount: tris.length };
}

/**
 * H > 5r is the whole point: it is what makes the bore clamp PARTIAL. Shrinking
 * this part to save time is not free — at a = 5, b = 2.0, r = 1.1, H = 7 the
 * concentration ratio at the clamp rim fell below the detector's 3.0 threshold
 * and `singularity` came back null, losing the property the fixture exists to
 * exercise. These dimensions are the smallest measured to keep it.
 */
const A = 6, B = 2.5, R = 1.2, H = 8, SEG = 1.0;

function makeRequest(opts: { adaptive?: boolean; quality?: "coarse" | "standard" | "fine" }): AnalysisRequest {
  const { positions, triangleCount } = crossPlateSoup(A, B, R, H, SEG);
  return {
    positions, triangleCount, fileType: "stl",
    bounds: { minX: -A, maxX: A, minY: -A, maxY: A, minZ: 0, maxZ: H },
    holes: [{
      id: 0, centre: [0, 0, H / 2], normal: [0, 0, 1], radius: R,
      confidence: 1, edgeCount: 32, rmsError: 0, maxDeviation: 0,
    }],
    boltHoleIds: [0],
    forces: [],
    pressures: [{ magnitude: 0.5, direction: [1, 0, 0], region: "face" }],
    print: {
      materialId: "pla", infillPct: 100, wallCount: 3,
      pattern: "grid", orientation: "flat", layerHeightMm: 0.2,
    },
    analysis: {
      meshQuality: opts.quality ?? "coarse",
      ...(opts.adaptive ? { adaptiveRefinement: true } : {}),
    },
  };
}

describe.skipIf(!probe.found)("second adaptive fixture: cross plate, partial bore clamp (issue #261)", () => {
  const tiers: Record<string, AnalysisResult> = {};
  let adaptive: AnalysisResult;

  beforeAll(async () => {
    for (const q of ["coarse", "standard", "fine"] as const) {
      tiers[q] = await runAnalysis(makeRequest({ quality: q }));
    }
    adaptive = await runAdaptiveAnalysis(
      makeRequest({ adaptive: true }),
      { maxElementGrowth: 3, maxIterations: 3 },
    );

    const fmt = (r: AnalysisResult): string =>
      `${r.elementCount} el, eta ${((r.globalRelativeError ?? NaN) * 100).toFixed(2)}%, ` +
      `bc ${r.bcSingularityErrorFraction != null ? (r.bcSingularityErrorFraction * 100).toFixed(1) + "%" : "n/a"}, ` +
      `peak ${r.maxVonMisesMPa.toFixed(3)} MPa, SF ${(r.safetyFactor ?? NaN).toFixed(2)}, ` +
      `sing ${r.singularity ? r.singularity.cause : "null"}`;
    // eslint-disable-next-line no-console
    console.log(
      `[#261 cross] coarse: ${fmt(tiers["coarse"]!)}\n` +
      `[#261 cross] standard: ${fmt(tiers["standard"]!)}\n` +
      `[#261 cross] fine: ${fmt(tiers["fine"]!)}\n` +
      `[#261 cross] adaptive: ${fmt(adaptive)}, stop '${adaptive.adaptiveRefinement?.stopReason}', ` +
      `${adaptive.adaptiveRefinement?.initialElementCount}->${adaptive.adaptiveRefinement?.finalElementCount}`,
    );
  }, 1_200_000);

  // ── The property the tube cannot exercise ──────────────────────────────────
  it("produces a CONSTRAINT-EDGE singularity, which the tube fixture never does", () => {
    // #257's one acceptance criterion that could not be closed on a real part:
    // the tube's governing singularity is its point load, so `constraint-edge`
    // was only ever proven against synthetic rim points in a unit test. Here the
    // clamp stops inside the bore and the peak lands on that rim.
    const s = tiers["fine"]!.singularity;
    expect(s, "no singularity flagged — the partial-clamp rim should be singular").not.toBeNull();
    expect(s!.cause).toBe("constraint-edge");
    // The remedy must be the constraint one, not fillet advice.
    expect(s!.message).not.toMatch(/fillet/i);
  });

  it("places the singular peak on the bore wall, not at the loaded face", () => {
    const s = tiers["fine"]!.singularity!;
    const [px, py] = s.peakLocation;
    const radial = Math.hypot(px, py);
    // On the bore wall (r = 1.2), nowhere near the +x loaded arm end at x = 6.
    expect(radial).toBeLessThan(R * 2);
    expect(px).toBeLessThan(A * 0.5);
  });

  // ── #256's swing, on a second part ─────────────────────────────────────────
  it("reproduces a materially mesh-dependent safety factor", () => {
    // Measured: SF 20.91 / 18.64 / 22.16 across coarse/standard/fine — a 18.9%
    // spread, and NON-MONOTONE in element count exactly as the tube's 46% was.
    // Asserted as a floor, not a pinned value: the point is that it is large,
    // and a future change that genuinely stabilises it should fail here loudly
    // rather than pass quietly.
    const sfs = (["coarse", "standard", "fine"] as const)
      .map(q => tiers[q]!.safetyFactor)
      .filter((v): v is number => v != null);
    expect(sfs.length).toBe(3);
    const spread = (Math.max(...sfs) - Math.min(...sfs)) / Math.min(...sfs);
    expect(spread).toBeGreaterThan(0.05);
  });

  it("element count does not predict the safety factor (non-monotone)", () => {
    const seq = (["coarse", "standard", "fine"] as const).map(q => ({
      n: tiers[q]!.elementCount, sf: tiers[q]!.safetyFactor ?? NaN,
    }));
    // Strictly increasing element counts...
    expect(seq[1]!.n).toBeGreaterThan(seq[0]!.n);
    expect(seq[2]!.n).toBeGreaterThan(seq[1]!.n);
    // ...but the SF sequence is not monotone in either direction. If a future
    // change makes it monotone that is a real improvement and worth noticing.
    const up   = seq[0]!.sf <= seq[1]!.sf && seq[1]!.sf <= seq[2]!.sf;
    const down = seq[0]!.sf >= seq[1]!.sf && seq[1]!.sf >= seq[2]!.sf;
    expect(up || down, `SF became monotone (${seq.map(s => s.sf.toFixed(2)).join(" -> ")}) — if intended, update this test`).toBe(false);
  });

  // ── The BC-fraction claim, on a second part ────────────────────────────────
  it("carries a substantial BC error share on every tier", () => {
    // Measured 41.1% / 48.9% / 48.2%. The band dominates the tail here as it
    // does on the tube, which is the part of that story that DOES generalise.
    for (const q of ["coarse", "standard", "fine"] as const) {
      const f = tiers[q]!.bcSingularityErrorFraction;
      expect(f, `${q}: no BC fraction computed`).not.toBeUndefined();
      expect(f!, `${q}`).toBeGreaterThan(0.2);
    }
  });

  it("does NOT reproduce the tube's falling-with-density BC fraction", () => {
    // The tube fell 40.6% -> 33.1% -> 27.7% (and 75.7% -> 48.0% across uniform
    // tiers), which docs/bc-singularity-exclusion.md attributed to the
    // topological band thinning under refinement. On this part it does not fall
    // — measured 41.1% -> 48.9% -> 48.2%, i.e. it RISES from coarse to standard.
    //
    // This is the single-fixture generalisation this file was written to test,
    // and it did not survive. The doc has been corrected to say the direction is
    // fixture-dependent. The caveat that matters — do not read the fraction as a
    // convergence metric across densities — is UNCHANGED and if anything
    // stronger, since it does not even move consistently.
    const f = (["coarse", "standard", "fine"] as const)
      .map(q => tiers[q]!.bcSingularityErrorFraction!);
    const strictlyFalling = f[0]! > f[1]! && f[1]! > f[2]!;
    expect(strictlyFalling, `BC fraction fell monotonically (${f.map(v => (v * 100).toFixed(1)).join("% -> ")}%) — it does not on this part; if this changes, docs/bc-singularity-exclusion.md needs revisiting`).toBe(false);
  });

  // ── Adaptive-loop behaviour ────────────────────────────────────────────────
  it("runs the adaptive loop to a stop reason in the contract", () => {
    const info = adaptive.adaptiveRefinement;
    expect(info).toBeTruthy();
    expect(info!.degradedToTier).toBe(false);
    expect([
      "target-error-reached", "max-iterations", "element-growth-cap",
      "budget-overshoot", "stalled", "remesh-failed", "resolve-failed",
      "no-error-field", "no-refinement-requested", "degraded-to-tier",
    ]).toContain(info!.stopReason);
    // Never reports success on a filtered figure (#259): whatever it stopped on,
    // the reported final error is the TOTAL, and a BC-dominated part must not be
    // able to claim it reached a 3% target.
    if (info!.stopReason === "target-error-reached") {
      expect(info!.finalGlobalError).toBeLessThanOrEqual(0.03 + 1e-9);
    }
  });

  it("cannot take a single refinement step inside a 3x element budget", () => {
    // MEASURED, and a different failure mode from the tube's. The tube spends
    // its full 5 iterations and stops on 'max-iterations'; here the very first
    // size field demands roughly 6x the base count — run uncapped, the first
    // re-mesh emitted 186k elements against a 32k base, and the second 216k —
    // so a 3x budget is overshot before any refined mesh is ever solved. The
    // loop correctly declines to solve an over-budget mesh and returns the tier
    // solve it already had.
    //
    // This is why the file caps the loop rather than running it at the 8x
    // default: at 8x this part is genuinely expensive, and the informative
    // result (the first step wants ~6x) is already visible at 3x. A user who
    // wants adaptivity on a part like this has to raise the budget, and that is
    // worth knowing.
    //
    // If a future change makes the loop able to refine within 3x — a smarter
    // size field, a gentler first step — this test should fail and be updated
    // to record the new behaviour. It is a characterisation, not a requirement.
    const info = adaptive.adaptiveRefinement!;
    expect(info.stopReason).toBe("budget-overshoot");
    expect(info.finalElementCount).toBe(info.initialElementCount);
    // No refined solve happened, so the reported error is the tier solve's.
    expect(info.finalGlobalError).toBeCloseTo(info.initialGlobalError, 12);
  });

  it("stays inside the element budget it was given", () => {
    const info = adaptive.adaptiveRefinement!;
    const budget = info.elementBudget;
    expect(budget, "no element budget reported").toBeTypeOf("number");
    expect(info.finalElementCount).toBeLessThanOrEqual(budget!);
    for (const h of info.history) {
      expect(h.elementCount).toBeLessThanOrEqual(budget!);
    }
  });
});
