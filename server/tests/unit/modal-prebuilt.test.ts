/**
 * modal-prebuilt.test.ts
 * ----------------------
 * Issue #100 regression tests for matrix/factorization reuse:
 *   1. solvePCG with a prebuilt IC(0) factor returns the same solution as
 *      solvePCG factorizing internally.
 *   2. runModalAnalysis with prebuiltK (pristine K from the static assembly)
 *      returns the same frequencies as the self-assembling path.
 *   3. The caller's pristine K value array is NOT mutated by the modal
 *      penalty (BC flavors must stay reconciled on separate copies).
 */

import { describe, it, expect } from "vitest";
import { generateBoxMesh, getNodesOnFace } from "../../solver/meshgen.js";
import { assembleK } from "../../solver/assembly.js";
import { assembleForceVector } from "../../solver/load.js";
import { applyDirichletBC } from "../../solver/boundary.js";
import { solvePCG, buildIC0 } from "../../solver/cg.js";
import { runModalAnalysis } from "../../solver/modal.js";

const STEEL = {
  E:             210_000,
  nu:            0.3,
  yieldStrength: 250,
  label:         "steel-prebuilt-test",
  massRho:       7850,   // kg/m³ — solid steel
};

describe("solvePCG with prebuilt IC(0) factor (issue #100)", () => {
  it("returns the same solution as internal factorization", async () => {
    const mesh = generateBoxMesh(0, 0, 0, 20, 10, 10, 4, 2, 2);
    const { K, diagIdx } = await assembleK(mesh, STEEL);
    const constraints = [{ nodeIndices: getNodesOnFace(mesh, "x", 0) }];
    const tip = getNodesOnFace(mesh, "x", 20);
    const forces = tip.map(n => ({ nodeIndex: n, forceN: [0, 0, -10] as [number, number, number] }));
    const f = assembleForceVector(mesh.nodeCount, forces);
    applyDirichletBC(K, f, diagIdx, constraints);

    const internal = solvePCG(K, f.slice(), diagIdx, 1e-10, 5000, 'ic0');
    const factor = buildIC0(K, diagIdx);
    const prebuilt = solvePCG(K, f.slice(), diagIdx, 1e-10, 5000, 'ic0', factor);

    expect(prebuilt.converged).toBe(true);
    expect(prebuilt.preconditionerUsed).toBe('ic0');
    // Same matrix, same factor values → identical iteration path
    expect(prebuilt.iterations).toBe(internal.iterations);
    for (let i = 0; i < internal.u.length; i++) {
      expect(prebuilt.u[i]).toBe(internal.u[i]);
    }
  });
});

describe("runModalAnalysis with prebuiltK (issue #100)", () => {
  it("matches the self-assembling path and does not mutate the pristine K", async () => {
    const mesh = generateBoxMesh(0, 0, 0, 50, 10, 10, 10, 2, 2);
    const fixedNodes = getNodesOnFace(mesh, "x", 0);

    // Self-assembling reference run
    const reference = await runModalAnalysis({
      mesh, material: STEEL, fixedNodes, nModes: 4,
    });

    // Prebuilt run: assemble pristine K once (as the static pipeline does)
    const { K, diagIdx } = await assembleK(mesh, STEEL);
    const pristine = K.data.slice();
    const withPrebuilt = await runModalAnalysis({
      mesh, material: STEEL, fixedNodes, nModes: 4,
      prebuiltK: { Kdata: K.data, rowPtr: K.rowPtr, colIdx: K.colIdx, diagIdx },
    });

    // 1. Frequencies match the reference run
    expect(withPrebuilt.modes.length).toBe(reference.modes.length);
    for (let j = 0; j < reference.modes.length; j++) {
      const fRef = reference.modes[j]!.frequencyHz;
      const fPre = withPrebuilt.modes[j]!.frequencyHz;
      if (fRef > 1) {
        expect(Math.abs(fPre - fRef) / fRef).toBeLessThan(1e-9);
      } else {
        expect(Math.abs(fPre - fRef)).toBeLessThan(1e-6);
      }
    }

    // 2. The caller's K value array was not touched by the modal penalty
    for (let k = 0; k < pristine.length; k++) {
      if (K.data[k] !== pristine[k]) {
        throw new Error(`prebuilt Kdata mutated at nnz index ${k}: ${K.data[k]} vs ${pristine[k]}`);
      }
    }
  }, 300_000);

  it("rejects a prebuiltK whose size does not match the mesh", async () => {
    const mesh = generateBoxMesh(0, 0, 0, 20, 10, 10, 4, 2, 2);
    const other = generateBoxMesh(0, 0, 0, 20, 10, 10, 2, 1, 1);
    const { K, diagIdx } = await assembleK(other, STEEL);
    await expect(runModalAnalysis({
      mesh, material: STEEL, fixedNodes: [0], nModes: 2,
      prebuiltK: { Kdata: K.data, rowPtr: K.rowPtr, colIdx: K.colIdx, diagIdx },
    })).rejects.toThrow(/prebuiltK size mismatch/);
  });
});
