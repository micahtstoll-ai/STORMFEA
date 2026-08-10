/**
 * mirror-mesh.test.ts — issue #296, step 4 (mirror and weld).
 *
 * `mirrorTetMesh` reflects a fundamental-domain volume mesh across its symmetry
 * plane and welds the seam. These lock the properties that make the result a
 * usable mesh rather than two halves sitting next to each other:
 *
 *   - the seam is welded EXACTLY (shared node indices, not coincident copies),
 *     which is the whole risk in this step — a near-miss seam is a fresh
 *     artifact source, the same class of defect as the vertex-welding bug in
 *     CLAUDE.md's heatmap section;
 *   - volume is conserved (the mirror doubles it, nothing is lost at the seam
 *     and nothing is double-counted);
 *   - the result is geometrically mirror-symmetric to machine precision, which
 *     is the property the whole issue exists to obtain;
 *   - a straddling input is REJECTED rather than silently overlapped.
 *
 * Pure geometry on structured fixtures — no mesher binary, never skips.
 */
import { describe, it, expect } from "vitest";
import { mirrorTetMesh, NotAFundamentalDomainError } from "../../solver/mirrorMesh.js";
import { generateBoxMeshC3D4, generateBoxMeshC3D10 } from "../../solver/meshgen.js";
import { tetCornerVolume } from "../../solver/adaptiveMesh.js";
import type { TetMesh } from "../../solver/types.js";

/** Summed corner volume — the quantity that must exactly double. */
function volumeOf(mesh: TetMesh): number {
  let v = 0;
  for (let e = 0; e < mesh.elementCount; e++) v += tetCornerVolume(mesh, e);
  return v;
}

/** Every node's mirror image must also be a node, to `tol`. */
function mirrorAsymmetry(
  mesh: TetMesh,
  n: readonly [number, number, number],
  o: readonly [number, number, number],
): number {
  // Hash the node cloud so this is O(n) rather than O(n^2) on the finer meshes.
  const key = (x: number, y: number, z: number) =>
    `${Math.round(x * 1e6)},${Math.round(y * 1e6)},${Math.round(z * 1e6)}`;
  const present = new Set<string>();
  for (let i = 0; i < mesh.nodeCount; i++) {
    present.add(key(mesh.nodes[i * 3]!, mesh.nodes[i * 3 + 1]!, mesh.nodes[i * 3 + 2]!));
  }
  let worst = 0;
  for (let i = 0; i < mesh.nodeCount; i++) {
    const px = mesh.nodes[i * 3]!, py = mesh.nodes[i * 3 + 1]!, pz = mesh.nodes[i * 3 + 2]!;
    const d = (px - o[0]) * n[0] + (py - o[1]) * n[1] + (pz - o[2]) * n[2];
    const mx = px - 2 * d * n[0], my = py - 2 * d * n[1], mz = pz - 2 * d * n[2];
    if (!present.has(key(mx, my, mz))) worst = 1;   // no partner at all
  }
  return worst;
}

const PLANE = { normal: [0, 0, 1] as const, origin: [0, 0, 0] as const };

describe("mirrorTetMesh — the seam (issue #296)", () => {
  // A half-slab sitting on z ∈ [-4, 0], so z = 0 is the symmetry plane and the
  // mesh is a fundamental domain by construction.
  const half = generateBoxMeshC3D4(0, 0, -4, 20, 10, 0, 6, 4, 3);

  it("welds the seam by SHARING node indices, not by adding coincident copies", () => {
    const r = mirrorTetMesh(half, PLANE);
    // The z = 0 face of a 6x4x3 box mesh has (6+1)x(4+1) = 35 nodes.
    expect(r.seamNodeCount).toBe(35);
    // Node count grows by the OFF-plane nodes only.
    expect(r.mesh.nodeCount).toBe(half.nodeCount * 2 - r.seamNodeCount);
    expect(r.mesh.elementCount).toBe(half.elementCount * 2);
  });

  it("produces no coincident node pairs anywhere — the seam is exact", () => {
    // The failure this guards: a seam node 1e-12 off the plane mirrors to a
    // DISTINCT node 2e-12 away, and the sliver tets between them are invisible
    // to every check except this one.
    const r = mirrorTetMesh(half, PLANE);
    const seen = new Map<string, number>();
    let coincident = 0;
    for (let i = 0; i < r.mesh.nodeCount; i++) {
      const k = `${r.mesh.nodes[i * 3]!.toFixed(9)},${r.mesh.nodes[i * 3 + 1]!.toFixed(9)},${r.mesh.nodes[i * 3 + 2]!.toFixed(9)}`;
      if (seen.has(k)) coincident++;
      seen.set(k, i);
    }
    expect(coincident).toBe(0);
  });

  it("conserves volume exactly — doubles it, loses nothing at the seam", () => {
    const r = mirrorTetMesh(half, PLANE);
    expect(volumeOf(r.mesh)).toBeCloseTo(2 * volumeOf(half), 9);
    // And equals the analytic whole slab: 20 x 10 x 8.
    expect(volumeOf(r.mesh)).toBeCloseTo(1600, 6);
  });

  it("is geometrically mirror-symmetric — every node has a partner", () => {
    const r = mirrorTetMesh(half, PLANE);
    expect(mirrorAsymmetry(r.mesh, [0, 0, 1], [0, 0, 0])).toBe(0);
  });

  it("keeps every element non-degenerate despite the reversed orientation", () => {
    // A reflection flips the Jacobian sign, which the assemblers absorb via
    // Math.abs. What must NOT happen is a zero-volume element.
    const r = mirrorTetMesh(half, PLANE);
    let minVol = Infinity;
    for (let e = 0; e < r.mesh.elementCount; e++) {
      const v = tetCornerVolume(r.mesh, e);
      if (v < minVol) minVol = v;
    }
    expect(minVol).toBeGreaterThan(0);
  });

  it("works on C3D10 without touching midside ordering", () => {
    // Node lists are copied verbatim through the index map, so every edge
    // relationship survives by construction — no C3D10_EDGE_PAIRS surgery.
    const halfQ = generateBoxMeshC3D10(0, 0, -4, 20, 10, 0, 3, 2, 2);
    const r = mirrorTetMesh(halfQ, PLANE);
    expect(r.mesh.nodesPerElem).toBe(10);
    expect(r.mesh.elementCount).toBe(halfQ.elementCount * 2);
    expect(volumeOf(r.mesh)).toBeCloseTo(2 * volumeOf(halfQ), 9);
    // Midside nodes still sit at their edges' midpoints on the mirrored half.
    const EDGES: [number, number][] = [[0,1],[1,2],[0,2],[0,3],[1,3],[2,3]];
    let worst = 0;
    for (let e = halfQ.elementCount; e < r.mesh.elementCount; e++) {
      for (let m = 0; m < 6; m++) {
        const [a, b] = EDGES[m]!;
        const na = r.mesh.elements[e * 10 + a]!, nb = r.mesh.elements[e * 10 + b]!;
        const nm = r.mesh.elements[e * 10 + 4 + m]!;
        for (let c = 0; c < 3; c++) {
          const mid = 0.5 * (r.mesh.nodes[na * 3 + c]! + r.mesh.nodes[nb * 3 + c]!);
          worst = Math.max(worst, Math.abs(mid - r.mesh.nodes[nm * 3 + c]!));
        }
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });
});

describe("mirrorTetMesh — snapping and preconditions", () => {
  it("snaps near-plane nodes onto it so the weld is exact, and reports it", () => {
    // Perturb the seam nodes by less than tolerance. Without the snap each
    // would mirror to a distinct node and the seam would double up.
    const half = generateBoxMeshC3D4(0, 0, -4, 20, 10, 0, 4, 3, 2);
    const nodes = new Float64Array(half.nodes);
    const diag = Math.sqrt(20 * 20 + 10 * 10 + 4 * 4);
    const nudge = diag * 1e-9;             // well inside surfaceSnapTolerance (1e-6·diag)
    let nudged = 0;
    for (let n = 0; n < half.nodeCount; n++) {
      if (Math.abs(nodes[n * 3 + 2]!) < 1e-12) { nodes[n * 3 + 2] = -nudge; nudged++; }
    }
    const perturbed: TetMesh = { ...half, nodes };

    const r = mirrorTetMesh(perturbed, PLANE);
    expect(nudged).toBeGreaterThan(0);
    expect(r.snappedNodeCount).toBe(nudged);
    expect(r.maxSnapDistance).toBeCloseTo(nudge, 15);
    expect(r.seamNodeCount).toBe(nudged);
    // Still exactly one node per seam position.
    expect(r.mesh.nodeCount).toBe(perturbed.nodeCount * 2 - r.seamNodeCount);
  });

  it("rejects a mesh that straddles the plane instead of overlapping it", () => {
    // The whole slab, not a half. Mirroring this would place two copies of the
    // material in the same region — a part twice as stiff, which no mesh
    // quality gate would flag.
    const whole = generateBoxMeshC3D4(0, 0, -4, 20, 10, 4, 4, 3, 4);
    expect(() => mirrorTetMesh(whole, PLANE)).toThrow(NotAFundamentalDomainError);
  });

  it("infers the material side, so the caller need not orient the normal", () => {
    const half = generateBoxMeshC3D4(0, 0, -4, 20, 10, 0, 4, 3, 2);
    const a = mirrorTetMesh(half, { normal: [0, 0, 1], origin: [0, 0, 0] });
    const b = mirrorTetMesh(half, { normal: [0, 0, -1], origin: [0, 0, 0] });
    expect(b.mesh.nodeCount).toBe(a.mesh.nodeCount);
    expect(volumeOf(b.mesh)).toBeCloseTo(volumeOf(a.mesh), 9);
  });

  it("handles an off-origin, non-axis-aligned plane", () => {
    // Half-slab below z = 3, mirrored about z = 3 with an unnormalised normal.
    const half = generateBoxMeshC3D4(0, 0, 0, 12, 8, 3, 3, 2, 2);
    const r = mirrorTetMesh(half, { normal: [0, 0, 7], origin: [0, 0, 3] });
    expect(volumeOf(r.mesh)).toBeCloseTo(2 * volumeOf(half), 9);
    expect(mirrorAsymmetry(r.mesh, [0, 0, 1], [0, 0, 3])).toBe(0);
    // The mirrored half reaches z = 6 and no further.
    let maxZ = -Infinity;
    for (let n = 0; n < r.mesh.nodeCount; n++) maxZ = Math.max(maxZ, r.mesh.nodes[n * 3 + 2]!);
    expect(maxZ).toBeCloseTo(6, 9);
  });
});
