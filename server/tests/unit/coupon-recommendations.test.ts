/**
 * coupon-recommendations.test.ts
 * ------------------------------
 * Locks for the coupon recommendation engine (feature #3) and the shared
 * interface-calibration gate. The gate is the SINGLE source of truth for the
 * failure-mode-row confidence and the recommender, so these pin: (a) an
 * uncalibrated part recommends both interlayer coupons with the GOVERNING mode
 * first, (b) a Z-tension coupon derived from shear (yieldZFromShear) does NOT
 * count as calibrated, (c) a fully-calibrated part recommends nothing, and
 * (d) an active-but-unfitted bond model is recommended for a sweep.
 */

import { describe, it, expect } from "vitest";
import {
  computeCouponRecommendations,
  interfaceCalibrationState,
  type CalibrationProfile,
} from "../../analysis.js";

const EMPTY = null;

describe("interfaceCalibrationState — the shared gate", () => {
  it("treats a shear-derived yieldZ as NOT tension-calibrated", () => {
    const cal = { yieldZ_MPa: 20, yieldZFromShear: true } as unknown as CalibrationProfile;
    expect(interfaceCalibrationState(cal, undefined).zCalibrated).toBe(false);
  });
  it("treats a real Z-tension coupon as tension-calibrated", () => {
    const cal = { yieldZ_MPa: 20, yieldZFromShear: false } as unknown as CalibrationProfile;
    expect(interfaceCalibrationState(cal, undefined).zCalibrated).toBe(true);
  });
  it("flags the bond model active only when a process field is present", () => {
    expect(interfaceCalibrationState(EMPTY, undefined).bondActive).toBe(false);
    expect(interfaceCalibrationState(EMPTY, { nozzleTempC: 200 }).bondActive).toBe(true);
  });
});

describe("computeCouponRecommendations — prioritization", () => {
  it("uncalibrated part: recommends both interlayer coupons, governing first", () => {
    // tension governs (lower SF)
    const recs = computeCouponRecommendations(EMPTY, undefined, /*sfTension*/ 1.2, /*sfShear*/ 3.0);
    expect(recs.map(r => r.coupon)).toEqual(["z-tension", "lap-shear"]);
    expect(recs[0]!.governing).toBe(true);
    expect(recs[0]!.confidenceGain).toBe("LOW → MEDIUM");
  });

  it("flips order when shear governs", () => {
    const recs = computeCouponRecommendations(EMPTY, undefined, /*sfTension*/ 4.0, /*sfShear*/ 0.9);
    expect(recs[0]!.coupon).toBe("lap-shear");
    expect(recs[0]!.governing).toBe(true);
  });

  it("fully-calibrated interlayer + no process → no recommendations", () => {
    const cal = { yieldZ_MPa: 20, yieldZFromShear: false, interShear_MPa: 12 } as unknown as CalibrationProfile;
    expect(computeCouponRecommendations(cal, undefined, 1.5, 1.5)).toEqual([]);
  });

  it("calibrated interlayer but active unfitted bond model → recommends a sweep", () => {
    const cal = { yieldZ_MPa: 20, yieldZFromShear: false, interShear_MPa: 12 } as unknown as CalibrationProfile;
    const recs = computeCouponRecommendations(cal, { nozzleTempC: 205 }, 1.5, 1.5);
    expect(recs.map(r => r.coupon)).toEqual(["bond-sweep"]);
  });

  it("a fitted bond model is not re-recommended", () => {
    const cal = {
      yieldZ_MPa: 20, yieldZFromShear: false, interShear_MPa: 12,
      bondCoeffs: { hConv: 30 },
    } as unknown as CalibrationProfile;
    expect(computeCouponRecommendations(cal, { nozzleTempC: 205 }, 1.5, 1.5)).toEqual([]);
  });
});
