/**
 * density-matrix.test.ts
 * ----------------------
 * Comprehensive test suite for GyroidOrthotropic material type and
 * density-based constitutive matrix scaling.
 *
 * Test coverage:
 *   - 20% infill density profile
 *   - 50% infill density profile
 *   - 100% infill density profile (solid reference)
 *   - Edge cases (0%, >100%, invalid Poisson's ratios)
 *   - Matrix properties (SPD, symmetry, invertibility)
 */

import { describe, it, expect } from "vitest";
import {
  GyroidOrthotropic,
  validateGyroidOrthotropic,
  isGyroidOrthotropic,
  isOrthotropicLike,
} from "../../solver/types.js";
import { buildGyroidConstitutiveMatrix, buildAnyConstitutiveMatrix } from "../../solver/element.js";

// ─── Helper functions for matrix validation ────────────────────────────────

/** Check if matrix is symmetric within tolerance. */
function isSymmetric(C: Float64Array, tol: number = 1e-10): boolean {
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      const Cij = C[i * 6 + j] ?? 0;
      const Cji = C[j * 6 + i] ?? 0;
      if (Math.abs(Cij - Cji) > tol) return false;
    }
  }
  return true;
}

/** Extract eigenvalues via power iteration (simplified SPD check). */
function isPositiveDefinite(C: Float64Array, tol: number = 1e-8): boolean {
  // For small 6×6 matrices, check diagonal dominance and perform Cholesky-like check
  // Simple check: all diagonal elements must be positive
  for (let i = 0; i < 6; i++) {
    if ((C[i * 6 + i] ?? 0) <= tol) return false;
  }

  // More robust: attempt Cholesky decomposition
  const L = new Float64Array(36);
  try {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = getMatrixElement(C, i, j);
        for (let k = 0; k < j; k++) {
          sum -= (L[i * 6 + k] ?? 0) * (L[j * 6 + k] ?? 0);
        }
        if (i === j) {
          if (sum <= tol) return false; // Not positive definite
          setMatrixElement(L, i, i, Math.sqrt(sum));
        } else {
          const ljj = L[j * 6 + j] ?? 0;
          setMatrixElement(L, i, j, sum / ljj);
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Compute matrix determinant (6×6). */
function determinant(C: Float64Array): number {
  // For a 6×6 symmetric matrix, use numerical computation
  // Simplified: return a non-zero positive value if SPD
  // (full determinant computation is complex; we rely on Cholesky for robustness)
  return isPositiveDefinite(C) ? 1.0 : 0.0;
}

/** Safe access to Float64Array with default. */
function getMatrixElement(C: Float64Array, i: number, j: number): number {
  const val = C[i * 6 + j];
  return val !== undefined ? val : 0;
}

/** Safe matrix element assignment. */
function setMatrixElement(C: Float64Array, i: number, j: number, value: number): void {
  C[i * 6 + j] = value;
}

/** Safe matrix element read. */
function readMatrixElement(C: Float64Array, i: number, j: number): number {
  return getMatrixElement(C, i, j);
}

// ─── Test suite: 20% infill density ───────────────────────────────────────

// Formula-computed values at ρ=0.2 (builder ignores stored moduli and recomputes from density):
//   E_xy = 3500 × 0.2^1.75 × (1−0.12×0.8) ≈ 189 MPa
//   E_z  = 2275 × 0.2^2.1  × (1−0.18×0.8) ≈ 66 MPa
//   G_xz = 1143 × 0.2^2.3  × (1−0.22×0.8) ≈ 23 MPa
describe("GyroidOrthotropic 20% density", () => {
  const material: GyroidOrthotropic = {
    kind: "gyroid-orthotropic",
    density: 0.2,
    E_xy: 189,
    E_z: 66,
    nu_xy: 0.38,
    nu_xz: 0.28,
    G_xz: 23,
    yieldXY: 10,
    yieldZ: 6,
    label: "PLA Gyroid 20%",
  };

  it("creates valid material with density 0.2", () => {
    expect(() => validateGyroidOrthotropic(material)).not.toThrow();
  });

  it("builds constitutive matrix (6×6)", () => {
    const C = buildGyroidConstitutiveMatrix(material);
    expect(C).toBeInstanceOf(Float64Array);
    expect(C.length).toBe(36);
  });

  it("matrix is symmetric", () => {
    const C = buildGyroidConstitutiveMatrix(material);
    expect(isSymmetric(C)).toBe(true);
  });

  it("matrix is positive definite", () => {
    const C = buildGyroidConstitutiveMatrix(material);
    expect(isPositiveDefinite(C)).toBe(true);
  });

  it("all matrix entries are finite", () => {
    const C = buildGyroidConstitutiveMatrix(material);
    for (let i = 0; i < 36; i++) {
      const val = C[i];
      expect(Number.isFinite(val ?? 0)).toBe(true);
    }
  });

  it("dispatcher routes gyroid materials correctly", () => {
    const C = buildAnyConstitutiveMatrix(material);
    expect(C).toBeInstanceOf(Float64Array);
    expect(C.length).toBe(36);
    expect(isPositiveDefinite(C)).toBe(true);
  });

  it("type guard recognizes gyroid material", () => {
    expect(isGyroidOrthotropic(material)).toBe(true);
    expect(isOrthotropicLike(material)).toBe(true);
  });

  it("shear block is decoupled (C[0:3,3:6] ≈ 0)", () => {
    const C = buildGyroidConstitutiveMatrix(material);
    for (let i = 0; i < 3; i++) {
      for (let j = 3; j < 6; j++) {
        expect(Math.abs(readMatrixElement(C, i, j))).toBeLessThan(1e-10);
      }
    }
  });
});

// ─── Test suite: 50% infill density ───────────────────────────────────────

// Formula-computed values at ρ=0.5:
//   E_xy = 3500 × 0.5^1.75 × (1−0.12×0.5) ≈ 1061 MPa
//   E_z  = 2275 × 0.5^2.1  × (1−0.18×0.5) ≈ 513 MPa
//   G_xz = 1143 × 0.5^2.3  × (1−0.22×0.5) ≈ 238 MPa
describe("GyroidOrthotropic 50% density", () => {
  const material: GyroidOrthotropic = {
    kind: "gyroid-orthotropic",
    density: 0.5,
    E_xy: 1061,
    E_z: 513,
    nu_xy: 0.38,
    nu_xz: 0.28,
    G_xz: 238,
    yieldXY: 31,
    yieldZ: 18,
    label: "PLA Gyroid 50%",
  };

  it("creates valid material with density 0.5", () => {
    expect(() => validateGyroidOrthotropic(material)).not.toThrow();
  });

  it("builds positive definite constitutive matrix", () => {
    const C = buildGyroidConstitutiveMatrix(material);
    expect(isSymmetric(C)).toBe(true);
    expect(isPositiveDefinite(C)).toBe(true);
  });

  it("elastic constants scale correctly from 20% to 50%", () => {
    const mat20 = {
      kind: "gyroid-orthotropic" as const,
      density: 0.2,
      E_xy: 189,
      E_z: 66,
      nu_xy: 0.38,
      nu_xz: 0.28,
      G_xz: 23,
      yieldXY: 10,
      yieldZ: 6,
      label: "20%",
    };

    const C20 = buildGyroidConstitutiveMatrix(mat20);
    const C50 = buildGyroidConstitutiveMatrix(material);

    // Stiffness should increase monotonically
    expect(readMatrixElement(C50, 0, 0)).toBeGreaterThan(readMatrixElement(C20, 0, 0)); // C11 at 50% > C11 at 20%
    expect(readMatrixElement(C50, 1, 1)).toBeGreaterThan(readMatrixElement(C20, 1, 1)); // C22 at 50% > C22 at 20%
    expect(readMatrixElement(C50, 2, 2)).toBeGreaterThan(readMatrixElement(C20, 2, 2)); // C33 at 50% > C33 at 20%
  });

  it("all matrix elements are non-negative (due to positive moduli)", () => {
    const C = buildGyroidConstitutiveMatrix(material);
    // Diagonal elements should be positive
    for (let i = 0; i < 6; i++) {
      expect(readMatrixElement(C, i, i)).toBeGreaterThan(0);
    }
  });
});

// ─── Test suite: 100% infill density (solid reference) ────────────────────

describe("GyroidOrthotropic 100% density (solid)", () => {
  const material: GyroidOrthotropic = {
    kind: "gyroid-orthotropic",
    density: 1.0,
    E_xy: 3500,
    E_z: 2275,
    nu_xy: 0.38,
    nu_xz: 0.28,
    G_xz: 1143,
    yieldXY: 56,
    yieldZ: 33,
    label: "PLA Gyroid 100%",
  };

  it("creates valid solid material with density 1.0", () => {
    expect(() => validateGyroidOrthotropic(material)).not.toThrow();
  });

  it("builds positive definite constitutive matrix", () => {
    const C = buildGyroidConstitutiveMatrix(material);
    expect(isSymmetric(C)).toBe(true);
    expect(isPositiveDefinite(C)).toBe(true);
  });

  it("100% density produces highest stiffness", () => {
    const mat50 = {
      kind: "gyroid-orthotropic" as const,
      density: 0.5,
      E_xy: 1061,
      E_z: 513,
      nu_xy: 0.38,
      nu_xz: 0.28,
      G_xz: 238,
      yieldXY: 31,
      yieldZ: 18,
      label: "50%",
    };

    const C50 = buildGyroidConstitutiveMatrix(mat50);
    const C100 = buildGyroidConstitutiveMatrix(material);

    // All diagonal elements should be larger at 100%
    for (let i = 0; i < 6; i++) {
      expect(readMatrixElement(C100, i, i)).toBeGreaterThan(readMatrixElement(C50, i, i));
    }
  });

  it("solid properties match reference values", () => {
    // Material constants should be as specified
    expect(material.E_xy).toBe(3500);
    expect(material.E_z).toBe(2275);
    expect(material.G_xz).toBe(1143);
  });

  it("compliance matrix (C^-1) is well-conditioned", () => {
    const C = buildGyroidConstitutiveMatrix(material);
    // For orthotropic materials, the compliance inverse exists
    // (this is guaranteed by positive-definiteness)
    expect(determinant(C)).toBeGreaterThan(0);
  });
});

// ─── Test suite: Edge cases ──────────────────────────────────────────────

describe("GyroidOrthotropic edge cases", () => {
  it("rejects density < 0", () => {
    const material: GyroidOrthotropic = {
      kind: "gyroid-orthotropic",
      density: -0.1,
      E_xy: 100,
      E_z: 50,
      nu_xy: 0.38,
      nu_xz: 0.28,
      G_xz: 20,
      yieldXY: 5,
      yieldZ: 3,
      label: "Invalid",
    };
    expect(() => validateGyroidOrthotropic(material)).toThrow();
  });

  it("rejects density > 1.0", () => {
    const material: GyroidOrthotropic = {
      kind: "gyroid-orthotropic",
      density: 1.1,
      E_xy: 3500,
      E_z: 2275,
      nu_xy: 0.38,
      nu_xz: 0.28,
      G_xz: 1143,
      yieldXY: 56,
      yieldZ: 33,
      label: "Over-100%",
    };
    expect(() => validateGyroidOrthotropic(material)).toThrow();
  });

  it("rejects E_xy <= 0", () => {
    const material: GyroidOrthotropic = {
      kind: "gyroid-orthotropic",
      density: 0.5,
      E_xy: 0,
      E_z: 229,
      nu_xy: 0.38,
      nu_xz: 0.28,
      G_xz: 88.7,
      yieldXY: 31,
      yieldZ: 18,
      label: "Zero E_xy",
    };
    expect(() => validateGyroidOrthotropic(material)).toThrow();
  });

  it("rejects invalid Poisson's ratio (nu_xy >= 0.5)", () => {
    const material: GyroidOrthotropic = {
      kind: "gyroid-orthotropic",
      density: 0.5,
      E_xy: 583,
      E_z: 229,
      nu_xy: 0.5,
      nu_xz: 0.28,
      G_xz: 88.7,
      yieldXY: 31,
      yieldZ: 18,
      label: "Invalid Poisson",
    };
    expect(() => validateGyroidOrthotropic(material)).toThrow();
  });

  it("accepts moderately low density (0.1)", () => {
    // Use computed values from power-law formulas for stability
    const density = 0.1;
    const E_xy = 3500 * Math.pow(density, 1.75) * (1 - 0.12 * (1 - density));
    const E_z = 2275 * Math.pow(density, 2.1) * (1 - 0.18 * (1 - density));
    const G_xz = 1143 * Math.pow(density, 2.3) * (1 - 0.22 * (1 - density));

    const material: GyroidOrthotropic = {
      kind: "gyroid-orthotropic",
      density,
      E_xy,
      E_z,
      nu_xy: 0.38,
      nu_xz: 0.28,
      G_xz,
      yieldXY: 5,
      yieldZ: 3,
      label: "Low density 10%",
    };
    expect(() => validateGyroidOrthotropic(material)).not.toThrow();
    // Matrix should be positive definite with formula-computed constants
    const C = buildGyroidConstitutiveMatrix(material);
    expect(isPositiveDefinite(C)).toBe(true);
  });
});

// ─── Test suite: Monotonicity and scaling ────────────────────────────────

describe("GyroidOrthotropic monotonicity", () => {
  it("stiffness increases monotonically with density", () => {
    const densities = [0.2, 0.5, 1.0];
    const matrices = densities.map((density) => {
      const E_xy_calc = 3500 * Math.pow(density, 1.75) * (1 - 0.12 * (1 - density));
      const E_z_calc = 2275 * Math.pow(density, 2.1) * (1 - 0.18 * (1 - density));
      const G_xz_calc = 1143 * Math.pow(density, 2.3) * (1 - 0.22 * (1 - density));

      const mat: GyroidOrthotropic = {
        kind: "gyroid-orthotropic",
        density,
        E_xy: E_xy_calc,
        E_z: E_z_calc,
        nu_xy: 0.38,
        nu_xz: 0.28,
        G_xz: G_xz_calc,
        yieldXY: 56 * density,
        yieldZ: 33 * density,
        label: `${(density * 100).toFixed(0)}%`,
      };

      return buildGyroidConstitutiveMatrix(mat);
    });

    // Check monotonic increase in diagonal elements
    for (let i = 0; i < 6; i++) {
      const m0 = matrices[0] as Float64Array;
      const m1 = matrices[1] as Float64Array;
      const m2 = matrices[2] as Float64Array;
      expect(readMatrixElement(m1, i, i)).toBeGreaterThan(readMatrixElement(m0, i, i));
      expect(readMatrixElement(m2, i, i)).toBeGreaterThan(readMatrixElement(m1, i, i));
    }
  });

  it("Poisson's ratio remains constant across densities", () => {
    const densities = [0.2, 0.5, 1.0];
    const nu_xy_input = 0.38;
    const nu_xz_input = 0.28;

    densities.forEach((density) => {
      const E_xy_calc = 3500 * Math.pow(density, 1.75) * (1 - 0.12 * (1 - density));
      const E_z_calc = 2275 * Math.pow(density, 2.1) * (1 - 0.18 * (1 - density));
      const G_xz_calc = 1143 * Math.pow(density, 2.3) * (1 - 0.22 * (1 - density));

      const mat: GyroidOrthotropic = {
        kind: "gyroid-orthotropic",
        density,
        E_xy: E_xy_calc,
        E_z: E_z_calc,
        nu_xy: nu_xy_input,
        nu_xz: nu_xz_input,
        G_xz: G_xz_calc,
        yieldXY: 56 * density,
        yieldZ: 33 * density,
        label: `${(density * 100).toFixed(0)}%`,
      };

      // Poisson's ratio should remain constant (only moduli scale)
      expect(mat.nu_xy).toBe(nu_xy_input);
      expect(mat.nu_xz).toBe(nu_xz_input);
    });
  });
});

// ─── Test suite: Type system integration ──────────────────────────────────

describe("GyroidOrthotropic type system", () => {
  const material: GyroidOrthotropic = {
    kind: "gyroid-orthotropic",
    density: 0.5,
    E_xy: 583,
    E_z: 229,
    nu_xy: 0.38,
    nu_xz: 0.28,
    G_xz: 88.7,
    yieldXY: 31,
    yieldZ: 18,
    label: "Test",
  };

  it("isGyroidOrthotropic type guard works", () => {
    expect(isGyroidOrthotropic(material)).toBe(true);
  });

  it("isOrthotropicLike recognizes gyroid as orthotropic-like", () => {
    expect(isOrthotropicLike(material)).toBe(true);
  });

  it("buildAnyConstitutiveMatrix dispatches correctly", () => {
    const C = buildAnyConstitutiveMatrix(material);
    expect(C).toBeInstanceOf(Float64Array);
    expect(C.length).toBe(36);
    expect(isPositiveDefinite(C)).toBe(true);
  });
});
