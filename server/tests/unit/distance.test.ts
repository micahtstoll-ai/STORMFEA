/**
 * distance.test.ts
 * ----------------
 * Dedicated known-answer tests for the point-to-triangle distance field
 * (server/solver/distance.ts) that the two-region (shell/core) classification
 * stands on. Closes #195.
 *
 * EVERY expected value in this file is computed BY HAND from the geometry and
 * documented in the comment above the assertion — none is read back from the
 * function under test. That is the whole point of a known-answer anchor: it
 * would catch a systematic error in the distances that the equal-thickness
 * equivalence tests in skin-band.test.ts / wallfrac.test.ts cannot.
 *
 * Coverage (issue #195 acceptance criteria):
 *   1. pointTriangleDistance across ALL Voronoi regions — interior/face
 *      projection, each of the 3 edges, each of the 3 vertices — plus a large
 *      boundary triangle where nearest-NODE would give a materially different
 *      (and wrong) answer.
 *   2. one-ring completeness: a fixture whose nearest triangle sits in a
 *      DIAGONAL grid cell (corner neighbour), verifying the 27-cell search
 *      actually includes diagonals (a face-only search would miss it).
 *   3. normal direction: unit length, and pointing FROM the closest surface
 *      point TOWARD the node (into the part), the documented convention.
 *   4. dMax clamping: at and just-below the clamp radius.
 *   5. boundary nodes seed at exactly 0; every surface corner node gets a
 *      distance in [0, dMax].
 */

import { describe, it, expect } from "vitest";
import {
  pointTriangleDistance,
  computeNodeSurfaceDistances,
  computeNodeSurfaceDistancesAndNormals,
} from "../../solver/distance.js";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import type { TetMesh } from "../../solver/types.js";

describe("pointTriangleDistance — all Voronoi regions (hand-computed)", () => {
  // Reference triangle: a 3-4-5 right triangle in the z = 0 plane.
  //   A = (0,0,0), B = (4,0,0), C = (0,3,0)
  // Edge AB lies on the x-axis (length 4); edge AC on the y-axis (length 3);
  // hypotenuse BC has length 5 and lives on the line 3x + 4y = 12.
  const A = [0, 0, 0] as const;
  const B = [4, 0, 0] as const;
  const C = [0, 3, 0] as const;
  const tri = [...A, ...B, ...C] as const;

  it("FACE region: perpendicular foot lands INSIDE the triangle", () => {
    // P = (1,1,2). Foot = (1,1,0); barycentric check x/4 + y/3 = 0.25 + 0.333 < 1
    // and x,y > 0, so the foot is interior. Distance = |z| = 2.
    expect(pointTriangleDistance(1, 1, 2, ...tri)).toBeCloseTo(2, 12);
  });

  it("VERTEX A region: closest feature is corner A", () => {
    // P = (-3,-4,0). Both AB·AP = -12 ≤ 0 and AC·AP = -12 ≤ 0, so the closest
    // point is A itself. Distance = |(-3,-4,0)| = sqrt(9+16) = 5.
    expect(pointTriangleDistance(-3, -4, 0, ...tri)).toBeCloseTo(5, 12);
  });

  it("VERTEX B region: closest feature is corner B", () => {
    // P = (7,0,4). Past B along the AB line (x = 7 > 4) and lifted in z.
    // Closest point is B = (4,0,0). Distance = |(3,0,4)| = sqrt(9+16) = 5.
    expect(pointTriangleDistance(7, 0, 4, ...tri)).toBeCloseTo(5, 12);
  });

  it("VERTEX C region: closest feature is corner C", () => {
    // P = (0,7,3). Past C along the AC line (y = 7 > 3) and lifted in z.
    // Closest point is C = (0,3,0). Distance = |(0,4,3)| = sqrt(16+9) = 5.
    expect(pointTriangleDistance(0, 7, 3, ...tri)).toBeCloseTo(5, 12);
  });

  it("EDGE AB region: closest point is interior to segment AB", () => {
    // P = (2,-3,4). Foot on AB (the x-axis) is (2,0,0), the midpoint of AB,
    // which is interior to the segment. Distance = |(0,-3,4)| = sqrt(9+16) = 5.
    expect(pointTriangleDistance(2, -3, 4, ...tri)).toBeCloseTo(5, 12);
  });

  it("EDGE AC region: closest point is interior to segment AC", () => {
    // P = (-3,1,4). Foot on AC (the y-axis) is (0,1,0), interior to the segment.
    // Distance = |(-3,0,4)| = sqrt(9+16) = 5.
    expect(pointTriangleDistance(-3, 1, 4, ...tri)).toBeCloseTo(5, 12);
  });

  it("EDGE BC region: closest point is interior to the hypotenuse", () => {
    // P = (5, 5.5, 0), in-plane. Line BC: 3x + 4y = 12, unit normal (3,4,0)/5.
    // Signed distance = (3·5 + 4·5.5 − 12)/5 = (15+22−12)/5 = 25/5 = 5.
    // Foot = P − 5·(3,4,0)/5 = (5−3, 5.5−4, 0) = (2, 1.5, 0) = midpoint of BC,
    // interior to the segment. Distance = 5.
    expect(pointTriangleDistance(5, 5.5, 0, ...tri)).toBeCloseTo(5, 12);
  });

  it("degenerate (zero-area) triangle collapses to segment distance, no NaN", () => {
    // Collinear "triangle" A(0,0,0) B(1,0,0) C(2,0,0) on the x-axis.
    // Point (0.5, 1, 0): closest point is the foot (0.5,0,0), distance = 1.
    const d = pointTriangleDistance(0.5, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(1, 12);
  });
});

describe("pointTriangleDistance — point-to-TRIANGLE beats nearest-node materially", () => {
  it("large boundary triangle: perpendicular foot is close, nearest vertex is far", () => {
    // Big triangle A(0,0,0) B(100,0,0) C(0,100,0) in the z = 0 plane.
    // Query P = (30, 30, 0.5). Foot = (30,30,0); 30+30 = 60 < 100 and both
    // coords > 0, so the foot is INTERIOR ⇒ true point-to-triangle distance
    // = 0.5.
    const bigTri = [0, 0, 0, 100, 0, 0, 0, 100, 0] as const;
    expect(pointTriangleDistance(30, 30, 0.5, ...bigTri)).toBeCloseTo(0.5, 12);

    // Nearest NODE of that same triangle would report a hugely different value:
    //   |P − A| = sqrt(30² + 30² + 0.5²) ≈ 42.43
    //   |P − B| = |P − C| = sqrt(70² + 30² + 0.5²) ≈ 76.16
    // i.e. the nearest-vertex distance (≈42.4) is ~85× the true distance (0.5).
    // This is exactly the aliasing CLAUDE.md invariant 4 warns about, and why
    // this module does point-to-triangle rather than nearest-node.
    const nearestNode = Math.min(
      Math.hypot(30, 30, 0.5),
      Math.hypot(70, 30, 0.5),
      Math.hypot(70, 30, 0.5),
    );
    expect(nearestNode).toBeGreaterThan(40); // materially different from 0.5
  });
});

describe("computeNodeSurfaceDistances — one-ring completeness (diagonal cell)", () => {
  // Hand-built minimal mesh in which the query node's nearest surface triangle
  // sits in a strictly DIAGONAL (corner) neighbour cell of the query's grid
  // cell — so a search over only face-adjacent cells would MISS it and clamp to
  // dMax. The 27-cell (di,dj,dk ∈ {−1,0,1}) ring in distance.ts must find it.
  //
  // Grid arithmetic (CELL = dMax = 5, xMin=yMin=zMin=0 via the anchor node 0):
  //   ci(x) = clamp(floor(x / 5))
  //   Query node 1 = (4.5,4.5,4.5) → cell (0,0,0)
  //   Triangle nodes 2,3,4 all have coords in [5.5, 6.0] → cell (1,1,1)
  //   (1,1,1) − (0,0,0) = (+1,+1,+1): a pure corner-diagonal offset.
  //
  // Closest point on the triangle to the query: the triangle lies in the plane
  // z = 5.5 with the query projecting to (4.5,4.5,5.5), which is outside the
  // triangle in the vertex-(5.5,5.5) region, so the closest point is the corner
  // node 2 = (5.5,5.5,5.5). Distance = |(1,1,1)| = sqrt(3) ≈ 1.7320508.
  const nodes = new Float64Array([
    0.0, 0.0, 0.0,   // 0: bbox anchor (min corner); not a mesh corner or surface node
    4.5, 4.5, 4.5,   // 1: query corner node
    5.5, 5.5, 5.5,   // 2: triangle vertex (also surface ⇒ dist 0)
    6.0, 5.5, 5.5,   // 3: triangle vertex
    5.5, 6.0, 5.5,   // 4: triangle vertex
  ]);
  // One C3D4 element whose first four (all four) nodes are corners; node 1 is
  // the interior corner we care about, nodes 2-4 are on the surface.
  const elements = new Int32Array([1, 2, 3, 4]);
  const mesh: TetMesh = { nodes, elements, nodeCount: 5, elementCount: 1, nodesPerElem: 4 };
  const surfaceFaces = new Int32Array([2, 3, 4]);

  it("finds the diagonal-cell triangle (returns sqrt(3), not the dMax clamp)", () => {
    const dist = computeNodeSurfaceDistances(mesh, surfaceFaces, 5);
    expect(dist[1]).toBeCloseTo(Math.sqrt(3), 12);
    expect(dist[1]).toBeLessThan(5); // NOT clamped — proves the diagonal cell was searched
  });

  it("boundary (triangle) nodes seed at exactly 0", () => {
    const dist = computeNodeSurfaceDistances(mesh, surfaceFaces, 5);
    expect(dist[2]).toBe(0);
    expect(dist[3]).toBe(0);
    expect(dist[4]).toBe(0);
  });

  it("normal points FROM the closest surface point TOWARD the node, unit length", () => {
    // Closest point is node 2 = (5.5,5.5,5.5); query is node 1 = (4.5,4.5,4.5).
    // Documented convention: normal = (node − closest)/|·| = (−1,−1,−1)/sqrt(3).
    const { dist, normal } = computeNodeSurfaceDistancesAndNormals(mesh, surfaceFaces, 5, true);
    expect(dist[1]).toBeCloseTo(Math.sqrt(3), 12);
    expect(normal).not.toBeNull();
    const nx = normal![3], ny = normal![4], nz = normal![5];
    const inv = 1 / Math.sqrt(3);
    expect(nx).toBeCloseTo(-inv, 12);
    expect(ny).toBeCloseTo(-inv, 12);
    expect(nz).toBeCloseTo(-inv, 12);
    expect(Math.hypot(nx!, ny!, nz!)).toBeCloseTo(1, 12);
  });
});

describe("computeNodeSurfaceDistances — dMax clamping (hand-computed)", () => {
  // Reuse the diagonal fixture: the query's true distance is sqrt(3) ≈ 1.732.
  const nodes = new Float64Array([
    0.0, 0.0, 0.0,
    4.5, 4.5, 4.5,
    5.5, 5.5, 5.5,
    6.0, 5.5, 5.5,
    5.5, 6.0, 5.5,
  ]);
  const elements = new Int32Array([1, 2, 3, 4]);
  const mesh: TetMesh = { nodes, elements, nodeCount: 5, elementCount: 1, nodesPerElem: 4 };
  const surfaceFaces = new Int32Array([2, 3, 4]);

  it("dMax comfortably above the true distance → true distance reported", () => {
    // dMax = 5 > sqrt(3): unclamped.
    const dist = computeNodeSurfaceDistances(mesh, surfaceFaces, 5);
    expect(dist[1]).toBeCloseTo(Math.sqrt(3), 12);
  });

  it("dMax below the true distance → clamped to exactly dMax", () => {
    // dMax = 1 < sqrt(3) ≈ 1.732. The nearest triangle is farther than dMax, so
    // no candidate beats the initial `best = dMax`; node 1 reports exactly 1.
    const dist = computeNodeSurfaceDistances(mesh, surfaceFaces, 1);
    expect(dist[1]).toBe(1);
  });
});

describe("computeNodeSurfaceDistances — box mesh completeness & analytic wall distance", () => {
  // 20×12×8 mm box; distance to surface = min distance to the 6 bounding planes.
  const mesh = generateBoxMeshC3D4(0, 0, 0, 20, 12, 8, 10, 6, 4);
  const faces = extractSurfaceFaces(mesh);
  const DMAX = 6.0;
  const dist = computeNodeSurfaceDistances(mesh, faces, DMAX);

  it("every boundary node seeds at exactly 0", () => {
    const onSurface = new Set<number>();
    for (let i = 0; i < faces.length; i++) onSurface.add(faces[i]!);
    for (const n of onSurface) expect(dist[n]).toBe(0);
  });

  it("every surface/corner node receives a finite distance in [0, dMax]", () => {
    // Corner nodes are those in the first 4 slots of each element.
    const isCorner = new Uint8Array(mesh.nodeCount);
    for (let e = 0; e < mesh.elementCount; e++)
      for (let k = 0; k < 4; k++) isCorner[mesh.elements[e * 4 + k]!] = 1;
    for (let n = 0; n < mesh.nodeCount; n++) {
      if (!isCorner[n]) continue;
      expect(Number.isFinite(dist[n])).toBe(true);
      expect(dist[n]).toBeGreaterThanOrEqual(0);
      expect(dist[n]).toBeLessThanOrEqual(DMAX);
    }
  });

  it("interior distances equal the analytic box wall distance (min of 6 planes)", () => {
    for (let n = 0; n < mesh.nodeCount; n++) {
      const x = mesh.nodes[n * 3]!, y = mesh.nodes[n * 3 + 1]!, z = mesh.nodes[n * 3 + 2]!;
      const analytic = Math.min(x, 20 - x, y, 12 - y, z, 8 - z);
      expect(dist[n]).toBeCloseTo(Math.min(analytic, DMAX), 9);
    }
  });

  it("deep-core node clamps to dMax when dMax is below its true wall distance", () => {
    // Box centre = (10,6,4); true wall distance = min(10,10,6,6,4,4) = 4.
    // With dMax = 2 the centre must clamp to exactly 2.
    const distTight = computeNodeSurfaceDistances(mesh, faces, 2);
    // Find the node nearest the geometric centre.
    let best = Infinity, ci = -1;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const dx = mesh.nodes[n * 3]! - 10, dy = mesh.nodes[n * 3 + 1]! - 6, dz = mesh.nodes[n * 3 + 2]! - 4;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best) { best = d; ci = n; }
    }
    expect(distTight[ci]).toBe(2);
    // …and with dMax = 6 (> 4) the same centre node reports its true wall
    // distance of 4 (unclamped), the analytic min-of-planes value.
    expect(dist[ci]).toBeCloseTo(4, 9);
  });

  it("box interior normals point inward (from surface into the part), unit length", () => {
    const { dist: d2, normal } = computeNodeSurfaceDistancesAndNormals(mesh, faces, DMAX, true);
    expect(normal).not.toBeNull();
    // Node closest to the middle of the x = 0 face, one wall-band in:
    // its nearest surface is the x = 0 plane, so the inward normal is +x.
    let best = Infinity, ci = -1;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const x = mesh.nodes[n * 3]!, y = mesh.nodes[n * 3 + 1]!, z = mesh.nodes[n * 3 + 2]!;
      if (x < 1.0) continue;                 // skip the on-surface layer (x≈0)
      const cost = x + Math.abs(y - 6) + Math.abs(z - 4); // near the face centre, small x
      if (cost < best && d2[n]! > 0 && d2[n]! < DMAX) { best = cost; ci = n; }
    }
    expect(ci).toBeGreaterThanOrEqual(0);
    const nx = normal![ci * 3]!, ny = normal![ci * 3 + 1]!, nz = normal![ci * 3 + 2]!;
    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 9);
    expect(nx).toBeGreaterThan(0.99);        // points +x, into the part
  });
});
