/**
 * two-region.test.ts
 * ------------------
 * buildTwoRegionField (Phase C): shell/core binning, degenerate collapses,
 * and the volume-weighted average material.
 */

import { describe, it, expect } from "vitest";
import { buildTwoRegionField, buildWallBondField, TWO_REGION_BIN_COUNT } from "../../twoRegion.js";
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
    // Interlaminar shear allowable follows the same blend; endpoints without
    // an explicit yieldZShear derive it as yieldZ/√3 (legacy Hill equivalence)
    const zsShell = SHELL.yieldZ / Math.sqrt(3);
    const zsCore  = CORE.yieldZ / Math.sqrt(3);
    expect(f.yieldZShear[0]).toBeCloseTo(zsCore, 12);
    expect(f.yieldZShear[N - 1]).toBeCloseTo(zsShell, 12);
    expect(f.yieldZShear[mid]).toBeCloseTo((zsShell + zsCore) / 2, 12);
    expect(f.massRho[0]).toBeCloseTo(CORE.massRho!, 12);
    expect(f.massRho[N - 1]).toBeCloseTo(SHELL.massRho!, 12);
    expect(f.shellFrac[0]).toBe(0);
    expect(f.shellFrac[N - 1]).toBe(1);
  });

  it("explicit endpoint yieldZShear values blend instead of the derived default", () => {
    const shellZS: OrthotropicMaterial = { ...SHELL, yieldZShear: 20 };
    const coreZS:  OrthotropicMaterial = { ...CORE,  yieldZShear: 4 };
    const tr = buildTwoRegionField(mesh, faces, shellZS, coreZS, 1.35);
    const f = tr.field!;
    expect(f.yieldZShear[0]).toBe(4);
    expect(f.yieldZShear[f.binCount - 1]).toBe(20);
    expect(tr.averageMaterial.yieldZShear).toBeCloseTo(
      tr.shellVolumeFraction * 20 + (1 - tr.shellVolumeFraction) * 4, 10);
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

describe("buildWallBondField", () => {
  const LINE_WIDTH = 0.45;

  it("returns null for wallCount < 2 (no internal loop boundary — flag-off no-op)", () => {
    expect(buildWallBondField(mesh, faces, LINE_WIDTH, 1, 27.5, 15.9)).toBeNull();
    expect(buildWallBondField(mesh, faces, LINE_WIDTH, 0, 27.5, 15.9)).toBeNull();
  });

  it("returns null for lineWidth <= 0", () => {
    expect(buildWallBondField(mesh, faces, 0, 3, 27.5, 15.9)).toBeNull();
  });

  it("produces a field with unit-or-zero normals and [0,1] interior fractions for wallCount>=2", () => {
    const wb = buildWallBondField(mesh, faces, LINE_WIDTH, 3, 27.5, 15.9);
    expect(wb).not.toBeNull();
    expect(wb!.wallNormal.length).toBe(mesh.elementCount * 3);
    expect(wb!.wallInteriorFrac.length).toBe(mesh.elementCount);
    expect(wb!.yieldWallMPa).toBe(27.5);
    expect(wb!.yieldWallShearMPa).toBe(15.9);
    let sawInterior = false;
    for (let e = 0; e < mesh.elementCount; e++) {
      const nx = wb!.wallNormal[e * 3] ?? 0, ny = wb!.wallNormal[e * 3 + 1] ?? 0, nz = wb!.wallNormal[e * 3 + 2] ?? 0;
      const len = Math.hypot(nx, ny, nz);
      expect(Number.isFinite(len)).toBe(true);
      expect(len).toBeLessThanOrEqual(1 + 1e-9);
      const frac = wb!.wallInteriorFrac[e] ?? 0;
      expect(Number.isFinite(frac)).toBe(true);
      expect(frac).toBeGreaterThanOrEqual(0);
      expect(frac).toBeLessThanOrEqual(1);
      if (frac > 0) sawInterior = true;
    }
    expect(sawInterior).toBe(true);
  });

  it("elements with nonzero wallInteriorFrac have a nonzero (unit) wallNormal", () => {
    const wb = buildWallBondField(mesh, faces, LINE_WIDTH, 3, 27.5, 15.9)!;
    for (let e = 0; e < mesh.elementCount; e++) {
      if ((wb.wallInteriorFrac[e] ?? 0) > 0.01) {
        const nx = wb.wallNormal[e * 3] ?? 0, ny = wb.wallNormal[e * 3 + 1] ?? 0, nz = wb.wallNormal[e * 3 + 2] ?? 0;
        expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 6);
      }
    }
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

  it("every bin blends the endpoint matrices at its own shellFrac (spacing-agnostic)", () => {
    // CORE_ANISO's ~17.5× in-plane contrast trips adaptive log-spacing, so the
    // middle-INDEX bin is no longer the arithmetic mean — but each bin b must
    // still be exactly f_b·C_shell + (1−f_b)·C_core at its stored fraction.
    const tr = buildTwoRegionField(mesh, faces, SHELL, CORE_ANISO, 1.35);
    const f = tr.field!;
    const Cshell = buildAnyConstitutiveMatrix(SHELL);
    const Ccore = buildAnyConstitutiveMatrix(CORE_ANISO);
    for (let b = 0; b < f.binCount; b++) {
      const fr = f.shellFrac[b]!;
      for (let i = 0; i < 36; i++) {
        expect(f.C[b * 36 + i]).toBeCloseTo(fr * Cshell[i]! + (1 - fr) * Ccore[i]!, 9);
      }
    }
  });
});

describe("adaptive log-spaced binning at high contrast (issue #178)", () => {
  // ~1000:1 shell:core stiffness — the near-zero-infill (floored lattice) core
  // whose 9 LINEAR bins put a ~126× step on the first interval.
  const CORE_HI: OrthotropicMaterial = {
    kind: "orthotropic",
    E_xy: 3.5, E_z: 1.575, nu_xy: 0.35, nu_xz: 0.35, G_xz: 0.52,
    yieldXY: 0.05, yieldZ: 0.0275, label: "core (0.1% — floored lattice)", massRho: 2,
  };
  const DIAG = [0, 7, 14, 21, 28, 35];

  it("grows the bin count past the legacy 9 and bounds every adjacent-bin stiffness step to ~2×", () => {
    const tr = buildTwoRegionField(mesh, faces, SHELL, CORE_HI, 1.35);
    const f = tr.field!;
    expect(f.binCount).toBeGreaterThan(TWO_REGION_BIN_COUNT);
    for (let b = 1; b < f.binCount; b++) {
      for (const i of DIAG) {
        const prev = f.C[(b - 1) * 36 + i]!;
        const cur = f.C[b * 36 + i]!;
        if (prev > 1e-30) expect(cur / prev).toBeLessThanOrEqual(2 + 1e-9);
      }
    }
  });

  it("endpoints stay bit-identical: pure-core & pure-shell bins equal the endpoint matrices", () => {
    const tr = buildTwoRegionField(mesh, faces, SHELL, CORE_HI, 1.35);
    const f = tr.field!;
    const N = f.binCount;
    const Cshell = buildAnyConstitutiveMatrix(SHELL);
    const Ccore = buildAnyConstitutiveMatrix(CORE_HI);
    for (let i = 0; i < 36; i++) {
      expect(f.C[0 * 36 + i]).toBe(Ccore[i]!);       // f = 0 exactly
      expect(f.C[(N - 1) * 36 + i]).toBe(Cshell[i]!); // f = 1 exactly
    }
    expect(f.shellFrac[0]).toBe(0);
    expect(f.shellFrac[N - 1]).toBe(1);
  });

  it("retains LINEAR 9-bin spacing at low contrast (bit-identical to legacy)", () => {
    // SHELL/CORE contrast ≈ 5 → linear N=9, mid-INDEX bin at f = 0.5.
    const tr = buildTwoRegionField(mesh, faces, SHELL, CORE, 1.35);
    const f = tr.field!;
    expect(f.binCount).toBe(TWO_REGION_BIN_COUNT);
    expect(f.shellFrac[(f.binCount - 1) / 2]).toBeCloseTo(0.5, 12);
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
    const { materialStrengthMultiplier, coreStrengthMultiplier } =
      await import("../../analysis.js");
    const m = generateBoxMeshC3D4(0, 0, 0, bx, by, bz, nx, ny, nz);
    const f = extractSurfaceFaces(m);
    const tr = buildTwoRegionField(m, f, SHELL, CORE, T_WALL);
    const Vf = tr.shellVolumeFraction;
    // Orientation-free on both sides (audit A4): flat carries no fallback
    // scalar, so implied and global compare pure section/lattice models.
    const coreLattice = coreStrengthMultiplier(INFILL, PATTERN);
    const implied = Vf + (1 - Vf) * coreLattice;
    const global = materialStrengthMultiplier(INFILL, WALLS, PATTERN);
    return { Vf, implied, global };
  }

  it("chunky coupon section (20×6): implied BELOW global but within 25% (GA law credits low-ρ infill less)", async () => {
    // Derivation at 20% grid, Vf ≈ 0.38: s(0.2) = 0.2^1.5 ≈ 0.089, so
    // implied ≈ 0.38 + 0.62·0.089 ≈ 0.44 vs global 0.54 → ~17% below.
    // (The legacy 0.55 orientation factor multiplied BOTH sides, so the
    // relative gap is unchanged by its removal — audit A4.)
    // Under the legacy linear core (s = 0.20) this was ~11%; the widening is
    // the power law's statement, not drift to be renormalized away.
    const { Vf, implied, global } = await impliedFor(60, 20, 6, 30, 10, 3);
    expect(Vf).toBeGreaterThan(0.2);
    expect(Vf).toBeLessThan(0.6);
    expect(implied).toBeLessThan(global);
    expect(Math.abs(implied - global) / global).toBeLessThan(0.25);
  });

  it("wall-dominated thin coupon (10×4): implied EXCEEDS global (legacy under-credits walls)", async () => {
    // Vf ≈ 0.57 dominates: implied ≈ 0.57 + 0.43·0.089 ≈ 0.61 vs
    // global 0.54 — the wall effect outweighs the GA infill knockdown.
    const { Vf, implied, global } = await impliedFor(50, 10, 4, 25, 5, 2);
    expect(Vf).toBeGreaterThan(0.45); // walls are ~half the section
    expect(implied).toBeGreaterThan(global * 1.05);
  });
});
