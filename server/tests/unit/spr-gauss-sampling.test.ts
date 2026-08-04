/**
 * Gauss-point SPR sampling for C3D10 (issue #158).
 *
 * `recoverElementStress` has always evaluated sigma = C*B*u at all four C3D10
 * Gauss points — the superconvergent sampling locations for a quadratic tet —
 * and then AVERAGED them into one Voigt6 per element. SPR was fed only that
 * average, positioned at the element's corner-average centroid.
 *
 * The cost of that was not mainly the lost within-element variation. It was
 * patch RANK: with one sample per element, a nodal patch at a convex model
 * corner can hold fewer points than a 3-D fit has unknowns, so those nodes fell
 * back to plain averaging — and averaging over a one-sided patch is biased by
 * O(h*|grad sigma|) even when the FE solution is exact. On a manufactured field
 * that a C3D10 mesh reproduces to 1e-13, exactly 46 nodes (the 8 box corners
 * plus the midside nodes interpolated from them) carried a deviation that put a
 * 1.46% floor under the ZZ error estimate, with 19 elements holding 90% of the
 * spurious energy at every refinement level.
 *
 * These tests lock the sampler's own contract. The end-to-end consequences —
 * eta collapsing to round-off, and the effectivity index theta — are locked in
 * solver_validation group 33.
 */
import { describe, it, expect } from "vitest";
import { generateBoxMeshC3D10, generateBoxMesh } from "../../solver/meshgen.js";
import { buildGaussSamples, recoverElementStress, sprSmoothedStress6 } from "../../solver/stress.js";
import { C3D10_GAUSS } from "../../solver/element.js";
import type { TetMesh } from "../../solver/types.js";

const ISO = { E: 3500, nu: 0.36, yieldStrength: 1e9, label: "spr-gauss" };

/** A displacement field whose stress varies WITHIN each element. */
function quadraticDisp(mesh: TetMesh): Float64Array {
  const d = new Float64Array(mesh.nodeCount * 3);
  for (let n = 0; n < mesh.nodeCount; n++) {
    const x = mesh.nodes[n * 3] ?? 0, y = mesh.nodes[n * 3 + 1] ?? 0, z = mesh.nodes[n * 3 + 2] ?? 0;
    d[n * 3]     = 1e-4 * (x * z + y * y);
    d[n * 3 + 1] = 1e-4 * (y * z - x * x);
    d[n * 3 + 2] = 1e-4 * (x * y - z * z);
  }
  return d;
}

describe("buildGaussSamples — C3D10 Gauss-point stress sampling", () => {
  const mesh = generateBoxMeshC3D10(0, 0, 0, 10, 10, 10, 3, 3, 3);
  const disp = quadraticDisp(mesh);

  it("returns null for C3D4 meshes (constant strain — nothing to un-average)", () => {
    const c3d4 = generateBoxMesh(0, 0, 0, 10, 10, 10, 2, 2, 2);
    expect(buildGaussSamples(c3d4, new Float64Array(c3d4.nodeCount * 3), ISO)).toBeNull();
  });

  it("emits four valid samples per element, sized to the mesh", () => {
    const s = buildGaussSamples(mesh, disp, ISO)!;
    expect(s.perElem).toBe(C3D10_GAUSS.length);
    expect(s.perElem).toBe(4);
    expect(s.xyz.length).toBe(mesh.elementCount * 4 * 3);
    expect(s.stress6.length).toBe(mesh.elementCount * 4 * 6);
    expect(s.volWeight.length).toBe(mesh.elementCount * 4);
    // Every sample of a valid mesh must be usable, and every value finite.
    for (let i = 0; i < s.volWeight.length; i++) expect(s.volWeight[i]).toBeGreaterThan(0);
    for (const v of s.stress6) expect(Number.isFinite(v)).toBe(true);
    for (const v of s.xyz) expect(Number.isFinite(v)).toBe(true);
  });

  it("places each sample INSIDE its own element (the isoparametric map, not the centroid)", () => {
    const s = buildGaussSamples(mesh, disp, ISO)!;
    for (let e = 0; e < mesh.elementCount; e++) {
      // Corner-node bounding box of this element; a point of the reference tet
      // maps strictly inside it for a straight-sided element.
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let ni = 0; ni < 4; ni++) {
        const n = mesh.elements[e * 10 + ni] ?? 0;
        for (let k = 0; k < 3; k++) {
          const c = mesh.nodes[n * 3 + k] ?? 0;
          lo[k] = Math.min(lo[k]!, c); hi[k] = Math.max(hi[k]!, c);
        }
      }
      for (let g = 0; g < 4; g++) {
        const si = e * 4 + g;
        for (let k = 0; k < 3; k++) {
          expect(s.xyz[si * 3 + k]).toBeGreaterThanOrEqual(lo[k]! - 1e-9);
          expect(s.xyz[si * 3 + k]).toBeLessThanOrEqual(hi[k]! + 1e-9);
        }
      }
    }
  });

  it("the four samples of an element average EXACTLY to recoverElementStress's elemStress6", () => {
    // The invariant that lets elemStress6 stay untouched: this is the same
    // arithmetic, kept at full resolution rather than collapsed. If these ever
    // disagree, the sampler and the criterion have drifted apart.
    const s = buildGaussSamples(mesh, disp, ISO)!;
    const { elemStress6 } = recoverElementStress(mesh, disp, ISO);
    let maxAbs = 0, maxScale = 0;
    for (let e = 0; e < mesh.elementCount; e++) {
      for (let k = 0; k < 6; k++) {
        let sum = 0;
        for (let g = 0; g < 4; g++) sum += s.stress6[(e * 4 + g) * 6 + k] ?? 0;
        const avg = sum / 4;
        maxAbs = Math.max(maxAbs, Math.abs(avg - (elemStress6[e * 6 + k] ?? 0)));
        maxScale = Math.max(maxScale, Math.abs(avg));
      }
    }
    expect(maxScale).toBeGreaterThan(0);          // the field is not trivially zero
    expect(maxAbs / maxScale).toBeLessThan(1e-12);
  });

  it("actually carries within-element variation (the samples are not four copies)", () => {
    // If this ever collapses, the sampler has silently reverted to an average
    // and every downstream test would still pass on stale data.
    const s = buildGaussSamples(mesh, disp, ISO)!;
    let maxSpread = 0, maxMag = 0;
    for (let e = 0; e < mesh.elementCount; e++) {
      for (let k = 0; k < 6; k++) {
        let lo = Infinity, hi = -Infinity;
        for (let g = 0; g < 4; g++) {
          const v = s.stress6[(e * 4 + g) * 6 + k] ?? 0;
          lo = Math.min(lo, v); hi = Math.max(hi, v); maxMag = Math.max(maxMag, Math.abs(v));
        }
        maxSpread = Math.max(maxSpread, hi - lo);
      }
    }
    expect(maxSpread / maxMag).toBeGreaterThan(1e-3);
  });
});

describe("sprSmoothedStress6 — recovery from Gauss samples", () => {
  const mesh = generateBoxMeshC3D10(0, 0, 0, 10, 10, 10, 3, 3, 3);
  const disp = quadraticDisp(mesh);

  it("stays bounded by the sampled data (no rank-deficient blow-up)", () => {
    const samples = buildGaussSamples(mesh, disp, ISO)!;
    const { elemStress6 } = recoverElementStress(mesh, disp, ISO);
    const nodal = sprSmoothedStress6(mesh, elemStress6, samples);

    let dataMax = 0;
    for (const v of samples.stress6) dataMax = Math.max(dataMax, Math.abs(v));
    let nodalMax = 0;
    for (const v of nodal) { expect(Number.isFinite(v)).toBe(true); nodalMax = Math.max(nodalMax, Math.abs(v)); }
    // Recovery may legitimately overshoot the sampled peak a little at a
    // boundary (it extrapolates to the node); 3x is the same generous ceiling
    // spr-midside-recovery.test.ts uses, and the pre-fix pathology exceeded it
    // by more than an order of magnitude.
    expect(nodalMax).toBeLessThan(3 * dataMax);
  });

  it("reproduces a LINEAR stress field exactly at every node, including box corners", () => {
    // The sharp statement of what Gauss sampling bought. With centroid sampling
    // the 8 box corners had patches too small to fit and fell back to averaging,
    // which is NOT exact for a linear field; here every node must be exact.
    const lin = (x: number, y: number, z: number) => 5 + 0.3 * x + 0.2 * y + 0.1 * z;
    const nGP = 4;
    const samples = buildGaussSamples(mesh, new Float64Array(mesh.nodeCount * 3), ISO)!;
    const sigma = new Float64Array(mesh.elementCount * nGP * 6);
    for (let s = 0; s < mesh.elementCount * nGP; s++) {
      sigma[s * 6] = lin(samples.xyz[s * 3] ?? 0, samples.xyz[s * 3 + 1] ?? 0, samples.xyz[s * 3 + 2] ?? 0);
    }
    const planted = { ...samples, stress6: sigma };
    const nodal = sprSmoothedStress6(mesh, new Float64Array(mesh.elementCount * 6), planted);

    let maxErr = 0;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const exact = lin(mesh.nodes[n * 3] ?? 0, mesh.nodes[n * 3 + 1] ?? 0, mesh.nodes[n * 3 + 2] ?? 0);
      maxErr = Math.max(maxErr, Math.abs((nodal[n * 6] ?? 0) - exact));
    }
    expect(maxErr).toBeLessThan(1e-8);
  });

  it("reproduces a QUADRATIC stress field exactly at interior nodes (the 10-term basis)", () => {
    // A linear recovery basis CANNOT do this at any node, however the samples
    // are placed — this is what raising the basis to the element's own order
    // buys, and it is the part of the change a linear-field test cannot see.
    const quad = (x: number, y: number, z: number) =>
      5 + 0.3 * x + 0.2 * y + 0.1 * z + 0.05 * x * x - 0.03 * y * y + 0.02 * x * z;
    const nGP = 4;
    const samples = buildGaussSamples(mesh, new Float64Array(mesh.nodeCount * 3), ISO)!;
    const sigma = new Float64Array(mesh.elementCount * nGP * 6);
    for (let s = 0; s < mesh.elementCount * nGP; s++) {
      sigma[s * 6] = quad(samples.xyz[s * 3] ?? 0, samples.xyz[s * 3 + 1] ?? 0, samples.xyz[s * 3 + 2] ?? 0);
    }
    const planted = { ...samples, stress6: sigma };
    const nodal = sprSmoothedStress6(mesh, new Float64Array(mesh.elementCount * 6), planted);

    // Interior CORNER nodes only: midside nodes are interpolated from their two
    // corners by design, which is exact for a linear field but not a quadratic
    // one, and boundary patches are one-sided so some demote to the linear fit.
    const isMid = new Uint8Array(mesh.nodeCount);
    for (let e = 0; e < mesh.elementCount; e++)
      for (let k = 4; k < 10; k++) isMid[mesh.elements[e * 10 + k] ?? 0] = 1;

    let maxErr = 0, checked = 0;
    const eps = 1e-6;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const x = mesh.nodes[n * 3] ?? 0, y = mesh.nodes[n * 3 + 1] ?? 0, z = mesh.nodes[n * 3 + 2] ?? 0;
      if (isMid[n]) continue;
      if (x < eps || x > 10 - eps || y < eps || y > 10 - eps || z < eps || z > 10 - eps) continue;
      maxErr = Math.max(maxErr, Math.abs((nodal[n * 6] ?? 0) - quad(x, y, z)));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
    expect(maxErr).toBeLessThan(1e-8);
  });

  it("omitting samples keeps the legacy centroid recovery (backward compatible)", () => {
    const { elemStress6 } = recoverElementStress(mesh, disp, ISO);
    const a = sprSmoothedStress6(mesh, elemStress6);
    const b = sprSmoothedStress6(mesh, elemStress6, null);
    expect(Array.from(a)).toEqual(Array.from(b));
    // And it must differ from the Gauss-sampled recovery — otherwise these
    // tests would be validating a no-op.
    const g = sprSmoothedStress6(mesh, elemStress6, buildGaussSamples(mesh, disp, ISO));
    let maxD = 0;
    for (let i = 0; i < a.length; i++) maxD = Math.max(maxD, Math.abs((a[i] ?? 0) - (g[i] ?? 0)));
    expect(maxD).toBeGreaterThan(0);
  });
});
