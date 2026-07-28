/**
 * c3d10-quadrature.test.ts
 * ------------------------
 * Issue #163: the default 4-point rule is EXACT for affine C3D10 elements and
 * UNDER-integrates genuinely curved ones. These tests pin:
 *   - the default path is bit-identical to passing C3D10_GAUSS explicitly,
 *   - the 4-point rule matches the high-order rule to round-off on an affine
 *     element (proving affine-exactness → validated results are unaffected),
 *   - the two rules DIFFER measurably on a curved element (the quantified
 *     under-integration error recorded in the PR).
 */

import { describe, it, expect } from "vitest";
import {
  c3d10ElementStiffness,
  C3D10_GAUSS,
  C3D10_GAUSS_HIGH_ORDER,
  buildConstitutiveMatrix,
} from "../../solver/element.js";

const C = buildConstitutiveMatrix({ E: 3500, nu: 0.36, yieldStrength: 50, label: "pla" });

// Straight-edged (affine) C3D10 tet: midsides at exact midpoints.
const STRAIGHT = new Float64Array([
  2,0,0, 0,2,0, 0,0,2, 0,0,0,
  1,1,0, 0,1,1, 1,0,1, 1,0,0, 0,1,0, 0,0,1,
]);

function relFro(a: Float64Array, b: Float64Array): number {
  let d = 0, n = 0;
  for (let i = 0; i < a.length; i++) { const e = (a[i]! - b[i]!); d += e*e; n += b[i]!*b[i]!; }
  return Math.sqrt(d) / Math.sqrt(n);
}

describe("C3D10 quadrature — default path unchanged (issue #163)", () => {
  it("default gauss argument is bit-identical to passing C3D10_GAUSS explicitly", () => {
    const kDefault = c3d10ElementStiffness(STRAIGHT, C);
    const kExplicit = c3d10ElementStiffness(STRAIGHT, C, C3D10_GAUSS);
    for (let i = 0; i < kDefault.length; i++) expect(kDefault[i]).toBe(kExplicit[i]);
  });
});

describe("C3D10 quadrature — 4-point rule is exact for affine elements (issue #163)", () => {
  it("affine element: 4-point and high-order rules agree to round-off", () => {
    const k4 = c3d10ElementStiffness(STRAIGHT, C, C3D10_GAUSS);
    const kH = c3d10ElementStiffness(STRAIGHT, C, C3D10_GAUSS_HIGH_ORDER);
    expect(relFro(k4, kH)).toBeLessThan(1e-12);
  });
});

describe("C3D10 quadrature — curved elements are under-integrated by the 4-point rule (issue #163)", () => {
  it("a curved element shows a measurable 4-point vs high-order stiffness difference", () => {
    // Displace three midsides off their midpoints (~20% of edge) → curved map.
    const curved = new Float64Array(STRAIGHT);
    curved[4*3]   = (curved[4*3]   ?? 0) + 0.4;   // node 4 x
    curved[5*3+1] = (curved[5*3+1] ?? 0) + 0.4;   // node 5 y
    curved[6*3+2] = (curved[6*3+2] ?? 0) + 0.4;   // node 6 z
    const k4 = c3d10ElementStiffness(curved, C, C3D10_GAUSS);
    const kH = c3d10ElementStiffness(curved, C, C3D10_GAUSS_HIGH_ORDER);
    const err = relFro(k4, kH);
    // Measured: ~10% offset → ~1.2%, ~20% → ~2.3%, ~30% → ~4.0%.
    expect(err).toBeGreaterThan(0.005);   // the under-integration is real, not negligible
    expect(err).toBeLessThan(0.1);        // and bounded for realistic curvature
  });
});
