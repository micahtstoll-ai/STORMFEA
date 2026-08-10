/**
 * analysis.ts
 * -----------
 * The core analysis pipeline for the local STORMFEA server.
 *
 * Takes:
 *   - STL positions (Float32Array)
 *   - Hole constraints (which hole IDs are bolted, from the UI)
 *   - Applied forces (magnitude + direction + location, from the UI)
 *   - Print settings (material, infill %, orientation)
 *
 * Returns:
 *   - Per-vertex von Mises stress (for heatmap on the surface)
 *   - Summary numbers (max stress, safety factor, displacement)
 *   - Failure assessment
 */

import { generateBoxMeshC3D4, generateBoxMeshC3D10, extractSurfaceFaces } from "./solver/meshgen.js";
import { runLinearStaticWithK }            from "./solver/pipeline.js";
import { runModalAnalysis }                from "./solver/modal.js";
import { runLinearBuckling }              from "./solver/buckling.js";
import { assembleK, assembleKsigma, buildSparsityPattern } from "./solver/assembly.js";
import { buildNodeElementAdjacency }       from "./solver/adjacency.js";
import { applyDirichletBC }    from "./solver/boundary.js";
import { assembleForceVector, assembleBodyForce, assembleSurfaceTraction, assembleSurfaceTractionNormal, selectPressureRegion, assembleTaperedFaceLoad, assembleContactPatchLoad } from "./solver/load.js";
import type { ModalAnalysisResult }        from "./solver/types.js";
import {
  buildLaminateCMatrix,
  DEFAULT_BEAD_PROPS,
  PATTERN_PLY_ANGLES,
  type BeadProperties,
} from "./solver/laminate.js";
import {
  predictBondMultipliers,
  bondBandExcursion,
  hasProcessSettings,
  WALL_THERMAL_DEPTH_CLAMP_MM,
  type ProcessSettings,
  type BondModelCoeffs,
  type BondPrediction,
} from "./solver/bond.js";
export { fitBondCoeffs, type BondSweepPoint } from "./solver/bond.js";

/**
 * Fallback characteristic inter-pass revisit length for the wall-to-wall
 * bond model when the geometric perimeter estimate degenerates (near-zero
 * part height, no classified perimeter faces). LOW confidence — a rough
 * "typical small-part perimeter" placeholder, not fitted to any data.
 */
const WALL_BOND_PASS_LENGTH_FALLBACK_MM = 40;

// ─── Memory profiling snap helper ────────────────────────────────────────────
// Activated by STORMFEA_PROFILE_MEMORY=1. Mirrors the helper in pipeline.ts.
const _analysisProfileMem = process.env["STORMFEA_PROFILE_MEMORY"] === "1";
let _analysisLastHeapMB = 0;
function _snapAnalysis(label: string): void {
  if (!_analysisProfileMem) return;
  if (typeof globalThis.gc === "function") globalThis.gc();
  const heapMB = process.memoryUsage().heapUsed / 1024 / 1024;
  const deltaMB = heapMB - _analysisLastHeapMB;
  console.log(`[mem/analysis] ${label}: heap=${heapMB.toFixed(1)}MB delta=${deltaMB >= 0 ? "+" : ""}${deltaMB.toFixed(1)}MB`);
  _analysisLastHeapMB = heapMB;
}
import type { SolverInput }                 from "./solver/pipeline.js";
import type { IsotropicMaterial, AnyMaterial, OrthotropicMaterial, ElementMaterialField, WallBondField } from "./solver/types.js";
import { buildTwoRegionField, buildWallBondField, estimateWallLoopPerimeterMm, TWO_REGION_MAX_ELEMENTS } from "./twoRegion.js";
import {
  LATTICE_PARAMS,
  LATTICE_STIFFNESS_FLOOR,
  PATTERN_MULTIPLIERS,
  latticeStiffnessScale,
  latticeStiffnessScales,
  latticeStrengthFraction,
  latticeStrengthFractions,
  latticeStrengthExpExcursion,
  lumpedInPlaneStiffnessScale,
  wallCreditFraction,
  patternFamilyOf,
  dfaPressureSensitivity,
} from "./solver/lattice.js";
import { isOrthotropic, isOrthotropicLike } from "./solver/types.js";
import { recoverElementStressComponents }   from "./solver/stress_detail.js";
import { rotationAligningZTo, rotateStress6ToLocal, computeGeometry } from "./solver/element.js";
import {
  sprSmoothedStress, sprSmoothedStress6, buildGaussSamples, vonMisesFromTensor6,
  recoverElementStress, nodeAveragedPrincipalStress,
  fdmInterfaceUtilization, interlaminarShearOf, INTERFACE_FRICTION_MU,
  type CriterionKind, type InPlaneAniso,
} from "./solver/stress.js";
import { flagMergedHoleWarnings }           from "./holes.js";
import type { HoleFeature }                 from "./holes.js";
import {
  meshWithTetGen, meshWithTetGenSizing, TetGenNotFoundError, probeTetGen,
  tetSizingForTier,
} from "./tetgen.js";
import { meshStepWithGmsh, gmshSizingForTier,
         GMSH_MAX_BUDGET_OVERSHOOT }        from "./gmsh_mesh.js";
import {
  MIN_ELEMENTS_THROUGH_THICKNESS,
  MESH_MAX_BUDGET_OVERSHOOT,
  achievedResolution,
  type MeshResolutionReport,
} from "./meshSizing.js";
import { tetCornerVolume }                  from "./solver/adaptiveMesh.js";
import { C3D10OrderingError }               from "./c3d10_ordering.js";
import {
  computeFingerprint, computeValidationCoverage,
  type ValidationCoverageReport, type CriterionValue as CoverageCriterionValue,
} from "./validation-coverage.js";
import {
  buildSizeField, relaxSizeFieldToBudget, shouldStopRefinement,
  bcDiscontinuityMask, BC_SINGULARITY_DILATE_HOPS, maskedErrorFraction,
  nodeCharacteristicSizes,
  smoothSizeFieldGradation, predictRefinedElementCount,
  judgeRemeshAgainstBudget, effectiveElementBudget,
  targetPerElementError, DEFAULT_LOOP_OPTIONS, DEFAULT_SIZE_FIELD_FACTORS,
  type LoopControlOptions, type SingularityRegion, type StopReason,
} from "./solver/adaptiveMesh.js";

// ─── Safety-factor verdict tiers (issue #141) ──────────────────────────────────
// Single source of truth for where "Safe" starts on the server. report.ts
// imports these directly (both run in the same Node process, so — unlike the
// client — there's a real shared import instead of a duplicated literal).
// client/index.html keeps identically-NAMED constants of its own (browser
// runtime, no shared module system with the server) — grep both when a
// threshold changes.
//
// Policy: "Safe" requires SF >= 2.0 (the recommended minimum margin). The
// 1.5–2.0 band is "Acceptable" — real positive margin, but never reported as
// Safe. Below 1.5 is "Marginal"; below 1.0 fails.
export const FAIL_SF_THRESHOLD       = 1.0;
export const ACCEPTABLE_SF_THRESHOLD = 1.5;
export const SAFE_SF_THRESHOLD       = 2.0;

// ─── Standard bolt database ───────────────────────────────────────────────────
/**
 * Standard bolt sizes with clearance and tap drill diameters.
 * Sources:
 *   Metric: ISO 273 clearance holes, ISO 724 tap drill sizes
 *   Inch:   ASME B18.2.8 clearance holes, ASME B1.1 tap drill sizes
 *           Values from Machinery's Handbook 29th Ed. pp. 1817–1862
 */

export interface BoltSize {
  label:          string;   // e.g. "M3", "#8-32"
  nominalMm:      number;   // nominal bolt diameter in mm
  clearanceClose: number;   // close-fit clearance hole diameter mm
  clearanceFree:  number;   // free-fit clearance hole diameter mm
  tapDrill75:     number;   // 75% thread tap drill diameter mm
  tapDrill50:     number;   // 50% thread tap drill diameter mm (softer materials)
  pitch:          number;   // thread pitch mm (for strip-out calculation)
  system:         "metric" | "inch";
}

// Exported for the #290 collision guard in
// server/tests/unit/classify-hole-clearance-collapse.test.ts: the twin-collapse
// in classifyHole is only safe for thread strip-out while the tapDrill75/50
// columns stay free of duplicates, and that has to be checked against the real
// table rather than asserted in a comment.
export const BOLT_SIZES: BoltSize[] = [
  // ── Metric coarse (ISO 724) ────────────────────────────────────────────────
  { label:"M2",   nominalMm:2.0,  clearanceClose:2.2,  clearanceFree:2.4,  tapDrill75:1.60, tapDrill50:1.75, pitch:0.40, system:"metric" },
  { label:"M2.5", nominalMm:2.5,  clearanceClose:2.7,  clearanceFree:2.9,  tapDrill75:2.05, tapDrill50:2.20, pitch:0.45, system:"metric" },
  { label:"M3",   nominalMm:3.0,  clearanceClose:3.2,  clearanceFree:3.4,  tapDrill75:2.50, tapDrill50:2.70, pitch:0.50, system:"metric" },
  // M3 nominal (3.0mm) — designers sometimes model tapped holes at nominal diameter
  { label:"M3 (nominal)", nominalMm:3.0, clearanceClose:3.0, clearanceFree:3.0, tapDrill75:3.0, tapDrill50:3.0, pitch:0.50, system:"metric" },
  { label:"M4",   nominalMm:4.0,  clearanceClose:4.3,  clearanceFree:4.5,  tapDrill75:3.30, tapDrill50:3.50, pitch:0.70, system:"metric" },
  { label:"M5",   nominalMm:5.0,  clearanceClose:5.3,  clearanceFree:5.5,  tapDrill75:4.20, tapDrill50:4.40, pitch:0.80, system:"metric" },
  { label:"M6",   nominalMm:6.0,  clearanceClose:6.4,  clearanceFree:6.6,  tapDrill75:5.00, tapDrill50:5.25, pitch:1.00, system:"metric" },
  { label:"M8",   nominalMm:8.0,  clearanceClose:8.4,  clearanceFree:9.0,  tapDrill75:6.80, tapDrill50:7.00, pitch:1.25, system:"metric" },
  { label:"M10",  nominalMm:10.0, clearanceClose:10.5, clearanceFree:11.0, tapDrill75:8.50, tapDrill50:8.75, pitch:1.50, system:"metric" },
  { label:"M12",  nominalMm:12.0, clearanceClose:13.0, clearanceFree:13.5, tapDrill75:10.20,tapDrill50:10.50,pitch:1.75, system:"metric" },
  // ── Unified inch coarse (ASME B1.1 UNC) ───────────────────────────────────
  { label:"#2-56",  nominalMm:2.18, clearanceClose:2.46, clearanceFree:2.77, tapDrill75:1.75, tapDrill50:1.98, pitch:0.453, system:"inch" },
  { label:"#4-40",  nominalMm:2.84, clearanceClose:3.05, clearanceFree:3.45, tapDrill75:2.26, tapDrill50:2.50, pitch:0.635, system:"inch" },
  { label:"#6-32",  nominalMm:3.51, clearanceClose:3.66, clearanceFree:4.01, tapDrill75:2.77, tapDrill50:3.07, pitch:0.794, system:"inch" },
  { label:"#8-32",  nominalMm:4.17, clearanceClose:4.37, clearanceFree:4.93, tapDrill75:3.45, tapDrill50:3.73, pitch:0.794, system:"inch" },
  { label:"#10-24", nominalMm:4.83, clearanceClose:5.16, clearanceFree:5.61, tapDrill75:3.81, tapDrill50:4.09, pitch:1.058, system:"inch" },
  { label:"#10-32", nominalMm:4.83, clearanceClose:5.16, clearanceFree:5.61, tapDrill75:4.04, tapDrill50:4.27, pitch:0.794, system:"inch" },
  { label:"1/4-20", nominalMm:6.35, clearanceClose:6.75, clearanceFree:7.14, tapDrill75:5.11, tapDrill50:5.41, pitch:1.270, system:"inch" },
  { label:"5/16-18",nominalMm:7.94, clearanceClose:8.33, clearanceFree:8.74, tapDrill75:6.53, tapDrill50:6.91, pitch:1.411, system:"inch" },
  { label:"3/8-16", nominalMm:9.53, clearanceClose:9.93, clearanceFree:10.31,tapDrill75:7.94, tapDrill50:8.33, pitch:1.588, system:"inch" },
  { label:"1/2-13", nominalMm:12.7, clearanceClose:13.10,clearanceFree:13.49,tapDrill75:10.72,tapDrill50:11.11,pitch:1.954, system:"inch" },
];

// ─── Hole classification ──────────────────────────────────────────────────────
export type HoleType = "clearance_close" | "clearance_free" | "tapped_75" | "tapped_50" | "ambiguous" | "nonstandard" | "oversized";

/** Human-readable labels for HoleType, for use in user-facing warning text.
 *  Without this, raw enum values like "tapped_75" leak directly into the UI
 *  (e.g. "M6 tapped_75"), which reads as a template bug rather than real
 *  engineering terminology. Wording matches the existing client-side label
 *  map (client/index.html, HOLE IDENTIFICATION panel) for consistency. */
const HOLE_TYPE_LABEL: Record<"clearance_close" | "clearance_free" | "tapped_75" | "tapped_50", string> = {
  clearance_close: "Clearance (close fit)",
  clearance_free:  "Clearance (free fit)",
  tapped_75:       "Tapped (75% thread)",
  tapped_50:       "Tapped (50% thread)",
};

export interface HoleClassification {
  type:         HoleType;
  bolt:         BoltSize | null;
  detectedDiamMm: number;
  warning:      string | null;
  /** For tapped holes: minor diameter (mm) for strip-out calculation */
  minorDiamMm?: number;
}

const MATCH_TOL = 0.20;  // mm — tolerance for matching detected diameter to standard

/** The BOLT_SIZES dimension classifyHole actually compares a match's `type` against. */
function matchedDimensionMm(bolt: BoltSize, type: HoleType): number {
  switch (type) {
    case "clearance_close": return bolt.clearanceClose;
    case "clearance_free":  return bolt.clearanceFree;
    case "tapped_75":       return bolt.tapDrill75;
    case "tapped_50":       return bolt.tapDrill50;
    default:                return NaN;
  }
}

export function classifyHole(
  radiusMm:        number,
  plateDimMinMm:   number,   // smallest plate dimension — for oversized check
): HoleClassification {
  const d = radiusMm * 2;

  // Oversized check — hole larger than 40% of smallest plate dimension
  if (d > plateDimMinMm * 0.40) {
    return { type:"oversized", bolt:null, detectedDiamMm:d,
      warning:`Hole diameter ${d.toFixed(2)}mm is >40% of the plate's smallest dimension (${plateDimMinMm.toFixed(1)}mm). This significantly weakens the net cross-section.` };
  }

  // Try to match against every standard size
  const matches: Array<{ bolt: BoltSize; type: HoleType; delta: number }> = [];

  for (const bolt of BOLT_SIZES) {
    const diffs = [
      { type: "clearance_close" as HoleType, delta: Math.abs(d - bolt.clearanceClose) },
      { type: "clearance_free"  as HoleType, delta: Math.abs(d - bolt.clearanceFree)  },
      { type: "tapped_75"       as HoleType, delta: Math.abs(d - bolt.tapDrill75)     },
      { type: "tapped_50"       as HoleType, delta: Math.abs(d - bolt.tapDrill50)     },
    ];
    for (const diff of diffs) {
      if (diff.delta <= MATCH_TOL) {
        matches.push({ bolt, type: diff.type, delta: diff.delta });
      }
    }
  }

  if (matches.length === 0) {
    return { type:"nonstandard", bolt:null, detectedDiamMm:d,
      warning:`Hole diameter ${d.toFixed(2)}mm does not match any standard metric or inch clearance or tap drill size (±0.2mm). Verify design intent — failure mode analysis may be inaccurate.` };
  }

  // Pick best match (smallest delta)
  matches.sort((a,b) => a.delta - b.delta);
  const best = matches[0]!;
  const bestValueMm = matchedDimensionMm(best.bolt, best.type);

  // Same-clearance twins (issue #290): another bolt matching the SAME type at
  // the IDENTICAL dimension as best (e.g. #10-24 / #10-32 both clearance-close
  // at 5.16mm — thread pitch doesn't move a clearance or tap-drill diameter).
  // These are not a second answer to "what size is this hole" — they're one
  // answer with an undetermined thread pitch — so they're excluded from the
  // ambiguity check below and reported as a group instead.
  const twins = matches.filter(m =>
    m.type === best.type &&
    m.bolt.label !== best.bolt.label &&
    matchedDimensionMm(m.bolt, m.type) === bestValueMm,
  );

  // Check for ambiguity — other good matches at a genuinely different size
  // (different dimension and/or a different hole type, e.g. clearance vs.
  // tap drill). Twins are excluded: matching precision can never separate
  // them, so flagging them "ambiguous" only hides the real question.
  const ambiguous = matches.filter(m =>
    m.delta < MATCH_TOL * 0.5 &&
    m.bolt.label !== best.bolt.label &&
    !(m.type === best.type && matchedDimensionMm(m.bolt, m.type) === bestValueMm),
  );
  if (ambiguous.length > 0) {
    return { type:"ambiguous", bolt:best.bolt, detectedDiamMm:d,
      warning:`Hole diameter ${d.toFixed(2)}mm could be ${best.bolt.label} (${HOLE_TYPE_LABEL[best.type as keyof typeof HOLE_TYPE_LABEL]}) or ${ambiguous[0]!.bolt.label} (${HOLE_TYPE_LABEL[ambiguous[0]!.type as keyof typeof HOLE_TYPE_LABEL]}). Verify which bolt is intended.` };
  }

  // Minor diameter for tapped holes — read off the representative bolt
  // (best.bolt), never the group-labelled one below: pitch is exactly the
  // dimension a twin group leaves undetermined, so it would be wrong to
  // pretend one value speaks for the whole group.
  const minorDiamMm = best.type.startsWith("tapped")
    ? best.bolt.nominalMm - best.bolt.pitch  // approximate minor diameter
    : undefined;

  // The diameter and type ARE resolved — warning stays null, matching every
  // other clean match, so report.ts's OK/warning coloring doesn't repaint a
  // correctly-identified hole as a defect (issue #290's core complaint).
  // What's genuinely undetermined (thread pitch) surfaces in `bolt.label`
  // instead, which every consumer already renders as plain text.
  const bolt = twins.length > 0
    ? { ...best.bolt, label: [best.bolt.label, ...twins.map(t => t.bolt.label)].join(" / ") }
    : best.bolt;

  return {
    type:           best.type,
    bolt,
    detectedDiamMm: d,
    warning:        null,
    minorDiamMm,
  };
}

// ─── Failure mode checks ──────────────────────────────────────────────────────
export interface FailureModeResult {
  mode:        string;
  sf:          number;
  failForceN:  number;
  checked:     boolean;
  confidence:  "high" | "medium" | "low" | "unchecked";
  note:        string;
}

/** What `governingSafetyFactor` resolved. */
export interface GoverningSF {
  /** The governing (lowest) safety factor. */
  sf:    number;
  /**
   * The checked row that produced `sf`, or null when the FEM bulk-yield SF
   * governs and no explicit "Bulk yield" row exists to point at — which is the
   * case on every part without bolted holes, since `checkFailureModes` (the
   * only producer of that row) runs per hole.
   */
  mode:  FailureModeResult | null;
  /** Display name for `mode` — its `.mode`, or "Bulk yield". */
  label: string;
}

/**
 * THE governing safety factor (issue #278) — the minimum over the FEM
 * bulk-yield SF and every CHECKED analytic failure mode.
 *
 * One function, one value, three consumers: `summary.safetyFactor`,
 * `summary.estimatedFailForce` (= totalAppliedForce × it) and `summary.verdict`.
 * Before #278 the first two were `bulk.sf` while the verdict was already this
 * minimum, so the UI could print "SF 3.00× — Safe" directly beside
 * "Fails — predicted to yield at 283 N (Thread strip-out)". There is
 * deliberately no second code path that could drift from this one.
 *
 * `bulkSF` seeds the reduce EXPLICITLY rather than being relied on through the
 * "Bulk yield" row, because that row only exists on parts with bolted holes.
 * On a hole-free part the checked rows are the interlayer/buckling ones alone,
 * and their minimum can sit ABOVE the bulk SF — including the `sf = 999`
 * "tensile-dominated, no buckling mode" sentinel, which used to let the verdict
 * announce "Safe — large margin (SF 999.00×)" over an arbitrarily bad bulk SF.
 *
 * With NO checked rows this returns `bulkSF` itself — the same value, no
 * arithmetic applied — so such parts are bit-identical to the pre-#278 headline.
 */
export function governingSafetyFactor(
  bulkSF:       number,
  failureModes: ReadonlyArray<FailureModeResult>,
): GoverningSF {
  const checked = failureModes.filter(m => m.checked);
  const sf      = checked.reduce((lo, m) => Math.min(lo, m.sf), bulkSF);
  const mode    = checked.find(m => m.sf === sf) ?? null;
  return { sf, mode, label: mode?.mode ?? "Bulk yield" };
}

/**
 * The headline verdict sentence, built from the GOVERNING safety factor
 * (issue #278) — the same number `summary.safetyFactor` reports, so the two
 * can never land in different tiers.
 *
 * `governingModeLabel` is `GoverningSF.mode?.mode`: undefined/null means bulk
 * yield governs with no explicit row, and the sentence says "bulk yield".
 */
export function buildBaseVerdict(params: {
  lowestSF:           number;
  governingModeLabel: string | null | undefined;
  totalAppliedForceN: number;
  converged:          boolean;
  cgIterations:       number;
}): string {
  const { lowestSF, totalAppliedForceN, converged, cgIterations } = params;
  const gov = params.governingModeLabel ?? "bulk yield";
  return !converged
    // An unconverged solve gives an unreliable stress field, so the safety
    // factor cannot be trusted in either direction — never report "Safe".
    ? `Inconclusive — solver did not converge (${cgIterations} iters). ` +
      `SF ${lowestSF.toFixed(2)}× shown for reference only; re-run with a finer mesh or check constraints.`
    : lowestSF < FAIL_SF_THRESHOLD
    ? `Fails — predicted to yield at ${(totalAppliedForceN * lowestSF).toFixed(0)} N (${gov})`
    : lowestSF < ACCEPTABLE_SF_THRESHOLD
    ? `Marginal — limited margin (SF ${lowestSF.toFixed(2)}×, governed by ${gov})`
    : lowestSF < SAFE_SF_THRESHOLD
    // Real positive margin, but below the tool's recommended 2× minimum —
    // must never say "Safe" (issue #141: this used to fall into the "Safe —
    // adequate margin" branch below, contradicting the client's 2× threshold).
    ? `Acceptable — below recommended 2× margin (SF ${lowestSF.toFixed(2)}×, governed by ${gov})`
    : lowestSF < 2.5
    ? `Safe — adequate margin (SF ${lowestSF.toFixed(2)}×)`
    : `Safe — large margin (SF ${lowestSF.toFixed(2)}×)`;
}

/**
 * Headline "bulk yield" safety factor for the verdict (issue #97).
 *
 * For orthotropic materials the solver already evaluates the anisotropic
 * criterion per element (recoverElementStress → SolverResult.minSafetyFactor,
 * using the calibrated allowables of the material actually solved) — by
 * default the FDM dual criterion (bulk von Mises + interlayer interface),
 * or Hill (1948) on the hill-legacy path. That is the number that must drive
 * the verdict: the von Mises SF (effectiveYield / maxVM) applies the in-plane
 * yield in all directions and overestimates the margin of Z-dominated stress
 * states by up to yieldXY/yieldZ (~1.7×).
 *
 * The von Mises SF is still returned for display/comparison.
 */
export function computeBulkSF(params: {
  /** SolverResult.minSafetyFactor — anisotropic-criterion-based for orthotropic materials */
  minSafetyFactor:   number;
  /** SolverResult.maxVonMisesMPa */
  maxVonMisesMPa:    number;
  /** Scalar effective yield (literature × print multipliers), MPa */
  effectiveYieldMPa: number;
  /** The material the solver actually ran with */
  material:          AnyMaterial;
  /** Which criterion recoverElementStress evaluated (default fdm-interface). */
  criterionUsed?:    CriterionKind;
}): { sf: number; criterion: "fdm-interface" | "hill" | "von-mises"; vonMisesSF: number } {
  const { minSafetyFactor, maxVonMisesMPa, effectiveYieldMPa, material } = params;
  const vonMisesSF = effectiveYieldMPa / (maxVonMisesMPa || 0.001);
  // Only OrthotropicMaterial gets the anisotropic criterion in
  // recoverElementStress (GyroidOrthotropic falls back to von Mises there,
  // but against the material's own yield — still preferable to the
  // literature-only scalar).
  if (isOrthotropicLike(material) && isFinite(minSafetyFactor)) {
    return {
      sf:        minSafetyFactor,
      criterion: !isOrthotropic(material) ? "von-mises"
               : (params.criterionUsed ?? "fdm-interface") === "hill-legacy" ? "hill"
               : "fdm-interface",
      vonMisesSF,
    };
  }
  return { sf: vonMisesSF, criterion: "von-mises", vonMisesSF };
}

/**
 * Check all applicable failure modes for a bolted hole connection.
 *
 * Modes checked:
 *  1. Bulk yield (from FEM) — high confidence
 *  2. Net-section tension — high confidence (classical formula)
 *  3. Shear-out — medium confidence (classical formula, but inter-layer shear
 *     strength is estimated as a fraction of yield)
 *  4. Thread strip-out — medium confidence (inter-layer shear estimated)
 *  5. Bearing failure — low confidence (FDM-specific data lacking)
 *
 * Classical formulas from Shigley's Mechanical Engineering Design, 10th Ed.
 */
export function checkFailureModes(params: {
  holeClass:        HoleClassification;
  plateThicknessMm: number;
  edgeDistMm:       number;
  holeSeparationMm: number;
  appliedForceN:    number;
  /**
   * Scalar in-plane yield of the material actually solved (MPa) — should
   * include coupon calibration and CLT adjustments, not just literature
   * values (issue #97). Used by the analytic (non-FEM) checks below.
   */
  effectiveYieldMPa: number;
  bulkSF:           number;
  /** Which criterion produced bulkSF — labels the "Bulk yield" entry. */
  bulkCriterion?:   "fdm-interface" | "hill" | "von-mises";
  orientation:      string;
  layerHeightMm:    number;
  calibratedBearingStrMPa?: number | null;
  bearingStressMult?: number;
  /**
   * Interlaminar shear allowable S_zs of the solved material (MPa) — the
   * lap-shear-calibrated (or bond-model-predicted) value. When present it
   * replaces the legacy Sy × 0.42/0.58 × lhf estimate for shear-out and
   * thread strip-out (audit A5: those checks now consume the same allowable
   * the FEM interface criterion uses).
   */
  interlayerShearMPa?: number | null;
  /**
   * Per-failure-mode material selection for WALL-LINED holes under the
   * two-region model (issue #175). Slicers line every hole with dense
   * perimeter walls, so the bolt shank / thread bears on SHELL material, not
   * the volume-averaged shell/core blend that `effectiveYieldMPa` /
   * `interlayerShearMPa` carry (CLAUDE.md invariant #6: per-feature consumers
   * read the shell endpoint, whole-part consumers read the average). Present
   * ⇒ two-region active AND walls line the hole (wallCount ≥ 1): bearing uses
   * `wallShellYieldMPa`, thread strip-out uses `wallShellInterlayerShearMPa`.
   * Absent (single-material / no walls) ⇒ bit-identical to the average path.
   * Bulk / net-section / shear-out modes keep the average material.
   */
  wallShellYieldMPa?: number | null;
  wallShellInterlayerShearMPa?: number | null;
}): FailureModeResult[] {
  const { holeClass, plateThicknessMm, edgeDistMm, holeSeparationMm,
          appliedForceN, effectiveYieldMPa, bulkSF, orientation,
          layerHeightMm, calibratedBearingStrMPa } = params;
  const bearingStressMult = params.bearingStressMult ?? 1.0;
  // Wall-lined-hole shell selection (issue #175): null unless two-region walls
  // line this hole. Bearing/thread then read the dense perimeter allowable.
  const wallShellYield = params.wallShellYieldMPa ?? null;
  const wallShellShear = params.wallShellInterlayerShearMPa ?? null;
  const bulkCriterion     = params.bulkCriterion ?? "von-mises";

  const results: FailureModeResult[] = [];
  const bolt = holeClass.bolt;
  const d    = holeClass.detectedDiamMm;
  const F    = appliedForceN;
  const t    = plateThicknessMm;
  const Sy   = effectiveYieldMPa;
  const lhf  = layerHeightFactor(layerHeightMm);

  // Inter-layer shear strength: the material's own interlaminar allowable
  // when available (same S_zs the FEM interface criterion uses); otherwise
  // the legacy estimate as a fraction of yield.
  // Legacy base ratio (literature review June 2026):
  //   flat:   0.42 (was 0.40) — conservative, Z-direction failure
  //   upright: 0.58 (was 0.55) — aligned with yieldZ/yieldXY = 0.58
  // Source: Cojocaru et al. 2019 measured 0.59; Rodriguez et al. 2001 ~0.50.
  const shearBase     = orientation === "upright" ? 0.58 : 0.42;
  const shearStrength = params.interlayerShearMPa ?? (Sy * shearBase * lhf);
  const shearSrcNote  = params.interlayerShearMPa != null
    ? `material interlaminar allowable S_zs = ${shearStrength.toFixed(1)} MPa`
    : `${(shearBase*100).toFixed(0)}% of yield × layer height ${layerHeightMm}mm (factor ${lhf.toFixed(2)}×)`;

  // ── 1. Bulk yield (from FEM) ──────────────────────────────────────────────
  results.push({
    mode:       "Bulk yield",
    sf:          bulkSF,
    failForceN:  F * bulkSF,
    checked:     true,
    confidence:  "high",
    note:        bulkCriterion === "fdm-interface"
      ? "FDM dual criterion from FEM — bulk (bead) von Mises + interlayer interface (tension/shear interaction). Most reliable result."
      : bulkCriterion === "hill"
      ? "Hill (1948) anisotropic yield criterion from FEM — accounts for the weaker inter-layer (Z) direction. Most reliable result."
      : "Von Mises stress from FEM vs effective yield. Most reliable result.",
  });

  // ── 2. Net-section tension ─────────────────────────────────────────────────
  // Failure of the remaining cross-section between hole and plate edge
  // (or between two holes). Conservative: use hole-to-hole if closer than edge.
  // σ_net = F / ((w - d) × t)  where w = ligament width
  // Shigley's Eq. 6-3 equivalent
  if (holeSeparationMm > 0 || edgeDistMm > 0) {
    const ligament = Math.min(
      holeSeparationMm > 0 ? holeSeparationMm - d : Infinity,
      edgeDistMm > 0 ? edgeDistMm - d/2 : Infinity,
    );
    if (ligament > 0 && isFinite(ligament)) {
      const netArea  = ligament * t;
      const sigmaNet = F / netArea;
      const sf_net   = Sy / sigmaNet;
      results.push({
        mode:       "Net-section tension",
        sf:          +sf_net.toFixed(3),
        failForceN:  +(F * sf_net).toFixed(0),
        checked:     true,
        confidence:  "high",
        note:        `Remaining cross-section between holes/edges (ligament ${ligament.toFixed(1)}mm × ${t.toFixed(1)}mm thick). Classical formula — reliable.`,
      });
    }
  }

  // ── 3. Shear-out ──────────────────────────────────────────────────────────
  // Relevant when bolt is loaded laterally (shear force).
  // Two shear planes from hole edge to plate edge.
  // τ = F / (2 × (e - d/2) × t)  where e = edge distance from hole centre, d = hole diameter
  // Only meaningful for lateral loads — flag as low confidence for axial loads
  if (edgeDistMm > d/2) {
    const shearArea = 2 * (edgeDistMm - d/2) * t;
    const tau       = F / shearArea;
    const sf_shear  = shearStrength / tau;
    results.push({
      mode:       "Shear-out",
      sf:          +sf_shear.toFixed(3),
      failForceN:  +(F * sf_shear).toFixed(0),
      checked:     true,
      confidence:  "medium",
      note:        `Two shear planes from hole to plate edge. Inter-layer shear strength: ${shearStrength.toFixed(0)} MPa (${shearSrcNote}).`,
    });
  }

  // ── 4. Thread strip-out (tapped holes only) ────────────────────────────────
  if (bolt && (holeClass.type === "tapped_75" || holeClass.type === "tapped_50") && holeClass.minorDiamMm) {
    const minorD   = holeClass.minorDiamMm;
    const pitch    = bolt.pitch;
    const nThreads = Math.floor(t / pitch);
    const threadEngagementLength = nThreads * pitch * 0.5;
    const shearArea = Math.PI * minorD * threadEngagementLength;
    // Layer interfaces per thread = pitch / layerHeight
    // More crossings per thread = more delamination risk
    const crossingsPerThread = pitch / layerHeightMm;
    const penalty = threadLayerPenalty(pitch, layerHeightMm);
    // Wall-lined holes: the thread is cut into the dense perimeter, so it strips
    // through the SHELL interlaminar allowable, not the shell/core blend (#175).
    const threadBaseShear = wallShellShear ?? shearStrength;
    const threadShear = threadBaseShear * penalty;
    const sf_strip = (threadShear * shearArea) / F;
    const threadMatNote = wallShellShear != null
      ? ` Using wall (shell) interlaminar allowable ${threadBaseShear.toFixed(1)} MPa — the thread is cut into the dense perimeter, not the infill core.`
      : ``;
    results.push({
      mode:       "Thread strip-out",
      sf:          +sf_strip.toFixed(3),
      failForceN:  +(F * sf_strip).toFixed(0),
      checked:     true,
      confidence:  "medium",
      note:        `${nThreads} threads engaged (${t.toFixed(1)}mm / ${pitch}mm pitch). Each thread crosses ~${crossingsPerThread.toFixed(1)} layer boundaries (lh=${layerHeightMm}mm) — penalty ${(penalty*100).toFixed(0)}%. Strength estimate ±30%.${threadMatNote}`,
    });
  }

  // ── 5. Bearing failure (hole wall) ────────────────────────────────────────
  // σ_bearing = F / (d × t)  — bolt shaft bearing on projected hole area
  // Bearing strength ≈ 1.5–2× compressive yield for metals, ~1.0–1.2× for plastics
  // For FDM: conservative estimate 1.0× effective yield (no data for higher)
  // Peak bearing stress is higher with cosine-bearing distribution (≈π/2× uniform)
  if (bolt) {
    const boltD        = bolt.nominalMm;
    const bearingArea  = boltD * t;
    const sigmaBear    = (F * bearingStressMult) / bearingArea;
    // Bearing yield: calibrated bearing strength wins; else the SHELL yield for
    // a wall-lined two-region hole (the shank bears on the dense perimeter, not
    // the shell/core blend — #175); else the average yield (single-material).
    const bearingYield = wallShellYield ?? Sy;
    const bearingStr   = calibratedBearingStrMPa ?? bearingYield * 1.0;
    const sf_bearing   = bearingStr / sigmaBear;
    const isCalibrated = calibratedBearingStrMPa != null;
    const usesWallYield = !isCalibrated && wallShellYield != null;
    const distLabel    = bearingStressMult > 1.1 ? ` (peak from cosine-bearing distribution)` : ``;
    results.push({
      mode:       "Bearing (hole wall)",
      sf:          +sf_bearing.toFixed(3),
      // sf_bearing is already measured against the PEAK stress (F·mult / area),
      // so F·sf_bearing is the load at which that peak reaches the allowable.
      // Dividing by bearingStressMult a second time applied the cosine-bearing
      // concentration twice and made this row's failForceN disagree with its
      // own sf — and with every other mode, which all report F·sf.
      failForceN:  +(F * sf_bearing).toFixed(0),
      checked:     true,
      confidence:  isCalibrated ? "medium" : "low",
      note: isCalibrated
        ? `Bolt shaft (${boltD}mm) bears on hole wall (${t.toFixed(1)}mm). Using CALIBRATED bearing strength ${bearingStr.toFixed(0)} MPa from physical test.${distLabel}`
        : usesWallYield
        ? `Bolt shaft (${boltD}mm) bears on hole wall (${t.toFixed(1)}mm). Using wall (shell) yield ${bearingStr.toFixed(0)} MPa — slicers line the hole with dense perimeters, so the shank bears on shell, not the infill-averaged blend. Run bearing coupon to improve confidence.${distLabel}`
        : `Bolt shaft (${boltD}mm) bears on hole wall (${t.toFixed(1)}mm). Bearing strength assumed = yield strength — no FDM data. Run bearing coupon to improve confidence.${distLabel}`,
    });
  } else {
    results.push({
      mode:       "Bearing (hole wall)",
      sf:          0,
      failForceN:  0,
      checked:     false,
      confidence:  "unchecked",
      note:        "Cannot check — hole does not match a standard bolt size. Verify hole diameter.",
    });
  }

  // Sort by SF ascending so governing failure mode is first
  results.sort((a,b) => {
    if (!a.checked) return 1;
    if (!b.checked) return -1;
    return a.sf - b.sf;
  });

  return results;
}
// ─── Calibration system ───────────────────────────────────────────────────────
/**
 * A calibrated material profile — back-calculated from physical coupon tests.
 * Overrides literature defaults for a specific material/settings combination.
 */
export interface CalibrationProfile {
  id:               string;
  label:            string;
  materialId:       string;
  layerHeightMm:    number;
  createdAt:        string;
  yieldXY_MPa:      number | null;
  yieldZ_MPa:       number | null;
  E_xy_MPa:         number | null;
  bearingStr_MPa:   number | null;
  shearStr_MPa:     number | null;
  E_z_over_E_xy:    number;
  yieldZ_over_yieldXY: number;
  G_xz_over_G_xy:   number;
  /**
   * Interlaminar shear allowable S_zs from the lap-shear coupon (Kt-corrected
   * peak, MPa). Independent of yieldZ since the criterion decoupling (audit
   * A5) — lap-shear is no longer converted into yieldZ unless no Z-tension
   * measurement exists. Absent on older stored profiles.
   */
  interShear_MPa?:  number | null;
  /** S_zs / S_zt ratio applied to the final yieldZ; default 1/√3 when absent. */
  interShear_over_yieldZ?: number | null;
  /**
   * True when yieldZ_MPa was DERIVED from the lap-shear measurement via the
   * legacy Hill relation (τ/0.58) because no Z-tension coupon was entered —
   * flags the delamination row's confidence as literature-grade.
   */
  yieldZFromShear?: boolean;
  /**
   * Printer/filament-fitted bead-penetration bond-model coefficients from a
   * process sweep (POST /api/calibration/bond-sweep → fitBondCoeffs). Absent
   * = literature defaults (confidence LOW).
   */
  bondCoeffs?: BondModelCoeffs | null;
  /**
   * Measured in-plane cross-bead tensile strength as a fraction of the
   * along-bead (in-plane) yield, 0 < r < 1 (feature #6). From a raster-oriented
   * tensile coupon; overrides the literature default when in-plane anisotropy
   * is enabled. Absent = no measurement.
   */
  crossBeadRatio?: number | null;
  /**
   * Optional overrides for the two-region core's Gibson-Ashby exponents
   * (solver/lattice.ts). Escape hatch for printer-specific lattice data —
   * there is no coupon-fitting workflow for these yet. Absent/null = family
   * defaults. Older stored profiles simply lack the keys.
   */
  latticeStiffExp?:    number | null;
  latticeStrengthExp?: number | null;
  /**
   * Optional fatigue calibration fitted from cyclic coupon data
   * (POST /api/calibration/fatigue → fitFatigueProfile). Absent/null = the
   * literature default S-N model (confidence LOW). Present = a printer-specific
   * S-N fit that flips estimateFatigue to MEDIUM confidence, exactly as a
   * measured bearing coupon flips the bearing mode LOW→MEDIUM.
   */
  fatigueSeRatio?:   number | null;   // endurance ratio Se/UTS at the endurance life
  fatigueBasquinB?:  number | null;   // fitted Basquin exponent b (negative)
  fatigueUTS_MPa?:   number | null;   // UTS used as the S-N strength basis
  /**
   * Fit quality of the S-N regression that produced the fields above (issue
   * #179). "poor" (logRms > FATIGUE_LOGRMS_MAX) forces estimateFatigue to keep
   * LOW confidence even though calibrated values are present — the measured
   * scatter did not earn the LOW→MEDIUM upgrade. Absent/"good"/null = a clean
   * fit (or a legacy profile) behaves exactly as before.
   */
  fatigueFitQuality?: "good" | "poor" | null;
}

/** One (stress amplitude, cycles-to-failure) point from a fatigue coupon. */
export interface FatigueCouponPoint {
  stressAmplitudeMPa: number;
  cycles:             number;
}

/**
 * Fit-quality gate for the cyclic-coupon S-N fit (issue #179). `logRms` is the
 * RMS residual of the log-log Basquin regression, i.e. the typical multiplicative
 * scatter in stress amplitude: logRms 0.15 ≈ e^0.15 ≈ ±16% about the fitted line.
 * Clean data fits to ~0 (fatigue-calibration.test.ts). Unlike the bond sweep this
 * endpoint does NOT reject above the bound — S-N scatter is physically inherent,
 * so a team's own noisy coupons are still their best available data. Instead a
 * poor fit is ACCEPTED but KEPT AT LOW CONFIDENCE (fitQuality: "poor" carried into
 * the profile): estimateFatigue still uses the measured Se/b but must not claim
 * the LOW→MEDIUM upgrade a clean fit earns.
 */
export const FATIGUE_LOGRMS_MAX = 0.15;

export interface FatigueFit {
  /** Fitted Basquin exponent b (σ_a = σ_f′·N^b), negative. */
  basquinB:   number;
  /** Fitted fatigue-strength coefficient σ_f′ (MPa). */
  sigmaF_MPa: number;
  /** Endurance limit Se at `enduranceLifeCycles` (MPa). */
  se_MPa:     number;
  /** Se / UTS. */
  seRatio:    number;
  /** RMS residual of the log-log fit (fit-quality diagnostic). */
  logRms:     number;
  /** "good" when logRms ≤ FATIGUE_LOGRMS_MAX, else "poor" (issue #179). */
  fitQuality: "good" | "poor";
}

/**
 * Least-squares fit of the Basquin S-N law σ_a = σ_f′·N^b to measured coupon
 * points, in log-log space (ln σ_a = ln σ_f′ + b·ln N). Needs ≥2 points at
 * distinct lives. The endurance limit is read off the fitted line at
 * `enduranceLifeCycles` (default 1e6). This turns real cyclic-test data into
 * the two constants estimateFatigue otherwise takes from literature.
 */
export function fitFatigueProfile(
  points: FatigueCouponPoint[],
  utsMPa: number,
  enduranceLifeCycles = 1e6,
): FatigueFit {
  const pts = points.filter(p => p.stressAmplitudeMPa > 0 && p.cycles > 0);
  if (pts.length < 2) {
    throw new Error("fitFatigueProfile needs ≥2 coupon points with positive amplitude and cycles.");
  }
  // Linear regression of y=ln σ_a on x=ln N.
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  const n = pts.length;
  for (const p of pts) {
    const x = Math.log(p.cycles);
    const y = Math.log(p.stressAmplitudeMPa);
    sx += x; sy += y; sxx += x * x; sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-12) {
    throw new Error("fitFatigueProfile: coupon points must span distinct cycle counts.");
  }
  const b = (n * sxy - sx * sy) / denom;           // slope
  const lnSigmaF = (sy - b * sx) / n;              // intercept
  const sigmaF = Math.exp(lnSigmaF);

  let sq = 0;
  for (const p of pts) {
    const predicted = lnSigmaF + b * Math.log(p.cycles);
    sq += (predicted - Math.log(p.stressAmplitudeMPa)) ** 2;
  }
  const logRms = Math.sqrt(sq / n);

  const se = sigmaF * Math.pow(enduranceLifeCycles, b);
  return {
    basquinB:   b,
    sigmaF_MPa: sigmaF,
    se_MPa:     se,
    seRatio:    utsMPa > 0 ? se / utsMPa : 0,
    logRms,
    fitQuality: logRms <= FATIGUE_LOGRMS_MAX ? "good" : "poor",
  };
}

export const COUPON_DIMS = {
  tensile: {
    gaugeWidthMm:   10.0,
    gaugeThickMm:    4.0,
    gaugeLengthMm:  50.0,
    description:    "Standard dog-bone, print flat, pull along length",
  },
  /**
   * Same dog-bone geometry as `tensile`, printed STANDING ON END so the gauge
   * axis is the build (Z) direction — every layer interface in the gauge is
   * loaded in pure opening tension. Measures the bond tensile allowable S_zt
   * (yieldZ) DIRECTLY (audit A5). Uniform gauge ⇒ Kt ≈ 1, plain F/A.
   */
  zTensile: {
    gaugeWidthMm:   10.0,
    gaugeThickMm:    4.0,
    gaugeLengthMm:  50.0,
    description:    "Dog-bone printed STANDING (gauge axis = build Z), pull along length — measures inter-layer tensile strength",
  },
  lapShear: {
    overlapWidthMm:  20.0,
    overlapLengthMm: 20.0,
    thicknessMm:      4.0,
    description:    "Two tabs, 20×20mm overlap, print flat, pull apart along tab length",
  },
  bearing: {
    holeDiamMm:      3.2,
    plateLengthMm:   40.0,
    plateWidthMm:    20.0,
    plateThickMm:     4.0,
    edgeDistMm:      10.0,
    description:    "Plate with M3 clearance hole, print flat, pull bolt laterally",
  },
} as const;

export function backCalculateProfile(params: {
  id:              string;
  label:           string;
  materialId:      string;
  layerHeightMm:   number;
  tensileFailN:    number | null;
  lapShearFailN:   number | null;
  bearingFailN:    number | null;
  tensileDeflMm:   number | null;
  /**
   * Failure load of the upright-printed Z-tension dog-bone (N). Measures the
   * bond tensile allowable S_zt (yieldZ) DIRECTLY — with it present, the
   * lap-shear coupon stays a pure interlaminar-shear measurement instead of
   * being converted into yieldZ via the legacy Hill τ/0.58 relation
   * (audit A5). Uniform gauge ⇒ plain F/A, no Kt.
   */
  zTensileFailN?:  number | null;
  /**
   * Stress-concentration factors from FEA-in-the-loop (see coupon_fea.ts).
   * Kt = peak/nominal stress for that coupon's geometry. Converts the nominal
   * F/A strength into a PEAK-based allowable consistent with how STORMFEA
   * evaluates real parts. Omit (or 1.0) to fall back to plain nominal F/A.
   *
   * Tensile is intentionally NOT corrected: its gauge is uniform by design, so
   * Kt ≈ 1 and F/A is the standard, correct measure.
   */
  ktLapShear?:     number;
  ktBearing?:      number;
}): CalibrationProfile {
  const { id, label, materialId, layerHeightMm,
          tensileFailN, lapShearFailN, bearingFailN, tensileDeflMm } = params;
  const ktLapShear = params.ktLapShear ?? 1.0;
  const ktBearing  = params.ktBearing  ?? 1.0;

  const lit = MATERIALS[materialId] ?? MATERIALS["pla"]!;

  // Tensile: F/A. The dog-bone gauge is uniform by design (failure forced into
  // the constant-section region), so nominal stress = peak stress and no Kt
  // correction is warranted — this is the ASTM-standard measure.
  let yieldXY_MPa: number | null = null;
  let E_xy_MPa:    number | null = null;
  if (tensileFailN !== null) {
    const area  = COUPON_DIMS.tensile.gaugeWidthMm * COUPON_DIMS.tensile.gaugeThickMm;
    yieldXY_MPa = tensileFailN / area;
  }
  if (tensileDeflMm !== null && tensileFailN !== null) {
    const stress = tensileFailN / (COUPON_DIMS.tensile.gaugeWidthMm * COUPON_DIMS.tensile.gaugeThickMm);
    const strain = tensileDeflMm / COUPON_DIMS.tensile.gaugeLengthMm;
    E_xy_MPa = strain > 0 ? stress / strain : null;
  }

  // Z-tension: direct measurement of the bond tensile allowable S_zt. Same
  // uniform dog-bone gauge as the flat tensile coupon (printed standing), so
  // it is the same ASTM-style F/A with no Kt.
  let yieldZ_MPa:    number | null = null;
  let yieldZFromShear = false;
  const zTensileFailN = params.zTensileFailN ?? null;
  if (zTensileFailN !== null) {
    const areaZ = COUPON_DIMS.zTensile.gaugeWidthMm * COUPON_DIMS.zTensile.gaugeThickMm;
    yieldZ_MPa = zTensileFailN / areaZ;
  }

  // Lap-shear: the allowable is the APPARENT (average) interlaminar shear
  // strength F/A_overlap. Kt is ≡ 1.0 BY POLICY (issue #140), not measured: the
  // end-of-overlap shear peak in a single-lap joint is a geometric singularity
  // (re-entrant corner) whose FEA "Kt" never converges under mesh refinement,
  // and STORMFEA evaluates part interlaminar shear on element-AVERAGED stress
  // (fdmDualCriterion S_zs) — so average-based is the CONSISTENT measure, not a
  // shortcut. The `ktLapShear` parameter (default 1.0) is retained only as a
  // manual override escape hatch for a caller with an externally-calibrated
  // correction; the /api/calibration/kt probe never sets it above 1.0.
  // It stays an INDEPENDENT allowable (audit A5); only when no Z-tension coupon
  // was run is it also converted into yieldZ via the legacy Hill τ_z = Z/√3
  // relation (τ/0.58) — flagged so consumers know yieldZ is derived.
  let shearStr_MPa:  number | null = null;
  let interShear_MPa: number | null = null;
  if (lapShearFailN !== null) {
    const area   = COUPON_DIMS.lapShear.overlapWidthMm * COUPON_DIMS.lapShear.overlapLengthMm;
    shearStr_MPa = ktLapShear * (lapShearFailN / area);
    interShear_MPa = shearStr_MPa;
    if (yieldZ_MPa === null) {
      yieldZ_MPa = shearStr_MPa / 0.58;
      yieldZFromShear = true;
    }
  }

  // Bearing: contact at the hole wall concentrates stress at the bore. Nominal
  // bearing stress F/(d·t) is lifted to a peak-based allowable by Kt. That Kt
  // comes from the plate-with-hole FEA probe (buildBearingKtProbe) as the
  // net-section OPEN-HOLE tension SCF — a first-order proxy for the true bearing
  // concentration, since the fixture can only apply far-field tension, not a
  // bolt bearing on the wall (issue #139). Default 1.0 ⇒ plain nominal F/(d·t).
  let bearingStr_MPa: number | null = null;
  if (bearingFailN !== null) {
    bearingStr_MPa = ktBearing * (bearingFailN /
      (COUPON_DIMS.bearing.holeDiamMm * COUPON_DIMS.bearing.plateThickMm));
  }

  const finalYieldXY = yieldXY_MPa ?? lit.yieldMPa;
  const finalYieldZ  = yieldZ_MPa  ?? lit.yieldMPa * FDM_ORTHO_RATIOS.yieldZ_over_yieldXY;
  // S_zs/S_zt ratio: measured when both interlayer coupons exist; 1/√3 (the
  // legacy Hill equivalence) otherwise. When yieldZ was DERIVED from the
  // shear measurement the "measured" ratio would be 0.58 by construction —
  // identical to the default within rounding — so the default is used.
  const interShearRatio = (interShear_MPa !== null && !yieldZFromShear && finalYieldZ > 0)
    ? interShear_MPa / finalYieldZ
    : null;

  return {
    id, label, materialId, layerHeightMm,
    createdAt:           new Date().toISOString(),
    yieldXY_MPa,
    yieldZ_MPa,
    E_xy_MPa,
    bearingStr_MPa,
    shearStr_MPa,
    interShear_MPa,
    interShear_over_yieldZ: interShearRatio,
    yieldZFromShear,
    E_z_over_E_xy:       FDM_ORTHO_RATIOS.E_z_over_E_xy,
    yieldZ_over_yieldXY: finalYieldZ / finalYieldXY,
    G_xz_over_G_xy:      FDM_ORTHO_RATIOS.G_xz_over_G_xy,
  };
}

// ─── Base properties (solid, 100% infill, isotropic approximation) ─────────
// densityKgM3: solid (100% dense) mass density in kg/m³ — used with
// effectiveVolumeFraction() to set massRho for modal analysis (issue #99).
export const MATERIALS: Record<string, { E: number; nu: number; yieldMPa: number; densityKgM3: number; label: string }> = {
  pla:   { E: 3500,  nu: 0.36, yieldMPa: 50,  densityKgM3: 1240, label: "PLA"   },
  petg:  { E: 2100,  nu: 0.38, yieldMPa: 45,  densityKgM3: 1270, label: "PETG"  },
  abs:   { E: 2300,  nu: 0.35, yieldMPa: 40,  densityKgM3: 1050, label: "ABS"   },
  tpu:   { E:  200,  nu: 0.48, yieldMPa: 15,  densityKgM3: 1200, label: "TPU"   },
  pa12:  { E: 1700,  nu: 0.40, yieldMPa: 48,  densityKgM3: 1010, label: "PA12 (Nylon)" },
  asa:   { E: 2100,  nu: 0.35, yieldMPa: 40,  densityKgM3: 1070, label: "ASA"   },
};

/**
 * The supported material ids — the single source of truth (issue #186). Every
 * other material table (BOND_MATERIALS, DEFAULT_BEAD_PROPS) must stay in sync
 * with this set; the invariant is locked by material-tables.test.ts. Request
 * validation rejects any id outside this set BEFORE analysis, so the downstream
 * `MATERIALS[id] ?? pla` fallbacks are defensive dead code, never a silent
 * wrong-physics substitution.
 */
export const MATERIAL_IDS = Object.keys(MATERIALS);

/** True when `materialId` is a supported material (issue #186). */
export function isKnownMaterial(materialId: string): boolean {
  return Object.prototype.hasOwnProperty.call(MATERIALS, materialId);
}

/** Literature in-plane yield for a material id (bond-sweep fit fallback). */
export function literatureYieldMPa(materialId: string): number {
  return (MATERIALS[materialId] ?? MATERIALS["pla"]!).yieldMPa;
}

/** Literature yieldZ/yieldXY ratio (bond-sweep fit fallback). */
export function literatureYieldZRatio(): number {
  return FDM_ORTHO_RATIOS.yieldZ_over_yieldXY;
}

/**
 * FDM orthotropic property ratios — updated from literature review June 2026.
 *
 * E_z / E_xy raised from 0.45 → 0.65:
 *   Multiple studies show stiffness is more isotropic than strength.
 *   "Stiffness properties of 3D printing polymers were isotropic even when
 *   strength was anisotropic." — Perez et al. 2021 (SAGE journals)
 *   Measured E_z/E_xy = 0.48–0.85 across studies; 0.65 is central estimate.
 *   Source: Perez/Celik/Karkkainen 2021; anisotropy for PLA parts study 2019.
 *
 * yieldZ / yieldXY raised from 0.50 → 0.58:
 *   Measured ratio 0.59 in compression study (Cojocaru et al. 2019).
 *   Range across studies: 0.50–0.65. Conservative central estimate: 0.58.
 *   Source: Cojocaru et al. 2019 (UPB Sci Bull); Rodriguez et al. 2001.
 *
 * G_xz / G_xy unchanged at 0.40: limited direct measurement data.
 *   Source: Ahn et al. 2002, Casavola et al. 2016.
 *
 * nu_xz unchanged at 0.30: limited direct measurement data.
 *   Source: Casavola et al. 2016.
 */
const FDM_ORTHO_RATIOS = {
  E_z_over_E_xy:       0.65,   // raised from 0.45 — stiffness more isotropic than strength
  G_xz_over_G_xy:      0.40,   // unchanged — limited data
  nu_xz:               0.30,   // unchanged — limited data
  yieldZ_over_yieldXY: 0.58,   // raised from 0.50 — better supported by 2019 measurements
};

/**
 * Default interlaminar-shear-to-Z-tension ratio S_zs/S_zt = 1/√3 ≈ 0.577.
 *
 * This is exactly the transverse-shear yield the legacy Hill (1948)
 * coefficients L = M = 3/(2Z²) hard-wired (τ_z,yield = Z/√3), kept as the
 * DEFAULT so uncalibrated through-layer results match the legacy criterion.
 * It stops being an assumption once BOTH interlayer coupons are run: the
 * Z-tension coupon measures S_zt directly and the lap-shear coupon measures
 * S_zs directly (audit A5 — lap-shear is no longer converted into yieldZ).
 */
export const INTERSHEAR_OVER_YIELDZ_DEFAULT = 1 / Math.sqrt(3);

/**
 * Literature cross-bead tensile ratio (feature #6) — in-plane strength across
 * unidirectional beads vs along them. FDM unidirectional-raster coupons report
 * ~0.7–0.9; 0.85 is a MILD LOW-confidence default applied ONLY when the raster
 * is declared unidirectional and no coupon ratio was measured. Overridden by
 * CalibrationProfile.crossBeadRatio.
 */
export const CROSS_BEAD_RATIO_LITERATURE = 0.85;

/**
 * Assumed solid top/bottom layer counts for the two-region model when the
 * caller supplies none (issue #181). Common slicer defaults are 4 top / 4
 * bottom layers, giving a 0.8 mm skin at a 0.2 mm layer height — a value with
 * NO physical relationship to the perimeter wall band (wallCount × line width)
 * that the code previously borrowed silently. The assumption is surfaced in
 * materialModel (skinLayersAssumed) and the report so it can be corrected.
 */
export const DEFAULT_TOP_LAYERS = 4;
export const DEFAULT_BOTTOM_LAYERS = 4;


/**
 * Fallback SCALAR-SWAP APPROXIMATION for upright prints when no bed is picked
 * (weak azimuth unknown). Physically an upright print has its layer normal
 * along a HORIZONTAL axis; the exact model is a 90° rotation of the full 6×6
 * C (Bond transform, used when weakAxis is known). Without the azimuth we
 * approximate by swapping scalars: E_z takes the strong in-layer modulus and
 * BOTH horizontal directions take the weak through-layer modulus —
 * conservative (the real part is weak in only one). G_xy is set to the
 * inter-layer shear G_xz because the global XY plane contains the layer
 * normal after the swap (issue #101). See the "upright_swap" SOURCES entry
 * and server/tests/unit/upright-swap.test.ts.
 *
 * Poisson ratios are swapped consistently with the moduli (issue #187). The
 * fabricated material is transversely isotropic about global Z (isotropy
 * plane = the horizontal XY, now the WEAK plane; axis = vertical Z, now the
 * STRONG in-layer direction). Modelling BOTH horizontal directions as the
 * weak through-layer axis means every Poisson coupling that involves a
 * horizontal direction is the through-layer coupling ν_zx (the minor ratio of
 * the input, ν_zx = ν_xz·E_z/E_xy by reciprocity):
 *   - nu_xz_new (horizontal→vertical) = ν_zx  — this exactly preserves the
 *     physical interlayer cross-coupling compliance entry
 *     s13 = −ν_xz_new/E_xy_new = −ν_zx/E_z = −ν_xz/E_xy (the input's own s13),
 *     whereas leaving nu_xz unchanged inflated it by E_xy/E_z.
 *   - nu_xy_new (horizontal↔horizontal, both weak) = ν_zx as well.
 * The result is a self-consistent, symmetric-positive-definite compliance
 * (reciprocity ν_ij/E_i = ν_ji/E_j holds by construction in
 * buildOrthotropicConstitutiveMatrix) rather than the pre-#187 hybrid that
 * kept the strong-plane ν_xy and the un-rescaled ν_xz against swapped E's.
 * The change is a consistency fix, not a loosening: conservatism still lives
 * in the moduli (both horizontals weak) and the yield swap. Locked by
 * server/tests/unit/upright-swap.test.ts.
 *
 * The input must be in the NATURAL frame (weak axis = local Z) and must not
 * carry a weakAxis — swapping an already-rotated material is meaningless.
 */
export function applyUprightScalarSwap(mat: OrthotropicMaterial): OrthotropicMaterial {
  // yieldZShear (interlaminar shear) rides along unchanged via the spread:
  // it belongs to the physical layer interface, which the swap relabels but
  // does not alter. The swapped material is analysed with the hill-legacy
  // criterion anyway (the interface criterion needs a known weak axis, which
  // the no-bed swap deliberately does not have — see runAnalysis).
  const nu_zx = mat.nu_xz * mat.E_z / mat.E_xy; // input minor ratio (reciprocity)
  return {
    ...mat,
    E_xy: mat.E_z, E_z: mat.E_xy,
    G_xy: mat.G_xz, G_xz: mat.G_xz,
    yieldXY: mat.yieldZ, yieldZ: mat.yieldXY,
    nu_xy: nu_zx, nu_xz: nu_zx,
  };
}

function buildOrthotropicMaterialCLT(
  baseMatId:       string,
  infillPct:       number,
  pattern:         string,
  orientation:     string,
  layerHeightMm:   number,
  strengthMul:     number,
  calibration?:    CalibrationProfile | null,
  beadPropsOverride?: BeadProperties,
  /** Through-layer (weak) axis in the global frame; see buildOrthotropicMaterial. */
  weakAxis?:       readonly [number, number, number] | null,
  /** Bead-penetration bond multipliers (process settings present); see bond.ts. */
  bondRel?:        BondPrediction | null,
  /**
   * Unified in-plane DENSITY knockdown (issue #176): the A-matrix scale for the
   * CLT laminate. When provided (single-material path), it is the shared
   * wall-credit + Gibson-Ashby law (lumpedInPlaneStiffnessScale), replacing the
   * legacy linear-ρ A-scaling so all paths share ONE ρ-law. When omitted (the
   * buildCoreMaterial base, called at infillPct = 100), it falls back to the
   * legacy `infillPct/100` — 1.0, a no-op, since the Gibson-Ashby knockdown is
   * applied per-axis OUTSIDE this call.
   */
  inPlaneDensityScale?: number,
): OrthotropicMaterial {
  const base = MATERIALS[baseMatId] ?? MATERIALS["pla"]!;
  const lhf  = layerHeightFactor(layerHeightMm);

  const yieldXY_base = calibration?.yieldXY_MPa ?? base.yieldMPa;
  const E_z_ratio    = calibration?.E_z_over_E_xy    ?? FDM_ORTHO_RATIOS.E_z_over_E_xy;
  const yZ_ratio     = calibration?.yieldZ_over_yieldXY ?? FDM_ORTHO_RATIOS.yieldZ_over_yieldXY;
  const Gxz_ratio    = calibration?.G_xz_over_G_xy  ?? FDM_ORTHO_RATIOS.G_xz_over_G_xy;

  const bead = beadPropsOverride ?? DEFAULT_BEAD_PROPS[baseMatId] ?? DEFAULT_BEAD_PROPS["pla"]!;
  const plyStack = PATTERN_PLY_ANGLES[pattern] ?? PATTERN_PLY_ANGLES["grid"]!;

  // Orientation is resolved by the constitutive rotation + anisotropic
  // criterion, so strengthMul must arrive orientation-free (audit A4). Sole
  // exception: an angled print with no bed picked has no directional model at
  // all (the natural frame would be treated as flat), so the legacy 0.75
  // scalar is kept as a conservative fallback until a bed face is chosen.
  const angledNoBedMul = angledNoBedFallbackMul(orientation, weakAxis);

  // Bead-penetration bond model (audit A6): process-settings multipliers on
  // the interlayer properties, relative to the reference condition, applied
  // ON TOP of the layer-height factor. 1.0 when no process block is present.
  const bondS = bondRel?.relStrength  ?? 1.0;
  const bondE = bondRel?.relStiffness ?? 1.0;

  const yieldXY = yieldXY_base * strengthMul * angledNoBedMul;
  const yieldZ  = yieldXY * yZ_ratio * lhf * bondS;
  const yieldZShear = yieldZ * (calibration?.interShear_over_yieldZ ?? INTERSHEAR_OVER_YIELDZ_DEFAULT);

  // Derive Z-direction properties from the empirical bond model
  // (CLT only replaces in-plane stiffness; Z is still bond-dominated).
  // min(1, strengthMul): stiffness saturates at solid — identical to the
  // legacy min(1, mul/0.55) once the 0.55 orientation factor left the mul.
  const E_xy_empirical = (calibration?.E_xy_MPa ?? base.E) * Math.min(1.0, strengthMul);
  const E_z    = E_xy_empirical * E_z_ratio * lhf * bondE;
  const G_xy   = E_xy_empirical / (2 * (1 + base.nu));
  const G_xz   = G_xy * Gxz_ratio * lhf * bondE;
  const nu_xz  = FDM_ORTHO_RATIOS.nu_xz;

  const src = calibration ? `CLT:calibrated:${calibration.id}` : "CLT:literature";

  const mat = buildLaminateCMatrix(
    bead,
    plyStack.angles,
    plyStack.fracs,
    inPlaneDensityScale ?? infillPct / 100,
    E_z,
    nu_xz,
    G_xz,
    yieldXY,
    yieldZ,
    `${base.label} (CLT, ${pattern}, ${orientation}, lh=${layerHeightMm}mm, ${src})`,
  );
  const matZS: OrthotropicMaterial = { ...mat, yieldZShear };

  // Exact path (issue #101): a known through-layer axis (bed normal) → keep the
  // natural weak-along-local-Z CLT material and attach `weakAxis` so the solver
  // rotates the full tensor. Handles flat (+Z ⇒ identity), upright, and angled
  // uniformly, replacing the scalar-swap approximation.
  if (weakAxis && Math.hypot(weakAxis[0], weakAxis[1], weakAxis[2]) > 0) {
    return { ...matZS, weakAxis };
  }

  if (orientation === "upright") {
    // Fallback scalar-swap approximation when no bed is picked — see
    // applyUprightScalarSwap.
    return applyUprightScalarSwap(matZS);
  }
  return matZS;
}

export function buildOrthotropicMaterial(
  baseMatId:       string,
  strengthMul:     number,
  orientation:     string,
  layerHeightMm:   number,
  calibration?:    CalibrationProfile | null,
  /**
   * Through-layer (weak) axis in the global frame, from the bed normal. When
   * provided, the material keeps its natural weak-along-local-Z constants and
   * carries `weakAxis` so the solver applies an exact tensor rotation (issue
   * #101) — this supersedes the scalar-swap upright approximation. When absent
   * (no bed picked), the conservative scalar swap is used for upright prints.
   */
  weakAxis?:       readonly [number, number, number] | null,
  /** Bead-penetration bond multipliers (process settings present); see bond.ts. */
  bondRel?:        BondPrediction | null,
  /**
   * Unified in-plane stiffness knockdown (issue #176): overrides the legacy
   * `min(1, strengthMul)` E_xy scale with the shared wall-credit + Gibson-Ashby
   * law (lumpedInPlaneStiffnessScale), so the single-material path uses the SAME
   * ρ-law as CLT and the two-region core. When omitted (shell build, core base,
   * tests — all at strengthMul = 1.0 ⇒ min(1,1) = 1), the legacy behavior is
   * bit-identical, decoupling stiffness density from the strength multiplier.
   */
  inPlaneStiffScale?: number,
): OrthotropicMaterial {
  const base = MATERIALS[baseMatId] ?? MATERIALS["pla"]!;
  const lhf  = layerHeightFactor(layerHeightMm);

  // Use calibrated values where available, fall back to literature
  const E_xy_base    = calibration?.E_xy_MPa    ?? base.E;
  const yieldXY_base = calibration?.yieldXY_MPa ?? base.yieldMPa;
  const E_z_ratio    = calibration?.E_z_over_E_xy    ?? FDM_ORTHO_RATIOS.E_z_over_E_xy;
  const yZ_ratio     = calibration?.yieldZ_over_yieldXY ?? FDM_ORTHO_RATIOS.yieldZ_over_yieldXY;
  const Gxz_ratio    = calibration?.G_xz_over_G_xy  ?? FDM_ORTHO_RATIOS.G_xz_over_G_xy;

  // See buildOrthotropicMaterialCLT: strengthMul is orientation-free (audit
  // A4); min(1, strengthMul) keeps stiffness saturated at solid; the angled
  // no-bed case keeps the legacy 0.75 scalar as a conservative fallback.
  const angledNoBedMul = angledNoBedFallbackMul(orientation, weakAxis);
  // Bead-penetration bond model multipliers (audit A6); 1.0 without process
  // settings — see buildOrthotropicMaterialCLT.
  const bondS = bondRel?.relStrength  ?? 1.0;
  const bondE = bondRel?.relStiffness ?? 1.0;

  // Stiffness density knockdown (issue #176): the unified wall-credit +
  // Gibson-Ashby law when supplied by the single-material path; else the legacy
  // min(1, strengthMul) (bit-identical for the strengthMul = 1.0 callers).
  const E_xy    = E_xy_base    * (inPlaneStiffScale ?? Math.min(1.0, strengthMul));
  const E_z     = E_xy         * E_z_ratio * lhf * bondE;
  const G_xy    = E_xy         / (2 * (1 + base.nu));
  const G_xz    = G_xy         * Gxz_ratio * lhf * bondE;
  const nu_xy   = base.nu;
  const nu_xz   = FDM_ORTHO_RATIOS.nu_xz;
  const yieldXY = yieldXY_base * strengthMul * angledNoBedMul;
  const yieldZ  = yieldXY      * yZ_ratio  * lhf * bondS;
  const yieldZShear = yieldZ * (calibration?.interShear_over_yieldZ ?? INTERSHEAR_OVER_YIELDZ_DEFAULT);

  const src = calibration ? `calibrated:${calibration.id}` : "literature";

  // Natural material: weak (through-layer) axis along local Z, strong in-plane.
  const flat: OrthotropicMaterial = {
    kind: "orthotropic",
    E_xy, E_z, nu_xy, nu_xz, G_xz, yieldXY, yieldZ, yieldZShear,
    label: `${base.label} (orthotropic, ${orientation}, lh=${layerHeightMm}mm, ${src})`,
  };

  // Exact path: a known weak axis (bed normal) → rotate the tensor to align the
  // local weak axis with it. Handles flat (+Z ⇒ identity), upright, and angled
  // uniformly and correctly (issue #101).
  if (weakAxis && Math.hypot(weakAxis[0], weakAxis[1], weakAxis[2]) > 0) {
    return { ...flat, weakAxis };
  }

  if (orientation === "upright") {
    // Fallback scalar-swap approximation (no bed picked, so the weak azimuth
    // is unknown) — see applyUprightScalarSwap.
    return applyUprightScalarSwap(flat);
  }
  return flat;
}

// ─── Print settings effect on strength ────────────────────────────────────────
/**
 * FDM effective strength multiplier.
 *
 * WHAT IS WELL-SUPPORTED BY PUBLISHED DATA:
 *
 * 1. Infill density: strength increases approximately linearly with infill %.
 *    At 100% infill, tensile strength ~45 MPa (PLA) vs ~22 MPa at 40%.
 *    Source: multiple studies including Garg et al. 2025, showing monotonic increase.
 *    NOTE: 100% infill is more brittle but not weaker in tensile/pull-through.
 *    We use a linear model: 0.30 (0%) to 1.0 (100%).
 *
 * 2. Layer orientation: well-established. Inter-layer bond is ~50-60% of in-layer.
 *    "Flat" print = load perpendicular to layers = weakest (~0.55×).
 *    "Upright" = load parallel to layers = strongest (~0.90×).
 *    Source: Rodriguez et al. 2001, confirmed by many studies.
 *
 * 3. Wall count: each perimeter is fully dense. More walls = more load-bearing
 *    cross-section at the part boundary.
 *
 * 4. Pattern multipliers: THE LITERATURE IS INCONSISTENT.
 *    Different studies rank patterns differently depending on load type, printer,
 *    and settings. Gyroid is often cited as near-isotropic, but some studies find
 *    grid or honeycomb stronger in tension. We apply small, conservative adjustments
 *    with explicit uncertainty. These should be treated as rough guidance only.
 *    Do not rely on pattern multipliers for safety-critical decisions.
 *
 * Sources: Wittbrodt & Pearce 2015, Rodriguez et al. 2001, Garg et al. 2025,
 * multiple PLA tensile studies on PubMed/ResearchGate.
 */

// Linear infill model — better supported than a peak curve
function infillStrengthCurve(pct: number): number {
  // Linear from 0.30 (walls only at 0%) to 1.0 (solid at 100%)
  // This matches the monotonically increasing trend seen in most studies
  return 0.30 + (pct / 100) * 0.70;
}

// Pattern multipliers — conservative, treat as approximate guidance only.
// Moved to solver/lattice.ts (imported above) so the strength prefactor lives
// beside the Gibson-Ashby exponent tables; values are unchanged, keeping the
// legacy uniform path bit-identical.

// Pattern uncertainty — shown to user so they know how reliable each value is
export const PATTERN_CONFIDENCE: Record<string, string> = {
  grid:         "well-studied baseline",
  lines:        "well-studied — known to be weakest",
  gyroid:       "near-isotropic claim supported, magnitude uncertain",
  cubic:        "limited data, similar to gyroid",
  honeycomb:    "conflicting data — strong in some tests, weak in others",
  trihexagon:   "limited data",
  lightning:    "well-established — decorative only",
  concentric:   "limited data",
  adaptive:     "limited data",
};

/**
 * Layer-adhesion orientation multiplier (well-established: inter-layer bond
 * is the weak link; flat prints load bonds in tension across the XY plane).
 * Applies to BOTH regions of the two-region model — walls and infill are
 * each still layered material.
 */
export function orientationMultiplier(orientation: string): number {
  return orientation === "flat"    ? 0.55
       : orientation === "upright" ? 0.90
       : 0.75;
}

/**
 * The one orientation scalar left in the SOLVED-material path (audit A4): an
 * "angled" print with NO bed face picked has no directional model — the
 * material would otherwise be built in the flat frame and analysed as if its
 * layers were flat. The legacy conservative 0.75 multiplier is kept for that
 * case only. Returns 1.0 everywhere else: "flat" is the exact natural frame,
 * "upright" is handled by the scalar swap, and any picked bed face gives the
 * exact weakAxis tensor rotation.
 */
export function angledNoBedFallbackMul(
  orientation: string,
  weakAxis?: readonly [number, number, number] | null,
): number {
  const hasAxis = !!weakAxis && Math.hypot(weakAxis[0], weakAxis[1], weakAxis[2]) > 0;
  return (!hasAxis && orientation !== "flat" && orientation !== "upright")
    ? orientationMultiplier(orientation)
    : 1.0;
}

export function effectiveStrengthMultiplier(
  infillPct:   number,
  wallCount:   number,
  pattern:     string,
  orientation: string,
): number {
  return materialStrengthMultiplier(infillPct, wallCount, pattern)
       * orientationMultiplier(orientation);
}

/**
 * Strength multiplier for the SOLVED material (layer-model audit, finding A4).
 *
 * Excludes orientation: the solver's constitutive model and failure criterion
 * already resolve load-vs-layer direction exactly (weakAxis tensor rotation +
 * anisotropic yield), so an orientation scalar here would double-count the
 * layer penalty — the legacy 0.55× flat multiplier encoded the same physics
 * as the yieldZ/yieldXY = 0.58 ratio, stacking to an unphysical
 * 0.55 × 0.58 ≈ 0.32 through-layer strength and knocking a flat part's
 * IN-PLANE strength (its coupon-measured yieldXY) to 0.55× for no reason.
 * infill/walls/pattern stay: they describe how much load-bearing section
 * exists, which the continuum mesh cannot see.
 *
 * effectiveStrengthMultiplier (above) KEEPS orientation and remains the
 * quick scalar ESTIMATOR for recommendations / what-if ranking only — it
 * approximates the direction effect without solving.
 */
export function materialStrengthMultiplier(
  infillPct: number,
  wallCount: number,
  pattern:   string,
): number {
  const infillMul  = infillStrengthCurve(infillPct);
  const wallBonus  = (wallCount - 1) * 0.10;
  const combined   = Math.min(1.0, infillMul + wallBonus);
  const patternMul = PATTERN_MULTIPLIERS[pattern] ?? 1.0;
  return combined * patternMul;
}

/**
 * Strength multiplier for a WALL-FREE homogenized infill lattice (the core
 * region of the two-region model). Unlike infillStrengthCurve — whose 0.30
 * intercept at 0% infill represents the perimeter walls — a pure lattice
 * carries ~nothing at 0% and follows a Gibson-Ashby power law in relative
 * density (solver/lattice.ts: s(ρ) = min(1, patternMul·ρ^m), m per pattern
 * family). Clamped at solid; anchored s(1) = min(1, patternMul), identical
 * to the legacy linear curve's ρ=1 value.
 *
 * Orientation-free (audit A4): direction is the criterion's job. The core is
 * still layered material — its through-layer weakness enters via yieldZ.
 */
export function coreStrengthMultiplier(
  infillPct:   number,
  pattern:     string,
  strengthExpOverride?: number | null,
): number {
  return latticeStrengthFraction(pattern, infillPct / 100, strengthExpOverride);
}

/**
 * Build the two-region CORE material: the wall-free homogenized infill
 * lattice, produced by applying per-axis Gibson-Ashby scale factors
 * (solver/lattice.ts) to the SOLID lattice base material.
 *
 * Frame handling: the per-axis laws are defined in the NATURAL frame (local
 * Z = layer normal = build axis — for extruded-wall patterns the walls are
 * continuous along that axis, so E_z keeps the mildest law and the core's
 * anisotropy INVERTS at low density). Scaling must therefore happen before
 * any frame transform:
 *  - real weakAxis: the builder returns natural constants + the axis; the
 *    rotation is applied later in the constitutive builder (after scaling).
 *  - upright with no bed picked: the builder would scalar-swap; we suppress
 *    the swap by requesting the identity axis [0,0,1], scale the natural
 *    constants, then apply the swap and drop the injected axis.
 *
 * Poisson guard: with inverted anisotropy an unscaled ν_xz makes
 * ν_zx = ν_xz·E_z/E_xy exceed the thermodynamic stability limit in
 * buildOrthotropicConstitutiveMatrix; scaling ν_xz by min(1, gXY/gZ) bounds
 * 2·ν_xz·ν_zx by its solid value, keeping every bin positive definite.
 *
 * Anchors (CLAUDE.md two-region invariant #8): every scale factor is exactly
 * 1.0 at 100% infill, so the core reproduces the solid/shell bit-for-bit and
 * the materialsEqual collapse in buildTwoRegionField keeps firing. A
 * calibration latticeStiffExp override routes to the scalar
 * (isotropic-in-ratio) law — a single fitted exponent can't say which axis
 * it belongs to.
 *
 * CLT: the solid base is built at 100% infill so the laminate's internal
 * linear A×ρ scaling is a no-op — the Gibson-Ashby laws are the ONLY density
 * knockdown. Mass stays linear (volume is volume).
 */
export function buildCoreMaterial(
  materialId:    string,
  infillPct:     number,
  pattern:       string,
  orientation:   string,
  layerHeightMm: number,
  calibration:   CalibrationProfile | null,
  useCLT:        boolean,
  beadProps:     BeadProperties | undefined,
  weakAxis:      readonly [number, number, number] | null,
  /** Bond-model multipliers — the core is layered material too; see bond.ts. */
  bondRel?:      BondPrediction | null,
): OrthotropicMaterial {
  const baseMat = MATERIALS[materialId] ?? MATERIALS["pla"]!;
  const rho = infillPct / 100;
  // Per-axis strength knockdown (issue #177): yieldXY, yieldZ, and yieldZShear
  // each follow their own Gibson-Ashby strength exponent so the strength
  // anisotropy tracks the per-axis stiffness anisotropy (a calibration
  // strengthExp collapses all three to one isotropic law). Applied in the
  // NATURAL frame below, before any upright swap.
  const { sXY, sZ, sZS } = latticeStrengthFractions(pattern, rho, calibration?.latticeStrengthExp);

  const uprightNoBed = !weakAxis && orientation === "upright";
  const solidAxis: readonly [number, number, number] | null =
    uprightNoBed ? [0, 0, 1] : weakAxis;
  // strengthMul = 1.0: the solid lattice base is the full-strength printed
  // material — orientation is the criterion's job (audit A4; the builder
  // itself applies the angled-no-bed fallback when applicable). Note the
  // uprightNoBed identity axis suppresses BOTH the swap and the fallback
  // here; the swap is applied manually below, after scaling.
  const solid = useCLT
    ? buildOrthotropicMaterialCLT(materialId, 100, pattern, orientation, layerHeightMm,
        1.0, calibration, beadProps, solidAxis, bondRel)
    : buildOrthotropicMaterial(materialId, 1.0, orientation, layerHeightMm,
        calibration, solidAxis, bondRel);

  let scaled: OrthotropicMaterial;
  if (calibration?.latticeStiffExp != null) {
    const g = latticeStiffnessScale(pattern, rho, calibration.latticeStiffExp);
    scaled = {
      ...solid,
      E_xy: solid.E_xy * g,
      E_z:  solid.E_z  * g,
      G_xz: solid.G_xz * g,
      ...(solid.G_xy !== undefined ? { G_xy: solid.G_xy * g } : {}),
    };
  } else {
    const { gXY, gZ, gGxz, gGxy } = latticeStiffnessScales(pattern, rho);
    // In-plane shear: explicit wall-network law when the family defines one
    // (walls25d — Gibson-Ashby honeycomb ρ³ bending mode); otherwise follow
    // E_xy so an explicit CLT G_xy scales consistently and a derived G_xy
    // stays derived from the scaled E_xy.
    const gxyCore = gGxy !== null
      ? (solid.G_xy ?? solid.E_xy / (2 * (1 + solid.nu_xy))) * gGxy
      : solid.G_xy !== undefined ? solid.G_xy * gXY
      : undefined;
    // SYMMETRIC Poisson guard: whichever way the per-axis laws skew the
    // anisotropy, the guarded 2·ν_xz·ν_zx stays bounded by its solid value —
    // in the natural frame AND after the upright scalar swap (which inverts
    // E_z/E_xy; the one-sided min(1, gXY/gZ) guard would let a swapped
    // tpms3d core at low ρ violate positive-definiteness). min(1,1,1) = 1
    // at ρ=1 keeps the anchor exact.
    const nu_xz = solid.nu_xz * Math.min(1, gXY / gZ, gZ / gXY);
    scaled = {
      ...solid,
      E_xy: solid.E_xy * gXY,
      E_z:  solid.E_z  * gZ,
      G_xz: solid.G_xz * gGxz,
      nu_xz,
      ...(gxyCore !== undefined ? { G_xy: gxyCore } : {}),
    };
  }

  // Apply the per-axis strength knockdown in the NATURAL frame (issue #177),
  // BEFORE the upright scalar swap: the swap relabels yieldXY↔yieldZ, so each
  // scaled yield must already carry its own physical-axis strength law when the
  // swap runs (interlaminar shear rides through the swap unchanged, matching the
  // stiffness treatment where per-axis gXY/gZ scale before framing).
  const scaledStr: OrthotropicMaterial = {
    ...scaled,
    yieldXY: scaled.yieldXY * sXY,
    yieldZ:  scaled.yieldZ  * sZ,
    yieldZShear: interlaminarShearOf(scaled) * sZS,
  };

  let framed: OrthotropicMaterial = scaledStr;
  if (uprightNoBed) {
    const { weakAxis: _identityAxis, ...swapped } = applyUprightScalarSwap(scaledStr);
    framed = swapped;
  }

  // Defensive stability check on the FINAL frame (mirrors
  // buildOrthotropicConstitutiveMatrix): clamp + warn rather than throw
  // during bin construction. Unreachable for the family tables (the
  // symmetric guard bounds the product by its solid value in both frames);
  // protects against pathological calibration/coefficient combinations.
  {
    const nu_zx = framed.nu_xz * framed.E_z / framed.E_xy;
    const delta = (1 - framed.nu_xy) - 2 * framed.nu_xz * nu_zx;
    if (delta <= 0) {
      console.warn(
        `[core-lattice] Poisson stability clamp (Δ=${delta.toFixed(4)}) for ` +
        `${pattern} at ρ=${rho.toFixed(2)} — setting core ν_xz to 0`,
      );
      framed = { ...framed, nu_xz: 0 };
    }
  }

  return {
    ...framed,
    label: `${solid.label} · GA ${pattern} lattice ρ=${infillPct}%`,
    massRho: baseMat.densityKgM3 * rho,
    // Deshpande–Fleck–Ashby pressure sensitivity of the homogenized foam core
    // (issue #171). α(ρ) → 0 exactly at ρ=1 (Math.pow(0,1)===0), so the ρ=1
    // core stays von Mises and the materialsEqual collapse is unaffected; grows
    // toward ~2.08 as ρ→0 (a sparse lattice yields hydrostatically). The bulk
    // criterion consumes it; stiffness is untouched (a strength-side change).
    dfaAlpha: dfaPressureSensitivity(rho),
  };
}

/**
 * First-order solid-volume fraction of an FDM part (issue #99).
 *
 * Used to scale the SOLID material density into an effective mass density
 * (massRho) for modal analysis, so that mass tracks infill the same way
 * stiffness already does. Without this a 20%-infill part carried full solid
 * density against infill-scaled stiffness, underestimating frequencies ~2×.
 *
 * Model: deliberately the SAME load-bearing-section model that
 * effectiveStrengthMultiplier uses for its combined infill+wall term
 * (infillStrengthCurve linear term + 0.10 per extra perimeter, clamped at
 * 1.0). That model already interprets its coefficients as the fraction of
 * solid, load-carrying cross-section (shells fully dense, interior at the
 * infill ratio); to first order the solid VOLUME fraction equals that solid
 * SECTION fraction. The pattern and orientation multipliers are strength
 * adjustments, not density adjustments, so they are excluded here.
 *
 * Limitations (documented, accepted at first order): the true shell fraction
 * depends on part surface-to-volume ratio and wall width, and infill patterns
 * differ a few percent in material use at equal percentage. Both effects are
 * far smaller than the 5× mass error this replaces.
 */
export function effectiveVolumeFraction(infillPct: number, wallCount: number): number {
  const infillFrac = infillStrengthCurve(infillPct);       // 0.30 → 1.0 linear
  const wallBonus  = (wallCount - 1) * 0.10;
  return Math.min(1.0, infillFrac + wallBonus);
}

// ─── Types ────────────────────────────────────────────────────────────────────
/**
 * Distribution used when a force does not name one (issue #271).
 *
 * This is 'contact_patch': the load is applied WHERE IT WAS PLACED, over a
 * tapered disc, rather than smeared across the whole extreme face toward its
 * direction. It changes the answer for every force that does not name a mode —
 * deliberately, because the previous default discarded the application point
 * entirely and put a hard-edged patch rim into the model.
 *
 * Measured on the Ø5-bore tube across a 5.3x element range, the safety-factor
 * spread across meshes falls from 26.6% to 1.6%, and the peak stops sitting on
 * a patch rim that never converges. `docs/load-distribution-default.md` records
 * the anchors this moved and why each moved.
 *
 * Set `loadDistribution: 'uniform'` to get the previous behaviour back exactly,
 * including the near-hole linear taper the absent field used to reach.
 */
export const DEFAULT_LOAD_DISTRIBUTION = 'contact_patch' as const;

export interface ForceSpec {
  /** Force magnitude in Newtons */
  magnitude: number;
  /** Unit direction vector [x, y, z] in STL file space */
  direction: [number, number, number];
  /**
   * Point of application in STL file space (mm).
   *
   * Read ONLY by `loadDistribution: 'contact_patch'` (issue #271). Every other
   * mode selects its nodes from `direction` alone, so under those modes moving
   * this field changes nothing — verified bit-identical to nine decimals across
   * four application points, including one on the opposite side of the part.
   * That is why 'contact_patch' exists; the legacy modes keep their behaviour
   * because changing them would move every force-loaded validated anchor.
   */
  position:  [number, number, number];
  /**
   * Load distribution mode. Absent → `DEFAULT_LOAD_DISTRIBUTION`.
   *   'uniform'        — equal split across the extreme-face band (legacy)
   *   'cosine_bearing' — concentrated at a bolt bearing point
   *   'tapered_patch'  — spread over a raised-cosine SLAB on the extreme face,
   *                      integrated as a consistent (tributary-area) traction.
   *                      Removes the hard patch rim the first two modes carry,
   *                      but a slab still runs off a free edge at full
   *                      strength; see `assembleTaperedFaceLoad` and #260.
   *   'contact_patch'  — a raised-cosine DISC centred on `position`, tapering
   *                      in every surface direction. The only mode that reads
   *                      `position` (issue #271), and the only one with no
   *                      untapered patch edge anywhere.
   * Absent → `DEFAULT_LOAD_DISTRIBUTION` ('contact_patch'). Ask for 'uniform'
   * explicitly to get the legacy cascade back, bit-identical.
   */
  loadDistribution?: 'uniform' | 'cosine_bearing' | 'tapered_patch' | 'contact_patch';
  /**
   * Depth of the 'tapered_patch' slab along the load direction, in mm — the
   * REAL contact size when the caller knows it. Ignored by every other mode.
   * Omitted → `LOAD_PATCH_DEPTH_FRACTION` of the part's extent along
   * `direction`, which is a judgement rather than a measurement.
   */
  loadPatchDepthMm?: number;
  /**
   * Radius of the 'contact_patch' disc, in mm — the real contact size (bolt
   * head, pin, pad) when the caller knows it. Ignored by every other mode.
   * Omitted → `CONTACT_PATCH_RADIUS_FRACTION` of the part's bounding-box
   * diagonal, which is the weakest number in that mode.
   */
  loadPatchRadiusMm?: number;
}

/**
 * Print settings describe the physical part as manufactured — the material and
 * the slicer parameters that shape it. They are distinct from AnalysisSettings,
 * which describe how the simulation is run (see below).
 */
export interface PrintSettings {
  materialId:    string;
  infillPct:     number;
  wallCount:     number;
  pattern:       string;
  orientation:   string;
  layerHeightMm: number;
  /**
   * Extrusion / line width in mm, used for the wall-band thickness
   * (wallCount × extrusionWidthMm). Slicer G-code typically reports it;
   * default 0.45 (0.4 nozzle typical). Clamped to [0.1, 2.0]. Consumed by the
   * two-region model (whose `twoRegion` flag lives in AnalysisSettings) — this
   * is a genuine slicer/print parameter, so it stays with the print settings.
   */
  extrusionWidthMm?: number;
  /**
   * Number of solid TOP layers (ceiling skin). Consumed by the two-region
   * model to give the top solid skin its own band thickness
   * (topLayers × layerHeightMm), independent of the vertical perimeter band
   * (wallCount × extrusionWidthMm). Clamped to [0, 64]. Absent → the two-region
   * model assumes a slicer-default count (DEFAULT_TOP_LAYERS) and flags the
   * assumption in materialModel.skinLayersAssumed (issue #181) — it never
   * borrows the perimeter band thickness.
   */
  topLayers?: number;
  /**
   * Number of solid BOTTOM layers (floor skin); see topLayers. Bottoms are
   * commonly thicker than tops, so the two are independent. Clamped to [0, 64].
   * Absent → assumes DEFAULT_BOTTOM_LAYERS (flagged in skinLayersAssumed).
   */
  bottomLayers?: number;
  /**
   * Optional process settings (nozzle/bed temperature, print speed, cooling
   * fan, ambient). When ANY field is present the bead-penetration bond model
   * (server/solver/bond.ts, audit A6) predicts interlayer strength/stiffness
   * multipliers RELATIVE to the reference condition and applies them on top
   * of layerHeightFactor. Absent → legacy layer-height-only path, unchanged.
   */
  process?: ProcessSettings;
  /**
   * Bead (raster) direction in the layer plane, degrees from the part's +X
   * axis. Consumed only by the in-plane raster anisotropy model (feature #6,
   * AnalysisSettings.inPlaneAnisotropy) to orient the cross-bead check. Default 0.
   */
  rasterAngleDeg?: number;
  /**
   * Declares a UNIDIRECTIONAL / dominant raster (e.g. single-perimeter walls,
   * unidirectional infill). Only then does opt-in in-plane anisotropy apply a
   * literature cross-bead knockdown absent a measured ratio — alternating ±45°
   * rasters homogenize and must stay isotropic.
   */
  unidirectionalRaster?: boolean;
}

/**
 * Analysis settings describe the numerical method and what to compute — the
 * mesh, the solver material model, and which extra solves to run. They are
 * orthogonal to PrintSettings: the same physical part can be analysed at
 * different fidelities or with different constitutive models.
 */
export interface AnalysisSettings {
  /** Mesh density preset: trades solve time against accuracy. */
  meshQuality:   "coarse" | "standard" | "fine";
  /** Element order: 1 = C3D4 linear, 2 = C3D10 quadratic (default). */
  meshOrder?:    1 | 2;
  /** Default: 'linear_static'. 'modal' also computes natural frequencies. */
  analysisType?: 'linear_static' | 'modal';
  /**
   * When true, also run a linear buckling (eigenvalue) analysis and report the
   * Buckling Load Factor. Opt-in because the eigen-solve adds solve time; works
   * for both C3D4 and C3D10 meshes.
   */
  computeBuckling?: boolean;
  /**
   * Material uncertainty mode. When 'central' (default) the solver uses the
   * literature central estimates. The server always computes sfConservative and
   * sfOptimistic alongside the central SF regardless of this field — it is
   * reserved for future single-mode runs.
   */
  uncertaintyMode?: 'central' | 'conservative' | 'optimistic';
  /**
   * When true, use Classical Laminate Theory (CLT) to compute effective in-plane
   * stiffness from first principles (ply stack + rotation + A-matrix inversion).
   * When false (default), use the empirical scalar multiplier model.
   */
  useCLT?:       boolean;
  /**
   * Optional override for single-bead properties used by the CLT model.
   * If omitted, DEFAULT_BEAD_PROPS[materialId] is used.
   */
  beadProps?:    BeadProperties;
  /**
   * When true, run the two-region material model: dense perimeter walls
   * (solid material, calibrated coupon props) vs homogenized infill core,
   * classified geometrically per element by wall-band volume fraction. The
   * wall band uses print.extrusionWidthMm.
   *
   * DEFAULT TRUE as of issue #297. Infill is one of the defining variables of
   * an FDM part, and the single-material path represents it as a scalar
   * knockdown with no spatial structure at all — a user could not see walls,
   * see the core, or tell a 2-wall part from a 5-wall one except as a
   * different number. The model is validated (sandwich cantilever within 0.3%
   * of composite-EI theory, where the homogenized model is ~23% too soft), so
   * the default was the only thing keeping it out of ordinary results.
   *
   * Pass `false` explicitly for the legacy single-material path, which remains
   * bit-identical (two-region invariant 1). Absent is no longer that path.
   */
  twoRegion?:    boolean;
  /**
   * When true, also return a volumetric stress payload (analysis-mesh node
   * positions + corner-tet connectivity + per-node stress/utilization arrays)
   * for the section-view interior heatmap (issue #190). Off by default: the
   * analysis mesh is much denser than the display mesh, so this payload can
   * be several MB and would slow down every ordinary analysis if always
   * included. Opt in only when the user has the section/clip view open.
   */
  includeVolumeField?: boolean;
  /**
   * When true (and twoRegion is also true, and print.wallCount >= 2), also
   * model wall-to-wall (bead-to-bead) bonding as a distinct, criterion-only
   * failure mode: adjacent perimeter loops are fused along a LOCAL radial
   * direction (varies around the part's contour), separately from the
   * global-Z interlayer bond check. Requires twoRegion because it rides on
   * the same distance-field geometry that model already computes. Default
   * false — legacy single-band wall model, bit-identical.
   */
  wallBond?:     boolean;
  /**
   * Failure criterion override. Default (absent): "fdm-interface" — the
   * decoupled dual criterion (bulk von Mises + interlayer interface,
   * docs/layer-model-audit.md A1–A3) — except on the upright-no-bed
   * scalar-swap fallback, which stays "hill-legacy" because the interface
   * criterion needs a known weak axis. Set "hill-legacy" explicitly to
   * compare against the pre-audit Hill (1948) criterion.
   */
  criterion?:    "fdm-interface" | "hill-legacy";
  /**
   * Opt-in in-plane raster (bead-to-bead) anisotropy for the bulk mechanism
   * (feature #6). Default off ⇒ the bulk term is exactly isotropic von Mises
   * (bit-identical). Even when ON it stays inert UNLESS there is real evidence
   * for anisotropy — a measured `CalibrationProfile.crossBeadRatio` or a
   * `PrintSettings.unidirectionalRaster` declaration — because typical ±45°
   * alternating rasters homogenize toward isotropic. Applies to the FDM
   * criterion only.
   */
  inPlaneAnisotropy?: boolean;
  /**
   * Opt-in error-driven adaptive mesh refinement (issue #149). When true (STL
   * path only, and only where a TetGen binary with sizing support exists), the
   * analysis runs an adaptive loop: solve → ZZ error estimate → build a
   * regional size field targeting the high-error elements → re-mesh → re-solve,
   * stopping on a target global error, an iteration cap, an element-growth cap,
   * or a stalled improvement. Default false ⇒ a single solve at the selected
   * mesh tier, BIT-IDENTICAL to the legacy path. Ignored (with a notice) on the
   * STEP/Gmsh path and on the box-mesh fallback, which degrade to tier behavior.
   */
  adaptiveRefinement?: boolean;
}

/**
 * Reported when a C3D10 mesh was rejected by the midside-ordering guard and the
 * analysis continued on LINEAR elements instead (issue #265).
 *
 * Present in the summary rather than logged, because the result is quantitatively
 * affected: C3D4 shear-locks in bending and can underpredict by tens of percent.
 * That is a caveat the reader needs, and it is a completely different caveat from
 * `meshFallback` — the geometry here is intact, only the element order is worse.
 */
export interface MeshOrderDowngrade {
  /** Order asked for (always 2 — nothing downgrades from linear). */
  requestedOrder: 2;
  /** Order actually solved. */
  actualOrder:    1;
  /** How many C3D10 attempts the guard rejected before giving up (always 2). */
  rejectedAttempts: number;
  /** The guard's measurement on the final rejected attempt, for the log/report. */
  bestElemMaxDev: number;
  /** Reader-facing explanation, including what it costs. */
  note:           string;
}

/**
 * Mesh an STL as C3D10, retrying ONCE if the midside-ordering guard rejects the
 * result, and falling back to LINEAR elements if it rejects the retry too
 * (issue #265).
 *
 * The ladder exists because the old code treated "TetGen could not mesh this
 * geometry" and "TetGen meshed it and the ordering guard refused the result" as
 * the same event, and answered both with a bounding box. They are not the same
 * event and they do not deserve the same answer:
 *
 *  1. **Retry once.** The rejection was observed to be TRANSIENT — once in three
 *     otherwise identical suite runs, same binary, same geometry, no input
 *     change. A second mesh costs one TetGen invocation and recovers the full
 *     analysis. It is also the discriminating experiment: a rejection that
 *     survives a fresh mesh (with a fresh scratch path) is reproducible.
 *
 *  2. **Reproducible ⇒ drop to C3D4, keeping the geometry.** A linear tet has no
 *     midside nodes, so the ordering that is in doubt does not exist — the guard
 *     is structurally inapplicable rather than merely silenced. This is a big
 *     improvement on what it replaces: the bounding box discards the bore, the
 *     fillets and every stress concentration the analysis is FOR, whereas this
 *     keeps all of them and pays in element order. A featureless part solved
 *     accurately is worth less than the real part solved less accurately.
 *
 *  3. **Genuine meshing failure ⇒ the box**, unchanged, handled by the caller.
 *
 * The downgrade is reported, not swallowed: C3D4 shear-locks in bending, which
 * is the reason the box fallback already honours the element-order selector.
 *
 * `attempt(order)` is the mesher call, injected so the ladder's POLICY is
 * testable without a TetGen binary — the decisions here are the part worth
 * pinning, and they are unreachable in a test if they are welded to a spawn.
 */
export async function meshWithGuardRetry<T>(
  requestedOrder: 1 | 2,
  attempt:        (order: 1 | 2) => Promise<T>,
  onDowngrade:    (d: MeshOrderDowngrade) => void,
): Promise<T> {
  // Linear was requested: there is no midside ordering to reject, so this is the
  // legacy call with no ladder around it.
  if (requestedOrder !== 2) return attempt(requestedOrder);

  try {
    return await attempt(2);
  } catch (err) {
    if (!(err instanceof C3D10OrderingError)) throw err;   // not ours to handle
    console.warn(
      `[analysis] C3D10 ordering guard rejected the mesh (${err.affineWitnesses} affine witnesses, ` +
      `closest element ${(err.bestElemMaxDev * 100).toFixed(0)}% off) — re-meshing once. ` +
      `This has been seen to be transient; a second rejection means it is not (issue #265).`,
    );

    try {
      const retry = await attempt(2);
      console.warn("[analysis] the re-mesh passed the ordering guard — continuing on C3D10.");
      return retry;
    } catch (err2) {
      if (!(err2 instanceof C3D10OrderingError)) throw err2;
      // Reproducible. The remap genuinely does not match this mesher build, so
      // no number of retries will help — but the geometry is fine, and linear
      // elements do not have the disputed nodes at all.
      const note =
        `The C3D10 (10-node tetrahedron) meshes from this TetGen build were rejected twice by ` +
        `STORMFEA's midside node-ordering check, so the analysis was re-run with LINEAR (4-node) ` +
        `elements, which have no midside nodes and cannot be affected. The geometry is intact — ` +
        `every hole and fillet is meshed as normal — but linear tetrahedra are overly stiff in ` +
        `bending, so displacements and bending stresses may be UNDERPREDICTED, in some cases by ` +
        `tens of percent. Treat this result as conservative in stiffness and approximate in ` +
        `stress. The underlying cause is a mesher version mismatch: see server/c3d10_ordering.ts.`;
      console.warn(`[analysis] ordering guard rejected the re-mesh too — downgrading to C3D4. ${note}`);
      onDowngrade({
        requestedOrder:   2,
        actualOrder:      1,
        rejectedAttempts: 2,
        bestElemMaxDev:   err2.bestElemMaxDev,
        note,
      });
      return attempt(1);
    }
  }
}

/**
 * How much the headline numbers moved across the meshes a run actually solved
 * (issue #256).
 *
 * The tool reports `safetyFactor` and `maxVonMisesMPa` as point values, and
 * `estimatedFailForce` ("will fail at X N") is derived from them. On a part with
 * an unresolvable singularity — which is every bolted part, at the clamp rim —
 * they are not converged quantities: measured 46% on the Ø5-bore tube and 18.9%
 * on the cross plate, NON-MONOTONE in element count, while the global energy
 * error converged normally over the same runs. Nothing said so.
 *
 * A part WITHOUT a singularity does not do this — the plate-with-hole fixture
 * (`smooth-concentration.test.ts`) gives 2.2%, monotone, settling to 0.1%. So
 * the spread is informative rather than noise: it separates "your number is
 * converged" from "your number is a sample".
 *
 * This is a MEASUREMENT over the meshes at hand, not a confidence interval. It
 * is bounded below by how far apart those meshes were and says nothing about
 * where the true value lies — a part whose meshes happen to agree can still be
 * wrong. It answers only "does refining this part change the answer".
 */
export interface HeadlineSpread {
  /** Number of distinct solves the spread is measured over (≥ 2). */
  samples:            number;
  /** Lowest / highest safety factor seen. Null when no solve produced one. */
  safetyFactorMin:    number | null;
  safetyFactorMax:    number | null;
  /** (max − min) / min for the safety factor, as a fraction. Null if unavailable. */
  safetyFactorSpread: number | null;
  /** Lowest / highest peak von Mises seen (MPa). */
  peakMin:            number;
  peakMax:            number;
  /** (max − min) / min for the peak, as a fraction. */
  peakSpread:         number;
  /**
   * Whether the peak moved monotonically with element count. FALSE is the
   * stronger warning: it means more elements did not even mean a consistently
   * different answer, so element count is not a proxy for trustworthiness.
   */
  monotoneInDensity:  boolean;
  /** Reader-facing sentence. Empty when the spread is small enough to ignore. */
  note:               string;
}

/**
 * Spread of the headline numbers across a multi-mesh history (issue #256).
 *
 * Pure and exported so the wording and the thresholds are testable without a
 * solve. Returns undefined for fewer than two samples rather than a zero
 * spread — "measured as none" and "not measured" must stay distinguishable, the
 * same rule `bcSingularityErrorFraction` follows.
 */
export function headlineSpreadOf(
  history: ReadonlyArray<{ elementCount: number; maxVonMisesMPa: number; safetyFactor: number | null }>,
): HeadlineSpread | undefined {
  if (history.length < 2) return undefined;

  const peaks = history.map(h => h.maxVonMisesMPa).filter(v => Number.isFinite(v) && v > 0);
  if (peaks.length < 2) return undefined;
  const peakMin = Math.min(...peaks), peakMax = Math.max(...peaks);
  const peakSpread = (peakMax - peakMin) / peakMin;

  const sfs = history.map(h => h.safetyFactor).filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  const haveSf = sfs.length >= 2;
  const sfMin = haveSf ? Math.min(...sfs) : null;
  const sfMax = haveSf ? Math.max(...sfs) : null;
  const sfSpread = haveSf ? (sfMax! - sfMin!) / sfMin! : null;

  // Monotonicity is judged on the peak against element count, in the order the
  // meshes were solved — sorted by density, so a loop that did not refine
  // monotonically is still read correctly.
  const byDensity = [...history]
    .filter(h => Number.isFinite(h.maxVonMisesMPa) && h.maxVonMisesMPa > 0)
    .sort((a, b) => a.elementCount - b.elementCount)
    .map(h => h.maxVonMisesMPa);
  let up = true, down = true;
  for (let i = 1; i < byDensity.length; i++) {
    if (byDensity[i]! < byDensity[i - 1]!) up = false;
    if (byDensity[i]! > byDensity[i - 1]!) down = false;
  }
  const monotoneInDensity = up || down;

  // 5% matches the convergence study's existing criterion for calling a metric
  // mesh-independent, so the two surfaces cannot tell the user opposite things.
  const shown = sfSpread ?? peakSpread;
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  const note = shown < 0.05
    ? ""
    : `Across the ${history.length} meshes solved, the safety factor moved ` +
      (haveSf ? `${sfMin!.toFixed(2)}–${sfMax!.toFixed(2)} (${pct(sfSpread!)}) ` : "") +
      `and the peak stress ${peakMin.toFixed(2)}–${peakMax.toFixed(2)} MPa (${pct(peakSpread)}). ` +
      (monotoneInDensity
        ? `The number is still settling, so treat the reported value as approximate to about this much.`
        : `It did NOT move consistently with element count, so a finer mesh is not a more trustworthy ` +
          `number here — this is the signature of a peak sitting at a singularity (a clamp rim, a loaded ` +
          `patch rim, or a sharp corner), where the peak is set by the element size and no mesh converges it. ` +
          `Judge the margin against the whole range, not the single value.`);

  return {
    samples: history.length,
    safetyFactorMin: sfMin, safetyFactorMax: sfMax, safetyFactorSpread: sfSpread,
    peakMin, peakMax, peakSpread,
    monotoneInDensity,
    note,
  };
}

/**
 * Result of the adaptive-refinement loop, surfaced on AnalysisResult when the
 * opt-in path ran. Purely informational; absent on the default single-solve.
 */
export interface AdaptiveRefinementInfo {
  /** Number of solves performed (1 = no refinement happened). */
  iterations:            number;
  /** Why the loop stopped. Union-typed so the API.md contract stays enforceable. */
  stopReason:            StopReason;
  /** Global relative error of the FIRST (tier) solve. */
  initialGlobalError:    number;
  /** Global relative error of the FINAL (reported) solve. */
  finalGlobalError:      number;
  /** Element count of the first solve. */
  initialElementCount:   number;
  /** Element count of the final solve. */
  finalElementCount:     number;
  /**
   * Hard element ceiling the loop enforced (maxElementGrowth × the base count).
   * Every entry in `history` is at or below it: a re-mesh that emitted more is
   * discarded unsolved rather than reported. Absent on a degraded run, which
   * never enters the loop.
   */
  elementBudget?:        number;
  /**
   * Fraction (0–1) of the reported solve's estimated error ENERGY sitting at a
   * boundary-condition discontinuity — the rim of a constrained or loaded patch.
   *
   * A DIAGNOSIS, not a target. That band converges at a measured rate of ~0.15
   * against the smooth-C3D10 expectation of 2.0, so once it dominates, the loop
   * can sit well short of `targetGlobalError` with nothing wrong with the mesh:
   * what is crude is the rigid-constraint idealization, not the discretization.
   * A high value means reach for a better bolt model, not a finer mesh.
   *
   * The reported `finalGlobalError` is unchanged by this and remains the TOTAL.
   * Absent when no mask could be built (no surface, or a degraded run).
   */
  bcSingularityErrorFraction?: number;
  /**
   * Per-iteration history. Carries the HEADLINE numbers as well as the error,
   * because the loop solves the same part at several densities and those solves
   * are the only place the tool ever sees how much its answer depends on the
   * mesh (issue #256). `safetyFactor` is null on a solve that could not produce
   * one (a degraded mesh).
   */
  history:               Array<{
    globalRelativeError: number;
    elementCount:        number;
    maxVonMisesMPa:      number;
    safetyFactor:        number | null;
  }>;
  /**
   * How far the headline numbers moved across the meshes the loop actually
   * solved (issue #256). Undefined when fewer than two solves happened, which
   * is the honest answer: one mesh cannot measure its own mesh-dependence.
   */
  headlineSpread?:       HeadlineSpread;
  /** True if the loop degraded to a single tier solve (no binary / STEP / box). */
  degradedToTier:        boolean;
  /** Human-readable note (e.g. why it degraded). */
  note:                  string;
}

/**
 * Layer height effect on inter-layer bond strength properties.
 *
 * Direction: thinner layers → stronger Z-direction bonds (more fusion events per mm).
 * This is supported by Farashi & Vafaee 2022 meta-analysis (131 samples):
 *   "Increasing layer thickness might reduce tensile strength up to 20%"
 * And by Vidakis et al., Qattawi et al., Salem et al. (cited in Szust & Adamski 2022):
 *   "Smaller layer height results in increase of tensile strength in Z direction"
 *
 * However the effect is NOT as steep as the original model assumed.
 * One study found optimal at 0.3mm (not 0.1mm) for gyroid+80% infill
 * (Hikmat et al. 2023, ETJ). The relationship depends on infill interaction.
 *
 * Revised calibration — capped at -15%/+10% (down from ±20%), asymmetric
 * because the clamp bounds [0.85, 1.10] are not symmetric about 1.0:
 *   0.1mm → ~1.10× baseline (was 1.15×)
 *   0.2mm → ~1.00× reference
 *   0.3mm → ~0.90× baseline (was 0.87×)
 *   0.35mm → ~0.85× baseline (was 0.82×)
 *
 * Slope = (0.90 - 1.10) / (0.3 - 0.1) = -1.0 per mm (reduced from -1.4)
 * Clamped to [0.85, 1.10] — more conservative range.
 *
 * Confidence: medium. The direction is consistent; the magnitude varies by study.
 * Sources: Farashi & Vafaee 2022; Szust & Adamski 2022; Vidakis et al. 2022.
 */
export function layerHeightFactor(layerHeightMm: number): number {
  // slope = -1.0 per mm through reference point (0.2mm → 1.0×)
  const factor = 1.00 + (0.2 - layerHeightMm) * 1.0;
  return Math.max(0.85, Math.min(1.10, factor));
}

/**
 * Thread interface penalty — how many layer boundaries a thread helix crosses.
 * Each crossing is a potential delamination point.
 * More crossings per thread = more penalty.
 *
 * penalty = base_reduction - (0.05 × extra_crossings_per_thread)
 * where extra_crossings = max(0, pitch/layerHeight - 1)
 * Returns a strength multiplier, clamped to [0.50, 0.75].
 */
export function threadLayerPenalty(pitchMm: number, layerHeightMm: number): number {
  const crossingsPerThread = pitchMm / layerHeightMm;
  // Base penalty 0.75 (from existing model), increases with more crossings
  // Each additional crossing beyond 1 adds ~5% more penalty, capped at 0.50
  const penalty = 0.75 - Math.max(0, crossingsPerThread - 1) * 0.05;
  return Math.max(0.50, penalty);
}

/**
 * Thrown by runAnalysis when its AbortSignal fires at a phase boundary
 * (issue #109). The /api/analyse SSE handler catches this to stop cleanly
 * without sending a bogus result when the client has disconnected/cancelled.
 */
export class AnalysisAbortError extends Error {
  constructor(message = "analysis aborted") {
    super(message);
    this.name = "AnalysisAbortError";
  }
}

/**
 * Progress event emitted at each solver phase boundary (issue #109). Streamed
 * to the client as SSE so the overlay reflects real solver phases instead of a
 * timer, and shows mesh size the moment meshing completes.
 */
export interface AnalysisPhaseEvent {
  phase: "mesh" | "constraints" | "assembly" | "solve" | "recovery" | "mapping" | "modal" | "buckling";
  message?: string;
  /** Present on the post-mesh "mesh" event. */
  nodeCount?:    number;
  elementCount?: number;
  nodesPerElem?: number;
  dof?:          number;
  /** Present on live "solve" (CG) progress events. */
  iteration?:         number;
  relativeResidual?:  number;
  converged?:         boolean;
  iterations?:        number;
}

export interface AnalysisRequest {
  /** Raw STL vertex positions — 9 floats per triangle (used when fileType = "stl") */
  positions:     Float32Array;
  triangleCount: number;
  /** Original file buffer for Gmsh (used when fileType = "step") */
  stepBuffer?:   Buffer;
  /** "stl" uses TetGen, "step" uses Gmsh with curvature-based refinement */
  fileType:      "stl" | "step";
  /** Bounding box in file space */
  bounds: {
    minX: number; maxX: number;
    minY: number; maxY: number;
    minZ: number; maxZ: number;
  };
  /** Hole features detected by the server (STL only — STEP derives them from CAD) */
  holes:         HoleFeature[];
  /** Indices into holes[] that the user marked as bolt constraints */
  boltHoleIds:   number[];
  /** Applied forces */
  forces:        ForceSpec[];
  /** Print settings — the physical part (material + slicer parameters). */
  print:         PrintSettings;
  /** Analysis settings — the numerical method (mesh, solver models, extra solves). */
  analysis:      AnalysisSettings;
  calibration?:  CalibrationProfile | null;
  /** User-specified bolt type overrides per hole id, e.g. {0: 'M3_clearance', 1: 'M3_tapped'} */
  holeTypeOverrides?: Record<number, string> | null;
  /**
   * Optional uniform body-force (self-weight / robot acceleration) load.
   *   g         — acceleration magnitude in multiples of standard gravity
   *               (1 = 9.80665 m/s²); e.g. 5 for a 5g impact case.
   *   direction — load direction in the part frame (need not be unit length).
   * Uses the material's (infill-scaled) mass density.
   */
  gravity?: { g: number; direction: [number, number, number] };
  /**
   * Optional surface pressure / traction loads. `direction` selects the extreme
   * face the load acts on. By default the traction is uniform:
   * t = magnitude·(−direction) (magnitude in MPa = N/mm², positive = inward push),
   * distributed as consistent tributary-area nodal forces. When `normal` is true
   * the load instead follows each loaded triangle's own outward normal
   * (t = −magnitude·n̂), i.e. a true pressure normal to a curved/non-planar face.
   * `region` selects which triangles are loaded: 'face' (default, the extreme
   * face toward `direction`), 'facing' (every triangle whose outward normal
   * faces `direction`), or 'all' (the whole exterior — hydrostatic, normal mode).
   * Honoured on the box-mesh fallback (which now carries surface connectivity).
   */
  pressures?: { magnitude: number; direction: [number, number, number]; normal?: boolean; region?: "face" | "facing" | "all" }[];
  /**
   * Fatigue load ratio R = σ_min/σ_max for the Goodman/Basquin estimate.
   * Default 0 (pulsating 0→peak). −1 = fully reversed; R>0 = tension-biased.
   */
  fatigueLoadRatio?: number;
  /**
   * Through-layer (weak) axis in the mesh/global frame — the FDM layer normal,
   * from the picked bed face. When present the solver rotates the orthotropic
   * tensor to align its weak axis with it (exact upright/angled model, issue
   * #101) instead of the scalar-swap approximation. Direction only; sign and
   * in-plane azimuth are immaterial.
   */
  layerNormal?: [number, number, number];
  /**
   * Optional progress callback (issue #109). Invoked at each phase boundary and,
   * when the solve streams, at CG residual checkpoints. Non-serializable, so it
   * is only ever set by the SSE server path — the blocking JSON path and all
   * tests leave it undefined and are unaffected.
   */
  onPhase?: (ev: AnalysisPhaseEvent) => void;
  /**
   * Optional abort signal (issue #109). Checked at each phase boundary; when
   * aborted (client disconnected or clicked Cancel), runAnalysis throws
   * AnalysisAbortError instead of burning CPU on a result nobody will read.
   */
  signal?: AbortSignal;
  /**
   * Adaptive-refinement seam (issue #149) — INTERNAL. When present, runAnalysis
   * skips its own STL/STEP meshing and solves this pre-built mesh instead. Set
   * only by runAdaptiveAnalysis when feeding a re-meshed volume back through the
   * pipeline. Undefined on every normal request ⇒ zero effect on the default
   * path. `_prebuiltMesh` must carry the same surface→node conventions
   * meshWithTetGen produces (surface vertices first, in order).
   */
  _prebuiltMesh?: {
    mesh:          import("./solver/types.js").TetMesh;
    surfaceToNode: Int32Array;
    surfaceFaces:  Int32Array | null;
  };
  /**
   * Adaptive-refinement seam (issue #149) — INTERNAL. A mutable capture object
   * runAnalysis writes the raw solved mesh and per-element error field into, so
   * the adaptive driver can build the next size field. A pure side-write at the
   * very end of the solve; it changes NO computed output, so the default path
   * (undefined) stays bit-identical.
   */
  _captureInternals?: {
    mesh?:          import("./solver/types.js").TetMesh;
    errorEstimate?: Float32Array;
    surfaceToNode?: Int32Array;
    surfaceFaces?:  Int32Array | null;
    meshFallback?:  boolean;
    /** Nodes carrying a displacement constraint (bolt walls) — BC-singularity input. */
    constrainedNodes?: Int32Array;
    /** Nodes carrying an applied nodal force — BC-singularity input. */
    loadedNodes?:      Int32Array;
  };
}

export interface PrintRecommendation {
  label:       string;
  infillPct:   number;
  pattern:     string;
  orientation: string;
  wallCount:   number;
  estimatedSF: number;
  estimatedFailN: number;
  vsCurrentPct: number;  // % change vs current settings
  highlight:   boolean;  // best recommendation
}

export interface RigidBodyModeWarning {
  detected:        boolean;
  /** Direction of the unresisted rotation axis, in mesh coordinates */
  axisDirection:   [number, number, number];
  /** A point the unresisted axis passes through (the constrained-node centroid) */
  axisPoint:       [number, number, number];
  /** Net torque (N·mm) the applied load(s) exert about that axis — this is
   *  what makes the under-constraint a REAL problem rather than a harmless
   *  geometric coincidence. Near-zero means the load doesn't drive the mode. */
  drivingTorqueNmm: number;
  /** How collinear the constrained nodes are (0 = perfectly spread in that
   *  dimension, would be ~1 for a true point/line). Used only for the
   *  message, not the pass/fail decision — torque is what decides that. */
  message:         string;
}

export interface SingularityWarning {
  /**
   * Whether this rises to a user-facing ALARM (issue #263).
   *
   * The object being present means the field is concentrated enough to describe
   * (`concentrationRatio` > `SINGULARITY_RATIO_REPORT`). `detected` means it is
   * conclusive enough on a SINGLE mesh to act on
   * (> `SINGULARITY_RATIO_ALARM`, or an isolated peak with no neighbours).
   *
   * The gap between the two is deliberate: a binary gate on this ratio flickers
   * on and off across meshes of the same part, because the ratio can sit within
   * noise of the threshold. Consumers that show a banner must key on `detected`;
   * consumers that report diagnostics can use the payload regardless.
   */
  detected:      boolean;
  /**
   * Index of the peak point in whichever field was assessed — the FEA MESH on
   * the production path (issue #263), the display mesh only when the detector
   * is called without `feaField`.
   *
   * Prefer `peakLocation` for anything spatial. This index is not portable
   * between the two meshes, and using it against the wrong one is silent: it
   * stays in range and points at an unrelated node. That mistake put the
   * adaptive loop's refinement-exclusion ball at an arbitrary location until
   * #257, and it is why the topology-suggestion caller translates through
   * `peakLocation` instead of passing this straight through.
   */
  peakVertexIdx: number;
  /** World-frame (raw mm) coordinate of the peak-stress point. Lets the client
   *  confirm the flagged singular vertex coincides with the peak-stress
   *  location and drives the convergence metric choice (issue #147). The
   *  mesh-independent way to refer to the peak — prefer it over peakVertexIdx. */
  peakLocation:  [number, number, number];
  peakStressMPa: number;
  /** Average stress in the local neighborhood (radius = neighborhoodRadiusMm).
   *  Name kept for payload back-compat; the radius is no longer a fixed 1mm. */
  stressAt1mmMPa: number;
  /** Neighborhood radius actually used, mm. Scaled to the LOCAL element size at
   *  the peak (not an absolute 1mm) so the heuristic is scale-invariant across a
   *  5mm bracket and a 500mm frame rail alike (issue #148). */
  neighborhoodRadiusMm: number;
  /** Local median surface-element edge length at the peak, mm (issue #148). */
  localElementSizeMm: number;
  /** Ratio: peakStress / neighborhood average — >3× suggests singularity */
  concentrationRatio: number;
  message:       string;
  confidence:    "high" | "medium" | "low";
  /** What the flag rests on (issue #148c): the server's single-mesh GEOMETRIC
   *  heuristic, or (set client-side) scale/unit-independent REFINEMENT
   *  divergence across a multi-mesh study. The client upgrades this field when
   *  it corroborates the flag with refinement evidence (issue #147). */
  evidence:      "single-mesh-heuristic" | "refinement";
  /** WHAT is singular (issue #257). A boundary condition applied over PART of a
   *  surface is singular at the curve where that patch stops, exactly as a
   *  re-entrant geometric corner is — but the remedies are opposite, so the
   *  three cases are named separately:
   *
   *    "constraint-edge" — the peak is nearest the rim of a CONSTRAINED patch.
   *                        The answer concerns the bolt idealization (#260).
   *    "load-edge"       — the peak is nearest the rim of a LOADED patch.
   *                        The answer concerns the contact area the load is
   *                        spread over.
   *    "geometry"        — neither rim is within the sampling radius. A fillet.
   *
   *  Both BC cases are decided by which rim the peak is NEAREST, and both are
   *  patch EDGES — this was called "load-point" until #271, which is why the
   *  name changed: the legacy load model spreads a force over a band of the
   *  extreme face, so what is singular is that band's rim, not a point. No
   *  load has ever been applied at a single point on this path. */
  cause:         "geometry" | "constraint-edge" | "load-edge";
  /** True when the peak is a large enough fraction of yield to matter for the
   *  verdict. Drives WORDING ONLY — never suppresses the warning. A singularity
   *  makes the peak stress mesh-dependent whether or not it is near yield, and
   *  that mesh-dependence is what the user is being told about (issue #256). */
  nearYield:     boolean;
}

export interface TopologySuggestion {
  /** Position in model space (mm) of the high-stress region centroid */
  position:      [number, number, number];
  label:         string;
  stressMPa:     number;
  suggestion:    string;
}

export interface FatigueEstimate {
  /**
   * Estimated cycles to failure using modified Goodman + Basquin.
   * null if stress is below endurance limit (infinite life).
   */
  estimatedCycles:    number | null;
  /** True if cycles < 100,000 — flag as fatigue concern */
  fatigueConcern:     boolean;
  /** Fatigue safety factor at 100,000 cycles */
  fatigueSF:          number;
  /** Endurance limit for this material + FDM setup (MPa) */
  enduranceLimitMPa:  number;
  /** Ultimate tensile strength used (MPa) */
  utsMPa:             number;
  /** Load ratio assumed (0 = fully pulsating, -1 = fully reversed) */
  loadRatio:          number;
  confidence:         "medium" | "low";
  note:               string;
  /**
   * BULK (von Mises amplitude) fatigue SF — the historical scalar estimate,
   * preserved verbatim so adding the interlayer check never silently changes
   * the reported bulk number. Equals `fatigueSF` when bulk governs.
   */
  bulkFatigueSF:      number;
  /** BULK Basquin cycles-to-failure (null = infinite life). Preserved from the scalar path. */
  bulkEstimatedCycles: number | null;
  /**
   * ADDITIVE interlayer (through-layer / interlaminar-shear) fatigue check —
   * present only for orthotropic materials with an interface stress field.
   * FDM cyclic delamination at the bead interface degrades from a lower
   * baseline than the bulk, so this term commonly governs cross-layer cyclic
   * loads even when the bulk estimate looks safe. Null for isotropic
   * materials or when no interface stress was available.
   */
  interlayer:         InterlayerFatigue | null;
  /**
   * Which mechanism gives the lower (governing) fatigue SF. The headline
   * verdict (`fatigueConcern`) is the MIN of the two: a concern if EITHER the
   * bulk or the interlayer term is a concern.
   */
  governingMechanism: "bulk" | "interlayer";
}

/**
 * Interlayer (through-layer) fatigue estimate — the cyclic counterpart of the
 * static interface criterion. The static path decomposes into in-plane bulk vs
 * tension-only interface traction; this mirrors that at the fatigue level.
 *
 * Amplitude: the interface driving stress is the tension-basis equivalent
 *   σ_iface = sqrt(⟨σzz⟩₊² + (τ_z · S_zt/S_zs)²)
 * (the static interface utilization × S_zt), so a single Goodman/Basquin runs
 * on the S_zt-basis endurance.
 *
 * Endurance: anchored to the STATIC interface allowable S_zt (≈ Z/Y × in-plane
 * yield — the "static Z/Y ratio as the zeroth-order default") knocked down by
 * the FLAT-print endurance ratio (0.37, the weaker of the flat-vs-upright Se/UTS
 * split), because flat prints already fatigue at the inter-layer bond.
 * Calibratable via the upright-vs-flat fatigue-coupon pair. Confidence LOW —
 * FDM interlayer S-N data is sparse.
 */
export interface InterlayerFatigue {
  /** Interlayer fatigue safety factor (modified Goodman on the interface traction). */
  fatigueSF:          number;
  /** Basquin cycles-to-failure for the interface (null = below the interlayer endurance limit). */
  estimatedCycles:    number | null;
  /** True if the interlayer term itself is a fatigue concern (SF < 1 or < 100k cycles). */
  fatigueConcern:     boolean;
  /** Interlayer endurance limit Se (MPa), on the S_zt allowable basis. */
  enduranceLimitMPa:  number;
  /** Interface tensile allowable S_zt used as the Goodman ultimate (MPa). */
  allowTensionMPa:    number;
  /** Interlaminar shear allowable S_zs (MPa). */
  allowShearMPa:      number;
  /** Peak through-layer opening stress ⟨σzz⟩₊ driving the cycle (MPa). */
  peakTensionMPa:     number;
  /** Peak driving interlayer shear τ_z (MPa). */
  peakShearMPa:       number;
  /** Tension-basis equivalent interface amplitude stress σ_iface used (MPa, = σ_max of the cycle). */
  peakInterfaceMPa:   number;
  confidence:         "medium" | "low";
  note:               string;
}

/**
 * Estimate fatigue life using modified Goodman criterion + Basquin power law.
 *
 * Assumptions:
 *   - Load ratio R = σ_min/σ_max is a user input (default 0 = pulsating).
 *     σ_max = peak VM, σ_a = σ_max(1−R)/2, σ_m = σ_max(1+R)/2. R=0 recovers
 *     σ_m=σ_a=σ_max/2 (repeated 0→peak, the conservative FTC default); R=−1 is
 *     fully reversed (σ_m=0, σ_a=σ_max); R>0 is a tension-biased cycle. A
 *     compressive mean stress (σ_m<0) is clamped to 0 in Goodman to stay
 *     conservative (its life benefit is not credited).
 *   - Endurance limit Se/UTS is orientation-dependent: 0.37 for flat prints
 *     (inter-layer bonds are the weak link) and 0.43 for upright prints.
 *     Conservative estimate: Juvinall & Marshek, and limited FDM fatigue data
 *     from Wang et al. 2020 (PLA fatigue life study)
 *   - Basquin exponent b ≈ -0.1 (typical for semi-ductile polymers)
 *   - Stress concentration factor Kf = 1.0 (FEM already captures geometry)
 *
 * Goodman: σ_a/Se + σ_m/Su = 1/SF_fatigue
 * Basquin:  N = (σ_a / (σ_f'))^(1/b) where σ_f' ≈ 1.5 × UTS
 *
 * Sources:
 *   Wang et al. 2020 — Fatigue behavior of FDM PLA under cyclic loading
 *   Juvinall & Marshek, Machine Component Design, §7
 *   Shigley's §6: endurance limit modifications
 *
 * Confidence: LOW-MEDIUM. FDM fatigue data is sparse. Treat as order-of-magnitude.
 */
/**
 * Modified-Goodman + Basquin core, shared by the bulk (von Mises) and the
 * interlayer (interface-traction) fatigue paths so the two can never diverge
 * in their cyclic mechanics — only their stress amplitude, endurance limit,
 * and ultimate differ. σ_max is the peak stress; Se the endurance limit; uts
 * the Goodman ultimate; sigmaf the Basquin fatigue-strength coefficient; b the
 * Basquin exponent; R the load ratio (already clamped).
 */
function goodmanBasquin(
  sigmaMax: number, Se: number, uts: number, sigmaf: number, b: number, R: number,
): { fatigueSF: number; estimatedCycles: number | null; sigma_a: number; sigma_m_eff: number } {
  const sigma_a = sigmaMax * (1 - R) / 2;
  const sigma_m = sigmaMax * (1 + R) / 2;
  // Compressive mean stress is beneficial; conservatively don't credit it.
  const sigma_m_eff = Math.max(0, sigma_m);
  // Modified Goodman: 1/SF = σ_a/Se + σ_m/Su
  const goodmanDemand = (sigma_a / Se) + (sigma_m_eff / uts);
  const fatigueSF = goodmanDemand > 0 ? 1 / goodmanDemand : 999;
  // Basquin cycles: σ_a,eq = σ_a/(1 − σ_m/Su) [Goodman-corrected amplitude]
  const sigmaEqA = sigma_a / Math.max(0.01, 1 - sigma_m_eff / uts);
  let estimatedCycles: number | null = null;
  if (sigmaEqA > Se) estimatedCycles = Math.max(1, Math.round(Math.pow(sigmaEqA / sigmaf, 1 / b)));
  return { fatigueSF, estimatedCycles, sigma_a, sigma_m_eff };
}

/**
 * Peak interface traction driving the interlayer fatigue cycle, plus the static
 * interface allowables. Mirrors the FEM inputs of the static interface
 * criterion (⟨σzz⟩₊ and interlaminar shear τ_z at the governing node).
 */
export interface InterlayerFatigueInput {
  /** Peak through-layer opening stress ⟨σzz⟩₊ (MPa) — σ_max of the interface cycle. */
  peakTensionMPa:  number;
  /** Peak driving interlayer shear τ_z (MPa). */
  peakShearMPa:    number;
  /** Static interface tensile allowable S_zt (MPa) — the Goodman ultimate for the interface. */
  allowTensionMPa: number;
  /** Static interlaminar shear allowable S_zs (MPa). */
  allowShearMPa:   number;
}

/**
 * Interlayer endurance ratio Se/S_zt for the through-layer bond under cyclic
 * load. Anchored to the FLAT-print bulk endurance ratio (0.37 — the weaker of
 * the flat-vs-upright split, since flat prints already fatigue AT the bond),
 * applied to the static interface allowable S_zt (which itself carries the
 * static Z/Y ratio). Calibratable via the upright-vs-flat fatigue coupon pair.
 * Confidence LOW.
 */
const INTERLAYER_ENDURANCE_RATIO_DEFAULT = 0.37;

export function estimateFatigue(
  peakVonMisesMPa: number,
  effectiveYieldMPa: number,
  materialId: string,
  orientation: string,
  /** Load ratio R = σ_min/σ_max. Default 0 (pulsating). Clamped to [-1, 0.95]. */
  loadRatioR: number = 0,
  /**
   * Optional fatigue calibration (from a fitted cyclic-coupon profile). When it
   * supplies an endurance ratio, the literature Se/UTS and Basquin b are
   * replaced by the measured values and confidence rises LOW→MEDIUM — mirroring
   * how a bearing coupon lifts the bearing mode.
   */
  calib?: { fatigueSeRatio?: number | null; fatigueBasquinB?: number | null; fatigueUTS_MPa?: number | null; fatigueFitQuality?: "good" | "poor" | null; fatigueSeRatioInterlayer?: number | null } | null,
  /**
   * Optional interlayer (through-layer / interlaminar-shear) interface stress —
   * when present the ADDITIVE interlayer fatigue check runs alongside the bulk
   * scalar path and the governing (min-SF) mechanism drives the verdict. Absent
   * for isotropic materials or when no interface stress field is available, in
   * which case the result is the bulk-only estimate (bit-identical to before).
   */
  interlayerInput?: InterlayerFatigueInput | null,
): FatigueEstimate {
  const R = Math.max(-1, Math.min(0.95, Number.isFinite(loadRatioR) ? loadRatioR : 0));
  const isCalibrated = calib != null && calib.fatigueSeRatio != null && Number.isFinite(calib.fatigueSeRatio);
  // Fit-quality gate (issue #179): a poor S-N fit still supplies the measured
  // Se/b (the team's own best data), but does NOT earn the LOW→MEDIUM upgrade —
  // the scatter is too large to call the estimate calibrated-grade.
  const calibPoorFit = isCalibrated && calib?.fatigueFitQuality === "poor";
  const calibratedConfident = isCalibrated && !calibPoorFit;
  // Base material UTS — use literature values, not FDM-reduced yield
  // UTS ≈ 1.15-1.25 × yield for PLA-like polymers
  // For FDM, we use the effective yield as the strength basis
  // BUT the endurance limit ratio applies to actual tested UTS of solid specimens
  const BASE_UTS: Record<string, number> = {
    pla:  65, petg: 55, abs: 48, tpu: 30, pa12: 58, asa: 48,
  };
  const baseMaterialUTS = (isCalibrated && calib?.fatigueUTS_MPa != null)
    ? calib.fatigueUTS_MPa
    : (BASE_UTS[materialId] ?? 55);

  // Endurance limit Se — from calibrated coupon data when available, otherwise
  // the orientation-adjusted literature ratio:
  //   Flat prints: Se ≈ 0.37 × UTS (inter-layer bonds are the weak link)
  //   Upright:    Se ≈ 0.43 × UTS
  //   Source: Wang et al. 2020 PLA fatigue, Juvinall §7
  const seRatio = isCalibrated
    ? calib!.fatigueSeRatio!
    : (orientation === 'upright' ? 0.43 : 0.37);
  const Se = baseMaterialUTS * seRatio;

  // For Goodman, we need UTS. Use effective yield as a proxy for actual UTS
  // (FDM parts typically fracture near yield for brittle-ish PLA)
  const utsMPa = Math.max(effectiveYieldMPa * 1.15, Se * 1.5);
  const sigmaf   = 1.5 * baseMaterialUTS;
  const b        = (isCalibrated && calib?.fatigueBasquinB != null) ? calib.fatigueBasquinB : -0.1;

  // ── Bulk (von Mises amplitude) path — the historical scalar estimate ──────
  // σ_max = peak VM: σ_a = σ_max(1−R)/2, σ_m = σ_max(1+R)/2. R=0 → σ_m=σ_a=σ_max/2.
  const bulk = goodmanBasquin(peakVonMisesMPa, Se, utsMPa, sigmaf, b, R);
  const bulkFatigueSF = +bulk.fatigueSF.toFixed(2);
  const bulkConcern = bulk.fatigueSF < 1.0 || (bulk.estimatedCycles !== null && bulk.estimatedCycles < 100_000);

  const cycleStrOf = (c: number | null): string => c === null
    ? 'infinite life (below endurance limit)'
    : c < 1_000
    ? `~${c.toLocaleString()} cycles — part will fail quickly under cyclic loading`
    : c < 100_000
    ? `~${c.toLocaleString()} cycles — fatigue concern for competition use (~${(c/500).toFixed(0)} matches)`
    : `~${c.toLocaleString()} cycles — adequate for competition use`;

  // ── Interlayer (through-layer / interlaminar-shear) path — ADDITIVE ───────
  // FDM cyclic delamination at the bead interface degrades from a lower
  // baseline than the bulk. The static interface criterion already erases the
  // tension-on-interface information from the scalar VM amplitude, so we run a
  // parallel Goodman/Basquin on the interface traction against an interlayer
  // endurance anchored to the static S_zt allowable (which carries the Z/Y
  // ratio) times the flat-print endurance ratio. Confidence LOW.
  let interlayer: InterlayerFatigue | null = null;
  if (interlayerInput && interlayerInput.allowTensionMPa > 0 && interlayerInput.allowShearMPa > 0) {
    const { peakTensionMPa, peakShearMPa, allowTensionMPa, allowShearMPa } = interlayerInput;
    // Tension-basis equivalent interface amplitude = S_zt × static interface
    // utilization = sqrt(⟨σzz⟩₊² + (τ_z·S_zt/S_zs)²). Reduces to ⟨σzz⟩₊ for
    // pure opening and to τ_z·S_zt/S_zs for pure interlayer shear.
    const shearOnTensionBasis = peakShearMPa * (allowTensionMPa / allowShearMPa);
    const sigmaIface = Math.sqrt(peakTensionMPa * peakTensionMPa + shearOnTensionBasis * shearOnTensionBasis);
    const seRatioIl = (isCalibrated && calib?.fatigueSeRatioInterlayer != null && Number.isFinite(calib.fatigueSeRatioInterlayer))
      ? calib.fatigueSeRatioInterlayer!
      : INTERLAYER_ENDURANCE_RATIO_DEFAULT;
    // Interface Goodman ultimate: the static tensile allowable S_zt (the bond
    // fractures at its through-layer tensile strength). Se on the same basis.
    const utsIface = allowTensionMPa;
    const SeIface  = allowTensionMPa * seRatioIl;
    const sigmafIface = 1.5 * utsIface;
    const il = goodmanBasquin(sigmaIface, SeIface, utsIface, sigmafIface, b, R);
    const ilConcern = il.fatigueSF < 1.0 || (il.estimatedCycles !== null && il.estimatedCycles < 100_000);
    interlayer = {
      fatigueSF: +il.fatigueSF.toFixed(2),
      estimatedCycles: il.estimatedCycles,
      fatigueConcern: ilConcern,
      enduranceLimitMPa: +SeIface.toFixed(1),
      allowTensionMPa: +allowTensionMPa.toFixed(1),
      allowShearMPa: +allowShearMPa.toFixed(1),
      peakTensionMPa: +peakTensionMPa.toFixed(2),
      peakShearMPa: +peakShearMPa.toFixed(2),
      peakInterfaceMPa: +sigmaIface.toFixed(2),
      confidence: (isCalibrated && calib?.fatigueSeRatioInterlayer != null) ? "medium" : "low",
      note: `Interlayer (through-layer) fatigue: ${cycleStrOf(il.estimatedCycles)}. ` +
            `σ_iface=${sigmaIface.toFixed(1)} MPa (⟨σzz⟩₊=${peakTensionMPa.toFixed(1)}, τ_z=${peakShearMPa.toFixed(1)} MPa) ` +
            `vs Se_interlayer=${SeIface.toFixed(1)} MPa (${(seRatioIl*100).toFixed(0)}% of S_zt=${allowTensionMPa.toFixed(1)} MPa). ` +
            `Cyclic delamination at the bead interface — the dominant FDM cyclic failure mode, degrades from a lower baseline than the bulk. ` +
            ((isCalibrated && calib?.fatigueSeRatioInterlayer != null)
              ? `Interlayer Se/UTS CALIBRATED from your upright-vs-flat fatigue coupon pair.`
              : `LOW confidence — interlayer S-N data sparse; anchored to the static Z/Y ratio. Run an upright-vs-flat fatigue coupon pair to calibrate.`),
    };
  }

  // ── Governing verdict: MIN of bulk and interlayer ─────────────────────────
  // Headline scalars stay the BULK values (never silently changed); the
  // verdict flag is a concern if EITHER mechanism is a concern.
  const governingMechanism: "bulk" | "interlayer" =
    interlayer && interlayer.fatigueSF < bulkFatigueSF ? "interlayer" : "bulk";
  const fatigueConcern = bulkConcern || (interlayer?.fatigueConcern ?? false);

  return {
    estimatedCycles: bulk.estimatedCycles,
    fatigueConcern,
    fatigueSF: bulkFatigueSF,
    enduranceLimitMPa: +Se.toFixed(1),
    utsMPa: +utsMPa.toFixed(1),
    loadRatio: R,
    confidence: calibratedConfident ? "medium" : "low",
    bulkFatigueSF,
    bulkEstimatedCycles: bulk.estimatedCycles,
    interlayer,
    governingMechanism,
    note: `${R === 0 ? "Pulsating load (R=0)" : `Load ratio R=${R.toFixed(2)}`}: ${cycleStrOf(bulk.estimatedCycles)}. ` +
          `σ_a=${bulk.sigma_a.toFixed(1)} MPa, σ_m=${bulk.sigma_m_eff.toFixed(1)} MPa. ` +
          `Se=${Se.toFixed(1)} MPa (${(seRatio*100).toFixed(0)}% of ${isCalibrated ? "measured" : "base"} UTS ${baseMaterialUTS.toFixed(0)} MPa, ${orientation} orientation). ` +
          (calibratedConfident
            ? `Using CALIBRATED S-N fit from cyclic coupon data (Se/UTS and Basquin b=${b.toFixed(3)} measured on your printer/filament). Goodman criterion + Basquin.`
            : calibPoorFit
            ? `Using your cyclic-coupon S-N fit (Se/UTS and Basquin b=${b.toFixed(3)}), but the fit quality was POOR (log-log scatter above the threshold) so confidence stays LOW — treat as order-of-magnitude and re-check the coupon data. Goodman criterion + Basquin.`
            : `FDM fatigue data sparse — treat as order-of-magnitude. Goodman criterion + Basquin b=-0.1. Run a fatigue coupon (POST /api/calibration/fatigue) to raise confidence. Source: Wang et al. 2020.`) +
          (interlayer
            ? ` BULK vs INTERLAYER: bulk SF ${bulkFatigueSF}×, interlayer SF ${interlayer.fatigueSF}× → ${governingMechanism.toUpperCase()} governs. ${interlayer.note}`
            : ``),
  };
}

// ─── Anisotropic utilization ratios (dual-criterion heatmap) ─────────────────
/**
 * Per-node anisotropic utilization ratios:
 *
 *   U_XY = sqrt(σxx² + σyy² − σxx·σyy + 3·τxy²) / yieldXY
 *          (in-plane von Mises measure vs in-plane yield Y)
 *   U_Z  = interface utilization of the layer-plane traction
 *          (fdmInterfaceUtilization: tension-only ⟨σzz⟩₊/S_zt interacting
 *           quadratically with τ_z/S_zs; under compression the friction-
 *           reduced shear only — audit A3: compression no longer counts
 *           toward bond failure).
 *
 * With the default S_zs = yieldZ/√3, tension-side values match the legacy
 * Hill-derived U_Z for pure states; compressive σzz now reads 0 instead of
 * |σzz|/yieldZ.
 *
 * Exported for unit testing (tests/unit/hill-utilization.test.ts).
 */
export function computeUtilizationRatios(
  sxx: number, syy: number, szz: number,
  txy: number, tyz: number, txz: number,
  yieldXY: number, yieldZ: number,
  yieldZShear?: number,
  mu: number = INTERFACE_FRICTION_MU,
): { uXY: number; uZ: number } {
  const uXY = Math.sqrt(Math.max(0, sxx*sxx + syy*syy - sxx*syy + 3*txy*txy)) / yieldXY;
  const zs = yieldZShear ?? yieldZ * INTERSHEAR_OVER_YIELDZ_DEFAULT;
  const { combined } = fdmInterfaceUtilization(szz, tyz, txz, yieldZ, zs, mu);
  return { uXY, uZ: combined };
}

/**
 * Peak interlayer-interface utilizations over all elements, decomposed into
 * the tension (delamination-onset) and shear terms — the FEM-field inputs
 * for the two interlayer failure-mode rows. The combined tension⊕shear
 * interaction already governs the headline SF via the dual criterion; these
 * rows report each mechanism's own margin (SF = 1/peak-utilization), so
 * "breaking upon the layers" and "layers sliding" are visible — and
 * calibratable — separately. Returns null for non-orthotropic materials.
 */
export function computeInterfaceModePeaks(
  mesh:        import("./solver/types.js").TetMesh,
  elemStress6: Float64Array,
  material:    AnyMaterial,
  field?:      ElementMaterialField | null,
): {
  sfTension: number; peakTensionMPa: number; allowTensionMPa: number;
  sfShear:   number; peakShearMPa:   number; allowShearMPa:   number;
} | null {
  if (!isOrthotropic(material)) return null;
  const axis = material.weakAxis;
  const weakR = (axis && Math.hypot(axis[0], axis[1], axis[2]) > 0
    && (axis[2] / (Math.hypot(axis[0], axis[1], axis[2]) || 1)) < 1 - 1e-12)
    ? rotationAligningZTo(axis) : null;
  const matZ  = material.yieldZ;
  const matZS = interlaminarShearOf(material);
  let maxUT = 0, maxUS = 0;
  let tStress = 0, tAllow = matZ;
  let sStress = 0, sAllow = matZS;
  for (let e = 0; e < mesh.elementCount; e++) {
    let szz = elemStress6[e * 6 + 2] ?? 0;
    let tyz = elemStress6[e * 6 + 4] ?? 0;
    let txz = elemStress6[e * 6 + 5] ?? 0;
    if (weakR) {
      const L = rotateStress6ToLocal([
        elemStress6[e * 6] ?? 0, elemStress6[e * 6 + 1] ?? 0, szz,
        elemStress6[e * 6 + 3] ?? 0, tyz, txz,
      ], weakR);
      szz = L[2]; tyz = L[4]; txz = L[5];
    }
    const bin = field ? (field.binOfElement[e] ?? 0) : 0;
    const yZ  = field ? (field.yieldZ[bin] ?? matZ) : matZ;
    const yZS = field ? (field.yieldZShear[bin] ?? matZS) : matZS;
    const u = fdmInterfaceUtilization(szz, tyz, txz, yZ, yZS);
    if (u.uTension > maxUT) { maxUT = u.uTension; tStress = Math.max(0, szz); tAllow = yZ; }
    if (u.uShear > maxUS) { maxUS = u.uShear; sStress = u.uShear * yZS; sAllow = yZS; }
  }
  const clampSF = (v: number) => Math.min(Math.max(v, 0), 999);
  return {
    sfTension: clampSF(maxUT > 1e-9 ? 1 / maxUT : 999),
    peakTensionMPa: tStress, allowTensionMPa: tAllow,
    sfShear:   clampSF(maxUS > 1e-9 ? 1 / maxUS : 999),
    peakShearMPa: sStress, allowShearMPa: sAllow,
  };
}

/** One build-height layer's peak interface state. */
export interface LayerInterfaceRisk {
  /** Layer index counting from the first-printed (lowest along the build axis) layer. */
  layer:    number;
  /** Layer mid-height along the build axis, mm (from the part's lowest point). */
  zMidMm:   number;
  /** Interface safety factor for this layer (1 / peak combined utilization), clamped [0,999]. */
  sf:       number;
  /** Peak tension (delamination-onset) utilization ⟨σzz⟩₊/S_zt in this layer. */
  uTension: number;
  /** Peak interlayer-shear utilization (friction-credited under compression) in this layer. */
  uShear:   number;
}

/** Full per-layer interface risk profile for the layer-by-layer delamination map. */
export interface LayerInterfaceProfile {
  /** Unit build axis (weak-axis / layer normal) the layers are stacked along, global frame. */
  buildAxis:      readonly [number, number, number];
  /** Effective layer thickness used for binning, mm (may be coarsened from the print layer height to cap bin count). */
  binHeightMm:    number;
  /** True when binHeightMm was coarsened above the print layer height to keep the profile bounded. */
  coarsened:      boolean;
  /** Index of the governing (lowest-SF) layer within `layers`. */
  governingIndex: number;
  /** Per-layer peaks, ordered from first-printed to last-printed. Only layers containing elements are emitted. */
  layers:         LayerInterfaceRisk[];
}

/** Cap on emitted layer bins so a thin-layer / tall-part combination can't bloat the payload. */
const MAX_LAYER_BINS = 320;

/**
 * Build-height interface risk profile: which PRINTED LAYERS are most at risk of
 * delamination, not just the single global peak that `computeInterfaceModePeaks`
 * reports. Elements are binned by their centroid position along the build axis
 * (the weak axis / layer normal); each bin reports its peak tension and shear
 * interface utilization via the same material-frame `fdmInterfaceUtilization`
 * used by the headline criterion. Returns null for non-orthotropic materials
 * (no interlayer interface is defined). See CLAUDE.md — this is a reporting
 * decomposition of physics already computed, it does not change any SF.
 */
export function computeLayerInterfaceProfile(
  mesh:          import("./solver/types.js").TetMesh,
  elemStress6:   Float64Array,
  material:      AnyMaterial,
  layerHeightMm: number,
  field?:        ElementMaterialField | null,
): LayerInterfaceProfile | null {
  if (!isOrthotropic(material)) return null;
  const n = mesh.elementCount;
  if (n === 0) return null;

  // Build axis = normalized weak axis (layer normal); default +Z. weakR rotates
  // global stress into the material frame, matching computeInterfaceModePeaks.
  const axisRaw = material.weakAxis;
  const axLen = axisRaw ? Math.hypot(axisRaw[0], axisRaw[1], axisRaw[2]) : 0;
  const buildAxis: readonly [number, number, number] =
    axLen > 1e-12 ? [axisRaw![0] / axLen, axisRaw![1] / axLen, axisRaw![2] / axLen] : [0, 0, 1];
  const weakR = (axLen > 1e-12 && buildAxis[2] < 1 - 1e-12) ? rotationAligningZTo(axisRaw!) : null;
  const matZ  = material.yieldZ;
  const matZS = interlaminarShearOf(material);
  const npe   = mesh.nodesPerElem;

  // Pass 1: element centroid projection onto the build axis + interface split.
  const proj = new Float64Array(n);
  const uT   = new Float64Array(n);
  const uS   = new Float64Array(n);
  const comb = new Float64Array(n);
  let minP = Infinity, maxP = -Infinity;
  for (let e = 0; e < n; e++) {
    // Centroid from the 4 corner nodes (indices 0–3 for both C3D4 and C3D10).
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < 4; k++) {
      const nd = mesh.elements[e * npe + k] ?? 0;
      cx += mesh.nodes[nd * 3] ?? 0;
      cy += mesh.nodes[nd * 3 + 1] ?? 0;
      cz += mesh.nodes[nd * 3 + 2] ?? 0;
    }
    cx *= 0.25; cy *= 0.25; cz *= 0.25;
    const p = cx * buildAxis[0] + cy * buildAxis[1] + cz * buildAxis[2];
    proj[e] = p;
    if (p < minP) minP = p;
    if (p > maxP) maxP = p;

    let szz = elemStress6[e * 6 + 2] ?? 0;
    let tyz = elemStress6[e * 6 + 4] ?? 0;
    let txz = elemStress6[e * 6 + 5] ?? 0;
    if (weakR) {
      const L = rotateStress6ToLocal([
        elemStress6[e * 6] ?? 0, elemStress6[e * 6 + 1] ?? 0, szz,
        elemStress6[e * 6 + 3] ?? 0, tyz, txz,
      ], weakR);
      szz = L[2]; tyz = L[4]; txz = L[5];
    }
    const bin = field ? (field.binOfElement[e] ?? 0) : 0;
    const yZ  = field ? (field.yieldZ[bin] ?? matZ) : matZ;
    const yZS = field ? (field.yieldZShear[bin] ?? matZS) : matZS;
    const u = fdmInterfaceUtilization(szz, tyz, txz, yZ, yZS);
    uT[e] = u.uTension; uS[e] = u.uShear; comb[e] = u.combined;
  }

  const span = Math.max(maxP - minP, 1e-9);
  const lh   = layerHeightMm > 1e-6 ? layerHeightMm : 0.2;
  const rawBins = Math.max(1, Math.ceil(span / lh));
  const coarsened = rawBins > MAX_LAYER_BINS;
  const nBins = coarsened ? MAX_LAYER_BINS : rawBins;
  const binHeightMm = coarsened ? span / nBins : lh;

  // Pass 2: accumulate per-bin peak utilizations.
  const binUT = new Float64Array(nBins);
  const binUS = new Float64Array(nBins);
  const binComb = new Float64Array(nBins);
  const binHas = new Uint8Array(nBins);
  for (let e = 0; e < n; e++) {
    let b = Math.floor((proj[e]! - minP) / binHeightMm);
    if (b < 0) b = 0; else if (b >= nBins) b = nBins - 1;
    binHas[b] = 1;
    if (uT[e]!   > binUT[b]!)   binUT[b]   = uT[e]!;
    if (uS[e]!   > binUS[b]!)   binUS[b]   = uS[e]!;
    if (comb[e]! > binComb[b]!) binComb[b] = comb[e]!;
  }

  const clampSF = (v: number) => Math.min(Math.max(v, 0), 999);
  const layers: LayerInterfaceRisk[] = [];
  let governingIndex = 0, minSf = Infinity;
  for (let b = 0; b < nBins; b++) {
    if (!binHas[b]) continue;
    const sf = clampSF(binComb[b]! > 1e-9 ? 1 / binComb[b]! : 999);
    if (sf < minSf) { minSf = sf; governingIndex = layers.length; }
    layers.push({
      layer:    b,
      zMidMm:   +((b + 0.5) * binHeightMm).toFixed(4),
      sf:       +sf.toFixed(3),
      uTension: +binUT[b]!.toFixed(4),
      uShear:   +binUS[b]!.toFixed(4),
    });
  }
  if (layers.length === 0) return null;
  return {
    buildAxis,
    binHeightMm: +binHeightMm.toFixed(4),
    coarsened,
    governingIndex,
    layers,
  };
}

/**
 * Peak in-plane cross-bead (bead-to-bead) utilization over all elements, for the
 * feature-#6 failure-mode row. Same cross-bead tension⊕shear form the criterion
 * uses, in the material frame. Returns null for non-orthotropic materials.
 */
export function computeCrossBeadPeak(
  mesh:        import("./solver/types.js").TetMesh,
  elemStress6: Float64Array,
  material:    AnyMaterial,
  aniso:       InPlaneAniso,
  field?:      ElementMaterialField | null,
): { sf: number; peakMPa: number; allowMPa: number } | null {
  if (!isOrthotropic(material)) return null;
  const axis = material.weakAxis;
  const weakR = (axis && Math.hypot(axis[0], axis[1], axis[2]) > 0
    && (axis[2] / (Math.hypot(axis[0], axis[1], axis[2]) || 1)) < 1 - 1e-12)
    ? rotationAligningZTo(axis) : null;
  const th = aniso.rasterAngleDeg * Math.PI / 180;
  const c = Math.cos(th), s = Math.sin(th);
  let maxU = 0, peak = 0, allow = aniso.crossBeadRatio * material.yieldXY;
  for (let e = 0; e < mesh.elementCount; e++) {
    let sxx = elemStress6[e * 6] ?? 0, syy = elemStress6[e * 6 + 1] ?? 0, txy = elemStress6[e * 6 + 3] ?? 0;
    if (weakR) {
      const L = rotateStress6ToLocal([
        sxx, syy, elemStress6[e * 6 + 2] ?? 0, txy, elemStress6[e * 6 + 4] ?? 0, elemStress6[e * 6 + 5] ?? 0,
      ], weakR);
      sxx = L[0]; syy = L[1]; txy = L[3];
    }
    const bin  = field ? (field.binOfElement[e] ?? 0) : 0;
    const yXY  = field ? (field.yieldXY[bin] ?? material.yieldXY) : material.yieldXY;
    const yCr  = aniso.crossBeadRatio * yXY;
    const sCr  = yCr / Math.sqrt(3);
    const sPerp = s * s * sxx + c * c * syy - 2 * c * s * txy;
    const tRp   = -c * s * sxx + c * s * syy + (c * c - s * s) * txy;
    const u = sPerp > 0
      ? Math.hypot(sPerp / yCr, tRp / sCr)
      : Math.abs(tRp) / sCr;
    if (u > maxU) { maxU = u; peak = Math.max(0, sPerp); allow = yCr; }
  }
  return { sf: Math.min(Math.max(maxU > 1e-9 ? 1 / maxU : 999, 0), 999), peakMPa: peak, allowMPa: allow };
}

/**
 * Calibration state of the two interlayer allowables, in ONE place so the
 * failure-mode-row confidence and the coupon recommender can never drift apart.
 *   zCalibrated — a real Z-tension coupon set S_zt (NOT the τ/0.58 shear
 *                 derivation, which leaves the row literature-grade).
 *   sCalibrated — a lap-shear coupon measured S_zs directly.
 *   bondActive/bondFitted — the process bond model is on / has fitted coeffs.
 */
export function interfaceCalibrationState(
  cal: CalibrationProfile | null | undefined,
  process: ProcessSettings | undefined,
): { zCalibrated: boolean; sCalibrated: boolean; bondActive: boolean; bondFitted: boolean } {
  return {
    zCalibrated: cal?.yieldZ_MPa != null && cal?.yieldZFromShear !== true,
    sCalibrated: cal?.interShear_MPa != null,
    bondActive:  hasProcessSettings(process),
    bondFitted:  cal?.bondCoeffs != null,
  };
}

/** A prioritized suggestion to print/run a calibration coupon. */
export interface CouponRecommendation {
  /** Which coupon to run. */
  coupon:  "z-tension" | "lap-shear" | "bond-sweep";
  /** Short human label. */
  label:   string;
  /** Why it matters for THIS design (which mode it calibrates, whether that mode governs). */
  reason:  string;
  /** Confidence tier it unlocks, e.g. "LOW → MEDIUM". */
  confidenceGain: string;
  /** True when it calibrates the currently governing interlayer mode. */
  governing: boolean;
}

/**
 * Rank the calibration coupons that would most improve confidence for this
 * specific result. Only the interlayer modes are considered (the tool's core
 * claim); a coupon that calibrates the GOVERNING mode is prioritized over one
 * that calibrates the non-governing mode. Returns [] when both interlayer
 * allowables are already measured and the bond model (if active) is fitted —
 * i.e. nothing left to recommend.
 */
export function computeCouponRecommendations(
  cal:       CalibrationProfile | null | undefined,
  process:   ProcessSettings | undefined,
  sfTension: number,
  sfShear:   number,
): CouponRecommendation[] {
  const st = interfaceCalibrationState(cal, process);
  const tensionGoverns = sfTension <= sfShear;
  const recs: Array<CouponRecommendation & { _priority: number }> = [];
  // Urgency rises as the mode's margin approaches 1; governing mode gets a big
  // base bump so it always sorts first.
  const urgency = (sf: number, governing: boolean) =>
    (governing ? 100 : 0) + 1 / Math.max(sf, 0.05);

  if (!st.zCalibrated) {
    recs.push({
      coupon: "z-tension",
      label:  "Z-tension dog-bone coupon",
      reason: `Interlayer tension (delamination onset)${tensionGoverns ? " — the GOVERNING mode" : ""} is on the literature ratio; ` +
              `a standing dog-bone measures the bond tensile allowable S_zt directly.`,
      confidenceGain: "LOW → MEDIUM",
      governing: tensionGoverns,
      _priority: urgency(sfTension, tensionGoverns),
    });
  }
  if (!st.sCalibrated) {
    recs.push({
      coupon: "lap-shear",
      label:  "Lap-shear coupon",
      reason: `Interlayer shear${!tensionGoverns ? " — the GOVERNING mode" : ""} uses the default S_zt/√3; ` +
              `a lap-shear coupon measures the interlaminar allowable S_zs directly.`,
      confidenceGain: "LOW → MEDIUM",
      governing: !tensionGoverns,
      _priority: urgency(sfShear, !tensionGoverns),
    });
  }
  if (st.bondActive && !st.bondFitted) {
    recs.push({
      coupon: "bond-sweep",
      label:  "Process bond-sweep fit",
      reason: `The bead-penetration bond model is active but running on literature constants; ` +
              `a Z-tension sweep across settings fits it to your printer.`,
      confidenceGain: "bond model LOW → MEDIUM",
      governing: false,
      _priority: 5,   // useful but below an uncalibrated governing allowable
    });
  }
  recs.sort((a, b) => b._priority - a._priority);
  return recs.map(({ _priority, ...r }) => r);
}

/** Interface-aware design-for-manufacturing guidance for a delamination-governed result. */
export interface DelaminationDFM {
  /** Which interface mechanism drives failure at the hotspot. */
  governingSubMode: "tension" | "shear";
  /**
   * Angle of the interface traction from the layer normal at the hotspot:
   * ~0° = pure opening (delamination), ~90° = pure sliding (interlayer shear).
   */
  interfaceLoadAngleDeg: number;
  /**
   * Strength unlocked by moving this load into the layer plane: yieldXY / S_zt
   * (tension) or yieldXY / S_zs (shear) — the factor by which the in-plane
   * allowable exceeds the bond allowable now governing.
   */
  inPlaneGainX: number;
  /** The current print orientation the advice is relative to. */
  currentOrientation: string;
  /** Concrete, ordered advice lines. */
  suggestions: string[];
}

/**
 * Turn a delamination-governed hotspot into concrete design advice: reorient so
 * the load lies in the (strong) layer plane, or — for a sliding interface — add
 * perimeter walls. Inputs are the governing element's stress in the MATERIAL
 * frame (weak axis = local Z) and its allowables. The strength ratios are real
 * material scalars (in-plane yield vs the bond allowable), so the "×N stronger"
 * claim is grounded, not a heuristic. Advisory only — changes no SF.
 */
export function computeDelaminationDFM(
  localSzz: number, localTyz: number, localTxz: number,
  yieldXY: number, yieldZ: number, yieldZShear: number,
  orientation: string,
): DelaminationDFM {
  const shear = Math.hypot(localTyz, localTxz);
  const uT = Math.max(0, localSzz) / Math.max(yieldZ, 1e-9);
  const uS = shear / Math.max(yieldZShear, 1e-9);
  const tension = uT >= uS;
  const angle = Math.atan2(shear, Math.max(localSzz, 0)) * 180 / Math.PI;
  const gain = tension ? yieldXY / Math.max(yieldZ, 1e-9) : yieldXY / Math.max(yieldZShear, 1e-9);
  const gainStr = `~${gain.toFixed(1)}×`;
  const suggestions: string[] = [];
  if (tension) {
    suggestions.push(
      `The layer bond is opening in tension (interface traction ${angle.toFixed(0)}° from the layer normal). ` +
      `Reorient so this load lies in the layer plane — that trades the bond allowable S_zt for the in-plane strength, ${gainStr} stronger here.`,
    );
    if (orientation === "flat") {
      suggestions.push(`Currently printed flat (layers ⟂ the pull). Printing upright or on-edge would carry this load along the beads instead of across the bond.`);
    } else {
      suggestions.push(`Aim the ${gainStr}-stronger in-plane direction at the peak tension, and keep interfaces out of the highest-tension region.`);
    }
  } else {
    suggestions.push(
      `Layers are sliding (interlayer shear, traction ${angle.toFixed(0)}° from the layer normal). ` +
      `Add perimeter walls — the dense shell carries interlayer shear — or reorient so the shear acts in-plane (${gainStr} the interlaminar allowable).`,
    );
    suggestions.push(`Interlayer shear governs short overhangs and shear-loaded joints; more walls beat more infill here.`);
  }
  return {
    governingSubMode: tension ? "tension" : "shear",
    interfaceLoadAngleDeg: +angle.toFixed(1),
    inPlaneGainX: +gain.toFixed(2),
    currentOrientation: orientation,
    suggestions,
  };
}

// ─── Cosine-bearing nodal force distribution ──────────────────────────────────
/**
 * Distribute a bolt bearing load over the loaded-face nodes using a cosine
 * distribution: w(θ) = max(0, cos θ), where θ is the angle between the node
 * position (relative to the hole centre) and the force direction. The weights
 * are normalized so the vector sum of the nodal forces equals the applied
 * force exactly; the peak occurs at the contact point (θ = 0) and the load
 * tapers to zero at θ = ±90°.
 *
 * @param nodes      Packed node coordinates [x0,y0,z0, x1,y1,z1, ...]
 * @param faceNodes  Indices (into `nodes`) of the loaded face nodes
 * @param ux,uy,uz   Unit force direction
 * @param fx,fy,fz   Total force components (N) — magnitude × unit direction
 *
 * Exported for unit testing (tests/unit/cosine-bearing-normalization.test.ts).
 */
export function computeCosineBearingForces(
  nodes: ArrayLike<number>,
  faceNodes: number[],
  holeCenterX: number, holeCenterY: number, holeCenterZ: number,
  ux: number, uy: number, uz: number,
  fx: number, fy: number, fz: number,
): { nodalForces: Array<[number, number, number]>; peakNodalForce: number } {
  const k = faceNodes.length || 1;

  // Compute cosine weights
  const weights = new Float64Array(faceNodes.length);
  for (let ni = 0; ni < faceNodes.length; ni++) {
    const n = faceNodes[ni]!;
    const nx = nodes[n*3]   ?? 0;
    const ny = nodes[n*3+1] ?? 0;
    const nz = nodes[n*3+2] ?? 0;

    // Vector from hole center to node
    const rx = nx - holeCenterX;
    const ry = ny - holeCenterY;
    const rz = nz - holeCenterZ;

    // cos(θ) = (r · d) / (|r| × |d|), d already normalized
    const dotProduct = rx * ux + ry * uy + rz * uz;
    const rMag = Math.sqrt(rx*rx + ry*ry + rz*rz) || 1e-6;
    const cosTheta = dotProduct / rMag;

    weights[ni] = Math.max(0, cosTheta);
  }

  // Normalize weights so total force is preserved
  const wSum = Array.from(weights).reduce((a,b)=>a+b, 0);
  const wScale = k / wSum;  // scale so Σ w_i = k
  let peakNodalForce = 0;
  const nodalForces: Array<[number, number, number]> = [];
  for (let ni = 0; ni < faceNodes.length; ni++) {
    const w = (weights[ni]! * wScale) / k;
    const forceMag = Math.sqrt((fx*w)*(fx*w) + (fy*w)*(fy*w) + (fz*w)*(fz*w));
    peakNodalForce = Math.max(peakNodalForce, forceMag);
    nodalForces.push([fx*w, fy*w, fz*w]);
  }
  return { nodalForces, peakNodalForce };
}

export interface IsotropicComparison {
  /** SF predicted by a conventional isotropic FEA tool (treating the FDM part as solid) */
  isoSafetyFactor:    number;
  /** Peak VM stress from the isotropic model, MPa */
  isoMaxVonMisesMPa:  number;
  /** How much more optimistic the isotropic model is, as a % */
  optimismPct:        number;
  /** Whether the isotropic model would call this part safe (SF >= 1) when STORMFEA says it fails */
  falseSafe:          boolean;
  /** Short plain-English explanation for the judge panel */
  explanation:        string;
}

/**
 * Which material model produced the solve, echoed to the client so the UI
 * can label results and show the two-region diagnostics.
 */
export interface MaterialModelInfo {
  twoRegion:            boolean;
  /** Perimeter wall-band thickness used for classification (wallCount × line width). */
  wallThicknessMm:      number | null;
  /**
   * Top/bottom solid-skin (floor/ceiling) band thicknesses, mm. Derived from
   * the solid top/bottom layer COUNT × layer height (issue #181) — a quantity
   * independent of the perimeter wall band. Always present for a two-region
   * solve; when the caller supplied no layer counts these use the assumed
   * defaults (see skinLayersAssumed).
   */
  skinTopThicknessMm?:  number | null;
  skinBotThicknessMm?:  number | null;
  /** Solid top/bottom layer counts used to derive the skin thicknesses. */
  skinTopLayers?:       number;
  skinBotLayers?:       number;
  /**
   * True when the top or bottom skin layer count was not supplied and the
   * slicer-default assumption (DEFAULT_TOP_LAYERS / DEFAULT_BOTTOM_LAYERS) was
   * used — set the actual slicer values for an accurate skin credit.
   */
  skinLayersAssumed?:   boolean;
  /**
   * Build axis the skin classification used. "bed" = the picked bed normal;
   * "assumed-z-up" = no bed picked, so global +Z was assumed (skins may be
   * misplaced if the part is not modeled Z-up).
   */
  skinBuildAxis?:       "bed" | "assumed-z-up";
  /** Shell (dense wall) share of part volume from the geometric classification. */
  shellVolumeFraction:  number | null;
  shellYieldXYMPa:      number | null;
  coreYieldXYMPa:       number | null;
  /**
   * Set when the two-region model ran and found NOTHING TO SPLIT — shell and
   * core are the same material (100% infill), so the classification was
   * skipped entirely rather than computed and discarded (issue #297).
   *
   * Deliberately not `degraded`: that means "requested but undeliverable on
   * this mesh" and is rendered as a warning. This is a correct, complete
   * answer — the part genuinely has one material — so it is reported as a
   * neutral note.
   */
  collapsed?:           string;
  /**
   * Anchor diagnostics: the volume-weighted average strength multiplier the
   * two-region split implies vs the legacy geometry-blind global multiplier.
   * Reported, deliberately NOT renormalized — the divergence is the point.
   */
  impliedAvgStrengthMul: number | null;
  globalModelStrengthMul: number;
  /**
   * Core (infill) homogenization diagnostics — present when the two-region
   * model ran with the Gibson-Ashby lattice laws (solver/lattice.ts).
   */
  core?: {
    model:             "gibson-ashby";
    patternFamily:     "tpms3d" | "walls25d" | "sparse";
    /** Effective in-plane stiffness exponent n (after calibration override). */
    stiffnessExponent: number;
    /** Strength exponent m (after calibration override). */
    strengthExponent:  number;
    /** g(ρ) = E_core / E_solid at the requested infill. */
    stiffnessScale:    number;
    /** s(ρ) = σ_core / σ_solid at the requested infill (pattern-clamped). */
    strengthScale:     number;
    /** True when g(ρ) hit the 1e-3 low-density floor. */
    floored:           boolean;
    /**
     * Core BULK yield criterion (issue #171). "deshpande-fleck-ashby" = the
     * pressure-dependent foam criterion σ̂² = (σ_vm² + α²σ_m²)/(1 + (α/3)²) with
     * the disclosed dfaAlpha; the core yields hydrostatically. "von-mises" only
     * when α = 0 (ρ = 1, i.e. the solid limit). Shell bins are always von Mises.
     */
    yieldCriterion:    "deshpande-fleck-ashby" | "von-mises";
    /** DFA pressure-sensitivity α(ρ) of the pure core (0 at ρ=1). LOW confidence. */
    dfaAlpha:          number;
    confidence:        "LOW";
  };
  /** Set when the two-region request degraded to uniform (why). */
  degraded?:            string;
  /**
   * Bead-penetration bond model diagnostics — present when process settings
   * activated it (server/solver/bond.ts, audit A6).
   */
  bond?: {
    relStrength:    number;
    relStiffness:   number;
    /**
     * False when the material has no bond-table entry (issue #186): the bond
     * path was refused, so `relStrength`/`relStiffness` are the reference no-op
     * (1.0) and the thermal diagnostics below are omitted. Absent ⇒ applied.
     */
    applied?:       boolean;
    /** Per-material reference cooling-fan duty the multiplier is anchored to, %
     *  (#184). Present only when the bond path applied (omitted on the #186 no-op). */
    coolingFanRefPct?: number;
    interfaceTempC?: number;
    substrateTempC?: number;
    coolTimeConstS?: number;
    clamped:        boolean;
    confidence:     "low" | "medium";
    note:           string;
  };
  /**
   * Wall-to-wall (bead-to-bead) bond diagnostics — present when
   * analysis.wallBond activated it (requires twoRegion and wallCount >= 2).
   * Null when requested but there was no internal loop boundary to model.
   */
  wallBond?: {
    relStrength:         number;
    relStiffness:        number | null;
    yieldWallMPa:         number;
    yieldWallShearMPa:    number;
    /** Estimated average wall-loop perimeter length used for the inter-pass revisit time, mm. */
    perimeterLengthMm:    number;
    /** True when the perimeter estimate degenerated and the fallback constant was used. */
    perimeterFallback:    boolean;
    /**
     * Basis of the loop-length estimate (#182): "outer-contour" — the
     * outer-wall loop(s) only, internal hole bores excluded; or "fallback" —
     * the fixed characteristic length used when the geometric estimate
     * degenerated.
     */
    loopLengthBasis:      "outer-contour" | "fallback";
    note?:                string;
  } | null;
}

/**
 * Volumetric stress payload for the section-view interior heatmap (issue
 * #190). Everything is expressed on the ANALYSIS mesh (mesh.nodes /
 * mesh.elements), not the display mesh — the client's marching-tet slicer
 * walks corner tets directly, so mid-side nodes of C3D10 elements are
 * omitted (linear interpolation across the 4 corners is exact for a linear
 * element and a documented approximation for a quadratic one; see PR notes).
 * All arrays are per-node (indexed by nodeIndex, 0..nodeCount-1) except
 * `tets`, which is 4 node indices per tet (cornerTetCount*4 length).
 */
export interface VolumeFieldPayload {
  nodeCount:    number;
  cornerTetCount: number;
  /** Node positions, xyz interleaved, length = nodeCount*3. Base64 Float32. */
  nodesB64:           string;
  /** Corner-tet connectivity (4 node indices per tet). Base64 Int32. */
  tetsB64:            string;
  /** Per-node von Mises stress (MPa). Base64 Float32. */
  nodeVonMisesB64:        string;
  /** Per-node signed von Mises (tension +, compression -). Base64 Float32. */
  nodeSignedVonMisesB64:  string;
  /** Per-node principal stresses σ1≥σ2≥σ3. Base64 Float32 each. */
  nodePrincipal1B64:      string;
  nodePrincipal2B64:      string;
  nodePrincipal3B64:      string;
  /** Per-node anisotropic utilization ratios (0-2ish); null if unavailable (isotropic material with no tensor recovery). */
  nodeXyUtilB64:          string | null;
  nodeZUtilB64:            string | null;
  /**
   * Per-node shell (wall) fraction in [0, 1] — 0 pure infill core, 1 pure solid
   * wall/skin (issue #297). Null when no two-region field ran.
   *
   * This is the ONLY surface the split can be seen on. A part's boundary is
   * wall BY CONSTRUCTION — every boundary node sits at distance 0 from the
   * surface and so inside the wall band — so the same field on the display
   * mesh is identically 1.0 on every part and carries no information. The
   * walls, the core, and the difference between a 2-wall and a 5-wall part are
   * only visible on a CUT.
   */
  nodeShellFractionB64:   string | null;
}

export interface AnalysisResult {
  materialModel:           MaterialModelInfo;
  /**
   * Per-analysis validation coverage map (issue #191) — which
   * solver_validation groups and unit-test suites directly exercise THIS
   * analysis's configuration (element order, material model, criterion,
   * load types, mesher, opt-in options), and which characteristics have no
   * direct anchor. See server/validation-coverage.ts for what "covered"
   * means and doesn't.
   */
  validationCoverage:      ValidationCoverageReport;
  vertexStress:            Float32Array;
  vertexPrincipalStress:   Float32Array;
  vertexPrincipalStress2:  Float32Array;
  vertexPrincipalStress3:  Float32Array;
  vertexDisplacement:      Float32Array;
  surfaceTriangleCount:   number;
  maxVonMisesMPa:         number;
  maxDisplacementMm:      number;
  effectiveYieldMPa:      number;
  /**
   * THE headline safety factor: the GOVERNING SF (issue #278) — the minimum
   * over the FEM bulk-yield SF and every CHECKED analytic failure mode
   * (net-section tension, shear-out, thread strip-out, bearing, the interlayer
   * rows, buckling BLF). Exactly the quantity `verdict` reports, so the two can
   * never disagree.
   *
   * Before #278 this was `bulkSafetyFactor` (bulk yield only), which let the UI
   * show "SF 3.00× — Safe" beside a verdict of "Fails ... (Thread strip-out)".
   * On a part where no analytic mode is checked it collapses to exactly
   * `bulkSafetyFactor`, so those parts are unchanged.
   *
   * Null on a mesh-fallback solve (no trustworthy SF at all).
   */
  safetyFactor:           number | null;
  /**
   * The FEM bulk-yield SF alone — what `safetyFactor` used to be (issue #278).
   * Kept in the payload (disclosed, not hidden) because it is the single most
   * trustworthy number in the result: it comes from the solved stress field and
   * the calibrated material, whereas most analytic modes are closed-form
   * estimates at medium/low confidence. `sfCriterion`, `vonMisesSafetyFactor`,
   * `safetyfactorLow`/`safetyFactorHigh` and `sfBandComposition` all describe
   * THIS number, not the governing one.
   */
  bulkSafetyFactor:       number | null;
  /**
   * Name of the failure mode that produced `safetyFactor` — one of the
   * `failureModes[].mode` labels, or "Bulk yield" when the FEM bulk criterion
   * governs (including hole-free parts, which carry no explicit "Bulk yield"
   * row). Always present, so a UI can name the governing mode without
   * re-deriving the argmin.
   */
  governingMode:          string;
  /** Which yield criterion produced `bulkSafetyFactor` (issue #97).
   *  "fdm-interface" = the decoupled dual criterion (default);
   *  "hill" = legacy Hill 1948 (upright-no-bed fallback or explicit opt-in). */
  sfCriterion:            "fdm-interface" | "hill" | "von-mises";
  /**
   * Von Mises SF (effectiveYield / maxVM) — what a conventional isotropic
   * check gives on the same stress field. Kept for display/comparison next
   * to the Hill-based bulk SF.
   */
  vonMisesSafetyFactor:   number | null;
  /**
   * Headline fail-force estimate: `totalAppliedForce × safetyFactor`, i.e.
   * driven by the GOVERNING mode (issue #278). Linear first-yield
   * extrapolation, not an ultimate/collapse load (issue #204).
   */
  estimatedFailForce:     number;
  /**
   * `totalAppliedForce × bulkSafetyFactor` — the bulk-yield-only fail force,
   * i.e. what `estimatedFailForce` was before #278. Equal to
   * `estimatedFailForce` whenever bulk yield governs.
   */
  bulkFailForceN:         number;
  /** Conservative BULK SF using lower bound of literature uncertainty range */
  safetyfactorLow:        number | null;
  /** Optimistic BULK SF using upper bound of literature uncertainty range */
  safetyFactorHigh:       number | null;
  /**
   * Human-readable disclosure of which uncertainty terms contributed to the
   * BULK SF band (issues #172/#173): the interlayer yield-ratio and layer-height-slope
   * literature ranges, plus — when active — the bond-model LOW-confidence
   * constants (process path) and the Gibson-Ashby core strength-exponent
   * spread (low-infill two-region path).
   */
  sfBandComposition?:     string | null;
  yielding:               boolean;
  verdict:                string;
  cgIterations:           number;
  converged:              boolean;
  /**
   * True when STL meshing (TetGen) failed and the analysis fell back to a
   * plain bounding-box mesh. In that case the geometry analysed is a solid
   * block with NO holes or features, so stress concentrations are absent and
   * the result must be treated as a rough sanity check only.
   */
  meshFallback:           boolean;
  /**
   * Non-null when the model's bounding-box diagonal falls outside the plausible
   * millimetre range (<1 mm or >2000 mm) — a strong hint the STL/STEP was
   * exported in the wrong units (metres, inches, microns). STORMFEA does NOT
   * auto-rescale (that would silently invent a scale); it analyses the numbers
   * as given and surfaces this actionable warning so the user can re-export in
   * millimetres. All physical outputs (mm, MPa, N) are only meaningful if the
   * geometry really is in millimetres (issue #168).
   */
  unitsWarning:           string | null;
  /**
   * Non-null when the C3D10 midside-ordering guard rejected this mesher's output
   * twice and the analysis continued on LINEAR elements with the geometry intact
   * (issue #265). Distinct from `meshFallback`, which means the geometry itself
   * was replaced by a bounding box. Null on every normal run.
   */
  meshOrderDowngrade:     MeshOrderDowngrade | null;
  /**
   * What the selected mesh tier actually DELIVERED, measured on the returned
   * mesh (issue #295). A tier promises an element count and a floor of
   * `MIN_ELEMENTS_THROUGH_THICKNESS` elements across the thinnest section;
   * both meshers treat that as a request rather than a guarantee, so this is
   * how a shortfall becomes visible instead of silent. `warning` is non-null
   * only when the section is under-resolved or the count fell below half the
   * target. Null on the box fallback (where `meshFallback` is the disclosure
   * that matters) and on the adaptive path's pre-built meshes.
   */
  meshResolution:         MeshResolutionReport | null;
  solverMs:               number;
  nodeCount:              number;
  elementCount:           number;
  nodesPerElem:           number;
  recommendations:        PrintRecommendation[];
  failureModes:           FailureModeResult[];
  holeClassifications:    HoleClassification[];
  calibrationId:          string | null;
  singularity:            SingularityWarning | null;
  rigidBodyMode:          RigidBodyModeWarning | null;
  topologySuggestions:    TopologySuggestion[];
  /**
   * Build-height interface risk profile (which printed layers are most at risk
   * of delamination). Null when no interlayer interface is defined (isotropic
   * material or the interface criterion is not active).
   */
  layerInterfaceProfile:  LayerInterfaceProfile | null;
  /**
   * Prioritized calibration-coupon suggestions for THIS result — which coupon
   * would most improve confidence, governing interlayer mode first. Empty when
   * both interlayer allowables are measured (and the bond model, if active, is
   * fitted) or the interface criterion is not active.
   */
  couponRecommendations:  CouponRecommendation[];
  /**
   * Interface-aware design advice (reorient / add walls) — present only when the
   * governing hotspot is delamination/interlayer-shear governed, null otherwise.
   */
  delaminationDFM:        DelaminationDFM | null;
  fatigue:                FatigueEstimate;
  isotropicComparison:    IsotropicComparison;
  /** Mode shapes projected to surface vertices, one per mode. Base64-encoded Float32Array. */
  vertexModeShapesB64?:   string[];
  /** Present when analysisType === 'modal'. Undefined for static-only runs. */
  modalResult?:           ModalAnalysisResult;
  /** Buckling mode shape projected to surface vertices. Base64 Float32Array. Present only with a physical positive BLF. */
  vertexBucklingModeB64?: string;
  /** Structured buckling summary. Present when computeBuckling was requested and the analysis ran. */
  bucklingResult?: {
    blf: number | null;
    verdict: 'FAIL' | 'MARGINAL' | 'PASS' | 'no-buckling' | 'indeterminate';
    converged: boolean;
    tensileDominated: boolean;
    indeterminate: boolean;
    hasMode: boolean;
    /** True when the smallest-positive BLF is certified as the global minimum
     *  (no smaller positive mode skipped); false → treat blf as an estimate. */
    certified: boolean;
    /** Lowest positive BLFs (ascending, up to ~3); blf is the first. */
    positiveBLFs: readonly number[];
  };
  /** CG solver residual checkpoints for convergence visualization */
  residualCheckpoints?:   readonly { iteration: number; relativeResidual: number }[];
  /** Zienkiewicz-Zhu error estimate η_e at each vertex, projected from elements */
  vertexErrorEstimateB64?: string;
  /** Global relative error η for mesh quality assessment */
  globalRelativeError?:    number;
  /**
   * Share of `globalRelativeError`'s energy sitting at boundary-condition
   * discontinuities — the rim of a constrained or loaded patch (issue #259).
   * In [0, 1]. Present on ordinary solves as well as adaptive ones.
   *
   * A DIAGNOSIS for reading `globalRelativeError`, not a second error target:
   * the total is still the total. It answers the question the single number
   * cannot — whether a high error means "refine the mesh" or "reconsider the
   * constraint idealization", which call for opposite responses.
   *
   * Read it for THIS solve only. The band is topological (the patch rim plus
   * `BC_SINGULARITY_DILATE_HOPS` adjacency rings), so it thins as the mesh
   * refines and the fraction falls with density for that reason alone. It is
   * not a convergence metric. Undefined — never 0 — when no mask could be
   * built, so "not measured" stays distinguishable from "measured as none".
   */
  bcSingularityErrorFraction?: number;
  /** Top-20 elements with highest error estimates, for refinement guidance */
  topErrorElements?:       Array<{ x: number; y: number; z: number; errorEstimate: number }>;
  /**
   * Volumetric stress payload for the section-view interior heatmap (#190).
   * Present only when req.analysis.includeVolumeField was true. Node
   * positions and corner-tet connectivity of the ANALYSIS mesh (not the
   * display mesh), plus per-node stress/utilization values so the client can
   * linearly interpolate across whichever tet the section plane cuts.
   */
  volumeField?: VolumeFieldPayload;
  /**
   * Adaptive-refinement report (issue #149). Present only when the opt-in
   * `analysis.adaptiveRefinement` path ran; absent on the default single solve.
   */
  adaptiveRefinement?:     AdaptiveRefinementInfo;
  /** XY in-plane utilization per surface vertex (null if unavailable) */
  vertexXyUtil:            Float32Array | null;
  /** Z inter-layer utilization per surface vertex (null if unavailable) */
  vertexZUtil:             Float32Array | null;
  /** Which direction governs at the critical node: 'xy' or 'z' */
  governingDirection:      'xy' | 'z' | null;
  /** Peak U_XY across all nodes */
  peakUtilXY:              number;
  /** Peak U_Z across all nodes */
  peakUtilZ:               number;
  /** Signed von Mises: sign(σxx+σyy+σzz) × σ_VM per surface vertex */
  vertexSignedVonMises:    Float32Array;
  /** Most compressive signed VM value (negative) across all nodes */
  minSignedVonMisesMPa:    number;
  /** Most tensile signed VM value (positive) across all nodes */
  maxSignedVonMisesMPa:    number;
  /** False when mesh fallback occurred; true when SF values are valid */
  safetyFactorAvailable:   boolean;
}

// ─── Stress singularity detection ────────────────────────────────────────────
/**
 * Detects whether the peak stress is at a geometric singularity.
 *
 * A singularity occurs at sharp re-entrant corners (e.g. right-angle internal notches).
 * The FEM stress at a singularity grows without bound as mesh is refined — it does not
 * represent a real failure load, just a mathematical artifact of the linear elastic model.
 *
 * Detection method:
 *   1. Find peak stress vertex
 *   2. Measure the LOCAL element size at the peak (median edge length of the
 *      surface triangles touching it) and set the neighborhood radius to a
 *      small multiple of it (SINGULARITY_NEIGHBORHOOD_FACTOR × h_local). Using
 *      an element-relative radius instead of an absolute 1mm makes the test
 *      scale-invariant: on a 5mm part 1mm spanned much of the geometry (false
 *      positives); on a 500mm part 1mm was sub-element (missed) — issue #148.
 *   3. Compute the average stress in that neighborhood; if peak/neighborhood
 *      ratio > 3.0, flag as likely singular.
 *   4. Additional check: if the peak vertex has NO neighbors within the radius
 *      (isolated point), that is a strong singularity indicator.
 *
 * The decision is on the SHAPE of the field (the ratio), never on the absolute
 * stress. It used to also require `peakVal > 50` MPa, commented as "2x yield" —
 * a hardcoded PLA number that made detection depend on how hard the part was
 * loaded. Measured (issue #257): an identical field with a 12x concentration
 * ratio was flagged at 51 MPa and silent at 50, so the same part with the same
 * mesh and the same geometry gained or lost its warning purely by scaling the
 * applied force. That silently defeated the scale-invariance #148 established
 * for the neighborhood radius, in the load dimension instead of the length one,
 * and it is why `singularity` came back null on every run of the bolt-
 * constrained Ø5-bore tube, whose peak sits at 5.5-8.0 MPa. Whether the peak is
 * near yield is still reported, as `nearYield`, but it governs wording only.
 *
 * This is a SINGLE-MESH GEOMETRIC heuristic (evidence: "single-mesh-heuristic").
 * The stronger, scale- and unit-independent test — the peak growing
 * systematically under refinement (p_obs ≈ 0) — needs multi-mesh data and is
 * applied client-side, which upgrades `evidence` to "refinement" (issue #147).
 * False positives are still possible at genuine stress concentrations (e.g.
 * tight hole radii); confidence is reported accordingly.
 */
/**
 * Detects whether the constraint set leaves a rigid-body rotation mode
 * unresisted, AND whether the applied load actually drives that mode.
 *
 * Two bolted holes that are close together or roughly collinear restrain
 * translation and rotation about axes perpendicular to the line between
 * them, but provide essentially zero idealized resistance to rotation
 * ABOUT that line itself — point/line constraints in the linear FEM model
 * have no rotational stiffness, unlike a real bolt (which resists some
 * rotation through preload friction and head bearing, neither of which
 * this tool has calibration data for and so cannot quantify).
 *
 * This is NOT a "you need more bolts" check — many real FTC parts are
 * legitimately single- or double-bolted and don't spin in service. The
 * check only flags a problem when BOTH of these are true:
 *   1. The constrained nodes are nearly collinear (principal-axis spread
 *      analysis of the constraint point cloud)
 *   2. The applied load(s) produce a non-negligible net torque about that
 *      axis — i.e. the load is actually trying to drive the rotation the
 *      constraints can't resist, not just coincidentally collinear with it
 *
 * Detection method:
 *   1. Compute the centroid and inertia-like second-moment matrix of all
 *      constrained nodes combined
 *   2. Eigendecompose (Jacobi rotation) to get principal axes and spread
 *   3. If spread along the 2nd-largest principal axis is small relative to
 *      the part's bounding diagonal, the constraint set is nearly 1D —
 *      collinear, with the dominant axis being the unresisted rotation axis
 *   4. Compute net applied-load torque about that axis; only flag if this
 *      exceeds a small threshold relative to the load magnitude and the
 *      part's characteristic length (i.e. actually significant, not
 *      numerical noise)
 */
export function detectUnconstrainedRigidBodyMode(
  constraints:    { nodeIndices: number[] }[],
  forces:         { nodeIndex: number; forceN: [number, number, number] }[],
  mesh:           { nodes: Float64Array; nodeCount: number },
): RigidBodyModeWarning | null {
  // Gather all constrained node coordinates across all bolt holes
  const constrainedIdx: number[] = [];
  for (const c of constraints) constrainedIdx.push(...c.nodeIndices);

  // A SINGLE constrained node fixes three translational DOF and nothing else:
  // the body is free to rotate about every axis through that point. That is
  // strictly worse than the near-collinear case this function was written to
  // catch, and it used to return null here — "cannot compute an axis" was being
  // reported as "no problem", leaving the detector NON-MONOTONE in severity
  // (it warned at 2 nodes and stayed silent at 1 and 0).
  //
  // Not hypothetical: `findStlBoltConstraintNodes` deliberately falls back to
  // `[closestNode(...)]` — exactly one node — when it cannot find a hole wall,
  // which happens when the mesh is too coarse to put nodes on a small bore.
  // Measured on a Ø2.4 mm bore in a 4 797-element mesh: 1 wall node, a peak of
  // 75 423 MPa, and a reported safety factor of 0.00, with no warning of any
  // kind. Silent, catastrophic, and indistinguishable from a real result.
  //
  // There is no single unresisted axis to name, so the reported one is the axis
  // the LOAD actually drives — the direction of the net torque about the
  // constrained point, whose magnitude is a genuine driving torque in the same
  // sense the collinear branch uses below.
  if (constrainedIdx.length === 1) {
    const p = constrainedIdx[0]!;
    const ax = mesh.nodes[p * 3] ?? 0, ay = mesh.nodes[p * 3 + 1] ?? 0, az = mesh.nodes[p * 3 + 2] ?? 0;
    let tx = 0, ty = 0, tz = 0;
    for (const f of forces) {
      const rx = (mesh.nodes[f.nodeIndex * 3] ?? 0) - ax;
      const ry = (mesh.nodes[f.nodeIndex * 3 + 1] ?? 0) - ay;
      const rz = (mesh.nodes[f.nodeIndex * 3 + 2] ?? 0) - az;
      const [fx, fy, fz] = f.forceN;
      tx += ry * fz - rz * fy;
      ty += rz * fx - rx * fz;
      tz += rx * fy - ry * fx;
    }
    const tMag = Math.sqrt(tx * tx + ty * ty + tz * tz);
    const dir: [number, number, number] = tMag > 1e-12
      ? [tx / tMag, ty / tMag, tz / tMag]
      : [0, 0, 1];
    return {
      detected: true,
      axisDirection: dir,
      axisPoint: [ax, ay, az],
      drivingTorqueNmm: tMag,
      // Unlike the collinear branch, this is reported REGARDLESS of how large
      // the torque is. A one-point constraint is not a borderline modelling
      // choice that a small load makes acceptable — it is an invalid restraint,
      // and the number it produces is meaningless at any load.
      message: `Only ONE node is constrained, so the part is free to rotate about every axis through that point — this model is not restrained and no result from it is meaningful. This almost always means the mesh was too coarse to place nodes on a bolt hole's wall, so the constraint collapsed to a single fallback point rather than gripping the bore. Check that each bolted hole is large enough relative to your mesh: re-run at a finer mesh quality, or confirm the hole radius is correct. The applied load drives a torque of ${tMag.toFixed(0)} N·mm about this point with nothing resisting it.`,
    };
  }

  // Zero constraints is deliberately left alone here. It is a different claim —
  // translation is unresisted too, so there is no axis to report in the sense
  // this warning's payload means — and it is already caught downstream, where a
  // fully singular system fails to converge and the verdict says so. Whether a
  // constraint-free request should be rejected outright is a product question,
  // not one to settle inside a rotation detector.
  if (constrainedIdx.length < 2) return null;

  const nC = constrainedIdx.length;
  let cx = 0, cy = 0, cz = 0;
  for (const idx of constrainedIdx) {
    cx += mesh.nodes[idx*3] ?? 0;
    cy += mesh.nodes[idx*3+1] ?? 0;
    cz += mesh.nodes[idx*3+2] ?? 0;
  }
  cx /= nC; cy /= nC; cz /= nC;

  let Ixx=0, Iyy=0, Izz=0, Ixy=0, Ixz=0, Iyz=0;
  for (const idx of constrainedIdx) {
    const x = (mesh.nodes[idx*3] ?? 0) - cx;
    const y = (mesh.nodes[idx*3+1] ?? 0) - cy;
    const z = (mesh.nodes[idx*3+2] ?? 0) - cz;
    Ixx += x*x; Iyy += y*y; Izz += z*z;
    Ixy += x*y; Ixz += x*z; Iyz += y*z;
  }
  Ixx/=nC; Iyy/=nC; Izz/=nC; Ixy/=nC; Ixz/=nC; Iyz/=nC;

  // 3x3 symmetric eigendecomposition via Jacobi rotation — robust, no deps
  function jacobiEigen(A: number[][]): { eigenvalues: number[]; eigenvectors: number[][] } {
    const a = A.map(r => r.slice());
    const V = [[1,0,0],[0,1,0],[0,0,1]];
    for (let sweep = 0; sweep < 50; sweep++) {
      let off = 0;
      for (let p=0;p<3;p++) for (let q=p+1;q<3;q++) off += a[p]![q]! ** 2;
      if (off < 1e-20) break;
      for (let p=0;p<3;p++) for (let q=p+1;q<3;q++) {
        if (Math.abs(a[p]![q]!) < 1e-15) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2*a[p]![q]!);
        const t = Math.sign(theta||1) / (Math.abs(theta) + Math.sqrt(theta*theta+1));
        const c = 1/Math.sqrt(t*t+1), s = t*c;
        const app=a[p]![p]!, aqq=a[q]![q]!, apq=a[p]![q]!;
        a[p]![p] = c*c*app - 2*s*c*apq + s*s*aqq;
        a[q]![q] = s*s*app + 2*s*c*apq + c*c*aqq;
        a[p]![q] = 0; a[q]![p] = 0;
        for (let r=0;r<3;r++) {
          if (r!==p && r!==q) {
            const arp=a[r]![p]!, arq=a[r]![q]!;
            a[r]![p] = a[p]![r] = c*arp - s*arq;
            a[r]![q] = a[q]![r] = s*arp + c*arq;
          }
        }
        for (let r=0;r<3;r++) {
          const vrp=V[r]![p]!, vrq=V[r]![q]!;
          V[r]![p] = c*vrp - s*vrq;
          V[r]![q] = s*vrp + c*vrq;
        }
      }
    }
    return {
      eigenvalues: [a[0]![0]!, a[1]![1]!, a[2]![2]!],
      eigenvectors: [[V[0]![0]!,V[1]![0]!,V[2]![0]!],[V[0]![1]!,V[1]![1]!,V[2]![1]!],[V[0]![2]!,V[1]![2]!,V[2]![2]!]],
    };
  }

  const { eigenvalues, eigenvectors } = jacobiEigen([[Ixx,Ixy,Ixz],[Ixy,Iyy,Iyz],[Ixz,Iyz,Izz]]);

  // Part bounding diagonal for scale-relative thresholds
  const nAll = mesh.nodeCount;
  let bMin = [Infinity,Infinity,Infinity], bMax = [-Infinity,-Infinity,-Infinity];
  for (let i=0;i<nAll;i++) for (let d=0;d<3;d++) {
    const v = mesh.nodes[i*3+d] ?? 0;
    if (v < bMin[d]!) bMin[d] = v;
    if (v > bMax[d]!) bMax[d] = v;
  }
  const diag = Math.sqrt((bMax[0]!-bMin[0]!)**2 + (bMax[1]!-bMin[1]!)**2 + (bMax[2]!-bMin[2]!)**2) || 1;

  const pairs = eigenvalues
    .map((v, i) => ({ val: v, vec: eigenvectors[i]! }))
    .sort((a, b) => b.val - a.val);
  const relativeSpread = pairs.map(p => Math.sqrt(Math.max(0, p.val)) / diag);

  // Collinear: dominant axis has real spread, but the 2nd axis barely does
  const isNearlyCollinear = relativeSpread[1]! < 0.03 && relativeSpread[0]! > 0.03;
  if (!isNearlyCollinear) return null;

  const axisVec = pairs[0]!.vec; // the line direction = unresisted rotation axis
  const axisDir: [number, number, number] = [axisVec[0] ?? 0, axisVec[1] ?? 0, axisVec[2] ?? 0];
  const axisPoint: [number, number, number] = [cx, cy, cz];

  // Net torque from ALL applied forces about this axis
  let torque = 0;
  let totalForceMag = 0;
  for (const f of forces) {
    const px = (mesh.nodes[f.nodeIndex*3] ?? 0) - cx;
    const py = (mesh.nodes[f.nodeIndex*3+1] ?? 0) - cy;
    const pz = (mesh.nodes[f.nodeIndex*3+2] ?? 0) - cz;
    const [fx, fy, fz] = f.forceN;
    const tx = py*fz - pz*fy;
    const ty = pz*fx - px*fz;
    const tz = px*fy - py*fx;
    torque += tx*axisDir[0] + ty*axisDir[1] + tz*axisDir[2];
    totalForceMag += Math.sqrt(fx*fx + fy*fy + fz*fz);
  }

  // Only flag if the torque is non-trivial relative to a characteristic
  // force-times-length scale — this is what separates "collinear bolts but
  // the load doesn't care" from "collinear bolts AND the load is trying to
  // spin the part about that exact axis".
  const characteristicTorque = totalForceMag * diag * 0.02; // 2% of max-possible-arm torque
  if (Math.abs(torque) < characteristicTorque) return null;

  const axisDesc = `(${axisDir[0].toFixed(2)}, ${axisDir[1].toFixed(2)}, ${axisDir[2].toFixed(2)})`;
  return {
    detected: true,
    axisDirection: [axisDir[0], axisDir[1], axisDir[2]],
    axisPoint,
    drivingTorqueNmm: torque,
    message: `These constraints don't resist rotation about the axis through your bolted holes ${axisDesc} — the bolt points are nearly in line, and idealized point constraints have no rotational stiffness about that line. Your applied load produces a real torque (${torque.toFixed(0)} N·mm) about this axis, so the solver has nothing to resist it with, which is why it failed to converge and why any "safety factor" from this run is not physically meaningful. If a real bolt's preload friction and head bearing would resist this rotation in practice, that's likely true — but this tool has no calibration data for that stiffness, so it can't quantify it for you. To get a trustworthy number: add a constraint point that isn't on this line (even a second contact point, not necessarily a bolt), or reposition one of the existing bolts off-axis.`,
  };
}

// ─── Paired scalar field + coordinates ───────────────────────────────────────
/**
 * A per-point scalar field TOGETHER WITH the coordinates it is indexed by.
 *
 * This exists to make one specific mistake unrepresentable. Two point sets are
 * in play throughout this file and they are not interchangeable:
 *
 *   • the DISPLAY mesh — `req.positions`, 3 vertices per surface triangle,
 *     the uploaded STL's tessellation, indexed by `vertexStress`;
 *   • the FEA mesh — `mesh.nodes`, indexed by `nodeStress`.
 *
 * Passing a field from one alongside coordinates from the other is silent: the
 * index stays in range and simply points at an unrelated location. It has
 * happened FOUR times — the adaptive loop's refinement-exclusion ball (#257),
 * `peakVertexIdx` (#263), the singularity detector's own internals, and
 * `generateTopologySuggestions`, which was reading `mesh.nodes` at display-
 * vertex indices and therefore placing design markers at unrelated coordinates.
 * Three of the four were found by accident while chasing something else.
 *
 * Carrying the two together, and checking the length invariant once at
 * construction, converts every one of those from a silent wrong answer into a
 * loud failure at the call site. `space` is carried for diagnostics only —
 * the length check is what actually does the work.
 */
export interface SampledField {
  readonly space:  "display" | "fea";
  readonly values: Float32Array | Float64Array;
  /** 3 per point, world mm, EXACTLY `values.length * 3` long. */
  readonly coords: Float32Array | Float64Array;
  readonly count:  number;
}

/**
 * Pair a scalar field with its coordinates, refusing a mismatched pairing.
 *
 * Throws rather than degrading: a field indexed against the wrong point set
 * produces confident nonsense, and there is no partially-correct answer to fall
 * back to. The exact-length rule is what catches the real bug — a display field
 * (one value per display vertex) paired with FEA coordinates has far more
 * coordinates than `values.length * 3`, so it fails here instead of silently
 * reading the wrong node.
 */
export function sampledField(
  space:  "display" | "fea",
  values: Float32Array | Float64Array,
  coords: Float32Array | Float64Array,
): SampledField {
  const count = values.length;
  if (coords.length !== count * 3) {
    throw new Error(
      `[sampledField] ${space}: ${count} values against ${coords.length} coordinate ` +
      `components (expected ${count * 3}). A scalar field has been paired with the ` +
      `wrong point set — display-mesh values indexed against FEA node coordinates, ` +
      `or vice versa. Both must come from the same mesh.`,
    );
  }
  return { space, values, coords, count };
}

/** Neighborhood radius as a multiple of the local element size (issue #148). */
export const SINGULARITY_NEIGHBORHOOD_FACTOR = 2.5;

/**
 * Floor on the neighborhood radius, as a fraction of the part's bounding
 * diagonal (issue #263).
 *
 * Why a part-relative floor exists at all: a purely element-relative radius
 * cannot see a singularity. The field is self-similar near the tip, so a ball
 * that shrinks with the mesh gives a peak/neighbourhood ratio that stays
 * constant and small however severe the singularity is. Measured — with FEA
 * sampling and no floor, the ratio fell below the 3.0 threshold at all four
 * densities on a part with a KNOWN constraint-edge singularity, and the
 * detector reported nothing at all.
 *
 * 5% is a judgement, not a measurement, and is the weakest number in this
 * heuristic. It wants to be small enough to stay local (5% of the diagonal is
 * well inside one feature on the parts this tool sees) and large enough that
 * the neighbourhood does not follow the peak down as the mesh refines.
 *
 * It now has a known-smooth control to be judged against —
 * `smooth-concentration.test.ts`, a plate-with-hole whose Kt≈3 concentration
 * provably converges. At this 5% the radius comes out 5.386 mm on that part and
 * stays there across a 6× element-count change, which is the behaviour the floor
 * exists for. Any change to this constant should be re-measured on BOTH
 * populations (that fixture and the cross plate), never on one.
 */
export const SINGULARITY_PART_FRACTION = 0.05;

/**
 * Ratio above which the payload is REPORTED at all. Below it, the field is not
 * concentrated enough to be worth describing and the detector returns null.
 *
 * Now has a measured floor under it (issue #263's calibration gap, closed by
 * `smooth-concentration.test.ts`): a plate-with-hole whose Kt≈3 concentration
 * provably CONVERGES reads 2.3–2.4 and stays there across four densities. So
 * 3.0 is the boundary between two measured populations rather than a number
 * with data on only one side — the known-smooth case sits below it and the
 * known-singular cases (3.1–3.3 constraint edge, 12 point spike) above.
 *
 * The margin is THIN — 2.4 against 3.0 — and that is the honest reading: a
 * sharper-but-still-smooth feature could cross this line. That is survivable
 * precisely because crossing it only produces a MEASUREMENT, not an alarm; see
 * SINGULARITY_RATIO_ALARM for why the two were split.
 */
export const SINGULARITY_RATIO_REPORT = 3.0;

/**
 * Ratio above which `detected` is set — i.e. the user is ALARMED, not merely
 * informed (issue #263).
 *
 * The band between REPORT and ALARM exists because a binary gate on this ratio
 * flickers. Measured on the cross plate at four densities with everything else
 * fixed, the ratio came out 3.3 / 3.1 / <3.0 / <3.0 while the peak itself
 * wandered non-monotonically (2.221 / 2.497 / 2.141 / 2.288 MPa). Sitting at
 * ~3.2 against a 3.0 gate, which side a given mesh landed on was decided by
 * noise — so a user refining their mesh watched the warning appear and vanish
 * for no physical reason. That is worse than not warning: it teaches people the
 * warning is meaningless.
 *
 * 6.0 is NOT a new number — it is the existing "high confidence" boundary, now
 * load-bearing. A ratio that high is conclusive on a single mesh; #148's own
 * point-spike fixture sits at 12, so genuine sharp re-entrant corners still
 * alarm on one solve.
 *
 * What covers the band in between: this ratio is a point-wise proxy for "your
 * peak is not converged", and there is now a far more stable instrument for the
 * same statement. On the cross plate `bcSingularityErrorFraction` (#259) read
 * 41.1 / 48.9 / 48.2 / ~48 % across the same four meshes — an integrated energy
 * norm, which is WHY it does not flicker — and the discretization readout warns
 * on it. So a borderline part is still told its number is constraint-limited;
 * it is just told by the instrument that can say so reliably.
 *
 * The band is reported, not hidden: the payload is present with `detected`
 * false, carrying the ratio, confidence and cause. Deliberately NOT surfaced as
 * a banner — the whole point is that this range is not actionable on one mesh.
 *
 * NOT LOWERED TO 2.5, now for a measured reason rather than caution (issue
 * #263). Dropping it there would make the cross plate alarm on every mesh, which
 * was tempting while the only data came from parts that SHOULD trip it. The
 * known-smooth control (`smooth-concentration.test.ts`) reads 2.3–2.4, so an
 * alarm at 2.5 would sit inside the smooth population's own range — it would
 * shout at a Kt≈3 hole whose peak demonstrably converges. The gap between the
 * populations (2.4 vs 3.1) is simply too narrow to carry an ALARM; it is wide
 * enough to carry a measurement, which is what the REPORT band is for.
 */
export const SINGULARITY_RATIO_ALARM = 6.0;

/**
 * Local characteristic element size at a display-mesh vertex: the median edge
 * length of the surface triangles that touch it. `positions` is the display
 * mesh (9 floats per triangle, 3 consecutive vertices per triangle), so
 * triangle t owns vertices 3t, 3t+1, 3t+2. Coincident vertices (shared corners,
 * which STL duplicates per-triangle) are gathered with a tolerance RELATIVE to
 * the owning triangle's smallest edge — scaling every coordinate by s scales
 * that tolerance and every edge by s, so the SAME triangles are gathered and
 * the returned length scales by s. That relative construction is what makes the
 * downstream neighborhood radius scale-invariant. Returns NaN if the peak's
 * owning triangle is degenerate/out of range.
 */
export function localEdgeLengthAtPeak(
  positions: Float32Array | Float64Array,
  peakIdx:   number,
): number {
  const triCount = Math.floor(positions.length / 9);
  const ownTri   = Math.floor(peakIdx / 3);
  if (ownTri < 0 || ownTri >= triCount) return NaN;

  const px = positions[peakIdx * 3]     ?? 0;
  const py = positions[peakIdx * 3 + 1] ?? 0;
  const pz = positions[peakIdx * 3 + 2] ?? 0;

  const edgeLensOf = (t: number): number[] => {
    const v = [t * 3, t * 3 + 1, t * 3 + 2];
    const pair = (u: number, w: number): number => {
      const dx = (positions[u * 3]     ?? 0) - (positions[w * 3]     ?? 0);
      const dy = (positions[u * 3 + 1] ?? 0) - (positions[w * 3 + 1] ?? 0);
      const dz = (positions[u * 3 + 2] ?? 0) - (positions[w * 3 + 2] ?? 0);
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    };
    return [pair(v[0]!, v[1]!), pair(v[1]!, v[2]!), pair(v[2]!, v[0]!)];
  };

  const ownEdges = edgeLensOf(ownTri).filter(e => e > 0);
  const seed = ownEdges.length ? Math.min(...ownEdges) : 0;
  // Relative coincidence tolerance → scale-invariant. eps=0 still matches the
  // exact per-triangle duplicates STL produces at a shared corner.
  const eps2 = (seed * 0.05) ** 2;

  const edges: number[] = [];
  for (let t = 0; t < triCount; t++) {
    let touches = false;
    for (let k = 0; k < 3; k++) {
      const vi = t * 3 + k;
      const dx = (positions[vi * 3]     ?? 0) - px;
      const dy = (positions[vi * 3 + 1] ?? 0) - py;
      const dz = (positions[vi * 3 + 2] ?? 0) - pz;
      if (dx * dx + dy * dy + dz * dz <= eps2) { touches = true; break; }
    }
    if (touches) for (const e of edgeLensOf(t)) if (e > 0) edges.push(e);
  }

  const pool = edges.length ? edges : ownEdges;
  if (!pool.length) return NaN;
  pool.sort((a, b) => a - b);
  return pool[Math.floor(pool.length / 2)]!;
}

/**
 * Single-mesh geometric singularity heuristic. `positions` MUST be aligned with
 * `vertexStress` (both indexed by display-mesh surface vertex) so the peak's
 * coordinate and its neighborhood are computed in the same index space — the
 * caller passes req.positions, not the internal FEA node array.
 */
export function detectSingularity(
  vertexStress:  Float32Array,
  positions:     Float32Array | Float64Array,
  ctx?: {
    /** World-mm (x,y,z) triples of nodes on the RIM of a CONSTRAINED patch —
     *  `bcDiscontinuityMask` output, mapped through `mesh.nodes`. When the peak
     *  lands within the sampling neighborhood of one, the singularity is the
     *  constraint idealization rather than the geometry. */
    bcRimPoints?: Float64Array | null;
    /** Same, for LOADED nodes. Kept separate from `bcRimPoints` because the two
     *  need opposite advice: a load rim is singular because the load was applied
     *  to a patch (or a point) rather than spread as a real contact pressure,
     *  and telling the user to reconsider their BOLT there is simply wrong. */
    loadRimPoints?: Float64Array | null;
    /** Material yield (MPa) for the `nearYield` wording flag. */
    yieldMPa?:    number;
    /**
     * The FEA field to assess, INSTEAD of the display mesh (issue #263).
     *
     * The display mesh is the uploaded STL's tessellation. It does not refine
     * when the solve does, and its vertex spacing bears no relation to the
     * resolution of the stress field sampled onto it, so a local gradient
     * cannot be measured on it at all. Measured on the cross plate: display
     * spacing 5.3 mm against an FEA element size of 0.10 mm, so the smallest
     * radius that finds ANY display neighbour is 13.25 mm — on a part 12 mm
     * across. That is the whole part, not a neighbourhood, and it is why the
     * ratio was a peak-vs-part contrast rather than a gradient.
     *
     * Supplying this makes the field and its length scale come from the SAME
     * mesh, which is what `concentrationRatio` has always claimed to be.
     *
     * Omitting it falls back to the display mesh, which keeps this function
     * usable standalone and keeps #148's scale-invariance tests meaningful —
     * they pass positions only and assert the geometry-scaling property, which
     * the fallback still has.
     */
    feaField?: {
      /** Nodal von Mises paired with `mesh.nodes` — build with `sampledField`. */
      field:    SampledField;
      /** Per-node characteristic element size (`nodeCharacteristicSizes`). */
      nodeSize: Float64Array;
    } | null;
  },
): SingularityWarning | null {
  // Which field is being assessed. `stress` and `coords` are indexed with the
  // SAME index everywhere below, so they cannot drift into different spaces the
  // way a display stress array paired with FEA coordinates would.
  const fea    = ctx?.feaField ?? null;
  const stress: Float32Array | Float64Array = fea ? fea.field.values : vertexStress;
  const coords: Float32Array | Float64Array = fea ? fea.field.coords : positions;
  const count  = fea ? fea.field.count : vertexStress.length;

  if (count === 0) return null;

  // Find peak stress point
  let peakIdx = 0, peakVal = 0;
  for (let i = 0; i < count; i++) {
    if ((stress[i] ?? 0) > peakVal) {
      peakVal = stress[i]!;
      peakIdx = i;
    }
  }
  if (peakVal < 0.1) return null;  // trivial stress, no singularity concern

  // Get peak position
  const px = coords[peakIdx * 3]     ?? 0;
  const py = coords[peakIdx * 3 + 1] ?? 0;
  const pz = coords[peakIdx * 3 + 2] ?? 0;
  const peakLocation: [number, number, number] = [px, py, pz];

  // Scale the neighborhood radius to the LOCAL element size at the peak (issue
  // #148) rather than a fixed 1mm. Without a local length scale we can't assess
  // a singularity, so bail out.
  const localH = fea
    ? (fea.nodeSize[peakIdx] ?? NaN)
    : localEdgeLengthAtPeak(positions, peakIdx);
  if (!(localH > 0) || !isFinite(localH)) return null;

  // The radius has a FLOOR proportional to the part, and this is the crux of
  // issue #263 rather than an implementation detail.
  //
  // An element-relative radius alone cannot detect a singularity. A singular
  // field is self-similar — sigma ~ r^-a near the tip — so peak/neighbourhood
  // measured over a ball that SHRINKS with the mesh is roughly constant, and
  // small, no matter how singular the field is. Measured on the cross plate
  // after moving sampling to the FEA field: the ratio fell under 3.0 at every
  // density and the detector reported NOTHING on a part with a known
  // constraint-edge singularity.
  //
  // A radius fixed in PHYSICAL space is what makes the comparison mean
  // something: the peak climbs as the mesh resolves the tip while the
  // neighbourhood average over a fixed ball stays put, so the ratio rises with
  // the severity of the singularity instead of cancelling against it.
  //
  // Expressed as a fraction of the part's bounding diagonal, so it stays
  // scale-invariant across a 5mm bracket and a 500mm frame rail — which is
  // #148's requirement, met without borrowing the mesh's length scale.
  //
  // `max` of the two: the element-relative radius still applies when it is the
  // LARGER, so a coarse mesh cannot end up with a radius finer than its own
  // elements and zero neighbours to average. On the display-mesh fallback the
  // element term dominates, which is why #148's scale-invariance tests are
  // unaffected.
  let diag = 0;
  {
    let mnX = Infinity, mnY = Infinity, mnZ = Infinity;
    let mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity;
    for (let i = 0; i < count; i++) {
      const x = coords[i * 3] ?? 0, y = coords[i * 3 + 1] ?? 0, z = coords[i * 3 + 2] ?? 0;
      if (x < mnX) mnX = x; if (x > mxX) mxX = x;
      if (y < mnY) mnY = y; if (y > mxY) mxY = y;
      if (z < mnZ) mnZ = z; if (z > mxZ) mxZ = z;
    }
    if (isFinite(mnX) && isFinite(mxX)) {
      diag = Math.sqrt((mxX-mnX)**2 + (mxY-mnY)**2 + (mxZ-mnZ)**2);
    }
  }
  const radius  = Math.max(
    SINGULARITY_NEIGHBORHOOD_FACTOR * localH,
    SINGULARITY_PART_FRACTION * diag,
  );
  const radius2 = radius * radius;
  // The display mesh duplicates each shared corner once per incident triangle,
  // so the peak location appears as several coincident vertices all carrying the
  // singular stress. They are the SAME physical point, not neighborhood samples,
  // so exclude anything within a small (element-relative → scale-invariant)
  // coincidence tolerance of the peak; counting them would deflate the ratio.
  const coincident2 = (localH * 0.05) ** 2;

  // Is the peak on the rim of a constrained/loaded patch? Same radius the stress
  // neighborhood uses, so the test scales with the local element size for the
  // same reason (#148) and needs no absolute length of its own.
  // NEAREST rim, not the first one within range. The sampling radius is a
  // generous 2.5x the local element size, and on a compact part that can put
  // BOTH the constrained rim and the loaded rim inside it — measured on the
  // Ø5-bore tube, the radius is 8.95 mm on a part 12 mm across, so a
  // first-match test reported "constraint-edge" for a peak sitting exactly on
  // the loaded node 3.5 mm from the nearest bore rim. Comparing distances makes
  // the attribution mean something; ties still go to the constraint, which is
  // the idealization with a design consequence (#260).
  const nearestRim2 = (rim: Float64Array | null | undefined): number => {
    if (!rim || rim.length < 3) return Infinity;
    let best = Infinity;
    for (let i = 0; i + 2 < rim.length; i += 3) {
      const dx = rim[i]! - px, dy = rim[i + 1]! - py, dz = rim[i + 2]! - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    return best;
  };
  const dBc2   = nearestRim2(ctx?.bcRimPoints);
  const dLoad2 = nearestRim2(ctx?.loadRimPoints);
  const cause: "geometry" | "constraint-edge" | "load-edge" =
    Math.min(dBc2, dLoad2) > radius2 ? "geometry"
    : dBc2 <= dLoad2                 ? "constraint-edge"
    : "load-edge";
  const nearYield = ctx?.yieldMPa !== undefined && ctx.yieldMPa > 0
    ? peakVal > 0.5 * ctx.yieldMPa
    : false;

  /** Cause-appropriate remedy. A fillet does nothing for a constraint edge. */
  const advice =
    cause === "constraint-edge"
      ? `This is the CONSTRAINT, not your part: a bolt is modelled as a rigid clamp over the whole bore wall, which is singular at the edge where the clamp stops. A real bolt bears on part of the wall with some joint compliance and has no such edge. Treat the peak here as an artifact of that idealization — judge the part on the stress a short distance away, not at the constrained rim.`
    : cause === "load-edge"
      ? `This is the EDGE OF THE LOADED REGION, not a feature of your part. Where an applied traction stops abruptly the stress is singular, exactly as pressing with an infinitely sharp tool would be — and the smaller the loaded patch, the sharper it is. A real load is carried by a contact area with pressure that falls off at its edge rather than stopping dead. Judge the part on the stress a short distance away from the loaded region. If this peak matters to your decision, set the contact size to the area the load really acts over (loadPatchRadiusMm) rather than leaving it to the default.`
      : `This looks like a geometric singularity at a sharp re-entrant corner. The true stress is lower. Add a fillet radius of >=0.5mm at this location in your CAD model.`;

  /** Why the number moves between meshes — the point of the warning (#256). */
  const meshNote = `Peak stress at a singularity is set by the local element size, so it does NOT converge: refining the mesh changes it rather than settling it, and the safety factor moves with it.`;

  let neighborSum = 0, neighborCount = 0;
  const nVerts = count;

  for (let i = 0; i < nVerts; i++) {
    if (i === peakIdx) continue;
    const dx = (coords[i * 3]     ?? 0) - px;
    const dy = (coords[i * 3 + 1] ?? 0) - py;
    const dz = (coords[i * 3 + 2] ?? 0) - pz;
    const dist2 = dx*dx + dy*dy + dz*dz;
    if (dist2 <= coincident2) continue;   // coincident duplicate of the peak
    if (dist2 < radius2) {
      neighborSum   += stress[i] ?? 0;
      neighborCount++;
    }
  }

  if (neighborCount === 0) {
    // Completely isolated peak — strong singularity indicator
    return {
      detected:           true,
      peakVertexIdx:      peakIdx,
      peakLocation,
      peakStressMPa:      peakVal,
      stressAt1mmMPa:     0,
      neighborhoodRadiusMm: +radius.toFixed(3),
      localElementSizeMm:   +localH.toFixed(3),
      concentrationRatio: 999,
      confidence:         "medium",
      evidence:           "single-mesh-heuristic",
      cause,
      nearYield,
      message: `Peak stress vertex (${peakVal.toFixed(1)} MPa) has no neighbors within ${radius.toFixed(2)}mm (2.5× the local element size) — isolated point stress, a strong singularity indicator. ${advice} ${meshNote}`,
    };
  }

  const avgNeighbor = neighborSum / neighborCount;
  const ratio       = avgNeighbor > 0.1 ? peakVal / avgNeighbor : 0;

  // Shape only. See the header note on why the old `&& peakVal > 50` is gone.
  if (ratio <= SINGULARITY_RATIO_REPORT) return null;

  const confidence: "high" | "medium" | "low" =
    ratio > SINGULARITY_RATIO_ALARM ? "high" : ratio > 4 ? "medium" : "low";

  return {
    // A MEASUREMENT above SINGULARITY_RATIO_REPORT; an ALARM only above
    // SINGULARITY_RATIO_ALARM. See those constants for why the band exists.
    detected:           ratio > SINGULARITY_RATIO_ALARM,
    peakVertexIdx:      peakIdx,
    peakLocation,
    peakStressMPa:      peakVal,
    stressAt1mmMPa:     +avgNeighbor.toFixed(1),
    neighborhoodRadiusMm: +radius.toFixed(3),
    localElementSizeMm:   +localH.toFixed(3),
    concentrationRatio: +ratio.toFixed(1),
    confidence,
    evidence:           "single-mesh-heuristic",
    cause,
    nearYield,
    message: `Peak stress ${peakVal.toFixed(1)} MPa is ${ratio.toFixed(1)}× higher than the surrounding neighborhood average (${avgNeighbor.toFixed(1)} MPa, within ${radius.toFixed(2)}mm ≈ 2.5× the local element size). ${advice} ${meshNote}${
      nearYield
        ? " The peak is also within reach of yield, so the safety factor here is both mesh-dependent AND close to the limit — treat this result as unresolved."
        : " The peak is well below yield on this run, so the verdict is unlikely to hinge on it — but the reported safety factor is still not a converged number."
    }`,
  };
}

// ─── Topology suggestions ─────────────────────────────────────────────────────
/**
 * Identifies high-stress regions near free surfaces and suggests where to add material.
 *
 * Method:
 *   1. Find vertices in top 5% of stress that are also surface vertices
 *   2. Cluster nearby vertices together (within 3mm)
 *   3. For each cluster: compute centroid, average stress, and suggest a design change
 *   4. Return top 3 suggestions (exclude singularity region if detected)
 */
function generateTopologySuggestions(
  /**
   * Stress and the coordinates it is indexed by, carried together (#263).
   * This used to be two loose parameters, and the caller passed the DISPLAY
   * stress array with the FEA node coordinates — so every suggestion was placed
   * at the position of an unrelated node. `sampledField` now rejects that
   * pairing at construction.
   */
  field:         SampledField,
  meshScale:     number,
  meshOffset:    [number, number, number],
  singularityIdx: number | null,
  bounds:        { minX:number; maxX:number; minY:number; maxY:number; minZ:number; maxZ:number },
): TopologySuggestion[] {
  const vertexStress = field.values;
  const positions    = field.coords;
  if (vertexStress.length === 0) return [];

  // Threshold: top 5% of stress values
  const sorted = Array.from(vertexStress).sort((a, b) => b - a);
  const p95idx = Math.floor(sorted.length * 0.05);
  const threshold = sorted[p95idx] ?? 0;
  if (threshold < 1) return [];

  // Collect high-stress surface vertices (exclude singularity vertex)
  const highStressVerts: Array<{idx: number; stress: number; x: number; y: number; z: number}> = [];
  for (let i = 0; i < vertexStress.length; i++) {
    if (i === singularityIdx) continue;
    if ((vertexStress[i] ?? 0) < threshold) continue;
    highStressVerts.push({
      idx: i,
      stress: vertexStress[i]!,
      x: positions[i * 3]     ?? 0,
      y: positions[i * 3 + 1] ?? 0,
      z: positions[i * 3 + 2] ?? 0,
    });
  }

  if (highStressVerts.length === 0) return [];

  // Cluster vertices within 3mm
  const clusterRadius = 3.0 / meshScale;
  const assigned = new Uint8Array(highStressVerts.length);
  const clusters: Array<typeof highStressVerts> = [];

  for (let i = 0; i < highStressVerts.length; i++) {
    if (assigned[i]) continue;
    const cluster = [highStressVerts[i]!];
    assigned[i] = 1;
    for (let j = i + 1; j < highStressVerts.length; j++) {
      if (assigned[j]) continue;
      const dx = (highStressVerts[j]!.x - highStressVerts[i]!.x);
      const dy = (highStressVerts[j]!.y - highStressVerts[i]!.y);
      const dz = (highStressVerts[j]!.z - highStressVerts[i]!.z);
      if (dx*dx + dy*dy + dz*dz < clusterRadius * clusterRadius) {
        cluster.push(highStressVerts[j]!);
        assigned[j] = 1;
      }
    }
    clusters.push(cluster);
  }

  clusters.sort((a, b) =>
    Math.max(...b.map(v => v.stress)) - Math.max(...a.map(v => v.stress)));

  const plateThick = bounds.maxZ - bounds.minZ;
  const plateW     = bounds.maxX - bounds.minX;
  const plateH     = bounds.maxY - bounds.minY;

  return clusters.slice(0, 3).map((cluster, clusterIdx) => {
    const cx = cluster.reduce((s, v) => s + v.x, 0) / cluster.length;
    const cy = cluster.reduce((s, v) => s + v.y, 0) / cluster.length;
    const cz = cluster.reduce((s, v) => s + v.z, 0) / cluster.length;
    const maxStress = Math.max(...cluster.map(v => v.stress));

    const wx = cx / meshScale + meshOffset[0];
    const wy = cy / meshScale + meshOffset[1];
    const wz = cz / meshScale + meshOffset[2];

    const fracZ = plateThick > 0 ? (wz - bounds.minZ) / plateThick : 0.5;
    const fracX = plateW > 0 ? (wx - bounds.minX) / plateW : 0.5;
    const fracY = plateH > 0 ? (wy - bounds.minY) / plateH : 0.5;

    const nearEdgeX = fracX < 0.2 || fracX > 0.8;
    const nearEdgeY = fracY < 0.2 || fracY > 0.8;
    const nearBottom = fracZ < 0.25;
    const nearTop    = fracZ > 0.75;
    const nearMiddle = !nearBottom && !nearTop;

    // Determine which cluster position this is relative to others
    // to ensure each suggestion is meaningfully different
    const posKey = `${nearBottom?'B':nearTop?'T':'M'}${nearEdgeX?'X':''}${nearEdgeY?'Y':''}`;

    // Build a specific, non-duplicate suggestion
    // Use cluster index to vary the message even if positions are similar
    let suggestion: string;
    const stressRatio = (maxStress / (clusters[0] ? Math.max(...clusters[0].map(v=>v.stress)) : maxStress)).toFixed(2);
    const rankNote = clusterIdx === 0 ? "Most critical region" :
                     clusterIdx === 1 ? "Second stress concentration" : "Third stress concentration";

    if (nearBottom) {
      suggestion = `${rankNote} — near bottom face. Pull force is loading inter-layer bonds in Z. ` +
        `This is the weakest direction for a flat print. Primary fix: increase to 5+ wall perimeters. ` +
        `Structural fix: redesign to print this face upright.`;
    } else if (nearTop) {
      suggestion = `${rankNote} — near top face. Surface concentration from applied load. ` +
        `Add 1–2mm thickness at this face in Onshape, or increase wall count to give ` +
        `more load-bearing perimeter at the top surface.`;
    } else if (nearEdgeX && nearEdgeY) {
      suggestion = `${rankNote} — at a corner (${(fracX*100).toFixed(0)}%, ${(fracY*100).toFixed(0)}% from origin). ` +
        `Corner stress concentrations respond to fillets. Add ≥1mm fillet radius in Onshape at ` +
        `this corner. Even R0.5mm reduces peak stress ~20%.`;
    } else if (nearEdgeX) {
      suggestion = `${rankNote} — near X-direction free edge (${(fracX*100).toFixed(0)}% across part). ` +
        `Edge distance from hole to this edge may be too small. ` +
        `Increase edge distance to at least 2× hole diameter in Onshape.`;
    } else if (nearEdgeY) {
      suggestion = `${rankNote} — near Y-direction free edge (${(fracY*100).toFixed(0)}% along part). ` +
        `Material is insufficient between hole and edge. ` +
        `Extend part length or move hole toward center.`;
    } else {
      // Middle body — vary by cluster index for distinct messages
      const bodyMessages = [
        `${rankNote} — body stress concentration near hole. The ${(fracZ*100).toFixed(0)}% height ` +
        `position suggests bending through the thickness. Increase wall count from the current ` +
        `setting by at least 2 perimeters.`,
        `${rankNote} — stress in body at (${wx.toFixed(1)}, ${wy.toFixed(1)}) mm. ` +
        `This zone carries significant shear load. Consider 40%+ infill with gyroid pattern ` +
        `to distribute this stress more evenly.`,
        `${rankNote} — at body centroid region (${(fracX*100).toFixed(0)}%, ${(fracY*100).toFixed(0)}%). ` +
        `Stress here indicates the part cross-section is insufficient. ` +
        `Add 1mm to part thickness at this location in Onshape.`,
      ];
      suggestion = bodyMessages[clusterIdx % bodyMessages.length]!;
    }

    return {
      position:   [+wx.toFixed(2), +wy.toFixed(2), +wz.toFixed(2)] as [number,number,number],
      label:      `Cluster ${clusterIdx + 1} of ${Math.min(3, clusters.length)} — ${maxStress.toFixed(1)} MPa`,
      stressMPa:  +maxStress.toFixed(1),
      suggestion,
    };
  });
}

// ─── Find nodes near a hole wall ──────────────────────────────────────────────
/**
 * 3-D cylinder test: a node belongs to the hole wall iff BOTH
 *   - its axial offset from the hole centre is within ±2.5·radius, AND
 *   - its radial distance from the hole axis is within ±tolerance of radius.
 * Works for arbitrary hole axes (hole.normal must be unit length).
 */
export function findHoleWallNodes(
  nodes:     Float64Array,
  nodeCount: number,
  hole:      HoleFeature,
  tolerance: number,
): number[] {
  const [hx, hy, hz] = hole.centre;
  const [nx, ny, nz] = hole.normal;
  const result: number[] = [];
  const halfLen = hole.radius * 2.5; // cylinder half-length for search

  for (let n = 0; n < nodeCount; n++) {
    const x = nodes[n*3]??0, y = nodes[n*3+1]??0, z = nodes[n*3+2]??0;
    const dx = x-hx, dy = y-hy, dz = z-hz;
    // Axial projection
    const t  = dx*nx + dy*ny + dz*nz;
    if (Math.abs(t) > halfLen) continue;
    // Radial distance
    const radX = dx - t*nx, radY = dy - t*ny, radZ = dz - t*nz;
    const radDist = Math.sqrt(radX*radX + radY*radY + radZ*radZ);
    if (Math.abs(radDist - hole.radius) < tolerance) {
      result.push(n);
    }
  }
  return result;
}

/**
 * Select the nodes to rigidly constrain for a bolted hole on the STL path
 * (issue #105).
 *
 * Previous behaviour selected by 2-D radial distance only (0.9r < r_xy < 1.15r
 * with NO bound along the hole axis) — every node anywhere in the part whose
 * XY projection landed in that ring was fixed (28.5% of all nodes on the demo
 * bracket for a single Ø5 hole). This over-constrains the model and inflates
 * bolt-area load capacity.
 *
 * Now unified on the 3-D cylinder test (findHoleWallNodes): axial extent is
 * bounded to ±2.5·radius around the hole centre, radial band is ±15% of the
 * radius. Fallbacks (in order):
 *   1. < 3 wall nodes → interior nodes of the bounded cylinder (r_rad < 0.9r)
 *   2. still none     → single node closest to the hole centre
 *
 * STL hole detection (holes.ts) only produces Z-axis holes today; arbitrary
 * axes are handled correctly by the cylinder test, but a non-Z (or degenerate)
 * axis is logged since it means the hole came from an unexpected source.
 */
export function findStlBoltConstraintNodes(
  nodes:     Float64Array,
  nodeCount: number,
  hole:      HoleFeature,
): number[] {
  const r = hole.radius;

  // Normalize the hole axis; fall back to Z (the only axis STL detection
  // produces) if degenerate, and warn on non-Z axes.
  let [ax, ay, az] = hole.normal;
  const alen = Math.sqrt(ax*ax + ay*ay + az*az);
  if (alen < 1e-9) {
    console.warn(
      `[analysis] hole ${hole.id}: degenerate axis (${hole.normal.join(", ")}) — defaulting to Z`,
    );
    ax = 0; ay = 0; az = 1;
  } else {
    ax /= alen; ay /= alen; az /= alen;
    if (Math.abs(az) < 0.999) {
      console.warn(
        `[analysis] hole ${hole.id}: non-Z axis (${ax.toFixed(3)}, ${ay.toFixed(3)}, ${az.toFixed(3)}) — ` +
        `STL hole detection normally produces Z-axis holes; constraining along the provided axis`,
      );
    }
  }
  const unitAxisHole: HoleFeature = { ...hole, normal: [ax, ay, az] };

  // Primary: wall nodes via the bounded 3-D cylinder test (radial band ±15%).
  const wallNodes = findHoleWallNodes(nodes, nodeCount, unitAxisHole, r * 0.15);
  if (wallNodes.length >= 3) return wallNodes;

  // Fallback 1: interior nodes of the SAME bounded cylinder (coarse meshes may
  // have no node near the wall but one on/near the axis).
  const [hx, hy, hz] = unitAxisHole.centre;
  const halfLen = r * 2.5;
  const interiorNodes: number[] = [];
  for (let n = 0; n < nodeCount; n++) {
    const x = nodes[n*3]??0, y = nodes[n*3+1]??0, z = nodes[n*3+2]??0;
    const dx = x-hx, dy = y-hy, dz = z-hz;
    const t  = dx*ax + dy*ay + dz*az;
    if (Math.abs(t) > halfLen) continue;
    const radX = dx - t*ax, radY = dy - t*ay, radZ = dz - t*az;
    const radDist = Math.sqrt(radX*radX + radY*radY + radZ*radZ);
    if (radDist < r * 0.9) interiorNodes.push(n);
  }
  // Prefer interior nodes over an under-populated wall set (mirrors the old
  // behaviour); fall back to whatever wall nodes exist (1-2) before resorting
  // to the single-closest-node fallback.
  if (interiorNodes.length > 0) return interiorNodes;
  if (wallNodes.length > 0) return wallNodes;

  // Fallback 2: single closest node to the hole centre.
  return [closestNode(nodes, nodeCount, hx, hy, hz)];
}

// ─── Find closest node to a 3D point ─────────────────────────────────────────
function closestNode(
  nodes:     Float64Array,
  nodeCount: number,
  px: number, py: number, pz: number,
): number {
  let best = 0, bestD = Infinity;
  for (let n = 0; n < nodeCount; n++) {
    // Parenthesise each `?? 0` BEFORE subtracting: `??` binds looser than `-`,
    // so `nodes[i] ?? 0 - px` parses as `nodes[i] ?? (0 - px)` and silently
    // measures the distance from the ORIGIN instead of from (px, py, pz).
    const dx = (nodes[n*3]     ?? 0) - px;
    const dy = (nodes[n*3 + 1] ?? 0) - py;
    const dz = (nodes[n*3 + 2] ?? 0) - pz;
    const d = dx*dx + dy*dy + dz*dz;
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

// ─── Per-vertex stress mapping ────────────────────────────────────────────────
/**
 * Map element-centroid stresses back to the original STL triangle soup.
 * For each STL vertex, find the closest mesh node and use its averaged stress.
 * This is approximate but fast and good enough for a heatmap.
 */
function mapStressToSTLVertices(
  stlPositions:  Float32Array,
  triangleCount: number,
  meshNodes:     Float64Array,
  nodeCount:     number,
  nodeStress:    Float64Array,  // per-node averaged von Mises
): Float32Array {
  const vertCount = triangleCount * 3;
  const result    = new Float32Array(vertCount);

  // For every STL vertex, find the closest mesh node (O(V×N) — acceptable for
  // the mesh sizes we're using, < 50k × 10k = 500M ops worst case.
  // In practice meshes are small enough this is fast.)
  for (let v = 0; v < vertCount; v++) {
    const vx = stlPositions[v*3]??0;
    const vy = stlPositions[v*3+1]??0;
    const vz = stlPositions[v*3+2]??0;
    const n  = closestNode(meshNodes, nodeCount, vx, vy, vz);
    result[v] = nodeStress[n] ?? 0;
  }

  return result;
}

// ─── Error-estimate vertex mapping ────────────────────────────────────────────
/**
 * Map per-element ZZ error estimates to display-mesh surface vertices.
 *
 * For each surface vertex: find FEA nodes within R3D via a spatial grid, then
 * consider only the elements ADJACENT to those nodes (node → element adjacency
 * built once per call, O(elementCount × npe)). The nearest element centroid
 * within R3D wins; if none is in range, fall back to a global centroid scan.
 *
 * Adjacency uses corner nodes only (first 4 of each element) — midside nodes
 * of C3D10 elements are skipped, matching the previous brute-force behaviour.
 *
 * This replaces an O(V × nearbyNodes × elementCount) brute-force scan that
 * dominated analysis wall time (issue #104: ~98% of a 6.5-minute analysis).
 * Output is identical to the brute-force version (same visit order, same
 * floating-point operations) — see server/tests/unit/error-mapping.test.ts.
 */
export function mapErrorEstimateToVertices(
  mesh:          import("./solver/types.js").TetMesh,
  errorEstimate: Float32Array | Float64Array,
  positions:     Float32Array,
  vertCount:     number,
): Float32Array {
  const out = new Float32Array(vertCount);
  const R3D = 3.0;
  const CELL3 = R3D;
  const R2 = R3D * R3D;
  const npe = mesh.nodesPerElem ?? 4;

  // ── Spatial grid over FEA nodes (same layout as the stress-mapping grid) ──
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const x = mesh.nodes[n*3] ?? 0, y = mesh.nodes[n*3+1] ?? 0, z = mesh.nodes[n*3+2] ?? 0;
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  }
  const gW = Math.ceil((xMax - xMin) / CELL3) + 1;
  const gH = Math.ceil((yMax - yMin) / CELL3) + 1;
  const gD = Math.ceil((zMax - zMin) / CELL3) + 1;
  const grid = new Map<number, number[]>();
  for (let n = 0; n < mesh.nodeCount; n++) {
    const ci = Math.floor(((mesh.nodes[n*3]   ?? 0) - xMin) / CELL3);
    const cj = Math.floor(((mesh.nodes[n*3+1] ?? 0) - yMin) / CELL3);
    const ck = Math.floor(((mesh.nodes[n*3+2] ?? 0) - zMin) / CELL3);
    const key = ci*gH*gD + cj*gD + ck;
    let cell = grid.get(key); if (!cell) { cell = []; grid.set(key, cell); }
    cell.push(n);
  }

  // ── Node → element adjacency (corner nodes only), built ONCE ──────────────
  const { ptr: adjPtr, list: adjList } = buildNodeElementAdjacency(mesh, Math.min(4, npe));

  // ── Element centroids (corner-node average), computed ONCE ────────────────
  const centX = new Float64Array(mesh.elementCount);
  const centY = new Float64Array(mesh.elementCount);
  const centZ = new Float64Array(mesh.elementCount);
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    let cx = 0, cy = 0, cz = 0;
    for (let ni = 0; ni < 4; ni++) {
      const nodeIdx = mesh.elements[base + ni] ?? 0;
      cx += mesh.nodes[nodeIdx * 3]     ?? 0;
      cy += mesh.nodes[nodeIdx * 3 + 1] ?? 0;
      cz += mesh.nodes[nodeIdx * 3 + 2] ?? 0;
    }
    centX[e] = cx / 4; centY[e] = cy / 4; centZ[e] = cz / 4;
  }

  // Element-visited stamps: stamp[e] === vertexEpoch ⇒ already checked for this
  // vertex. Avoids allocating a fresh Set per vertex.
  const stamp = new Int32Array(mesh.elementCount).fill(-1);

  for (let v = 0; v < vertCount; v++) {
    const vx = positions[v*3] ?? 0, vy = positions[v*3+1] ?? 0, vz = positions[v*3+2] ?? 0;
    let bestDist2 = Infinity, bestError = 0;

    const ci = Math.floor((vx - xMin) / CELL3);
    const cj = Math.floor((vy - yMin) / CELL3);
    const ck = Math.floor((vz - zMin) / CELL3);

    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        for (let dk = -1; dk <= 1; dk++) {
          const ni2 = ci + di, nj2 = cj + dj, nk2 = ck + dk;
          if (ni2 < 0 || ni2 >= gW || nj2 < 0 || nj2 >= gH || nk2 < 0 || nk2 >= gD) continue;
          const cell = grid.get(ni2*gH*gD + nj2*gD + nk2);
          if (!cell) continue;
          for (const n of cell) {
            const aStart = adjPtr[n] ?? 0, aEnd = adjPtr[n+1] ?? 0;
            for (let a = aStart; a < aEnd; a++) {
              const e = adjList[a] ?? 0;
              if (stamp[e] === v) continue;
              stamp[e] = v;
              const dx = (centX[e] ?? 0) - vx, dy = (centY[e] ?? 0) - vy, dz = (centZ[e] ?? 0) - vz;
              const d2 = dx*dx + dy*dy + dz*dz;
              if (d2 < R2 && d2 < bestDist2) {
                bestDist2 = d2;
                bestError = errorEstimate[e] ?? 0;
              }
            }
          }
        }
      }
    }

    // Fallback: global centroid scan if nothing within R3D
    if (bestDist2 === Infinity) {
      for (let e = 0; e < mesh.elementCount; e++) {
        const dx = (centX[e] ?? 0) - vx, dy = (centY[e] ?? 0) - vy, dz = (centZ[e] ?? 0) - vz;
        const d2 = dx*dx + dy*dy + dz*dz;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          bestError = errorEstimate[e] ?? 0;
        }
      }
    }
    out[v] = bestError;
  }

  return out;
}

// ─── Main analysis function ───────────────────────────────────────────────────
/**
 * runAnalysis — Main analysis pipeline.
 *
 * Full pipeline:
 *   1. Parse geometry (STL via TetGen, or STEP via Gmsh)
 *   2. Detect bolt holes (from geometry or Gmsh CAD identification)
 *   3. Compute print settings strength multiplier (infill × orientation × layer height)
 *   4. Build orthotropic material from literature constants or calibrated profile
 *   5. Apply Dirichlet BCs (fixed bolt holes) and Neumann BCs (applied force)
 *   6. Run linear static FEM (PCG solver)
 *   7. SPR-smooth nodal stresses from element results
 *   8. Map volume mesh stresses back to surface triangles for display
 *   9. Compute peak VM, SF, displacement
 *  10. Run all failure mode checks (bulk, net-section, shear-out, thread, bearing)
 *  11. Singularity detection — flag if peak is a mathematical artifact
 *  12. Topology suggestions — identify high-stress regions and what to do
 *  13. Fatigue estimate — Goodman + Basquin for cyclic loading
 *  14. Generate print setting recommendations
 *
 * The most physically significant improvement over isotropic FEA:
 * The constitutive matrix C is transversely isotropic — E_z ≈ 0.65×E_xy.
 * This means the FEM stress field itself reflects FDM anisotropy,
 * not just the post-processing failure check.
 */
export async function runAnalysis(req: AnalysisRequest): Promise<AnalysisResult> {
  // Reject unknown material ids at the boundary (issue #186) rather than let the
  // downstream `MATERIALS[id] ?? pla` fallbacks silently substitute PLA physics.
  // The HTTP layer validates this too (with a friendlier 400); this guard also
  // protects direct library callers so the wrong-physics path cannot be reached.
  if (!isKnownMaterial(req.print.materialId)) {
    throw new Error(
      `Unknown materialId "${req.print.materialId}". Supported materials: ${MATERIAL_IDS.join(", ")}.`);
  }

  const t0 = Date.now();

  // ── Progress + cancellation plumbing (issue #109) ──────────────────────────
  // emit() forwards phase events to the SSE client (no-op on the JSON path).
  // checkAbort() throws AnalysisAbortError at a phase boundary if the client
  // has disconnected/cancelled, so the expensive solve never runs for an
  // abandoned request. A callback that throws must not corrupt the solve, so
  // emit() swallows callback errors.
  const emit = (ev: AnalysisPhaseEvent): void => {
    if (!req.onPhase) return;
    try { req.onPhase(ev); } catch { /* progress reporting must never break the solve */ }
  };
  const checkAbort = (): void => {
    if (req.signal?.aborted) throw new AnalysisAbortError();
  };

  // ── Material + print settings ───────────────────────────────────────────────
  const baseMat = MATERIALS[req.print.materialId] ?? MATERIALS["pla"]!;

  // Through-layer (weak) axis from the picked bed normal, when available — the
  // solver then applies an exact tensor rotation instead of the scalar-swap
  // upright approximation (issue #101). Only its direction matters (sign/azimuth
  // about the axis are immaterial). Omitted → conservative scalar-swap fallback.
  const weakAxis: readonly [number, number, number] | null =
    (req.layerNormal && Math.hypot(req.layerNormal[0], req.layerNormal[1], req.layerNormal[2]) > 1e-9)
      ? req.layerNormal : null;

  // Orientation-free material multiplier (audit A4): the criterion resolves
  // load-vs-layer direction; only the angled-no-bed case keeps a scalar
  // fallback (no directional model exists there).
  const strengthMul = materialStrengthMultiplier(
    req.print.infillPct,
    req.print.wallCount,
    req.print.pattern ?? "grid",
  );
  const orientFallbackMul = angledNoBedFallbackMul(req.print.orientation, weakAxis);
  const effectiveYield = baseMat.yieldMPa * strengthMul * orientFallbackMul;

  // Failure criterion: the FDM dual criterion by default; the upright-no-bed
  // scalar swap keeps the legacy Hill evaluation (the interface criterion
  // needs a known weak axis, which the swap deliberately does not have).
  const criterion: CriterionKind = req.analysis.criterion
    ?? ((req.print.orientation === "upright" && !weakAxis) ? "hill-legacy" : "fdm-interface");

  // Bead-penetration bond model (audit A6): only active when the request
  // carries process settings; otherwise the legacy layer-height-only path
  // runs bit-identically (bondRel = null → all multipliers 1.0).
  const bondRel: BondPrediction | null = hasProcessSettings(req.print.process)
    ? predictBondMultipliers(
        req.print.materialId,
        req.print.layerHeightMm ?? 0.2,
        req.print.process,
        req.calibration?.bondCoeffs ?? null,
      )
    : null;
  if (bondRel) {
    console.log(`[analysis] bond model active: ${bondRel.note}`);
  }

  // Use orthotropic material model — accurately captures the anisotropy of FDM parts.
  // For flat prints: E_z ≈ 0.65 × E_xy, yieldZ ≈ 0.58 × yieldXY.
  // For upright prints: axes are swapped — the strong direction faces the load.

  // Unified in-plane density knockdown (issue #176): ONE ρ-law for the lumped
  // single-material paths — a wall-credit + Gibson-Ashby volume average
  // (lumpedInPlaneStiffnessScale), the lumped limit of the two-region core.
  // The CLT path passes it as the laminate A-matrix scale; the non-CLT path as
  // the E_xy scale. This replaces the previous three inconsistent laws
  // (CLT linear-ρ, non-CLT 0.30+0.70ρ·patternMul, core bare Gibson-Ashby) that
  // swung a 20% part 2–5× across the CLT/two-region toggles. At 100% infill the
  // knockdown is exactly 1.0, so every path reproduces the solid (anchor).
  const inPlaneDensityKnockdown = lumpedInPlaneStiffnessScale(
    req.print.pattern ?? "grid",
    req.print.infillPct / 100,
    wallCreditFraction(req.print.wallCount),
    req.calibration?.latticeStiffExp,
  );

  const builtMaterial: AnyMaterial = req.analysis.useCLT
    ? buildOrthotropicMaterialCLT(
        req.print.materialId,
        req.print.infillPct,
        req.print.pattern ?? "grid",
        req.print.orientation,
        req.print.layerHeightMm ?? 0.2,
        strengthMul,
        req.calibration ?? null,
        req.analysis.beadProps,
        weakAxis,
        bondRel,
        inPlaneDensityKnockdown,
      )
    : buildOrthotropicMaterial(
        req.print.materialId,
        strengthMul,
        req.print.orientation,
        req.print.layerHeightMm ?? 0.2,
        req.calibration ?? null,
        weakAxis,
        bondRel,
        inPlaneDensityKnockdown,
      );

  // Effective mass density (issue #99): solid density × first-order solid
  // volume fraction (infill % + fully-dense perimeters). Consumed by
  // assembleMass in the modal path so the mass matrix tracks infill the same
  // way the stiffness matrix already does.
  // `let`: the two-region model (below, after meshing) replaces this with the
  // volume-weighted average of its shell/core materials.
  let material: AnyMaterial = {
    ...builtMaterial,
    massRho: baseMat.densityKgM3 * effectiveVolumeFraction(req.print.infillPct, req.print.wallCount),
  };

  // ── Build volume mesh ──────────────────────────────────────────────────────
  checkAbort();
  emit({ phase: "mesh", message: req.fileType === "step" ? "Meshing (Gmsh)…" : "Meshing (TetGen)…" });
  let mesh: import("./solver/types.js").TetMesh;
  let surfaceToNode: Int32Array;
  // Surface triangles as mesh-node triples, for consistent pressure/traction
  // loads. Null on the box-fallback path (no surface connectivity).
  let surfaceFaces: Int32Array | null = null;
  let gmshResult: import("./gmsh_mesh.js").GmshMeshResult | null = null;
  let meshFallback = false;
  /** Set by the guard-retry ladder when C3D10 had to be abandoned (issue #265). */
  let meshOrderDowngrade: MeshOrderDowngrade | null = null;

  // ── Units sanity check (issue #168) ────────────────────────────────────────
  // A physically-plausible FDM part has a bounding-box diagonal between ~1 mm
  // and ~2000 mm. Outside that, the file was almost certainly exported in the
  // wrong units (metres/inches/microns), which would make every mm/MPa/N output
  // meaningless. We do NOT auto-rescale — we flag it, additively, so the client
  // can warn and the user can re-export. The geometry is analysed exactly as
  // supplied either way.
  const _bbDiag = Math.sqrt(
    (req.bounds.maxX - req.bounds.minX) ** 2 +
    (req.bounds.maxY - req.bounds.minY) ** 2 +
    (req.bounds.maxZ - req.bounds.minZ) ** 2,
  );
  const unitsWarning: string | null =
    (Number.isFinite(_bbDiag) && (_bbDiag < 1 || _bbDiag > 2000))
      ? `This model's bounding-box diagonal is ${_bbDiag.toPrecision(4)} units — outside the ` +
        `typical millimetre range (1–2000 mm). If it was exported in metres, inches, or microns, ` +
        `the analysis units (mm, MPa, N) are misinterpreted and every result below is off by the ` +
        `unit scale. STORMFEA does not auto-rescale — re-export the geometry in millimetres and re-run.`
      : null;

  if (req._prebuiltMesh) {
    // ── Adaptive-refinement seam (issue #149) ────────────────────────────────
    // A re-meshed volume was handed to us by runAdaptiveAnalysis; skip meshing
    // entirely and solve it. Undefined on every normal request, so this branch
    // is inert on the default path.
    mesh          = req._prebuiltMesh.mesh;
    surfaceToNode = req._prebuiltMesh.surfaceToNode;
    surfaceFaces  = req._prebuiltMesh.surfaceFaces;
    console.log(`[analysis] adaptive: solving pre-built mesh (${mesh.nodeCount} nodes, ${mesh.elementCount} elements)`);
  } else if (req.fileType === "step" && req.stepBuffer) {
    // ── STEP path: Gmsh with curvature-based refinement ──────────────────────
    // Sizing is scale-relative and floored on the thinnest section (issue
    // #295); it was absolute millimetres, so this tier targeted an element SIZE
    // while the TetGen tier targets an element COUNT.
    const sizing = gmshSizingForTier(
      req.bounds,
      (req.analysis.meshQuality as import("./tetgen.js").MeshTier) ?? "standard",
    );
    const elementOrder = req.analysis.meshOrder ?? 2;
    _snapAnalysis("before Gmsh mesh");
    console.log(
      `[analysis] meshing STEP with Gmsh (clMin=${sizing.clMin.toPrecision(3)}, ` +
      `clMax=${sizing.clMax.toPrecision(3)}, clCurv=${sizing.clCurv}); ` +
      `predicted ~${Math.round(sizing.predictedElements)} elements against a ` +
      `${sizing.targetElements} target, ` +
      `${sizing.elementsThroughThickness.toFixed(1)} across the thinnest section`,
    );
    if (sizing.budgetClamped) {
      console.warn(
        `[analysis] Gmsh sizing hit the ${GMSH_MAX_BUDGET_OVERSHOOT}x element-budget ceiling; ` +
        `clMax was pulled back to ${sizing.clMax.toPrecision(3)} mm and the thinnest section now ` +
        `carries ${sizing.elementsThroughThickness.toFixed(1)} elements ` +
        `(target ${MIN_ELEMENTS_THROUGH_THICKNESS}). Results in bending may be under-resolved.`,
      );
    } else if (sizing.elementsThroughThickness < MIN_ELEMENTS_THROUGH_THICKNESS) {
      console.warn(
        `[analysis] Gmsh sizing leaves only ${sizing.elementsThroughThickness.toFixed(1)} elements ` +
        `across the thinnest section (target ${MIN_ELEMENTS_THROUGH_THICKNESS}).`,
      );
    }
    gmshResult = await meshStepWithGmsh(req.stepBuffer, {
      clMin: sizing.clMin, clMax: sizing.clMax, clCurv: sizing.clCurv, elementOrder,
    });
    mesh = gmshResult.mesh;
    surfaceFaces = gmshResult.surfaceTriangles;
    _snapAnalysis("after Gmsh mesh");
    surfaceToNode = new Int32Array(gmshResult.surfaceTriangles.length);
    for (let i = 0; i < gmshResult.surfaceTriangles.length; i++) {
      surfaceToNode[i] = gmshResult.surfaceTriangles[i] ?? 0;
    }
    console.log(`[analysis] Gmsh mesh: ${mesh.nodeCount} nodes, ${mesh.elementCount} elements (${mesh.nodesPerElem}-node)`);
  } else {
    // ── STL path: TetGen ─────────────────────────────────────────────────────
    try {
      _snapAnalysis("before TetGen mesh");
      const tetOrder = (req.analysis.meshOrder ?? 2) as 1 | 2;
      // Map the coarse/standard/fine selector to TetGen's max-volume (-a) switch
      // so the control actually affects STL mesh density. Derived from the part's
      // OWN bounding-box volume / a per-tier target element count, so mesh density
      // is scale-invariant (issue #168): a metre- or cm-scale STL meshes to the
      // same element count as the equivalent mm part, instead of the old fixed
      // mm³ values producing ~0 elements off-scale. A typical mm part reproduces
      // the historical 30/10/3 mm³ (see tetMaxVolumeForTier).
      const tetTier = (req.analysis.meshQuality === "fine" ? "fine"
                     : req.analysis.meshQuality === "coarse" ? "coarse"
                     : "standard") as import("./tetgen.js").MeshTier;
      // Sized against the tier's element COUNT (issue #168) and floored on the
      // thinnest section (issue #295) — the count budget alone let a large thin
      // plate spend its elements on plan area and carry two through the wall.
      const tetSizing = tetSizingForTier(req.bounds, tetTier);
      const tetMaxVol = tetSizing.maxVolume;
      console.log(
        `[analysis] meshing with TetGen (order=${tetOrder}, maxVol=${tetMaxVol.toPrecision(4)} units³, ` +
        `quality=${req.analysis.meshQuality}); predicted ~${Math.round(tetSizing.predictedElements)} elements ` +
        `against a ${tetSizing.targetElements} target, ` +
        `${tetSizing.elementsThroughThickness.toFixed(1)} across the thinnest section` +
        `${tetSizing.thicknessFloorBinding ? " (through-thickness floor binding)" : ""}...`,
      );
      if (tetSizing.budgetClamped) {
        console.warn(
          `[analysis] TetGen sizing hit the ${MESH_MAX_BUDGET_OVERSHOOT}x element-budget ceiling; ` +
          `maxVol was pushed back to ${tetMaxVol.toPrecision(4)} units³ and the thinnest section now ` +
          `carries ${tetSizing.elementsThroughThickness.toFixed(1)} elements ` +
          `(target ${MIN_ELEMENTS_THROUGH_THICKNESS}). Results in bending may be under-resolved.`,
        );
      }
      const tetResult = await meshWithGuardRetry(
        tetOrder,
        order => meshWithTetGen(req.positions, req.triangleCount, order, tetMaxVol),
        d => { meshOrderDowngrade = d; },
      );
      mesh          = tetResult.mesh;
      surfaceToNode = tetResult.surfaceToNode;
      surfaceFaces  = tetResult.surfaceFaces;
      console.log(`[analysis] TetGen mesh: ${mesh.nodeCount} nodes, ${mesh.elementCount} elements (${mesh.nodesPerElem}-node)`);
      _snapAnalysis("after TetGen mesh");
    } catch (err) {
      // A missing binary is an environment problem, not a geometry problem —
      // don't degrade to the box mesh (which the UI explains as "your STL may
      // be broken"). Surface the real cause with its install hint instead
      // (issue #106). The box fallback below remains for genuine meshing
      // failures where TetGen ran and rejected the geometry.
      if (err instanceof TetGenNotFoundError) throw err;
      // Honour the element-order selector on the fallback too: a C3D10 box mesh
      // avoids the ~55% bending underprediction that C3D4 suffers from shear
      // locking. The box is still featureless (no holes/fillets), so the
      // mesh-fallback reliability banner is unchanged — only element-order
      // accuracy improves.
      const tetOrder = (req.analysis.meshOrder ?? 2) as 1 | 2;
      console.warn(`[analysis] TetGen failed, falling back to ${tetOrder === 2 ? "C3D10" : "C3D4"} box mesh:`, err);
      meshFallback = true;
      const { minX, maxX, minY, maxY, minZ, maxZ } = req.bounds;
      const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
      const divisions = req.analysis.meshQuality === "fine" ? 32 : req.analysis.meshQuality === "coarse" ? 12 : 22;
      const aspect = Math.max(spanX, spanY, spanZ);
      const nx = Math.max(4, Math.round(divisions * spanX / aspect));
      const ny = Math.max(4, Math.round(divisions * spanY / aspect));
      const nz = Math.max(2, Math.round(divisions * spanZ / aspect));
      mesh = tetOrder === 2
        ? generateBoxMeshC3D10(minX, minY, minZ, maxX, maxY, maxZ, nx, ny, nz)
        : generateBoxMeshC3D4(minX, minY, minZ, maxX, maxY, maxZ, nx, ny, nz);
      // Real boundary connectivity so surface-pressure loads are honoured on the
      // fallback (previously skipped for lack of surface faces).
      surfaceFaces = extractSurfaceFaces(mesh);
      surfaceToNode = new Int32Array(req.triangleCount * 3);
      for (let i = 0; i < surfaceToNode.length; i++) surfaceToNode[i] = i % mesh.nodeCount;
    }
  }

  // ── Achieved vs target resolution (issue #295) ───────────────────────────
  // Measured on the mesh that came back, not predicted from the flags that
  // were sent: both meshers treat a size cap as a request. TetGen's switch-set
  // fallback chain relaxes `-a` and can end at `-pQ` with no volume constraint
  // at all, and Gmsh's clmax yields where a curvature constraint disagrees, so
  // a readout built from the flags would report the mesh that is not in doubt.
  // Skipped on the box fallback, where the geometry itself was replaced and
  // `meshFallback` is the disclosure that matters. Computed for PRE-BUILT
  // meshes too (the adaptive seam): elements-across-the-thinnest-section is a
  // property of the mesh, not of how it was requested, and the two-region
  // resolution gate below depends on it being present on every real mesh. The
  // count half of the readout is tier-relative and an adaptively-refined mesh
  // legitimately overshoots its tier — which is never warned about anyway.
  let meshResolution: MeshResolutionReport | null = null;
  if (!meshFallback) {
    let meshedVolume = 0;
    for (let e = 0; e < mesh.elementCount; e++) meshedVolume += tetCornerVolume(mesh, e);
    const resTier = (req.analysis.meshQuality === "fine" ? "fine"
                   : req.analysis.meshQuality === "coarse" ? "coarse"
                   : "standard") as import("./tetgen.js").MeshTier;
    meshResolution = achievedResolution(req.bounds, resTier, mesh.elementCount, meshedVolume);
    if (meshResolution?.warning) {
      console.warn(
        `[analysis] mesh resolution: ${meshResolution.achievedElements} elements against a ` +
        `${meshResolution.targetElements} ${resTier} target ` +
        `(${meshResolution.budgetRatio.toFixed(2)}x), ` +
        `${meshResolution.elementsThroughThickness.toFixed(1)} across the thinnest section. ` +
        meshResolution.warning,
      );
    }
  }

  // Mesh built — report size to the client immediately (issue #109) and honor
  // an abort that arrived while the (async) mesher was running, so the solve
  // never starts for a request the client already abandoned.
  checkAbort();
  emit({
    phase: "mesh",
    message: "Mesh built",
    nodeCount:    mesh.nodeCount,
    elementCount: mesh.elementCount,
    nodesPerElem: mesh.nodesPerElem,
    dof:          mesh.nodeCount * 3,
  });

  // ── Two-region (shell/core) material model ─────────────────────────────────
  // Opt-in: classify each element by its wall-band volume fraction and replace
  // the single homogenized material with a quantized shell↔core blend field.
  // `material` becomes the volume-weighted AVERAGE (scalar consumers keep
  // working); the field carries the per-element stiffness/yield/density.
  let materialField: ElementMaterialField | undefined;
  let wallBondField: WallBondField | undefined;
  // Shell (dense perimeter) allowables for wall-lined-hole bolt-region checks
  // (issue #175). Set only on the two-region path; whole-part consumers keep
  // reading the volume-averaged `material`.
  let shellHoleAllowables: { yieldXY: number; interlayerShear: number } | undefined;
  let materialModel: MaterialModelInfo = {
    twoRegion: false,
    wallThicknessMm: null,
    shellVolumeFraction: null,
    shellYieldXYMPa: null,
    coreYieldXYMPa: null,
    impliedAvgStrengthMul: null,
    globalModelStrengthMul: strengthMul * orientFallbackMul,
    ...(bondRel ? { bond: bondRel.supported ? {
      relStrength:    +bondRel.relStrength.toFixed(4),
      relStiffness:   +bondRel.relStiffness.toFixed(4),
      coolingFanRefPct: bondRel.coolingFanRefPct,
      interfaceTempC: +bondRel.interfaceTempC.toFixed(1),
      substrateTempC: +bondRel.substrateTempC.toFixed(1),
      coolTimeConstS: +bondRel.coolTimeConstS.toFixed(2),
      clamped:        bondRel.clamped,
      confidence:     bondRel.confidence,
      note:           bondRel.note,
    } : {
      // Unknown material (issue #186): bond path refused, reference no-op
      // multipliers applied. Surface the disclosure; omit the meaningless temps.
      relStrength:    1,
      relStiffness:   1,
      applied:        false,
      clamped:        false,
      confidence:     bondRel.confidence,
      note:           bondRel.note,
    } } : {}),
  };
  // Default TRUE (issue #297) — `?? true`, so an explicit `false` still selects
  // the legacy single-material path bit-identically (invariant 1) and only an
  // ABSENT flag changes meaning. Every guard below can still degrade it back.
  const twoRegionRequested = req.analysis.twoRegion ?? true;
  if (twoRegionRequested) {
    const degrade = (why: string): void => {
      console.warn(`[analysis] two-region requested but degraded to uniform: ${why}`);
      materialModel = { ...materialModel, degraded: why };
    };
    if (meshFallback) {
      // The box mesh has material where the real part has holes — a geometric
      // wall band on it would be doubly wrong. Results are already flagged
      // unreliable via meshFallback.
      degrade("box-fallback mesh (no real geometry to classify)");
    } else if (!surfaceFaces || surfaceFaces.length === 0) {
      degrade("no boundary surface available");
    } else if (mesh.elementCount > TWO_REGION_MAX_ELEMENTS) {
      degrade(`mesh too large (${mesh.elementCount} > ${TWO_REGION_MAX_ELEMENTS} elements)`);
    } else if (meshResolution?.belowThroughThicknessFloor) {
      // ── The resolution gate (issue #297) ───────────────────────────────────
      // The CLASSIFICATION is not the fragile part — `tetFractionBelowIso`
      // integrates the level set INSIDE the element (invariant #2), so the
      // shell volume fraction is within 3.2% even when the element is 4.4x the
      // band width. What needs resolution is the STRUCTURAL EFFECT the model
      // exists to capture. Measured on a 60x30x6 mm sandwich cantilever, as
      // the share of the converged 26.1% stiffening each mesh recovers:
      //
      //   1 element through thickness:   4%   (tip deflection 29.0% off)
      //   2 elements:                   57%   (13.1% off)
      //   3 elements:                   83%   (4.75% off)
      //   4 elements:                  100%   (0.84% off)
      //
      // At one element through thickness the model returns essentially the
      // homogenized answer WHILE REPORTING ITSELF ACTIVE, which is worse than
      // not offering it: the user reads "two-region" and a shell fraction on a
      // result that is uniform in all but name. Degrading is the honest
      // outcome — same answer, accurate label, and a reason that names the fix.
      //
      // This is measured on the emitted mesh (`meshResolution`), not on the
      // sizing request, because both meshers treat a size cap as a request
      // (issue #295). The tiers now FLOOR at MIN_ELEMENTS_THROUGH_THICKNESS, so
      // this fires only where the mesher could not honour that floor — a very
      // thin section against the element-budget ceiling, or a mesher fallback.
      degrade(
        `mesh resolves only ${meshResolution.elementsThroughThickness.toFixed(1)} elements across ` +
        `the thinnest section (needs ${MIN_ELEMENTS_THROUGH_THICKNESS}); the shell/core split would ` +
        `report itself active while returning the homogenized answer`,
      );
    } else {
      const lineWidth = Math.min(2.0, Math.max(0.1, req.print.extrusionWidthMm ?? 0.45));
      const tWall = req.print.wallCount * lineWidth;

      // Shell: solid perimeter material at full strength (strengthMul = 1.0)
      // — exactly the convention the coupon calibration back-calculates
      // (coupons are printed flat and pulled in-plane), so calibrated solid
      // props flow to the shell unchanged. Orientation is the criterion's
      // job (audit A4); the builder applies the angled-no-bed fallback
      // itself. No pattern multiplier, no infill knockdown, solid density.
      const shellBuilt = buildOrthotropicMaterial(
        req.print.materialId, 1.0, req.print.orientation,
        req.print.layerHeightMm ?? 0.2, req.calibration ?? null, weakAxis,
        bondRel,
      );
      const shellMat: OrthotropicMaterial = { ...shellBuilt, massRho: baseMat.densityKgM3 };
      // Capture the dense-perimeter allowables for wall-lined bolt-region checks
      // (#175). The shell is built at strengthMul = 1.0 (solid perimeter), so
      // this is independent of infill — a 20%-infill and a 100%-infill part with
      // equal wall count get the SAME bearing/thread allowable.
      shellHoleAllowables = { yieldXY: shellMat.yieldXY, interlayerShear: interlaminarShearOf(shellMat) };

      // Core: wall-free homogenized lattice — per-axis Gibson-Ashby power
      // laws applied to the solid lattice base (see buildCoreMaterial: frame
      // handling, Poisson guard, ρ=1 anchors, CLT-at-100% composition; near 0
      // at 0% infill — infillStrengthCurve's 0.30 intercept represents the
      // walls and must NOT be reused here). The shell stays on the solid
      // builder: perimeters are solid extrusions, not the infill ply stack.
      const rho = req.print.infillPct / 100;
      const pattern = req.print.pattern ?? "grid";
      // Reporting scales: the in-plane stiffness law and the strength
      // fraction. The core itself is built with the full per-axis set
      // (anisotropic families) inside buildCoreMaterial.
      const gStiff = latticeStiffnessScale(pattern, rho, req.calibration?.latticeStiffExp);
      const sStr   = latticeStrengthFraction(pattern, rho, req.calibration?.latticeStrengthExp);

      const coreMat = buildCoreMaterial(
        req.print.materialId, req.print.infillPct, pattern, req.print.orientation,
        req.print.layerHeightMm ?? 0.2, req.calibration ?? null,
        req.analysis.useCLT ?? false, req.analysis.beadProps, weakAxis,
        bondRel,
      );

      // Independent floor/ceiling (top/bottom solid skin) bands: their
      // thickness is layers × layer height, generally DIFFERENT from the
      // vertical perimeter band (wallCount × line width). Skins are the SAME
      // solid material as the perimeters (same weak axis), so only the geometry
      // changes. The top/bottom solid-skin count has no physical relationship
      // to the perimeter wall count, so when the caller supplies none we assume
      // sensible slicer defaults (4/4) and derive the skin thickness from THEM
      // — never silently borrowing tWall (issue #181). The assumption is
      // surfaced in materialModel (skinLayersAssumed) and the report. Skins are
      // always modeled for a two-region solve; when their thickness equals
      // tWall the classifier still collapses bit-identically to the single-band
      // path (skin-band.test.ts).
      const layerH = req.print.layerHeightMm ?? 0.2;
      const clampLayers = (n: number | undefined, dflt: number): number =>
        n === undefined ? dflt : Math.min(64, Math.max(0, n));
      const topAssumed = req.print.topLayers === undefined;
      const botAssumed = req.print.bottomLayers === undefined;
      const topLayers = clampLayers(req.print.topLayers, DEFAULT_TOP_LAYERS);
      const botLayers = clampLayers(req.print.bottomLayers, DEFAULT_BOTTOM_LAYERS);
      const skinLayersAssumed = topAssumed || botAssumed;
      const tSkinTop = topLayers * layerH;
      const tSkinBot = botLayers * layerH;
      // Build axis for skin geometry: the picked bed normal, else assume Z-up.
      const skinBuildAxis: "bed" | "assumed-z-up" = weakAxis ? "bed" : "assumed-z-up";
      const buildAxis = weakAxis ?? ([0, 0, 1] as const);
      const skin = { buildAxis, tSkinTop, tSkinBot };

      const tr = buildTwoRegionField(mesh, surfaceFaces, shellMat, coreMat, tWall, skin);
      material = tr.averageMaterial;
      materialField = tr.field ?? undefined;

      // ── Wall-to-wall (bead-to-bead) bond field ────────────────────────────
      // Opt-in, requires twoRegion (rides on the same distance-field geometry)
      // and wallCount >= 2 (no internal loop boundary otherwise). Criterion-
      // only: never touches the constitutive matrix built above.
      if (req.analysis.wallBond && req.print.wallCount >= 2) {
        // Inter-pass revisit time for wall-to-wall bonding is a DIFFERENT
        // geometry than interlayer (Z) bonding: adjacent loops are usually
        // printed back-to-back within the same layer, so the relevant
        // "return" is roughly the time to finish one full perimeter loop —
        // perimeterLengthMm / printSpeed — not a fixed toolpath constant.
        // Estimated from the OUTER-contour perimeter-face area (exact for a
        // prismatic part; internal hole bores excluded — #182); degenerates
        // (near-zero height, no perimeter faces) fall back to a fixed length.
        const perimeterEstimate = estimateWallLoopPerimeterMm(mesh, surfaceFaces, buildAxis);
        const perimeterFallback = !(perimeterEstimate > 1e-6);
        const passLengthMmWall = perimeterFallback ? WALL_BOND_PASS_LENGTH_FALLBACK_MM : perimeterEstimate;

        // Wall-to-wall weld: the road's thermal DEPTH is the bead LINE WIDTH
        // (adjacent beads cool laterally toward each other through their sides),
        // not the layer height — so pass lineWidth as the thermal depth WITH the
        // width-appropriate clamp, instead of silently repurposing the layer-
        // height slot and its layer-height clamp (issue #185; τc π/8 transfer
        // derivation in WALL_THERMAL_DEPTH_CLAMP_MM's docs). Same value for
        // in-clamp widths (≤1.0 mm) as before, so results are bit-identical
        // there; a >1.0 mm wide bead is now honored instead of clamped to 1.0.
        const bondRelWall: BondPrediction | null = hasProcessSettings(req.print.process)
          ? predictBondMultipliers(
              req.print.materialId,
              lineWidth,
              req.print.process,
              req.calibration?.bondCoeffs ?? null,
              passLengthMmWall,
              WALL_THERMAL_DEPTH_CLAMP_MM,
            )
          : null;

        // Wall-to-wall allowables: no dedicated coupon data exists for this
        // interface anywhere in the codebase (genuinely unexplored design
        // space). Pragmatic first-order stand-in: reuse the interlayer
        // allowables (same polymer weld mechanism, different geometry),
        // re-modulated by the wall-specific bond model's relative strength.
        // LOW confidence by construction — labeled as such in the diagnostic.
        const wallRelStrength = bondRelWall?.relStrength ?? 1.0;
        const yieldWallMPa = shellMat.yieldZ * wallRelStrength;
        const yieldWallShearMPa = interlaminarShearOf(shellMat) * wallRelStrength;

        wallBondField = buildWallBondField(
          mesh, surfaceFaces, lineWidth, req.print.wallCount, yieldWallMPa, yieldWallShearMPa,
        ) ?? undefined;

        materialModel = {
          ...materialModel,
          wallBond: wallBondField ? {
            relStrength:      +wallRelStrength.toFixed(4),
            relStiffness:     bondRelWall ? +bondRelWall.relStiffness.toFixed(4) : null,
            yieldWallMPa:      +yieldWallMPa.toFixed(3),
            yieldWallShearMPa: +yieldWallShearMPa.toFixed(3),
            perimeterLengthMm: +passLengthMmWall.toFixed(1),
            perimeterFallback,
            loopLengthBasis: perimeterFallback ? "fallback" : "outer-contour",
            ...(bondRelWall ? { note: bondRelWall.note } : {}),
          } : null,
        };
      }

      // ── Collapse: shell ≡ core, so there is no split (issue #297) ─────────
      // `buildTwoRegionField` short-circuits BEFORE computing the
      // classification here, because on a 100%-infill part it would cost the
      // dominant share of the analysis to produce a percentage that cannot
      // change a single reported number. Report the collapse honestly — the
      // model ran and found nothing to split, which is not a degradation (it
      // was not "asked for and undeliverable") and not a two-region solve
      // either. `materialModel.twoRegion` stays false, matching the fact that
      // the solve IS uniform.
      if (tr.shellVolumeFraction === null) {
        materialModel = { ...materialModel, collapsed: tr.collapsedReason ?? "no split" };
      } else {
      // Anchor diagnostics: what the geometric split implies vs the legacy
      // geometry-blind global multiplier. Reported, deliberately not
      // renormalized — the divergence is the point of the model. Reuses the
      // exact sStr that built the core, so the diagnostic can never
      // desynchronize from the material.
      const Vf = tr.shellVolumeFraction;
      const impliedAvgStrengthMul = (Vf * 1.0 + (1 - Vf) * sStr) * orientFallbackMul;
      const family = patternFamilyOf(pattern);
      materialModel = {
        ...materialModel,
        twoRegion: true,
        wallThicknessMm: tWall,
        skinTopThicknessMm: tSkinTop,
        skinBotThicknessMm: tSkinBot,
        skinTopLayers: topLayers,
        skinBotLayers: botLayers,
        skinLayersAssumed,
        skinBuildAxis,
        shellVolumeFraction: Vf,
        shellYieldXYMPa: shellMat.yieldXY,
        coreYieldXYMPa: coreMat.yieldXY,
        impliedAvgStrengthMul,
        core: {
          model: "gibson-ashby",
          patternFamily: family,
          stiffnessExponent: req.calibration?.latticeStiffExp ?? LATTICE_PARAMS[family].stiffExpXY,
          // Representative (in-plane) strength exponent; the through-layer and
          // interlaminar-shear axes now follow their own exponents (issue #177).
          strengthExponent:  req.calibration?.latticeStrengthExp ?? LATTICE_PARAMS[family].strengthExpXY,
          stiffnessScale: gStiff,
          strengthScale:  sStr,
          floored: gStiff <= LATTICE_STIFFNESS_FLOOR,
          yieldCriterion: coreMat.dfaAlpha && coreMat.dfaAlpha > 0 ? "deshpande-fleck-ashby" : "von-mises",
          dfaAlpha: +(coreMat.dfaAlpha ?? 0).toFixed(4),
          confidence: "LOW",
        },
      };
      console.log(
        `[analysis] two-region model: tWall=${tWall.toFixed(2)}mm, ` +
        `skins top=${tSkinTop.toFixed(2)}mm (${topLayers}L) bot=${tSkinBot.toFixed(2)}mm (${botLayers}L) ` +
        `${skinBuildAxis}${skinLayersAssumed ? " assumed-default" : ""}, ` +
        `shell Vf=${(Vf * 100).toFixed(1)}%, ` +
        `bins=${tr.field ? tr.field.binCount : "collapsed-to-uniform"}, ` +
        `impliedAvgMul=${impliedAvgStrengthMul.toFixed(3)} vs globalMul=${strengthMul.toFixed(3)}`
      );
      }
    }
  }

  // ── Constraints: bolt hole physics ────────────────────────────────────────
  emit({ phase: "constraints", message: "Applying constraints…" });
  const boltedHoles = req.holes.filter(h => req.boltHoleIds.includes(h.id));
  const constraints: { nodeIndices: number[] }[] = [];

  if (gmshResult && gmshResult.holeWallNodes.size > 0) {
    // STEP path: use Gmsh's exactly-identified hole wall nodes
    // holeWallNodes is indexed 0, 1, ... in order of detection
    // boltHoleIds refers to the same holes by index
    for (const holeId of req.boltHoleIds) {
      const wallNodes = gmshResult.holeWallNodes.get(holeId);
      if (wallNodes && wallNodes.length > 0) {
        console.log(`[analysis] STEP hole ${holeId}: ${wallNodes.length} wall nodes (exact from CAD)`);
        constraints.push({ nodeIndices: wallNodes });
      }
    }
    // If no boltHoleIds specified, constrain all detected holes
    if (constraints.length === 0 && gmshResult.holeWallNodes.size > 0) {
      for (const [id, wallNodes] of gmshResult.holeWallNodes.entries()) {
        console.log(`[analysis] STEP auto-constraining hole ${id}: ${wallNodes.length} nodes`);
        constraints.push({ nodeIndices: wallNodes });
      }
    }
  } else {
    // STL path: geometric search for hole wall nodes.
    // Uses the bounded 3-D cylinder test (issue #105) — the previous XY-only
    // annulus fixed every node in the part whose XY projection landed in the
    // ring, regardless of its position along the hole axis.
    for (const hole of boltedHoles) {
      const holeNodes = findStlBoltConstraintNodes(mesh.nodes, mesh.nodeCount, hole);
      console.log(
        `[analysis] hole ${hole.id}: ${holeNodes.length} wall nodes ` +
        `(r=${hole.radius.toFixed(2)}±15%, axial ±${(hole.radius*2.5).toFixed(2)}mm)`,
      );
      constraints.push({ nodeIndices: holeNodes });
    }
  }

  // ── Forces ─────────────────────────────────────────────────────────────────
  const solverForces: { nodeIndex: number; forceN: [number,number,number] }[] = [];
  // Track peak nodal force per force spec for bearing stress calculation
  const peakNodalForcesPerForce = new Map<number, number>();

  for (let forceIdx = 0; forceIdx < req.forces.length; forceIdx++) {
    const f = req.forces[forceIdx]!;
    const [dx, dy, dz] = f.direction;
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
    const fx = dx/len * f.magnitude;
    const fy = dy/len * f.magnitude;
    const fz = dz/len * f.magnitude;

    // ── Tapered patch (issue #260) ──────────────────────────────────────────
    // Opt-in, and it returns before any of the extreme-face node selection
    // below runs — so an absent or legacy `loadDistribution` reaches exactly
    // the code it always did. Needs surface connectivity to integrate over;
    // without it (a mesh path that carries none) fall through to the legacy
    // selection with a loud note rather than silently applying a different
    // load model than the caller asked for.
    // The DEFAULT distribution (issue #271). An absent `loadDistribution` now
    // means 'contact_patch': the load is applied where it was placed. Legacy
    // stays reachable by asking for it explicitly — 'uniform' reproduces the
    // old absent-field cascade exactly, including the near-hole linear taper.
    const mode = f.loadDistribution ?? DEFAULT_LOAD_DISTRIBUTION;

    if (mode === 'contact_patch') {
      if (surfaceFaces) {
        const patch = assembleContactPatchLoad(
          mesh, surfaceFaces, [dx/len, dy/len, dz/len], [fx, fy, fz],
          f.position, f.loadPatchRadiusMm,
        );
        let applied = 0, resX = 0, resY = 0, resZ = 0;
        for (let n = 0; n < mesh.nodeCount; n++) {
          const nx = patch.forces[n*3] ?? 0;
          const ny = patch.forces[n*3+1] ?? 0;
          const nz = patch.forces[n*3+2] ?? 0;
          if (nx !== 0 || ny !== 0 || nz !== 0) {
            solverForces.push({ nodeIndex: n, forceN: [nx, ny, nz] });
            applied++; resX += nx; resY += ny; resZ += nz;
          }
        }
        // The snap distance is the one number that says whether the load landed
        // where the user put it. A large snap means the application point was
        // not on a surface facing the load — worth seeing, not worth failing.
        const snapNote = patch.centreSnapMm > (patch.radiusMm || 1)
          ? ` — WARNING: the application point is ${patch.centreSnapMm.toFixed(2)}mm from the nearest ` +
            `surface facing this load, further than the patch radius. The load was applied at the ` +
            `nearest windward surface instead. Check the force direction against where it was placed.`
          : ` (application point ${patch.centreSnapMm.toFixed(3)}mm from the nearest windward face)`;
        console.log(`[analysis] force ${f.magnitude}N in (${dx},${dy},${dz}): contact patch at ` +
          `(${f.position.join(",")}) radius=${patch.radiusMm.toFixed(3)}mm over ` +
          `${patch.loadedTriangles} triangles, ${applied} loaded nodes, ` +
          `|resultant|=${Math.hypot(resX, resY, resZ).toFixed(4)}N${snapNote}`);
        continue;
      }
      console.warn(
        `[analysis] force ${f.magnitude}N would use loadDistribution='${mode}'` +
        `${f.loadDistribution ? "" : " (the default)"}, but this mesh carries no surface ` +
        `connectivity to integrate a traction over. Falling back to the legacy extreme-face ` +
        `selection — the result is the LEGACY load model, and the application point is NOT honoured.`,
      );
    }

    if (mode === 'tapered_patch') {
      if (surfaceFaces) {
        const tapered = assembleTaperedFaceLoad(
          mesh, surfaceFaces, [dx/len, dy/len, dz/len], [fx, fy, fz], f.loadPatchDepthMm,
        );
        let applied = 0, resX = 0, resY = 0, resZ = 0;
        for (let n = 0; n < mesh.nodeCount; n++) {
          const nx = tapered.forces[n*3] ?? 0;
          const ny = tapered.forces[n*3+1] ?? 0;
          const nz = tapered.forces[n*3+2] ?? 0;
          if (nx !== 0 || ny !== 0 || nz !== 0) {
            solverForces.push({ nodeIndex: n, forceN: [nx, ny, nz] });
            applied++; resX += nx; resY += ny; resZ += nz;
          }
        }
        console.log(`[analysis] force ${f.magnitude}N in (${dx},${dy},${dz}): tapered patch ` +
          `depth=${tapered.patchDepthMm.toFixed(3)}mm over ${tapered.loadedTriangles} triangles, ` +
          `${applied} loaded nodes, |resultant|=${Math.hypot(resX, resY, resZ).toFixed(4)}N`);
        continue;
      }
      console.warn(
        `[analysis] force ${f.magnitude}N requested loadDistribution='tapered_patch', but this ` +
        `mesh carries no surface connectivity to integrate a traction over. Falling back to the ` +
        `legacy extreme-face selection — the result is the LEGACY load model, not the tapered one.`,
      );
    }

    let faceNodes: number[];

    if (gmshResult) {
      // STEP path: use the exact CAD face in the force direction
      const isTopForce = dz/len > 0.5;
      const isBottomForce = dz/len < -0.5;
      if (isTopForce && gmshResult.topFaceNodes.length > 0) {
        faceNodes = gmshResult.topFaceNodes;
      } else if (isBottomForce && gmshResult.bottomFaceNodes.length > 0) {
        faceNodes = gmshResult.bottomFaceNodes;
      } else {
        // A ±Z-directed force was requested but Gmsh classified NO matching
        // top/bottom face (issue #169). This used to fall through silently; make
        // it loud so a misclassification (e.g. an origin-centred or very thin
        // STEP part whose flat faces were not recognised) is visible instead of
        // the load quietly landing on a geometric best-guess face.
        if (isTopForce || isBottomForce) {
          console.warn(
            `[analysis] ${isTopForce ? 'top' : 'bottom'}-directed force ${f.magnitude}N ` +
            `(dir ${dx},${dy},${dz}) requested, but Gmsh classified no ` +
            `${isTopForce ? 'top_face' : 'bottom_face'} (top=${gmshResult.topFaceNodes.length} ` +
            `bottom=${gmshResult.bottomFaceNodes.length} nodes). Falling back to the geometric ` +
            `extreme face. If the load lands wrong, the STEP part is likely origin-centred or ` +
            `thinner than expected — check the flat-face classification.`
          );
        }
        // Find extreme face in force direction
        let maxProj = -Infinity;
        for (let n = 0; n < mesh.nodeCount; n++) {
          const proj = (mesh.nodes[n*3]??0)*(dx/len) + (mesh.nodes[n*3+1]??0)*(dy/len) + (mesh.nodes[n*3+2]??0)*(dz/len);
          if (proj > maxProj) maxProj = proj;
        }
        faceNodes = [];
        for (let n = 0; n < mesh.nodeCount; n++) {
          const proj = (mesh.nodes[n*3]??0)*(dx/len) + (mesh.nodes[n*3+1]??0)*(dy/len) + (mesh.nodes[n*3+2]??0)*(dz/len);
          if (maxProj - proj < 0.5) faceNodes.push(n);
        }
      }
    } else {
      // STL path: find extreme face geometrically
      let maxProj = -Infinity;
      for (let n = 0; n < mesh.nodeCount; n++) {
        const proj = (mesh.nodes[n*3]??0)*(dx/len) + (mesh.nodes[n*3+1]??0)*(dy/len) + (mesh.nodes[n*3+2]??0)*(dz/len);
        if (proj > maxProj) maxProj = proj;
      }
      faceNodes = [];
      for (let n = 0; n < mesh.nodeCount; n++) {
        const proj = (mesh.nodes[n*3]??0)*(dx/len) + (mesh.nodes[n*3+1]??0)*(dy/len) + (mesh.nodes[n*3+2]??0)*(dz/len);
        if (maxProj - proj < 0.5) faceNodes.push(n);
      }
    }

    console.log(`[analysis] force ${f.magnitude}N in (${dx},${dy},${dz}): ${faceNodes.length} face nodes, distribution=${f.loadDistribution ?? 'uniform'}`);
    const k = faceNodes.length || 1;

    const holeList = req.holes.filter(h => req.boltHoleIds.includes(h.id));
    const isCosineBearing = f.loadDistribution === 'cosine_bearing' && holeList.length > 0 && faceNodes.length > 4;

    if (isCosineBearing) {
      // Cosine-bearing distribution: concentrated at bearing point, tapers to zero at 90°
      // Weight function: w(θ) = max(0, cos(θ))
      // where θ is the angle between node position (relative to hole center) and force direction

      // Find hole center on the loading face
      let holeCenterX = 0, holeCenterY = 0, holeCenterZ = 0;
      let holeWeight = 0;
      for (const hole of holeList) {
        holeCenterX += hole.centre[0];
        holeCenterY += hole.centre[1];
        holeCenterZ += hole.centre[2];
        holeWeight += 1;
      }
      holeCenterX /= holeWeight;
      holeCenterY /= holeWeight;
      holeCenterZ /= holeWeight;

      // Compute cosine weights, normalize, and build nodal forces
      // (extracted to computeCosineBearingForces for unit testing)
      const { nodalForces, peakNodalForce } = computeCosineBearingForces(
        mesh.nodes, faceNodes,
        holeCenterX, holeCenterY, holeCenterZ,
        dx/len, dy/len, dz/len,
        fx, fy, fz,
      );
      for (let ni = 0; ni < faceNodes.length; ni++) {
        solverForces.push({ nodeIndex: faceNodes[ni]!, forceN: nodalForces[ni]! });
      }
      peakNodalForcesPerForce.set(forceIdx, peakNodalForce);
    } else if (holeList.length > 0 && faceNodes.length > 4) {
      // Linear-taper distribution (default for bolted holes without explicit cosine_bearing)
      // Nodes closer to the bolt hole edge receive proportionally higher load.
      const weights = new Float64Array(faceNodes.length).fill(1.0);
      for (let ni = 0; ni < faceNodes.length; ni++) {
        const n = faceNodes[ni]!;
        const nx = mesh.nodes[n*3]   ?? 0;
        const ny = mesh.nodes[n*3+1] ?? 0;
        // Find minimum distance to any bolt hole centre (in XY)
        let minDistSq = Infinity;
        let nearRadius = 1.5;
        for (const hole of holeList) {
          const dx2 = nx - hole.centre[0];
          const dy2 = ny - hole.centre[1];
          const d2  = dx2*dx2 + dy2*dy2;
          if (d2 < minDistSq) { minDistSq = d2; nearRadius = hole.radius; }
        }
        const minDist = Math.sqrt(minDistSq);
        const R = nearRadius * 3.0;  // influence radius = 3× hole radius
        if (minDist < R) {
          weights[ni] = 1.0 + 0.6 * (1.0 - minDist / R);
        }
      }
      // Normalize weights so total force is preserved
      const wSum = Array.from(weights).reduce((a,b)=>a+b, 0);
      const wScale = k / wSum;
      for (let ni = 0; ni < faceNodes.length; ni++) {
        const n = faceNodes[ni]!;
        const w = (weights[ni]! * wScale) / k;
        solverForces.push({ nodeIndex: n, forceN: [fx*w, fy*w, fz*w] });
      }
    } else {
      // Uniform distribution (no holes nearby or too few nodes)
      for (const n of faceNodes) {
        solverForces.push({ nodeIndex: n, forceN: [fx/k, fy/k, fz/k] });
      }
    }
  }

  // ── Self-weight / body-force load (gravity or robot acceleration) ──────────
  // When requested, add a consistent body-force load. b = ρ·a in N/mm³, where
  //   ρ = material.massRho[kg/m³] × 1e-12  (→ tonne/mm³, already infill-scaled #99)
  //   a = g × 9806.65 mm/s² along the normalised direction
  // and 1 tonne·mm/s² = 1 N, so the resulting nodal loads are in N and add
  // directly to the point-force list feeding the solve (and buckling pre-stress).
  if (req.gravity && req.gravity.g) {
    const dir  = req.gravity.direction;
    const dlen = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const rhoTMm3 = ((material as { massRho?: number }).massRho ?? 1240) * 1e-12;
    const a = req.gravity.g * 9806.65;
    const b: [number, number, number] = [
      rhoTMm3 * a * (dir[0] / dlen),
      rhoTMm3 * a * (dir[1] / dlen),
      rhoTMm3 * a * (dir[2] / dlen),
    ];
    // Two-region field: distribute the weight where the material actually is
    // (dense walls vs sparse core) instead of uniformly at the average density.
    let rhoScale: Float64Array | null = null;
    if (materialField) {
      const avgRho = (material as { massRho?: number }).massRho ?? 1240;
      rhoScale = new Float64Array(mesh.elementCount);
      for (let e = 0; e < mesh.elementCount; e++) {
        rhoScale[e] = (materialField.massRho[materialField.binOfElement[e] ?? 0] ?? avgRho) / avgRho;
      }
    }
    const bodyF = assembleBodyForce(mesh, b, rhoScale);
    let loaded = 0, totX = 0, totY = 0, totZ = 0;
    for (let n = 0; n < mesh.nodeCount; n++) {
      const fx = bodyF[n*3] ?? 0, fy = bodyF[n*3+1] ?? 0, fz = bodyF[n*3+2] ?? 0;
      if (fx !== 0 || fy !== 0 || fz !== 0) {
        solverForces.push({ nodeIndex: n, forceN: [fx, fy, fz] });
        loaded++; totX += fx; totY += fy; totZ += fz;
      }
    }
    console.log(`[analysis] self-weight ${req.gravity.g}g: ${loaded} loaded nodes, ` +
      `resultant=${Math.hypot(totX, totY, totZ).toFixed(3)}N`);
  }

  // ── Surface pressure / traction loads ──────────────────────────────────────
  // A traction applied over the surface triangles of the extreme face in
  // direction d, distributed as consistent (tributary-area) nodal forces.
  // Uniform mode: t = P·(−d) (same push on every loaded triangle). Normal mode
  // (p.normal): t = P·(−n̂) per triangle, following each triangle's own outward
  // normal — a true pressure on a curved/non-planar face. The fallback box mesh
  // now carries surface connectivity, so pressure is honoured there too.
  if (req.pressures && req.pressures.length > 0) {
    if (!surfaceFaces) {
      console.warn("[analysis] surface pressure ignored — no surface connectivity.");
    } else {
      for (const p of req.pressures) {
        // Zero → no-op. Negative is allowed and means outward (tension/suction).
        if (!Number.isFinite(p.magnitude) || p.magnitude === 0) continue;
        // Which surface triangles the pressure acts on:
        //   'face'   (default) — the extreme face toward `direction` (a band).
        //   'facing' — every surface triangle whose outward normal faces
        //              `direction` (the whole windward side).
        //   'all'    — the entire exterior surface (e.g. hydrostatic/external
        //              pressure; only physical with normal mode).
        const region = p.region ?? "face";
        const [dx, dy, dz] = p.direction;
        const dl = Math.hypot(dx, dy, dz);
        const hasDir = dl > 0;
        const ux = hasDir ? dx/dl : 0, uy = hasDir ? dy/dl : 0, uz = hasDir ? dz/dl : 0;
        // A direction is required to select a face/facing region and for the
        // uniform (non-normal) traction direction. 'all' + normal needs none.
        if ((region !== "all" || !p.normal) && !hasDir) continue;

        const isLoaded = selectPressureRegion(mesh.nodes, surfaceFaces, [ux, uy, uz], region);
        const nLoaded = isLoaded.reduce((s, on) => s + (on ? 1 : 0), 0);
        // Loud failure instead of a silent no-load solve (issue #157). A finite
        // non-zero pressure that selects ZERO triangles would otherwise proceed
        // with an unloaded model presented as a normal result. 'face' now
        // always returns the extreme triangle, so an empty selection here means
        // the region genuinely has no windward surface — a modelling error the
        // user must see.
        if (nLoaded === 0 && region !== "all") {
          throw new Error(
            `Pressure of ${p.magnitude} MPa (region='${region}', direction ` +
            `(${ux.toFixed(2)},${uy.toFixed(2)},${uz.toFixed(2)})) selected NO surface triangles, ` +
            `so it would apply zero load. Check the pressure direction/region against the model — ` +
            `a '${region}' region needs a surface facing that direction.`
          );
        }
        // Report the loaded area so total force = pressure × area is verifiable.
        let loadedAreaMm2 = 0;
        for (let t = 0; t < isLoaded.length; t++) {
          if (!isLoaded[t]) continue;
          const a = surfaceFaces[t*3] ?? 0, b = surfaceFaces[t*3+1] ?? 0, c = surfaceFaces[t*3+2] ?? 0;
          const ax = mesh.nodes[a*3]??0, ay = mesh.nodes[a*3+1]??0, az = mesh.nodes[a*3+2]??0;
          const bx = mesh.nodes[b*3]??0, by = mesh.nodes[b*3+1]??0, bz = mesh.nodes[b*3+2]??0;
          const cx = mesh.nodes[c*3]??0, cy = mesh.nodes[c*3+1]??0, cz = mesh.nodes[c*3+2]??0;
          const nx = (by-ay)*(cz-az)-(bz-az)*(cy-ay);
          const ny = (bz-az)*(cx-ax)-(bx-ax)*(cz-az);
          const nz = (bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
          loadedAreaMm2 += 0.5 * Math.hypot(nx, ny, nz);
        }
        // A positive pressure pushes INWARD on the selected face (compression) —
        // the intuitive "pressure on this face" and the compressive pre-stress
        // buckling needs. Negative magnitude → outward (tension).
        //   Uniform: the selected face's outward normal points along +d, so an
        //   inward push is −magnitude·d.
        //   Normal:  each loaded triangle uses its own outward normal n̂, so the
        //   inward push is −magnitude·n̂ per triangle (physical on curved faces).
        const pf = p.normal
          ? assembleSurfaceTractionNormal(mesh, surfaceFaces, isLoaded, -p.magnitude)
          : assembleSurfaceTraction(mesh, surfaceFaces, isLoaded,
              [-p.magnitude*ux, -p.magnitude*uy, -p.magnitude*uz]);
        let resN = 0;
        for (let n = 0; n < mesh.nodeCount; n++) {
          const fx = pf[n*3]??0, fy = pf[n*3+1]??0, fz = pf[n*3+2]??0;
          if (fx !== 0 || fy !== 0 || fz !== 0) {
            solverForces.push({ nodeIndex: n, forceN: [fx, fy, fz] });
            resN += Math.hypot(fx, fy, fz);
          }
        }
        console.log(`[analysis] pressure ${p.magnitude}MPa ${p.normal ? "normal-to-surface" : `in (${ux.toFixed(2)},${uy.toFixed(2)},${uz.toFixed(2)})`} region=${region}: ` +
          `${nLoaded} loaded triangles over ${loadedAreaMm2.toFixed(2)} mm², |resultant|~${resN.toFixed(2)}N`);
      }
    }
  }

  const effectiveForces = solverForces;

  // ── Rigid-body-mode check ─────────────────────────────────────────────────
  // Run before the solve since this is purely a constraint-geometry check —
  // doesn't need solve results, and catching it early means we can surface
  // a precise explanation even if CG goes on to fail to converge (which it
  // usually will, given a genuinely unresisted rigid-body mode).
  const rigidBodyMode = detectUnconstrainedRigidBodyMode(constraints, effectiveForces, mesh);
  if (rigidBodyMode) {
    console.log(`[analysis] rigid-body-mode warning: ${rigidBodyMode.message}`);
  }

  // Assembly + solve boundary — last cheap chance to bail before the expensive
  // stiffness assembly and CG solve (issue #109).
  checkAbort();
  emit({ phase: "assembly", message: "Assembling stiffness matrix…" });

  // ── Solve ──────────────────────────────────────────────────────────────────
  // K is assembled ONCE (issue #100). Modal and buckling both need K WITHOUT
  // the static Dirichlet penalties (modal applies a diagonal-scaling penalty,
  // buckling applies a fresh Dirichlet penalty), so the pipeline keeps a
  // pristine copy of K's value array; each consumer applies its own BC flavor
  // to its own copy. rowPtr/colIdx/diagIdx (the sparsity pattern) depend only
  // on mesh connectivity and are shared by K, M and Kσ.
  const wantsModal = req.analysis.analysisType === 'modal';
  const mayBuckle  = req.analysis.computeBuckling === true;

  // In-plane raster (bead-to-bead) anisotropy (feature #6, opt-in + evidence-
  // gated). Stays inert — leaving the bulk term exactly isotropic von Mises —
  // unless the user opted in AND there is real evidence: a measured cross-bead
  // ratio, or a declared unidirectional raster (typical ±45° alternating
  // rasters homogenize to isotropic, so the flag alone changes nothing).
  let inPlaneAniso: InPlaneAniso | null = null;
  if (req.analysis.inPlaneAnisotropy && criterion === "fdm-interface" && isOrthotropic(material)) {
    const measured = req.calibration?.crossBeadRatio;
    const ratio = (measured != null && measured > 0 && measured < 1)
      ? measured
      : (req.print.unidirectionalRaster ? CROSS_BEAD_RATIO_LITERATURE : null);
    if (ratio != null && ratio > 0 && ratio < 1) {
      inPlaneAniso = { rasterAngleDeg: req.print.rasterAngleDeg ?? 0, crossBeadRatio: ratio };
    }
  }

  const input: SolverInput = {
    mesh,
    material,
    ...(materialField ? { materialField } : {}),
    ...(wallBondField ? { wallBond: wallBondField } : {}),
    criterion,
    ...(inPlaneAniso ? { inPlaneAniso } : {}),
    constraints,
    forces: effectiveForces,
    keepPristineK: wantsModal || mayBuckle,
    signal: req.signal,
    onCgProgress: req.onPhase
      ? (iteration, relativeResidual) => emit({ phase: "solve", iteration, relativeResidual })
      : undefined,
  };

  emit({ phase: "solve", message: "Solving K·u = F (conjugate gradient)…" });
  const intermediate = await runLinearStaticWithK(input);
  checkAbort();
  const result: import("./solver/types.js").SolverResult = intermediate.result;

  // ── Adaptive-refinement capture (issue #149) ───────────────────────────────
  // Pure side-write: expose the solved mesh + per-element error field to the
  // adaptive driver so it can build the next size field. Undefined on every
  // normal request, so this does not touch the default path's output at all.
  if (req._captureInternals) {
    req._captureInternals.mesh          = mesh;
    req._captureInternals.errorEstimate = result.errorEstimate;
    req._captureInternals.surfaceToNode = surfaceToNode;
    req._captureInternals.surfaceFaces  = surfaceFaces;
    req._captureInternals.meshFallback  = meshFallback;
    // BC node sets, for the adaptive driver's singularity exclusion. The EDGE
    // of each of these sets is where the solution is genuinely singular.
    req._captureInternals.constrainedNodes =
      Int32Array.from(constraints.flatMap(c => c.nodeIndices));
    req._captureInternals.loadedNodes =
      Int32Array.from(solverForces.map(f => f.nodeIndex));
  }

  let modalResult: ModalAnalysisResult | undefined;

  if (wantsModal) {
    // Collect fixed node indices from constraints
    const fixedNodes: number[] = [];
    for (const cs of constraints) {
      for (const ni of cs.nodeIndices) fixedNodes.push(ni);
    }

    try {
      modalResult = await runModalAnalysis({
        mesh,
        material,
        ...(materialField ? { materialField } : {}),
        fixedNodes,
        nModes: 10,
        // Reuse the statically-assembled K (pristine values + shared pattern)
        prebuiltK: intermediate.K0data ? {
          Kdata:   intermediate.K0data,
          rowPtr:  intermediate.K.rowPtr,
          colIdx:  intermediate.K.colIdx,
          diagIdx: intermediate.diagIdx,
        } : undefined,
      });
      console.log(`[analyse] modal: ${modalResult.modes.length} modes, f1=${modalResult.modes.find(m => m.frequencyHz > 1)?.frequencyHz.toFixed(1) ?? '?'}Hz, certified=${modalResult.certified}`);
      // Surface eigensolver advisories (partial rigid modes, un-certified band,
      // non-convergence) to the caller — #160.1/.4. These are non-fatal; the
      // static result and modal frequencies are preserved either way.
      if (modalResult.warnings && modalResult.warnings.length > 0) {
        for (const w of modalResult.warnings) console.warn(`[analyse] modal warning: ${w}`);
      }
    } catch (err) {
      console.warn(`[analyse] modal solve failed (static result preserved): ${err}`);
      modalResult = undefined;
    }
  }

  // ── Linear buckling analysis ───────────────────────────────────────────────
  // Compute the Buckling Load Factor (BLF) using the pre-stress from the
  // static solve. Opt-in (req.analysis.computeBuckling) because the eigen-solve adds
  // solve time; runs for both C3D4 and C3D10 meshes. Failures are non-fatal:
  // the buckling result is marked "unchecked" rather than crashing the analysis.
  let bucklingBLF: number | undefined;
  let bucklingConverged = false;
  let bucklingTensile   = false;
  let bucklingIndeterminate = false;
  let bucklingCertified = false;
  let bucklingPositiveBLFs: number[] = [];
  let bucklingMode: Float64Array | undefined;
  if (mayBuckle && result.elemStress6) {
    try {
      // Apply BCs to a fresh copy of the pristine assembled K (issue #100 —
      // previously this re-ran the full element assembly). Falls back to
      // re-assembly if the pristine copy is unavailable.
      let Kbuck: import("./solver/types.js").CSRMatrix;
      let buckDiagIdx: Int32Array;
      if (intermediate.K0data) {
        Kbuck = {
          n:      intermediate.K.n,
          data:   intermediate.K0data.slice(),
          colIdx: intermediate.K.colIdx,
          rowPtr: intermediate.K.rowPtr,
        };
        buckDiagIdx = intermediate.diagIdx;
      } else {
        ({ K: Kbuck, diagIdx: buckDiagIdx } = await assembleK(mesh, material, 'auto', undefined, materialField));
      }
      const fDummy = assembleForceVector(mesh.nodeCount, effectiveForces);
      applyDirichletBC(Kbuck, fDummy, buckDiagIdx, constraints);

      // For C3D10, recover σ per Gauss point (issue #164) so the linear stress
      // gradient of bending members enters Kσ instead of being averaged away.
      const Ksigma = assembleKsigma(
        mesh, result.elemStress6, Kbuck.rowPtr, Kbuck.colIdx,
        mesh.nodesPerElem === 10
          ? { displacement: result.displacement, material, field: materialField ?? null }
          : undefined,
      );
      const bResult = await runLinearBuckling(Kbuck, Ksigma, buckDiagIdx);
      bucklingConverged     = bResult.converged;
      bucklingTensile       = bResult.tensileDominated;
      bucklingIndeterminate = bResult.indeterminate;
      bucklingCertified     = bResult.certified;
      bucklingPositiveBLFs  = bResult.positiveBLFs.map(v => +v.toFixed(4));
      // Do NOT surface a non-physical (indeterminate) eigenvalue as a BLF.
      if (!bResult.indeterminate) bucklingBLF = bResult.blf;
      // Keep the mode shape only when a physical positive BLF was found.
      if (!bResult.indeterminate && !bResult.tensileDominated && bResult.blf > 0) {
        bucklingMode = bResult.modeShape;
      }
      console.log(`[buckling] BLF=${bResult.blf.toFixed(3)} converged=${bResult.converged} certified=${bResult.certified} iters=${bResult.iterations} tensile=${bResult.tensileDominated} indeterminate=${bResult.indeterminate} modes=[${bucklingPositiveBLFs.join(', ')}]`);
    } catch (err) {
      console.warn(`[buckling] Analysis failed (non-fatal): ${err}`);
    }
  }

  // ── SPR-smoothed nodal stress ──────────────────────────────────────────────
  // Use Superconvergent Patch Recovery for more accurate nodal stress values,
  // especially at stress concentrations near holes.
  // Falls back to direct averaging for under-determined patches (<4 elements).
  // Reference: Zienkiewicz & Zhu (1992) Int J Numer Methods Eng 33(7).
  emit({ phase: "recovery", message: "Recovering nodal stress (SPR)…" });
  // ── Nodal stress: recover the TENSOR, then project (issue #258) ─────────────
  // The displayed heatmap and the nodal utilization field used to be recovered
  // from ONE centroid sample per element. At a convex model corner such a patch
  // can hold fewer points than a 3-D fit has unknowns, so it degraded to plain
  // averaging — and averaging over a one-sided patch is biased by O(h·|grad s|)
  // even when the FE solution is exact. Measured in docs/spr-gauss-point-handoff.md:
  // 6 of 343 corner patches rank-deficient on a structured box, 28 of 792 on a
  // TetGen cylinder; zero under Gauss sampling. Those same patches feed the
  // heatmap.
  //
  // The scalar is now a PROJECTION of the recovered tensor, not a second
  // independently-recovered field. Von Mises is a nonlinear functional of sigma,
  // so recovering it directly is a different operation with no superconvergence
  // behind it — and, being convex, it sits at or ABOVE the von Mises of the
  // recovered tensor by Jensen, biasing the peak in exactly the direction this
  // work exists to remove. Decision recorded in the handoff doc.
  //
  // Consequence worth naming: heatmap and ZZ estimator are now the SAME
  // recovered field. They used to be two independent recoveries of one physical
  // field, free to disagree — the estimator could improve while the picture the
  // user reads did not.
  //
  // The solver already recovered this exact field — the ZZ error estimate is
  // computed against it, from the same mesh, displacement, material and
  // material field — so it comes back on the result rather than being recovered
  // again here. That second recovery cost as much as the entire ZZ stage
  // (measured 755 ms on a 24.6k-element C3D10 mesh: 425 ms rebuilding the Gauss
  // samples, 330 ms re-solving the patches). The `??` branch is the fallback for
  // a result built with the error estimate switched off.
  _snapAnalysis("before sprSmoothedStress");
  const nodeStress6 = result.nodeStress6
    ?? (result.elemStress6
      ? sprSmoothedStress6(mesh, result.elemStress6, buildGaussSamples(
          mesh, result.displacement, material, materialField ?? undefined,
        ))
      : null);
  // C3D4 takes this same projection: buildGaussSamples returns null for linear
  // elements, so their RECOVERY is unchanged (constant element stress, centroid
  // is the correct single sample) — but the projection is what gets displayed,
  // so C3D4 heatmap values did move. Measured against a manufactured field they
  // moved neither toward nor away from truth (worst nodal error identical to the
  // legacy path at 20%/15%/10% over three densities); the reason to take it here
  // is one recovered field everywhere, not accuracy. See the handoff doc.
  //
  // sprSmoothedStress below is therefore unreachable on any result the pipeline
  // builds. It stays as the honest fallback for a result carrying neither a
  // nodal nor an element tensor.
  const nodeStress = nodeStress6
    ? (() => {
        const vm = new Float64Array(mesh.nodeCount);
        for (let n = 0; n < mesh.nodeCount; n++) {
          vm[n] = vonMisesFromTensor6(
            nodeStress6[n*6]   ?? 0, nodeStress6[n*6+1] ?? 0, nodeStress6[n*6+2] ?? 0,
            nodeStress6[n*6+3] ?? 0, nodeStress6[n*6+4] ?? 0, nodeStress6[n*6+5] ?? 0,
          );
        }
        return vm;
      })()
    : sprSmoothedStress(mesh, result.vonMises);
  _snapAnalysis("after sprSmoothedStress");

  // ── SPR-smoothed nodal stress tensor + anisotropic utilization ratios ────────
  // U_XY = sqrt(σxx²+σyy²-σxx·σyy+3·σxy²) / yieldXY  (in-plane von Mises / yieldXY)
  // U_Z  = interlayer interface utilization (tension-only ⟨σzz⟩₊/S_zt ⊕
  //        τ_z/S_zs quadratic interaction; friction-reduced shear under
  //        compression — see computeUtilizationRatios / audit A3)
  const orthoMatU = isOrthotropic(material)
    ? (material as import("./solver/types.js").OrthotropicMaterial)
    : null;
  const utilYieldXY = orthoMatU ? orthoMatU.yieldXY : effectiveYield;
  const utilYieldZ  = orthoMatU ? orthoMatU.yieldZ  : effectiveYield;
  const utilYieldZS = orthoMatU
    ? interlaminarShearOf(orthoMatU)
    : effectiveYield * INTERSHEAR_OVER_YIELDZ_DEFAULT;
  // U_XY / U_Z are defined in the material frame (weak axis = local Z). For a
  // rotated weak axis (upright/angled, issue #101) rotate the nodal stress into
  // that frame first; null for the common weak-along-Z case.
  const utilR = (orthoMatU && orthoMatU.weakAxis
    && Math.hypot(...orthoMatU.weakAxis) > 0
    && (orthoMatU.weakAxis[2] / (Math.hypot(...orthoMatU.weakAxis) || 1)) < 1 - 1e-12)
    ? rotationAligningZTo(orthoMatU.weakAxis) : null;

  // Two-region field: per-node yields — the volume-weighted average of the
  // adjacent elements' bin yields, mirroring how the nodal stress itself is a
  // patch average (SPR). One scatter pass over elements, no adjacency needed.
  let nodeYieldXY: Float64Array | null = null;
  let nodeYieldZ:  Float64Array | null = null;
  let nodeYieldZS: Float64Array | null = null;
  if (materialField && nodeStress6) {
    nodeYieldXY = new Float64Array(mesh.nodeCount);
    nodeYieldZ  = new Float64Array(mesh.nodeCount);
    nodeYieldZS = new Float64Array(mesh.nodeCount);
    const nodeVolSum = new Float64Array(mesh.nodeCount);
    const npeY = mesh.nodesPerElem;
    for (let e = 0; e < mesh.elementCount; e++) {
      const bin = materialField.binOfElement[e] ?? 0;
      const yXY = materialField.yieldXY[bin] ?? utilYieldXY;
      const yZ  = materialField.yieldZ[bin]  ?? utilYieldZ;
      const yZS = materialField.yieldZShear[bin] ?? utilYieldZS;
      const base = e * npeY;
      const V = computeGeometry(
        mesh.nodes,
        mesh.elements[base] ?? 0, mesh.elements[base + 1] ?? 0,
        mesh.elements[base + 2] ?? 0, mesh.elements[base + 3] ?? 0,
      ).V;
      for (let k = 0; k < npeY; k++) {
        const n = mesh.elements[base + k] ?? 0;
        nodeYieldXY[n] = (nodeYieldXY[n] ?? 0) + yXY * V;
        nodeYieldZ[n]  = (nodeYieldZ[n]  ?? 0) + yZ * V;
        nodeYieldZS[n] = (nodeYieldZS[n] ?? 0) + yZS * V;
        nodeVolSum[n]  = (nodeVolSum[n]  ?? 0) + V;
      }
    }
    for (let n = 0; n < mesh.nodeCount; n++) {
      const w = nodeVolSum[n] ?? 0;
      if (w > 0) {
        nodeYieldXY[n] = (nodeYieldXY[n] ?? 0) / w;
        nodeYieldZ[n]  = (nodeYieldZ[n]  ?? 0) / w;
        nodeYieldZS[n] = (nodeYieldZS[n] ?? 0) / w;
      } else {
        nodeYieldXY[n] = utilYieldXY;
        nodeYieldZ[n]  = utilYieldZ;
        nodeYieldZS[n] = utilYieldZS;
      }
    }
  }

  // ── Shell/core classification as a displayable field (issue #297) ──────────
  // The two-region split is otherwise invisible: the results text reports a
  // shell VOLUME FRACTION for the whole part, so a user cannot see where the
  // walls are, cannot see the core, and cannot tell a 2-wall part from a
  // 5-wall one except as a different scalar. This projects the per-element
  // classification the solver actually used onto nodes so it can be painted.
  //
  // Volume-weighted, not a plain incidence count: elements meeting at a node
  // differ in size, and an unweighted mean would let a cluster of small
  // elements outvote the large one that carries the material. Weighting by
  // element volume makes the nodal value the same quantity the volume
  // fractions in `materialModel` report, so the picture and the number agree.
  //
  // Feeds the VOLUME payload only (`volumeField.nodeShellFractionB64`), never
  // the display mesh. A part's boundary is wall by construction — every
  // boundary node sits at distance 0 from the surface, inside the wall band —
  // so the same field on the display mesh is identically 1.0 on every part and
  // shows nothing. Measured, not assumed: on the 24x12x6 fixture the surface
  // field came back min 1.0 / max 1.0 against a 50.6% shell volume fraction.
  // The split is an INTERIOR property and the section cut is the only place it
  // can be seen.
  //
  // Null when the field is absent (flag off, or degraded), so the client can
  // hide the view rather than painting a constant that would imply it ran.
  let nodeShellFrac: Float64Array | null = null;
  if (materialField) {
    const acc = new Float64Array(mesh.nodeCount);
    const wgt = new Float64Array(mesh.nodeCount);
    const npe = mesh.nodesPerElem ?? 4;
    for (let e = 0; e < mesh.elementCount; e++) {
      const bin = materialField.binOfElement[e] ?? 0;
      const f   = materialField.shellFrac[bin] ?? 0;
      // Corner volume is the right weight for C3D10 too: the midside nodes sit
      // on the same element and share its material, so the straight-edged
      // corner volume is the element's weight regardless of order.
      const vol = tetCornerVolume(mesh, e);
      if (!(vol > 0)) continue;
      for (let k = 0; k < npe; k++) {
        const n = mesh.elements[e * npe + k] ?? 0;
        acc[n] = (acc[n] ?? 0) + f * vol;
        wgt[n] = (wgt[n] ?? 0) + vol;
      }
    }
    nodeShellFrac = new Float64Array(mesh.nodeCount);
    for (let n = 0; n < mesh.nodeCount; n++) {
      const w = wgt[n] ?? 0;
      nodeShellFrac[n] = w > 0 ? (acc[n] ?? 0) / w : 0;
    }
  }

  const nodeUtilXY = nodeStress6 ? new Float64Array(mesh.nodeCount) : null;
  const nodeUtilZ  = nodeStress6 ? new Float64Array(mesh.nodeCount) : null;
  const nodeSignedStress = new Float64Array(mesh.nodeCount);
  if (nodeStress6 && nodeUtilXY && nodeUtilZ) {
    for (let n = 0; n < mesh.nodeCount; n++) {
      let sxx = nodeStress6[n*6]   ?? 0;
      let syy = nodeStress6[n*6+1] ?? 0;
      let szz = nodeStress6[n*6+2] ?? 0;
      let txy = nodeStress6[n*6+3] ?? 0;
      let tyz = nodeStress6[n*6+4] ?? 0;
      let txz = nodeStress6[n*6+5] ?? 0;
      if (utilR) {
        const L = rotateStress6ToLocal([sxx, syy, szz, txy, tyz, txz], utilR);
        sxx = L[0]; syy = L[1]; szz = L[2]; txy = L[3]; tyz = L[4]; txz = L[5];
      }
      const util = computeUtilizationRatios(
        sxx, syy, szz, txy, tyz, txz,
        nodeYieldXY ? (nodeYieldXY[n] ?? utilYieldXY) : utilYieldXY,
        nodeYieldZ  ? (nodeYieldZ[n]  ?? utilYieldZ)  : utilYieldZ,
        nodeYieldZS ? (nodeYieldZS[n] ?? utilYieldZS) : utilYieldZS,
      );
      nodeUtilXY[n] = util.uXY;
      nodeUtilZ[n]  = util.uZ;
      const hydro = sxx + syy + szz;
      nodeSignedStress[n] = (hydro >= 0 ? 1 : -1) * (nodeStress[n] ?? 0);
    }
  } else {
    // No tensor available: fall back to unsigned VM
    for (let n = 0; n < mesh.nodeCount; n++) {
      nodeSignedStress[n] = nodeStress[n] ?? 0;
    }
  }

  // ── Map stress back to surface vertices ────────────────────────────────────
  emit({ phase: "mapping", message: "Mapping stress to surface…" });
  // Vertex count must match the CLIENT's display mesh (req.positions /
  // req.triangleCount), not the server's internal analysis mesh — the
  // client's mesh3d geometry (and its color attribute buffer) was built
  // from the upload-time positions, which can have a different vertex
  // count than the analysis-time Gmsh mesh (different clMin/clMax
  // settings: 0.5/4.0 for upload preview vs 0.3/3.0 for analysis). Sizing
  // vertexStress to the wrong mesh previously caused the client's
  // `cols.set(colors)` to throw "RangeError: offset is out of bounds"
  // whenever the two meshes' vertex counts didn't happen to match.
  const vertCount = req.triangleCount * 3;

  const vertexStress        = new Float32Array(vertCount);
  const vertexSignedVonMises = new Float32Array(vertCount);
  const vertexXyUtil  = nodeUtilXY ? new Float32Array(vertCount) : null;
  const vertexZUtil   = nodeUtilZ  ? new Float32Array(vertCount) : null;

  // ── Shared 3D nearest-neighbour stress mapping ───────────────────────────────
  // Both STL and STEP paths use the same algorithm:
  //   For each surface vertex, find FEA nodes within R3D mm in 3D space.
  //   Assign the NEAREST node's stress (not max, not average).
  //
  // Why nearest, not max:
  //   Taking the max within a radius pulls toward interior hot-spots that project
  //   onto the surface from behind, causing two adjacent surface vertices to get
  //   very different values (one happens to be near a hot node, the other not).
  //   Nearest-node is spatially coherent: adjacent surface vertices map to
  //   adjacent FEA nodes, so the stress field varies smoothly across the surface.
  //
  // The client-side Gouraud smoothing (weld + group average) then interpolates
  //   colors across shared vertices, giving the final smooth gradient.
  //
  // R3D = 3mm: large enough to always find a node for typical mesh densities,
  //   small enough not to reach across features. Fallback: global nearest if none found.

  const R3D   = 3.0;
  const CELL3 = R3D;

  // Build 3D grid from FEA nodes
  let nxMin=Infinity,nxMax=-Infinity,nyMin=Infinity,nyMax=-Infinity,nzMin=Infinity,nzMax=-Infinity;
  for (let n=0;n<mesh.nodeCount;n++){
    const x=mesh.nodes[n*3]??0,y=mesh.nodes[n*3+1]??0,z=mesh.nodes[n*3+2]??0;
    if(x<nxMin)nxMin=x; if(x>nxMax)nxMax=x;
    if(y<nyMin)nyMin=y; if(y>nyMax)nyMax=y;
    if(z<nzMin)nzMin=z; if(z>nzMax)nzMax=z;
  }
  const gW3 = Math.ceil((nxMax-nxMin)/CELL3)+1;
  const gH3 = Math.ceil((nyMax-nyMin)/CELL3)+1;
  const gD3 = Math.ceil((nzMax-nzMin)/CELL3)+1;
  const grid3 = new Map<number, number[]>();
  for (let n=0;n<mesh.nodeCount;n++){
    const ci=Math.floor(((mesh.nodes[n*3]??0)-nxMin)/CELL3);
    const cj=Math.floor(((mesh.nodes[n*3+1]??0)-nyMin)/CELL3);
    const ck=Math.floor(((mesh.nodes[n*3+2]??0)-nzMin)/CELL3);
    const key=ci*gH3*gD3+cj*gD3+ck;
    let cell=grid3.get(key); if(!cell){cell=[];grid3.set(key,cell);}
    cell.push(n);
  }

  // Helper: find nearest FEA node to a surface vertex position
  function nearestNodeStress(vx:number,vy:number,vz:number): number {
    const ci=Math.floor((vx-nxMin)/CELL3);
    const cj=Math.floor((vy-nyMin)/CELL3);
    const ck=Math.floor((vz-nzMin)/CELL3);
    let bestDist2=Infinity, bestS=0;
    const R2=R3D*R3D;
    for(let di=-1;di<=1;di++) for(let dj=-1;dj<=1;dj++) for(let dk=-1;dk<=1;dk++){
      const ni2=ci+di,nj2=cj+dj,nk2=ck+dk;
      if(ni2<0||ni2>=gW3||nj2<0||nj2>=gH3||nk2<0||nk2>=gD3) continue;
      const cell=grid3.get(ni2*gH3*gD3+nj2*gD3+nk2);
      if(!cell) continue;
      for(const n of cell){
        const dx=(mesh.nodes[n*3]??0)-vx,dy=(mesh.nodes[n*3+1]??0)-vy,dz=(mesh.nodes[n*3+2]??0)-vz;
        const d2=dx*dx+dy*dy+dz*dz;
        if(d2<R2 && d2<bestDist2){bestDist2=d2; bestS=nodeStress[n]??0;}
      }
    }
    if(bestDist2===Infinity){
      // Fallback: global linear scan for the truly nearest node
      for(let n=0;n<mesh.nodeCount;n++){
        const dx=(mesh.nodes[n*3]??0)-vx,dy=(mesh.nodes[n*3+1]??0)-vy,dz=(mesh.nodes[n*3+2]??0)-vz;
        const d2=dx*dx+dy*dy+dz*dz;
        if(d2<bestDist2){bestDist2=d2; bestS=nodeStress[n]??0;}
      }
    }
    return bestS;
  }

  // Helper: find nearest node index (reused for utilization lookups)
  function nearestNodeIdx2(vx:number, vy:number, vz:number): number {
    const ci=Math.floor((vx-nxMin)/CELL3);
    const cj=Math.floor((vy-nyMin)/CELL3);
    const ck=Math.floor((vz-nzMin)/CELL3);
    let bestDist2=Infinity, bestN=0;
    const R2=R3D*R3D;
    for(let di=-1;di<=1;di++) for(let dj=-1;dj<=1;dj++) for(let dk=-1;dk<=1;dk++){
      const ni2=ci+di,nj2=cj+dj,nk2=ck+dk;
      if(ni2<0||ni2>=gW3||nj2<0||nj2>=gH3||nk2<0||nk2>=gD3) continue;
      const cell=grid3.get(ni2*gH3*gD3+nj2*gD3+nk2);
      if(!cell) continue;
      for(const n of cell){
        const dx=(mesh.nodes[n*3]??0)-vx,dy=(mesh.nodes[n*3+1]??0)-vy,dz=(mesh.nodes[n*3+2]??0)-vz;
        const d2=dx*dx+dy*dy+dz*dz;
        if(d2<R2 && d2<bestDist2){bestDist2=d2; bestN=n;}
      }
    }
    if(bestDist2===Infinity){
      for(let n=0;n<mesh.nodeCount;n++){
        const dx=(mesh.nodes[n*3]??0)-vx,dy=(mesh.nodes[n*3+1]??0)-vy,dz=(mesh.nodes[n*3+2]??0)-vz;
        const d2=dx*dx+dy*dy+dz*dz;
        if(d2<bestDist2){bestDist2=d2; bestN=n;}
      }
    }
    return bestN;
  }

  // Map every display-mesh surface vertex (req.positions — the same
  // geometry the client's mesh3d was built from) to its nearest FEA node's
  // stress. This is correct for both STL and STEP: nearestNodeStress() is a
  // pure spatial lookup against the analysis mesh's nodes, so it doesn't
  // matter that the analysis mesh itself (mesh.nodes) may have a different
  // resolution/vertex count than the display mesh being queried here.
  for (let v = 0; v < vertCount; v++) {
    const vx = req.positions[v*3]   ?? 0;
    const vy = req.positions[v*3+1] ?? 0;
    const vz = req.positions[v*3+2] ?? 0;
    vertexStress[v] = nearestNodeStress(vx, vy, vz);
    const nIdx = nearestNodeIdx2(vx, vy, vz);
    vertexSignedVonMises[v] = nodeSignedStress[nIdx] ?? 0;
    if (vertexXyUtil && vertexZUtil) {
      vertexXyUtil[v] = nodeUtilXY![nIdx] ?? 0;
      vertexZUtil[v]  = nodeUtilZ![nIdx]  ?? 0;
    }
  }

  // Validate vertex stress array (catch regressions in mesh-vertex count mismatch)
  if (vertexStress.length !== vertCount) {
    throw new Error(
      `[analysis] Vertex stress array size mismatch: ${vertexStress.length} ` +
      `vertices but expected ${vertCount} (req.triangleCount=${req.triangleCount} * 3). ` +
      `Check that vertCount is derived from req.triangleCount, not gmshResult.surfaceTriangles.length.`
    );
  }

  // ── Principal stress vertex mapping ───────────────────────────────────────
  // Map σ1, σ2, σ3 (all three principal stresses) per node to the display mesh.
  const nodePrincipal = result.nodePrincipalStress;
  const vertexPrincipalStress  = new Float32Array(vertCount);
  const vertexPrincipalStress2 = new Float32Array(vertCount);
  const vertexPrincipalStress3 = new Float32Array(vertCount);
  if (nodePrincipal) {
    const np: Float64Array = nodePrincipal;
    // Returns [bestN] index of nearest node, or -1 if not found within grid radius
    function nearestNodeIdx(vx: number, vy: number, vz: number): number {
      const ci=Math.floor((vx-nxMin)/CELL3);
      const cj=Math.floor((vy-nyMin)/CELL3);
      const ck=Math.floor((vz-nzMin)/CELL3);
      let bestDist2=Infinity, bestN=-1;
      const R2=R3D*R3D;
      for(let di=-1;di<=1;di++) for(let dj=-1;dj<=1;dj++) for(let dk=-1;dk<=1;dk++){
        const ni2=ci+di,nj2=cj+dj,nk2=ck+dk;
        if(ni2<0||ni2>=gW3||nj2<0||nj2>=gH3||nk2<0||nk2>=gD3) continue;
        const cell=grid3.get(ni2*gH3*gD3+nj2*gD3+nk2);
        if(!cell) continue;
        for(const n of cell){
          const dx=(mesh.nodes[n*3]??0)-vx,dy=(mesh.nodes[n*3+1]??0)-vy,dz=(mesh.nodes[n*3+2]??0)-vz;
          const d2=dx*dx+dy*dy+dz*dz;
          if(d2<R2 && d2<bestDist2){bestDist2=d2; bestN=n;}
        }
      }
      if(bestN<0){
        for(let n=0;n<mesh.nodeCount;n++){
          const dx=(mesh.nodes[n*3]??0)-vx,dy=(mesh.nodes[n*3+1]??0)-vy,dz=(mesh.nodes[n*3+2]??0)-vz;
          const d2=dx*dx+dy*dy+dz*dz;
          if(d2<bestDist2){bestDist2=d2; bestN=n;}
        }
      }
      return bestN;
    }
    for (let v = 0; v < vertCount; v++) {
      const n = nearestNodeIdx(req.positions[v*3] ?? 0, req.positions[v*3+1] ?? 0, req.positions[v*3+2] ?? 0);
      if (n >= 0) {
        vertexPrincipalStress[v]  = np[n*3]   ?? 0;
        vertexPrincipalStress2[v] = np[n*3+1] ?? 0;
        vertexPrincipalStress3[v] = np[n*3+2] ?? 0;
      }
    }
  }

  // ── Error estimate vertex mapping ────────────────────────────────────────────
  // Map element-level error estimates to surface vertices. Uses a node→element
  // adjacency list built once per mesh (issue #104 — the previous inline
  // implementation scanned ALL elements per nearby node per vertex,
  // O(V × nodes × elements), which was ~98% of analysis wall time).
  _snapAnalysis("before error-estimate mapping");
  const vertexErrorEstimate = result.errorEstimate
    ? mapErrorEstimateToVertices(mesh, result.errorEstimate, req.positions, vertCount)
    : undefined;
  _snapAnalysis("after error-estimate mapping");

  // ── Nodal displacement vertex mapping ───────────────────────────────────────
  // Map nodal displacements (ux, uy, uz) to surface vertices.
  // Each surface vertex gets the displacement of its nearest FEA node.
  // Layout: [ux0, uy0, uz0, ux1, uy1, uz1, ...] with length = vertCount * 3
  const vertexDisplacement = new Float32Array(vertCount * 3);
  const disp = result.displacement;

  function nearestNodeDisplacement(vx: number, vy: number, vz: number): [number, number, number] {
    const ci=Math.floor((vx-nxMin)/CELL3);
    const cj=Math.floor((vy-nyMin)/CELL3);
    const ck=Math.floor((vz-nzMin)/CELL3);
    let bestDist2=Infinity, bestN=-1;
    const R2=R3D*R3D;
    for(let di=-1;di<=1;di++) for(let dj=-1;dj<=1;dj++) for(let dk=-1;dk<=1;dk++){
      const ni2=ci+di,nj2=cj+dj,nk2=ck+dk;
      if(ni2<0||ni2>=gW3||nj2<0||nj2>=gH3||nk2<0||nk2>=gD3) continue;
      const cell=grid3.get(ni2*gH3*gD3+nj2*gD3+nk2);
      if(!cell) continue;
      for(const n of cell){
        const dx=(mesh.nodes[n*3]??0)-vx,dy=(mesh.nodes[n*3+1]??0)-vy,dz=(mesh.nodes[n*3+2]??0)-vz;
        const d2=dx*dx+dy*dy+dz*dz;
        if(d2<R2 && d2<bestDist2){bestDist2=d2; bestN=n;}
      }
    }
    if(bestN<0){
      // Fallback: global linear scan for the truly nearest node
      for(let n=0;n<mesh.nodeCount;n++){
        const dx=(mesh.nodes[n*3]??0)-vx,dy=(mesh.nodes[n*3+1]??0)-vy,dz=(mesh.nodes[n*3+2]??0)-vz;
        const d2=dx*dx+dy*dy+dz*dz;
        if(d2<bestDist2){bestDist2=d2; bestN=n;}
      }
    }
    return bestN >= 0 ? [
      disp[bestN*3]??0,
      disp[bestN*3+1]??0,
      disp[bestN*3+2]??0
    ] : [0, 0, 0];
  }

  for (let v = 0; v < vertCount; v++) {
    const [ux, uy, uz] = nearestNodeDisplacement(
      req.positions[v*3] ?? 0, req.positions[v*3+1] ?? 0, req.positions[v*3+2] ?? 0
    );
    vertexDisplacement[v*3]   = ux;
    vertexDisplacement[v*3+1] = uy;
    vertexDisplacement[v*3+2] = uz;
  }

  // ── Modal mode shape projection to surface vertices ─────────────────────────
  // Reuse the same nearestNode spatial grid to map each mode shape to surface vertices.
  let vertexModeShapesB64: string[] | undefined;
  if (modalResult && modalResult.modes.length > 0) {
    vertexModeShapesB64 = [];
    for (const mode of modalResult.modes) {
      const modeShape = mode.modeShape;
      const vertMode = new Float32Array(vertCount * 3);
      for (let v = 0; v < vertCount; v++) {
        const vx = req.positions[v*3] ?? 0;
        const vy = req.positions[v*3+1] ?? 0;
        const vz = req.positions[v*3+2] ?? 0;
        // Find nearest node using the same grid as displacement
        const ci = Math.floor((vx-nxMin)/CELL3);
        const cj = Math.floor((vy-nyMin)/CELL3);
        const ck = Math.floor((vz-nzMin)/CELL3);
        let bestDist2 = Infinity, bestN = -1;
        const R2 = R3D * R3D;
        for (let di=-1;di<=1;di++) for (let dj=-1;dj<=1;dj++) for (let dk=-1;dk<=1;dk++) {
          const ni2=ci+di, nj2=cj+dj, nk2=ck+dk;
          if (ni2<0||ni2>=gW3||nj2<0||nj2>=gH3||nk2<0||nk2>=gD3) continue;
          const cell = grid3.get(ni2*gH3*gD3+nj2*gD3+nk2);
          if (!cell) continue;
          for (const n of cell) {
            const ddx=(mesh.nodes[n*3]??0)-vx, ddy=(mesh.nodes[n*3+1]??0)-vy, ddz=(mesh.nodes[n*3+2]??0)-vz;
            const d2=ddx*ddx+ddy*ddy+ddz*ddz;
            if (d2<R2 && d2<bestDist2) { bestDist2=d2; bestN=n; }
          }
        }
        if (bestN < 0) {
          for (let n=0; n<mesh.nodeCount; n++) {
            const ddx=(mesh.nodes[n*3]??0)-vx, ddy=(mesh.nodes[n*3+1]??0)-vy, ddz=(mesh.nodes[n*3+2]??0)-vz;
            const d2=ddx*ddx+ddy*ddy+ddz*ddz;
            if (d2<bestDist2) { bestDist2=d2; bestN=n; }
          }
        }
        if (bestN >= 0) {
          vertMode[v*3]   = modeShape[bestN*3] ?? 0;
          vertMode[v*3+1] = modeShape[bestN*3+1] ?? 0;
          vertMode[v*3+2] = modeShape[bestN*3+2] ?? 0;
        }
      }
      vertexModeShapesB64.push(Buffer.from(vertMode.buffer).toString("base64"));
    }
  }

  // ── Buckling mode shape projection to surface vertices ──────────────────────
  // Same nearest-node grid mapping as the modal shapes, for the single buckling
  // eigenvector (present only when a physical positive BLF was found).
  let vertexBucklingModeB64: string | undefined;
  if (bucklingMode) {
    const vertMode = new Float32Array(vertCount * 3);
    const R2 = R3D * R3D;
    for (let v = 0; v < vertCount; v++) {
      const vx = req.positions[v*3] ?? 0;
      const vy = req.positions[v*3+1] ?? 0;
      const vz = req.positions[v*3+2] ?? 0;
      const ci = Math.floor((vx-nxMin)/CELL3);
      const cj = Math.floor((vy-nyMin)/CELL3);
      const ck = Math.floor((vz-nzMin)/CELL3);
      let bestDist2 = Infinity, bestN = -1;
      for (let di=-1;di<=1;di++) for (let dj=-1;dj<=1;dj++) for (let dk=-1;dk<=1;dk++) {
        const ni2=ci+di, nj2=cj+dj, nk2=ck+dk;
        if (ni2<0||ni2>=gW3||nj2<0||nj2>=gH3||nk2<0||nk2>=gD3) continue;
        const cell = grid3.get(ni2*gH3*gD3+nj2*gD3+nk2);
        if (!cell) continue;
        for (const n of cell) {
          const ddx=(mesh.nodes[n*3]??0)-vx, ddy=(mesh.nodes[n*3+1]??0)-vy, ddz=(mesh.nodes[n*3+2]??0)-vz;
          const d2=ddx*ddx+ddy*ddy+ddz*ddz;
          if (d2<R2 && d2<bestDist2) { bestDist2=d2; bestN=n; }
        }
      }
      if (bestN < 0) {
        for (let n=0; n<mesh.nodeCount; n++) {
          const ddx=(mesh.nodes[n*3]??0)-vx, ddy=(mesh.nodes[n*3+1]??0)-vy, ddz=(mesh.nodes[n*3+2]??0)-vz;
          const d2=ddx*ddx+ddy*ddy+ddz*ddz;
          if (d2<bestDist2) { bestDist2=d2; bestN=n; }
        }
      }
      if (bestN >= 0) {
        vertMode[v*3]   = bucklingMode[bestN*3] ?? 0;
        vertMode[v*3+1] = bucklingMode[bestN*3+1] ?? 0;
        vertMode[v*3+2] = bucklingMode[bestN*3+2] ?? 0;
      }
    }
    vertexBucklingModeB64 = Buffer.from(vertMode.buffer).toString("base64");
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const maxVM = result.maxVonMisesMPa;
  // BULK-YIELD SF (issue #97): the solver's per-element criterion minimum SF —
  // uses the calibrated, anisotropic yield of the material actually solved.
  // The von Mises SF is kept alongside for display/comparison.
  //
  // NOTE (issue #278): this is NOT the headline `summary.safetyFactor` any more.
  // It is the FEM bulk-yield mode only; the headline is the GOVERNING SF —
  // the minimum over this and every checked analytic failure mode — computed
  // further down as `lowestSF` and reported alongside this one as
  // `summary.bulkSafetyFactor`.
  const bulk = computeBulkSF({
    minSafetyFactor:   result.minSafetyFactor,
    maxVonMisesMPa:    maxVM,
    effectiveYieldMPa: effectiveYield,
    material,
    criterionUsed:     criterion,
  });
  const sf         = bulk.sf;
  const sfVonMises = bulk.vonMisesSF;

  // Scalar in-plane yield of the material actually solved (includes coupon
  // calibration and CLT adjustments). The analytic hole checks below must use
  // this, not the literature-only effectiveYield (issue #97).
  const solvedYieldXY = isOrthotropicLike(material) ? material.yieldXY : effectiveYield;

  // Estimate failure force: linear scaling from applied loads.
  // This is the BULK-YIELD fail force. The headline `estimatedFailForce` is
  // derived from the governing SF further down (issue #278); this one stays in
  // the payload as `bulkFailForceN` so the bulk number is disclosed, not hidden.
  const totalAppliedForce = req.forces.reduce((sum, f) => sum + f.magnitude, 0) || 1;
  const bulkFailForceN = totalAppliedForce * sf;

  // Yielding per the same criterion that produced the BULK SF. Deliberately
  // stays bulk-only (issue #278): it answers "does the material itself yield",
  // which is a different question from "does the part fail" — an analytic mode
  // such as thread strip-out or shear-out can govern the part without the bulk
  // material reaching yield. The governing answer is `verdict` / `safetyFactor`.
  const yielding = sf < 1.0;

  const solverMs = Date.now() - t0;

  // ── Classify holes and run failure mode checks ────────────────────────────
  const plateThickness = req.bounds.maxZ - req.bounds.minZ;
  // Use XY dimensions for hole size checks — thickness is irrelevant for oversized detection
  const plateDimMin    = Math.min(
    req.bounds.maxX - req.bounds.minX,
    req.bounds.maxY - req.bounds.minY,
  );
  const totalForce2 = req.forces.reduce((s,f) => s + f.magnitude, 0) || 1;

  const holeClassifications: HoleClassification[] = [];
  const allFailureModes: FailureModeResult[] = [];

  // Classify each bolted hole and check failure modes
  const boltedHolesList = req.holes.filter(h => req.boltHoleIds.includes(h.id));

  // If no holes from request, use gmsh-detected holes
  const holesForClassification = boltedHolesList.length > 0
    ? boltedHolesList
    : Array.from(gmshResult?.holeWallNodes.keys() ?? []).map(id => ({
        id, radius: 1.5, centre: [0,0,0] as [number,number,number],
        normal: [0,0,1] as [number,number,number],
        confidence:1, edgeCount:0, rmsError:0, maxDeviation:0,
      }));

  // Apply user override if provided
  function applyHoleOverride(
    cls:      HoleClassification,
    override: string | undefined,
  ): HoleClassification {
    if (!override) return cls;

    // Parse override string like "M3_clearance", "M3_tapped", "no4_clearance"
    const parts    = override.split('_');
    const boltKey  = parts[0]!;    // "M3", "M2.5", "no4", etc.
    const typeHint = parts[1]!;    // "clearance" or "tapped"

    // Find matching bolt size
    const boltLabel = boltKey.startsWith('no')
      ? '#' + boltKey.slice(2).replace(/(\d+)(\d{2})$/, '$1-$2')  // "no4" → "#4-40" approx
      : boltKey;  // "M3" → "M3"

    const bolt = BOLT_SIZES.find(b =>
      b.label.toLowerCase().startsWith(boltLabel.toLowerCase())
    ) ?? cls.bolt;

    const type: HoleType = typeHint === 'tapped' ? 'tapped_75' : 'clearance_close';
    const minorDiamMm = (type === 'tapped_75' && bolt)
      ? bolt.nominalMm - bolt.pitch : undefined;

    return {
      ...cls,
      bolt,
      type,
      minorDiamMm,
      warning: null,  // user has confirmed — clear ambiguity warning
    };
  }

  // Detect overlapping (likely Gmsh-merged) hole detections across ALL holes so
  // the geometry warning reaches the report too, not just the upload-time UI
  // panel. Keyed by hole id (same check as the upload path in index.ts).
  const mergeWarn = flagMergedHoleWarnings(req.holes);
  const mergeById = new Map<number, string>();
  req.holes.forEach((h, i) => { if (mergeWarn[i]) mergeById.set(h.id, mergeWarn[i]!); });

  for (const hole of holesForClassification) {
    const rawCls  = classifyHole(hole.radius, plateDimMin);
    const override = req.holeTypeOverrides?.[hole.id];
    const cls = applyHoleOverride(rawCls, override);
    // A merge/overlap warning is about the detected radius/centre, so it stands
    // even when the user has overridden the bolt type — append it either way.
    const mw = mergeById.get(hole.id);
    if (mw) cls.warning = [cls.warning, mw].filter(Boolean).join(" ");
    holeClassifications.push(cls);

    // Edge distance: distance from hole centre to nearest plate edge in XY
    const [hx, hy] = hole.centre;
    const edgeDists = [
      hx - req.bounds.minX, req.bounds.maxX - hx,
      hy - req.bounds.minY, req.bounds.maxY - hy,
    ];
    const edgeDistMm = Math.min(...edgeDists.filter(d => d > 0));

    // Hole separation: min distance between this hole and any other hole
    let holeSepMm = Infinity;
    for (const other of holesForClassification) {
      if (other.id === hole.id) continue;
      const sep = Math.sqrt((hx-other.centre[0])**2+(hy-other.centre[1])**2);
      if (sep < holeSepMm) holeSepMm = sep;
    }
    if (!isFinite(holeSepMm)) holeSepMm = 0;

    // Calculate bearing stress multiplier for cosine-bearing distribution
    // If forces with cosine_bearing affect this hole, peak stress is higher than uniform
    let bearingStressMult = 1.0;
    let hasCosineBearing = false;
    for (let fi = 0; fi < req.forces.length; fi++) {
      const f = req.forces[fi]!;
      if (f.loadDistribution === 'cosine_bearing' && peakNodalForcesPerForce.has(fi)) {
        // For cosine-bearing, the peak nodal force is significantly higher than uniform average
        // Calculate the ratio of peak to average for this force
        const peakF = peakNodalForcesPerForce.get(fi)!;
        const avgF = f.magnitude / Math.max(1, holesForClassification.length);
        if (peakF > avgF * 1.1) {
          // This force has meaningful cosine-bearing concentration
          hasCosineBearing = true;
          bearingStressMult = Math.max(bearingStressMult, peakF / avgF);
        }
      }
    }

    const modes = checkFailureModes({
      holeClass:         cls,
      plateThicknessMm:  plateThickness,
      edgeDistMm,
      holeSeparationMm:  holeSepMm,
      appliedForceN:     totalForce2 / Math.max(1, holesForClassification.length),
      effectiveYieldMPa: solvedYieldXY,
      bulkSF:            sf,
      bulkCriterion:     bulk.criterion,
      orientation:       req.print.orientation,
      layerHeightMm:     req.print.layerHeightMm ?? 0.2,
      calibratedBearingStrMPa: req.calibration?.bearingStr_MPa ?? null,
      interlayerShearMPa: isOrthotropicLike(material) ? interlaminarShearOf(material) : null,
      // Wall-lined-hole shell selection (#175): only when a genuine two-region
      // field is active AND walls line the hole (wallCount ≥ 1). Slicers line
      // holes with perimeters, so bearing/thread are carried by the shell, not
      // the volume-averaged blend. Single-material / no-wall path passes null →
      // bit-identical to the average material.
      ...(materialField && req.print.wallCount >= 1 && shellHoleAllowables ? {
        wallShellYieldMPa:           shellHoleAllowables.yieldXY,
        wallShellInterlayerShearMPa: shellHoleAllowables.interlayerShear,
      } : {}),
      ...(bearingStressMult > 1.0 ? { bearingStressMult } : {}),
    });

    // Merge — keep lowest SF per mode across all holes
    for (const m of modes) {
      const existing = allFailureModes.find(e => e.mode === m.mode);
      if (!existing) {
        allFailureModes.push(m);
      } else if (m.checked && (!existing.checked || m.sf < existing.sf)) {
        Object.assign(existing, m);
      }
    }
  }

  // ── 6. Linear buckling (BLF) ─────────────────────────────────────────────────
  {
    // BLF verdict thresholds — STORMFEA internal design-basis values, not a
    // cited standard. User-facing rationale lives in the SOURCES tab
    // ("blf_thresholds" entry in SOURCES_DB, client/index.html):
    //   < 1.5  FAIL     — linear (eigenvalue) buckling assumes perfect geometry
    //                     and centered loads; FDM imperfections and load
    //                     eccentricity typically knock 10–40% off the linear
    //                     prediction, so margins under 1.5× are not dependable.
    //   < 3.0  MARGINAL — additional allowance for nonlinear pre-buckling
    //                     deformation, idealized BCs, and modeling error.
    //   ≥ 3.0  PASS     — comfortable margin.
    const BLF_FAIL_THRESHOLD     = 1.5;
    const BLF_MARGINAL_THRESHOLD = 3.0;
    // Representative imperfection knockdown (mid of the cited 10–40% band): the
    // fraction of the linear eigenvalue that survives real FDM geometry
    // imperfections and load eccentricity. Reported as an informational
    // imperfection-adjusted BLF; the VERDICT thresholds above already embed this
    // margin, so it is NOT applied again to `sf` (that would double-count).
    const BLF_IMPERFECTION_KNOCKDOWN = 0.75;
    const totalForceN = req.forces.reduce((s, f) => s + f.magnitude, 0) || 1;
    if (bucklingTensile) {
      allFailureModes.push({
        mode:       "Linear buckling (BLF)",
        sf:          999,
        failForceN:  999 * totalForceN,
        checked:     true,
        confidence:  "low",
        note:        "Structure is tensile-dominated — no compressive buckling mode found. BLF effectively infinite.",
      });
    } else if (bucklingBLF !== undefined && isFinite(bucklingBLF) && bucklingBLF > 0) {
      const blf = bucklingBLF;
      const blfVerdict = blf < BLF_FAIL_THRESHOLD     ? "FAIL"
                       : blf < BLF_MARGINAL_THRESHOLD ? "MARGINAL" : "PASS";
      const convergeNote = bucklingConverged ? "" : " (iteration did not converge — treat as estimate)";
      const certifyNote = bucklingCertified ? "" :
        " (smallest-positive mode NOT certified — the block did not bracket it; a lower BLF may exist, treat as an upper estimate)";
      const adjustedBLF = blf * BLF_IMPERFECTION_KNOCKDOWN;
      allFailureModes.push({
        mode:       "Linear buckling (BLF)",
        sf:          +blf.toFixed(3),
        failForceN:  +(totalForceN * blf).toFixed(0),
        checked:     true,
        confidence:  "low",
        note:        `BLF ${blf.toFixed(2)}× → ${blfVerdict}. The eigenvalue itself is validated: the solver ` +
                     `reproduces the closed-form Euler critical load to <5% (solver_validation group 16), so the ` +
                     `COMPUTED buckling load is high-confidence. The mode stays LOW overall only because real FDM ` +
                     `geometry imperfections and load eccentricity knock ~10–40% off that ideal value ` +
                     `(imperfection-adjusted ≈ ${adjustedBLF.toFixed(2)}×) — an empirical de-rating that needs ` +
                     `physical buckling coupons to pin down. Critical for thin walls, channels, and gussets. Verdict ` +
                     `thresholds (FAIL <1.5×, MARGINAL <3.0×) already embed this knockdown — see SOURCES tab.${convergeNote}${certifyNote}`,
      });
    } else if (bucklingIndeterminate) {
      // The block subspace eigensolver captured the low spectrum but found NO
      // positive eigenvalue — every low mode is tension-driven. A physical
      // buckling factor may still exist outside the captured window; report
      // indeterminate rather than a misleading number.
      allFailureModes.push({
        mode:       "Linear buckling (BLF)",
        sf:          0,
        failForceN:  0,
        checked:     false,
        confidence:  "unchecked",
        note:        "Buckling factor indeterminate: mixed tension/compression pre-stress — " +
                     "the eigensolver's low-mode block contained only non-physical (negative) " +
                     "eigenvalues. Treat buckling as UNCHECKED for this load case.",
      });
    } else {
      // Buckling not available (C3D10 mesh, or solver failure)
      allFailureModes.push({
        mode:       "Linear buckling (BLF)",
        sf:          0,
        failForceN:  0,
        checked:     false,
        confidence:  "unchecked",
        note:        "Buckling analysis not available for this mesh type or solver configuration.",
      });
    }
  }

  // ── Interlayer failure modes (FEM field decomposition) ─────────────────────
  // The dual criterion already folds the tension⊕shear interaction into the
  // headline SF; these rows decompose the layer interface into its two
  // mechanisms so delamination onset ("breaking upon the layers") and
  // interlayer shear are reported — and calibrated — separately.
  let layerInterfaceProfile: LayerInterfaceProfile | null = null;
  let couponRecommendations: CouponRecommendation[] = [];
  if (result.elemStress6 && criterion === "fdm-interface" && isOrthotropic(material)) {
    layerInterfaceProfile = computeLayerInterfaceProfile(
      mesh, result.elemStress6, material, req.print.layerHeightMm ?? 0.2, materialField ?? null,
    );
    const peaks = computeInterfaceModePeaks(mesh, result.elemStress6, material, materialField ?? null);
    if (peaks) {
      // Single source of truth for the interlayer calibration gates — shared
      // with the coupon recommender so the two can't disagree.
      const { zCalibrated: zCal, sCalibrated: sCal } = interfaceCalibrationState(req.calibration, req.print.process);
      couponRecommendations = computeCouponRecommendations(
        req.calibration, req.print.process, peaks.sfTension, peaks.sfShear,
      );
      allFailureModes.push({
        mode:       "Interlayer tension (delamination onset)",
        sf:          +peaks.sfTension.toFixed(3),
        failForceN:  +(totalForce2 * peaks.sfTension).toFixed(0),
        checked:     true,
        confidence:  zCal ? "medium" : "low",
        note: `Peak through-layer opening stress ⟨σzz⟩₊ = ${peaks.peakTensionMPa.toFixed(2)} MPa vs bond tensile allowable ` +
              `S_zt = ${peaks.allowTensionMPa.toFixed(1)} MPa ` +
              (zCal ? `(CALIBRATED from your Z-tension coupon). `
                    : `(literature ratio ${(FDM_ORTHO_RATIOS.yieldZ_over_yieldXY * 100).toFixed(0)}% of in-plane yield — print the Z-tension coupon to calibrate). `) +
              `Compression does not open the interface; the tension⊕shear interaction is already in the headline criterion.`,
      });
      allFailureModes.push({
        mode:       "Interlayer shear",
        sf:          +peaks.sfShear.toFixed(3),
        failForceN:  +(totalForce2 * peaks.sfShear).toFixed(0),
        checked:     true,
        confidence:  sCal ? "medium" : "low",
        note: `Peak driving interlayer shear (friction-credited under compression) = ${peaks.peakShearMPa.toFixed(2)} MPa vs ` +
              `interlaminar allowable S_zs = ${peaks.allowShearMPa.toFixed(1)} MPa ` +
              (sCal ? `(CALIBRATED from your lap-shear coupon). `
                    : `(default S_zt/√3 — run the lap-shear coupon to measure it directly). `) +
              `Layers sliding over each other; governs shear-loaded joints and short overhangs.`,
      });
    }
  }

  // ── In-plane bead-to-bead bond (feature #6) ────────────────────────────────
  // Only present when in-plane raster anisotropy is active (opt-in + evidence-
  // gated). Reports the cross-bead margin, which is already folded into the
  // headline SF via the bulk term's min().
  if (inPlaneAniso && result.elemStress6 && isOrthotropic(material)) {
    const cb = computeCrossBeadPeak(mesh, result.elemStress6, material, inPlaneAniso, materialField ?? null);
    if (cb) {
      const measured = req.calibration?.crossBeadRatio != null;
      allFailureModes.push({
        mode:       "In-plane bead bond (cross-raster)",
        sf:          +cb.sf.toFixed(3),
        failForceN:  +(totalForce2 * cb.sf).toFixed(0),
        checked:     true,
        confidence:  measured ? "medium" : "low",
        note: `Peak cross-bead tension = ${cb.peakMPa.toFixed(2)} MPa vs cross-bead allowable ${cb.allowMPa.toFixed(1)} MPa ` +
              `(${(inPlaneAniso.crossBeadRatio * 100).toFixed(0)}% of in-plane yield, raster ${inPlaneAniso.rasterAngleDeg.toFixed(0)}°, ` +
              (measured ? `CALIBRATED from your cross-bead coupon). `
                        : `literature default — you declared a unidirectional raster). `) +
              `Beads pulling apart within the layer plane; only meaningful for unidirectional/dominant rasters (±45° alternating rasters homogenize to isotropic).`,
      });
    }
  }

  // Sort: unchecked last, then by SF ascending (governing failure first)
  allFailureModes.sort((a,b) => {
    if (!a.checked && b.checked) return 1;
    if (a.checked && !b.checked) return -1;
    return a.sf - b.sf;
  });

  // ── THE governing safety factor (issue #278) ──────────────────────────────
  // ONE value, shared by the verdict AND the headline `summary.safetyFactor` /
  // `summary.estimatedFailForce` — see governingSafetyFactor() for why `sf`
  // seeds the minimum explicitly and why the no-checked-modes case collapses to
  // exactly `sf`. Locked by governing-safety-factor.test.ts.
  const governing         = governingSafetyFactor(sf, allFailureModes);
  const lowestSF          = governing.sf;
  const governingModeName = governing.label;

  // Headline fail force, from the SAME governing SF the verdict uses. Same
  // expression shape as the old bulk-only one (`totalAppliedForce * <sf>`), so
  // when `lowestSF === sf` it reproduces `bulkFailForceN` exactly. The client's
  // `computeDisplayFailForce` recovers the applied load as
  // estimatedFailForce / safetyFactor — that inverse still holds exactly.
  const estimatedFailForce = totalAppliedForce * lowestSF;

  const baseVerdict = buildBaseVerdict({
    lowestSF,
    governingModeLabel: governing.mode?.mode,
    // Identical value to totalAppliedForce (same reduce over req.forces);
    // kept as totalForce2 so this sentence's number is untouched by #278.
    totalAppliedForceN: totalForce2,
    converged:          result.converged,
    cgIterations:       result.cgIterations,
  });

  // If TetGen failed, the geometry analysed was a featureless bounding box —
  // no holes, no fillets, no stress concentrations. The number is a rough
  // sanity check at best; say so up front rather than presenting it as a result.
  const governingVerdict = meshFallback
    ? `Safety factor cannot be computed: TetGen mesh generation failed or is unavailable. Analysis was performed on a bounding box with NO holes, fillets, or geometric features. Stress concentrators (where parts actually fail) are not modeled. This result is not suitable for design decisions. To enable proper analysis, install TetGen (see startup messages).`
    : baseVerdict;
  const baseMat2    = MATERIALS[req.print.materialId] ?? MATERIALS["pla"]!;
  const totalForce  = req.forces.reduce((s, f) => s + f.magnitude, 0) || 1;
  const currentMul  = strengthMul;

  // ── Singularity detection ─────────────────────────────────────────────────
  // Pass req.positions (the display-mesh surface vertices) — NOT mesh.nodes —
  // so the peak's coordinate and its neighborhood are read in the SAME index
  // space as vertexStress (both indexed by display vertex). The radius is scaled
  // to the local element size inside detectSingularity (issue #148).
  //
  // The BC rim is passed so the warning can name the right CAUSE (issue #257).
  // A bolt is a rigid clamp over a finite patch and is singular where the patch
  // stops, but the old message always recommended a fillet — advice that does
  // nothing for a constraint edge. Reuses the same `bcDiscontinuityMask` the
  // adaptive loop uses, mapped from node indices to world mm because the
  // detector works in display-vertex space.
  // Constrained and loaded sets are masked SEPARATELY, not unioned as the
  // adaptive loop does. The loop only needs to know a node is on some BC rim so
  // it can stop refining it; the warning has to tell the user WHICH, because the
  // two call for opposite responses (rethink the bolt vs spread the load).
  const surfaceNodeMaskForBc = (surfaceFaces && surfaceFaces.length > 0)
    ? (() => {
        const s = new Uint8Array(mesh.nodeCount);
        for (const n of surfaceFaces) if (n >= 0 && n < s.length) s[n] = 1;
        return s;
      })()
    : null;

  const rimMaskFor = (nodeSet: readonly number[]): Uint8Array | null => {
    if (!surfaceNodeMaskForBc || nodeSet.length === 0) return null;
    return bcDiscontinuityMask(mesh, [nodeSet], BC_SINGULARITY_DILATE_HOPS, surfaceNodeMaskForBc);
  };

  const rimPointsOf = (mask: Uint8Array | null): Float64Array | null => {
    if (!mask) return null;
    const pts: number[] = [];
    for (let n = 0; n < mask.length; n++) {
      if (mask[n] !== 1) continue;
      pts.push(mesh.nodes[n * 3] ?? 0, mesh.nodes[n * 3 + 1] ?? 0, mesh.nodes[n * 3 + 2] ?? 0);
    }
    return pts.length ? Float64Array.from(pts) : null;
  };

  const constrainedRimMask = rimMaskFor(constraints.flatMap(c => c.nodeIndices));
  const loadedRimMask      = rimMaskFor(solverForces.map(f => f.nodeIndex));

  // Assess the FEA field, not the display mesh (issue #263). vertexStress and
  // req.positions are still passed so the fallback path stays available, but
  // with feaField present they are unused — the detector reads nodeStress
  // against mesh.nodes, which is the only pairing where the neighbourhood
  // radius and the field it samples come from the same mesh.
  const singularity = detectSingularity(
    vertexStress,
    req.positions,
    {
      bcRimPoints:   rimPointsOf(constrainedRimMask),
      loadRimPoints: rimPointsOf(loadedRimMask),
      yieldMPa:      baseMat2.yieldMPa,
      feaField: {
        field:    sampledField("fea", nodeStress, mesh.nodes),
        nodeSize: nodeCharacteristicSizes(mesh),
      },
    },
  );

  // `peakVertexIdx` now indexes the FEA mesh, but generateTopologySuggestions
  // iterates the DISPLAY field, so the exclusion index has to be translated
  // rather than passed through — the exact index-space confusion that put the
  // adaptive loop's exclusion ball at an unrelated node before #257. Nearest
  // display vertex to the singular location; null when nothing was flagged.
  const singularDisplayIdx = ((): number | null => {
    if (!singularity?.detected) return null;
    const [sx, sy, sz] = singularity.peakLocation;
    let best = Infinity, bestIdx = -1;
    for (let v = 0; v < vertCount; v++) {
      const dx = (req.positions[v * 3] ?? 0) - sx;
      const dy = (req.positions[v * 3 + 1] ?? 0) - sy;
      const dz = (req.positions[v * 3 + 2] ?? 0) - sz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) { best = d2; bestIdx = v; }
    }
    return bestIdx >= 0 ? bestIdx : null;
  })();

  // ── BC share of the estimated error (issue #259) ───────────────────────────
  // The same quantity the adaptive loop reports as `bcSingularityErrorFraction`,
  // computed on the ORDINARY single solve as well. It only ever existed on the
  // adaptive path, which is opt-in, so on the great majority of runs the number
  // that says "this error is the constraint idealization, not your mesh" was not
  // merely unshown — it was never calculated.
  //
  // That matters because the error percentage IS shown, next to advice keyed
  // purely on its size ("refine the mesh before trusting margins" above 10%).
  // On a bolt-constrained part that instruction is exactly wrong: the BC band
  // converges at a measured ~0.15 against the ~2.0 a smooth region gives, so
  // halving that component needs on the order of 10^6x the elements. Without
  // this fraction the client cannot tell the two situations apart.
  //
  // UNION of the constrained and loaded rims, matching the adaptive definition
  // exactly so the two paths report the same statistic. (Dilation is per-edge
  // and monotone, so OR-ing two separately dilated masks equals dilating the
  // union — the split above costs nothing here.) Undefined, never 0, when no
  // mask could be built: "not measured" and "measured as none" are different
  // claims and the client renders them differently.
  const bcSingularityErrorFraction = ((): number | undefined => {
    if (!result.errorEstimate) return undefined;
    if (!constrainedRimMask && !loadedRimMask) return undefined;
    const union = new Uint8Array(mesh.nodeCount);
    for (const m of [constrainedRimMask, loadedRimMask]) {
      if (!m) continue;
      for (let i = 0; i < union.length; i++) if (m[i] === 1) union[i] = 1;
    }
    return maskedErrorFraction(mesh, result.errorEstimate, union);
  })();

  // ── Topology suggestions ──────────────────────────────────────────────────
  // mesh.nodes are already in the raw STL/world mm frame (TetGen meshes
  // req.positions, the box fallback spans req.bounds, and force/hole node
  // matching indexes these coords directly). So cluster centroids need no
  // un-normalization: pass scale=1 and a zero offset. A non-zero offset here
  // shifts every suggestion off the real stress region by half the part in
  // X/Y (and by minZ in Z), which is what made the diamond markers miss the
  // high-stress clusters and mis-report their near-edge/near-top context.
  const meshOffset: [number, number, number] = [0, 0, 0];
  // `req.positions`, NOT `mesh.nodes` — the stress array here is the DISPLAY
  // field, so its coordinates must be the display mesh's. Passing mesh.nodes
  // (as this call did) placed every suggestion at an unrelated node's position;
  // `sampledField` now refuses that pairing outright rather than computing a
  // confident wrong answer from it.
  const topologySuggestions = generateTopologySuggestions(
    sampledField("display", vertexStress, req.positions),
    1.0,
    meshOffset,
    singularDisplayIdx,
    req.bounds,
  );

  // Candidate configurations to evaluate
  // Include layer height variation — 0.1mm is stronger than 0.2mm in Z direction
  const currentLH = req.print.layerHeightMm ?? 0.2;
  const altLH     = currentLH > 0.15 ? 0.1 : 0.2;  // suggest finer if currently coarse

  const candidates: Array<{ infill:number; pattern:string; orient:string; walls:number; lh:number; label:string }> = [
    { infill:20,  pattern:'gyroid',  orient:'flat',    walls:req.print.wallCount, lh:currentLH, label:'20% gyroid, flat' },
    { infill:40,  pattern:'gyroid',  orient:'flat',    walls:req.print.wallCount, lh:currentLH, label:'40% gyroid, flat' },
    { infill:40,  pattern:'gyroid',  orient:'upright', walls:req.print.wallCount, lh:currentLH, label:'40% gyroid, upright' },
    { infill:20,  pattern:'cubic',   orient:'upright', walls:req.print.wallCount, lh:currentLH, label:'20% cubic, upright' },
    { infill:40,  pattern:'cubic',   orient:'upright', walls:req.print.wallCount, lh:currentLH, label:'40% cubic, upright' },
    { infill:60,  pattern:'gyroid',  orient:'upright', walls:req.print.wallCount, lh:currentLH, label:'60% gyroid, upright' },
    { infill:100, pattern:'grid',    orient:'flat',    walls:req.print.wallCount, lh:currentLH, label:'100% grid, flat (solid)' },
    { infill:40,  pattern:'honeycomb',orient:'flat',   walls:req.print.wallCount, lh:currentLH, label:'40% honeycomb, flat' },
    // Layer height variation — finer layers = stronger Z bonds
    { infill:req.print.infillPct, pattern:req.print.pattern??'grid', orient:req.print.orientation,
      walls:req.print.wallCount, lh:altLH,
      label:`${req.print.infillPct}% ${req.print.pattern??'grid'}, ${req.print.orientation}, ${altLH}mm layers` },
    // More walls at current settings
    { infill:req.print.infillPct, pattern:req.print.pattern??'grid', orient:req.print.orientation,
      walls:Math.min(8, req.print.wallCount + 2), lh:currentLH,
      label:`${req.print.infillPct}% ${req.print.pattern??'grid'}, +2 walls` },
  ];

  const recommendations: PrintRecommendation[] = candidates
    .map(c => {
      const mul       = effectiveStrengthMultiplier(c.infill, c.walls, c.pattern, c.orient);
      const lhf       = layerHeightFactor(c.lh);
      const adjYieldZ = baseMat2.yieldMPa * mul * FDM_ORTHO_RATIOS.yieldZ_over_yieldXY * lhf;
      const adjYield  = baseMat2.yieldMPa * mul;
      // Use minimum of XY and Z yield for the recommendation
      const effectiveAdj = Math.min(adjYield, adjYieldZ / FDM_ORTHO_RATIOS.yieldZ_over_yieldXY);
      const adjSF    = effectiveAdj / (maxVM || 0.001);
      const adjFail  = totalForce * adjSF;
      const vsCurrentPct = Math.round(((mul * lhf - currentMul * layerHeightFactor(currentLH)) /
                                       (currentMul * layerHeightFactor(currentLH))) * 100);
      return {
        label:           c.label,
        infillPct:       c.infill,
        pattern:         c.pattern,
        orientation:     c.orient,
        wallCount:       c.walls,
        estimatedSF:     +adjSF.toFixed(2),
        estimatedFailN:  +adjFail.toFixed(0),
        vsCurrentPct,
        highlight:       false,
      };
    })
    .filter(r => {
      return !(
        r.infillPct    === req.print.infillPct &&
        r.pattern      === (req.print.pattern ?? 'grid') &&
        r.orientation  === req.print.orientation &&
        r.wallCount    === req.print.wallCount
      );
    })
    .sort((a, b) => b.estimatedSF - a.estimatedSF)
    .slice(0, 5);

  // Mark the best recommendation
  if (recommendations.length > 0) recommendations[0]!.highlight = true;

  // ── Fatigue estimate ──────────────────────────────────────────────────────
  // Two-region field: the fatigue hotspot lives in ONE region — evaluate the
  // governing element's (argmin-SF) own stress against its own bin yield.
  // Averaging would understate a shell hotspot's margin and overstate a core
  // hotspot's. Uniform model: legacy maxVM vs effectiveYield.
  let fatigueStress = maxVM;
  let fatigueYield  = effectiveYield;
  if (materialField && result.governingElement !== undefined) {
    const ge  = result.governingElement;
    const bin = materialField.binOfElement[ge] ?? 0;
    fatigueStress = result.vonMises[ge] ?? maxVM;
    fatigueYield  = materialField.yieldXY[bin] ?? effectiveYield;
  }
  // Interlayer fatigue input: the peak interface traction (⟨σzz⟩₊ and driving
  // interlayer shear τ_z) against its static allowables, so the ADDITIVE
  // through-layer fatigue check can run alongside the bulk scalar. Only defined
  // for orthotropic materials with an interface stress field; null otherwise,
  // in which case the fatigue result is the bulk-only estimate as before.
  let interlayerFatigueInput: InterlayerFatigueInput | null = null;
  if (result.elemStress6 && isOrthotropic(material)) {
    const ifp = computeInterfaceModePeaks(mesh, result.elemStress6, material, materialField ?? null);
    if (ifp) {
      interlayerFatigueInput = {
        peakTensionMPa:  ifp.peakTensionMPa,
        peakShearMPa:    ifp.peakShearMPa,
        allowTensionMPa: ifp.allowTensionMPa,
        allowShearMPa:   ifp.allowShearMPa,
      };
    }
  }
  const fatigue = estimateFatigue(
    fatigueStress,
    fatigueYield,
    req.print.materialId,
    req.print.orientation,
    req.fatigueLoadRatio ?? 0,
    req.calibration ?? null,
    interlayerFatigueInput,
  );

  // ── Isotropic comparison ─────────────────────────────────────────────────
  // Shows what a conventional isotropic FEA tool would predict.
  //
  // The dominant source of difference between isotropic and orthotropic FEA
  // for FDM parts is NOT the stiffness matrix (both give similar stress fields
  // for the same mesh/BCs) — it is the YIELD CRITERION.
  //
  // Isotropic FEA: SF = yieldStrength / vonMises  (applies same yield in all directions)
  // STORMFEA:    SF = yieldXY / σ_hill  (Hill 1948 quadratic criterion)
  //
  // For flat prints under through-thickness load: yieldZ = 0.58 × yieldXY.
  // This means the orthotropic SF can be 42% lower than the isotropic SF
  // for the same stress field — which is exactly the false-safety mechanism.
  //
  // We compute both on the same stress field (the orthotropic solve) to isolate
  // the criterion difference from the stiffness difference.
  let isotropicComparison: IsotropicComparison;
  try {
    // Isotropic SF: apply full yieldXY uniformly (no Z-direction penalty)
    // This is what every conventional FEA tool computes.
    // Using the same stress field as STORMFEA so the comparison is purely
    // about the yield criterion, not mesh/solver differences.
    const orthoMat = material as import("./solver/types.js").OrthotropicMaterial;
    const yieldXY = isOrthotropic(material) ? orthoMat.yieldXY : effectiveYield;
    const yieldZ  = isOrthotropic(material) ? orthoMat.yieldZ  : effectiveYield;

    // Isotropic SF = yieldXY / maxVM  (conventional FEA — ignores Z-direction weakness)
    const isoSF     = maxVM > 0 ? yieldXY / maxVM : 999;

    // The optimism gap is the ratio (isoSF/sfOrthotropic - 1) expressed as percent.
    // This measures how much safer the isotropic model thinks the part is.
    const optimismPct = sf > 0 && sf < 999
      ? +((isoSF - sf) / sf * 100).toFixed(1)
      : 0;
    const falseSafe = isoSF >= 1.0 && sf < 1.0;

    const isoMaxVM = maxVM;  // same stress field — only yield criterion differs

    // How much of the optimism comes from the Z-direction penalty
    const yieldPenaltyPct = +((1 - yieldZ / yieldXY) * 100).toFixed(0);
    const directionWord = req.print.orientation === 'flat'
      ? "flat-printed (load perpendicular to layers)"
      : "upright-printed";

    let explanation: string;
    if (falseSafe) {
      explanation = `Conventional FEA: SF ${isoSF.toFixed(2)}× — part appears SAFE. ` +
        `STORMFEA: SF ${sf.toFixed(2)}× — part FAILS. ` +
        `Reason: this is a ${directionWord} part. ` +
        `Inter-layer bond yield is only ${(yieldZ/yieldXY*100).toFixed(0)}% of in-plane yield (${yieldZ.toFixed(1)} vs ${yieldXY.toFixed(1)} MPa). ` +
        `Conventional FEA applies in-plane yield everywhere — it cannot see this failure mode.`;
    } else if (optimismPct > 5) {
      explanation = `Conventional FEA predicts SF ${isoSF.toFixed(2)}× — ${optimismPct}% more optimistic than STORMFEA's ${sf.toFixed(2)}×. ` +
        `The gap comes from the yield criterion: conventional tools apply in-plane yield (${yieldXY.toFixed(1)} MPa) uniformly. ` +
        `STORMFEA uses the Hill criterion, which accounts for the weaker through-layer direction ` +
        `(${yieldZ.toFixed(1)} MPa — ${yieldPenaltyPct}% lower). ` +
        `For a ${directionWord} part, the inter-layer bonds govern failure first.`;
    } else {
      const wouldGap = (1/FDM_ORTHO_RATIOS.yieldZ_over_yieldXY - 1) * 100;
      explanation = `Both predictions agree closely (conventional ${isoSF.toFixed(2)}× vs STORMFEA ${sf.toFixed(2)}×). ` +
        `The governing stress here is predominantly in-plane, where both use yield_XY (${yieldXY.toFixed(1)} MPa). ` +
        `Note: for parts where Z-direction tension governs (pure pull-through loading), the gap would be ~${wouldGap.toFixed(0)}% — ` +
        `conventional FEA would be optimistic because it ignores inter-layer yield (${yieldZ.toFixed(1)} MPa vs ${yieldXY.toFixed(1)} MPa in-plane).`;
    }

    isotropicComparison = {
      isoSafetyFactor:   +isoSF.toFixed(3),
      isoMaxVonMisesMPa: +isoMaxVM.toFixed(2),
      optimismPct,
      falseSafe,
      explanation,
    };
  } catch (e) {
    isotropicComparison = {
      isoSafetyFactor:   sf,
      isoMaxVonMisesMPa: maxVM,
      optimismPct:       0,
      falseSafe:         false,
      explanation:       "Isotropic comparison unavailable.",
    };
  }

  // ── Material uncertainty bands ────────────────────────────────────────────
  // Literature uncertainty ranges (from SOURCES tab):
  //   Constant           Central   Conservative  Optimistic
  //   E_z/E_xy           0.65      0.55          0.75       (stiffness — affects K, not fast-path)
  //   yieldZ/yieldXY     0.58      0.48          0.68       (central 0.58 from Cojocaru 2019 / Rodriguez 2001;
  //                                                          ±0.10 band is an engineering margin — no paper
  //                                                          reports these bounds — but lies inside published
  //                                                          cross-study scatter; see uncertainty_table /
  //                                                          allum2020 / zaldivar2017 SOURCES entries)
  //   G_xz/G_xy          0.40      0.33          0.47       (Casavola 2016)
  //   Layer height slope −1.0/mm  −1.3/mm       −0.7/mm    (central −1.0/mm from Farashi 2022 meta-analysis;
  //                                                          band bracketed by published extremes — Shergill
  //                                                          2023 ≈−2.0/mm steep end, Garg 2025 slope ≥ 0 —
  //                                                          exact ±30% width is a choice within that spread;
  //                                                          see uncertainty_table / shergill2023 SOURCES)
  //
  // Fast-path: reuse displacement field, only re-evaluate Hill yield criterion with
  // perturbed yield strengths. E_z and G_xz affect K (not fast to perturb).
  // Layer height effect is captured via the lhf slope uncertainty below.
  //
  // Conservative SF: lower yield (yieldZ/yieldXY=0.48) + steeper lhf slope (−1.3/mm)
  // Optimistic SF:   higher yield (yieldZ/yieldXY=0.68) + shallower lhf slope (−0.7/mm)
  const centralYzRatio = req.calibration?.yieldZ_over_yieldXY ?? FDM_ORTHO_RATIOS.yieldZ_over_yieldXY;
  const yieldMul_low  = 0.48 / centralYzRatio;
  const yieldMul_high = 0.68 / centralYzRatio;
  // Layer height factor uncertainty: slope −1.3/mm (conservative) vs −0.7/mm (optimistic)
  // vs −1.0/mm (central). We derive multipliers relative to the central lhf at actual lh.
  const lhMm = req.print.layerHeightMm ?? 0.2;
  const lhfCentral      = Math.max(0.85, Math.min(1.10, 1.00 + (0.2 - lhMm) * 1.0));
  const lhfConservative = Math.max(0.85, Math.min(1.10, 1.00 + (0.2 - lhMm) * 1.3));
  const lhfOptimistic   = Math.max(0.85, Math.min(1.10, 1.00 + (0.2 - lhMm) * 0.7));
  const lhMul_low  = lhfCentral > 0 ? lhfConservative / lhfCentral : 1;
  const lhMul_high = lhfCentral > 0 ? lhfOptimistic   / lhfCentral : 1;

  // With the dual criterion the banded constants (yieldZ ratio, layer-height
  // slope) enter ONLY the interface mechanism — scaling both interface
  // allowables by m scales its SF by exactly m, while the bulk (bead) SF uses
  // yieldXY and does not move. So the band applies when the governing hotspot
  // is interface-governed and collapses to the central SF when it is
  // bulk-governed (the legacy blanket multiplication overstated uncertainty
  // for in-plane-governed parts). hill-legacy keeps the blanket behavior.
  let bandScalesSF = true;
  let delaminationDFM: DelaminationDFM | null = null;
  if (criterion === "fdm-interface" && isOrthotropic(material)
      && result.elemStress6 && result.governingElement !== undefined) {
    const g = result.governingElement;
    const s6 = result.elemStress6;
    let gsxx = s6[g*6] ?? 0, gsyy = s6[g*6+1] ?? 0, gszz = s6[g*6+2] ?? 0;
    let gtxy = s6[g*6+3] ?? 0, gtyz = s6[g*6+4] ?? 0, gtxz = s6[g*6+5] ?? 0;
    if (utilR) {
      const L = rotateStress6ToLocal([gsxx, gsyy, gszz, gtxy, gtyz, gtxz], utilR);
      gsxx = L[0]; gsyy = L[1]; gszz = L[2]; gtxy = L[3]; gtyz = L[4]; gtxz = L[5];
    }
    const gBin = materialField ? (materialField.binOfElement[g] ?? 0) : 0;
    const gYXY = materialField ? (materialField.yieldXY[gBin] ?? utilYieldXY) : utilYieldXY;
    const gYZ  = materialField ? (materialField.yieldZ[gBin]  ?? utilYieldZ)  : utilYieldZ;
    const gYZS = materialField ? (materialField.yieldZShear[gBin] ?? utilYieldZS) : utilYieldZS;
    const gvm = Math.sqrt(0.5*((gsxx-gsyy)**2+(gsyy-gszz)**2+(gszz-gsxx)**2) + 3*(gtxy*gtxy+gtyz*gtyz+gtxz*gtxz));
    const uBulk = gvm / gYXY;
    const uInt  = fdmInterfaceUtilization(gszz, gtyz, gtxz, gYZ, gYZS).combined;
    bandScalesSF = uInt >= uBulk;
    // Interface-aware DFM (#5): only when the hotspot is interface-governed —
    // reorientation / walls advice is meaningless for a bulk-governed part.
    if (uInt >= uBulk && uInt > 1e-9) {
      delaminationDFM = computeDelaminationDFM(
        gszz, gtyz, gtxz, gYXY, gYZ, gYZS, req.print.orientation,
      );
    }
  }
  // ── Bond-model LOW-confidence band term (#172) ────────────────────────────
  // The bead-penetration bond model scales the INTERFACE allowables via
  // constants the repo labels LOW confidence (bond.ts). When the process path
  // is active AND the interface governs, propagate their uncertainty as an
  // extra multiplicative widening. bondBandExcursion is exactly {1,1} at the
  // reference process condition (relStrength is a ratio to reference at the
  // same constants), so the anchor is preserved and the width grows with the
  // distance off-reference. Interface-only, gated on bandScalesSF like the
  // yield/lh terms (bond does not move the bulk-governed SF).
  let bondBandLow = 1, bondBandHigh = 1;
  if (bondRel && bandScalesSF && hasProcessSettings(req.print.process)) {
    const exc = bondBandExcursion(
      req.print.materialId,
      req.print.layerHeightMm ?? 0.2,
      req.print.process,
      req.calibration?.bondCoeffs ?? null,
    );
    bondBandLow  = exc.low;
    bondBandHigh = exc.high;
  }

  // ── Gibson-Ashby exponent band term (#173) ────────────────────────────────
  // On the two-region path the core strength rides on ρ^m with LOW-confidence
  // exponents. When the GOVERNING element is core-classified, propagate the
  // exponent uncertainty so low-infill core-governed parts get a wider band,
  // scaling with (1−ρ). Weighted by the governing bin's CORE fraction (1−shell)
  // so shell-governed parts inherit none of it. Applies regardless of
  // interface/bulk (the core knockdown hits both in-plane and through-layer
  // strength), and is exactly {1,1} at ρ=1 (solid anchor).
  let coreBandLow = 1, coreBandHigh = 1;
  if (materialField && result.governingElement !== undefined) {
    const gBinC = materialField.binOfElement[result.governingElement] ?? 0;
    const shellFracG = materialField.shellFrac[gBinC] ?? 1;
    const coreFracG = Math.min(1, Math.max(0, 1 - shellFracG));
    if (coreFracG > 1e-9) {
      const exc = latticeStrengthExpExcursion(
        req.print.pattern ?? "grid",
        req.print.infillPct / 100,
        req.calibration?.latticeStrengthExp,
      );
      coreBandLow  = 1 + coreFracG * (exc.low  - 1);
      coreBandHigh = 1 + coreFracG * (exc.high - 1);
    }
  }

  // Interface-governed terms (yield ratio, layer-height slope, bond) apply only
  // when the interface governs; the core GA term applies whenever the governing
  // element is core-classified. All terms are exactly 1.0 at their anchors
  // (100% infill, reference process, solid), so uniform / on-reference parts
  // reproduce the prior band bit-for-bit.
  const ifLow  = bandScalesSF ? yieldMul_low  * lhMul_low  * bondBandLow  : 1;
  const ifHigh = bandScalesSF ? yieldMul_high * lhMul_high * bondBandHigh : 1;
  // Deliberately banded around the BULK SF (`sf`), not the governing SF
  // (issue #278): every term in the band is a material-property uncertainty of
  // the FEM bulk criterion. Re-anchoring it on an analytic mode that governs
  // (thread strip-out, bearing, ...) would claim these literature ranges
  // propagate through formulas they were never derived for. Both surfaces
  // render it beside the disclosed bulk number, not around the headline.
  const sfLow  = +(sf * ifLow  * coreBandLow ).toFixed(2);
  const sfHigh = +(sf * ifHigh * coreBandHigh).toFixed(2);

  // Disclose which terms actually contributed to the band (#172/#173).
  const bandTerms: string[] = [];
  if (bandScalesSF) {
    bandTerms.push("interlayer yield-ratio (0.48–0.68)", "layer-height slope (−0.7…−1.3/mm)");
    if (bondBandLow !== 1 || bondBandHigh !== 1) {
      bandTerms.push(`bond-model LOW-confidence constants (×${bondBandLow.toFixed(2)}…${bondBandHigh.toFixed(2)}, off-reference process)`);
    }
  }
  if (coreBandLow !== 1 || coreBandHigh !== 1) {
    bandTerms.push(`Gibson-Ashby core strength-exponent spread (×${coreBandLow.toFixed(2)}…${coreBandHigh.toFixed(2)}, low-infill core-governed)`);
  }
  const sfBandComposition = bandTerms.length > 0
    ? `SF band from: ${bandTerms.join("; ")}.`
    : "SF band collapses to the central value (bulk in-plane governs; no banded constant applies).";

  // ── Governing utilization direction ──────────────────────────────────────
  let governingDirection: 'xy' | 'z' | null = null;
  let peakUtilXY = 0, peakUtilZ = 0;
  if (nodeUtilXY && nodeUtilZ) {
    for (let n = 0; n < mesh.nodeCount; n++) {
      if ((nodeUtilXY[n] ?? 0) > peakUtilXY) peakUtilXY = nodeUtilXY[n] ?? 0;
      if ((nodeUtilZ[n]  ?? 0) > peakUtilZ)  peakUtilZ  = nodeUtilZ[n]  ?? 0;
    }
    governingDirection = peakUtilXY >= peakUtilZ ? 'xy' : 'z';
  }

  let minSignedVM = 0, maxSignedVM = 0;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const sv = nodeSignedStress[n] ?? 0;
    if (sv < minSignedVM) minSignedVM = sv;
    if (sv > maxSignedVM) maxSignedVM = sv;
  }

  // ── Volumetric stress payload (issue #190, opt-in) ──────────────────────────
  // Built from the ANALYSIS mesh (mesh.nodes/mesh.elements), not the display
  // mesh — the client's marching-tet slicer walks corner tets directly against
  // whatever cut plane the section view is using. Only computed when the
  // client asked for it (includeVolumeField), so ordinary analyses (section
  // view closed) don't pay the extra payload size / encode time.
  let volumeField: VolumeFieldPayload | undefined;
  if (req.analysis.includeVolumeField && !meshFallback) {
    const npeV = mesh.nodesPerElem ?? 4;
    const cornerTetCount = mesh.elementCount;
    const nodesArr = new Float32Array(mesh.nodeCount * 3);
    for (let i = 0; i < mesh.nodeCount * 3; i++) nodesArr[i] = mesh.nodes[i] ?? 0;
    const tetsArr = new Int32Array(cornerTetCount * 4);
    for (let e = 0; e < cornerTetCount; e++) {
      const base = e * npeV;
      tetsArr[e*4]   = mesh.elements[base]   ?? 0;
      tetsArr[e*4+1] = mesh.elements[base+1] ?? 0;
      tetsArr[e*4+2] = mesh.elements[base+2] ?? 0;
      tetsArr[e*4+3] = mesh.elements[base+3] ?? 0;
    }
    const nVM  = new Float32Array(mesh.nodeCount);
    const nSVM = new Float32Array(mesh.nodeCount);
    for (let n = 0; n < mesh.nodeCount; n++) {
      nVM[n]  = nodeStress[n] ?? 0;
      nSVM[n] = nodeSignedStress[n] ?? 0;
    }
    const np = result.nodePrincipalStress;
    const nP1 = new Float32Array(mesh.nodeCount);
    const nP2 = new Float32Array(mesh.nodeCount);
    const nP3 = new Float32Array(mesh.nodeCount);
    if (np) {
      for (let n = 0; n < mesh.nodeCount; n++) {
        nP1[n] = np[n*3]   ?? 0;
        nP2[n] = np[n*3+1] ?? 0;
        nP3[n] = np[n*3+2] ?? 0;
      }
    }
    let nXyUtilB64: string | null = null;
    let nZUtilB64:  string | null = null;
    if (nodeUtilXY && nodeUtilZ) {
      const nXY = new Float32Array(mesh.nodeCount);
      const nZ  = new Float32Array(mesh.nodeCount);
      for (let n = 0; n < mesh.nodeCount; n++) {
        nXY[n] = nodeUtilXY[n] ?? 0;
        nZ[n]  = nodeUtilZ[n]  ?? 0;
      }
      nXyUtilB64 = Buffer.from(nXY.buffer).toString("base64");
      nZUtilB64  = Buffer.from(nZ.buffer).toString("base64");
    }
    let nShellB64: string | null = null;
    if (nodeShellFrac) {
      const nSF = new Float32Array(mesh.nodeCount);
      for (let n = 0; n < mesh.nodeCount; n++) nSF[n] = nodeShellFrac[n] ?? 0;
      nShellB64 = Buffer.from(nSF.buffer).toString("base64");
    }
    volumeField = {
      nodeCount: mesh.nodeCount,
      cornerTetCount,
      nodesB64:              Buffer.from(nodesArr.buffer).toString("base64"),
      tetsB64:               Buffer.from(tetsArr.buffer).toString("base64"),
      nodeVonMisesB64:       Buffer.from(nVM.buffer).toString("base64"),
      nodeSignedVonMisesB64: Buffer.from(nSVM.buffer).toString("base64"),
      nodePrincipal1B64:     Buffer.from(nP1.buffer).toString("base64"),
      nodePrincipal2B64:     Buffer.from(nP2.buffer).toString("base64"),
      nodePrincipal3B64:     Buffer.from(nP3.buffer).toString("base64"),
      nodeXyUtilB64: nXyUtilB64,
      nodeZUtilB64:  nZUtilB64,
      nodeShellFractionB64: nShellB64,
    };
    // Payload-size visibility (issue #190 acceptance criterion: "payload size
    // impact measured"). Opt-in only, so this never fires on an ordinary
    // analysis — logged here rather than asserted in a test because the
    // number is mesh-density-dependent, not a solver invariant.
    const approxBytes =
      volumeField.nodesB64.length + volumeField.tetsB64.length +
      volumeField.nodeVonMisesB64.length + volumeField.nodeSignedVonMisesB64.length +
      volumeField.nodePrincipal1B64.length + volumeField.nodePrincipal2B64.length +
      volumeField.nodePrincipal3B64.length +
      (volumeField.nodeXyUtilB64?.length ?? 0) + (volumeField.nodeZUtilB64?.length ?? 0) +
      (volumeField.nodeShellFractionB64?.length ?? 0);
    console.log(
      `[analyse] volumeField: ${mesh.nodeCount} nodes, ${cornerTetCount} tets, ` +
      `~${(approxBytes / 1024).toFixed(0)} KB base64 (opt-in, includeVolumeField=true)`
    );
  }
  // ── Per-analysis validation coverage map (issue #191) ───────────────────────
  // Reuses characteristics already computed above rather than re-deriving them
  // — sfCriterion (bulk.criterion) is the authoritative record of which
  // criterion actually governed this solve, not a re-guess from settings.
  const coverageCriterion: CoverageCriterionValue =
    bulk.criterion === "hill" ? "hill-legacy" : bulk.criterion;
  const fingerprint = computeFingerprint({
    nodesPerElem: mesh.nodesPerElem,
    twoRegionActive: !!materialField,
    orthotropic: isOrthotropic(material),
    criterion: coverageCriterion,
    hasForces: req.forces.length > 0,
    hasPressures: !!(req.pressures && req.pressures.length > 0),
    hasBoltHoles: req.boltHoleIds.length > 0,
    isModal: !!modalResult,
    computesBuckling: mayBuckle,
    fileType: req.fileType,
    meshFallback,
    bondProcessActive: !!bondRel,
    inPlaneAnisotropyActive: !!inPlaneAniso,
    wallBondActive: !!wallBondField,
  });
  const validationCoverage: ValidationCoverageReport = computeValidationCoverage(fingerprint);

  return {
    materialModel,
    validationCoverage,
    vertexStress,
    vertexSignedVonMises,
    vertexXyUtil,
    vertexZUtil,
    vertexPrincipalStress,
    vertexPrincipalStress2,
    vertexPrincipalStress3,
    vertexDisplacement,
    surfaceTriangleCount: vertCount / 3,
    maxVonMisesMPa:     maxVM,
    maxDisplacementMm:  result.maxDisplacementMm,
    effectiveYieldMPa:  effectiveYield,
    safetyFactor:       meshFallback ? null : lowestSF,
    bulkSafetyFactor:   meshFallback ? null : sf,
    governingMode:      governingModeName,
    sfCriterion:        bulk.criterion,
    vonMisesSafetyFactor: meshFallback ? null : sfVonMises,
    safetyfactorLow:    meshFallback ? null : sfLow,
    safetyFactorHigh:   meshFallback ? null : sfHigh,
    sfBandComposition:  meshFallback ? null : sfBandComposition,
    estimatedFailForce,
    bulkFailForceN,
    yielding,
    verdict:            governingVerdict,
    cgIterations:       result.cgIterations,
    converged:          result.converged,
    meshFallback,
    unitsWarning,
    meshOrderDowngrade,
    meshResolution,
    safetyFactorAvailable: !meshFallback,
    solverMs,
    nodeCount:          mesh.nodeCount,
    elementCount:       mesh.elementCount,
    nodesPerElem:       mesh.nodesPerElem,
    recommendations,
    failureModes:       allFailureModes,
    holeClassifications,
    calibrationId:      req.calibration?.id ?? null,
    singularity,
    rigidBodyMode,
    topologySuggestions,
    layerInterfaceProfile,
    couponRecommendations,
    delaminationDFM,
    fatigue,
    isotropicComparison,
    governingDirection,
    peakUtilXY: +peakUtilXY.toFixed(3),
    peakUtilZ:  +peakUtilZ.toFixed(3),
    minSignedVonMisesMPa: +minSignedVM.toFixed(3),
    maxSignedVonMisesMPa: +maxSignedVM.toFixed(3),
    vertexModeShapesB64,
    modalResult,
    vertexBucklingModeB64,
    bucklingResult: mayBuckle ? {
      blf: bucklingBLF ?? null,
      verdict: bucklingTensile ? 'no-buckling'
             : bucklingIndeterminate ? 'indeterminate'
             : (bucklingBLF !== undefined && bucklingBLF > 0)
                 ? (bucklingBLF < 1.5 ? 'FAIL' : bucklingBLF < 3.0 ? 'MARGINAL' : 'PASS')
                 : 'indeterminate',
      converged: bucklingConverged,
      tensileDominated: bucklingTensile,
      indeterminate: bucklingIndeterminate,
      hasMode: !!vertexBucklingModeB64,
      certified: bucklingCertified,
      positiveBLFs: bucklingPositiveBLFs,
    } : undefined,
    residualCheckpoints: result.residualCheckpoints,
    vertexErrorEstimateB64: vertexErrorEstimate ? Buffer.from(vertexErrorEstimate.buffer).toString("base64") : undefined,
    globalRelativeError: result.globalRelativeError,
    bcSingularityErrorFraction,
    topErrorElements: result.topErrorElements ? [...result.topErrorElements] : undefined,
    volumeField,
  };
}

// ─── Adaptive-refinement driver (issue #149) ─────────────────────────────────
/**
 * Size-transition ratio the re-mesh size field is held to (see
 * smoothSizeFieldGradation). Applied to the raw field before the budget guard.
 */
const GRADATION = DEFAULT_SIZE_FIELD_FACTORS.gradation;

/**
 * How many extra re-meshes one refinement iteration may spend recovering from a
 * budget overshoot before the loop gives up on that iteration. Two: the first
 * retry uses a calibration measured from the actual overshoot, so it converges
 * immediately unless the predictor is wrong in a way a scalar cannot capture.
 */
const MAX_REMESH_ATTEMPTS = 2;

/**
 * runAdaptiveAnalysis — the OPT-IN error-driven adaptive refinement loop.
 *
 * Runs the normal analysis once at the selected mesh tier, then, while the ZZ
 * global relative error is above target and the guards allow, builds a regional
 * SIZE FIELD from the per-element error indicator (small elements where error
 * concentrates, coarse elsewhere), re-meshes with TetGen sizing, and re-solves.
 * Reports the BEST (lowest global-error) iteration with an AdaptiveRefinementInfo.
 *
 * DEGRADES CLEANLY to the single tier solve — returning exactly what runAnalysis
 * would return, plus a `degradedToTier` note — when adaptivity cannot run: the
 * STEP/Gmsh path, the box-mesh fallback, a missing TetGen binary, or no error
 * field. This keeps the default single-solve behaviour reachable and unchanged.
 *
 * The element-growth cap is enforced against the mesh TetGen ACTUALLY emitted,
 * before that mesh is solved — not against the first-order prediction alone, and
 * not one iteration late off the completed loop state. An overshoot re-meshes
 * with a calibrated-tighter budget, and if that still overshoots the loop stops
 * on `budget-overshoot` having spent no solve on the over-budget mesh.
 *
 * The size-field construction, gradation limit, budget guard, and stop criteria
 * are unit-tested without any binary (server/tests/unit/adaptive-mesh.test.ts).
 * Only the meshWithTetGenSizing re-mesh needs the binary; where it is absent the
 * loop degrades on the first iteration.
 */
export async function runAdaptiveAnalysis(
  req: AnalysisRequest,
  loopOverrides?: Partial<LoopControlOptions>,
): Promise<AnalysisResult> {
  const opts: LoopControlOptions = { ...DEFAULT_LOOP_OPTIONS, ...loopOverrides };

  // ── First (tier) solve, capturing the raw mesh + error field ───────────────
  const cap0: NonNullable<AnalysisRequest["_captureInternals"]> = {};
  const first = await runAnalysis({ ...req, _captureInternals: cap0 });

  // Follow the order the first solve ACTUALLY produced, not the one requested.
  // They differ when the C3D10 ordering guard forced a downgrade to linear
  // (issue #265): re-meshing at order 2 from a C3D4 base would ask the same
  // rejected mesher for the same rejected elements, and — before it failed —
  // would size the field with the quadratic convergence exponent against a
  // linear solution. `nodesPerElem` is what was solved, so it is the truth here.
  const order: 1 | 2 = first.nodesPerElem === 4 ? 1 : (req.analysis.meshOrder ?? 2) as 1 | 2;

  const history: AdaptiveRefinementInfo["history"] = [
    {
      globalRelativeError: first.globalRelativeError ?? 0,
      elementCount:        first.elementCount,
      maxVonMisesMPa:      first.maxVonMisesMPa,
      safetyFactor:        first.safetyFactor,
    },
  ];

  const degrade = (note: string): AnalysisResult => ({
    ...first,
    adaptiveRefinement: {
      iterations:          1,
      stopReason:          "degraded-to-tier",
      initialGlobalError:  first.globalRelativeError ?? 0,
      finalGlobalError:    first.globalRelativeError ?? 0,
      initialElementCount: first.elementCount,
      finalElementCount:   first.elementCount,
      history,
      degradedToTier:      true,
      note,
    },
  });

  if (req.fileType !== "stl" || req.stepBuffer) {
    return degrade("Adaptive refinement runs on the STL/TetGen path only; used the selected mesh tier.");
  }
  if (cap0.meshFallback) {
    return degrade("Mesh degraded to the box fallback (no surface connectivity); adaptive sizing unavailable — used the tier mesh.");
  }
  if (!cap0.mesh || !cap0.errorEstimate) {
    return degrade("No per-element error field was produced; used the selected mesh tier.");
  }

  const probe = await probeTetGen();
  if (!probe.found) {
    return degrade("TetGen binary not found; adaptive re-mesh unavailable — used the selected mesh tier.");
  }

  // ── Singularity exclusion (issue #147): keep a small radius around a flagged
  //    singular corner coarse — refining a true singularity never converges. ──
  //    Only for a GEOMETRIC singularity. A constraint-edge or load-edge one is
  //    already handled, and handled better, by the BC-discontinuity mask below:
  //    that band is topological, so it scales with the local element size, where
  //    this ball is a fixed 2 mm regardless of part size. Stacking both on the
  //    same singularity double-excludes it. This distinction did not exist
  //    before issue #257 because the detector's absolute 50 MPa gate meant
  //    `detected` was essentially never true on the parts this tool analyses, so
  //    this branch was dead code; removing that gate made it live, and it moved
  //    the #149 benchmark's adaptive peak from 8.485 to 8.860 MPa (past its
  //    2x-uniform bound) on the first run where it fired. Gating it by cause
  //    restores the measured baseline and keeps the ball for the case it was
  //    designed for.
  const singularities: SingularityRegion[] = [];
  if (first.singularity?.detected && first.singularity.cause === "geometry" && cap0.mesh) {
    // `peakLocation`, NOT `peakVertexIdx` indexed into mesh.nodes. Those are two
    // different index spaces: peakVertexIdx indexes the DISPLAY mesh (3 vertices
    // per surface triangle, what detectSingularity was handed), while mesh.nodes
    // is the FEA node array. Using one to index the other put the exclusion ball
    // at an unrelated node — in range, so it failed silently. It stayed dormant
    // only because the detector's old absolute 50 MPa gate meant `detected` was
    // essentially never true (issue #257); removing that gate makes this live.
    // peakLocation is already world mm, which is what SingularityRegion wants.
    const [nx, ny, nz] = first.singularity.peakLocation;
    if (nx !== undefined && ny !== undefined && nz !== undefined) {
      // 2 mm exclusion ball — comfortably larger than the ~1 mm neighbourhood
      // the detector samples, so the singular tip and its immediate ring are
      // left coarse.
      singularities.push({ x: nx, y: ny, z: nz, radius: 2.0 });
    }
  }

  // ── BC-discontinuity exclusion ─────────────────────────────────────────────
  // The edge of a constrained patch, and the rim of a loaded patch, are genuine
  // singularities of the IDEALIZATION: refining them never converges, so an
  // equidistribution loop pours elements into a region that cannot improve and
  // stalls short of its target. Marking the interface (one ring either side)
  // lets the budget go to the interior, which does converge. See
  // bcDiscontinuityMask for the measurement this rests on.
  const bcMaskFor = (cap: NonNullable<AnalysisRequest["_captureInternals"]>): Uint8Array | undefined => {
    if (!cap.mesh) return undefined;
    // Surface-node mask: the patch-rim test is only meaningful within the
    // boundary surface (see bcDiscontinuityMask). No surface ⇒ no exclusion.
    if (!cap.surfaceFaces) return undefined;
    const surf = new Uint8Array(cap.mesh.nodeCount);
    for (const n of cap.surfaceFaces) if (n >= 0 && n < surf.length) surf[n] = 1;
    return bcDiscontinuityMask(
      cap.mesh,
      [cap.constrainedNodes ?? [], cap.loadedNodes ?? []],
      BC_SINGULARITY_DILATE_HOPS,
      surf,
    );
  };
  // Node indices are per-mesh, so this is rebuilt after every accepted re-mesh.
  let bcExclude = bcMaskFor(cap0);
  let bestBcFraction: number | undefined =
    maskedErrorFraction(cap0.mesh, cap0.errorEstimate, bcExclude);

  const baseElementCount = first.elementCount;
  const budget = Math.max(baseElementCount + 1, Math.floor(baseElementCount * opts.maxElementGrowth));

  // Running calibration of predictRefinedElementCount against what TetGen
  // actually emits. 1 = the predictor is trusted; >1 = it under-predicts by
  // that factor and the budget handed to the guard is divided by it.
  let sizingBias = 1;

  let best = first;
  let bestGRE = first.globalRelativeError ?? Infinity;
  let curMesh = cap0.mesh;
  let curError = cap0.errorEstimate;
  let iterations = 1;
  let stopReason: StopReason = "max-iterations";

  // Loop state reflects the iteration just COMPLETED (starts at the tier solve).
  let state = {
    iteration:                   0,
    globalRelativeError:         first.globalRelativeError ?? 0,
    elementCount:                first.elementCount,
    baseElementCount,
    previousGlobalRelativeError: null as number | null,
    refinedNodeCount:            null as number | null,
  };

  for (;;) {
    const decision = shouldStopRefinement(state, opts);
    if (decision.stop) { stopReason = decision.reason; break; }

    // ── Build the regional size field from the current error field ───────────
    const targetErr = targetPerElementError(opts.targetGlobalError, curMesh.elementCount);
    const raw = buildSizeField(curMesh, curError, {
      targetError:   targetErr,
      order,
      minSizeFactor: DEFAULT_SIZE_FIELD_FACTORS.minSizeFactor,
      maxSizeFactor: DEFAULT_SIZE_FIELD_FACTORS.maxSizeFactor,
      singularities,
      excludeNodes: bcExclude,
    });
    if (raw.refinedNodeCount === 0) { stopReason = "no-refinement-requested"; break; }
    // Bound the size transition between refined and unrefined regions BEFORE
    // the budget guard, so the elements the graded band costs are inside the
    // budget rather than a surprise on top of it.
    const graded = smoothSizeFieldGradation(curMesh, raw, GRADATION);

    // ── Re-mesh with the sizing field, and hold it to the budget ─────────────
    // The budget guard is a PREDICTION (predictRefinedElementCount is
    // first-order by construction), and nothing used to compare it against what
    // TetGen actually emitted — so an under-prediction silently blew the cap and
    // the over-budget mesh went on to consume a full solve before anything
    // noticed. Observed on a Ø5-bore tube: 13,340 → 115,544 elements, 8.7×
    // against the documented 8× cap, 13 slivers, and the mesh-quality gate
    // (#166) then rejected the whole thing.
    //
    // So: measure the ACTUAL count, and if it overshoots, use the overshoot as a
    // multiplicative calibration on the predictor and re-mesh with a
    // correspondingly tighter effective budget. A re-mesh is cheap next to a
    // solve; an over-budget solve is the expensive mistake. The calibration is
    // monotone (it only ever tightens) and carries across iterations, so a
    // predictor that is optimistic on this geometry stays corrected.
    let remesh: Awaited<ReturnType<typeof meshWithTetGenSizing>> | null = null;
    let attemptStop: StopReason | null = null;
    let acceptedRefinedNodes = 0;
    for (let attempt = 0; attempt <= MAX_REMESH_ATTEMPTS; attempt++) {
      const effBudget = effectiveElementBudget(budget, curMesh.elementCount, sizingBias);
      const field = relaxSizeFieldToBudget(curMesh, graded, effBudget, GRADATION);
      if (field.refinedNodeCount === 0) {
        // The budget left no room to refine anything at all.
        attemptStop = "no-refinement-requested";
        break;
      }
      const predicted = predictRefinedElementCount(curMesh, field);
      let candidate;
      try {
        candidate = await meshWithTetGenSizing(req.positions, req.triangleCount, curMesh, field, order);
      } catch (err) {
        console.warn("[analysis] adaptive re-mesh failed, keeping best-so-far:", err);
        attemptStop = "remesh-failed";
        break;
      }
      const actual = candidate.mesh.elementCount;
      console.log(
        `[analysis] adaptive re-mesh: ${curMesh.elementCount} → ${actual} elements ` +
        `(predicted ${Math.round(predicted)}, effective budget ${effBudget} of ${budget}, ` +
        `bias ${sizingBias.toFixed(2)})`,
      );
      const verdict = judgeRemeshAgainstBudget(actual, predicted, budget, curMesh.elementCount);
      if (verdict.accepted) {
        sizingBias = verdict.sizingBias;
        remesh = candidate;
        acceptedRefinedNodes = field.refinedNodeCount;
        break;
      }
      console.warn(
        `[analysis] adaptive re-mesh overshot the element budget ` +
        `(${actual} > ${budget}, predicted ${Math.round(predicted)}); ` +
        `bias ${sizingBias.toFixed(3)} → ${verdict.sizingBias.toFixed(3)}, ` +
        `attempt ${attempt + 1}/${MAX_REMESH_ATTEMPTS + 1}`,
      );
      if (verdict.sizingBias <= sizingBias * 1.01) {
        // The calibration barely moved, so the next attempt would rebuild
        // essentially the same field and re-mesh to the same result. Stop rather
        // than repeat it.
        attemptStop = "budget-overshoot";
        break;
      }
      sizingBias = verdict.sizingBias;
    }
    if (attemptStop) { stopReason = attemptStop; break; }
    if (!remesh) {
      // Every attempt overshot. Stop WITHOUT solving — the whole point of the
      // cap is to not spend a solve on a mesh that exceeds it.
      stopReason = "budget-overshoot";
      break;
    }

    // ── Re-solve on the refined mesh ─────────────────────────────────────────
    // Guarded for the same reason the re-mesh above is: a refined mesh can be
    // REJECTED downstream even when TetGen returned it happily. A size field
    // that shrinks elements hard near a stress concentration can leave a
    // handful of slivers, and the hard mesh-quality gate (#166) then throws
    // rather than solving an ill-conditioned system — observed on a Ø5-bore
    // tube, where the first refinement produced 13 slivers out of 115k
    // elements and killed the whole analysis.
    //
    // Without this catch the exception escapes runAdaptiveAnalysis entirely, so
    // an OPT-IN accuracy feature turns a perfectly good tier solve into a 500 —
    // and `best` already holds that good solve. Degrade to it, exactly as this
    // function's contract promises, instead of losing it.
    const capN: NonNullable<AnalysisRequest["_captureInternals"]> = {};
    let next: AnalysisResult;
    try {
      next = await runAnalysis({
        ...req,
        _prebuiltMesh: {
          mesh:          remesh.mesh,
          surfaceToNode: remesh.surfaceToNode,
          surfaceFaces:  remesh.surfaceFaces,
        },
        _captureInternals: capN,
      });
    } catch (err) {
      console.warn("[analysis] adaptive re-solve failed, keeping best-so-far:", err);
      stopReason = "resolve-failed";
      break;
    }
    // A refined solve that did not converge must never become the reported
    // result: its stress field is unresolved, and the ZZ error estimate computed
    // from it is not meaningful — so comparing its `globalRelativeError` against
    // bestGRE below could adopt it on the strength of a number that means
    // nothing. This used to be enforced indirectly, by the CG wall clock
    // THROWING into the catch above. That clock is now a hang guard which
    // returns its current iterate with converged: false instead (the iteration
    // cap always behaved that way), so the check has to be explicit. Same
    // outcome as before — degrade to the best solve so far and say why.
    if (!next.converged) {
      console.warn(
        `[analysis] adaptive re-solve did not converge ` +
        `(${next.elementCount} elements, ${next.cgIterations} CG iterations); keeping best-so-far`);
      stopReason = "resolve-failed";
      break;
    }
    iterations++;
    const nextGRE = next.globalRelativeError ?? 0;
    history.push({
      globalRelativeError: nextGRE,
      elementCount:        next.elementCount,
      maxVonMisesMPa:      next.maxVonMisesMPa,
      safetyFactor:        next.safetyFactor,
    });

    const nextMask = bcMaskFor(capN);
    if (nextGRE < bestGRE) {
      best = next; bestGRE = nextGRE;
      bestBcFraction = (capN.mesh && capN.errorEstimate)
        ? maskedErrorFraction(capN.mesh, capN.errorEstimate, nextMask)
        : undefined;
    }

    // Advance loop state for the next stop decision.
    const prevGRE = state.globalRelativeError;
    state = {
      iteration:                   state.iteration + 1,
      globalRelativeError:         nextGRE,
      elementCount:                next.elementCount,
      baseElementCount,
      previousGlobalRelativeError: prevGRE,
      refinedNodeCount:            acceptedRefinedNodes,
    };

    if (!capN.mesh || !capN.errorEstimate) { stopReason = "no-error-field"; break; }
    curMesh = capN.mesh;
    curError = capN.errorEstimate;
    bcExclude = nextMask;
  }

  return {
    ...best,
    adaptiveRefinement: {
      iterations,
      stopReason,
      initialGlobalError:  first.globalRelativeError ?? 0,
      finalGlobalError:    Number.isFinite(bestGRE) ? bestGRE : (first.globalRelativeError ?? 0),
      initialElementCount: baseElementCount,
      finalElementCount:   best.elementCount,
      elementBudget:       budget,
      bcSingularityErrorFraction: bestBcFraction,
      history,
      headlineSpread:      headlineSpreadOf(history),
      degradedToTier:      false,
      // The BC sentence is appended whenever the fraction is known — no
      // threshold, because a threshold would be one more tunable constant
      // sitting under a user-facing string. The reader can judge 5% or 75%.
      note: `Adaptive refinement: ${iterations} solve(s), stopped on '${stopReason}'.` +
        (bestBcFraction === undefined ? "" :
          ` ${(bestBcFraction * 100).toFixed(0)}% of the remaining estimated error sits at ` +
          `boundary-condition discontinuities (the rim of a constrained or loaded patch), ` +
          `which refinement cannot reduce — that share reflects the constraint idealization, ` +
          `not the mesh.`),
    },
  };
}
