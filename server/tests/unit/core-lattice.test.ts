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
  latticeStiffnessScales,
  latticeStrengthFraction,
  lumpedInPlaneStiffnessScale,
  wallCreditFraction,
  patternFamilyOf,
} from "../../solver/lattice.js";
import { buildLaminateCMatrix, DEFAULT_BEAD_PROPS, PATTERN_PLY_ANGLES } from "../../solver/laminate.js";
import { buildAnyConstitutiveMatrix } from "../../solver/element.js";
import { buildTwoRegionField } from "../../twoRegion.js";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import {
  buildCoreMaterial,
  buildOrthotropicMaterial,
  orientationMultiplier,
  type CalibrationProfile,
} from "../../analysis.js";
import type { OrthotropicMaterial } from "../../solver/types.js";

const ALL_PATTERNS = Object.keys(PATTERN_FAMILY);
const STRUCTURAL = ALL_PATTERNS.filter(p => patternFamilyOf(p) !== "sparse");

/** The production core builder, defaulted to the plain (non-CLT) path. */
function makeCore(
  infillPct: number,
  pattern: string,
  orientation = "flat",
  weakAxis: readonly [number, number, number] | null = null,
  calibration: CalibrationProfile | null = null,
  layerHeightMm = 0.2,
): OrthotropicMaterial {
  return buildCoreMaterial(
    "pla", infillPct, pattern, orientation, layerHeightMm,
    calibration, false, undefined, weakAxis,
  );
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

  it("per-axis scales are exactly 1.0 at ρ=1 for every structural pattern", () => {
    for (const p of STRUCTURAL) {
      const s = latticeStiffnessScales(p, 1);
      expect(s.gXY).toBe(1.0);
      expect(s.gZ).toBe(1.0);
      expect(s.gGxz).toBe(1.0);
      if (s.gGxy !== null) expect(s.gGxy).toBe(1.0);
    }
  });

  it("the production core reproduces the solid bit-for-bit at 100% infill", () => {
    const solid = buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null);
    const core = makeCore(100, "grid");
    expect(core.E_xy).toBe(solid.E_xy);
    expect(core.E_z).toBe(solid.E_z);
    expect(core.nu_xz).toBe(solid.nu_xz);
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
    const core = makeCore(0, "grid");
    expect(core.E_xy).toBeGreaterThan(0);
    expect(() => buildAnyConstitutiveMatrix(core)).not.toThrow();
    const C = buildAnyConstitutiveMatrix(core);
    for (let i = 0; i < 36; i++) expect(Number.isFinite(C[i]!)).toBe(true);
  });

  it("0% infill runs through buildTwoRegionField without NaN", () => {
    const mesh = generateBoxMeshC3D4(0, 0, 0, 20, 12, 8, 10, 6, 4);
    const faces = extractSurfaceFaces(mesh);
    const solid: OrthotropicMaterial = {
      ...buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null),
      massRho: 1240,
    };
    const core = makeCore(0, "grid");
    const tr = buildTwoRegionField(mesh, faces, solid, core, 0.9);
    expect(tr.field).not.toBeNull();
    for (let i = 0; i < tr.field!.C.length; i++) {
      expect(Number.isFinite(tr.field!.C[i]!)).toBe(true);
    }
  });
});

// ─── Orientation decoupling ──────────────────────────────────────────────────

describe("orientation is decoupled from core stiffness and strength (audit A4)", () => {
  // Production builds the core solid with strengthMul = 1.0 — orientation is
  // resolved by the criterion (weakAxis rotation / scalar swap), not a scalar
  // on the material. The ONLY exception is the angled-no-bed fallback (no
  // directional model exists there), which keeps the legacy 0.75.
  it("flat and angled cores have identical stiffness; angled-no-bed yields carry the 0.75 fallback", () => {
    const flat = makeCore(40, "gyroid", "flat");
    const angled = makeCore(40, "gyroid", "angled");
    expect(angled.E_xy).toBe(flat.E_xy);
    expect(angled.E_z).toBe(flat.E_z);
    expect(flat.yieldXY).toBeCloseTo(50 * latticeStrengthFraction("gyroid", 0.4), 10);
    expect(angled.yieldXY / flat.yieldXY).toBeCloseTo(orientationMultiplier("angled"), 12);
  });

  it("an angled core WITH a bed face gets no scalar penalty (exact tensor path)", () => {
    const flat = makeCore(40, "gyroid", "flat");
    const angledBed = makeCore(40, "gyroid", "angled", [0, Math.SQRT1_2, Math.SQRT1_2]);
    expect(angledBed.yieldXY).toBeCloseTo(flat.yieldXY, 12);
    expect(angledBed.yieldZ).toBeCloseTo(flat.yieldZ, 12);
  });
});

// ─── 100%-infill degenerate collapse through the real classifier ─────────────

describe("100% infill collapses to the uniform solid path", () => {
  const mesh = generateBoxMeshC3D4(0, 0, 0, 20, 12, 8, 10, 6, 4);
  const faces = extractSurfaceFaces(mesh);

  it.each(["grid", "gyroid"])("pattern %s: field is null (materialsEqual fires)", (pattern) => {
    const solid: OrthotropicMaterial = {
      ...buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null),
      massRho: 1240,
    };
    const core = makeCore(100, pattern);
    const tr = buildTwoRegionField(mesh, faces, solid, core, 0.9);
    expect(tr.field).toBeNull();
    expect(tr.averageMaterial.E_xy).toBeCloseTo(solid.E_xy, 12);
  });
});

// ─── Stage 2: per-axis anisotropic core ──────────────────────────────────────

describe("per-axis lattice laws (natural frame)", () => {
  it("walls25d inverts the anisotropy at low ρ (continuous walls along the build axis)", () => {
    const s = latticeStiffnessScales("grid", 0.2);
    expect(s.gZ).toBeGreaterThan(s.gXY);      // ρ^1 ≫ ρ^2
    expect(s.gGxy).not.toBeNull();
    expect(s.gGxy!).toBeLessThan(s.gXY);      // ρ³ wall-bending shear is softest
  });

  it("tpms3d degrades E_z faster than E_xy and G_xz fastest (locked gyroid ordering)", () => {
    const s = latticeStiffnessScales("gyroid", 0.2);
    expect(s.gZ).toBeLessThan(s.gXY);
    expect(s.gGxz).toBeLessThan(s.gZ);
    expect(s.gGxy).toBeNull();
  });

  it("walls25d core E_z/E_xy ratio exceeds the solid's and grows as ρ drops", () => {
    const solid = buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null);
    const ratioSolid = solid.E_z / solid.E_xy;
    const r40 = makeCore(40, "grid");
    const r15 = makeCore(15, "grid");
    expect(r40.E_z / r40.E_xy).toBeGreaterThan(ratioSolid);
    expect(r15.E_z / r15.E_xy).toBeGreaterThan(r40.E_z / r40.E_xy);
  });
});

describe("buildCoreMaterial frame handling + stability", () => {
  it("positive-definite C for every pattern × ρ × layer height × frame", () => {
    const rhos = [0, 0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1.0];
    const lhs = [0.1, 0.2, 0.3];
    const frames: ReadonlyArray<readonly [string, readonly [number, number, number] | null]> = [
      ["flat", null], ["angled", null], ["upright", null],
      ["upright", [1, 0, 0]], ["flat", [0, 0, 1]],
    ];
    for (const p of ALL_PATTERNS) {
      for (const rho of rhos) {
        for (const lh of lhs) {
          for (const [orient, axis] of frames) {
            const core = makeCore(rho * 100, p, orient, axis, null, lh);
            expect(() => buildAnyConstitutiveMatrix(core)).not.toThrow();
          }
        }
      }
    }
  });

  it("upright-no-bed: scaling happens in the natural frame, then the scalar swap", () => {
    // Natural constants (swap suppressed via the identity axis), per-axis
    // scaled, then swapped: global E_z carries the natural in-plane law and
    // global E_xy the natural through-layer law.
    const nat = buildOrthotropicMaterial("pla", 1.0, "upright", 0.2, null, [0, 0, 1]);
    const s = latticeStiffnessScales("grid", 0.2);
    const core = makeCore(20, "grid", "upright");
    expect(core.weakAxis).toBeUndefined();
    expect(core.E_z).toBeCloseTo(nat.E_xy * s.gXY, 8);
    expect(core.E_xy).toBeCloseTo(nat.E_z * s.gZ, 8);
    expect(core.G_xy).toBeCloseTo(nat.G_xz * s.gGxz, 8); // swap: G_xy ← inter-layer shear
  });

  it("a real weakAxis is carried through with natural constants (rotation happens in C)", () => {
    const core = makeCore(20, "grid", "upright", [1, 0, 0]);
    expect(core.weakAxis).toEqual([1, 0, 0]);
    const nat = buildOrthotropicMaterial("pla", 1.0, "upright", 0.2, null, [1, 0, 0]);
    const s = latticeStiffnessScales("grid", 0.2);
    expect(core.E_xy).toBeCloseTo(nat.E_xy * s.gXY, 8);
    expect(core.E_z).toBeCloseTo(nat.E_z * s.gZ, 8);
  });

  it("calibration stiffness-exponent override routes to the scalar (ratio-preserving) law", () => {
    const cal: CalibrationProfile = {
      id: "t", label: "t", materialId: "pla", layerHeightMm: 0.2, createdAt: "",
      yieldXY_MPa: null, yieldZ_MPa: null, E_xy_MPa: null, bearingStr_MPa: null,
      shearStr_MPa: null, E_z_over_E_xy: 0.65, yieldZ_over_yieldXY: 0.58,
      G_xz_over_G_xy: 0.40, latticeStiffExp: 1.0,
    };
    const core = makeCore(50, "grid", "flat", null, cal);
    const solid = buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, cal, null);
    const g = latticeStiffnessScale("grid", 0.5, 1.0); // 0.475
    expect(core.E_xy).toBeCloseTo(solid.E_xy * g, 8);
    expect(core.E_z).toBeCloseTo(solid.E_z * g, 8);   // ratios preserved
    expect(core.nu_xz).toBe(solid.nu_xz);             // no Poisson guard needed
  });
});

// ─── Issue #176: ONE in-plane density knockdown across all paths ──────────────

describe("unified in-plane density knockdown (issue #176)", () => {
  const PAT = "grid";
  const wc1 = wallCreditFraction(1);

  it("100% infill knockdown is EXACTLY 1.0 (solid anchor) for every structural pattern & wall count", () => {
    for (const p of STRUCTURAL) {
      for (const walls of [0, 1, 3, 5]) {
        // g_GA(1) = 1 ⇒ wallCredit + (1−wallCredit)·1 = 1 bit-for-bit.
        expect(lumpedInPlaneStiffnessScale(p, 1, wallCreditFraction(walls))).toBe(1.0);
      }
    }
  });

  it("wall credit is the +0.10-per-wall proxy, capped at 0.9", () => {
    expect(wallCreditFraction(0)).toBe(0);
    expect(wallCreditFraction(1)).toBeCloseTo(0.10, 12);
    expect(wallCreditFraction(3)).toBeCloseTo(0.30, 12);
    expect(wallCreditFraction(20)).toBe(0.9);
  });

  it("the lumped law sits between bare Gibson-Ashby and the legacy linear model (fixes the 2–5× swing)", () => {
    for (const rho of [0.2, 0.5]) {
      const k = lumpedInPlaneStiffnessScale(PAT, rho, wc1);
      const bareGA = latticeStiffnessScale(PAT, rho);             // e.g. 0.0368 at 0.2
      const legacyLinear = Math.min(1, 0.30 + 0.70 * rho);        // grid patternMul 1.0
      expect(k).toBeGreaterThan(bareGA);
      expect(k).toBeLessThan(legacyLinear);
    }
  });

  it("non-CLT single-material E_xy uses the shared knockdown and preserves the E_z/E_xy ratio", () => {
    for (const rho of [0.2, 0.5]) {
      const k = lumpedInPlaneStiffnessScale(PAT, rho, wc1);
      const solid = buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null);
      const part  = buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null, null, k);
      expect(part.E_xy / solid.E_xy).toBeCloseTo(k, 12);
      expect(part.E_z  / solid.E_z ).toBeCloseTo(k, 12);
      // Anchor: at ρ=1 the built part IS the solid, bit-for-bit.
      const anchor = buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null, null,
        lumpedInPlaneStiffnessScale(PAT, 1, wc1));
      expect(anchor.E_xy).toBe(solid.E_xy);
    }
  });

  it("CLT and non-CLT single-material paths agree on the in-plane knockdown RATIO to <1% (unified ρ-law)", () => {
    const bead = DEFAULT_BEAD_PROPS["pla"]!;
    const stack = PATTERN_PLY_ANGLES[PAT]!;
    for (const rho of [0.2, 0.5]) {
      const k = lumpedInPlaneStiffnessScale(PAT, rho, wc1);

      // Non-CLT isotropic-base path: E_xy scales by k.
      const nSolid = buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null);
      const nPart  = buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null, null, k);
      const rNon = nPart.E_xy / nSolid.E_xy;

      // CLT path: the SAME k is the A-matrix scale, and CLT E is linear in A.
      const cSolid = buildLaminateCMatrix(bead, stack.angles, stack.fracs, 1.0, 1400, 0.30, 540, 50, 29, "s");
      const cPart  = buildLaminateCMatrix(bead, stack.angles, stack.fracs, k,   1400, 0.30, 540, 50, 29, "p");
      const rCLT = cPart.E_xy / cSolid.E_xy;

      // Both knockdown ratios equal k (the shared law) — the cross-path swing is
      // gone. Absolute E still differs (CLT laminate vs isotropic base), by design.
      expect(rNon).toBeCloseTo(k, 10);
      expect(rCLT).toBeCloseTo(k, 6);
      expect(Math.abs(rNon - rCLT) / rNon).toBeLessThan(0.01);
    }
  });
});
