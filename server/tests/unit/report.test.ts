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

// ── Issue #259: the error advice must depend on the CAUSE, not just the size ──
describe("generateHtmlReport — BC share of the discretization error (#259)", () => {
  const MESH = { nodeCount: 12000, elementCount: 8000 };

  it("high error with no BC data keeps the plain refine-the-mesh advice", () => {
    // Undefined means NOT MEASURED. It must not be read as "none of it is BC",
    // but with nothing to say we fall back to the size-only wording.
    const html = render({ ...MESH, globalRelativeError: 0.12 });
    expect(html).toMatch(/refine the mesh before trusting margins/i);
    expect(html).not.toMatch(/boundary-condition discontinuities/i);
  });

  it("high error that is mostly BC does NOT tell the reader to refine", () => {
    // The defect this issue is about: a bolt-constrained part printing
    // "refine the mesh" for an error no affordable mesh can move.
    const html = render({
      ...MESH, globalRelativeError: 0.12, bcSingularityErrorFraction: 0.62,
    });
    expect(html).toMatch(/a finer mesh will NOT fix this/i);
    expect(html).toMatch(/62% of it sits at boundary-condition discontinuities/i);
    expect(html).toMatch(/better bolt or load idealization/i);
    expect(html).not.toMatch(/refine the mesh before trusting margins/i);
  });

  it("a notable but not dominant share is reported without overriding the advice", () => {
    const html = render({
      ...MESH, globalRelativeError: 0.12, bcSingularityErrorFraction: 0.38,
    });
    // Still worth refining — most of the error is resolvable — but the reader
    // is told part of it is not.
    expect(html).toMatch(/refine the mesh before trusting margins/i);
    expect(html).toMatch(/38% of it sits at boundary-condition discontinuities/i);
    expect(html).not.toMatch(/a finer mesh will NOT fix this/i);
  });

  it("a small BC share is not mentioned at all", () => {
    const html = render({
      ...MESH, globalRelativeError: 0.12, bcSingularityErrorFraction: 0.05,
    });
    expect(html).toMatch(/refine the mesh before trusting margins/i);
    expect(html).not.toMatch(/boundary-condition discontinuities/i);
  });

  it("states the band is not comparable across mesh densities", () => {
    // The number falls with refinement mostly because the topological band
    // thins (40.6% -> 27.7% on one part), so it must never be read as a trend.
    const html = render({
      ...MESH, globalRelativeError: 0.12, bcSingularityErrorFraction: 0.62,
    });
    expect(html).toMatch(/not comparable across densities/i);
  });

  it("a LOW total error stays 'well resolved' regardless of the BC share", () => {
    // At 2% nothing needs doing, whatever the split — the advice must not turn
    // alarming just because most of a tiny error happens to sit at the rim.
    const html = render({
      ...MESH, globalRelativeError: 0.02, bcSingularityErrorFraction: 0.9,
    });
    expect(html).toMatch(/mesh is well resolved/i);
    expect(html).not.toMatch(/a finer mesh will NOT fix this/i);
  });
});

describe("generateHtmlReport — mesh sensitivity of the headline number (#256)", () => {
  /** An adaptive run that solved three meshes with a swinging safety factor. */
  const SWINGING = {
    adaptiveRefinement: {
      iterations: 3, stopReason: "max-iterations",
      initialGlobalError: 0.19, finalGlobalError: 0.11,
      initialElementCount: 44875, finalElementCount: 80866,
      degradedToTier: false, note: "",
      history: [
        { globalRelativeError: 0.19, elementCount: 44875, maxVonMisesMPa: 6.864, safetyFactor: 7.28 },
        { globalRelativeError: 0.14, elementCount: 65358, maxVonMisesMPa: 8.017, safetyFactor: 6.24 },
        { globalRelativeError: 0.11, elementCount: 80866, maxVonMisesMPa: 5.564, safetyFactor: 8.99 },
      ],
      headlineSpread: {
        samples: 3,
        safetyFactorMin: 6.24, safetyFactorMax: 8.99, safetyFactorSpread: 0.4407,
        peakMin: 5.564, peakMax: 8.017, peakSpread: 0.4409,
        monotoneInDensity: false,
        note: "Across the 3 meshes solved, the safety factor moved 6.24-8.99 (44.1%) and the peak stress 5.56-8.02 MPa (44.1%). It did NOT move consistently with element count, so a finer mesh is not a more trustworthy number here.",
      },
    },
  };

  it("prints the spread when the headline number is mesh-sensitive", () => {
    // The defect #256 opened on: the report showed a converging discretization
    // error next to a safety factor swinging 46%, with nothing saying so.
    const html = render(SWINGING);
    expect(html).toMatch(/Mesh sensitivity of the safety factor/i);
    expect(html).toMatch(/6\.24/);
    expect(html).toMatch(/8\.99/);
  });

  it("shows every mesh it measured, not just the range", () => {
    // A reader has to be able to check the claim. Bare percentages are not
    // auditable; the per-mesh rows are.
    const html = render(SWINGING);
    expect(html).toMatch(/44,875 el/);
    expect(html).toMatch(/80,866 el/);
    expect(html).toMatch(/SF 7\.28/);
  });

  it("says the range is not a confidence interval", () => {
    // It is bounded by how far apart the meshes happened to be and says nothing
    // about where the true value is. Printing a range without that sentence
    // invites it to be read as an error bar.
    const html = render(SWINGING);
    expect(html).toMatch(/not a confidence interval/i);
  });

  it("prints NOTHING for a run that converged", () => {
    // The 5% cutoff. A warning on every report is a warning on none.
    const converged = {
      adaptiveRefinement: {
        ...SWINGING.adaptiveRefinement,
        headlineSpread: {
          samples: 3,
          safetyFactorMin: 1.362, safetyFactorMax: 1.390, safetyFactorSpread: 0.0206,
          peakMin: 35.98, peakMax: 36.714, peakSpread: 0.0204,
          monotoneInDensity: true,
          note: "",
        },
      },
    };
    expect(render(converged)).not.toMatch(/Mesh sensitivity of the safety factor/i);
  });

  it("prints nothing on an ordinary single-mesh run", () => {
    // No adaptive loop ⇒ one solve ⇒ no spread to report. It must not invent one.
    expect(render()).not.toMatch(/Mesh sensitivity of the safety factor/i);
  });
});

describe("generateHtmlReport — element-order downgrade (#265)", () => {
  const DOWNGRADE = {
    nodesPerElem: 4,
    meshOrderDowngrade: {
      requestedOrder: 2, actualOrder: 1, rejectedAttempts: 2, bestElemMaxDev: 0.4,
      note: "The C3D10 meshes from this TetGen build were rejected twice by STORMFEA's midside node-ordering check, so the analysis was re-run with LINEAR (4-node) elements. The geometry is intact but bending stresses may be UNDERPREDICTED.",
    },
  };

  it("explains WHY the elements are linear", () => {
    // The existing C3D4 banner says the numbers are suspect but cannot say the
    // user did not choose this — that difference is what makes it actionable.
    const html = render(DOWNGRADE);
    expect(html).toMatch(/Element order was downgraded to linear/i);
    expect(html).toMatch(/node-ordering check/i);
  });

  it("keeps the existing C3D4 shear-locking banner as well", () => {
    // Two different statements: one about accuracy, one about provenance.
    // Neither substitutes for the other.
    const html = render(DOWNGRADE);
    expect(html).toMatch(/C3D4 linear elements/i);
    expect(html).toMatch(/Element order was downgraded/i);
  });

  it("prints nothing on a normal C3D10 run", () => {
    expect(render()).not.toMatch(/Element order was downgraded/i);
  });
});
