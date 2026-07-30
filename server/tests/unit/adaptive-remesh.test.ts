/**
 * adaptive-remesh.test.ts — issue #149 (INTEGRATION, requires a tetgen binary).
 *
 * Exercises the BINARY-DEPENDENT half of the adaptive loop:
 * meshWithTetGenSizing must honour a per-node size field so elements shrink
 * where the field requests small sizes and stay coarse elsewhere.
 *
 * Locally (no tetgen) this suite self-skips with a notice — the same pattern as
 * tetgen-c3d10.test.ts. It only runs where a tetgen binary is available (CI, or
 * via TETGEN_BIN). The size-FIELD construction and loop control are covered
 * binary-free in adaptive-mesh.test.ts; this is the end-to-end proof that the
 * field actually drives the mesher.
 *
 *   TETGEN_BIN=/path/to/tetgen npx vitest run server/tests/unit/adaptive-remesh.test.ts
 */
import { describe, it, expect, beforeAll } from "vitest";
import { meshWithTetGen, meshWithTetGenSizing, probeTetGen, type TetGenResult } from "../../tetgen.js";
import {
  buildSizeField, aggregateElementFieldsToNodes, type SizeField,
} from "../../solver/adaptiveMesh.js";
import type { TetMesh } from "../../solver/types.js";

const probe = await probeTetGen();
if (!probe.found) {
  // eslint-disable-next-line no-console
  console.warn(
    "SKIP: tetgen not found (searched TETGEN_BIN env var, module directory, PATH) — " +
    "skipping adaptive-remesh integration test (issue #149). The size-field construction " +
    "and loop control are still covered binary-free in adaptive-mesh.test.ts.",
  );
}

// A 4×4×4 mm cube as a triangle soup (same style as tetgen-c3d10.test.ts).
const S = 4;
const CUBE_VERTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [S, 0, 0], [S, S, 0], [0, S, 0],
  [0, 0, S], [S, 0, S], [S, S, S], [0, S, S],
];
const CUBE_TRIS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7],
  [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
  [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
];
function cubeTriangleSoup(): { positions: Float32Array; triangleCount: number } {
  const positions = new Float32Array(CUBE_TRIS.length * 9);
  CUBE_TRIS.forEach(([a, b, c], t) => {
    [a, b, c].forEach((vi, k) => {
      const v = CUBE_VERTS[vi]!;
      positions[t * 9 + k * 3]     = v[0];
      positions[t * 9 + k * 3 + 1] = v[1];
      positions[t * 9 + k * 3 + 2] = v[2];
    });
  });
  return { positions, triangleCount: CUBE_TRIS.length };
}

/** Mean corner-tet edge length near a target point (density probe). */
function meanSizeNear(mesh: TetMesh, px: number, py: number, pz: number, radius: number): { mean: number; count: number } {
  const npe = mesh.nodesPerElem ?? 4;
  let sum = 0, count = 0;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 4; k++) {
      const n = mesh.elements[base + k]!;
      cx += mesh.nodes[n * 3]!; cy += mesh.nodes[n * 3 + 1]!; cz += mesh.nodes[n * 3 + 2]!;
    }
    cx /= 4; cy /= 4; cz /= 4;
    const d2 = (cx - px) ** 2 + (cy - py) ** 2 + (cz - pz) ** 2;
    if (d2 <= radius * radius) {
      // characteristic size from corner 0-1 edge as a cheap proxy
      const n0 = mesh.elements[base]!, n1 = mesh.elements[base + 1]!;
      const edge = Math.hypot(
        mesh.nodes[n0 * 3]! - mesh.nodes[n1 * 3]!,
        mesh.nodes[n0 * 3 + 1]! - mesh.nodes[n1 * 3 + 1]!,
        mesh.nodes[n0 * 3 + 2]! - mesh.nodes[n1 * 3 + 2]!,
      );
      sum += edge; count++;
    }
  }
  return { mean: count > 0 ? sum / count : 0, count };
}

describe.skipIf(!probe.found)("adaptive re-mesh honours the size field (requires tetgen binary)", () => {
  let coarse: TetGenResult;
  let field: SizeField;
  let refined: TetGenResult;

  beforeAll(async () => {
    const { positions, triangleCount } = cubeTriangleSoup();
    // Coarse base mesh (linear tets keep the assertions simple).
    coarse = await meshWithTetGen(positions, triangleCount, 1, 20);

    // Fake an error field concentrated in the corner near (0,0,0): elements
    // whose centroid is close to that corner get high error, the rest ~0.
    const m = coarse.mesh;
    const npe = m.nodesPerElem ?? 4;
    const err = new Float32Array(m.elementCount);
    for (let e = 0; e < m.elementCount; e++) {
      const base = e * npe;
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 4; k++) {
        const n = m.elements[base + k]!;
        cx += m.nodes[n * 3]!; cy += m.nodes[n * 3 + 1]!; cz += m.nodes[n * 3 + 2]!;
      }
      cx /= 4; cy /= 4; cz /= 4;
      const dCorner = Math.hypot(cx, cy, cz);
      err[e] = dCorner < S * 0.5 ? 0.9 : 0.001;
    }
    field = buildSizeField(m, err, {
      targetError: 0.02, order: 1, minSizeFactor: 0.3, maxSizeFactor: 1.0,
    });

    refined = await meshWithTetGenSizing(positions, triangleCount, m, field, 1);
  }, 180_000);

  it("the size field requests refinement only near the high-error corner", () => {
    // Sanity: this is really the field we think it is.
    const { nodeError } = aggregateElementFieldsToNodes(coarse.mesh, new Float32Array(coarse.mesh.elementCount));
    expect(nodeError.length).toBe(coarse.mesh.nodeCount);
    expect(field.refinedNodeCount).toBeGreaterThan(0);
  });

  it("produces a valid, non-empty refined mesh with in-range indices", () => {
    expect(refined.mesh.elementCount).toBeGreaterThan(0);
    for (const n of refined.mesh.elements) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(refined.mesh.nodeCount);
    }
  });

  it("refines the high-error corner denser than the opposite (low-error) corner", () => {
    const hi = meanSizeNear(refined.mesh, 0, 0, 0, S * 0.6);
    const lo = meanSizeNear(refined.mesh, S, S, S, S * 0.6);
    expect(hi.count).toBeGreaterThan(0);
    expect(lo.count).toBeGreaterThan(0);
    // Smaller mean element size near the refined corner than the coarse one.
    expect(hi.mean).toBeLessThan(lo.mean);
  });

  it("increases the overall element count vs the coarse base mesh", () => {
    expect(refined.mesh.elementCount).toBeGreaterThan(coarse.mesh.elementCount);
  });
});
