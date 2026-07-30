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
  /** In-plane strength power-law exponent m_xy in s = min(1, patternMul·ρ^m)
   *  (yieldXY). This is the representative scalar `latticeStrengthFraction`
   *  returns — its value is unchanged from the pre-per-axis `strengthExp`. */
  readonly strengthExpXY:  number;
  /** Through-layer strength exponent m_z (yieldZ). Per-axis so the strength
   *  anisotropy tracks the stiffness anisotropy (issue #177): for extruded
   *  walls the continuous vertical walls give the mildest law (rule of
   *  mixtures, m ≈ 1), so at low ρ yieldZ_core can exceed yieldXY_core, exactly
   *  as E_z_core exceeds E_xy_core — the sign of (Z − XY) now agrees between
   *  stiffness and strength. */
  readonly strengthExpZ:   number;
  /** Interlaminar-shear strength exponent m_zs (yieldZShear). */
  readonly strengthExpZS:  number;
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
    stiffExpXY: 1.75, stiffCorrXY: 0.12, stiffPrefactor: 1.0,
    // Strength stretch-dominated; per-axis exponents MIRROR the stiffness
    // ordering (XY < Z < Gxz) so the near-isotropic core keeps Z weaker AND
    // softer than XY at low ρ (both signs already agreed here; the per-axis
    // law keeps them consistent). m_xy unchanged from the legacy strengthExp.
    strengthExpXY: 1.25, strengthExpZ: 1.5, strengthExpZS: 1.6,
    stiffExpZ: 2.1, stiffCorrZ: 0.18, stiffExpGxz: 2.3, stiffCorrGxz: 0.22, stiffExpGxy: null,
    confidence: "LOW",
  },
  // Extruded wall networks: bending-dominated in-plane → Gibson-Ashby
  // open-cell n ≈ 2; plastic collapse m = 1.5; stiff along the build axis
  // (continuous walls → rule of mixtures, n = 1).
  walls25d: {
    family: "walls25d",
    stiffExpXY: 2.0, stiffCorrXY: 0.10, stiffPrefactor: 1.0,
    // Per-axis strength (issue #177): in-plane bending collapse m_xy = 1.5
    // (unchanged from the legacy strengthExp); through-layer follows the
    // continuous vertical walls (rule of mixtures m_z = 1.0, matching gZ's
    // n = 1) so the strength anisotropy INVERTS at low ρ just like the
    // stiffness; interlaminar shear stays conservative at 1.5.
    strengthExpXY: 1.5, strengthExpZ: 1.0, strengthExpZS: 1.5,
    stiffExpZ: 1.0, stiffCorrZ: 0.0, stiffExpGxz: 1.5, stiffCorrGxz: 0.10, stiffExpGxy: 3.0,
    confidence: "LOW",
  },
  // Lightning: decorative — prefactor 0.3 on top of the power law.
  sparse: {
    family: "sparse",
    stiffExpXY: 2.0, stiffCorrXY: 0.0, stiffPrefactor: 0.3,
    // Decorative — isotropic strength (no directional wall network to credit).
    strengthExpXY: 1.5, strengthExpZ: 1.5, strengthExpZS: 1.5,
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

/**
 * Geometry-free solid-perimeter volume-fraction proxy for the LUMPED
 * single-material paths (issue #176). The non-two-region analysis has no mesh
 * classification, so the perimeter contribution is estimated from wall count
 * alone: ~10% of a small part's cross-section per perimeter loop, capped well
 * below solid. This is the SAME +0.10-per-wall heuristic the mass model uses
 * (effectiveVolumeFraction) — LOW confidence, and superseded by the two-region
 * model's exact per-element wall fraction whenever geometry is available.
 */
export function wallCreditFraction(wallCount: number): number {
  return Math.min(0.9, Math.max(0, wallCount) * 0.10);
}

/**
 * Unified LUMPED in-plane stiffness knockdown for the single-material paths
 * (issue #176): a Voigt (iso-strain) volume average of solid perimeter walls
 * and a Gibson-Ashby infill core,
 *
 *     knockdown = wallCredit + (1 − wallCredit) · g_GA(ρ)
 *
 * i.e. the lumped limit of the two-region model's E_eff = Vf·E_solid +
 * (1−Vf)·E_solid·g(ρ). Both the CLT and the non-CLT single-material paths route
 * their density knockdown through THIS one law (the CLT path passes it as the
 * A-matrix scale, the non-CLT path as the E_xy scale), replacing the three
 * inconsistent laws (linear-ρ, 0.30+0.70ρ, bare Gibson-Ashby) that swung a 20%
 * part 2–5× across toggles.
 *
 * Anchor (invariant #8): g_GA(1) = 1 exactly for structural patterns, so
 * knockdown(ρ=1) = wallCredit + (1−wallCredit) = 1 EXACTLY regardless of wall
 * credit — 100% infill reproduces the solid across every path. Floored
 * implicitly by g_GA's own LATTICE_STIFFNESS_FLOOR and the wall credit.
 */
export function lumpedInPlaneStiffnessScale(
  pattern: string,
  rho: number,
  wallCredit: number,
  overrideExp?: number | null,
): number {
  const g = latticeStiffnessScale(pattern, rho, overrideExp);
  const w = Math.min(1, Math.max(0, wallCredit));
  return Math.min(1, w + (1 - w) * g);
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

/** Per-axis wall-free lattice strength fractions in the NATURAL material frame
 *  (local Z = layer normal = build axis), each s = min(1, patternMul·ρ^m). */
export interface LatticeStrengthScales {
  /** Scales yieldXY (in-plane). Representative scalar (see latticeStrengthFraction). */
  readonly sXY:  number;
  /** Scales yieldZ (through-layer). */
  readonly sZ:   number;
  /** Scales yieldZShear (interlaminar shear). */
  readonly sZS:  number;
}

/**
 * Per-axis wall-free lattice strength fractions s_a(ρ) = max(floor,
 * min(1, patternMul·ρ^m_a)) for a = XY, Z, ZS (issue #177).
 *
 * The single scalar `latticeStrengthFraction` knocked yieldXY, yieldZ, and
 * yieldZShear down by the SAME factor, so the core kept the solid's
 * yieldZ/yieldXY = 0.58 ratio while the per-axis STIFFNESS law inverted the
 * anisotropy (E_z > E_xy for extruded walls at low ρ) — the model claimed
 * Z-stiffer-yet-Z-weaker at once. Per-axis strength exponents (mirroring the
 * stiffness family structure) fix the sign inconsistency.
 *
 * Anchors (invariant #8): Math.pow(1, m) = 1, so every s_a(1) = min(1, patternMul)
 * EXACTLY and identically across axes — the 100%-infill materialsEqual collapse
 * is preserved. Floored at LATTICE_STRENGTH_FLOOR.
 *
 * A calibration `overrideExp` (a single fitted number) applies to ALL axes
 * uniformly — collapsing to the isotropic-in-ratio strength law, exactly as the
 * stiffness override routes to the scalar `latticeStiffnessScale`. One fitted
 * exponent cannot say which axis it belongs to.
 */
export function latticeStrengthFractions(
  pattern: string,
  rho: number,
  overrideExp?: number | null,
): LatticeStrengthScales {
  const p = LATTICE_PARAMS[patternFamilyOf(pattern)];
  const patternMul = PATTERN_MULTIPLIERS[pattern] ?? 1.0;
  const r = clampRho(rho);
  const s = (m: number) => Math.max(LATTICE_STRENGTH_FLOOR, Math.min(1, patternMul * Math.pow(r, m)));
  return {
    sXY: s(overrideExp ?? p.strengthExpXY),
    sZ:  s(overrideExp ?? p.strengthExpZ),
    sZS: s(overrideExp ?? p.strengthExpZS),
  };
}

/**
 * Representative (in-plane) wall-free lattice strength fraction
 * s_xy(ρ) = max(floor, min(1, patternMul·ρ^m_xy)) — the yieldXY axis of
 * latticeStrengthFractions.
 *
 * Kept as the single source for BOTH coreStrengthMultiplier (which multiplies
 * by orientationMultiplier) and the impliedAvgStrengthMul diagnostic in
 * analysis.ts, so the two can never desynchronize; in-plane is what coupons
 * measure. Its VALUE is unchanged from the pre-per-axis law (m_xy equals the
 * old strengthExp), so every locked regression value holds.
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
  return latticeStrengthFractions(pattern, rho, overrideExp).sXY;
}
