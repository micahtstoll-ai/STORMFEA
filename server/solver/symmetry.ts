/**
 * symmetry.ts
 * -----------
 * Mirror-symmetry detection for a part's boundary surface (issue #296).
 *
 * WHY THIS EXISTS
 * ---------------
 * An unstructured tet mesh of a mirror-symmetric part is not itself
 * mirror-symmetric, so the recovered stress field carries an asymmetry the
 * geometry does not have. Measured on a symmetric cantilever fixture: only 128
 * of 384 element centroids had a mirror partner at all, and the SPR nodal
 * field's mirror asymmetry ran 1.83 / 0.88 / 0.52 % rms across 384 / 3,072 /
 * 10,368 elements while the DISPLACEMENT field stayed symmetric to 0.001%. A
 * user looking at a symmetric part with an asymmetric heatmap cannot tell
 * whether they are seeing physics or meshing.
 *
 * The fix is to mesh a fundamental domain and mirror it, which first requires
 * knowing whether — and about which plane — the part is symmetric. That is
 * what this module answers. It is deliberately separate from, and usable
 * without, the meshing half.
 *
 * WHY THE VERIFICATION DOES NOT MATCH MESH ENTITIES
 * -------------------------------------------------
 * The obvious test — mirror the nodes and look for a node at the image
 * position — is exactly wrong here, because the input is a symmetric part
 * whose MESH is asymmetric. That is the condition being detected, so a test
 * that requires mesh-entity correspondence would reject every real case.
 *
 * Instead each mirrored sample point is measured against the SURFACE AS A
 * GEOMETRIC OBJECT: the distance from the image point to the nearest boundary
 * triangle, via the same `pointTriangleDistance` the two-region distance field
 * uses. On a truly symmetric part every mirrored surface point lies ON the
 * surface, whatever triangles happen to be there. The test is therefore
 * independent of how the part was meshed, which is the whole point.
 *
 * CANDIDATE PLANES
 * ----------------
 * A mirror plane maps the body to itself, so it maps the inertia tensor to
 * itself, so its normal is an eigenvector of that tensor. Three candidates,
 * from the area-weighted covariance of the boundary surface.
 *
 * The three COORDINATE axes are tested as well. Two reasons: a part whose
 * covariance has near-equal eigenvalues (a cube, a square-section bar) has
 * numerically arbitrary eigenvectors, and CAD parts are usually modelled
 * axis-aligned, so the coordinate axes are the likely answer precisely when
 * the principal axes are least trustworthy. Duplicates are removed.
 */

import type { TetMesh } from "./types.js";
import { pointTriangleDistance } from "./distance.js";

/** A detected mirror-symmetry plane, in the mesh's own coordinates. */
export interface SymmetryPlane {
  /** Unit normal to the plane. */
  readonly normal: readonly [number, number, number];
  /** A point on the plane (the area-weighted surface centroid). */
  readonly origin: readonly [number, number, number];
  /**
   * Worst mirrored-sample-to-surface distance, as a fraction of the bounding
   * box diagonal. Zero is a perfect mirror; the accept threshold is `tolRel`.
   */
  readonly residual: number;
}

/**
 * Sample-count ceiling for the verification sweep.
 *
 * Verification is O(samples x triangles) with no acceleration structure, which
 * is affordable only because the sweep SHORT-CIRCUITS on the first sample that
 * exceeds tolerance — the asymmetric case, which is the common one, exits
 * almost immediately. A symmetric part pays the full cost, so the sample count
 * is capped rather than scaling with the mesh.
 *
 * Confidence: LOW as a specific number. It trades detection sensitivity for
 * time and has not been tuned against a corpus of real parts; it is set where
 * a full sweep stays well under a second on the fixtures in this repo. Raising
 * it makes detection stricter (more chances to find a violation), never looser.
 */
export const SYMMETRY_MAX_SAMPLES = 1500;

/**
 * Default acceptance tolerance, as a fraction of the bounding-box diagonal.
 *
 * A mirrored surface point must land within this of the surface. 1e-3 of the
 * diagonal is ~0.1 mm on a 100 mm part — tight enough to reject a part with a
 * real feature on one side only, loose enough to absorb the faceting error of
 * an STL approximation of a curved surface, which is the dominant source of
 * residual on a genuinely symmetric part.
 *
 * Confidence: LOW. Chosen by argument from STL chord error, not measured
 * against a corpus. It is the knob to revisit if detection proves too eager or
 * too shy on real parts.
 */
export const SYMMETRY_DEFAULT_TOL_REL = 1e-3;

/**
 * Two candidate normals closer than this are treated as the same plane.
 *
 * Not a cosmetic tidy-up — without it the detector reports SIX planes for a
 * box, which has three. The covariance is built from the boundary
 * triangulation's centroid cloud, and that cloud is genuinely chiral (the tet
 * subdivision is), so the principal axes of a perfectly axis-aligned box come
 * back rotated by ~1e-4 rad. Measured on a 100x50x20 box at 3,072 elements the
 * eigenvectors were [0.000225, 0.000460, 1.000000] and friends: a dot product
 * of 1 - 1.3e-7 against the true axis, which sails through a 1e-9 duplicate
 * test, then passes verification on its own (residuals 3.7e-4 to 8.7e-4, under
 * the 1e-3 acceptance) and is reported as a separate plane.
 *
 * One degree is far wider than that numerical spread and far narrower than any
 * real pair of distinct mirror planes. A body with mirror planes genuinely one
 * degree apart has near-continuous rotational symmetry (a cylinder has
 * infinitely many), and collapsing those to one representative is the right
 * answer anyway — a fundamental domain can only be cut about one of them.
 *
 * Candidates are ordered COORDINATE AXES FIRST so that when an exact axis and
 * a numerically-rotated principal axis collapse together, the exact one wins.
 * The cost of being wrong is a false negative on a part whose true symmetry
 * plane sits within a degree of a coordinate axis but not on it: the exact
 * axis is verified, fails, and the near-miss principal axis never gets its
 * turn. That direction is safe — the part simply meshes the way it does today.
 */
export const SYMMETRY_DEDUP_ANGLE_DEG = 1;

/** Symmetric 3x3 eigendecomposition by cyclic Jacobi. Returns unit columns. */
function jacobiEigenvectors3(a: number[][]): [number, number, number][] {
  const m = [[a[0]![0]!, a[0]![1]!, a[0]![2]!],
             [a[1]![0]!, a[1]![1]!, a[1]![2]!],
             [a[2]![0]!, a[2]![1]!, a[2]![2]!]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 32; sweep++) {
    let off = 0;
    for (let p = 0; p < 3; p++) for (let q = p + 1; q < 3; q++) off += m[p]![q]! * m[p]![q]!;
    if (off < 1e-24) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = m[p]![q]!;
        if (Math.abs(apq) < 1e-30) continue;
        const theta = (m[q]![q]! - m[p]![p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const mkp = m[k]![p]!, mkq = m[k]![q]!;
          m[k]![p] = c * mkp - s * mkq;
          m[k]![q] = s * mkp + c * mkq;
        }
        for (let k = 0; k < 3; k++) {
          const mpk = m[p]![k]!, mqk = m[q]![k]!;
          m[p]![k] = c * mpk - s * mqk;
          m[q]![k] = s * mpk + c * mqk;
          const vkp = v[k]![p]!, vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return [
    [v[0]![0]!, v[1]![0]!, v[2]![0]!],
    [v[0]![1]!, v[1]![1]!, v[2]![1]!],
    [v[0]![2]!, v[1]![2]!, v[2]![2]!],
  ];
}

/**
 * Find every mirror-symmetry plane of a part's boundary surface.
 *
 * @param mesh          The volume mesh (only `nodes` is read).
 * @param surfaceFaces  Boundary triangle corner-index triples, as produced by
 *                      `extractSurfaceFaces` or either mesher.
 * @param tolRel        Acceptance tolerance as a fraction of the bbox
 *                      diagonal. Default `SYMMETRY_DEFAULT_TOL_REL`.
 * @returns             Accepted planes, best (lowest residual) first. Empty
 *                      when the part has no mirror symmetry, which is the
 *                      normal outcome for most geometry.
 */
export function detectSymmetryPlanes(
  mesh:         TetMesh,
  surfaceFaces: Int32Array,
  tolRel:       number = SYMMETRY_DEFAULT_TOL_REL,
): SymmetryPlane[] {
  const triCount = Math.floor(surfaceFaces.length / 3);
  if (triCount === 0) return [];
  const nodes = mesh.nodes;

  // ── Bounding box, for the scale the tolerance is relative to ─────────────
  let xMin = Infinity, yMin = Infinity, zMin = Infinity;
  let xMax = -Infinity, yMax = -Infinity, zMax = -Infinity;
  for (let t = 0; t < triCount * 3; t++) {
    const n = surfaceFaces[t] ?? 0;
    const x = nodes[n * 3] ?? 0, y = nodes[n * 3 + 1] ?? 0, z = nodes[n * 3 + 2] ?? 0;
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    if (z < zMin) zMin = z; if (z > zMax) zMax = z;
  }
  const diag = Math.hypot(xMax - xMin, yMax - yMin, zMax - zMin);
  if (!(diag > 0)) return [];
  const tolAbs = tolRel * diag;

  // ── Area-weighted centroid and covariance of the surface ─────────────────
  // Area weighting rather than node counting: a mesh with more triangles on
  // one side of a symmetric part would otherwise pull the centroid off the
  // symmetry plane, which is the exact failure this module must not have.
  const triCx = new Float64Array(triCount);
  const triCy = new Float64Array(triCount);
  const triCz = new Float64Array(triCount);
  const triA  = new Float64Array(triCount);
  let areaTotal = 0, cx = 0, cy = 0, cz = 0;
  for (let t = 0; t < triCount; t++) {
    const na = surfaceFaces[t * 3] ?? 0, nb = surfaceFaces[t * 3 + 1] ?? 0, nc = surfaceFaces[t * 3 + 2] ?? 0;
    const ax = nodes[na * 3] ?? 0, ay = nodes[na * 3 + 1] ?? 0, az = nodes[na * 3 + 2] ?? 0;
    const bx = nodes[nb * 3] ?? 0, by = nodes[nb * 3 + 1] ?? 0, bz = nodes[nb * 3 + 2] ?? 0;
    const ccx = nodes[nc * 3] ?? 0, ccy = nodes[nc * 3 + 1] ?? 0, ccz = nodes[nc * 3 + 2] ?? 0;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = ccx - ax, vy = ccy - ay, vz = ccz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const area = 0.5 * Math.hypot(nx, ny, nz);
    triA[t] = area;
    triCx[t] = (ax + bx + ccx) / 3;
    triCy[t] = (ay + by + ccy) / 3;
    triCz[t] = (az + bz + ccz) / 3;
    areaTotal += area;
    cx += area * triCx[t]!; cy += area * triCy[t]!; cz += area * triCz[t]!;
  }
  if (!(areaTotal > 0)) return [];
  cx /= areaTotal; cy /= areaTotal; cz /= areaTotal;

  const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let t = 0; t < triCount; t++) {
    const w = triA[t]! / areaTotal;
    const dx = triCx[t]! - cx, dy = triCy[t]! - cy, dz = triCz[t]! - cz;
    cov[0]![0]! += w * dx * dx; cov[0]![1]! += w * dx * dy; cov[0]![2]! += w * dx * dz;
    cov[1]![0]! += w * dy * dx; cov[1]![1]! += w * dy * dy; cov[1]![2]! += w * dy * dz;
    cov[2]![0]! += w * dz * dx; cov[2]![1]! += w * dz * dy; cov[2]![2]! += w * dz * dz;
  }

  // ── Candidate normals: the coordinate axes + the principal axes ──────────
  // Coordinate axes FIRST: they are exact, and when a numerically-rotated
  // principal axis collapses onto one during dedup the exact representative is
  // the one kept. See SYMMETRY_DEDUP_ANGLE_DEG.
  const candidates: [number, number, number][] = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1],
    ...jacobiEigenvectors3(cov),
  ];
  const dedupDot = Math.cos((SYMMETRY_DEDUP_ANGLE_DEG * Math.PI) / 180);
  const unique: [number, number, number][] = [];
  for (const c of candidates) {
    const len = Math.hypot(c[0], c[1], c[2]);
    if (!(len > 0)) continue;
    const n: [number, number, number] = [c[0] / len, c[1] / len, c[2] / len];
    // +n and -n describe the same plane, so compare on |dot|.
    if (unique.some(u => Math.abs(u[0] * n[0] + u[1] * n[1] + u[2] * n[2]) > dedupDot)) continue;
    unique.push(n);
  }

  // ── Sample points: triangle centroids, strided to the cap ────────────────
  const stride = Math.max(1, Math.ceil(triCount / SYMMETRY_MAX_SAMPLES));
  const sample: number[] = [];
  for (let t = 0; t < triCount; t += stride) sample.push(t);

  const found: SymmetryPlane[] = [];
  for (const n of unique) {
    let worst = 0;
    let ok = true;
    for (const t of sample) {
      // Mirror the sample point through the candidate plane.
      const dx = triCx[t]! - cx, dy = triCy[t]! - cy, dz = triCz[t]! - cz;
      const d = dx * n[0] + dy * n[1] + dz * n[2];
      const px = triCx[t]! - 2 * d * n[0];
      const py = triCy[t]! - 2 * d * n[1];
      const pz = triCz[t]! - 2 * d * n[2];

      // Nearest distance from the image point to the surface. Short-circuits
      // as soon as any triangle puts it inside tolerance, and the outer loop
      // bails on the first sample that cannot be satisfied — so an asymmetric
      // candidate is rejected in roughly one sample's work.
      let best = Infinity;
      for (let s = 0; s < triCount; s++) {
        const na = surfaceFaces[s * 3] ?? 0, nb = surfaceFaces[s * 3 + 1] ?? 0, nc = surfaceFaces[s * 3 + 2] ?? 0;
        const dd = pointTriangleDistance(
          px, py, pz,
          nodes[na * 3] ?? 0, nodes[na * 3 + 1] ?? 0, nodes[na * 3 + 2] ?? 0,
          nodes[nb * 3] ?? 0, nodes[nb * 3 + 1] ?? 0, nodes[nb * 3 + 2] ?? 0,
          nodes[nc * 3] ?? 0, nodes[nc * 3 + 1] ?? 0, nodes[nc * 3 + 2] ?? 0,
        );
        if (dd < best) best = dd;
        if (best <= tolAbs) break;
      }
      if (best > tolAbs) { ok = false; break; }
      if (best > worst) worst = best;
    }
    if (ok) {
      found.push({ normal: n, origin: [cx, cy, cz], residual: worst / diag });
    }
  }

  found.sort((a, b) => a.residual - b.residual);
  return found;
}
