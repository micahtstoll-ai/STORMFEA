/**
 * distance-grid-budget.test.ts
 *
 * Issue #298: `computeNodeSurfaceDistancesAndNormals` sized its triangle-bucket
 * grid as `CELL = max(dMax, 1e-6)` and inserted every boundary triangle into
 * every cell its AABB spans. With `dMax` far below element scale a single
 * triangle spans millions of cells, so the bucket Map grew until V8 threw
 * `RangeError: Map maximum size exceeded` — an out-of-memory-shaped crash rather
 * than a stated rejection. Measured before the fix on the fixture below: 34 s of
 * thrash, then the throw. `computeNodeBandPenetration` carried a verbatim copy of
 * the same grid and the same hazard.
 *
 * The fix caps the grid instead of trusting `dMax` (`chooseGridCellSize`). Two
 * halves, and BOTH need pinning, because they fail in opposite directions:
 *
 *   [A] The guard fires when it must — no crash, and the answer is still exact,
 *       since a coarser grid only widens the candidate set a query examines.
 *   [B] The guard does NOT fire when it must not. This is the half no result can
 *       reveal: coarsening every real analysis would be slower, still correct,
 *       and invisible to every other assertion in the suite. So the production
 *       call shape is asserted to leave the cell size at exactly `dMax`.
 */

import { describe, it, expect } from "vitest";
import {
  generateBoxMeshC3D4,
  generateBoxMeshC3D10,
  extractSurfaceFaces,
} from "../../solver/meshgen.js";
import {
  computeNodeSurfaceDistances,
  computeNodeSurfaceDistancesAndNormals,
  computeNodeBandPenetration,
  chooseGridCellSize,
  pointTriangleDistance,
} from "../../solver/distance.js";
import { buildPlateWithHoleMesh } from "../../coupon_fea.js";
import type { TetMesh } from "../../solver/types.js";

/** The exact fixture the issue reproduced against: 20x10x5 mm, 56 boundary triangles. */
function issueFixture(): TetMesh {
  const m = generateBoxMeshC3D10(0, 0, 0, 20, 10, 5, 4, 2, 1);
  return { nodes: m.nodes, elements: m.elements, nodeCount: m.nodeCount,
           elementCount: m.elementCount, nodesPerElem: 10 };
}

function boxC3D4(nx: number, ny: number, nz: number): TetMesh {
  const m = generateBoxMeshC3D4(0, 0, 0, 20, 10, 5, nx, ny, nz);
  return { nodes: m.nodes, elements: m.elements, nodeCount: m.nodeCount,
           elementCount: m.elementCount, nodesPerElem: 4 };
}

/**
 * The longest corner-corner edge, i.e. the term both production callers add to
 * their band to get `dMax` (`maxCornerEdge` in twoRegion.ts). Recomputed here
 * rather than imported because the point of test [B] is to pin the SHAPE of the
 * production call, and a local copy states that shape instead of inheriting it.
 */
function maxCornerEdge(mesh: TetMesh): number {
  const npe = mesh.nodesPerElem;
  let maxE2 = 0;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    for (let i = 0; i < 4; i++) {
      const ni = mesh.elements[base + i]!;
      const xi = mesh.nodes[ni * 3]!, yi = mesh.nodes[ni * 3 + 1]!, zi = mesh.nodes[ni * 3 + 2]!;
      for (let j = i + 1; j < 4; j++) {
        const nj = mesh.elements[base + j]!;
        const dx = mesh.nodes[nj * 3]! - xi;
        const dy = mesh.nodes[nj * 3 + 1]! - yi;
        const dz = mesh.nodes[nj * 3 + 2]! - zi;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > maxE2) maxE2 = d2;
      }
    }
  }
  return Math.sqrt(maxE2);
}

/**
 * O(nodes x triangles) reference: the exact clamped distance, computed with no
 * grid at all. The grid is an acceleration structure, so this is the definition
 * the gridded implementation must reproduce EXACTLY (not approximately) at every
 * cell size — that is what makes coarsening a safe response to the budget.
 */
function bruteForceDistances(mesh: TetMesh, faces: Int32Array, dMax: number): Float64Array {
  const out = new Float64Array(mesh.nodeCount).fill(dMax);
  const N = mesh.nodes;
  const meshNodes = new Set<number>();
  for (let e = 0; e < mesh.elementCount; e++)
    for (let k = 0; k < mesh.nodesPerElem; k++) meshNodes.add(mesh.elements[e * mesh.nodesPerElem + k]!);
  const onSurface = new Set<number>();
  for (let i = 0; i < faces.length; i++) onSurface.add(faces[i]!);

  for (const n of meshNodes) {
    if (onSurface.has(n)) { out[n] = 0; continue; }
    let best = dMax;
    for (let t = 0; t < faces.length / 3; t++) {
      const a = faces[t * 3]!, b = faces[t * 3 + 1]!, c = faces[t * 3 + 2]!;
      const d = pointTriangleDistance(
        N[n * 3]!, N[n * 3 + 1]!, N[n * 3 + 2]!,
        N[a * 3]!, N[a * 3 + 1]!, N[a * 3 + 2]!,
        N[b * 3]!, N[b * 3 + 1]!, N[b * 3 + 2]!,
        N[c * 3]!, N[c * 3 + 1]!, N[c * 3 + 2]!,
      );
      if (d < best) best = d;
    }
    out[n] = best;
  }
  return out;
}

describe("#298 [A] — a dMax far below element scale is answered, not crashed on", () => {
  it("the reported case (20x10x5 box, 56 triangles, dMax = 1e-6) returns", () => {
    const mesh = issueFixture();
    const faces = extractSurfaceFaces(mesh);
    expect(faces.length / 3).toBe(56); // the triangle count quoted in the issue

    // Before the fix this threw RangeError after ~34 s. The assertion is simply
    // that it comes back; the values are checked below.
    const dist = computeNodeSurfaceDistances(mesh, faces, 1e-6);
    expect(dist.length).toBe(mesh.nodeCount);
  });

  it("computeNodeBandPenetration — the second copy of the same grid — returns too", () => {
    const mesh = issueFixture();
    const faces = extractSurfaceFaces(mesh);
    const faceBand = new Float64Array(faces.length / 3).fill(1e-9);
    const phi = computeNodeBandPenetration(mesh, faces, faceBand, 1e-6);
    expect(phi.length).toBe(mesh.nodeCount);
    expect(phi.every((v) => Number.isFinite(v))).toBe(true);
  });

  it("the normals variant keeps its no-NaN-by-construction contract", () => {
    const mesh = issueFixture();
    const faces = extractSurfaceFaces(mesh);
    const { dist, normal } = computeNodeSurfaceDistancesAndNormals(mesh, faces, 1e-6, true);
    expect(normal).not.toBeNull();
    expect(dist.every((v) => Number.isFinite(v))).toBe(true);
    // Every node vector is either a unit vector or exactly zero ("no interface
    // here") — a coarsened grid must not leak a partially-normalized direction.
    for (let n = 0; n < mesh.nodeCount; n++) {
      const x = normal![n * 3]!, y = normal![n * 3 + 1]!, z = normal![n * 3 + 2]!;
      const len = Math.sqrt(x * x + y * y + z * z);
      expect(len === 0 || Math.abs(len - 1) < 1e-12).toBe(true);
    }
  });

  it("a coarsened grid returns the EXACT brute-force answer, not an approximation", () => {
    // 1e-6 forces heavy coarsening, 0.05 and 0.5 force some; each must still
    // reproduce the no-grid reference bit for bit.
    const mesh = boxC3D4(3, 2, 1);
    const faces = extractSurfaceFaces(mesh);
    for (const dMax of [1e-6, 1e-3, 0.05, 0.5]) {
      const got = computeNodeSurfaceDistances(mesh, faces, dMax);
      const want = bruteForceDistances(mesh, faces, dMax);
      for (let n = 0; n < mesh.nodeCount; n++) {
        expect(got[n]).toBe(want[n]);
      }
    }
  });

  it("and so does an UNcoarsened grid — the guard changed no legitimate result", () => {
    const mesh = boxC3D4(4, 3, 2);
    const faces = extractSurfaceFaces(mesh);
    for (const dMax of [2, 5, 50]) {
      const got = computeNodeSurfaceDistances(mesh, faces, dMax);
      const want = bruteForceDistances(mesh, faces, dMax);
      for (let n = 0; n < mesh.nodeCount; n++) {
        expect(got[n]).toBe(want[n]);
      }
    }
  });

  it("the cell is never LOWERED below dMax — the one-ring query stays complete", () => {
    // Each caller scans only the node's cell and its 26 neighbours, which is
    // sufficient exactly because cell >= dMax. Coarsening is safe; refining
    // would silently truncate the search.
    const mesh = issueFixture();
    const faces = extractSurfaceFaces(mesh);
    const triCount = faces.length / 3;
    for (const dMax of [1e-6, 1e-3, 0.05, 0.5, 2, 5, 50, 500]) {
      const cell = chooseGridCellSize(mesh.nodes, mesh.nodeCount, faces, triCount, dMax);
      expect(cell).toBeGreaterThanOrEqual(dMax);
    }
  });
});

describe("#298 [B] — the guard is inert at the dMax production actually passes", () => {
  // Both callers derive dMax as (band + maxCornerEdge), so it is always at least
  // one element edge. At that magnitude a triangle's AABB spans at most 2 cells
  // per axis, and the budget must not be tight enough to notice. If this fails,
  // real analyses got slower — with nothing else in the suite able to say so.
  const WALL_BAND_MM = 1.35; // the ~2-perimeter wall band the model resolves

  it("box C3D10: the chosen cell is exactly dMax, i.e. no coarsening happened", () => {
    const mesh = issueFixture();
    const faces = extractSurfaceFaces(mesh);
    const dMax = WALL_BAND_MM + maxCornerEdge(mesh);
    const cell = chooseGridCellSize(mesh.nodes, mesh.nodeCount, faces, faces.length / 3, dMax);
    expect(cell).toBe(dMax);
  });

  it("finer box C3D4: still exactly dMax", () => {
    const mesh = boxC3D4(10, 6, 4);
    const faces = extractSurfaceFaces(mesh);
    const dMax = WALL_BAND_MM + maxCornerEdge(mesh);
    const cell = chooseGridCellSize(mesh.nodes, mesh.nodeCount, faces, faces.length / 3, dMax);
    expect(cell).toBe(dMax);
  });

  it("curved bore (non-axis-aligned boundary triangles): still exactly dMax", () => {
    // A plate with a hole is the closest in-repo fixture to a real part's
    // surface — boundary triangles at many orientations, a range of sizes.
    const mesh = buildPlateWithHoleMesh({
      widthMm: 30, thickMm: 4, lengthMm: 60, holeR: 5, nTheta: 24, ns: 6, nThick: 2,
    });
    const faces = extractSurfaceFaces(mesh);
    const dMax = WALL_BAND_MM + maxCornerEdge(mesh);
    const cell = chooseGridCellSize(mesh.nodes, mesh.nodeCount, faces, faces.length / 3, dMax);
    expect(cell).toBe(dMax);
  });

  it("headroom is real: dMax an eighth of the production value is still inert", () => {
    // The budget allows 64 cells per triangle against the ~8 a legitimate dMax
    // needs. Shrinking dMax 8x (so a triangle spans ~4 cells per axis) should
    // still sit under budget — this is the margin that keeps [B] from being a
    // coincidence of one fixture.
    const mesh = issueFixture();
    const faces = extractSurfaceFaces(mesh);
    const dMax = (WALL_BAND_MM + maxCornerEdge(mesh)) / 8;
    const cell = chooseGridCellSize(mesh.nodes, mesh.nodeCount, faces, faces.length / 3, dMax);
    expect(cell).toBe(dMax);
  });
});
