/**
 * b-matrix-sign.test.ts
 * ---------------------
 * Regression test for a sign error in the C3D4 shape-function derivative
 * coefficients (computeGeometry, server/solver/element.ts), found while
 * writing the issue #97 verdict test.
 *
 * The γ (∂N/∂y) cofactor signs were [-,+,-,+] — a copy of the β/δ pattern —
 * instead of the correct [+,-,+,-] (the y column of the 4×4 coordinate matrix
 * sits between x and z, shifting the cofactor sign alternation by one). Every
 * ∂N/∂y was negated.
 *
 * Why the validation suite never caught it: the same B is used for assembly
 * and stress recovery. Flipping all γ is equivalent to conjugating K by the
 * DOF reflection P (u_y → −u_y): K_wrong = P·K·P, because the strain
 * reflection D = diag(1,1,1,−1,−1,1) satisfies D·C·D = C for every
 * block-diagonal C used here. For loads with no y component (or only y
 * components), the computed u_x/u_z and all stress invariants are exactly
 * correct; only mixed-direction loads and externally imposed strain fields
 * expose the bug. The C3D10 path (isoparametric, Jacobian-based) never had
 * the error — so C3D4 and C3D10 disagreed on mixed loads.
 */

import { describe, it, expect } from "vitest";
import { computeGeometry, buildB } from "../../solver/element.js";
import { generateBoxMesh } from "../../solver/meshgen.js";

describe("C3D4 shape-function derivatives (γ sign regression)", () => {
  it("canonical tet: ∇N matches the analytic shape functions", () => {
    // Tet (0,0,0)=n3 ordering per node list below:
    // nodes: n0=(1,0,0), n1=(0,1,0), n2=(0,0,1), n3=(0,0,0), 6V = 1... build:
    const nodes = new Float64Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
      0, 0, 0,
    ]);
    const geom = computeGeometry(nodes, 0, 1, 2, 3);
    const inv6V = 1 / (6 * geom.V);
    // Shape functions: N0 = x, N1 = y, N2 = z, N3 = 1−x−y−z
    // ∂N/∂x = [1, 0, 0, −1], ∂N/∂y = [0, 1, 0, −1], ∂N/∂z = [0, 0, 1, −1]
    const dNdx = geom.beta.map(v => v * inv6V);
    const dNdy = geom.gamma.map(v => v * inv6V);
    const dNdz = geom.delta.map(v => v * inv6V);
    expect(dNdx).toEqual([1, 0, 0, -1].map(v => expect.closeTo(v, 10)));
    expect(dNdy).toEqual([0, 1, 0, -1].map(v => expect.closeTo(v, 10)));
    expect(dNdz).toEqual([0, 0, 1, -1].map(v => expect.closeTo(v, 10)));
  });

  it("every element of a box mesh reproduces all six unit strain fields exactly", () => {
    const mesh = generateBoxMesh(0, 0, 0, 10, 10, 10, 3, 3, 3);
    // Linear displacement fields and their exact Voigt strains
    const fields: Array<{ f: (x: number, y: number, z: number) => [number, number, number]; eps: number[] }> = [
      { f: (x) => [x, 0, 0],       eps: [1, 0, 0, 0, 0, 0] },
      { f: (_x, y) => [0, y, 0],   eps: [0, 1, 0, 0, 0, 0] },  // ← failed before the fix (−1)
      { f: (_x, _y, z) => [0, 0, z], eps: [0, 0, 1, 0, 0, 0] },
      { f: (_x, y) => [y, 0, 0],   eps: [0, 0, 0, 1, 0, 0] },  // γxy — failed before the fix
      { f: (_x, _y, z) => [0, z, 0], eps: [0, 0, 0, 0, 1, 0] },  // γyz — failed before the fix
      { f: (_x, _y, z) => [z, 0, 0], eps: [0, 0, 0, 0, 0, 1] },
    ];
    for (let e = 0; e < mesh.elementCount; e++) {
      const ns = [0, 1, 2, 3].map(i => mesh.elements[e * 4 + i]!);
      const geom = computeGeometry(mesh.nodes, ns[0]!, ns[1]!, ns[2]!, ns[3]!);
      const B = buildB(geom);
      for (const { f, eps } of fields) {
        const ue: number[] = [];
        for (const n of ns) {
          ue.push(...f(mesh.nodes[n * 3]!, mesh.nodes[n * 3 + 1]!, mesh.nodes[n * 3 + 2]!));
        }
        for (let r = 0; r < 6; r++) {
          let s = 0;
          for (let c = 0; c < 12; c++) s += B[r * 12 + c]! * ue[c]!;
          expect(s).toBeCloseTo(eps[r]!, 9);
        }
      }
    }
  });
});
