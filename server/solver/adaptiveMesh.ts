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
 * Aggregate per-element η and characteristic size onto nodes. A node takes the
 * MAX error of its incident elements (conservative: if any touching element is
 * high-error, refine the node) and the MIN characteristic size (so the target
 * scales off the smallest local element, never coarsening a locally-fine spot).
 */
export function aggregateElementFieldsToNodes(
  mesh: TetMesh,
  errorEstimate: Float32Array | Float64Array,
): { nodeError: Float64Array; nodeSize: Float64Array } {
  const npe = mesh.nodesPerElem ?? 4;
  const nodeError = new Float64Array(mesh.nodeCount);
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
    const err = errorEstimate[e] ?? 0;
    // Only the four corner nodes carry geometry for a C3D10; midside nodes
    // inherit from their edge, so aggregating corners is sufficient and the
    // per-node metric is interpolated by the mesher anyway.
    for (let k = 0; k < 4; k++) {
      const n = mesh.elements[base + k] ?? 0;
      touched[n] = 1;
      if (err > nodeError[n]!) nodeError[n] = err;
      if (h > 0 && h < nodeSize[n]!) nodeSize[n] = h;
    }
  }

  // Midside / untouched nodes: give them a finite size (mean of touched) so
  // downstream math never sees Infinity.
  let sizeSum = 0, sizeN = 0;
  for (let n = 0; n < mesh.nodeCount; n++) {
    if (touched[n] && Number.isFinite(nodeSize[n]!)) { sizeSum += nodeSize[n]!; sizeN++; }
  }
  const meanSize = sizeN > 0 ? sizeSum / sizeN : 1;
  for (let n = 0; n < mesh.nodeCount; n++) {
    if (!touched[n] || !Number.isFinite(nodeSize[n]!)) nodeSize[n] = meanSize;
  }
  return { nodeError, nodeSize };
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
    let excluded = false;
    if (sing.length > 0) {
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

// ─── Element-count prediction & budget guard ─────────────────────────────────
/**
 * Estimate the element count a size field would produce. Refining a region
 * from local size h_cur to h_tgt multiplies its element density by
 * (h_cur / h_tgt)³ in 3D. Summing the per-element density factor (using the
 * finest target among the element's corner nodes) gives a first-order estimate
 * of the resulting element count — enough to enforce a growth budget BEFORE
 * spending a re-mesh.
 */
export function predictRefinedElementCount(mesh: TetMesh, field: SizeField): number {
  const npe = mesh.nodesPerElem ?? 4;
  let predicted = 0;
  for (let e = 0; e < mesh.elementCount; e++) {
    const base = e * npe;
    let hCur = 0, hTgt = Infinity;
    for (let k = 0; k < 4; k++) {
      const n = mesh.elements[base + k] ?? 0;
      hCur += field.currentSize[n]!;
      if (field.targetSize[n]! < hTgt) hTgt = field.targetSize[n]!;
    }
    hCur /= 4;
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
 */
export function relaxSizeFieldToBudget(
  mesh: TetMesh,
  field: SizeField,
  elementBudget: number,
): SizeField {
  const predicted = predictRefinedElementCount(mesh, field);
  if (predicted <= elementBudget || elementBudget <= 0) return field;

  // Binary-search an exponent β in (0,1] applied to each shrink ratio:
  //   h_new' = h_cur · (h_tgt / h_cur)^β
  // β=1 reproduces the field; β→0 removes all refinement. Find the largest β
  // whose prediction fits the budget (keep as much refinement as allowed).
  let lo = 0, hi = 1, best = 0;
  for (let iter = 0; iter < 40; iter++) {
    const beta = (lo + hi) / 2;
    const trial = applyShrinkExponent(field, beta);
    const pred = predictRefinedElementCount(mesh, trial);
    if (pred <= elementBudget) { best = beta; lo = beta; } else { hi = beta; }
  }
  return applyShrinkExponent(field, best);
}

function applyShrinkExponent(field: SizeField, beta: number): SizeField {
  const n = field.targetSize.length;
  const targetSize = new Float64Array(n);
  let refinedNodeCount = 0;
  let minTargetSize = Infinity, maxTargetSize = 0;
  for (let i = 0; i < n; i++) {
    const hCur = field.currentSize[i]!;
    const ratio = hCur > 0 ? field.targetSize[i]! / hCur : 1;
    const ts = ratio < 1 ? hCur * Math.pow(ratio, beta) : field.targetSize[i]!;
    targetSize[i] = ts;
    if (ts < hCur * 0.99) refinedNodeCount++;
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

export type StopReason =
  | "continue"
  | "target-error-reached"
  | "max-iterations"
  | "element-growth-cap"
  | "stalled"
  | "no-refinement-requested";

/**
 * Decide whether the adaptive loop should stop AFTER completing `state`. Order
 * of checks matters: success (target reached) first, then the hard guards
 * (iteration + growth caps), then the soft guards (stall, nothing to refine).
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
  maxIterations: 4,              // cap total solves at 1 base + up to 3 refines
  maxElementGrowth: 8,           // never exceed 8× the base element count
  minRelativeImprovement: 0.05,  // stop when a step improves error <5%
};

export const DEFAULT_SIZE_FIELD_FACTORS = {
  minSizeFactor: 0.35,  // one step never shrinks an element below ~1/3 its size
  maxSizeFactor: 1.0,   // never coarsen (refinement-only), keeps low-error coarse
} as const;

// ─── TetGen background-metric file serialization ─────────────────────────────
/**
 * Serialize a per-node metric to TetGen's `.mtr` format. One header line
 * "<nodeCount> 1" (one scalar value per node = isotropic target edge length),
 * then one value per line. TetGen reads this alongside a background mesh
 * (.b.node/.b.ele) under `-m` and interpolates the target size through the
 * volume. Pure string output — unit-testable with no binary.
 */
export function sizeFieldToMtr(field: SizeField): string {
  const n = field.targetSize.length;
  const lines: string[] = [`${n} 1`];
  for (let i = 0; i < n; i++) {
    lines.push(`${field.targetSize[i]!.toPrecision(8)}`);
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
