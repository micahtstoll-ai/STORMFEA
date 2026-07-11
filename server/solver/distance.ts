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
 * C3D10 midside nodes are skipped (left at dMax): the wall-fraction level
 * set (wallfrac.ts) only reads corner distances.
 */

import type { TetMesh } from "./types.js";

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
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;

  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) {
    return Math.sqrt(apx * apx + apy * apy + apz * apz); // vertex A
  }

  const bpx = px - bx, bpy = py - by, bpz = pz - bz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) {
    return Math.sqrt(bpx * bpx + bpy * bpy + bpz * bpz); // vertex B
  }

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const denom = d1 - d3;
    const v = denom > 0 ? d1 / denom : 0; // edge AB (denom 0 ⇒ degenerate)
    const qx = ax + v * abx - px, qy = ay + v * aby - py, qz = az + v * abz - pz;
    return Math.sqrt(qx * qx + qy * qy + qz * qz);
  }

  const cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) {
    return Math.sqrt(cpx * cpx + cpy * cpy + cpz * cpz); // vertex C
  }

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const denom = d2 - d6;
    const w = denom > 0 ? d2 / denom : 0; // edge AC
    const qx = ax + w * acx - px, qy = ay + w * acy - py, qz = az + w * acz - pz;
    return Math.sqrt(qx * qx + qy * qy + qz * qz);
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const denom = (d4 - d3) + (d5 - d6);
    const w = denom > 0 ? (d4 - d3) / denom : 0; // edge BC
    const qx = bx + w * (cx - bx) - px, qy = by + w * (cy - by) - py, qz = bz + w * (cz - bz) - pz;
    return Math.sqrt(qx * qx + qy * qy + qz * qz);
  }

  // Inside face region
  const denom = va + vb + vc;
  if (denom <= 0) {
    // Fully degenerate triangle — fall back to vertex A distance (the edge
    // cases above already handled collinear layouts).
    return Math.sqrt(apx * apx + apy * apy + apz * apz);
  }
  const v = vb / denom, w = vc / denom;
  const qx = ax + v * abx + w * acx - px;
  const qy = ay + v * aby + w * acy - py;
  const qz = az + v * abz + w * acz - pz;
  return Math.sqrt(qx * qx + qy * qy + qz * qz);
}

/**
 * Distance from every corner node to the nearest boundary triangle.
 *
 * @param mesh          Tet mesh (C3D4 or C3D10; midside nodes are skipped).
 * @param surfaceFaces  Boundary triangle corner-node index triples into
 *                      mesh.nodes (from TetGen/Gmsh/extractSurfaceFaces).
 * @param dMax          Clamp distance: nodes farther than this from the
 *                      surface report exactly dMax ("deep core"). Keeps the
 *                      grid search O(1) per node.
 * @returns             Float64Array of length nodeCount. Nodes referenced by
 *                      surfaceFaces are exactly 0; skipped (midside) nodes
 *                      and deep-core nodes report dMax.
 */
export function computeNodeSurfaceDistances(
  mesh: TetMesh,
  surfaceFaces: Int32Array,
  dMax: number,
): Float64Array {
  const nodeCount = mesh.nodeCount;
  const nodes = mesh.nodes;
  const dist = new Float64Array(nodeCount).fill(dMax);
  const triCount = Math.floor(surfaceFaces.length / 3);
  if (triCount === 0 || dMax <= 0) return dist;

  // Boundary nodes are exactly on the surface.
  for (let i = 0; i < triCount * 3; i++) {
    const n = surfaceFaces[i] ?? 0;
    if (n >= 0 && n < nodeCount) dist[n] = 0;
  }

  // Corner-node set: the level set only reads corners (first 4 per element).
  const isCorner = new Uint8Array(nodeCount);
  const npe = mesh.nodesPerElem;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    for (let k = 0; k < 4; k++) {
      const n = mesh.elements[base + k] ?? 0;
      if (n >= 0 && n < nodeCount) isCorner[n] = 1;
    }
  }

  // ── Triangle-bucketed spatial grid ──────────────────────────────────────
  // Same keying scheme as the nearest-node grids in analysis.ts; triangles
  // are inserted into every cell their AABB overlaps so a query only needs
  // cells within the search radius.
  let xMin = Infinity, yMin = Infinity, zMin = Infinity;
  let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
  for (let n = 0; n < nodeCount; n++) {
    const x = nodes[n * 3] ?? 0, y = nodes[n * 3 + 1] ?? 0, z = nodes[n * 3 + 2] ?? 0;
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  }
  const CELL = Math.max(dMax, 1e-6);
  const gW = Math.max(1, Math.ceil((xMax - xMin) / CELL) + 1);
  const gH = Math.max(1, Math.ceil((yMax - yMin) / CELL) + 1);
  const gD = Math.max(1, Math.ceil((zMax - zMin) / CELL) + 1);
  const ci = (x: number) => Math.min(gW - 1, Math.max(0, Math.floor((x - xMin) / CELL)));
  const cj = (y: number) => Math.min(gH - 1, Math.max(0, Math.floor((y - yMin) / CELL)));
  const ck = (z: number) => Math.min(gD - 1, Math.max(0, Math.floor((z - zMin) / CELL)));
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

  // ── Per-node query ──────────────────────────────────────────────────────
  // Cell size = dMax, so any triangle within dMax of the node lies in the
  // node's cell or one of its 26 neighbors. One ring suffices; anything
  // farther is clamped to dMax anyway.
  for (let n = 0; n < nodeCount; n++) {
    if (!isCorner[n]) continue;       // midside nodes unused by the level set
    if (dist[n] === 0) continue;      // boundary node, exact already
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
            if (d < best) best = d;
          }
        }
      }
    }
    dist[n] = best;
  }

  return dist;
}
