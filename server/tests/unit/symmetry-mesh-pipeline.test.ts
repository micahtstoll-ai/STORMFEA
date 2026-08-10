/**
 * symmetry-mesh-pipeline.test.ts — issue #296, the wiring.
 *
 * `analysis.symmetryMesh` runs detect -> clip -> mesh the half -> mirror inside
 * `runAnalysis`. These exercise the whole chain against a REAL TetGen mesh,
 * which is the case that matters: a structured box mesh is chiral in a tidy,
 * predictable way, while TetGen's is chiral in the way real parts are (measured
 * on this fixture: 8 of 2,624 element centroids have a mirror partner, 0.3%).
 *
 * What is locked here:
 *   - the opt-in is genuinely opt-in (absent flag reports nothing at all);
 *   - when it applies, the resulting mesh is EXACTLY mirror-symmetric where the
 *     ordinary TetGen mesh is not;
 *   - when it cannot apply it degrades to the ordinary mesh and SAYS WHY,
 *     rather than failing the solve or going quiet;
 *   - the solve still works on the mirrored mesh, whose second half carries
 *     reversed-orientation elements.
 *
 * TetGen-gated: self-skips where the binary is absent (CI installs it).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { runAnalysis, type AnalysisRequest, type AnalysisResult } from "../../analysis.js";
import { probeTetGen } from "../../tetgen.js";
import type { TetMesh } from "../../solver/types.js";

const probe = await probeTetGen();

const L = 24, W = 12, H = 6;
const PLANE_Y = W / 2;

/** A symmetric bar, as a triangle soup. Symmetric about y = W/2 by construction. */
function barSoup(): { positions: Float32Array; triangleCount: number } {
  const c: Array<[number, number, number]> = [
    [0, 0, 0], [L, 0, 0], [L, W, 0], [0, W, 0],
    [0, 0, H], [L, 0, H], [L, W, H], [0, W, H],
  ];
  const quads = [[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[0,3,7,4],[1,5,6,2]];
  const tris: Array<[number, number, number][]> = [];
  // Wound OUTWARD: signed volume must be POSITIVE. An inward-wound closed
  // surface passes the manifold check but makes the clip emit its cap on the
  // wrong side, which shows up as inconsistent edges rather than as anything
  // naming the cause.
  for (const [a, b, cc, d] of quads) tris.push([c[a!]!, c[cc!]!, c[b!]!], [c[a!]!, c[d!]!, c[cc!]!]);
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((t, ti) => t.forEach((p, k) => p.forEach((v, ci) => { positions[ti * 9 + k * 3 + ci] = v; })));
  return { positions, triangleCount: tris.length };
}

/** An ASYMMETRIC part: the bar with one corner sheared, so no plane exists. */
function wedgeSoup(): { positions: Float32Array; triangleCount: number } {
  const c: Array<[number, number, number]> = [
    [0, 0, 0], [L, 0, 0], [L, W, 0], [0, W, 0],
    [0, 0, H], [L, 0, H], [L, W * 0.55, H], [0, W, H],   // one top corner pulled in
  ];
  const quads = [[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[0,3,7,4],[1,5,6,2]];
  const tris: Array<[number, number, number][]> = [];
  // Wound OUTWARD: signed volume must be POSITIVE. An inward-wound closed
  // surface passes the manifold check but makes the clip emit its cap on the
  // wrong side, which shows up as inconsistent edges rather than as anything
  // naming the cause.
  for (const [a, b, cc, d] of quads) tris.push([c[a!]!, c[cc!]!, c[b!]!], [c[a!]!, c[d!]!, c[cc!]!]);
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((t, ti) => t.forEach((p, k) => p.forEach((v, ci) => { positions[ti * 9 + k * 3 + ci] = v; })));
  return { positions, triangleCount: tris.length };
}

function request(
  soup: { positions: Float32Array; triangleCount: number },
  symmetryMesh?: boolean,
): AnalysisRequest {
  return {
    positions: soup.positions, triangleCount: soup.triangleCount, fileType: "stl",
    bounds: { minX: 0, maxX: L, minY: 0, maxY: W, minZ: 0, maxZ: H },
    holes: [{
      id: 0, centre: [3, PLANE_Y, H / 2], normal: [0, 0, 1], radius: 2,
      confidence: 1, edgeCount: 32, rmsError: 0, maxDeviation: 0,
    }],
    boltHoleIds: [0],
    forces: [{
      magnitude: 120, direction: [0, 0, -1], position: [L, PLANE_Y, H],
      loadDistribution: "uniform",   // the default is separately asymmetric (#305)
    }],
    print: {
      materialId: "pla", infillPct: 100, wallCount: 3,
      pattern: "grid", orientation: "flat", layerHeightMm: 0.2,
    },
    analysis: {
      meshQuality: "coarse", meshOrder: 2, twoRegion: false,
      ...(symmetryMesh === undefined ? {} : { symmetryMesh }),
    },
    _captureInternals: {},
  };
}

/** Share of element centroids with a mirror partner about y = PLANE_Y. */
function centroidPairingPct(mesh: TetMesh): number {
  const npe = mesh.nodesPerElem;
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const cs: Array<[number, number, number]> = [];
  for (let e = 0; e < mesh.elementCount; e++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const n = mesh.elements[e * npe + k]!;
      x += mesh.nodes[n * 3]!; y += mesh.nodes[n * 3 + 1]!; z += mesh.nodes[n * 3 + 2]!;
    }
    cs.push([x / 4, y / 4, z / 4]);
  }
  const set = new Set(cs.map(c => key(c[0], c[1], c[2])));
  let paired = 0;
  for (const c of cs) if (set.has(key(c[0], 2 * PLANE_Y - c[1], c[2]))) paired++;
  return (100 * paired) / cs.length;
}

describe.skipIf(!probe.found)("symmetry-preserving meshing, end to end (issue #296)", () => {
  let plain: AnalysisResult;
  let symmetric: AnalysisResult;
  let plainReq: AnalysisRequest;
  let symReq: AnalysisRequest;

  beforeAll(async () => {
    plainReq = request(barSoup());
    symReq   = request(barSoup(), true);
    plain     = await runAnalysis(plainReq);
    symmetric = await runAnalysis(symReq);
  }, 600_000);

  it("is genuinely opt-in — an absent flag reports nothing and changes nothing", () => {
    expect(plain.symmetryMesh).toBeNull();
    expect(plain.converged).toBe(true);
  });

  it("applies on a symmetric part and names the plane it used", () => {
    expect(symmetric.symmetryMesh).not.toBeNull();
    expect(symmetric.symmetryMesh!.applied).toBe(true);
    expect(symmetric.symmetryMesh!.reason).toBeNull();
    // The bar's narrow axis is y; the detector may legitimately report other
    // planes too, but the one used must be a real one of this box.
    const n = symmetric.symmetryMesh!.planeNormal!;
    const isAxis = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])]
      .some((c, i, arr) => c > 0.999 && arr.filter(v => v < 1e-3).length === 2);
    expect(isAxis).toBe(true);
    expect(symmetric.symmetryMesh!.seamNodeCount).toBeGreaterThan(0);
  });

  it("produces a mesh that is mirror-symmetric where the ordinary one is not", () => {
    const plainMesh = plainReq._captureInternals!.mesh!;
    const symMesh   = symReq._captureInternals!.mesh!;
    // TetGen's own mesh of this bar is essentially chiral...
    expect(centroidPairingPct(plainMesh)).toBeLessThan(10);
    // ...and the mirrored one pairs essentially completely. This is the whole
    // issue. Not asserted at exactly 100%: the metric buckets centroids on a
    // rounded coordinate hash, and a centroid whose mirrored y lands one ulp
    // across a bucket boundary misses its partner — measured 99.85%, i.e. ~22
    // of 14,260, all at the seam. Exact geometric symmetry is proven
    // independently and without hashing in mirror-mesh.test.ts, which walks
    // every node's mirror image.
    expect(centroidPairingPct(symMesh)).toBeGreaterThan(99);
  });

  it("still solves, with half the elements reversed in orientation", () => {
    expect(symmetric.converged).toBe(true);
    expect(symmetric.maxDisplacementMm).toBeGreaterThan(0);
    expect(symmetric.maxDisplacementMm).toBeLessThan(L);
    // Same part, same load: the two meshes must agree on the physics. Loose,
    // because they are genuinely different discretizations of it.
    const rel = Math.abs(symmetric.maxDisplacementMm - plain.maxDisplacementMm)
              / plain.maxDisplacementMm;
    expect(rel).toBeLessThan(0.25);
  });

  it("degrades to the ordinary mesh, with a reason, on an asymmetric part", async () => {
    const r = await runAnalysis(request(wedgeSoup(), true));
    expect(r.symmetryMesh).not.toBeNull();
    expect(r.symmetryMesh!.applied).toBe(false);
    expect(r.symmetryMesh!.reason).toBeTruthy();
    // Degraded, not broken: the solve still happened on the ordinary mesh.
    expect(r.converged).toBe(true);
    expect(r.maxDisplacementMm).toBeGreaterThan(0);
  }, 300_000);
});
