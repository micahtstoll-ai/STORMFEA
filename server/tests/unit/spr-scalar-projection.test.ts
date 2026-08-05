/**
 * spr-scalar-projection.test.ts
 * -----------------------------
 * Issue #258. The DISPLAY heatmap's nodal von Mises used to be recovered
 * independently, from one CENTROID sample per element, while the ZZ estimator's
 * tensor recovery had already moved to four C3D10 Gauss points per element.
 *
 * Why that mattered: at a convex model corner a nodal patch can hold fewer
 * centroid samples than a 3-D fit has unknowns, so the recovery degrades to
 * plain averaging — and averaging over a one-sided patch is biased by
 * O(h*|grad sigma|) EVEN WHEN THE FE SOLUTION IS EXACT. Measured previously:
 * 6 of 343 corner patches rank-deficient on a structured box, 28 of 792 on a
 * TetGen cylinder; zero under Gauss sampling. Those same patches feed the
 * picture users read a safety factor off.
 *
 * The scalar is now a PROJECTION of the recovered tensor rather than a second
 * independent recovery. That choice is not cosmetic: von Mises is a nonlinear,
 * CONVEX functional of sigma, so recovering it directly sits at or above the
 * von Mises of the recovered tensor by Jensen's inequality — biasing the peak
 * upward, in exactly the direction the corner-patch artifact already pushed it.
 *
 * These tests use a MANUFACTURED field with a known exact answer, so "better"
 * is measured against truth rather than against a finer mesh.
 */

import { describe, it, expect } from "vitest";
import { generateBoxMeshC3D10, generateBoxMeshC3D4 } from "../../solver/meshgen.js";
import {
  buildGaussSamples, sprSmoothedStress, sprSmoothedStress6, vonMisesFromTensor6,
  buildSolverResult,
} from "../../solver/stress.js";
import type { TetMesh } from "../../solver/types.js";

const ISO = { E: 3500, nu: 0.36, yieldStrength: 1e9, label: "spr-scalar" };

/** Uniaxial sigma_xx field. With only sigma_xx non-zero, von Mises == |sigma_xx|. */
const lin = (x: number, y: number, z: number): number => 5 + 0.3 * x + 0.2 * y + 0.1 * z;

/** Corner nodes of the box — the patches that were rank-deficient. */
function boxCornerNodes(mesh: TetMesh, L: number): number[] {
  const out: number[] = [];
  const at = (v: number, t: number) => Math.abs(v - t) < 1e-9;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const x = mesh.nodes[n*3] ?? 0, y = mesh.nodes[n*3+1] ?? 0, z = mesh.nodes[n*3+2] ?? 0;
    if ((at(x,0)||at(x,L)) && (at(y,0)||at(y,L)) && (at(z,0)||at(z,L))) out.push(n);
  }
  return out;
}

describe("nodal von Mises is a projection of the recovered tensor (issue #258)", () => {
  const L = 10;
  const mesh = generateBoxMeshC3D10(0, 0, 0, L, L, L, 3, 3, 3);
  const nGP = 4;

  /** Plant the linear field at the Gauss points and at element centroids. */
  function plant() {
    const samples = buildGaussSamples(mesh, new Float64Array(mesh.nodeCount * 3), ISO)!;
    const sigma = new Float64Array(mesh.elementCount * nGP * 6);
    for (let s = 0; s < mesh.elementCount * nGP; s++) {
      sigma[s*6] = lin(samples.xyz[s*3] ?? 0, samples.xyz[s*3+1] ?? 0, samples.xyz[s*3+2] ?? 0);
    }
    const planted = { ...samples, stress6: sigma };

    // Element-wise data the LEGACY scalar path would have been given: for a
    // linear field the element average equals the value at the centroid, so
    // this input is itself exact — any error below is the recovery's, not the
    // input's.
    const elemStress6 = new Float64Array(mesh.elementCount * 6);
    const elemVonMises = new Float64Array(mesh.elementCount);
    for (let e = 0; e < mesh.elementCount; e++) {
      let sxx = 0;
      for (let g = 0; g < nGP; g++) sxx += sigma[(e*nGP+g)*6] ?? 0;
      sxx /= nGP;
      elemStress6[e*6] = sxx;
      elemVonMises[e]  = Math.abs(sxx);
    }
    return { planted, elemStress6, elemVonMises };
  }

  it("the tensor projection is EXACT at every node, corners included", () => {
    const { planted, elemStress6 } = plant();
    const nodal6 = sprSmoothedStress6(mesh, elemStress6, planted);

    let maxErr = 0;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const vm = vonMisesFromTensor6(
        nodal6[n*6] ?? 0, nodal6[n*6+1] ?? 0, nodal6[n*6+2] ?? 0,
        nodal6[n*6+3] ?? 0, nodal6[n*6+4] ?? 0, nodal6[n*6+5] ?? 0);
      const exact = Math.abs(lin(mesh.nodes[n*3] ?? 0, mesh.nodes[n*3+1] ?? 0, mesh.nodes[n*3+2] ?? 0));
      maxErr = Math.max(maxErr, Math.abs(vm - exact));
    }
    expect(maxErr).toBeLessThan(1e-8);
  });

  it("the LEGACY scalar recovery is NOT exact — this is the improvement", () => {
    // The before/after #258 asks for, stated as a measurement rather than a
    // screenshot: same manufactured field, same mesh, same exact answer.
    const { elemVonMises } = plant();
    const legacy = sprSmoothedStress(mesh, elemVonMises);

    let maxErr = 0;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const exact = Math.abs(lin(mesh.nodes[n*3] ?? 0, mesh.nodes[n*3+1] ?? 0, mesh.nodes[n*3+2] ?? 0));
      maxErr = Math.max(maxErr, Math.abs((legacy[n] ?? 0) - exact));
    }
    // Not asserting a specific magnitude — TetGen/mesh details would make that
    // brittle — only that the legacy path demonstrably fails to reproduce a
    // field the new path reproduces to round-off.
    expect(maxErr).toBeGreaterThan(1e-6);
  });

  it("the legacy error is WORST at corners but present everywhere", () => {
    // Measured by boundary class on this mesh, worst relative error:
    //
    //   interior 8.33 %   face 9.09 %   edge 9.68 %   CORNER 20.00 %
    //
    // Worth stating precisely, because "rank-deficient corner patches" invites
    // the reading that corners are the ONLY affected place. They are not. The
    // corner patches are the extreme case of a bias that the centroid recovery
    // carries wherever the incident element centroids sit off-centre from the
    // node — which is everywhere in a tet mesh, just least badly in the middle.
    //
    // Note there was no exactness test for the SCALAR path before this file:
    // solver_validation group 20 ("SPR linear-field exactness") exercises
    // sprSmoothedStress6, the tensor path. That is how an 8% interior bias in
    // the displayed field went unnoticed while the tensor path was proven exact.
    const { elemVonMises } = plant();
    const legacy = sprSmoothedStress(mesh, elemVonMises);
    const corners = new Set(boxCornerNodes(mesh, L));
    expect(corners.size).toBe(8);

    let worstCorner = 0, worstOther = 0;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const exact = Math.abs(lin(mesh.nodes[n*3] ?? 0, mesh.nodes[n*3+1] ?? 0, mesh.nodes[n*3+2] ?? 0));
      const rel = Math.abs((legacy[n] ?? 0) - exact) / exact;
      if (corners.has(n)) worstCorner = Math.max(worstCorner, rel);
      else                worstOther  = Math.max(worstOther, rel);
    }
    // Corners are the extreme...
    expect(worstCorner).toBeGreaterThan(worstOther);
    // ...but the rest of the mesh is not clean either, which is the part that
    // matters for the heatmap as a whole rather than at eight points.
    expect(worstOther).toBeGreaterThan(0.02);
  });

  it("projection and direct recovery genuinely differ (they are not the same operation)", () => {
    // Guards the decision itself. If these ever coincide, the argument for
    // choosing one over the other has quietly stopped applying — von Mises
    // being nonlinear is the whole reason the choice exists.
    const { planted, elemStress6, elemVonMises } = plant();
    const nodal6 = sprSmoothedStress6(mesh, elemStress6, planted);
    const legacy = sprSmoothedStress(mesh, elemVonMises);

    let maxDiff = 0;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const vm = vonMisesFromTensor6(
        nodal6[n*6] ?? 0, nodal6[n*6+1] ?? 0, nodal6[n*6+2] ?? 0,
        nodal6[n*6+3] ?? 0, nodal6[n*6+4] ?? 0, nodal6[n*6+5] ?? 0);
      maxDiff = Math.max(maxDiff, Math.abs(vm - (legacy[n] ?? 0)));
    }
    expect(maxDiff).toBeGreaterThan(1e-6);
  });

  it("the solver hands back the recovered field it judged, bit-identically", () => {
    // The display path reads sigma* off the SolverResult instead of recovering
    // it a second time, because the ZZ estimator has already recovered exactly
    // this field from the same mesh, displacement and material. Bit-identity is
    // the whole justification for the reuse, so it is asserted rather than
    // assumed: any divergence means the two callers are no longer asking the
    // same question, and the heatmap would silently stop being the field the
    // reported error was measured against.
    //
    // Mutation-checked: dropping the Gauss samples from the comparison
    // recovery (so it fits centroids instead) fails this test.
    //
    // Not a micro-optimisation either — the duplicated recovery measured 755 ms
    // on a 24.6k-element C3D10 mesh (425 ms of Gauss sampling plus 330 ms of
    // patch solves), as much again as the entire ZZ stage it repeats.
    const u = new Float64Array(mesh.nodeCount * 3);
    for (let n = 0; n < mesh.nodeCount; n++) {
      const x = mesh.nodes[n*3] ?? 0, y = mesh.nodes[n*3+1] ?? 0, z = mesh.nodes[n*3+2] ?? 0;
      u[n*3]   = 1e-3 * (0.01*x*x + 0.005*y*z);
      u[n*3+1] = 1e-3 * (0.01*y*y - 0.004*x*z);
      u[n*3+2] = 1e-3 * (0.008*z*z + 0.003*x*y);
    }

    const solved = buildSolverResult(mesh, u, ISO, 0, true, 0);
    expect(solved.nodeStress6).toBeDefined();
    expect(solved.elemStress6).toBeDefined();

    const again = sprSmoothedStress6(
      mesh, solved.elemStress6!, buildGaussSamples(mesh, u, ISO));

    expect(solved.nodeStress6!.length).toBe(mesh.nodeCount * 6);
    for (let i = 0; i < again.length; i++) {
      expect(solved.nodeStress6![i]).toBe(again[i]);   // toBe: exact, not closeTo
    }
  });

  it("no error estimate means no recovered field — the fallback stays live", () => {
    // buildSolverResult only recovers sigma* as part of the ZZ estimate, so
    // switching the estimate off must leave the field absent rather than
    // silently stale. The display path's `??` branch exists for exactly this
    // case; if this ever returns a field, that branch has become dead code.
    const u = new Float64Array(mesh.nodeCount * 3);
    const solved = buildSolverResult(mesh, u, ISO, 0, true, 0, undefined, false);
    expect(solved.nodeStress6).toBeUndefined();
  });

  it("von Mises of a pure uniaxial tensor is its magnitude (the premise above)", () => {
    expect(vonMisesFromTensor6(7, 0, 0, 0, 0, 0)).toBeCloseTo(7, 12);
    expect(vonMisesFromTensor6(-7, 0, 0, 0, 0, 0)).toBeCloseTo(7, 12);
    // And pure shear is sqrt(3)*tau, the other standard anchor.
    expect(vonMisesFromTensor6(0, 0, 0, 5, 0, 0)).toBeCloseTo(5 * Math.sqrt(3), 12);
  });
});

/**
 * C3D4 takes the projection too, and that is a DECISION rather than a
 * consequence of `result.elemStress6` happening to always be populated.
 *
 * It needs its own lock because the reasoning that justifies it on C3D10 does
 * not carry: buildGaussSamples returns null for linear elements, so there are
 * no superconvergent samples to add and no accuracy argument to make. What
 * remains is consistency — one recovered field, the same operation on both
 * element types, and a heatmap that is the field the estimator judged.
 *
 * The bar for a change made on consistency grounds is that it costs nothing
 * measurable, so that is what these assert.
 */
describe("C3D4 also projects — deliberately, and at no measured cost", () => {
  const L = 10;
  const lin4 = (x: number, y: number, z: number): number => 5 + 0.3*x + 0.2*y + 0.1*z;

  /** Worst relative nodal error of each path against a field known exactly. */
  function worstErrors(div: number) {
    const mesh = generateBoxMeshC3D4(0, 0, 0, L, L, L, div, div, div);

    // C3D4 stress is constant per element, so planting the exact field at the
    // centroid makes the INPUT exact — any error below belongs to the recovery.
    const elemStress6  = new Float64Array(mesh.elementCount * 6);
    const elemVonMises = new Float64Array(mesh.elementCount);
    for (let e = 0; e < mesh.elementCount; e++) {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < 4; i++) {
        const n = mesh.elements[e*4 + i] ?? 0;
        cx += mesh.nodes[n*3] ?? 0; cy += mesh.nodes[n*3+1] ?? 0; cz += mesh.nodes[n*3+2] ?? 0;
      }
      const s = lin4(cx/4, cy/4, cz/4);
      elemStress6[e*6] = s;
      elemVonMises[e]  = Math.abs(s);
    }

    const legacy = sprSmoothedStress(mesh, elemVonMises);
    const nodal6 = sprSmoothedStress6(mesh, elemStress6);

    let worstLegacy = 0, worstProj = 0, maxAbsDiff = 0;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const exact = Math.abs(lin4(mesh.nodes[n*3] ?? 0, mesh.nodes[n*3+1] ?? 0, mesh.nodes[n*3+2] ?? 0));
      const proj  = vonMisesFromTensor6(
        nodal6[n*6] ?? 0, nodal6[n*6+1] ?? 0, nodal6[n*6+2] ?? 0,
        nodal6[n*6+3] ?? 0, nodal6[n*6+4] ?? 0, nodal6[n*6+5] ?? 0);
      const old = legacy[n] ?? 0;
      worstLegacy = Math.max(worstLegacy, Math.abs(old  - exact) / exact);
      worstProj   = Math.max(worstProj,   Math.abs(proj - exact) / exact);
      maxAbsDiff  = Math.max(maxAbsDiff, Math.abs(proj - old));
    }
    return { worstLegacy, worstProj, maxAbsDiff, elementCount: mesh.elementCount };
  }

  it("buildGaussSamples has nothing to offer a linear element", () => {
    // The premise. If this ever returns samples, the accuracy argument DOES
    // reach C3D4 and this whole block should be re-measured rather than trusted.
    const mesh = generateBoxMeshC3D4(0, 0, 0, L, L, L, 2, 2, 2);
    expect(buildGaussSamples(mesh, new Float64Array(mesh.nodeCount * 3), ISO)).toBeNull();
  });

  it("the projection is neither better nor worse than the legacy scalar", () => {
    // Measured at three densities: worst nodal error 20.00% / 15.00% / 10.00%,
    // IDENTICAL for both paths. They coincide at the worst node for a reason
    // rather than by luck: that node's patch is rank-deficient, so both fall
    // back to plain averaging, and for a strictly positive uniaxial field
    // |mean(sigma_xx)| == mean(|sigma_xx|).
    //
    // This is the assertion that says the C3D4 change is free. If a future
    // change to the C3D4 path makes the projection worse than the field it
    // replaced, the consistency argument alone no longer covers it.
    for (const div of [3, 4, 6]) {
      const { worstLegacy, worstProj } = worstErrors(div);
      expect(worstProj).toBeCloseTo(worstLegacy, 12);
    }
  });

  it("both paths converge as the mesh refines", () => {
    // Guards against the equality above being satisfied by two equally broken
    // fields: whatever they agree on has to shrink with h.
    const e3 = worstErrors(3).worstProj;
    const e6 = worstErrors(6).worstProj;
    expect(e6).toBeLessThan(e3);
  });

  it("C3D4 display values move only when the tensor is MULTIAXIAL", () => {
    // "C3D4 is untouched" is the tempting summary and it is wrong — but the
    // true statement is narrower than "the values moved", and the uniaxial
    // fixture above is exactly the case where they do NOT.
    //
    // On a field with only sigma_xx > 0, von Mises IS sigma_xx, and SPR is
    // linear per component, so projecting the recovered tensor reproduces the
    // recovered scalar to the last bit. Nonlinearity has nothing to bite on.
    // (worstErrors() above measures maxAbsDiff = 0 for exactly this reason,
    // which is why the equality it asserts is so clean.)
    expect(worstErrors(4).maxAbsDiff).toBe(0);

    // Make the tensor multiaxial and the two operations separate. This is the
    // case a real part is in, and it is where the C3D4 display field moved:
    // measured on a solved 384-element bracket, peak von Mises 0.4348 -> 0.4347
    // but a worst-node shift of 0.10, about 23% of the peak.
    const mesh = generateBoxMeshC3D4(0, 0, 0, L, L, L, 4, 4, 4);
    const elemStress6  = new Float64Array(mesh.elementCount * 6);
    const elemVonMises = new Float64Array(mesh.elementCount);
    for (let e = 0; e < mesh.elementCount; e++) {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < 4; i++) {
        const n = mesh.elements[e*4 + i] ?? 0;
        cx += mesh.nodes[n*3] ?? 0; cy += mesh.nodes[n*3+1] ?? 0; cz += mesh.nodes[n*3+2] ?? 0;
      }
      cx /= 4; cy /= 4; cz /= 4;
      const sxx =  5 + 0.30*cx, syy = -3 + 0.20*cy, txy = 2 + 0.15*cz;
      elemStress6[e*6] = sxx; elemStress6[e*6+1] = syy; elemStress6[e*6+3] = txy;
      elemVonMises[e]  = vonMisesFromTensor6(sxx, syy, 0, txy, 0, 0);
    }

    const legacy = sprSmoothedStress(mesh, elemVonMises);
    const nodal6 = sprSmoothedStress6(mesh, elemStress6);
    let maxAbsDiff = 0;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const proj = vonMisesFromTensor6(
        nodal6[n*6] ?? 0, nodal6[n*6+1] ?? 0, nodal6[n*6+2] ?? 0,
        nodal6[n*6+3] ?? 0, nodal6[n*6+4] ?? 0, nodal6[n*6+5] ?? 0);
      maxAbsDiff = Math.max(maxAbsDiff, Math.abs(proj - (legacy[n] ?? 0)));
    }
    expect(maxAbsDiff).toBeGreaterThan(1e-6);
  });
});
