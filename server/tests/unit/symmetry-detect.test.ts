/**
 * symmetry-detect.test.ts — issue #296
 *
 * `detectSymmetryPlanes` answers "is this part mirror-symmetric, and about
 * what plane?", which is the gate for symmetry-preserving meshing. The tests
 * that matter most are the two that could quietly invalidate the feature:
 *
 *  - a symmetric part whose MESH is asymmetric must still be detected (this is
 *    the entire condition being detected, so a mesh-entity-matching
 *    implementation would fail it while passing everything else), and
 *  - a part with a feature on one side only must be REJECTED, or the mirror
 *    step would fabricate geometry that is not there.
 */

import { describe, it, expect } from "vitest";
import { generateBoxMeshC3D10, extractSurfaceFaces } from "../../solver/meshgen.js";
import { detectSymmetryPlanes, SYMMETRY_DEFAULT_TOL_REL, SYMMETRY_DEDUP_ANGLE_DEG }
  from "../../solver/symmetry.js";
import { buildPlateWithHoleMesh } from "../../coupon_fea.js";
import type { TetMesh } from "../../solver/types.js";

function boxMesh(L: number, W: number, T: number, nx = 3, ny = 2, nz = 2): TetMesh {
  const m = generateBoxMeshC3D10(0, 0, 0, L, W, T, nx, ny, nz);
  return { nodes: m.nodes, elements: m.elements, nodeCount: m.nodeCount,
           elementCount: m.elementCount, nodesPerElem: 10 };
}

/** Displace interior nodes only, so the SURFACE is untouched but the mesh is not symmetric. */
function jitterInterior(mesh: TetMesh, L: number, W: number, T: number, amp: number): TetMesh {
  const nodes = Float64Array.from(mesh.nodes);
  let s = 12345 >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) - 0.5;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const x = nodes[n * 3]!, y = nodes[n * 3 + 1]!, z = nodes[n * 3 + 2]!;
    const onB = x < 1e-9 || x > L - 1e-9 || y < 1e-9 || y > W - 1e-9 || z < 1e-9 || z > T - 1e-9;
    if (onB) continue;
    nodes[n * 3] = x + amp * rnd();
    nodes[n * 3 + 1] = y + amp * rnd();
    nodes[n * 3 + 2] = z + amp * rnd();
  }
  return { ...mesh, nodes };
}

const axis = (p: { normal: readonly [number, number, number] }): string => {
  const [x, y, z] = p.normal.map(Math.abs) as [number, number, number];
  if (x > 0.99) return "x";
  if (y > 0.99) return "y";
  if (z > 0.99) return "z";
  return "oblique";
};

describe("detectSymmetryPlanes", () => {
  it("finds all three mirror planes of a box", () => {
    const mesh = boxMesh(40, 20, 10);
    const planes = detectSymmetryPlanes(mesh, extractSurfaceFaces(mesh));
    const axes = new Set(planes.map(axis));
    expect(axes.has("x")).toBe(true);
    expect(axes.has("y")).toBe(true);
    expect(axes.has("z")).toBe(true);
  });

  it("finds EXACTLY three — near-duplicate principal axes must collapse", () => {
    // Regression guard. The covariance is built from the boundary
    // triangulation's centroid cloud, which is chiral, so the principal axes of
    // an axis-aligned box come back rotated by ~1e-4 rad. Measured on this
    // geometry at 3,072 elements they were [0.000225, 0.000460, 1.000000] and
    // friends — dot 1 - 1.3e-7 against the true axis, which passed a 1e-9
    // duplicate test and then passed verification on its own, so the detector
    // reported SIX planes for a box. Several mesh densities, because the
    // rotation only appears once the surface triangulation is fine enough.
    for (const [nx, ny, nz] of [[3, 2, 2], [8, 4, 2], [16, 8, 4], [12, 6, 3]] as const) {
      const m = generateBoxMeshC3D10(0, 0, 0, 100, 50, 20, nx, ny, nz);
      const mesh: TetMesh = { nodes: m.nodes, elements: m.elements, nodeCount: m.nodeCount,
                              elementCount: m.elementCount, nodesPerElem: 10 };
      const planes = detectSymmetryPlanes(mesh, extractSurfaceFaces(mesh));
      expect(planes.length).toBe(3);
      expect(new Set(planes.map(axis))).toEqual(new Set(["x", "y", "z"]));
    }
  });

  it("a cube's extra (diagonal) symmetries do not multiply into near-duplicates", () => {
    // A cube has more than three mirror planes, and its covariance is fully
    // degenerate so the eigenvectors are numerically arbitrary. Whatever is
    // returned must still be pairwise distinct by more than the dedup angle.
    const m = generateBoxMeshC3D10(0, 0, 0, 20, 20, 20, 4, 4, 4);
    const mesh: TetMesh = { nodes: m.nodes, elements: m.elements, nodeCount: m.nodeCount,
                            elementCount: m.elementCount, nodesPerElem: 10 };
    const planes = detectSymmetryPlanes(mesh, extractSurfaceFaces(mesh));
    expect(planes.length).toBeGreaterThan(0);
    const cosDedup = Math.cos((SYMMETRY_DEDUP_ANGLE_DEG * Math.PI) / 180);
    for (let i = 0; i < planes.length; i++) {
      for (let j = i + 1; j < planes.length; j++) {
        const d = Math.abs(planes[i]!.normal[0] * planes[j]!.normal[0] +
                           planes[i]!.normal[1] * planes[j]!.normal[1] +
                           planes[i]!.normal[2] * planes[j]!.normal[2]);
        expect(d).toBeLessThanOrEqual(cosDedup);
      }
    }
  });

  it("puts every plane through the part centre", () => {
    const L = 40, W = 20, T = 10;
    const mesh = boxMesh(L, W, T);
    for (const p of detectSymmetryPlanes(mesh, extractSurfaceFaces(mesh))) {
      expect(p.origin[0]).toBeCloseTo(L / 2, 6);
      expect(p.origin[1]).toBeCloseTo(W / 2, 6);
      expect(p.origin[2]).toBeCloseTo(T / 2, 6);
    }
  });

  it("works on a box NOT centred at the origin (the centroid, not the origin, defines the plane)", () => {
    const m = generateBoxMeshC3D10(100, -50, 7, 140, -30, 17, 3, 2, 2);
    const mesh: TetMesh = { nodes: m.nodes, elements: m.elements, nodeCount: m.nodeCount,
                            elementCount: m.elementCount, nodesPerElem: 10 };
    const planes = detectSymmetryPlanes(mesh, extractSurfaceFaces(mesh));
    expect(planes.length).toBeGreaterThanOrEqual(3);
    for (const p of planes) {
      expect(p.origin[0]).toBeCloseTo(120, 6);
      expect(p.origin[1]).toBeCloseTo(-40, 6);
      expect(p.origin[2]).toBeCloseTo(12, 6);
    }
  });

  it("THE CASE THAT MATTERS: symmetric part, asymmetric mesh, still detected", () => {
    // Interior nodes are displaced so the mesh has no mirror correspondence at
    // all, while the surface stays exactly symmetric. An implementation that
    // verified by matching mesh entities would fail here and pass every other
    // test in this file.
    const L = 40, W = 20, T = 10;
    const base = boxMesh(L, W, T, 4, 3, 3);
    const jittered = jitterInterior(base, L, W, T, 1.5);

    // Confirm the premise: the mesh really is no longer mirror-symmetric.
    const key = (n: number, m: TetMesh) =>
      `${m.nodes[n*3]!.toFixed(6)}|${m.nodes[n*3+1]!.toFixed(6)}|${m.nodes[n*3+2]!.toFixed(6)}`;
    const present = new Set<string>();
    for (let n = 0; n < jittered.nodeCount; n++) present.add(key(n, jittered));
    let unmatched = 0;
    for (let n = 0; n < jittered.nodeCount; n++) {
      const mx = jittered.nodes[n*3]!, my = W - jittered.nodes[n*3+1]!, mz = jittered.nodes[n*3+2]!;
      if (!present.has(`${mx.toFixed(6)}|${my.toFixed(6)}|${mz.toFixed(6)}`)) unmatched++;
    }
    expect(unmatched).toBeGreaterThan(0);

    // Detection must still succeed, because the SURFACE is symmetric.
    const planes = detectSymmetryPlanes(jittered, extractSurfaceFaces(jittered));
    expect(new Set(planes.map(axis)).has("y")).toBe(true);
  });

  it("REJECTS a part with a feature on one side only", () => {
    // Push one surface node inward by 8% of the width. The part is no longer
    // mirror-symmetric about y, and accepting it would let the mirror step
    // fabricate geometry the user never modelled.
    const L = 40, W = 20, T = 10;
    const mesh = boxMesh(L, W, T, 4, 4, 3);
    const faces = extractSurfaceFaces(mesh);
    const nodes = Float64Array.from(mesh.nodes);
    let moved = -1;
    for (let n = 0; n < mesh.nodeCount && moved < 0; n++) {
      // an interior-of-face node on y = 0, away from the edges
      if (Math.abs(nodes[n*3+1]!) > 1e-9) continue;
      const x = nodes[n*3]!, z = nodes[n*3+2]!;
      if (x > 5 && x < L - 5 && z > 2 && z < T - 2) moved = n;
    }
    expect(moved).toBeGreaterThanOrEqual(0);
    nodes[moved * 3 + 1] = 0.08 * W;
    const dented: TetMesh = { ...mesh, nodes };

    const planes = detectSymmetryPlanes(dented, faces);
    expect(new Set(planes.map(axis)).has("y")).toBe(false);
    // The other two planes are unaffected by a dent on a y face only in the
    // sense that the dent breaks them too (it is a single point, not a
    // mirrored pair), so assert only the y claim, which is the one that
    // matters for a y-plane mirror.
  });

  it("finds the two planes of a centred plate with a central hole", () => {
    // Curved internal boundary, and a genuinely non-trivial surface: the bore
    // must mirror onto itself for the x and z planes to be accepted.
    const mesh = buildPlateWithHoleMesh({
      widthMm: 30, thickMm: 4, lengthMm: 60, holeR: 5, nTheta: 24, ns: 5, nThick: 2,
    });
    const planes = detectSymmetryPlanes(mesh, extractSurfaceFaces(mesh));
    expect(planes.length).toBeGreaterThanOrEqual(2);
    for (const p of planes) expect(p.residual).toBeLessThan(SYMMETRY_DEFAULT_TOL_REL);
  });

  it("residual is ~0 for an exact mirror and planes come back best-first", () => {
    const mesh = boxMesh(40, 20, 10);
    const planes = detectSymmetryPlanes(mesh, extractSurfaceFaces(mesh));
    expect(planes.length).toBeGreaterThan(0);
    for (const p of planes) expect(p.residual).toBeLessThan(1e-9);
    for (let i = 1; i < planes.length; i++)
      expect(planes[i]!.residual).toBeGreaterThanOrEqual(planes[i - 1]!.residual);
  });

  it("normals are unit length and de-duplicated", () => {
    const mesh = boxMesh(40, 20, 10);
    const planes = detectSymmetryPlanes(mesh, extractSurfaceFaces(mesh));
    for (const p of planes) {
      expect(Math.hypot(p.normal[0], p.normal[1], p.normal[2])).toBeCloseTo(1, 12);
    }
    // +n and -n are the same plane and must not both be reported.
    for (let i = 0; i < planes.length; i++) {
      for (let j = i + 1; j < planes.length; j++) {
        const d = Math.abs(planes[i]!.normal[0] * planes[j]!.normal[0] +
                           planes[i]!.normal[1] * planes[j]!.normal[1] +
                           planes[i]!.normal[2] * planes[j]!.normal[2]);
        expect(d).toBeLessThan(1 - 1e-9);
      }
    }
  });

  it("a tighter tolerance never accepts more planes than a looser one", () => {
    const mesh = boxMesh(40, 20, 10, 4, 3, 3);
    const faces = extractSurfaceFaces(mesh);
    const loose = detectSymmetryPlanes(mesh, faces, 1e-2).length;
    const tight = detectSymmetryPlanes(mesh, faces, 1e-9).length;
    expect(tight).toBeLessThanOrEqual(loose);
  });

  it("returns empty rather than throwing on degenerate input", () => {
    const mesh = boxMesh(40, 20, 10);
    expect(detectSymmetryPlanes(mesh, new Int32Array(0))).toEqual([]);
  });
});
