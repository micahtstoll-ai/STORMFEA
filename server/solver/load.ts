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
): Float64Array {
  const [bx, by, bz] = bodyForce;
  const f   = new Float64Array(mesh.nodeCount * 3);
  const npe = mesh.nodesPerElem;

  if (npe === 10) {
    const coords = new Float64Array(30);
    for (let e = 0; e < mesh.elementCount; e++) {
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
        const vol = Math.abs(detJ) * gp.w;
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
      const base = e * 4;
      const n0 = mesh.elements[base]   ?? 0, n1 = mesh.elements[base+1] ?? 0,
            n2 = mesh.elements[base+2] ?? 0, n3 = mesh.elements[base+3] ?? 0;
      const V = computeGeometry(mesh.nodes, n0, n1, n2, n3).V;
      const w = V / 4;
      for (const n of [n0, n1, n2, n3]) {
        f[n*3]   = (f[n*3]   ?? 0) + bx * w;
        f[n*3+1] = (f[n*3+1] ?? 0) + by * w;
        f[n*3+2] = (f[n*3+2] ?? 0) + bz * w;
      }
    }
  }

  return f;
}
