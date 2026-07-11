/**
 * two-region.test.ts
 * ------------------
 * buildTwoRegionField (Phase C): shell/core binning, degenerate collapses,
 * and the volume-weighted average material.
 */

import { describe, it, expect } from "vitest";
import { buildTwoRegionField, TWO_REGION_BIN_COUNT } from "../../twoRegion.js";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import type { OrthotropicMaterial } from "../../solver/types.js";

const SHELL: OrthotropicMaterial = {
  kind: "orthotropic",
  E_xy: 3500, E_z: 1575, nu_xy: 0.35, nu_xz: 0.35, G_xz: 520,
  yieldXY: 50, yieldZ: 27.5, label: "shell (solid)", massRho: 1240,
};

const CORE: OrthotropicMaterial = {
  kind: "orthotropic",
  E_xy: 700, E_z: 315, nu_xy: 0.35, nu_xz: 0.35, G_xz: 104,
  yieldXY: 10, yieldZ: 5.5, label: "core (20% lattice)", massRho: 248,
};

// 20×12×8 mm box, 2 mm elements
const mesh = generateBoxMeshC3D4(0, 0, 0, 20, 12, 8, 10, 6, 4);
const faces = extractSurfaceFaces(mesh);

describe("buildTwoRegionField", () => {
  it("classifies a box into a mixed field with a plausible shell fraction", () => {
    const T_WALL = 1.35;
    const tr = buildTwoRegionField(mesh, faces, SHELL, CORE, T_WALL);
    expect(tr.field).not.toBeNull();
    const field = tr.field!;
    expect(field.binCount).toBe(TWO_REGION_BIN_COUNT);
    expect(field.binOfElement.length).toBe(mesh.elementCount);
    for (let e = 0; e < mesh.elementCount; e++) {
      expect(field.binOfElement[e]).toBeGreaterThanOrEqual(0);
      expect(field.binOfElement[e]).toBeLessThan(field.binCount);
    }
    // Analytic band fraction of the box (inner-box subtraction is exact)
    const outer = 20 * 12 * 8;
    const inner = (20 - 2 * T_WALL) * (12 - 2 * T_WALL) * (8 - 2 * T_WALL);
    const analytic = (outer - inner) / outer;
    expect(Math.abs(tr.shellVolumeFraction - analytic) / analytic).toBeLessThan(0.05);
    // Mixed: some pure-core elements and some (partially) shell elements
    let sawCore = false, sawShellish = false;
    for (let e = 0; e < mesh.elementCount; e++) {
      if (field.binOfElement[e] === 0) sawCore = true;
      if ((field.binOfElement[e] ?? 0) > 0) sawShellish = true;
    }
    expect(sawCore).toBe(true);
    expect(sawShellish).toBe(true);
  });

  it("bin properties interpolate shell↔core linearly", () => {
    const tr = buildTwoRegionField(mesh, faces, SHELL, CORE, 1.35);
    const f = tr.field!;
    const N = f.binCount;
    expect(f.yieldXY[0]).toBeCloseTo(CORE.yieldXY, 12);       // bin 0 = pure core
    expect(f.yieldXY[N - 1]).toBeCloseTo(SHELL.yieldXY, 12);  // last bin = pure shell
    const mid = (N - 1) / 2;
    expect(f.yieldXY[mid]).toBeCloseTo((SHELL.yieldXY + CORE.yieldXY) / 2, 12);
    expect(f.massRho[0]).toBeCloseTo(CORE.massRho!, 12);
    expect(f.massRho[N - 1]).toBeCloseTo(SHELL.massRho!, 12);
    expect(f.shellFrac[0]).toBe(0);
    expect(f.shellFrac[N - 1]).toBe(1);
  });

  it("average material is the Vf-weighted blend", () => {
    const tr = buildTwoRegionField(mesh, faces, SHELL, CORE, 1.35);
    const Vf = tr.shellVolumeFraction;
    expect(tr.averageMaterial.E_xy).toBeCloseTo(Vf * SHELL.E_xy + (1 - Vf) * CORE.E_xy, 8);
    expect(tr.averageMaterial.yieldXY).toBeCloseTo(Vf * SHELL.yieldXY + (1 - Vf) * CORE.yieldXY, 8);
    expect(tr.averageMaterial.massRho).toBeCloseTo(Vf * SHELL.massRho! + (1 - Vf) * CORE.massRho!, 8);
  });

  it("tWall = 0 collapses to uniform core", () => {
    const tr = buildTwoRegionField(mesh, faces, SHELL, CORE, 0);
    expect(tr.field).toBeNull();
    expect(tr.shellVolumeFraction).toBe(0);
    expect(tr.averageMaterial.yieldXY).toBeCloseTo(CORE.yieldXY, 12);
    expect(tr.averageMaterial.E_xy).toBeCloseTo(CORE.E_xy, 12);
  });

  it("huge tWall (thin part) collapses to uniform shell", () => {
    // Box min half-dimension is 4mm; a 10mm band swallows everything.
    const tr = buildTwoRegionField(mesh, faces, SHELL, CORE, 10);
    expect(tr.field).toBeNull();
    expect(tr.shellVolumeFraction).toBeCloseTo(1, 9);
    expect(tr.averageMaterial.yieldXY).toBeCloseTo(SHELL.yieldXY, 12);
  });

  it("shell ≡ core (100% infill) collapses to uniform", () => {
    const tr = buildTwoRegionField(mesh, faces, SHELL, { ...SHELL, label: "core=shell" }, 1.35);
    expect(tr.field).toBeNull();
    expect(tr.averageMaterial.E_xy).toBeCloseTo(SHELL.E_xy, 12);
  });

  it("weakAxis is carried onto blends when the shell has one", () => {
    const shellW: OrthotropicMaterial = { ...SHELL, weakAxis: [0, 0, 1] as const };
    const coreW: OrthotropicMaterial = { ...CORE, weakAxis: [0, 0, 1] as const };
    const tr = buildTwoRegionField(mesh, faces, shellW, coreW, 1.35);
    expect(tr.averageMaterial.weakAxis).toEqual([0, 0, 1]);
  });
});
