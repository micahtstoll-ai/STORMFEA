/**
 * adaptive-resolve-failure.test.ts — issue #149 follow-up (requires a tetgen binary).
 *
 * Locks the adaptive loop's DEGRADATION CONTRACT against a real failure it was
 * observed to violate: `runAdaptiveAnalysis` must never turn a part that solves
 * fine at the selected mesh tier into a thrown error.
 *
 * The defect: the loop guarded `meshWithTetGenSizing` in a try/catch but left
 * the re-solve on the refined mesh unguarded. TetGen can happily RETURN a mesh
 * that the hard mesh-quality gate (#166) then REJECTS — a size field that
 * shrinks elements hard around a stress concentration leaves a few slivers, the
 * gate throws rather than solving an ill-conditioned system, and the exception
 * escaped runAdaptiveAnalysis entirely. An opt-in accuracy feature therefore
 * converted a good tier solve into a 500, discarding the good result the loop
 * was already holding in `best`.
 *
 * Reproduced on a Ø5-bore tube: the first refinement went 13,340 → 115,544
 * elements and produced 13 slivers, which killed the whole analysis.
 *
 * The assertions are deliberately written as a CONTRACT, not as "this geometry
 * produces slivers" — whether TetGen slivers on any given input is version- and
 * geometry-sensitive, so pinning that would be brittle. What must hold either
 * way: the call resolves, the result is usable, and if the loop did stop early
 * it reports a stop reason from the documented union rather than throwing.
 *
 *   TETGEN_BIN=/path/to/tetgen npx vitest run server/tests/unit/adaptive-resolve-failure.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { runAnalysis, runAdaptiveAnalysis, type AnalysisRequest, type AnalysisResult } from "../../analysis.js";
import { probeTetGen } from "../../tetgen.js";
import type { StopReason } from "../../solver/adaptiveMesh.js";

const probe = await probeTetGen();
if (!probe.found) {
  // eslint-disable-next-line no-console
  console.warn(
    "SKIP: tetgen not found — skipping adaptive re-solve degradation test (issue #149). " +
    "The loop-control logic is covered binary-free in adaptive-mesh.test.ts.",
  );
}

// Every stop reason the response contract (docs/API.md) allows. A reason
// outside this set means the driver invented one that callers cannot handle.
const VALID_STOP_REASONS: ReadonlySet<string> = new Set<StopReason>([
  "continue",
  "target-error-reached",
  "max-iterations",
  "element-growth-cap",
  "stalled",
  "no-refinement-requested",
  "remesh-failed",
  "resolve-failed",
  "no-error-field",
  "degraded-to-tier",
]);

// Hollow cylinder with a Ø5 bore — the bore is a genuine stress concentrator,
// so the error indicator asks for aggressive local refinement there. Same
// geometry family as the #108 mesher-integration gate.
function tubeTriangleSoup(
  R: number, r: number, H: number, N: number,
): { positions: Float32Array; triangleCount: number } {
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

describe.skipIf(!probe.found)("adaptive refinement degrades instead of throwing (issue #149)", () => {
  let tier: AnalysisResult;
  let adaptive: AnalysisResult;
  let threw: unknown = null;

  beforeAll(async () => {
    // Baseline: the SAME part at the same tier, without adaptivity. If this
    // throws the premise is void and the assertions below say so explicitly.
    tier = await runAnalysis(makeRequest(false));
    try {
      adaptive = await runAdaptiveAnalysis(makeRequest(true));
    } catch (err) {
      threw = err;
    }
  }, 600_000);

  it("the part solves at the selected tier without adaptivity (premise)", () => {
    expect(tier.converged).toBe(true);
    expect(tier.safetyFactor).not.toBeNull();
  });

  it("does not throw — a refined mesh the quality gate rejects must not kill the analysis", () => {
    // The regression itself. Before the fix this rejected with a mesh-quality
    // error raised from the re-solve, not from the re-mesh.
    expect(threw).toBeNull();
  });

  it("returns a usable, converged result even when refinement could not proceed", () => {
    expect(adaptive).toBeDefined();
    expect(adaptive.converged).toBe(true);
    expect(adaptive.safetyFactor).not.toBeNull();
    expect(Number.isFinite(adaptive.maxVonMisesMPa)).toBe(true);
    expect(adaptive.maxVonMisesMPa).toBeGreaterThan(0);
  });

  it("reports a stop reason from the documented contract", () => {
    const info = adaptive.adaptiveRefinement;
    expect(info).toBeDefined();
    expect(VALID_STOP_REASONS.has(info!.stopReason)).toBe(true);
  });

  it("never reports fewer than the one tier solve it always performs", () => {
    expect(adaptive.adaptiveRefinement!.iterations).toBeGreaterThanOrEqual(1);
  });

  it("falls back to the tier result when no refinement iteration succeeded", () => {
    const info = adaptive.adaptiveRefinement!;
    // When the loop never completed a refined solve it must report the tier
    // solve's own numbers, not a partially-updated mix of the two.
    if (info.iterations === 1) {
      expect(info.finalElementCount).toBe(info.initialElementCount);
      expect(info.finalGlobalError).toBe(info.initialGlobalError);
      expect(adaptive.elementCount).toBe(tier.elementCount);
    }
  });
});
