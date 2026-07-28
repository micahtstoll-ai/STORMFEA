/**
 * meshQuality.ts
 * ──────────────
 * Per-element quality metrics: scale-invariant normalized Jacobian, aspect
 * ratio, true dihedral angles, and (C3D10) tangling detection at the Gauss
 * points. Used to detect the elements that actually damage a solve — slivers,
 * extreme skew, and folded quadratic maps — independent of model scale/units.
 *
 * Metrics
 *   - scaledJacobian: signed detJ / edgeRMS³ (issues #165). DIMENSIONLESS and
 *     scale-invariant. Regular tet ≈ 0.707; → 0 for a near-zero-volume sliver;
 *     < 0 for a mirror-oriented (inverted) C3D4 element.
 *   - aspectRatio: longest edge / shortest altitude (dimensionless).
 *   - minDihedralDeg: minimum TRUE dihedral angle over [0,180]° (issue #165 —
 *     obtuse slivers are no longer folded to their acute supplement).
 *   - minGaussDetJ: (C3D10) signed min detJ over the 4 stiffness Gauss points;
 *     ≤ 0 ⇒ the midside placement folds the isoparametric map (issue #162). For
 *     C3D4 this equals the (constant) raw Jacobian.
 *   - midsideMaxDev: (C3D10) largest mid-edge deviation from the true midpoint,
 *     relative to the edge length — a cheap curved-element screen.
 *
 * Classification (scale-invariant; issue #166 re-keys the gate on damage, not
 * on a Jacobian SIGN the C3D4 assembler auto-orients away):
 *   - "degenerate" (hard fail): tangled (C3D10 minGaussDetJ ≤ 0), OR a
 *     near-zero-volume sliver (|scaledJacobian| < SLIVER_SCALED_JAC), OR an
 *     extreme aspect ratio (AR > SLIVER_ASPECT). These destroy the local
 *     stiffness/stress or the conditioning and cannot be auto-repaired.
 *   - "poor" (warn): |scaledJacobian| < POOR_SCALED_JAC, AR > POOR_ASPECT, or
 *     minDihedral < POOR_DIHEDRAL_DEG.
 *   - "normal": otherwise.
 *
 * Threshold rationale
 *   The regular (equilateral) tetrahedron has scaledJacobian = 1/√2 ≈ 0.707.
 *   POOR_SCALED_JAC = 0.1 is ≈ 7× flatter than regular — the onset of skew that
 *   noticeably degrades stress recovery. SLIVER_SCALED_JAC = 0.02 is ≈ 35×
 *   flatter: an element with ~35× less volume than a regular tet of the same
 *   edge scale, where B ∝ 1/(6V) blows the stiffness rows up and poisons
 *   conditioning. AR limits mirror the classic 20 (poor) with 50 reserved for
 *   the sliver tier. All are dimensionless, so a part exported in metres vs
 *   millimetres classifies identically.
 */

import type { TetMesh, ElementQualityMetrics, MeshQualityReport, ElementQualitySeverity } from "./types.js";
import { buildB_c3d10, C3D10_GAUSS } from "./element.js";

// ─── Scale-invariant classification thresholds (issue #165/#166) ───────────────
const SLIVER_SCALED_JAC = 0.02;   // hard: near-zero normalized volume
const POOR_SCALED_JAC   = 0.10;   // warn: onset of damaging skew
const SLIVER_ASPECT     = 50;     // hard: extreme aspect ratio
const POOR_ASPECT       = 20;     // warn
const POOR_DIHEDRAL_DEG = 5;      // warn
// C3D10 mid-edge node beyond ¼ of the edge from the true midpoint makes the
// quadratic edge map ξ→x non-monotonic (dx/dξ changes sign at an endpoint) —
// the exact 1D fold limit. Valid curved elements (Gmsh fillets) sit well inside.
const MIDSIDE_FOLD_DEV  = 0.25;   // hard: folded quadratic edge

const C3D10_EDGE_PAIRS: readonly [number, number][] = [[0,1],[1,2],[0,2],[0,3],[1,3],[2,3]];

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

function normalize(v: [number, number, number]): [number, number, number] {
  const len = magnitude(v);
  if (len < 1e-15) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ─── Jacobian Determinant ─────────────────────────────────────────────────────

/**
 * Compute Jacobian determinant (signed volume × 6) for a tetrahedron.
 * J = det([ p1-p0, p2-p0, p3-p0 ]) = (p1-p0) · ((p2-p0) × (p3-p0))
 *
 * Positive J: non-inverted element
 * J ≈ 0: degenerate (zero volume)
 * Negative J: inverted element (fatal)
 */
function computeJacobian(p0: [number, number, number], p1: [number, number, number], p2: [number, number, number], p3: [number, number, number]): number {
  const v1 = sub(p1, p0);
  const v2 = sub(p2, p0);
  const v3 = sub(p3, p0);
  const c = cross(v2, v3);
  return dot(v1, c);
}

// ─── Aspect Ratio ─────────────────────────────────────────────────────────────

/**
 * Aspect ratio = longest edge / shortest altitude.
 * For a tetrahedron with 4 nodes, there are 6 edges and 4 faces.
 *
 * Altitude to a face: perpendicular distance from opposite vertex to face.
 * For face (n0, n1, n2) and opposite node n3:
 *   - Face normal = (p1-p0) × (p2-p0)
 *   - Altitude = |dot(p3-p0, normal)| / |normal|
 *
 * We want the SHORTEST altitude (tightest constraint).
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
 * Minimum dihedral angle (in degrees) in a tetrahedron.
 * Dihedral angle: angle between two adjacent faces.
 *
 * A tet has 6 edges; each edge is shared by 2 faces.
 * For edge (i, j) and the 2 other nodes k, l:
 *   - Face 1 normal = (pj-pi) × (pk-pi)
 *   - Face 2 normal = (pj-pi) × (pl-pi)
 *   - Dihedral angle = acos(|n1 · n2| / (|n1| × |n2|))
 */
/**
 * All 6 true dihedral angles (degrees, range [0,180]) of a tetrahedron.
 * Exported for testing the obtuse-sliver case (issue #165) — an obtuse
 * dihedral must be reported as its true value, not folded to the acute
 * supplement.
 */
export function tetDihedralAnglesDeg(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number]
): number[] {
  const nodes: [number, number, number][] = [p0, p1, p2, p3];
  const edges: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
  ];
  const out: number[] = [];
  for (const edgeIndices of edges) {
    const i = edgeIndices[0], j = edgeIndices[1];
    const others = nodes.filter((_, idx) => idx !== i && idx !== j);
    if (others.length !== 2) continue;
    const pi = nodes[i], pj = nodes[j], pk = others[0], pl = others[1];
    if (!pi || !pj || !pk || !pl) continue;
    const edgeVec = sub(pj, pi);
    const n1 = cross(edgeVec, sub(pk, pi));
    const n2 = cross(edgeVec, sub(pl, pi));
    const len1 = magnitude(n1), len2 = magnitude(n2);
    if (len1 < 1e-15 || len2 < 1e-15) { out.push(0); continue; }
    const cosAngle = dot(n1, n2) / (len1 * len2);
    out.push((Math.acos(Math.max(-1, Math.min(1, cosAngle))) * 180) / Math.PI);
  }
  return out;
}

function computeMinDihedralAngle(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number]
): number {
  const nodes: [number, number, number][] = [p0, p1, p2, p3];
  const edges: [number, number][] = [
    [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
  ];

  let minAngle = 180;

  for (const edgeIndices of edges) {
    const i = edgeIndices[0];
    const j = edgeIndices[1];
    // Find the two other nodes
    const others = nodes.filter((_, idx) => idx !== i && idx !== j);
    if (others.length !== 2) continue;

    const pi = nodes[i];
    const pj = nodes[j];
    const pk = others[0];
    const pl = others[1];
    if (!pi || !pj || !pk || !pl) continue;

    const edgeVec = sub(pj, pi);
    const v1 = sub(pk, pi);
    const v2 = sub(pl, pi);

    const n1 = cross(edgeVec, v1);
    const n2 = cross(edgeVec, v2);

    const len1 = magnitude(n1);
    const len2 = magnitude(n2);

    if (len1 < 1e-15 || len2 < 1e-15) {
      minAngle = 0;
      break;
    }

    // n1 = e×(pk−pi), n2 = e×(pl−pi) both lie in the plane ⟂ to the shared
    // edge; the angle between them IS the interior dihedral angle along that
    // edge, over the full [0,180]° range. (Previously folded to [0,90]° via
    // min(a,180−a), which mis-reported obtuse slivers as their acute
    // supplement — issue #165.)
    const cosAngle = dot(n1, n2) / (len1 * len2);
    const angleRad = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    const dihedralDeg = (angleRad * 180) / Math.PI;
    minAngle = Math.min(minAngle, dihedralDeg);
  }

  return minAngle;
}

// ─── Scale-invariant normalized Jacobian & C3D10 tangling ─────────────────────

/** RMS of the 6 edge lengths of a tetrahedron (the natural length scale). */
function edgeRms(
  p0: [number, number, number], p1: [number, number, number],
  p2: [number, number, number], p3: [number, number, number],
): number {
  const ns = [p0, p1, p2, p3];
  let sum = 0, count = 0;
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
    const d = magnitude(sub(ns[i]!, ns[j]!));
    sum += d * d; count++;
  }
  return Math.sqrt(sum / count);
}

/**
 * Scale-invariant normalized Jacobian: signed detJ / edgeRMS³ (issue #165).
 * Dimensionless — a part in metres vs millimetres yields the same value.
 * Regular tet ≈ 0.707; a sliver → 0; an inverted C3D4 element < 0.
 */
function scaledJacobianOf(
  p0: [number, number, number], p1: [number, number, number],
  p2: [number, number, number], p3: [number, number, number],
): number {
  const detJ = computeJacobian(p0, p1, p2, p3);
  const h = edgeRms(p0, p1, p2, p3);
  if (h < 1e-30) return 0;
  return detJ / (h * h * h);
}

/**
 * C3D10 curved-element checks (issue #162): signed min detJ over the 4 stiffness
 * Gauss points (≤0 ⇒ folded/tangled map) and the largest mid-edge deviation from
 * the true midpoint relative to the edge length. Corner-tet inspection alone
 * misses midside-driven tangling.
 */
function c3d10CurvedChecks(
  nodes: Float64Array, elements: Int32Array, startIdx: number,
): { minGaussDetJ: number; midsideMaxDev: number } {
  const coords = new Float64Array(30);
  for (let ni = 0; ni < 10; ni++) {
    const nd = elements[startIdx + ni]!;
    coords[ni*3]   = nodes[nd*3]   ?? 0;
    coords[ni*3+1] = nodes[nd*3+1] ?? 0;
    coords[ni*3+2] = nodes[nd*3+2] ?? 0;
  }

  // A validly-oriented C3D10 element may have detJ CONSISTENTLY negative (just a
  // reversed node winding — the assembler integrates |detJ|, so it is fine, and
  // the C3D10 isoparametric sign convention differs from the corner triple
  // product anyway). TANGLING that corrupts the integral shows up as a SIGN
  // INCONSISTENCY AMONG the 4 stiffness Gauss points: a valid element (however
  // wound) has all four the same sign; a fold flips some. Align to the dominant
  // (sum) orientation and report the oriented minimum — ≤0 only when folded.
  const detJs: number[] = [];
  let sum = 0;
  for (const gp of C3D10_GAUSS) {
    let detJ: number;
    try {
      ({ detJ } = buildB_c3d10(coords, gp.xi, gp.eta, gp.zeta));
    } catch {
      detJ = 0; // near-zero Jacobian throws — treat as degenerate at this point
    }
    detJs.push(detJ);
    sum += detJ;
  }
  const s = sum >= 0 ? 1 : -1;
  let minDetJ = Infinity;
  for (const d of detJs) minDetJ = Math.min(minDetJ, d * s);

  // Midside deviation relative to edge length.
  let maxDev = 0;
  for (let ep = 0; ep < 6; ep++) {
    const [c0, c1] = C3D10_EDGE_PAIRS[ep]!;
    const mid = 4 + ep;
    let len2 = 0, dev2 = 0;
    for (let d = 0; d < 3; d++) {
      const a = coords[c0*3+d]!, b = coords[c1*3+d]!, m = coords[mid*3+d]!;
      const expected = 0.5 * (a + b);
      const dd = m - expected;
      dev2 += dd * dd;
      const el = b - a;
      len2 += el * el;
    }
    if (len2 > 1e-30) maxDev = Math.max(maxDev, Math.sqrt(dev2 / len2));
  }

  return { minGaussDetJ: minDetJ, midsideMaxDev: maxDev };
}

// ─── Quality Assessment ────────────────────────────────────────────────────────

/** True when a C3D10 element is tangled/folded (issue #162). */
function isC3D10Tangled(minGaussDetJ: number, midsideMaxDev: number): boolean {
  return minGaussDetJ <= 0 || midsideMaxDev > MIDSIDE_FOLD_DEV;
}

function assessSeverity(
  scaledJacobian: number,
  aspectRatio:    number,
  minDihedralDeg: number,
  minGaussDetJ:   number,
  midsideMaxDev:  number,
): ElementQualitySeverity {
  const absScaled = Math.abs(scaledJacobian);
  // Hard failures — the accuracy killers (issue #166). Note we use |scaled|:
  // a mirror-oriented but well-shaped C3D4 element (negative sign only) is NOT
  // degenerate because the assembler auto-orients it; a folded C3D10 element
  // IS, because Math.abs on |detJ| would silently integrate a wrong-but-
  // positive-definite stiffness (issue #162).
  if (isC3D10Tangled(minGaussDetJ, midsideMaxDev)) return "degenerate"; // folded quadratic map
  if (absScaled < SLIVER_SCALED_JAC) return "degenerate";   // near-zero-volume sliver
  if (aspectRatio > SLIVER_ASPECT)   return "degenerate";   // extreme aspect ratio
  // Soft warnings.
  if (absScaled < POOR_SCALED_JAC || aspectRatio > POOR_ASPECT || minDihedralDeg < POOR_DIHEDRAL_DEG) {
    return "poor";
  }
  return "normal";
}

// ─── Per-Element Metrics ───────────────────────────────────────────────────────

/**
 * Compute quality metrics for a single C3D4 element.
 */
function computeElementMetrics(
  elementIdx: number,
  nodes: Float64Array,
  elements: Int32Array,
  nodesPerElem: number
): ElementQualityMetrics {
  // Extract node indices for this element
  const startIdx = elementIdx * nodesPerElem;
  const n0Idx = elements[startIdx]!;
  const n1Idx = elements[startIdx + 1]!;
  const n2Idx = elements[startIdx + 2]!;
  const n3Idx = elements[startIdx + 3]!;

  // Extract coordinates
  const p0: [number, number, number] = [
    nodes[n0Idx * 3]!,
    nodes[n0Idx * 3 + 1]!,
    nodes[n0Idx * 3 + 2]!,
  ];
  const p1: [number, number, number] = [
    nodes[n1Idx * 3]!,
    nodes[n1Idx * 3 + 1]!,
    nodes[n1Idx * 3 + 2]!,
  ];
  const p2: [number, number, number] = [
    nodes[n2Idx * 3]!,
    nodes[n2Idx * 3 + 1]!,
    nodes[n2Idx * 3 + 2]!,
  ];
  const p3: [number, number, number] = [
    nodes[n3Idx * 3]!,
    nodes[n3Idx * 3 + 1]!,
    nodes[n3Idx * 3 + 2]!,
  ];

  const jacobianMin    = computeJacobian(p0, p1, p2, p3);
  const scaledJacobian = scaledJacobianOf(p0, p1, p2, p3);
  const aspectRatio    = computeAspectRatio(p0, p1, p2, p3);
  const minDihedralDeg = computeMinDihedralAngle(p0, p1, p2, p3);

  // C3D10: inspect the true isoparametric map at the Gauss points (midside-node
  // tangling is invisible to the 4-corner tet above). C3D4 has a constant
  // Jacobian and the assembler auto-orients it (Math.abs), so its "tangling"
  // measure is |jacobianMin| — ≥0 always, ≤0 only when the tet is truly
  // zero-volume. There is no midside to displace. Issue #162.
  let minGaussDetJ = Math.abs(jacobianMin);
  let midsideMaxDev = 0;
  if (nodesPerElem === 10) {
    const curved = c3d10CurvedChecks(nodes, elements, startIdx);
    minGaussDetJ = curved.minGaussDetJ;
    midsideMaxDev = curved.midsideMaxDev;
  }

  const severity = assessSeverity(scaledJacobian, aspectRatio, minDihedralDeg, minGaussDetJ, midsideMaxDev);

  return {
    elementIdx,
    jacobianMin,
    scaledJacobian,
    aspectRatio,
    minDihedralDeg,
    minGaussDetJ,
    midsideMaxDev,
    severity,
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
  let tangledCount = 0;

  // +∞-like sentinels so the worst is tracked correctly regardless of scale
  // (a mesh whose every element exceeds 1 mm³ previously under-reported
  // worstJacobianMin, which was initialized to 1 — issue #165).
  let worstJacobianMin = Infinity;
  let worstScaledJacobian = Infinity;   // tracked by magnitude (see below)
  let worstAspectRatio = 0;
  let worstMinDihedralDeg = 180;
  let worstElement: ElementQualityMetrics | null = null;

  const rank = (m: ElementQualityMetrics): number =>
    m.severity === "degenerate" ? 2 : m.severity === "poor" ? 1 : 0;

  for (let e = 0; e < elementCount; e++) {
    const metrics = computeElementMetrics(e, nodes, elements, nodesPerElem);

    if (metrics.severity === "degenerate") {
      degenerateCount++;
    } else if (metrics.severity === "poor") {
      poorQualityCount++;
    } else {
      normalCount++;
    }
    if (nodesPerElem === 10 && (metrics.minGaussDetJ <= 0 || metrics.midsideMaxDev > MIDSIDE_FOLD_DEV)) tangledCount++;

    worstJacobianMin = Math.min(worstJacobianMin, metrics.jacobianMin);
    if (Math.abs(metrics.scaledJacobian) < Math.abs(worstScaledJacobian)) {
      worstScaledJacobian = metrics.scaledJacobian;
    }
    worstAspectRatio = Math.max(worstAspectRatio, metrics.aspectRatio);
    worstMinDihedralDeg = Math.min(worstMinDihedralDeg, metrics.minDihedralDeg);

    // Worst element: most severe first, then smallest normalized Jacobian
    // (scale-invariant), so the reported hotspot is meaningful across units.
    if (!worstElement
        || rank(metrics) > rank(worstElement)
        || (rank(metrics) === rank(worstElement)
            && Math.abs(metrics.scaledJacobian) < Math.abs(worstElement.scaledJacobian))) {
      worstElement = metrics;
    }
  }

  if (!Number.isFinite(worstJacobianMin)) worstJacobianMin = 0;      // empty mesh guard
  if (!Number.isFinite(worstScaledJacobian)) worstScaledJacobian = 0;

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
    worstScaledJacobian,
    worstAspectRatio,
    worstMinDihedralDeg,
    tangledCount,
    worstElement,
  };
}
