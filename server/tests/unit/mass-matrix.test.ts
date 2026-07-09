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

describe("assembleMass — default massRho fallback", () => {
  const matNoRho: IsotropicMaterial = {
    E: 3500, nu: 0.35, yieldStrength: 56, label: "no-rho",
    // massRho omitted → defaults to 1240 kg/m³
  };
  const matWithRho: IsotropicMaterial = { ...matNoRho, massRho: 1240 };

  it("omitting massRho uses 1240 kg/m³ default", () => {
    const a = assembleMass(CUBE_MESH, matNoRho,   'lumped') as Float64Array;
    const b = assembleMass(CUBE_MESH, matWithRho, 'lumped') as Float64Array;
    for (let i = 0; i < a.length; i++) {
      expect(a[i]).toBeCloseTo(b[i] ?? 0, 25);
    }
  });
});
