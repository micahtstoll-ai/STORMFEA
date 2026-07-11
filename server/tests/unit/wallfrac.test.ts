/**
 * wallfrac.test.ts
 * ----------------
 * Level-set tet volume fractions + wall-band classification (two-region
 * material model, Phase B).
 */

import { describe, it, expect } from "vitest";
import { tetFractionBelowIso, computeWallFractions } from "../../solver/wallfrac.js";
import { computeNodeSurfaceDistances } from "../../solver/distance.js";
import { generateBoxMeshC3D4 } from "../../solver/meshgen.js";
import { extractSurfaceFaces } from "../../solver/meshgen.js";

describe("tetFractionBelowIso", () => {
  it("all corners on one side → 0 or 1", () => {
    expect(tetFractionBelowIso(1, 2, 3, 4)).toBe(0);
    expect(tetFractionBelowIso(-1, -2, -3, -4)).toBe(1);
    expect(tetFractionBelowIso(0, 0, 0, 0)).toBe(0); // φ=0 counts as non-negative
  });

  it("single negative corner: f = ∏ φ/(φ−φj) (analytic corner cases)", () => {
    // Symmetric: a=-1, others +1 → each t = 1/2 → f = 1/8
    expect(tetFractionBelowIso(-1, 1, 1, 1)).toBeCloseTo(1 / 8, 12);
    // Cut exactly through the three opposite vertices (φj = 0): f = 1
    expect(tetFractionBelowIso(-1, 0, 0, 0)).toBeCloseTo(1, 12);
  });

  it("three negative corners: complement of the single-positive corner", () => {
    expect(tetFractionBelowIso(1, -1, -1, -1)).toBeCloseTo(1 - 1 / 8, 12);
  });

  it("2-vs-2 symmetric mid-cut → exactly 1/2", () => {
    expect(tetFractionBelowIso(-1, -1, 1, 1)).toBeCloseTo(0.5, 12);
  });

  it("2-vs-2 asymmetric case matches the divided-difference identity", () => {
    // f = Σ_{φi<0} φi³/∏_{j≠i}(φi−φj), valid for distinct values
    const [a, b, c, d] = [-1, -2, 1, 3];
    const dd =
      a ** 3 / ((a - b) * (a - c) * (a - d)) +
      b ** 3 / ((b - a) * (b - c) * (b - d));
    expect(tetFractionBelowIso(a, b, c, d)).toBeCloseTo(dd, 12);
  });

  it("symmetry: f(φ) + f(−φ) = 1 for strictly-nonzero mixed sign patterns", () => {
    const cases: Array<[number, number, number, number]> = [
      [-1, 2, 3, 4],
      [-1, -2, 3, 4],
      [-1, -2, -3, 4],
      [-0.3, 0.7, -1.9, 2.4],
      [-5, 0.01, 0.02, 0.03],
    ];
    for (const [p0, p1, p2, p3] of cases) {
      const f = tetFractionBelowIso(p0, p1, p2, p3);
      const g = tetFractionBelowIso(-p0, -p1, -p2, -p3);
      expect(f + g).toBeCloseTo(1, 12);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it("corner exactly on the iso-surface produces finite output (no NaN)", () => {
    for (const c of [
      tetFractionBelowIso(-1, 0, 1, 1),
      tetFractionBelowIso(-1, -1, 0, 1),
      tetFractionBelowIso(-1, 0, 0, 1),
      tetFractionBelowIso(0, 0, 0, -1),
    ]) {
      expect(Number.isFinite(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it("continuity across the sign convention at a tied pair (regression)", () => {
    // Perturbing a zero corner slightly to either side must not jump
    const eps = 1e-9;
    const below = tetFractionBelowIso(-1, -eps, 1, 1);
    const above = tetFractionBelowIso(-1, +eps, 1, 1);
    expect(Math.abs(below - above)).toBeLessThan(1e-6);
  });
});

describe("computeNodeSurfaceDistances + computeWallFractions on a box", () => {
  // 20×12×8 mm box, fine enough grid that the band volume estimate is fair
  const mesh = generateBoxMeshC3D4(0, 0, 0, 20, 12, 8, 10, 6, 4);
  const faces = extractSurfaceFaces(mesh);
  const T_WALL = 1.35;
  const dist = computeNodeSurfaceDistances(mesh, faces, T_WALL + 6.0);

  it("every boundary node has distance exactly 0", () => {
    const onSurface = new Set<number>();
    for (let i = 0; i < faces.length; i++) onSurface.add(faces[i]!);
    for (const n of onSurface) expect(dist[n]).toBe(0);
  });

  it("interior node distances equal the analytic box wall distance", () => {
    // For a box, distance to surface = min distance to the 6 planes
    for (let n = 0; n < mesh.nodeCount; n++) {
      const x = mesh.nodes[n * 3]!, y = mesh.nodes[n * 3 + 1]!, z = mesh.nodes[n * 3 + 2]!;
      const analytic = Math.min(x, 20 - x, y, 12 - y, z, 8 - z);
      const clamped = Math.min(analytic, T_WALL + 6.0);
      expect(dist[n]).toBeCloseTo(clamped, 9);
    }
  });

  it("Σ wallFrac·Vₑ approximates the analytic band volume within 5%", () => {
    const frac = computeWallFractions(mesh, dist, T_WALL);
    let bandVol = 0;
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
      bandVol += (frac[e] ?? 0) * v;
    }
    // Analytic: V_box − V_inner where the inner box shrinks by tWall each side.
    // (Approximation: the true offset region of a box has no rounded corners
    // going inward, so inner-box subtraction is EXACT for the inward band.)
    const outer = 20 * 12 * 8;
    const inner = (20 - 2 * T_WALL) * (12 - 2 * T_WALL) * (8 - 2 * T_WALL);
    const analytic = outer - inner;
    expect(Math.abs(bandVol - analytic) / analytic).toBeLessThan(0.05);
  });

  it("tWall = 0 → all core; huge tWall → all shell", () => {
    const zero = computeWallFractions(mesh, dist, 0);
    expect(zero.every(v => v === 0)).toBe(true);
    const all = computeWallFractions(mesh, dist, 100);
    expect(all.every(v => v === 1)).toBe(true);
  });
});

describe("pointTriangleDistance regions", () => {
  it("face, edge, vertex, and sliver cases", async () => {
    const { pointTriangleDistance } = await import("../../solver/distance.js");
    // Unit right triangle in z=0 plane: A(0,0,0), B(1,0,0), C(0,1,0)
    const tri = [0, 0, 0, 1, 0, 0, 0, 1, 0] as const;
    // Above the interior → face distance
    expect(pointTriangleDistance(0.2, 0.2, 0.5, ...tri)).toBeCloseTo(0.5, 12);
    // Beyond vertex A → vertex distance
    expect(pointTriangleDistance(-3, -4, 0, ...tri)).toBeCloseTo(5, 12);
    // Beyond edge AB laterally → edge distance
    expect(pointTriangleDistance(0.5, -2, 0, ...tri)).toBeCloseTo(2, 12);
    // Hypotenuse edge region
    expect(pointTriangleDistance(1, 1, 0, ...tri)).toBeCloseTo(Math.SQRT1_2, 12);
    // Degenerate sliver (all three points collinear) → finite, no NaN
    const d = pointTriangleDistance(0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 0);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(1, 12);
  });
});
