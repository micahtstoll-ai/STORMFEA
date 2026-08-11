/**
 * distance.ts
 * -----------
 * Node-to-boundary-surface distance field for the two-region (shell/core)
 * FDM material model.
 *
 * Given the tet mesh's boundary triangles (corner-node index triples, as
 * produced by TetGen/Gmsh/extractSurfaceFaces), computes for every CORNER
 * node its Euclidean distance to the nearest boundary triangle, clamped at
 * `dMax`. Nodes that appear in the boundary triangulation are exactly 0.
 *
 * Accuracy note: nearest-surface-NODE distance is NOT sufficient here —
 * boundary triangles are typically 3–6 mm across while the wall band being
 * resolved is ~1.35 mm, so the chord-vs-plane error alone would exceed the
 * band. This module therefore does true point-to-triangle closest-point
 * queries (Ericson, "Real-Time Collision Detection" §5.1.5) over a
 * triangle-bucketed spatial grid.
 *
 * For C3D10 the MIDSIDE nodes are resolved too (issue #180): the wall-fraction
 * level set (wallfrac.ts) subdivides each quadratic tet into 8 corner/midside
 * sub-tets, so it needs every element node's distance — a band that enters an
 * element between corners (concave features) is otherwise missed. Only nodes
 * NOT referenced by any element stay at dMax. For C3D4 (npe = 4) every node is
 * a corner, so this is bit-identical to the corner-only behavior.
 */

import type { TetMesh } from "./types.js";

/**
 * Cells one boundary triangle may be replicated into before the grid is judged
 * too fine to be worth it (issue #298).
 *
 * The grid's cell size comes from `dMax`, and every triangle is inserted into
 * every cell its AABB spans. So a `dMax` far below element scale makes a single
 * triangle span millions of cells and the bucket Map grows until V8 throws
 * `RangeError: Map maximum size exceeded` — an out-of-memory-shaped crash rather
 * than a stated rejection. Nothing in either function's signature says `dMax`
 * must be on the order of the element size, so that constraint was invisible
 * from the call sites; the budget below makes the functions total for any input
 * instead of relying on callers to know it.
 *
 * Coarsening is the right response rather than rejection because the grid is an
 * ACCELERATION STRUCTURE, not part of the answer: every distance is computed by
 * `pointTriangleClosestVector` over whatever candidates a query collects. A
 * larger cell only widens that candidate set, and while `cell >= dMax` holds the
 * one-ring query still sees every triangle within the search radius — so not one
 * returned number changes, only how many triangles were examined to get it.
 *
 * 64 is a limit on WASTE, not just on memory. Cells finer than a triangle buy no
 * selectivity: a query cell still yields every triangle overlapping it, so
 * subdividing below triangle scale only copies the same triangle into more
 * buckets. At the intended `dMax` (at least one element edge — both production
 * callers pass `max(band) + maxCornerEdge`, and a boundary triangle's AABB
 * extent cannot exceed its longest edge) a triangle spans at most 2 cells per
 * axis, i.e. 8. The factor of 8 headroom over that is what keeps this guard off
 * every mesh the meshers actually emit.
 */
const MAX_CELLS_PER_TRIANGLE = 64;

/**
 * Absolute backstop on total insertions, independent of triangle count, so the
 * bucket Map cannot approach V8's ~2^24-entry ceiling however many triangles
 * arrive. It becomes the smaller of the two budget terms past ~31 000 triangles,
 * but at the 8-cells-per-triangle a legitimate `dMax` actually costs it does not
 * force any COARSENING until ~250 000 boundary triangles — an order of magnitude
 * beyond the largest mesh tier this tool emits.
 */
const GRID_INSERTION_BUDGET = 2_000_000;

/**
 * Cell edge for the triangle-bucket grid: `max(dMax, 1e-6)`, doubled while the
 * insertions it implies exceed
 * `min(GRID_INSERTION_BUDGET, MAX_CELLS_PER_TRIANGLE * triCount)` (issue #298).
 *
 * Exported because the load-bearing property is a NEGATIVE one that no result
 * can show: on a production-shaped input this must return `dMax` UNCHANGED, so
 * the guard costs analyses nothing. Tightening the budget would quietly coarsen
 * every real analysis — slower, still correct, and invisible to every other
 * assertion in the suite. `distance-grid-budget.test.ts` pins it.
 *
 * The returned cell is never below `max(dMax, 1e-6)`, which is what lets callers
 * rely on a 27-cell one-ring query being complete.
 */
export function chooseGridCellSize(
  nodes: Float64Array,
  nodeCount: number,
  surfaceFaces: Int32Array,
  triCount: number,
  dMax: number,
): number {
  let xMin = Infinity, yMin = Infinity, zMin = Infinity;
  let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
  for (let n = 0; n < nodeCount; n++) {
    const x = nodes[n * 3] ?? 0, y = nodes[n * 3 + 1] ?? 0, z = nodes[n * 3 + 2] ?? 0;
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  }

  const budget = Math.min(GRID_INSERTION_BUDGET, MAX_CELLS_PER_TRIANGLE * triCount);

  /**
   * Insertions the given cell size implies, abandoned as soon as it is over
   * budget — in the pathological case the very first triangle settles it, so
   * the guard costs O(1) exactly when it matters and one pass over the
   * triangles when it does not.
   */
  const insertionsFor = (cell: number, gW: number, gH: number, gD: number): number => {
    const idx = (v: number, min: number, g: number) =>
      Math.min(g - 1, Math.max(0, Math.floor((v - min) / cell)));
    let total = 0;
    for (let t = 0; t < triCount; t++) {
      const na = surfaceFaces[t * 3] ?? 0, nb = surfaceFaces[t * 3 + 1] ?? 0, nc = surfaceFaces[t * 3 + 2] ?? 0;
      const ax = nodes[na * 3] ?? 0, ay = nodes[na * 3 + 1] ?? 0, az = nodes[na * 3 + 2] ?? 0;
      const bx = nodes[nb * 3] ?? 0, by = nodes[nb * 3 + 1] ?? 0, bz = nodes[nb * 3 + 2] ?? 0;
      const cx = nodes[nc * 3] ?? 0, cy = nodes[nc * 3 + 1] ?? 0, cz = nodes[nc * 3 + 2] ?? 0;
      const si = idx(Math.max(ax, bx, cx), xMin, gW) - idx(Math.min(ax, bx, cx), xMin, gW) + 1;
      const sj = idx(Math.max(ay, by, cy), yMin, gH) - idx(Math.min(ay, by, cy), yMin, gH) + 1;
      const sk = idx(Math.max(az, bz, cz), zMin, gD) - idx(Math.min(az, bz, cz), zMin, gD) + 1;
      total += si * sj * sk;
      if (total > budget) return total;
    }
    return total;
  };

  let cell = Math.max(dMax, 1e-6);
  for (;;) {
    const gW = Math.max(1, Math.ceil((xMax - xMin) / cell) + 1);
    const gH = Math.max(1, Math.ceil((yMax - yMin) / cell) + 1);
    const gD = Math.max(1, Math.ceil((zMax - zMin) / cell) + 1);
    // A single cell is as coarse as the grid gets: there is nothing left to
    // trade, and the insertion count is already down to one per triangle.
    if (gW === 1 && gH === 1 && gD === 1) return cell;
    if (insertionsFor(cell, gW, gH, gD) <= budget) return cell;
    cell *= 2;
  }
}

/** Triangle-bucketed spatial grid, plus the cell indexing it was built with. */
interface TriangleBucketGrid {
  /** Cell edge, mm. Always >= dMax — see `buildTriangleBucketGrid`. */
  readonly cell: number;
  readonly gW: number;
  readonly gH: number;
  readonly gD: number;
  readonly ci: (x: number) => number;
  readonly cj: (y: number) => number;
  readonly ck: (z: number) => number;
  readonly key: (i: number, j: number, k: number) => number;
  /** Cell key → indices of the triangles whose AABB overlaps that cell. */
  readonly grid: Map<number, number[]>;
}

/**
 * Bucket every boundary triangle into the cells its AABB overlaps, so a query
 * only has to visit the cells within its search radius. Same keying scheme as
 * the nearest-node grids in `analysis.ts` (floor-based, bounding-box
 * normalized).
 *
 * Cell edge is `max(dMax, 1e-6)`, then doubled while the implied insertion count
 * exceeds `min(GRID_INSERTION_BUDGET, MAX_CELLS_PER_TRIANGLE * triCount)`
 * (issue #298). The cell is only ever RAISED, so `cell >= dMax` holds
 * unconditionally — which is exactly what every caller's 27-cell one-ring query
 * relies on for completeness. Doubling terminates because a grid of one cell
 * costs one insertion per triangle, which no budget below the triangle count can
 * be asked to beat.
 */
function buildTriangleBucketGrid(
  nodes: Float64Array,
  nodeCount: number,
  surfaceFaces: Int32Array,
  triCount: number,
  dMax: number,
): TriangleBucketGrid {
  let xMin = Infinity, yMin = Infinity, zMin = Infinity;
  let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
  for (let n = 0; n < nodeCount; n++) {
    const x = nodes[n * 3] ?? 0, y = nodes[n * 3 + 1] ?? 0, z = nodes[n * 3 + 2] ?? 0;
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  }

  // chooseGridCellSize re-derives these bounds rather than taking them as an
  // argument, so the cell size has exactly one definition (a test calls it
  // directly — see its docblock). The duplicated pass is O(nodeCount) of float
  // compares against a per-node triangle query; keep the single definition.
  const cell = chooseGridCellSize(nodes, nodeCount, surfaceFaces, triCount, dMax);
  const gW = Math.max(1, Math.ceil((xMax - xMin) / cell) + 1);
  const gH = Math.max(1, Math.ceil((yMax - yMin) / cell) + 1);
  const gD = Math.max(1, Math.ceil((zMax - zMin) / cell) + 1);

  const ci = (x: number) => Math.min(gW - 1, Math.max(0, Math.floor((x - xMin) / cell)));
  const cj = (y: number) => Math.min(gH - 1, Math.max(0, Math.floor((y - yMin) / cell)));
  const ck = (z: number) => Math.min(gD - 1, Math.max(0, Math.floor((z - zMin) / cell)));
  const key = (i: number, j: number, k: number) => (i * gH + j) * gD + k;

  const grid = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const na = surfaceFaces[t * 3] ?? 0, nb = surfaceFaces[t * 3 + 1] ?? 0, nc = surfaceFaces[t * 3 + 2] ?? 0;
    const ax = nodes[na * 3] ?? 0, ay = nodes[na * 3 + 1] ?? 0, az = nodes[na * 3 + 2] ?? 0;
    const bx = nodes[nb * 3] ?? 0, by = nodes[nb * 3 + 1] ?? 0, bz = nodes[nb * 3 + 2] ?? 0;
    const cx = nodes[nc * 3] ?? 0, cy = nodes[nc * 3 + 1] ?? 0, cz = nodes[nc * 3 + 2] ?? 0;
    const i0 = ci(Math.min(ax, bx, cx)), i1 = ci(Math.max(ax, bx, cx));
    const j0 = cj(Math.min(ay, by, cy)), j1 = cj(Math.max(ay, by, cy));
    const k0 = ck(Math.min(az, bz, cz)), k1 = ck(Math.max(az, bz, cz));
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (let k = k0; k <= k1; k++) {
          const kk = key(i, j, k);
          const bucket = grid.get(kk);
          if (bucket) bucket.push(t);
          else grid.set(kk, [t]);
        }
      }
    }
  }

  return { cell, gW, gH, gD, ci, cj, ck, key, grid };
}

/**
 * Closest point on triangle (a, b, c) to point p, as the vector (p − q)
 * FROM the closest point q TO p (i.e. pointing from the surface toward p).
 * Ericson's closest-point-on-triangle: classifies p against the triangle's
 * Voronoi regions (vertices, edges, face). Degenerate (zero-area) triangles
 * collapse to point/segment distance. Shared kernel behind
 * `pointTriangleDistance` and the normal-capturing distance field builder.
 */
function pointTriangleClosestVector(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): readonly [number, number, number] {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    return [apx, apy, apz]; // vertex A
  }

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    return [bpx, bpy, bpz]; // vertex B
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const denom = d1 - d3;
    const v = denom > 0 ? d1 / denom : 0; // edge AB (denom 0 ⇒ degenerate)
    return [px - (ax + v * abx), py - (ay + v * aby), pz - (az + v * abz)];
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    return [cpx, cpy, cpz]; // vertex C
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const denom = d2 - d6;
    const w = denom > 0 ? d2 / denom : 0; // edge AC
    return [px - (ax + w * acx), py - (ay + w * acy), pz - (az + w * acz)];
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const denom = (d4 - d3) + (d5 - d6);
    const w = denom > 0 ? (d4 - d3) / denom : 0; // edge BC
    return [px - (bx + w * (cx - bx)), py - (by + w * (cy - by)), pz - (bz + w * (cz - bz))];
  }

  // Inside face region
  const denom = va + vb + vc;
  if (denom <= 0) {
    // Fully degenerate triangle — fall back to vertex A distance (the edge
    // cases above already handled collinear layouts).
    return [apx, apy, apz];
  }
  const v = vb / denom, w = vc / denom;
  return [
    px - (ax + v * abx + w * acx),
    py - (ay + v * aby + w * acy),
    pz - (az + v * abz + w * acz),
  ];
}

/**
 * Closest distance from point p to triangle (a, b, c).
 * Ericson's closest-point-on-triangle: classifies p against the triangle's
 * Voronoi regions (vertices, edges, face) and returns the exact distance.
 * Degenerate (zero-area) triangles collapse to point/segment distance.
 */
export function pointTriangleDistance(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  const [qx, qy, qz] = pointTriangleClosestVector(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz);
  return Math.sqrt(qx * qx + qy * qy + qz * qz);
}

/**
 * Distance from every corner node to the nearest boundary triangle.
 *
 * @param mesh          Tet mesh (C3D4 or C3D10; midside nodes are skipped).
 * @param surfaceFaces  Boundary triangle corner-node index triples into
 *                      mesh.nodes (from TetGen/Gmsh/extractSurfaceFaces).
 * @param dMax          Clamp distance AND search radius: nodes farther than
 *                      this from the surface report exactly dMax ("deep
 *                      core"). It also sizes the spatial grid, so it is
 *                      EXPECTED to be on the order of the element size — that
 *                      is what keeps the search O(1) per node. Both production
 *                      callers pass `max(band) + maxCornerEdge(mesh)`, always
 *                      at least one element edge. A far smaller value is
 *                      answered correctly but progressively more slowly, never
 *                      by a crash (issue #298).
 * @returns             Float64Array of length nodeCount. Nodes referenced by
 *                      surfaceFaces are exactly 0; skipped (midside) nodes
 *                      and deep-core nodes report dMax.
 */
export function computeNodeSurfaceDistances(
  mesh: TetMesh,
  surfaceFaces: Int32Array,
  dMax: number,
): Float64Array {
  return computeNodeSurfaceDistancesAndNormals(mesh, surfaceFaces, dMax, false).dist;
}

/**
 * Same distance field as `computeNodeSurfaceDistances`, optionally also
 * capturing, per corner node, the unit vector from the closest boundary
 * point TOWARD the node — i.e. the local "wall-normal" / radial direction
 * pointing from the surface into the part. This is the natural per-node
 * weak-axis direction for a bead-to-bead (wall-loop-to-wall-loop) bond
 * criterion, which varies continuously around a part's contour, unlike the
 * single global weak axis used for interlayer (Z) bonding.
 *
 * `wantNormal=false` is bit-identical to `computeNodeSurfaceDistances` (same
 * accumulation order, same clamping) — the normal capture is a pure
 * additive readout of an already-computed intermediate, never altering the
 * `dist` numerics. Boundary nodes (dist===0) and nodes with no resolved
 * closest triangle within range have no well-defined direction and report
 * a zero vector (no-NaN-by-construction; downstream per-element averaging
 * treats zero as "no interface here").
 *
 * @returns `dist`: same as computeNodeSurfaceDistances. `normal`: null when
 *   `wantNormal` is false, else Float64Array of length nodeCount*3 (unit
 *   vectors, zero where undefined).
 */
export function computeNodeSurfaceDistancesAndNormals(
  mesh: TetMesh,
  surfaceFaces: Int32Array,
  dMax: number,
  wantNormal: boolean,
): { dist: Float64Array; normal: Float64Array | null } {
  const nodeCount = mesh.nodeCount;
  const nodes = mesh.nodes;
  const dist = new Float64Array(nodeCount).fill(dMax);
  const normal = wantNormal ? new Float64Array(nodeCount * 3) : null;
  const triCount = Math.floor(surfaceFaces.length / 3);
  if (triCount === 0 || dMax <= 0) return { dist, normal };

  // Boundary nodes are exactly on the surface.
  for (let i = 0; i < triCount * 3; i++) {
    const n = surfaceFaces[i] ?? 0;
    if (n >= 0 && n < nodeCount) dist[n] = 0;
  }

  // Mesh-node set: the level set reads corners AND (for C3D10) midside nodes
  // (issue #180 sub-tet subdivision), so resolve every node referenced by an
  // element. For C3D4 (npe = 4) this marks exactly the corners — bit-identical.
  const isMeshNode = new Uint8Array(nodeCount);
  const npe = mesh.nodesPerElem;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    for (let k = 0; k < npe; k++) {
      const n = mesh.elements[base + k] ?? 0;
      if (n >= 0 && n < nodeCount) isMeshNode[n] = 1;
    }
  }

  const { gW, gH, gD, ci, cj, ck, key, grid } =
    buildTriangleBucketGrid(nodes, nodeCount, surfaceFaces, triCount, dMax);

  // ── Per-node query ──────────────────────────────────────────────────────
  // Cell size >= dMax, so any triangle within dMax of the node lies in the
  // node's cell or one of its 26 neighbors. One ring suffices; anything
  // farther is clamped to dMax anyway.
  for (let n = 0; n < nodeCount; n++) {
    if (!isMeshNode[n]) continue;     // nodes referenced by no element
    if (dist[n] === 0) continue;      // boundary node, exact already
    const px = nodes[n * 3] ?? 0, py = nodes[n * 3 + 1] ?? 0, pz = nodes[n * 3 + 2] ?? 0;
    const i0 = ci(px), j0 = cj(py), k0 = ck(pz);
    let best = dMax;
    let bestDx = 0, bestDy = 0, bestDz = 0;
    for (let di = -1; di <= 1; di++) {
      const i = i0 + di;
      if (i < 0 || i >= gW) continue;
      for (let dj = -1; dj <= 1; dj++) {
        const j = j0 + dj;
        if (j < 0 || j >= gH) continue;
        for (let dk = -1; dk <= 1; dk++) {
          const k = k0 + dk;
          if (k < 0 || k >= gD) continue;
          const bucket = grid.get(key(i, j, k));
          if (!bucket) continue;
          for (const t of bucket) {
            const na = surfaceFaces[t * 3] ?? 0, nb = surfaceFaces[t * 3 + 1] ?? 0, nc = surfaceFaces[t * 3 + 2] ?? 0;
            const [vx, vy, vz] = pointTriangleClosestVector(
              px, py, pz,
              nodes[na * 3] ?? 0, nodes[na * 3 + 1] ?? 0, nodes[na * 3 + 2] ?? 0,
              nodes[nb * 3] ?? 0, nodes[nb * 3 + 1] ?? 0, nodes[nb * 3 + 2] ?? 0,
              nodes[nc * 3] ?? 0, nodes[nc * 3 + 1] ?? 0, nodes[nc * 3 + 2] ?? 0,
            );
            const d = Math.sqrt(vx * vx + vy * vy + vz * vz);
            if (d < best) { best = d; bestDx = vx; bestDy = vy; bestDz = vz; }
          }
        }
      }
    }
    dist[n] = best;
    if (normal && best > 1e-12) {
      const inv = 1 / best;
      normal[n * 3] = bestDx * inv;
      normal[n * 3 + 1] = bestDy * inv;
      normal[n * 3 + 2] = bestDz * inv;
    }
  }

  return { dist, normal };
}

/**
 * Per-corner-node band PENETRATION for a multi-thickness wall/skin model:
 * the minimum over boundary triangles of (distance-to-triangle − that
 * triangle's band thickness). Values < 0 mean the node lies inside SOME band.
 *
 * This generalizes the single-thickness classifier: the two-region field
 * subtracts one `tWall` from a plain distance, but floors/ceilings (top/bottom
 * solid skins) are thicker than the vertical perimeter band. Giving each
 * boundary triangle its own band thickness `faceBand[t]` and taking the union
 * of the resulting bands is exactly `φ = minₜ(distₜ − faceBand[t])`, evaluated
 * here directly so `wallfrac.ts` can run the same marching-tet volume on it.
 *
 * When every triangle shares one band thickness `t`, this returns
 * `minₜ(distₜ) − t` — bit-identical to `computeNodeSurfaceDistances(...) − t`,
 * so the legacy single-band path is a special case.
 *
 * @param mesh          Tet mesh (C3D4 or C3D10; midside nodes are skipped).
 * @param surfaceFaces  Boundary triangle corner-node index triples.
 * @param faceBand      Per-triangle band thickness (length = triCount), mm.
 * @param dMax          Search/clamp radius. MUST exceed the largest band plus
 *                      the longest element edge so band-straddling elements
 *                      keep un-clamped corners (the caller passes
 *                      max(band) + maxCornerEdge). Deep-core nodes report dMax.
 *                      It also sizes the spatial grid; see the note on
 *                      `computeNodeSurfaceDistances`'s `dMax` (issue #298).
 * @returns             Float64Array of length nodeCount: φ per corner node
 *                      (negative inside a band); midside / deep-core nodes dMax.
 */
export function computeNodeBandPenetration(
  mesh: TetMesh,
  surfaceFaces: Int32Array,
  faceBand: Float64Array,
  dMax: number,
): Float64Array {
  const nodeCount = mesh.nodeCount;
  const nodes = mesh.nodes;
  const phi = new Float64Array(nodeCount).fill(dMax);
  const triCount = Math.floor(surfaceFaces.length / 3);
  if (triCount === 0 || dMax <= 0) return phi;

  // Mesh-node set: corners AND (for C3D10) midside nodes are resolved so the
  // level set's sub-tet subdivision (issue #180) sees interior band crossings.
  // Unlike the distance field there is no boundary-node shortcut — a surface
  // node's penetration is −(its triangle's band), which depends on the class.
  // For C3D4 (npe = 4) this marks exactly the corners — bit-identical.
  const isMeshNode = new Uint8Array(nodeCount);
  const npe = mesh.nodesPerElem;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    for (let k = 0; k < npe; k++) {
      const n = mesh.elements[base + k] ?? 0;
      if (n >= 0 && n < nodeCount) isMeshNode[n] = 1;
    }
  }

  const { gW, gH, gD, ci, cj, ck, key, grid } =
    buildTriangleBucketGrid(nodes, nodeCount, surfaceFaces, triCount, dMax);

  // ── Per-node query ───────────────────────────────────────────────────────
  // Any triangle whose band reaches the node has distance < band ≤ max(band) <
  // dMax ≤ CELL, so it lies in the node's cell or a neighbour — one ring is
  // sufficient for the sign of φ. Triangles farther than dMax give a large
  // positive penetration and cannot lower a negative min.
  for (let n = 0; n < nodeCount; n++) {
    if (!isMeshNode[n]) continue;
    const px = nodes[n * 3] ?? 0, py = nodes[n * 3 + 1] ?? 0, pz = nodes[n * 3 + 2] ?? 0;
    const i0 = ci(px), j0 = cj(py), k0 = ck(pz);
    let best = dMax;
    for (let di = -1; di <= 1; di++) {
      const i = i0 + di;
      if (i < 0 || i >= gW) continue;
      for (let dj = -1; dj <= 1; dj++) {
        const j = j0 + dj;
        if (j < 0 || j >= gH) continue;
        for (let dk = -1; dk <= 1; dk++) {
          const k = k0 + dk;
          if (k < 0 || k >= gD) continue;
          const bucket = grid.get(key(i, j, k));
          if (!bucket) continue;
          for (const t of bucket) {
            const na = surfaceFaces[t * 3] ?? 0, nb = surfaceFaces[t * 3 + 1] ?? 0, nc = surfaceFaces[t * 3 + 2] ?? 0;
            const d = pointTriangleDistance(
              px, py, pz,
              nodes[na * 3] ?? 0, nodes[na * 3 + 1] ?? 0, nodes[na * 3 + 2] ?? 0,
              nodes[nb * 3] ?? 0, nodes[nb * 3 + 1] ?? 0, nodes[nb * 3 + 2] ?? 0,
              nodes[nc * 3] ?? 0, nodes[nc * 3 + 1] ?? 0, nodes[nc * 3 + 2] ?? 0,
            );
            const pen = d - (faceBand[t] ?? 0);
            if (pen < best) best = pen;
          }
        }
      }
    }
    phi[n] = best;
  }

  return phi;
}

/**
 * Per-element local wall-normal direction: average the (up to 4) corner
 * unit normals from `computeNodeSurfaceDistancesAndNormals` and renormalize.
 * This is the per-element weak-axis direction for the wall-to-wall bond
 * criterion — it varies continuously around a part's contour, unlike the
 * single global weak axis used for interlayer (Z) bonding.
 *
 * A zero-length average (corners with no resolved direction, or directions
 * that cancel — e.g. a flat/degenerate element far from any wall interface)
 * yields a zero vector, which downstream consumers must treat as "no
 * interface here" (no-NaN-by-construction).
 *
 * @returns Float64Array of length elementCount*3 (unit vectors, zero where undefined).
 */
export function computeElementWallNormals(
  mesh: TetMesh,
  nodeNormal: Float64Array,
): Float64Array {
  const out = new Float64Array(mesh.elementCount * 3);
  const npe = mesh.nodesPerElem;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    let sx = 0, sy = 0, sz = 0;
    for (let k = 0; k < 4; k++) {
      const n = mesh.elements[base + k] ?? 0;
      sx += nodeNormal[n * 3] ?? 0;
      sy += nodeNormal[n * 3 + 1] ?? 0;
      sz += nodeNormal[n * 3 + 2] ?? 0;
    }
    const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (len > 1e-9) {
      const inv = 1 / len;
      out[e * 3] = sx * inv;
      out[e * 3 + 1] = sy * inv;
      out[e * 3 + 2] = sz * inv;
    }
  }
  return out;
}
