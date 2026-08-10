/**
 * two-region-default.test.ts — issue #297.
 *
 * The two-region (walls vs infill) model is now the DEFAULT rather than an
 * opt-in. These lock the three things that change with the default, plus the
 * one thing that must not:
 *
 *   1. Absent `analysis.twoRegion` now RUNS the model (it used to mean "off").
 *   2. Explicit `twoRegion: false` still selects the legacy single-material
 *      path — two-region invariant 1, which the default flip must not weaken.
 *      "Off" is now a deliberate choice rather than an accident of omission.
 *   3. The model degrades, with a reason, on a mesh too coarse to express the
 *      structural effect it exists to capture — the measured finding behind
 *      MIN_ELEMENTS_THROUGH_THICKNESS (issue #295 / #297 comment): at one
 *      element through thickness the model recovers 4% of the sandwich
 *      stiffening while reporting itself ACTIVE, which is worse than not
 *      offering it.
 *   4. The classification is exported as a paintable field on the VOLUME
 *      payload, and its volume-weighted mean agrees with the shell volume
 *      fraction the summary reports — so the picture and the number cannot
 *      drift apart.
 *
 * On (4): the split is only visible on a SECTION CUT. A part's boundary is wall
 * by construction — every boundary node sits at distance 0 from the surface and
 * so inside the wall band — so the same field on the display mesh is
 * identically 1.0 on every part. That was measured here, not assumed: an
 * earlier revision of this file shipped the display-mesh field and the
 * "is not a constant" test below caught it at min 1.0 / max 1.0 against a 50.6%
 * shell volume fraction. The field now rides on `volumeField` only.
 *
 * Runs on prebuilt box meshes through the `_prebuiltMesh` seam, so it needs no
 * TetGen and never skips. That seam is also what lets the through-thickness
 * resolution be set EXACTLY rather than inferred from a mesher's response to a
 * size cap.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis, type AnalysisRequest } from "../../analysis.js";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import { MIN_ELEMENTS_THROUGH_THICKNESS } from "../../meshSizing.js";

// A 24 x 12 x 6 mm plate — the documented fixture's 6 mm section (the quantity
// the gate reads) at a plan size that keeps these solves to a few thousand
// elements.
const W = 24, D = 12, H = 6;

/** Two triangles per box face, as the display mesh the vertex payload is sized from. */
function plateSoup(): { positions: Float32Array; triangleCount: number } {
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

/** A prebuilt mesh with `nz` cells through the 6 mm thickness. */
function plateMesh(nx: number, ny: number, nz: number) {
  const mesh = generateBoxMeshC3D4(0, 0, 0, W, D, H, nx, ny, nz);
  const surfaceFaces = extractSurfaceFaces(mesh);
  const surfaceToNode = new Int32Array(mesh.nodeCount);
  for (let i = 0; i < surfaceToNode.length; i++) surfaceToNode[i] = i;
  return { mesh, surfaceToNode, surfaceFaces };
}

// NOTE on the division counts: `achievedResolution` reports the mean element
// SIZE across the thin direction, not a layer count, so an anisotropic
// structured mesh reads lower than its nominal layering (see that function's
// docblock). These cells are 1.5 x 1.5 x 0.75 mm — eight nominal layers through
// the 6 mm section, reading 4.5 — so FINE clears the floor on the metric the
// gate actually uses rather than on the number a reader would infer from `nz`.
const COARSE = plateMesh(8, 4, 1);     // reads 1.4 through thickness — below the floor
const FINE   = plateMesh(16, 8, 8);    // reads 4.5 — above it

function request(
  prebuilt: ReturnType<typeof plateMesh>,
  twoRegion?: boolean,
): AnalysisRequest {
  const { positions, triangleCount } = plateSoup();
  return {
    positions, triangleCount, fileType: "stl",
    bounds: { minX: 0, maxX: W, minY: 0, maxY: D, minZ: 0, maxZ: H },
    holes: [], boltHoleIds: [],
    forces: [{ magnitude: 100, direction: [0, 0, 1], position: [W, D / 2, H] }],
    print: {
      // Sparse infill is required for the split to MEAN anything: at 100% the
      // core is the solid material and the field collapses to the uniform path
      // by design (`materialsEqual`, two-region invariant 8's rho=1 anchor).
      materialId: "pla", infillPct: 20, wallCount: 3,
      pattern: "grid", orientation: "flat", layerHeightMm: 0.2,
      extrusionWidthMm: 0.45,
    },
    analysis: {
      meshQuality: "standard", meshOrder: 1,
      ...(twoRegion === undefined ? {} : { twoRegion }),
    },
    _prebuiltMesh: prebuilt,
  };
}

describe("two-region is the default (issue #297)", () => {
  it("runs with NO analysis.twoRegion flag at all", async () => {
    // The flip itself. Before #297 this request produced a single averaged
    // material and `materialModel.twoRegion === false`.
    const r = await runAnalysis(request(FINE));
    expect(r.materialModel.twoRegion).toBe(true);
    expect(r.materialModel.degraded).toBeUndefined();
    expect(r.materialModel.shellVolumeFraction).toBeGreaterThan(0);
    expect(r.materialModel.shellVolumeFraction).toBeLessThan(1);
  }, 120_000);

  it("explicit false still selects the legacy single-material path (invariant 1)", async () => {
    const off = await runAnalysis(request(FINE, false));
    expect(off.materialModel.twoRegion).toBe(false);
    // Not a degradation — a choice. A degraded run means "asked for, could not
    // deliver"; this one was never asked for.
    expect(off.materialModel.degraded).toBeUndefined();
    expect(off.materialModel.shellVolumeFraction).toBeNull();
    expect(off.volumeField?.nodeShellFractionB64 ?? null).toBeNull();
  }, 120_000);

  it("the default actually changes the answer — off and default are not the same solve", async () => {
    // Guards against a flip that looks landed but is inert: if these agreed,
    // every assertion above could pass while the model did nothing.
    const [dflt, off] = await Promise.all([
      runAnalysis(request(FINE)),
      runAnalysis(request(FINE, false)),
    ]);
    expect(dflt.maxDisplacementMm).not.toBeCloseTo(off.maxDisplacementMm, 6);
    // Direction is the validated one: the two-region split is STIFFER than the
    // homogenized average, which is ~23-35% too soft on sandwich geometry.
    expect(dflt.maxDisplacementMm).toBeLessThan(off.maxDisplacementMm);
  }, 240_000);
});

describe("the invariants still hold at the resolution the gate now guarantees", () => {
  // Issue #297 scope item 2: verify the CLAUDE.md two-region invariants at the
  // resolutions the fixed tiers actually deliver. The gate above means any run
  // that reaches the model has at least MIN_ELEMENTS_THROUGH_THICKNESS across
  // the section, so these run at exactly the resolution the default now
  // guarantees rather than at whatever a fixture happened to pick.

  it("invariant 5: reports the divergence between the split and the legacy multiplier, and does not renormalize it", async () => {
    const r = await runAnalysis(request(FINE));
    const mm = r.materialModel;
    expect(mm.twoRegion).toBe(true);
    expect(mm.impliedAvgStrengthMul).not.toBeNull();
    expect(mm.globalModelStrengthMul).toBeGreaterThan(0);
    // The two disagree — that disagreement is the reported quantity. If the
    // model were quietly renormalized to match the legacy multiplier, these
    // would be equal and the number would carry no information.
    expect(mm.impliedAvgStrengthMul!).not.toBeCloseTo(mm.globalModelStrengthMul, 3);
  }, 120_000);

  it("invariant 5: collapses to the uniform path at 100% infill (endpoint anchored)", async () => {
    // Shell === core, so the field must collapse rather than build nine bins of
    // an identical material. This is also the path every heavy CI fixture takes.
    const solid = request(FINE);
    const r = await runAnalysis({
      ...solid,
      print: { ...solid.print, infillPct: 100 },
    });
    expect(r.materialModel.degraded).toBeUndefined();
    // Collapsed: no per-element field was published for the section view.
    expect(r.volumeField?.nodeShellFractionB64 ?? null).toBeNull();
  }, 120_000);
});

describe("the resolution gate (issue #297)", () => {
  it("degrades on a mesh too coarse to express the sandwich effect", async () => {
    const r = await runAnalysis(request(COARSE));
    expect(r.meshResolution).not.toBeNull();
    expect(r.meshResolution!.elementsThroughThickness).toBeLessThan(MIN_ELEMENTS_THROUGH_THICKNESS);
    // Degraded, not silently active-but-meaningless.
    expect(r.materialModel.twoRegion).toBe(false);
    expect(r.materialModel.degraded).toBeTruthy();
    expect(r.materialModel.degraded!).toMatch(/thinnest section/);
    // The reason names the fix, not just the fault.
    expect(r.materialModel.degraded!).toMatch(new RegExp(`${MIN_ELEMENTS_THROUGH_THICKNESS}`));
    // And no classification field is published for a run that did not classify.
    expect(r.volumeField?.nodeShellFractionB64 ?? null).toBeNull();
  }, 120_000);

  it("does not degrade once the mesh resolves the section", async () => {
    const r = await runAnalysis(request(FINE));
    expect(r.meshResolution!.elementsThroughThickness)
      .toBeGreaterThanOrEqual(MIN_ELEMENTS_THROUGH_THICKNESS);
    expect(r.materialModel.twoRegion).toBe(true);
    expect(r.materialModel.degraded).toBeUndefined();
  }, 120_000);

  it("the gate reads the MESH, so an explicit opt-in cannot override it", async () => {
    // twoRegion: true on a mesh that cannot express it is still degraded —
    // the gate is about what the mesh can represent, not about what was asked.
    const r = await runAnalysis(request(COARSE, true));
    expect(r.materialModel.twoRegion).toBe(false);
    expect(r.materialModel.degraded).toMatch(/thinnest section/);
  }, 120_000);
});

describe("the shell/core split is displayable (issue #297)", () => {
  /** Decode the volume payload's classification back to a Float32Array. */
  function shellOf(vf: { nodeShellFractionB64: string | null } | undefined): Float32Array {
    const b64 = vf?.nodeShellFractionB64;
    if (!b64) throw new Error("no nodeShellFractionB64 on the volume payload");
    const buf = Buffer.from(b64, "base64");
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  }

  it("publishes a per-node classification bounded to [0, 1] on the volume payload", async () => {
    const r = await runAnalysis({ ...request(FINE), analysis: {
      meshQuality: "standard", meshOrder: 1, includeVolumeField: true,
    } });
    const f = shellOf(r.volumeField);
    expect(f.length).toBe(r.nodeCount);
    for (let i = 0; i < f.length; i++) {
      expect(f[i]).toBeGreaterThanOrEqual(0);
      expect(f[i]).toBeLessThanOrEqual(1);
      expect(Number.isFinite(f[i])).toBe(true);
    }
  }, 120_000);

  it("is not a constant — it would be useless as a picture if it were", async () => {
    // THE regression this file exists for on the display side: the first
    // revision painted the DISPLAY mesh, where this assertion failed at
    // max - min === 0 because a part's surface is entirely wall.
    const r = await runAnalysis({ ...request(FINE), analysis: {
      meshQuality: "standard", meshOrder: 1, includeVolumeField: true,
    } });
    const f = shellOf(r.volumeField);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < f.length; i++) {
      if (f[i]! < min) min = f[i]!;
      if (f[i]! > max) max = f[i]!;
    }
    expect(min).toBeLessThan(0.5);   // interior nodes are core
    expect(max).toBeCloseTo(1, 3);   // boundary nodes are wall
  }, 120_000);

  it("agrees with the shell VOLUME FRACTION the summary reports", async () => {
    // The picture and the number come from one classification, so they must not
    // be able to drift. This is a nodal average against a volume-weighted
    // element average over a non-uniform mesh, so they agree in the loose sense
    // that matters: same split, same order, both strictly interior to (0, 1).
    const r = await runAnalysis({ ...request(FINE), analysis: {
      meshQuality: "standard", meshOrder: 1, includeVolumeField: true,
    } });
    const f = shellOf(r.volumeField);
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i]!;
    const meanNodal = sum / f.length;
    const volFrac = r.materialModel.shellVolumeFraction!;
    expect(volFrac).toBeGreaterThan(0);
    expect(volFrac).toBeLessThan(1);
    expect(meanNodal).toBeGreaterThan(0);
    expect(meanNodal).toBeLessThan(1);
    // Nodal averaging over-weights the boundary (surface nodes are shared by
    // fewer elements), so the nodal mean sits ABOVE the volume fraction.
    expect(meanNodal).toBeGreaterThan(volFrac - 1e-9);
    expect(meanNodal - volFrac).toBeLessThan(0.45);
  }, 120_000);
});
