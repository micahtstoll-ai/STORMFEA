/**
 * reaction-forces.test.ts
 * -----------------------
 * Issue #136 regression tests for support reaction recovery.
 *
 * The penalty method mutates the diagonal of every constrained DOF
 * (K_ii += K_PENALTY) and the RHS (f_i += K_PENALTY·g_i). Recovering the
 * reaction from the MODIFIED stiffness gives
 *   (K_modified·u)_i − f_ext_i = (K₀·u)_i + K_PENALTY·u_i − f_ext_i ≈ K_PENALTY·g_i,
 * which collapses to ≈0 for fixed supports (g = 0) and to a spurious
 * K_PENALTY·g for prescribed displacements. The fix backs the penalty out of
 * the modified diagonal so the reported reaction is the true residual against
 * the pristine stiffness, (K₀·u)_i − f_ext_i.
 *
 * These tests assert the physically-correct reactions; the OLD code path would
 * report ≈0 at fixed supports and fail every one of them.
 */

import { describe, it, expect } from "vitest";
import { generateBoxMesh, getNodesOnFace } from "../../solver/meshgen.js";
import { runLinearStatic, runLinearStaticWithK } from "../../solver/pipeline.js";
import type { CSRMatrix } from "../../solver/types.js";

const PLA = { E: 3500, nu: 0.36, yieldStrength: 50, label: "pla" };

// Sparse row dot-product (K·u)_i for a single row i.
function rowDotU(K: CSRMatrix, u: Float64Array, i: number): number {
  let s = 0;
  const rStart = K.rowPtr[i] ?? 0;
  const rEnd = K.rowPtr[i + 1] ?? 0;
  for (let k = rStart; k < rEnd; k++) {
    const col = K.colIdx[k];
    if (col === undefined) continue;
    s += (K.data[k] ?? 0) * (u[col] ?? 0);
  }
  return s;
}

describe("support reaction recovery (issue #136)", () => {
  it("cantilever tip load: fixed-face reaction resultant equals the applied load", async () => {
    const L = 80, W = 4, H = 4;
    const mesh = generateBoxMesh(0, 0, 0, L, W, H, 20, 2, 2);
    const fixed = getNodesOnFace(mesh, "x", 0);
    const tip = getNodesOnFace(mesh, "x", L);

    const P = 10; // total downward (−z) load, Newtons
    const forces = tip.map(n => ({ nodeIndex: n, forceN: [0, 0, -P / tip.length] as [number, number, number] }));

    const { result, K } = await runLinearStaticWithK({
      mesh, material: PLA,
      constraints: [{ nodeIndices: fixed }],
      forces,
    });

    expect(result.converged).toBe(true);
    expect(result.boltReactions).toBeDefined();
    const react = result.boltReactions![0]!;

    // Corrected reaction: opposes the applied load. ΣF = 0 ⇒ Fz = +P, Fx = Fy = 0.
    expect(Math.abs(react.Fz - P) / P).toBeLessThan(1e-3);
    expect(Math.abs(react.Fx)).toBeLessThan(1e-3 * P);
    expect(Math.abs(react.Fy)).toBeLessThan(1e-3 * P);

    // Demonstrate the defect directly: the penalty-INCLUSIVE residual (old code)
    // at the fixed z-DOFs is (K_modified·u)_i, which collapses to ≈0 (f_ext = 0
    // on the fixed face). It is nowhere near the true reaction P.
    let oldFz = 0;
    for (const n of fixed) oldFz += rowDotU(K, result.displacement, n * 3 + 2);
    expect(Math.abs(oldFz)).toBeLessThan(1e-3 * P); // old value ≈ 0 — the bug
    expect(Math.abs(react.Fz - oldFz)).toBeGreaterThan(0.9 * P); // fix moved it to ≈P
  });

  it("prescribed non-zero displacement: reaction is finite and physical, not K_PENALTY·g", async () => {
    const L = 20, W = 10, H = 10;
    const mesh = generateBoxMesh(0, 0, 0, L, W, H, 4, 2, 2);
    const x0Face = getNodesOnFace(mesh, "x", 0);
    const xLFace = getNodesOnFace(mesh, "x", L);

    const delta = 0.02; // prescribed +x stretch on the far face (mm)
    // A prescribed displacement enters the RHS as K_PENALTY·g (huge), so the
    // default RELATIVE CG tolerance under-resolves the reaction balance (its
    // absolute residual scales with the inflated RHS). Tighten it here — this is
    // a property of the penalty method, independent of the #136 recovery fix.
    const result = await runLinearStatic({
      mesh, material: PLA,
      constraints: [
        { nodeIndices: x0Face }, // fixed at zero
        {
          nodeIndices: xLFace,
          prescribedDisplacement: xLFace.map(() => [delta, 0, 0] as [number, number, number]),
        },
      ],
      forces: [],
      cgTolerance: 1e-12,
    });

    expect(result.converged).toBe(true);
    const rFixed = result.boltReactions![0]!;
    const rPrescribed = result.boltReactions![1]!;

    // Every component must be finite (a K_PENALTY·g leak would still be finite,
    // but astronomically large — see the band + balance checks below).
    for (const r of [rFixed, rPrescribed]) {
      expect(isFinite(r.Fx)).toBe(true);
      expect(isFinite(r.Fy)).toBe(true);
      expect(isFinite(r.Fz)).toBe(true);
    }

    // Physical magnitude band: uniaxial estimate F ≈ E·A·δ/L. Confined lateral
    // contraction stiffens this somewhat, so allow a wide 0.1×–10× window. The
    // spurious penalty value K_PENALTY·δ ≈ (kMax·1e8)·δ is ~1e8× larger and would
    // blow straight through the upper bound — this is the "not K_PENALTY·g" check.
    const Funiaxial = PLA.E * (W * H) * delta / L; // ≈ 350 N
    for (const r of [rFixed, rPrescribed]) {
      expect(Math.abs(r.Fx)).toBeGreaterThan(0.1 * Funiaxial);
      expect(Math.abs(r.Fx)).toBeLessThan(10 * Funiaxial);
    }

    // No external loads ⇒ the two supports must balance (equal and opposite).
    expect(Math.abs(rFixed.Fx + rPrescribed.Fx)).toBeLessThan(5e-3 * Math.abs(rPrescribed.Fx));
    expect(Math.sign(rFixed.Fx)).toBe(-Math.sign(rPrescribed.Fx));
  });

  it("multi-constraint model: reaction resultants balance the applied loads", async () => {
    // Fixed–fixed block: both x-faces clamped, transverse load on the top face.
    const L = 40, W = 8, H = 8;
    const mesh = generateBoxMesh(0, 0, 0, L, W, H, 8, 2, 2);
    const leftFace = getNodesOnFace(mesh, "x", 0);
    const rightFace = getNodesOnFace(mesh, "x", L);
    const topFace = getNodesOnFace(mesh, "z", H);

    const Ptot = 24; // total −z load spread over the top face
    const forces = topFace.map(n => ({ nodeIndex: n, forceN: [0, 0, -Ptot / topFace.length] as [number, number, number] }));

    const result = await runLinearStatic({
      mesh, material: PLA,
      constraints: [{ nodeIndices: leftFace }, { nodeIndices: rightFace }],
      forces,
    });

    expect(result.converged).toBe(true);
    const [rL, rR] = [result.boltReactions![0]!, result.boltReactions![1]!];

    // Global equilibrium: Σ reactions = −Σ applied loads.
    const sumFx = rL.Fx + rR.Fx;
    const sumFy = rL.Fy + rR.Fy;
    const sumFz = rL.Fz + rR.Fz;
    expect(Math.abs(sumFx)).toBeLessThan(1e-3 * Ptot);
    expect(Math.abs(sumFy)).toBeLessThan(1e-3 * Ptot);
    expect(Math.abs(sumFz - Ptot) / Ptot).toBeLessThan(1e-3); // balances the −Ptot load

    // Each support carries a real share of the load (old code: both ≈0).
    expect(Math.abs(rL.Fz)).toBeGreaterThan(0.1 * Ptot);
    expect(Math.abs(rR.Fz)).toBeGreaterThan(0.1 * Ptot);
  });
});
