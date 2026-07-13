/**
 * bond.test.ts
 * ------------
 * Locks for the bead-penetration bond model (server/solver/bond.ts, audit A6).
 *
 * The model's constants are LOW confidence literature estimates; like the
 * Gibson-Ashby lattice exponents they are regression-locked here — changing
 * them must be a deliberate re-estimation, not drift. The structural
 * properties (reference anchoring, monotone trends, clamps, fallback
 * bit-identity) are the real invariants.
 */

import { describe, it, expect } from "vitest";
import {
  predictBondMultipliers,
  fitBondCoeffs,
  hasProcessSettings,
  BOND_REFERENCE,
  BOND_MATERIALS,
  type BondSweepPoint,
} from "../../solver/bond.js";
import { buildOrthotropicMaterial, layerHeightFactor } from "../../analysis.js";

const REF_PROC = { ...BOND_REFERENCE, nozzleTempC: BOND_MATERIALS["pla"]!.nozzleRefC };

describe("reference anchoring", () => {
  it("reference process settings give multipliers of exactly 1.0 (every material, every layer height)", () => {
    for (const matId of Object.keys(BOND_MATERIALS)) {
      for (const lh of [0.1, 0.2, 0.3]) {
        const p = predictBondMultipliers(matId, lh, {
          ...BOND_REFERENCE, nozzleTempC: BOND_MATERIALS[matId]!.nozzleRefC,
        });
        expect(p.relStrength).toBeCloseTo(1.0, 9);
        expect(p.relStiffness).toBeCloseTo(1.0, 9);
      }
    }
  });

  it("anchoring survives coefficient overrides (cur and ref share coeffs)", () => {
    const p = predictBondMultipliers("pla", 0.2, REF_PROC, {
      hConv: 55, activationEnergyKJmol: 80, strengthPrefactor: 1.0,
    });
    expect(p.relStrength).toBeCloseTo(1.0, 9);
  });

  it("an EMPTY process block predicts 1.0 (all fields default to reference)", () => {
    const p = predictBondMultipliers("pla", 0.2, {});
    expect(p.relStrength).toBeCloseTo(1.0, 9);
    expect(p.relStiffness).toBeCloseTo(1.0, 9);
  });
});

describe("physical trends (direction locks)", () => {
  it("hotter nozzle → stronger bond; colder → weaker", () => {
    const hot  = predictBondMultipliers("pla", 0.2, { ...REF_PROC, nozzleTempC: 230 });
    const cold = predictBondMultipliers("pla", 0.2, { ...REF_PROC, nozzleTempC: 190 });
    expect(hot.relStrength).toBeGreaterThan(1.0);
    expect(cold.relStrength).toBeLessThan(1.0);
  });

  it("more part-cooling fan → weaker bond", () => {
    const noFan   = predictBondMultipliers("pla", 0.2, { ...REF_PROC, coolingFanPct: 0 });
    const fullFan = predictBondMultipliers("pla", 0.2, { ...REF_PROC, coolingFanPct: 100 });
    expect(noFan.relStrength).toBeGreaterThan(fullFan.relStrength);
    expect(fullFan.relStrength).toBeCloseTo(1.0, 9);   // reference IS full fan
  });

  it("faster printing → hotter substrate → stronger bond (Coogan & Kazmer 2017 trend)", () => {
    const fast = predictBondMultipliers("pla", 0.2, { ...REF_PROC, printSpeedMmS: 150 });
    const slow = predictBondMultipliers("pla", 0.2, { ...REF_PROC, printSpeedMmS: 20 });
    expect(fast.substrateTempC).toBeGreaterThan(slow.substrateTempC);
    expect(fast.relStrength).toBeGreaterThan(slow.relStrength);
  });

  it("hotter bed/environment → stronger bond", () => {
    const hotBed = predictBondMultipliers("pla", 0.2, { ...REF_PROC, bedTempC: 100 });
    expect(hotBed.relStrength).toBeGreaterThan(1.0);
  });

  it("layer height alone does NOT move the multiplier (its slope stays with layerHeightFactor)", () => {
    // The reference potential is computed at the SAME layer height, so pure
    // hL changes cancel — the validated empirical lhf carries the hL effect.
    const thin  = predictBondMultipliers("pla", 0.1, REF_PROC);
    const thick = predictBondMultipliers("pla", 0.3, REF_PROC);
    expect(thin.relStrength).toBeCloseTo(1.0, 9);
    expect(thick.relStrength).toBeCloseTo(1.0, 9);
  });

  it("thinner layers are MORE process-sensitive (smaller τc) — the hL–process interaction", () => {
    const thinCold  = predictBondMultipliers("pla", 0.1, { ...REF_PROC, nozzleTempC: 190 });
    const thickCold = predictBondMultipliers("pla", 0.3, { ...REF_PROC, nozzleTempC: 190 });
    expect(thinCold.coolTimeConstS).toBeLessThan(thickCold.coolTimeConstS);
  });
});

describe("robustness: clamps and degenerate inputs", () => {
  it("extreme settings stay finite and inside the clamps", () => {
    const cases = [
      { nozzleTempC: 450, coolingFanPct: 0, printSpeedMmS: 600, bedTempC: 150 },
      { nozzleTempC: 155, coolingFanPct: 100, printSpeedMmS: 1, bedTempC: 0, ambientTempC: 0 },
      { nozzleTempC: 165 }, // barely above PLA Tg+20 clamp region
    ];
    for (const proc of cases) {
      const p = predictBondMultipliers("pla", 0.2, proc);
      expect(Number.isFinite(p.relStrength)).toBe(true);
      expect(Number.isFinite(p.relStiffness)).toBe(true);
      expect(p.relStrength).toBeGreaterThanOrEqual(0.4);
      expect(p.relStrength).toBeLessThanOrEqual(1.5);
      expect(p.relStiffness).toBeGreaterThanOrEqual(0.6);
      expect(p.relStiffness).toBeLessThanOrEqual(1.25);
    }
  });

  it("unknown material falls back to PLA constants", () => {
    const p = predictBondMultipliers("unobtainium", 0.2, REF_PROC);
    expect(Number.isFinite(p.relStrength)).toBe(true);
  });

  it("hasProcessSettings gates on any meaningful field", () => {
    expect(hasProcessSettings(undefined)).toBe(false);
    expect(hasProcessSettings({})).toBe(false);
    expect(hasProcessSettings({ nozzleTempC: 210 })).toBe(true);
    expect(hasProcessSettings({ coolingFanPct: 0 })).toBe(true);
  });
});

describe("locked interior value (regression — change = deliberate re-estimation)", () => {
  it("PLA at 190°C / full fan / 60 mm/s / 0.2 mm is locked", () => {
    const p = predictBondMultipliers("pla", 0.2, { ...REF_PROC, nozzleTempC: 190 });
    // Value captured at implementation time; the direction (<1) is physical,
    // the magnitude is the model's LOW-confidence statement.
    expect(p.relStrength).toBeCloseTo(0.6498, 3);
    expect(p.relStiffness).toBeCloseTo(Math.sqrt(p.relStrength), 6);
  });
});

describe("builder integration (analysis.ts)", () => {
  it("no bondRel → material identical to the legacy path (bit-for-bit)", () => {
    const a = buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null);
    const b = buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null, null);
    expect(b).toEqual(a);
  });

  it("bondRel scales interlayer strength/stiffness only", () => {
    const base = buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null);
    const rel = predictBondMultipliers("pla", 0.2, { ...REF_PROC, nozzleTempC: 230 });
    const bonded = buildOrthotropicMaterial("pla", 1.0, "flat", 0.2, null, null, rel);
    expect(bonded.yieldXY).toBe(base.yieldXY);
    expect(bonded.E_xy).toBe(base.E_xy);
    expect(bonded.yieldZ).toBeCloseTo(base.yieldZ * rel.relStrength, 10);
    expect(bonded.E_z).toBeCloseTo(base.E_z * rel.relStiffness, 10);
    expect(bonded.G_xz).toBeCloseTo(base.G_xz * rel.relStiffness, 10);
    // yieldZShear derives from the bonded yieldZ (same S_zs/S_zt ratio)
    expect(bonded.yieldZShear! / bonded.yieldZ).toBeCloseTo(base.yieldZShear! / base.yieldZ, 12);
  });
});

describe("process-sweep coefficient fit", () => {
  it("recovers synthetic data generated from known coefficients", () => {
    const truth = { hConv: 50, activationEnergyKJmol: 75, strengthPrefactor: 1.1 };
    const Y = 50, yZ = 0.58;
    const settings: Array<Omit<BondSweepPoint, "measuredSztMPa">> = [
      { layerHeightMm: 0.2, nozzleTempC: 190, printSpeedMmS: 60, coolingFanPct: 100 },
      { layerHeightMm: 0.2, nozzleTempC: 210, printSpeedMmS: 60, coolingFanPct: 100 },
      { layerHeightMm: 0.2, nozzleTempC: 230, printSpeedMmS: 60, coolingFanPct: 100 },
      { layerHeightMm: 0.1, nozzleTempC: 210, printSpeedMmS: 120, coolingFanPct: 50 },
      { layerHeightMm: 0.3, nozzleTempC: 220, printSpeedMmS: 30, coolingFanPct: 0 },
      { layerHeightMm: 0.2, nozzleTempC: 200, printSpeedMmS: 90, coolingFanPct: 100 },
    ];
    const points: BondSweepPoint[] = settings.map(s => ({
      ...s,
      measuredSztMPa: Y * yZ * layerHeightFactor(s.layerHeightMm)
        * predictBondMultipliers("pla", s.layerHeightMm, s, truth).relStrength,
    }));
    const fit = fitBondCoeffs("pla", points, Y, yZ, layerHeightFactor);
    expect(fit.rmsePct).toBeLessThan(2);
    // Predictions must reproduce the measurements even if the individual
    // coefficients trade off against each other (the fit is what's consumed).
    for (const p of fit.points) {
      expect(Math.abs(p.predictedMPa - p.measuredMPa) / p.measuredMPa).toBeLessThan(0.05);
    }
  });

  it("rejects fewer than 3 points", () => {
    expect(() => fitBondCoeffs("pla", [
      { layerHeightMm: 0.2, measuredSztMPa: 20 },
      { layerHeightMm: 0.3, measuredSztMPa: 18 },
    ], 50, 0.58, layerHeightFactor)).toThrow(/≥3/);
  });
});
