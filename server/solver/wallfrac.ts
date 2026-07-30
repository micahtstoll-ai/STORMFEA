/**
 * wallfrac.ts
 * -----------
 * Per-element wall-band volume fractions for the two-region (shell/core)
 * FDM material model.
 *
 * The wall band is the set of points within `tWall` of the part surface.
 * Volume meshes are far coarser than the band (2.9–6.3 mm element edges vs
 * a ~1.35 mm band), so a hard in/out element classification aliases badly.
 * Instead, each element gets the volume fraction of the tet where φ = nodeDist
 * − tWall is negative (marching-tetrahedra volume). For C3D4 this is the exact
 * fraction of the LINEAR interpolant from the 4 corner distances. For C3D10 the
 * element is subdivided into 8 corner/midside sub-tets (issue #180) so the
 * quadratic band field is resolved between corners — a band that enters an
 * element without reaching a corner (concave features: fillet roots, boss
 * bases) is otherwise reported as fraction 0 by the corner-only interpolant.
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
 * Sub-tetrahedra of a (straight-sided) C3D10 quadratic tet for the level-set
 * volume fraction (issue #180). Local node order per element:
 *   0–3 corners; 4=mid(0,1) 5=mid(1,2) 6=mid(0,2) 7=mid(0,3) 8=mid(1,3) 9=mid(2,3).
 *
 * The standard uniform refinement: 4 corner sub-tets plus the central
 * octahedron (edge-midpoint hull) split into 4 along the internal diagonal
 * 4–9 (mid(0,1)–mid(2,3), the two opposite edges that share no vertex), whose
 * equator 6–7–8–5 is a valid 4-cycle of octahedron edges. For a straight-sided
 * quadratic tet the midside nodes are exact edge midpoints, so all 8 sub-tets
 * have volume = ⅛ of the parent and the element fraction is their unweighted
 * mean. (This matches the straight-sided C3D10 assumption already made by the
 * two-region volume integration in twoRegion.ts.)
 *
 * Consuming the midside φ this way captures a band that enters the element
 * between corners (all 4 corners on the same side of the iso-surface, a midside
 * on the other) — which the 4-corner linear interpolant reports as fraction 0.
 */
const C3D10_SUBTETS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 4, 6, 7], [1, 4, 5, 8], [2, 5, 6, 9], [3, 7, 8, 9], // corner tets
  [4, 9, 6, 7], [4, 9, 7, 8], [4, 9, 8, 5], [4, 9, 5, 6], // central octahedron
];

/**
 * Volume fraction of ONE element where the field φ (per local node) is
 * negative. C3D4 (npe < 10): the exact 4-corner marching-tet fraction. C3D10
 * (npe ≥ 10): the mean of the 8 corner/midside sub-tet fractions (issue #180),
 * quadratic-resolution capture with zero extra distance queries.
 *
 * `phi(localNode)` returns φ at local node index 0..3 (C3D4) or 0..9 (C3D10).
 * NaN-free by construction: every sub-tet fraction routes through
 * `tetFractionBelowIso`, whose per-sign-case denominators are strictly nonzero.
 */
function elementFractionBelowIso(npe: number, phi: (localNode: number) => number): number {
  if (npe >= 10) {
    let sum = 0;
    for (const [a, b, c, d] of C3D10_SUBTETS) {
      sum += tetFractionBelowIso(phi(a), phi(b), phi(c), phi(d));
    }
    return sum / C3D10_SUBTETS.length;
  }
  return tetFractionBelowIso(phi(0), phi(1), phi(2), phi(3));
}

/**
 * Wall-band volume fraction per element: fraction of each tet within `tWall`
 * of the surface, from node surface distances (see distance.ts). For C3D10 the
 * midside distances are consumed via the 8 sub-tet subdivision (issue #180), so
 * a band entering the element between corners is captured; C3D4 uses the exact
 * 4-corner marching-tet fraction.
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
  const elems = mesh.elements;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    frac[e] = elementFractionBelowIso(npe, (local) => (nodeDist[elems[base + local] ?? 0] ?? 0) - tWall);
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
  const elems = mesh.elements;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    frac[e] = elementFractionBelowIso(npe, (local) => nodePhi[elems[base + local] ?? 0] ?? 0);
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
  const elems = mesh.elements;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    // Cumulative "below outer boundary of loop k" fraction, then difference
    // consecutive thresholds so each loop's fraction is exact and the sum
    // telescopes back to the single-threshold wallFrac exactly (same sub-tet
    // subdivision as computeWallFractions, so telescoping holds for C3D10 too).
    let prevBelow = 0;
    for (let k = 0; k < wallCount; k++) {
      const iso = (k + 1) * lineWidth;
      const below = elementFractionBelowIso(npe, (local) => (nodeDist[elems[base + local] ?? 0] ?? 0) - iso);
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
  const elems = mesh.elements;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    const belowHi = elementFractionBelowIso(npe, (local) => (nodeDist[elems[base + local] ?? 0] ?? 0) - isoHi);
    const belowLo = elementFractionBelowIso(npe, (local) => (nodeDist[elems[base + local] ?? 0] ?? 0) - isoLo);
    frac[e] = Math.max(0, belowHi - belowLo);
  }
  return frac;
}
