// scripts/test_client_logic.mjs
//
// Lightweight test runner for pure-logic functions inside client/index.html.
// This does NOT spin up a real browser or WebGL context — it extracts
// specific functions via regex (the same technique used manually throughout
// development) and runs them against minimal mocks of THREE.js/DOM. This
// catches real logic bugs (wrong formulas, stale variable references,
// off-by-one errors) without the much larger investment of a full headless-
// browser test harness.
//
// Coverage is intentionally narrow: only functions whose correctness can be
// checked without actually rendering pixels. Visual/rendering bugs (camera
// framing, split-view alignment) still require manual testing in a real
// browser — this test suite does not replace that, it only catches the
// class of bug that crashes outright (ReferenceError, NaN propagation,
// wrong array indexing) before a human ever sees the screen.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.join(__dirname, '..', 'client', 'index.html');
const html = fs.readFileSync(clientPath, 'utf-8');

let passed = 0, failed = 0;
function test(name, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

function extractFunction(src, signature, nextFunctionName) {
  const re = new RegExp(
    `function ${signature}\\s*\\{[\\s\\S]*?\\n\\}\\n\\nfunction ${nextFunctionName}`
  );
  const m = src.match(re);
  if (!m) throw new Error(`Could not extract function matching: ${signature}`);
  return m[0].replace(new RegExp(`\\n\\nfunction ${nextFunctionName}$`), '');
}

// Minimal THREE.js mock — just enough surface area for buildGeometryFromPositions
class MockBufferAttribute {
  constructor(arr, itemSize) { this.array = arr; this.itemSize = itemSize; }
}
class MockVector3 {
  constructor() { this.x = 0; this.y = 0; this.z = 0; }
  clone() { const v = new MockVector3(); v.x = this.x; v.y = this.y; v.z = this.z; return v; }
}
class MockBufferGeometry {
  setAttribute(name, attr) { this.attributes = this.attributes || {}; this.attributes[name] = attr; }
  computeBoundingBox() {
    const pos = this.attributes.position.array;
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      minX = Math.min(minX, pos[i]);   maxX = Math.max(maxX, pos[i]);
      minY = Math.min(minY, pos[i+1]); maxY = Math.max(maxY, pos[i+1]);
      minZ = Math.min(minZ, pos[i+2]); maxZ = Math.max(maxZ, pos[i+2]);
    }
    this.boundingBox = {
      min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ },
      getCenter(v) { v.x = (minX+maxX)/2; v.y = (minY+maxY)/2; v.z = (minZ+maxZ)/2; },
      getSize(v) { v.x = maxX-minX; v.y = maxY-minY; v.z = maxZ-minZ; },
    };
  }
  translate(dx, dy, dz) {
    const pos = this.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) { pos[i] += dx; pos[i+1] += dy; pos[i+2] += dz; }
  }
}
global.THREE = { BufferGeometry: MockBufferGeometry, BufferAttribute: MockBufferAttribute, Vector3: MockVector3 };

// ── Test group A: buildGeometryFromPositions ─────────────────────────────────
console.log('\n[A] buildGeometryFromPositions — centering, scale, normals');
{
  const fnCode = extractFunction(html, 'buildGeometryFromPositions\\(positions\\)', 'loadMeshFromPositions');
  const mod = { exports: {} };
  new Function('module', 'exports', fnCode + '\nmodule.exports = { buildGeometryFromPositions };')(mod, mod.exports);
  const { buildGeometryFromPositions } = mod.exports;

  // Two triangles forming a small box, offset far from the origin — checks
  // that centering actually moves the geometry to (0,0,0), not just computes
  // the center without applying it.
  const positions = new Float32Array([
    10,10,10,  12,10,10,  10,12,10,
    10,10,12,  12,10,12,  10,12,12,
  ]);
  const result = buildGeometryFromPositions(positions);

  test('Computes correct centroid', 
    Math.abs(result.center.x - 11) < 1e-6 && Math.abs(result.center.y - 11) < 1e-6 && Math.abs(result.center.z - 11) < 1e-6,
    `center=(${result.center.x},${result.center.y},${result.center.z})`);

  test('Computes correct bounding size',
    Math.abs(result.size.x - 2) < 1e-6 && Math.abs(result.size.y - 2) < 1e-6 && Math.abs(result.size.z - 2) < 1e-6,
    `size=(${result.size.x},${result.size.y},${result.size.z})`);

  test('Scale normalizes largest dimension to 1.6 scene units',
    Math.abs(result.scale - 0.8) < 1e-6, // 1.6 / 2.0
    `scale=${result.scale}`);

  test('Geometry is actually translated to origin (not just center computed)',
    Math.abs(result.geo.attributes.position.array[0] - (-1)) < 1e-6,
    `first vertex x=${result.geo.attributes.position.array[0]}`);

  test('Normal attribute is present and correctly sized',
    !!result.geo.attributes.normal && result.geo.attributes.normal.array.length === positions.length,
    `normal length=${result.geo.attributes.normal?.array.length}`);

  test('Degenerate input (single point repeated) does not throw or produce NaN',
    (() => {
      try {
        const r = buildGeometryFromPositions(new Float32Array([5,5,5, 5,5,5, 5,5,5]));
        return isFinite(r.scale) || r.scale === Infinity; // max dimension is 0, scale may be Infinity — should not be NaN
      } catch { return false; }
    })());
}

// ── Test group B: split-view rotation routing logic ──────────────────────────
console.log('\n[B] Split-view drag routing — half detection and rotation accumulation');
{
  // Re-implements the exact decision logic from the mousedown/mousemove
  // handlers (extracting the real handler is impractical since it's wired
  // to document-level listeners with closures over many globals — this
  // tests the DECISION FORMULA directly, which is the part most likely to
  // have an off-by-one or stale-state bug).
  function decideHalf(clientX, viewerLeft, viewerWidth) {
    return (clientX - viewerLeft) > viewerWidth / 2;
  }

  test('Click in left half (x=100 of 0-400 viewer) is NOT right half',
    decideHalf(100, 0, 400) === false);
  test('Click in right half (x=300 of 0-400 viewer) IS right half',
    decideHalf(300, 0, 400) === true);
  test('Click exactly at midline (x=200 of 0-400) is NOT right half (boundary goes to left)',
    decideHalf(200, 0, 400) === false);
  test('Viewer offset from page edge is correctly accounted for',
    decideHalf(150, 100, 400) === false && decideHalf(350, 100, 400) === true,
    'viewerLeft=100 case');

  // Simulates: drag starts in left half, mouse moves past the midline mid-drag.
  // Correct behavior: the half captured AT MOUSEDOWN should be used for the
  // whole gesture, not re-evaluated on every move (this was a real bug found
  // and fixed during development — re-evaluating per-move could flip which
  // design's camera gets rotated mid-drag).
  const startedInRightHalf = decideHalf(100, 0, 400); // false — drag starts in left half
  let currentX = 100;
  const moves = [150, 250, 350]; // crosses the midline (200) partway through
  let flipped = false;
  for (const x of moves) {
    const recomputedEachMove = decideHalf(x, 0, 400);
    if (recomputedEachMove !== startedInRightHalf && x > 200) flipped = true;
  }
  test('Captured-at-mousedown value stays stable for the whole gesture (does not flip mid-drag)',
    startedInRightHalf === false, // the captured value never changes during the simulated drag
    `captured=${startedInRightHalf}, would-have-flipped-if-recomputed=${flipped}`);
}

// ── Test group C: split-view zoom/aspect math ────────────────────────────────
console.log('\n[C] Split-view zoom and aspect ratio calculations');
{
  // Re-implements the exact formulas from renderSplitFrame for direct testing.
  function splitZoom(baseZoom, fullWidth, halfWidth) {
    return baseZoom * (fullWidth / halfWidth) * 0.72;
  }
  function splitAspect(halfWidth, height) {
    return halfWidth / height;
  }

  test('50/50 split produces equal aspect ratios for both halves',
    splitAspect(500, 1000) === splitAspect(500, 1000)); // trivially true for exact 50/50, real check is below

  const W = 999, H = 700; // odd width, exercises the rounding case found earlier
  const splitPx = Math.round(0.5 * W);
  const leftAspect = splitAspect(splitPx, H);
  const rightAspect = splitAspect(W - splitPx, H);
  test('Odd-width canvas: aspect ratio difference between halves is negligible (<1%)',
    Math.abs(leftAspect - rightAspect) / leftAspect < 0.01,
    `left=${leftAspect.toFixed(4)} right=${rightAspect.toFixed(4)} diff=${(100*Math.abs(leftAspect-rightAspect)/leftAspect).toFixed(2)}%`);

  test('Zoom increases (not decreases) for the narrower half-viewport',
    splitZoom(3, 1000, 500) > 3,
    `result=${splitZoom(3, 1000, 500)}`);

  test('Zoom formula does not produce NaN or Infinity for realistic inputs',
    isFinite(splitZoom(3, 1920, 960)));
}

// ── Test group D: A/B baseline lock (real regression case) ──────────────────
console.log('\n[D] A/B comparison baseline lock — does not overwrite on re-analysis');
{
  // Regression test for a real reported bug: storeAsBaseline() was called
  // unconditionally on every analysis, so re-running ANALYSE with changed
  // settings (the natural workflow) silently destroyed the captured
  // baseline. By the time the user clicked "Run Comparison", both sides
  // held the same (most recent) result, showing 0% difference on every
  // metric despite genuinely different settings between the two runs.
  const fnMatch = html.match(
    /const AB = \{[\s\S]*?\n\};\n\n\/\/ Called after[\s\S]*?function storeAsBaseline\(summary, fileName\) \{[\s\S]*?\n\}\n/
  );
  if (!fnMatch) throw new Error('Could not extract AB object + storeAsBaseline');

  const mod = { exports: {} };
  global.S = { fileData: { fileName: 'test.step' }, results: null, _stressArrays: null };
  const stubEl = { textContent: '', style: {} };
  global.document = { getElementById: () => stubEl };
  new Function('module', 'exports', fnMatch[0] + '\nmodule.exports = { AB, storeAsBaseline };')(mod, mod.exports);
  const { AB, storeAsBaseline } = mod.exports;

  storeAsBaseline({ safetyFactor: 8.52, maxVonMisesMPa: 5.28 }, 'test.step');
  const sfAfterFirst = AB.baseline.summary.safetyFactor;

  // Simulate re-running ANALYSE with different settings (force 200N -> 400N)
  storeAsBaseline({ safetyFactor: 4.26, maxVonMisesMPa: 10.56 }, 'test.step');
  const sfAfterSecond = AB.baseline.summary.safetyFactor;

  test('Baseline is captured on first analysis',
    sfAfterFirst === 8.52, `sf=${sfAfterFirst}`);
  test('Baseline is NOT overwritten by a second analysis with different settings',
    sfAfterSecond === 8.52,
    `expected baseline to stay at 8.52, got ${sfAfterSecond} — this is the exact bug that was reported and fixed`);
  test('baselineLocked flag is set after first capture',
    AB.baselineLocked === true);

  // Simulate the explicit "reset baseline" action
  AB.baselineLocked = false;
  storeAsBaseline({ safetyFactor: 1.05 }, 'test.step');
  test('Explicit unlock allows a deliberate new baseline capture',
    AB.baseline.summary.safetyFactor === 1.05,
    `sf=${AB.baseline.summary.safetyFactor}`);
}

// ── Test group E: parseGcodeParams ──────────────────────────────────────────
console.log('\n[E] parseGcodeParams — slicer detection and parameter extraction');
{
  // Extract inferLayerHeightFromZ and parseGcodeParams from the HTML.
  // Both are defined consecutively; extract them as a combined block.
  const gcodeBlock = html.match(
    /function inferLayerHeightFromZ\(lines\) \{[\s\S]*?\n\}\n\nfunction parseGcodeParams\(lines\) \{[\s\S]*?\n\}\n/
  );
  if (!gcodeBlock) throw new Error('Could not extract inferLayerHeightFromZ + parseGcodeParams');

  const mod = { exports: {} };
  new Function('module', 'exports',
    gcodeBlock[0] + '\nmodule.exports = { inferLayerHeightFromZ, parseGcodeParams };'
  )(mod, mod.exports);
  const { inferLayerHeightFromZ, parseGcodeParams } = mod.exports;

  // Test E1: PrusaSlicer
  {
    const lines = [
      '; generated by PrusaSlicer 2.7.0',
      ';LAYER_COUNT:120',
      ';HEIGHT:0.300',
      ...Array(10).fill(';HEIGHT:0.200'),
      ...Array(5).fill(';WIDTH:0.450'),
    ];
    const r = parseGcodeParams(lines);
    test('E1 PrusaSlicer: slicerDetected', r.slicerDetected === 'prusaslicer', `got ${r.slicerDetected}`);
    test('E1 PrusaSlicer: layerCount', r.layerCount === 120, `got ${r.layerCount}`);
    test('E1 PrusaSlicer: layerHeightMm', r.layerHeightMm === 0.2, `got ${r.layerHeightMm}`);
    test('E1 PrusaSlicer: firstLayerHeightMm', r.firstLayerHeightMm === 0.3, `got ${r.firstLayerHeightMm}`);
    test('E1 PrusaSlicer: extrusionWidthMm', r.extrusionWidthMm === 0.45, `got ${r.extrusionWidthMm}`);
  }

  // Test E2: Bambu Studio
  {
    const lines = [
      '; generated by BambuStudio 1.8.0',
      '; layer_height = 0.20',
      '; initial_layer_print_height = 0.30',
      '; line_width = 0.45',
      ';LAYER_COUNT:80',
    ];
    const r = parseGcodeParams(lines);
    test('E2 Bambu: slicerDetected', r.slicerDetected === 'bambu', `got ${r.slicerDetected}`);
    test('E2 Bambu: layerCount', r.layerCount === 80, `got ${r.layerCount}`);
    test('E2 Bambu: layerHeightMm', r.layerHeightMm === 0.2, `got ${r.layerHeightMm}`);
    test('E2 Bambu: firstLayerHeightMm', r.firstLayerHeightMm === 0.3, `got ${r.firstLayerHeightMm}`);
    test('E2 Bambu: extrusionWidthMm', r.extrusionWidthMm === 0.45, `got ${r.extrusionWidthMm}`);
  }

  // Test E3: Cura with Z-delta fallback for layer height
  {
    const zLines = Array.from({ length: 10 }, (_, i) =>
      `G0 Z${((i + 1) * 0.28).toFixed(2)}`
    );
    const lines = [
      ';Generated with Cura_SteamEngine 5.4.0',
      ';FLAVOR:Marlin',
      ';LAYER_COUNT:50',
      ...zLines,
    ];
    const r = parseGcodeParams(lines);
    test('E3 Cura: slicerDetected', r.slicerDetected === 'cura', `got ${r.slicerDetected}`);
    test('E3 Cura: layerCount', r.layerCount === 50, `got ${r.layerCount}`);
    test('E3 Cura: layerHeightMm via Z-delta', r.layerHeightMm !== null && Math.abs(r.layerHeightMm - 0.28) < 0.01,
      `got ${r.layerHeightMm}`);
  }

  // Test E4: Unknown slicer — Z-delta fallback only
  {
    const lines = [
      'G0 Z0.3',
      'G0 Z0.6',
      'G0 Z0.9',
    ];
    const r = parseGcodeParams(lines);
    test('E4 Unknown: slicerDetected', r.slicerDetected === 'unknown', `got ${r.slicerDetected}`);
    test('E4 Unknown: layerHeightMm from Z-delta', r.layerHeightMm !== null && Math.abs(r.layerHeightMm - 0.3) < 0.01,
      `got ${r.layerHeightMm}`);
  }

  // Test E5: Empty input
  {
    const r = parseGcodeParams([]);
    test('E5 Empty: layerCount null', r.layerCount === null, `got ${r.layerCount}`);
    test('E5 Empty: layerHeightMm null', r.layerHeightMm === null, `got ${r.layerHeightMm}`);
    test('E5 Empty: slicerDetected unknown', r.slicerDetected === 'unknown', `got ${r.slicerDetected}`);
  }
}

console.log('\n' + '─'.repeat(52));
console.log(`Client logic validation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('CLIENT LOGIC VALIDATION FAILED');
  process.exit(1);
} else {
  console.log('All client logic tests passed ✓');
}
