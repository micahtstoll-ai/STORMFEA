/**
 * adaptive-default-identical.test.ts — issue #149.
 *
 * Proves the adaptive-refinement feature is a true OPT-IN with a BIT-IDENTICAL
 * default path:
 *
 *   1. The internal `_captureInternals` side-write runAnalysis gained is inert:
 *      a solve with it present produces numerically identical output to a solve
 *      without it (it only reads out the mesh/error, changing no computed value).
 *
 *   2. runAdaptiveAnalysis on a non-adaptive path (STEP/Gmsh here) DEGRADES to
 *      exactly the tier solve — every reported number equals plain runAnalysis —
 *      and merely annotates the result with an `adaptiveRefinement` report.
 *
 * This runs a real full-pipeline solve via the STEP→Gmsh path, which needs the
 * gmsh binary (installed in this environment and CI). It self-skips otherwise.
 * The STL→TetGen adaptive loop itself is exercised in adaptive-remesh.test.ts
 * (tetgen-gated) and its pure logic in adaptive-mesh.test.ts (binary-free).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import * as path from "path";
import { runAnalysis, runAdaptiveAnalysis, type AnalysisRequest } from "../../analysis.js";

let gmshFound = true;
try {
  execFileSync("gmsh", ["--version"], { stdio: "ignore" });
} catch {
  gmshFound = false;
  // eslint-disable-next-line no-console
  console.warn("SKIP: gmsh not found — skipping adaptive default-path bit-identical test (issue #149)");
}

function makePlateStep(L: number, W: number, H: number, holeR: number): Buffer {
  const base = path.join(tmpdir(), `sf_adapt_ident_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const geo =
    `SetFactory("OpenCASCADE");\n` +
    `Box(1) = {0,0,0, ${L},${W},${H}};\n` +
    `Cylinder(2) = {${L / 2},${W / 2},-1, 0,0,${H + 2}, ${holeR}};\n` +
    `BooleanDifference(3) = { Volume{1}; Delete; }{ Volume{2}; Delete; };\n`;
  writeFileSync(`${base}.geo`, geo);
  execFileSync("gmsh", [`${base}.geo`, "-0", "-o", `${base}.step`, "-format", "step"], { stdio: "ignore" });
  return readFileSync(`${base}.step`);
}

describe.skipIf(!gmshFound)("adaptive refinement: opt-in with bit-identical default (issue #149)", () => {
  const L = 20, W = 12, H = 3, holeR = 2.5;
  let baseReq: AnalysisRequest;

  beforeAll(() => {
    const stepBuffer = makePlateStep(L, W, H, holeR);
    baseReq = {
      positions: new Float32Array(0),
      triangleCount: 0,
      stepBuffer,
      fileType: "step",
      bounds: { minX: 0, maxX: L, minY: 0, maxY: W, minZ: 0, maxZ: H },
      holes: [],
      boltHoleIds: [],
      forces: [{ magnitude: 40, direction: [1, 0, 0], position: [L, W / 2, H] }],
      print: {
        materialId: "pla", infillPct: 100, wallCount: 3,
        pattern: "grid", orientation: "flat", layerHeightMm: 0.2,
      },
      analysis: { meshQuality: "standard" },
    };
  }, 60_000);

  const KEYS = [
    "maxVonMisesMPa", "maxDisplacementMm", "safetyFactor",
    "elementCount", "nodeCount", "globalRelativeError", "cgIterations",
  ] as const;

  it("the _captureInternals side-write is numerically inert", async () => {
    const plain = await runAnalysis(baseReq);
    const captured = await runAnalysis({ ...baseReq, _captureInternals: {} });
    for (const k of KEYS) {
      expect(captured[k]).toStrictEqual(plain[k]);
    }
  }, 120_000);

  it("runAdaptiveAnalysis degrades to the tier solve on the STEP path, numerically identical", async () => {
    const plain = await runAnalysis(baseReq);
    const adaptive = await runAdaptiveAnalysis(baseReq);
    for (const k of KEYS) {
      expect(adaptive[k]).toStrictEqual(plain[k]);
    }
    // ...and it reports WHY it degraded rather than silently doing nothing.
    expect(adaptive.adaptiveRefinement).toBeDefined();
    expect(adaptive.adaptiveRefinement!.degradedToTier).toBe(true);
    expect(adaptive.adaptiveRefinement!.iterations).toBe(1);
    expect(adaptive.adaptiveRefinement!.note.toLowerCase()).toContain("stl");
  }, 120_000);

  it("plain runAnalysis result carries NO adaptiveRefinement field (default untouched)", async () => {
    const plain = await runAnalysis(baseReq);
    expect(plain.adaptiveRefinement).toBeUndefined();
  }, 120_000);
});
