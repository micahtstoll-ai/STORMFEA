/**
 * stress_detail.ts
 * ----------------
 * Returns full 6-component Voigt stress per element for testing.
 * Not part of the production API — used only by the patch test to verify
 * individual stress components, not just von Mises.
 */

import type { TetMesh, IsotropicMaterial } from "./types.js";
import { buildConstitutiveMatrix, computeGeometry, buildB } from "./element.js";

function f64(arr: Float64Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`f64: index ${i} out of bounds`);
  return v;
}
function i32(arr: Int32Array, i: number): number {
  const v = arr[i];
  if (v === undefined) throw new RangeError(`i32: index ${i} out of bounds`);
  return v;
}

/**
 * Returns a Float64Array of length elementCount × 6.
 * Layout per element: [σxx, σyy, σzz, τxy, τyz, τxz]
 */
export function recoverElementStressComponents(
  mesh:         TetMesh,
  displacement: Float64Array,
  mat:          IsotropicMaterial,
): Float64Array {
  const C = buildConstitutiveMatrix(mat);
  const out = new Float64Array(mesh.elementCount * 6);

  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * 4;
    const n0 = i32(mesh.elements, base);
    const n1 = i32(mesh.elements, base + 1);
    const n2 = i32(mesh.elements, base + 2);
    const n3 = i32(mesh.elements, base + 3);

    const geom = computeGeometry(mesh.nodes, n0, n1, n2, n3);
    const B    = buildB(geom);

    const ue = new Float64Array(12);
    const elemNodes = [n0, n1, n2, n3] as const;
    for (let ni = 0; ni < 4; ni++) {
      const idx = elemNodes[ni] ?? 0;
      ue[ni*3]   = f64(displacement, idx*3);
      ue[ni*3+1] = f64(displacement, idx*3+1);
      ue[ni*3+2] = f64(displacement, idx*3+2);
    }

    const eps = new Float64Array(6);
    for (let r = 0; r < 6; r++) {
      let s = 0;
      for (let c = 0; c < 12; c++) s += (B[r*12+c] ?? 0) * (ue[c] ?? 0);
      eps[r] = s;
    }

    for (let r = 0; r < 6; r++) {
      let s = 0;
      for (let c = 0; c < 6; c++) s += (C[r*6+c] ?? 0) * (eps[c] ?? 0);
      out[e*6+r] = s;
    }
  }

  return out;
}
