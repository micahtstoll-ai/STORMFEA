/**
 * material-field.test.ts
 * ----------------------
 * Phase A of the two-region (shell/core) material model: per-element material
 * field plumbing through stiffness assembly, stress recovery, and mass.
 *
 * Invariants:
 *   1. A single-bin field whose C equals the uniform material's C produces a
 *      K bit-identical to the no-field path (C3D4 and C3D10) — the field is a
 *      pure superset of legacy behavior.
 *   2. Stiffness scales with the bin matrices: an all-elements-in-bin-1 field
 *      with C1 = 2·C0 yields exactly 2× the uniform K.
 *   3. recoverElementStress with a single-bin field matches the no-field path;
 *      with per-bin yields, element safety factors scale by the bin's yield.
 *   4. assembleMass with a 2-bin density field gives total mass Σ ρ_bin·V_bin.
 *   5. governingElement points at the argmin-SF element.
 */

import { describe, it, expect } from "vitest";
import { assembleK } from "../../solver/assembly.js";
import { assembleMass } from "../../solver/mass.js";
import { recoverElementStress } from "../../solver/stress.js";
import { buildAnyConstitutiveMatrix } from "../../solver/element.js";
import { generateBoxMeshC3D4, generateBoxMeshC3D10 } from "../../solver/meshgen.js";
import type {
  ElementMaterialField,
  IsotropicMaterial,
  OrthotropicMaterial,
  TetMesh,
} from "../../solver/types.js";

const ISO: IsotropicMaterial = {
  E: 3500, nu: 0.35, yieldStrength: 50, label: "test-PLA", massRho: 1240,
};

const ORTHO: OrthotropicMaterial = {
  kind: "orthotropic",
  E_xy: 3500, E_z: 2800, nu_xy: 0.35, nu_xz: 0.35, G_xz: 1000,
  yieldXY: 50, yieldZ: 30, label: "test-ortho", massRho: 1240,
};

/** Single-bin field wrapping a uniform material — must reproduce legacy K. */
function uniformField(mesh: TetMesh, mat: IsotropicMaterial | OrthotropicMaterial): ElementMaterialField {
  const C = buildAnyConstitutiveMatrix(mat);
  const yXY = "kind" in mat ? mat.yieldXY : mat.yieldStrength;
  const yZ = "kind" in mat ? mat.yieldZ : mat.yieldStrength;
  return {
    binCount: 1,
    binOfElement: new Int32Array(mesh.elementCount),
    C,
    yieldXY: Float64Array.of(yXY),
    yieldZ: Float64Array.of(yZ),
    massRho: Float64Array.of(mat.massRho ?? 1240),
    shellFrac: Float64Array.of(0),
  };
}

describe("ElementMaterialField — Phase A infrastructure", () => {
  it("single-bin field K equals no-field K bit-identically (C3D4)", async () => {
    const mesh = generateBoxMeshC3D4(0, 0, 0, 4, 4, 4, 3, 3, 3);
    const plain = await assembleK(mesh, ISO, "serial");
    const fielded = await assembleK(mesh, ISO, "serial", undefined, uniformField(mesh, ISO));
    expect(fielded.K.data.length).toBe(plain.K.data.length);
    for (let i = 0; i < plain.K.data.length; i++) {
      expect(fielded.K.data[i]).toBe(plain.K.data[i]);
    }
  });

  it("single-bin field K equals no-field K bit-identically (C3D10)", async () => {
    const mesh = generateBoxMeshC3D10(0, 0, 0, 4, 4, 4, 2, 2, 2);
    const plain = await assembleK(mesh, ORTHO, "serial");
    const fielded = await assembleK(mesh, ORTHO, "serial", undefined, uniformField(mesh, ORTHO));
    for (let i = 0; i < plain.K.data.length; i++) {
      expect(fielded.K.data[i]).toBe(plain.K.data[i]);
    }
  });

  it("all-bin-1 field with C1 = 2·C0 doubles K exactly", async () => {
    const mesh = generateBoxMeshC3D4(0, 0, 0, 4, 4, 4, 3, 3, 3);
    const C0 = buildAnyConstitutiveMatrix(ISO);
    const Cs = new Float64Array(72);
    Cs.set(C0, 0);
    for (let i = 0; i < 36; i++) Cs[36 + i] = 2 * (C0[i] ?? 0);
    const field: ElementMaterialField = {
      binCount: 2,
      binOfElement: new Int32Array(mesh.elementCount).fill(1),
      C: Cs,
      yieldXY: Float64Array.of(50, 50),
      yieldZ: Float64Array.of(50, 50),
      massRho: Float64Array.of(1240, 1240),
      shellFrac: Float64Array.of(0, 1),
    };
    const plain = await assembleK(mesh, ISO, "serial");
    const doubled = await assembleK(mesh, ISO, "serial", undefined, field);
    for (let i = 0; i < plain.K.data.length; i++) {
      expect(doubled.K.data[i]).toBeCloseTo(2 * (plain.K.data[i] ?? 0), 10);
    }
  });

  it("binOfElement length mismatch throws", async () => {
    const mesh = generateBoxMeshC3D4(0, 0, 0, 2, 2, 2, 1, 1, 1);
    const bad = { ...uniformField(mesh, ISO), binOfElement: new Int32Array(1) };
    await expect(assembleK(mesh, ISO, "serial", undefined, bad)).rejects.toThrow(/binOfElement length/);
  });

  it("recoverElementStress: single-bin field matches no-field results", () => {
    const mesh = generateBoxMeshC3D4(0, 0, 0, 4, 4, 4, 2, 2, 2);
    // Uniform uniaxial strain field: ux = 0.01·x → identical stress everywhere
    const u = new Float64Array(mesh.nodeCount * 3);
    for (let n = 0; n < mesh.nodeCount; n++) u[n * 3] = 0.01 * (mesh.nodes[n * 3] ?? 0);

    const plain = recoverElementStress(mesh, u, ORTHO);
    const fielded = recoverElementStress(mesh, u, ORTHO, uniformField(mesh, ORTHO));
    for (let e = 0; e < mesh.elementCount; e++) {
      expect(fielded.vonMises[e]).toBe(plain.vonMises[e]);
      expect(fielded.safetyFactor[e]).toBe(plain.safetyFactor[e]);
    }
    expect(fielded.minSF).toBe(plain.minSF);
  });

  it("recoverElementStress: per-bin yield scales element SF; governingElement is argmin", () => {
    const mesh = generateBoxMeshC3D4(0, 0, 0, 4, 4, 4, 2, 2, 2);
    const u = new Float64Array(mesh.nodeCount * 3);
    for (let n = 0; n < mesh.nodeCount; n++) u[n * 3] = 0.01 * (mesh.nodes[n * 3] ?? 0);

    // Same C in both bins, half yield in bin 1 → SF halves for bin-1 elements.
    const C0 = buildAnyConstitutiveMatrix(ORTHO);
    const Cs = new Float64Array(72);
    Cs.set(C0, 0); Cs.set(C0, 36);
    const bins = new Int32Array(mesh.elementCount);
    for (let e = 0; e < mesh.elementCount; e++) bins[e] = e % 2;
    const field: ElementMaterialField = {
      binCount: 2,
      binOfElement: bins,
      C: Cs,
      yieldXY: Float64Array.of(50, 25),
      yieldZ: Float64Array.of(30, 15),
      massRho: Float64Array.of(1240, 1240),
      shellFrac: Float64Array.of(1, 0),
    };
    const plain = recoverElementStress(mesh, u, ORTHO);
    const fielded = recoverElementStress(mesh, u, ORTHO, field);
    for (let e = 0; e < mesh.elementCount; e++) {
      const expected = (e % 2 === 0)
        ? (plain.safetyFactor[e] ?? 0)
        : (plain.safetyFactor[e] ?? 0) / 2;
      expect(fielded.safetyFactor[e]).toBeCloseTo(expected, 10);
    }
    // Governing element must be the argmin of the fielded SF array
    let minSF = Infinity, argmin = 0;
    for (let e = 0; e < mesh.elementCount; e++) {
      if ((fielded.safetyFactor[e] ?? 999) < minSF) { minSF = fielded.safetyFactor[e] ?? 999; argmin = e; }
    }
    expect(fielded.governingElement).toBe(argmin);
    expect(fielded.minSF).toBeCloseTo(minSF, 12);
  });

  it("assembleMass: 2-bin density field gives total mass Σ ρ_bin·V_bin (C3D4 lumped)", () => {
    // 10×10×10 mm box, 2×2×2 hexes → 24 conforming tets of equal volume share
    const mesh = generateBoxMeshC3D4(0, 0, 0, 10, 10, 10, 2, 2, 2);
    const RHO0 = 1000, RHO1 = 2000; // kg/m³
    const bins = new Int32Array(mesh.elementCount);
    for (let e = 0; e < mesh.elementCount; e++) bins[e] = e % 2;
    const field: ElementMaterialField = {
      binCount: 2,
      binOfElement: bins,
      C: buildAnyConstitutiveMatrix(ISO),
      yieldXY: Float64Array.of(50, 50),
      yieldZ: Float64Array.of(50, 50),
      massRho: Float64Array.of(RHO0, RHO1),
      shellFrac: Float64Array.of(0, 1),
    };
    const lumped = assembleMass(mesh, ISO, "lumped", undefined, field) as Float64Array;
    let total = 0;
    for (let n = 0; n < mesh.nodeCount; n++) total += lumped[n * 3] ?? 0; // x-direction masses

    // Expected: per-element V × ρ_bin. Volumes via the shared tet-volume formula.
    let expected = 0;
    for (let e = 0; e < mesh.elementCount; e++) {
      const b = e * 4;
      const [n0, n1, n2, n3] = [mesh.elements[b]!, mesh.elements[b + 1]!, mesh.elements[b + 2]!, mesh.elements[b + 3]!];
      const ax = mesh.nodes[n0 * 3]!, ay = mesh.nodes[n0 * 3 + 1]!, az = mesh.nodes[n0 * 3 + 2]!;
      const bx = mesh.nodes[n1 * 3]!, by = mesh.nodes[n1 * 3 + 1]!, bz = mesh.nodes[n1 * 3 + 2]!;
      const cx = mesh.nodes[n2 * 3]!, cy = mesh.nodes[n2 * 3 + 1]!, cz = mesh.nodes[n2 * 3 + 2]!;
      const dx = mesh.nodes[n3 * 3]!, dy = mesh.nodes[n3 * 3 + 1]!, dz = mesh.nodes[n3 * 3 + 2]!;
      const v = Math.abs(
        (bx - ax) * ((cy - ay) * (dz - az) - (cz - az) * (dy - ay)) -
        (by - ay) * ((cx - ax) * (dz - az) - (cz - az) * (dx - ax)) +
        (bz - az) * ((cx - ax) * (dy - ay) - (cy - ay) * (dx - ax))
      ) / 6;
      expected += v * (e % 2 === 0 ? RHO0 : RHO1) * 1e-12; // kg/m³ → t/mm³
    }
    expect(total).toBeCloseTo(expected, 12);
    // And it must differ from the uniform-material mass (sanity: field applied)
    const uniform = assembleMass(mesh, ISO, "lumped") as Float64Array;
    let totalUniform = 0;
    for (let n = 0; n < mesh.nodeCount; n++) totalUniform += uniform[n * 3] ?? 0;
    expect(Math.abs(total - totalUniform)).toBeGreaterThan(1e-15);
  });
});
