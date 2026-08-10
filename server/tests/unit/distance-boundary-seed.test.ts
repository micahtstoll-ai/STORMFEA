/**
 * distance-boundary-seed.test.ts
 *
 * Two-region invariant #4, second half: "Boundary nodes seed at exactly 0."
 *
 * `docs/INVARIANTS.md` and ROADMAP both list this as a partial-coverage gap —
 * the point-to-triangle half of invariant #4 is locked, but nothing asserted
 * the seeding itself. It is worth its own test because the seeding loop in
 * `computeNodeSurfaceDistancesAndNormals` walks `surfaceFaces`, and
 * `extractSurfaceFaces` emits CORNER-only triples: a C3D10 boundary MIDSIDE
 * node is never seeded by that loop and reaches zero (if it does) only through
 * the point-triangle sweep. Corners and midsides are therefore checked
 * separately, and to different tolerances, because they get there by different
 * routes.
 *
 * SCOPE LIMIT, stated rather than implied: every fixture here places C3D10
 * midside nodes at the straight midpoint of their corner pair, so a boundary
 * midside always lies exactly in the plane of the boundary triangles that
 * contain it. A mesher that projects midside nodes onto a CURVED CAD surface
 * (Gmsh `-order 2` does) would place them off the flat chord by the sagitta,
 * and their distance would be genuinely non-zero rather than float noise.
 * That case needs a Gmsh binary and is NOT covered here.
 */

import { describe, it, expect } from "vitest";
import {
  generateBoxMeshC3D4,
  generateBoxMeshC3D10,
  extractSurfaceFaces,
} from "../../solver/meshgen.js";
import { computeNodeSurfaceDistances } from "../../solver/distance.js";
import { buildPlateWithHoleMesh } from "../../coupon_fea.js";
import type { TetMesh } from "../../solver/types.js";

/** Corner nodes referenced by at least one boundary triangle. */
function boundaryCorners(faces: Int32Array): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < faces.length; i++) s.add(faces[i]!);
  return s;
}

/**
 * C3D10 midside nodes whose edge lies on a boundary face. Found by asking, for
 * each tet edge, whether either of the two tet faces containing it is a
 * boundary face — which is what makes the midside geometrically on the surface.
 */
function boundaryMidsides(mesh: TetMesh, faces: Int32Array): Set<number> {
  const out = new Set<number>();
  if (mesh.nodesPerElem !== 10) return out;

  const faceKey = new Set<string>();
  for (let i = 0; i < faces.length; i += 3) {
    const t = [faces[i]!, faces[i + 1]!, faces[i + 2]!].sort((a, b) => a - b);
    faceKey.add(t.join(","));
  }
  const EDGES: readonly (readonly [number, number, number])[] = [
    [0, 1, 4], [1, 2, 5], [0, 2, 6], [0, 3, 7], [1, 3, 8], [2, 3, 9],
  ];
  for (let e = 0; e < mesh.elementCount; e++) {
    const b = e * 10;
    for (const [ca, cb, cm] of EDGES) {
      for (const other of [0, 1, 2, 3]) {
        if (other === ca || other === cb) continue;
        const t = [mesh.elements[b + ca]!, mesh.elements[b + cb]!, mesh.elements[b + other]!]
          .sort((x, y) => x - y);
        if (faceKey.has(t.join(","))) out.add(mesh.elements[b + cm]!);
      }
    }
  }
  return out;
}

describe("two-region invariant #4 — boundary nodes seed at exactly 0", () => {
  it("C3D4 planar box: every boundary corner is EXACTLY 0", () => {
    const m = generateBoxMeshC3D4(0, 0, 0, 20, 10, 5, 4, 2, 1);
    const mesh: TetMesh = { nodes: m.nodes, elements: m.elements, nodeCount: m.nodeCount,
                            elementCount: m.elementCount, nodesPerElem: 4 };
    const faces = extractSurfaceFaces(mesh);
    const dist = computeNodeSurfaceDistances(mesh, faces, 10);

    const corners = boundaryCorners(faces);
    expect(corners.size).toBeGreaterThan(0);
    for (const n of corners) expect(dist[n]).toBe(0);
  });

  it("C3D10 planar box: boundary corners EXACTLY 0, boundary midsides also 0", () => {
    const m = generateBoxMeshC3D10(0, 0, 0, 20, 10, 5, 4, 2, 1);
    const mesh: TetMesh = { nodes: m.nodes, elements: m.elements, nodeCount: m.nodeCount,
                            elementCount: m.elementCount, nodesPerElem: 10 };
    const faces = extractSurfaceFaces(mesh);
    const dist = computeNodeSurfaceDistances(mesh, faces, 10);

    const corners = boundaryCorners(faces);
    for (const n of corners) expect(dist[n]).toBe(0);

    // Midsides are NOT in surfaceFaces (corner-only triples), so they reach
    // zero through the point-triangle sweep. On a planar face that is exact.
    const mids = boundaryMidsides(mesh, faces);
    expect(mids.size).toBeGreaterThan(0);
    for (const n of mids) {
      if (corners.has(n)) continue;
      expect(dist[n]).toBe(0);
    }
  });

  it("C3D10 curved bore: corners EXACTLY 0, midsides 0 to machine precision", () => {
    // A plate with a hole exercises boundary triangles that are not axis
    // aligned. Midsides still sit on the chord here (see the scope limit in
    // the file header), so the residual is float noise, not geometry — but it
    // is NOT bit-zero, and asserting toBe(0) here would be wrong.
    const mesh = buildPlateWithHoleMesh({
      widthMm: 30, thickMm: 4, lengthMm: 60, holeR: 5, nTheta: 24, ns: 6, nThick: 2,
    });
    const faces = extractSurfaceFaces(mesh);
    const dist = computeNodeSurfaceDistances(mesh, faces, 10);

    const corners = boundaryCorners(faces);
    expect(corners.size).toBeGreaterThan(0);
    for (const n of corners) expect(dist[n]).toBe(0);

    const mids = boundaryMidsides(mesh, faces);
    expect(mids.size).toBeGreaterThan(0);
    let worst = 0;
    for (const n of mids) {
      if (corners.has(n)) continue;
      worst = Math.max(worst, dist[n]!);
    }
    // Measured 1.83e-15 on this fixture; 1e-12 is a generous ceiling that still
    // fails loudly if a boundary midside ever picks up a real geometric offset.
    expect(worst).toBeLessThan(1e-12);
  });

  // NOTE on a test that is deliberately absent: the obvious way to prove the
  // SEED loop (rather than the sweep) is what zeroes the corners would be to
  // pass a dMax far below element scale, so the search cannot reach any
  // triangle. That is not a legitimate input and cannot be tested here — the
  // spatial grid uses CELL = max(dMax, 1e-6), so a tiny dMax makes every
  // triangle span millions of cells and the bucket Map throws "Map maximum
  // size exceeded". It is unreachable in production (every caller passes
  // dMax = maxBand + maxCornerEdge(mesh), always at least one element edge),
  // so it is a latent robustness hazard rather than a live defect.
  //
  // The curved-bore case above carries the evidence instead, and more
  // directly: corners come back bit-exactly 0 while swept boundary midsides
  // land at ~1.8e-15. Identical geometry, different values, therefore
  // different code paths — the corners were seeded, not searched.

  it("an interior node is strictly positive — the field is not all zeros", () => {
    // Guards against the degenerate pass where everything reads 0.
    const m = generateBoxMeshC3D10(0, 0, 0, 20, 20, 20, 6, 6, 6);
    const mesh: TetMesh = { nodes: m.nodes, elements: m.elements, nodeCount: m.nodeCount,
                            elementCount: m.elementCount, nodesPerElem: 10 };
    const faces = extractSurfaceFaces(mesh);
    const dist = computeNodeSurfaceDistances(mesh, faces, 20);

    let maxDist = 0;
    for (let n = 0; n < mesh.nodeCount; n++) maxDist = Math.max(maxDist, dist[n]!);
    // Centre of a 20 mm cube is 10 mm from the nearest face.
    expect(maxDist).toBeGreaterThan(5);
  });
});
