/**
 * analysis.ts
 * -----------
 * The core analysis pipeline for the local StressForm server.
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

import { generateBoxMesh }                  from "./solver/meshgen.js";
import { runLinearStatic, runLinearStaticWithK } from "./solver/pipeline.js";
import { runModalAnalysis }                from "./solver/modal.js";
import { runLinearBuckling }              from "./solver/buckling.js";
import { assembleK, assembleKsigma, buildSparsityPattern } from "./solver/assembly.js";
import { applyDirichletBC }    from "./solver/boundary.js";
import { assembleForceVector } from "./solver/load.js";
import type { ModalAnalysisResult }        from "./solver/types.js";
import {
  buildLaminateCMatrix,
  DEFAULT_BEAD_PROPS,
  PATTERN_PLY_ANGLES,
  type BeadProperties,
} from "./solver/laminate.js";

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
import type { IsotropicMaterial, AnyMaterial, OrthotropicMaterial } from "./solver/types.js";
import { isOrthotropic } from "./solver/types.js";
import { recoverElementStressComponents }   from "./solver/stress_detail.js";
import { sprSmoothedStress, sprSmoothedStress6, recoverElementStress, nodeAveragedPrincipalStress } from "./solver/stress.js";
import type { HoleFeature }                 from "./holes.js";
import { meshWithTetGen }                   from "./tetgen.js";
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
 * Check all applicable failure modes for a bolted hole connection.
 *
 * Modes checked:
 *  1. Bulk yield (from FEM) — high confidence
 *  2. Net-section tension — high confidence (classical formula)
 *  3. Shear-out — high confidence (classical formula, applies to lateral loads)
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
  effectiveYieldMPa: number;
  bulkSF:           number;
  orientation:      string;
  layerHeightMm:    number;
  calibratedBearingStrMPa?: number | null;
  bearingStressMult?: number;
}): FailureModeResult[] {
  const { holeClass, plateThicknessMm, edgeDistMm, holeSeparationMm,
          appliedForceN, effectiveYieldMPa, bulkSF, orientation,
          layerHeightMm, calibratedBearingStrMPa } = params;
  const bearingStressMult = params.bearingStressMult ?? 1.0;

  const results: FailureModeResult[] = [];
  const bolt = holeClass.bolt;
  const d    = holeClass.detectedDiamMm;
  const F    = appliedForceN;
  const t    = plateThicknessMm;
  const Sy   = effectiveYieldMPa;
  const lhf  = layerHeightFactor(layerHeightMm);

  // Inter-layer shear strength.
  // Base ratio updated from literature review (June 2026):
  //   flat:   0.42 (was 0.40) — conservative, Z-direction failure
  //   upright: 0.58 (was 0.55) — aligned with yieldZ/yieldXY = 0.58
  // Source: Cojocaru et al. 2019 measured 0.59; Rodriguez et al. 2001 ~0.50.
  // Using 0.42/0.58 as slightly conservative central estimates.
  const shearBase     = orientation === "upright" ? 0.58 : 0.42;
  const shearStrength = Sy * shearBase * lhf;

  const lhNote = `layer height ${layerHeightMm}mm (factor ${lhf.toFixed(2)}×)`;

  // ── 1. Bulk yield (from FEM) ──────────────────────────────────────────────
  results.push({
    mode:       "Bulk yield",
    sf:          bulkSF,
    failForceN:  F * bulkSF,
    checked:     true,
    confidence:  "high",
    note:        "Von Mises stress from FEM vs effective yield. Most reliable result.",
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
      note:        `Two shear planes from hole to plate edge. Inter-layer shear strength: ${shearStrength.toFixed(0)} MPa (${(shearBase*100).toFixed(0)}% of yield × ${lhNote}).`,
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
}

export const COUPON_DIMS = {
  tensile: {
    gaugeWidthMm:   10.0,
    gaugeThickMm:    4.0,
    gaugeLengthMm:  50.0,
    description:    "Standard dog-bone, print flat, pull along length",
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
   * Stress-concentration factors from FEA-in-the-loop (see coupon_fea.ts).
   * Kt = peak/nominal stress for that coupon's geometry. Converts the nominal
   * F/A strength into a PEAK-based allowable consistent with how StressForm
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

  // Lap-shear: the single-lap joint concentrates shear at the overlap ends, so
  // nominal F/A_overlap underestimates the true peak. Multiply by Kt (from the
  // solver) to get the peak-based interlaminar shear strength.
  let shearStr_MPa: number | null = null;
  let yieldZ_MPa:   number | null = null;
  if (lapShearFailN !== null) {
    const area   = COUPON_DIMS.lapShear.overlapWidthMm * COUPON_DIMS.lapShear.overlapLengthMm;
    shearStr_MPa = ktLapShear * (lapShearFailN / area);
    yieldZ_MPa   = shearStr_MPa / 0.58;
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

  return {
    id, label, materialId, layerHeightMm,
    createdAt:           new Date().toISOString(),
    yieldXY_MPa,
    yieldZ_MPa,
    E_xy_MPa,
    bearingStr_MPa,
    shearStr_MPa,
    E_z_over_E_xy:       FDM_ORTHO_RATIOS.E_z_over_E_xy,
    yieldZ_over_yieldXY: finalYieldZ / finalYieldXY,
    G_xz_over_G_xy:      FDM_ORTHO_RATIOS.G_xz_over_G_xy,
  };
}

// ─── Base properties (solid, 100% infill, isotropic approximation) ─────────
const MATERIALS: Record<string, { E: number; nu: number; yieldMPa: number; label: string }> = {
  pla:   { E: 3500,  nu: 0.36, yieldMPa: 50,  label: "PLA"   },
  petg:  { E: 2100,  nu: 0.38, yieldMPa: 45,  label: "PETG"  },
  abs:   { E: 2300,  nu: 0.35, yieldMPa: 40,  label: "ABS"   },
  tpu:   { E:  200,  nu: 0.48, yieldMPa: 15,  label: "TPU"   },
  pa12:  { E: 1700,  nu: 0.40, yieldMPa: 48,  label: "PA12 (Nylon)" },
  asa:   { E: 2100,  nu: 0.35, yieldMPa: 40,  label: "ASA"   },
};

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


function buildOrthotropicMaterialCLT(
  baseMatId:       string,
  infillPct:       number,
  pattern:         string,
  orientation:     string,
  layerHeightMm:   number,
  strengthMul:     number,
  calibration?:    CalibrationProfile | null,
  beadPropsOverride?: BeadProperties,
): OrthotropicMaterial {
  const base = MATERIALS[baseMatId] ?? MATERIALS["pla"]!;
  const lhf  = layerHeightFactor(layerHeightMm);

  const yieldXY_base = calibration?.yieldXY_MPa ?? base.yieldMPa;
  const E_z_ratio    = calibration?.E_z_over_E_xy    ?? FDM_ORTHO_RATIOS.E_z_over_E_xy;
  const yZ_ratio     = calibration?.yieldZ_over_yieldXY ?? FDM_ORTHO_RATIOS.yieldZ_over_yieldXY;
  const Gxz_ratio    = calibration?.G_xz_over_G_xy  ?? FDM_ORTHO_RATIOS.G_xz_over_G_xy;

  const bead = beadPropsOverride ?? DEFAULT_BEAD_PROPS[baseMatId] ?? DEFAULT_BEAD_PROPS["pla"]!;
  const plyStack = PATTERN_PLY_ANGLES[pattern] ?? PATTERN_PLY_ANGLES["grid"]!;

  const yieldXY = yieldXY_base * strengthMul;
  const yieldZ  = yieldXY * yZ_ratio * lhf;

  // Derive Z-direction properties from the empirical bond model
  // (CLT only replaces in-plane stiffness; Z is still bond-dominated)
  const E_xy_empirical = (calibration?.E_xy_MPa ?? base.E) * Math.min(1.0, strengthMul / 0.55);
  const E_z    = E_xy_empirical * E_z_ratio * lhf;
  const G_xy   = E_xy_empirical / (2 * (1 + base.nu));
  const G_xz   = G_xy * Gxz_ratio * lhf;
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

  if (orientation === "upright") {
    return {
      kind: "orthotropic",
      E_xy: mat.E_z, E_z: mat.E_xy,
      nu_xy: mat.nu_xy, nu_xz: mat.nu_xz, G_xz: mat.G_xz,
      yieldXY: mat.yieldZ, yieldZ: mat.yieldXY,
      label: mat.label.replace(`, ${orientation}`, ", upright"),
    };
  }
  return mat;
}

function buildOrthotropicMaterial(
  baseMatId:       string,
  strengthMul:     number,
  orientation:     string,
  layerHeightMm:   number,
  calibration?:    CalibrationProfile | null,
): OrthotropicMaterial {
  const base = MATERIALS[baseMatId] ?? MATERIALS["pla"]!;
  const lhf  = layerHeightFactor(layerHeightMm);

  // Use calibrated values where available, fall back to literature
  const E_xy_base    = calibration?.E_xy_MPa    ?? base.E;
  const yieldXY_base = calibration?.yieldXY_MPa ?? base.yieldMPa;
  const E_z_ratio    = calibration?.E_z_over_E_xy    ?? FDM_ORTHO_RATIOS.E_z_over_E_xy;
  const yZ_ratio     = calibration?.yieldZ_over_yieldXY ?? FDM_ORTHO_RATIOS.yieldZ_over_yieldXY;
  const Gxz_ratio    = calibration?.G_xz_over_G_xy  ?? FDM_ORTHO_RATIOS.G_xz_over_G_xy;

  const E_xy    = E_xy_base    * Math.min(1.0, strengthMul / 0.55);
  const E_z     = E_xy         * E_z_ratio * lhf;
  const G_xy    = E_xy         / (2 * (1 + base.nu));
  const G_xz    = G_xy         * Gxz_ratio * lhf;
  const nu_xy   = base.nu;
  const nu_xz   = FDM_ORTHO_RATIOS.nu_xz;
  const yieldXY = yieldXY_base * strengthMul;
  const yieldZ  = yieldXY      * yZ_ratio  * lhf;

  const src = calibration ? `calibrated:${calibration.id}` : "literature";

  if (orientation === "upright") {
    return {
      kind: "orthotropic",
      E_xy: E_z, E_z: E_xy,
      nu_xy, nu_xz, G_xz,
      yieldXY: yieldZ, yieldZ: yieldXY,
      label: `${base.label} (orthotropic, upright, lh=${layerHeightMm}mm, ${src})`,
    };
  }
  return {
    kind: "orthotropic",
    E_xy, E_z, nu_xy, nu_xz, G_xz, yieldXY, yieldZ,
    label: `${base.label} (orthotropic, flat, lh=${layerHeightMm}mm, ${src})`,
  };
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

// Pattern multipliers — conservative, treat as approximate guidance only
// The spread between patterns is kept small because the literature is inconsistent.
// The main variable that matters is orientation, not pattern.
const PATTERN_MULTIPLIERS: Record<string, number> = {
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

export function effectiveStrengthMultiplier(
  infillPct:   number,
  wallCount:   number,
  pattern:     string,
  orientation: string,
): number {
  const infillMul  = infillStrengthCurve(infillPct);
  const wallBonus  = (wallCount - 1) * 0.10;
  const combined   = Math.min(1.0, infillMul + wallBonus);
  const patternMul = PATTERN_MULTIPLIERS[pattern] ?? 1.0;
  const orientMul  = orientation === "flat"    ? 0.55
                   : orientation === "upright" ? 0.90
                   : 0.75;

  return combined * patternMul * orientMul;
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

export interface PrintSettings {
  materialId:    string;
  infillPct:     number;
  wallCount:     number;
  pattern:       string;
  orientation:   string;
  layerHeightMm: number;
  /** Element order: 1 = C3D4 linear, 2 = C3D10 quadratic (default). */
  meshOrder?:    1 | 2;
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
  /** Print settings */
  print:         PrintSettings;
  meshQuality:   string;
  calibration?:  CalibrationProfile | null;
  /** User-specified bolt type overrides per hole id, e.g. {0: 'M3_clearance', 1: 'M3_tapped'} */
  holeTypeOverrides?: Record<number, string> | null;
  /** Default: 'linear_static'. Set to 'modal' to also compute natural frequencies. */
  analysisType?: 'linear_static' | 'modal';
  /**
   * Material uncertainty mode. When 'central' (default) the solver uses the literature
   * central estimates. The server always computes sfConservative and sfOptimistic alongside
   * the central SF regardless of this field — it is reserved for future single-mode runs.
   */
  uncertaintyMode?: 'central' | 'conservative' | 'optimistic';
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
 *   - Pulsating load (R=0): σ_min=0, σ_max=peak VM, σ_m=σ_a=σ_max/2
 *     (conservative for FTC mechanisms — most see repeated 0→peak loading)
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
): FatigueEstimate {
  // Base material UTS — use literature values, not FDM-reduced yield
  // UTS ≈ 1.15-1.25 × yield for PLA-like polymers
  // For FDM, we use the effective yield as the strength basis
  // BUT the endurance limit ratio applies to actual tested UTS of solid specimens
  const BASE_UTS: Record<string, number> = {
    pla:  65, petg: 55, abs: 48, tpu: 30, pa12: 58, asa: 48,
  };
  const baseMaterialUTS = BASE_UTS[materialId] ?? 55;

  // Endurance limit Se — orientation-adjusted, based on BASE UTS
  // Flat prints: Se ≈ 0.37 × UTS (inter-layer bonds are the weak link)
  // Upright:    Se ≈ 0.43 × UTS
  // Source: Wang et al. 2020 PLA fatigue, Juvinall §7
  const seRatio = orientation === 'upright' ? 0.43 : 0.37;
  const Se = baseMaterialUTS * seRatio;

  // For Goodman, we need UTS. Use effective yield as a proxy for actual UTS
  // (FDM parts typically fracture near yield for brittle-ish PLA)
  const utsMPa = Math.max(effectiveYieldMPa * 1.15, Se * 1.5);

  // Pulsating load (R=0): σ_m = σ_a = σ_max / 2
  const sigma_a = peakVonMisesMPa / 2;
  const sigma_m = peakVonMisesMPa / 2;

  // Modified Goodman: 1/SF = σ_a/Se + σ_m/Su
  const goodmanDemand = (sigma_a / Se) + (sigma_m / utsMPa);
  const fatigueSF     = goodmanDemand > 0 ? 1 / goodmanDemand : 999;

  // Basquin cycles to failure
  // σ_a,eq = σ_a / (1 - σ_m/Su)  [Goodman-corrected amplitude]
  const sigmaEqA = sigma_a / Math.max(0.01, 1 - sigma_m / utsMPa);
  const sigmaf   = 1.5 * baseMaterialUTS;
  const b        = -0.1;

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
    loadRatio: 0,
    confidence: "low",
    note: `Pulsating load (R=0): ${cycleStr}. Se=${Se.toFixed(1)} MPa (${(seRatio*100).toFixed(0)}% of base UTS ${baseMaterialUTS} MPa, ${orientation} orientation). ` +
          `FDM fatigue data sparse — treat as order-of-magnitude. Goodman criterion + Basquin b=-0.1. ` +
          `Source: Wang et al. 2020.`,
  };
}

// ─── Anisotropic utilization ratios (Hill-derived, dual-criterion heatmap) ────
/**
 * Per-node anisotropic utilization ratios:
 *
 *   U_XY = sqrt(σxx² + σyy² − σxx·σyy + 3·τxy²) / yieldXY
 *          (in-plane von Mises measure vs in-plane yield Y)
 *   U_Z  = max(|σzz|, √3·sqrt(τyz² + τxz²)) / yieldZ
 *          (through-layer normal or interlayer shear vs bond yield Z;
 *           the √3 factor comes from Hill L = M = 3/(2Z²), i.e. the shear
 *           yield in Z-planes is Z/√3)
 *
 * Exported for unit testing (tests/unit/hill-utilization.test.ts).
 */
export function computeUtilizationRatios(
  sxx: number, syy: number, szz: number,
  txy: number, tyz: number, txz: number,
  yieldXY: number, yieldZ: number,
): { uXY: number; uZ: number } {
  const uXY = Math.sqrt(Math.max(0, sxx*sxx + syy*syy - sxx*syy + 3*txy*txy)) / yieldXY;
  const normalZ = Math.abs(szz);
  const shearZ  = Math.sqrt(3) * Math.sqrt(tyz*tyz + txz*txz);
  const uZ = Math.max(normalZ, shearZ) / yieldZ;
  return { uXY, uZ };
}

// ─── Cosine-bearing nodal force distribution ──────────────────────────────────
/**
 * Distribute a bolt bearing load over the loaded-face nodes using a cosine
 * distribution: w(θ) = max(0, cos θ), where θ is the angle between the node
 * position (relative to the hole centre) and the force direction. The weights
 * are normalized so the vector sum of the nodal forces equals the applied
 * force exactly; the peak occurs at the contact point (θ = 0) and the load
 * tapers to zero at θ = ±90°. If no node faces the force direction (all
 * weights zero), the load is distributed uniformly instead.
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
  let wSum = Array.from(weights).reduce((a,b)=>a+b, 0);
  if (wSum < 1e-12) {
    // Edge case: no node faces the force direction (all cos θ ≤ 0) — e.g. the
    // hole-face centroid sits ahead of every node. Fall back to a uniform
    // distribution instead of dividing by ~0 and emitting NaN forces.
    weights.fill(1);
    wSum = k;
  }
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
  /** Whether the isotropic model would call this part safe (SF >= 1) when StressForm says it fails */
  falseSafe:          boolean;
  /** Short plain-English explanation for the judge panel */
  explanation:        string;
}

export interface AnalysisResult {
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
  fatigue:                FatigueEstimate;
  isotropicComparison:    IsotropicComparison;
  /** Mode shapes projected to surface vertices, one per mode. Base64-encoded Float32Array. */
  vertexModeShapesB64?:   string[];
  /** Present when analysisType === 'modal'. Undefined for static-only runs. */
  modalResult?:           ModalAnalysisResult;
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
function findHoleWallNodes(
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

  // ── Material + print settings ───────────────────────────────────────────────
  const baseMat = MATERIALS[req.print.materialId] ?? MATERIALS["pla"]!;
  const strengthMul = effectiveStrengthMultiplier(
    req.print.infillPct,
    req.print.wallCount,
    req.print.pattern ?? "grid",
    req.print.orientation,
  );
  const effectiveYield = baseMat.yieldMPa * strengthMul;

  // Use orthotropic material model — accurately captures the anisotropy of FDM parts.
  // For flat prints: E_z ≈ 0.45 × E_xy, G_xz ≈ 0.40 × G_xy (Ahn et al. 2002)
  // For upright prints: axes are swapped — the strong direction faces the load
  const material: AnyMaterial = req.print.useCLT
    ? buildOrthotropicMaterialCLT(
        req.print.materialId,
        req.print.infillPct,
        req.print.pattern ?? "grid",
        req.print.orientation,
        req.print.layerHeightMm ?? 0.2,
        strengthMul,
        req.calibration ?? null,
        req.print.beadProps,
      )
    : buildOrthotropicMaterial(
        req.print.materialId,
        strengthMul,
        req.print.orientation,
        req.print.layerHeightMm ?? 0.2,
        req.calibration ?? null,
      );

  // ── Build volume mesh ──────────────────────────────────────────────────────
  let mesh: import("./solver/types.js").TetMesh;
  let surfaceToNode: Int32Array;
  let gmshResult: import("./gmsh_mesh.js").GmshMeshResult | null = null;
  let meshFallback = false;

  if (req.fileType === "step" && req.stepBuffer) {
    // ── STEP path: Gmsh with curvature-based refinement ──────────────────────
    const clOpts = {
      coarse:   { clMin: 0.5, clMax: 4.0, clCurv: 15 },
      standard: { clMin: 0.3, clMax: 3.0, clCurv: 20 },
      fine:     { clMin: 0.2, clMax: 2.0, clCurv: 30 },
    };
    const opts = clOpts[req.meshQuality as keyof typeof clOpts] ?? clOpts.standard;
    const elementOrder = req.print.meshOrder ?? 2;
    _snapAnalysis("before Gmsh mesh");
    console.log("[analysis] meshing STEP with Gmsh...");
    gmshResult = await meshStepWithGmsh(req.stepBuffer, { ...opts, elementOrder });
    mesh = gmshResult.mesh;
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
      const tetOrder = (req.print.meshOrder ?? 2) as 1 | 2;
      console.log(`[analysis] meshing with TetGen (order=${tetOrder})...`);
      const tetResult = await meshWithTetGen(req.positions, req.triangleCount, tetOrder);
      mesh          = tetResult.mesh;
      surfaceToNode = tetResult.surfaceToNode;
      console.log(`[analysis] TetGen mesh: ${mesh.nodeCount} nodes, ${mesh.elementCount} elements (${mesh.nodesPerElem}-node)`);
      _snapAnalysis("after TetGen mesh");
    } catch (err) {
      console.warn("[analysis] TetGen failed, falling back to C3D4 box mesh (C3D10 not available in fallback):", err);
      meshFallback = true;
      const { minX, maxX, minY, maxY, minZ, maxZ } = req.bounds;
      const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
      const divisions = req.meshQuality === "fine" ? 32 : req.meshQuality === "coarse" ? 12 : 22;
      const aspect = Math.max(spanX, spanY, spanZ);
      const nx = Math.max(4, Math.round(divisions * spanX / aspect));
      const ny = Math.max(4, Math.round(divisions * spanY / aspect));
      const nz = Math.max(2, Math.round(divisions * spanZ / aspect));
      mesh = generateBoxMesh(minX, minY, minZ, maxX, maxY, maxZ, nx, ny, nz);
      surfaceToNode = new Int32Array(req.triangleCount * 3);
      for (let i = 0; i < surfaceToNode.length; i++) surfaceToNode[i] = i % mesh.nodeCount;
    }
  }

  // ── Constraints: bolt hole physics ────────────────────────────────────────
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
    // STL path: geometric search for hole wall nodes
    for (const hole of boltedHoles) {
      const [hx, hy] = hole.centre;
      const r = hole.radius;

      const holeWallNodes: number[] = [];
      const holeInteriorNodes: number[] = [];
      for (let n = 0; n < mesh.nodeCount; n++) {
        const x = mesh.nodes[n*3]??0, y = mesh.nodes[n*3+1]??0;
        const radDist = Math.sqrt((x-hx)**2 + (y-hy)**2);
        if (radDist < r * 0.9) {
          holeInteriorNodes.push(n);
        } else if (radDist < r * 1.15) {
          holeWallNodes.push(n);
        }
      }

      const holeNodes = holeWallNodes.length >= 3 ? holeWallNodes : holeInteriorNodes;
      console.log(`[analysis] hole ${hole.id}: ${holeNodes.length} wall nodes (r=${r.toFixed(2)}±15%)`);

      if (holeNodes.length === 0) {
        holeNodes.push(closestNode(mesh.nodes, mesh.nodeCount, hx, hy, hole.centre[2]));
      }

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

  // ── Solve ──────────────────────────────────────────────────────────────────
  const input: SolverInput = {
    mesh,
    material,
    constraints,
    forces: effectiveForces,
  };

  let result: import("./solver/types.js").SolverResult;
  let modalResult: ModalAnalysisResult | undefined;

  if (req.analysisType === 'modal') {
    // Run static + keep K for modal reuse
    const intermediate = await runLinearStaticWithK(input);
    result = intermediate.result;

    // Collect fixed node indices from constraints
    const fixedNodes: number[] = [];
    for (const cs of constraints) {
      for (const ni of cs.nodeIndices) fixedNodes.push(ni);
    }

    try {
      modalResult = await runModalAnalysis({
        mesh,
        material,
        fixedNodes,
        nModes: 10,
      });
      console.log(`[analyse] modal: ${modalResult.modes.length} modes, f1=${modalResult.modes.find(m => m.frequencyHz > 1)?.frequencyHz.toFixed(1) ?? '?'}Hz`);
    } catch (err) {
      console.warn(`[analyse] modal solve failed (static result preserved): ${err}`);
      modalResult = undefined;
    }
  } else {
    result = await runLinearStatic(input);
  }

  // ── Linear buckling analysis ───────────────────────────────────────────────
  // Compute the Buckling Load Factor (BLF) using the pre-stress from the
  // static solve. Only run for C3D4 meshes (geometric stiffness for C3D10
  // is not yet implemented). Failures are non-fatal: buckling result is
  // marked "unchecked" rather than crashing the analysis.
  let bucklingBLF: number | undefined;
  let bucklingConverged = false;
  let bucklingTensile   = false;
  if (mesh.nodesPerElem === 4 && result.elemStress6) {
    try {
      // Rebuild K with BCs for the buckling solve (same assembly as static).
      const { K: Kbuck, diagIdx: buckDiagIdx } = await assembleK(mesh, material);
      const fDummy = assembleForceVector(mesh.nodeCount, effectiveForces);
      applyDirichletBC(Kbuck, fDummy, buckDiagIdx, constraints);

      const Ksigma = assembleKsigma(mesh, result.elemStress6, Kbuck.rowPtr, Kbuck.colIdx);
      const bResult = await runLinearBuckling(Kbuck, Ksigma, buckDiagIdx);
      bucklingBLF       = bResult.blf;
      bucklingConverged = bResult.converged;
      bucklingTensile   = bResult.tensileDominated;
      console.log(`[buckling] BLF=${bResult.blf.toFixed(3)} converged=${bResult.converged} iters=${bResult.iterations} tensile=${bResult.tensileDominated}`);
    } catch (err) {
      console.warn(`[buckling] Analysis failed (non-fatal): ${err}`);
    }
  }

  // ── SPR-smoothed nodal stress ──────────────────────────────────────────────
  // Use Superconvergent Patch Recovery for more accurate nodal stress values,
  // especially at stress concentrations near holes.
  // Falls back to direct averaging for under-determined patches (<4 elements).
  // Reference: Zienkiewicz & Zhu (1992) Int J Numer Methods Eng 33(7).
  _snapAnalysis("before sprSmoothedStress");
  const nodeStress = sprSmoothedStress(mesh, result.vonMises);
  _snapAnalysis("after sprSmoothedStress");

  // ── SPR-smoothed nodal stress tensor + anisotropic utilization ratios ────────
  // U_XY = sqrt(σxx²+σyy²-σxx·σyy+3·σxy²) / yieldXY  (in-plane von Mises / yieldXY)
  // U_Z  = max(|σzz|, sqrt(3)·sqrt(σyz²+σxz²)) / yieldZ  (out-of-plane / yieldZ)
  // G_ratio=1/sqrt(3) from Hill L=M=3/(2Z²) → shear yield in Z-planes = yieldZ/sqrt(3)
  const orthoMatU = isOrthotropic(material)
    ? (material as import("./solver/types.js").OrthotropicMaterial)
    : null;
  const utilYieldXY = orthoMatU ? orthoMatU.yieldXY : effectiveYield;
  const utilYieldZ  = orthoMatU ? orthoMatU.yieldZ  : effectiveYield;

  const nodeStress6 = result.elemStress6
    ? sprSmoothedStress6(mesh, result.elemStress6)
    : null;

  const nodeUtilXY = nodeStress6 ? new Float64Array(mesh.nodeCount) : null;
  const nodeUtilZ  = nodeStress6 ? new Float64Array(mesh.nodeCount) : null;
  const nodeSignedStress = new Float64Array(mesh.nodeCount);
  if (nodeStress6 && nodeUtilXY && nodeUtilZ) {
    for (let n = 0; n < mesh.nodeCount; n++) {
      const sxx = nodeStress6[n*6]   ?? 0;
      const syy = nodeStress6[n*6+1] ?? 0;
      const szz = nodeStress6[n*6+2] ?? 0;
      const txy = nodeStress6[n*6+3] ?? 0;
      const tyz = nodeStress6[n*6+4] ?? 0;
      const txz = nodeStress6[n*6+5] ?? 0;
      const util = computeUtilizationRatios(sxx, syy, szz, txy, tyz, txz, utilYieldXY, utilYieldZ);
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
  // Map element-level error estimates to surface vertices using the same
  // nearest-node grid. For each surface vertex, find the nearest element and
  // use its error estimate (interpolated from element centroid).
  const vertexErrorEstimate = result.errorEstimate ? new Float32Array(vertCount) : undefined;
  if (vertexErrorEstimate && result.errorEstimate) {
    // Build element → node connectivity for error mapping
    // For each surface vertex, find the nearest FEA element and use its error
    function nearestElementError(vx: number, vy: number, vz: number): number {
      let bestDist2 = Infinity, bestError = 0;
      const R2 = R3D * R3D;
      // Check nearby nodes for their adjacent elements
      const ci = Math.floor((vx - nxMin) / CELL3);
      const cj = Math.floor((vy - nyMin) / CELL3);
      const ck = Math.floor((vz - nzMin) / CELL3);

      const checkedElems = new Set<number>();
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          for (let dk = -1; dk <= 1; dk++) {
            const ni2 = ci + di, nj2 = cj + dj, nk2 = ck + dk;
            if (ni2 < 0 || ni2 >= gW3 || nj2 < 0 || nj2 >= gH3 || nk2 < 0 || nk2 >= gD3) continue;
            const cell = grid3.get(ni2 * gH3 * gD3 + nj2 * gD3 + nk2);
            if (!cell) continue;
            for (const n of cell) {
              // Find elements containing this node
              const npe = mesh.nodesPerElem ?? 4;
              for (let e = 0; e < mesh.elementCount; e++) {
                if (checkedElems.has(e)) continue;
                const base = e * npe;
                let hasNode = false;
                for (let ni = 0; ni < Math.min(4, npe); ni++) {
                  if ((mesh.elements[base + ni] ?? 0) === n) { hasNode = true; break; }
                }
                if (!hasNode) continue;
                checkedElems.add(e);

                // Compute element centroid distance
                let cx = 0, cy = 0, cz = 0;
                for (let ni = 0; ni < 4; ni++) {
                  const nodeIdx = mesh.elements[base + ni] ?? 0;
                  cx += mesh.nodes[nodeIdx * 3] ?? 0;
                  cy += mesh.nodes[nodeIdx * 3 + 1] ?? 0;
                  cz += mesh.nodes[nodeIdx * 3 + 2] ?? 0;
                }
                cx /= 4; cy /= 4; cz /= 4;
                const dx = cx - vx, dy = cy - vy, dz = cz - vz;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < R2 && d2 < bestDist2) {
                  bestDist2 = d2;
                  bestError = (result.errorEstimate![e] ?? 0);
                }
              }
            }
          }
        }
      }
      // Fallback: global scan if none found within R3D
      if (bestDist2 === Infinity) {
        for (let e = 0; e < mesh.elementCount; e++) {
          const npe = mesh.nodesPerElem ?? 4;
          const base = e * npe;
          let cx = 0, cy = 0, cz = 0;
          for (let ni = 0; ni < 4; ni++) {
            const nodeIdx = mesh.elements[base + ni] ?? 0;
            cx += mesh.nodes[nodeIdx * 3] ?? 0;
            cy += mesh.nodes[nodeIdx * 3 + 1] ?? 0;
            cz += mesh.nodes[nodeIdx * 3 + 2] ?? 0;
          }
          cx /= 4; cy /= 4; cz /= 4;
          const dx = cx - vx, dy = cy - vy, dz = cz - vz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestDist2) {
            bestDist2 = d2;
            bestError = (result.errorEstimate![e] ?? 0);
          }
        }
      }
      return bestError;
    }
    for (let v = 0; v < vertCount; v++) {
      vertexErrorEstimate[v] = nearestElementError(
        req.positions[v * 3] ?? 0, req.positions[v * 3 + 1] ?? 0, req.positions[v * 3 + 2] ?? 0
      );
    }
  }

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

  // ── Summary ────────────────────────────────────────────────────────────────
  const maxVM = result.maxVonMisesMPa;
  const sf    = effectiveYield / (maxVM || 0.001);

  // Estimate failure force: linear scaling from applied loads
  const totalAppliedForce = req.forces.reduce((sum, f) => sum + f.magnitude, 0) || 1;
  const estimatedFailForce = totalAppliedForce * sf;

  const yielding = maxVM >= effectiveYield;

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

  for (const hole of holesForClassification) {
    const rawCls  = classifyHole(hole.radius, plateDimMin);
    const override = req.holeTypeOverrides?.[hole.id];
    const cls = applyHoleOverride(rawCls, override);
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
      effectiveYieldMPa: effectiveYield,
      bulkSF:            sf,
      orientation:       req.print.orientation,
      layerHeightMm:     req.print.layerHeightMm ?? 0.2,
      calibratedBearingStrMPa: req.calibration?.bearingStr_MPa ?? null,
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
      allFailureModes.push({
        mode:       "Linear buckling (BLF)",
        sf:          +blf.toFixed(3),
        failForceN:  +(totalForceN * blf).toFixed(0),
        checked:     true,
        confidence:  "low",
        note:        `BLF ${blf.toFixed(2)}× → ${blfVerdict}. Linear buckling overestimates real BLF by 10–40% for ` +
                     `imperfect FDM geometry. Critical for thin walls, channels, and gussets. Verdict thresholds ` +
                     `(FAIL <1.5×, MARGINAL <3.0×) are STORMFEA design-basis values — see SOURCES tab.${convergeNote}`,
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
  const meshOffset: [number, number, number] = [
    (req.bounds.minX + req.bounds.maxX) / 2,
    (req.bounds.minY + req.bounds.maxY) / 2,
    req.bounds.minZ,
  ];
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
  const fatigue = estimateFatigue(
    maxVM,
    effectiveYield,
    req.print.materialId,
    req.print.orientation,
  );

  // ── Isotropic comparison ─────────────────────────────────────────────────
  // Shows what a conventional isotropic FEA tool would predict.
  //
  // The dominant source of difference between isotropic and orthotropic FEA
  // for FDM parts is NOT the stiffness matrix (both give similar stress fields
  // for the same mesh/BCs) — it is the YIELD CRITERION.
  //
  // Isotropic FEA: SF = yieldStrength / vonMises  (applies same yield in all directions)
  // StressForm:    SF = yieldXY / σ_hill  (Hill 1948 quadratic criterion)
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
    // Using the same stress field as StressForm so the comparison is purely
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
        `StressForm: SF ${sf.toFixed(2)}× — part FAILS. ` +
        `Reason: this is a ${directionWord} part. ` +
        `Inter-layer bond yield is only ${(yieldZ/yieldXY*100).toFixed(0)}% of in-plane yield (${yieldZ.toFixed(1)} vs ${yieldXY.toFixed(1)} MPa). ` +
        `Conventional FEA applies in-plane yield everywhere — it cannot see this failure mode.`;
    } else if (optimismPct > 5) {
      explanation = `Conventional FEA predicts SF ${isoSF.toFixed(2)}× — ${optimismPct}% more optimistic than StressForm's ${sf.toFixed(2)}×. ` +
        `The gap comes from the yield criterion: conventional tools apply in-plane yield (${yieldXY.toFixed(1)} MPa) uniformly. ` +
        `StressForm uses the Hill criterion, which accounts for the weaker through-layer direction ` +
        `(${yieldZ.toFixed(1)} MPa — ${yieldPenaltyPct}% lower). ` +
        `For a ${directionWord} part, the inter-layer bonds govern failure first.`;
    } else {
      const wouldGap = (1/FDM_ORTHO_RATIOS.yieldZ_over_yieldXY - 1) * 100;
      explanation = `Both predictions agree closely (conventional ${isoSF.toFixed(2)}× vs StressForm ${sf.toFixed(2)}×). ` +
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
  const sfLow  = +(sf * yieldMul_low  * lhMul_low).toFixed(2);
  const sfHigh = +(sf * yieldMul_high * lhMul_high).toFixed(2);

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
    fatigue,
    isotropicComparison,
    governingDirection,
    peakUtilXY: +peakUtilXY.toFixed(3),
    peakUtilZ:  +peakUtilZ.toFixed(3),
    minSignedVonMisesMPa: +minSignedVM.toFixed(3),
    maxSignedVonMisesMPa: +maxSignedVM.toFixed(3),
    vertexModeShapesB64,
    modalResult,
    residualCheckpoints: result.residualCheckpoints,
    vertexErrorEstimateB64: vertexErrorEstimate ? Buffer.from(vertexErrorEstimate.buffer).toString("base64") : undefined,
    globalRelativeError: result.globalRelativeError,
    topErrorElements: result.topErrorElements ? [...result.topErrorElements] : undefined,
  };
}
