/**
 * fatigue-calibration.test.ts
 * ---------------------------
 * Locks the fatigue calibration path (server/analysis.ts): the S-N Basquin fit
 * and the LOW→MEDIUM confidence gate.
 *
 * Fatigue confidence is LOW by default because published FDM S-N data is sparse.
 * Code cannot manufacture that data, but it can (a) fit a printer-specific S-N
 * curve from a team's own cyclic coupons and (b) validate the Goodman/Basquin
 * math. These tests cover both — mirroring how a bearing coupon lifts the
 * bearing mode LOW→MEDIUM.
 */

import { describe, it, expect } from "vitest";
import {
  fitFatigueProfile,
  estimateFatigue,
  FATIGUE_LOGRMS_MAX,
  type FatigueCouponPoint,
} from "../../analysis.js";

describe("fitFatigueProfile — S-N Basquin regression", () => {
  it("round-trips a known Basquin law σ_a = σf'·N^b", () => {
    // Synthesize exact points from σf' = 90 MPa, b = -0.10.
    const sigmaF = 90, b = -0.10;
    const points: FatigueCouponPoint[] = [1e3, 1e4, 1e5, 1e6].map(N => ({
      cycles: N,
      stressAmplitudeMPa: sigmaF * Math.pow(N, b),
    }));
    const fit = fitFatigueProfile(points, /*uts*/ 60, /*enduranceLife*/ 1e6);
    expect(fit.basquinB).toBeCloseTo(b, 6);
    expect(fit.sigmaF_MPa).toBeCloseTo(sigmaF, 4);
    // Se at 1e6 = 90·(1e6)^-0.1 ≈ 22.6 MPa
    expect(fit.se_MPa).toBeCloseTo(sigmaF * Math.pow(1e6, b), 4);
    expect(fit.seRatio).toBeCloseTo(fit.se_MPa / 60, 6);
    expect(fit.logRms).toBeLessThan(1e-9); // exact data ⇒ ~zero residual
  });

  it("rejects fewer than two points", () => {
    expect(() => fitFatigueProfile([{ stressAmplitudeMPa: 30, cycles: 1e5 }], 60))
      .toThrow(/≥2/);
  });

  it("rejects points that do not span distinct cycle counts", () => {
    expect(() => fitFatigueProfile(
      [{ stressAmplitudeMPa: 30, cycles: 1e5 }, { stressAmplitudeMPa: 25, cycles: 1e5 }], 60,
    )).toThrow(/distinct/);
  });

  it("flags a clean fit 'good' and a scattered fit 'poor' (issue #179 residual gate)", () => {
    // Clean power-law data → ~zero residual → good.
    const clean: FatigueCouponPoint[] = [1e3, 1e4, 1e5, 1e6].map(N => ({
      cycles: N, stressAmplitudeMPa: 90 * Math.pow(N, -0.1),
    }));
    const good = fitFatigueProfile(clean, 60);
    expect(good.fitQuality).toBe("good");
    expect(good.logRms).toBeLessThan(FATIGUE_LOGRMS_MAX);

    // Same lives, but the amplitudes scatter badly around the trend — one point
    // is off by ~2×, which no straight log-log line can absorb.
    const noisy: FatigueCouponPoint[] = [
      { cycles: 1e3, stressAmplitudeMPa: 90 * Math.pow(1e3, -0.1) },
      { cycles: 1e4, stressAmplitudeMPa: 90 * Math.pow(1e4, -0.1) * 1.9 },
      { cycles: 1e5, stressAmplitudeMPa: 90 * Math.pow(1e5, -0.1) * 0.6 },
      { cycles: 1e6, stressAmplitudeMPa: 90 * Math.pow(1e6, -0.1) },
    ];
    const poor = fitFatigueProfile(noisy, 60);
    expect(poor.fitQuality).toBe("poor");
    expect(poor.logRms).toBeGreaterThan(FATIGUE_LOGRMS_MAX);
  });
});

describe("estimateFatigue — calibration confidence gate", () => {
  const peakVM = 20, yieldMPa = 50;

  it("is LOW confidence with no calibration (literature S-N)", () => {
    const f = estimateFatigue(peakVM, yieldMPa, "pla", "flat", 0, null);
    expect(f.confidence).toBe("low");
    // Literature flat-print endurance ratio 0.37 × base UTS 65 = 24.05 MPa
    // (reported rounded to 0.1 MPa).
    expect(f.enduranceLimitMPa).toBeCloseTo(0.37 * 65, 0);
  });

  it("rises to MEDIUM confidence and uses measured Se when calibrated", () => {
    const calib = { fatigueSeRatio: 0.30, fatigueBasquinB: -0.12, fatigueUTS_MPa: 58 };
    const f = estimateFatigue(peakVM, yieldMPa, "pla", "flat", 0, calib);
    expect(f.confidence).toBe("medium");
    // Se = 0.30 × 58 = 17.4 MPa (measured), not the literature 24.05.
    expect(f.enduranceLimitMPa).toBeCloseTo(0.30 * 58, 1);
    expect(f.note).toMatch(/CALIBRATED/);
  });

  it("ignores a partial calibration missing the endurance ratio (stays LOW)", () => {
    const calib = { fatigueSeRatio: null, fatigueBasquinB: -0.12, fatigueUTS_MPa: 58 };
    const f = estimateFatigue(peakVM, yieldMPa, "pla", "flat", 0, calib);
    expect(f.confidence).toBe("low");
  });

  it("a POOR-quality fit is used but kept LOW confidence — never MEDIUM (issue #179)", () => {
    // Same calibrated values as the MEDIUM case, but flagged as a poor fit: the
    // measured Se is still applied, yet confidence must not claim the upgrade.
    const calib = { fatigueSeRatio: 0.30, fatigueBasquinB: -0.12, fatigueUTS_MPa: 58, fatigueFitQuality: "poor" as const };
    const f = estimateFatigue(peakVM, yieldMPa, "pla", "flat", 0, calib);
    expect(f.confidence).toBe("low");
    // Still USES the measured Se = 0.30 × 58 (not the literature 0.37 × 65).
    expect(f.enduranceLimitMPa).toBeCloseTo(0.30 * 58, 1);
    expect(f.note).toMatch(/POOR/);
  });

  it("an explicit 'good' fit quality still rises to MEDIUM (issue #179)", () => {
    const calib = { fatigueSeRatio: 0.30, fatigueBasquinB: -0.12, fatigueUTS_MPa: 58, fatigueFitQuality: "good" as const };
    const f = estimateFatigue(peakVM, yieldMPa, "pla", "flat", 0, calib);
    expect(f.confidence).toBe("medium");
  });
});
