/**
 * goodman-fatigue.test.ts
 * -----------------------
 * Analytical benchmark for the modified Goodman fatigue estimate (issue #63).
 * Calls the ACTUAL implementation `estimateFatigue` exported from
 * server/analysis.ts and checks it against a hand-computed Goodman diagram.
 *
 * Implementation model (documented in estimateFatigue):
 *   - Pulsating load, R = 0:  σ_m = σ_a = σ_max/2
 *   - Endurance limit Se = seRatio × BASE_UTS(material),
 *     seRatio = 0.37 (flat) or 0.43 (upright); BASE_UTS(pla) = 65 MPa
 *   - Goodman UTS proxy: Su = max(1.15 × effectiveYield, 1.5 × Se)
 *   - Modified Goodman: 1/SF = σ_a/Se + σ_m/Su
 *   - Basquin: N = (σ_a,eq/σ_f')^(1/b), σ_a,eq = σ_a/(1 − σ_m/Su),
 *     σ_f' = 1.5 × BASE_UTS, b = −0.1; infinite life if σ_a,eq ≤ Se
 */

import { describe, it, expect } from "vitest";
import { estimateFatigue } from "../../analysis.js";

describe("Modified Goodman fatigue SF vs hand calculation (PLA, flat)", () => {
  // ─── Case 1: infinite-life case ───────────────────────────────────────────
  // Inputs: peak von Mises σ_max = 20 MPa, effective yield = 40 MPa,
  //         material 'pla', orientation 'flat'.
  //
  // Hand calculation:
  //   BASE_UTS(pla) = 65 MPa; seRatio(flat) = 0.37
  //   Se = 0.37 × 65 = 24.05 MPa
  //   Su = max(1.15 × 40, 1.5 × 24.05) = max(46, 36.075) = 46 MPa
  //   σ_a = σ_m = 20/2 = 10 MPa
  //   Goodman demand: 1/SF = σ_a/Se + σ_m/Su
  //                        = 10/24.05 + 10/46
  //                        = 0.4158004158 + 0.2173913043
  //                        = 0.6331917201
  //   SF = 1/0.6331917201 = 1.5793 (implementation rounds to 1.58)
  //
  //   Basquin equivalent amplitude:
  //     σ_a,eq = σ_a/(1 − σ_m/Su) = 10/(1 − 10/46) = 10·46/36 = 12.7778 MPa
  //   12.7778 ≤ Se = 24.05 → below endurance limit → infinite life
  const r1 = estimateFatigue(20, 40, "pla", "flat");

  it("SF_fatigue = 1/(σ_a/Se + σ_m/Su) = 1.58 (hand: 1.5793)", () => {
    // Implementation returns +SF.toFixed(2); 1.5793 → 1.58.
    // 0.005 tolerance (toBeCloseTo precision 2) ≈ 0.3% — inside the ≤1% requirement.
    expect(r1.fatigueSF).toBeCloseTo(1.5793, 2);
  });

  it("reported UTS is the Goodman proxy Su = 1.15 × yield = 46 MPa", () => {
    expect(r1.utsMPa).toBe(46);
  });

  it("reported endurance limit Se = 0.37 × 65 = 24.05 MPa (±0.05 for 1-decimal rounding)", () => {
    // 24.05 is exactly half-way between the 1-decimal values 24.0 and 24.1
    // the implementation can report (it rounds Se with toFixed(1)), so the
    // rounding error is exactly 0.05; use 0.051 to absorb float half-ulp.
    expect(Math.abs(r1.enduranceLimitMPa - 24.05)).toBeLessThan(0.051);
  });

  it("σ_a,eq = 12.78 MPa < Se = 24.05 MPa → infinite life, no fatigue concern", () => {
    expect(r1.estimatedCycles).toBeNull();
    expect(r1.fatigueConcern).toBe(false);
    expect(r1.loadRatio).toBe(0);
  });

  // ─── Case 2: finite-life case ─────────────────────────────────────────────
  // Inputs: peak σ_max = 60 MPa, effective yield = 40 MPa, 'pla', 'flat'.
  //
  // Hand calculation:
  //   Se = 24.05 MPa, Su = 46 MPa (as above)
  //   σ_a = σ_m = 60/2 = 30 MPa
  //   1/SF = 30/24.05 + 30/46 = 1.2474012474 + 0.6521739130 = 1.8995751604
  //   SF = 1/1.8995751604 = 0.5264 (implementation rounds to 0.53) → FAIL (<1)
  //
  //   Basquin:
  //     σ_a,eq = 30/(1 − 30/46) = 30/(16/46) = 30·46/16 = 86.25 MPa > Se
  //     σ_f' = 1.5 × 65 = 97.5 MPa
  //     N = (86.25/97.5)^(1/−0.1) = (97.5/86.25)^10 = (26/23)^10
  //       26^10 = 141,167,095,653,376;  23^10 = 41,426,511,213,649
  //       N = 141167095653376/41426511213649 = 3.40766
  //     Math.round(3.40766) = 3 cycles (exact expected integer)
  const r2 = estimateFatigue(60, 40, "pla", "flat");

  it("SF_fatigue = 0.53 (hand: 0.5264) and flags a fatigue concern", () => {
    expect(r2.fatigueSF).toBeCloseTo(0.5264, 2);
    expect(r2.fatigueConcern).toBe(true);
  });

  it("Basquin cycles to failure N = round((26/23)^10) = 3 exactly", () => {
    expect(r2.estimatedCycles).toBe(3);
  });
});

describe("Modified Goodman fatigue SF: orientation effect (PLA, upright)", () => {
  // Inputs: peak σ_max = 20 MPa, effective yield = 40 MPa, 'pla', 'upright'.
  //
  // Hand calculation:
  //   seRatio(upright) = 0.43 → Se = 0.43 × 65 = 27.95 MPa
  //   Su = max(1.15 × 40, 1.5 × 27.95) = max(46, 41.925) = 46 MPa
  //   σ_a = σ_m = 10 MPa
  //   1/SF = 10/27.95 + 10/46 = 0.3577817531 + 0.2173913043 = 0.5751730575
  //   SF = 1/0.5751730575 = 1.7386 (implementation rounds to 1.74)
  it("upright Se = 27.95 MPa gives SF = 1.74 (hand: 1.7386)", () => {
    const r = estimateFatigue(20, 40, "pla", "upright");
    expect(r.fatigueSF).toBeCloseTo(1.7386, 2);
    // 27.95 is exactly half-way between reportable 1-decimal values 27.9 and
    // 28.0 (implementation rounds Se with toFixed(1)) — allow 0.051.
    expect(Math.abs(r.enduranceLimitMPa - 27.95)).toBeLessThan(0.051);
    expect(r.utsMPa).toBe(46);
  });

  it("upright SF exceeds flat SF for the same stress (higher Se)", () => {
    const flat    = estimateFatigue(20, 40, "pla", "flat");
    const upright = estimateFatigue(20, 40, "pla", "upright");
    expect(upright.fatigueSF).toBeGreaterThan(flat.fatigueSF);
  });
});

describe("Modified Goodman: algebraic boundary on the Goodman line", () => {
  // Pick σ_max so the operating point lands EXACTLY on the Goodman line
  // (SF = 1): σ_a/Se + σ_m/Su = 1 with σ_a = σ_m = σ_max/2 gives
  //   σ_max = 2/(1/Se + 1/Su) = 2·Se·Su/(Se + Su)
  // For PLA flat with yield 40: Se = 24.05, Su = 46:
  //   σ_max = 2 × 24.05 × 46/(24.05 + 46) = 2212.6/70.05 = 31.5860 MPa
  //   → 1/SF = 15.7930/24.05 + 15.7930/46 = 0.6566 + 0.3433... = 1.0000
  it("σ_max = 2·Se·Su/(Se+Su) = 31.586 MPa lies on the Goodman line: SF = 1.00", () => {
    const Se = 0.37 * 65;         // 24.05 — same literature constants as the docs above
    const Su = 46;
    const sigmaMax = (2 * Se * Su) / (Se + Su);   // hand: 31.5860 MPa
    expect(sigmaMax).toBeCloseTo(31.5860, 3);
    const r = estimateFatigue(sigmaMax, 40, "pla", "flat");
    expect(r.fatigueSF).toBeCloseTo(1.0, 2);
  });
});

describe("Fatigue load ratio R (issue: R input)", () => {
  // Same PLA/flat constants: Se = 24.05, Su = 46. peak σ_max = 20 MPa.
  // R = 0 (pulsating): σ_a = σ_m = 10 → SF = 1.58 (see Case 1 above).
  // R = -1 (fully reversed): σ_a = σ_max = 20, σ_m = 0.
  //   1/SF = 20/24.05 + 0/46 = 0.83160 → SF = 1.2025 → 1.20.
  it("R = -1 (fully reversed) gives σ_m = 0 and a lower SF than R = 0", () => {
    const pulsating = estimateFatigue(20, 40, "pla", "flat", 0);
    const reversed  = estimateFatigue(20, 40, "pla", "flat", -1);
    expect(reversed.loadRatio).toBe(-1);
    expect(reversed.fatigueSF).toBeCloseTo(1.20, 2);
    // Fully reversed loading is more damaging than pulsating at the same peak.
    expect(reversed.fatigueSF).toBeLessThan(pulsating.fatigueSF);
  });

  it("default R (omitted) equals R = 0 explicitly", () => {
    const a = estimateFatigue(25, 40, "pla", "flat");
    const b = estimateFatigue(25, 40, "pla", "flat", 0);
    expect(a.fatigueSF).toBe(b.fatigueSF);
    expect(a.loadRatio).toBe(0);
  });

  it("R > 0 (tension-biased) has a smaller alternating component → higher SF vs R = 0", () => {
    // At a fixed σ_max, larger R shrinks σ_a = σ_max(1−R)/2. Since Se < Su the
    // amplitude term dominates Goodman, so less alternating stress = less
    // fatigue damage = higher SF (even though the mean stress rises).
    const pulsating = estimateFatigue(25, 40, "pla", "flat", 0);
    const biased    = estimateFatigue(25, 40, "pla", "flat", 0.5);
    expect(biased.loadRatio).toBe(0.5);
    expect(biased.fatigueSF).toBeGreaterThan(pulsating.fatigueSF);
  });

  it("R is clamped to [-1, 0.95] (an out-of-range value does not escape)", () => {
    const r = estimateFatigue(20, 40, "pla", "flat", -5);
    expect(r.loadRatio).toBe(-1);
  });
});
