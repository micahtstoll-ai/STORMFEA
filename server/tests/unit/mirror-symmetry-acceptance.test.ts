/**
 * mirror-symmetry-acceptance.test.ts — issue #296's acceptance criterion.
 *
 * The issue: an unstructured tet mesh of a mirror-symmetric part is not itself
 * mirror-symmetric, so the recovered stress field carries an asymmetry the
 * geometry does not have. Acceptance: "A symmetric part under a symmetric load
 * should return an SPR nodal field whose mirror asymmetry is at the level of the
 * displacement field (order 0.001%), not 0.5-1.8%."
 *
 * The comparison is controlled so mesh CONNECTIVITY is the only variable: both
 * meshes carry the same node grid, the same node count and the same element
 * count. One is cut chirally across the plane; the other is a half mesh put
 * through `mirrorTetMesh`.
 *
 * ── The premise is asserted, not assumed ─────────────────────────────────────
 * The chirality is measured first, by counting element centroids that have a
 * mirror partner. Without that check a "chiral" fixture that happens to be
 * symmetric would make the comparison vacuous — which is exactly what an earlier
 * revision of this file risked, and why the counts are in the test rather than
 * in a comment.
 *
 * ── The load has to be symmetric, and that is not automatic ──────────────────
 * These use `loadDistribution: "uniform"`. The DEFAULT `contact_patch` (#271)
 * injects its own asymmetry: measured on the perfectly symmetric mirrored mesh
 * below, with the load placed exactly ON the symmetry plane, it produces 5.04%
 * SPR asymmetry where uniform produces 0.0000%. That is a defect in the load
 * distribution, not in the mesh, and it is tracked separately — but it means a
 * symmetry measurement using the default load would be measuring the load.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis, type AnalysisRequest } from "../../analysis.js";
import { generateBoxMeshC3D10, extractSurfaceFaces } from "../../solver/meshgen.js";
import { mirrorTetMesh } from "../../solver/mirrorMesh.js";
import type { TetMesh } from "../../solver/types.js";

const L = 24, W = 12, H = 6;
const PLANE_Y = W / 2;

function barSoup(): { positions: Float32Array; triangleCount: number } {
  const c: Array<[number, number, number]> = [
    [0, 0, 0], [L, 0, 0], [L, W, 0], [0, W, 0],
    [0, 0, H], [L, 0, H], [L, W, H], [0, W, H],
  ];
  const quads = [[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[0,3,7,4],[1,5,6,2]];
  const tris: Array<[number, number, number][]> = [];
  for (const [a, b, cc, d] of quads) tris.push([c[a!]!, c[b!]!, c[cc!]!], [c[a!]!, c[cc!]!, c[d!]!]);
  const positions = new Float32Array(tris.length * 9);
  tris.forEach((t, ti) => t.forEach((p, k) => p.forEach((v, ci) => { positions[ti * 9 + k * 3 + ci] = v; })));
  return { positions, triangleCount: tris.length };
}

function request(mesh: TetMesh): AnalysisRequest {
  const { positions, triangleCount } = barSoup();
  const surfaceToNode = new Int32Array(mesh.nodeCount);
  for (let i = 0; i < surfaceToNode.length; i++) surfaceToNode[i] = i;
  return {
    positions, triangleCount, fileType: "stl",
    bounds: { minX: 0, maxX: L, minY: 0, maxY: W, minZ: 0, maxZ: H },
    // Bolt region centred ON the symmetry plane, so the constraint set is
    // itself mirror-symmetric. Without any constraint the bar is a rigid-body
    // mode and the solve runs away (measured: ~1e16 mm), which the convergence
    // premise below catches.
    holes: [{
      id: 0, centre: [3, PLANE_Y, H / 2], normal: [0, 0, 1], radius: 2,
      confidence: 1, edgeCount: 32, rmsError: 0, maxDeviation: 0,
    }],
    boltHoleIds: [0],
    forces: [{
      magnitude: 120, direction: [0, 0, -1], position: [L, PLANE_Y, H],
      loadDistribution: "uniform",     // see the header — the default is not symmetric
    }],
    print: {
      materialId: "pla", infillPct: 100, wallCount: 3,
      pattern: "grid", orientation: "flat", layerHeightMm: 0.2,
    },
    analysis: { meshQuality: "standard", meshOrder: 2, includeVolumeField: true, twoRegion: false },
    _prebuiltMesh: { mesh, surfaceToNode, surfaceFaces: extractSurfaceFaces(mesh) },
  };
}

const decodeF32 = (b64: string): Float32Array => {
  const buf = Buffer.from(b64, "base64");
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
};

const posKey = (x: number, y: number, z: number) =>
  `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;

/** Share of element centroids that have a mirror partner — the chirality metric. */
function centroidPairingPct(mesh: TetMesh): number {
  const npe = mesh.nodesPerElem;
  const cs: Array<[number, number, number]> = [];
  for (let e = 0; e < mesh.elementCount; e++) {
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 4; k++) {
      const n = mesh.elements[e * npe + k]!;
      x += mesh.nodes[n * 3]!; y += mesh.nodes[n * 3 + 1]!; z += mesh.nodes[n * 3 + 2]!;
    }
    cs.push([x / 4, y / 4, z / 4]);
  }
  const set = new Set(cs.map(c => posKey(c[0], c[1], c[2])));
  let paired = 0;
  for (const c of cs) if (set.has(posKey(c[0], 2 * PLANE_Y - c[1], c[2]))) paired++;
  return (100 * paired) / cs.length;
}

/** RMS mirror asymmetry of a per-node field, as a percentage of its peak. */
function asymmetryPct(mesh: TetMesh, field: Float32Array): { pct: number; unpaired: number } {
  const index = new Map<string, number>();
  for (let i = 0; i < mesh.nodeCount; i++) {
    index.set(posKey(mesh.nodes[i*3]!, mesh.nodes[i*3+1]!, mesh.nodes[i*3+2]!), i);
  }
  let sumSq = 0, paired = 0, unpaired = 0, peak = 0;
  for (let i = 0; i < mesh.nodeCount; i++) {
    peak = Math.max(peak, Math.abs(field[i] ?? 0));
    const j = index.get(posKey(mesh.nodes[i*3]!, 2 * PLANE_Y - mesh.nodes[i*3+1]!, mesh.nodes[i*3+2]!));
    if (j === undefined) { unpaired++; continue; }
    const d = (field[i] ?? 0) - (field[j] ?? 0);
    sumSq += d * d; paired++;
  }
  return { pct: peak > 0 ? (Math.sqrt(sumSq / paired) / peak) * 100 : NaN, unpaired };
}

const chiral   = generateBoxMeshC3D10(0, 0, 0, L, W, H, 8, 4, 2);
const halfMesh = generateBoxMeshC3D10(0, 0, 0, L, PLANE_Y, H, 8, 2, 2);
const mirrored = mirrorTetMesh(halfMesh, { normal: [0, 1, 0], origin: [0, PLANE_Y, 0] }).mesh;

describe("issue #296 acceptance: mirroring removes the mesh's own asymmetry", () => {
  it("premise: the meshes differ ONLY in chirality", () => {
    // Same grid, same size — a lower asymmetry from a coarser mesh would prove
    // nothing.
    expect(mirrored.nodeCount).toBe(chiral.nodeCount);
    expect(mirrored.elementCount).toBe(chiral.elementCount);
    // And the baseline really is chiral: 128 of 384 centroids pair, which is
    // the exact figure the issue reports for its own fixture.
    expect(centroidPairingPct(chiral)).toBeCloseTo(33.33, 1);
    // ...while the mirrored mesh pairs completely.
    expect(centroidPairingPct(mirrored)).toBe(100);
  });

  it("the chiral mesh injects SPR asymmetry the geometry does not have", async () => {
    const r = await runAnalysis(request(chiral));
    expect(r.converged).toBe(true);
    expect(r.maxDisplacementMm).toBeLessThan(L);
    const a = asymmetryPct(chiral, decodeF32(r.volumeField!.nodeVonMisesB64));
    expect(a.unpaired).toBe(0);
    // Measured 3.909%. Locked loosely: this is the defect's magnitude, and if it
    // ever collapsed on its own the comparison below would be vacuous.
    expect(a.pct).toBeGreaterThan(1);
  }, 300_000);

  it("the mirrored mesh removes it entirely", async () => {
    const r = await runAnalysis(request(mirrored));
    expect(r.converged).toBe(true);
    expect(r.maxDisplacementMm).toBeLessThan(L);
    const a = asymmetryPct(mirrored, decodeF32(r.volumeField!.nodeVonMisesB64));
    expect(a.unpaired).toBe(0);
    // Acceptance asked for "order 0.001%". Measured 0.0000% — exactly zero to
    // float32 print precision, because the mesh, the constraint set and the
    // load are each symmetric, so the whole discrete problem is.
    expect(a.pct).toBeLessThan(0.001);
  }, 300_000);

  it("the principal stresses are symmetric too, not just von Mises", async () => {
    // von Mises alone could hide a sign-flipped asymmetry; the principals cannot.
    const r = await runAnalysis(request(mirrored));
    for (const b64 of [r.volumeField!.nodePrincipal1B64, r.volumeField!.nodePrincipal3B64]) {
      expect(asymmetryPct(mirrored, decodeF32(b64)).pct).toBeLessThan(0.001);
    }
  }, 300_000);
});
