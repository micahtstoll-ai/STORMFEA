/**
 * layer-interface-profile.test.ts
 * -------------------------------
 * Locks for computeLayerInterfaceProfile — the build-height delamination-risk
 * decomposition (feature #1). This is a REPORTING view of physics the headline
 * criterion already computes, so the tests pin: (a) elements bin into the right
 * printed layer along the build axis, (b) the per-layer SF is 1/peak-combined
 * interface utilization and the worst layer is flagged as governing, (c) it
 * returns null when no interlayer interface exists (isotropic), and (d) the bin
 * count is capped so a thin-layer / tall-part combo can't bloat the payload.
 */

import { describe, it, expect } from "vitest";
import { computeLayerInterfaceProfile } from "../../analysis.js";
import { fdmInterfaceUtilization } from "../../solver/stress.js";
import type { OrthotropicMaterial, TetMesh } from "../../solver/types.js";

const Y = 50;
const Z = 29;                 // through-layer tensile allowable
const ZS = Z / Math.sqrt(3);  // default interlaminar shear allowable

const MAT: OrthotropicMaterial = {
  kind: "orthotropic",
  E_xy: 3500, E_z: 2275, nu_xy: 0.36, nu_xz: 0.30, G_xz: 515,
  yieldXY: Y, yieldZ: Z, label: "layer-profile-test",
};

const ISO = { E: 3500, nu: 0.36, yieldStrength: Y, label: "iso" } as const;

/**
 * Build a mesh of `n` single tets stacked along +Z, one per printed layer of
 * height `lh`. Element e sits at centroid z ≈ e·lh, so with bin height lh it
 * lands in bin e. Each element gets 4 unique nodes.
 */
function stackedMesh(n: number, lh: number): TetMesh {
  const nodes = new Float64Array(n * 4 * 3);
  const elements = new Int32Array(n * 4);
  for (let e = 0; e < n; e++) {
    const z = e * lh;
    const base = e * 4;
    // n0..n3 — a non-degenerate tet with all four corners ~at height z.
    const coords = [
      [0, 0, z],
      [1, 0, z],
      [0, 1, z],
      [0, 0, z + 1e-3],
    ];
    for (let k = 0; k < 4; k++) {
      nodes[(base + k) * 3]     = coords[k]![0]!;
      nodes[(base + k) * 3 + 1] = coords[k]![1]!;
      nodes[(base + k) * 3 + 2] = coords[k]![2]!;
      elements[base + k] = base + k;
    }
  }
  return { nodes, elements, nodeCount: n * 4, elementCount: n, nodesPerElem: 4 };
}

describe("computeLayerInterfaceProfile — binning & governing layer", () => {
  it("separates elements at distinct heights and flags the worst as governing", () => {
    const n = 6, lh = 0.2;
    // Space the tets 3 layers apart so each lands in its own (non-empty) bin;
    // empty bins between them are omitted from the output.
    const mesh = stackedMesh(n, 3 * lh);
    // szz (through-layer tension) peaks at element 4 → that layer governs.
    const szzByElem = [2, 4, 6, 8, 20, 5];
    const es6 = new Float64Array(n * 6);
    for (let e = 0; e < n; e++) es6[e * 6 + 2] = szzByElem[e]!;

    const p = computeLayerInterfaceProfile(mesh, es6, MAT, lh, null);
    expect(p).not.toBeNull();
    // six distinct heights → six emitted layers, strictly increasing bin index
    expect(p!.layers.length).toBe(n);
    const idx = p!.layers.map(L => L.layer);
    for (let i = 1; i < idx.length; i++) expect(idx[i]!).toBeGreaterThan(idx[i - 1]!);
    // governing = the highest-tension (lowest-SF) layer, which is element 4's
    expect(p!.governingIndex).toBe(4);
    const gov = p!.layers[4]!;
    // SF = 1 / (σzz / S_zt) for pure tension
    expect(gov.sf).toBeCloseTo(+(1 / (20 / Z)).toFixed(3), 3);
    expect(gov.uTension).toBeCloseTo(20 / Z, 4);
    expect(p!.coarsened).toBe(false);
  });

  it("merges elements at the same height into one layer, keeping the peak", () => {
    // Two tets at z=0 (one calm, one hot) and one at z=lh.
    const lh = 0.2;
    const nodes = new Float64Array(3 * 4 * 3);
    const elements = new Int32Array(3 * 4);
    const zByElem = [0, 0, lh];
    for (let e = 0; e < 3; e++) {
      const z = zByElem[e]!, base = e * 4;
      const coords = [[0, 0, z], [1, 0, z], [0, 1, z], [0, 0, z + 1e-3]];
      for (let k = 0; k < 4; k++) {
        nodes[(base + k) * 3] = coords[k]![0]!;
        nodes[(base + k) * 3 + 1] = coords[k]![1]!;
        nodes[(base + k) * 3 + 2] = coords[k]![2]!;
        elements[base + k] = base + k;
      }
    }
    const mesh: TetMesh = { nodes, elements, nodeCount: 12, elementCount: 3, nodesPerElem: 4 };
    const es6 = new Float64Array(3 * 6);
    es6[0 * 6 + 2] = 4;    // calm element in layer 0
    es6[1 * 6 + 2] = 18;   // hot element, SAME layer 0
    es6[2 * 6 + 2] = 6;    // layer 1
    const p = computeLayerInterfaceProfile(mesh, es6, MAT, lh, null)!;
    expect(p.layers.length).toBe(2);
    // layer 0 reports the hotter of its two elements
    expect(p.layers[0]!.uTension).toBeCloseTo(18 / Z, 4);
    expect(p.governingIndex).toBe(0);
  });

  it("per-layer SF matches fdmInterfaceUtilization on a shear-governed state", () => {
    const mesh = stackedMesh(1, 0.2);
    const es6 = new Float64Array(6);
    es6[4] = 7;  // tyz — pure interlayer shear
    const p = computeLayerInterfaceProfile(mesh, es6, MAT, 0.2, null)!;
    const u = fdmInterfaceUtilization(0, 7, 0, Z, ZS);
    expect(p.layers[0]!.sf).toBeCloseTo(1 / u.combined, 3);
    expect(p.layers[0]!.uShear).toBeCloseTo(7 / ZS, 4);
    expect(p.layers[0]!.uTension).toBe(0);
  });

  it("returns null for an isotropic material (no interlayer interface)", () => {
    const mesh = stackedMesh(3, 0.2);
    const es6 = new Float64Array(3 * 6);
    expect(computeLayerInterfaceProfile(mesh, es6, ISO as any, 0.2, null)).toBeNull();
  });

  it("caps the bin count and reports coarsening for a thin-layer tall part", () => {
    // 500 stacked elements at 0.05 mm layers → 500 raw bins, above the 320 cap.
    const n = 500, lh = 0.05;
    const mesh = stackedMesh(n, lh);
    const es6 = new Float64Array(n * 6);
    for (let e = 0; e < n; e++) es6[e * 6 + 2] = 1 + e * 0.01;
    const p = computeLayerInterfaceProfile(mesh, es6, MAT, lh, null)!;
    expect(p.coarsened).toBe(true);
    expect(p.layers.length).toBeLessThanOrEqual(320);
    expect(p.binHeightMm).toBeGreaterThan(lh);
    // worst layer is still the last (highest σzz) one
    expect(p.governingIndex).toBe(p.layers.length - 1);
  });
});
