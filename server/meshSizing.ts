/**
 * meshSizing.ts — the resolution contract a mesh tier makes, shared by both
 * mesher paths (issue #295).
 *
 * STORMFEA has two meshers and they used to size themselves on incompatible
 * philosophies: STL -> TetGen was scale-relative (bounding-box volume over a
 * target element COUNT) while STEP -> Gmsh was absolute millimetres, which
 * fixes an element SIZE and lets the count float with part size. "Fine" meant
 * 40,000 elements for an STL and 2 mm elements for a STEP, and neither path
 * had a floor on the thinnest section.
 *
 * This module is the single definition of what a tier promises, so the promise
 * cannot drift between the two paths again:
 *
 *   1. a target element COUNT       (`MESH_TARGET_ELEMENTS`)
 *   2. a through-thickness FLOOR    (`MIN_ELEMENTS_THROUGH_THICKNESS`)
 *   3. one overshoot ceiling        (`MESH_MAX_BUDGET_OVERSHOOT`)
 *   4. one edge <-> volume relation (`regularTetEdgeForCount` and friends)
 *
 * Deliberately dependency-free and pure: no mesher binary, no TetMesh import,
 * no solver types. Both `tetgen.ts` and `gmsh_mesh.ts` build their own
 * mesher-specific flags on top of it, and the achieved-resolution readout is
 * computed from plain numbers so the caller can feed it a real meshed volume.
 *
 * See `docs/mesh-sizing.md` for the landed decision and its measurements.
 */

/**
 * Per-tier target element counts, shared by BOTH mesher paths so a tier means
 * the same resolution budget whichever file format the part arrived in.
 *
 * These are the historical TetGen numbers (issue #168): a typical mm-scale FDM
 * part (~120,000 mm³ bbox, a ≈49 mm cube) reproduces the old fixed TetGen
 * volumes of 30/10/3 mm³ exactly, so adopting them on the Gmsh side changed the
 * Gmsh contract without changing the TetGen one.
 */
export const MESH_TARGET_ELEMENTS = { coarse: 4_000, standard: 12_000, fine: 40_000 } as const;

export type MeshTier = keyof typeof MESH_TARGET_ELEMENTS;

/**
 * Minimum elements across the part's SMALLEST bounding-box dimension.
 *
 * This is the floor an element-count budget alone does not provide. A count
 * target is a budget for the WHOLE part, so a large thin plate can hit 40,000
 * elements while carrying two of them through a 4 mm wall — under-resolved for
 * bending however many elements the part holds in total, and bending is the
 * dominant FTC bracket load case.
 *
 * MEASURED, not conventional. A 60x30x6 mm cantilever with a 1.35 mm wall band
 * (shell E_xy 2400 / core E_xy 600 MPa) was solved with the two-region field
 * active and against the homogenized average at the same resolution, sweeping
 * elements through the 6 mm thickness. The quantity that matters is how much of
 * the converged SANDWICH STIFFENING (26.1% at 8 elements through) each
 * resolution recovers:
 *
 *   1 through: 4% of the stiffening, tip deflection 29.0% off converged
 *   2 through: 57%, 13.1% off
 *   3 through: 83%,  4.75% off
 *   4 through: 100%, 0.84% off
 *   8 through: 100%, converged (reference)
 *
 * Four is where the structural effect is fully recovered. Three — the
 * conventional textbook figure, and what this constant was first set to —
 * leaves 17% of it behind. At ONE element through thickness the two-region
 * model returns essentially the homogenized answer while reporting itself
 * active, which is worse than not offering it.
 *
 * Note the wall-band CLASSIFICATION converges far faster than the structural
 * response: the same fixture recovers the exact analytic shell volume fraction
 * to 3.2% at one element per 4.4 band widths and to 0.06% at h = 1.5 mm,
 * because `tetFractionBelowIso` integrates the level set INSIDE the element
 * (two-region invariant 2). Volume fraction is therefore the wrong thing to
 * size the mesh against; the through-thickness layering is the binding
 * constraint, and this constant is set from it.
 *
 * Confidence: MEDIUM. One geometry and one shell/core contrast — the threshold
 * could move with a much stiffer or much thinner skin. It is a floor rather
 * than a target, so erring high is the safe direction.
 */
export const MIN_ELEMENTS_THROUGH_THICKNESS = 4;

/**
 * How far past the tier's element target the sizing may land before it is
 * pulled back. The floor above can demand more elements than the budget wants
 * — a large thin plate is the standard conflict — and resolving the section
 * matters more than hitting a count, so the allowance is deliberately loose.
 * It exists to stop a pathological geometry from building a mesh the solver
 * cannot finish, not to enforce the target.
 */
export const MESH_MAX_BUDGET_OVERSHOOT = 4;

/**
 * Volume of a regular tetrahedron of edge length `h`.
 *
 * This one relation is what lets an edge-length floor (`MIN_ELEMENTS_THROUGH_
 * THICKNESS` is expressed in edges across a dimension) be handed to TetGen,
 * whose `-a` switch is a VOLUME cap, and to Gmsh, whose `clmax` is a LENGTH.
 * Both paths therefore describe the same geometry, as does `sizeFieldToVolFile`
 * (solver/adaptiveMesh.ts), which uses the same 6·√2.
 */
export function regularTetVolumeForEdge(h: number): number {
  return Math.pow(h, 3) / (6 * Math.SQRT2);
}

/**
 * Edge length of a regular tetrahedron that fills `volume` with `count`
 * elements. Inverse of `regularTetVolumeForEdge` scaled by the count.
 *
 * Confidence: LOW as an absolute predictor. A real mesh is not regular tets and
 * typically emits somewhat MORE elements than this for a given size cap —
 * exactly what `VOLUME_CAP_SCALE` (adaptiveMesh.ts, calibrated to 13 on one
 * geometry) exists to absorb on the TetGen side, where the equivalent ratio on
 * the tier path drifts between ~2.5 and ~5.5 with density.
 *
 * That error has a KNOWN SIGN, which is why it is usable here: more elements
 * than predicted means elements SMALLER than predicted, so a through-thickness
 * floor derived from this relation delivers at least the layers it asks for.
 * It errs toward a finer mesh, never a coarser one. Nothing downstream treats
 * the predicted count as truth — it drives a log line, the overshoot clamp, and
 * an achieved-vs-target readout that reports the real number once the mesher
 * has run (`achievedResolution`).
 */
export function regularTetEdgeForCount(volume: number, count: number): number {
  return Math.cbrt((6 * Math.SQRT2 * volume) / count);
}

/** Regular-tet estimate of how many elements of edge `h` fill `volume`. */
export function regularTetCountForEdge(volume: number, h: number): number {
  return volume / regularTetVolumeForEdge(h);
}

export interface MeshBounds {
  minX: number; maxX: number;
  minY: number; maxY: number;
  minZ: number; maxZ: number;
}

/** Bounding-box spans, volume and smallest dimension. */
export function bboxMetrics(bounds: MeshBounds): {
  dx: number; dy: number; dz: number; volume: number; minDim: number;
} {
  const dx = bounds.maxX - bounds.minX;
  const dy = bounds.maxY - bounds.minY;
  const dz = bounds.maxZ - bounds.minZ;
  return { dx, dy, dz, volume: dx * dy * dz, minDim: Math.min(dx, dy, dz) };
}

/**
 * True when a bounding box carries no usable scale information (degenerate,
 * non-finite, or flat). Callers keep their historical absolute sizing in that
 * case rather than inventing a size from a bad number.
 */
export function bboxIsUsable(bounds: MeshBounds): boolean {
  const { volume, minDim } = bboxMetrics(bounds);
  return volume > 0 && Number.isFinite(volume) && minDim > 0;
}

/**
 * What a tier actually DELIVERED, measured on the mesh the mesher returned
 * rather than predicted from the flags it was given (issue #295: "both paths
 * should report achieved vs target element count, so a 12x shortfall is visible
 * rather than silent").
 *
 * The predicted numbers cannot serve this purpose on their own. Both meshers
 * treat a size cap as a REQUEST: TetGen's switch-set fallback chain drops `-q`
 * and can end at `-pQ` with no volume constraint at all, and Gmsh's `clmax` is
 * not honoured where a curvature or boundary constraint disagrees. A readout
 * built from the flags would report the mesh that was ASKED for, which is
 * exactly the mesh that is not in doubt.
 *
 * `meshedVolume` should be the summed element volume when the caller has it
 * (see `tetCornerVolume`, solver/adaptiveMesh.ts). Falling back to the bounding
 * box overestimates the mean element volume for anything non-boxy and so
 * UNDER-reports the achieved resolution — conservative, but worth avoiding.
 */
export interface MeshResolutionReport {
  tier: MeshTier;
  /** Elements the tier targets. */
  targetElements: number;
  /** Elements the mesher actually emitted. */
  achievedElements: number;
  /** achieved / target. Below 1 is a shortfall, above 1 an overshoot. */
  budgetRatio: number;
  /** Mean element volume, back-figured to a regular-tet edge length. */
  characteristicEdge: number;
  /** Elements across the smallest bbox dimension at that edge length. */
  elementsThroughThickness: number;
  /** True when the section carries fewer than the floor demands. */
  belowThroughThicknessFloor: boolean;
  /** Human-readable summary, null when nothing is worth flagging. */
  warning: string | null;
}

export function achievedResolution(
  bounds:       MeshBounds,
  tier:         MeshTier,
  elementCount: number,
  meshedVolume: number,
): MeshResolutionReport | null {
  const target = MESH_TARGET_ELEMENTS[tier] ?? MESH_TARGET_ELEMENTS.standard;
  const { volume: bboxVol, minDim } = bboxMetrics(bounds);

  if (!(elementCount > 0) || !Number.isFinite(elementCount) || !(minDim > 0)) return null;

  const volume = meshedVolume > 0 && Number.isFinite(meshedVolume) ? meshedVolume : bboxVol;
  if (!(volume > 0) || !Number.isFinite(volume)) return null;

  const characteristicEdge = regularTetEdgeForCount(volume, elementCount);
  const through = characteristicEdge > 0 ? minDim / characteristicEdge : NaN;
  const budgetRatio = elementCount / target;
  const below = Number.isFinite(through) && through < MIN_ELEMENTS_THROUGH_THICKNESS;

  // One warning, ranked: an under-resolved section is a correctness problem and
  // outranks a count shortfall, which is only a budget observation. Overshoot
  // is never warned about — a finer mesh than asked for costs time, not truth.
  let warning: string | null = null;
  if (below) {
    warning =
      `The thinnest section of this part carries about ${through.toFixed(1)} elements ` +
      `(target ${MIN_ELEMENTS_THROUGH_THICKNESS}). Bending stiffness is under-resolved there, ` +
      `which typically reads as a part that is stiffer and stronger than it is. ` +
      `A finer mesh tier is the fix.`;
  } else if (budgetRatio < 0.5) {
    warning =
      `This mesh has ${elementCount.toLocaleString()} elements against a ${target.toLocaleString()} ` +
      `target for the ${tier} tier. The mesher could not honour the requested element size — ` +
      `usually a geometry it had to simplify to mesh at all.`;
  }

  return {
    tier,
    targetElements: target,
    achievedElements: elementCount,
    budgetRatio,
    characteristicEdge,
    elementsThroughThickness: through,
    belowThroughThicknessFloor: below,
    warning,
  };
}
