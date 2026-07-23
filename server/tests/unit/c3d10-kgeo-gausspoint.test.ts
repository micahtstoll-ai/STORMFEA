/**
 * c3d10-kgeo-gausspoint.test.ts
 * -----------------------------
 * Issue #164: C3D10 geometric stiffness must integrate the LINEAR element stress
 * at each Gauss point, not one element-constant value. A single averaged stress
 * washes the ± bending stress of a bending member toward zero, under-building Kσ
 * and biasing the buckling load factor non-conservative (part passes when it
 * would buckle).
 *
 * These tests lock:
 *   1. Bit-identical regression: a uniform stress state (same σ at every Gauss
 *      point) must reproduce the legacy element-constant Kσ exactly.
 *   2. The bending wash-out the fix targets: a pure-bending (zero element-mean)
 *      stress field produces a ~zero Kσ through the old averaged path but a
 *      non-zero Kσ through the per-Gauss-point path.
 *   3. Assembly-level consistency: for a uniform-strain displacement field the
 *      per-Gauss-point plumbing reproduces the element-constant Kσ.
 */

import { describe, it, expect } from "vitest";
import {
  c3d10ElementGeometricStiffness,
  buildB_c3d10,
  c3d10ShapeFunctions,
  buildAnyConstitutiveMatrix,
  C3D10_GAUSS,
} from "../../solver/element.js";
import { assembleKsigma, buildSparsityPattern } from "../../solver/assembly.js";
import type { TetMesh, IsotropicMaterial } from "../../solver/types.js";

// Single straight-sided C3D10 tet (same geometry as buckling-sign.test / group 6).
const NODE_COORDS = new Float64Array([
  2,0,0,  0,2,0,  0,0,2,  0,0,0,
  1,1,0,  0,1,1,  1,0,1,  1,0,0,  0,1,0,  0,0,1,
]);

const mesh10: TetMesh = {
  nodes:        NODE_COORDS,
  elements:     new Int32Array([0,1,2,3,4,5,6,7,8,9]),
  nodeCount:    10,
  elementCount: 1,
  nodesPerElem: 10,
};

const mat: IsotropicMaterial = { E: 3500, nu: 0.36, yieldStrength: 50, label: "pla" };

describe("c3d10ElementGeometricStiffness — per-Gauss-point stress (issue #164)", () => {
  it("uniform stress: length-24 (4× identical) reproduces length-6 bit-for-bit", () => {
    const sig6 = new Float64Array([12, -3, 5, 2, -1, 4]);
    const sig24 = new Float64Array(24);
    for (let g = 0; g < 4; g++) sig24.set(sig6, g * 6);

    const kLegacy = c3d10ElementGeometricStiffness(NODE_COORDS, sig6);
    const kPerGP  = c3d10ElementGeometricStiffness(NODE_COORDS, sig24);

    expect(kPerGP.length).toBe(kLegacy.length);
    for (let i = 0; i < kLegacy.length; i++) {
      // Bit-identical, not merely close: the arithmetic is the same at every GP.
      expect(kPerGP[i]).toBe(kLegacy[i]);
    }
  });

  it("pure bending (zero element-mean σxx) washes out when averaged but not per-GP", () => {
    // Build a genuine linear σxx field σxx = k·(x − x̄) sampled at the 4 Gauss
    // points, x̄ = mean of the Gauss-point x's, so the element average is ~0.
    const k = 10; // MPa/mm gradient
    const gpX: number[] = [];
    for (const gp of C3D10_GAUSS) {
      const N = c3d10ShapeFunctions(gp.xi, gp.eta, gp.zeta);
      let x = 0;
      for (let i = 0; i < 10; i++) x += (N[i] ?? 0) * (NODE_COORDS[i*3] ?? 0);
      gpX.push(x);
    }
    const xBar = gpX.reduce((a, b) => a + b, 0) / gpX.length;

    const sig24 = new Float64Array(24);
    let sigAvgXX = 0;
    for (let g = 0; g < 4; g++) {
      const sxx = k * (gpX[g]! - xBar);
      sig24[g*6] = sxx;
      sigAvgXX += sxx / 4; // element-averaged σxx (old path input)
    }
    const sigAvg6 = new Float64Array([sigAvgXX, 0, 0, 0, 0, 0]);

    // Sanity: the averaged σxx really is ~0 (the wash-out).
    expect(Math.abs(sigAvgXX)).toBeLessThan(1e-9);

    const kAveraged = c3d10ElementGeometricStiffness(NODE_COORDS, sigAvg6);
    const kPerGP    = c3d10ElementGeometricStiffness(NODE_COORDS, sig24);

    // Old path: essentially zero Kσ → BLF → ∞ (non-conservative).
    let maxAvg = 0, maxGP = 0;
    for (let i = 0; i < kPerGP.length; i++) {
      maxAvg = Math.max(maxAvg, Math.abs(kAveraged[i] ?? 0));
      maxGP  = Math.max(maxGP,  Math.abs(kPerGP[i]  ?? 0));
    }
    expect(maxAvg).toBeLessThan(1e-9);       // averaged bending stress → ~0 Kσ
    expect(maxGP).toBeGreaterThan(1e-3);     // per-GP retains the bending energy
  });

  it("symmetric Kσ for a per-Gauss-point stress state", () => {
    const sig24 = new Float64Array(24);
    for (let g = 0; g < 4; g++) sig24.set([5 + g, -2, 3, 1, 0.5, -1], g * 6);
    const K = c3d10ElementGeometricStiffness(NODE_COORDS, sig24);
    let maxAsym = 0, scale = 0;
    for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) {
      maxAsym = Math.max(maxAsym, Math.abs((K[i*30+j] ?? 0) - (K[j*30+i] ?? 0)));
      scale = Math.max(scale, Math.abs(K[i*30+j] ?? 0));
    }
    expect(maxAsym).toBeLessThan(1e-12 * (scale + 1));
  });
});

describe("assembleKsigma — per-Gauss-point plumbing (issue #164)", () => {
  it("uniform-strain displacement: per-GP path matches the element-constant path", () => {
    const { rowPtr, colIdx } = buildSparsityPattern(mesh10);

    // Linear displacement u_x = a·x → constant strain ε = [a,0,0,0,0,0] → uniform
    // stress. The per-Gauss recovery must then reproduce the constant-stress Kσ.
    const a = 0.01;
    const disp = new Float64Array(mesh10.nodeCount * 3);
    for (let nd = 0; nd < mesh10.nodeCount; nd++) {
      disp[nd*3] = a * (NODE_COORDS[nd*3] ?? 0);
    }

    const C = buildAnyConstitutiveMatrix(mat);
    const sigConst = new Float64Array(6);
    for (let r = 0; r < 6; r++) sigConst[r] = (C[r*6] ?? 0) * a; // C·[a,0,0,0,0,0]

    const kLegacy = assembleKsigma(mesh10, sigConst, rowPtr, colIdx);
    const kPerGP  = assembleKsigma(mesh10, sigConst, rowPtr, colIdx, { displacement: disp, material: mat });

    let maxDiff = 0, scale = 0;
    for (let i = 0; i < kLegacy.data.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs((kPerGP.data[i] ?? 0) - (kLegacy.data[i] ?? 0)));
      scale   = Math.max(scale, Math.abs(kLegacy.data[i] ?? 0));
    }
    // Uniform strain ⇒ per-GP σ == constant σ up to float rounding of B·u.
    expect(maxDiff).toBeLessThan(1e-9 * (scale + 1));
  });

  it("non-uniform displacement: per-GP path differs from the averaged-stress path", () => {
    const { rowPtr, colIdx } = buildSparsityPattern(mesh10);

    // Bending-type displacement u_x = c·x·z produces a σxx that varies across the
    // element (a real stress gradient). The averaged-stress Kσ then differs from
    // the per-Gauss-point Kσ — the whole point of the fix.
    const c = 0.02;
    const disp = new Float64Array(mesh10.nodeCount * 3);
    for (let nd = 0; nd < mesh10.nodeCount; nd++) {
      const x = NODE_COORDS[nd*3] ?? 0, z = NODE_COORDS[nd*3+2] ?? 0;
      disp[nd*3] = c * x * z;
    }

    // Element-averaged stress from the same displacement (old assembleKsigma
    // input): σ = C·ε averaged over the 4 Gauss points.
    const C = buildAnyConstitutiveMatrix(mat);
    const sigAvg = new Float64Array(6);
    const nGP = C3D10_GAUSS.length;
    for (const gp of C3D10_GAUSS) {
      const { B } = buildB_c3d10(NODE_COORDS, gp.xi, gp.eta, gp.zeta);
      const eps = new Float64Array(6);
      for (let r = 0; r < 6; r++) {
        let e = 0;
        for (let cc = 0; cc < 30; cc++) {
          const nd = (cc / 3) | 0, comp = cc % 3;
          e += (B[r*30+cc] ?? 0) * (disp[nd*3+comp] ?? 0);
        }
        eps[r] = e;
      }
      for (let r = 0; r < 6; r++) {
        let s = 0;
        for (let cc = 0; cc < 6; cc++) s += (C[r*6+cc] ?? 0) * (eps[cc] ?? 0);
        sigAvg[r] = (sigAvg[r] ?? 0) + s / nGP;
      }
    }

    const kAveraged = assembleKsigma(mesh10, sigAvg, rowPtr, colIdx);
    const kPerGP    = assembleKsigma(mesh10, sigAvg, rowPtr, colIdx, { displacement: disp, material: mat });

    let maxDiff = 0, scale = 0;
    for (let i = 0; i < kAveraged.data.length; i++) {
      maxDiff = Math.max(maxDiff, Math.abs((kPerGP.data[i] ?? 0) - (kAveraged.data[i] ?? 0)));
      scale   = Math.max(scale, Math.abs(kPerGP.data[i] ?? 0));
    }
    expect(maxDiff).toBeGreaterThan(1e-6 * (scale + 1)); // materially different
  });
});
