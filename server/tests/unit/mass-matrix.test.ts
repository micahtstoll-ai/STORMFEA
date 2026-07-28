/**
 * mass-matrix.test.ts
 * -------------------
 * Validates assembleMass for C3D4 and C3D10 elements:
 *   1. total mass = ρ × volume  (consistent and lumped)
 *   2. consistent and lumped give identical total mass
 *   3. consistent M is positive definite (Cholesky check on small mesh)
 *   4. C3D10 lumped (HRZ) masses are ALL POSITIVE — row-sum lumping produces
 *      negative corner masses for C3D10 (issue #103) and must not be used.
 */

import { describe, it, expect } from "vitest";
import { assembleMass, assembleM } from "../../solver/mass.js";
import { generateBoxMeshC3D10 } from "../../solver/meshgen.js";
import { c3d10ConsistentMassSubblock, isC3D10Affine, c3d10Volume } from "../../solver/element.js";
import type { TetMesh, IsotropicMaterial, CSRMatrix } from "../../solver/types.js";

// ─── Unit-cube C3D4 mesh (6 tets from a subdivided unit cube) ──────────────

// 8 corner nodes of the unit cube [0,1]³
const CUBE_NODES = new Float64Array([
  0,0,0,  1,0,0,  1,1,0,  0,1,0,
  0,0,1,  1,0,1,  1,1,1,  0,1,1,
]);

// 5-tet decomposition of unit cube (standard minimal partition)
const CUBE_ELEMENTS = new Int32Array([
  0,1,2,5,
  0,2,3,7,
  0,4,5,7,
  2,5,6,7,
  0,2,5,7,
]);

const CUBE_MESH: TetMesh = {
  nodes:        CUBE_NODES,
  elements:     CUBE_ELEMENTS,
  nodeCount:    8,
  elementCount: 5,
  nodesPerElem: 4,
};

// PLA-like isotropic material with explicit massRho
const PLA_MAT: IsotropicMaterial = {
  E:             3500,
  nu:            0.35,
  yieldStrength: 56,
  label:         "PLA test",
  massRho:       1240,   // kg/m³ → solver uses 1240e-12 t/mm³
};

// Expected total mass: ρ_solver × V_cube
// V_cube = 1 mm³, ρ_solver = 1240 × 1e-12 t/mm³
const RHO_SOLVER = 1240 * 1e-12;
const EXPECTED_TOTAL_MASS = RHO_SOLVER * 1.0;   // 1 mm³ cube

// ─── Helper: sum all entries of a CSR matrix ──────────────────────────────

function csrTotalSum(M: CSRMatrix): number {
  let s = 0;
  for (let i = 0; i < M.data.length; i++) s += M.data[i] ?? 0;
  return s;
}

// ─── Helper: row-sum of CSR matrix ───────────────────────────────────────

function csrRowSums(M: CSRMatrix): Float64Array {
  const rs = new Float64Array(M.n);
  for (let r = 0; r < M.n; r++) {
    const s = M.rowPtr[r] ?? 0;
    const e = M.rowPtr[r + 1] ?? M.data.length;
    for (let k = s; k < e; k++) rs[r] = (rs[r] ?? 0) + (M.data[k] ?? 0);
  }
  return rs;
}

// ─── Helper: Cholesky SPD check ──────────────────────────────────────────

function isPositiveDefiniteCSR(M: CSRMatrix): boolean {
  const n = M.n;
  // Dense copy for Cholesky
  const A = new Float64Array(n * n);
  for (let r = 0; r < n; r++) {
    const s = M.rowPtr[r] ?? 0;
    const e = M.rowPtr[r + 1] ?? M.data.length;
    for (let k = s; k < e; k++) {
      const c = M.colIdx[k] ?? 0;
      A[r * n + c] = M.data[k] ?? 0;
    }
  }
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j] ?? 0;
      for (let k = 0; k < j; k++) sum -= (L[i * n + k] ?? 0) * (L[j * n + k] ?? 0);
      if (i === j) {
        if (sum <= 0) return false;
        L[i * n + i] = Math.sqrt(sum);
      } else {
        const ljj = L[j * n + j] ?? 0;
        if (ljj === 0) return false;
        L[i * n + j] = sum / ljj;
      }
    }
  }
  return true;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("assembleMass C3D4 — consistent", () => {
  const result = assembleMass(CUBE_MESH, PLA_MAT, 'consistent') as { M: CSRMatrix };
  const M = result.M;

  it("returns CSR matrix with correct DOF count", () => {
    expect(M.n).toBe(CUBE_MESH.nodeCount * 3);   // 24
  });

  it("total row-sum equals ρ × V (total mass check)", () => {
    const rowSums = csrRowSums(M);
    let total = 0;
    for (let i = 0; i < rowSums.length; i++) total += rowSums[i] ?? 0;
    expect(total).toBeCloseTo(EXPECTED_TOTAL_MASS * 3, 20);  // 3 DOFs per node, each sums to ρV
  });

  it("is positive definite", () => {
    expect(isPositiveDefiniteCSR(M)).toBe(true);
  });

  it("all entries are finite", () => {
    for (let i = 0; i < M.data.length; i++) {
      expect(Number.isFinite(M.data[i] ?? 0)).toBe(true);
    }
  });
});

describe("assembleMass C3D4 — lumped", () => {
  const lumped = assembleMass(CUBE_MESH, PLA_MAT, 'lumped') as Float64Array;

  it("returns Float64Array of length n = nodeCount × 3", () => {
    expect(lumped).toBeInstanceOf(Float64Array);
    expect(lumped.length).toBe(CUBE_MESH.nodeCount * 3);
  });

  it("all lumped masses are positive", () => {
    for (let i = 0; i < lumped.length; i++) {
      expect((lumped[i] ?? 0)).toBeGreaterThan(0);
    }
  });

  it("total lumped mass equals ρ × V", () => {
    let total = 0;
    for (let i = 0; i < lumped.length; i++) total += lumped[i] ?? 0;
    expect(total).toBeCloseTo(EXPECTED_TOTAL_MASS * 3, 20);
  });
});

describe("assembleMass — consistent vs lumped total mass equality", () => {
  it("lumped and consistent give identical total mass (row-sum property)", () => {
    const conResult = assembleMass(CUBE_MESH, PLA_MAT, 'consistent') as { M: CSRMatrix };
    const lumped    = assembleMass(CUBE_MESH, PLA_MAT, 'lumped') as Float64Array;

    const rowSums = csrRowSums(conResult.M);
    let consTotal = 0;
    let lumpTotal = 0;
    for (let i = 0; i < rowSums.length; i++) consTotal += rowSums[i] ?? 0;
    for (let i = 0; i < lumped.length;  i++) lumpTotal += lumped[i]  ?? 0;

    expect(lumpTotal).toBeCloseTo(consTotal, 20);
  });
});

// ─── C3D10 (quadratic tet) lumped mass — HRZ diagonal scaling ───────────────
// Row-sum lumping of the C3D10 consistent matrix gives NEGATIVE corner masses
// (corner row sum = −ρ·6Ve/120 per direction). assembleMass(…, 'lumped') must
// use HRZ diagonal scaling for npe=10: all masses positive, total preserved.

// Single straight-sided C3D10 tet: corners (2,0,0),(0,2,0),(0,0,2),(0,0,0),
// midside nodes at edge midpoints (EDGE_PAIRS ordering [0,1],[1,2],[0,2],[0,3],[1,3],[2,3]).
// Volume = |det|/6 = 8/6 = 4/3 mm³.
const TET10_NODES = new Float64Array([
  2,0,0,  0,2,0,  0,0,2,  0,0,0,
  1,1,0,  0,1,1,  1,0,1,  1,0,0,  0,1,0,  0,0,1,
]);
const TET10_MESH: TetMesh = {
  nodes:        TET10_NODES,
  elements:     new Int32Array([0,1,2,3,4,5,6,7,8,9]),
  nodeCount:    10,
  elementCount: 1,
  nodesPerElem: 10,
};
const TET10_VOLUME = 4 / 3;

describe("assembleMass C3D10 — lumped (HRZ)", () => {
  const lumped = assembleMass(TET10_MESH, PLA_MAT, 'lumped') as Float64Array;

  it("returns Float64Array of length n = nodeCount × 3", () => {
    expect(lumped).toBeInstanceOf(Float64Array);
    expect(lumped.length).toBe(TET10_MESH.nodeCount * 3);
  });

  it("all lumped masses are strictly positive (issue #103 regression)", () => {
    for (let i = 0; i < lumped.length; i++) {
      expect(lumped[i] ?? 0).toBeGreaterThan(0);
    }
  });

  it("total lumped mass equals ρ × V (mass preserved)", () => {
    let total = 0;
    for (let i = 0; i < lumped.length; i++) total += lumped[i] ?? 0;
    expect(total).toBeCloseTo(3 * RHO_SOLVER * TET10_VOLUME, 20);
  });

  it("HRZ split: corner mass = ρV/36, midside mass = 4ρV/27 per direction", () => {
    const mCorner  = RHO_SOLVER * TET10_VOLUME / 36;
    const mMidside = 4 * RHO_SOLVER * TET10_VOLUME / 27;
    for (let a = 0; a < 4;  a++) expect(lumped[a * 3]).toBeCloseTo(mCorner, 22);
    for (let a = 4; a < 10; a++) expect(lumped[a * 3]).toBeCloseTo(mMidside, 22);
  });

  it("lumped total matches consistent total (row-sum of consistent M)", () => {
    const conResult = assembleMass(TET10_MESH, PLA_MAT, 'consistent') as { M: CSRMatrix };
    expect(csrTotalSum(conResult.M)).toBeCloseTo(
      Array.from(lumped).reduce((a, b) => a + b, 0), 20);
  });

  it("documents WHY HRZ is needed: consistent corner row-sums are negative", () => {
    const conResult = assembleMass(TET10_MESH, PLA_MAT, 'consistent') as { M: CSRMatrix };
    const rowSums = csrRowSums(conResult.M);
    // Corner node rows (nodes 0-3, x-DOF) sum to −ρ·6Ve/120 < 0
    for (let a = 0; a < 4; a++) {
      expect(rowSums[a * 3] ?? 0).toBeLessThan(0);
    }
  });
});

describe("assembleMass C3D10 — lumped on multi-element box mesh", () => {
  // 2×2×2 mm box, 2×2×2 divisions → 48 quadratic tets, V = 8 mm³
  const mesh = generateBoxMeshC3D10(0, 0, 0, 2, 2, 2, 2, 2, 2);
  const lumped = assembleMass(mesh, PLA_MAT, 'lumped') as Float64Array;

  it("all lumped masses positive on a real multi-element mesh", () => {
    for (let i = 0; i < lumped.length; i++) {
      expect(lumped[i] ?? 0).toBeGreaterThan(0);
    }
  });

  it("total lumped mass equals ρ × V_box", () => {
    let total = 0;
    for (let i = 0; i < lumped.length; i++) total += lumped[i] ?? 0;
    expect(total).toBeCloseTo(3 * RHO_SOLVER * 8.0, 18);
  });
});

// ─── C3D10 isoparametric consistent mass (issue #158) ───────────────────────
// The consistent mass for a curved C3D10 element (mid-edge nodes displaced off
// the straight midpoints) must integrate ρ·Nᵀ·N with the true isoparametric
// Jacobian — the same geometry model the stiffness uses — not the affine-scaled
// reference matrix. Straight elements must be reproduced exactly.

// Exact reference-tet mass sub-block values (unit tet, ρ=1, V=1/6).
const MR = {
  CC_DIAG:  1 / 420,
  CC_OFF:   1 / 2520,
  CM_ADJ:  -1 / 630,
  CM_OPP:  -1 / 420,
  MM_DIAG:  8 / 630,
  MM_ADJ:   4 / 630,
  MM_OPP:   2 / 630,
} as const;
const EDGE_PAIRS: readonly [number, number][] = [[0,1],[1,2],[0,2],[0,3],[1,3],[2,3]];
function refMassEntry(a: number, b: number): number {
  const aC = a < 4, bC = b < 4;
  if (aC && bC) return a === b ? MR.CC_DIAG : MR.CC_OFF;
  if (aC && !bC) { const [p, q] = EDGE_PAIRS[b - 4]!; return (a === p || a === q) ? MR.CM_ADJ : MR.CM_OPP; }
  if (!aC && bC) { const [p, q] = EDGE_PAIRS[a - 4]!; return (b === p || b === q) ? MR.CM_ADJ : MR.CM_OPP; }
  if (a === b) return MR.MM_DIAG;
  const [a0, a1] = EDGE_PAIRS[a - 4]!, [b0, b1] = EDGE_PAIRS[b - 4]!;
  return (a0 === b0 || a0 === b1 || a1 === b0 || a1 === b1) ? MR.MM_ADJ : MR.MM_OPP;
}

// Straight-sided tet (affine): corners (2,0,0),(0,2,0),(0,0,2),(0,0,0) with
// midsides at the exact edge midpoints. |detJ| = 6·Ve = 8, Ve = 4/3.
const STRAIGHT_COORDS = new Float64Array([
  2,0,0,  0,2,0,  0,0,2,  0,0,0,
  1,1,0,  0,1,1,  1,0,1,  1,0,0,  0,1,0,  0,0,1,
]);

describe("C3D10 isoparametric mass — straight element matches exact reference (issue #158)", () => {
  it("isC3D10Affine classifies the straight element as affine", () => {
    expect(isC3D10Affine(STRAIGHT_COORDS)).toBe(true);
  });

  it("isoparametric sub-block reproduces the analytical reference matrix (Duffy rule is degree-4 exact)", () => {
    const { m, volume } = c3d10ConsistentMassSubblock(STRAIGHT_COORDS);
    const scale = 6 * (4 / 3); // |detJ| = 6·Ve for the affine element
    expect(volume).toBeCloseTo(4 / 3, 10);
    for (let a = 0; a < 10; a++) {
      for (let b = 0; b < 10; b++) {
        expect(m[a * 10 + b]).toBeCloseTo(scale * refMassEntry(a, b), 10);
      }
    }
  });

  it("Σ of all sub-block entries equals the element volume (partition of unity)", () => {
    const { m, volume } = c3d10ConsistentMassSubblock(STRAIGHT_COORDS);
    let s = 0;
    for (let i = 0; i < 100; i++) s += m[i] ?? 0;
    expect(s).toBeCloseTo(volume, 10);
    expect(s).toBeCloseTo(4 / 3, 10);
  });
});

describe("C3D10 isoparametric mass — curved element (issue #158)", () => {
  // Bulge one mid-edge node outward: move node 4 (edge 0-1 midpoint (1,1,0))
  // outward in-plane along +x by 0.4 mm → element is genuinely curved and its
  // true (isoparametric) volume grows above the corner-node value 4/3.
  const CURVED_COORDS = new Float64Array(STRAIGHT_COORDS);
  CURVED_COORDS[4 * 3] = 1.4; // node 4 x: 1.0 → 1.4

  it("isC3D10Affine flags the displaced-midside element as NOT affine", () => {
    expect(isC3D10Affine(CURVED_COORDS)).toBe(false);
  });

  it("curved total mass differs from the affine (corner-volume) value in the right direction", () => {
    // The affine shortcut uses the corner-node volume (4/3); the true
    // isoparametric volume of the bulged element is larger.
    const affineVol = 4 / 3;
    const trueVol = c3d10Volume(CURVED_COORDS);
    expect(trueVol).toBeGreaterThan(affineVol);

    // Σ sub-block entries = true volume, and it exceeds the affine reference sum.
    const { m } = c3d10ConsistentMassSubblock(CURVED_COORDS);
    let s = 0;
    for (let i = 0; i < 100; i++) s += m[i] ?? 0;
    expect(s).toBeCloseTo(trueVol, 8);
    expect(s).toBeGreaterThan(affineVol);
  });

  it("assembleMass total mass on a curved element equals ρ × true volume", () => {
    const mesh: TetMesh = {
      nodes: CURVED_COORDS,
      elements: new Int32Array([0,1,2,3,4,5,6,7,8,9]),
      nodeCount: 10, elementCount: 1, nodesPerElem: 10,
    };
    const res = assembleMass(mesh, PLA_MAT, 'consistent') as { M: CSRMatrix };
    let total = 0;
    for (let i = 0; i < res.M.data.length; i++) total += res.M.data[i] ?? 0;
    const trueVol = c3d10Volume(CURVED_COORDS);
    // total = 3 directions × ρ × V
    expect(total).toBeCloseTo(3 * RHO_SOLVER * trueVol, 18);
  });

  it("consistent M on a curved element is positive definite", () => {
    const mesh: TetMesh = {
      nodes: CURVED_COORDS,
      elements: new Int32Array([0,1,2,3,4,5,6,7,8,9]),
      nodeCount: 10, elementCount: 1, nodesPerElem: 10,
    };
    const res = assembleMass(mesh, PLA_MAT, 'consistent') as { M: CSRMatrix };
    expect(isPositiveDefiniteCSR(res.M)).toBe(true);
  });
});

describe("assembleMass — missing density is LOUD (issue #159)", () => {
  // Previously assembleMass silently defaulted a material without massRho to
  // PLA (1240 kg/m³): a dense material (steel 7850) reported frequencies ~2.5×
  // too high with no warning. The kernel now refuses to guess — it either uses
  // material.massRho, a caller-supplied defaultRho, or throws.
  const matNoRho: IsotropicMaterial = {
    E: 3500, nu: 0.35, yieldStrength: 56, label: "no-rho",
  };
  const matWithRho: IsotropicMaterial = { ...matNoRho, massRho: 1240 };

  it("throws (not a silent 1240) when massRho and defaultRho are both absent", () => {
    expect(() => assembleMass(CUBE_MESH, matNoRho, 'lumped')).toThrow(/massRho/);
    expect(() => assembleMass(CUBE_MESH, matNoRho, 'consistent')).toThrow(/massRho/);
  });

  it("error names the material and points at the two explicit options", () => {
    expect(() => assembleMass(CUBE_MESH, matNoRho, 'lumped')).toThrow(/no-rho/);
    expect(() => assembleMass(CUBE_MESH, matNoRho, 'lumped')).toThrow(/defaultRho/);
  });

  it("uses caller-supplied defaultRho when massRho is absent", () => {
    const a = assembleMass(CUBE_MESH, matNoRho,   'lumped', undefined, undefined, 1240) as Float64Array;
    const b = assembleMass(CUBE_MESH, matWithRho, 'lumped') as Float64Array;
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i] ?? 0, 25);
  });

  it("material massRho takes precedence over defaultRho", () => {
    // defaultRho would be 9999 but the material carries 1240 → material wins.
    const a = assembleMass(CUBE_MESH, matWithRho, 'lumped', undefined, undefined, 9999) as Float64Array;
    const b = assembleMass(CUBE_MESH, matWithRho, 'lumped') as Float64Array;
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i] ?? 0, 25);
  });

  it("a dense material is NEVER silently treated as PLA (defaultRho carries through)", () => {
    const steel: IsotropicMaterial = { ...matNoRho, label: "steel", massRho: 7850 };
    const withDefault = assembleMass(CUBE_MESH, matNoRho, 'lumped', undefined, undefined, 7850) as Float64Array;
    const withRho     = assembleMass(CUBE_MESH, steel,    'lumped') as Float64Array;
    // steel/PLA density ratio is ~6.3× → the mass must reflect 7850, not 1240.
    const pla = assembleMass(CUBE_MESH, matWithRho, 'lumped') as Float64Array;
    expect((withDefault[0] ?? 0) / (pla[0] ?? 1)).toBeCloseTo(7850 / 1240, 6);
    for (let i = 0; i < withDefault.length; i++) expect(withDefault[i]).toBeCloseTo(withRho[i] ?? 0, 25);
  });
});
