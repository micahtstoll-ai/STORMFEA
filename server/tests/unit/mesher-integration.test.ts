/**
 * mesher-integration.test.ts — issue #108.
 * ----------------------------------------
 * End-to-end tests that exercise the REAL TetGen and Gmsh binaries through the
 * full runAnalysis() / meshStepWithGmsh() pipelines. Until #108 these paths had
 * NO automated coverage against real meshers — which is exactly why the C3D10
 * midnode-permutation bug (#66) shipped undetected in the primary STL path.
 *
 * Two independent gates:
 *   1. STL → TetGen → C3D10 → solve. A hollow cylinder (Ø5 bore) is meshed by
 *      the real tetgen binary, bolt-constrained on its bore, loaded, and solved.
 *      Asserts a finite safety factor, C3D10 elements, and — critically — that
 *      the analysis did NOT silently fall back to the featureless box mesh.
 *   2. STEP → Gmsh → hole detection → solve. A Ø5 plate (the geometry named in
 *      issue #108) is generated as a STEP with Gmsh's OpenCASCADE kernel, then
 *      meshed and analysed. Asserts the hole is detected at the correct radius,
 *      a finite safety factor, and no box fallback.
 *
 * Both gates SKIP gracefully (with a clear "SKIP: <binary> not found" message)
 * when the relevant binary is absent, so `npm test` stays green in environments
 * without the meshers (local dev, and CI runners before #108 installs them).
 *
 *   TETGEN_BIN=/path/to/tetgen npx vitest run server/tests/unit/mesher-integration.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { runAnalysis, type AnalysisRequest } from '../../analysis.js';
import { meshStepWithGmsh, probeGmsh } from '../../gmsh_mesh.js';
import { probeTetGen } from '../../tetgen.js';

// ─── Wall-time budget (issue #108) ───────────────────────────────────────────
// Issue #108 suggests a "demo analysis < 60 s" regression gate. Since #104's
// speedup a Ø5 plate meshes+solves in a few seconds on a dev box, so this
// ceiling is deliberately generous — it exists to catch a gross performance
// regression (e.g. an accidental O(n²) reintroduced, or a solver that no longer
// converges and spins), NOT to police normal run-to-run variance on slow shared
// CI runners. Tighten only if it proves too loose to catch real regressions.
const WALLTIME_BUDGET_MS = 60_000;

const tetgen = await probeTetGen();
const gmsh = await probeGmsh();
if (!tetgen.found) {
  // eslint-disable-next-line no-console
  console.warn('SKIP: tetgen not found — skipping STL→TetGen integration tests (issue #108)');
}
if (!gmsh.found) {
  // eslint-disable-next-line no-console
  console.warn('SKIP: gmsh not found — skipping STEP→Gmsh integration tests (issue #108)');
}

// ─── STL geometry: a hollow cylinder (Ø5 bore) as a triangle soup ────────────
// Watertight tube of outer radius R, inner radius r, height H, N angular
// segments. The bore is a clean cylindrical hole for the bolt constraint;
// centring it on the origin also exercises negative XY coordinates.
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
    tris.push([ib0, it1, ib1], [ib0, it0, it1]); // inner (bore) wall
    tris.push([it0, ot0, ot1], [it0, ot1, it1]); // top annulus  (z=H)
    tris.push([ib0, ob1, ob0], [ib0, ib1, ob1]); // bottom annulus (z=0)
  }
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((t, ti) => t.forEach((p, k) => p.forEach((v, c) => {
    positions[ti * 9 + k * 3 + c] = v;
  })));
  return { positions, triangleCount: tris.length };
}

// ─── STEP geometry: a Ø5 plate, built with Gmsh's OpenCASCADE kernel ─────────
// Written as a .geo, exported to STEP (-0 = geometry only). Self-contained so
// the STEP test needs no committed binary fixture; it naturally requires the
// same gmsh binary it is testing, so the skip guard covers it too.
function makePlateStep(L: number, W: number, H: number, holeR: number): Buffer {
  const base = path.join(tmpdir(), `sf_e2e_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const geo =
    `SetFactory("OpenCASCADE");\n` +
    `Box(1) = {0,0,0, ${L},${W},${H}};\n` +
    `Cylinder(2) = {${L / 2},${W / 2},-1, 0,0,${H + 2}, ${holeR}};\n` +
    `BooleanDifference(3) = { Volume{1}; Delete; }{ Volume{2}; Delete; };\n`;
  writeFileSync(`${base}.geo`, geo);
  execFileSync('gmsh', [`${base}.geo`, '-0', '-o', `${base}.step`, '-format', 'step'], { stdio: 'ignore' });
  return readFileSync(`${base}.step`);
}

const PLA_PRINT: AnalysisRequest['print'] = {
  materialId: 'pla', infillPct: 100, wallCount: 3,
  pattern: 'grid', orientation: 'flat', layerHeightMm: 0.2,
};

// meshOrder is deliberately omitted here: this exercises the AnalysisSettings
// default (meshOrder ?? 2 → C3D10) in analysis.ts. The gate-1 test below asserts
// nodesPerElem === 10, so a partial analysis object that still meshes quadratic
// proves the default kicks in after the print/analysis split.
const STD_ANALYSIS: AnalysisRequest['analysis'] = {
  meshQuality: 'standard',
};

// ─── Gate 1: STL → TetGen → C3D10 → solve ────────────────────────────────────
describe.skipIf(!tetgen.found)('STL upload → TetGen → analyse (issue #108, requires tetgen)', () => {
  const R = 6, r = 2.5, H = 5, N = 32;
  let result: Awaited<ReturnType<typeof runAnalysis>>;
  let elapsedMs = 0;

  beforeAll(async () => {
    const { positions, triangleCount } = tubeTriangleSoup(R, r, H, N);
    const req: AnalysisRequest = {
      positions,
      triangleCount,
      fileType: 'stl',
      bounds: { minX: -R, maxX: R, minY: -R, maxY: R, minZ: 0, maxZ: H },
      holes: [{
        id: 0, centre: [0, 0, H / 2], normal: [0, 0, 1], radius: r,
        confidence: 1, edgeCount: N, rmsError: 0, maxDeviation: 0,
      }],
      boltHoleIds: [0],
      forces: [{ magnitude: 50, direction: [1, 0, 0], position: [R, 0, H] }],
      print: PLA_PRINT,
      analysis: STD_ANALYSIS,
    };
    const t0 = Date.now();
    result = await runAnalysis(req);
    elapsedMs = Date.now() - t0;
  }, 120_000);

  it('meshes with the real tetgen binary — C3D10, no fallback to the box mesh', () => {
    // The whole point of #108: prove the primary STL path ran the real mesher
    // and produced quadratic tets, rather than silently degrading to the
    // featureless bounding-box mesh (which would make SF meaningless).
    expect(result.meshFallback).toBe(false);
    expect(result.nodesPerElem).toBe(10);
    expect(result.elementCount).toBeGreaterThan(0);
  });

  it('produces a finite, positive safety factor from a converged solve', () => {
    expect(result.converged).toBe(true);
    expect(result.safetyFactorAvailable).toBe(true);
    expect(result.safetyFactor).not.toBeNull();
    expect(Number.isFinite(result.safetyFactor as number)).toBe(true);
    expect(result.safetyFactor as number).toBeGreaterThan(0);
    expect(Number.isFinite(result.maxVonMisesMPa)).toBe(true);
    expect(result.maxVonMisesMPa).toBeGreaterThan(0);
  });

  it(`completes within the wall-time budget (${WALLTIME_BUDGET_MS} ms)`, () => {
    expect(elapsedMs).toBeLessThan(WALLTIME_BUDGET_MS);
  });
});

// ─── Gate 2: STEP → Gmsh → hole detection → solve ────────────────────────────
describe.skipIf(!gmsh.found)('STEP upload → Gmsh → analyse (issue #108, requires gmsh)', () => {
  const L = 20, W = 12, H = 3, holeR = 2.5; // Ø5 plate
  let stepBuffer: Buffer;

  beforeAll(() => {
    stepBuffer = makePlateStep(L, W, H, holeR);
  }, 60_000);

  it('detects the Ø5 hole at the correct radius (fine mesh)', async () => {
    const t0 = Date.now();
    const mesh = await meshStepWithGmsh(stepBuffer, {
      clMin: 0.2, clMax: 2.0, clCurv: 30, elementOrder: 2, // = meshQuality "fine"
    });
    const elapsedMs = Date.now() - t0;

    expect(mesh.mesh.nodeCount).toBeGreaterThan(0);
    expect(mesh.mesh.elementCount).toBeGreaterThan(0);
    expect([4, 10]).toContain(mesh.mesh.nodesPerElem);

    // Exactly one hole, detected at Ø5 → radius 2.5 (± faceting tolerance).
    expect(mesh.holeWallNodes.size).toBe(1);
    const radii = [...mesh.holeRadius.values()];
    expect(radii.length).toBe(1);
    expect(radii[0]!).toBeGreaterThan(holeR - 0.1);
    expect(radii[0]!).toBeLessThan(holeR + 0.1);

    // Issue #108 reports this reproduces "in ~2 s"; meshing alone is far faster.
    expect(elapsedMs).toBeLessThan(WALLTIME_BUDGET_MS);
  }, 120_000);

  it('analyses end-to-end: finite safety factor, no box fallback', async () => {
    const req: AnalysisRequest = {
      positions: new Float32Array(0),
      triangleCount: 0,
      fileType: 'step',
      stepBuffer,
      bounds: { minX: 0, maxX: L, minY: 0, maxY: W, minZ: 0, maxZ: H },
      holes: [],
      boltHoleIds: [], // empty → the STEP path auto-constrains every detected hole
      forces: [{ magnitude: 100, direction: [1, 0, 0], position: [L, W / 2, H / 2] }],
      print: PLA_PRINT,
      analysis: { meshQuality: 'fine', meshOrder: 2 },
    };
    const t0 = Date.now();
    const result = await runAnalysis(req);
    const elapsedMs = Date.now() - t0;

    expect(result.meshFallback).toBe(false); // Gmsh path never uses the box mesh
    expect(result.nodesPerElem).toBe(10);
    expect(result.converged).toBe(true);
    expect(result.safetyFactorAvailable).toBe(true);
    expect(result.safetyFactor).not.toBeNull();
    expect(Number.isFinite(result.safetyFactor as number)).toBe(true);
    expect(result.safetyFactor as number).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(WALLTIME_BUDGET_MS);
  }, 120_000);
});
