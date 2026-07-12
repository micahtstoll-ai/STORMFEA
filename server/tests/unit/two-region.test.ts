/**
 * two-region.test.ts
 * ------------------
 * buildTwoRegionField (Phase C): shell/core binning, degenerate collapses,
 * and the volume-weighted average material.
 */

import { describe, it, expect } from "vitest";
import { buildTwoRegionField, TWO_REGION_BIN_COUNT } from "../../twoRegion.js";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import { buildAnyConstitutiveMatrix } from "../../solver/element.js";
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

describe("true Voigt matrix blending (anisotropic core)", () => {
  // Core with a DIFFERENT E_z/E_xy ratio than the shell — the anisotropic
  // lattice families produce exactly this (walls25d inverts the anisotropy),
  // and engineering-constant blending would NOT equal the matrix blend here.
  const CORE_ANISO: OrthotropicMaterial = {
    kind: "orthotropic",
    E_xy: 200, E_z: 900, nu_xy: 0.35, nu_xz: 0.10, G_xz: 80,
    yieldXY: 8, yieldZ: 5, label: "core (inverted anisotropy)", massRho: 200,
  };

  it("endpoint bins equal the endpoint matrices bit-for-bit", () => {
    const tr = buildTwoRegionField(mesh, faces, SHELL, CORE_ANISO, 1.35);
    const f = tr.field!;
    const N = f.binCount;
    const Cshell = buildAnyConstitutiveMatrix(SHELL);
    const Ccore = buildAnyConstitutiveMatrix(CORE_ANISO);
    for (let i = 0; i < 36; i++) {
      expect(f.C[0 * 36 + i]).toBe(Ccore[i]!);
      expect(f.C[(N - 1) * 36 + i]).toBe(Cshell[i]!);
    }
  });

  it("mid bin is the entrywise mean of the endpoint matrices", () => {
    const tr = buildTwoRegionField(mesh, faces, SHELL, CORE_ANISO, 1.35);
    const f = tr.field!;
    const mid = (f.binCount - 1) / 2;
    const Cshell = buildAnyConstitutiveMatrix(SHELL);
    const Ccore = buildAnyConstitutiveMatrix(CORE_ANISO);
    for (let i = 0; i < 36; i++) {
      expect(f.C[mid * 36 + i]).toBeCloseTo((Cshell[i]! + Ccore[i]!) / 2, 10);
    }
  });
});

describe("anchor policy: implied average vs legacy global multiplier", () => {
  // The endpoints agree by construction; the interior DIVERGES in two ways,
  // both deliberate (report, never renormalize):
  //  1. The Gibson-Ashby strength law credits low-ρ infill less than the
  //     legacy linear curve (s(0.2) = 0.2^1.5 ≈ 0.089 vs linear 0.20), so
  //     implied < global wherever the core matters.
  //  2. The legacy model's geometry-blind +0.10-per-wall bonus under-credits
  //     wall-dominated thin sections, so implied > global there.
  const INFILL = 20, WALLS = 2, PATTERN = "grid", ORIENT = "flat";
  const LINE_W = 0.45;
  const T_WALL = WALLS * LINE_W; // 0.9mm

  async function impliedFor(bx: number, by: number, bz: number, nx: number, ny: number, nz: number) {
    const { effectiveStrengthMultiplier, coreStrengthMultiplier, orientationMultiplier } =
      await import("../../analysis.js");
    const m = generateBoxMeshC3D4(0, 0, 0, bx, by, bz, nx, ny, nz);
    const f = extractSurfaceFaces(m);
    const tr = buildTwoRegionField(m, f, SHELL, CORE, T_WALL);
    const Vf = tr.shellVolumeFraction;
    const coreLattice = coreStrengthMultiplier(INFILL, PATTERN, ORIENT) / orientationMultiplier(ORIENT);
    const implied = (Vf + (1 - Vf) * coreLattice) * orientationMultiplier(ORIENT);
    const global = effectiveStrengthMultiplier(INFILL, WALLS, PATTERN, ORIENT);
    return { Vf, implied, global };
  }

  it("chunky coupon section (20×6): implied BELOW global but within 25% (GA law credits low-ρ infill less)", async () => {
    // Derivation at 20% grid flat, Vf ≈ 0.38: s(0.2) = 0.2^1.5 ≈ 0.089, so
    // implied ≈ (0.38 + 0.62·0.089)·0.55 ≈ 0.24 vs global 0.297 → ~17% below.
    // Under the legacy linear core (s = 0.20) this was ~11%; the widening is
    // the power law's statement, not drift to be renormalized away.
    const { Vf, implied, global } = await impliedFor(60, 20, 6, 30, 10, 3);
    expect(Vf).toBeGreaterThan(0.2);
    expect(Vf).toBeLessThan(0.6);
    expect(implied).toBeLessThan(global);
    expect(Math.abs(implied - global) / global).toBeLessThan(0.25);
  });

  it("wall-dominated thin coupon (10×4): implied EXCEEDS global (legacy under-credits walls)", async () => {
    // Vf ≈ 0.57 dominates: implied ≈ (0.57 + 0.43·0.089)·0.55 ≈ 0.33 vs
    // global 0.297 — the wall effect outweighs the GA infill knockdown.
    const { Vf, implied, global } = await impliedFor(50, 10, 4, 25, 5, 2);
    expect(Vf).toBeGreaterThan(0.45); // walls are ~half the section
    expect(implied).toBeGreaterThan(global * 1.05);
  });
});
