/**
 * taguchi-two-region.test.ts
 * --------------------------
 * Taguchi L9 orthogonal-array sweep of the two-region material model.
 *
 * Four factors at three levels each, nine runs (each level of each factor
 * appears exactly three times, balanced against every other factor):
 *
 *   A  infillPct    10 / 40 / 80 %
 *   B  wallCount    1 / 3 / 5      (wall band = wallCount × 0.45 mm)
 *   C  pattern      grid / gyroid / lines
 *   D  orientation  flat / angled / upright
 *
 * Two kinds of assertion:
 *  1. Per-run invariants that must hold at EVERY point of the parameter space
 *     (shell stronger than core, bins monotone, averages bounded, no NaN).
 *  2. Taguchi main effects — level means across the balanced array must move
 *     the physically expected direction (more infill → stronger implied
 *     average; more walls → larger shell fraction; better orientation →
 *     stronger), which catches sign errors and factor mix-ups that any single
 *     hand-picked configuration would miss.
 *
 * Plus one mid-array smoke solve so a representative mixed field goes through
 * the full static pipeline.
 */

import { describe, it, expect } from "vitest";
import { buildTwoRegionField } from "../../twoRegion.js";
import {
  buildCoreMaterial,
  buildOrthotropicMaterial,
  angledNoBedFallbackMul,
} from "../../analysis.js";
import { latticeStrengthFraction } from "../../solver/lattice.js";
import { generateBoxMeshC3D4, extractSurfaceFaces } from "../../solver/meshgen.js";
import { runLinearStatic } from "../../solver/pipeline.js";
import type { OrthotropicMaterial } from "../../solver/types.js";

const LINE_W = 0.45;
const LH = 0.2;
const MAT_ID = "pla";

const INFILL = [10, 40, 80] as const;              // factor A
const WALLS = [1, 3, 5] as const;                  // factor B
const PATTERN = ["grid", "gyroid", "lines"] as const;   // factor C
const ORIENT = ["flat", "angled", "upright"] as const;  // factor D

// Standard L9(3^4) orthogonal array (1-indexed levels)
const L9: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 1, 1, 1],
  [1, 2, 2, 2],
  [1, 3, 3, 3],
  [2, 1, 2, 3],
  [2, 2, 3, 1],
  [2, 3, 1, 2],
  [3, 1, 3, 2],
  [3, 2, 1, 3],
  [3, 3, 2, 1],
];

// Specimen: 40×20×10 mm block, 2 mm elements — thick enough that even the
// 5-wall (2.25 mm) band leaves a real core (interior depth reaches 5 mm).
const mesh = generateBoxMeshC3D4(0, 0, 0, 40, 20, 10, 20, 10, 5);
const faces = extractSurfaceFaces(mesh);

interface RunResult {
  run: number;
  levels: readonly [number, number, number, number];
  shell: OrthotropicMaterial;
  core: OrthotropicMaterial;
  Vf: number;
  fieldBins: number | null;
  implied: number; // implied average strength multiplier
  binYieldsMonotone: boolean;
  avgBounded: boolean;
  allFinite: boolean;
}

function executeRun(run: number, levels: readonly [number, number, number, number]): RunResult {
  const infill = INFILL[levels[0] - 1]!;
  const walls = WALLS[levels[1] - 1]!;
  const pattern = PATTERN[levels[2] - 1]!;
  const orient = ORIENT[levels[3] - 1]!;

  // Production convention (audit A4): shell at full strength (mul = 1.0) —
  // orientation is the criterion's job; the builder applies the angled-no-bed
  // 0.75 fallback itself when applicable.
  const shell: OrthotropicMaterial = {
    ...buildOrthotropicMaterial(MAT_ID, 1.0, orient, LH, null, null),
    massRho: 1240,
  };
  // The REAL production core builder (per-axis Gibson-Ashby laws applied in
  // the natural frame, upright scalar swap, Poisson guard) — no test-local
  // mirror to drift out of sync with analysis.ts.
  const sStr = latticeStrengthFraction(pattern, infill / 100);
  const core = buildCoreMaterial(MAT_ID, infill, pattern, orient, LH, null, false, undefined, null);

  const tWall = walls * LINE_W;
  const tr = buildTwoRegionField(mesh, faces, shell, core, tWall);
  const Vf = tr.shellVolumeFraction;

  const lattice = sStr; // s(ρ) = min(1, patternMul·ρ^m)
  const implied = (Vf + (1 - Vf) * lattice) * angledNoBedFallbackMul(orient, null);

  let binYieldsMonotone = true;
  let allFinite = Number.isFinite(Vf) && Number.isFinite(implied);
  if (tr.field) {
    const f = tr.field;
    for (let b = 1; b < f.binCount; b++) {
      if ((f.yieldXY[b] ?? 0) < (f.yieldXY[b - 1] ?? 0) - 1e-12) binYieldsMonotone = false;
    }
    for (let b = 0; b < f.binCount; b++) {
      if (!Number.isFinite(f.yieldXY[b] ?? NaN) || !Number.isFinite(f.massRho[b] ?? NaN)) allFinite = false;
    }
    for (let i = 0; i < f.C.length; i++) {
      if (!Number.isFinite(f.C[i] ?? NaN)) { allFinite = false; break; }
    }
  }

  const avg = tr.averageMaterial;
  const eps = 1e-9;
  const avgBounded =
    avg.yieldXY >= Math.min(shell.yieldXY, core.yieldXY) - eps &&
    avg.yieldXY <= Math.max(shell.yieldXY, core.yieldXY) + eps &&
    avg.E_xy >= Math.min(shell.E_xy, core.E_xy) - eps &&
    avg.E_xy <= Math.max(shell.E_xy, core.E_xy) + eps;

  return {
    run, levels, shell, core, Vf,
    fieldBins: tr.field ? tr.field.binCount : null,
    implied, binYieldsMonotone, avgBounded, allFinite,
  };
}

const results: RunResult[] = L9.map((levels, i) => executeRun(i + 1, levels));

describe("Taguchi L9 sweep — per-run invariants", () => {
  it.each(results.map(r => [r.run, r] as const))(
    "run %i: shell > core, mixed field, monotone bins, bounded average, finite",
    (_run, r) => {
      // Shell must strictly out-YIELD the wall-free lattice at every point of
      // the array (infill ≤ 80% keeps s(ρ) = min(1, patternMul·ρ^m) < 1).
      // Stiffness is now strict too: g(ρ) = ρ^n·(1−c(1−ρ)) < 1 for every
      // ρ < 1, and orientation no longer enters core stiffness (the legacy
      // min(1, mul/0.55) clamp let a dense core in a favorable orientation
      // match shell E — runs 7 and 8 under the old model).
      expect(r.shell.yieldXY).toBeGreaterThan(r.core.yieldXY);
      expect(r.shell.E_xy).toBeGreaterThan(r.core.E_xy);
      // Specimen is thick enough that every run stays a genuine two-region mix
      expect(r.Vf).toBeGreaterThan(0.05);
      expect(r.Vf).toBeLessThan(0.95);
      expect(r.fieldBins).toBe(9);
      expect(r.binYieldsMonotone).toBe(true);
      expect(r.avgBounded).toBe(true);
      expect(r.allFinite).toBe(true);
      // Implied average multiplier can never exceed the solid (the only
      // orientation scalar left is the angled-no-bed fallback — audit A4)
      const fallbackMul = angledNoBedFallbackMul(ORIENT[r.levels[3] - 1]!, null);
      expect(r.implied).toBeLessThanOrEqual(fallbackMul + 1e-12);
      expect(r.implied).toBeGreaterThan(0);
    },
  );
});

describe("Taguchi L9 sweep — main effects (level means, balanced array)", () => {
  const meanWhere = (factor: number, level: number, get: (r: RunResult) => number) => {
    const rs = results.filter(r => r.levels[factor] === level);
    return rs.reduce((a, r) => a + get(r), 0) / rs.length;
  };

  it("A (infill): mean implied strength multiplier strictly increases with infill", () => {
    const m = [1, 2, 3].map(l => meanWhere(0, l, r => r.implied));
    expect(m[1]).toBeGreaterThan(m[0]!);
    expect(m[2]).toBeGreaterThan(m[1]!);
  });

  it("B (walls): mean shell volume fraction strictly increases with wall count", () => {
    const m = [1, 2, 3].map(l => meanWhere(1, l, r => r.Vf));
    expect(m[1]).toBeGreaterThan(m[0]!);
    expect(m[2]).toBeGreaterThan(m[1]!);
  });

  it("D (orientation): no material scalar except the angled-no-bed fallback (audit A4)", () => {
    // Orientation no longer scales the solved material — the criterion
    // resolves direction. Deterministic builder-level lock instead of a
    // level-mean ordering (the old flat 0.55 < angled 0.75 < upright 0.90
    // ordering was the double-count this replaces):
    const flat    = buildOrthotropicMaterial(MAT_ID, 1.0, "flat",    LH, null, null);
    const angled  = buildOrthotropicMaterial(MAT_ID, 1.0, "angled",  LH, null, null);
    const upright = buildOrthotropicMaterial(MAT_ID, 1.0, "upright", LH, null, null);
    // Angled with no bed: no directional model exists → legacy 0.75 fallback
    expect(angled.yieldXY / flat.yieldXY).toBeCloseTo(0.75, 12);
    // Upright with no bed: conservative scalar SWAP (a relabeling), no extra penalty
    expect(upright.yieldXY).toBeCloseTo(flat.yieldZ, 12);
    expect(upright.yieldZ).toBeCloseTo(flat.yieldXY, 12);
    // Any picked bed face → exact tensor path, no scalar at all
    const angledBed = buildOrthotropicMaterial(MAT_ID, 1.0, "angled", LH, null, [0, Math.SQRT1_2, Math.SQRT1_2]);
    expect(angledBed.yieldXY).toBeCloseTo(flat.yieldXY, 12);
  });

  it("B (walls): mean implied multiplier increases with wall count (more solid shell)", () => {
    const m = [1, 2, 3].map(l => meanWhere(1, l, r => r.implied));
    expect(m[1]).toBeGreaterThan(m[0]!);
    expect(m[2]).toBeGreaterThan(m[1]!);
  });
});

describe("Taguchi L9 sweep — mid-array smoke solve", () => {
  it("run 5 (40% gyroid, 3 walls, flat) solves through the full static pipeline", async () => {
    const r5 = results[4]!;
    const solveMesh = generateBoxMeshC3D4(0, 0, 0, 40, 20, 10, 10, 5, 3);
    const solveFaces = extractSurfaceFaces(solveMesh);
    const tr = buildTwoRegionField(solveMesh, solveFaces, r5.shell, r5.core, WALLS[r5.levels[1] - 1]! * LINE_W);
    expect(tr.field).not.toBeNull();

    const fixed: number[] = [], tip: number[] = [];
    for (let n = 0; n < solveMesh.nodeCount; n++) {
      const x = solveMesh.nodes[n * 3] ?? 0;
      if (x < 1e-9) fixed.push(n);
      if (x > 40 - 1e-9) tip.push(n);
    }
    const res = await runLinearStatic({
      mesh: solveMesh,
      material: tr.averageMaterial,
      ...(tr.field ? { materialField: tr.field } : {}),
      constraints: [{ nodeIndices: fixed }],
      forces: tip.map(n => ({ nodeIndex: n, forceN: [0, 0, -50 / tip.length] as [number, number, number] })),
    });
    expect(res.converged).toBe(true);
    expect(Number.isFinite(res.maxVonMisesMPa)).toBe(true);
    expect(res.maxVonMisesMPa).toBeGreaterThan(0);
    expect(res.minSafetyFactor).toBeGreaterThan(0);
    expect(res.governingElement).toBeGreaterThanOrEqual(0);
    expect(res.governingElement!).toBeLessThan(solveMesh.elementCount);
    for (let i = 0; i < res.displacement.length; i++) {
      if (!Number.isFinite(res.displacement[i] ?? NaN)) {
        throw new Error(`non-finite displacement at DOF ${i}`);
      }
    }
  });
});
