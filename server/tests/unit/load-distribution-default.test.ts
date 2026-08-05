/**
 * load-distribution-default.test.ts — the DEFAULT load distribution (#271).
 *
 * `DEFAULT_LOAD_DISTRIBUTION` is 'contact_patch': a force that does not name a
 * mode is applied WHERE IT WAS PLACED. That is a deliberate change to every
 * force-loaded result, and the reason it needs its own lock is that the rest of
 * the suite cannot catch a regression in it:
 *
 *   • `solver_validation.ts` — the 187 known-answer anchors — never calls
 *     `runAnalysis`. It drives the solver with explicit nodal forces, so it is
 *     structurally blind to how analysis.ts distributes a load. Its passing is
 *     not evidence about this default, in either direction.
 *   • The fixtures that DO route through the force path assert inequalities and
 *     behavioural facts rather than pinned numbers (deliberately — TetGen's
 *     element count is chaotic in its volume cap). They absorbed this change
 *     without a single failure.
 *
 * So without this file, the default could silently revert and the whole suite
 * would stay green. What it pins:
 *
 *   1. An absent `loadDistribution` behaves as 'contact_patch'.
 *   2. It therefore RESPECTS `position` — the #271 headline.
 *   3. 'uniform' still reaches the legacy model, so the previous behaviour is
 *      reachable, which is the condition #260 and #271 both set for changing a
 *      default at all.
 *
 * Runs on a prebuilt box mesh through the `_prebuiltMesh` seam, so it needs no
 * TetGen and never skips.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis, DEFAULT_LOAD_DISTRIBUTION, type AnalysisRequest } from "../../analysis.js";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";

const W = 20, D = 10, H = 10;   // a 20 x 10 x 10 mm bar

/** Two triangles per box face, as the display mesh the payload is sized from. */
function barSoup(): { positions: Float32Array; triangleCount: number } {
  const c: Array<[number, number, number]> = [
    [0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0],
    [0, 0, H], [W, 0, H], [W, D, H], [0, D, H],
  ];
  const quads = [
    [0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1],
    [3, 2, 6, 7], [0, 3, 7, 4], [1, 5, 6, 2],
  ];
  const tris: Array<[number, number, number][]> = [];
  for (const [a, b, cc, d] of quads) {
    tris.push([c[a!]!, c[b!]!, c[cc!]!], [c[a!]!, c[cc!]!, c[d!]!]);
  }
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((t, ti) => t.forEach((p, k) => p.forEach((v, ci) => {
    positions[ti * 9 + k * 3 + ci] = v;
  })));
  return { positions, triangleCount: tris.length };
}

const mesh = generateBoxMeshC3D4(0, 0, 0, W, D, H, 10, 6, 6);
const surfaceFaces = extractSurfaceFaces(mesh);
const surfaceToNode = new Int32Array(mesh.nodeCount);
for (let i = 0; i < surfaceToNode.length; i++) surfaceToNode[i] = i;

function request(
  position: [number, number, number],
  loadDistribution?: "uniform" | "cosine_bearing" | "tapered_patch" | "contact_patch",
): AnalysisRequest {
  const { positions, triangleCount } = barSoup();
  return {
    positions, triangleCount, fileType: "stl",
    bounds: { minX: 0, maxX: W, minY: 0, maxY: D, minZ: 0, maxZ: H },
    holes: [], boltHoleIds: [],
    // +z load, so the loaded face is the top and `position` can be moved along
    // it without changing anything the legacy path would notice.
    forces: [{ magnitude: 200, direction: [0, 0, 1], position, ...(loadDistribution ? { loadDistribution } : {}) }],
    print: {
      materialId: "pla", infillPct: 100, wallCount: 3,
      pattern: "grid", orientation: "flat", layerHeightMm: 0.2,
    },
    analysis: { meshQuality: "coarse", meshOrder: 1 },
    _prebuiltMesh: { mesh, surfaceToNode, surfaceFaces },
  };
}

const NEAR: [number, number, number] = [3, D / 2, H];
const FAR:  [number, number, number] = [17, D / 2, H];

describe("DEFAULT_LOAD_DISTRIBUTION (#271)", () => {
  it("is 'contact_patch' — the load goes where it was placed", () => {
    expect(DEFAULT_LOAD_DISTRIBUTION).toBe("contact_patch");
  });

  it("an absent loadDistribution respects the application point", async () => {
    // THE regression this file exists for. Under the pre-#271 default these two
    // requests were bit-identical, because the load went to the whole extreme
    // face in +z regardless of where the user put it.
    const near = await runAnalysis(request(NEAR));
    const far  = await runAnalysis(request(FAR));

    expect(near.maxVonMisesMPa).toBeGreaterThan(0);
    expect(far.maxVonMisesMPa).toBeGreaterThan(0);
    // A load near one end of a bar is not the same load case as one near the
    // other end. Any implementation that ignores `position` fails here.
    const rel = Math.abs(near.maxDisplacementMm - far.maxDisplacementMm)
              / Math.max(near.maxDisplacementMm, far.maxDisplacementMm);
    expect(rel).toBeGreaterThan(0.01);
  });

  it("an absent loadDistribution matches an explicit contact_patch", async () => {
    const implicit = await runAnalysis(request(NEAR));
    const explicit = await runAnalysis(request(NEAR, "contact_patch"));
    expect(implicit.maxVonMisesMPa).toBeCloseTo(explicit.maxVonMisesMPa, 9);
    expect(implicit.maxDisplacementMm).toBeCloseTo(explicit.maxDisplacementMm, 9);
  });

  it("'uniform' still reaches the legacy model, which ignores the point", async () => {
    // The escape hatch. #260 and #271 both make "the previous behaviour stays
    // reachable" a condition of changing the default, so this is that condition
    // as a test: legacy is not merely still in the code, it is still selectable
    // and still behaves the way it did — including ignoring `position`.
    const near = await runAnalysis(request(NEAR, "uniform"));
    const far  = await runAnalysis(request(FAR, "uniform"));
    expect(near.maxVonMisesMPa).toBeCloseTo(far.maxVonMisesMPa, 9);
    expect(near.maxDisplacementMm).toBeCloseTo(far.maxDisplacementMm, 9);
  });

  it("the default and the legacy model give materially different answers", async () => {
    // Stated as a fact rather than a tolerance: this default change moves
    // results, that is the point of it, and a future change that quietly makes
    // them agree again would mean the default stopped taking effect.
    const dflt   = await runAnalysis(request(NEAR));
    const legacy = await runAnalysis(request(NEAR, "uniform"));
    const rel = Math.abs(dflt.maxVonMisesMPa - legacy.maxVonMisesMPa) / legacy.maxVonMisesMPa;
    expect(rel).toBeGreaterThan(0.05);
  });
});
