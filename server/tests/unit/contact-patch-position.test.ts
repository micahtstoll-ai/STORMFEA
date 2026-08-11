/**
 * contact-patch-position.test.ts — `assembleContactPatchLoad` (issue #271).
 *
 * `ForceSpec.position` is documented as the point of application, the client
 * raycasts the surface and draws an arrow there, and until this mode existed
 * the solver read the field nowhere: measured bit-identical to nine decimals
 * across four application points, including one on the opposite side of the
 * part. This is the mode that makes it load-bearing.
 *
 * The headline assertion is therefore the one the legacy path fails: MOVING THE
 * APPLICATION POINT MOVES THE LOAD. Everything else here guards the ways a
 * position-centred patch can go wrong that a direction-only patch cannot —
 * wrapping onto a face the load never touches, and falling between the
 * triangles into a silent zero-load solve (the issue #157 failure mode).
 */
import { describe, it, expect } from "vitest";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import { assembleContactPatchLoad, CONTACT_PATCH_RADIUS_FRACTION } from "../../solver/load.js";
import type { TetMesh } from "../../solver/types.js";

const L = 10;   // 10 mm cube

function build(n: number, scale = 1): { mesh: TetMesh; faces: Int32Array } {
  const mesh = generateBoxMeshC3D4(0, 0, 0, L * scale, L * scale, L * scale, n, n, n);
  return { mesh, faces: extractSurfaceFaces(mesh) };
}

/** Load-weighted centroid of the applied nodal forces, and the resultant. */
function loadCentroid(mesh: TetMesh, f: Float64Array) {
  let sx = 0, sy = 0, sz = 0, w = 0, fx = 0, fy = 0, fz = 0, loaded = 0;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const nx = f[n*3] ?? 0, ny = f[n*3+1] ?? 0, nz = f[n*3+2] ?? 0;
    fx += nx; fy += ny; fz += nz;
    const mag = Math.hypot(nx, ny, nz);
    if (mag === 0) continue;
    sx += (mesh.nodes[n*3] ?? 0) * mag;
    sy += (mesh.nodes[n*3+1] ?? 0) * mag;
    sz += (mesh.nodes[n*3+2] ?? 0) * mag;
    w += mag; loaded++;
  }
  return { x: sx/w, y: sy/w, z: sz/w, fx, fy, fz, loaded };
}

describe("assembleContactPatchLoad — position is load-bearing (#271)", () => {
  it("moves the load when the application point moves", () => {
    const { mesh, faces } = build(10);
    const d: [number, number, number] = [0, 0, 1];
    const F: [number, number, number] = [0, 0, 100];

    // Two points on the +z face, 5 mm apart in x.
    const near = assembleContactPatchLoad(mesh, faces, d, F, [2.5, 5, L]);
    const far  = assembleContactPatchLoad(mesh, faces, d, F, [7.5, 5, L]);
    const cNear = loadCentroid(mesh, near.forces);
    const cFar  = loadCentroid(mesh, far.forces);

    // The legacy path returns identical results here. This must not.
    expect(cNear.x).toBeLessThan(cFar.x);
    expect(cFar.x - cNear.x).toBeGreaterThan(2.5);
    // Each patch sits near its own requested point, not at the face centre.
    expect(cNear.x).toBeCloseTo(2.5, 0);
    expect(cFar.x).toBeCloseTo(7.5, 0);
    // And both still apply the whole load.
    expect(cNear.fz).toBeCloseTo(100, 9);
    expect(cFar.fz).toBeCloseTo(100, 9);
  });

  it("reproduces the requested force exactly, wherever the point is", () => {
    const { mesh, faces } = build(8);
    for (const p of [[5, 5, L], [1, 1, L], [9, 9, L], [0, 0, L]] as Array<[number, number, number]>) {
      const r = assembleContactPatchLoad(mesh, faces, [0, 0, 1], [0, 0, 250], p);
      const c = loadCentroid(mesh, r.forces);
      expect(c.fz, `at (${p})`).toBeCloseTo(250, 9);
      expect(c.fx, `at (${p})`).toBeCloseTo(0, 12);
      expect(c.fy, `at (${p})`).toBeCloseTo(0, 12);
    }
  });
});

describe("assembleContactPatchLoad — guards", () => {
  it("loads only the surface the point is on, never the far face", () => {
    // A thin plate: 10x10x1. A 3-D ball centred on one face with a radius of a
    // few mm trivially reaches the other one, 1 mm away, which the load never
    // touches. Growing the patch by edge adjacency is what stops it (#305);
    // `contact-patch-surface.test.ts` covers the rule itself.
    const mesh = generateBoxMeshC3D4(0, 0, 0, L, L, 1, 10, 10, 2);
    const faces = extractSurfaceFaces(mesh);
    const r = assembleContactPatchLoad(mesh, faces, [0, 0, -1], [0, 0, -100], [5, 5, 0], 4);
    // The point is on the BOTTOM face (z = 0), so the patch is.
    for (let n = 0; n < mesh.nodeCount; n++) {
      const mag = Math.hypot(r.forces[n*3] ?? 0, r.forces[n*3+1] ?? 0, r.forces[n*3+2] ?? 0);
      if (mag === 0) continue;
      expect(mesh.nodes[n*3+2], `node ${n} loaded on the far face`).toBeLessThan(0.5);
    }
    expect(loadCentroid(mesh, r.forces).fz).toBeCloseTo(-100, 9);
  });

  it("snaps an off-surface application point and reports how far", () => {
    const { mesh, faces } = build(8);
    // 3 mm above the +z face — the sort of thing a stale or hand-written
    // request carries. It must still load the face below, not nothing.
    const r = assembleContactPatchLoad(mesh, faces, [0, 0, 1], [0, 0, 100], [5, 5, L + 3]);
    expect(r.loadedTriangles).toBeGreaterThan(0);
    expect(r.centreSnapMm).toBeGreaterThan(2.9);
    const c = loadCentroid(mesh, r.forces);
    expect(c.fz).toBeCloseTo(100, 9);
    expect(c.z).toBeCloseTo(L, 6);          // landed on the top face
    expect(c.x).toBeCloseTo(5, 0);          // under the requested point
  });

  it("never returns a silent zero-load solve for a radius below the mesh size", () => {
    // The failure mode issue #157 was about: a finite load that selects nothing
    // and proceeds as an unloaded model presented as a normal result.
    const { mesh, faces } = build(4);       // 2.5 mm elements
    const r = assembleContactPatchLoad(mesh, faces, [0, 0, 1], [0, 0, 100], [5, 5, L], 0.01);
    expect(r.loadedTriangles).toBeGreaterThan(0);
    expect(loadCentroid(mesh, r.forces).fz).toBeCloseTo(100, 9);
  });

  it("returns an empty load rather than NaN for degenerate input", () => {
    const { mesh, faces } = build(4);
    const noDir = assembleContactPatchLoad(mesh, faces, [0, 0, 0], [0, 0, 100], [5, 5, L]);
    expect(noDir.loadedTriangles).toBe(0);
    expect(Array.from(noDir.forces).every(v => v === 0)).toBe(true);

    const nanCentre = assembleContactPatchLoad(mesh, faces, [0, 0, 1], [0, 0, 100], [NaN, 5, L]);
    expect(nanCentre.loadedTriangles).toBe(0);
    expect(Array.from(nanCentre.forces).every(v => v === 0)).toBe(true);
  });
});

describe("assembleContactPatchLoad — the patch itself", () => {
  it("is graded from the application point outward", () => {
    const { mesh, faces } = build(12);
    const centre: [number, number, number] = [5, 5, L];
    const r = assembleContactPatchLoad(mesh, faces, [0, 0, 1], [0, 0, 100], centre);

    let inner = 0, outer = 0;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const mag = Math.hypot(r.forces[n*3] ?? 0, r.forces[n*3+1] ?? 0, r.forces[n*3+2] ?? 0);
      if (mag === 0) continue;
      const d = Math.hypot((mesh.nodes[n*3] ?? 0) - centre[0], (mesh.nodes[n*3+1] ?? 0) - centre[1]);
      if (d <= r.radiusMm / 2) inner += mag; else outer += mag;
    }
    expect(inner).toBeGreaterThan(outer);
  });

  it("tapers to zero — nothing is loaded beyond the radius", () => {
    const { mesh, faces } = build(12);
    const centre: [number, number, number] = [5, 5, L];
    const r = assembleContactPatchLoad(mesh, faces, [0, 0, 1], [0, 0, 100], centre, 3);
    const elem = L / 12;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const mag = Math.hypot(r.forces[n*3] ?? 0, r.forces[n*3+1] ?? 0, r.forces[n*3+2] ?? 0);
      if (mag === 0) continue;
      const d = Math.hypot((mesh.nodes[n*3] ?? 0) - centre[0], (mesh.nodes[n*3+1] ?? 0) - centre[1]);
      // Weights are per triangle from its centroid, so a node can sit about one
      // element beyond the cut — bound the overhang, not zero it.
      expect(d).toBeLessThanOrEqual(3 + elem * 1.51);
    }
  });

  it("is scale-invariant — a 10x part gets a 10x patch", () => {
    const base = build(8);
    const big = build(8, 10);
    const rBase = assembleContactPatchLoad(base.mesh, base.faces, [0, 0, 1], [0, 0, 100], [5, 5, L]);
    const rBig  = assembleContactPatchLoad(big.mesh, big.faces, [0, 0, 1], [0, 0, 100], [50, 50, L*10]);
    expect(rBig.radiusMm).toBeCloseTo(rBase.radiusMm * 10, 9);
    expect(rBig.loadedTriangles).toBe(rBase.loadedTriangles);
    expect(rBase.radiusMm).toBeCloseTo(
      Math.sqrt(3) * L * CONTACT_PATCH_RADIUS_FRACTION, 9);
  });

  it("keeps the patch radius fixed as the mesh refines", () => {
    const radii = [4, 8, 12].map(n => {
      const { mesh, faces } = build(n);
      return assembleContactPatchLoad(mesh, faces, [0, 0, 1], [0, 0, 100], [5, 5, L]).radiusMm;
    });
    for (const r of radii) expect(r).toBeCloseTo(radii[0]!, 9);
  });
});
