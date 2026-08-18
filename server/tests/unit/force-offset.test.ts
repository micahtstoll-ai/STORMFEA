/**
 * force-offset.test.ts — point-force offset placement.
 *
 * A force with `selectionMode: 'point'` may carry a global-frame `offset` that
 * nudges its application point before the contact patch is assembled. The offset
 * is clamped to the part bounding box, applies only in 'point' mode, and is
 * bit-identical to the pre-offset path when absent/zero.
 *
 * `effectiveForcePosition` is the pure point calculation (position + offset,
 * clamped). The load-behaviour tests drive that point through
 * `assembleContactPatchLoad` — the same call the analysis loop makes — to show
 * that offsetting the point moves the load exactly as moving the click does.
 */
import { describe, it, expect } from "vitest";
import { effectiveForcePosition } from "../../analysis.js";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import { assembleContactPatchLoad } from "../../solver/load.js";
import type { TetMesh } from "../../solver/types.js";

const L = 10;   // 10 mm cube
const BOUNDS = { minX: 0, maxX: L, minY: 0, maxY: L, minZ: 0, maxZ: L };

function build(n: number): { mesh: TetMesh; faces: Int32Array } {
  const mesh = generateBoxMeshC3D4(0, 0, 0, L, L, L, n, n, n);
  return { mesh, faces: extractSurfaceFaces(mesh) };
}

/** Load-weighted centroid of the applied nodal forces, and the resultant. */
function loadCentroid(mesh: TetMesh, f: Float64Array) {
  let sx = 0, sy = 0, sz = 0, w = 0, fx = 0, fy = 0, fz = 0;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const nx = f[n*3] ?? 0, ny = f[n*3+1] ?? 0, nz = f[n*3+2] ?? 0;
    fx += nx; fy += ny; fz += nz;
    const mag = Math.hypot(nx, ny, nz);
    if (mag === 0) continue;
    sx += (mesh.nodes[n*3] ?? 0) * mag;
    sy += (mesh.nodes[n*3+1] ?? 0) * mag;
    sz += (mesh.nodes[n*3+2] ?? 0) * mag;
    w += mag;
  }
  return { x: sx/w, y: sy/w, z: sz/w, fx, fy, fz };
}

describe("effectiveForcePosition — the pure point calculation", () => {
  const P: [number, number, number] = [2, 5, L];

  it("returns the position unchanged when there is no offset", () => {
    expect(effectiveForcePosition(P, undefined, "point", BOUNDS)).toEqual(P);
  });

  it("returns the position unchanged for an all-zero offset (bit-identical path)", () => {
    const out = effectiveForcePosition(P, [0, 0, 0], "point", BOUNDS);
    expect(out).toEqual(P);
    // Same reference-value identity the pre-offset path relied on.
    expect(out[0]).toBe(P[0]); expect(out[1]).toBe(P[1]); expect(out[2]).toBe(P[2]);
  });

  it("adds the offset in global coordinates", () => {
    expect(effectiveForcePosition([2, 5, 5], [3, -1, 0], "point", BOUNDS)).toEqual([5, 4, 5]);
  });

  it("clamps the offset point to the bounding box", () => {
    // +X and +Z driven past the box; -Y driven below it.
    expect(effectiveForcePosition([2, 5, 5], [100, -100, 100], "point", BOUNDS))
      .toEqual([L, 0, L]);
  });

  it("ignores the offset for face and edge selection (already resolved UI-side)", () => {
    expect(effectiveForcePosition(P, [5, 0, 0], "face", BOUNDS)).toEqual(P);
    expect(effectiveForcePosition(P, [5, 0, 0], "edge", BOUNDS)).toEqual(P);
  });

  it("treats an absent selectionMode as 'point'", () => {
    expect(effectiveForcePosition([2, 5, 5], [1, 0, 0], undefined, BOUNDS)).toEqual([3, 5, 5]);
  });
});

describe("force offset — load follows the offset point through the patch", () => {
  it("moves the load by the offset, matching an un-offset click at the same point", () => {
    const { mesh, faces } = build(10);
    const d: [number, number, number] = [0, 0, 1];
    const F: [number, number, number] = [0, 0, 100];
    const clicked: [number, number, number] = [2.5, 5, L];

    // Offset the clicked point by +5 mm in x ...
    const offPos = effectiveForcePosition(clicked, [5, 0, 0], "point", BOUNDS);
    const offset = assembleContactPatchLoad(mesh, faces, d, F, offPos);
    // ... and compare to clicking directly at the offset destination.
    const direct = assembleContactPatchLoad(mesh, faces, d, F, [7.5, 5, L]);

    const cOff = loadCentroid(mesh, offset.forces);
    const cDir = loadCentroid(mesh, direct.forces);

    // The offset path reproduces the direct-click patch exactly.
    expect(cOff.x).toBeCloseTo(cDir.x, 9);
    expect(cOff.x).toBeCloseTo(7.5, 0);
    // And it moved from the original click.
    expect(cOff.x).toBeGreaterThan(2.5 + 2);
    // Whole load is still applied.
    expect(cOff.fz).toBeCloseTo(100, 9);
  });

  it("a clamped offset still applies the full load on the surface", () => {
    const { mesh, faces } = build(8);
    // Offset drives the point far past +x; it clamps to the +x edge of the top face.
    const p = effectiveForcePosition([5, 5, L], [999, 0, 0], "point", BOUNDS);
    expect(p[0]).toBe(L);
    const r = assembleContactPatchLoad(mesh, faces, [0, 0, 1], [0, 0, 100], p);
    expect(r.loadedTriangles).toBeGreaterThan(0);
    const c = loadCentroid(mesh, r.forces);
    expect(c.fz).toBeCloseTo(100, 9);
    expect(c.x).toBeGreaterThan(7);   // patch sits at the clamped +x edge
  });

  it("a zero offset is bit-identical to placing the force with no offset at all", () => {
    const { mesh, faces } = build(8);
    const clicked: [number, number, number] = [4, 6, L];
    const withZero = effectiveForcePosition(clicked, [0, 0, 0], "point", BOUNDS);
    const a = assembleContactPatchLoad(mesh, faces, [0, 0, 1], [0, 0, 100], withZero);
    const b = assembleContactPatchLoad(mesh, faces, [0, 0, 1], [0, 0, 100], clicked);
    for (let i = 0; i < a.forces.length; i++) {
      expect(a.forces[i]).toBe(b.forces[i]);
    }
  });
});
