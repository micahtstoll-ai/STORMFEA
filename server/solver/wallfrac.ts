/**
 * wallfrac.ts
 * -----------
 * Per-element wall-band volume fractions for the two-region (shell/core)
 * FDM material model.
 *
 * The wall band is the set of points within `tWall` of the part surface.
 * Volume meshes are far coarser than the band (2.9–6.3 mm element edges vs
 * a ~1.35 mm band), so a hard in/out element classification aliases badly.
 * Instead, each element gets the exact volume fraction of the tet where the
 * LINEAR interpolant of φ = nodeDist − tWall is negative — sub-element
 * resolution from just the 4 corner distances (marching-tetrahedra volume).
 *
 * Formulas are the standard simplex level-set volume fractions, written per
 * sign-case so every denominator is strictly nonzero by construction (a
 * negative φ minus a non-negative φ): no NaN, no tie-breaking jitter needed.
 * The 2-vs-2 wedge case was cross-checked against the divided-difference
 * identity  f = Σ_{φi<0} φi³/∏_{j≠i}(φi−φj).
 */

import type { TetMesh } from "./types.js";

/**
 * Volume fraction of a tetrahedron where the linear field φ (given at the 4
 * corners) is negative. Exact for a linear interpolant; φ = 0 corners count
 * as the non-negative side (measure-zero either way).
 */
export function tetFractionBelowIso(p0: number, p1: number, p2: number, p3: number): number {
  const phi = [p0, p1, p2, p3];
  const neg: number[] = [];
  const pos: number[] = [];
  for (const v of phi) (v < 0 ? neg : pos).push(v);

  if (neg.length === 0) return 0;
  if (neg.length === 4) return 1;

  if (neg.length === 1) {
    // Corner tet cut off at the lone negative vertex:
    //   f = ∏_j φneg/(φneg − φj)   (each denominator strictly < 0)
    const a = neg[0]!;
    let f = 1;
    for (const j of pos) f *= a / (a - j);
    return clamp01(f);
  }

  if (neg.length === 3) {
    // Complement of the 1-positive corner tet (denominators strictly > 0).
    const p = pos[0]!;
    let f = 1;
    for (const j of neg) f *= p / (p - j);
    return clamp01(1 - f);
  }

  // 2-vs-2: the negative region is a wedge (prism) with vertices A, B and the
  // four edge cuts toward C, D. Edge parameters t = φneg/(φneg − φpos) ∈ (0,1].
  // Prism split into 3 tets gives (derived in barycentric coordinates):
  //   f = t_ac·t_ad + t_ac·t_bd·(1 − t_ad) + t_bc·t_bd·(1 − t_ac)
  const a = neg[0]!, b = neg[1]!;
  const c = pos[0]!, d = pos[1]!;
  const tac = a / (a - c);
  const tad = a / (a - d);
  const tbc = b / (b - c);
  const tbd = b / (b - d);
  return clamp01(tac * tad + tac * tbd * (1 - tad) + tbc * tbd * (1 - tac));
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Wall-band volume fraction per element: fraction of each tet within `tWall`
 * of the surface, from corner-node surface distances (see distance.ts).
 * C3D10 midside nodes are ignored — the corners define the linear level set,
 * the same order of approximation as the faceted boundary itself.
 *
 * @returns Float64Array of length elementCount, values in [0, 1].
 */
export function computeWallFractions(
  mesh: TetMesh,
  nodeDist: Float64Array,
  tWall: number,
): Float64Array {
  const frac = new Float64Array(mesh.elementCount);
  if (tWall <= 0) return frac; // no wall band → all core
  const npe = mesh.nodesPerElem;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    const n0 = mesh.elements[base] ?? 0;
    const n1 = mesh.elements[base + 1] ?? 0;
    const n2 = mesh.elements[base + 2] ?? 0;
    const n3 = mesh.elements[base + 3] ?? 0;
    frac[e] = tetFractionBelowIso(
      (nodeDist[n0] ?? 0) - tWall,
      (nodeDist[n1] ?? 0) - tWall,
      (nodeDist[n2] ?? 0) - tWall,
      (nodeDist[n3] ?? 0) - tWall,
    );
  }
  return frac;
}

/**
 * Wall-band volume fraction per element from a precomputed nodal band
 * penetration φ (see `computeNodeBandPenetration` in distance.ts), where
 * φ < 0 already means "inside some wall/skin band". Identical marching-tet
 * volume as `computeWallFractions`, but the per-face band thickness is baked
 * into φ upstream, so nothing is subtracted here. Used by the multi-thickness
 * (perimeter wall vs top/bottom skin) two-region path.
 *
 * @returns Float64Array of length elementCount, values in [0, 1].
 */
export function computeWallFractionsFromPhi(
  mesh: TetMesh,
  nodePhi: Float64Array,
): Float64Array {
  const frac = new Float64Array(mesh.elementCount);
  const npe = mesh.nodesPerElem;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    const n0 = mesh.elements[base] ?? 0;
    const n1 = mesh.elements[base + 1] ?? 0;
    const n2 = mesh.elements[base + 2] ?? 0;
    const n3 = mesh.elements[base + 3] ?? 0;
    frac[e] = tetFractionBelowIso(
      nodePhi[n0] ?? 0,
      nodePhi[n1] ?? 0,
      nodePhi[n2] ?? 0,
      nodePhi[n3] ?? 0,
    );
  }
  return frac;
}

/**
 * Per-element, per-loop volume fractions: the wall band [0, tWall) is split
 * into `wallCount` discrete loops of width `lineWidth` (loop k spans
 * [k·lineWidth, (k+1)·lineWidth)), matching how a slicer actually deposits
 * `wallCount` separate perimeter beads instead of one homogeneous band.
 *
 * Reuses `tetFractionBelowIso` at each loop boundary — no new geometry
 * primitive, just `wallCount+1` iso-surface evaluations instead of one.
 * Report/mass-breakdown use only: does not feed the stiffness bins in
 * twoRegion.ts (all loops share the shell material there by design).
 *
 * @returns Float64Array of length elementCount*wallCount, row-major by
 *   element then loop index. Σ over loops for a given element equals
 *   computeWallFractions(mesh, nodeDist, wallCount*lineWidth)[e] to fp
 *   precision, since the loop bands exactly partition [0, tWall).
 */
export function computeLoopVolumeFractions(
  mesh: TetMesh,
  nodeDist: Float64Array,
  lineWidth: number,
  wallCount: number,
): Float64Array {
  const out = new Float64Array(mesh.elementCount * wallCount);
  if (lineWidth <= 0 || wallCount <= 0) return out;
  const npe = mesh.nodesPerElem;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    const n0 = mesh.elements[base] ?? 0;
    const n1 = mesh.elements[base + 1] ?? 0;
    const n2 = mesh.elements[base + 2] ?? 0;
    const n3 = mesh.elements[base + 3] ?? 0;
    const d0 = nodeDist[n0] ?? 0, d1 = nodeDist[n1] ?? 0, d2 = nodeDist[n2] ?? 0, d3 = nodeDist[n3] ?? 0;
    // Cumulative "below outer boundary of loop k" fraction, then difference
    // consecutive thresholds so each loop's fraction is exact and the sum
    // telescopes back to the single-threshold wallFrac exactly.
    let prevBelow = 0;
    for (let k = 0; k < wallCount; k++) {
      const iso = (k + 1) * lineWidth;
      const below = tetFractionBelowIso(d0 - iso, d1 - iso, d2 - iso, d3 - iso);
      out[e * wallCount + k] = Math.max(0, below - prevBelow);
      prevBelow = below;
    }
  }
  return out;
}

/**
 * Per-element "wall interior" fraction: how much of this tet sits at a
 * loop-to-loop internal boundary (i.e. has a bonded wall-loop neighbor on
 * BOTH sides), rather than at the outer surface or the innermost
 * shell/core boundary. Zero identically when wallCount < 2 (no internal
 * loop boundary exists) — this is the natural flag-off no-op for the
 * wall-to-wall bond criterion.
 *
 * Uses a band centered on the internal-boundary set, from the midpoint of
 * the first loop to the midpoint of the last loop
 * ([0.5·lineWidth, (wallCount−0.5)·lineWidth]), rather than gating on a
 * discrete "interior loop index" (which would degenerate to zero at
 * wallCount=2 even though a single valid internal boundary exists there).
 *
 * @returns Float64Array of length elementCount, values in [0, 1].
 */
export function computeWallInteriorFraction(
  mesh: TetMesh,
  nodeDist: Float64Array,
  lineWidth: number,
  wallCount: number,
): Float64Array {
  const frac = new Float64Array(mesh.elementCount);
  if (lineWidth <= 0 || wallCount < 2) return frac;
  const isoLo = 0.5 * lineWidth;
  const isoHi = (wallCount - 0.5) * lineWidth;
  const npe = mesh.nodesPerElem;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    const n0 = mesh.elements[base] ?? 0;
    const n1 = mesh.elements[base + 1] ?? 0;
    const n2 = mesh.elements[base + 2] ?? 0;
    const n3 = mesh.elements[base + 3] ?? 0;
    const d0 = nodeDist[n0] ?? 0, d1 = nodeDist[n1] ?? 0, d2 = nodeDist[n2] ?? 0, d3 = nodeDist[n3] ?? 0;
    const belowHi = tetFractionBelowIso(d0 - isoHi, d1 - isoHi, d2 - isoHi, d3 - isoHi);
    const belowLo = tetFractionBelowIso(d0 - isoLo, d1 - isoLo, d2 - isoLo, d3 - isoLo);
    frac[e] = Math.max(0, belowHi - belowLo);
  }
  return frac;
}
