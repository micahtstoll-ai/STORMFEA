/**
 * error-mapping.test.ts
 * ---------------------
 * Correctness tests for the adjacency-based error-estimate vertex mapping
 * (issue #104). The fast path (node→element adjacency, built once per mesh)
 * must produce IDENTICAL output to the old brute-force scan that checked
 * every element for every nearby node.
 *
 * A verbatim port of the pre-fix brute-force algorithm lives in this file
 * as the reference implementation.
 */

import { describe, it, expect } from "vitest";
import { mapErrorEstimateToVertices } from "../../analysis.js";
import { buildNodeElementAdjacency, buildNodeElementLists } from "../../solver/adjacency.js";
import { generateBoxMesh } from "../../solver/meshgen.js";
import type { TetMesh } from "../../solver/types.js";

// ── Reference: verbatim port of the old brute-force mapping ─────────────────

function bruteForceErrorMapping(
  mesh: TetMesh,
  errorEstimate: Float32Array,
  positions: Float32Array,
  vertCount: number,
): Float32Array {
  const out = new Float32Array(vertCount);
  const R3D = 3.0, CELL3 = R3D;

  let nxMin = Infinity, nxMax = -Infinity, nyMin = Infinity, nyMax = -Infinity, nzMin = Infinity, nzMax = -Infinity;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const x = mesh.nodes[n*3] ?? 0, y = mesh.nodes[n*3+1] ?? 0, z = mesh.nodes[n*3+2] ?? 0;
    if (x < nxMin) nxMin = x; if (x > nxMax) nxMax = x;
    if (y < nyMin) nyMin = y; if (y > nyMax) nyMax = y;
    if (z < nzMin) nzMin = z; if (z > nzMax) nzMax = z;
  }
  const gW3 = Math.ceil((nxMax - nxMin) / CELL3) + 1;
  const gH3 = Math.ceil((nyMax - nyMin) / CELL3) + 1;
  const gD3 = Math.ceil((nzMax - nzMin) / CELL3) + 1;
  const grid3 = new Map<number, number[]>();
  for (let n = 0; n < mesh.nodeCount; n++) {
    const ci = Math.floor(((mesh.nodes[n*3]   ?? 0) - nxMin) / CELL3);
    const cj = Math.floor(((mesh.nodes[n*3+1] ?? 0) - nyMin) / CELL3);
    const ck = Math.floor(((mesh.nodes[n*3+2] ?? 0) - nzMin) / CELL3);
    const key = ci*gH3*gD3 + cj*gD3 + ck;
    let cell = grid3.get(key); if (!cell) { cell = []; grid3.set(key, cell); }
    cell.push(n);
  }

  function nearestElementError(vx: number, vy: number, vz: number): number {
    let bestDist2 = Infinity, bestError = 0;
    const R2 = R3D * R3D;
    const ci = Math.floor((vx - nxMin) / CELL3);
    const cj = Math.floor((vy - nyMin) / CELL3);
    const ck = Math.floor((vz - nzMin) / CELL3);

    const checkedElems = new Set<number>();
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let dk = -1; dk <= 1; dk++) {
          const ni2 = ci + di, nj2 = cj + dj, nk2 = ck + dk;
          if (ni2 < 0 || ni2 >= gW3 || nj2 < 0 || nj2 >= gH3 || nk2 < 0 || nk2 >= gD3) continue;
          const cell = grid3.get(ni2 * gH3 * gD3 + nj2 * gD3 + nk2);
          if (!cell) continue;
          for (const n of cell) {
            const npe = mesh.nodesPerElem ?? 4;
            for (let e = 0; e < mesh.elementCount; e++) {
              if (checkedElems.has(e)) continue;
              const base = e * npe;
              let hasNode = false;
              for (let ni = 0; ni < Math.min(4, npe); ni++) {
                if ((mesh.elements[base + ni] ?? 0) === n) { hasNode = true; break; }
              }
              if (!hasNode) continue;
              checkedElems.add(e);

              let cx = 0, cy = 0, cz = 0;
              for (let ni = 0; ni < 4; ni++) {
                const nodeIdx = mesh.elements[base + ni] ?? 0;
                cx += mesh.nodes[nodeIdx * 3] ?? 0;
                cy += mesh.nodes[nodeIdx * 3 + 1] ?? 0;
                cz += mesh.nodes[nodeIdx * 3 + 2] ?? 0;
              }
              cx /= 4; cy /= 4; cz /= 4;
              const dx = cx - vx, dy = cy - vy, dz = cz - vz;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < R2 && d2 < bestDist2) {
                bestDist2 = d2;
                bestError = errorEstimate[e] ?? 0;
              }
            }
          }
        }
      }
    }
    if (bestDist2 === Infinity) {
      for (let e = 0; e < mesh.elementCount; e++) {
        const npe = mesh.nodesPerElem ?? 4;
        const base = e * npe;
        let cx = 0, cy = 0, cz = 0;
        for (let ni = 0; ni < 4; ni++) {
          const nodeIdx = mesh.elements[base + ni] ?? 0;
          cx += mesh.nodes[nodeIdx * 3] ?? 0;
          cy += mesh.nodes[nodeIdx * 3 + 1] ?? 0;
          cz += mesh.nodes[nodeIdx * 3 + 2] ?? 0;
        }
        cx /= 4; cy /= 4; cz /= 4;
        const dx = cx - vx, dy = cy - vy, dz = cz - vz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          bestError = errorEstimate[e] ?? 0;
        }
      }
    }
    return bestError;
  }

  for (let v = 0; v < vertCount; v++) {
    out[v] = nearestElementError(
      positions[v*3] ?? 0, positions[v*3+1] ?? 0, positions[v*3+2] ?? 0,
    );
  }
  return out;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function syntheticErrors(elementCount: number, seed: number): Float32Array {
  const errs = new Float32Array(elementCount);
  let state = seed >>> 0;
  for (let e = 0; e < elementCount; e++) {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    errs[e] = state / 0x100000000;
  }
  return errs;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildNodeElementAdjacency", () => {
  it("matches the naive per-node element lists on a box mesh", () => {
    const mesh = generateBoxMesh(-5, -4, -3, 6, 4, 3, 4, 3, 2);
    const { ptr, list } = buildNodeElementAdjacency(mesh);
    const naive = buildNodeElementLists(mesh);
    expect(ptr.length).toBe(mesh.nodeCount + 1);
    expect(ptr[mesh.nodeCount]).toBe(mesh.elementCount * mesh.nodesPerElem);
    for (let n = 0; n < mesh.nodeCount; n++) {
      const got = Array.from(list.subarray(ptr[n]!, ptr[n + 1]!));
      expect(got).toEqual(naive[n]);
    }
  });

  it("restricts to corner nodes when nodesPerElemToUse=4 (C3D10 semantics)", () => {
    // Hand-built single C3D10 element: nodes 0-3 corners, 4-9 midside.
    const nodes = new Float64Array([
      0,0,0,  1,0,0,  0,1,0,  0,0,1,          // corners
      0.5,0,0,  0.5,0.5,0,  0,0.5,0,          // midside
      0,0,0.5,  0.5,0,0.5,  0,0.5,0.5,
    ]);
    const mesh: TetMesh = {
      nodes,
      nodeCount: 10,
      elements: new Int32Array([0,1,2,3,4,5,6,7,8,9]),
      elementCount: 1,
      nodesPerElem: 10,
    };
    const { ptr, list } = buildNodeElementAdjacency(mesh, 4);
    // Corner nodes 0-3 are adjacent to element 0; midside nodes 4-9 are not.
    for (let n = 0; n < 4; n++) {
      expect(Array.from(list.subarray(ptr[n]!, ptr[n + 1]!))).toEqual([0]);
    }
    for (let n = 4; n < 10; n++) {
      expect(ptr[n + 1]! - ptr[n]!).toBe(0);
    }
  });
});

describe("mapErrorEstimateToVertices (issue #104)", () => {
  it("produces identical output to the old brute-force scan (C3D4, negative coords)", () => {
    // Box spanning negative coordinates — the regime where grid indexing
    // bugs historically appeared.
    const mesh = generateBoxMesh(-12, -8, -6, 10, 8, 6, 5, 4, 3);
    const errs = syntheticErrors(mesh.elementCount, 987654321);

    // Query points: perturbed node positions (in-grid path), plus points far
    // outside the mesh (global-scan fallback path), plus points off the grid
    // on the negative side.
    const pts: number[] = [];
    for (let n = 0; n < mesh.nodeCount; n += 3) {
      pts.push(
        (mesh.nodes[n*3]   ?? 0) + 0.137,
        (mesh.nodes[n*3+1] ?? 0) - 0.291,
        (mesh.nodes[n*3+2] ?? 0) + 0.083,
      );
    }
    pts.push(500, 500, 500);       // far outside → fallback
    pts.push(-500, -500, -500);    // far outside, negative → fallback
    pts.push(-11.9, -7.9, -5.9);   // near the negative corner
    const vertCount = pts.length / 3;
    const positions = new Float32Array(pts);

    const fast  = mapErrorEstimateToVertices(mesh, errs, positions, vertCount);
    const brute = bruteForceErrorMapping(mesh, errs, positions, vertCount);

    expect(fast.length).toBe(vertCount);
    for (let v = 0; v < vertCount; v++) {
      expect(fast[v]).toBe(brute[v]);   // exact — same FP operations
    }
  });

  it("produces identical output on a C3D10 mesh (corner-only adjacency)", () => {
    // Two C3D10 elements sharing a face; midside nodes deliberately given
    // distinct coordinates so they land in grid cells too.
    const c4 = generateBoxMesh(0, 0, 0, 4, 4, 4, 1, 1, 1);
    // Promote the C3D4 mesh to a fake C3D10 mesh: append 6 unique midside
    // nodes per element (midpoints of edges 01,12,02,03,13,23).
    const EDGE: [number, number][] = [[0,1],[1,2],[0,2],[0,3],[1,3],[2,3]];
    const nElems = c4.elementCount;
    const nodes: number[] = Array.from(c4.nodes.subarray(0, c4.nodeCount * 3));
    const elements: number[] = [];
    let nextNode = c4.nodeCount;
    for (let e = 0; e < nElems; e++) {
      const corners = [0,1,2,3].map(i => c4.elements[e*4+i] ?? 0);
      elements.push(...corners);
      for (const [a, b] of EDGE) {
        const na = corners[a]!, nb = corners[b]!;
        nodes.push(
          ((c4.nodes[na*3]   ?? 0) + (c4.nodes[nb*3]   ?? 0)) / 2,
          ((c4.nodes[na*3+1] ?? 0) + (c4.nodes[nb*3+1] ?? 0)) / 2,
          ((c4.nodes[na*3+2] ?? 0) + (c4.nodes[nb*3+2] ?? 0)) / 2,
        );
        elements.push(nextNode++);
      }
    }
    const mesh10: TetMesh = {
      nodes: new Float64Array(nodes),
      nodeCount: nextNode,
      elements: new Int32Array(elements),
      elementCount: nElems,
      nodesPerElem: 10,
    };

    const errs = syntheticErrors(nElems, 24680);
    const pts = new Float32Array([
      0.31, 0.87, 1.23,
      3.71, 3.11, 0.53,
      2.01, 2.02, 2.03,
      99, 99, 99,           // fallback
    ]);
    const vertCount = pts.length / 3;

    const fast  = mapErrorEstimateToVertices(mesh10, errs, pts, vertCount);
    const brute = bruteForceErrorMapping(mesh10, errs, pts, vertCount);
    for (let v = 0; v < vertCount; v++) {
      expect(fast[v]).toBe(brute[v]);
    }
  });
});
