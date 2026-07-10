/**
 * bond-rotation.test.ts
 * ---------------------
 * Validates the tensor-rotation core that replaces the upright scalar-swap
 * (issue #101): rotating a weak-along-Z orthotropic stiffness so its weak axis
 * points along an arbitrary global direction (Bond transform), and expressing a
 * global stress in the material frame.
 */

import { describe, it, expect } from "vitest";
import {
  buildOrthotropicConstitutiveMatrix,
  rotateC6,
  rotationAligningZTo,
  rotateStress6ToLocal,
} from "../../solver/element.js";
import { generateBoxMeshC3D10, getNodesOnFace } from "../../solver/meshgen.js";
import { runLinearStatic } from "../../solver/pipeline.js";
import type { OrthotropicMaterial } from "../../solver/types.js";

const BASE: OrthotropicMaterial = {
  kind: "orthotropic",
  E_xy: 3500, E_z: 2000, nu_xy: 0.36, nu_xz: 0.30, G_xz: 600,
  yieldXY: 50, yieldZ: 29, label: "t",
};

// Invert a 6×6 (flat 36) via Gauss-Jordan; returns the compliance S = C⁻¹.
function invert6(C: Float64Array): Float64Array {
  const n = 6;
  const A = new Float64Array(n * n * 2);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) A[i*(2*n)+j] = C[i*n+j]!;
    A[i*(2*n)+n+i] = 1;
  }
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col+1; r < n; r++) if (Math.abs(A[r*(2*n)+col]!) > Math.abs(A[piv*(2*n)+col]!)) piv = r;
    if (piv !== col) for (let j = 0; j < 2*n; j++) { const t = A[col*(2*n)+j]!; A[col*(2*n)+j] = A[piv*(2*n)+j]!; A[piv*(2*n)+j] = t; }
    const d = A[col*(2*n)+col]!;
    for (let j = 0; j < 2*n; j++) A[col*(2*n)+j] = A[col*(2*n)+j]! / d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = A[r*(2*n)+col]!;
      for (let j = 0; j < 2*n; j++) A[r*(2*n)+j] = A[r*(2*n)+j]! - f * A[col*(2*n)+j]!;
    }
  }
  const S = new Float64Array(n*n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) S[i*n+j] = A[i*(2*n)+n+j]!;
  return S;
}

// Young's modulus along global x/y/z from the compliance diagonal.
function youngs(C: Float64Array): [number, number, number] {
  const S = invert6(C);
  return [1/S[0]!, 1/S[7]!, 1/S[14]!];
}

describe("rotationAligningZTo", () => {
  it("returns identity for +Z", () => {
    const R = rotationAligningZTo([0,0,1]);
    expect(Array.from(R)).toEqual([1,0,0, 0,1,0, 0,0,1]);
  });
  it("maps local ẑ onto the requested axis", () => {
    for (const ax of [[1,0,0],[0,1,0],[1,1,0],[0,1,1],[-1,2,3]] as [number,number,number][]) {
      const R = rotationAligningZTo(ax);
      const n = Math.hypot(...ax);
      // R·ẑ is the third column of R.
      expect(R[2]).toBeCloseTo(ax[0]/n, 9);
      expect(R[5]).toBeCloseTo(ax[1]/n, 9);
      expect(R[8]).toBeCloseTo(ax[2]/n, 9);
    }
  });
  it("is orthonormal (RᵀR = I)", () => {
    const R = rotationAligningZTo([1,2,3]);
    for (let i=0;i<3;i++) for (let j=0;j<3;j++) {
      let d=0; for (let m=0;m<3;m++) d += R[m*3+i]!*R[m*3+j]!;
      expect(d).toBeCloseTo(i===j?1:0, 9);
    }
  });
});

describe("rotateC6 on an orthotropic stiffness", () => {
  const C0 = buildOrthotropicConstitutiveMatrix(BASE);

  it("identity rotation leaves C unchanged", () => {
    const C = rotateC6(C0, rotationAligningZTo([0,0,1]));
    for (let i=0;i<36;i++) expect(C[i]).toBeCloseTo(C0[i]!, 6);
  });

  it("unrotated: E_x = E_y = E_xy (3500), E_z = E_z (2000)", () => {
    const [ex, ey, ez] = youngs(C0);
    expect(ex).toBeCloseTo(3500, 2);
    expect(ey).toBeCloseTo(3500, 2);
    expect(ez).toBeCloseTo(2000, 2);
  });

  it("weak axis → +X moves the soft modulus onto X (E_x=2000, E_z=3500)", () => {
    const C = buildOrthotropicConstitutiveMatrix({ ...BASE, weakAxis: [1,0,0] });
    const [ex, ey, ez] = youngs(C);
    expect(ex).toBeCloseTo(2000, 1);
    expect(ey).toBeCloseTo(3500, 1);
    expect(ez).toBeCloseTo(3500, 1);
  });

  it("weak axis → +Y moves the soft modulus onto Y", () => {
    const C = buildOrthotropicConstitutiveMatrix({ ...BASE, weakAxis: [0,1,0] });
    const [ex, ey, ez] = youngs(C);
    expect(ex).toBeCloseTo(3500, 1);
    expect(ey).toBeCloseTo(2000, 1);
    expect(ez).toBeCloseTo(3500, 1);
  });

  it("weak axis = +Z is identical to the default (no rotation)", () => {
    const C = buildOrthotropicConstitutiveMatrix({ ...BASE, weakAxis: [0,0,1] });
    for (let i=0;i<36;i++) expect(C[i]).toBeCloseTo(C0[i]!, 9);
  });
});

describe("rotateStress6ToLocal", () => {
  it("identity leaves the stress unchanged", () => {
    const R = rotationAligningZTo([0,0,1]);
    const s = rotateStress6ToLocal([10, 5, -3, 2, 1, 4], R);
    expect(s).toEqual([10, 5, -3, 2, 1, 4]);
  });

  it("with weak axis +X, a global σ_xx becomes the local through-thickness σ_zz", () => {
    const R = rotationAligningZTo([1,0,0]);
    const [lxx, lyy, lzz] = rotateStress6ToLocal([7, 0, 0, 0, 0, 0], R);
    expect(lzz).toBeCloseTo(7, 9);  // load axis is now the weak (local Z) direction
    expect(lxx).toBeCloseTo(0, 9);
    expect(lyy).toBeCloseTo(0, 9);
  });
});

describe("end-to-end: weakAxis rotates the anisotropy in a real solve", () => {
  // Pull a bar along global Z. With the weak axis along Z (flat) the bar is
  // compliant (E_z); with the weak axis rotated to X (upright, Z is now the
  // strong in-plane direction) the SAME bar is stiffer — the axial-stiffness
  // ratio must track E_xy/E_z. This exercises the rotated C through assembly.
  const mesh = generateBoxMeshC3D10(0,0,0, 4,4,20, 2,2,8);
  const fixed = getNodesOnFace(mesh, "z", 0);
  const top   = getNodesOnFace(mesh, "z", 20);
  const perNode = 1000 / top.length;
  const forces = top.map(n => ({ nodeIndex: n, forceN: [0,0,perNode] as [number,number,number] }));
  const constraints = [{ nodeIndices: fixed }];

  const axialDelta = async (weakAxis: [number,number,number]) => {
    const mat: OrthotropicMaterial = { ...BASE, weakAxis };
    const res = await runLinearStatic({ mesh, material: mat, constraints, forces });
    let maxUz = 0;
    for (const n of top) maxUz = Math.max(maxUz, Math.abs(res.displacement[n*3+2]!));
    return maxUz;
  };

  it("weak-along-Z is more compliant than weak-along-X by ≈ E_xy/E_z", async () => {
    const dWeakZ = await axialDelta([0,0,1]); // Z weak  → compliant (E_z)
    const dWeakX = await axialDelta([1,0,0]); // Z strong → stiff (E_xy)
    expect(dWeakZ).toBeGreaterThan(dWeakX);
    // δ ∝ 1/E along the load axis, so the ratio trends to E_xy/E_z = 1.75; the
    // fully-fixed grip adds lateral constraint so it lands a bit under. A clear
    // anisotropy flip (well above 1) is the point.
    const ratio = dWeakZ / dWeakX;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(1.9);
  });
});
