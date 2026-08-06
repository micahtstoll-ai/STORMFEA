/**
 * governing-safety-factor.test.ts
 * --------------------------------
 * Issue #278: `summary.safetyFactor` and `summary.estimatedFailForce` were
 * derived from the FEM bulk-yield SF while `summary.verdict` was derived from
 * `lowestSF` — the minimum over ALL checked failure modes. The two are rendered
 * next to each other, so the app could simultaneously show
 *
 *     SF 3.00×  ·  FAIL FORCE (EST.) 600 N  ·  "Safe — exceeds 2× threshold"
 *     "Marginal — limited margin (SF 1.41×, governed by Thread strip-out)"
 *
 * on the same screen, with the optimistic number as the headline. The fix makes
 * the headline FOLLOW the governing mode (`governingSafetyFactor`) and discloses
 * the bulk-yield pair alongside it (`bulkSafetyFactor` / `bulkFailForceN` /
 * `governingMode`).
 *
 * What this file locks:
 *   1. COLLAPSE — with no checked analytic mode the governing SF is bit-identical
 *      to the bulk SF (this project's "flag off must stay bit-identical" rule
 *      applied to a headline number: parts that gained no new information must
 *      report exactly what they reported before #278).
 *   2. GOVERNANCE — the issue's own reproduction (M6 tapped hole, 4 mm plate,
 *      9 mm edge distance, 200 N, bulk SF 3.0) puts Thread strip-out at
 *      sf = 1.415 in front, and the headline follows it.
 *   3. AGREEMENT — the headline SF and the verdict sentence can never land in
 *      different tiers, because they are the same number by construction.
 */

import { describe, it, expect } from "vitest";
import {
  governingSafetyFactor,
  buildBaseVerdict,
  checkFailureModes,
  classifyHole,
  FAIL_SF_THRESHOLD,
  ACCEPTABLE_SF_THRESHOLD,
  SAFE_SF_THRESHOLD,
  type FailureModeResult,
} from "../../analysis.js";
import { generateHtmlReport } from "../../report.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

function row(over: Partial<FailureModeResult>): FailureModeResult {
  return {
    mode: "Some mode", sf: 5, failForceN: 500, checked: true,
    confidence: "medium", note: "note.",
    ...over,
  };
}

/** The unchecked buckling row `runAnalysis` pushes on EVERY run. */
const BUCKLING_UNCHECKED = row({
  mode: "Linear buckling (BLF)", sf: 0, failForceN: 0,
  checked: false, confidence: "unchecked",
  note: "Buckling analysis not available for this mesh type or solver configuration.",
});

/** The `sf = 999` sentinel row for a tensile-dominated part (no buckling mode). */
const BUCKLING_TENSILE = row({
  mode: "Linear buckling (BLF)", sf: 999, failForceN: 999_000,
  checked: true, confidence: "low",
  note: "Structure is tensile-dominated — no compressive buckling mode found.",
});

type Tier = "fail" | "marginal" | "acceptable" | "safe";

/** Tier of a safety factor, from the server's own exported thresholds. */
function tierOf(sf: number): Tier {
  if (sf < FAIL_SF_THRESHOLD)       return "fail";
  if (sf < ACCEPTABLE_SF_THRESHOLD) return "marginal";
  if (sf < SAFE_SF_THRESHOLD)       return "acceptable";
  return "safe";
}

/** Tier a reader would take away from the verdict SENTENCE. */
function tierOfVerdict(verdict: string): Tier {
  if (verdict.startsWith("Fails"))      return "fail";
  if (verdict.startsWith("Marginal"))   return "marginal";
  if (verdict.startsWith("Acceptable")) return "acceptable";
  if (verdict.startsWith("Safe"))       return "safe";
  throw new Error(`unclassifiable verdict: ${verdict}`);
}

/** The issue's reproduction, verbatim. */
function issue278Modes(): FailureModeResult[] {
  return checkFailureModes({
    holeClass:         { ...classifyHole(2.5, 40), type: "tapped_75", minorDiamMm: 5.0 },
    plateThicknessMm:  4,
    edgeDistMm:        9,
    holeSeparationMm:  0,
    appliedForceN:     200,
    effectiveYieldMPa: 39,
    bulkSF:            3.0,
    bulkCriterion:     "fdm-interface",
    orientation:       "flat",
    layerHeightMm:     0.2,
  });
}

// ─── 1. Collapse: no checked analytic mode ⇒ bit-identical to the bulk SF ──────

describe("#278 collapse — a part with NO checked failure mode reports exactly the bulk SF", () => {
  // Deliberately awkward values: a float that survives no rounding trip and one
  // that is not representable as a short decimal. `toBe` (Object.is), not
  // toBeCloseTo — the claim is bit-identity, not agreement.
  const BULK_SFS = [0.5, 1.0, 1.4999999999999998, 2.0, 3.0, 7.283456789012345, 1234.5];

  it("empty failure-mode list returns the bulk SF bit-for-bit", () => {
    for (const bulk of BULK_SFS) {
      expect(governingSafetyFactor(bulk, []).sf).toBe(bulk);
    }
  });

  it("only-unchecked rows (the always-present buckling row) return the bulk SF bit-for-bit", () => {
    for (const bulk of BULK_SFS) {
      const g = governingSafetyFactor(bulk, [BUCKLING_UNCHECKED]);
      expect(g.sf).toBe(bulk);
      // No row to point at, so the label falls back to bulk yield and the
      // verdict's own lowercase wording is preserved via `mode === null`.
      expect(g.mode).toBeNull();
      expect(g.label).toBe("Bulk yield");
    }
  });

  it("the derived fail force is bit-identical too (same expression, same operand)", () => {
    for (const bulk of BULK_SFS) {
      const totalAppliedForce = 137.5;
      const governing = governingSafetyFactor(bulk, [BUCKLING_UNCHECKED]).sf;
      expect(totalAppliedForce * governing).toBe(totalAppliedForce * bulk);
    }
  });

  it("the verdict sentence is unchanged for a collapsed part (pre-#278 wording, lowercase 'bulk yield')", () => {
    const g = governingSafetyFactor(0.8, [BUCKLING_UNCHECKED]);
    const verdict = buildBaseVerdict({
      lowestSF: g.sf, governingModeLabel: g.mode?.mode,
      totalAppliedForceN: 200, converged: true, cgIterations: 100,
    });
    expect(verdict).toBe("Fails — predicted to yield at 160 N (bulk yield)");
  });
});

// ─── 2. The sf = 999 sentinel must not raise the headline ─────────────────────

describe("#278 — the 'no buckling mode' sf=999 sentinel can never raise the headline", () => {
  it("a tensile-dominated hole-free part reports its bulk SF, not 999", () => {
    // Before #278 `lowestSF` was min() over the CHECKED rows only, with no bulk
    // seed. A hole-free isotropic part carries exactly one checked row — the
    // 999 sentinel — so the verdict announced "Safe — large margin (SF 999.00×)"
    // regardless of the bulk SF. This is the regression that made seeding the
    // reduce with `sf` mandatory, not merely tidy.
    const g = governingSafetyFactor(0.42, [BUCKLING_TENSILE]);
    expect(g.sf).toBe(0.42);
    expect(g.label).toBe("Bulk yield");
    expect(tierOf(g.sf)).toBe("fail");
  });

  it("a real buckling BLF below the bulk SF still governs", () => {
    const blf = row({ mode: "Linear buckling (BLF)", sf: 1.2, failForceN: 240, confidence: "low" });
    const g = governingSafetyFactor(3.0, [blf]);
    expect(g.sf).toBe(1.2);
    expect(g.label).toBe("Linear buckling (BLF)");
  });
});

// ─── 3. Governance: the issue's own reproduction ──────────────────────────────

describe("#278 reproduction — M6 tapped hole, 4 mm plate, 9 mm edge, 200 N, bulk SF 3.0", () => {
  const APPLIED_N = 200;

  it("thread strip-out is the governing mode at sf = 1.415 (the issue's measured value)", () => {
    const modes = issue278Modes();
    const g = governingSafetyFactor(3.0, modes);
    expect(g.label).toBe("Thread strip-out");
    expect(g.sf).toBeCloseTo(1.415, 3);
    // ...and it really is below every other checked row, bulk yield included.
    for (const m of modes) {
      if (m.checked) expect(m.sf).toBeGreaterThanOrEqual(g.sf);
    }
  });

  it("the headline SF follows the governing mode, not bulk yield", () => {
    const g = governingSafetyFactor(3.0, issue278Modes());
    expect(g.sf).toBeLessThan(3.0);
    expect(tierOf(g.sf)).toBe("marginal");
    // The pre-#278 headline (bulk yield) would have been "safe" — the exact
    // contradiction reported in the issue.
    expect(tierOf(3.0)).toBe("safe");
  });

  it("the headline fail force is 283 N (governing), and 600 N is disclosed as the bulk-yield figure", () => {
    const g = governingSafetyFactor(3.0, issue278Modes());
    expect(APPLIED_N * g.sf).toBeCloseTo(283, 0);
    expect(APPLIED_N * 3.0).toBe(600);
  });

  it("the verdict sentence names the same mode and the same number as the headline", () => {
    const g = governingSafetyFactor(3.0, issue278Modes());
    const verdict = buildBaseVerdict({
      lowestSF: g.sf, governingModeLabel: g.mode?.mode,
      totalAppliedForceN: APPLIED_N, converged: true, cgIterations: 100,
    });
    expect(verdict).toContain("Thread strip-out");
    expect(verdict).toContain(g.sf.toFixed(2));
  });
});

// ─── 4. Agreement: headline and verdict can never report different tiers ──────

describe("#278 agreement — the headline SF and the verdict are always the same tier", () => {
  // Sweep straight across every tier boundary, including the exact boundary
  // values (1.0, 1.5, 2.0) where an off-by-one comparison would show up.
  const SWEEP = [
    0.01, 0.42, 0.999, 0.9999999, 1.0, 1.0000001, 1.2, 1.4999, 1.5,
    1.5000001, 1.75, 1.9999, 2.0, 2.0000001, 2.4, 2.5, 3.0, 12.7, 999,
  ];

  it("every SF in the sweep lands in the same tier on both surfaces (bulk governs)", () => {
    for (const sf of SWEEP) {
      const g = governingSafetyFactor(sf, [BUCKLING_UNCHECKED]);
      const verdict = buildBaseVerdict({
        lowestSF: g.sf, governingModeLabel: g.mode?.mode,
        totalAppliedForceN: 200, converged: true, cgIterations: 100,
      });
      expect(tierOfVerdict(verdict), `SF ${sf} → "${verdict}"`).toBe(tierOf(g.sf));
    }
  });

  it("every SF in the sweep lands in the same tier on both surfaces (an analytic mode governs)", () => {
    for (const sf of SWEEP) {
      // Bulk yield is comfortably "safe" in every case; an analytic mode drags
      // the headline down. Both surfaces must move together.
      const analytic = row({ mode: "Thread strip-out", sf, failForceN: 200 * sf });
      const g = governingSafetyFactor(50, [analytic, BUCKLING_UNCHECKED]);
      const verdict = buildBaseVerdict({
        lowestSF: g.sf, governingModeLabel: g.mode?.mode,
        totalAppliedForceN: 200, converged: true, cgIterations: 100,
      });
      expect(g.sf).toBe(Math.min(sf, 50));
      expect(tierOfVerdict(verdict), `SF ${sf} → "${verdict}"`).toBe(tierOf(g.sf));
    }
  });

  it("the governing SF is never above the bulk SF, whatever the rows say", () => {
    const rows = [
      row({ mode: "Net-section tension", sf: 5.07 }),
      row({ mode: "Shear-out",           sf: 4.259 }),
      row({ mode: "Bearing (hole wall)", sf: 4.68 }),
      BUCKLING_TENSILE,
      row({ mode: "Bearing (hole wall)", sf: 0, checked: false, confidence: "unchecked" }),
    ];
    for (const bulk of [0.1, 1.0, 2.5, 4.0, 6.0, 1000]) {
      expect(governingSafetyFactor(bulk, rows).sf).toBeLessThanOrEqual(bulk);
    }
  });

  it("an unconverged solve still refuses to say Safe, using the governing SF", () => {
    const g = governingSafetyFactor(3.0, issue278Modes());
    const verdict = buildBaseVerdict({
      lowestSF: g.sf, governingModeLabel: g.mode?.mode,
      totalAppliedForceN: 200, converged: false, cgIterations: 5000,
    });
    expect(verdict).toMatch(/^Inconclusive/);
    expect(verdict).not.toMatch(/Safe/);
    expect(verdict).toContain(g.sf.toFixed(2));
  });
});

// ─── 5. Disclosure renders in the printed report ──────────────────────────────

describe("#278 disclosure — the HTML report shows governing, mode and bulk together", () => {
  const PRINT_SETTINGS = {
    materialId: "pla", infillPct: 20, wallCount: 3,
    pattern: "gyroid", orientation: "flat", layerHeightMm: 0.2,
  };

  /** Minimal structurally-valid result stub — same shape as report.test.ts's. */
  function result(over: Record<string, unknown> = {}) {
    return {
      materialModel: { twoRegion: false },
      maxVonMisesMPa: 12.5,
      maxDisplacementMm: 0.42,
      effectiveYieldMPa: 39,
      safetyFactor: 1.415,
      bulkSafetyFactor: 3.0,
      governingMode: "Thread strip-out",
      estimatedFailForce: 283,
      bulkFailForceN: 600,
      verdict: "Marginal — limited margin (SF 1.41×, governed by Thread strip-out)",
      failureModes: [
        { mode: "Thread strip-out", sf: 1.415, failForceN: 283, checked: true, confidence: "medium", note: "n." },
        { mode: "Bulk yield",       sf: 3.0,   failForceN: 600, checked: true, confidence: "high",   note: "n." },
      ],
      holeClassifications: [],
      fatigue: { estimatedCycles: null, fatigueConcern: false, fatigueSF: 3.1, enduranceLimitMPa: 22, confidence: "medium" },
      singularity: null,
      topologySuggestions: [],
      calibrationId: null,
      converged: true,
      meshFallback: false,
      rigidBodyMode: null,
      sfCriterion: "fdm-interface",
      safetyfactorLow: 2.4,
      safetyFactorHigh: 3.6,
      isotropicComparison: null,
      nodesPerElem: 10,
      ...over,
    };
  }

  const render = (over: Record<string, unknown> = {}) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generateHtmlReport(result(over) as any, "bracket.step", PRINT_SETTINGS, "2026-08-06");

  it("labels the headline as governing and names the governing mode", () => {
    const html = render();
    expect(html).toMatch(/Safety Factor \(governing\)/i);
    expect(html).toMatch(/Est\. Failure Load \(governing\)/i);
    expect(html).toMatch(/Governed by Thread strip-out/i);
  });

  it("shows the bulk-yield SF and fail force beside the headline", () => {
    const html = render();
    expect(html).toMatch(/Bulk yield alone: 3\.00×/);
    expect(html).toMatch(/Bulk yield alone: 600 N/);
    // ...and the band is explicitly a BULK-yield band, centred on 3.00×.
    expect(html).toMatch(/Bulk-yield SF uncertainty band:.*3\.00×/);
  });

  it("says nothing extra when bulk yield itself governs", () => {
    const html = render({
      safetyFactor: 3.0, bulkSafetyFactor: 3.0,
      estimatedFailForce: 600, bulkFailForceN: 600,
      governingMode: "Bulk yield",
    });
    expect(html).not.toMatch(/Bulk yield alone/);
    expect(html).toMatch(/Governed by Bulk yield/i);
  });

  it("renders a pre-#278 payload (no bulk fields) exactly as before, via the legacy fallbacks", () => {
    const html = render({
      bulkSafetyFactor: undefined, bulkFailForceN: undefined, governingMode: undefined,
    });
    // No disclosure line is invented, and the governing mode still resolves —
    // from the first checked failure-mode row, as it did before #278.
    expect(html).not.toMatch(/Bulk yield alone/);
    expect(html).toMatch(/Governing failure mode: Thread strip-out/i);
  });
});
