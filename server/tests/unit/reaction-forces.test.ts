/**
 * reaction-forces.test.ts
 * -----------------------
 * Support-reaction recovery (issue #136 intent, carried through the issue #154
 * elimination migration).
 *
 * Reactions are recovered as the residual against the PRISTINE stiffness,
 *   R_i = (K0·u)_i − f_ext_i,
 * using the pristine constrained rows snapshotted by applyDirichletBC. This is
 * physically correct and independent of the constraint scheme — with elimination
 * the SOLVED K's constrained rows are zeroed, so the pristine snapshot (not the
 * modified matrix) is what carries the reaction.
 *
 * Asserts:
 *  1. A cantilever's fixed-face reaction equals the applied tip load.
 *  2. A prescribed-displacement reaction is finite and PHYSICAL (not K_penalty·g)
 *     and balances the opposing support.
 *  3. Fixed–fixed reactions balance the applied mid-span load.
 */

import { describe, it, expect } from 'vitest';
import { generateBoxMesh } from '../../solver/meshgen.js';
import { runLinearStatic } from '../../solver/pipeline.js';

const STEEL = { E: 210_000, nu: 0.3, yieldStrength: 250, label: 'steel', massRho: 7850 };

function facesOf(mesh: ReturnType<typeof generateBoxMesh>, L: number) {
  const x0: number[] = [], xL: number[] = [], mid: number[] = [];
  for (let n = 0; n < mesh.nodeCount; n++) {
    const x = mesh.nodes[n * 3] ?? 0;
    if (x < 1e-6) x0.push(n);
    if (x > L - 1e-6) xL.push(n);
    if (Math.abs(x - L / 2) < L / 20) mid.push(n);
  }
  return { x0, xL, mid };
}

describe('support reactions (#136 intent under #154 elimination)', () => {
  it('cantilever fixed-face reaction equals the applied tip load', async () => {
    const L = 40;
    const mesh = generateBoxMesh(0, 0, 0, L, 6, 6, 10, 3, 3);
    const { x0, xL } = facesOf(mesh, L);
    const Pz = -8;                       // total downward tip load, N
    const forces = xL.map(n => ({ nodeIndex: n, forceN: [0, 0, Pz / xL.length] as [number, number, number] }));

    const r = await runLinearStatic({ mesh, material: STEEL, constraints: [{ nodeIndices: x0 }], forces });
    const R = r.boltReactions![0]!;

    // Reaction balances the applied load: sum(reactions) = −sum(external).
    expect(R.Fz).toBeCloseTo(-Pz, 3);          // ≈ +8 N
    expect(Math.abs(R.Fx)).toBeLessThan(1e-3);
    expect(Math.abs(R.Fy)).toBeLessThan(1e-3);
  });

  it('prescribed-displacement reaction is finite/physical (not K_penalty·g) and balances', async () => {
    const L = 40;
    const mesh = generateBoxMesh(0, 0, 0, L, 6, 6, 10, 3, 3);
    const { x0, xL } = facesOf(mesh, L);
    const uz = 0.25;                      // prescribed tip displacement, mm
    const r = await runLinearStatic({
      mesh, material: STEEL,
      constraints: [
        { nodeIndices: x0 },
        { nodeIndices: xL, fixedAxes: [false, false, true],
          prescribedDisplacement: xL.map(() => [0, 0, uz] as [number, number, number]) },
      ],
      forces: [],
    });
    const Rbase = r.boltReactions![0]!;
    const Rtip  = r.boltReactions![1]!;

    // The tip reaction is a physical elastic force ~ (EI/L³)-scale — hundreds of
    // N, NOT the ~1e8·uz a penalty formulation would leak. Assert it is bounded
    // well below any penalty magnitude, and non-trivial.
    expect(Number.isFinite(Rtip.Fz)).toBe(true);
    expect(Math.abs(Rtip.Fz)).toBeGreaterThan(1);
    expect(Math.abs(Rtip.Fz)).toBeLessThan(1e6);
    // No external loads ⇒ all reactions balance: Fz_base + Fz_tip ≈ 0.
    expect(Rbase.Fz + Rtip.Fz).toBeCloseTo(0, 2);
    // The prescribed constraint itself is satisfied exactly (elimination).
    const uTipZ = xL.map(n => r.displacement[n * 3 + 2] ?? 0);
    for (const v of uTipZ) expect(v).toBeCloseTo(uz, 8);
  });

  it('fixed–fixed reactions balance the applied mid-span load', async () => {
    const L = 40;
    const mesh = generateBoxMesh(0, 0, 0, L, 6, 6, 12, 3, 3);
    const { x0, xL, mid } = facesOf(mesh, L);
    const Pz = -12;
    const forces = mid.map(n => ({ nodeIndex: n, forceN: [0, 0, Pz / mid.length] as [number, number, number] }));

    const r = await runLinearStatic({
      mesh, material: STEEL,
      constraints: [{ nodeIndices: x0 }, { nodeIndices: xL }],
      forces,
    });
    const R0 = r.boltReactions![0]!, R1 = r.boltReactions![1]!;
    // The two supports together carry the whole load.
    expect(R0.Fz + R1.Fz).toBeCloseTo(-Pz, 2);   // ≈ +12 N
    // A symmetric mid-span load splits roughly evenly between the ends.
    expect(R0.Fz).toBeGreaterThan(0);
    expect(R1.Fz).toBeGreaterThan(0);
  });
});
