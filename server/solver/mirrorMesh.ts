/**
 * mirrorMesh.ts — reflect a fundamental-domain volume mesh across its symmetry
 * plane and weld the seam (issue #296, step 4).
 *
 * An unstructured tet mesh of a mirror-symmetric part is NOT itself mirror
 * symmetric: the tet subdivision is chiral, so the recovered stress field
 * carries an asymmetry the geometry does not have. Measured on a symmetric
 * cantilever, only 128 of 384 element centroids had a mirror partner at all,
 * and the SPR nodal field's mirror asymmetry ran 1.83% / 0.88% / 0.52% rms
 * across 384 / 3,072 / 10,368 elements while the DISPLACEMENT field stayed
 * symmetric to 0.001%. Mesh half the part, mirror it, and the mesh stops
 * contributing asymmetry of its own.
 *
 * ── Why no orientation fix ───────────────────────────────────────────────────
 * A reflection reverses orientation, so every mirrored tet has a negative
 * Jacobian. That is FINE here and deliberately so: the C3D4/C3D10 assemblers
 * auto-orient via `Math.abs(sixV)` / `Math.abs(detJ)`, and the mesh-quality gate
 * keys on scale-invariant shape metrics rather than the Jacobian SIGN precisely
 * so "a MIRROR-oriented but well shaped mesh solves correctly and must pass the
 * gate" (`runLinearStaticWithK`, pipeline.ts). Permuting corners to restore a
 * positive sign would ALSO require permuting the six C3D10 midside nodes to
 * match `C3D10_EDGE_PAIRS`, which is exactly the class of index surgery that
 * produced the #66 / #265 midnode defects. Copying the element's node list
 * verbatim through the index map keeps every edge relationship intact by
 * construction, so there is nothing to get wrong.
 *
 * ── Why the seam must be snapped, not just matched ───────────────────────────
 * The weld at the symmetry plane has to be EXACT or the seam becomes a fresh
 * artifact source — the same class of defect as the vertex-welding bug in
 * CLAUDE.md's heatmap section. A node sitting 10 nm off the plane would mirror
 * to a DISTINCT node 20 nm away, producing a pair of near-coincident nodes and
 * the sliver tets that connect them. So nodes within tolerance of the plane are
 * snapped ONTO it before mirroring, which makes coincidence exact rather than
 * approximate: the mirrored image of a snapped node is bit-identical to the node
 * itself, so it maps back to the same index and no seam node is duplicated.
 *
 * The tolerance is `surfaceSnapTolerance` (clip.ts) — the SAME definition the
 * clip uses to decide which vertices lie on the plane, which is the point: the
 * clip decides what is on the plane and this decides which of those are the same
 * point afterwards. If the two ever differed the seam would not close.
 */

import type { TetMesh }          from "./types.js";
import { surfaceSnapTolerance }  from "./clip.js";

export interface MirrorPlane {
  /** Plane normal; need not be unit length. */
  readonly normal: readonly [number, number, number];
  /** Any point on the plane. */
  readonly origin: readonly [number, number, number];
}

export interface MirrorResult {
  mesh: TetMesh;
  /** Nodes lying ON the plane, shared by both halves rather than duplicated. */
  seamNodeCount: number;
  /** Nodes that were nudged onto the plane to make the weld exact. */
  snappedNodeCount: number;
  /** Largest distance any snapped node moved, in model units. */
  maxSnapDistance: number;
  /** Tolerance used, in model units. */
  tolerance: number;
}

/**
 * Thrown when the input is not a fundamental domain — it has material on BOTH
 * sides of the plane, so mirroring would overlap the mesh with itself.
 *
 * Reported rather than silently tolerated: an overlapping mesh is not a mesh
 * quality problem the gate would catch, it is two copies of the same material
 * occupying one region, which solves to a part twice as stiff as it should be.
 */
export class NotAFundamentalDomainError extends Error {
  constructor(
    readonly nodesOnFarSide: number,
    readonly worstDistance: number,
  ) {
    super(
      `mirrorTetMesh: input straddles the plane — ${nodesOnFarSide} node(s) sit on the far ` +
      `side, worst ${worstDistance.toPrecision(4)} units past it. Mirroring would overlap the ` +
      `mesh with itself. Mesh the CLIPPED half (see clipSurfaceAtPlane) before mirroring.`,
    );
    this.name = "NotAFundamentalDomainError";
  }
}

/** Bounding-box diagonal of a node array, for the scale-relative tolerance. */
function meshDiagonal(mesh: TetMesh): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const x = mesh.nodes[n * 3] ?? 0, y = mesh.nodes[n * 3 + 1] ?? 0, z = mesh.nodes[n * 3 + 2] ?? 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Number.isFinite(d) && d > 0 ? d : 1;
}

/**
 * Mirror `mesh` across `plane` and weld the seam, returning a mesh of the whole
 * part. Element count exactly doubles; node count grows by the number of
 * OFF-plane nodes, because every on-plane node is shared.
 *
 * Preconditions (checked, not assumed): every node lies on the kept side of the
 * plane or on it, within tolerance. The kept side is inferred from the input —
 * whichever side holds material — so the caller does not have to agree with this
 * module about normal direction.
 */
export function mirrorTetMesh(
  mesh:  TetMesh,
  plane: MirrorPlane,
  opts?: { tolerance?: number },
): MirrorResult {
  const [nx0, ny0, nz0] = plane.normal;
  const len = Math.sqrt(nx0 * nx0 + ny0 * ny0 + nz0 * nz0);
  if (!(len > 0) || !Number.isFinite(len)) {
    throw new Error("mirrorTetMesh: plane normal must be a non-zero finite vector");
  }
  const nx = nx0 / len, ny = ny0 / len, nz = nz0 / len;
  const [ox, oy, oz] = plane.origin;

  const tol = opts?.tolerance ?? surfaceSnapTolerance(meshDiagonal(mesh));

  // ── Signed distances, and which side holds the material ──────────────────
  const dist = new Float64Array(mesh.nodeCount);
  let posCount = 0, negCount = 0;
  let worstPos = 0, worstNeg = 0;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const d = (mesh.nodes[n * 3]! - ox) * nx
            + (mesh.nodes[n * 3 + 1]! - oy) * ny
            + (mesh.nodes[n * 3 + 2]! - oz) * nz;
    dist[n] = d;
    if (d > tol)      { posCount++; if (d > worstPos) worstPos = d; }
    else if (d < -tol) { negCount++; if (-d > worstNeg) worstNeg = -d; }
  }

  // A fundamental domain lies entirely on ONE side. Infer which from the input
  // rather than requiring the caller to orient the normal our way; then the
  // other side must be empty.
  if (posCount > 0 && negCount > 0) {
    const farSide = posCount <= negCount ? posCount : negCount;
    throw new NotAFundamentalDomainError(farSide, Math.min(worstPos, worstNeg));
  }

  // ── Snap the seam exactly onto the plane ─────────────────────────────────
  // Done on a COPY: mutating the caller's mesh would move geometry underneath
  // whatever else holds a reference to it.
  const nodes = new Float64Array(mesh.nodeCount * 3);
  nodes.set(mesh.nodes.subarray(0, mesh.nodeCount * 3));

  let seamNodeCount = 0, snappedNodeCount = 0, maxSnapDistance = 0;
  const isSeam = new Uint8Array(mesh.nodeCount);
  for (let n = 0; n < mesh.nodeCount; n++) {
    const d = dist[n]!;
    if (Math.abs(d) > tol) continue;
    isSeam[n] = 1;
    seamNodeCount++;
    if (d !== 0) {
      // Project onto the plane. After this the node's mirror image is itself,
      // bit-for-bit, so the weld is exact rather than within-tolerance.
      nodes[n * 3]     = nodes[n * 3]!     - d * nx;
      nodes[n * 3 + 1] = nodes[n * 3 + 1]! - d * ny;
      nodes[n * 3 + 2] = nodes[n * 3 + 2]! - d * nz;
      snappedNodeCount++;
      if (Math.abs(d) > maxSnapDistance) maxSnapDistance = Math.abs(d);
    }
  }

  // ── Index map: seam nodes map to themselves, others to a fresh node ──────
  const map = new Int32Array(mesh.nodeCount);
  let nextIndex = mesh.nodeCount;
  for (let n = 0; n < mesh.nodeCount; n++) {
    map[n] = isSeam[n] ? n : nextIndex++;
  }
  const newNodeCount = nextIndex;

  const outNodes = new Float64Array(newNodeCount * 3);
  outNodes.set(nodes);
  for (let n = 0; n < mesh.nodeCount; n++) {
    if (isSeam[n]) continue;
    const m = map[n]!;
    const px = nodes[n * 3]!, py = nodes[n * 3 + 1]!, pz = nodes[n * 3 + 2]!;
    // Reflection: p' = p - 2·((p - o)·n)·n. Recomputed from the SNAPPED
    // coordinates rather than reusing `dist`, so the two can never disagree.
    const d = (px - ox) * nx + (py - oy) * ny + (pz - oz) * nz;
    outNodes[m * 3]     = px - 2 * d * nx;
    outNodes[m * 3 + 1] = py - 2 * d * ny;
    outNodes[m * 3 + 2] = pz - 2 * d * nz;
  }

  // ── Elements: the originals, then their images through the map ───────────
  const npe = mesh.nodesPerElem;
  const outElements = new Int32Array(mesh.elementCount * npe * 2);
  outElements.set(mesh.elements.subarray(0, mesh.elementCount * npe));
  const base = mesh.elementCount * npe;
  for (let e = 0; e < mesh.elementCount; e++) {
    for (let k = 0; k < npe; k++) {
      outElements[base + e * npe + k] = map[mesh.elements[e * npe + k]!]!;
    }
  }

  return {
    mesh: {
      nodes:        outNodes,
      elements:     outElements,
      nodeCount:    newNodeCount,
      elementCount: mesh.elementCount * 2,
      nodesPerElem: npe,
    },
    seamNodeCount,
    snappedNodeCount,
    maxSnapDistance,
    tolerance: tol,
  };
}
