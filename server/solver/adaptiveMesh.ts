/**
 * adaptiveMesh.ts
 * ---------------
 * Error-driven adaptive mesh refinement: the CORE, binary-independent logic
 * that closes the loop between the Zienkiewicz–Zhu error estimator and the
 * mesher (issue #149).
 *
 * The ZZ estimator (`computeZZErrorEstimate` in stress.ts) produces a
 * per-element error indicator η_e and a `globalRelativeError`. Historically
 * `topErrorElements` was forwarded to the client "for refinement guidance"
 * but nothing consumed it. This module turns that η field into a REGIONAL
 * SIZE FIELD — a per-node target element edge length — that requests smaller
 * elements where η is large and leaves low-error regions coarse. That size
 * field is what drives a targeted TetGen re-mesh (the binary-dependent step
 * lives in tetgen.ts; this file has no dependency on any binary and is fully
 * unit-testable).
 *
 * Sizing law (equidistribution of the predicted error, Zienkiewicz–Zhu 1992):
 *
 *     h_new = h_cur · clamp( (η_target / η_e)^(1/p),  minFactor, maxFactor )
 *
 * where p is the convergence rate of the error in the energy norm (≈ the
 * element polynomial order: 1 for C3D4, 2 for C3D10). An element whose error
 * exceeds the per-element target η_target gets a factor < 1 (refine); an
 * element already below target gets a factor ≥ 1 (leave coarse / mildly
 * coarsen up to maxFactor). Both factors are clamped so a single iteration
 * can neither explode (minFactor floors the shrink) nor coarsen without bound.
 *
 * Guards against runaway refinement:
 *   - per-node minFactor floor (a hard cap on how much smaller one step goes);
 *   - a BOUNDED GRADATION (smoothSizeFieldGradation) so the target size varies
 *     Lipschitz-continuously between refined and unrefined regions instead of
 *     stepping discontinuously at the refinement boundary;
 *   - a global element-count budget (predictRefinedElementCount +
 *     relaxSizeFieldToBudget inflate all targets uniformly when the requested
 *     field would blow the budget);
 *   - singularity exclusion (nodes inside a flagged singular region keep their
 *     current size — you can never resolve a true singularity by refining, so
 *     chasing it is pure waste; issue #147).
 *
 * Loop control (shouldStopRefinement) stops on: target global error reached,
 * iteration cap, element-growth cap, a stalled improvement, or when the size
 * field requests no refinement at all.
 *
 * The budget guard is a PREDICTION, and predictRefinedElementCount is explicitly
 * first-order. The driver must therefore also check the count TetGen actually
 * emitted against the same budget before committing to a solve — see
 * `judgeRemeshAgainstBudget` and the `budget-overshoot` stop reason.
 */

import type { TetMesh } from "./types.js";

// ─── Element characteristic size ────────────────────────────────────────────
/**
 * Characteristic edge length of a tetrahedron from its corner-node volume.
 * For a regular tet, V = h³ / (6√2), so h = (6√2 · V)^(1/3). This gives a
 * scale-consistent "mesh size" per element that the sizing law scales.
 */
export function tetCharacteristicSize(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  dx: number, dy: number, dz: number,
): number {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const e3x = dx - ax, e3y = dy - ay, e3z = dz - az;
  // scalar triple product / 6 = signed volume
  const vol = Math.abs(
    e1x * (e2y * e3z - e2z * e3y) -
    e1y * (e2x * e3z - e2z * e3x) +
    e1z * (e2x * e3y - e2y * e3x),
  ) / 6;
  if (vol <= 0) return 0;
  return Math.cbrt(6 * Math.SQRT2 * vol);
}

/** Per-element corner volume (mm³). Used for element-count prediction. */
export function tetCornerVolume(mesh: TetMesh, e: number): number {
  const npe = mesh.nodesPerElem ?? 4;
  const base = e * npe;
  const n0 = mesh.elements[base]     ?? 0;
  const n1 = mesh.elements[base + 1] ?? 0;
  const n2 = mesh.elements[base + 2] ?? 0;
  const n3 = mesh.elements[base + 3] ?? 0;
  const ax = mesh.nodes[n0 * 3] ?? 0, ay = mesh.nodes[n0 * 3 + 1] ?? 0, az = mesh.nodes[n0 * 3 + 2] ?? 0;
  const bx = mesh.nodes[n1 * 3] ?? 0, by = mesh.nodes[n1 * 3 + 1] ?? 0, bz = mesh.nodes[n1 * 3 + 2] ?? 0;
  const cx = mesh.nodes[n2 * 3] ?? 0, cy = mesh.nodes[n2 * 3 + 1] ?? 0, cz = mesh.nodes[n2 * 3 + 2] ?? 0;
  const dx = mesh.nodes[n3 * 3] ?? 0, dy = mesh.nodes[n3 * 3 + 1] ?? 0, dz = mesh.nodes[n3 * 3 + 2] ?? 0;
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const e3x = dx - ax, e3y = dy - ay, e3z = dz - az;
  return Math.abs(
    e1x * (e2y * e3z - e2z * e3y) -
    e1y * (e2x * e3z - e2z * e3x) +
    e1z * (e2x * e3y - e2y * e3x),
  ) / 6;
}

// ─── Types ──────────────────────────────────────────────────────────────────
export interface SingularityRegion {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Nodes within this radius (mm) of the point are excluded from refinement. */
  readonly radius: number;
}

export interface SizeFieldOptions {
  /**
   * Per-element target error indicator (the equidistribution goal). Elements
   * above it are refined; below it are left coarse. Typically derived from the
   * desired global error and the element count (see targetPerElementError).
   */
  readonly targetError: number;
  /** Error convergence rate ≈ element order p (1 for C3D4, 2 for C3D10). */
  readonly order: number;
  /** Floor on h_new/h_cur — hard cap on one-step refinement (e.g. 0.35). */
  readonly minSizeFactor: number;
  /** Ceiling on h_new/h_cur — cap on one-step coarsening (e.g. 1.0 = never coarsen). */
  readonly maxSizeFactor: number;
  /** Absolute smallest allowed target size (mm), a physical floor. */
  readonly absMinSize?: number;
  /** Absolute largest allowed target size (mm). */
  readonly absMaxSize?: number;
  /** Regions to exclude from refinement (true singularities — issue #147). */
  readonly singularities?: readonly SingularityRegion[];
  /**
   * Per-node exclusion mask (1 = never refine this node), length nodeCount.
   * OR-ed with `singularities`, which it exists alongside rather than replaces:
   * a `SingularityRegion` is a GEOMETRIC ball, right for a detected singular
   * corner whose position is known but whose mesh neighbourhood is not; a mask
   * is a topological set, right for a boundary-condition discontinuity, which
   * is defined by which nodes the BC was applied to and not by any radius.
   *
   * It is also the only shape that stays O(nodeCount). The region test is
   * O(nodeCount × regions), fine for the handful of detected corners but
   * quadratic for a BC interface, which can run to thousands of nodes.
   */
  readonly excludeNodes?: Uint8Array;
}

export interface SizeField {
  /** Per-node target edge length (mm). Length === mesh.nodeCount. */
  readonly targetSize: Float64Array;
  /** Per-node current local edge length (mm), for reference / prediction. */
  readonly currentSize: Float64Array;
  /** Nodes whose target is meaningfully (>1%) smaller than current. */
  readonly refinedNodeCount: number;
  /** Nodes excluded because they sit inside a flagged singular region. */
  readonly excludedNodeCount: number;
  readonly minTargetSize: number;
  readonly maxTargetSize: number;
}

// ─── Node-level error + size aggregation ────────────────────────────────────
/**
 * Per-node characteristic ELEMENT SIZE: the MIN characteristic size over the
 * elements touching each node, so the metric reflects the smallest local
 * element and never coarsens a locally-fine spot.
 *
 * Split out of `aggregateElementFieldsToNodes` so consumers that want a length
 * scale but have no error field can share the definition rather than grow a
 * second one that drifts from it (the singularity detector, issue #263).
 *
 * Midside and untouched nodes are given the mean of the touched ones, so
 * downstream math never sees Infinity.
 */
export function nodeCharacteristicSizes(mesh: TetMesh): Float64Array {
  const npe = mesh.nodesPerElem ?? 4;
  const nodeSize = new Float64Array(mesh.nodeCount).fill(Infinity);
  const touched = new Uint8Array(mesh.nodeCount);

  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    const n0 = mesh.elements[base]     ?? 0;
    const n1 = mesh.elements[base + 1] ?? 0;
    const n2 = mesh.elements[base + 2] ?? 0;
    const n3 = mesh.elements[base + 3] ?? 0;
    const ax = mesh.nodes[n0 * 3] ?? 0, ay = mesh.nodes[n0 * 3 + 1] ?? 0, az = mesh.nodes[n0 * 3 + 2] ?? 0;
    const bx = mesh.nodes[n1 * 3] ?? 0, by = mesh.nodes[n1 * 3 + 1] ?? 0, bz = mesh.nodes[n1 * 3 + 2] ?? 0;
    const cx = mesh.nodes[n2 * 3] ?? 0, cy = mesh.nodes[n2 * 3 + 1] ?? 0, cz = mesh.nodes[n2 * 3 + 2] ?? 0;
    const dx = mesh.nodes[n3 * 3] ?? 0, dy = mesh.nodes[n3 * 3 + 1] ?? 0, dz = mesh.nodes[n3 * 3 + 2] ?? 0;
    const h = tetCharacteristicSize(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
    // Only the four corner nodes carry geometry for a C3D10; midside nodes
    // inherit from their edge, so aggregating corners is sufficient and the
    // per-node metric is interpolated by the mesher anyway.
    for (let k = 0; k < 4; k++) {
      const n = mesh.elements[base + k] ?? 0;
      touched[n] = 1;
      if (h > 0 && h < nodeSize[n]!) nodeSize[n] = h;
    }
  }

  let sizeSum = 0, sizeN = 0;
  for (let n = 0; n < mesh.nodeCount; n++) {
    if (touched[n] && Number.isFinite(nodeSize[n]!)) { sizeSum += nodeSize[n]!; sizeN++; }
  }
  const meanSize = sizeN > 0 ? sizeSum / sizeN : 1;
  for (let n = 0; n < mesh.nodeCount; n++) {
    if (!touched[n] || !Number.isFinite(nodeSize[n]!)) nodeSize[n] = meanSize;
  }
  return nodeSize;
}

/**
 * Aggregate per-element η and characteristic size onto nodes. A node takes the
 * MAX error of its incident elements (conservative: if any touching element is
 * high-error, refine the node) and the MIN characteristic size (see
 * `nodeCharacteristicSizes`, which owns that half).
 */
export function aggregateElementFieldsToNodes(
  mesh: TetMesh,
  errorEstimate: Float32Array | Float64Array,
): { nodeError: Float64Array; nodeSize: Float64Array } {
  const npe = mesh.nodesPerElem ?? 4;
  const nodeError = new Float64Array(mesh.nodeCount);

  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    const err = errorEstimate[e] ?? 0;
    for (let k = 0; k < 4; k++) {
      const n = mesh.elements[base + k] ?? 0;
      if (err > nodeError[n]!) nodeError[n] = err;
    }
  }

  return { nodeError, nodeSize: nodeCharacteristicSizes(mesh) };
}

// ─── Target per-element error from a desired global error ───────────────────
/**
 * Equidistribution target: to reach a global relative error `targetGlobal`
 * spread evenly over N elements, each element should carry
 * η_target = targetGlobal / √N (energy-norm errors add in quadrature). This is
 * the classic ZZ equidistribution goal.
 */
export function targetPerElementError(targetGlobal: number, elementCount: number): number {
  if (elementCount <= 0) return targetGlobal;
  return targetGlobal / Math.sqrt(elementCount);
}

// ─── Build the size field ────────────────────────────────────────────────────
/**
 * Construct the per-node target-size field from the per-element error field.
 * This is the heart of issue #149: high-error elements → smaller target size,
 * low-error elements → unchanged (coarse). Pure and binary-independent.
 */
export function buildSizeField(
  mesh: TetMesh,
  errorEstimate: Float32Array | Float64Array,
  opts: SizeFieldOptions,
): SizeField {
  const { nodeError, nodeSize } = aggregateElementFieldsToNodes(mesh, errorEstimate);
  const p = Math.max(1, opts.order);
  const invP = 1 / p;
  const tiny = 1e-9;
  const targetErr = Math.max(tiny, opts.targetError);

  const targetSize = new Float64Array(mesh.nodeCount);
  let refinedNodeCount = 0;
  let excludedNodeCount = 0;
  let minTargetSize = Infinity;
  let maxTargetSize = 0;

  const sing = opts.singularities ?? [];

  for (let n = 0; n < mesh.nodeCount; n++) {
    const hCur = nodeSize[n]!;
    const eta = nodeError[n]!;

    // Singularity exclusion: never refine toward a flagged singular region.
    let excluded = opts.excludeNodes ? opts.excludeNodes[n] === 1 : false;
    if (!excluded && sing.length > 0) {
      const nx = mesh.nodes[n * 3] ?? 0, ny = mesh.nodes[n * 3 + 1] ?? 0, nz = mesh.nodes[n * 3 + 2] ?? 0;
      for (const s of sing) {
        const dx = nx - s.x, dy = ny - s.y, dz = nz - s.z;
        if (dx * dx + dy * dy + dz * dz <= s.radius * s.radius) { excluded = true; break; }
      }
    }

    let factor: number;
    if (excluded) {
      factor = 1; // keep current size
      excludedNodeCount++;
    } else {
      // Equidistribution sizing law.
      factor = Math.pow(targetErr / Math.max(tiny, eta), invP);
      if (factor < opts.minSizeFactor) factor = opts.minSizeFactor;
      if (factor > opts.maxSizeFactor) factor = opts.maxSizeFactor;
    }

    let ts = hCur * factor;
    if (opts.absMinSize !== undefined && ts < opts.absMinSize) ts = opts.absMinSize;
    if (opts.absMaxSize !== undefined && ts > opts.absMaxSize) ts = opts.absMaxSize;

    targetSize[n] = ts;
    if (!excluded && ts < hCur * 0.99) refinedNodeCount++;
    if (ts < minTargetSize) minTargetSize = ts;
    if (ts > maxTargetSize) maxTargetSize = ts;
  }

  if (!Number.isFinite(minTargetSize)) minTargetSize = 0;

  return {
    targetSize,
    currentSize: nodeSize,
    refinedNodeCount,
    excludedNodeCount,
    minTargetSize,
    maxTargetSize,
  };
}

// ─── Size-field gradation (Lipschitz smoothing) ──────────────────────────────
/**
 * Unique corner-to-corner edges of the tet mesh, with their lengths. Only the
 * four CORNER nodes carry geometry (a C3D10's midside nodes sit on these very
 * edges), which matches every other consumer in this file — aggregation,
 * prediction, and the background `.ele` file TetGen interpolates the metric
 * over are all corner-only.
 */
export interface TetEdgeList {
  readonly a: Int32Array;
  readonly b: Int32Array;
  /** Euclidean length of edge k, in mm. */
  readonly len: Float64Array;
}

export function buildTetEdgeList(mesh: TetMesh): TetEdgeList {
  const npe = mesh.nodesPerElem ?? 4;
  const seen = new Set<number>();
  const ea: number[] = [], eb: number[] = [], el: number[] = [];
  const n = mesh.nodeCount;
  // The 6 corner-pairs of a tet.
  const PAIRS: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3],
  ];
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    for (const [p, q] of PAIRS) {
      const i0 = mesh.elements[base + p] ?? 0;
      const i1 = mesh.elements[base + q] ?? 0;
      if (i0 === i1) continue;
      const lo = i0 < i1 ? i0 : i1;
      const hi = i0 < i1 ? i1 : i0;
      const key = lo * n + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      const dx = (mesh.nodes[hi * 3] ?? 0) - (mesh.nodes[lo * 3] ?? 0);
      const dy = (mesh.nodes[hi * 3 + 1] ?? 0) - (mesh.nodes[lo * 3 + 1] ?? 0);
      const dz = (mesh.nodes[hi * 3 + 2] ?? 0) - (mesh.nodes[lo * 3 + 2] ?? 0);
      ea.push(lo); eb.push(hi); el.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
  }
  return { a: Int32Array.from(ea), b: Int32Array.from(eb), len: Float64Array.from(el) };
}

/** Max relaxation sweeps for the gradation solve; convergence is monotone. */
const GRADATION_MAX_SWEEPS = 200;

/**
 * Bound the GRADATION of a size field — the third defect behind the sliver
 * failure. `buildSizeField` can drop the target size by minSizeFactor at one
 * node while its immediate neighbour keeps the current (coarse) size, so the
 * mesher is asked to absorb the whole transition across a single edge. Mesh
 * generators want a bounded size-transition ratio; nothing previously imposed
 * one, and TetGen resolved the discontinuity with slivers at the refinement
 * boundary (13 of them, normalized Jacobian down to 0.0037, on the Ø5-bore tube).
 *
 * The classic remedy (Borouchaki, Hecht & Frey 1998) is to make the size field
 * Lipschitz-continuous: for every mesh edge (i,j) of length d,
 *
 *     h_i <= h_j + (gradation - 1) · d
 *
 * so the target size can grow by at most a factor ≈ `gradation` per element
 * step away from a refined region. Enforced by repeated relaxation sweeps
 * (forward + backward for faster propagation) until no value changes.
 *
 * Only nodes that are actually BEING REFINED (target below their own current
 * size) act as constraint sources. This is what keeps the operator a no-op on a
 * field that requests no refinement: an already-adaptively-refined mesh has a
 * genuine size gradient of its own, and re-imposing a Lipschitz bound on those
 * CURRENT sizes would demand refinement that has nothing to do with the error
 * estimate — enough of it, measured, to consume the whole remaining element
 * budget and stall the loop a step early. A node lowered by the constraint
 * becomes a source itself, so the graded band still propagates outward from the
 * refined region with the right decay.
 *
 * The operator only ever LOWERS targets — it spreads refinement outward into
 * the transition band rather than pulling any region coarser — and never below
 * `field.minTargetSize`, the smallest size the input field already requested.
 * Those bounds are what keep it composable with the budget guard: smoothing
 * costs elements, so `relaxSizeFieldToBudget` evaluates its budget prediction on
 * the SMOOTHED field, never on the raw one.
 *
 * `gradation <= 1` is degenerate (it would force a globally uniform field) and
 * is treated as "no gradation limit", returning the field untouched.
 */
export function smoothSizeFieldGradation(
  mesh: TetMesh,
  field: SizeField,
  gradation: number,
): SizeField {
  return smoothWithEdges(field, buildTetEdgeList(mesh), gradation);
}

function smoothWithEdges(field: SizeField, edges: TetEdgeList, gradation: number): SizeField {
  if (!Number.isFinite(gradation) || gradation <= 1) return field;
  const beta = gradation - 1;
  const m = edges.a.length;
  const h = Float64Array.from(field.targetSize);
  // Never smooth below the finest size the input field already asked for: the
  // gradation limit must not defeat absMinSize or the minSizeFactor floor.
  const floor = field.minTargetSize > 0 ? field.minTargetSize : 0;

  // A node is a constraint SOURCE only while it is itself being refined.
  const refining = (n: number): boolean => h[n]! < field.currentSize[n]! * (1 - 1e-12);

  for (let sweep = 0; sweep < GRADATION_MAX_SWEEPS; sweep++) {
    let changed = false;
    // Forward then backward: a one-directional sweep propagates a constraint
    // only along increasing edge index, so alternating halves the sweep count.
    for (let pass = 0; pass < 2; pass++) {
      for (let k = 0; k < m; k++) {
        const e = pass === 0 ? k : m - 1 - k;
        const i = edges.a[e]!, j = edges.b[e]!, d = edges.len[e]!;
        const hi = h[i]!, hj = h[j]!;
        if (hi > hj + beta * d && refining(j)) {
          const nv = Math.max(hj + beta * d, floor);
          if (nv < hi - 1e-12) { h[i] = nv; changed = true; }
        } else if (hj > hi + beta * d && refining(i)) {
          const nv = Math.max(hi + beta * d, floor);
          if (nv < hj - 1e-12) { h[j] = nv; changed = true; }
        }
      }
    }
    if (!changed) break;
  }

  return withTargets(field, h);
}

/** Rebuild a SizeField around a new target array, recomputing its statistics. */
function withTargets(field: SizeField, targetSize: Float64Array): SizeField {
  let refinedNodeCount = 0;
  let minTargetSize = Infinity, maxTargetSize = 0;
  for (let i = 0; i < targetSize.length; i++) {
    const ts = targetSize[i]!;
    if (ts < field.currentSize[i]! * 0.99) refinedNodeCount++;
    if (ts < minTargetSize) minTargetSize = ts;
    if (ts > maxTargetSize) maxTargetSize = ts;
  }
  if (!Number.isFinite(minTargetSize)) minTargetSize = 0;
  return {
    targetSize,
    currentSize: field.currentSize,
    refinedNodeCount,
    excludedNodeCount: field.excludedNodeCount,
    minTargetSize,
    maxTargetSize,
  };
}

// ─── Boundary-condition discontinuity exclusion ──────────────────────────────
/**
 * Mark the nodes sitting on a BOUNDARY-CONDITION discontinuity, so the adaptive
 * loop does not refine toward them.
 *
 * WHY. Refining a singularity never converges, and a rigid displacement
 * constraint applied over part of a surface creates one exactly where it stops:
 * the solution has a genuine stress singularity along the edge of the
 * constrained patch, and the same is true at the rim of a loaded patch, where
 * traction jumps to zero. The elements there report large error at every
 * density, so an equidistribution loop keeps pouring elements into a region
 * that cannot improve, and stalls before reaching its target.
 *
 * This was measured on the Ø5-bore tube (see docs/spr-gauss-point-handoff.md).
 * Under UNIFORM refinement from 6 763 to 19 308 elements the clamped bore and
 * its rim grew from 52% to 75% of the total error energy while the smooth
 * interior collapsed from 38% to 16%; the global convergence rate was 0.61
 * against the smooth-C3D10 expectation of 2.0, and 1.56 when the clamped
 * boundary was excluded from the norm.
 *
 * NOT geometry. It is worth being precise, because the obvious guess is wrong:
 * the tube's sharp outer rim carried 0.2–0.4% of the error energy and did not
 * grow. A sharp edge is only singular when the material wedge is RE-ENTRANT
 * (> 180°); a convex 90° edge between two traction-free faces is bounded. What
 * is singular here is the BC idealization, not the part.
 *
 * WHAT IS MARKED — and the trap. The patch EDGE only: the curve where the
 * constrained (or loaded) patch stops. Interior nodes of the patch are NOT
 * marked; they are a stress concentration, which is real, resolvable and
 * exactly what this tool exists to resolve.
 *
 * Finding that edge needs `surfaceNodes`, and omitting it does not degrade the
 * answer, it inverts it. A BC set is a 2-D patch embedded in a 3-D mesh, so in
 * the VOLUME graph almost every node of the patch has a neighbour just beneath
 * it that is not in the set — making "has a neighbour outside the set" true for
 * the whole patch rather than its rim. Measured on the Ø5-bore tube, that
 * mistake masked the entire bore wall, suppressed refinement so completely that
 * the loop stalled after one step at 18.7% (against 11.1% with no exclusion at
 * all). Restricting the test to edges whose BOTH endpoints lie on the surface
 * confines it to the rim, which is what is actually singular.
 *
 * `dilateHops` then grows the band through mesh adjacency rather than by an
 * absolute radius, so it scales with the local element size automatically and
 * stays proportionate on a 5 mm part and a 500 mm one.
 *
 * A set covering the whole surface, or none of it, produces no rim and marks
 * nothing — a uniformly constrained or unconstrained body has no discontinuity.
 */
export function bcDiscontinuityMask(
  mesh:         TetMesh,
  nodeSets:     readonly (readonly number[] | Int32Array)[],
  dilateHops:   number,
  surfaceNodes?: Uint8Array | null,
): Uint8Array {
  const NC = mesh.nodeCount;
  const mask = new Uint8Array(NC);
  const usable = nodeSets.filter(s => s.length > 0);
  if (usable.length === 0) return mask;

  const edges = buildTetEdgeList(mesh);
  const member = new Uint8Array(NC);
  // Without a surface mask the patch-edge test is not merely approximate, it is
  // wrong (see above), so refuse to guess: mark nothing rather than mask a whole
  // constrained face and starve the refinement the caller asked for.
  if (!surfaceNodes) return mask;

  for (const set of usable) {
    member.fill(0);
    for (const n of set) if (n >= 0 && n < NC) member[n] = 1;
    for (let k = 0; k < edges.a.length; k++) {
      const a = edges.a[k]!, b = edges.b[k]!;
      // Only edges lying IN the surface can straddle the patch rim.
      if (surfaceNodes[a] !== 1 || surfaceNodes[b] !== 1) continue;
      // The discontinuity lies ON this edge, so both endpoints carry it.
      if (member[a] !== member[b]) { mask[a] = 1; mask[b] = 1; }
    }
  }

  // Dilate through the mesh graph. Each pass is one ring of neighbours; the
  // frontier is snapshotted so a pass cannot cascade through itself.
  for (let hop = 0; hop < dilateHops; hop++) {
    const frontier = mask.slice();
    for (let k = 0; k < edges.a.length; k++) {
      const a = edges.a[k]!, b = edges.b[k]!;
      if (frontier[a] === 1) mask[b] = 1;
      if (frontier[b] === 1) mask[a] = 1;
    }
  }

  return mask;
}

/**
 * How many rings of mesh neighbours beyond the BC interface stay unrefined.
 *
 * 1 is deliberate and conservative. The singular field decays quickly, and
 * every node excluded here is a node the loop will not refine — near a BOLT
 * HOLE, which is the region this tool exists to get right. A wide band would
 * trade a converging global error for a worse bearing-stress resolution, which
 * is the wrong trade for the product. Widen only against a measurement showing
 * the loop still stalls on the excluded band.
 */
export const BC_SINGULARITY_DILATE_HOPS = 1;

/**
 * Fraction of the total estimated error ENERGY carried by elements touching a
 * masked (BC-singularity) node. In [0, 1]; 0 when nothing is masked.
 *
 * This is the diagnosis the adaptive loop reports, and it is why the loop can
 * stop well short of `targetGlobalError` without anything being wrong with the
 * mesh. The masked band converges at a measured rate of ~0.15 against the
 * smooth-C3D10 expectation of 2.0 — halving that component would take on the
 * order of 10⁶× the elements — so once it dominates, refinement has nothing
 * left to buy. A user reading a stalled 10% needs to know whether to reach for
 * a finer mesh or for a better bolt idealization, and this number is the
 * difference between those two answers.
 *
 * Energies add in quadrature, so this sums η_e², NOT η_e. An element counts as
 * masked if ANY of its corner nodes is: the error is a per-element quantity and
 * the mask is per-node, so touching the band at all is what matters.
 *
 * Deliberately a REPORTED number and not a TARGET. Letting the loop chase the
 * unmasked remainder would let it announce `target-error-reached` at 3% while
 * the honest total was 10% — a worse claim than the single number it replaced.
 */
export function maskedErrorFraction(
  mesh:          TetMesh,
  errorEstimate: Float32Array | Float64Array,
  mask:          Uint8Array | null | undefined,
): number {
  if (!mask) return 0;
  const npe = mesh.nodesPerElem ?? 4;
  let masked = 0, total = 0;
  for (let e = 0; e < mesh.elementCount; e++) {
    const eta = errorEstimate[e] ?? 0;
    const e2 = eta * eta;
    total += e2;
    const base = e * npe;
    for (let k = 0; k < 4; k++) {
      if (mask[mesh.elements[base + k] ?? 0] === 1) { masked += e2; break; }
    }
  }
  return total > 0 ? masked / total : 0;
}

// ─── Element-count prediction & budget guard ─────────────────────────────────
/**
 * Estimate the element count a size field would produce. Refining a region
 * from local size h_cur to h_tgt multiplies its element density by
 * (h_cur / h_tgt)³ in 3D. Summing the per-element density factor (using the
 * finest target among the element's corner nodes) gives a first-order estimate
 * of the resulting element count — enough to enforce a growth budget BEFORE
 * spending a re-mesh.
 *
 * FIRST-ORDER, and knowingly so: it takes the AVERAGE current size over an
 * element's four corners but the FINEST target among them, ignores what the
 * mesher does to satisfy the transition between the two, and assumes perfect
 * (h_cur/h_tgt)³ density scaling. It under-predicted by ~8% on the Ø5-bore tube.
 * Callers must therefore treat it as an estimate and check the count TetGen
 * actually emitted (`budgetOvershootFactor`) rather than trusting this number.
 */
export function predictRefinedElementCount(mesh: TetMesh, field: SizeField): number {
  const npe = mesh.nodesPerElem ?? 4;
  let predicted = 0;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    let hCur = Infinity, hTgt = Infinity;
    for (let k = 0; k < 4; k++) {
      const n = mesh.elements[base + k] ?? 0;
      // MIN on both sides, not mean-current vs min-target. Mixing the two makes
      // the ratio exceed 1 even for a field that requests NO refinement, so the
      // prediction had a floor above the current element count — which in turn
      // let the budget bisection bottom out over budget and spin the driver's
      // re-mesh retries on an identical field. Taking the same statistic on both
      // sides makes an unrefined field predict exactly mesh.elementCount, which
      // is the calibration the whole guard rests on.
      if (field.currentSize[n]! < hCur) hCur = field.currentSize[n]!;
      if (field.targetSize[n]!  < hTgt) hTgt = field.targetSize[n]!;
    }
    if (!Number.isFinite(hCur) || hCur <= 0) { predicted += 1; continue; }
    if (hTgt <= 0 || !Number.isFinite(hTgt)) hTgt = hCur;
    const ratio = hCur / hTgt;
    predicted += ratio > 1 ? ratio * ratio * ratio : 1;
  }
  return predicted;
}

/**
 * If a size field would exceed the element budget, inflate every refinement
 * uniformly (raise the shrink factor toward 1 with a common exponent) until the
 * prediction fits. Returns a NEW size field; leaves already-in-budget fields
 * unchanged. This is the runaway-refinement guard: we still refine the highest-
 * error regions, just less aggressively, rather than blowing up the DOF count.
 *
 * `gradation`, when given (> 1), makes every trial field Lipschitz-smoothed
 * before its count is predicted, so the budget accounts for the elements the
 * transition band costs. Smoothing is monotone in β — a smaller β means larger
 * targets means a smaller smoothed field means fewer predicted elements — so
 * the bisection stays valid. Omitting it reproduces the un-graded behaviour
 * exactly.
 */
export function relaxSizeFieldToBudget(
  mesh: TetMesh,
  field: SizeField,
  elementBudget: number,
  gradation?: number,
): SizeField {
  const graded = gradation !== undefined && gradation > 1
    ? { edges: buildTetEdgeList(mesh), gradation }
    : null;
  const shape = (beta: number): SizeField => {
    const scaled = applyShrinkExponent(field, beta);
    return graded ? smoothWithEdges(scaled, graded.edges, graded.gradation) : scaled;
  };

  const predicted = predictRefinedElementCount(mesh, field);
  if (predicted <= elementBudget || elementBudget <= 0) return field;

  // β=0 is the no-refinement field. If even that cannot fit, the budget is
  // already spent and there is nothing honest to hand the mesher — return the
  // unrefined field (never the smoothed one, which would still request work) so
  // the caller sees refinedNodeCount === 0 and stops, instead of re-meshing to
  // no purpose.
  const unrefined = applyShrinkExponent(field, 0);
  if (predictRefinedElementCount(mesh, shape(0)) > elementBudget) return unrefined;

  // Binary-search an exponent β in (0,1] applied to each shrink ratio:
  //   h_new' = h_cur · (h_tgt / h_cur)^β
  // β=1 reproduces the field; β→0 removes all refinement. Find the largest β
  // whose prediction fits the budget (keep as much refinement as allowed).
  let lo = 0, hi = 1, best = 0;
  for (let iter = 0; iter < 40; iter++) {
    const beta = (lo + hi) / 2;
    const pred = predictRefinedElementCount(mesh, shape(beta));
    if (pred <= elementBudget) { best = beta; lo = beta; } else { hi = beta; }
  }
  return best > 0 ? shape(best) : unrefined;
}

export interface RemeshBudgetVerdict {
  /** True if the emitted mesh fits the budget and may be solved. */
  readonly accepted: boolean;
  /**
   * Predictor calibration to carry into the next attempt: 1 = trust
   * `predictRefinedElementCount`, >1 = it under-predicts the GROWTH by that
   * factor. Feed it to `effectiveElementBudget`. Never below 1 — the guard
   * corrects for under-prediction, and treating an over-prediction as licence
   * to refine harder would defeat the cap it exists to enforce.
   */
  readonly sizingBias: number;
}

/**
 * The reality check the budget guard lacked. `relaxSizeFieldToBudget` only ever
 * compared a PREDICTION to the budget, and `predictRefinedElementCount` is
 * first-order, so when it under-predicted the budget was silently exceeded —
 * and because `shouldStopRefinement` sees only the iteration just COMPLETED,
 * the over-budget mesh had already cost a full solve by the time anything
 * noticed. On the Ø5-bore tube that was 115,544 elements against a 106,720
 * budget (8.7× the 13,340-element base, versus the documented 8× cap), 13
 * slivers, and a rejected solve.
 *
 * Given what TetGen ACTUALLY emitted, decide whether to admit the mesh and how
 * much to distrust the predictor next time.
 *
 * The bias is measured on the GROWTH above the current mesh, not on the totals:
 * `(actual − current) / (predicted − current)`. A field requesting no refinement
 * reproduces the current mesh exactly no matter how wrong the predictor is, so
 * the error lives entirely in the increment. Calibrating on totals instead makes
 * the correction blow up as the mesh grows — measured on the tube, a totals bias
 * of 1.75 after the first refinement drove the next iteration's effective budget
 * BELOW the current element count, which reads as "no refinement is possible"
 * and stalled the loop a full step early.
 */
export function judgeRemeshAgainstBudget(
  actualElementCount: number,
  predictedElementCount: number,
  elementBudget: number,
  currentElementCount: number,
): RemeshBudgetVerdict {
  const predictedGrowth = predictedElementCount - currentElementCount;
  const actualGrowth    = actualElementCount - currentElementCount;
  const ratio = predictedGrowth > 0 && Number.isFinite(actualGrowth)
    ? actualGrowth / predictedGrowth
    : 1;
  return {
    accepted: elementBudget <= 0 || actualElementCount <= elementBudget,
    sizingBias: Math.max(ratio, 1),
  };
}

/**
 * The budget to hand `relaxSizeFieldToBudget` so that the mesh TetGen actually
 * emits lands under `elementBudget`, given a measured `sizingBias`.
 *
 * Inverse of the growth model in `judgeRemeshAgainstBudget`: if the mesher
 * delivers `bias ×` the predicted growth, then to end up with at most
 * `elementBudget` elements we may only PREDICT a growth of
 * `(elementBudget − current) / bias`. Never returns less than the current count
 * — an effective budget below it would ask for negative refinement.
 */
export function effectiveElementBudget(
  elementBudget: number,
  currentElementCount: number,
  sizingBias: number,
): number {
  if (elementBudget <= 0) return elementBudget;
  const bias = Number.isFinite(sizingBias) && sizingBias > 1 ? sizingBias : 1;
  const room = Math.max(0, elementBudget - currentElementCount);
  return Math.floor(currentElementCount + room / bias);
}

function applyShrinkExponent(field: SizeField, beta: number): SizeField {
  const n = field.targetSize.length;
  const targetSize = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const hCur = field.currentSize[i]!;
    const ratio = hCur > 0 ? field.targetSize[i]! / hCur : 1;
    targetSize[i] = ratio < 1 ? hCur * Math.pow(ratio, beta) : field.targetSize[i]!;
  }
  return withTargets(field, targetSize);
}

// ─── Loop control ────────────────────────────────────────────────────────────
export interface LoopControlOptions {
  /** Stop once the global relative error drops to/below this (e.g. 0.03). */
  readonly targetGlobalError: number;
  /** Hard cap on refinement iterations (e.g. 4). */
  readonly maxIterations: number;
  /** Never let the element count exceed this multiple of the initial mesh. */
  readonly maxElementGrowth: number;
  /**
   * Stop if a refinement step improves the global error by less than this
   * RELATIVE fraction (e.g. 0.05 = <5% improvement ⇒ diminishing returns).
   */
  readonly minRelativeImprovement: number;
}

export interface LoopState {
  /** 0-based index of the iteration just COMPLETED. */
  readonly iteration: number;
  readonly globalRelativeError: number;
  readonly elementCount: number;
  readonly baseElementCount: number;
  /** Global error of the previous iteration (null for the first). */
  readonly previousGlobalRelativeError: number | null;
  /** Nodes the just-built size field requested to refine (null if none built). */
  readonly refinedNodeCount: number | null;
}

/**
 * Why the adaptive loop stopped.
 *
 * The first group is decided by `shouldStopRefinement` from the loop state. The
 * second group can only be produced by the DRIVER (`runAdaptiveAnalysis`), which
 * owns the binary-dependent and failure paths the pure stop-criterion function
 * cannot see. Both groups are part of the response contract (`docs/API.md`), so
 * they live in one union — a driver reason that is not listed here is a bug in
 * the contract, not a free-form string.
 */
export type StopReason =
  // Decided by shouldStopRefinement:
  | "continue"
  | "target-error-reached"
  | "max-iterations"
  | "element-growth-cap"
  | "stalled"
  | "no-refinement-requested"
  // Produced by the driver (runAdaptiveAnalysis):
  | "budget-overshoot"
  | "remesh-failed"
  | "resolve-failed"
  | "no-error-field"
  | "degraded-to-tier";

/**
 * Decide whether the adaptive loop should stop AFTER completing `state`. Order
 * of checks matters: success (target reached) first, then the hard guards
 * (iteration + growth caps), then the soft guards (stall, nothing to refine).
 *
 * NOTE the element-growth check here is a BACKSTOP, not the primary enforcement
 * of the cap. It reads the state of the iteration just completed, so on its own
 * it can only notice an over-budget mesh after that mesh has already cost a full
 * solve. The driver enforces the cap against the mesh TetGen actually emitted,
 * BEFORE solving it (`budgetOvershootFactor` → `budget-overshoot`); by the time
 * a state reaches this function the count has already been admitted.
 */
export function shouldStopRefinement(
  state: LoopState,
  opts: LoopControlOptions,
): { stop: boolean; reason: StopReason } {
  if (state.globalRelativeError <= opts.targetGlobalError) {
    return { stop: true, reason: "target-error-reached" };
  }
  if (state.iteration + 1 >= opts.maxIterations) {
    return { stop: true, reason: "max-iterations" };
  }
  if (state.elementCount >= state.baseElementCount * opts.maxElementGrowth) {
    return { stop: true, reason: "element-growth-cap" };
  }
  if (state.refinedNodeCount !== null && state.refinedNodeCount === 0) {
    return { stop: true, reason: "no-refinement-requested" };
  }
  if (state.previousGlobalRelativeError !== null && state.previousGlobalRelativeError > 0) {
    const improvement =
      (state.previousGlobalRelativeError - state.globalRelativeError) /
      state.previousGlobalRelativeError;
    // Negative improvement (error grew) or below the threshold ⇒ stop.
    if (improvement < opts.minRelativeImprovement) {
      return { stop: true, reason: "stalled" };
    }
  }
  return { stop: false, reason: "continue" };
}

// ─── Default options ──────────────────────────────────────────────────────────
export const DEFAULT_LOOP_OPTIONS: LoopControlOptions = {
  targetGlobalError: 0.03,       // 3% global relative error target
  // Cap total solves at 1 base + up to 4 refines. One more than the original 4
  // because minSizeFactor was softened from 0.35 to 0.55 below: the same total
  // refinement now needs roughly one extra step to reach. The 8× element budget,
  // not this cap, is what bounds the worst-case cost of a run.
  maxIterations: 5,
  maxElementGrowth: 8,           // never exceed 8× the base element count
  minRelativeImprovement: 0.05,  // stop when a step improves error <5%
};

export const DEFAULT_SIZE_FIELD_FACTORS = {
  /**
   * Floor on h_new/h_cur in ONE step. Was 0.35, which is a ~23× jump in local
   * element DENSITY ((1/0.35)³) that the mesher has to absorb across the
   * refinement boundary in a single re-mesh — the prime suspect for the slivers
   * on the Ø5-bore tube. 0.55 is a ~6× density step instead, reached over more
   * iterations (maxIterations went 4 → 5) rather than one violent one.
   */
  minSizeFactor: 0.55,
  maxSizeFactor: 1.0,   // never coarsen (refinement-only), keeps low-error coarse
  /**
   * Maximum size-transition ratio per element step (the Lipschitz slope is
   * gradation − 1). 1.5 is the usual mesh-generation default: the target size
   * may grow by at most ~50% per element away from a refined region, so the
   * refined and unrefined regions are joined by a graded band instead of a
   * step. See smoothSizeFieldGradation.
   */
  gradation: 1.5,
} as const;

// ─── TetGen refinement-input file serialization ──────────────────────────────
/**
 * Reduce a mesh + size field to the CORNER-ONLY linear mesh TetGen's refinement
 * pass is handed. Returns a compacted mesh (nodesPerElem 4) plus the size field
 * restricted to those nodes.
 *
 * Two properties this must have, both relied on by `meshWithTetGenSizing`:
 *
 *  1. CORNER-ONLY. `aggregateElementFieldsToNodes` only visits an element's four
 *     corner nodes (midside nodes carry no independent geometry or error), so a
 *     C3D10 mesh's midside nodes never receive a real target size —
 *     `buildSizeField` falls through to the mean-size placeholder for them. On
 *     the Ø5-bore tube that was 18,664 of 21,885 nodes, i.e. 85% of the field
 *     was one constant (0.4375 mm) against a real field spanning 0.149–0.447 mm.
 *     Feeding those placeholder values to the mesher describes a sizing function
 *     nobody asked for.
 *
 *  2. ORDER-PRESERVING. Corner nodes keep their relative order from the input
 *     mesh, so the welded STL surface vertices — always tet corners, and always
 *     the first N nodes of a mesh this module is given — stay the first N nodes
 *     of the compacted mesh. TetGen's `-r` emits its input vertices first and in
 *     order, so that is what keeps `surfaceToNode` an identity map through a
 *     re-mesh. Renumbering in first-seen-in-elements order would silently break
 *     it.
 *
 * On a linear (nodesPerElem 4) mesh every node is a corner, so this is an
 * identity apart from discarding unreferenced nodes.
 */
export function extractCornerBackground(
  mesh: TetMesh,
  field: SizeField,
): { mesh: TetMesh; field: SizeField } {
  const npe = mesh.nodesPerElem ?? 4;
  const isCorner = new Uint8Array(mesh.nodeCount);
  for (let e = 0; e < mesh.elementCount; e++) {
    for (let k = 0; k < 4; k++) isCorner[mesh.elements[e * npe + k] ?? 0] = 1;
  }
  // Ascending original index — see property 2 above.
  const remap = new Int32Array(mesh.nodeCount).fill(-1);
  let cornerCount = 0;
  for (let n = 0; n < mesh.nodeCount; n++) if (isCorner[n]) remap[n] = cornerCount++;

  const elements = new Int32Array(mesh.elementCount * 4);
  for (let e = 0; e < mesh.elementCount; e++) {
    for (let k = 0; k < 4; k++) {
      elements[e * 4 + k] = remap[mesh.elements[e * npe + k] ?? 0]!;
    }
  }

  const nodes = new Float64Array(cornerCount * 3);
  const targetSize = new Float64Array(cornerCount);
  const currentSize = new Float64Array(cornerCount);
  let refinedNodeCount = 0;
  let minTargetSize = Infinity, maxTargetSize = 0;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const c = remap[n]!;
    if (c < 0) continue;
    nodes[c * 3]     = mesh.nodes[n * 3]     ?? 0;
    nodes[c * 3 + 1] = mesh.nodes[n * 3 + 1] ?? 0;
    nodes[c * 3 + 2] = mesh.nodes[n * 3 + 2] ?? 0;
    const ts = field.targetSize[n] ?? 0;
    const cs = field.currentSize[n] ?? 0;
    targetSize[c] = ts;
    currentSize[c] = cs;
    if (ts < cs * 0.99) refinedNodeCount++;
    if (ts < minTargetSize) minTargetSize = ts;
    if (ts > maxTargetSize) maxTargetSize = ts;
  }
  if (!Number.isFinite(minTargetSize)) minTargetSize = 0;

  return {
    mesh: { nodes, elements, nodeCount: cornerCount, elementCount: mesh.elementCount, nodesPerElem: 4 },
    field: {
      targetSize,
      currentSize,
      refinedNodeCount,
      excludedNodeCount: field.excludedNodeCount,
      minTargetSize,
      maxTargetSize,
    },
  };
}

/**
 * Empirical scale from "target edge length" to the TetGen `-a` volume CAP that
 * actually yields elements of that size.
 *
 * A volume cap is an upper bound, not a target: TetGen's refinement keeps
 * splitting until every tet is under the cap, so the sizes it settles on are
 * well below it. Feeding the exact regular-tet volume h³/(6√2) therefore
 * over-refines badly — on the Ø5-bore tube it delivered 2.1× the predicted
 * element GROWTH, turning one step into 5.7× of an 8× budget. Scaling the cap
 * makes it mean "elements of about this size" rather than "elements at most this
 * size", which is what the size field asks for and what
 * predictRefinedElementCount assumes.
 *
 * 13 is where prediction met reality on that part: predicted 43,829 elements
 * against 40,534 emitted (growth ratio 0.89, versus 2.08 at the unscaled value).
 * Calibrating the predictor is the point — the budget guard, the relaxation
 * bisection and the retry correction all reason in predicted counts, so a
 * predictor that is right to ~10% is worth more here than one that is
 * conservative.
 *
 * Confidence LOW and geometry-dependent (the equivalent measurement over the
 * tier path's uniform caps drifts between ~2.5 and ~5.5 as the cap tightens), so
 * it is only a SEED: the driver measures the residual against what TetGen
 * actually emits and corrects per-run (`judgeRemeshAgainstBudget` →
 * `effectiveElementBudget`). Nothing downstream trusts this number — the budget
 * is enforced on the real count, never on this.
 */
export const VOLUME_CAP_SCALE = 13;

/**
 * Serialize a size field to TetGen's `.vol` format: a per-element maximum
 * volume constraint, read under `-r -a`. Header "<elementCount>", then one
 * "<1-based index> <max volume>" line per element.
 *
 * This is the sizing mechanism the adaptive re-mesh uses, in place of the `-m`
 * background metric — see the meshWithTetGenSizing header for the measurements
 * behind that choice. Each element's cap comes from the FINEST target among its
 * four corner
 * nodes, matching predictRefinedElementCount's convention exactly so the budget
 * prediction and the constraint describe the same mesh.
 *
 * `mesh` must be the corner-only mesh from extractCornerBackground (indices are
 * read as 4-per-element).
 */
export function sizeFieldToVolFile(
  mesh: TetMesh,
  field: SizeField,
  volumeCapScale: number = VOLUME_CAP_SCALE,
): string {
  const lines: string[] = [`${mesh.elementCount}`];
  const scale = volumeCapScale / (6 * Math.SQRT2);
  for (let e = 0; e < mesh.elementCount; e++) {
    let h = Infinity;
    for (let k = 0; k < 4; k++) {
      const t = field.targetSize[mesh.elements[e * 4 + k] ?? 0] ?? 0;
      if (t > 0 && t < h) h = t;
    }
    // A non-positive or unreachable target means "no constraint here"; -1 is
    // TetGen's own encoding for an unconstrained element.
    const vol = Number.isFinite(h) && h > 0 ? h * h * h * scale : -1;
    lines.push(`${e + 1} ${vol > 0 ? vol.toPrecision(8) : "-1"}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Serialize a mesh to TetGen's `.node` format (used to write the background
 * mesh the metric attaches to). 1-based indices, "<count> 3 0 0" header.
 */
export function meshToNodeFile(mesh: TetMesh): string {
  const lines: string[] = [`${mesh.nodeCount} 3 0 0`];
  for (let n = 0; n < mesh.nodeCount; n++) {
    lines.push(`${n + 1} ${mesh.nodes[n * 3] ?? 0} ${mesh.nodes[n * 3 + 1] ?? 0} ${mesh.nodes[n * 3 + 2] ?? 0}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Serialize a mesh's tetrahedra to TetGen's `.ele` format (corner nodes only —
 * the background mesh only needs the linear tets to interpolate the metric).
 * 1-based indices, "<count> 4 0" header.
 */
export function meshToEleFile(mesh: TetMesh): string {
  const npe = mesh.nodesPerElem ?? 4;
  const lines: string[] = [`${mesh.elementCount} 4 0`];
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    const a = (mesh.elements[base]     ?? 0) + 1;
    const b = (mesh.elements[base + 1] ?? 0) + 1;
    const c = (mesh.elements[base + 2] ?? 0) + 1;
    const d = (mesh.elements[base + 3] ?? 0) + 1;
    lines.push(`${e + 1} ${a} ${b} ${c} ${d}`);
  }
  return lines.join("\n") + "\n";
}
