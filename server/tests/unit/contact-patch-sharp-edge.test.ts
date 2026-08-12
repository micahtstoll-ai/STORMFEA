/**
 * contact-patch-sharp-edge.test.ts — issue #308.
 *
 * A `contact_patch` load placed exactly on a sharp geometric edge wraps onto
 * both faces the edge joins (correct — a contact at an edge really does bear
 * on both), but the governing peak inside such a patch does not converge with
 * mesh refinement the way one on a flat face does (measured on the Ø5-bore
 * tube fixture, `docs/load-distribution-default.md`). `assembleContactPatchLoad`
 * now reports `maxLoadedNormalAngleDeg` — the largest angle between adjacent
 * LOADED triangles' normals — so a caller can flag it instead of silently
 * reporting a mesh-dependent number. These tests pin the signal itself: near
 * zero on a flat patch, near 90 degrees on a patch that wraps a cube edge,
 * and past `CONTACT_PATCH_SHARP_EDGE_DEG` in exactly the edge case.
 */
import { describe, it, expect } from "vitest";
import {
  assembleContactPatchLoad, CONTACT_PATCH_SHARP_EDGE_DEG,
} from "../../solver/load.js";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import type { TetMesh } from "../../solver/types.js";

const L = 10;   // 10 mm cube

function cube(n: number): { mesh: TetMesh; faces: Int32Array } {
  const mesh = generateBoxMeshC3D4(0, 0, 0, L, L, L, n, n, n);
  return { mesh, faces: extractSurfaceFaces(mesh) };
}

describe("assembleContactPatchLoad — maxLoadedNormalAngleDeg (#308)", () => {
  it("is ~0 deg for a patch entirely on one flat face", () => {
    const { mesh, faces } = cube(10);
    const r = assembleContactPatchLoad(mesh, faces, [0, 0, -1], [0, 0, -100], [5, 5, L], 2);
    expect(r.loadedTriangles).toBeGreaterThan(1);
    expect(r.maxLoadedNormalAngleDeg).toBeLessThan(1);
  });

  it("is ~90 deg for a patch centred on a cube edge (wraps both faces)", () => {
    const { mesh, faces } = cube(10);
    // Same point and radius as the "wraps onto the adjoining face" fixture in
    // contact-patch-surface.test.ts — that test pins WHICH nodes get loaded;
    // this one pins the geometric signal the wrap produces.
    const r = assembleContactPatchLoad(mesh, faces, [0, 0, -1], [0, 0, -100], [5, 0, L], 2);
    expect(r.maxLoadedNormalAngleDeg).toBeCloseTo(90, 0);
    expect(r.maxLoadedNormalAngleDeg).toBeGreaterThanOrEqual(CONTACT_PATCH_SHARP_EDGE_DEG);
  });

  it("stays ~0 deg as the patch grows on a flat face, however wide", () => {
    // The signal must not fire on an ordinary large patch that never reaches
    // a rim — otherwise every generously-sized load on a flat part would be
    // flagged as spanning a sharp edge.
    const { mesh, faces } = cube(14);
    const r = assembleContactPatchLoad(mesh, faces, [0, 0, -1], [0, 0, -100], [5, 5, L], 4.5);
    expect(r.loadedTriangles).toBeGreaterThan(4);
    expect(r.maxLoadedNormalAngleDeg).toBeLessThan(1);
  });

  it("is 0 for a single-triangle fallback patch (no adjacent loaded pair)", () => {
    const { mesh, faces } = cube(12);
    const r = assembleContactPatchLoad(mesh, faces, [0, 0, -1], [0, 0, -100], [5, 5, L], 0.01);
    expect(r.maxLoadedNormalAngleDeg).toBe(0);
  });
});
