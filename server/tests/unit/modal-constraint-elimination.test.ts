/**
 * modal-constraint-elimination.test.ts
 * ------------------------------------
 * Issue #155: the modal generalized eigenproblem K·φ = ω²·M·φ must constrain
 * DOFs consistently with the static path, not with the old per-diagonal penalty
 * `K_ii *= 1e8`. That multiply fails on a poorly-connected DOF (tiny self-
 * stiffness): tiny·1e8 is still ~0, so the DOF stays essentially free and
 * surfaces as a spurious near-zero mode. The fix DECOUPLES each constrained DOF
 * in K (shared boundary.ts primitive) with a large ABSOLUTE stiffness κ and
 * leaves M positive-definite, so:
 *   (a) no returned (low) mode localizes at a constrained DOF,
 *   (b) the free spectrum matches a reference solve on the reduced DOFs, and
 *   (c) each constrained DOF sits at ω² ≈ κ/M_ii — the TOP of the spectrum.
 * Keeping M SPD (rather than zeroing the constrained mass) is what lets the
 * shift-invert subspace iteration resolve a body's genuine rigid-body modes
 * instead of collapsing into spurious near-zero eigenvalues (see #160 tests).
 */

import { describe, it, expect } from "vitest";
import {
  constrainedDOFMask,
  eliminateConstrainedRowsCols,
} from "../../solver/boundary.js";
import { runModalAnalysis } from "../../solver/modal.js";
import { generateBoxMesh, getNodesOnFace } from "../../solver/meshgen.js";
import type { CSRMatrix } from "../../solver/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Dense symmetric n×n → CSR storing ALL n² entries (so every row/col exists). */
function denseToCSR(A: number[][], n: number): { M: CSRMatrix; diagIdx: Int32Array } {
  const data = new Float64Array(n * n);
  const colIdx = new Int32Array(n * n);
  const rowPtr = new Int32Array(n + 1);
  const diagIdx = new Int32Array(n);
  let k = 0;
  for (let r = 0; r < n; r++) {
    rowPtr[r] = k;
    for (let c = 0; c < n; c++) {
      data[k] = A[r]![c]!;
      colIdx[k] = c;
      if (r === c) diagIdx[r] = k;
      k++;
    }
  }
  rowPtr[n] = k;
  return { M: { n, data, colIdx, rowPtr }, diagIdx };
}

function csrGet(M: CSRMatrix, r: number, c: number): number {
  const s = M.rowPtr[r] ?? 0, e = M.rowPtr[r + 1] ?? M.data.length;
  for (let k = s; k < e; k++) if ((M.colIdx[k] ?? -1) === c) return M.data[k] ?? 0;
  return 0;
}

// ─── Unit tests: the shared elimination routine ────────────────────────────────

describe("constrainedDOFMask + eliminateConstrainedRowsCols (issue #155)", () => {
  it("masks the 3 translational DOFs of each fixed node (and respects fixedAxes)", () => {
    const mask = constrainedDOFMask(12, [{ nodeIndices: [1, 3] }]);
    expect(Array.from(mask)).toEqual([0,0,0, 1,1,1, 0,0,0, 1,1,1]);

    const roller = constrainedDOFMask(6, [{ nodeIndices: [0], fixedAxes: [false, false, true] }]);
    expect(Array.from(roller)).toEqual([0, 0, 1, 0, 0, 0]); // z only
  });

  it("zeros constrained rows AND columns and sets the diagonal", () => {
    // 3-DOF system; DOF 2 is the constraint.
    const { M: K, diagIdx } = denseToCSR([
      [ 2, -1, -0.5],
      [-1,  2, -0.3],
      [-0.5, -0.3, 5],
    ], 3);
    // Constrain DOF 2 (built via the shared mask helper for node 0 / z-axis).
    const m2 = constrainedDOFMask(3, [{ nodeIndices: [0], fixedAxes: [false, false, true] }]);
    expect(Array.from(m2)).toEqual([0, 0, 1]);
    eliminateConstrainedRowsCols(K, diagIdx, m2, 1.0);

    // Free 2×2 block untouched
    expect(csrGet(K, 0, 0)).toBe(2);  expect(csrGet(K, 0, 1)).toBe(-1);
    expect(csrGet(K, 1, 0)).toBe(-1); expect(csrGet(K, 1, 1)).toBe(2);
    // Constrained row/col fully zeroed except unit diagonal
    expect(csrGet(K, 0, 2)).toBe(0);  expect(csrGet(K, 1, 2)).toBe(0);
    expect(csrGet(K, 2, 0)).toBe(0);  expect(csrGet(K, 2, 1)).toBe(0);
    expect(csrGet(K, 2, 2)).toBe(1);
  });

  it("decoupling with a large ABSOLUTE stiffness fixes what the ×1e8 penalty misses", () => {
    // DOF 2 is a poorly-connected constraint: near-ZERO self-stiffness but real
    // coupling to the free DOFs. This is exactly where `K_ii *= 1e8` fails.
    const Kdense = [
      [ 2,   -1,   -0.7 ],
      [-1,    2,   -0.4 ],
      [-0.7, -0.4,  1e-12 ],  // constrained DOF: essentially no self-stiffness
    ];

    // --- OLD modal penalty: multiply the constrained diagonal by 1e8 ---
    const pen = denseToCSR(Kdense.map(r => r.slice()), 3).M;
    const dp = 2 * 3 + 2;
    pen.data[dp] = (pen.data[dp] ?? 0) * 1e8;         // 1e-12 * 1e8 = 1e-4  (still ~0!)
    // Rayleigh quotient at e₂ = [0,0,1]: R = e₂ᵀ K e₂ = K[2][2] = 1e-4.
    // With M = I the smallest eigenvalue is ≤ 1e-4 ⇒ a spurious near-zero mode is
    // admitted, far below the true lowest free-block frequency (ω² = 1).
    expect(csrGet(pen, 2, 2)).toBeLessThan(1e-3);
    expect(csrGet(pen, 2, 2)).toBeCloseTo(1e-4, 8);

    // --- NEW scheme: decouple K with a large ABSOLUTE stiffness (κ), leave M ---
    // (the modal path uses κ = max|K_ii|·1e8; any large absolute value works).
    const { M: Kel, diagIdx } = denseToCSR(Kdense.map(r => r.slice()), 3);
    const mask = new Uint8Array([0, 0, 1]);
    const kappa = 2 * 1e8;   // absolute — independent of the 1e-12 physical diagonal
    eliminateConstrainedRowsCols(Kel, diagIdx, mask, kappa);

    // DOF 2 is fully decoupled with a large ABSOLUTE stiffness (no coupling left).
    expect(csrGet(Kel, 2, 2)).toBe(kappa);
    expect(csrGet(Kel, 0, 2)).toBe(0);
    expect(csrGet(Kel, 2, 0)).toBe(0);

    // With M = I the constrained DOF sits at ω² = κ = 2e8 — the TOP of the
    // spectrum, NOT ~1e-4. The free 2×2 block [[2,-1],[-1,2]] is untouched → its
    // eigenvalues are exactly {1, 3}: the genuine low spectrum, no spurious mode.
    const a = csrGet(Kel, 0, 0), b = csrGet(Kel, 0, 1), d = csrGet(Kel, 1, 1);
    const tr = a + d, det = a * d - b * b;
    const lambdaMin = (tr - Math.sqrt(tr * tr - 4 * det)) / 2;
    const lambdaMax = (tr + Math.sqrt(tr * tr - 4 * det)) / 2;
    expect(lambdaMin).toBeCloseTo(1, 12);
    expect(lambdaMax).toBeCloseTo(3, 12);
    expect(kappa).toBeGreaterThan(lambdaMax * 1e6);   // constrained mode far above the band
    // The free block is bit-identical to the reference reduced system.
    expect([a, b, d]).toEqual([2, -1, 2]);
  });
});

// ─── Integration: guard property on a real modal solve ─────────────────────────

describe("runModalAnalysis constrained-DOF guard (issue #155)", () => {
  const STEEL = { E: 210_000, nu: 0.3, yieldStrength: 250, label: "steel", massRho: 7850 };

  it("no returned mode localizes at a constrained DOF, and frequencies stay physical", async () => {
    const mesh = generateBoxMesh(0, 0, 0, 60, 10, 10, 8, 2, 2);
    const fixedNodes = getNodesOnFace(mesh, "x", 0);
    const res = await runModalAnalysis({ mesh, material: STEEL, fixedNodes, nModes: 6 });

    // Build the constrained-DOF set.
    const constrained = new Set<number>();
    for (const ni of fixedNodes) for (let d = 0; d < 3; d++) constrained.add(ni * 3 + d);

    for (const mode of res.modes) {
      let cN2 = 0, tN2 = 0;
      for (let i = 0; i < mode.modeShape.length; i++) {
        const v = mode.modeShape[i] ?? 0;
        tN2 += v * v;
        if (constrained.has(i)) cN2 += v * v;
      }
      // Decoupling each constrained DOF with a large absolute stiffness drives
      // its displacement to ≈0 in every reported mode: the constrained-DOF energy
      // fraction is negligible (the internal guard uses 1e-8; observed ≪ 1e-12).
      expect(tN2).toBeGreaterThan(0);
      expect(cN2 / tN2).toBeLessThan(1e-10);
    }

    // At least one real (flexible) mode above the rigid-body floor.
    const flex = res.modes.find(m => m.frequencyHz > 10);
    expect(flex).toBeDefined();
  }, 120_000);
});
