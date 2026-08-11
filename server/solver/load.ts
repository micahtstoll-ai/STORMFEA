/**
 * load.ts
 * -------
 * Assembles the global force vector f.
 *
 * Phase 1 supports:
 *   - Point forces: a force [fx, fy, fz] applied directly to a single node
 *   - Equivalent nodal forces: distributes a uniform traction over a set of
 *     nodes equally (used by the patch test to apply 1 MPa in Z over the top face)
 *
 * UNIT CONSISTENCY
 * ================
 * K has units N/mm (stiffness: force per unit displacement).
 * f has units N.
 * u = K⁻¹f has units mm.
 *
 * Forces must be in Newtons. If applying a pressure (MPa = N/mm²) over an
 * area A (mm²), the total force is P × A (N), distributed equally over the
 * face nodes.
 */

import type { PointForce, TetMesh } from "./types.js";
import { computeGeometry, c3d10ShapeFunctions, buildB_c3d10, C3D10_GAUSS } from "./element.js";
import { buildEdgeMidsideMap, buildSurfaceTriangleAdjacency } from "./adjacency.js";
import { pointTriangleDistance } from "./distance.js";

/**
 * Assemble the force vector for a list of point forces.
 * Returns a new Float64Array of length = nodeCount × 3.
 */
export function assembleForceVector(
  nodeCount:   number,
  pointForces: readonly PointForce[],
): Float64Array {
  const f = new Float64Array(nodeCount * 3);

  for (const pf of pointForces) {
    const base = pf.nodeIndex * 3;
    if (base + 2 >= nodeCount * 3) {
      throw new RangeError(
        `Force node ${pf.nodeIndex} out of range (nodeCount=${nodeCount})`
      );
    }
    f[base]     = (f[base]     ?? 0) + pf.forceN[0];
    f[base + 1] = (f[base + 1] ?? 0) + pf.forceN[1];
    f[base + 2] = (f[base + 2] ?? 0) + pf.forceN[2];
  }

  return f;
}

/**
 * Split a resultant face force EQUALLY over a set of nodes.
 *
 * totalForce [N, N, N] is the resultant on the face; each node in nodeIndices
 * gets an equal 1/N share regardless of its tributary area or shape-function
 * weight.
 *
 * NOT a consistent load: equal splitting is only the work-equivalent nodal
 * force when every node has the same tributary integral, which holds only for a
 * uniform patch of identical linear (C3D4) corner nodes. It is WRONG for a
 * C3D10 face (corners and mid-sides have different ∫N dA) and for irregular
 * tessellations. Use it ONLY for the equal-node patch-test fixture; production
 * surface loads go through assembleSurfaceTraction / assembleSurfaceTractionNormal,
 * which integrate the actual shape functions (C3D4 corner lumping, C3D10 T6).
 *
 * For the patch-test fixture:
 *   Area of top face of a 10mm cube = 100 mm²
 *   Pressure = 1 MPa = 1 N/mm²
 *   Total force = 100 N in +Z
 *   Distributed over N face nodes: each node gets 100/N N in +Z
 */
export function distributedFaceForce(
  _nodeCount:  number,
  nodeIndices: readonly number[],
  totalForce:  readonly [number, number, number],
): PointForce[] {
  if (nodeIndices.length === 0) throw new Error("distributedFaceForce: empty node list");
  const n = nodeIndices.length;
  const fx = totalForce[0] / n;
  const fy = totalForce[1] / n;
  const fz = totalForce[2] / n;

  return nodeIndices.map((ni) => ({
    nodeIndex: ni,
    forceN:    [fx, fy, fz] as const,
  }));
}

/**
 * Assemble the consistent nodal force vector for a uniform body force
 * (e.g. gravity / self-weight or a constant robot-acceleration load).
 *
 *   f_i = ∫_V N_i · b dV        (per node i, per DOF)
 *
 * where b = [bx, by, bz] is the body force PER UNIT VOLUME in N/mm³
 * (b = ρ·a: density in tonne/mm³ times acceleration in mm/s², since
 * 1 tonne·mm/s² = 1 N). Integrated exactly with the element's shape functions:
 *   - C3D4  (linear):    ∫N_i dV = V/4 for each of the 4 nodes.
 *   - C3D10 (quadratic): numerically via the same 4-point Gauss rule as the
 *                        stiffness, using the shape-function values and |detJ|.
 *
 * Returns a Float64Array of length nodeCount × 3 that can be added directly to
 * the global force vector (or converted to equivalent point forces).
 */
export function assembleBodyForce(
  mesh:      TetMesh,
  bodyForce: readonly [number, number, number],
  /**
   * Optional per-element multiplier on the body force (two-region material
   * field: scale[e] = ρ_element / ρ_average, so a part with dense walls and
   * a sparse core carries its weight where the material actually is).
   * Absent = uniform body force (legacy).
   */
  perElementScale?: Float64Array | null,
): Float64Array {
  const [bx, by, bz] = bodyForce;
  const f   = new Float64Array(mesh.nodeCount * 3);
  const npe = mesh.nodesPerElem;

  if (npe === 10) {
    const coords = new Float64Array(30);
    for (let e = 0; e < mesh.elementCount; e++) {
      const s = perElementScale ? (perElementScale[e] ?? 1) : 1;
      const base = e * 10;
      for (let i = 0; i < 10; i++) {
        const n = mesh.elements[base + i] ?? 0;
        coords[i*3]   = mesh.nodes[n*3]   ?? 0;
        coords[i*3+1] = mesh.nodes[n*3+1] ?? 0;
        coords[i*3+2] = mesh.nodes[n*3+2] ?? 0;
      }
      for (const gp of C3D10_GAUSS) {
        const { detJ } = buildB_c3d10(coords, gp.xi, gp.eta, gp.zeta);
        const N = c3d10ShapeFunctions(gp.xi, gp.eta, gp.zeta);
        const vol = Math.abs(detJ) * gp.w * s;
        for (let i = 0; i < 10; i++) {
          const n = mesh.elements[base + i] ?? 0;
          const w = (N[i] ?? 0) * vol;
          f[n*3]   = (f[n*3]   ?? 0) + bx * w;
          f[n*3+1] = (f[n*3+1] ?? 0) + by * w;
          f[n*3+2] = (f[n*3+2] ?? 0) + bz * w;
        }
      }
    }
  } else {
    for (let e = 0; e < mesh.elementCount; e++) {
      const s = perElementScale ? (perElementScale[e] ?? 1) : 1;
      const base = e * 4;
      const n0 = mesh.elements[base]   ?? 0, n1 = mesh.elements[base+1] ?? 0,
            n2 = mesh.elements[base+2] ?? 0, n3 = mesh.elements[base+3] ?? 0;
      const V = computeGeometry(mesh.nodes, n0, n1, n2, n3).V;
      const w = V / 4 * s;
      for (const n of [n0, n1, n2, n3]) {
        f[n*3]   = (f[n*3]   ?? 0) + bx * w;
        f[n*3+1] = (f[n*3+1] ?? 0) + by * w;
        f[n*3+2] = (f[n*3+2] ?? 0) + bz * w;
      }
    }
  }

  return f;
}

/**
 * Assemble consistent nodal forces for a uniform surface traction (pressure)
 * over a subset of surface triangles.
 *
 *   f_i = ∫_A N_i · t dA        (per surface node i, per DOF)
 *
 * where t = [tx, ty, tz] is the traction in N/mm² (MPa) — for a pressure P
 * along direction d, t = P·d. The boundary triangle list carries only the three
 * CORNER nodes of each face, so the consistent load depends on the element order
 * (mesh.nodesPerElem):
 *
 *   • C3D4 (linear): the face is a linear T3 triangle. ∫N_i dA = A/3 for each of
 *     the three corner shape functions, so every corner node receives t·A/3.
 *
 *   • C3D10 (quadratic): the face is a 6-node T6 triangle. The quadratic corner
 *     integral ∫N_corner dA = 0 and the mid-side integral ∫N_mid dA = A/3, so the
 *     load belongs on the three MID-SIDE nodes (t·A/3 each), NOT the corners.
 *     The mid-side node on each face edge is recovered from the edge→mid-side map
 *     (adjacency.ts) built from the parent elements. This is the true consistent
 *     load for the quadratic element and is required for the C3D10 patch test to
 *     reproduce a constant stress field near the loaded surface (issue #137). If
 *     an edge's mid-side is somehow absent (non-quadratic/inconsistent input) the
 *     triangle falls back to corner lumping so the resultant stays correct.
 *
 * Both paths integrate to the same resultant t·A per triangle.
 *
 * @param mesh     tet mesh (nodes + connectivity; element order drives the rule)
 * @param faces    surface triangles as corner-node triples [a0,b0,c0, a1,b1,c1, …]
 * @param loaded   isLoaded[t] = true → triangle t receives the traction
 * @param traction [tx, ty, tz] in N/mm² (MPa)
 * @returns Float64Array of length nodeCount × 3
 */
export function assembleSurfaceTraction(
  mesh:     TetMesh,
  faces:    Int32Array,
  loaded:   readonly boolean[],
  traction: readonly [number, number, number],
): Float64Array {
  const nodes = mesh.nodes;
  const f = new Float64Array(nodes.length);
  const [tx, ty, tz] = traction;
  const triCount = Math.floor(faces.length / 3);
  const edgeMid = buildEdgeMidsideMap(mesh);   // null for C3D4
  const N = mesh.nodeCount;
  const edgeKey = (p: number, q: number): number => (p < q ? p * N + q : q * N + p);

  for (let t = 0; t < triCount; t++) {
    if (!loaded[t]) continue;
    const a = faces[t*3] ?? 0, b = faces[t*3+1] ?? 0, c = faces[t*3+2] ?? 0;
    const ax = nodes[a*3] ?? 0, ay = nodes[a*3+1] ?? 0, az = nodes[a*3+2] ?? 0;
    const bx = nodes[b*3] ?? 0, by = nodes[b*3+1] ?? 0, bz = nodes[b*3+2] ?? 0;
    const cx = nodes[c*3] ?? 0, cy = nodes[c*3+1] ?? 0, cz = nodes[c*3+2] ?? 0;
    // Area = ½‖(b−a)×(c−a)‖
    const ux = bx-ax, uy = by-ay, uz = bz-az;
    const vx = cx-ax, vy = cy-ay, vz = cz-az;
    const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const area = 0.5 * Math.hypot(nx, ny, nz);
    const w = area / 3;

    // C3D10: load the three mid-side nodes (T6 consistent). C3D4 (or missing
    // mid-side): load the three corners (T3 consistent).
    const mab = edgeMid?.get(edgeKey(a, b));
    const mbc = edgeMid?.get(edgeKey(b, c));
    const mca = edgeMid?.get(edgeKey(c, a));
    const targets = (edgeMid && mab !== undefined && mbc !== undefined && mca !== undefined)
      ? [mab, mbc, mca]
      : [a, b, c];
    for (const n of targets) {
      f[n*3]   = (f[n*3]   ?? 0) + tx * w;
      f[n*3+1] = (f[n*3+1] ?? 0) + ty * w;
      f[n*3+2] = (f[n*3+2] ?? 0) + tz * w;
    }
  }

  return f;
}

/** Median triangle edge length over a boundary-triangle list — the mesh's own
 *  characteristic element size. Used to make the 'face' proximity band scale-
 *  and unit-relative (issue #157) instead of a fixed 0.5 mm. Returns 0 for an
 *  empty list. */
function medianTriEdgeLength(nodes: Float64Array, faces: Int32Array): number {
  const triCount = Math.floor(faces.length / 3);
  if (triCount === 0) return 0;
  const perTri = new Float64Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const a = faces[t*3]??0, b = faces[t*3+1]??0, c = faces[t*3+2]??0;
    const ax = nodes[a*3]??0, ay = nodes[a*3+1]??0, az = nodes[a*3+2]??0;
    const bx = nodes[b*3]??0, by = nodes[b*3+1]??0, bz = nodes[b*3+2]??0;
    const cx = nodes[c*3]??0, cy = nodes[c*3+1]??0, cz = nodes[c*3+2]??0;
    const eAB = Math.hypot(bx-ax, by-ay, bz-az);
    const eBC = Math.hypot(cx-bx, cy-by, cz-bz);
    const eCA = Math.hypot(ax-cx, ay-cy, az-cz);
    perTri[t] = (eAB + eBC + eCA) / 3;
  }
  perTri.sort();
  return perTri[Math.floor(triCount / 2)] ?? 0;
}

/**
 * Select which surface triangles a pressure load acts on.
 *
 *   'face'   — the extreme face toward `direction`: triangles whose centroid
 *              projects to within a SCALE-RELATIVE band (0.5 × the median
 *              boundary-edge length) of the furthest node projected onto
 *              `direction`. Deriving the band from the mesh's own element size
 *              (issue #157) means a coarse mesh no longer selects zero
 *              triangles and a fine/scaled mesh no longer captures extra rows.
 *              The extreme triangle is always included, so a valid direction on
 *              a non-empty surface can never yield an empty 'face' selection.
 *   'facing' — every triangle whose OUTWARD normal faces `direction`
 *              (normal·direction > 0), i.e. the whole windward side.
 *   'all'    — the entire exterior surface (hydrostatic / external pressure).
 *
 * Returns a boolean[] aligned with the triangles in `faces`. A zero-length
 * `direction` selects nothing for 'face'/'facing' (undefined side) but still
 * selects everything for 'all'.
 */
export function selectPressureRegion(
  nodes:     Float64Array,
  faces:     Int32Array,
  direction: readonly [number, number, number],
  region:    "face" | "facing" | "all",
): boolean[] {
  const triCount = Math.floor(faces.length / 3);
  const out: boolean[] = new Array(triCount).fill(false);
  if (region === "all") return out.fill(true);

  const [dx, dy, dz] = direction;
  const dl = Math.hypot(dx, dy, dz);
  if (!(dl > 0)) return out;   // undefined side without a direction
  const ux = dx/dl, uy = dy/dl, uz = dz/dl;

  let maxProj = -Infinity;
  // Scale-relative proximity band (issue #157): 0.5 × the median boundary-edge
  // length. On a canonical mm mesh this lands near the historical 0.5 mm; it
  // scales with the mesh so coarse meshes still capture the extreme face and
  // 10×-scaled geometry selects the same triangles.
  let band = 0;
  if (region === "face") {
    for (let n = 0; n < nodes.length / 3; n++) {
      const proj = (nodes[n*3]??0)*ux + (nodes[n*3+1]??0)*uy + (nodes[n*3+2]??0)*uz;
      if (proj > maxProj) maxProj = proj;
    }
    band = 0.5 * medianTriEdgeLength(nodes, faces);
  }
  // Track the triangle nearest the extreme, so 'face' can never come back empty
  // for a valid direction on a non-empty surface (the silent zero-load bug).
  let bestTri = -1, bestProj = -Infinity;
  for (let t = 0; t < triCount; t++) {
    const a = faces[t*3]??0, b = faces[t*3+1]??0, c = faces[t*3+2]??0;
    const ax = nodes[a*3]??0, ay = nodes[a*3+1]??0, az = nodes[a*3+2]??0;
    const bx = nodes[b*3]??0, by = nodes[b*3+1]??0, bz = nodes[b*3+2]??0;
    const cx = nodes[c*3]??0, cy = nodes[c*3+1]??0, cz = nodes[c*3+2]??0;
    const nx = (by-ay)*(cz-az)-(bz-az)*(cy-ay);
    const ny = (bz-az)*(cx-ax)-(bx-ax)*(cz-az);
    const nz = (bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
    const facing = (nx*ux + ny*uy + nz*uz) > 1e-9;
    if (region === "facing") {
      out[t] = facing;
    } else { // face
      // BOTH tests, not just the proximity band. The band alone is a slab of
      // space, so on a fine mesh it wraps around the rim onto the ADJACENT,
      // perpendicular surface: on a Ø20 cylinder loaded on its top face it
      // picked up 48 side-wall triangles (39.2 mm² on top of the true 313.3 mm²
      // disk), inflating the pressure resultant by 12%. A side wall is not part
      // of the face being loaded, and its own normal says so. Requiring the
      // triangle to face the load direction makes the selection depend on the
      // GEOMETRY rather than on how finely it happens to be meshed — the coarse
      // input triangulation only escaped this because its side facets were tall
      // enough to fall outside the band.
      if (!facing) continue;
      const proj = ((ax+bx+cx)/3)*ux + ((ay+by+cy)/3)*uy + ((az+bz+cz)/3)*uz;
      if (proj > bestProj) { bestProj = proj; bestTri = t; }
      out[t] = (maxProj - proj) <= band;
    }
  }
  // Guarantee non-emptiness for 'face': if the band caught nothing (e.g. a very
  // coarse, slightly angled face), fall back to the single extreme triangle
  // rather than silently applying no load.
  if (region === "face" && bestTri >= 0 && !out.some(Boolean)) out[bestTri] = true;
  return out;
}

/**
 * Assemble consistent nodal forces for a pressure that acts NORMAL to each
 * loaded surface triangle (a true surface-normal pressure, not a single fixed
 * direction). For each loaded triangle the traction is t = pressure · n̂, where
 * n̂ is the triangle's OUTWARD unit normal (from its winding — the surface faces
 * from TetGen, Gmsh, and `extractSurfaceFaces` are outward-oriented).
 *
 * Sign convention matches `assembleSurfaceTraction`'s caller: pass a negative
 * `pressureMPa` for an inward push (compression) and a positive value for an
 * outward pull (suction/tension). The consistent load per triangle is t·A with
 * t = pressure·n̂, distributed exactly as in `assembleSurfaceTraction`: onto the
 * three corners for C3D4 (T3) and onto the three mid-side nodes for C3D10 (T6,
 * issue #137). Each loaded node receives pressure·n/6 (= pressure·n̂·A/3).
 *
 * @param mesh        tet mesh (nodes + connectivity; element order drives the rule)
 * @param faces       surface triangles as corner-node triples [a0,b0,c0, …]
 * @param loaded      isLoaded[t] = true → triangle t receives the pressure
 * @param pressureMPa scalar pressure in N/mm² (MPa); sign per convention above
 * @returns Float64Array of length nodeCount × 3
 */
export function assembleSurfaceTractionNormal(
  mesh:        TetMesh,
  faces:       Int32Array,
  loaded:      readonly boolean[],
  pressureMPa: number,
): Float64Array {
  const nodes = mesh.nodes;
  const f = new Float64Array(nodes.length);
  const triCount = Math.floor(faces.length / 3);
  const edgeMid = buildEdgeMidsideMap(mesh);   // null for C3D4
  const N = mesh.nodeCount;
  const edgeKey = (p: number, q: number): number => (p < q ? p * N + q : q * N + p);

  for (let t = 0; t < triCount; t++) {
    if (!loaded[t]) continue;
    const a = faces[t*3] ?? 0, b = faces[t*3+1] ?? 0, c = faces[t*3+2] ?? 0;
    const ax = nodes[a*3] ?? 0, ay = nodes[a*3+1] ?? 0, az = nodes[a*3+2] ?? 0;
    const bx = nodes[b*3] ?? 0, by = nodes[b*3+1] ?? 0, bz = nodes[b*3+2] ?? 0;
    const cx = nodes[c*3] ?? 0, cy = nodes[c*3+1] ?? 0, cz = nodes[c*3+2] ?? 0;
    // n = (b−a)×(c−a); ‖n‖ = 2·area, so n̂·area = n/2 and each node gets n/2 / 3.
    const ux = bx-ax, uy = by-ay, uz = bz-az;
    const vx = cx-ax, vy = cy-ay, vz = cz-az;
    const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const mag = Math.hypot(nx, ny, nz);
    if (!(mag > 0)) continue;   // degenerate triangle
    // force per node = pressure · n̂ · (area/3) = pressure · (n/mag) · (mag/2) / 3
    //               = pressure · n / 6
    const w = pressureMPa / 6;

    // C3D10: onto the three mid-side nodes (T6). C3D4 (or missing): corners (T3).
    const mab = edgeMid?.get(edgeKey(a, b));
    const mbc = edgeMid?.get(edgeKey(b, c));
    const mca = edgeMid?.get(edgeKey(c, a));
    const targets = (edgeMid && mab !== undefined && mbc !== undefined && mca !== undefined)
      ? [mab, mbc, mca]
      : [a, b, c];
    for (const n of targets) {
      f[n*3]   = (f[n*3]   ?? 0) + nx * w;
      f[n*3+1] = (f[n*3+1] ?? 0) + ny * w;
      f[n*3+2] = (f[n*3+2] ?? 0) + nz * w;
    }
  }

  return f;
}

/**
 * Default depth of the tapered load patch, as a fraction of the part's extent
 * ALONG the load direction.
 *
 * Confidence: LOW. This is a judgement, not a measurement — no contact study
 * backs the number, and a caller who knows the real contact size should pass
 * `patchDepthMm` instead of inheriting it. It is deliberately part-relative
 * rather than mesh-relative: a mesh-relative patch would shrink under
 * refinement, which changes the load idealization from one mesh to the next
 * and is precisely the non-convergence this mode exists to remove. Being
 * part-relative also makes it scale-invariant, the property issue #168
 * established for mesh density and issue #157 for the pressure band.
 */
export const LOAD_PATCH_DEPTH_FRACTION = 0.15;

/**
 * Raised-cosine taper on s ∈ [0, 1]: 1 at the patch centre-plane, 0 at its
 * edge, with ZERO SLOPE at both ends.
 *
 * The zero slope at s = 1 is the whole point. A linear ramp still leaves a
 * kink in the traction where the patch stops, and it is the traction
 * DISCONTINUITY at a patch rim that is singular — not the patch's existence.
 */
function raisedCosineTaper(s: number): number {
  if (!(s > 0)) return 1;
  if (s >= 1) return 0;
  return 0.5 * (1 + Math.cos(Math.PI * s));
}

/**
 * Assemble consistent nodal forces for a point load SPREAD over a tapered
 * patch on the extreme face toward `direction`.
 *
 * The legacy force path selects every node within a hard 0.5 mm of the extreme
 * projection and splits the load equally between them. That has three defects
 * this replaces:
 *
 *   1. The patch has a HARD RIM — traction jumps from full to zero across one
 *      element — so the model contains a load singularity whose peak stress
 *      does not converge. Measured on the Ø5-bore tube (issue #260's
 *      de-risking sweep), the governing peak sat on that rim on every mesh and
 *      the safety factor swung 26.6% non-monotonically across a 5x element
 *      range.
 *   2. The 0.5 mm band is ABSOLUTE, so the same part at two scales gets a
 *      different load idealization (issue #271).
 *   3. Equal-split-per-node is not a consistent load: it depends on how the
 *      mesher happened to distribute nodes over the patch, not on area.
 *
 * Here the traction is w(t)·t̂ with w a raised cosine in projection depth, and
 * it is integrated with the same tributary-area rule as a surface pressure
 * (`assembleSurfaceTraction`'s T3/T6 split), then rescaled so the resultant is
 * EXACTLY the requested force. The rescale is what keeps this comparable to
 * the legacy path: same total load, different distribution.
 *
 * The patch is a SLAB — a band in the projection coordinate — not a disc,
 * because a disc needs a centre and the only candidate is `ForceSpec.position`,
 * which the force path does not read (issue #271). A slab is fully determined
 * by the direction alone, so this mode does not quietly decide #271's open
 * question. It therefore tapers the traction circumferentially but NOT where
 * the patch runs off the end of the part at a free edge; see #271.
 *
 * @param mesh        tet mesh
 * @param faces       surface triangles as corner-node triples
 * @param direction   load direction (need not be unit length)
 * @param force       total force [fx, fy, fz] in N — reproduced exactly
 * @param patchDepthMm  depth of the taper along `direction`; non-finite or
 *                      non-positive falls back to the part-relative default
 * @returns Float64Array of length nodeCount × 3, and the patch depth used
 */
export function assembleTaperedFaceLoad(
  mesh:         TetMesh,
  faces:        Int32Array,
  direction:    readonly [number, number, number],
  force:        readonly [number, number, number],
  patchDepthMm?: number,
): { forces: Float64Array; patchDepthMm: number; loadedTriangles: number } {
  const nodes = mesh.nodes;
  const [dx, dy, dz] = direction;
  const dl = Math.hypot(dx, dy, dz);
  const empty = { forces: new Float64Array(nodes.length), patchDepthMm: 0, loadedTriangles: 0 };
  if (!(dl > 0)) return empty;
  const ux = dx/dl, uy = dy/dl, uz = dz/dl;

  const triCount = Math.floor(faces.length / 3);
  if (triCount === 0) return empty;

  // Extent of the part along the load direction sets the default depth.
  let maxProj = -Infinity, minProj = Infinity;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const p = (nodes[n*3]??0)*ux + (nodes[n*3+1]??0)*uy + (nodes[n*3+2]??0)*uz;
    if (p > maxProj) maxProj = p;
    if (p < minProj) minProj = p;
  }
  const extent = maxProj - minProj;
  let depth = (patchDepthMm !== undefined && Number.isFinite(patchDepthMm) && patchDepthMm > 0)
    ? patchDepthMm
    : extent * LOAD_PATCH_DEPTH_FRACTION;
  // A degenerate part (zero extent along d) would divide by zero below. Fall
  // back to the mesh's own size rather than returning an unloaded model.
  if (!(depth > 0)) depth = medianTriEdgeLength(nodes, faces);
  if (!(depth > 0)) return empty;

  // Per-triangle taper weight from the centroid's projection depth.
  const weights = new Float64Array(triCount);
  let loadedTriangles = 0;
  for (let t = 0; t < triCount; t++) {
    const a = faces[t*3]??0, b = faces[t*3+1]??0, c = faces[t*3+2]??0;
    const cxp = ((nodes[a*3]??0) + (nodes[b*3]??0) + (nodes[c*3]??0)) / 3;
    const cyp = ((nodes[a*3+1]??0) + (nodes[b*3+1]??0) + (nodes[c*3+1]??0)) / 3;
    const czp = ((nodes[a*3+2]??0) + (nodes[b*3+2]??0) + (nodes[c*3+2]??0)) / 3;
    const proj = cxp*ux + cyp*uy + czp*uz;
    const w = raisedCosineTaper((maxProj - proj) / depth);
    weights[t] = w;
    if (w > 0) loadedTriangles++;
  }

  // Integrate w·t̂ with the tributary-area rule, using a unit traction; the
  // scale factor comes afterwards from the resultant, so the requested force is
  // reproduced exactly whatever the patch area turned out to be.
  const f = new Float64Array(nodes.length);
  const edgeMid = buildEdgeMidsideMap(mesh);   // null for C3D4
  const N = mesh.nodeCount;
  const edgeKey = (p: number, q: number): number => (p < q ? p * N + q : q * N + p);
  let areaWeighted = 0;

  for (let t = 0; t < triCount; t++) {
    const w = weights[t] ?? 0;
    if (!(w > 0)) continue;
    const a = faces[t*3] ?? 0, b = faces[t*3+1] ?? 0, c = faces[t*3+2] ?? 0;
    const ax = nodes[a*3] ?? 0, ay = nodes[a*3+1] ?? 0, az = nodes[a*3+2] ?? 0;
    const bx = nodes[b*3] ?? 0, by = nodes[b*3+1] ?? 0, bz = nodes[b*3+2] ?? 0;
    const cx = nodes[c*3] ?? 0, cy = nodes[c*3+1] ?? 0, cz = nodes[c*3+2] ?? 0;
    const vx1 = bx-ax, vy1 = by-ay, vz1 = bz-az;
    const vx2 = cx-ax, vy2 = cy-ay, vz2 = cz-az;
    const nx = vy1*vz2 - vz1*vy2, ny = vz1*vx2 - vx1*vz2, nz = vx1*vy2 - vy1*vx2;
    const area = 0.5 * Math.hypot(nx, ny, nz);
    if (!(area > 0)) continue;
    const share = (w * area) / 3;
    areaWeighted += w * area;

    const mab = edgeMid?.get(edgeKey(a, b));
    const mbc = edgeMid?.get(edgeKey(b, c));
    const mca = edgeMid?.get(edgeKey(c, a));
    const targets = (edgeMid && mab !== undefined && mbc !== undefined && mca !== undefined)
      ? [mab, mbc, mca]
      : [a, b, c];
    for (const n of targets) {
      f[n*3]   = (f[n*3]   ?? 0) + share;   // unit traction, scaled below
    }
  }

  if (!(areaWeighted > 0)) return empty;

  // Every node currently holds its ∫N_i w dA share in slot 0. Turn that into
  // the requested force vector, normalised so Σ f = `force` exactly.
  const [fx, fy, fz] = force;
  const inv = 1 / areaWeighted;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const share = (f[n*3] ?? 0) * inv;
    if (share === 0) continue;
    f[n*3]   = fx * share;
    f[n*3+1] = fy * share;
    f[n*3+2] = fz * share;
  }

  return { forces: f, patchDepthMm: depth, loadedTriangles };
}

/**
 * Default radius of the contact patch, as a fraction of the part's bounding-box
 * diagonal.
 *
 * Confidence: LOW, and this is the weakest number in the mode. It is a
 * judgement in the same sense as `SINGULARITY_PART_FRACTION`: chosen so the
 * default disc is comparable in scale to `LOAD_PATCH_DEPTH_FRACTION`'s slab on
 * a typical part (on the Ø5-bore tube, 1.77 mm against 1.80 mm) rather than
 * fitted to anything. A caller who knows the real contact size — the bolt head,
 * the pin, the pad — should pass `radiusMm` and stop inheriting a guess.
 *
 * Do not tune it to make one fixture's safety factor behave. That is the
 * calibration mistake this repo has made repeatedly; it wants parts with known
 * contact geometry, not a fixture whose answer looks nicer.
 */
export const CONTACT_PATCH_RADIUS_FRACTION = 0.10;

/**
 * Assemble consistent nodal forces for a point load spread over a contact patch
 * CENTRED AT THE APPLICATION POINT — the mode that makes `ForceSpec.position`
 * load-bearing (issue #271).
 *
 * Every other distribution mode selects its nodes from `direction` alone, so
 * moving the application point changes nothing: measured bit-identical to nine
 * decimals across four positions, including one on the opposite side of the
 * part. The client meanwhile raycasts the surface, snaps to the feature under
 * the cursor and draws an arrow there. This closes that gap.
 *
 * It also fixes what `assembleTaperedFaceLoad` structurally could not. That
 * patch is a SLAB — a band in the projection coordinate — so it tapers
 * circumferentially but runs off the end of the part at a free edge with the
 * traction still at full strength. Measured on the Ø5-bore tube (#260), the
 * governing peak moved onto exactly that run-off edge and kept growing at
 * h^-0.23. A patch that tapers in EVERY surface direction has no such edge.
 *
 * ── The patch acts on the surface the point was placed on (issue #305) ───────
 *
 * The eligible surface is the one CONTAINING the application point — the patch
 * is grown by EDGE ADJACENCY from the triangle nearest the centre, admitting
 * neighbours while they are inside the radius. `direction` selects nothing.
 *
 * It used to select windward triangles (n·d > 0), and that is wrong for the
 * load this mode is named after. A contact PUSHES: at the surface it presses
 * on, the force points INTO the material, so n·d < 0 there. The windward test
 * therefore made the surface under the user's arrow ineligible on every
 * compressive load and left only the far side of the part, a full thickness
 * away — outside the radius, so the taper selected nothing and the
 * "patch fell between the triangles" fallback below put the ENTIRE force on one
 * arbitrarily-chosen triangle of the opposite face. Measured on the #296 bar,
 * 120 N in -z placed on the top face: 1 triangle, on z = 0, chosen by index
 * among tied candidates — which is where #305's 5.04% mirror asymmetry came
 * from, and why it survived on a mesh with 100% centroid pairing.
 *
 * Both signs are legitimate and neither changes the patch: a nodal force set is
 * one either way, and whether it is contact or a bolted pad in tension is the
 * sign of `force`, not a property of the surface. What must not happen is the
 * patch reaching THROUGH the part onto the far face — a 3-D ball centred on a
 * thin part's top face trivially does, and the load would then act on a surface
 * it never touched. Edge adjacency is what stops it: the far face is not
 * edge-connected to the near one except around the part's rim, so it is
 * excluded exactly when the rim is further away than the patch radius, and
 * included exactly when the contact really does wrap an edge. A normal-based
 * test (same-side-as-the-anchor, or a signed plane offset) needs a tolerance
 * that cannot be right for both a thin plate and a tight bore; adjacency needs
 * none. Distance within the patch is still Euclidean, not geodesic — on a
 * contact-sized patch that difference is second-order.
 *
 * Two guards worth knowing about:
 *
 *   • The centre is SNAPPED to the nearest triangle when it does not land on
 *     one — a raycast hit carries float error, and a caller may send a point
 *     that is off the surface entirely. The snap distance is returned so the
 *     caller can say so out loud. A silent zero-load solve is the failure mode
 *     issue #157 was about; this never returns one for a non-degenerate input.
 *   • When the patch falls between the triangles (a radius below the local mesh
 *     size), the nearest triangle carries the load — together with every
 *     triangle TIED with it, so a symmetric part loaded on its symmetry plane
 *     stays symmetric instead of resolving the tie by triangle index.
 *
 * @param mesh      tet mesh
 * @param faces     surface triangles as corner-node triples
 * @param direction load direction (need not be unit length)
 * @param force     total force [fx, fy, fz] in N — reproduced exactly
 * @param centre    application point in the same frame as `mesh.nodes` (mm)
 * @param radiusMm  contact radius; non-finite or non-positive → part-relative default
 */
export function assembleContactPatchLoad(
  mesh:      TetMesh,
  faces:     Int32Array,
  direction: readonly [number, number, number],
  force:     readonly [number, number, number],
  centre:    readonly [number, number, number],
  radiusMm?: number,
): { forces: Float64Array; radiusMm: number; loadedTriangles: number; centreSnapMm: number } {
  const nodes = mesh.nodes;
  const [dx, dy, dz] = direction;
  const dl = Math.hypot(dx, dy, dz);
  const empty = { forces: new Float64Array(nodes.length), radiusMm: 0, loadedTriangles: 0, centreSnapMm: 0 };
  // A zero direction is a degenerate force spec, not a load: reject it here
  // rather than assembling a patch for a force with no line of action. The
  // direction plays no part in choosing the patch (see the header) — `force`
  // already carries it, and its sign is what makes the patch contact or tension.
  if (!(dl > 0)) return empty;

  const triCount = Math.floor(faces.length / 3);
  if (triCount === 0) return empty;
  if (!centre.every(v => Number.isFinite(v))) return empty;

  // Triangle centroids and areas, cached — every step below needs both and the
  // surface is walked several times otherwise.
  const cx = new Float64Array(triCount), cy = new Float64Array(triCount), cz = new Float64Array(triCount);
  const area = new Float64Array(triCount);
  let mnX = Infinity, mnY = Infinity, mnZ = Infinity;
  let mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const x = nodes[n*3] ?? 0, y = nodes[n*3+1] ?? 0, z = nodes[n*3+2] ?? 0;
    if (x < mnX) mnX = x; if (x > mxX) mxX = x;
    if (y < mnY) mnY = y; if (y > mxY) mxY = y;
    if (z < mnZ) mnZ = z; if (z > mxZ) mxZ = z;
  }
  for (let t = 0; t < triCount; t++) {
    const a = faces[t*3] ?? 0, b = faces[t*3+1] ?? 0, c = faces[t*3+2] ?? 0;
    const ax = nodes[a*3] ?? 0, ay = nodes[a*3+1] ?? 0, az = nodes[a*3+2] ?? 0;
    const bx = nodes[b*3] ?? 0, by = nodes[b*3+1] ?? 0, bz = nodes[b*3+2] ?? 0;
    const ccx = nodes[c*3] ?? 0, ccy = nodes[c*3+1] ?? 0, ccz = nodes[c*3+2] ?? 0;
    cx[t] = (ax + bx + ccx) / 3; cy[t] = (ay + by + ccy) / 3; cz[t] = (az + bz + ccz) / 3;
    const vx1 = bx-ax, vy1 = by-ay, vz1 = bz-az;
    const vx2 = ccx-ax, vy2 = ccy-ay, vz2 = ccz-az;
    const nx = vy1*vz2 - vz1*vy2, ny = vz1*vx2 - vx1*vz2, nz = vx1*vy2 - vy1*vx2;
    area[t] = 0.5 * Math.hypot(nx, ny, nz);
  }

  const diag = Math.sqrt((mxX-mnX)**2 + (mxY-mnY)**2 + (mxZ-mnZ)**2);
  let radius = (radiusMm !== undefined && Number.isFinite(radiusMm) && radiusMm > 0)
    ? radiusMm
    : diag * CONTACT_PATCH_RADIUS_FRACTION;
  if (!(radius > 0)) radius = medianTriEdgeLength(nodes, faces);
  if (!(radius > 0)) return empty;

  // Snap the centre onto the surface. A raycast hit is already there to within
  // float error, so this is normally a no-op; it matters when the caller sends
  // a point that is off the surface entirely.
  //
  // POINT-TO-TRIANGLE, not point-to-centroid: a centroid distance is an alias
  // for the mesh's element size, so a point sitting exactly on a coarse face
  // reports itself half an element off the surface (measured 2.24 mm on the
  // #305 bar, against a 2.75 mm patch radius) — and `analysis.ts` warns the
  // user when this number exceeds the radius. Same aliasing the two-region
  // distance field had to avoid (CLAUDE.md, two-region invariant 4).
  const dTri = new Float64Array(triCount);
  let bestTri = -1, bestD = Infinity;
  for (let t = 0; t < triCount; t++) {
    if (!(area[t]! > 0)) { dTri[t] = Infinity; continue; }
    const a = faces[t*3] ?? 0, b = faces[t*3+1] ?? 0, c = faces[t*3+2] ?? 0;
    const d = pointTriangleDistance(
      centre[0], centre[1], centre[2],
      nodes[a*3] ?? 0, nodes[a*3+1] ?? 0, nodes[a*3+2] ?? 0,
      nodes[b*3] ?? 0, nodes[b*3+1] ?? 0, nodes[b*3+2] ?? 0,
      nodes[c*3] ?? 0, nodes[c*3+1] ?? 0, nodes[c*3+2] ?? 0,
    );
    dTri[t] = d;
    if (d < bestD) { bestD = d; bestTri = t; }
  }
  if (bestTri < 0) return empty;   // no non-degenerate surface triangle at all

  // Grow the patch from the seed by EDGE ADJACENCY, admitting a neighbour while
  // it is inside the radius (issue #305). The reached set is the connected
  // component of the disc that contains the seed, so it is independent of the
  // traversal order and therefore of triangle numbering — the property a
  // mirror-symmetric part needs. Taper about the REQUESTED point, not the
  // snapped one: snapping exists to guarantee a non-empty patch, not to move
  // the load the user placed.
  const weights = new Float64Array(triCount);
  let loadedTriangles = 0, areaWeighted = 0;
  const dOf = (t: number): number =>
    Math.hypot(cx[t]!-centre[0], cy[t]!-centre[1], cz[t]!-centre[2]);
  if (dOf(bestTri) < radius) {
    const { ptr, list } = buildSurfaceTriangleAdjacency(faces, mesh.nodeCount);
    const seen = new Uint8Array(triCount);
    const stack: number[] = [bestTri];
    seen[bestTri] = 1;
    while (stack.length > 0) {
      const t = stack.pop()!;
      const w = raisedCosineTaper(dOf(t) / radius);
      if (w > 0 && area[t]! > 0) { weights[t] = w; loadedTriangles++; areaWeighted += w * area[t]!; }
      for (let k = ptr[t] ?? 0; k < (ptr[t+1] ?? 0); k++) {
        const u = list[k] ?? 0;
        if (seen[u]) continue;
        if (!(area[u]! > 0) || !(dOf(u) < radius)) continue;
        seen[u] = 1;
        stack.push(u);
      }
    }
  }
  // The patch fell between the triangles (radius smaller than the local mesh,
  // or the centre off the surface). Load the nearest triangle rather than
  // returning an unloaded model presented as a normal result — TOGETHER WITH
  // every triangle tied with it, because resolving a tie by index is how a
  // symmetric part acquired an asymmetric load in #305.
  if (!(areaWeighted > 0)) {
    const tie = bestD * (1 + 1e-12) + 1e-12;
    loadedTriangles = 0;
    areaWeighted = 0;
    for (let t = 0; t < triCount; t++) {
      if (!(area[t]! > 0) || (dTri[t] ?? Infinity) > tie) continue;
      weights[t] = 1;
      loadedTriangles++;
      areaWeighted += area[t]!;
    }
    if (!(areaWeighted > 0)) return empty;
  }

  const f = new Float64Array(nodes.length);
  const edgeMid = buildEdgeMidsideMap(mesh);   // null for C3D4
  const N = mesh.nodeCount;
  const edgeKey = (p: number, q: number): number => (p < q ? p * N + q : q * N + p);
  for (let t = 0; t < triCount; t++) {
    const w = weights[t] ?? 0;
    if (!(w > 0)) continue;
    const a = faces[t*3] ?? 0, b = faces[t*3+1] ?? 0, c = faces[t*3+2] ?? 0;
    const share = (w * (area[t] ?? 0)) / 3;
    const mab = edgeMid?.get(edgeKey(a, b));
    const mbc = edgeMid?.get(edgeKey(b, c));
    const mca = edgeMid?.get(edgeKey(c, a));
    const targets = (edgeMid && mab !== undefined && mbc !== undefined && mca !== undefined)
      ? [mab, mbc, mca]
      : [a, b, c];
    for (const n of targets) f[n*3] = (f[n*3] ?? 0) + share;
  }

  const [fx, fy, fz] = force;
  const inv = 1 / areaWeighted;
  for (let n = 0; n < mesh.nodeCount; n++) {
    const share = (f[n*3] ?? 0) * inv;
    if (share === 0) continue;
    f[n*3]   = fx * share;
    f[n*3+1] = fy * share;
    f[n*3+2] = fz * share;
  }

  return { forces: f, radiusMm: radius, loadedTriangles, centreSnapMm: bestD };
}
