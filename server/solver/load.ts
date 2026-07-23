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
import { buildEdgeMidsideMap } from "./adjacency.js";

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

/**
 * Select which surface triangles a pressure load acts on.
 *
 *   'face'   — the extreme face toward `direction`: triangles whose centroid is
 *              within 0.5 mm of the furthest node projected onto `direction`.
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
  if (region === "face") {
    for (let n = 0; n < nodes.length / 3; n++) {
      const proj = (nodes[n*3]??0)*ux + (nodes[n*3+1]??0)*uy + (nodes[n*3+2]??0)*uz;
      if (proj > maxProj) maxProj = proj;
    }
  }
  for (let t = 0; t < triCount; t++) {
    const a = faces[t*3]??0, b = faces[t*3+1]??0, c = faces[t*3+2]??0;
    const ax = nodes[a*3]??0, ay = nodes[a*3+1]??0, az = nodes[a*3+2]??0;
    const bx = nodes[b*3]??0, by = nodes[b*3+1]??0, bz = nodes[b*3+2]??0;
    const cx = nodes[c*3]??0, cy = nodes[c*3+1]??0, cz = nodes[c*3+2]??0;
    if (region === "facing") {
      const nx = (by-ay)*(cz-az)-(bz-az)*(cy-ay);
      const ny = (bz-az)*(cx-ax)-(bx-ax)*(cz-az);
      const nz = (bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
      out[t] = (nx*ux + ny*uy + nz*uz) > 1e-9;
    } else { // face
      const proj = ((ax+bx+cx)/3)*ux + ((ay+by+cy)/3)*uy + ((az+bz+cz)/3)*uz;
      out[t] = (maxProj - proj) < 0.5;
    }
  }
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
