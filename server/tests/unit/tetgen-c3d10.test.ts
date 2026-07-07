/**
 * tetgen-c3d10.test.ts
 * --------------------
 * Regression test pinning the TetGen -o2 → STORMFEA C3D10 midnode permutation
 * (C3D10_REORDER in server/tetgen.ts).
 *
 * TetGen 1.5 emits the six edge-midpoint nodes of each 10-node tet in the
 * order mid(2,3), mid(0,3), mid(0,1), mid(1,2), mid(1,3), mid(0,2) — verified
 * empirically against TetGen 1.5.1-beta1. STORMFEA's element.ts expects the
 * standard C3D10 order mid(0,1), mid(1,2), mid(0,2), mid(0,3), mid(1,3),
 * mid(2,3). If C3D10_REORDER ever regresses, the midpoint assertions below
 * fail immediately.
 *
 * These are integration tests that require a real tetgen binary. The binary
 * is located via the usual search in tetgen.ts (TETGEN_BIN env var, next to
 * the compiled file, PATH). Without one the suite is skipped so CI stays
 * green:
 *
 *   TETGEN_BIN=/path/to/tetgen npx vitest run server/tests/unit/tetgen-c3d10.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { meshWithTetGen, probeTetGen, type TetGenResult } from '../../tetgen.js';
import {
  buildB_c3d10,
  c3d10ElementStiffness,
  buildConstitutiveMatrix,
} from '../../solver/element.js';

const probe = await probeTetGen();
if (!probe.found) {
  // eslint-disable-next-line no-console
  console.warn(
    'SKIP: tetgen not found (searched TETGEN_BIN env var, module directory, PATH) — ' +
    'skipping TetGen C3D10 midnode-ordering integration tests',
  );
}

// ─── Test geometry: unit cube as an STL-style triangle soup ──────────────────
// 8 corners, 12 triangles, outward-consistent winding. Same topology as the
// OFF files used for the original empirical verification.
const CUBE_VERTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
const CUBE_TRIS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 2, 1], [0, 3, 2],   // bottom (z=0)
  [4, 5, 6], [4, 6, 7],   // top    (z=1)
  [0, 1, 5], [0, 5, 4],   // y=0
  [1, 2, 6], [1, 6, 5],   // x=1
  [2, 3, 7], [2, 7, 6],   // y=1
  [3, 0, 4], [3, 4, 7],   // x=0
];

function cubeTriangleSoup(): { positions: Float32Array; triangleCount: number } {
  const positions = new Float32Array(CUBE_TRIS.length * 9);
  CUBE_TRIS.forEach(([a, b, c], t) => {
    [a, b, c].forEach((vi, k) => {
      const v = CUBE_VERTS[vi]!;
      positions[t * 9 + k * 3]     = v[0];
      positions[t * 9 + k * 3 + 1] = v[1];
      positions[t * 9 + k * 3 + 2] = v[2];
    });
  });
  return { positions, triangleCount: CUBE_TRIS.length };
}

// STORMFEA C3D10 midnode convention (element.ts c3d10ShapeFunctions):
// slot 4=mid(0,1), 5=mid(1,2), 6=mid(0,2), 7=mid(0,3), 8=mid(1,3), 9=mid(2,3)
const MIDNODE_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [1, 2], [0, 2], [0, 3], [1, 3], [2, 3],
];

// 4-point Gauss rule used by element.ts for C3D10 (same barycentric points).
const GAUSS_POINTS = [
  { xi: 0.1381966, eta: 0.1381966, zeta: 0.1381966 },
  { xi: 0.5854102, eta: 0.1381966, zeta: 0.1381966 },
  { xi: 0.1381966, eta: 0.5854102, zeta: 0.1381966 },
  { xi: 0.1381966, eta: 0.1381966, zeta: 0.5854102 },
] as const;

function elementNodeCoords(mesh: TetGenResult['mesh'], e: number): Float64Array {
  const coords = new Float64Array(10 * 3);
  for (let k = 0; k < 10; k++) {
    const n = mesh.elements[e * 10 + k]!;
    coords[k * 3]     = mesh.nodes[n * 3]!;
    coords[k * 3 + 1] = mesh.nodes[n * 3 + 1]!;
    coords[k * 3 + 2] = mesh.nodes[n * 3 + 2]!;
  }
  return coords;
}

/** Volume of the corner tet (nodes 0–3) of a C3D10 element. */
function cornerTetVolume(coords: Float64Array): number {
  const d = (i: number, j: number, a: number) => coords[i * 3 + a]! - coords[j * 3 + a]!;
  const ax = d(1, 0, 0), ay = d(1, 0, 1), az = d(1, 0, 2);
  const bx = d(2, 0, 0), by = d(2, 0, 1), bz = d(2, 0, 2);
  const cx = d(3, 0, 0), cy = d(3, 0, 1), cz = d(3, 0, 2);
  const det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  return Math.abs(det) / 6;
}

describe.skipIf(!probe.found)('TetGen -o2 → C3D10 midnode ordering (requires tetgen binary)', () => {
  let result: TetGenResult;

  beforeAll(async () => {
    const { positions, triangleCount } = cubeTriangleSoup();
    result = await meshWithTetGen(positions, triangleCount, 2);
  }, 120_000);

  it('produces 10-node elements with in-range node indices', () => {
    const { mesh } = result;
    expect(mesh.nodesPerElem).toBe(10);
    expect(mesh.elementCount).toBeGreaterThan(0);
    expect(mesh.elements.length).toBe(mesh.elementCount * 10);
    for (const n of mesh.elements) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(mesh.nodeCount);
    }
  });

  it('every midnode equals the midpoint of its expected corner pair (pins C3D10_REORDER)', () => {
    const { mesh } = result;
    const TOL = 1e-9; // corners are exact 0/1 floats; midpoints are exact 0.5s
    for (let e = 0; e < mesh.elementCount; e++) {
      const coords = elementNodeCoords(mesh, e);
      for (let slot = 4; slot < 10; slot++) {
        const [a, b] = MIDNODE_EDGES[slot - 4]!;
        for (let axis = 0; axis < 3; axis++) {
          const mid = (coords[a * 3 + axis]! + coords[b * 3 + axis]!) / 2;
          const got = coords[slot * 3 + axis]!;
          if (Math.abs(got - mid) > TOL) {
            expect.fail(
              `element ${e}, midnode slot ${slot} (expected mid of corners ${a},${b}), axis ${axis}: ` +
              `got ${got}, expected ${mid} — C3D10_REORDER permutation is wrong`,
            );
          }
        }
      }
    }
  });

  it('buildB_c3d10 is finite and non-degenerate at every Gauss point of every element', () => {
    const { mesh } = result;
    for (let e = 0; e < mesh.elementCount; e++) {
      const coords = elementNodeCoords(mesh, e);
      for (const gp of GAUSS_POINTS) {
        const { B, detJ } = buildB_c3d10(coords, gp.xi, gp.eta, gp.zeta);
        expect(Number.isFinite(detJ)).toBe(true);
        expect(Math.abs(detJ)).toBeGreaterThan(1e-12);
        let maxAbs = 0;
        for (const v of B) {
          expect(Number.isFinite(v)).toBe(true);
          maxAbs = Math.max(maxAbs, Math.abs(v));
        }
        expect(maxAbs).toBeGreaterThan(0); // not the zero matrix
      }
    }
  });

  it('element stiffness Ke is finite, symmetric, and positive-definite on non-rigid modes', () => {
    const { mesh } = result;
    const C = buildConstitutiveMatrix({
      E: 2000, nu: 0.35, yieldStrength: 50, label: 'PLA-like test material',
    });
    const e = 0;
    const coords = elementNodeCoords(mesh, e);
    const Ke = c3d10ElementStiffness(coords, C);

    // Finite, symmetric, positive diagonal.
    let maxAbs = 0;
    for (const v of Ke) {
      expect(Number.isFinite(v)).toBe(true);
      maxAbs = Math.max(maxAbs, Math.abs(v));
    }
    expect(maxAbs).toBeGreaterThan(0);
    for (let i = 0; i < 30; i++) {
      expect(Ke[i * 30 + i]!).toBeGreaterThan(0);
      for (let j = i + 1; j < 30; j++) {
        expect(Math.abs(Ke[i * 30 + j]! - Ke[j * 30 + i]!)).toBeLessThanOrEqual(1e-9 * maxAbs);
      }
    }

    const quad = (u: Float64Array): number => {
      let s = 0;
      for (let i = 0; i < 30; i++) {
        let row = 0;
        for (let j = 0; j < 30; j++) row += Ke[i * 30 + j]! * u[j]!;
        s += u[i]! * row;
      }
      return s;
    };

    // Rigid-body translation must carry (numerically) zero strain energy.
    for (let axis = 0; axis < 3; axis++) {
      const u = new Float64Array(30);
      for (let k = 0; k < 10; k++) u[k * 3 + axis] = 1;
      expect(Math.abs(quad(u))).toBeLessThanOrEqual(1e-8 * maxAbs);
    }

    // Uniform uniaxial strain εxx: u_x = εxx·x. Straining modes must have
    // strictly positive energy, and because the element geometry is affine
    // (midnodes at exact edge midpoints — asserted above) the 4-point Gauss
    // rule integrates this constant-strain energy exactly:
    //   U = ½ εᵀCε V = ½ C00 εxx² V
    const EPS = 1e-3;
    const u = new Float64Array(30);
    for (let k = 0; k < 10; k++) u[k * 3] = EPS * coords[k * 3]!;
    const energy = 0.5 * quad(u);
    const expected = 0.5 * C[0]! * EPS * EPS * cornerTetVolume(coords);
    expect(energy).toBeGreaterThan(0);
    expect(expected).toBeGreaterThan(0);
    expect(Math.abs(energy - expected) / expected).toBeLessThanOrEqual(1e-6);
  });
});
