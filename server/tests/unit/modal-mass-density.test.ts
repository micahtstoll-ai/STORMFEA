/**
 * modal-mass-density.test.ts
 * --------------------------
 * Issue #99: modal analysis must use the material's effective mass density
 * (massRho = solid density × effective volume fraction), not a label-derived
 * SOLID density. Before the fix, stiffness was infill-scaled but mass was
 * not, so a 20%-infill part carried ~5× too much mass and its frequencies
 * came out ~√5 ≈ 2.2× low.
 *
 * Physics under test: f = (1/2π)·√(k_eff/m_eff). If stiffness scales by s and
 * mass by v between two configurations of the SAME geometry and BCs, then
 *   f_ratio = √(s/v)   — not √(s), which is what the old solid-mass path gave.
 */

import { describe, it, expect } from "vitest";
import { generateBoxMesh, getNodesOnFace } from "../../solver/meshgen.js";
import { runModalAnalysis } from "../../solver/modal.js";
import { effectiveVolumeFraction } from "../../analysis.js";
import type { IsotropicMaterial } from "../../solver/types.js";

// Small cantilever beam — coarse mesh keeps the eigensolve fast; we only
// compare RATIOS of f₁ between materials on the identical mesh, so
// discretisation error cancels.
const mesh = generateBoxMesh(0, 0, 0, 40, 8, 8, 5, 2, 2);
const fixedNodes = getNodesOnFace(mesh, "x", 0);

async function firstFrequency(mat: IsotropicMaterial): Promise<number> {
  const res = await runModalAnalysis({ mesh, material: mat, fixedNodes, nModes: 4 });
  const f1 = res.modes.find(m => m.frequencyHz > 1)?.frequencyHz;
  if (!f1) throw new Error("no flexible mode found");
  return f1;
}

describe("effectiveVolumeFraction (issue #99)", () => {
  it("matches the strength model's combined infill+wall solid fraction", () => {
    expect(effectiveVolumeFraction(100, 2)).toBeCloseTo(1.0, 9);   // solid, clamped
    expect(effectiveVolumeFraction(20, 2)).toBeCloseTo(0.30 + 0.14 + 0.10, 9);  // 0.54
    expect(effectiveVolumeFraction(0, 1)).toBeCloseTo(0.30, 9);    // walls-only floor
    expect(effectiveVolumeFraction(80, 5)).toBeCloseTo(1.0, 9);    // clamp at solid
  });
});

describe("modal analysis uses massRho (issue #99)", () => {
  const solid: IsotropicMaterial = {
    E: 3500, nu: 0.36, yieldStrength: 50, label: "pla-solid", massRho: 1240,
  };

  it("4× mass → f₁ halves on the same stiffness", async () => {
    const heavy: IsotropicMaterial = { ...solid, massRho: 4 * 1240 };
    const f1 = await firstFrequency(solid);
    const f1heavy = await firstFrequency(heavy);
    expect(f1heavy / f1).toBeCloseTo(0.5, 2);
  }, 120_000);

  it("cube at 100% vs 20% infill: f₁ follows √(k_eff/m_eff), not √(k_eff)", async () => {
    // Emulate what analysis.ts builds for 20% infill, 2 walls:
    //   stiffness scale s = min(1, strengthMul/0.55) with
    //     strengthMul(20%, 2 walls, grid, flat) = 0.54 × 1.0 × 0.55 = 0.297
    //     → s = 0.297/0.55 = 0.54
    //   mass scale v = effectiveVolumeFraction(20, 2) = 0.54
    // With s = v the frequency must be UNCHANGED (√(s/v) = 1); the pre-fix
    // solid-mass path would have predicted √s ≈ 0.735.
    const s = 0.54;
    const v = effectiveVolumeFraction(20, 2);
    expect(v).toBeCloseTo(0.54, 9);

    const infill20: IsotropicMaterial = {
      ...solid, E: solid.E * s, label: "pla-20pct", massRho: 1240 * v,
    };
    const f100 = await firstFrequency(solid);
    const f20  = await firstFrequency(infill20);

    const expectedRatio = Math.sqrt(s / v);          // = 1.0 here
    const stiffnessOnlyRatio = Math.sqrt(s);         // ≈ 0.735 (the old, wrong prediction)
    expect(f20 / f100).toBeCloseTo(expectedRatio, 2);
    expect(Math.abs(f20 / f100 - stiffnessOnlyRatio)).toBeGreaterThan(0.1);
  }, 240_000);

  it("massRho path agrees with the legacy label fallback when densities coincide", async () => {
    // "PA12 (Nylon)" must resolve to the pa12 density (1.01e-9 t/mm³), not the
    // generic "nylon" entry — the lookup table is ordered most-specific-first.
    // With massRho = 1010 kg/m³ (= 1.01e-9 t/mm³) both paths must agree.
    const withRho: IsotropicMaterial = {
      E: 1700, nu: 0.40, yieldStrength: 48, label: "PA12 (Nylon)", massRho: 1010,
    };
    const { massRho: _drop, ...rest } = withRho;
    const withoutRho = rest as IsotropicMaterial;   // triggers the labelled fallback
    const fRho  = await firstFrequency(withRho);
    const fName = await firstFrequency(withoutRho);
    expect(fName / fRho).toBeCloseTo(1.0, 2);
  }, 240_000);
});
