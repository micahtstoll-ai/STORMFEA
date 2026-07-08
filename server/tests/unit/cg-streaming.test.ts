/**
 * cg-streaming.test.ts
 * --------------------
 * Issue #109 regression: the cooperative event-loop-yielding solver
 * (solvePCGStreaming, used by the SSE analysis path) must be NUMERICALLY
 * IDENTICAL to the blocking solvePCG, since both feed the same buildPayload().
 * They share one generator (pcgSolve), so this guards against any future edit
 * that lets the two drivers drift, and confirms the progress/abort hooks fire.
 */

import { describe, it, expect } from "vitest";
import { generateBoxMesh, getNodesOnFace } from "../../solver/meshgen.js";
import { assembleK } from "../../solver/assembly.js";
import { assembleForceVector } from "../../solver/load.js";
import { applyDirichletBC } from "../../solver/boundary.js";
import { solvePCG, solvePCGStreaming } from "../../solver/cg.js";

const STEEL = {
  E:             210_000,
  nu:            0.3,
  yieldStrength: 250,
  label:         "steel-cg-streaming-test",
  massRho:       7850,
};

async function buildSystem() {
  const mesh = generateBoxMesh(0, 0, 0, 20, 10, 10, 5, 3, 3);
  const { K, diagIdx } = await assembleK(mesh, STEEL);
  const constraints = [{ nodeIndices: getNodesOnFace(mesh, "x", 0) }];
  const tip = getNodesOnFace(mesh, "x", 20);
  const forces = tip.map(n => ({ nodeIndex: n, forceN: [0, 0, -10] as [number, number, number] }));
  const f = assembleForceVector(mesh.nodeCount, forces);
  applyDirichletBC(K, f, diagIdx, constraints);
  return { K, diagIdx, f };
}

describe("solvePCGStreaming vs solvePCG (issue #109)", () => {
  it("produces a bit-identical solution, iteration count, and checkpoints", async () => {
    for (const precond of ['ic0', 'jacobi'] as const) {
      const { K, diagIdx, f } = await buildSystem();
      const sync   = solvePCG(K, f.slice(), diagIdx, 1e-10, 5000, precond);
      const stream = await solvePCGStreaming(K, f.slice(), diagIdx, 1e-10, 5000, precond);

      expect(stream.converged).toBe(sync.converged);
      expect(stream.iterations).toBe(sync.iterations);
      expect(stream.finalRelativeResidual).toBe(sync.finalRelativeResidual);
      expect(stream.preconditionerUsed).toBe(sync.preconditionerUsed);
      expect(stream.residualCheckpoints.length).toBe(sync.residualCheckpoints.length);
      expect(stream.residualCheckpoints).toEqual(sync.residualCheckpoints);
      // Solution vector must match exactly (same generator, same arithmetic order).
      expect(stream.u.length).toBe(sync.u.length);
      for (let i = 0; i < sync.u.length; i++) {
        expect(stream.u[i]).toBe(sync.u[i]);
      }
    }
  });

  it("streams residual checkpoints via onProgress", async () => {
    const { K, diagIdx, f } = await buildSystem();
    const seen: Array<{ iteration: number; relativeResidual: number }> = [];
    const res = await solvePCGStreaming(K, f.slice(), diagIdx, 1e-10, 5000, 'ic0', null, {
      onProgress: (iteration, relativeResidual) => seen.push({ iteration, relativeResidual }),
    });
    expect(res.converged).toBe(true);
    expect(seen.length).toBeGreaterThan(0);
    // The streamed checkpoints match the ones recorded in the result.
    expect(seen).toEqual([...res.residualCheckpoints]);
  });

  it("aborts mid-solve when the signal fires (name === AnalysisAbortError)", async () => {
    const { K, diagIdx, f } = await buildSystem();
    const ac = new AbortController();
    let calls = 0;
    // Abort after the second checkpoint so the solve is genuinely interrupted.
    const p = solvePCGStreaming(K, f.slice(), diagIdx, 1e-12, 5000, 'jacobi', null, {
      signal: ac.signal,
      onProgress: () => { if (++calls === 2) ac.abort(); },
    });
    await expect(p).rejects.toMatchObject({ name: "AnalysisAbortError" });
  });
});
