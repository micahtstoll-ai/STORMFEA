/**
 * modal-robustness.test.ts
 * ------------------------
 * Acceptance tests for the modal eigensolver robustness rework (#160):
 * missed-mode certification (guard-block + residual), per-mode residual gating,
 * problem-scaled shift, and partial-rigid labeling + warning.
 *
 * All meshes are deliberately coarse — these assert BEHAVIOUR (degeneracy
 * capture, gating, scaling, labeling), not fine-grained accuracy, so they stay
 * fast.
 */

import { describe, it, expect } from "vitest";
import { generateBoxMesh, getNodesOnFace } from "../../solver/meshgen.js";
import { runModalAnalysis } from "../../solver/modal.js";
import type { IsotropicMaterial } from "../../solver/types.js";

// Steel — massRho is in kg/m³ (assembleMass converts to tonne/mm³ internally,
// matching the modal-mass-density suite's convention).
const STEEL: IsotropicMaterial = {
  E: 210_000, nu: 0.3, yieldStrength: 250, label: "steel-robust-test", massRho: 7850,
};

// Square cross-section cantilever along X → transverse (Y,Z) bending is a
// degenerate pair; axial (X) modes are far higher. Symmetric ny=nz meshing.
const L = 60, W = 10, H = 10;
function squareCantilever() {
  const mesh = generateBoxMesh(0, 0, 0, L, W, H, 12, 2, 2);
  const fixedNodes = getNodesOnFace(mesh, "x", 0);
  return { mesh, fixedNodes };
}

function firstFlexibleIndex(modes: Array<{ frequencyHz: number }>): number {
  for (let i = 0; i < modes.length; i++) if (modes[i]!.frequencyHz > 1) return i;
  throw new Error("no flexible mode found");
}

// ─── #160.1: clustered / degenerate pair capture + certification ──────────────

describe("#160 clustered-mode capture (guard block)", () => {
  it("degenerate transverse bending pair: both members returned & distinct", async () => {
    const { mesh, fixedNodes } = squareCantilever();
    const res = await runModalAnalysis({ mesh, material: STEEL, fixedNodes, nModes: 8 });
    const i = firstFlexibleIndex(res.modes);
    const m1 = res.modes[i]!, m2 = res.modes[i + 1]!;

    // Square cross-section ⇒ the two lowest bending modes are (near-)degenerate.
    const relGap = Math.abs(m1.frequencyHz - m2.frequencyHz) / m1.frequencyHz;
    console.log(`\n  [#160] bending pair: f=${m1.frequencyHz.toFixed(2)}, ${m2.frequencyHz.toFixed(2)} Hz  relGap=${(relGap*100).toFixed(2)}%`);
    expect(relGap).toBeLessThan(0.05);   // a genuine close/degenerate pair
    expect(m1.rigid).toBe(false);
    expect(m2.rigid).toBe(false);

    // Both members are real, DISTINCT eigenvectors (not one mode reported twice).
    // A degenerate pair spans a 2-D eigenspace; the solver returns an orthonormal
    // basis for it, so the two shapes must not be (anti)parallel.
    let dot = 0, n1 = 0, n2 = 0;
    for (let k = 0; k < m1.modeShape.length; k++) {
      dot += m1.modeShape[k]! * m2.modeShape[k]!;
      n1 += m1.modeShape[k]! ** 2; n2 += m2.modeShape[k]! ** 2;
    }
    const cos = Math.abs(dot) / Math.sqrt(n1 * n2);
    console.log(`  [#160] pair |cos(∠)| = ${cos.toFixed(4)} (distinct ⇒ well below 1)`);
    expect(cos).toBeLessThan(0.99);
  }, 120_000);

  it("clean fully-constrained solve certifies via guard-block", async () => {
    const { mesh, fixedNodes } = squareCantilever();
    const res = await runModalAnalysis({ mesh, material: STEEL, fixedNodes, nModes: 6 });
    expect(res.converged).toBe(true);
    expect(res.certified).toBe("guard-block");
    // Every reported mode is a true eigenpair (small residual).
    for (const m of res.modes) expect(m.residual).toBeLessThan(1e-3);
  }, 120_000);
});

// ─── #160.2: per-mode residual gating ─────────────────────────────────────────

describe("#160 residual check gates convergence", () => {
  it("truncated iteration → not converged & larger residuals than a full solve", async () => {
    const { mesh, fixedNodes } = squareCantilever();
    const full = await runModalAnalysis({ mesh, material: STEEL, fixedNodes, nModes: 5 });
    // A deliberately truncated run: eigenvalues have not settled and the mode
    // shapes are far from true eigenvectors. Eigenvalue-change alone might call
    // this "done"; the residual gate must not.
    const few  = await runModalAnalysis({ mesh, material: STEEL, fixedNodes, nModes: 5, maxIter: 5 });

    // Max residual over the non-rigid reported modes (Infinity if none survive).
    const maxRes = (r: typeof full) => {
      const rs = r.modes.filter(m => !m.rigid).map(m => m.residual);
      return rs.length ? Math.max(...rs) : Infinity;
    };
    console.log(`\n  [#160] residual: full=${maxRes(full).toExponential(2)}  few=${maxRes(few).toExponential(2)}`);

    expect(full.converged).toBe(true);
    expect(maxRes(full)).toBeLessThan(1e-3);        // full solve: true eigenpairs
    expect(few.converged).toBe(false);              // gated: residuals too large ⇒ not converged
    expect(maxRes(few)).toBeGreaterThan(maxRes(full)); // residual actually tracks convergence
    // Residuals are finite, non-negative numbers on every mode.
    for (const m of full.modes) {
      expect(Number.isFinite(m.residual)).toBe(true);
      expect(m.residual).toBeGreaterThanOrEqual(0);
    }
  }, 180_000);
});

// ─── #160.3: problem-scaled auto shift (stiff & soft) ─────────────────────────

describe("#160 auto-scaled shift recovers frequencies across stiffness scales", () => {
  it("soft part (E×1e-9 ⇒ λ_min≪1) scales as √(E): f ratio ≈ √(scale), no fixed-σ blowup", async () => {
    const ESCALE = 1e-9;   // λ_min drops well below 1 rad²/s² — the old fixed σ=1.0
                           // would exceed it and make Kσ indefinite.
    const expected = Math.sqrt(ESCALE);
    const { mesh, fixedNodes } = squareCantilever();
    const stiff = STEEL;
    const soft: IsotropicMaterial = { ...STEEL, E: STEEL.E * ESCALE, label: "steel-soft" };

    // Both use the DEFAULT (auto) shift — no explicit sigma.
    const rStiff = await runModalAnalysis({ mesh, material: stiff, fixedNodes, nModes: 4 });
    const rSoft  = await runModalAnalysis({ mesh, material: soft,  fixedNodes, nModes: 4 });

    const fStiff = rStiff.modes[firstFlexibleIndex(rStiff.modes)]!.frequencyHz;
    // Soft part: fundamental is < 1 Hz, so take the lowest positive-ω² mode.
    const fSoft = rSoft.modes.find(m => m.omega2 > 0)!.frequencyHz;
    const ratio = fSoft / fStiff;
    console.log(`\n  [#160] auto-shift  fStiff=${fStiff.toFixed(2)}Hz  fSoft=${fSoft.toExponential(3)}Hz  ratio=${ratio.toExponential(3)} (expect ${expected.toExponential(3)})`);

    expect(Number.isFinite(fStiff)).toBe(true);
    expect(Number.isFinite(fSoft)).toBe(true);
    expect(fStiff).toBeGreaterThan(1);   // stiff fundamental is a real frequency
    // ω ∝ √(E) with mass & mesh fixed → ratio = √(scale) (shapes identical,
    // discretisation error cancels).
    expect(ratio).toBeGreaterThan(expected * 0.98);
    expect(ratio).toBeLessThan(expected * 1.02);
  }, 180_000);
});

// ─── #160.4: partial-rigid labeling + warning ─────────────────────────────────

describe("#160 partial-rigid modes are labeled + warned, not silently 0 Hz", () => {
  it("single pinned node leaves rotational rigid modes: labeled, warned, not thrown", async () => {
    const mesh = generateBoxMesh(0, 0, 0, L, W, H, 8, 2, 2);
    // Pin exactly ONE node (all 3 DOF): removes 3 translational RBMs, leaves the
    // 3 rotational RBMs as near-zero modes alongside the elastic spectrum.
    const cornerNodes = getNodesOnFace(mesh, "x", 0);
    const fixedNodes = [cornerNodes[0]!];

    const res = await runModalAnalysis({ mesh, material: STEEL, fixedNodes, nModes: 8 });

    console.log(`\n  [#160] partial-rigid: rigidCount=${res.rigidBodyModeCount}/${res.modes.length}  warnings=${res.warnings?.length ?? 0}`);
    console.log("        freqs:", res.modes.map(m => m.frequencyHz.toFixed(2)).join(", "));

    // Some — but not all — modes are rigid (would have thrown if all rigid).
    expect(res.rigidBodyModeCount).toBeGreaterThan(0);
    expect(res.rigidBodyModeCount).toBeLessThan(res.modes.length);
    // Rigid flag agrees with near-zero frequency; at least one labeled mode.
    const rigidModes = res.modes.filter(m => m.rigid);
    expect(rigidModes.length).toBe(res.rigidBodyModeCount);
    for (const m of rigidModes) expect(m.frequencyHz).toBeLessThan(1);
    // A warning was surfaced (constraints present + a rigid mode found).
    expect(res.warnings && res.warnings.length).toBeGreaterThan(0);
    expect(res.warnings!.some(w => /rigid/i.test(w))).toBe(true);
    // Not a silent 0 Hz fundamental: a real elastic mode exists above the rigid set.
    expect(res.modes.some(m => !m.rigid && m.frequencyHz > 1)).toBe(true);
  }, 120_000);
});
