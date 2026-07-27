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
 * Distribute a uniform traction over a set of nodes as equivalent nodal forces.
 *
 * totalForce [N, N, N] is the resultant force on the face.
 * It is split equally among all nodes in nodeIndices.
 *
 * For the patch test:
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
 * along direction d, t = P·d. Over a triangle of area A the integral of each
 * linear corner shape function is A/3, so each of the three corner nodes
 * receives t·A/3 (tributary-area lumping). For C3D10 surface faces only the
 * corner nodes are available from the boundary triangle list, so the load is
 * lumped on corners — the standard, safe consistent-load approximation while
 * the interior solve stays fully quadratic.
 *
 * @param nodes    mesh node coordinates [x0,y0,z0, …]
 * @param faces    surface triangles as node triples [a0,b0,c0, a1,b1,c1, …]
 * @param loaded   isLoaded[t] = true → triangle t receives the traction
 * @param traction [tx, ty, tz] in N/mm² (MPa)
 * @returns Float64Array of length nodeCount × 3
 */
export function assembleSurfaceTraction(
  nodes:    Float64Array,
  faces:    Int32Array,
  loaded:   readonly boolean[],
  traction: readonly [number, number, number],
): Float64Array {
  const f = new Float64Array(nodes.length);
  const [tx, ty, tz] = traction;
  const triCount = Math.floor(faces.length / 3);

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
    for (const n of [a, b, c]) {
      f[n*3]   = (f[n*3]   ?? 0) + tx * w;
      f[n*3+1] = (f[n*3+1] ?? 0) + ty * w;
      f[n*3+2] = (f[n*3+2] ?? 0) + tz * w;
    }
  }

  return f;
}

/**
 * Result of {@link selectPressureRegionDetailed}: the per-triangle mask plus the
 * verifiable metadata a caller needs to sanity-check a pressure load — the
 * number of loaded triangles and their total area, so `|resultant| = P·area`
 * (a uniform or normal traction over the selection) can be checked directly.
 */
export interface PressureRegionSelection {
  /** isLoaded[t] = true → triangle t receives the traction. */
  loaded:              boolean[];
  /** Count of selected triangles. */
  loadedTriangleCount: number;
  /** Total surface area of the selected triangles, in mm². */
  areaMm2:             number;
}

/**
 * Select which surface triangles a pressure load acts on, returning the mask
 * plus verifiable area metadata.
 *
 *   'face'   — the extreme face toward `direction`. SCALE-AWARE: seeded at the
 *              triangle furthest along `direction` (whose outward normal faces
 *              it) and grown by connectivity flood-fill to every edge-connected,
 *              near-coplanar triangle. This selects the whole planar face
 *              exactly, independent of element size — fixing the old fixed
 *              0.5 mm projection band, which selected ZERO triangles on a coarse
 *              or angled face (a silent no-load solve) and extra fringe layers
 *              on a fine one (issue #156).
 *   'facing' — every triangle whose OUTWARD normal faces `direction`
 *              (normal·direction > 0), i.e. the whole windward side.
 *   'all'    — the entire exterior surface (hydrostatic / external pressure).
 *
 * A zero-length `direction` selects nothing for 'face'/'facing' (undefined side)
 * but still selects everything for 'all'. When a direction IS given, an EMPTY
 * 'face'/'facing' selection THROWS rather than returning a silent no-load mask.
 */
export function selectPressureRegionDetailed(
  nodes:     Float64Array,
  faces:     Int32Array,
  direction: readonly [number, number, number],
  region:    "face" | "facing" | "all",
): PressureRegionSelection {
  const triCount = Math.floor(faces.length / 3);
  const loaded: boolean[] = new Array(triCount).fill(false);

  // Per-triangle area (½‖(b−a)×(c−a)‖). Cheap helper reused below.
  const triArea = (t: number): number => {
    const a = faces[t*3]??0, b = faces[t*3+1]??0, c = faces[t*3+2]??0;
    const ax = nodes[a*3]??0, ay = nodes[a*3+1]??0, az = nodes[a*3+2]??0;
    const bx = nodes[b*3]??0, by = nodes[b*3+1]??0, bz = nodes[b*3+2]??0;
    const cx = nodes[c*3]??0, cy = nodes[c*3+1]??0, cz = nodes[c*3+2]??0;
    const nx = (by-ay)*(cz-az)-(bz-az)*(cy-ay);
    const ny = (bz-az)*(cx-ax)-(bx-ax)*(cz-az);
    const nz = (bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
    return 0.5 * Math.hypot(nx, ny, nz);
  };
  const sumArea = (): number => {
    let s = 0;
    for (let t = 0; t < triCount; t++) if (loaded[t]) s += triArea(t);
    return s;
  };
  const finish = (): PressureRegionSelection => {
    let count = 0;
    for (let t = 0; t < triCount; t++) if (loaded[t]) count++;
    return { loaded, loadedTriangleCount: count, areaMm2: sumArea() };
  };

  if (region === "all") {
    loaded.fill(true);
    return finish();
  }

  const [dx, dy, dz] = direction;
  const dl = Math.hypot(dx, dy, dz);
  if (!(dl > 0)) return finish();   // undefined side without a direction (empty)
  const ux = dx/dl, uy = dy/dl, uz = dz/dl;

  // Unit outward normal of triangle t (or null for a degenerate triangle).
  const triUnitNormal = (t: number): [number, number, number] | null => {
    const a = faces[t*3]??0, b = faces[t*3+1]??0, c = faces[t*3+2]??0;
    const ax = nodes[a*3]??0, ay = nodes[a*3+1]??0, az = nodes[a*3+2]??0;
    const bx = nodes[b*3]??0, by = nodes[b*3+1]??0, bz = nodes[b*3+2]??0;
    const cx = nodes[c*3]??0, cy = nodes[c*3+1]??0, cz = nodes[c*3+2]??0;
    const nx = (by-ay)*(cz-az)-(bz-az)*(cy-ay);
    const ny = (bz-az)*(cx-ax)-(bx-ax)*(cz-az);
    const nz = (bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
    const m = Math.hypot(nx, ny, nz);
    return m > 0 ? [nx/m, ny/m, nz/m] : null;
  };

  if (region === "facing") {
    for (let t = 0; t < triCount; t++) {
      const n = triUnitNormal(t);
      if (n && (n[0]*ux + n[1]*uy + n[2]*uz) > 1e-9) loaded[t] = true;
    }
    const res = finish();
    if (res.loadedTriangleCount === 0) {
      throw new Error(
        `selectPressureRegion 'facing': no surface triangle faces direction ` +
        `(${ux.toFixed(3)}, ${uy.toFixed(3)}, ${uz.toFixed(3)}). The mesh may be ` +
        `degenerate or the direction ill-defined — refusing a silent no-load solve.`,
      );
    }
    return res;
  }

  // ── region === "face": connectivity flood-fill of the extreme coplanar face ──
  // Seed = the forward-facing triangle furthest along `direction`.
  let seed = -1, seedProj = -Infinity;
  for (let t = 0; t < triCount; t++) {
    const n = triUnitNormal(t);
    if (!n || (n[0]*ux + n[1]*uy + n[2]*uz) <= 1e-9) continue;   // skip degenerate / back faces
    const a = faces[t*3]??0, b = faces[t*3+1]??0, c = faces[t*3+2]??0;
    const proj =
      (((nodes[a*3]??0)+(nodes[b*3]??0)+(nodes[c*3]??0))/3)*ux +
      (((nodes[a*3+1]??0)+(nodes[b*3+1]??0)+(nodes[c*3+1]??0))/3)*uy +
      (((nodes[a*3+2]??0)+(nodes[b*3+2]??0)+(nodes[c*3+2]??0))/3)*uz;
    if (proj > seedProj) { seedProj = proj; seed = t; }
  }
  if (seed < 0) {
    throw new Error(
      `selectPressureRegion 'face': no surface triangle faces direction ` +
      `(${ux.toFixed(3)}, ${uy.toFixed(3)}, ${uz.toFixed(3)}) — cannot locate an ` +
      `extreme face. The mesh may be empty or degenerate; refusing a silent no-load solve.`,
    );
  }

  // Edge → adjacent-triangle map (shared undirected edge = two shared corners).
  const N = nodes.length / 3;
  const edgeKey = (p: number, q: number): number => (p < q ? p * N + q : q * N + p);
  const edgeToTris = new Map<number, number[]>();
  for (let t = 0; t < triCount; t++) {
    const a = faces[t*3]??0, b = faces[t*3+1]??0, c = faces[t*3+2]??0;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const k = edgeKey(p, q);
      const lst = edgeToTris.get(k);
      if (lst) lst.push(t); else edgeToTris.set(k, [t]);
    }
  }

  // Grow the coplanar patch: include an edge-neighbour whose unit normal is
  // within ~25° of the seed normal (same planar face; sides/curvature stop it).
  const COS_TOL = 0.9;
  const seedN = triUnitNormal(seed)!;
  const stack = [seed];
  loaded[seed] = true;
  while (stack.length > 0) {
    const t = stack.pop()!;
    const a = faces[t*3]??0, b = faces[t*3+1]??0, c = faces[t*3+2]??0;
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const neigh = edgeToTris.get(edgeKey(p, q));
      if (!neigh) continue;
      for (const nt of neigh) {
        if (nt === t || loaded[nt]) continue;
        const nn = triUnitNormal(nt);
        if (nn && (nn[0]*seedN[0] + nn[1]*seedN[1] + nn[2]*seedN[2]) >= COS_TOL) {
          loaded[nt] = true;
          stack.push(nt);
        }
      }
    }
  }

  const res = finish();
  if (res.loadedTriangleCount === 0) {
    // Unreachable in practice (the seed is always selected), but assert anyway
    // so an empty 'face' selection can never become a silent no-load solve.
    throw new Error(
      `selectPressureRegion 'face': selection is empty for direction ` +
      `(${ux.toFixed(3)}, ${uy.toFixed(3)}, ${uz.toFixed(3)}).`,
    );
  }
  return res;
}

/**
 * Backwards-compatible mask-only wrapper around {@link selectPressureRegionDetailed}.
 * Returns a boolean[] aligned with the triangles in `faces`.
 */
export function selectPressureRegion(
  nodes:     Float64Array,
  faces:     Int32Array,
  direction: readonly [number, number, number],
  region:    "face" | "facing" | "all",
): boolean[] {
  return selectPressureRegionDetailed(nodes, faces, direction, region).loaded;
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
 * outward pull (suction/tension). Each of the three corner nodes receives
 * t·A/3 (tributary-area lumping), identical to the uniform assembler.
 *
 * @param nodes       mesh node coordinates [x0,y0,z0, …]
 * @param faces       surface triangles as node triples [a0,b0,c0, …]
 * @param loaded      isLoaded[t] = true → triangle t receives the pressure
 * @param pressureMPa scalar pressure in N/mm² (MPa); sign per convention above
 * @returns Float64Array of length nodeCount × 3
 */
export function assembleSurfaceTractionNormal(
  nodes:       Float64Array,
  faces:       Int32Array,
  loaded:      readonly boolean[],
  pressureMPa: number,
): Float64Array {
  const f = new Float64Array(nodes.length);
  const triCount = Math.floor(faces.length / 3);

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
    for (const n of [a, b, c]) {
      f[n*3]   = (f[n*3]   ?? 0) + nx * w;
      f[n*3+1] = (f[n*3+1] ?? 0) + ny * w;
      f[n*3+2] = (f[n*3+2] ?? 0) + nz * w;
    }
  }

  return f;
}
