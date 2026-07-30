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
import { assembleForceVector, assembleBodyForce, assembleSurfaceTraction, assembleSurfaceTractionNormal, selectPressureRegion } from "./solver/load.js";
import type { ModalAnalysisResult }        from "./solver/types.js";
import {
  buildLaminateCMatrix,
  DEFAULT_BEAD_PROPS,
  PATTERN_PLY_ANGLES,
  type BeadProperties,
} from "./solver/laminate.js";
import {
  predictBondMultipliers,
  hasProcessSettings,
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
  patternFamilyOf,
} from "./solver/lattice.js";
import { isOrthotropic, isOrthotropicLike } from "./solver/types.js";
import { recoverElementStressComponents }   from "./solver/stress_detail.js";
import { rotationAligningZTo, rotateStress6ToLocal, computeGeometry } from "./solver/element.js";
import {
  sprSmoothedStress, sprSmoothedStress6, recoverElementStress, nodeAveragedPrincipalStress,
  fdmInterfaceUtilization, interlaminarShearOf, INTERFACE_FRICTION_MU,
  type CriterionKind, type InPlaneAniso,
} from "./solver/stress.js";
import { flagMergedHoleWarnings }           from "./holes.js";
import type { HoleFeature }                 from "./holes.js";
import { meshWithTetGen, TetGenNotFoundError } from "./tetgen.js";
import { meshStepWithGmsh }                 from "./gmsh_mesh.js";

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

const BOLT_SIZES: BoltSize[] = [
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

  // Check for ambiguity — multiple good matches
  const ambiguous = matches.filter(m => m.delta < MATCH_TOL * 0.5 && m.bolt.label !== best.bolt.label);
  if (ambiguous.length > 0) {
    return { type:"ambiguous", bolt:best.bolt, detectedDiamMm:d,
      warning:`Hole diameter ${d.toFixed(2)}mm could be ${best.bolt.label} (${HOLE_TYPE_LABEL[best.type as keyof typeof HOLE_TYPE_LABEL]}) or ${ambiguous[0]!.bolt.label} (${HOLE_TYPE_LABEL[ambiguous[0]!.type as keyof typeof HOLE_TYPE_LABEL]}). Verify which bolt is intended.` };
  }

  // Minor diameter for tapped holes
  const minorDiamMm = best.type.startsWith("tapped")
    ? best.bolt.nominalMm - best.bolt.pitch  // approximate minor diameter
    : undefined;

  return {
    type:           best.type,
    bolt:           best.bolt,
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
}): FailureModeResult[] {
  const { holeClass, plateThicknessMm, edgeDistMm, holeSeparationMm,
          appliedForceN, effectiveYieldMPa, bulkSF, orientation,
          layerHeightMm, calibratedBearingStrMPa } = params;
  const bearingStressMult = params.bearingStressMult ?? 1.0;
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
  // τ = F / (2 × e × t)  where e = edge distance from hole centre
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
    const threadShear = shearStrength * penalty;
    const sf_strip = (threadShear * shearArea) / F;
    results.push({
      mode:       "Thread strip-out",
      sf:          +sf_strip.toFixed(3),
      failForceN:  +(F * sf_strip).toFixed(0),
      checked:     true,
      confidence:  "medium",
      note:        `${nThreads} threads engaged (${t.toFixed(1)}mm / ${pitch}mm pitch). Each thread crosses ~${crossingsPerThread.toFixed(1)} layer boundaries (lh=${layerHeightMm}mm) — penalty ${(penalty*100).toFixed(0)}%. Strength estimate ±30%.`,
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
    // Use calibrated bearing strength if available — otherwise conservative estimate
    const bearingStr   = calibratedBearingStrMPa ?? Sy * 1.0;
    const sf_bearing   = bearingStr / sigmaBear;
    const isCalibrated = calibratedBearingStrMPa != null;
    const distLabel    = bearingStressMult > 1.1 ? ` (peak from cosine-bearing distribution)` : ``;
    results.push({
      mode:       "Bearing (hole wall)",
      sf:          +sf_bearing.toFixed(3),
      failForceN:  +(F * sf_bearing / bearingStressMult).toFixed(0),
      checked:     true,
      confidence:  isCalibrated ? "medium" : "low",
      note: isCalibrated
        ? `Bolt shaft (${boltD}mm) bears on hole wall (${t.toFixed(1)}mm). Using CALIBRATED bearing strength ${bearingStr.toFixed(0)} MPa from physical test.${distLabel}`
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
}

/** One (stress amplitude, cycles-to-failure) point from a fatigue coupon. */
export interface FatigueCouponPoint {
  stressAmplitudeMPa: number;
  cycles:             number;
}

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

  // Lap-shear: the single-lap joint concentrates shear at the overlap ends, so
  // nominal F/A_overlap underestimates the true peak. Multiply by Kt (from the
  // solver) to get the peak-based interlaminar shear strength S_zs. It stays
  // an INDEPENDENT allowable (audit A5); only when no Z-tension coupon was
  // run is it also converted into yieldZ via the legacy Hill τ_z = Z/√3
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
  // bearing stress F/(d·t) is corrected to peak by Kt.
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
const MATERIALS: Record<string, { E: number; nu: number; yieldMPa: number; densityKgM3: number; label: string }> = {
  pla:   { E: 3500,  nu: 0.36, yieldMPa: 50,  densityKgM3: 1240, label: "PLA"   },
  petg:  { E: 2100,  nu: 0.38, yieldMPa: 45,  densityKgM3: 1270, label: "PETG"  },
  abs:   { E: 2300,  nu: 0.35, yieldMPa: 40,  densityKgM3: 1050, label: "ABS"   },
  tpu:   { E:  200,  nu: 0.48, yieldMPa: 15,  densityKgM3: 1200, label: "TPU"   },
  pa12:  { E: 1700,  nu: 0.40, yieldMPa: 48,  densityKgM3: 1010, label: "PA12 (Nylon)" },
  asa:   { E: 2100,  nu: 0.35, yieldMPa: 40,  densityKgM3: 1070, label: "ASA"   },
};

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
 * The input must be in the NATURAL frame (weak axis = local Z) and must not
 * carry a weakAxis — swapping an already-rotated material is meaningless.
 */
export function applyUprightScalarSwap(mat: OrthotropicMaterial): OrthotropicMaterial {
  // yieldZShear (interlaminar shear) rides along unchanged via the spread:
  // it belongs to the physical layer interface, which the swap relabels but
  // does not alter. The swapped material is analysed with the hill-legacy
  // criterion anyway (the interface criterion needs a known weak axis, which
  // the no-bed swap deliberately does not have — see runAnalysis).
  return {
    ...mat,
    E_xy: mat.E_z, E_z: mat.E_xy,
    G_xy: mat.G_xz, G_xz: mat.G_xz,
    yieldXY: mat.yieldZ, yieldZ: mat.yieldXY,
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
    infillPct / 100,
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

  const E_xy    = E_xy_base    * Math.min(1.0, strengthMul);
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
  const sStr = latticeStrengthFraction(pattern, rho, calibration?.latticeStrengthExp);

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

  let framed: OrthotropicMaterial = scaled;
  if (uprightNoBed) {
    const { weakAxis: _identityAxis, ...swapped } = applyUprightScalarSwap(scaled);
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
    yieldXY: framed.yieldXY * sStr,
    yieldZ:  framed.yieldZ  * sStr,
    // Interlaminar shear follows the same lattice strength fraction as the
    // other strengths (the bond area thins with density like the walls do).
    yieldZShear: interlaminarShearOf(framed) * sStr,
    label: `${solid.label} · GA ${pattern} lattice ρ=${infillPct}%`,
    massRho: baseMat.densityKgM3 * rho,
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
export interface ForceSpec {
  /** Force magnitude in Newtons */
  magnitude: number;
  /** Unit direction vector [x, y, z] in STL file space */
  direction: [number, number, number];
  /** Point of application in STL file space (mm) */
  position:  [number, number, number];
  /** Load distribution mode: 'uniform' = equal across face, 'cosine_bearing' = concentrated at bearing point (default: 'uniform') */
  loadDistribution?: 'uniform' | 'cosine_bearing';
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
   * (wallCount × extrusionWidthMm). Clamped to [0, 64]. Absent → the top skin
   * falls back to the perimeter band thickness (legacy behavior, unchanged).
   */
  topLayers?: number;
  /**
   * Number of solid BOTTOM layers (floor skin); see topLayers. Bottoms are
   * commonly thicker than tops, so the two are independent. Clamped to [0, 64].
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
   * wall band uses print.extrusionWidthMm. Default false — the empirical
   * single-material model.
   */
  twoRegion?:    boolean;
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
 * Revised calibration — capped at ±15% (down from ±20%):
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
 * penalty = base_reduction × (1 + 0.05 × extra_crossings_per_thread)
 * where extra_crossings = max(0, pitch/layerHeight - 1)
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
  detected:      boolean;
  peakVertexIdx: number;
  peakStressMPa: number;
  /** Stress at 1mm radius from peak — if much lower, singularity likely */
  stressAt1mmMPa: number;
  /** Ratio: peakStress / stressAt1mm — >3× suggests singularity */
  concentrationRatio: number;
  message:       string;
  confidence:    "high" | "medium" | "low";
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
 *   - Endurance limit Se ≈ 0.40 × UTS for FDM PLA (flat print)
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
  calib?: { fatigueSeRatio?: number | null; fatigueBasquinB?: number | null; fatigueUTS_MPa?: number | null } | null,
): FatigueEstimate {
  const R = Math.max(-1, Math.min(0.95, Number.isFinite(loadRatioR) ? loadRatioR : 0));
  const isCalibrated = calib != null && calib.fatigueSeRatio != null && Number.isFinite(calib.fatigueSeRatio);
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

  // Amplitude / mean from the load ratio R = σ_min/σ_max, with σ_max = peak VM:
  //   σ_a = σ_max(1−R)/2,  σ_m = σ_max(1+R)/2.  R=0 → σ_m = σ_a = σ_max/2.
  const sigma_a = peakVonMisesMPa * (1 - R) / 2;
  const sigma_m = peakVonMisesMPa * (1 + R) / 2;
  // Compressive mean stress is beneficial; conservatively don't credit it.
  const sigma_m_eff = Math.max(0, sigma_m);

  // Modified Goodman: 1/SF = σ_a/Se + σ_m/Su
  const goodmanDemand = (sigma_a / Se) + (sigma_m_eff / utsMPa);
  const fatigueSF     = goodmanDemand > 0 ? 1 / goodmanDemand : 999;

  // Basquin cycles to failure
  // σ_a,eq = σ_a / (1 - σ_m/Su)  [Goodman-corrected amplitude]
  const sigmaEqA = sigma_a / Math.max(0.01, 1 - sigma_m_eff / utsMPa);
  const sigmaf   = 1.5 * baseMaterialUTS;
  const b        = (isCalibrated && calib?.fatigueBasquinB != null) ? calib.fatigueBasquinB : -0.1;

  let estimatedCycles: number | null = null;
  if (sigmaEqA <= Se) {
    estimatedCycles = null; // infinite life
  } else {
    const N = Math.pow(sigmaEqA / sigmaf, 1 / b);
    estimatedCycles = Math.max(1, Math.round(N));
  }

  const fatigueConcern = fatigueSF < 1.0 || (estimatedCycles !== null && estimatedCycles < 100_000);

  const cycleStr = estimatedCycles === null
    ? 'infinite life (below endurance limit)'
    : estimatedCycles < 1_000
    ? `~${estimatedCycles.toLocaleString()} cycles — part will fail quickly under cyclic loading`
    : estimatedCycles < 100_000
    ? `~${estimatedCycles.toLocaleString()} cycles — fatigue concern for competition use (~${(estimatedCycles/500).toFixed(0)} matches)`
    : `~${estimatedCycles.toLocaleString()} cycles — adequate for competition use`;

  return {
    estimatedCycles,
    fatigueConcern,
    fatigueSF: +fatigueSF.toFixed(2),
    enduranceLimitMPa: +Se.toFixed(1),
    utsMPa: +utsMPa.toFixed(1),
    loadRatio: R,
    confidence: isCalibrated ? "medium" : "low",
    note: `${R === 0 ? "Pulsating load (R=0)" : `Load ratio R=${R.toFixed(2)}`}: ${cycleStr}. ` +
          `σ_a=${sigma_a.toFixed(1)} MPa, σ_m=${sigma_m_eff.toFixed(1)} MPa. ` +
          `Se=${Se.toFixed(1)} MPa (${(seRatio*100).toFixed(0)}% of ${isCalibrated ? "measured" : "base"} UTS ${baseMaterialUTS.toFixed(0)} MPa, ${orientation} orientation). ` +
          (isCalibrated
            ? `Using CALIBRATED S-N fit from cyclic coupon data (Se/UTS and Basquin b=${b.toFixed(3)} measured on your printer/filament). Goodman criterion + Basquin.`
            : `FDM fatigue data sparse — treat as order-of-magnitude. Goodman criterion + Basquin b=-0.1. Run a fatigue coupon (POST /api/calibration/fatigue) to raise confidence. Source: Wang et al. 2020.`),
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
   * Top/bottom solid-skin (floor/ceiling) band thicknesses, mm — present when
   * the two-region model classified independent skins (topLayers/bottomLayers
   * supplied). Null when skins were not modeled (fell back to the perimeter band).
   */
  skinTopThicknessMm?:  number | null;
  skinBotThicknessMm?:  number | null;
  /**
   * Build axis the skin classification used. "bed" = the picked bed normal;
   * "assumed-z-up" = no bed picked, so global +Z was assumed (skins may be
   * misplaced if the part is not modeled Z-up). Absent when skins not modeled.
   */
  skinBuildAxis?:       "bed" | "assumed-z-up";
  /** Shell (dense wall) share of part volume from the geometric classification. */
  shellVolumeFraction:  number | null;
  shellYieldXYMPa:      number | null;
  coreYieldXYMPa:       number | null;
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
    interfaceTempC: number;
    substrateTempC: number;
    coolTimeConstS: number;
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
    note?:                string;
  } | null;
}

export interface AnalysisResult {
  materialModel:           MaterialModelInfo;
  vertexStress:            Float32Array;
  vertexPrincipalStress:   Float32Array;
  vertexPrincipalStress2:  Float32Array;
  vertexPrincipalStress3:  Float32Array;
  vertexDisplacement:      Float32Array;
  surfaceTriangleCount:   number;
  maxVonMisesMPa:         number;
  maxDisplacementMm:      number;
  effectiveYieldMPa:      number;
  safetyFactor:           number | null;
  /** Which yield criterion produced the headline safetyFactor (issue #97).
   *  "fdm-interface" = the decoupled dual criterion (default);
   *  "hill" = legacy Hill 1948 (upright-no-bed fallback or explicit opt-in). */
  sfCriterion:            "fdm-interface" | "hill" | "von-mises";
  /**
   * Von Mises SF (effectiveYield / maxVM) — what a conventional isotropic
   * check gives on the same stress field. Kept for display/comparison next
   * to the Hill-based headline SF.
   */
  vonMisesSafetyFactor:   number | null;
  estimatedFailForce:     number;
  /** Conservative SF using lower bound of literature uncertainty range */
  safetyfactorLow:        number | null;
  /** Optimistic SF using upper bound of literature uncertainty range */
  safetyFactorHigh:       number | null;
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
  };
  /** CG solver residual checkpoints for convergence visualization */
  residualCheckpoints?:   readonly { iteration: number; relativeResidual: number }[];
  /** Zienkiewicz-Zhu error estimate η_e at each vertex, projected from elements */
  vertexErrorEstimateB64?: string;
  /** Global relative error η for mesh quality assessment */
  globalRelativeError?:    number;
  /** Top-20 elements with highest error estimates, for refinement guidance */
  topErrorElements?:       Array<{ x: number; y: number; z: number; errorEstimate: number }>;
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
 *   2. Compute average stress in a 1mm radius neighborhood
 *   3. If peak/neighborhood ratio > 3.0, flag as likely singularity
 *   4. Additional check: if peak stress vertex has very few neighboring triangles
 *      (isolated point), more likely to be a singularity
 *
 * This is a heuristic. False positives possible at genuine stress concentrations
 * (e.g. tight hole radii). Confidence is reported accordingly.
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
  if (constrainedIdx.length < 2) return null; // need at least 2 points for a meaningful axis

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

function detectSingularity(
  vertexStress:  Float32Array,
  positions:     Float64Array,
  surfaceTris:   Int32Array | null,
  meshScale:     number,
): SingularityWarning | null {
  if (vertexStress.length === 0) return null;

  // Find peak stress vertex index
  let peakIdx = 0, peakVal = 0;
  for (let i = 0; i < vertexStress.length; i++) {
    if ((vertexStress[i] ?? 0) > peakVal) {
      peakVal = vertexStress[i]!;
      peakIdx = i;
    }
  }
  if (peakVal < 0.1) return null;  // trivial stress, no singularity concern

  // Get peak vertex position
  const px = positions[peakIdx * 3]     ?? 0;
  const py = positions[peakIdx * 3 + 1] ?? 0;
  const pz = positions[peakIdx * 3 + 2] ?? 0;

  // Find all vertices within 1mm radius and compute their average stress
  const radius1mm = 1.0 / meshScale;  // 1mm in model units
  let neighborSum = 0, neighborCount = 0;
  const nVerts = vertexStress.length;

  for (let i = 0; i < nVerts; i++) {
    if (i === peakIdx) continue;
    const dx = (positions[i * 3]     ?? 0) - px;
    const dy = (positions[i * 3 + 1] ?? 0) - py;
    const dz = (positions[i * 3 + 2] ?? 0) - pz;
    const dist2 = dx*dx + dy*dy + dz*dz;
    if (dist2 < radius1mm * radius1mm) {
      neighborSum   += vertexStress[i] ?? 0;
      neighborCount++;
    }
  }

  if (neighborCount === 0) {
    // Completely isolated peak — strong singularity indicator
    return {
      detected:           true,
      peakVertexIdx:      peakIdx,
      peakStressMPa:      peakVal,
      stressAt1mmMPa:     0,
      concentrationRatio: 999,
      confidence:         "medium",
      message: `Peak stress vertex (${peakVal.toFixed(1)} MPa) has no neighbors within 1mm — isolated point stress. This is likely a geometric singularity at a sharp corner. The true stress is lower. Add a fillet radius of ≥0.5mm to resolve.`,
    };
  }

  const avgNeighbor = neighborSum / neighborCount;
  const ratio       = avgNeighbor > 0.1 ? peakVal / avgNeighbor : 0;

  // Ratio > 3 AND stress > 2× yield → likely singularity
  const likelySingularity = ratio > 3.0 && peakVal > 50;

  if (!likelySingularity) return null;

  const confidence: "high" | "medium" | "low" =
    ratio > 6 ? "high" : ratio > 4 ? "medium" : "low";

  return {
    detected:           true,
    peakVertexIdx:      peakIdx,
    peakStressMPa:      peakVal,
    stressAt1mmMPa:     +avgNeighbor.toFixed(1),
    concentrationRatio: +ratio.toFixed(1),
    confidence,
    message: `Peak stress ${peakVal.toFixed(1)} MPa is ${ratio.toFixed(1)}× higher than the 1mm neighborhood average (${avgNeighbor.toFixed(1)} MPa). This gradient suggests a geometric singularity at a sharp re-entrant corner. The safety factor may be artificially low. Add a fillet radius ≥0.5mm at this location in your CAD model.`,
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
  vertexStress:  Float32Array,
  positions:     Float64Array,
  meshNodes:     Float64Array,
  meshScale:     number,
  meshOffset:    [number, number, number],
  singularityIdx: number | null,
  bounds:        { minX:number; maxX:number; minY:number; maxY:number; minZ:number; maxZ:number },
): TopologySuggestion[] {
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
    const d = (nodes[n*3]??0-px)**2 + (nodes[n*3+1]??0-py)**2 + (nodes[n*3+2]??0-pz)**2;
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
      )
    : buildOrthotropicMaterial(
        req.print.materialId,
        strengthMul,
        req.print.orientation,
        req.print.layerHeightMm ?? 0.2,
        req.calibration ?? null,
        weakAxis,
        bondRel,
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

  if (req.fileType === "step" && req.stepBuffer) {
    // ── STEP path: Gmsh with curvature-based refinement ──────────────────────
    const clOpts = {
      coarse:   { clMin: 0.5, clMax: 4.0, clCurv: 15 },
      standard: { clMin: 0.3, clMax: 3.0, clCurv: 20 },
      fine:     { clMin: 0.2, clMax: 2.0, clCurv: 30 },
    };
    const opts = clOpts[req.analysis.meshQuality as keyof typeof clOpts] ?? clOpts.standard;
    const elementOrder = req.analysis.meshOrder ?? 2;
    _snapAnalysis("before Gmsh mesh");
    console.log("[analysis] meshing STEP with Gmsh...");
    gmshResult = await meshStepWithGmsh(req.stepBuffer, { ...opts, elementOrder });
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
      // so the control actually affects STL mesh density. 'standard' keeps the
      // historical 10 mm³. (Previously the selector only affected the STEP path.)
      const tetMaxVol = req.analysis.meshQuality === "fine" ? 3
                      : req.analysis.meshQuality === "coarse" ? 30
                      : 10;
      console.log(`[analysis] meshing with TetGen (order=${tetOrder}, maxVol=${tetMaxVol}mm³, quality=${req.analysis.meshQuality})...`);
      const tetResult = await meshWithTetGen(req.positions, req.triangleCount, tetOrder, tetMaxVol);
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
  let materialModel: MaterialModelInfo = {
    twoRegion: false,
    wallThicknessMm: null,
    shellVolumeFraction: null,
    shellYieldXYMPa: null,
    coreYieldXYMPa: null,
    impliedAvgStrengthMul: null,
    globalModelStrengthMul: strengthMul * orientFallbackMul,
    ...(bondRel ? { bond: {
      relStrength:    +bondRel.relStrength.toFixed(4),
      relStiffness:   +bondRel.relStiffness.toFixed(4),
      interfaceTempC: +bondRel.interfaceTempC.toFixed(1),
      substrateTempC: +bondRel.substrateTempC.toFixed(1),
      coolTimeConstS: +bondRel.coolTimeConstS.toFixed(2),
      clamped:        bondRel.clamped,
      confidence:     bondRel.confidence,
      note:           bondRel.note,
    } } : {}),
  };
  if (req.analysis.twoRegion) {
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
      // thickness is layers × layer height, generally different from the
      // vertical perimeter band. Skins are the SAME solid material as the
      // perimeters (same weak axis), so only the geometry changes. When the
      // user supplies no skin layer counts, the skin bands default to tWall and
      // the classifier reduces bit-identically to the single-band path.
      const layerH = req.print.layerHeightMm ?? 0.2;
      const clampLayers = (n: number | undefined): number | undefined =>
        n === undefined ? undefined : Math.min(64, Math.max(0, n));
      const topLayers = clampLayers(req.print.topLayers);
      const botLayers = clampLayers(req.print.bottomLayers);
      const skinRequested = topLayers !== undefined || botLayers !== undefined;
      const tSkinTop = topLayers !== undefined ? topLayers * layerH : tWall;
      const tSkinBot = botLayers !== undefined ? botLayers * layerH : tWall;
      // Build axis for skin geometry: the picked bed normal, else assume Z-up.
      const skinBuildAxis: "bed" | "assumed-z-up" = weakAxis ? "bed" : "assumed-z-up";
      const buildAxis = weakAxis ?? ([0, 0, 1] as const);
      const skin = skinRequested ? { buildAxis, tSkinTop, tSkinBot } : undefined;

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
        // Estimated from the classified perimeter-face area (exact for a
        // prismatic part); degenerates (near-zero height, no perimeter
        // faces) fall back to a fixed characteristic length.
        const perimeterEstimate = estimateWallLoopPerimeterMm(mesh, surfaceFaces, buildAxis);
        const perimeterFallback = !(perimeterEstimate > 1e-6);
        const passLengthMmWall = perimeterFallback ? WALL_BOND_PASS_LENGTH_FALLBACK_MM : perimeterEstimate;

        const bondRelWall: BondPrediction | null = hasProcessSettings(req.print.process)
          ? predictBondMultipliers(
              req.print.materialId,
              lineWidth,
              req.print.process,
              req.calibration?.bondCoeffs ?? null,
              passLengthMmWall,
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
            ...(bondRelWall ? { note: bondRelWall.note } : {}),
          } : null,
        };
      }

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
        skinTopThicknessMm: skinRequested ? tSkinTop : null,
        skinBotThicknessMm: skinRequested ? tSkinBot : null,
        ...(skinRequested ? { skinBuildAxis } : {}),
        shellVolumeFraction: Vf,
        shellYieldXYMPa: shellMat.yieldXY,
        coreYieldXYMPa: coreMat.yieldXY,
        impliedAvgStrengthMul,
        core: {
          model: "gibson-ashby",
          patternFamily: family,
          stiffnessExponent: req.calibration?.latticeStiffExp ?? LATTICE_PARAMS[family].stiffExpXY,
          strengthExponent:  req.calibration?.latticeStrengthExp ?? LATTICE_PARAMS[family].strengthExp,
          stiffnessScale: gStiff,
          strengthScale:  sStr,
          floored: gStiff <= LATTICE_STIFFNESS_FLOOR,
          confidence: "LOW",
        },
      };
      console.log(
        `[analysis] two-region model: tWall=${tWall.toFixed(2)}mm, ` +
        (skinRequested
          ? `skins top=${tSkinTop.toFixed(2)}mm bot=${tSkinBot.toFixed(2)}mm (${skinBuildAxis}), `
          : ``) +
        `shell Vf=${(Vf * 100).toFixed(1)}%, ` +
        `bins=${tr.field ? tr.field.binCount : "collapsed-to-uniform"}, ` +
        `impliedAvgMul=${impliedAvgStrengthMul.toFixed(3)} vs globalMul=${strengthMul.toFixed(3)}`
      );
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
          `${nLoaded} loaded triangles, |resultant|~${resN.toFixed(2)}N`);
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
      console.log(`[analyse] modal: ${modalResult.modes.length} modes, f1=${modalResult.modes.find(m => m.frequencyHz > 1)?.frequencyHz.toFixed(1) ?? '?'}Hz`);
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

      const Ksigma = assembleKsigma(mesh, result.elemStress6, Kbuck.rowPtr, Kbuck.colIdx);
      const bResult = await runLinearBuckling(Kbuck, Ksigma, buckDiagIdx);
      bucklingConverged     = bResult.converged;
      bucklingTensile       = bResult.tensileDominated;
      bucklingIndeterminate = bResult.indeterminate;
      // Do NOT surface a non-physical (indeterminate) eigenvalue as a BLF.
      if (!bResult.indeterminate) bucklingBLF = bResult.blf;
      // Keep the mode shape only when a physical positive BLF was found.
      if (!bResult.indeterminate && !bResult.tensileDominated && bResult.blf > 0) {
        bucklingMode = bResult.modeShape;
      }
      console.log(`[buckling] BLF=${bResult.blf.toFixed(3)} converged=${bResult.converged} iters=${bResult.iterations} tensile=${bResult.tensileDominated} indeterminate=${bResult.indeterminate}`);
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
  _snapAnalysis("before sprSmoothedStress");
  const nodeStress = sprSmoothedStress(mesh, result.vonMises);
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

  const nodeStress6 = result.elemStress6
    ? sprSmoothedStress6(mesh, result.elemStress6)
    : null;

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
  // Headline SF (issue #97): the solver's per-element Hill (1948) minimum SF —
  // uses the calibrated, anisotropic yield of the material actually solved.
  // The von Mises SF is kept alongside for display/comparison.
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

  // Estimate failure force: linear scaling from applied loads
  const totalAppliedForce = req.forces.reduce((sum, f) => sum + f.magnitude, 0) || 1;
  const estimatedFailForce = totalAppliedForce * sf;

  // Yielding per the same criterion that produced the headline SF
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
                     `thresholds (FAIL <1.5×, MARGINAL <3.0×) already embed this knockdown — see SOURCES tab.${convergeNote}`,
      });
    } else if (bucklingIndeterminate) {
      // Eigensolver converged only to a negative (tension-driven) eigenvalue,
      // even after a deflated restart — a positive BLF may exist but was not
      // found. Report indeterminate rather than a misleading number.
      allFailureModes.push({
        mode:       "Linear buckling (BLF)",
        sf:          0,
        failForceN:  0,
        checked:     false,
        confidence:  "unchecked",
        note:        "Buckling factor indeterminate: mixed tension/compression pre-stress — " +
                     "the eigensolver found only a non-physical (negative) mode. " +
                     "Treat buckling as UNCHECKED for this load case.",
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

  // Override verdict if any failure mode governs below bulk yield
  const checkedModes  = allFailureModes.filter(m => m.checked);
  const lowestSF      = checkedModes.length > 0
    ? Math.min(...checkedModes.map(m => m.sf))
    : sf;
  const governingMode2 = checkedModes.find(m => m.sf === lowestSF);
  const baseVerdict = !result.converged
    // An unconverged solve gives an unreliable stress field, so the safety
    // factor cannot be trusted in either direction — never report "Safe".
    ? `Inconclusive — solver did not converge (${result.cgIterations} iters). ` +
      `SF ${lowestSF.toFixed(2)}× shown for reference only; re-run with a finer mesh or check constraints.`
    : lowestSF < 1.0
    ? `Fails — predicted to yield at ${(totalForce2 * lowestSF).toFixed(0)} N (${governingMode2?.mode ?? "bulk yield"})`
    : lowestSF < 1.5
    ? `Marginal — limited margin (SF ${lowestSF.toFixed(2)}×, governed by ${governingMode2?.mode ?? "bulk yield"})`
    : lowestSF < 2.5
    ? `Safe — adequate margin (SF ${lowestSF.toFixed(2)}×)`
    : `Safe — large margin (SF ${lowestSF.toFixed(2)}×)`;

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
  const singularity = detectSingularity(
    vertexStress,
    mesh.nodes,
    null,
    1.0,
  );

  // ── Topology suggestions ──────────────────────────────────────────────────
  // mesh.nodes are already in the raw STL/world mm frame (TetGen meshes
  // req.positions, the box fallback spans req.bounds, and force/hole node
  // matching indexes these coords directly). So cluster centroids need no
  // un-normalization: pass scale=1 and a zero offset. A non-zero offset here
  // shifts every suggestion off the real stress region by half the part in
  // X/Y (and by minZ in Z), which is what made the diamond markers miss the
  // high-stress clusters and mis-report their near-edge/near-top context.
  const meshOffset: [number, number, number] = [0, 0, 0];
  const topologySuggestions = generateTopologySuggestions(
    vertexStress,
    mesh.nodes,
    mesh.nodes,
    1.0,
    meshOffset,
    singularity?.peakVertexIdx ?? null,
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
  const fatigue = estimateFatigue(
    fatigueStress,
    fatigueYield,
    req.print.materialId,
    req.print.orientation,
    req.fatigueLoadRatio ?? 0,
    req.calibration ?? null,
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
  const sfLow  = +(bandScalesSF ? sf * yieldMul_low  * lhMul_low  : sf).toFixed(2);
  const sfHigh = +(bandScalesSF ? sf * yieldMul_high * lhMul_high : sf).toFixed(2);

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

  return {
    materialModel,
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
    safetyFactor:       meshFallback ? null : sf,
    sfCriterion:        bulk.criterion,
    vonMisesSafetyFactor: meshFallback ? null : sfVonMises,
    safetyfactorLow:    meshFallback ? null : sfLow,
    safetyFactorHigh:   meshFallback ? null : sfHigh,
    estimatedFailForce,
    yielding,
    verdict:            governingVerdict,
    cgIterations:       result.cgIterations,
    converged:          result.converged,
    meshFallback,
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
    } : undefined,
    residualCheckpoints: result.residualCheckpoints,
    vertexErrorEstimateB64: vertexErrorEstimate ? Buffer.from(vertexErrorEstimate.buffer).toString("base64") : undefined,
    globalRelativeError: result.globalRelativeError,
    topErrorElements: result.topErrorElements ? [...result.topErrorElements] : undefined,
  };
}
