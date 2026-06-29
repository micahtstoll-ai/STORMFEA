/**
 * mass-matrix.test.ts
 * -------------------
 * Validates assembleMass for C3D4 elements:
 *   1. total mass = ρ × volume  (consistent and lumped)
 *   2. consistent and lumped give identical total mass (row-sum property)
 *   3. consistent M is positive definite (Cholesky check on small mesh)
 */

import { describe, it, expect } from "vitest";
import { assembleMass, assembleM } from "../../solver/mass.js";
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
