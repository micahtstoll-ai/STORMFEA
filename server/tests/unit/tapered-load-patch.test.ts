/**
 * tapered-load-patch.test.ts — `assembleTaperedFaceLoad` (issue #260).
 *
 * The legacy force path selects every node within a HARD 0.5 mm of the extreme
 * projection and splits the load equally between them. Measured on the Ø5-bore
 * tube across a 5x element range, the governing stress peak sat on the rim of
 * that patch on every mesh and the safety factor swung 26.6% non-monotonically
 * (issue #260's de-risking sweep). A traction that jumps from full to zero
 * across one element is singular, and the peak at a singularity does not
 * converge.
 *
 * This mode replaces the jump with a raised-cosine taper integrated as a
 * consistent tributary-area traction. What has to hold:
 *
 *   1. The resultant is EXACTLY the requested force — otherwise the mode is not
 *      comparable to the legacy path and every downstream number moves for a
 *      reason that has nothing to do with the distribution.
 *   2. The patch is graded, not uniform — that is the entire point.
 *   3. The patch's physical size is MESH-INDEPENDENT. A mesh-relative patch
 *      (the shape `selectPressureRegion` uses for its band, issue #157) would
 *      shrink under refinement, changing the load idealization from one mesh to
 *      the next — which is the non-convergence this exists to remove.
 *   4. It is SCALE-INVARIANT, the property issue #168 established for mesh
 *      density and issue #271 notes the legacy 0.5 mm band lacks.
 *
 * The legacy path is reached by asking for `loadDistribution: 'uniform'`. It is
 * no longer what an ABSENT field means — since #271 that resolves to
 * `DEFAULT_LOAD_DISTRIBUTION` ('contact_patch'); see
 * `load-distribution-default.test.ts` for the lock on that.
 */
import { describe, it, expect } from "vitest";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import { assembleTaperedFaceLoad, LOAD_PATCH_DEPTH_FRACTION } from "../../solver/load.js";
import type { TetMesh } from "../../solver/types.js";

const L = 10;   // 10 mm cube

function build(n: number, scale = 1): { mesh: TetMesh; faces: Int32Array } {
  const mesh = generateBoxMeshC3D4(0, 0, 0, L * scale, L * scale, L * scale, n, n, n);
  return { mesh, faces: extractSurfaceFaces(mesh) };
}

/** Total applied force, and the per-node loads keyed by projection depth. */
function summarise(mesh: TetMesh, f: Float64Array, dir: [number, number, number]) {
  const [ux, uy, uz] = dir;
  let maxProj = -Infinity;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const p = (mesh.nodes[n*3]??0)*ux + (mesh.nodes[n*3+1]??0)*uy + (mesh.nodes[n*3+2]??0)*uz;
    if (p > maxProj) maxProj = p;
  }
  let fx = 0, fy = 0, fz = 0, loaded = 0, maxDepth = 0;
  const byDepth: Array<{ depth: number; mag: number }> = [];
  for (let n = 0; n < mesh.nodeCount; n++) {
    const nx = f[n*3] ?? 0, ny = f[n*3+1] ?? 0, nz = f[n*3+2] ?? 0;
    fx += nx; fy += ny; fz += nz;
    const mag = Math.hypot(nx, ny, nz);
    if (mag === 0) continue;
    const p = (mesh.nodes[n*3]??0)*ux + (mesh.nodes[n*3+1]??0)*uy + (mesh.nodes[n*3+2]??0)*uz;
    const depth = maxProj - p;
    byDepth.push({ depth, mag });
    if (depth > maxDepth) maxDepth = depth;
    loaded++;
  }
  return { fx, fy, fz, loaded, maxDepth, byDepth };
}

describe("assembleTaperedFaceLoad — resultant", () => {
  for (const n of [2, 4, 8]) {
    it(`reproduces the requested force exactly at ${n}x${n}x${n}`, () => {
      const { mesh, faces } = build(n);
      const { forces } = assembleTaperedFaceLoad(mesh, faces, [0, 0, 1], [0, 0, 250]);
      const s = summarise(mesh, forces, [0, 0, 1]);
      // Exact to floating point, not merely close: the assembly normalises by
      // the integrated area precisely so this holds whatever the patch caught.
      expect(s.fz).toBeCloseTo(250, 9);
      expect(s.fx).toBeCloseTo(0, 12);
      expect(s.fy).toBeCloseTo(0, 12);
    });
  }

  it("carries an oblique force without leaking magnitude between components", () => {
    const { mesh, faces } = build(6);
    const d: [number, number, number] = [0, 0.6, 0.8];
    const { forces } = assembleTaperedFaceLoad(mesh, faces, d, [0, 60, 80]);
    const s = summarise(mesh, forces, d);
    expect(s.fy).toBeCloseTo(60, 9);
    expect(s.fz).toBeCloseTo(80, 9);
    expect(Math.hypot(s.fx, s.fy, s.fz)).toBeCloseTo(100, 9);
  });

  it("returns an empty load rather than NaN for a zero-length direction", () => {
    const { mesh, faces } = build(4);
    const r = assembleTaperedFaceLoad(mesh, faces, [0, 0, 0], [0, 0, 100]);
    expect(r.loadedTriangles).toBe(0);
    expect(Array.from(r.forces).every(v => v === 0)).toBe(true);
  });
});

describe("assembleTaperedFaceLoad — the patch is graded, not uniform", () => {
  it("loads the extreme face more heavily than the patch edge", () => {
    const { mesh, faces } = build(8);
    const { forces, patchDepthMm } = assembleTaperedFaceLoad(mesh, faces, [0, 0, 1], [0, 0, 100]);
    const s = summarise(mesh, forces, [0, 0, 1]);

    // Split the patch at half depth and compare the load each half carries.
    // A uniform patch would put roughly equal traction in both; the raised
    // cosine puts the great majority in the inner half.
    const half = patchDepthMm / 2;
    const inner = s.byDepth.filter(d => d.depth <= half).reduce((a, d) => a + d.mag, 0);
    const outer = s.byDepth.filter(d => d.depth > half).reduce((a, d) => a + d.mag, 0);
    expect(inner).toBeGreaterThan(outer);
  });

  it("tapers to zero — nothing is loaded beyond the patch depth", () => {
    const { mesh, faces } = build(8);
    const { forces, patchDepthMm } = assembleTaperedFaceLoad(mesh, faces, [0, 0, 1], [0, 0, 100]);
    const s = summarise(mesh, forces, [0, 0, 1]);
    // Weights are computed per TRIANGLE from its centroid, and a triangle's
    // load lands on its nodes — so a node can sit up to about one element
    // beyond the cut. Bound the overhang by the element size, not by zero.
    const elem = (L / 8);
    expect(s.maxDepth).toBeLessThanOrEqual(patchDepthMm + elem * 1.01);
    // And it is genuinely a patch, not the whole part.
    expect(s.maxDepth).toBeLessThan(L / 2);
  });

  it("honours an explicit contact depth", () => {
    const { mesh, faces } = build(8);
    const deep = assembleTaperedFaceLoad(mesh, faces, [0, 0, 1], [0, 0, 100]);
    const shallow = assembleTaperedFaceLoad(mesh, faces, [0, 0, 1], [0, 0, 100], 0.8);
    expect(deep.patchDepthMm).toBeCloseTo(L * LOAD_PATCH_DEPTH_FRACTION, 9);
    expect(shallow.patchDepthMm).toBeCloseTo(0.8, 9);
    expect(shallow.loadedTriangles).toBeLessThan(deep.loadedTriangles);
    // A shallower contact still carries the whole load.
    expect(summarise(mesh, shallow.forces, [0, 0, 1]).fz).toBeCloseTo(100, 9);
  });
});

describe("assembleTaperedFaceLoad — invariances", () => {
  it("keeps the patch depth fixed as the mesh refines", () => {
    // The property that makes this a convergent load model: refining the mesh
    // must not change WHICH physical region is loaded. A mesh-relative band
    // would shrink here, and the peak stress would chase it forever.
    const depths = [2, 4, 8, 12].map(n => {
      const { mesh, faces } = build(n);
      return assembleTaperedFaceLoad(mesh, faces, [0, 0, 1], [0, 0, 100]).patchDepthMm;
    });
    for (const d of depths) expect(d).toBeCloseTo(L * LOAD_PATCH_DEPTH_FRACTION, 9);
  });

  it("is scale-invariant — a 10x part gets a 10x patch, not the same millimetres", () => {
    const base = build(6);
    const big = build(6, 10);
    const rBase = assembleTaperedFaceLoad(base.mesh, base.faces, [0, 0, 1], [0, 0, 100]);
    const rBig = assembleTaperedFaceLoad(big.mesh, big.faces, [0, 0, 1], [0, 0, 100]);

    expect(rBig.patchDepthMm).toBeCloseTo(rBase.patchDepthMm * 10, 9);
    // Same triangles selected on the geometrically similar mesh — the load
    // idealization is a property of the part, not of its units.
    expect(rBig.loadedTriangles).toBe(rBase.loadedTriangles);
    // And the same distribution: identical total, identical node count.
    const sBase = summarise(base.mesh, rBase.forces, [0, 0, 1]);
    const sBig = summarise(big.mesh, rBig.forces, [0, 0, 1]);
    expect(sBig.loaded).toBe(sBase.loaded);
    expect(sBig.fz).toBeCloseTo(sBase.fz, 9);
  });

  it("converges the loaded area under refinement", () => {
    // A consistent traction over a fixed physical patch has a well-defined
    // area, so the count of loaded triangles should grow with the mesh while
    // the patch's extent stays put — the signature of a convergent load.
    const runs = [4, 8, 12].map(n => {
      const { mesh, faces } = build(n);
      const r = assembleTaperedFaceLoad(mesh, faces, [0, 0, 1], [0, 0, 100]);
      return { n, tris: r.loadedTriangles, maxDepth: summarise(mesh, r.forces, [0, 0, 1]).maxDepth };
    });
    expect(runs[1]!.tris).toBeGreaterThan(runs[0]!.tris);
    expect(runs[2]!.tris).toBeGreaterThan(runs[1]!.tris);
    // The physical extent does not run away as the triangle count grows.
    for (const r of runs) expect(r.maxDepth).toBeLessThan(L * LOAD_PATCH_DEPTH_FRACTION + L / 4);
  });
});
