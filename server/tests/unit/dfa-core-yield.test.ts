/**
 * dfa-core-yield.test.ts
 * ----------------------
 * Deshpande–Fleck–Ashby (DFA) pressure-dependent yield for the homogenized
 * infill CORE (issue #171).
 *
 * The core of the two-region model is a cellular solid: it yields under
 * HYDROSTATIC stress (the lattice compacts), unlike the deviatoric von Mises
 * the solid obeys. The core BULK term therefore uses the isotropic-foam DFA
 * criterion, in the ROADMAP's self-consistent normalized form
 *
 *     σ̂² = (σ_vm² + α²·σ_m²) / (1 + (α/3)²)          σ_m = ⅓·tr(σ)
 *
 * with pressure sensitivity α(ρ) = DFA_ALPHA0·(1 − ρ). The `(1 + (α/3)²)`
 * normalization makes the UNIAXIAL yield the exact fixed point (σ̂ = σ for any
 * α), so DFA never disturbs the in-plane coupon anchor — it only ADDS
 * hydrostatic yield. α is an engineering estimate (confidence LOW); these
 * tests LOCK the α(ρ) law (like core-lattice.test.ts locks the stiffness
 * exponents) and verify the four required limits from closed forms, NOT from
 * code output:
 *   (a) pure deviatoric → the α·σ_m term is zero (σ̂ = σ_vm/√(1+(α/3)²));
 *   (b) pure hydrostatic on a low-ρ core → FINITE SF matching the closed form
 *       (von Mises predicts infinite strength);
 *   (c) ρ=1 → α = 0 EXACTLY → DFA collapses to von Mises bit-for-bit;
 *   (d) flag-off / no-α path bit-identical to the legacy criterion.
 */

import { describe, it, expect } from "vitest";
import {
  DFA_ALPHA0,
  DFA_ALPHA_EXP,
  dfaPressureSensitivity,
} from "../../solver/lattice.js";
import { fdmDualCriterionSF, recoverElementStress } from "../../solver/stress.js";
import { buildTwoRegionField } from "../../twoRegion.js";
import { buildCoreMaterial, buildOrthotropicMaterial } from "../../analysis.js";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import { buildAnyConstitutiveMatrix } from "../../solver/element.js";
import type { OrthotropicMaterial, ElementMaterialField } from "../../solver/types.js";

const Y = 50;                        // in-plane yield (MPa)
const YZ = 30;                       // through-layer yield
const YZS = YZ / Math.sqrt(3);       // interlaminar shear allowable

/** Reference von Mises SF via the legacy (no-α) criterion path. */
function vmSF(s: number[]): number {
  return fdmDualCriterionSF(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!, Y, YZ, YZS);
}
/** DFA SF (bulk term pressure-dependent with coefficient α). */
function dfaSF(s: number[], alpha: number): number {
  return fdmDualCriterionSF(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!, Y, YZ, YZS, undefined, null, alpha);
}
/** Closed-form DFA bulk equivalent stress (independent of the implementation). */
function dfaEqStressClosed(s: number[], alpha: number): number {
  const vm = Math.sqrt(
    0.5 * ((s[0]! - s[1]!) ** 2 + (s[1]! - s[2]!) ** 2 + (s[2]! - s[0]!) ** 2)
    + 3 * (s[3]! ** 2 + s[4]! ** 2 + s[5]! ** 2),
  );
  const sm = (s[0]! + s[1]! + s[2]!) / 3;
  return Math.sqrt((vm * vm + alpha * alpha * sm * sm) / (1 + (alpha / 3) ** 2));
}

// ─── α(ρ) law: regression lock + exact anchors ───────────────────────────────
describe("dfaPressureSensitivity — α(ρ) law (confidence LOW, regression-locked)", () => {
  it("locks the literature constants", () => {
    // Deshpande & Fleck (2000): α ≈ 2.08 for cellular metals (ν_p ≈ 0).
    // A deliberate change must update these in the same commit.
    expect(DFA_ALPHA0).toBe(2.08);
    expect(DFA_ALPHA_EXP).toBe(1.0);
  });

  it("collapses to von Mises at ρ=1 EXACTLY (invariant #8 anchor)", () => {
    // toBe, not toBeCloseTo: Math.pow(0, 1) === 0 and 2.08·0 === 0, so σ̂ ≡ σ_vm
    // and the ρ=1 core reproduces the solid's criterion bit-for-bit.
    expect(dfaPressureSensitivity(1)).toBe(0);
  });

  it("reaches the fully-cellular foam limit at ρ→0", () => {
    expect(dfaPressureSensitivity(0)).toBe(DFA_ALPHA0);
  });

  it("follows α(ρ) = 2.08·(1−ρ) at intermediate densities", () => {
    expect(dfaPressureSensitivity(0.2)).toBeCloseTo(1.664, 12);
    expect(dfaPressureSensitivity(0.5)).toBeCloseTo(1.04, 12);
    expect(dfaPressureSensitivity(0.8)).toBeCloseTo(0.416, 12);
  });

  it("is monotone-decreasing in ρ (denser ⇒ less pressure-sensitive)", () => {
    for (let r = 0; r < 1; r += 0.1) {
      expect(dfaPressureSensitivity(r)).toBeGreaterThan(dfaPressureSensitivity(r + 0.1) - 1e-12);
    }
  });

  it("clamps ρ outside [0,1]", () => {
    expect(dfaPressureSensitivity(1.5)).toBe(0);
    expect(dfaPressureSensitivity(-0.5)).toBe(DFA_ALPHA0);
  });
});

// ─── (a) pure deviatoric: the α·σ_m term is zero ─────────────────────────────
describe("(a) pure deviatoric stress — α·σ_m term vanishes", () => {
  const alpha = dfaPressureSensitivity(0.2); // 1.664

  it("pure shear: σ̂ = σ_vm/√(1+(α/3)²) (mean stress zero)", () => {
    const s = [0, 0, 0, 12, 0, 0]; // τxy only ⇒ σ_m = 0
    const eqClosed = dfaEqStressClosed(s, alpha);
    // σ_m = 0 kills the pressure term; only the normalization scales σ_vm.
    const vm = Math.sqrt(3) * 12;
    expect(eqClosed).toBeCloseTo(vm / Math.sqrt(1 + (alpha / 3) ** 2), 12);
    // The bulk term governs here (interface sees no normal/transverse-shear).
    expect(dfaSF(s, alpha)).toBeCloseTo(Y / eqClosed, 10);
  });

  it("UNIAXIAL is the exact von-Mises fixed point for ANY α", () => {
    // The (1+(α/3)²) normalization is chosen so uniaxial yields at Y regardless
    // of α — the coupon anchor the codebase calibrates is preserved.
    const s = [30, 0, 0, 0, 0, 0];
    for (const a of [0, 0.5, alpha, DFA_ALPHA0]) {
      expect(dfaSF(s, a)).toBeCloseTo(vmSF(s), 10);
    }
  });
});

// ─── (b) pure hydrostatic: finite yield vs von Mises' infinity ───────────────
describe("(b) pure hydrostatic stress on a low-ρ core — finite DFA yield", () => {
  const rho = 0.2;
  const alpha = dfaPressureSensitivity(rho); // 1.664
  const p = -12.5; // hydrostatic compression (MPa) — the motivating case
  const hydro = [p, p, p, 0, 0, 0];

  it("von Mises predicts INFINITE strength (SF = 999 sentinel)", () => {
    // σ_vm = 0, no transverse shear, compressive normal ⇒ friction branch inert.
    expect(vmSF(hydro)).toBe(999);
  });

  it("DFA yields at a FINITE pressure matching the closed form", () => {
    const sf = dfaSF(hydro, alpha);
    expect(sf).toBeLessThan(999);
    expect(Number.isFinite(sf)).toBe(true);
    // Closed form: σ̂ = |α·p|/√(1+(α/3)²) ⇒ SF = Y·√(1+(α/3)²)/(α·|p|).
    const sfClosed = (Y * Math.sqrt(1 + (alpha / 3) ** 2)) / (alpha * Math.abs(p));
    expect(sf).toBeCloseTo(sfClosed, 10);
    expect(sf).toBeCloseTo(2.748864, 5); // pinned numeric value
  });

  it("tension and compression yield at the same |pressure| (symmetric bulk term)", () => {
    expect(dfaSF([p, p, p, 0, 0, 0], alpha)).toBeGreaterThan(0);
    // For hydrostatic TENSION the delamination interface also governs, so
    // compare the BULK term alone via the closed form magnitude.
    expect(dfaEqStressClosed([p, p, p, 0, 0, 0], alpha))
      .toBeCloseTo(dfaEqStressClosed([-p, -p, -p, 0, 0, 0], alpha), 12);
  });
});

// ─── (c) ρ=1 → DFA ≡ von Mises exactly, for every stress state ────────────────
describe("(c) ρ=1 (α=0) collapses to von Mises bit-for-bit", () => {
  const states: number[][] = [
    [40, -10, 5, 8, -3, 6],
    [-20, -20, -20, 0, 0, 0], // hydrostatic — the stress test for the collapse
    [15, 0, 0, 0, 0, 0],
    [0, 0, 0, 7, -4, 2],
    [33, 12, -25, 4, 9, -6],
  ];
  it("α(1) drives an EXACT (toBe) match to the legacy criterion", () => {
    const alpha1 = dfaPressureSensitivity(1);
    expect(alpha1).toBe(0);
    for (const s of states) {
      // The α=0 branch is skipped entirely (no sqrt(vm²) round-trip), so the
      // arithmetic is identical to the pre-DFA path — bit-for-bit equality.
      expect(dfaSF(s, alpha1)).toBe(vmSF(s));
    }
  });
});

// ─── (d) flag-off / no-α path bit-identical ──────────────────────────────────
describe("(d) flag-off path bit-identical (no core ⇒ criterion unchanged)", () => {
  const states: number[][] = [
    [40, -10, 5, 8, -3, 6],
    [-20, -35, -12, 4, 7, -2],
    [0, 0, 0, 9, 0, 0],
  ];
  it("the default (no α argument) equals an explicit α=0", () => {
    for (const s of states) {
      expect(dfaSF(s, 0)).toBe(vmSF(s));
    }
  });

  it("a two-region field built WITHOUT dfaAlpha stays von Mises (older fields)", () => {
    // recoverElementStress must treat an absent field.dfaAlpha as α=0.
    const mesh = generateBoxMeshC3D4(0, 0, 0, 4, 4, 4, 1, 1, 1);
    const disp = new Float64Array(mesh.nodeCount * 3); // unloaded ⇒ zero stress
    const mat: OrthotropicMaterial = {
      kind: "orthotropic", E_xy: 3500, E_z: 3500, nu_xy: 0.36, nu_xz: 0.36,
      G_xz: 3500 / (2 * 1.36), yieldXY: Y, yieldZ: Y, label: "iso",
    };
    const legacyField: ElementMaterialField = {
      binCount: 1, binOfElement: new Int32Array(mesh.elementCount),
      C: buildAnyConstitutiveMatrix(mat),
      yieldXY: Float64Array.of(Y), yieldZ: Float64Array.of(Y),
      yieldZShear: Float64Array.of(Y / Math.sqrt(3)),
      massRho: Float64Array.of(1240), shellFrac: Float64Array.of(0),
      // NOTE: no dfaAlpha — the type allows omission; recovery must default to 0.
    };
    const r = recoverElementStress(mesh, disp, mat, legacyField);
    // Unloaded ⇒ SF at the 999 ceiling for every element (no yielding at all).
    expect(r.minSF).toBe(999);
  });
});

// ─── Field wiring: buildTwoRegionField populates per-bin α correctly ─────────
describe("buildTwoRegionField — per-bin core-fraction-weighted α", () => {
  function makeShellCore(infillPct: number): { shell: OrthotropicMaterial; core: OrthotropicMaterial } {
    const shell = { ...buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null), massRho: 1240 };
    const core = buildCoreMaterial("pla", infillPct, "grid", "flat", 0.2, null, false, undefined, null);
    return { shell, core };
  }

  it("the pure-core bin carries α(ρ); the pure-shell bin carries 0", () => {
    const mesh = generateBoxMeshC3D4(0, 0, 0, 40, 12, 12, 10, 4, 4);
    const faces = extractSurfaceFaces(mesh);
    const { shell, core } = makeShellCore(20);
    const tr = buildTwoRegionField(mesh, faces, shell, core, 1.35);
    expect(tr.field).not.toBeNull();
    const f = tr.field!;
    expect(f.dfaAlpha).toBeDefined();
    // The core material's α is α(0.2); the builder blends it as (1−shellFrac)·α.
    const alphaCore = dfaPressureSensitivity(0.2);
    for (let b = 0; b < f.binCount; b++) {
      expect(f.dfaAlpha![b]).toBeCloseTo((1 - f.shellFrac[b]!) * alphaCore, 12);
    }
    // Endpoints exist by construction of the bin schedule.
    const minShell = Math.min(...Array.from(f.shellFrac));
    const maxShell = Math.max(...Array.from(f.shellFrac));
    expect(minShell).toBeCloseTo(0, 9);          // pure-core bin ⇒ full α
    expect(maxShell).toBeCloseTo(1, 9);          // pure-shell bin ⇒ α = 0
    const coreBin = Array.from(f.shellFrac).indexOf(minShell);
    expect(f.dfaAlpha![coreBin]).toBeCloseTo(alphaCore, 9);
  });

  it("100% infill degenerates to uniform (no field ⇒ no DFA, ρ=1 collapse)", () => {
    const mesh = generateBoxMeshC3D4(0, 0, 0, 40, 12, 12, 10, 4, 4);
    const faces = extractSurfaceFaces(mesh);
    const { shell, core } = makeShellCore(100);
    const tr = buildTwoRegionField(mesh, faces, shell, core, 1.35);
    // materialsEqual (ρ=1) ⇒ field null ⇒ von Mises everywhere (invariant #8).
    expect(tr.field).toBeNull();
    expect(tr.averageMaterial.dfaAlpha ?? 0).toBe(0);
  });
});

// ─── End-to-end: a low-ρ core element yields hydrostatically (the acceptance case)
describe("recoverElementStress — a core element yields under hydrostatic compression", () => {
  // Isotropic-limit orthotropic core so the constitutive matrix is isotropic and
  // a uniform hydrostatic strain maps to a pure hydrostatic stress state.
  const E = 3500, NU = 0.36;
  const isoCore = (alpha: number): { mat: OrthotropicMaterial; field: ElementMaterialField } => {
    const mat: OrthotropicMaterial = {
      kind: "orthotropic", E_xy: E, E_z: E, nu_xy: NU, nu_xz: NU,
      G_xz: E / (2 * (1 + NU)), yieldXY: Y, yieldZ: Y, label: "iso-core",
    };
    return { mat, field: fieldFor(mat, alpha) };
  };
  const fieldFor = (mat: OrthotropicMaterial, alpha: number): ElementMaterialField => ({
    binCount: 1, binOfElement: new Int32Array(0), // filled per mesh below
    C: buildAnyConstitutiveMatrix(mat),
    yieldXY: Float64Array.of(Y), yieldZ: Float64Array.of(Y),
    yieldZShear: Float64Array.of(Y / Math.sqrt(3)),
    massRho: Float64Array.of(1240), shellFrac: Float64Array.of(0),
    dfaAlpha: Float64Array.of(alpha),
  });

  function runHydro(alpha: number): number {
    const mesh = generateBoxMeshC3D4(0, 0, 0, 4, 4, 4, 1, 1, 1);
    const { mat } = isoCore(alpha);
    const field: ElementMaterialField = {
      ...fieldFor(mat, alpha),
      binOfElement: new Int32Array(mesh.elementCount), // all bin 0
    };
    // Uniform hydrostatic contraction: u = −e·x. ε = (−e,−e,−e,0,0,0) everywhere.
    const e = 0.001;
    const disp = new Float64Array(mesh.nodeCount * 3);
    for (let n = 0; n < mesh.nodeCount; n++) {
      disp[n * 3] = -e * (mesh.nodes[n * 3] ?? 0);
      disp[n * 3 + 1] = -e * (mesh.nodes[n * 3 + 1] ?? 0);
      disp[n * 3 + 2] = -e * (mesh.nodes[n * 3 + 2] ?? 0);
    }
    return recoverElementStress(mesh, disp, mat, field).minSF;
  }

  it("von Mises (α=0) sees infinite strength; DFA (α>0) yields at a finite, correct SF", () => {
    const alpha = dfaPressureSensitivity(0.2);
    const sfVM = runHydro(0);
    const sfDFA = runHydro(alpha);

    expect(sfVM).toBe(999);            // legacy: hydrostatic never yields
    expect(sfDFA).toBeLessThan(999);   // DFA: the foam core compacts

    // Closed form: p = −e·E/(1−2ν); σ̂ = |α·p|/√(1+(α/3)²); SF = Y/σ̂.
    const p = -0.001 * E / (1 - 2 * NU);
    const sigHat = Math.abs(alpha * p) / Math.sqrt(1 + (alpha / 3) ** 2);
    expect(sfDFA).toBeCloseTo(Y / sigHat, 6);
  });
});
