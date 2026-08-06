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
import { meshWithTetGen, probeTetGen } from "../../tetgen.js";

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

/**
 * Explicit TetGen volume caps rather than the coarse/standard/fine tiers.
 *
 * The tiers are NOT reproducible enough for a bore this small. Run under
 * `npm run test` the coarse tier produced a 4 797-element mesh where the same
 * request standalone produced 32 377, and at that density the Ø2.4 mm bore had
 * exactly ONE node on its wall — so the part was restrained by a single node,
 * came back with a 75 GPa peak and SF 0.00, and two assertions here failed for
 * reasons that had nothing to do with what they were testing.
 *
 * A fixed `-a` cap is deterministic for a given TetGen build and puts the
 * element count under this file's control instead of the tier heuristic's. The
 * premise check below then verifies the constraint was actually captured, so a
 * future TetGen whose response to `-a` shifts fails as "the fixture stopped
 * being valid" rather than as a bogus solver result.
 *
 * Calibrated by measurement, not arithmetic: the naive volume/cap estimate was
 * out by ~3.2x (cap 0.036 predicted ~20k elements and produced 65k). These caps
 * give roughly 20k / 31k / 49k on TetGen 1.5.0.
 *
 * The upper end is deliberately bounded. At 179k elements the detector stopped
 * flagging the clamp rim at all (`singularity` null) even though the geometry
 * and constraint are unchanged — the concentration ratio drifts below its 3.0
 * threshold as the FEA field sharpens while the sampling neighbourhood, sized
 * from the STL display tessellation, does not shrink with it. That is #263, and
 * it is a defect rather than a property of this fixture, so the fixture stays in
 * a density range where the detector still works instead of encoding the bug.
 */
const VOLUME_CAPS = [0.120, 0.075, 0.048] as const;
const TIER_NAMES = ["coarse", "standard", "fine"] as const;

describe.skipIf(!probe.found)("second adaptive fixture: cross plate, partial bore clamp (issue #261)", () => {
  const tiers: Record<string, AnalysisResult> = {};
  let adaptive: AnalysisResult;

  beforeAll(async () => {
    const { positions, triangleCount } = crossPlateSoup(A, B, R, H, SEG);
    for (let i = 0; i < VOLUME_CAPS.length; i++) {
      const built = await meshWithTetGen(positions, triangleCount, 2, VOLUME_CAPS[i]!);
      tiers[TIER_NAMES[i]!] = await runAnalysis({
        ...makeRequest({}),
        _prebuiltMesh: {
          mesh:          built.mesh,
          surfaceToNode: built.surfaceToNode,
          surfaceFaces:  built.surfaceFaces,
        },
      });
    }
    // The adaptive run gets a deterministic base mesh too. Its FIRST solve goes
    // through runAnalysis, so leaving it on the tier heuristic would reintroduce
    // exactly the variability the caps above exist to remove — and the loop's
    // behaviour (whether a 3x budget is overshot) depends directly on the base
    // count, so a base that moves would make the characterisation below flaky.
    // Re-meshing after the first solve is driven by the captured mesh, so only
    // the base needs pinning.
    const adaptiveBase = await meshWithTetGen(positions, triangleCount, 2, VOLUME_CAPS[0]!);
    adaptive = await runAdaptiveAnalysis(
      {
        ...makeRequest({ adaptive: true }),
        _prebuiltMesh: {
          mesh:          adaptiveBase.mesh,
          surfaceToNode: adaptiveBase.surfaceToNode,
          surfaceFaces:  adaptiveBase.surfaceFaces,
        },
      },
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

  // ── Premise: the fixture is valid at all ───────────────────────────────────
  it("captured the bore constraint on every mesh (premise)", () => {
    // Everything below is meaningless if the bore was too coarsely meshed to
    // carry constraint nodes. That failure mode is not hypothetical: it is what
    // the tier-based version of this file actually did, restraining the part by
    // a single node and reporting a 75 GPa peak with SF 0.00. A properly
    // constrained solve on this part sits in the tens, so anything wildly
    // outside that means the CONSTRAINT is broken, not the solver.
    for (const q of TIER_NAMES) {
      const r = tiers[q]!;
      expect(r.meshFallback, `${q}: fell back to a box mesh`).toBe(false);
      expect(r.converged, `${q}: solve did not converge`).not.toBe(false);
      expect(r.safetyFactor, `${q}: no safety factor`).not.toBeNull();
      expect(
        r.maxVonMisesMPa,
        `${q}: peak ${r.maxVonMisesMPa.toFixed(1)} MPa is far above anything this load can produce — ` +
        `the bore almost certainly has too few wall nodes to restrain the part`,
      ).toBeLessThan(1000);
      expect(r.rigidBodyMode?.detected ?? false, `${q}: under-constrained`).toBe(false);
    }
  });

  it("meshes are strictly denser across the three caps (premise)", () => {
    const n = TIER_NAMES.map(q => tiers[q]!.elementCount);
    expect(n[1]!, `element counts ${n.join(" -> ")} are not increasing`).toBeGreaterThan(n[0]!);
    expect(n[2]!, `element counts ${n.join(" -> ")} are not increasing`).toBeGreaterThan(n[1]!);
  });

  // ── The property the tube cannot exercise ──────────────────────────────────
  it("produces a CONSTRAINT-EDGE singularity on at least one mesh", () => {
    // #257's one acceptance criterion that could not be closed on a real part:
    // the tube's governing singularity is its point load, so `constraint-edge`
    // was only ever proven against synthetic rim points in a unit test. Here the
    // clamp stops inside the bore and the peak lands on that rim.
    //
    // "At least one mesh" and not "every mesh", for a measured reason. Whether
    // the detector fires is ERRATIC in mesh density on this part — same
    // geometry, same constraint, same load:
    //
    //   42 720 el  fires      48 861 el  null       56 861 el  null
    //   65 318 el  fires     102 152 el  fires     178 727 el  null
    //
    // Not a threshold, not monotone: it fires, stops, and starts again. The
    // cause is #263 — the sampling neighbourhood was sized from the STL display
    // tessellation and did not shrink as the FEA field sharpened, so the
    // concentration ratio wandered across its 3.0 cut for reasons unrelated to
    // the physics. Asserting it on a particular mesh would be encoding that
    // bug; asserting the CAPABILITY is what this fixture is actually for.
    //
    // #263 IS FIXED, and this assertion deliberately did NOT tighten to "every
    // mesh". That was the original plan and it was wrong: the fix moved sampling
    // to the FEA field (radius 13.250 -> 0.938 mm, stable under refinement), but
    // this part's ratio then sat at 3.1–3.3, inside the REPORT band, so it no
    // longer ALARMS on any mesh. Making it alarm needs the threshold at ~2.5 —
    // and the known-smooth control added since (`smooth-concentration.test.ts`,
    // a Kt≈3 hole whose peak provably converges) measures 2.3–2.4, so a 2.5
    // alarm would fire on a part with no singularity at all. The populations are
    // too close to separate with an alarm; the weaker assertion here is the
    // correct one, by measurement rather than by concession.
    const flagged = TIER_NAMES
      .map(q => ({ q, s: tiers[q]!.singularity }))
      .filter((e): e is { q: typeof TIER_NAMES[number]; s: NonNullable<typeof e.s> } => e.s !== null);

    expect(
      flagged.length,
      `no mesh flagged a singularity at all (${TIER_NAMES.map(q => `${q}=${tiers[q]!.elementCount}`).join(", ")}) — ` +
      `the partial-clamp rim should be singular on at least one`,
    ).toBeGreaterThan(0);

    const constraintEdge = flagged.filter(e => e.s.cause === "constraint-edge");
    expect(
      constraintEdge.length,
      `flagged ${flagged.map(e => `${e.q}:${e.s.cause}`).join(", ")} — expected at least one constraint-edge`,
    ).toBeGreaterThan(0);

    for (const e of constraintEdge) {
      // The remedy must be the constraint one, not fillet advice.
      expect(e.s.message, e.q).not.toMatch(/fillet/i);
      // And the peak must be on the bore wall (r = 1.2), nowhere near the +x
      // loaded arm end at x = 6 — i.e. it is the CLAMP, not the load.
      const [px, py] = e.s.peakLocation;
      expect(Math.hypot(px, py), `${e.q}: peak not on the bore wall`).toBeLessThan(R * 2);
      expect(px, `${e.q}: peak drifted toward the loaded face`).toBeLessThan(A * 0.5);
    }
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

  it("never keeps a solve it did not actually make, whatever it stops on", () => {
    // What the loop does on this part is HIGHLY sensitive to its base mesh, and
    // that is itself the finding. Measured, same part and same 3x cap:
    //
    //   base 32 377 (tier-meshed)  -> 'budget-overshoot', 32 377 -> 32 377,
    //                                 i.e. no refined solve at all; the first
    //                                 size field wanted ~6x (uncapped it
    //                                 emitted 186k, then 216k).
    //   base 42 720 (cap-meshed)   -> 'no-refinement-requested',
    //                                 42 720 -> 127 914, error 12.03% -> 10.17%.
    //
    // A 32% change in the base mesh flips the loop between "cannot move at all"
    // and "refines 3x and improves". So an assertion pinning either outcome
    // would be pinning the base mesh, not the loop. What must hold either way is
    // the consistency property: if the loop reports no refinement it must also
    // report the base numbers, and if it reports refinement the error must be
    // the refined solve's. Reporting a stop reason of one and the numbers of the
    // other would be a real defect.
    const info = adaptive.adaptiveRefinement!;
    if (info.finalElementCount === info.initialElementCount) {
      // No refined mesh was kept, so the error must be exactly the base solve's.
      expect(info.finalGlobalError).toBeCloseTo(info.initialGlobalError, 12);
    } else {
      // A refined mesh was kept, so it must be strictly larger and the loop must
      // report the iteration it actually chose.
      expect(info.finalElementCount).toBeGreaterThan(info.initialElementCount);
      expect(info.iterations).toBeGreaterThan(1);
    }
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
