/**
 * clip.ts
 * -------
 * Watertight clipping of a closed triangulated surface at a plane (issue #300).
 *
 * WHY THIS EXISTS
 * ---------------
 * Symmetry-preserving meshing (#296) is "detect the plane, mesh the fundamental
 * domain, mirror and weld". Detection landed in `symmetry.ts`. Meshing the
 * fundamental domain means handing TetGen or Gmsh a CLOSED volume representing
 * half the part, which means clipping the input surface at the plane and
 * capping the cut. That is this module, and nothing else in the repo does it:
 * `sliceTetsByAxisPlane` (client) is a marching-tet slice of the VOLUME mesh
 * for display, producing a cut face to colour rather than a watertight surface
 * a mesher can consume, and it runs after the solve.
 *
 * WHERE THE DIFFICULTY ACTUALLY IS
 * --------------------------------
 * Steps 1-3 (classify, split, re-triangulate) are routine. Step 4, capping the
 * hole left at the plane, is not a triangle fan. Cutting a plate through its
 * bore leaves an outer loop PLUS the bore's cross-section as an inner loop, so
 * the cap is a constrained triangulation of a polygon WITH HOLES. A fan over
 * the outer loop tiles straight across the bore and hands the mesher a solid
 * where the part has a hole — a silently wrong answer, not a crash.
 *
 * HOW WATERTIGHTNESS IS OBTAINED (rather than hoped for)
 * ------------------------------------------------------
 * Watertightness is binary: TetGen wants a closed PLC, and one unclosed loop
 * either fails outright or tetrahedralises something that is not the part. So
 * closure is a property of the CONSTRUCTION here, and then checked explicitly
 * before any mesher is invoked (`checkSurfaceClosure`, reported on every
 * result) rather than left to a downstream mesh-quality gate to notice:
 *
 *  - **One snap pass, on vertices, before anything is classified.** A vertex
 *    within tolerance of the plane is projected ONTO it and its signed distance
 *    set to exactly 0. Every triangle sharing that vertex therefore sees the
 *    same classification, and a vertex a hair off the plane cannot emit a
 *    zero-area sliver (the failure the `-m` background-metric episode and the
 *    #166 hard sliver gate both paid for).
 *  - **Split points are cached per EDGE, not per triangle.** The two triangles
 *    sharing an edge receive the same new vertex INDEX carrying bit-identical
 *    coordinates, so a split can never open a seam. The cached point is also
 *    projected onto the plane, so the cap's boundary is exactly planar.
 *  - **Sign tests are on the snapped distances only**, never on recomputed
 *    geometry, so "on the plane" means one thing everywhere in this file.
 *
 * THE SNAP TOLERANCE IS SHARED STATE
 * ----------------------------------
 * Whatever epsilon the clip uses, #296's mirror-and-weld must use the SAME one
 * or the seam will not close: the clip decides which vertices sit exactly on
 * the plane, and the weld decides which of those are the same point after
 * mirroring. `surfaceSnapTolerance` is that single definition — `tetgen.ts`'s
 * `weldToleranceForDiag` delegates to it rather than carrying a second literal
 * that can drift.
 *
 * KEEP-SIDE CONVENTION
 * --------------------
 * The kept half-space is `dot(normal, p - origin) <= 0`, i.e. the side the
 * normal points AWAY from. To keep the other half, negate the normal; there is
 * deliberately no `side` flag, so there is only one convention to remember.
 *
 * SCOPE (issue #300)
 * ------------------
 * Clipping and capping only. Mirroring the result, welding the seam, and
 * wiring any of it into the analysis path stay under #296. `capFaceStart` is
 * exported for that step: the mirror must drop the cap faces before joining
 * the halves, or the seam becomes a doubled internal wall.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * An indexed triangle surface: the shape `weldVertices` produces and the shape
 * `extractSurfaceFaces` produces (given the owning mesh's node array).
 * Triangles are assumed OUTWARD-oriented and consistently wound, which both
 * producers guarantee.
 */
export interface SurfaceMesh {
  /** Vertex positions, [x0,y0,z0, x1,y1,z1, …]. */
  readonly positions: Float64Array;
  /** Triangle corner indices into `positions`, [a0,b0,c0, a1,b1,c1, …]. */
  readonly faces:     Int32Array;
}

/** The cutting plane, in the surface's own coordinates. */
export interface ClipPlane {
  /** Plane normal; need not be unit length. The kept side is `dot(n, p-o) <= 0`. */
  readonly normal: readonly [number, number, number];
  /** Any point on the plane. */
  readonly origin: readonly [number, number, number];
}

/** Manifoldness report for a triangle surface. */
export interface ClosureReport {
  /** True when every edge is shared by exactly two oppositely-wound triangles. */
  closed:              boolean;
  triangleCount:       number;
  /** Edges used by exactly one triangle — a hole in the surface. */
  openEdges:           number;
  /** Edges used by three or more triangles. */
  nonManifoldEdges:    number;
  /** Edges used twice in the SAME direction — a flipped neighbour. */
  inconsistentEdges:   number;
  /** Triangles with a repeated corner index. */
  degenerateTriangles: number;
}

export interface ClipOptions {
  /**
   * Distance within which a vertex is snapped onto the plane. Defaults to
   * `surfaceSnapTolerance(bbox diagonal)`. Whatever is passed here must also be
   * used by #296's mirror-and-weld, or the seam will not close.
   */
  readonly snapTolerance?: number;
}

export interface ClipResult {
  /** The clipped, capped surface. Empty when the plane discards the whole part. */
  surface:                SurfaceMesh;
  /** Triangle index where cap faces begin; caps are always emitted LAST. */
  capFaceStart:           number;
  capFaceCount:           number;
  /** Summed area of the cap triangles. */
  capArea:                number;
  /**
   * Area the boundary loops enclose (outer loops minus holes), computed from
   * the loops alone. `capArea` must match it: a fan across a bore would not,
   * so the pair is a self-check on the triangulation, reported rather than
   * asserted so the caller can decide what to do about it.
   */
  loopArea:               number;
  outerLoopCount:         number;
  holeLoopCount:          number;
  snappedVertexCount:     number;
  keptTriangleCount:      number;
  splitTriangleCount:     number;
  discardedTriangleCount: number;
  /** Cap triangles with effectively zero area — the sliver signal. */
  degenerateCapTriangles: number;
  /**
   * Times the ear clipper found no valid ear and had to force one. Non-zero
   * means a cap polygon defeated the triangulator; the cap is still closed
   * (every polygon edge still used exactly once) but may self-overlap, which
   * `capArea` vs `loopArea` will show.
   */
  capFallbackCount:       number;
  /** Manifoldness of `surface`, run before any mesher can be handed the result. */
  closure:                ClosureReport;
}

// ─── Shared snap tolerance ───────────────────────────────────────────────────

/**
 * Snap tolerance as a fraction of the bounding-box diagonal.
 *
 * Scale-relative for the reason `weldToleranceForDiag` is (issue #168): a fixed
 * absolute epsilon only behaves when the model happens to be in millimetres.
 * 1e-6 of the diagonal is one decade looser than float32 coincidence
 * (~diag·1e-7), which is what the STL path's welded vertices agree to, and far
 * tighter than any real feature — 0.1 µm on a 100 mm part.
 *
 * Confidence: MEDIUM. The value is inherited from the vertex weld, where it has
 * been in production, and the two MUST agree (see the module header). It is a
 * coincidence threshold, not a sliver-avoidance knob: a vertex sitting
 * 10 µm off the plane is not snapped and will produce a thin — though valid and
 * reported — cap triangle. Raising it to swallow such cases would move real
 * geometry, so the honest lever is `ClipOptions.snapTolerance` at a call site
 * that knows its input, not a bigger default here.
 */
export const SURFACE_SNAP_TOL_REL = 1e-6;

/**
 * Snap/weld tolerance for a surface whose bounding-box diagonal is `diag`.
 * The floor keeps the value strictly positive for a degenerate zero-size input.
 *
 * This is the ONE definition: `tetgen.ts`'s `weldToleranceForDiag` delegates
 * here so the clipper and the weld cannot drift apart (issue #300).
 */
export function surfaceSnapTolerance(diag: number): number {
  return Math.max(diag * SURFACE_SNAP_TOL_REL, 1e-12);
}

// ─── Surface measures ────────────────────────────────────────────────────────

/** Bounding box of a surface's vertices, plus the diagonal length. */
export function surfaceBoundingBox(surface: SurfaceMesh): {
  min: [number, number, number]; max: [number, number, number]; diag: number;
} {
  const p = surface.positions;
  const n = Math.floor(p.length / 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < n; v++) {
    const x = p[v * 3] ?? 0, y = p[v * 3 + 1] ?? 0, z = p[v * 3 + 2] ?? 0;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) { minX = minY = minZ = 0; maxX = maxY = maxZ = 0; }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    diag: Math.hypot(maxX - minX, maxY - minY, maxZ - minZ),
  };
}

/**
 * Signed volume enclosed by a closed, outward-oriented triangle surface, by the
 * divergence theorem (sum of the tetrahedra each triangle forms with the
 * origin). Positive for an outward-oriented closed surface; independent of
 * where the origin sits. Meaningless — but harmless — on an open surface, which
 * is why closure is checked separately rather than inferred from this.
 */
export function signedVolumeOf(surface: SurfaceMesh): number {
  const p = surface.positions, f = surface.faces;
  const triCount = Math.floor(f.length / 3);
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    const a = f[t * 3] ?? 0, b = f[t * 3 + 1] ?? 0, c = f[t * 3 + 2] ?? 0;
    const ax = p[a * 3] ?? 0, ay = p[a * 3 + 1] ?? 0, az = p[a * 3 + 2] ?? 0;
    const bx = p[b * 3] ?? 0, by = p[b * 3 + 1] ?? 0, bz = p[b * 3 + 2] ?? 0;
    const cx = p[c * 3] ?? 0, cy = p[c * 3 + 1] ?? 0, cz = p[c * 3 + 2] ?? 0;
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return vol;
}

/** Total area of a triangle surface. */
export function surfaceAreaOf(surface: SurfaceMesh): number {
  const p = surface.positions, f = surface.faces;
  const triCount = Math.floor(f.length / 3);
  let area = 0;
  for (let t = 0; t < triCount; t++) {
    const a = f[t * 3] ?? 0, b = f[t * 3 + 1] ?? 0, c = f[t * 3 + 2] ?? 0;
    area += triangleArea(p, a, b, c);
  }
  return area;
}

function triangleArea(p: Float64Array, a: number, b: number, c: number): number {
  const ax = p[a * 3] ?? 0, ay = p[a * 3 + 1] ?? 0, az = p[a * 3 + 2] ?? 0;
  const ux = (p[b * 3] ?? 0) - ax, uy = (p[b * 3 + 1] ?? 0) - ay, uz = (p[b * 3 + 2] ?? 0) - az;
  const vx = (p[c * 3] ?? 0) - ax, vy = (p[c * 3 + 1] ?? 0) - ay, vz = (p[c * 3 + 2] ?? 0) - az;
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}

/**
 * Check that a triangle surface is a closed, consistently-oriented 2-manifold.
 *
 * This is the gate that must pass BEFORE a mesher is invoked. TetGen given an
 * unclosed PLC does not reliably fail — it can tetrahedralise something that is
 * not the part — so "the mesh quality gate will catch it" is not a substitute.
 *
 * Each directed edge of each triangle is counted. A closed, consistently-wound
 * surface uses every directed edge exactly once, so its reverse must also
 * appear exactly once.
 */
export function checkSurfaceClosure(surface: SurfaceMesh): ClosureReport {
  const f = surface.faces;
  const triCount = Math.floor(f.length / 3);
  // Directed-edge use counts, keyed on the ordered vertex pair.
  const dir = new Map<string, number>();
  let degenerateTriangles = 0;

  for (let t = 0; t < triCount; t++) {
    const a = f[t * 3] ?? 0, b = f[t * 3 + 1] ?? 0, c = f[t * 3 + 2] ?? 0;
    if (a === b || b === c || a === c) { degenerateTriangles++; continue; }
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = `${u},${v}`;
      dir.set(k, (dir.get(k) ?? 0) + 1);
    }
  }

  let openEdges = 0, nonManifoldEdges = 0, inconsistentEdges = 0;
  const seen = new Set<string>();
  for (const [k, count] of dir) {
    const [uStr, vStr] = k.split(",");
    const u = Number(uStr), v = Number(vStr);
    const undirected = u < v ? `${u},${v}` : `${v},${u}`;
    if (seen.has(undirected)) continue;
    seen.add(undirected);

    const fwd = dir.get(`${u},${v}`) ?? 0;
    const rev = dir.get(`${v},${u}`) ?? 0;
    const total = fwd + rev;
    if (total > 2)                     nonManifoldEdges++;
    else if (total < 2)                openEdges++;
    else if (fwd !== 1 || rev !== 1)   inconsistentEdges++;   // used twice, same way
  }

  return {
    closed: openEdges === 0 && nonManifoldEdges === 0 && inconsistentEdges === 0
            && degenerateTriangles === 0 && triCount > 0,
    triangleCount: triCount,
    openEdges,
    nonManifoldEdges,
    inconsistentEdges,
    degenerateTriangles,
  };
}

// ─── The clip ────────────────────────────────────────────────────────────────

/**
 * Clip a closed triangle surface to the half-space `dot(n, p - o) <= 0` and cap
 * the cut, producing a closed surface.
 *
 * @param surface  A closed, outward-oriented, consistently-wound triangle
 *                 surface. Check it with `checkSurfaceClosure` if the producer
 *                 does not already guarantee it — clipping an open surface
 *                 produces boundary edges off the plane, which are reported as
 *                 `openEdges` on the result rather than silently capped.
 * @param plane    Cutting plane. The normal need not be unit length.
 * @param opts     See `ClipOptions`.
 * @throws if the input is a closed surface wound INWARD (negative
 *         `signedVolumeOf`) — see issue #306. A consistently inward-wound
 *         surface passes `checkSurfaceClosure` on its own, so the cap would
 *         otherwise be emitted on the wrong side and the RESULT would fail
 *         closure with "inconsistent edges", a diagnostic that points at the
 *         cap triangulation rather than at the input's winding. Caught here
 *         instead, against the one signal that already distinguishes the two
 *         cases. Does not fire on a surface with MIXED winding — that already
 *         fails its own `checkSurfaceClosure`, correctly, before this runs.
 */
export function clipSurfaceAtPlane(
  surface: SurfaceMesh,
  plane:   ClipPlane,
  opts:    ClipOptions = {},
): ClipResult {
  const srcPos = surface.positions;
  const srcFaces = surface.faces;
  const srcTriCount = Math.floor(srcFaces.length / 3);
  const srcVertCount = Math.floor(srcPos.length / 3);

  const inputVolume = signedVolumeOf(surface);
  if (inputVolume < 0) {
    throw new Error(
      "clipSurfaceAtPlane: input surface is wound INWARD (signed volume "
      + `${inputVolume.toExponential(3)} < 0). The clip requires an `
      + "outward-oriented surface — flip its triangle winding before calling.",
    );
  }

  const nLen = Math.hypot(plane.normal[0], plane.normal[1], plane.normal[2]);
  if (!(nLen > 0)) throw new Error("clipSurfaceAtPlane: plane normal has zero length");
  const nx = plane.normal[0] / nLen, ny = plane.normal[1] / nLen, nz = plane.normal[2] / nLen;
  const [ox, oy, oz] = plane.origin;

  const diag = surfaceBoundingBox(surface).diag;
  const snapTol = opts.snapTolerance ?? surfaceSnapTolerance(diag);

  // ── 1. Signed distances, with the single snap pass ────────────────────────
  // Snapping happens ONCE, on vertices, before any triangle is looked at, so
  // every triangle sharing a snapped vertex classifies it identically. The
  // position is moved onto the plane as well as the distance zeroed: a cap
  // boundary that is only nearly planar defeats the 2D triangulation below.
  const pos = Float64Array.from(srcPos);
  const dist = new Float64Array(srcVertCount);
  let snappedVertexCount = 0;
  for (let v = 0; v < srcVertCount; v++) {
    const x = pos[v * 3] ?? 0, y = pos[v * 3 + 1] ?? 0, z = pos[v * 3 + 2] ?? 0;
    const d = (x - ox) * nx + (y - oy) * ny + (z - oz) * nz;
    if (Math.abs(d) <= snapTol) {
      pos[v * 3]     = x - d * nx;
      pos[v * 3 + 1] = y - d * ny;
      pos[v * 3 + 2] = z - d * nz;
      dist[v] = 0;
      if (d !== 0) snappedVertexCount++;
    } else {
      dist[v] = d;
    }
  }

  // ── 2. Output vertex pool ─────────────────────────────────────────────────
  // Source vertices are copied lazily (only those a kept triangle references),
  // so the result carries no orphans. Split points are cached per EDGE: both
  // triangles sharing an edge get the same index and bit-identical coordinates,
  // which is what makes a split incapable of opening a seam.
  const outPos: number[] = [];
  const srcToOut = new Int32Array(srcVertCount).fill(-1);
  const useSrc = (v: number): number => {
    const existing = srcToOut[v] ?? -1;
    if (existing >= 0) return existing;
    const idx = outPos.length / 3;
    outPos.push(pos[v * 3] ?? 0, pos[v * 3 + 1] ?? 0, pos[v * 3 + 2] ?? 0);
    srcToOut[v] = idx;
    return idx;
  };

  const splitCache = new Map<number, number>();
  const splitOnEdge = (a: number, b: number): number => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const key = lo * srcVertCount + hi;
    const hit = splitCache.get(key);
    if (hit !== undefined) return hit;

    // Interpolate in the canonical (lo, hi) direction so the arithmetic — and
    // hence the last bit of the result — does not depend on which triangle
    // asked first.
    const dLo = dist[lo] ?? 0, dHi = dist[hi] ?? 0;
    const t = dLo / (dLo - dHi);
    let x = (pos[lo * 3] ?? 0) + t * ((pos[hi * 3] ?? 0) - (pos[lo * 3] ?? 0));
    let y = (pos[lo * 3 + 1] ?? 0) + t * ((pos[hi * 3 + 1] ?? 0) - (pos[lo * 3 + 1] ?? 0));
    let z = (pos[lo * 3 + 2] ?? 0) + t * ((pos[hi * 3 + 2] ?? 0) - (pos[lo * 3 + 2] ?? 0));
    // Kill the round-off residual so the point is exactly on the plane.
    const resid = (x - ox) * nx + (y - oy) * ny + (z - oz) * nz;
    x -= resid * nx; y -= resid * ny; z -= resid * nz;

    const idx = outPos.length / 3;
    outPos.push(x, y, z);
    splitCache.set(key, idx);
    return idx;
  };

  // ── 3. Classify, split, re-triangulate ────────────────────────────────────
  const outFaces: number[] = [];
  // Vertices that ended up exactly on the plane, in OUTPUT indices — the only
  // ones a cap boundary edge may reference.
  const onPlane = new Set<number>();
  let keptTriangleCount = 0, splitTriangleCount = 0, discardedTriangleCount = 0;

  const emit = (a: number, b: number, c: number): void => {
    if (a === b || b === c || a === c) return;   // collapsed by snapping
    outFaces.push(a, b, c);
  };

  for (let t = 0; t < srcTriCount; t++) {
    const va = srcFaces[t * 3] ?? 0, vb = srcFaces[t * 3 + 1] ?? 0, vc = srcFaces[t * 3 + 2] ?? 0;
    const tri = [va, vb, vc];
    const sa = dist[va] ?? 0, sb = dist[vb] ?? 0, sc = dist[vc] ?? 0;

    const nPos = (sa > 0 ? 1 : 0) + (sb > 0 ? 1 : 0) + (sc > 0 ? 1 : 0);
    const nNeg = (sa < 0 ? 1 : 0) + (sb < 0 ? 1 : 0) + (sc < 0 ? 1 : 0);

    if (nPos === 0 && nNeg === 0) {
      // Coplanar triangle — a flat face lying exactly ON the plane, which is an
      // ordinary FTC bracket rather than a pathological input. Its own outward
      // normal decides: the normal points AWAY from material, and the discard
      // side is the +n side, so a face bounding kept material has normal·n > 0.
      // Getting this backwards deletes a real face (a hole in the surface) or
      // keeps a face bounding material that is no longer there (an internal
      // wall), and the closure check catches both.
      const ax = pos[va * 3] ?? 0, ay = pos[va * 3 + 1] ?? 0, az = pos[va * 3 + 2] ?? 0;
      const ux = (pos[vb * 3] ?? 0) - ax, uy = (pos[vb * 3 + 1] ?? 0) - ay, uz = (pos[vb * 3 + 2] ?? 0) - az;
      const wx = (pos[vc * 3] ?? 0) - ax, wy = (pos[vc * 3 + 1] ?? 0) - ay, wz = (pos[vc * 3 + 2] ?? 0) - az;
      const fnx = uy * wz - uz * wy, fny = uz * wx - ux * wz, fnz = ux * wy - uy * wx;
      if (fnx * nx + fny * ny + fnz * nz > 0) {
        const a = useSrc(va), b = useSrc(vb), c = useSrc(vc);
        onPlane.add(a); onPlane.add(b); onPlane.add(c);
        emit(a, b, c);
        keptTriangleCount++;
      } else {
        discardedTriangleCount++;
      }
      continue;
    }

    if (nPos === 0) {                              // wholly on the kept side
      const a = useSrc(va), b = useSrc(vb), c = useSrc(vc);
      if (sa === 0) onPlane.add(a);
      if (sb === 0) onPlane.add(b);
      if (sc === 0) onPlane.add(c);
      emit(a, b, c);
      keptTriangleCount++;
      continue;
    }

    if (nNeg === 0) { discardedTriangleCount++; continue; }   // wholly discarded

    // Straddling: Sutherland-Hodgman against the half-space. A vertex with
    // distance exactly 0 is emitted as itself and creates NO split point, which
    // is precisely why the snap pass above prevents slivers here.
    const polyIdx: number[] = [];
    for (let i = 0; i < 3; i++) {
      const cur = tri[i]!, nxt = tri[(i + 1) % 3]!;
      const sCur = dist[cur] ?? 0, sNxt = dist[nxt] ?? 0;
      if (sCur <= 0) {
        const o = useSrc(cur);
        if (sCur === 0) onPlane.add(o);
        polyIdx.push(o);
      }
      if ((sCur < 0 && sNxt > 0) || (sCur > 0 && sNxt < 0)) {
        const o = splitOnEdge(cur, nxt);
        onPlane.add(o);
        polyIdx.push(o);
      }
    }
    // Sutherland-Hodgman preserves winding, so a fan from the first vertex is
    // correctly oriented. The polygon has at most 4 vertices here.
    for (let i = 1; i + 1 < polyIdx.length; i++) emit(polyIdx[0]!, polyIdx[i]!, polyIdx[i + 1]!);
    splitTriangleCount++;
  }

  const capFaceStart = outFaces.length / 3;

  // ── 4. Extract the open boundary loops and cap them ───────────────────────
  const loops = extractBoundaryLoops(outFaces, onPlane);
  const cap = triangulateCapLoops(loops, outPos, [nx, ny, nz], diag);
  for (const [a, b, c] of cap.triangles) outFaces.push(a, b, c);

  const positions = Float64Array.from(outPos);
  const faces = Int32Array.from(outFaces);
  const result: SurfaceMesh = { positions, faces };

  let capArea = 0, degenerateCapTriangles = 0;
  const areaEps = Math.max(diag * diag * 1e-14, Number.MIN_VALUE);
  for (let t = capFaceStart; t < faces.length / 3; t++) {
    const a = faces[t * 3] ?? 0, b = faces[t * 3 + 1] ?? 0, c = faces[t * 3 + 2] ?? 0;
    const ar = triangleArea(positions, a, b, c);
    capArea += ar;
    if (ar <= areaEps) degenerateCapTriangles++;
  }

  return {
    surface: result,
    capFaceStart,
    capFaceCount: faces.length / 3 - capFaceStart,
    capArea,
    loopArea: cap.loopArea,
    outerLoopCount: cap.outerCount,
    holeLoopCount: cap.holeCount,
    snappedVertexCount,
    keptTriangleCount,
    splitTriangleCount,
    discardedTriangleCount,
    degenerateCapTriangles,
    capFallbackCount: cap.fallbackCount,
    closure: checkSurfaceClosure(result),
  };
}

/**
 * Chain the surface's open boundary edges into closed loops.
 *
 * An edge used by exactly one triangle is a boundary edge, and on a correctly
 * clipped surface every one of them lies in the plane — which is what
 * `onPlane` verifies. An edge off the plane means the INPUT was not closed;
 * it is dropped here rather than capped (capping it would invent geometry),
 * and the closure check on the result reports the consequence.
 *
 * Following each directed boundary edge from its head gives loops that inherit
 * the surface's winding. Orientation is not trusted for classifying outer
 * loops against holes — containment does that in `triangulateCapLoops` — but a
 * consistent traversal is what makes each loop come out closed.
 */
function extractBoundaryLoops(faces: number[], onPlane: Set<number>): number[][] {
  const triCount = faces.length / 3;
  const used = new Map<string, number>();
  for (let t = 0; t < triCount; t++) {
    const a = faces[t * 3] ?? 0, b = faces[t * 3 + 1] ?? 0, c = faces[t * 3 + 2] ?? 0;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [number, number][]) {
      const k = `${u},${v}`;
      used.set(k, (used.get(k) ?? 0) + 1);
    }
  }

  // Boundary = directed edge whose reverse is absent. Bucket by tail vertex so
  // a loop can be walked; a vertex where two loops pinch together has more than
  // one outgoing edge, and consuming greedily still closes both loops.
  const outgoing = new Map<number, number[]>();
  let edgeCount = 0;
  for (const [k, count] of used) {
    const [uStr, vStr] = k.split(",");
    const u = Number(uStr), v = Number(vStr);
    if ((used.get(`${v},${u}`) ?? 0) > 0) continue;      // interior edge
    if (count !== 1) continue;                            // non-manifold; leave it
    if (!onPlane.has(u) || !onPlane.has(v)) continue;     // input was not closed
    const list = outgoing.get(u);
    if (list) list.push(v); else outgoing.set(u, [v]);
    edgeCount++;
  }

  const loops: number[][] = [];
  let consumed = 0;
  for (const start of outgoing.keys()) {
    while ((outgoing.get(start)?.length ?? 0) > 0) {
      const loop: number[] = [];
      let cur = start;
      let closedLoop = false;
      // The guard is the total edge count: a walk cannot legitimately visit
      // more edges than exist, so this cannot spin on malformed input.
      while (consumed <= edgeCount) {
        const nexts = outgoing.get(cur);
        if (!nexts || nexts.length === 0) break;
        const nxt = nexts.pop()!;
        consumed++;
        loop.push(cur);
        cur = nxt;
        if (cur === start) { closedLoop = true; break; }
      }
      // A walk that ran out of edges before returning to its start is not a
      // loop, and capping it would invent a boundary the geometry does not
      // have. Drop it — the closure check on the result reports the edges it
      // leaves open, which is the honest signal.
      if (closedLoop && loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

// ─── Cap triangulation: polygon with holes ───────────────────────────────────

interface Pt2 { x: number; y: number; id: number; }

/**
 * Triangulate the cap: the region the boundary loops enclose in the plane.
 *
 * The cap's outward normal is +n — material is on the `dot(n,p-o) <= 0` side,
 * so the lid faces the other way — and a triangle wound CCW in the (u,v) basis
 * built here has exactly that normal, so emitting CCW triangles orients the cap
 * correctly by construction.
 *
 * Outer loops and holes are separated by CONTAINMENT DEPTH rather than by
 * winding: depth 0 (inside no other loop) is an outer boundary, depth 1 is a
 * hole in it, depth 2 is an island inside that hole, and so on. Depth is robust
 * to a loop whose traversal direction came out unexpectedly, and it generalises
 * for free to the cases that actually occur — a cut with several disjoint
 * cross-sections, or a bore inside a boss inside a pocket.
 */
function triangulateCapLoops(
  loops:  number[][],
  outPos: number[],
  n:      [number, number, number],
  diag:   number,
): { triangles: [number, number, number][]; loopArea: number; outerCount: number; holeCount: number; fallbackCount: number } {
  const triangles: [number, number, number][] = [];
  if (loops.length === 0) {
    return { triangles, loopArea: 0, outerCount: 0, holeCount: 0, fallbackCount: 0 };
  }

  // Orthonormal in-plane basis with u × v = n.
  const [nxv, nyv, nzv] = n;
  const ref: [number, number, number] = Math.abs(nxv) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let ux = nyv * ref[2] - nzv * ref[1];
  let uy = nzv * ref[0] - nxv * ref[2];
  let uz = nxv * ref[1] - nyv * ref[0];
  const uLen = Math.hypot(ux, uy, uz);
  ux /= uLen; uy /= uLen; uz /= uLen;
  const vx = nyv * uz - nzv * uy;
  const vy = nzv * ux - nxv * uz;
  const vz = nxv * uy - nyv * ux;

  const project = (id: number): Pt2 => {
    const x = outPos[id * 3] ?? 0, y = outPos[id * 3 + 1] ?? 0, z = outPos[id * 3 + 2] ?? 0;
    return { x: x * ux + y * uy + z * uz, y: x * vx + y * vy + z * vz, id };
  };

  const rings: Pt2[][] = loops.map(loop => loop.map(project));

  // ── Containment depth ────────────────────────────────────────────────────
  const depth = rings.map((ring, i) => {
    // A ring vertex, not a centroid: the centroid of a non-convex ring can fall
    // outside its own polygon, and a vertex of one loop never lies on another.
    const probe = ring[0]!;
    let d = 0;
    for (let j = 0; j < rings.length; j++) {
      if (j === i) continue;
      if (pointInRing(rings[j]!, probe.x, probe.y)) d++;
    }
    return d;
  });

  const areas = rings.map(signedArea2);
  let loopArea = 0;
  for (let i = 0; i < rings.length; i++) {
    loopArea += (depth[i]! % 2 === 0 ? 1 : -1) * Math.abs(areas[i]!);
  }

  // Each outer ring collects the holes whose immediate parent it is.
  const outerIdx = rings.map((_, i) => i).filter(i => depth[i]! % 2 === 0);
  const holeIdx  = rings.map((_, i) => i).filter(i => depth[i]! % 2 === 1);
  const holesOf = new Map<number, number[]>(outerIdx.map(i => [i, [] as number[]]));
  for (const h of holeIdx) {
    let parent = -1, parentDepth = -1;
    for (const o of outerIdx) {
      if (depth[o]! >= depth[h]!) continue;
      if (!pointInRing(rings[o]!, rings[h]![0]!.x, rings[h]![0]!.y)) continue;
      if (depth[o]! > parentDepth) { parent = o; parentDepth = depth[o]!; }
    }
    // A hole with no containing outer ring cannot happen on a closed input; if
    // it does, dropping it leaves the region untiled rather than tiling ACROSS
    // a void, and the capArea/loopArea disagreement says so.
    if (parent >= 0) holesOf.get(parent)!.push(h);
  }

  // The 2D cross products below are AREAS, so the tolerance scales with diag²,
  // not diag. Sized to sit far above coordinate round-off (~diag²·1e-16) and
  // far below any triangle a mesher would accept.
  const eps = Math.max(diag * diag * 1e-12, Number.MIN_VALUE);
  let fallbackCount = 0;
  for (const o of outerIdx) {
    const outer = orient(rings[o]!, areas[o]!, true);            // CCW
    const holes = holesOf.get(o)!.map(h => orient(rings[h]!, areas[h]!, false)); // CW
    const merged = holes.length > 0 ? bridgeHoles(outer, holes) : outer;
    const res = earClip(merged, eps);
    fallbackCount += res.fallbackCount;
    for (const tri of res.triangles) triangles.push(tri);
  }

  return { triangles, loopArea, outerCount: outerIdx.length, holeCount: holeIdx.length, fallbackCount };
}

function signedArea2(ring: Pt2[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j]!.x - ring[i]!.x) * (ring[j]!.y + ring[i]!.y);
  }
  return a / 2;
}

/** Return the ring wound CCW (`wantCCW`) or CW, reversing a copy if needed. */
function orient(ring: Pt2[], area: number, wantCCW: boolean): Pt2[] {
  const isCCW = area > 0;
  return isCCW === wantCCW ? ring.slice() : ring.slice().reverse();
}

/** Crossing-number point-in-polygon. Points on the boundary are unspecified. */
function pointInRing(ring: Pt2[], px: number, py: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]!.x, yi = ring[i]!.y, xj = ring[j]!.x, yj = ring[j]!.y;
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function cross2(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** True when segments p1p2 and p3p4 cross at a point interior to both. */
function properlyIntersect(p1: Pt2, p2: Pt2, p3: Pt2, p4: Pt2): boolean {
  const d1 = cross2(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y);
  const d2 = cross2(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y);
  const d3 = cross2(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  const d4 = cross2(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Splice each hole into the outer ring along a bridge, turning a polygon with
 * holes into one simple polygon the ear clipper can handle.
 *
 * The bridge is chosen by VISIBILITY rather than by earcut's ray-cast-and-
 * refine: from the hole's rightmost vertex, take the nearest ring vertex whose
 * connecting segment crosses no edge of the ring or of any hole not yet
 * spliced, and whose midpoint lies in the material (inside the ring, outside
 * every remaining hole). Crossing nothing means the segment stays in one
 * region, so the midpoint test identifies which — the pair is sufficient.
 *
 * O(n²) per hole, which is affordable at cap-polygon sizes (tens to a few
 * hundred vertices, a bore cross-section being the large case) and much easier
 * to reason about than the ray-cast variant.
 */
function bridgeHoles(outer: Pt2[], holes: Pt2[][]): Pt2[] {
  // Rightmost-first: a hole further right can only bridge to the outer ring or
  // to a hole already spliced, never to one still pending.
  const pending = holes
    .map(h => {
      // A loop, not Math.max(...spread): a cut through a finely-faceted bore
      // can carry more vertices than the argument limit allows.
      let maxX = -Infinity;
      for (const p of h) if (p.x > maxX) maxX = p.x;
      return { ring: h, maxX };
    })
    .sort((a, b) => b.maxX - a.maxX)
    .map(e => e.ring);

  let ring = outer.slice();
  for (let hi = 0; hi < pending.length; hi++) {
    const hole = pending[hi]!;
    const remaining = pending.slice(hi + 1);

    // The hole's rightmost vertex; ties broken on y so the choice is total.
    let m = 0;
    for (let i = 1; i < hole.length; i++) {
      const a = hole[i]!, b = hole[m]!;
      if (a.x > b.x || (a.x === b.x && a.y > b.y)) m = i;
    }
    const M = hole[m]!;

    const order = ring
      .map((p, i) => ({ i, d: (p.x - M.x) * (p.x - M.x) + (p.y - M.y) * (p.y - M.y) }))
      .sort((a, b) => a.d - b.d);

    let bridge = -1;
    for (const { i } of order) {
      const P = ring[i]!;
      if (!bridgeIsClear(M, P, ring, i, hole, m, remaining)) continue;
      const mx = (M.x + P.x) / 2, my = (M.y + P.y) / 2;
      if (!pointInRing(ring, mx, my)) continue;
      if (remaining.some(r => pointInRing(r, mx, my))) continue;
      bridge = i;
      break;
    }
    // No visible vertex means the hole cannot be reached — geometrically
    // impossible for a valid polygon with holes, so rather than fabricate a
    // bridge, leave the hole out. The cap stays closed around the outer ring
    // and capArea vs loopArea reports the untiled void.
    if (bridge < 0) continue;

    const rotated: Pt2[] = [];
    for (let k = 0; k < hole.length; k++) rotated.push(hole[(m + k) % hole.length]!);
    ring = [
      ...ring.slice(0, bridge + 1),
      ...rotated,
      rotated[0]!,
      ring[bridge]!,
      ...ring.slice(bridge + 1),
    ];
  }
  return ring;
}

/** Bridge segment M–P crosses no polygon edge (edges incident to M or P excepted). */
function bridgeIsClear(
  M: Pt2, P: Pt2,
  ring: Pt2[], ringIdx: number,
  hole: Pt2[], holeIdx: number,
  remaining: Pt2[][],
): boolean {
  for (let j = 0; j < ring.length; j++) {
    if (j === ringIdx || (j + 1) % ring.length === ringIdx) continue;
    if (properlyIntersect(M, P, ring[j]!, ring[(j + 1) % ring.length]!)) return false;
  }
  for (let j = 0; j < hole.length; j++) {
    if (j === holeIdx || (j + 1) % hole.length === holeIdx) continue;
    if (properlyIntersect(M, P, hole[j]!, hole[(j + 1) % hole.length]!)) return false;
  }
  for (const r of remaining) {
    for (let j = 0; j < r.length; j++) {
      if (properlyIntersect(M, P, r[j]!, r[(j + 1) % r.length]!)) return false;
    }
  }
  return true;
}

/**
 * Inside-or-on test for a CCW triangle, to within `eps`.
 *
 * The tolerance is not defensive garnish. Boundary vertices that are collinear
 * in the PART are only collinear to round-off in the DATA — the plate fixture's
 * square edge, built as `t·cosθ` with `t = half-width/|cosθ|`, lands on
 * x = 30 ± 1e-14 — so an exact `>= 0` test reads points that sit on an edge as
 * outside it, roughly half the time. That is the difference between rejecting
 * an ear that would cut a diagonal along a straight run of the boundary and
 * accepting it.
 */
function insideTriangle(a: Pt2, b: Pt2, c: Pt2, p: Pt2, eps: number): boolean {
  return cross2(a.x, a.y, b.x, b.y, p.x, p.y) >= -eps
      && cross2(b.x, b.y, c.x, c.y, p.x, p.y) >= -eps
      && cross2(c.x, c.y, a.x, a.y, p.x, p.y) >= -eps;
}

/**
 * Ear-clip a simple CCW polygon (bridges included) into triangles.
 *
 * A candidate ear is rejected when another vertex lies inside it OR ON ITS
 * BOUNDARY, and only REFLEX-OR-FLAT vertices are allowed to reject it. Both
 * halves of that rule are load-bearing, and getting either wrong is silent:
 *
 *  - **On-boundary counts.** A clipped cap boundary is full of COLLINEAR
 *    vertices — every point where the part's side wall met the plane along a
 *    straight edge. With a strictly-interior test, an ear may cut a diagonal
 *    lying exactly along such a run, which is "valid" by that test and leaves
 *    the run behind as a zero-area chain that only the fallback below can
 *    consume. Measured on the plate-with-bore fixture: 7 zero-area cap
 *    triangles and 6 fallbacks, with the cap AREA still landing one ULP from
 *    the analytic value — so nothing but an explicit sliver count would have
 *    caught it, and the mesher would have been handed degenerate facets.
 *  - **Only reflex-or-flat vertices block.** A convex vertex touching the ear
 *    cannot make it invalid, and blocking on it would stall the clipper at
 *    every hole bridge, whose duplicated vertices sit exactly on the
 *    zero-width channel.
 *
 * When no ear can be found at all the polygon is not simple (a bridge
 * overlapped, or the loop self-intersects). Rather than loop forever or drop
 * vertices, the most-convex remaining vertex is clipped anyway and the event is
 * COUNTED: the result still uses every polygon edge exactly once, so the
 * surface stays closed, but it may self-overlap — which is what the `capArea`
 * versus `loopArea` comparison on the result surfaces.
 */
function earClip(poly: Pt2[], eps: number): { triangles: [number, number, number][]; fallbackCount: number } {
  const triangles: [number, number, number][] = [];
  const idx = poly.map((_, i) => i);
  let fallbackCount = 0;

  while (idx.length > 3) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ip = idx[(i + idx.length - 1) % idx.length]!;
      const ic = idx[i]!;
      const inx = idx[(i + 1) % idx.length]!;
      const a = poly[ip]!, b = poly[ic]!, c = poly[inx]!;
      if (cross2(a.x, a.y, b.x, b.y, c.x, c.y) <= eps) continue;   // reflex or flat

      let blocked = false;
      for (let j = 0; j < idx.length; j++) {
        const k = idx[j]!;
        if (k === ip || k === ic || k === inx) continue;
        if (!insideTriangle(a, b, c, poly[k]!, eps)) continue;
        const kp = poly[idx[(j + idx.length - 1) % idx.length]!]!;
        const kc = poly[k]!;
        const kn = poly[idx[(j + 1) % idx.length]!]!;
        if (cross2(kp.x, kp.y, kc.x, kc.y, kn.x, kn.y) <= eps) { blocked = true; break; }
      }
      if (blocked) continue;

      triangles.push([a.id, b.id, c.id]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (clipped) continue;

    // Fallback: clip the most convex vertex regardless.
    let best = 0, bestCross = -Infinity;
    for (let i = 0; i < idx.length; i++) {
      const a = poly[idx[(i + idx.length - 1) % idx.length]!]!;
      const b = poly[idx[i]!]!;
      const c = poly[idx[(i + 1) % idx.length]!]!;
      const cr = cross2(a.x, a.y, b.x, b.y, c.x, c.y);
      if (cr > bestCross) { bestCross = cr; best = i; }
    }
    const a = poly[idx[(best + idx.length - 1) % idx.length]!]!;
    const b = poly[idx[best]!]!;
    const c = poly[idx[(best + 1) % idx.length]!]!;
    triangles.push([a.id, b.id, c.id]);
    idx.splice(best, 1);
    fallbackCount++;
  }

  if (idx.length === 3) {
    triangles.push([poly[idx[0]!]!.id, poly[idx[1]!]!.id, poly[idx[2]!]!.id]);
  }
  return { triangles, fallbackCount };
}
