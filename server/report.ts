/**
 * report.ts — Server-side HTML report generation
 * ================================================
 * Generates a clean one-page HTML report from analysis results.
 * This is served as /api/report and rendered cleanly for print/PDF.
 * The client's browser print dialog saves it as PDF.
 *
 * Design goals:
 *   - Self-contained HTML (no external dependencies)
 *   - Nordic Storm branding (gold/dark)
 *   - Fits on one page when printed
 *   - All relevant data included with confidence labels
 */

import type { AnalysisResult } from "./analysis.js";
import { FAIL_SF_THRESHOLD, SAFE_SF_THRESHOLD } from "./analysis.js";

// ── HTML escaping (issue #281) ────────────────────────────────────────────────
// /api/report accepts an attacker-controlled `result` object (it's just the
// client's own analysis JSON posted back) and this file used to interpolate
// every string field from it straight into the page with zero escaping —
// verdict, failure-mode notes, hole warnings, the uploaded file's own name,
// print settings, etc. Route EVERY non-numeric interpolation through `esc`.
// Values that are already numbers run through `.toFixed()`/arithmetic are
// left alone (coercion, not concatenation, so there is nothing to inject);
// anything that reaches the page as a bare string — including numeric-ish
// fields like `infillPct`/`skinTopLayers` that are interpolated WITHOUT a
// `.toFixed()`/`Number()` conversion, and anything routed through
// `.toLocaleString()` (which on a non-number value, e.g. a string, just
// returns that value unchanged — NOT a safe numeric formatter) — is escaped.
// This only prevents HTML injection into element/attribute text; it must
// never be used to sanitize a value destined for a <script> or <style>
// context (none exist in this file today — see the audit note below).
function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function generateHtmlReport(
  result: AnalysisResult,
  fileName: string,
  printSettings: {
    materialId: string;
    infillPct: number;
    wallCount: number;
    pattern: string;
    orientation: string;
    layerHeightMm: number;
  },
  timestamp: string,
): string {
  const {
    maxVonMisesMPa, maxDisplacementMm, effectiveYieldMPa,
    safetyFactor, estimatedFailForce, verdict,
    failureModes, holeClassifications, fatigue, singularity,
    topologySuggestions, calibrationId,
    converged, meshFallback, rigidBodyMode,
    sfCriterion, safetyfactorLow, safetyFactorHigh,
    isotropicComparison, materialModel, nodesPerElem,
    nodeCount, elementCount, globalRelativeError, bcSingularityErrorFraction,
    bucklingResult, adaptiveRefinement, meshOrderDowngrade,
  } = result;

  // ── Issue #278 disclosure trio ────────────────────────────────────────────
  // `safetyFactor` / `estimatedFailForce` are the GOVERNING numbers (min over
  // bulk yield and every checked analytic mode) — the same quantity `verdict`
  // reports. The bulk-yield-only pair is printed beside them so the reader can
  // see all three at a glance: the governing number, which mode governs it, and
  // what bulk yield alone said.
  //
  // Every read is `?? <legacy fallback>`: this route renders a `result` POSTed
  // by the client, which may be a session saved before #278 and carry only the
  // old fields. Such a payload renders exactly as it did before.
  const bulkSafetyFactor = result.bulkSafetyFactor ?? safetyFactor;
  const bulkFailForceN   = result.bulkFailForceN   ?? estimatedFailForce;
  const governingMode    = result.governingMode
    ?? failureModes.find(m => m.checked)?.mode
    ?? 'Bulk yield';
  /** True when an analytic mode — not bulk yield — set the headline. */
  const analyticGoverns  = bulkSafetyFactor != null && safetyFactor != null
    && bulkSafetyFactor > safetyFactor + 1e-9;

  // C3D4 (linear tet, nodesPerElem===4) carries a documented ~55%
  // bending-stress underprediction from shear locking — never let the
  // printed report show a C3D4 result without this caveat (issue #189).
  // C3D10 (nodesPerElem===10, the default) gets no banner.
  const c3d4Caveat = nodesPerElem === 4
    ? `<div style="padding:8px 10px;margin-bottom:10px;background:#fff8e0;border:1px solid #8B6914;border-radius:3px;font-size:10px;color:#5c3a00">
        <b>&#9888; Computed with C3D4 linear elements:</b> underpredict bending stress by up to ~55% due to shear locking. The safety factor above may be more optimistic than the true value for bending-loaded geometry. Re-run with C3D10 before trusting this margin.
      </div>`
    : '';

  // Issue #204: estimatedFailForce is a linear first-yield extrapolation
  // (totalAppliedForce × SF, server/analysis.ts) presented with no caveat.
  // When buckling governs below that first-yield load, lead with the lower,
  // more honest number instead and flag it — the BLF and safetyFactor
  // needed to derive the applied load are both already on the result.
  let bucklingGoverns = false;
  let displayFailForce = estimatedFailForce;
  if (bucklingResult && bucklingResult.blf != null
      && bucklingResult.verdict !== 'no-buckling' && bucklingResult.verdict !== 'indeterminate'
      && safetyFactor != null && safetyFactor > 0) {
    const appliedForce = estimatedFailForce / safetyFactor;
    const bucklingForce = bucklingResult.blf * appliedForce;
    if (bucklingForce < estimatedFailForce) {
      bucklingGoverns = true;
      displayFailForce = bucklingForce;
    }
  }

  const criterionLabel =
    sfCriterion === "fdm-interface" ? "FDM dual criterion (bulk von Mises + interlayer interface)"
    : sfCriterion === "hill"        ? "Hill (1948) anisotropic criterion (legacy path)"
    : "Von Mises";

  // When the solve didn't converge or fell back to a box mesh, the SF is not
  // trustworthy — colour the verdict box neutral grey rather than a reassuring
  // green/amber so the printed report can't imply confidence it doesn't have.
  const unreliable = converged === false || meshFallback === true || safetyFactor === null;
  // Green only at/above SAFE_SF_THRESHOLD (issue #141) — shared with the
  // headline verdict text (analysis.ts baseVerdict) and client/index.html's
  // identically-named constants so the printed report can't disagree with
  // the app.
  const sfColor = unreliable ? '#5a5a5a'
    : safetyFactor >= SAFE_SF_THRESHOLD ? '#1a7a40' : safetyFactor >= FAIL_SF_THRESHOLD ? '#7a5a00' : '#7a1a1a';
  const verdictBg = unreliable ? '#ececec'
    : safetyFactor >= SAFE_SF_THRESHOLD ? '#e8f5ee' : safetyFactor >= FAIL_SF_THRESHOLD ? '#fff8e0' : '#fde8e8';

  const confBadge = (c: string) => {
    const colors: Record<string, string> = {
      high:'#1a5c2a', medium:'#5c3a00', low:'#5c1a00', unchecked:'#333'
    };
    return `<span style="font-size:9px;color:${colors[c]??'#333'};border:1px solid ${colors[c]??'#333'}44;padding:1px 5px;border-radius:2px">${esc(String(c).toUpperCase())}</span>`;
  };

  // Highlight the row that actually set the headline (by name, from
  // `governingMode`) rather than "the first checked row" — those coincide only
  // when the checked rows include the governing one (issue #278).
  const failureRows = failureModes.map(m => {
    const isGov = m.checked && m.mode === governingMode;
    return `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:4px 8px;font-weight:${isGov ? '600' : '400'};color:${isGov?'#8B6914':'#333'}">${isGov ? '▲ ' : ''}${esc(m.mode)}</td>
      <td style="padding:4px 8px;text-align:center;color:${m.checked?(m.sf>=SAFE_SF_THRESHOLD?'#1a7a40':m.sf>=FAIL_SF_THRESHOLD?'#5c3a00':'#7a1a1a'):'#999'}">${m.checked ? `${m.sf.toFixed(2)}×` : '—'}</td>
      <td style="padding:4px 8px;text-align:center">${confBadge(m.confidence)}</td>
      <td style="padding:4px 8px;font-size:10px;color:#666">${esc(m.note.split('.')[0])}.</td>
    </tr>`;
  }).join('');

  const holeRows = holeClassifications.map((h, i) => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:4px 8px">Hole ${i}</td>
      <td style="padding:4px 8px">${esc(h.bolt?.label ?? 'unknown')}</td>
      <td style="padding:4px 8px">${esc(h.type.replace('_', ' '))}</td>
      <td style="padding:4px 8px;color:${h.warning?'#7a1a1a':'#1a7a40'}">${h.warning ? esc(h.warning.slice(0,120)) : '✓ OK'}</td>
    </tr>`).join('');

  const topoList = topologySuggestions.slice(0, 2).map((t, i) => `
    <li style="margin-bottom:4px"><b>${esc(t.stressMPa)} MPa</b> at (${esc(t.position.join(', '))}) mm — ${esc(t.suggestion.slice(0, 120))}</li>
  `).join('');

  // ── Reliability caveats (issue #196) ──────────────────────────────────────
  // The app shows explicit banners for compromised results (client/index.html
  // reliabilityBanner, ~L6291-6321) but the printed report used to signal
  // this ONLY via a grey verdict box — indistinguishable from a normal result
  // once photocopied or grayscale-printed. Port every caveat state the app
  // can show into report text as well, wording kept in sync with the app.
  let reliabilityCaveats = '';
  const caveatBox = (title: string, body: string) => `
    <div style="padding:8px 10px;margin-bottom:8px;background:#fdf0e0;border:1px solid #7a1a1a;border-radius:3px;font-size:10px;color:#3a1a00">
      <div style="font-weight:700;color:#7a1a1a;margin-bottom:2px">&#9888; ${title}</div>
      <div style="line-height:1.5">${body}</div>
    </div>`;
  if (meshFallback) {
    reliabilityCaveats += caveatBox(
      'Approximate result — mesh fallback',
      'STL meshing failed, so the part was analysed as a solid bounding box. Holes, fillets, and stress concentrations are <b>not modelled</b> — the true peak stress is higher than shown. Re-export the STL (check for non-manifold edges or self-intersections) and re-run before trusting this number.',
    );
  }
  if (converged === false) {
    const convergenceDetail = (rigidBodyMode && rigidBodyMode.detected)
      ? esc(rigidBodyMode.message)
      : 'The linear solve did not reach its tolerance, so the stress field — and every number derived from it — is unreliable in either direction. Try a finer mesh or verify that the constraints fully restrain the part.';
    reliabilityCaveats += caveatBox(
      `Solver did not converge${rigidBodyMode && rigidBodyMode.detected ? ' — under-constrained rotation' : ''}`,
      convergenceDetail,
    );
  }
  if (converged !== false && rigidBodyMode?.detected) {
    reliabilityCaveats += caveatBox('Under-constrained rotation detected', esc(rigidBodyMode.message));
  }
  if (materialModel.twoRegion && materialModel.degraded) {
    reliabilityCaveats += caveatBox('Two-region material model degraded', esc(materialModel.degraded));
  } else if (!materialModel.twoRegion && materialModel.degraded) {
    reliabilityCaveats += caveatBox('Two-region material model requested but ran uniform', esc(materialModel.degraded));
  }
  if (materialModel.wallBond) {
    reliabilityCaveats += caveatBox(
      'Wall-to-wall bond — LOW confidence',
      `Wall-to-wall bond allowable ${materialModel.wallBond.yieldWallMPa.toFixed(2)} MPa tension / ${materialModel.wallBond.yieldWallShearMPa.toFixed(2)} MPa shear (×${materialModel.wallBond.relStrength.toFixed(2)} vs interlayer baseline, est. perimeter ${materialModel.wallBond.perimeterLengthMm.toFixed(0)} mm${materialModel.wallBond.perimeterFallback ? ' — fallback' : ''}) — no bead-to-bead coupon data.`,
    );
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>STORMFEA Report — ${esc(fileName)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Source+Sans+Pro:wght@400;600&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Source Sans Pro',sans-serif; color:#1a1814; background:#fff; font-size:11px; }
  .page { width:100%; max-width:960px; margin:0 auto; padding:24px 28px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #C9A227; padding-bottom:12px; margin-bottom:16px; }
  .title { font-family:'Rajdhani',sans-serif; font-size:22px; font-weight:700; color:#C9A227; letter-spacing:.1em; }
  .subtitle { font-size:10px; color:#888; letter-spacing:.08em; margin-top:2px; }
  .meta { text-align:right; font-size:10px; color:#888; line-height:1.6; }
  .verdict-box { padding:12px 16px; border-radius:4px; margin-bottom:14px; background:${verdictBg}; border:1px solid ${sfColor}44; }
  .verdict-text { font-size:14px; font-weight:600; color:${sfColor}; margin-bottom:3px; }
  .verdict-sub { font-size:10px; color:#666; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:14px; }
  .grid4 { display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:14px; }
  .card { background:#f8f6f0; border:1px solid #e0d8c8; border-radius:3px; padding:8px 10px; }
  .card-label { font-size:9px; color:#888; text-transform:uppercase; letter-spacing:.1em; margin-bottom:2px; }
  .card-value { font-size:16px; font-weight:600; color:#1a1814; }
  .card-unit { font-size:10px; color:#888; }
  .section-title { font-family:'Rajdhani',sans-serif; font-size:12px; font-weight:700; letter-spacing:.15em; color:#C9A227; text-transform:uppercase; border-bottom:1px solid #e0d8c8; padding-bottom:4px; margin-bottom:8px; }
  table { width:100%; border-collapse:collapse; font-size:10px; }
  th { background:#8B6914; color:#fff; padding:5px 8px; text-align:left; font-size:10px; font-weight:600; }
  .settings-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-bottom:14px; }
  .setting-item { font-size:10px; }
  .setting-label { color:#888; }
  .setting-value { color:#1a1814; font-weight:600; }
  .footer { border-top:1px solid #e0d8c8; padding-top:8px; margin-top:14px; display:flex; justify-content:space-between; font-size:9px; color:#888; }
  .badge { display:inline-block; padding:1px 6px; border-radius:2px; font-size:9px; border:1px solid; margin-left:6px; }
  .badge-calib { color:#1a5c2a; border-color:#1a5c2a44; background:#e8f5ee; }
  .badge-lit { color:#888; border-color:#88888844; }
  @media print { body { print-color-adjust:exact; -webkit-print-color-adjust:exact; } .page { padding:12px; } }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div>
      <div class="title">STORMFEA FEA REPORT</div>
      <div class="subtitle">FDM-Aware Finite Element Analysis · Nordic Storm FTC 5962</div>
    </div>
    <div class="meta">
      <div><b>${esc(fileName)}</b></div>
      <div>${esc(timestamp)}</div>
      <div>Team 5962 · BIOBUZZ 2026–2027</div>
      <div>
        ${calibrationId
          ? `<span class="badge badge-calib">CALIBRATED</span>`
          : `<span class="badge badge-lit">Literature defaults</span>`}
      </div>
    </div>
  </div>

  <!-- Reliability caveats -->
  ${reliabilityCaveats}

  <!-- Verdict -->
  ${c3d4Caveat}
  <div class="verdict-box">
    <div class="verdict-text">${esc(verdict)}</div>
    <div class="verdict-sub">
      Governing failure mode: ${esc(governingMode)} &nbsp;·&nbsp;
      ${singularity?.detected ? 'Stress singularity detected — see notes below' : '✓ No singularity detected'}
    </div>
  </div>

  <!-- Key Numbers -->
  <div class="grid4">
    <div class="card">
      <div class="card-label">Safety Factor (governing)</div>
      <div class="card-value" style="color:${sfColor}">${safetyFactor !== null ? safetyFactor.toFixed(2) : '—'}<span class="card-unit">×</span></div>
      <div class="card-unit" style="line-height:1.4">${safetyFactor !== null ? `Governed by ${esc(governingMode)}` : 'Not available'}${
        analyticGoverns ? `<br>Bulk yield alone: ${bulkSafetyFactor!.toFixed(2)}×` : ''}</div>
    </div>
    <div class="card">
      <div class="card-label">Peak Stress</div>
      <div class="card-value">${maxVonMisesMPa.toFixed(1)}<span class="card-unit"> MPa</span></div>
    </div>
    <div class="card">
      <div class="card-label">Est. Failure Load (governing)${bucklingGoverns ? ' (buckling-limited)' : ''}</div>
      <div class="card-value">${displayFailForce.toFixed(0)}<span class="card-unit"> N</span></div>
      <div class="card-unit">(${(displayFailForce/4.448).toFixed(0)} lbf)</div>
      <div class="card-unit" style="line-height:1.4">${safetyFactor !== null ? esc(governingMode) : '&nbsp;'}${
        analyticGoverns ? `<br>Bulk yield alone: ${bulkFailForceN.toFixed(0)} N` : ''}</div>
    </div>
    <div class="card">
      <div class="card-label">Max Displacement</div>
      <div class="card-value">${maxDisplacementMm.toFixed(3)}<span class="card-unit"> mm</span></div>
    </div>
  </div>

  <!-- Fail-force caveat (issue #204) — the number above is a linear
       first-yield extrapolation (totalAppliedForce × SF), not a definitive
       ultimate/collapse load. Every other point estimate in this report
       (SF band, fatigue) is disclosed with the same kind of humility. -->
  <div style="font-size:9px;color:#888;margin:-8px 0 14px;line-height:1.5">
    ${bucklingGoverns
      ? `Buckling-limited estimate: BLF ${bucklingResult!.blf!.toFixed(2)}× applied load, lower than the governing first-yield estimate of ${estimatedFailForce.toFixed(0)} N. Linear buckling can overestimate real capacity by 10–40% for imperfect FDM geometry.`
      : `Linear first-yield estimate: assumes stress ∝ load and failure at first yield (no plasticity/buckling redistribution). Actual capacity is typically higher for ductile bending, lower if buckling governs.`}
    ${analyticGoverns
      ? ` The governing mode here is <b>${esc(governingMode)}</b>, not bulk yield: the FEM bulk-yield check alone gives SF ${bulkSafetyFactor!.toFixed(2)}× (${bulkFailForceN.toFixed(0)} N). Bulk yield is the highest-confidence single number in this report — but the part is predicted to fail by the governing mode first, so the headline follows that (issue #278).`
      : ``}
  </div>

  <div class="grid2">
    <!-- Failure Modes -->
    <div>
      <div class="section-title">Failure Mode Analysis</div>
      <table>
        <thead><tr><th>Mode</th><th style="text-align:center">SF</th><th>Confidence</th><th>Note</th></tr></thead>
        <tbody>${failureRows}</tbody>
      </table>
    </div>

    <!-- Print Settings + Fatigue -->
    <div>
      <div class="section-title">Print Settings</div>
      <div class="settings-grid">
        <div class="setting-item"><div class="setting-label">Material</div><div class="setting-value">${esc(printSettings.materialId.toUpperCase())}</div></div>
        <div class="setting-item"><div class="setting-label">Infill</div><div class="setting-value">${esc(printSettings.infillPct)}% ${esc(printSettings.pattern)}</div></div>
        <div class="setting-item"><div class="setting-label">Walls</div><div class="setting-value">${esc(printSettings.wallCount)} perimeters</div></div>
        <div class="setting-item"><div class="setting-label">Orientation</div><div class="setting-value">${esc(printSettings.orientation)}</div></div>
        <div class="setting-item"><div class="setting-label">Layer height</div><div class="setting-value">${esc(printSettings.layerHeightMm)} mm</div></div>
        <div class="setting-item"><div class="setting-label">Eff. yield</div><div class="setting-value">${effectiveYieldMPa.toFixed(1)} MPa</div></div>
      </div>

      <div class="section-title" style="margin-top:8px">Fatigue Estimate</div>
      <div style="padding:8px 10px;background:${fatigue.fatigueConcern?'#fff8e0':'#e8f5ee'};border:1px solid ${fatigue.fatigueConcern?'#8B6914':'#1a7a40'}44;border-radius:3px;font-size:10px">
        <div style="font-weight:600;color:${fatigue.fatigueConcern?'#5c3a00':'#1a7a40'};margin-bottom:3px">
          ${fatigue.estimatedCycles === null ? '∞ Infinite life — below endurance limit' :
            fatigue.estimatedCycles < 100000 ? `~${esc(fatigue.estimatedCycles.toLocaleString())} cycles — fatigue concern` :
            `✓ ~${esc(fatigue.estimatedCycles.toLocaleString())} cycles`}
        </div>
        <div style="color:#666">Fatigue SF: ${esc(fatigue.fatigueSF)}× &nbsp;·&nbsp; Se: ${esc(fatigue.enduranceLimitMPa)} MPa &nbsp;·&nbsp; ${confBadge(fatigue.confidence)}</div>
      </div>
    </div>
  </div>

  <!-- Material model & criterion -->
  <div style="margin-bottom:14px">
    <div class="section-title">Material Model</div>
    <div style="font-size:10px;color:#444;line-height:1.7">
      <b>Failure criterion:</b> ${criterionLabel}.
      ${safetyfactorLow !== null && safetyFactorHigh !== null && bulkSafetyFactor !== null
        // Banded around the BULK SF, which is what the interlayer-property
        // literature ranges actually propagate through — NOT around the
        // governing headline (issue #278).
        ? `&nbsp;·&nbsp; <b>Bulk-yield SF uncertainty band:</b> ${safetyfactorLow.toFixed(2)}× (conservative) — ${bulkSafetyFactor.toFixed(2)}× — ${safetyFactorHigh.toFixed(2)}× (optimistic), from the interlayer-property literature ranges.`
        : ``}
      ${materialModel.twoRegion
        ? `<br><b>Two-region model:</b> ${((materialModel.shellVolumeFraction ?? 0) * 100).toFixed(0)}% dense wall band (perimeter ${materialModel.wallThicknessMm?.toFixed(2)} mm${
            materialModel.skinTopThicknessMm != null
              ? `, top skin ${materialModel.skinTopThicknessMm.toFixed(2)} mm (${esc(materialModel.skinTopLayers)} layers), bottom skin ${materialModel.skinBotThicknessMm?.toFixed(2)} mm (${esc(materialModel.skinBotLayers)} layers)${materialModel.skinLayersAssumed ? " — assumed slicer-default layer counts; set actual top/bottom layers for accuracy" : ""}${materialModel.skinBuildAxis === "assumed-z-up" ? " — skins assumed Z-up (no bed picked)" : ""}`
              : ``
          }) over a homogenized ${materialModel.core ? esc(materialModel.core.patternFamily) + " Gibson-Ashby" : ""} infill core; shell yield ${materialModel.shellYieldXYMPa?.toFixed(1)} MPa vs core ${materialModel.coreYieldXYMPa?.toFixed(1)} MPa.`
        : ``}
      ${materialModel.bond
        ? materialModel.bond.applied === false
          ? `<br><b>Bead-penetration bond model:</b> not applied — ${esc(materialModel.bond.note)}`
          : `<br><b>Bead-penetration bond model (${esc(String(materialModel.bond.confidence).toUpperCase())} confidence):</b> interlayer strength ×${materialModel.bond.relStrength.toFixed(2)}, stiffness ×${materialModel.bond.relStiffness.toFixed(2)} vs typical settings — interface ${(materialModel.bond.interfaceTempC ?? 0).toFixed(0)}°C on a ${(materialModel.bond.substrateTempC ?? 0).toFixed(0)}°C substrate, τ_cool ${(materialModel.bond.coolTimeConstS ?? 0).toFixed(1)} s${materialModel.bond.clamped ? " (clamped)" : ""}.`
        : ``}
      ${isotropicComparison
        ? `<br><b>vs conventional isotropic FEA:</b> ${esc(isotropicComparison.explanation)}`
        : ``}
    </div>
  </div>

  <!-- Mesh & discretization confidence (issue #202) — globalRelativeError
       and topErrorElements were computed and transmitted but never shown
       anywhere; this is the plain-percentage answer to "how much of the
       stress field is mesh, not physics?" next to the node/element counts
       a reviewer already expects here. -->
  ${nodeCount != null && elementCount != null ? `
  <div style="margin-bottom:14px">
    <div class="section-title">Mesh</div>
    <div style="font-size:10px;color:#444;line-height:1.7">
      <b>${esc(nodeCount.toLocaleString())}</b> nodes &nbsp;·&nbsp; <b>${esc(elementCount.toLocaleString())}</b> elements
      ${globalRelativeError != null ? (() => {
        const pct = globalRelativeError * 100;
        // Issue #259: the printed report gave the same size-only advice the app
        // did, so a bolt-constrained part came off the printer telling its
        // reader to refine a mesh that cannot fix the number. Same conditional
        // wording as client/index.html, kept in sync deliberately.
        const bcPct = bcSingularityErrorFraction != null ? bcSingularityErrorFraction * 100 : null;
        const bcDominant = bcPct != null && bcPct >= 50;
        const bcNotable  = bcPct != null && bcPct >= 33 && bcPct < 50;
        const errColor = pct < 5 ? '#1a7a40' : pct < 10 ? '#7a5a00' : '#7a1a1a';
        const errLabel = pct < 5 ? 'low — mesh is well resolved'
          : bcDominant ? 'dominated by the constraint idealization — a finer mesh will NOT fix this'
          : pct < 10 ? 'moderate — consider a finer mesh for final numbers'
          : 'high — refine the mesh before trusting margins';
        const bcNote = (bcDominant || bcNotable)
          ? ` <b>${bcPct!.toFixed(0)}% of it sits at boundary-condition discontinuities</b> — the rim of a constrained or loaded patch, singular by construction — and does not fall meaningfully under refinement.${bcDominant ? ' Reach for a better bolt or load idealization, not a finer mesh.' : ''} Band is defined by mesh adjacency, so this share is specific to this solve and not comparable across densities.`
          : ``;
        return ` &nbsp;·&nbsp; <b>Discretization error (η):</b> <span style="color:${errColor}">${pct.toFixed(1)}% — ${errLabel}</span>. Zienkiewicz-Zhu ESTIMATE of mesh-artifact share of the stress field, not an exact bound — lower is better.${bcNote}`;
      })() : ``}
    </div>
  </div>` : ``}

  <!-- Mesh sensitivity of the HEADLINE numbers (issue #256). The energy-norm
       readout above converges properly even on parts whose safety factor does
       not — measured 19.4% -> 11.1% while the safety factor swung 46% non-
       monotonically on the same runs. A reader shown only that percentage is
       being shown a well-behaved number next to a badly-behaved one, with
       nothing distinguishing them. Keep this comment free of the phrase the
       block above prints: comments ship to the reader and the tests match
       case-insensitively on it. -->
  ${adaptiveRefinement?.headlineSpread?.note ? (() => {
    const s = adaptiveRefinement.headlineSpread!;
    // Non-monotone is the stronger signal: a number that does not even move
    // consistently with density cannot be improved by refining.
    const bg = s.monotoneInDensity ? '#fff8e0' : '#fdeaea';
    const bd = s.monotoneInDensity ? '#e8cf8a' : '#e0a0a0';
    const fg = s.monotoneInDensity ? '#5c3a00' : '#7a1a1a';
    return `
  <div style="margin-bottom:14px;padding:8px 10px;background:${bg};border:1px solid ${bd};border-radius:3px;font-size:10px;color:${fg};line-height:1.7">
    <strong>&#9888; Mesh sensitivity of the safety factor</strong><br>
    ${esc(s.note)}
    <div style="margin-top:4px;color:#555">
      Measured over ${s.samples} solves of this part: ${adaptiveRefinement.history
        .map(h => `${esc(h.elementCount.toLocaleString())} el &rarr; ${h.safetyFactor != null ? `SF ${h.safetyFactor.toFixed(2)}` : 'SF &mdash;'} / ${h.maxVonMisesMPa.toFixed(2)} MPa`)
        .join(' &nbsp;·&nbsp; ')}.
      This is the range the meshes produced, not a confidence interval &mdash; it says whether refining changes the answer, not how close any of them is to the truth.
    </div>
  </div>`;
  })() : ``}

  <!-- Element-order downgrade (issue #265). The geometry is intact but the
       elements are linear, and C3D4 shear-locks in bending — the same reason
       the c3d4Caveat banner exists. This says WHY it happened, which the
       nodesPerElem banner cannot know. -->
  ${meshOrderDowngrade ? `
  <div style="margin-bottom:14px;padding:8px 10px;background:#fff8e0;border:1px solid #e8cf8a;border-radius:3px;font-size:10px;color:#5c3a00;line-height:1.7">
    <strong>&#9888; Element order was downgraded to linear</strong><br>
    ${esc(meshOrderDowngrade.note)}
  </div>` : ``}

  <!-- Holes + Topology -->
  <div class="grid2">
    <div>
      <div class="section-title">Hole Identification</div>
      <table>
        <thead><tr><th>Hole</th><th>Size</th><th>Type</th><th>Status</th></tr></thead>
        <tbody>${holeRows}</tbody>
      </table>
    </div>
    ${topologySuggestions.length ? `
    <div>
      <div class="section-title">Design Suggestions</div>
      <ul style="padding-left:14px;color:#444;line-height:1.7">${topoList}</ul>
    </div>` : '<div></div>'}
  </div>

  <!-- Singularity caveat. Deliberately OUTSIDE the design-suggestions block and
       printed in full. It used to be nested inside it, so a detected singularity
       vanished from the report whenever there were no topology suggestions; and
       it was truncated to 160 characters, which now cuts off exactly the part
       that says what to do about it. This is the caveat that tells the reader
       the headline safety factor is not a converged number (issues #257, #256,
       and the report-drops-caveats complaint in #196) — it does not get cut. -->
  ${singularity?.detected ? `
  <div style="margin-top:10px;padding:8px 10px;background:#fff8e0;border:1px solid #e8cf8a;border-radius:3px;font-size:10px;color:#5c3a00;line-height:1.7">
    <strong>${singularity.cause === "constraint-edge" ? "Constraint-edge singularity" : singularity.cause === "load-edge" ? "Loaded-edge singularity" : "Stress singularity"} detected (${esc(singularity.confidence)} confidence)</strong><br>
    ${esc(singularity.message)}
  </div>` : ''}

  <!-- Footer -->
  <div class="footer">
    <div>STORMFEA · Nordic Storm FTC 5962 · FDM-Aware FEA — Orthotropic Model + ${sfCriterion === "hill" ? "Hill Criterion" : "Dual Criterion (bulk + interlayer interface)"} + SPR Smoothing</div>
    <div>For comparison and ranking only — not safety certification</div>
  </div>

</div>
</body>
</html>`;
}
