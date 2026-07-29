/**
 * report.test.ts
 * ---------------
 * Issue #196: the printed report used to signal a compromised result ONLY
 * via a grey verdict box — indistinguishable from a normal result once
 * grayscale-printed or photocopied. generateHtmlReport() must now render
 * explicit text for each reliability caveat the app shows: mesh-quality
 * fallback, non-convergence, rigid-body/under-constrained rotation, and
 * degraded two-region material model (plus LOW-confidence wall-bond).
 *
 * A normal converged run must render NONE of these caveat blocks.
 */

import { describe, it, expect } from "vitest";
import { generateHtmlReport } from "../../report.js";
import type { AnalysisResult } from "../../analysis.js";

const PRINT_SETTINGS = {
  materialId: "pla", infillPct: 20, wallCount: 3,
  pattern: "gyroid", orientation: "flat", layerHeightMm: 0.2,
};

/** Minimal but structurally valid AnalysisResult stub — only the fields
 *  generateHtmlReport() actually reads are populated meaningfully; the rest
 *  are cast through `unknown` since report.ts never touches them. */
function baseResult(overrides: Record<string, unknown> = {}): AnalysisResult {
  return {
    materialModel: { twoRegion: false },
    maxVonMisesMPa: 12.5,
    maxDisplacementMm: 0.42,
    effectiveYieldMPa: 45,
    safetyFactor: 2.4,
    estimatedFailForce: 480,
    verdict: "Safe under applied load",
    failureModes: [],
    holeClassifications: [],
    fatigue: { estimatedCycles: null, fatigueConcern: false, fatigueSF: 3.1, enduranceLimitMPa: 22, confidence: "medium" },
    singularity: null,
    topologySuggestions: [],
    calibrationId: null,
    converged: true,
    meshFallback: false,
    rigidBodyMode: null,
    sfCriterion: "fdm-interface",
    safetyfactorLow: null,
    safetyFactorHigh: null,
    isotropicComparison: null,
    nodesPerElem: 10,
    ...overrides,
  } as unknown as AnalysisResult;
}

function render(overrides: Record<string, unknown> = {}) {
  return generateHtmlReport(baseResult(overrides), "bracket.step", PRINT_SETTINGS, "2026-07-29T00:00:00Z");
}

describe("generateHtmlReport — reliability caveats (#196)", () => {
  it("a normal converged run shows NO caveat text", () => {
    const html = render();
    expect(html).not.toMatch(/mesh fallback/i);
    expect(html).not.toMatch(/did not converge/i);
    expect(html).not.toMatch(/under-constrained rotation/i);
    expect(html).not.toMatch(/degraded/i);
  });

  it("mesh-fallback run shows the box-fallback caveat", () => {
    const html = render({ meshFallback: true, safetyFactor: null });
    expect(html).toMatch(/Approximate result — mesh fallback/i);
    expect(html).toMatch(/analysed as a solid bounding box/i);
    expect(html).toMatch(/not modelled/i);
  });

  it("non-converged run shows the non-convergence caveat", () => {
    const html = render({ converged: false });
    expect(html).toMatch(/Solver did not converge/i);
    expect(html).toMatch(/unreliable in either direction/i);
  });

  it("non-converged + rigid-body-mode shows the rigid-body message instead of the generic one", () => {
    const html = render({
      converged: false,
      rigidBodyMode: { detected: true, message: "Unresisted rotation about the mounting-hole axis." },
    });
    expect(html).toMatch(/Solver did not converge — under-constrained rotation/i);
    expect(html).toMatch(/Unresisted rotation about the mounting-hole axis\./);
  });

  it("converged run with rigid-body-mode still surfaces the under-constrained warning", () => {
    const html = render({
      converged: true,
      rigidBodyMode: { detected: true, message: "Unresisted rotation detected despite numeric convergence." },
    });
    expect(html).toMatch(/Under-constrained rotation detected/i);
    expect(html).toMatch(/Unresisted rotation detected despite numeric convergence\./);
  });

  it("degraded two-region model shows the degradation caveat", () => {
    const html = render({
      materialModel: { twoRegion: true, degraded: "wall band collapsed to zero thickness" },
    });
    expect(html).toMatch(/Two-region material model degraded/i);
    expect(html).toMatch(/wall band collapsed to zero thickness/);
  });

  it("two-region requested but ran uniform shows the distinct caveat wording", () => {
    const html = render({
      materialModel: { twoRegion: false, degraded: "infill percentage rounds to 100%" },
    });
    expect(html).toMatch(/requested but ran uniform/i);
    expect(html).toMatch(/infill percentage rounds to 100%/);
  });

  it("wall-bond model shows the LOW-confidence caveat", () => {
    const html = render({
      materialModel: {
        twoRegion: true,
        wallBond: {
          relStrength: 0.62, relStiffness: 0.8,
          yieldWallMPa: 18.4, yieldWallShearMPa: 11.2,
          perimeterLengthMm: 240, perimeterFallback: false,
        },
      },
    });
    expect(html).toMatch(/Wall-to-wall bond — LOW confidence/i);
    expect(html).toMatch(/no bead-to-bead coupon data/i);
  });
});
