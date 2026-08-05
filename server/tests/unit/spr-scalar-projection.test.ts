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
import { generateBoxMeshC3D10 } from "../../solver/meshgen.js";
import {
  buildGaussSamples, sprSmoothedStress, sprSmoothedStress6, vonMisesFromTensor6,
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

  it("the error the legacy path carries is concentrated at the box CORNERS", () => {
    // The mechanism, not just the symptom: corner patches are the rank-deficient
    // ones, so if the diagnosis is right the worst legacy error must live there.
    const { elemVonMises } = plant();
    const legacy = sprSmoothedStress(mesh, elemVonMises);
    const corners = new Set(boxCornerNodes(mesh, L));
    expect(corners.size).toBe(8);

    let worstCorner = 0, worstInterior = 0;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const exact = Math.abs(lin(mesh.nodes[n*3] ?? 0, mesh.nodes[n*3+1] ?? 0, mesh.nodes[n*3+2] ?? 0));
      const err = Math.abs((legacy[n] ?? 0) - exact);
      if (corners.has(n)) worstCorner = Math.max(worstCorner, err);
      else                worstInterior = Math.max(worstInterior, err);
    }
    expect(worstCorner).toBeGreaterThan(worstInterior);
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

  it("von Mises of a pure uniaxial tensor is its magnitude (the premise above)", () => {
    expect(vonMisesFromTensor6(7, 0, 0, 0, 0, 0)).toBeCloseTo(7, 12);
    expect(vonMisesFromTensor6(-7, 0, 0, 0, 0, 0)).toBeCloseTo(7, 12);
    // And pure shear is sqrt(3)*tau, the other standard anchor.
    expect(vonMisesFromTensor6(0, 0, 0, 5, 0, 0)).toBeCloseTo(5 * Math.sqrt(3), 12);
  });
});
