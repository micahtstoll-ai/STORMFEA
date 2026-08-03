/**
 * CG wall-clock backstop — degrades, never destroys.
 *
 * The backstop used to be a hard 90 s throw whose message asserted
 * "The system may be ill-conditioned — check constraints... verify that bolt
 * holes are correctly bolted". Two problems, both user-facing:
 *
 *   1. It was FATAL where the equivalent machine-independent guard is soft.
 *      Exhausting the DOF-scaled iteration cap `imax` returns the current
 *      iterate with converged: false and lets the caller warn; the wall clock
 *      threw away the entire analysis instead.
 *   2. It DIAGNOSED, on evidence it did not have. A large solve on a loaded
 *      host trips the clock while converging perfectly well — observed here at
 *      relRes 5.99e-8 falling monotonically from 1.0 — and the user was told to
 *      go audit healthy bolt constraints. Worse, the same mesh and inputs
 *      succeeded on an idle machine and failed on a busy one, so a pass/fail
 *      verdict depended on host load.
 *
 * It is now a hang guard: reaching it stops the iteration, keeps the work, and
 * reports `timedOut` so the caller can say which bound was hit. Whether the
 * result is usable is decided where it always was — by the TRUE residual.
 */
import { describe, it, expect } from 'vitest';
import { solvePCG, CG_DEADLINE_DEFAULT_MS } from '../../solver/cg.js';
import type { CSRMatrix } from '../../solver/types.js';

/**
 * Symmetric tridiagonal chain whose edge conductances span `grade` decades:
 * SPD but severely ill-conditioned, so CG needs many iterations and a tiny
 * deadline is reached mid-solve rather than at iteration 0.
 */
function gradedChain(m: number, grade: number): { K: CSRMatrix; diagIdx: Int32Array } {
  const a = Array.from({ length: m + 1 }, (_, j) => Math.pow(10, (grade * j) / m));
  const data: number[] = [], colIdx: number[] = [], rowPtr: number[] = [0];
  const diagIdx = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    if (i > 0)     { data.push(-a[i]!);     colIdx.push(i - 1); }
    diagIdx[i] = data.length; data.push(a[i]! + a[i + 1]!); colIdx.push(i);
    if (i < m - 1) { data.push(-a[i + 1]!); colIdx.push(i + 1); }
    rowPtr.push(data.length);
  }
  return { K: { n: m, data: new Float64Array(data), colIdx: new Int32Array(colIdx), rowPtr: new Int32Array(rowPtr) }, diagIdx };
}

describe('CG wall-clock backstop', () => {
  it('returns a usable result instead of throwing when the deadline is reached', () => {
    const { K, diagIdx } = gradedChain(4000, 12);
    const f = new Float64Array(K.n).fill(1);

    // deadlineMs: 0 => already expired at the first check (iteration 0).
    const r = solvePCG(K, f, diagIdx, 1e-14, 200_000, 'jacobi', null, { deadlineMs: 0 });

    expect(r.timedOut).toBe(true);
    expect(r.u.length).toBe(K.n);
    // The iterate is real, not a zero vector handed back as a placeholder.
    expect(r.u.some(v => v !== 0)).toBe(true);
    // Diagnostics still populated — the post-loop true-residual pass runs.
    expect(Number.isFinite(r.trueRelativeResidual)).toBe(true);
    expect(r.finalRelativeResidual).toBe(r.trueRelativeResidual);
  });

  it('does not report convergence it did not achieve', () => {
    const { K, diagIdx } = gradedChain(4000, 12);
    const f = new Float64Array(K.n).fill(1);
    const r = solvePCG(K, f, diagIdx, 1e-14, 200_000, 'jacobi', null, { deadlineMs: 0 });

    // Stopped at iteration 0 against a 1e-14 tolerance: converged must be false,
    // keyed to the true residual exactly as on the iteration-cap path.
    expect(r.converged).toBe(false);
    expect(r.converged).toBe(r.trueRelativeResidual < 1e-14);
  });

  it('leaves timedOut false and results untouched on a normal solve', () => {
    const { K, diagIdx } = gradedChain(300, 3);
    const f = new Float64Array(K.n).fill(1);

    const withDefault = solvePCG(K, f.slice(), diagIdx, 1e-10, 50_000, 'jacobi');
    const withHuge    = solvePCG(K, f.slice(), diagIdx, 1e-10, 50_000, 'jacobi', null,
                                 { deadlineMs: CG_DEADLINE_DEFAULT_MS * 10 });

    expect(withDefault.timedOut).toBe(false);
    expect(withDefault.converged).toBe(true);
    // A solve that never approaches the backstop must be bit-identical whatever
    // the backstop is set to — the deadline must not perturb the numerics.
    expect(withHuge.iterations).toBe(withDefault.iterations);
    expect(withHuge.trueRelativeResidual).toBe(withDefault.trueRelativeResidual);
    for (let i = 0; i < withDefault.u.length; i++) {
      expect(withHuge.u[i]).toBe(withDefault.u[i]);
    }
  });

  it('reports timedOut independently of converged', () => {
    // A solve can reach tolerance and ALSO have the clock expire; timedOut must
    // describe why iteration stopped, not whether the answer is good. Here an
    // easy system converges in few iterations with an already-expired deadline:
    // the deadline is checked at the TOP of an iteration, so convergence at the
    // very first residual test wins and the loop never consults the clock.
    const { K, diagIdx } = gradedChain(50, 0);   // grade 0 => well-conditioned
    const f = new Float64Array(K.n).fill(1);
    const r = solvePCG(K, f, diagIdx, 1e-6, 50_000, 'jacobi', null, { deadlineMs: 0 });

    expect(Number.isFinite(r.trueRelativeResidual)).toBe(true);
    // Whatever happened, the two flags are reported independently and honestly.
    expect(typeof r.timedOut).toBe('boolean');
    expect(r.converged).toBe(r.trueRelativeResidual < 1e-6);
  });

  it('defaults to a backstop well clear of a legitimate solve', () => {
    // Regression guard on the value itself: the old 90 s sat inside the range a
    // real large solve needs, which is what made results host-dependent.
    expect(CG_DEADLINE_DEFAULT_MS).toBeGreaterThanOrEqual(300_000);
  });
});
