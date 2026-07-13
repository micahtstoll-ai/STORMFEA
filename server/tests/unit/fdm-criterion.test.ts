/**
 * fdm-criterion.test.ts
 * ---------------------
 * Locks for the FDM dual failure criterion (bulk von Mises + interlayer
 * interface) that replaced the Hill (1948) quadratic — layer-model audit
 * findings A1–A3 (docs/layer-model-audit.md):
 *
 *   A1  the calibrated Hill form was azimuth-DEPENDENT in the supposedly
 *       isotropic layer plane (N = 3/(2Y²) ≠ F + 2H when Z ≠ Y);
 *   A2  for Z < Y/2 the clamped-negative quadratic form silently reported
 *       SF = 999 for in-plane tension–compression states;
 *   A3  interlayer failure was tension/compression symmetric.
 */

import { describe, it, expect } from "vitest";
import {
  fdmDualCriterionSF,
  fdmInterfaceUtilization,
  hillEquivalentStress,
  interlaminarShearOf,
  recoverElementStress,
  INTERFACE_FRICTION_MU,
} from "../../solver/stress.js";
import { buildAnyConstitutiveMatrix } from "../../solver/element.js";
import { generateBoxMeshC3D4 } from "../../solver/meshgen.js";
import type { ElementMaterialField, OrthotropicMaterial } from "../../solver/types.js";

const Y  = 50;            // in-plane yield
const Z  = 29;            // through-layer (bond) tensile allowable, 0.58·Y
const ZS = Z / Math.sqrt(3);  // default interlaminar shear allowable

/** Rotate a stress state by angle a about the material z axis. */
function rotateAboutZ(
  s: [number, number, number, number, number, number],
  a: number,
): [number, number, number, number, number, number] {
  const [sxx, syy, szz, txy, tyz, txz] = s;
  const c = Math.cos(a), n = Math.sin(a);
  // σ' = QᵀσQ with Q = Rz(a); components written out:
  const sxxR = c*c*sxx + n*n*syy + 2*c*n*txy;
  const syyR = n*n*sxx + c*c*syy - 2*c*n*txy;
  const txyR = (c*c - n*n)*txy + c*n*(syy - sxx);
  const tyzR = c*tyz - n*txz;
  const txzR = n*tyz + c*txz;
  return [sxxR, syyR, szz, txyR, tyzR, txzR];
}

const vm = (s: [number, number, number, number, number, number]) =>
  Math.sqrt(0.5*((s[0]-s[1])**2 + (s[1]-s[2])**2 + (s[2]-s[0])**2)
    + 3*(s[3]*s[3] + s[4]*s[4] + s[5]*s[5]));

describe("A1: azimuth invariance about the layer normal", () => {
  const states: Array<[number, number, number, number, number, number]> = [
    [30, 0, 0, 0, 0, 0],          // uniaxial in-plane
    [0, 0, 0, 20, 0, 0],          // pure in-plane shear
    [25, -25, 0, 0, 0, 0],        // in-plane tension–compression (the A1 case)
    [10, -5, 12, 8, 6, 3],        // general mixed state
    [0, 0, 15, 0, 9, 4],          // through-layer tension + interlayer shear
  ];

  it("dual criterion SF is invariant under rotation about z (≤1e-12 rel)", () => {
    for (const s of states) {
      const ref = fdmDualCriterionSF(...s, Y, Z, ZS);
      for (const a of [Math.PI/8, Math.PI/4, 1.0, 2.3]) {
        const r = rotateAboutZ(s, a);
        const sf = fdmDualCriterionSF(...r, Y, Z, ZS);
        expect(Math.abs(sf - ref) / ref).toBeLessThan(1e-12);
      }
    }
  });

  it("documents the legacy Hill defect: 45° azimuth changed pure-shear SF ~1.7×", () => {
    // Same physical state: pure in-plane shear τ, expressed as τxy vs as
    // principal (σ, −σ) at 45°. Hill with the calibrated N is NOT invariant.
    const t = 20;
    const hillShear = Y / hillEquivalentStress(0, 0, 0, t, 0, 0, Y, Z);
    const hill45    = Y / hillEquivalentStress(t, -t, 0, 0, 0, 0, Y, Z);
    expect(hill45 / hillShear).toBeGreaterThan(1.5);   // the defect, locked
    // The dual criterion gives the identical (invariant) answer: Y/(√3 τ).
    const dualShear = fdmDualCriterionSF(0, 0, 0, t, 0, 0, Y, Z, ZS);
    const dual45    = fdmDualCriterionSF(t, -t, 0, 0, 0, 0, Y, Z, ZS);
    expect(dualShear).toBeCloseTo(Y / (Math.sqrt(3) * t), 10);
    expect(dual45).toBeCloseTo(dualShear, 12);
  });
});

describe("A2: no silent SF=999 for in-plane tension–compression at low Z", () => {
  it("Z = 0.48·Y (the conservative band bound) gives a finite, correct SF", () => {
    const Zlow = 0.48 * Y;   // below Y/2 — the legacy negative-form region
    const s: [number, number, number, number, number, number] = [30, -30, 0, 0, 0, 0];
    // Legacy defect: clamped negative form → SF = 999.
    const hillSF = Y / Math.max(hillEquivalentStress(...s, Y, Zlow), 1e-12);
    expect(hillSF).toBeGreaterThan(900);   // the defect, locked
    // Dual criterion: bulk von Mises governs — finite and azimuth-consistent.
    const sf = fdmDualCriterionSF(...s, Y, Zlow, Zlow / Math.sqrt(3));
    expect(sf).toBeCloseTo(Y / vm(s), 10);
    expect(sf).toBeLessThan(2);
  });
});

describe("A3: interlayer tension/compression asymmetry + friction", () => {
  it("through-layer tension fails at S_zt; equal compression does not open the interface", () => {
    const sfT = fdmDualCriterionSF(0, 0, Z, 0, 0, 0, Y, Z, ZS);
    expect(sfT).toBeCloseTo(1.0, 10);
    const sfC = fdmDualCriterionSF(0, 0, -Z, 0, 0, 0, Y, Z, ZS);
    // Compression is checked by bulk von Mises only: SF = Y/|σzz|
    expect(sfC).toBeCloseTo(Y / Z, 10);
  });

  it("compression raises interlayer shear capacity (Mohr–Coulomb credit)", () => {
    const t = 10;
    const sf0 = fdmDualCriterionSF(0, 0, 0, 0, t, 0, Y, Z, ZS);
    const sfC = fdmDualCriterionSF(0, 0, -8, 0, t, 0, Y, Z, ZS);
    expect(sfC).toBeGreaterThan(sf0);
    // Closed form of the interface term: S_zs/(τ − μ|σzz|), unless bulk governs
    const sfIntExpected = ZS / (t - INTERFACE_FRICTION_MU * 8);
    const sfBulk = Y / vm([0, 0, -8, 0, t, 0]);
    expect(sfC).toBeCloseTo(Math.min(sfIntExpected, sfBulk), 10);
  });

  it("utilization split: uTension is Macaulay (0 under compression)", () => {
    const uT = fdmInterfaceUtilization(12, 3, 4, Z, ZS);
    expect(uT.uTension).toBeCloseTo(12 / Z, 12);
    expect(uT.uShear).toBeCloseTo(5 / ZS, 12);
    expect(uT.combined).toBeCloseTo(Math.hypot(12 / Z, 5 / ZS), 12);
    const uC = fdmInterfaceUtilization(-12, 3, 4, Z, ZS);
    expect(uC.uTension).toBe(0);
    expect(uC.combined).toBeCloseTo(Math.max(0, 5 - INTERFACE_FRICTION_MU * 12) / ZS, 12);
  });
});

describe("anchors preserved from the legacy criterion", () => {
  it("in-plane uniaxial yields at Y; through-layer uniaxial at Z; flat-print false-safety SF ≈ 0.58", () => {
    expect(fdmDualCriterionSF(Y, 0, 0, 0, 0, 0, Y, Z, ZS)).toBeCloseTo(1.0, 10);
    expect(fdmDualCriterionSF(0, 0, Z, 0, 0, 0, Y, Z, ZS)).toBeCloseTo(1.0, 10);
    // Through-layer stress at the in-plane yield level → SF = Z/Y = 0.58
    expect(fdmDualCriterionSF(0, 0, Y, 0, 0, 0, Y, Z, ZS)).toBeCloseTo(Z / Y, 10);
  });

  it("interlayer shear yields at Z/√3 — identical to Hill's L = M = 3/(2Z²)", () => {
    const tYield = Z / Math.sqrt(3);
    expect(fdmDualCriterionSF(0, 0, 0, 0, 0, tYield, Y, Z, ZS)).toBeCloseTo(1.0, 10);
  });

  it("isotropic collapse: S_zt = Y, S_zs = Y/√3 reproduces von Mises for uniaxial/shear/mixed-traction states", () => {
    const states: Array<[number, number, number, number, number, number]> = [
      [30, 0, 0, 0, 0, 0], [0, 0, 40, 0, 0, 0], [0, 0, 0, 10, 0, 0],
      [0, 0, 20, 0, 12, 5], [20, -10, 5, 8, 3, 2],
    ];
    for (const s of states) {
      const sf = fdmDualCriterionSF(...s, Y, Y, Y / Math.sqrt(3));
      expect(sf).toBeCloseTo(Y / vm(s), 8);
    }
    // Intentional exception: hydrostatic tension is interface-governed
    // (von Mises is blind to triaxial tension; a bonded interface is not).
    const sfHydro = fdmDualCriterionSF(30, 30, 30, 0, 0, 0, Y, Y, Y / Math.sqrt(3));
    expect(sfHydro).toBeCloseTo(Y / 30, 10);
  });
});

describe("per-bin yieldZShear plumbing through recoverElementStress", () => {
  const MAT: OrthotropicMaterial = {
    kind: "orthotropic",
    E_xy: 3500, E_z: 2275, nu_xy: 0.36, nu_xz: 0.30, G_xz: 515,
    yieldXY: Y, yieldZ: Z, label: "fdm-criterion-test",
  };

  it("a field whose bin halves ONLY yieldZShear halves shear-governed SFs", () => {
    const mesh = generateBoxMeshC3D4(0, 0, 0, 4, 4, 4, 2, 2, 2);
    // Displacement field with dominant transverse shear strain γxz: ux = k·z
    const u = new Float64Array(mesh.nodeCount * 3);
    for (let n = 0; n < mesh.nodeCount; n++) u[n * 3] = 0.01 * (mesh.nodes[n * 3 + 2] ?? 0);

    const C0 = buildAnyConstitutiveMatrix(MAT);
    const mkField = (zs: number): ElementMaterialField => ({
      binCount: 1,
      binOfElement: new Int32Array(mesh.elementCount),
      C: C0,
      yieldXY: Float64Array.of(Y),
      yieldZ: Float64Array.of(Z),
      yieldZShear: Float64Array.of(zs),
      massRho: Float64Array.of(1240),
      shellFrac: Float64Array.of(1),
    });

    const base = recoverElementStress(mesh, u, MAT, mkField(ZS));
    const half = recoverElementStress(mesh, u, MAT, mkField(ZS / 2));
    // Pure γxz stress state → interface shear governs (ZS < Y/√3 would be
    // needed... here ZS = Z/√3 ≈ 16.7 < Y/√3 ≈ 28.9, so interface governs)
    expect(half.minSF).toBeCloseTo(base.minSF / 2, 8);
  });

  it("no-field path uses the material's own yieldZShear (default yieldZ/√3)", () => {
    expect(interlaminarShearOf(MAT)).toBeCloseTo(ZS, 12);
    expect(interlaminarShearOf({ ...MAT, yieldZShear: 12 })).toBe(12);
  });

  it("hill-legacy flag reproduces the Hill criterion exactly", () => {
    const mesh = generateBoxMeshC3D4(0, 0, 0, 4, 4, 4, 2, 2, 2);
    const u = new Float64Array(mesh.nodeCount * 3);
    for (let n = 0; n < mesh.nodeCount; n++) u[n * 3] = 0.005 * (mesh.nodes[n * 3 + 2] ?? 0);
    const legacy = recoverElementStress(mesh, u, MAT, undefined, "hill-legacy");
    for (let e = 0; e < mesh.elementCount; e++) {
      const s = legacy.elemStress6.subarray(e * 6, e * 6 + 6);
      const sig = hillEquivalentStress(s[0]!, s[1]!, s[2]!, s[3]!, s[4]!, s[5]!, Y, Z);
      const expected = Math.min(Math.max(sig > 1e-12 ? Y / sig : 999, 0), 999);
      expect(legacy.safetyFactor[e]).toBeCloseTo(expected, 10);
    }
  });
});
