import { describe, it, expect } from 'vitest';
import { buildIC0, forwardSolve, backwardSolve } from '../../solver/cg.js';
import type { IC0Factor } from '../../solver/cg.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a dense-but-fully-stored CSRMatrix for a symmetric n×n matrix given
 * as a row-major flat array.  Stores ALL entries (upper + lower + diagonal) in
 * row order — matches the format that assembleK produces.  Returns both the
 * matrix and a diagIdx array pointing to the diagonal entry in each row.
 */
function makeCSR(n: number, values: number[]): {
  K: { n: number; data: Float64Array; colIdx: Int32Array; rowPtr: Int32Array };
  diagIdx: Int32Array;
} {
  const data: number[]   = [];
  const colIdx: number[] = [];
  const rowPtr: number[] = [0];
  const diagIdx = new Int32Array(n);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = values[i * n + j]!;
      if (v !== 0 || i === j) {           // always include diagonal
        if (i === j) diagIdx[i] = data.length;
        data.push(v);
        colIdx.push(j);
      }
    }
    rowPtr.push(data.length);
  }

  return {
    K: {
      n,
      data:   new Float64Array(data),
      colIdx: new Int32Array(colIdx),
      rowPtr: new Int32Array(rowPtr),
    },
    diagIdx,
  };
}

/**
 * Reconstruct the matrix product L·Lᵀ from IC0Factor, where L is the
 * lower-triangular factor (diagonal + entries to the left of the diagonal).
 * Returns a dense n×n matrix (row-major).
 */
function ltlt(f: IC0Factor, n: number): number[][] {
  // Build dense L first
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    const rowStart = f.LrowPtr[i]!;
    const dPos     = f.diagIdx[i]!;
    for (let p = rowStart; p <= dPos; p++) {   // lower triangle including diagonal
      const j = f.LcolIdx[p]!;
      if (j <= i) L[i]![j] = f.Ldata[p]!;
    }
  }
  // Compute L·Lᵀ
  const result: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let k = 0; k <= Math.min(i, j); k++) s += L[i]![k]! * L[j]![k]!;
      result[i]![j] = s;
    }
  }
  return result;
}

// ─── 2×2 dense SPD — IC(0) is exact Cholesky ─────────────────────────────────
// K = [4  2]    exact L = [2  0]    L·Lᵀ = K exactly.
//     [2  5]               [1  2]
const K2x2_VALUES = [4, 2, 2, 5];

describe('buildIC0 — 2×2 dense SPD matrix', () => {
  const { K, diagIdx } = makeCSR(2, K2x2_VALUES);

  it('diagonal of L equals expected sqrt values', () => {
    const f = buildIC0(K, diagIdx);
    // L[0,0] = sqrt(4) = 2,  L[1,1] = sqrt(5 - 1²) = sqrt(4) = 2
    expect(f.Ldata[diagIdx[0]!]).toBeCloseTo(2, 12);
    expect(f.Ldata[diagIdx[1]!]).toBeCloseTo(2, 12);
  });

  it('L[1,0] = K[1,0] / L[0,0] = 2/2 = 1', () => {
    const f = buildIC0(K, diagIdx);
    // The off-diagonal entry in row 1 (column 0) is the first entry of row 1.
    const row1Start = f.LrowPtr[1]!;
    const row1DPos  = f.diagIdx[1]!;
    // There is exactly one entry before the diagonal in row 1.
    expect(row1DPos - row1Start).toBe(1);
    expect(f.Ldata[row1Start]!).toBeCloseTo(1, 12);
  });

  it('L·Lᵀ = K (IC(0) is exact Cholesky on a dense 2×2)', () => {
    const f = buildIC0(K, diagIdx);
    const prod = ltlt(f, 2);
    expect(prod[0]![0]).toBeCloseTo(4, 10);
    expect(prod[0]![1]).toBeCloseTo(2, 10);
    expect(prod[1]![0]).toBeCloseTo(2, 10);
    expect(prod[1]![1]).toBeCloseTo(5, 10);
  });
});

// ─── 3×3 dense SPD — IC(0) is exact Cholesky ─────────────────────────────────
// K = [4  2  0]    Exact Cholesky:
//     [2  5  1]    L[0,0]=2, L[1,0]=1, L[1,1]=2, L[2,1]=0.5, L[2,2]=sqrt(2-0.25)=sqrt(1.75)
//     [0  1  2]    (L[2,0]=0/2=0 since K[2,0]=0)
const K3x3_VALUES = [
  4, 2, 0,
  2, 5, 1,
  0, 1, 2,
];

describe('buildIC0 — 3×3 dense SPD matrix', () => {
  const { K, diagIdx } = makeCSR(3, K3x3_VALUES);

  it('L·Lᵀ ≈ K (entries that are non-zero in K)', () => {
    const f = buildIC0(K, diagIdx);
    const prod = ltlt(f, 3);
    // All entries of K should be reproduced by L·Lᵀ on a fully connected 3×3.
    // (The zero entry K[0,2] is stored as 0 in CSR but IC(0) fill-in is zero too.)
    const flat = K3x3_VALUES;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(prod[i]![j]).toBeCloseTo(flat[i * 3 + j]!, 8);
      }
    }
  });

  it('all diagonal entries of L are positive', () => {
    const f = buildIC0(K, diagIdx);
    for (let i = 0; i < 3; i++) {
      expect(f.Ldata[diagIdx[i]!]!).toBeGreaterThan(0);
    }
  });
});

// ─── forwardSolve + backwardSolve: (L·Lᵀ)⁻¹·b = K⁻¹·b ──────────────────────
// For 2×2: K⁻¹ = 1/16 * [5,-2; -2,4].  b=[2,2] → K⁻¹·b=[3/8, 1/4].
describe('forwardSolve + backwardSolve — 2×2', () => {
  const { K, diagIdx } = makeCSR(2, K2x2_VALUES);

  it('L⁻¹·b is correct (forwardSolve)', () => {
    const f = buildIC0(K, diagIdx);
    const b = new Float64Array([4, 6]);
    const x = new Float64Array(2);
    forwardSolve(f.Ldata, f.LcolIdx, f.LrowPtr, f.diagIdx, b, x);
    // L·x = b with L=[2,0;1,2]: x[0]=4/2=2, x[1]=(6-1*2)/2=2
    expect(x[0]).toBeCloseTo(2, 12);
    expect(x[1]).toBeCloseTo(2, 12);
  });

  it('L⁻ᵀ·b is correct (backwardSolve)', () => {
    const f = buildIC0(K, diagIdx);
    const b = new Float64Array([1, 0.5]);
    const x = new Float64Array(2);
    backwardSolve(f.Ldata, f.LcolIdx, f.LrowPtr, f.diagIdx, b, x);
    // Lᵀ·x = b with Lᵀ=[2,1;0,2]: x[1]=0.5/2=0.25, x[0]=(1-1*0.25)/2=0.375
    expect(x[0]).toBeCloseTo(0.375, 12);
    expect(x[1]).toBeCloseTo(0.25,  12);
  });

  it('forward then backward solves K⁻¹·b correctly', () => {
    const f = buildIC0(K, diagIdx);
    const b = new Float64Array([2, 2]);
    const y = new Float64Array(2);
    const x = new Float64Array(2);
    // Forward: L·y = b
    forwardSolve(f.Ldata, f.LcolIdx, f.LrowPtr, f.diagIdx, b, y);
    // Backward: Lᵀ·x = y
    backwardSolve(f.Ldata, f.LcolIdx, f.LrowPtr, f.diagIdx, y, x);
    // K⁻¹·[2;2] = 1/16*[5*2-2*2, -2*2+4*2] = [6/16, 4/16] = [0.375, 0.25]
    expect(x[0]).toBeCloseTo(0.375, 12);
    expect(x[1]).toBeCloseTo(0.25,  12);
  });
});

// ─── Non-positive-definite matrix throws IC0_NONPOSDEF ───────────────────────
describe('buildIC0 — non-positive-definite matrix', () => {
  it('throws IC0_NONPOSDEF for a matrix with non-positive pivot', () => {
    // K = [1, 2; 2, 1] — not SPD (det = 1-4 = -3 < 0)
    const { K, diagIdx } = makeCSR(2, [1, 2, 2, 1]);
    expect(() => buildIC0(K, diagIdx)).toThrow('IC0_NONPOSDEF');
  });
});
