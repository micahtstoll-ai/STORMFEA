/**
 * report-caveats.test.ts
 * ----------------------
 * The printed HTML report (server/report.ts) must surface the same
 * reliability caveats the app shows, in print-safe form. These tests render
 * the report for each compromised state and assert the caveat text appears,
 * and that a clean converged run shows none of them.
 *
 * Covers issues:
 *   #196 — reliability caveats (mesh fallback, non-convergence,
 *          under-constrained rotation, degraded two-region, LOW-confidence
 *          wall bond)
 *   #202 — overall discretization-error figure in the mesh section
 *   #204 — "linear first-yield estimate" fail-force caveat + buckling-limited
 *          fail force
 *   #189 — C3D4 bending-underprediction caveat
 */

import { describe, it, expect } from "vitest";
import { generateHtmlReport } from "../../report.js";
import type { AnalysisResult } from "../../analysis.js";

const PRINT_SETTINGS = {
  materialId: "pla",
  infillPct: 40,
  wallCount: 3,
  pattern: "grid",
  orientation: "flat",
  layerHeightMm: 0.2,
};

/** A clean, converged, single-material C3D10 result — no caveats expected.
 *  Only the fields report.ts reads are populated; cast through unknown so the
 *  test stays decoupled from unrelated AnalysisResult fields. */
function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  const base = {
    maxVonMisesMPa: 12.3,
    maxDisplacementMm: 0.45,
    effectiveYieldMPa: 30,
    safetyFactor: 2.44,
    vonMisesSafetyFactor: 2.44,
    estimatedFailForce: 812,
    safetyfactorLow: 1.9,
    safetyFactorHigh: 3.1,
    verdict: "Safe — SF 2.44×",
    sfCriterion: "fdm-interface" as const,
    converged: true,
    meshFallback: false,
    rigidBodyMode: null,
    nodeCount: 41234,
    elementCount: 28012,
    nodesPerElem: 10,
    globalRelativeError: 0.062,
    calibrationId: null,
    singularity: null,
    topologySuggestions: [],
    holeClassifications: [],
    failureModes: [
      { mode: "Bulk yield", checked: true, sf: 2.44, confidence: "high", note: "Von Mises vs effective yield. OK." },
    ],
    fatigue: {
      fatigueConcern: false,
      estimatedCycles: null,
      fatigueSF: 2.0,
      enduranceLimitMPa: 10,
      confidence: "low",
    },
    isotropicComparison: null,
    materialModel: { twoRegion: false },
    bucklingResult: undefined,
  };
  return { ...base, ...overrides } as unknown as AnalysisResult;
}

const render = (overrides: Partial<AnalysisResult> = {}) =>
  generateHtmlReport(makeResult(overrides), "part.step", PRINT_SETTINGS, "2026-07-27 12:00");

describe("report reliability caveats (#196)", () => {
  it("a clean converged run shows no reliability caveat", () => {
    const html = render();
    expect(html).not.toContain("mesh fallback");
    expect(html).not.toContain("did not converge");
    expect(html).not.toContain("Under-constrained rotation");
    expect(html).not.toContain("material model degraded");
    expect(html).not.toContain("Wall-to-wall bond — LOW confidence");
  });

  it("mesh fallback surfaces the bounding-box caveat", () => {
    const html = render({ meshFallback: true, safetyFactor: null });
    expect(html).toContain("mesh fallback");
    expect(html).toContain("solid bounding box");
    expect(html).toContain("not modelled");
  });

  it("non-convergence surfaces the unreliable-stress-field caveat", () => {
    const html = render({ converged: false });
    expect(html).toContain("Solver did not converge");
    expect(html).toContain("unreliable in either direction");
  });

  it("under-constrained rotation surfaces even when the solve converged", () => {
    const html = render({
      converged: true,
      rigidBodyMode: { detected: true, message: "Two bolts are collinear; the applied load spins the part about that axis." } as any,
    });
    expect(html).toContain("Under-constrained rotation detected");
    expect(html).toContain("collinear");
  });

  it("non-convergence WITH rigid-body mode names the rotation in the heading", () => {
    const html = render({
      converged: false,
      rigidBodyMode: { detected: true, message: "Collinear constraints leave a free rotation." } as any,
    });
    expect(html).toContain("under-constrained rotation");
    expect(html).toContain("Collinear constraints");
  });

  it("degraded two-region model surfaces its reason", () => {
    const html = render({ materialModel: { twoRegion: false, degraded: "wall band thinner than one element" } as any });
    expect(html).toContain("material model degraded");
    expect(html).toContain("wall band thinner than one element");
  });

  it("wall-to-wall bond surfaces the LOW-confidence caveat", () => {
    const html = render({
      materialModel: {
        twoRegion: true,
        wallBond: { yieldWallMPa: 5, yieldWallShearMPa: 3, relStrength: 0.8, perimeterLengthMm: 120, perimeterFallback: false },
      } as any,
    });
    expect(html).toContain("Wall-to-wall bond — LOW confidence");
    expect(html).toContain("no bead-to-bead");
  });
});

describe("report mesh & discretization figure (#202)", () => {
  it("shows node/element counts, element type and the overall discretization error", () => {
    const html = render({ nodeCount: 41234, elementCount: 28012, nodesPerElem: 10, globalRelativeError: 0.062 });
    expect(html).toContain("41,234 nodes");
    expect(html).toContain("28,012 elements");
    expect(html).toContain("C3D10 quadratic tet");
    expect(html).toContain("Overall discretization error:");
    expect(html).toContain("6.2%");
  });

  it("omits the discretization figure when it was not computed", () => {
    const html = render({ globalRelativeError: undefined });
    expect(html).not.toContain("Overall discretization error:");
    // node/element counts still print
    expect(html).toContain("nodes");
  });
});

describe("report fail-force honesty + buckling (#204)", () => {
  it("softens the label and carries the first-yield caveat by default", () => {
    const html = render();
    expect(html).toContain("Est. Failure Load");
    expect(html).not.toContain(">Fail Force<");
    expect(html).toContain("Linear first-yield estimate");
    expect(html).toContain("812"); // unchanged first-yield value
  });

  it("shows the buckling-limited load when a BLF governs (BLF < SF)", () => {
    const html = render({
      estimatedFailForce: 812,
      safetyFactor: 2.44,
      bucklingResult: { blf: 1.5, verdict: "MARGINAL" } as any,
    });
    expect(html).toContain("buckling-limited");
    expect(html).toContain("Buckling governs");
    // 812 * 1.5 / 2.44 ≈ 499 N
    expect(html).toContain("499");
  });

  it("keeps the first-yield estimate when the BLF does not govern (BLF > SF)", () => {
    const html = render({
      estimatedFailForce: 812,
      safetyFactor: 2.44,
      bucklingResult: { blf: 5.0, verdict: "PASS" } as any,
    });
    expect(html).not.toContain("buckling-limited");
    expect(html).toContain("812");
  });
});
