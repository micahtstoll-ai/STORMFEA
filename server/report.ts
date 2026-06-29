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
    converged, meshFallback,
  } = result;

  const govMode = failureModes.find(m => m.checked);
  // When the solve didn't converge or fell back to a box mesh, the SF is not
  // trustworthy — colour the verdict box neutral grey rather than a reassuring
  // green/amber so the printed report can't imply confidence it doesn't have.
  const unreliable = converged === false || meshFallback === true;
  const sfColor = unreliable ? '#5a5a5a'
    : safetyFactor >= 2 ? '#1a7a40' : safetyFactor >= 1 ? '#7a5a00' : '#7a1a1a';
  const verdictBg = unreliable ? '#ececec'
    : safetyFactor >= 2 ? '#e8f5ee' : safetyFactor >= 1 ? '#fff8e0' : '#fde8e8';

  const confBadge = (c: string) => {
    const colors: Record<string, string> = {
      high:'#1a5c2a', medium:'#5c3a00', low:'#5c1a00', unchecked:'#333'
    };
    return `<span style="font-size:9px;color:${colors[c]??'#333'};border:1px solid ${colors[c]??'#333'}44;padding:1px 5px;border-radius:2px">${c.toUpperCase()}</span>`;
  };

  const failureRows = failureModes.map(m => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:4px 8px;font-weight:${m === govMode ? '600' : '400'};color:${m===govMode?'#8B6914':'#333'}">${m === govMode ? '▲ ' : ''}${m.mode}</td>
      <td style="padding:4px 8px;text-align:center;color:${m.checked?(m.sf>=2?'#1a7a40':m.sf>=1?'#5c3a00':'#7a1a1a'):'#999'}">${m.checked ? `${m.sf.toFixed(2)}×` : '—'}</td>
      <td style="padding:4px 8px;text-align:center">${confBadge(m.confidence)}</td>
      <td style="padding:4px 8px;font-size:10px;color:#666">${m.note.split('.')[0]}.</td>
    </tr>`).join('');

  const holeRows = holeClassifications.map((h, i) => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:4px 8px">Hole ${i}</td>
      <td style="padding:4px 8px">${h.bolt?.label ?? 'unknown'}</td>
      <td style="padding:4px 8px">${h.type.replace('_', ' ')}</td>
      <td style="padding:4px 8px;color:${h.warning?'#7a1a1a':'#1a7a40'}">${h.warning ? '⚠ ' + h.warning.slice(0,60) : '✓ OK'}</td>
    </tr>`).join('');

  const topoList = topologySuggestions.slice(0, 2).map((t, i) => `
    <li style="margin-bottom:4px"><b>${t.stressMPa} MPa</b> at (${t.position.join(', ')}) mm — ${t.suggestion.slice(0, 120)}</li>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>StressForm Report — ${fileName}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@600;700&family=Source+Sans+Pro:wght@400;600&display=swap');
  * { box-sizing:border-box; margin:0; padding:0; }
  body { font-family:'Source Sans Pro',sans-serif; color:#1a1814; background:#fff; font-size:11px; }
  .page { width:100%; max-width:960px; margin:0 auto; padding:24px 28px; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #B8860B; padding-bottom:12px; margin-bottom:16px; }
  .title { font-family:'Rajdhani',sans-serif; font-size:22px; font-weight:700; color:#B8860B; letter-spacing:.1em; }
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
  .section-title { font-family:'Rajdhani',sans-serif; font-size:12px; font-weight:700; letter-spacing:.15em; color:#B8860B; text-transform:uppercase; border-bottom:1px solid #e0d8c8; padding-bottom:4px; margin-bottom:8px; }
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
      <div class="title">STRESSFORM FEA REPORT</div>
      <div class="subtitle">FDM-Aware Finite Element Analysis · Nordic Storm FTC 5962</div>
    </div>
    <div class="meta">
      <div><b>${fileName}</b></div>
      <div>${timestamp}</div>
      <div>Team 5962 · BIOBUZZ 2026–2027</div>
      <div>
        ${calibrationId
          ? `<span class="badge badge-calib">⊗ CALIBRATED</span>`
          : `<span class="badge badge-lit">◇ Literature defaults</span>`}
      </div>
    </div>
  </div>

  <!-- Verdict -->
  <div class="verdict-box">
    <div class="verdict-text">${verdict}</div>
    <div class="verdict-sub">
      Governing failure mode: ${govMode?.mode ?? 'Bulk yield'} &nbsp;·&nbsp;
      ${singularity?.detected ? '⚠ Stress singularity detected — see notes below' : '✓ No singularity detected'}
    </div>
  </div>

  <!-- Key Numbers -->
  <div class="grid4">
    <div class="card">
      <div class="card-label">Safety Factor</div>
      <div class="card-value" style="color:${sfColor}">${safetyFactor.toFixed(2)}<span class="card-unit">×</span></div>
    </div>
    <div class="card">
      <div class="card-label">Peak Stress</div>
      <div class="card-value">${maxVonMisesMPa.toFixed(1)}<span class="card-unit"> MPa</span></div>
    </div>
    <div class="card">
      <div class="card-label">Fail Force</div>
      <div class="card-value">${estimatedFailForce.toFixed(0)}<span class="card-unit"> N</span></div>
      <div class="card-unit">(${(estimatedFailForce/4.448).toFixed(0)} lbf)</div>
    </div>
    <div class="card">
      <div class="card-label">Max Displacement</div>
      <div class="card-value">${maxDisplacementMm.toFixed(3)}<span class="card-unit"> mm</span></div>
    </div>
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
        <div class="setting-item"><div class="setting-label">Material</div><div class="setting-value">${printSettings.materialId.toUpperCase()}</div></div>
        <div class="setting-item"><div class="setting-label">Infill</div><div class="setting-value">${printSettings.infillPct}% ${printSettings.pattern}</div></div>
        <div class="setting-item"><div class="setting-label">Walls</div><div class="setting-value">${printSettings.wallCount} perimeters</div></div>
        <div class="setting-item"><div class="setting-label">Orientation</div><div class="setting-value">${printSettings.orientation}</div></div>
        <div class="setting-item"><div class="setting-label">Layer height</div><div class="setting-value">${printSettings.layerHeightMm} mm</div></div>
        <div class="setting-item"><div class="setting-label">Eff. yield</div><div class="setting-value">${effectiveYieldMPa.toFixed(1)} MPa</div></div>
      </div>

      <div class="section-title" style="margin-top:8px">Fatigue Estimate</div>
      <div style="padding:8px 10px;background:${fatigue.fatigueConcern?'#fff8e0':'#e8f5ee'};border:1px solid ${fatigue.fatigueConcern?'#8B6914':'#1a7a40'}44;border-radius:3px;font-size:10px">
        <div style="font-weight:600;color:${fatigue.fatigueConcern?'#5c3a00':'#1a7a40'};margin-bottom:3px">
          ${fatigue.estimatedCycles === null ? '∞ Infinite life — below endurance limit' :
            fatigue.estimatedCycles < 100000 ? `⚠ ~${fatigue.estimatedCycles.toLocaleString()} cycles — fatigue concern` :
            `✓ ~${fatigue.estimatedCycles.toLocaleString()} cycles`}
        </div>
        <div style="color:#666">Fatigue SF: ${fatigue.fatigueSF}× &nbsp;·&nbsp; Se: ${fatigue.enduranceLimitMPa} MPa &nbsp;·&nbsp; <span style="color:#888">LOW CONFIDENCE</span></div>
      </div>
    </div>
  </div>

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
      ${singularity?.detected ? `<div style="margin-top:6px;padding:6px 8px;background:#fff8e0;border-radius:3px;font-size:10px;color:#5c3a00">⚠ ${singularity.message.slice(0,160)}</div>` : ''}
    </div>` : '<div></div>'}
  </div>

  <!-- Footer -->
  <div class="footer">
    <div>StressForm v1.0 · Nordic Storm FTC 5962 · FDM-Aware FEA — Orthotropic Model + Hill Criterion + SPR Smoothing</div>
    <div>For comparison and ranking only — not safety certification</div>
  </div>

</div>
</body>
</html>`;
}
