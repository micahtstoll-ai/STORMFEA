/**
 * core-lattice.test.ts
 * --------------------
 * Regression locks and invariants for the Gibson-Ashby core homogenization
 * (server/solver/lattice.ts) used by the two-region material model.
 *
 * The exponents are engineering estimates (confidence LOW) — these tests LOCK
 * them the way gyroid-formula.test.ts locks the original gyroid coefficients:
 * a deliberate change must update the locked values here in the same commit.
 *
 * The exact-anchor tests use toBe (bit equality), not toBeCloseTo: the
 * materialsEqual collapse in twoRegion.ts (rel-diff < 1e-9) relies on the
 * ρ=1 scales being EXACTLY 1.0 so that core = solid × scale reproduces the
 * solid bit-for-bit (CLAUDE.md two-region invariant #8).
 */

import { describe, it, expect } from "vitest";
import {
  LATTICE_PARAMS,
  LATTICE_STIFFNESS_FLOOR,
  LATTICE_STRENGTH_FLOOR,
  PATTERN_FAMILY,
  PATTERN_MULTIPLIERS,
  gibsonAshbyModulus,
  latticeStiffnessScale,
  latticeStrengthFraction,
  patternFamilyOf,
} from "../../solver/lattice.js";
import { buildAnyConstitutiveMatrix } from "../../solver/element.js";
import { buildTwoRegionField } from "../../twoRegion.js";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import { buildOrthotropicMaterial, orientationMultiplier } from "../../analysis.js";
import type { OrthotropicMaterial } from "../../solver/types.js";

const ALL_PATTERNS = Object.keys(PATTERN_FAMILY);
const STRUCTURAL = ALL_PATTERNS.filter(p => patternFamilyOf(p) !== "sparse");

/** Mirror of the production core wiring (analysis.ts two-region block):
 *  Gibson-Ashby scales applied to the SOLID lattice base material. */
function buildProductionStyleCore(
  shellSolid: OrthotropicMaterial,
  pattern: string,
  infillPct: number,
): OrthotropicMaterial {
  const rho = infillPct / 100;
  const g = latticeStiffnessScale(pattern, rho);
  const s = latticeStrengthFraction(pattern, rho);
  return {
    ...shellSolid,
    E_xy: shellSolid.E_xy * g,
    E_z:  shellSolid.E_z  * g,
    G_xz: shellSolid.G_xz * g,
    ...(shellSolid.G_xy !== undefined ? { G_xy: shellSolid.G_xy * g } : {}),
    yieldXY: shellSolid.yieldXY * s,
    yieldZ:  shellSolid.yieldZ  * s,
    label: `${shellSolid.label} · GA ${pattern} lattice ρ=${infillPct}%`,
    massRho: 1240 * rho,
  };
}

// ─── Exact endpoint anchors (invariant #8) ───────────────────────────────────

describe("ρ=1 anchors are exact (toBe, not closeTo)", () => {
  it("stiffness scale is exactly 1.0 for every structural pattern", () => {
    for (const p of STRUCTURAL) {
      expect(latticeStiffnessScale(p, 1)).toBe(1.0);
    }
  });

  it("strength fraction is exactly min(1, patternMul) for every pattern", () => {
    for (const p of ALL_PATTERNS) {
      expect(latticeStrengthFraction(p, 1)).toBe(Math.min(1, PATTERN_MULTIPLIERS[p]!));
    }
  });

  it("solid × scale reproduces the solid bit-for-bit at 100% infill", () => {
    const solid = buildOrthotropicMaterial("pla", 0.55, "flat", 0.2, null, null);
    const core = buildProductionStyleCore({ ...solid, massRho: 1240 }, "grid", 100);
    expect(core.E_xy).toBe(solid.E_xy);
    expect(core.E_z).toBe(solid.E_z);
    expect(core.yieldXY).toBe(solid.yieldXY);
    expect(core.yieldZ).toBe(solid.yieldZ);
  });
});

// ─── Locked interior values (regression) ─────────────────────────────────────

describe("locked interior values at ρ=0.2 (change = deliberate re-estimation)", () => {
  it("g_tpms3d(0.2) ≈ 0.05407 (= 0.2^1.75 × 0.904 — matches the legacy gyroid lock)", () => {
    expect(latticeStiffnessScale("gyroid", 0.2)).toBeCloseTo(0.054072, 5);
  });
  it("g_walls25d(0.2) = 0.0368 (= 0.2² × 0.92)", () => {
    expect(latticeStiffnessScale("grid", 0.2)).toBeCloseTo(0.0368, 6);
  });
  it("s_walls25d(0.2) ≈ 0.08944 (= 0.2^1.5, grid patternMul 1.0)", () => {
    expect(latticeStrengthFraction("grid", 0.2)).toBeCloseTo(0.089443, 5);
  });
  it("s_tpms3d(0.2) ≈ 0.14445 (= 1.08 × 0.2^1.25, gyroid)", () => {
    expect(latticeStrengthFraction("gyroid", 0.2)).toBeCloseTo(0.144452, 5);
  });
  it("gibsonAshbyModulus reproduces the legacy gyroid E_xy at ρ=0.2 (≈189 MPa on PLA base)", () => {
    expect(gibsonAshbyModulus(3500, 0.2, 1.75, 0.12)).toBeCloseTo(189.2, 0);
  });
});

// ─── Structure of the laws ───────────────────────────────────────────────────

describe("law structure", () => {
  it("g and s are strictly monotone in ρ above the floor, for every pattern", () => {
    for (const p of ALL_PATTERNS) {
      let prevG = -Infinity, prevS = -Infinity;
      for (let rho = 0.05; rho <= 1.0001; rho += 0.05) {
        const g = latticeStiffnessScale(p, rho);
        const s = latticeStrengthFraction(p, rho);
        if (prevG > LATTICE_STIFFNESS_FLOOR && s < 1) {
          expect(g).toBeGreaterThan(prevG);
        }
        if (prevS > LATTICE_STRENGTH_FLOOR && prevS < 1) {
          expect(s).toBeGreaterThanOrEqual(prevS);
        }
        prevG = g; prevS = s;
      }
    }
  });

  it("family stiffness ordering at ρ=0.3: tpms3d > walls25d > sparse", () => {
    const g3d = latticeStiffnessScale("gyroid", 0.3);
    const g25 = latticeStiffnessScale("grid", 0.3);
    const gsp = latticeStiffnessScale("lightning", 0.3);
    expect(g3d).toBeGreaterThan(g25);
    expect(g25).toBeGreaterThan(gsp);
  });

  it("power law sits well below the legacy linear model at typical infill", () => {
    // 20% gyroid: legacy stiffness scale was ρ·patternMul ≈ 0.216; GA ≈ 0.054.
    expect(latticeStiffnessScale("gyroid", 0.2)).toBeLessThan(0.2 * 1.08 * 0.5);
  });

  it("calibration override replaces the exponent (correction retained)", () => {
    // grid, ρ=0.5, override n=1: 0.5^1 × (1 − 0.10·0.5) = 0.475
    expect(latticeStiffnessScale("grid", 0.5, 1.0)).toBeCloseTo(0.475, 12);
    // strength override m=1: min(1, 1.0 × 0.5) = 0.5
    expect(latticeStrengthFraction("grid", 0.5, 1.0)).toBeCloseTo(0.5, 12);
  });

  it("unknown pattern ids fall back to the walls25d family", () => {
    expect(patternFamilyOf("mystery-pattern")).toBe("walls25d");
    expect(latticeStiffnessScale("mystery-pattern", 0.2)).toBeCloseTo(0.0368, 6);
  });
});

// ─── Floor behavior + the pre-existing 0%-infill crash ───────────────────────

describe("low-density floor", () => {
  it("scales floor at exactly 1e-3 at ρ=0", () => {
    for (const p of ALL_PATTERNS) {
      expect(latticeStiffnessScale(p, 0)).toBe(LATTICE_STIFFNESS_FLOOR);
      expect(latticeStrengthFraction(p, 0)).toBe(LATTICE_STRENGTH_FLOOR);
    }
  });

  it("0% infill core builds a valid constitutive matrix (previously threw on E=0)", () => {
    const solid: OrthotropicMaterial = {
      ...buildOrthotropicMaterial("pla", 0.55, "flat", 0.2, null, null),
      massRho: 1240,
    };
    const core = buildProductionStyleCore(solid, "grid", 0);
    expect(core.E_xy).toBeGreaterThan(0);
    expect(() => buildAnyConstitutiveMatrix(core)).not.toThrow();
    const C = buildAnyConstitutiveMatrix(core);
    for (let i = 0; i < 36; i++) expect(Number.isFinite(C[i]!)).toBe(true);
  });

  it("0% infill runs through buildTwoRegionField without NaN", () => {
    const mesh = generateBoxMeshC3D4(0, 0, 0, 20, 12, 8, 10, 6, 4);
    const faces = extractSurfaceFaces(mesh);
    const solid: OrthotropicMaterial = {
      ...buildOrthotropicMaterial("pla", 0.55, "flat", 0.2, null, null),
      massRho: 1240,
    };
    const core = buildProductionStyleCore(solid, "grid", 0);
    const tr = buildTwoRegionField(mesh, faces, solid, core, 0.9);
    expect(tr.field).not.toBeNull();
    for (let i = 0; i < tr.field!.C.length; i++) {
      expect(Number.isFinite(tr.field!.C[i]!)).toBe(true);
    }
  });
});

// ─── Orientation decoupling ──────────────────────────────────────────────────

describe("orientation is decoupled from core stiffness", () => {
  // Production builds the core solid with strengthMul = orientMul, whose
  // min(1, orientMul/0.55) clamp yields solid E for EVERY orientation. The
  // legacy path scaled stiffness by min(1, coreMul/0.55), leaking orientMul
  // into core E (upright cores were 1.64× stiffer than flat at equal ρ).
  it("flat and angled cores have identical stiffness; yields scale with orientMul", () => {
    const mk = (orient: string) => {
      const solid: OrthotropicMaterial = {
        ...buildOrthotropicMaterial("pla", orientationMultiplier(orient), orient, 0.2, null, null),
        massRho: 1240,
      };
      return buildProductionStyleCore(solid, "gyroid", 40);
    };
    const flat = mk("flat"), angled = mk("angled");
    expect(angled.E_xy).toBe(flat.E_xy);
    expect(angled.E_z).toBe(flat.E_z);
    expect(angled.yieldXY / flat.yieldXY).toBeCloseTo(
      orientationMultiplier("angled") / orientationMultiplier("flat"), 12);
  });
});

// ─── 100%-infill degenerate collapse through the real classifier ─────────────

describe("100% infill collapses to the uniform solid path", () => {
  const mesh = generateBoxMeshC3D4(0, 0, 0, 20, 12, 8, 10, 6, 4);
  const faces = extractSurfaceFaces(mesh);

  it.each(["grid", "gyroid"])("pattern %s: field is null (materialsEqual fires)", (pattern) => {
    const solid: OrthotropicMaterial = {
      ...buildOrthotropicMaterial("pla", 0.55, "flat", 0.2, null, null),
      massRho: 1240,
    };
    const core = buildProductionStyleCore(solid, pattern, 100);
    const tr = buildTwoRegionField(mesh, faces, solid, core, 0.9);
    expect(tr.field).toBeNull();
    expect(tr.averageMaterial.E_xy).toBeCloseTo(solid.E_xy, 12);
  });
});
