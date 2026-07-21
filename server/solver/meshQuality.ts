/**
 * meshQuality.ts
 * ──────────────
 * Per-element tetrahedral quality metrics used to detect elements that damage
 * solution accuracy (slivers, near-flat caps, needle wedges, inverted/folded
 * mappings).
 *
 * SCALE INVARIANCE (issue #165)
 * =============================
 * The classification metrics are dimensionless, so the SAME physical element is
 * classified identically at any model scale (0.1×, 1×, 10× all agree):
 *
 *   - normalizedJacobian  — mean-ratio quality  √2·(6V) / l_rms³
 *       l_rms = RMS of the 6 edge lengths. Exactly 1.0 for a regular tet,
 *       (0,1] for well-shaped elements, → 0 for slivers, < 0 for inverted.
 *       Both numerator (∝ length³) and denominator (∝ length³) scale together,
 *       so the ratio is unitless. This replaces the old raw mm³ triple product,
 *       which flagged tiny-but-well-shaped elements and passed large-but-bad
 *       ones (a sub-mm feature was "poor" purely for being small).
 *   - aspectRatio         — longest edge / shortest altitude (already unitless).
 *   - min/maxDihedralDeg  — dihedral angles over the FULL [0,180] range.
 *
 * The raw signed 6·V (`jacobianMin`) is retained for sign/back-compat reporting
 * only — thresholds never key on it (issue #166: its sign is auto-oriented away
 * by the assembler, so mirror-oriented meshes must not be flagged for it).
 *
 * THRESHOLDS (re-derived for the normalized metric)
 * =================================================
 *   normalizedJacobian ideal = 1.0 (regular tet, by construction).
 *   |nj| < POOR_NJ (0.10)  → "poor": mean-ratio below 10% of ideal.
 *   |nj| < HARD_SLIVER_NJ (0.02) → "degenerate": a genuine sliver. At nj≈0.02
 *          the element volume is ~2% of a regular tet on the same edge scale,
 *          so the strain-displacement matrix B ∝ 1/(6V) is inflated ~50× and
 *          the element-stiffness conditioning is wrecked (~10³–10⁴×). This is
 *          the accuracy killer the gate (issue #166) blocks on.
 *   aspectRatio > POOR_AR (20)  → "poor"   (standard tet-quality guidance).
 *   aspectRatio > HARD_AR (100) → hard block (catastrophic elongation).
 *   dihedral < POOR_MIN_DIHEDRAL (5°) or > POOR_MAX_DIHEDRAL (175°) → "poor"
 *          (needle wedge / near-flat cap; regular-tet dihedral ≈ 70.5°).
 */

import type { TetMesh, ElementQualityMetrics, MeshQualityReport, ElementQualitySeverity } from "./types.js";
import { c3d10GaussDetJ } from "./element.js";

// ─── Re-derived, scale-invariant thresholds ───────────────────────────────────
/** |normalizedJacobian| below this ⇒ genuine sliver → degenerate + hard block. */
export const HARD_SLIVER_NJ = 0.02;
/** |normalizedJacobian| below this ⇒ poor accuracy. */
export const POOR_NJ = 0.10;
/** aspect ratio above this ⇒ poor accuracy. */
export const POOR_AR = 20;
/** aspect ratio above this ⇒ catastrophic elongation → hard block. */
export const HARD_AR = 100;
/** dihedral below this (deg) ⇒ poor (needle wedge). */
export const POOR_MIN_DIHEDRAL = 5;
/** dihedral above this (deg) ⇒ poor (near-flat cap sliver). */
export const POOR_MAX_DIHEDRAL = 175;
/** C3D10 midside offset (‖mid−edgeMidpoint‖/edgeLen) above this ⇒ poor. A
 *  perfect straight-sided element is 0; Gmsh curved elements stay well under. */
export const POOR_MIDSIDE = 0.25;
/** C3D10 midside offset at/above this ⇒ treated as a fold (the node is pushed
 *  half an edge or more — past the corner — which tangles the mapping even if
 *  the 4 interior Gauss points happen not to sample the inverted region). */
export const MIDSIDE_FOLD = 0.5;

// ─── Vector/Matrix Operations ─────────────────────────────────────────────────

function sub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function magnitude(v: [number, number, number]): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

// ─── Jacobian Determinant ─────────────────────────────────────────────────────

/**
 * Signed 6·volume of a tetrahedron: J = (p1-p0) · ((p2-p0) × (p3-p0)).
 * Positive: non-inverted. ≈0: zero-volume. Negative: mirror/inverted orientation.
 * SCALE-DEPENDENT (mm³) — used only for sign, never for classification.
 */
function computeJacobian(p0: [number, number, number], p1: [number, number, number], p2: [number, number, number], p3: [number, number, number]): number {
  const v1 = sub(p1, p0);
  const v2 = sub(p2, p0);
  const v3 = sub(p3, p0);
  const c = cross(v2, v3);
  return dot(v1, c);
}

/**
 * RMS of the 6 edge lengths of a tetrahedron. Zero only for a fully-collapsed
 * element.
 */
function rmsEdgeLength(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number]
): number {
  const nodes: [number, number, number][] = [p0, p1, p2, p3];
  let sumSq = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const d = sub(nodes[i]!, nodes[j]!);
      sumSq += d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    }
  }
  return Math.sqrt(sumSq / 6);
}

/**
 * Scale-invariant "mean-ratio" normalized Jacobian: √2·(6V) / l_rms³.
 * Regular tet → 1.0; slivers → 0; inverted → negative. Dimensionless.
 */
function computeNormalizedJacobian(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number]
): number {
  const sixV = computeJacobian(p0, p1, p2, p3);
  const lrms = rmsEdgeLength(p0, p1, p2, p3);
  if (lrms < 1e-15) return 0;
  return (Math.SQRT2 * sixV) / (lrms * lrms * lrms);
}

// ─── Aspect Ratio ─────────────────────────────────────────────────────────────

/**
 * Aspect ratio = longest edge / shortest altitude (dimensionless, scale-invariant).
 */
function computeAspectRatio(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number]
): number {
  const nodes: [number, number, number][] = [p0, p1, p2, p3];

  // Compute all 6 edge lengths
  let maxEdge = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const ni = nodes[i];
      const nj = nodes[j];
      if (!ni || !nj) continue;
      const edge = magnitude(sub(ni, nj));
      maxEdge = Math.max(maxEdge, edge);
    }
  }

  if (maxEdge < 1e-15) return 1e10;

  // Compute all 4 altitudes
  const altitudes = [
    computeAltitude(p1, p2, p3, p0), // altitude to face (1,2,3) from node 0
    computeAltitude(p0, p2, p3, p1), // altitude to face (0,2,3) from node 1
    computeAltitude(p0, p1, p3, p2), // altitude to face (0,1,3) from node 2
    computeAltitude(p0, p1, p2, p3), // altitude to face (0,1,2) from node 3
  ];

  const minAltitude = Math.min(...altitudes);
  if (minAltitude < 1e-15) return 1e10;

  return maxEdge / minAltitude;
}

function computeAltitude(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number]
): number {
  // Perpendicular distance from p3 to plane defined by p0, p1, p2
  const v1 = sub(p1, p0);
  const v2 = sub(p2, p0);
  const normal = cross(v1, v2);
  const normalLen = magnitude(normal);
  if (normalLen < 1e-15) return 1e-10;
  const v3 = sub(p3, p0);
  const value = dot(v3, normal);
  return Math.abs(value) / normalLen;
}

// ─── Dihedral Angles ──────────────────────────────────────────────────────────

/**
 * Min and max dihedral angle (degrees) over the tet's 6 edges, in the TRUE
 * [0,180] range (issue #165).
 *
 * The old code took the angle between the two face NORMALS and collapsed it with
 * `min(a, 180−a)` after an absolute-value dot product — that folded [0,180] down
 * to [0,90], so an obtuse (>90°) near-flat sliver reported a plausible-looking
 * acute angle instead of its true, near-180° dihedral.
 *
 * Correct interior dihedral at edge (i,j): project the two off-edge vertices onto
 * the plane ⟂ to the edge and measure the angle between those projections. This
 * is the physical angle between the two half-faces and lives in [0,180].
 */
function computeDihedralAngles(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number]
): { min: number; max: number } {
  const nodes: [number, number, number][] = [p0, p1, p2, p3];
  // For each edge (i,j), the OTHER two vertices (k,l) define the two faces.
  const edges: [number, number, number, number][] = [
    [0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2],
    [1, 2, 0, 3], [1, 3, 0, 2], [2, 3, 0, 1],
  ];

  let minAngle = 180;
  let maxAngle = 0;

  for (const [i, j, k, l] of edges) {
    const pi = nodes[i]!, pj = nodes[j]!, pk = nodes[k]!, pl = nodes[l]!;
    const e = sub(pj, pi);
    const eLen2 = dot(e, e);
    if (eLen2 < 1e-30) { minAngle = 0; maxAngle = 180; continue; }

    // Components of (pk-pi) and (pl-pi) perpendicular to the edge.
    const wk0 = sub(pk, pi);
    const wl0 = sub(pl, pi);
    const tk = dot(wk0, e) / eLen2;
    const tl = dot(wl0, e) / eLen2;
    const wk: [number, number, number] = [wk0[0] - tk * e[0], wk0[1] - tk * e[1], wk0[2] - tk * e[2]];
    const wl: [number, number, number] = [wl0[0] - tl * e[0], wl0[1] - tl * e[1], wl0[2] - tl * e[2]];

    const lk = magnitude(wk);
    const ll = magnitude(wl);
    if (lk < 1e-15 || ll < 1e-15) { minAngle = 0; maxAngle = 180; continue; }

    const cosAngle = Math.max(-1, Math.min(1, dot(wk, wl) / (lk * ll)));
    const angleDeg = (Math.acos(cosAngle) * 180) / Math.PI; // full [0,180]
    minAngle = Math.min(minAngle, angleDeg);
    maxAngle = Math.max(maxAngle, angleDeg);
  }

  return { min: minAngle, max: maxAngle };
}

// ─── Quality Assessment ────────────────────────────────────────────────────────

/**
 * Classify an element from its scale-invariant metrics.
 * NOTE: uses |normalizedJacobian| so a MIRRORED (negative-sign but well-shaped)
 * element is treated as normal — the assembler auto-orients it (issue #166).
 * `curvedFolded` (a C3D10 fold, issue #162) forces "degenerate".
 */
function assessSeverity(
  normalizedJacobian: number,
  aspectRatio: number,
  minDihedralDeg: number,
  maxDihedralDeg: number,
  curvedFolded: boolean,
  maxMidsideOffset?: number,
): ElementQualitySeverity {
  const absNJ = Math.abs(normalizedJacobian);
  if (curvedFolded || !Number.isFinite(normalizedJacobian) || absNJ < HARD_SLIVER_NJ) {
    return "degenerate";
  }
  const midsidePoor = maxMidsideOffset !== undefined && maxMidsideOffset > POOR_MIDSIDE;
  if (absNJ < POOR_NJ || aspectRatio > POOR_AR ||
      minDihedralDeg < POOR_MIN_DIHEDRAL || maxDihedralDeg > POOR_MAX_DIHEDRAL || midsidePoor) {
    return "poor";
  }
  return "normal";
}

// ─── C3D10 curved-mapping metrics (issue #162) ────────────────────────────────

/** Per-element curved-mapping diagnostics for a quadratic (C3D10) element. */
interface CurvedMetrics {
  readonly curvedFolded: boolean;
  /** Worst corner-orientation-relative Gauss detJ (cornerSign·detJ); ≤0 ⇒ fold. */
  readonly minGaussDetJ: number;
  /** Max over the 6 edges of ‖midsideNode − edgeMidpoint‖ / edgeLength. */
  readonly maxMidsideOffset: number;
}

// Midside node index per corner-pair, matching STORMFEA C3D10 ordering
// (types.ts): 4=mid(0,1), 5=mid(1,2), 6=mid(0,2), 7=mid(0,3), 8=mid(1,3), 9=mid(2,3).
const C3D10_EDGE_MIDS: readonly [number, number, number][] = [
  [0, 1, 4], [1, 2, 5], [0, 2, 6], [0, 3, 7], [1, 3, 8], [2, 3, 9],
];

/**
 * Evaluate the C3D10 curved-mapping health of one element.
 *
 * A fold is detected two independent ways:
 *   1. Gauss-point sign: the four detJ must all share one sign. Referencing each
 *      against the element's OWN majority orientation (sign of Σ detJ) rather
 *      than a bare detJ ≤ 0 keeps a legitimately MIRRORED element (all detJ
 *      negative, which the assembler's Math.abs handles) from false-positiving,
 *      while still reducing to "detJ ≤ 0 at a Gauss point" for the usual
 *      positively-oriented mesh. `minGaussDetJ = min(orient·detJ)`; ≤ 0 ⇒ the
 *      mapping inverts between Gauss points (a genuine fold). Note the corner-tet
 *      triple-product sign is NOT a valid reference here — its ordering
 *      convention is opposite to the isoparametric detJ.
 *   2. Midside displacement: a node pushed ≥ MIDSIDE_FOLD of its edge length is
 *      past the corner and tangles the mapping even if the 4 interior Gauss
 *      points miss the inverted pocket — a cheap geometric screen.
 */
function computeCurvedMetrics(coords10: Float64Array): CurvedMetrics {
  const gaussDetJ = c3d10GaussDetJ(coords10);
  let sum = 0;
  for (let g = 0; g < gaussDetJ.length; g++) sum += gaussDetJ[g]!;
  const orient = Math.sign(sum); // element's own majority orientation
  let minRel = Infinity;
  for (let g = 0; g < gaussDetJ.length; g++) {
    const rel = orient === 0 ? 0 : orient * gaussDetJ[g]!;
    if (rel < minRel) minRel = rel;
  }
  if (!Number.isFinite(minRel)) minRel = 0;

  let maxMidsideOffset = 0;
  for (const [a, b, m] of C3D10_EDGE_MIDS) {
    const ax = coords10[a * 3]!, ay = coords10[a * 3 + 1]!, az = coords10[a * 3 + 2]!;
    const bx = coords10[b * 3]!, by = coords10[b * 3 + 1]!, bz = coords10[b * 3 + 2]!;
    const mx = coords10[m * 3]!, my = coords10[m * 3 + 1]!, mz = coords10[m * 3 + 2]!;
    const edgeLen = Math.hypot(bx - ax, by - ay, bz - az);
    if (edgeLen < 1e-15) continue;
    const ex = mx - 0.5 * (ax + bx), ey = my - 0.5 * (ay + by), ez = mz - 0.5 * (az + bz);
    const off = Math.hypot(ex, ey, ez) / edgeLen;
    if (off > maxMidsideOffset) maxMidsideOffset = off;
  }

  const curvedFolded =
    orient === 0 || minRel <= 0 || maxMidsideOffset >= MIDSIDE_FOLD;

  return { curvedFolded, minGaussDetJ: minRel, maxMidsideOffset };
}

/**
 * True when an element's shape exceeds a HARD threshold and must block the solve
 * (issue #166): a genuine sliver, a catastrophic aspect ratio, a folded C3D10
 * mapping, or a non-finite metric. Mirror-orientation (sign only) never trips it.
 */
export function isHardViolation(m: ElementQualityMetrics): boolean {
  const absNJ = Math.abs(m.normalizedJacobian);
  return (m.curvedFolded === true) ||
    !Number.isFinite(m.normalizedJacobian) ||
    absNJ < HARD_SLIVER_NJ ||
    m.aspectRatio > HARD_AR;
}

// ─── Per-Element Metrics ───────────────────────────────────────────────────────

/**
 * Compute quality metrics for a single element (corner tetrahedron). For C3D10
 * the curved-mapping metrics (fold / midside offset) are layered in by
 * computeMeshQuality (issue #162).
 */
function computeElementMetrics(
  elementIdx: number,
  nodes: Float64Array,
  elements: Int32Array,
  nodesPerElem: number
): ElementQualityMetrics {
  // Extract corner node indices for this element
  const startIdx = elementIdx * nodesPerElem;
  const n0Idx = elements[startIdx]!;
  const n1Idx = elements[startIdx + 1]!;
  const n2Idx = elements[startIdx + 2]!;
  const n3Idx = elements[startIdx + 3]!;

  // Extract coordinates
  const p0: [number, number, number] = [nodes[n0Idx * 3]!, nodes[n0Idx * 3 + 1]!, nodes[n0Idx * 3 + 2]!];
  const p1: [number, number, number] = [nodes[n1Idx * 3]!, nodes[n1Idx * 3 + 1]!, nodes[n1Idx * 3 + 2]!];
  const p2: [number, number, number] = [nodes[n2Idx * 3]!, nodes[n2Idx * 3 + 1]!, nodes[n2Idx * 3 + 2]!];
  const p3: [number, number, number] = [nodes[n3Idx * 3]!, nodes[n3Idx * 3 + 1]!, nodes[n3Idx * 3 + 2]!];

  const jacobianMin = computeJacobian(p0, p1, p2, p3);
  const normalizedJacobian = computeNormalizedJacobian(p0, p1, p2, p3);
  const aspectRatio = computeAspectRatio(p0, p1, p2, p3);
  const dih = computeDihedralAngles(p0, p1, p2, p3);

  const centroid: [number, number, number] = [
    (p0[0] + p1[0] + p2[0] + p3[0]) / 4,
    (p0[1] + p1[1] + p2[1] + p3[1]) / 4,
    (p0[2] + p1[2] + p2[2] + p3[2]) / 4,
  ];

  // C3D10 (quadratic) elements: also screen the CURVED mapping (issue #162). A
  // midside node displaced enough to fold the mapping is invisible to the
  // corner-tet metrics above, so evaluate detJ at the 4 Gauss points and the
  // midside offsets. C3D4 (linear) elements skip this — there is no curvature.
  let curvedFolded: boolean | undefined;
  let minGaussDetJ: number | undefined;
  let maxMidsideOffset: number | undefined;
  if (nodesPerElem === 10) {
    const coords10 = new Float64Array(30);
    for (let i = 0; i < 10; i++) {
      const ni = elements[startIdx + i]!;
      coords10[i * 3]     = nodes[ni * 3]!;
      coords10[i * 3 + 1] = nodes[ni * 3 + 1]!;
      coords10[i * 3 + 2] = nodes[ni * 3 + 2]!;
    }
    const cm = computeCurvedMetrics(coords10);
    curvedFolded = cm.curvedFolded;
    minGaussDetJ = cm.minGaussDetJ;
    maxMidsideOffset = cm.maxMidsideOffset;
  }

  const severity = assessSeverity(
    normalizedJacobian, aspectRatio, dih.min, dih.max, curvedFolded === true, maxMidsideOffset,
  );

  return {
    elementIdx,
    jacobianMin,
    normalizedJacobian,
    aspectRatio,
    minDihedralDeg: dih.min,
    maxDihedralDeg: dih.max,
    severity,
    curvedFolded,
    minGaussDetJ,
    maxMidsideOffset,
    centroid,
  };
}

// ─── Mesh-Level Report ────────────────────────────────────────────────────────

/**
 * Compute aggregated mesh quality report.
 * Scans all elements and produces counts, worst-case values, and quality score.
 */
export function computeMeshQuality(mesh: TetMesh): MeshQualityReport {
  const { nodes, elements, elementCount, nodesPerElem } = mesh;

  let degenerateCount = 0;
  let poorQualityCount = 0;
  let normalCount = 0;
  let curvedFoldedCount = 0;
  let hardViolationCount = 0;

  let worstJacobianMin = Infinity;         // raw signed 6·V — init +∞ (issue #165: was 1, under-reporting)
  let worstNormalizedJacobian = Infinity;  // closest-to-zero |nj|
  let worstAspectRatio = 0;
  let worstMinDihedralDeg = 180;
  let worstMaxDihedralDeg = 0;
  let worstElement: ElementQualityMetrics | null = null;
  const hardViolators: ElementQualityMetrics[] = [];
  const HARD_VIOLATOR_CAP = 16;

  for (let e = 0; e < elementCount; e++) {
    const metrics = computeElementMetrics(e, nodes, elements, nodesPerElem);

    if (metrics.severity === "degenerate") {
      degenerateCount++;
    } else if (metrics.severity === "poor") {
      poorQualityCount++;
    } else {
      normalCount++;
    }

    if (metrics.curvedFolded) curvedFoldedCount++;

    if (isHardViolation(metrics)) {
      hardViolationCount++;
      if (hardViolators.length < HARD_VIOLATOR_CAP) hardViolators.push(metrics);
    }

    worstJacobianMin = Math.min(worstJacobianMin, metrics.jacobianMin);
    worstNormalizedJacobian = Math.min(worstNormalizedJacobian, Math.abs(metrics.normalizedJacobian));
    worstAspectRatio = Math.max(worstAspectRatio, metrics.aspectRatio);
    worstMinDihedralDeg = Math.min(worstMinDihedralDeg, metrics.minDihedralDeg);
    worstMaxDihedralDeg = Math.max(worstMaxDihedralDeg, metrics.maxDihedralDeg);

    // Track the single worst element: prefer smaller |nj| among non-normal ones.
    if (!worstElement || metrics.severity !== "normal") {
      if (!worstElement || Math.abs(metrics.normalizedJacobian) < Math.abs(worstElement.normalizedJacobian)) {
        worstElement = metrics;
      }
    }
  }

  if (!Number.isFinite(worstJacobianMin)) worstJacobianMin = 0;
  if (!Number.isFinite(worstNormalizedJacobian)) worstNormalizedJacobian = 0;

  // Quality score: [0, 1], where 1 is perfect
  // Penalize degenerate elements heavily, poor elements moderately
  const score = Math.max(
    0,
    1 - (degenerateCount / elementCount) * 2 - (poorQualityCount / elementCount) * 0.5
  );

  return {
    totalElements: elementCount,
    degenerateCount,
    poorQualityCount,
    normalCount,
    qualityScore: score,
    worstJacobianMin,
    worstNormalizedJacobian,
    worstAspectRatio,
    worstMinDihedralDeg,
    worstMaxDihedralDeg,
    curvedFoldedCount,
    hardViolationCount,
    hardViolators,
    worstElement,
  };
}
