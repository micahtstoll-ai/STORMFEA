/**
 * buckling-sign.test.ts
 * ---------------------
 * Regression tests for issue #103 (buckling numerical hygiene):
 *
 * 1. Power iteration sign-blindness: runLinearBuckling converges to the
 *    largest-MAGNITUDE eigenvalue of K⁻¹·(−Kσ). With mixed tension/compression
 *    the dominant eigenvalue can be negative while a physical positive mode
 *    exists. The solver must deflate the negative mode and find the positive
 *    one — or flag the result `indeterminate` when none exists.
 *
 * 2. assembleKsigma must THROW for C3D10 meshes instead of silently returning
 *    an all-zero Kσ (which would make any downstream BLF meaningless).
 *
 * The eigenvalue tests use tiny diagonal matrices so the spectrum is exact and
 * known: K = I (CSR identity), Kσ diagonal, so K⁻¹·(−Kσ) = diag(−Kσ).
 */

import { describe, it, expect } from "vitest";
import { runLinearBuckling } from "../../solver/buckling.js";
import { assembleKsigma, buildSparsityPattern } from "../../solver/assembly.js";
import type { CSRMatrix, TetMesh } from "../../solver/types.js";

/** Build an n×n diagonal CSR matrix. */
function diagCSR(values: number[]): { M: CSRMatrix; diagIdx: Int32Array } {
  const n = values.length;
  const rowPtr = new Int32Array(n + 1);
  const colIdx = new Int32Array(n);
  const data = new Float64Array(n);
  const diagIdx = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    rowPtr[i + 1] = i + 1;
    colIdx[i] = i;
    data[i] = values[i] ?? 0;
    diagIdx[i] = i;
  }
  return { M: { n, data, colIdx, rowPtr }, diagIdx };
}

describe("runLinearBuckling — sign-blindness handling (issue #103)", () => {
  it("finds the positive mode when the dominant eigenvalue is negative (mixed state)", async () => {
    // K = I, Kσ = diag(2, −1, −1, −1) → K⁻¹·(−Kσ) has eigenvalues {−2, 1, 1, 1}.
    // Plain power iteration converges to the dominant μ = −2 (tensile,
    // non-physical → BLF = 1/μ = −0.5). The deflated restart must recover the
    // physical positive mode: μ = 1 → BLF = 1.
    const { M: K, diagIdx } = diagCSR([1, 1, 1, 1]);
    const { M: Ksigma } = diagCSR([2, -1, -1, -1]);

    const r = await runLinearBuckling(K, Ksigma, diagIdx, 200, 1e-7);
    expect(r.indeterminate).toBe(false);
    expect(r.tensileDominated).toBe(false);
    expect(r.converged).toBe(true);
    expect(r.blf).toBeCloseTo(1.0, 4);
  });

  it("returns a positive BLF directly when compression dominates", async () => {
    // Kσ = diag(−2, 1) → K⁻¹·(−Kσ) has eigenvalues {2, −1}: dominant μ = 2 is
    // already positive, BLF = 1/μ = 0.5 (smallest positive load factor).
    const { M: K, diagIdx } = diagCSR([1, 1]);
    const { M: Ksigma } = diagCSR([-2, 1]);

    const r = await runLinearBuckling(K, Ksigma, diagIdx, 200, 1e-7);
    expect(r.indeterminate).toBe(false);
    expect(r.blf).toBeCloseTo(0.5, 4);
  });

  it("flags indeterminate when NO positive eigenvalue exists (all tensile Kσ energy)", async () => {
    // Kσ = diag(2, 2, 2) → K⁻¹·(−Kσ) = −2·I: every eigenvalue negative.
    // Even after deflation there is no positive mode — the solver must NOT
    // report a negative number as a buckling factor.
    const { M: K, diagIdx } = diagCSR([1, 1, 1]);
    const { M: Ksigma } = diagCSR([2, 2, 2]);

    const r = await runLinearBuckling(K, Ksigma, diagIdx, 200, 1e-6);
    expect(r.indeterminate).toBe(true);
    expect(r.converged).toBe(false);
  });
});

describe("assembleKsigma — C3D10 guard (issue #103)", () => {
  it("throws for nodesPerElem=10 instead of silently returning zero Kσ", () => {
    // Single straight-sided C3D10 tet (same geometry as solver_validation group 6)
    const mesh10: TetMesh = {
      nodes: new Float64Array([
        2,0,0,  0,2,0,  0,0,2,  0,0,0,
        1,1,0,  0,1,1,  1,0,1,  1,0,0,  0,1,0,  0,0,1,
      ]),
      elements:     new Int32Array([0,1,2,3,4,5,6,7,8,9]),
      nodeCount:    10,
      elementCount: 1,
      nodesPerElem: 10,
    };
    const { rowPtr, colIdx } = buildSparsityPattern(mesh10);
    const elemStress = new Float64Array(6);
    expect(() => assembleKsigma(mesh10, elemStress, rowPtr, colIdx)).toThrow(/C3D4/);
  });
});
