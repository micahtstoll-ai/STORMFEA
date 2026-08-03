/**
 * validation-coverage.ts — per-analysis validation coverage map (issue #191).
 * -----------------------------------------------------------------------
 * The live scoreboard (`GET /api/solver-tests`, DEBUG tab) shows the FULL
 * validation suite passing, globally. That is a different assurance from
 * "the suite covers the specific model path this analysis exercised" — a
 * user (or judge) looking at a green scoreboard has no way to see that some
 * configurations rest on far fewer anchors than others, or that some
 * combinations have no direct coverage at all.
 *
 * This module is the "which evidence backs what" table:
 *   1. A small, closed set of configuration AXES (element order, material
 *      model, failure criterion, load types, mesher, opt-in features) whose
 *      VALUES are the things an analysis can actually be.
 *   2. A map from each axis value to the validation entries (solver_validation
 *      groups + unit-test suites) that directly exercise it.
 *   3. A fingerprint function that reads an analysis's real characteristics
 *      and reports which axis values it hits.
 *   4. A coverage function that turns a fingerprint into an honest report:
 *      which entries cover this analysis, which axis values have NO direct
 *      entry (stated plainly, not implied), and any known combination gaps
 *      (an axis value being individually covered does not mean every
 *      COMBINATION with another axis value is — e.g. two-region validation
 *      runs exclusively on C3D10 meshes).
 *
 * CI guard: `server/tests/unit/validation-coverage.test.ts` asserts every
 * value in ALL_AXIS_VALUES has a key in COVERAGE_MAP (an empty array is a
 * valid, explicit "no direct coverage" declaration — but the key must
 * exist, so a newly added axis value can't silently fall through unmapped).
 *
 * IMPORTANT — what "covered" means and doesn't: an entry appearing in the
 * map means that suite exercises the same *characteristic* (e.g. "runs a
 * C3D10 mesh", "exercises the fdm-interface criterion"). It is NOT a claim
 * that the suite tests this exact geometry, load case, or material — that
 * would require per-analysis regression fixtures the project doesn't have.
 * The map answers "is this kind of thing exercised anywhere in the suite",
 * not "is this exact analysis proven correct". See METHODOLOGY.md.
 */

// ── Axis values ──────────────────────────────────────────────────────────────
// Each value is a distinct, independently-checkable configuration
// characteristic. Kept as template-literal unions (not free-form strings) so
// TypeScript enforces COVERAGE_MAP and ALL_AXIS_VALUES stay in lockstep with
// any future axis addition.

export type ElementOrderValue = "C3D4" | "C3D10";
export type MaterialValue     = "isotropic" | "orthotropic" | "two-region";
export type CriterionValue    = "fdm-interface" | "hill-legacy" | "von-mises";
export type LoadTypeValue     = "pressure" | "force" | "bolt" | "modal" | "buckling";
export type MesherValue       = "tetgen" | "gmsh" | "box-fallback";
export type OptionValue       = "bond-process" | "in-plane-anisotropy" | "wall-bond";

export type CoverageAxisValue =
  | `elementOrder:${ElementOrderValue}`
  | `material:${MaterialValue}`
  | `criterion:${CriterionValue}`
  | `loadType:${LoadTypeValue}`
  | `mesher:${MesherValue}`
  | `option:${OptionValue}`;

export const ALL_AXIS_VALUES: CoverageAxisValue[] = [
  "elementOrder:C3D4", "elementOrder:C3D10",
  "material:isotropic", "material:orthotropic", "material:two-region",
  "criterion:fdm-interface", "criterion:hill-legacy", "criterion:von-mises",
  "loadType:pressure", "loadType:force", "loadType:bolt", "loadType:modal", "loadType:buckling",
  "mesher:tetgen", "mesher:gmsh", "mesher:box-fallback",
  "option:bond-process", "option:in-plane-anisotropy", "option:wall-bond",
];

// ── Validation entries ──────────────────────────────────────────────────────
// Solver-group ids match the `[N]` headers in server/tests/solver_validation.ts
// (also what GET /api/solver-tests parses into its live scoreboard groups).
// Unit-suite ids match server/tests/unit/<id>.test.ts filenames.

export interface ValidationEntry {
  id:    string;
  label: string;
  kind:  "solver-group" | "unit-suite";
}

function solverGroup(n: number, label: string): [string, ValidationEntry] {
  const id = `solver:${n}`;
  return [id, { id, label, kind: "solver-group" }];
}
function unitSuite(name: string, label: string): [string, ValidationEntry] {
  const id = `unit:${name}`;
  return [id, { id, label, kind: "unit-suite" }];
}

export const VALIDATION_ENTRIES: Record<string, ValidationEntry> = Object.fromEntries([
  solverGroup(1,  "Patch test — uniform body force"),
  solverGroup(2,  "Cantilever beam — tip deflection consistency"),
  solverGroup(3,  "Orthotropic constitutive matrix — isotropic limit"),
  solverGroup(4,  "SPR superconvergent patch recovery"),
  solverGroup(5,  "C3D10 second-order tetrahedral element"),
  solverGroup(6,  "C3D10 assembly integration — nodesPerElem propagation"),
  solverGroup(7,  "Hill criterion — directional yield + von Mises collapse"),
  solverGroup(9,  "Under-constrained rotation detection (collinear bolts)"),
  solverGroup(12, "Pure axial tension bar — exact textbook comparison"),
  solverGroup(16, "Linear buckling — Euler column (clamped-free cantilever)"),
  solverGroup(17, "Simply-supported beam — center deflection"),
  solverGroup(19, "C3D10 cantilever convergence sweep (body-diagonal mesh)"),
  solverGroup(20, "SPR linear-field exactness — C3D4 and C3D10"),
  solverGroup(21, "Body force — consistent nodal load sums to ρ·V·a"),
  solverGroup(22, "Surface pressure — consistent traction resultant + patch test"),
  solverGroup(23, "Orthotropic directional stiffness — δ_z/δ_x ≈ E_xy/E_z"),
  solverGroup(24, "Hole-in-plate stress concentration — Kirsch Kt ≈ 3.0"),
  solverGroup(25, "Two-region material field — solve equivalence + sandwich beam"),
  solverGroup(26, "Numerical homogenization — perforated-plate cell vs isolated-hole theory"),

  unitSuite("spr-midside-recovery",       "SPR recovery stays bounded at C3D10 midside nodes"),
  unitSuite("fdm-criterion",              "FDM dual criterion — azimuth invariance + anchor locks"),
  unitSuite("hill-utilization",           "Hill-legacy utilization ratios U_XY/U_Z analytical benchmark"),
  unitSuite("verdict-hill-sf",            "Hill-legacy safety-factor verdict wiring"),
  unitSuite("in-plane-anisotropy",        "Opt-in in-plane raster (bead-to-bead) anisotropy"),
  unitSuite("bond",                       "Bead-penetration bond model (process block)"),
  unitSuite("bond-rotation",              "Tensor-rotation upright/angled bond model core"),
  unitSuite("upright-swap",               "Upright-no-bed scalar-swap fallback"),
  unitSuite("two-region",                 "buildTwoRegionField — shell/core binning + average material"),
  unitSuite("material-field",             "Per-element material field plumbing (stiffness/recovery/mass)"),
  unitSuite("wallfrac",                   "Level-set tet volume fractions + wall-band classification"),
  unitSuite("skin-band",                  "Independent top/bottom solid-skin bands"),
  unitSuite("core-lattice",               "Gibson-Ashby core homogenization"),
  unitSuite("taguchi-two-region",         "Two-region Taguchi L9 main-effect checks"),
  unitSuite("tetgen-c3d10",               "TetGen -o2 midnode permutation regression"),
  unitSuite("gmsh-clustering",            "Gmsh closely-spaced-hole clustering"),
  unitSuite("mesher-integration",         "End-to-end real TetGen/Gmsh binary integration"),
  unitSuite("tetgen-not-found",           "Box-mesh fallback path (no TetGen binary)"),
  unitSuite("hole-constraint",            "Bolt-hole constraint node clustering"),
  unitSuite("cosine-bearing-normalization","Non-uniform (cosine-bearing) bolt load distribution"),
  unitSuite("modal-solver",               "Modal eigensolver vs Euler-Bernoulli analytical solution"),
  unitSuite("modal-mass-density",         "Modal analysis effective mass density (issue #99)"),
  unitSuite("modal-prebuilt",             "Modal matrix/factorization reuse (issue #100)"),
  unitSuite("buckling-sign",              "Buckling numerical hygiene (issue #103)"),
  unitSuite("clt-laminate",               "Classical Laminate Theory (useCLT option)"),
  unitSuite("orthotropic-compliance",     "Orthotropic compliance / Poisson convention audit"),
]);

// ── Coverage map ─────────────────────────────────────────────────────────────
// An EMPTY array is a deliberate, explicit "no direct coverage" declaration —
// distinct from an axis value missing a key entirely (which the CI guard
// treats as an error). Keep entries evidence-based: only list a suite if it
// actually exercises that characteristic, not "probably touches it somehow".

export const COVERAGE_MAP: Record<CoverageAxisValue, string[]> = {
  "elementOrder:C3D4": ["solver:1", "solver:2", "solver:12", "solver:17", "solver:20", "solver:21", "solver:25"],
  "elementOrder:C3D10": [
    "solver:5", "solver:6", "solver:19", "solver:20", "solver:25",
    "unit:tetgen-c3d10", "unit:spr-midside-recovery",
  ],

  "material:isotropic": ["solver:1", "solver:2", "solver:3", "solver:12", "solver:17"],
  "material:orthotropic": ["solver:3", "solver:7", "solver:23", "unit:orthotropic-compliance"],
  "material:two-region": [
    "solver:25", "unit:two-region", "unit:material-field", "unit:wallfrac",
    "unit:skin-band", "unit:core-lattice", "unit:taguchi-two-region",
  ],

  "criterion:fdm-interface": ["unit:fdm-criterion"],
  "criterion:hill-legacy": ["solver:7", "unit:hill-utilization", "unit:verdict-hill-sf"],
  "criterion:von-mises": ["solver:7"], // isotropic collapse of the Hill form, verified in [7]

  "loadType:force": ["solver:1", "solver:2", "solver:12", "solver:17", "solver:21"],
  "loadType:pressure": ["solver:22"],
  "loadType:bolt": ["solver:9", "unit:hole-constraint", "unit:cosine-bearing-normalization"],
  "loadType:modal": ["unit:modal-solver", "unit:modal-mass-density", "unit:modal-prebuilt"],
  "loadType:buckling": ["solver:16", "unit:buckling-sign"],

  "mesher:tetgen": ["unit:tetgen-c3d10", "unit:mesher-integration"],
  "mesher:gmsh": ["unit:gmsh-clustering", "unit:mesher-integration"],
  "mesher:box-fallback": ["unit:tetgen-not-found"],

  "option:bond-process": ["unit:bond", "unit:bond-rotation"],
  "option:in-plane-anisotropy": ["unit:in-plane-anisotropy"],
  // Wall-to-wall (bead-to-bead) bonding: only exercised inside the two-region
  // group's [25.3] sub-block today, no standalone unit suite yet.
  "option:wall-bond": ["solver:25"],
};

// ── Known combination gaps ──────────────────────────────────────────────────
// Coverage is tracked per-axis, not per-combination — two axis values each
// being individually covered does NOT mean their combination is. This list
// states the combinations we know are NOT directly anchored, so the report
// can say so plainly instead of implying combinatorial coverage it doesn't
// have. Keep this list honest and short: only combinations actually checked
// against the suite, not a guess.
export interface ComboGap {
  axes: CoverageAxisValue[];
  note: string;
}

export const KNOWN_COMBO_GAPS: ComboGap[] = [
  {
    axes: ["elementOrder:C3D4", "material:two-region"],
    note: "Two-region validation (group 25, and the wallfrac/skin-band/material-field/" +
          "core-lattice/taguchi unit suites) runs exclusively on C3D10 meshes. C3D4 + " +
          "two-region is not directly anchored — individual axes are covered separately, " +
          "the combination is not.",
  },
  {
    axes: ["option:bond-process", "material:two-region"],
    note: "The bond-process model (bond.test.ts, bond-rotation.test.ts) is validated on " +
          "single-material inputs; the two-region wall-to-wall bond interaction is only " +
          "exercised through group 25's [25.3] wall-bond sub-block, which does not itself " +
          "combine a process block with two-region classification.",
  },
  {
    axes: ["loadType:modal", "material:two-region"],
    note: "Modal analysis validation (modal-solver/modal-mass-density/modal-prebuilt) runs " +
          "on uniform materials only; no direct anchor for modal + two-region together.",
  },
  {
    axes: ["loadType:buckling", "material:two-region"],
    note: "Buckling validation (group 16, buckling-sign.test.ts) runs on uniform materials " +
          "only; no direct anchor for buckling + two-region together.",
  },
];

// ── Fingerprint ──────────────────────────────────────────────────────────────
// The minimal set of characteristics needed to look up coverage. Kept as
// plain data (not read from AnalysisResult directly) so it's easy to build in
// tests without running a full solve.

export interface AnalysisFingerprint {
  elementOrder: ElementOrderValue;
  material:     MaterialValue;
  criterion:    CriterionValue;
  loadTypes:    LoadTypeValue[];
  mesher:       MesherValue;
  options:      OptionValue[];
}

export interface FingerprintInputs {
  nodesPerElem: number | undefined;
  /** true when a per-element material field (two-region) is active. */
  twoRegionActive: boolean;
  /** true when the material is orthotropic (transversely isotropic) at all. */
  orthotropic: boolean;
  criterion: CriterionValue;
  hasForces: boolean;
  hasPressures: boolean;
  hasBoltHoles: boolean;
  isModal: boolean;
  computesBuckling: boolean;
  fileType: "stl" | "step";
  meshFallback: boolean;
  bondProcessActive: boolean;
  inPlaneAnisotropyActive: boolean;
  wallBondActive: boolean;
}

export function computeFingerprint(inputs: FingerprintInputs): AnalysisFingerprint {
  const elementOrder: ElementOrderValue = inputs.nodesPerElem === 10 ? "C3D10" : "C3D4";

  const material: MaterialValue = inputs.twoRegionActive
    ? "two-region"
    : (inputs.orthotropic ? "orthotropic" : "isotropic");

  const loadTypes: LoadTypeValue[] = [];
  if (inputs.hasForces) loadTypes.push("force");
  if (inputs.hasPressures) loadTypes.push("pressure");
  if (inputs.hasBoltHoles) loadTypes.push("bolt");
  if (inputs.isModal) loadTypes.push("modal");
  if (inputs.computesBuckling) loadTypes.push("buckling");

  const mesher: MesherValue = inputs.meshFallback
    ? "box-fallback"
    : (inputs.fileType === "step" ? "gmsh" : "tetgen");

  const options: OptionValue[] = [];
  if (inputs.bondProcessActive) options.push("bond-process");
  if (inputs.inPlaneAnisotropyActive) options.push("in-plane-anisotropy");
  if (inputs.wallBondActive) options.push("wall-bond");

  return { elementOrder, material, criterion: inputs.criterion, loadTypes, mesher, options };
}

function fingerprintAxisValues(fp: AnalysisFingerprint): CoverageAxisValue[] {
  const values: CoverageAxisValue[] = [
    `elementOrder:${fp.elementOrder}`,
    `material:${fp.material}`,
    `criterion:${fp.criterion}`,
    `mesher:${fp.mesher}`,
  ];
  for (const lt of fp.loadTypes) values.push(`loadType:${lt}`);
  for (const opt of fp.options) values.push(`option:${opt}`);
  return values;
}

// ── Coverage report ──────────────────────────────────────────────────────────

export interface AxisCoverage {
  axis:    CoverageAxisValue;
  entries: ValidationEntry[];   // empty means NO direct coverage for this axis
}

export interface ValidationCoverageReport {
  fingerprint:     AnalysisFingerprint;
  /** Every axis value present in this analysis, each with its covering entries. */
  axisCoverage:    AxisCoverage[];
  /** Deduplicated union of every entry id covering ANY axis this analysis hits. */
  coveringEntryIds: string[];
  /** Axis values present in this analysis with zero direct entries. */
  uncoveredAxes:    CoverageAxisValue[];
  /** Known combination gaps whose axes are ALL present in this fingerprint. */
  comboGaps:        ComboGap[];
}

export function computeValidationCoverage(fp: AnalysisFingerprint): ValidationCoverageReport {
  const axisValues = fingerprintAxisValues(fp);
  const axisCoverage: AxisCoverage[] = axisValues.map(axis => ({
    axis,
    entries: (COVERAGE_MAP[axis] ?? []).map(id => VALIDATION_ENTRIES[id]).filter((e): e is ValidationEntry => !!e),
  }));

  const coveringIdSet = new Set<string>();
  for (const ac of axisCoverage) for (const e of ac.entries) coveringIdSet.add(e.id);

  const uncoveredAxes = axisCoverage.filter(ac => ac.entries.length === 0).map(ac => ac.axis);

  const axisSet = new Set(axisValues);
  const comboGaps = KNOWN_COMBO_GAPS.filter(gap => gap.axes.every(a => axisSet.has(a)));

  return {
    fingerprint: fp,
    axisCoverage,
    coveringEntryIds: [...coveringIdSet].sort(),
    uncoveredAxes,
    comboGaps,
  };
}
