/**
 * meshQuality.ts
 * ──────────────
 * Per-element quality metrics: Jacobian determinant, aspect ratio, dihedral angles.
 * Used to detect degenerate/inverted elements and poor-quality tetrahedra.
 *
 * Metrics:
 *   - Jacobian determinant (J_min): volume-related, must be > 0 for valid element
 *   - Aspect ratio (AR): longest edge / shortest altitude, should be < 20
 *   - Minimum dihedral angle: should be > 5°
 *
 * Thresholds:
 *   - Degenerate: J_min < 0 (inverted element)
 *   - Poor quality: J_min < 0.01 OR AR > 20 OR min dihedral < 5°
 */

import type { TetMesh, ElementQualityMetrics, MeshQualityReport, ElementQualitySeverity } from "./types.js";

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

    const cosAngle = dot(n1, n2) / (len1 * len2);
    const angleRad = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    const angleDeg = (angleRad * 180) / Math.PI;

    // Dihedral angle is the supplement if we computed the exterior angle
    const dihedralDeg = Math.min(angleDeg, 180 - angleDeg);
    minAngle = Math.min(minAngle, dihedralDeg);
  }

  return minAngle;
}

// ─── Quality Assessment ────────────────────────────────────────────────────────

function assessSeverity(jacobianMin: number, aspectRatio: number, minDihedralDeg: number): ElementQualitySeverity {
  if (jacobianMin < 0) return "degenerate";
  if (jacobianMin < 0.01 || aspectRatio > 20 || minDihedralDeg < 5) return "poor";
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

  const jacobianMin = computeJacobian(p0, p1, p2, p3);
  const aspectRatio = computeAspectRatio(p0, p1, p2, p3);
  const minDihedralDeg = computeMinDihedralAngle(p0, p1, p2, p3);
  const severity = assessSeverity(jacobianMin, aspectRatio, minDihedralDeg);

  return {
    elementIdx,
    jacobianMin,
    aspectRatio,
    minDihedralDeg,
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

  let worstJacobianMin = 1;
  let worstAspectRatio = 0;
  let worstMinDihedralDeg = 180;
  let worstElement: ElementQualityMetrics | null = null;

  for (let e = 0; e < elementCount; e++) {
    const metrics = computeElementMetrics(e, nodes, elements, nodesPerElem);

    if (metrics.severity === "degenerate") {
      degenerateCount++;
    } else if (metrics.severity === "poor") {
      poorQualityCount++;
    } else {
      normalCount++;
    }

    worstJacobianMin = Math.min(worstJacobianMin, metrics.jacobianMin);
    worstAspectRatio = Math.max(worstAspectRatio, metrics.aspectRatio);
    worstMinDihedralDeg = Math.min(worstMinDihedralDeg, metrics.minDihedralDeg);

    if (!worstElement || metrics.severity !== "normal") {
      if (!worstElement || metrics.jacobianMin < worstElement.jacobianMin) {
        worstElement = metrics;
      }
    }
  }

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
    worstAspectRatio,
    worstMinDihedralDeg,
    worstElement,
  };
}
