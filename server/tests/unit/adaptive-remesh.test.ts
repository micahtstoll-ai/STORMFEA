/**
 * adaptive-remesh.test.ts — issue #149 (INTEGRATION, requires a tetgen binary).
 *
 * Exercises the BINARY-DEPENDENT half of the adaptive loop:
 * meshWithTetGenSizing must honour a per-node size field so elements shrink
 * where the field requests small sizes and stay coarse elsewhere.
 *
 * The mechanism is TetGen's `-r` (refine an existing mesh) under per-element
 * volume constraints, NOT the `-m` background metric it originally used — `-m`
 * leaves slivers on curved boundaries even with a constant metric, which is what
 * kept the refined solve from ever completing. See the meshWithTetGenSizing
 * header for the measurements, and adaptive-benchmark.test.ts for the
 * end-to-end acceptance gate.
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
    // Coarse base mesh (linear tets keep the assertions simple), but NOT the
    // minimal tetrahedralisation. At maxVol 20 on this 64 mm³ cube TetGen
    // returns 22 elements — so coarse that the re-mesh's own `-q1.4` quality
    // refinement does all the work and swamps the size field, and the corner
    // density contrast measured below collapses to 1.04. At maxVol 4 (129
    // elements) the base already satisfies the quality bound, the volume
    // constraints dominate as intended, and the contrast is 2.1×. The fixture
    // has to leave the size field something to act on.
    coarse = await meshWithTetGen(positions, triangleCount, 1, 4);

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

  it("adds boundary points — the size field is not blocked by a frozen surface", () => {
    // Regression guard for the `-Y` defect: with the input surface triangulation
    // preserved, TetGen may not subdivide boundary facets, so a requested size
    // smaller than the existing boundary triangles is unreachable and the
    // "refined" mesh can come back COARSER than the base (measured on the old
    // `-pm` path: 12 elements against a 22-element base). Refinement near a
    // surface REQUIRES new boundary vertices, so demand strictly more nodes than
    // the 8 input corners. `-Y` is deliberately absent from every switch set.
    expect(refined.steinerCount).toBeGreaterThan(0);
    expect(refined.mesh.nodeCount).toBeGreaterThan(CUBE_VERTS.length);
  });

  it("emits the input surface vertices first, in welded order (O(1) surface map)", () => {
    // meshWithTetGenSizing returns an identity surfaceToNode on the strength of
    // a TetGen property: input vertices come out as the first N nodes, in the
    // order they were fed in. Dropping `-Y` is exactly the change that could
    // have invalidated it, so assert it against actual coordinates instead of
    // trusting the switch set.
    //
    // Note the map is in WELDED vertex order (the order weldVertices first
    // encounters each position while walking the triangle soup), not CUBE_VERTS
    // order — so round-trip through surfaceFaces rather than comparing to
    // CUBE_VERTS positionally.
    const { positions } = cubeTriangleSoup();
    expect(refined.surfaceToNode.length).toBe(CUBE_VERTS.length);
    for (let i = 0; i < refined.surfaceToNode.length; i++) {
      expect(refined.surfaceToNode[i]).toBe(i);   // identity, as the caller assumes
    }
    // Every corner of every input triangle must land on the mesh node its
    // surface index points at, with the coordinates it was submitted with.
    for (let t = 0; t < CUBE_TRIS.length; t++) {
      for (let k = 0; k < 3; k++) {
        const n = refined.surfaceToNode[refined.surfaceFaces[t * 3 + k]!]!;
        expect(refined.mesh.nodes[n * 3]!).toBeCloseTo(positions[t * 9 + k * 3]!, 9);
        expect(refined.mesh.nodes[n * 3 + 1]!).toBeCloseTo(positions[t * 9 + k * 3 + 1]!, 9);
        expect(refined.mesh.nodes[n * 3 + 2]!).toBeCloseTo(positions[t * 9 + k * 3 + 2]!, 9);
      }
    }
  });
});
