/**
 * lattice.ts
 * ----------
 * Gibson-Ashby homogenization laws for FDM infill lattices — the wall-free
 * CORE region of the two-region material model (twoRegion.ts).
 *
 * Model: cellular-solid power laws (Gibson & Ashby 1997):
 *   stiffness  g(ρ) = pf · ρ^n · (1 − c(1−ρ))       E_core = E_solid · g(ρ)
 *   strength   s(ρ) = min(1, patternMul · ρ^m)       σ_core = σ_solid · s(ρ)
 * with n ∈ [1.5, 2.5] for open-cell (bending-dominated) solids and lower for
 * stretch-dominated topologies; m ≈ 1.5 for bending-dominated plastic
 * collapse, ~1.2–1.3 for stretch-dominated TPMS lattices.
 *
 * The power-law FORM is cited (Gibson & Ashby 1997; SOURCES entry
 * "gibson_ashby1997"). The specific exponents and correction factors are
 * STORMFEA engineering estimates chosen WITHIN the cited ranges — confidence
 * LOW — locked by regression tests (server/tests/unit/core-lattice.test.ts)
 * and overridable per calibration profile. The tpms3d stiffness coefficients
 * are the pre-existing gyroid estimates (element.ts, gyroid-formula.test.ts).
 *
 * NUMERICAL HOMOGENIZATION (server/homogenize.ts) exists to raise this from a
 * guess-within-a-range to a solver-derived value, but its first-order cell (a
 * single circular perforation) is stress-concentration-dominated (n≈2.5–3, the
 * hole's Kt≈3 compliance) and does NOT reproduce a periodic wall network's
 * n≈2 — so it corroborates the METHOD (validated against isolated-hole theory,
 * solver_validation group 26) but is NOT yet evidence to lift these exponents
 * above LOW. The concrete path to MEDIUM is a periodic SQUARE-void RVE with
 * multi-direction load averaging (or physical coupon calibration → HIGH).
 *
 * ANCHOR INVARIANT (CLAUDE.md two-region invariant #8): g(1) = 1 and
 * s(1) = min(1, patternMul) EXACTLY (IEEE-754: Math.pow(1, n) === 1 and
 * 1 − c·0 === 1), so consumers that multiply solid properties by these scales
 * reproduce the solid bit-for-bit at 100% infill — the materialsEqual
 * degenerate collapse in twoRegion.ts depends on it. Never re-derive the
 * ρ=1 material through a parallel formula chain.
 *
 * FLOOR: both scales are floored at 1e-3 × solid so a 0%-infill core still
 * builds a positive-definite constitutive matrix (previously E = 0 threw in
 * buildOrthotropicConstitutiveMatrix). The resulting ~10³ shell:core
 * stiffness contrast at near-zero infill is acceptable for the Jacobi-PCG
 * solver and far below any structurally meaningful value.
 */

// ─── Pattern strength multipliers ────────────────────────────────────────────
// Conservative scalar adjustments — treat as approximate guidance only. The
// spread between patterns is kept small because the literature is
// inconsistent; orientation matters far more than pattern. (Moved verbatim
// from analysis.ts so the strength prefactor lives beside the exponents.)
export const PATTERN_MULTIPLIERS: Record<string, number> = {
  grid:         1.00,  // baseline
  lines:        0.92,  // weakest — unidirectional, highly anisotropic
  gyroid:       1.08,  // near-isotropic benefit — modest advantage
  cubic:        1.05,  // similar to gyroid for structural loads
  honeycomb:    1.03,  // strong in compression axis, competitive in tension
  trihexagon:   1.04,  // similar to honeycomb
  lightning:    0.50,  // decorative only, minimal structural contribution
  concentric:   0.88,  // weak structurally
  adaptive:     1.04,  // variable density, similar to cubic
};

// ─── Pattern families ────────────────────────────────────────────────────────

/**
 * Homogenization family of an infill pattern:
 * - tpms3d:   3-D near-isotropic lattices (TPMS / space-filling). Bending and
 *             stretching mix; stiffness degrades ~ρ^1.75.
 * - walls25d: 2.5-D extruded wall networks — continuous vertical walls along
 *             the build axis, bending-dominated in the layer plane.
 * - sparse:   decorative support-style infill with minimal structural
 *             contribution (lightning).
 */
export type PatternFamily = "tpms3d" | "walls25d" | "sparse";

export const PATTERN_FAMILY: Record<string, PatternFamily> = {
  gyroid:     "tpms3d",
  cubic:      "tpms3d",
  adaptive:   "tpms3d",
  grid:       "walls25d",
  lines:      "walls25d",
  honeycomb:  "walls25d",
  trihexagon: "walls25d",
  concentric: "walls25d",
  lightning:  "sparse",
};

export interface LatticeFamilyParams {
  readonly family:         PatternFamily;
  /** In-plane stiffness power-law exponent n (the Stage-1 scalar law uses
   *  the XY coefficients for ALL moduli — isotropic-in-ratio). */
  readonly stiffExpXY:     number;
  /** Linear correction c in g = pf·ρ^n·(1 − c(1−ρ)), in-plane. */
  readonly stiffCorrXY:    number;
  /** Prefactor pf: 1.0 for structural families, <1 for sparse. */
  readonly stiffPrefactor: number;
  /** Strength power-law exponent m in s = min(1, patternMul·ρ^m). */
  readonly strengthExp:    number;
  // Per-axis laws (natural frame: local Z = layer normal = build axis).
  // Consumed by the gyroid constitutive builder today and by the anisotropic
  // core model (Stage 2). tpms3d values are the pre-existing locked gyroid
  // coefficients; walls25d gZ is rule-of-mixtures along continuous vertical
  // walls, gGxy the classic Gibson-Ashby honeycomb in-plane shear ρ³.
  readonly stiffExpZ:      number;
  readonly stiffCorrZ:     number;
  readonly stiffExpGxz:    number;
  readonly stiffCorrGxz:   number;
  /** Explicit in-plane shear law; null = derive G_xy from the scaled E_xy. */
  readonly stiffExpGxy:    number | null;
  /** All exponents are engineering estimates within Gibson-Ashby ranges. */
  readonly confidence:     "LOW";
}

export const LATTICE_PARAMS: Record<PatternFamily, LatticeFamilyParams> = {
  // TPMS-like 3-D lattices: coefficients from the existing (regression-locked)
  // gyroid formula in element.ts; strength stretch-dominated.
  tpms3d: {
    family: "tpms3d",
    stiffExpXY: 1.75, stiffCorrXY: 0.12, stiffPrefactor: 1.0, strengthExp: 1.25,
    stiffExpZ: 2.1, stiffCorrZ: 0.18, stiffExpGxz: 2.3, stiffCorrGxz: 0.22, stiffExpGxy: null,
    confidence: "LOW",
  },
  // Extruded wall networks: bending-dominated in-plane → Gibson-Ashby
  // open-cell n ≈ 2; plastic collapse m = 1.5; stiff along the build axis
  // (continuous walls → rule of mixtures, n = 1).
  walls25d: {
    family: "walls25d",
    stiffExpXY: 2.0, stiffCorrXY: 0.10, stiffPrefactor: 1.0, strengthExp: 1.5,
    stiffExpZ: 1.0, stiffCorrZ: 0.0, stiffExpGxz: 1.5, stiffCorrGxz: 0.10, stiffExpGxy: 3.0,
    confidence: "LOW",
  },
  // Lightning: decorative — prefactor 0.3 on top of the power law.
  sparse: {
    family: "sparse",
    stiffExpXY: 2.0, stiffCorrXY: 0.0, stiffPrefactor: 0.3, strengthExp: 1.5,
    stiffExpZ: 2.0, stiffCorrZ: 0.0, stiffExpGxz: 2.0, stiffCorrGxz: 0.0, stiffExpGxy: null,
    confidence: "LOW",
  },
};

/** Family lookup with a conservative default for unknown pattern ids. */
export function patternFamilyOf(pattern: string): PatternFamily {
  return PATTERN_FAMILY[pattern] ?? "walls25d";
}

// ─── Floors ──────────────────────────────────────────────────────────────────
/**
 * Minimum stiffness/strength scale (× solid). Keeps every two-region bin's
 * constitutive matrix positive definite at 0% infill (E = 0 previously threw
 * during bin construction) while staying far below structural relevance.
 */
export const LATTICE_STIFFNESS_FLOOR = 1e-3;
export const LATTICE_STRENGTH_FLOOR  = 1e-3;

// ─── Laws ────────────────────────────────────────────────────────────────────

/**
 * Generalized Gibson-Ashby modulus: base·ρ^n·(1 − c(1−ρ)).
 *
 * Material-agnostic form of the gyroid power law previously hardcoded (with
 * PLA base values) in element.ts. The arithmetic ORDER matches that original
 * exactly so regression-locked values reproduce bit-for-bit.
 */
export function gibsonAshbyModulus(base: number, rho: number, n: number, c: number): number {
  const one_minus_rho = 1 - rho;
  return base * Math.pow(rho, n) * (1 - c * one_minus_rho);
}

function clampRho(rho: number): number {
  return Math.min(1, Math.max(0, rho));
}

/**
 * Stage-1 scalar stiffness knockdown g(ρ) for a wall-free homogenized lattice:
 * every modulus of the solid is multiplied by this factor (isotropic-in-ratio;
 * the solid's transverse-isotropy ratios are preserved).
 *
 * g(1) = 1 exactly for structural families (anchor invariant); floored at
 * LATTICE_STIFFNESS_FLOOR.
 *
 * @param overrideExp Calibration override for the exponent n (correction and
 *                    prefactor keep their family values).
 */
export function latticeStiffnessScale(
  pattern: string,
  rho: number,
  overrideExp?: number | null,
): number {
  const p = LATTICE_PARAMS[patternFamilyOf(pattern)];
  const n = overrideExp ?? p.stiffExpXY;
  const r = clampRho(rho);
  return Math.max(LATTICE_STIFFNESS_FLOOR, gibsonAshbyModulus(p.stiffPrefactor, r, n, p.stiffCorrXY));
}

/** Per-axis stiffness scale factors in the NATURAL material frame
 *  (local Z = layer normal = build axis). */
export interface LatticeAxisScales {
  /** Scales E_xy (and, when gGxy is null, the derived G_xy). */
  readonly gXY:  number;
  /** Scales E_z — the through-layer modulus. For extruded-wall patterns the
   *  walls are continuous ALONG the build axis, so this law is the mildest
   *  (rule of mixtures, n = 1) and the core's anisotropy inverts at low ρ. */
  readonly gZ:   number;
  /** Scales G_xz. */
  readonly gGxz: number;
  /** Explicit in-plane shear scale (walls25d: the classic Gibson-Ashby
   *  honeycomb ρ³ bending mode); null = derive G_xy from the scaled E_xy. */
  readonly gGxy: number | null;
}

/**
 * Stage-2 per-axis stiffness knockdowns for the anisotropic core model.
 * Applied to the solid's NATURAL-frame constants BEFORE any weakAxis
 * rotation or upright scalar swap (scaling and frame handling only commute
 * for the scalar law). Same anchors and floor as latticeStiffnessScale:
 * every factor is exactly pf at ρ=1 and floored at LATTICE_STIFFNESS_FLOOR.
 */
export function latticeStiffnessScales(pattern: string, rho: number): LatticeAxisScales {
  const p = LATTICE_PARAMS[patternFamilyOf(pattern)];
  const r = clampRho(rho);
  const floor = LATTICE_STIFFNESS_FLOOR;
  return {
    gXY:  Math.max(floor, gibsonAshbyModulus(p.stiffPrefactor, r, p.stiffExpXY,  p.stiffCorrXY)),
    gZ:   Math.max(floor, gibsonAshbyModulus(p.stiffPrefactor, r, p.stiffExpZ,   p.stiffCorrZ)),
    gGxz: Math.max(floor, gibsonAshbyModulus(p.stiffPrefactor, r, p.stiffExpGxz, p.stiffCorrGxz)),
    gGxy: p.stiffExpGxy === null
      ? null
      : Math.max(floor, gibsonAshbyModulus(p.stiffPrefactor, r, p.stiffExpGxy, 0)),
  };
}

/**
 * Wall-free lattice strength fraction s(ρ) = max(floor, min(1, patternMul·ρ^m)).
 *
 * Excludes orientation — the single source for BOTH coreStrengthMultiplier
 * (which multiplies by orientationMultiplier) and the impliedAvgStrengthMul
 * diagnostic in analysis.ts, so the two can never desynchronize.
 *
 * s(1) = min(1, patternMul) exactly — identical to the legacy linear curve's
 * ρ=1 value pattern-for-pattern, preserving the 100%-infill degenerate
 * collapse behavior (fires for patternMul ≥ 1, doesn't for lines/concentric/
 * lightning).
 */
export function latticeStrengthFraction(
  pattern: string,
  rho: number,
  overrideExp?: number | null,
): number {
  const p = LATTICE_PARAMS[patternFamilyOf(pattern)];
  const m = overrideExp ?? p.strengthExp;
  const patternMul = PATTERN_MULTIPLIERS[pattern] ?? 1.0;
  const r = clampRho(rho);
  return Math.max(LATTICE_STRENGTH_FLOOR, Math.min(1, patternMul * Math.pow(r, m)));
}
