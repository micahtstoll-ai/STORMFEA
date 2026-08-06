/**
 * headline-spread.test.ts — the mesh-sensitivity readout for the headline
 * numbers (issue #256).
 *
 * WHAT THIS IS FOR
 * ================
 * `safetyFactor` and `maxVonMisesMPa` are the numbers a user acts on, and
 * `estimatedFailForce` is derived from them. On a part with an unresolvable
 * singularity they are not converged, and refining does not settle them:
 * measured 46% on the Ø5-bore tube and 18.9% on the cross plate, NON-MONOTONE
 * in element count, while the global energy-norm error converged normally over
 * the very same runs. Nothing in the product said so — a user comparing two runs
 * of the same part could watch the safety factor move by half with no signal
 * that this was expected.
 *
 * The measurement is available for free on any run that solved more than one
 * mesh, which the adaptive loop always does. This pins the arithmetic, the
 * wording, and — most importantly — the two things that must NOT happen:
 * inventing a spread from one mesh, and warning about a part that converged.
 *
 * The paired client-side implementation is checked in
 * `scripts/test_client_logic.mjs` group S against the same fixtures, because the
 * two surfaces must not be able to tell a user opposite things.
 */

import { describe, it, expect } from "vitest";
import { headlineSpreadOf } from "../../analysis.js";

type Sample = { globalRelativeError: number; elementCount: number; maxVonMisesMPa: number; safetyFactor: number | null };
const s = (elementCount: number, maxVonMisesMPa: number, safetyFactor: number | null): Sample =>
  ({ globalRelativeError: 0, elementCount, maxVonMisesMPa, safetyFactor });

/** The Ø5-bore tube's legacy ladder, exactly as reported in issue #256. */
const TUBE: Sample[] = [
  s(44_875, 6.864, 7.28),
  s(65_358, 8.017, 6.24),
  s(80_866, 5.564, 8.99),
  s(90_000, 5.500, 9.09),
];

/**
 * The plate-with-hole control from `smooth-concentration.test.ts` — a genuine
 * Kt≈3 concentration that CONVERGES. The negative case the swing investigation
 * never had.
 */
const SMOOTH: Sample[] = [
  s(1_536, 35.980, 1.390),
  s(3_456, 36.543, 1.368),
  s(6_144, 36.678, 1.363),
  s(9_600, 36.714, 1.362),
];

describe("headlineSpreadOf — not measured vs measured as none (issue #256)", () => {
  it("returns undefined for a single solve", () => {
    // The distinction `bcSingularityErrorFraction` already follows. One mesh
    // cannot measure its own mesh-dependence, and reporting 0% would assert a
    // convergence that was never tested — the most dangerous possible default
    // for this particular number.
    expect(headlineSpreadOf([s(1000, 5, 9)])).toBeUndefined();
    expect(headlineSpreadOf([])).toBeUndefined();
  });

  it("returns a ZERO spread when two solves genuinely agree", () => {
    const out = headlineSpreadOf([s(1000, 10, 5), s(2000, 10, 5)])!;
    expect(out).toBeDefined();
    expect(out.peakSpread).toBe(0);
    expect(out.safetyFactorSpread).toBe(0);
    // A converged part must not be warned. If everything gets a banner, the
    // banner stops carrying information.
    expect(out.note).toBe("");
  });

  it("ignores non-finite and non-positive peaks rather than propagating them", () => {
    expect(headlineSpreadOf([s(1000, NaN, 5), s(2000, 10, 4)])).toBeUndefined();
    expect(headlineSpreadOf([s(1000, 0, 5), s(2000, 10, 4)])).toBeUndefined();
  });
});

describe("headlineSpreadOf — the tube, as issue #256 measured it", () => {
  const out = headlineSpreadOf(TUBE)!;

  it("recovers the reported 6.24–9.09 safety-factor range", () => {
    expect(out.samples).toBe(4);
    expect(out.safetyFactorMin).toBeCloseTo(6.24, 10);
    expect(out.safetyFactorMax).toBeCloseTo(9.09, 10);
  });

  it("recovers the ~46% spread the issue is named for", () => {
    expect(out.safetyFactorSpread!).toBeCloseTo((9.09 - 6.24) / 6.24, 10);
    expect(out.safetyFactorSpread!).toBeGreaterThan(0.45);
    expect(out.peakSpread).toBeCloseTo((8.017 - 5.500) / 5.500, 10);
  });

  it("detects the NON-monotonicity, which is the actionable half", () => {
    // The 65k mesh reports a HIGHER peak than the 81k mesh. This is what makes
    // "just refine more" useless advice on this part, so the wording branches
    // on it and the report colours on it.
    expect(out.monotoneInDensity).toBe(false);
    expect(out.note).toMatch(/did NOT move consistently with element count/);
    expect(out.note).toMatch(/singularity/);
    // Must not tell the reader to refine, which is the wrong remedy here.
    expect(out.note).not.toMatch(/finer mesh is (a |the )?more trustworthy/);
  });

  it("states the range in the note, not just the percentage", () => {
    // "SF 6.24–9.09" is what a user can act on; "46%" alone is not.
    expect(out.note).toMatch(/6\.24/);
    expect(out.note).toMatch(/9\.09/);
    expect(out.note).toMatch(/45\.7%|46\.\d%/);
  });
});

describe("headlineSpreadOf — the smooth control must stay quiet (issue #256)", () => {
  const out = headlineSpreadOf(SMOOTH)!;

  it("reports the small, monotone spread of a converging part", () => {
    expect(out.monotoneInDensity).toBe(true);
    expect(out.safetyFactorSpread!).toBeLessThan(0.03);
  });

  it("issues NO warning for a part that converged", () => {
    // The whole point of the 5% cutoff. A tool that warns on every part has not
    // told anyone anything, and this fixture is the one where "converged" is
    // demonstrable rather than assumed.
    expect(out.note).toBe("");
  });
});

describe("headlineSpreadOf — monotone-but-large keeps a softer message", () => {
  it("says the number is still settling rather than blaming a singularity", () => {
    // A part refining consistently toward a limit but not there yet is a
    // different situation from a non-converging peak, and the remedy IS a finer
    // mesh. Conflating the two would make the warning wrong half the time.
    const settling = [s(1000, 10.0, 10.0), s(4000, 11.5, 8.7), s(9000, 12.0, 8.3)];
    const out = headlineSpreadOf(settling)!;
    expect(out.monotoneInDensity).toBe(true);
    expect(out.note).toMatch(/still settling/);
    expect(out.note).not.toMatch(/did NOT move consistently/);
  });

  it("judges monotonicity in DENSITY order, not history order", () => {
    // The loop can accept meshes out of density order (it keeps the best-error
    // solve, not the last). Reading the array order would then report a
    // non-monotone sequence that is monotone in the variable that matters.
    const ordered   = [s(1000, 10.0, 5), s(4000, 11.5, 4), s(9000, 12.0, 3)];
    const shuffled  = [s(9000, 12.0, 3), s(1000, 10.0, 5), s(4000, 11.5, 4)];
    expect(headlineSpreadOf(shuffled)!.monotoneInDensity)
      .toBe(headlineSpreadOf(ordered)!.monotoneInDensity);
    expect(headlineSpreadOf(shuffled)!.monotoneInDensity).toBe(true);
  });

  it("treats a decreasing sequence as monotone too", () => {
    const falling = [s(1000, 14.0, 3.5), s(4000, 12.5, 4.0), s(9000, 12.0, 4.2)];
    expect(headlineSpreadOf(falling)!.monotoneInDensity).toBe(true);
  });
});

describe("headlineSpreadOf — degraded solves (issue #256)", () => {
  it("still reports the peak spread when no safety factor is available", () => {
    // A mesh-fallback solve reports safetyFactor null. Losing the whole
    // measurement because one of the two numbers is missing would hide the
    // sensitivity on exactly the runs that are already least trustworthy.
    const out = headlineSpreadOf([s(1000, 10, null), s(9000, 14, null)])!;
    expect(out).toBeDefined();
    expect(out.safetyFactorSpread).toBeNull();
    expect(out.safetyFactorMin).toBeNull();
    expect(out.peakSpread).toBeCloseTo(0.4, 10);
    // Materiality falls back to the peak, so the warning still fires.
    expect(out.note).not.toBe("");
    expect(out.note).toMatch(/peak stress/);
  });

  it("needs two safety factors, not one, before reporting an SF range", () => {
    const out = headlineSpreadOf([s(1000, 10, 5), s(9000, 14, null)])!;
    expect(out.safetyFactorSpread).toBeNull();
    expect(out.peakSpread).toBeCloseTo(0.4, 10);
  });
});
