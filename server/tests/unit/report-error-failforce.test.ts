/**
 * report-error-failforce.test.ts
 * -------------------------------
 * Issue #202: globalRelativeError (and node/element counts) must render in
 * the printed report's mesh section — it was computed and transmitted but
 * never shown anywhere.
 *
 * Issue #204: estimatedFailForce is a linear first-yield extrapolation
 * (totalAppliedForce × SF) presented with no caveat. generateHtmlReport()
 * must (a) always attach the linear-estimate caveat next to the fail-force
 * card, and (b) when the buckling mode's BLF × applied load is lower than
 * the first-yield estimate, display and flag the buckling-limited number
 * instead — the number itself must change, not just get a caveat.
 */

import { describe, it, expect } from "vitest";
import { generateHtmlReport } from "../../report.js";
import type { AnalysisResult } from "../../analysis.js";

const PRINT_SETTINGS = {
  materialId: "pla", infillPct: 20, wallCount: 3,
  pattern: "gyroid", orientation: "flat", layerHeightMm: 0.2,
};

function baseResult(overrides: Record<string, unknown> = {}): AnalysisResult {
  return {
    materialModel: { twoRegion: false },
    maxVonMisesMPa: 12.5,
    maxDisplacementMm: 0.42,
    effectiveYieldMPa: 45,
    safetyFactor: 2.0,
    estimatedFailForce: 500,
    verdict: "Safe under applied load",
    failureModes: [],
    holeClassifications: [],
    fatigue: { estimatedCycles: null, fatigueConcern: false, fatigueSF: 3.1, enduranceLimitMPa: 22, confidence: "medium" },
    singularity: null,
    topologySuggestions: [],
    calibrationId: null,
    converged: true,
    meshFallback: false,
    sfCriterion: "fdm-interface",
    safetyfactorLow: null,
    safetyFactorHigh: null,
    isotropicComparison: null,
    nodeCount: 5321,
    elementCount: 18400,
    globalRelativeError: undefined,
    bucklingResult: undefined,
    ...overrides,
  } as unknown as AnalysisResult;
}

function render(overrides: Record<string, unknown> = {}) {
  return generateHtmlReport(baseResult(overrides), "bracket.step", PRINT_SETTINGS, "2026-07-29T00:00:00Z");
}

describe("generateHtmlReport — discretization error readout (#202)", () => {
  it("omits the mesh error line when globalRelativeError is absent", () => {
    const html = render();
    expect(html).not.toMatch(/Discretization error/i);
    // node/element counts still render when present
    expect(html).toMatch(/5,321/);
    expect(html).toMatch(/18,400/);
  });

  it("shows the global relative error as a percentage next to node/element counts", () => {
    const html = render({ globalRelativeError: 0.083 });
    expect(html).toMatch(/Discretization error/i);
    expect(html).toMatch(/8\.3%/);
    expect(html).toMatch(/5,321/);
    expect(html).toMatch(/18,400/);
  });

  it("low error (<5%) reads as low-risk, high error (>10%) reads as high-risk", () => {
    const lowHtml = render({ globalRelativeError: 0.02 });
    expect(lowHtml).toMatch(/low — mesh is well resolved/i);
    const highHtml = render({ globalRelativeError: 0.15 });
    expect(highHtml).toMatch(/high — refine the mesh/i);
  });
});

describe("generateHtmlReport — fail-force caveat and buckling-governed selection (#204)", () => {
  it("always attaches the linear first-yield caveat to the fail-force card", () => {
    const html = render();
    expect(html).toMatch(/linear first-yield estimate/i);
    expect(html).toMatch(/not an? (definitive )?ultimate\/collapse load|assumes stress ∝ load/i);
  });

  it("card label reads 'Est. Failure Load', not the old definitive 'Will fail at' framing", () => {
    const html = render();
    expect(html).toMatch(/Est\. Failure Load/);
    expect(html).not.toMatch(/Will fail at/i);
  });

  it("no buckling result: displays the plain first-yield number", () => {
    const html = render();
    expect(html).toMatch(/500<span class="card-unit"> N<\/span>/);
    expect(html).not.toMatch(/buckling-limited/i);
  });

  it("buckling BLF x applied load ABOVE first-yield: first-yield still governs", () => {
    // appliedForce = estimatedFailForce/safetyFactor = 500/2 = 250N
    // BLF 5x -> bucklingForce = 1250N > 500N -> first yield governs
    const html = render({
      bucklingResult: { blf: 5.0, verdict: "PASS", converged: true, tensileDominated: false, indeterminate: false, hasMode: true },
    });
    expect(html).toMatch(/500<span class="card-unit"> N<\/span>/);
    expect(html).not.toMatch(/buckling-limited/i);
  });

  it("buckling BLF x applied load BELOW first-yield: shows the lower, buckling-limited number, flagged", () => {
    // appliedForce = 250N; BLF 1.2x -> bucklingForce = 300N < 500N
    const html = render({
      bucklingResult: { blf: 1.2, verdict: "MARGINAL", converged: true, tensileDominated: false, indeterminate: false, hasMode: true },
    });
    expect(html).toMatch(/300<span class="card-unit"> N<\/span>/);
    expect(html).toMatch(/buckling-limited/i);
    expect(html).toMatch(/BLF 1\.20×/);
  });

  it("'no-buckling' (tensile-dominated) verdict never overrides the first-yield number", () => {
    const html = render({
      bucklingResult: { blf: null, verdict: "no-buckling", converged: true, tensileDominated: true, indeterminate: false, hasMode: false },
    });
    expect(html).toMatch(/500<span class="card-unit"> N<\/span>/);
    expect(html).not.toMatch(/buckling-limited/i);
  });

  it("'indeterminate' verdict never overrides the first-yield number", () => {
    const html = render({
      bucklingResult: { blf: null, verdict: "indeterminate", converged: false, tensileDominated: false, indeterminate: true, hasMode: false },
    });
    expect(html).toMatch(/500<span class="card-unit"> N<\/span>/);
    expect(html).not.toMatch(/buckling-limited/i);
  });
});
