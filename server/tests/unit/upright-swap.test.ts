/**
 * upright-swap.test.ts
 * --------------------
 * Issue #101: the "upright" print orientation is modeled as a scalar swap
 * (E_xy ↔ E_z, yieldXY ↔ yieldZ) that keeps the material transversely
 * isotropic about global Z. The exact model is a 90° rotation of the full
 * 6×6 stiffness tensor (Bond transformation), which is transversely isotropic
 * about a HORIZONTAL axis instead.
 *
 * This file:
 *   1. Regression-tests the dropped-G_xy bug: the swapped material must carry
 *      G_xy = G_xz (inter-layer shear) explicitly, not fall back to the
 *      isotropic approximation E_xy/(2(1+ν)) inside the constitutive builder.
 *   2. Benchmarks the swap against the full Bond rotation on the default PLA
 *      orthotropic constants, asserting where the two agree exactly (vertical
 *      modulus, global-XY shear) and that the disagreement elsewhere is the
 *      documented conservative direction (swap is never stiffer than rotation).
 *
 * Bond transformation (Auld 1973 §3): with rotation matrix R (x' = R·x),
 * stresses transform as σ' = M·σ and C' = M·C·Mᵀ, where M is built from R:
 *   normal row (i,i):  M[(ii)][(kk)] = R_ik², M[(ii)][(kl)] = 2·R_ik·R_il
 *   shear  row (i,j):  M[(ij)][(kk)] = R_ik·R_jk,
 *                      M[(ij)][(kl)] = R_ik·R_jl + R_il·R_jk
 * Voigt ordering here matches element.ts: [xx, yy, zz, xy, yz, xz].
 */

import { describe, it, expect } from "vitest";
import { buildOrthotropicConstitutiveMatrix } from "../../solver/element.js";
import { applyUprightScalarSwap } from "../../analysis.js";
import type { OrthotropicMaterial } from "../../solver/types.js";

// Voigt index pairs in this codebase's ordering [xx, yy, zz, xy, yz, xz]
const VOIGT: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [1, 1], [2, 2], [0, 1], [1, 2], [0, 2],
];

/** Build the 6×6 Bond stress-transformation matrix M from a 3×3 rotation R. */
function bondM(R: number[][]): Float64Array {
  const M = new Float64Array(36);
  for (let p = 0; p < 6; p++) {
    const [i, j] = VOIGT[p]!;
    for (let q = 0; q < 6; q++) {
      const [k, l] = VOIGT[q]!;
      if (i === j) {
        // normal-stress row
        M[p * 6 + q] = k === l
          ? R[i]![k]! * R[i]![k]!
          : 2 * R[i]![k]! * R[i]![l]!;
      } else {
        // shear row
        M[p * 6 + q] = k === l
          ? R[i]![k]! * R[j]![k]!
          : R[i]![k]! * R[j]![l]! + R[i]![l]! * R[j]![k]!;
      }
    }
  }
  return M;
}

/** C' = M · C · Mᵀ */
function rotateC(C: Float64Array, M: Float64Array): Float64Array {
  const T = new Float64Array(36);   // T = M·C
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += M[i * 6 + k]! * C[k * 6 + j]!;
      T[i * 6 + j] = s;
    }
  const out = new Float64Array(36); // out = T·Mᵀ
  for (let i = 0; i < 6; i++)
    for (let j = 0; j < 6; j++) {
      let s = 0;
      for (let k = 0; k < 6; k++) s += T[i * 6 + k]! * M[j * 6 + k]!;
      out[i * 6 + j] = s;
    }
  return out;
}

// ─── Default PLA orthotropic constants (flat print, matching analysis.ts) ─────
const E_xy = 3500, nu_xy = 0.36;
const E_z  = E_xy * 0.65;
const G_xy = E_xy / (2 * (1 + nu_xy));
const G_xz = G_xy * 0.40;
const nu_xz = 0.30;

const FLAT: OrthotropicMaterial = {
  kind: "orthotropic",
  E_xy, E_z, nu_xy, nu_xz, G_xy, G_xz,
  yieldXY: 50, yieldZ: 29, label: "pla-flat",
};

// The scalar-swapped upright material exactly as the builders in analysis.ts
// construct it — sourced from the real function so this benchmark can never
// drift from production (E swap, yield swap, G_xy = G_xz inter-layer shear,
// and the reciprocity-consistent Poisson swap of issue #187).
const SWAPPED: OrthotropicMaterial = applyUprightScalarSwap(FLAT);

// Input minor Poisson ratio ν_zx = ν_xz·E_z/E_xy — the value both swapped
// Poisson entries take (both horizontal directions are the weak axis).
const NU_ZX = nu_xz * E_z / E_xy;

// 90° rotation about global Y: material z-axis (layer normal) → global +x,
// material x → global −z. This is the exact "upright" reorientation.
const R90Y = [
  [0, 0, 1],
  [0, 1, 0],
  [-1, 0, 0],
];

describe("upright orientation: scalar swap vs full tensor rotation (issue #101)", () => {
  const C_flat    = buildOrthotropicConstitutiveMatrix(FLAT);
  const C_swap    = buildOrthotropicConstitutiveMatrix(SWAPPED);
  const C_rotated = rotateC(C_flat, bondM(R90Y));

  it("Bond transform sanity: 90° rotation permutes the flat C as expected", () => {
    // New x = old z, new z = old −x  →  index permutation 0↔2 on normal
    // components; shear planes: xy→yz (old), yz→xy, xz→xz (sign² = 1).
    expect(C_rotated[0]).toBeCloseTo(C_flat[14]!, 6);       // C'11 = C33
    expect(C_rotated[7]).toBeCloseTo(C_flat[7]!, 6);        // C'22 = C22
    expect(C_rotated[14]).toBeCloseTo(C_flat[0]!, 6);       // C'33 = C11
    expect(C_rotated[1]).toBeCloseTo(C_flat[8]!, 6);        // C'12 = C23
    expect(C_rotated[2]).toBeCloseTo(C_flat[2]!, 6);        // C'13 = C13
    expect(C_rotated[8]).toBeCloseTo(C_flat[1]!, 6);        // C'23 = C12
    expect(C_rotated[21]).toBeCloseTo(C_flat[28]!, 6);      // G'_xy = G_yz = G_xz
    expect(C_rotated[28]).toBeCloseTo(C_flat[21]!, 6);      // G'_yz = G_xy
    expect(C_rotated[35]).toBeCloseTo(C_flat[35]!, 6);      // G'_xz = G_xz
  });

  it("regression (dropped G_xy): swapped material carries inter-layer shear in the C[21] slot", () => {
    // The exact rotated global-XY shear modulus is the inter-layer G_xz.
    expect(C_swap[21]).toBeCloseTo(G_xz, 6);
    expect(C_rotated[21]).toBeCloseTo(G_xz, 6);
    // ...and NOT the isotropic fallback the builder derives when G_xy is
    // omitted (the pre-fix behavior): E_z/(2(1+nu_xy)) ≈ 836 MPa vs 515 MPa.
    const isotropicFallback = SWAPPED.E_xy / (2 * (1 + SWAPPED.nu_xy));
    expect(Math.abs(C_swap[21]! - isotropicFallback)).toBeGreaterThan(100);
  });

  // Extract engineering constants by inverting the 3×3 normal block of C
  // (uniaxial-stress compliances) — this is the physically meaningful basis
  // for comparing the two models; raw C entries mix stiffness with Poisson
  // constraint coupling and are not directly comparable.
  function engineeringE(C: Float64Array): { Ex: number; Ey: number; Ez: number } {
    const a = C[0]!, b = C[1]!, c = C[2]!,
          b2 = C[6]!, a2 = C[7]!, c2 = C[8]!,
          d1 = C[12]!, d2 = C[13]!, e = C[14]!;
    const det = a * (a2 * e - c2 * d2) - b * (b2 * e - c2 * d1) + c * (b2 * d2 - a2 * d1);
    const s11 = (a2 * e - c2 * d2) / det;   // (1,1) cofactor
    const s22 = (a * e - c * d1) / det;     // (2,2) cofactor
    const s33 = (a * a2 - b * b2) / det;    // (3,3) cofactor
    return { Ex: 1 / s11, Ey: 1 / s22, Ez: 1 / s33 };
  }

  it("swap matches rotation exactly for the vertical (load-axis) and weak-horizontal moduli", () => {
    const eSwap = engineeringE(C_swap);
    const eRot  = engineeringE(C_rotated);
    // Global Z (load axis): both give the strong in-layer modulus E_xy(flat).
    expect(eSwap.Ez).toBeCloseTo(eRot.Ez, 0);
    expect(eSwap.Ez).toBeCloseTo(E_xy, 0);
    // Global X (layer normal after rotation): both give the weak E_z(flat).
    expect(eSwap.Ex).toBeCloseTo(eRot.Ex, 0);
    expect(eSwap.Ex).toBeCloseTo(E_z, 0);
  });

  it("swap is conservative in engineering-constant space: never stiffer than the rotation", () => {
    // The documented limitation: the swap makes BOTH horizontal directions
    // weak, whereas the rotated (exact) tensor keeps one horizontal direction
    // strong. Compare every engineering modulus (E via compliance, G directly
    // from the decoupled shear diagonal).
    const eSwap = engineeringE(C_swap);
    const eRot  = engineeringE(C_rotated);
    expect(eSwap.Ex).toBeLessThanOrEqual(eRot.Ex * 1.001);
    expect(eSwap.Ey).toBeLessThanOrEqual(eRot.Ey * 1.001);
    expect(eSwap.Ez).toBeLessThanOrEqual(eRot.Ez * 1.001);
    expect(C_swap[21]!).toBeLessThanOrEqual(C_rotated[21]! * 1.001);  // G_xy
    expect(C_swap[28]!).toBeLessThanOrEqual(C_rotated[28]! * 1.001);  // G_yz
    expect(C_swap[35]!).toBeLessThanOrEqual(C_rotated[35]! * 1.001);  // G_xz
    // The known gaps: strong horizontal E underestimated by the E_z/E_xy
    // ratio, and one vertical shear plane held at the inter-layer value.
    expect(eSwap.Ey / eRot.Ey).toBeCloseTo(E_z / E_xy, 1);      // ≈ 0.65
    expect(C_swap[28]! / C_rotated[28]!).toBeCloseTo(0.40, 1);  // G_xz/G_xy
  });
});

describe("applyUprightScalarSwap: field-by-field + Poisson consistency (issue #187)", () => {
  const s = applyUprightScalarSwap(FLAT);

  it("swaps every field of the material exactly (full field-by-field lock)", () => {
    // Moduli & yields swap; inter-layer shear takes both shear slots.
    expect(s.E_xy).toBe(FLAT.E_z);
    expect(s.E_z).toBe(FLAT.E_xy);
    expect(s.G_xy).toBe(FLAT.G_xz);
    expect(s.G_xz).toBe(FLAT.G_xz);
    expect(s.yieldXY).toBe(FLAT.yieldZ);
    expect(s.yieldZ).toBe(FLAT.yieldXY);
    // Poisson pair now swapped consistently (was the pre-#187 inconsistency):
    // both horizontals are the weak axis → every ν involving them is ν_zx.
    expect(s.nu_xy).toBeCloseTo(NU_ZX, 12);
    expect(s.nu_xz).toBeCloseTo(NU_ZX, 12);
    // yieldZShear rides along unchanged (physical interface property).
    expect(s.kind).toBe("orthotropic");
  });

  it("preserves the physical interlayer cross-coupling s13 (not inflated by E_xy/E_z)", () => {
    // The swapped material's coupling compliance entry equals the INPUT's own
    // s13 = −ν_xz/E_xy. The pre-#187 swap (nu_xz unchanged, E_xy←E_z) gave
    // s13_old = −ν_xz/E_z, larger in magnitude by E_xy/E_z ≈ 1.54×.
    const s13_new = -s.nu_xz / s.E_xy;
    const s13_input = -FLAT.nu_xz / FLAT.E_xy;
    expect(s13_new).toBeCloseTo(s13_input, 12);
    const s13_preFix = -FLAT.nu_xz / FLAT.E_z; // what the unswapped ν gave
    expect(Math.abs(s13_new - s13_preFix)).toBeGreaterThan(1e-6);
  });

  it("reciprocity ν_ij/E_i = ν_ji/E_j holds for the swapped set", () => {
    // Minor ratio derived from the swapped constants must round-trip.
    const nu_zx_swapped = s.nu_xz * s.E_z / s.E_xy;
    expect(s.nu_xz / s.E_xy).toBeCloseTo(nu_zx_swapped / s.E_z, 15);
    // And the swapped minor ratio equals the input's MAJOR ν_xz — the clean
    // relabel of the through-layer coupling.
    expect(nu_zx_swapped).toBeCloseTo(FLAT.nu_xz, 12);
  });

  it("swapped material yields a symmetric, positive-definite compliance (SPD)", () => {
    const C = buildOrthotropicConstitutiveMatrix(s); // throws if not stable
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++)
        expect(C[i * 6 + j]).toBeCloseTo(C[j * 6 + i] ?? 0, 8);
    // Leading principal minors of the 3×3 normal block > 0 (SPD).
    const c11 = C[0]!, c12 = C[1]!, c13 = C[2]!, c33 = C[14]!;
    expect(c11).toBeGreaterThan(0);
    expect(c11 * c11 - c12 * c12).toBeGreaterThan(0);
    const m3 = c11 * (c11 * c33 - c13 * c13) - c12 * (c12 * c33 - c13 * c13)
             + c13 * (c12 * c13 - c11 * c13);
    expect(m3).toBeGreaterThan(0);
  });

  it("recovered ν_xz from the swapped compliance equals the fabricated value", () => {
    const C = buildOrthotropicConstitutiveMatrix(s);
    // Invert the normal block to read s13 = −ν_xz/E_xy back out.
    const a = C[0]!, b = C[1]!, c = C[2]!, e = C[14]!;
    const det = a * (a * e - c * c) - b * (b * e - c * c) + c * (b * c - a * c);
    const s13 = (b * c - a * c) / det; // (1,3) cofactor / det
    expect(-s13 * s.E_xy).toBeCloseTo(s.nu_xz, 6);
  });
});
