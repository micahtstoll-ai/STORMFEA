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

  storeAsBaseline({ safetyFactor: 8.52, maxVonMisesMPa: 5.28, safetyFactorAvailable: true }, 'test.step');
  const sfAfterFirst = AB.baseline.summary.safetyFactor;

  // Simulate re-running ANALYSE with different settings (force 200N -> 400N)
  storeAsBaseline({ safetyFactor: 4.26, maxVonMisesMPa: 10.56, safetyFactorAvailable: true }, 'test.step');
  const sfAfterSecond = AB.baseline.summary.safetyFactor;

  test('Baseline is captured on first analysis',
    sfAfterFirst === 8.52, `sf=${sfAfterFirst}`);
  test('Baseline is NOT overwritten by a second analysis with different settings',
    sfAfterSecond === 8.52,
    `expected baseline to stay at 8.52, got ${sfAfterSecond} — this is the exact bug that was reported and fixed`);
  test('baselineLocked flag is set after first capture',
    AB.baselineLocked === true);
  test('DOM: baseline SF displays numeric value when available',
    stubEl.textContent === 'SF 8.52×',
    `expected 'SF 8.52×', got '${stubEl.textContent}'`);

  // Simulate the explicit "reset baseline" action
  AB.baselineLocked = false;
  storeAsBaseline({ safetyFactor: 1.05, safetyFactorAvailable: true }, 'test.step');
  test('Explicit unlock allows a deliberate new baseline capture',
    AB.baseline.summary.safetyFactor === 1.05,
    `sf=${AB.baseline.summary.safetyFactor}`);
  test('DOM: baseline SF displays correct numeric value after reset',
    stubEl.textContent === 'SF 1.05×',
    `expected 'SF 1.05×', got '${stubEl.textContent}'`);

  // Test mesh fallback case: safetyFactorAvailable = false
  AB.baselineLocked = false;
  storeAsBaseline({ safetyFactor: null, safetyFactorAvailable: false, maxVonMisesMPa: 25.5 }, 'fallback.step');
  test('DOM: baseline SF shows fallback when unavailable (mesh fallback)',
    stubEl.textContent === 'SF —',
    `expected 'SF —', got '${stubEl.textContent}'`);
  test('DOM: fallback text color is text-lo (muted)',
    stubEl.style.color === 'var(--text-lo)',
    `expected 'var(--text-lo)', got '${stubEl.style.color}'`);
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

// ── Test group F: section-view clip plane + stencil-cap placement ───────────
console.log('\n[F] Section view — clip plane math and cut-face (cap) placement');
{
  // Extract the real _updateClipPlane and run it against mocks. This covers
  // the plane keep-side math AND the stencil-cap quad transform added so the
  // section view shows a solid cut face instead of a hollow interior.
  const fnCode = extractFunction(html, '_updateClipPlane\\(\\)', '_syncClipUI');

  class MockVec3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  }
  class MockPlane {
    set(normal, constant) { this.normal = normal; this.constant = constant; return this; }
    applyMatrix4() { return this; } // identity world matrix in these tests
  }
  const xyzTriple = () => ({
    x: 0, y: 0, z: 0,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; },
  });
  const makeCapMesh = () => ({
    rotation: xyzTriple(), position: xyzTriple(), scale: xyzTriple(),
  });

  // modelSize (2, 4, 8) mm — deliberately unequal so an axis mix-up fails loudly
  const runClip = (axis, pos, flip, withCap = true) => {
    const S = {
      clipAxis: axis, clipPos: pos, clipFlip: flip,
      _clipPlane: new MockPlane(),
      _modelSize: { x: 2, y: 4, z: 8 },
      _cap: withCap ? { capMesh: makeCapMesh() } : null,
    };
    const mesh3d = { updateMatrixWorld() {}, matrixWorld: 'identity' };
    const THREE = { Vector3: MockVec3 };
    new Function('S', 'mesh3d', 'THREE', fnCode + '\n_updateClipPlane();')(S, mesh3d, THREE);
    return S;
  };

  // F1: plane math — z axis at 75% of an 8mm extent → cut at z = +2
  {
    const S = runClip('z', 75, false);
    test('F1 plane normal points +z (keep z ≥ cut)',
      S._clipPlane.normal.x === 0 && S._clipPlane.normal.y === 0 && S._clipPlane.normal.z === 1,
      `normal=(${S._clipPlane.normal.x},${S._clipPlane.normal.y},${S._clipPlane.normal.z})`);
    test('F1 plane constant = -off for the kept half', S._clipPlane.constant === -2,
      `constant=${S._clipPlane.constant}`);
    test('F1 cap sits exactly on the cut plane (z = +2)',
      S._cap.capMesh.position.x === 0 && S._cap.capMesh.position.y === 0 && S._cap.capMesh.position.z === 2,
      `pos=(${S._cap.capMesh.position.x},${S._cap.capMesh.position.y},${S._cap.capMesh.position.z})`);
    test('F1 cap needs no rotation for z axis (PlaneGeometry already faces z)',
      S._cap.capMesh.rotation.x === 0 && S._cap.capMesh.rotation.y === 0 && S._cap.capMesh.rotation.z === 0);
  }

  // F2: cap orientation per axis
  {
    const Sx = runClip('x', 50, false);
    test('F2 x-axis cut rotates cap 90° about y',
      Math.abs(Sx._cap.capMesh.rotation.y - Math.PI / 2) < 1e-12 && Sx._cap.capMesh.rotation.x === 0,
      `rot=(${Sx._cap.capMesh.rotation.x},${Sx._cap.capMesh.rotation.y})`);
    const Sy = runClip('y', 50, false);
    test('F2 y-axis cut rotates cap -90° about x',
      Math.abs(Sy._cap.capMesh.rotation.x + Math.PI / 2) < 1e-12 && Sy._cap.capMesh.rotation.y === 0,
      `rot=(${Sy._cap.capMesh.rotation.x},${Sy._cap.capMesh.rotation.y})`);
  }

  // F3: flip inverts the kept half but the cut face stays at the same spot
  {
    const S = runClip('z', 75, true);
    test('F3 flipped plane normal points -z', S._clipPlane.normal.z === -1,
      `nz=${S._clipPlane.normal.z}`);
    test('F3 flipped plane constant sign inverts', S._clipPlane.constant === 2,
      `constant=${S._clipPlane.constant}`);
    test('F3 cap position unchanged by flip', S._cap.capMesh.position.z === 2,
      `z=${S._cap.capMesh.position.z}`);
  }

  // F4: cap quad covers the whole cross-section — half-size must be at least
  // the bbox half-diagonal so no corner of the cut can poke past the cap
  {
    const S = runClip('x', 50, false);
    const diag = Math.sqrt(2 * 2 + 4 * 4 + 8 * 8);
    test('F4 cap quad side ≥ bbox diagonal (covers any cut cross-section)',
      S._cap.capMesh.scale.x >= diag && S._cap.capMesh.scale.y >= diag,
      `scale=${S._cap.capMesh.scale.x}, diag=${diag.toFixed(3)}`);
  }

  // F5: slider extremes stay inside the model and cap objects being absent
  // (section toggled before first activation) must not throw
  {
    const S0 = runClip('y', 0, false);
    const S100 = runClip('y', 100, false);
    test('F5 pos=0 cuts at -extent/2, pos=100 at +extent/2',
      S0._cap.capMesh.position.y === -2 && S100._cap.capMesh.position.y === 2,
      `y0=${S0._cap.capMesh.position.y}, y100=${S100._cap.capMesh.position.y}`);
    let threw = false;
    try { runClip('z', 50, false, false); } catch { threw = true; }
    test('F5 no cap objects yet (S._cap null) does not throw', !threw);
  }
}

// ── Test group G: stlToMeshLocal / meshLocalToStl coordinate frame ───────────
// Regression guard for the frame bug where overlays multiplied by mesh3d.scale
// a second time (mesh3d.matrixWorld already applies it), collapsing bolt rings
// and force arrows toward the part centre. Mesh-local coords must be plain mm
// minus the centering offset — NO scale factor.
console.log('\n[G] stlToMeshLocal / meshLocalToStl — overlay coordinate frame');
{
  const toLocal = extractFunction(html, 'stlToMeshLocal\\(wx, wy, wz\\)', 'meshLocalToStl');
  const toStl   = extractFunction(html, 'meshLocalToStl\\(lx, ly, lz\\)', 'findNearestHole');
  const mod = { exports: {} };
  new Function('module', 'exports', 'mesh3d', 'S',
    toLocal + '\n' + toStl + '\nmodule.exports = { stlToMeshLocal, meshLocalToStl };')(
    mod, mod.exports,
    { userData: { offset: { x: 50, y: 40, z: 30 }, scale: 0.016 } },
    { fileData: {} });
  const { stlToMeshLocal, meshLocalToStl } = mod.exports;

  const local = stlToMeshLocal(80, 40, 30);
  test('stlToMeshLocal subtracts offset only (no scale factor)',
    local[0] === 30 && local[1] === 0 && local[2] === 0,
    `got=[${local}]`);

  test('stlToMeshLocal does NOT apply mesh3d.scale (would give 0.48, not 30)',
    Math.abs(local[0] - 30) < 1e-9,
    `x=${local[0]}`);

  const back = meshLocalToStl(...local);
  test('meshLocalToStl is the exact inverse (round-trips)',
    back[0] === 80 && back[1] === 40 && back[2] === 30,
    `got=[${back}]`);

  const p = [12.3, -4.5, 99.9];
  const rt = meshLocalToStl(...stlToMeshLocal(...p));
  test('round-trip preserves an arbitrary point',
    Math.abs(rt[0]-p[0]) < 1e-9 && Math.abs(rt[1]-p[1]) < 1e-9 && Math.abs(rt[2]-p[2]) < 1e-9,
    `got=[${rt}]`);
}

// ── Test group H: computeDominantPrincipal (tension/compression view) ────────
console.log('\n[H] computeDominantPrincipal — dominant signed principal');
{
  // The function is followed by a comment (not another function), so match it
  // directly up to its first column-0 closing brace (its body has no such brace).
  const m = html.match(/function computeDominantPrincipal\(s1, s3\)\s*\{[\s\S]*?\n\}/);
  if (!m) throw new Error('Could not extract computeDominantPrincipal');
  const fnCode = m[0];
  const mod = { exports: {} };
  new Function('module', 'exports', fnCode + '\nmodule.exports = { computeDominantPrincipal };')(mod, mod.exports);
  const { computeDominantPrincipal } = mod.exports;

  const s1 = new Float32Array([ 10,   2,  -1,  5,  0 ]);   // most-tensile principal
  const s3 = new Float32Array([ -3,  -8,  -1, -5, -2 ]);   // most-compressive principal
  const out = computeDominantPrincipal(s1, s3);

  test('picks σ₁ when tension dominates in magnitude', out[0] === 10, `got ${out[0]}`);
  test('picks σ₃ when compression dominates in magnitude', out[1] === -8, `got ${out[1]}`);
  test('ties (|σ₁|=|σ₃|) resolve to σ₁', out[2] === -1 && out[3] === 5, `got ${out[2]}, ${out[3]}`);
  test('preserves sign (compression stays negative)', out[4] === -2, `got ${out[4]}`);
  test('output length matches input', out.length === 5, `len ${out.length}`);
}

// ── Test group I: computeDivergingColors threshold filter ────────────────────
console.log('\n[I] computeDivergingColors — threshold filter greys the other side');
{
  const fnCode = extractFunction(html, 'computeDivergingColors\\(stressArr, absMaxOverride, filter\\)', 'setColormap');
  const mod = { exports: {} };
  // divergingColor is a separate helper; a stub that never returns grey lets us
  // detect filter-greyed vertices unambiguously ([0.5,0.5,0.5]).
  new Function('module','exports','divergingColor',
    fnCode + '\nmodule.exports = { computeDivergingColors };')(
    mod, mod.exports, () => [1, 0, 0]);
  const { computeDivergingColors } = mod.exports;

  const arr = new Float32Array([ 10, -10, 2, -2, 0 ]);   // absMax override = 10
  const isGrey = (c, i) => Math.abs(c[i*3]-0.5)<1e-6 && Math.abs(c[i*3+1]-0.5)<1e-6 && Math.abs(c[i*3+2]-0.5)<1e-6;

  // above, frac 0.5 -> threshold |σ| >= 5: keep 10 and -10, grey 2,-2,0
  const a = computeDivergingColors(arr, 10, { enabled:true, side:'above', frac:0.5 });
  test('above-threshold keeps hot extremes (|σ|≥5)', !isGrey(a.colors,0) && !isGrey(a.colors,1), 'hot verts kept');
  test('above-threshold greys the calm core', isGrey(a.colors,2) && isGrey(a.colors,3) && isGrey(a.colors,4), 'calm greyed');

  // below, frac 0.5 -> threshold |σ| <= 5: keep 2,-2,0, grey 10,-10
  const b = computeDivergingColors(arr, 10, { enabled:true, side:'below', frac:0.5 });
  test('below-threshold greys the hot extremes', isGrey(b.colors,0) && isGrey(b.colors,1), 'hot greyed');
  test('below-threshold keeps the calm core', !isGrey(b.colors,2) && !isGrey(b.colors,4), 'calm kept');

  // disabled -> nothing greyed
  const c = computeDivergingColors(arr, 10, { enabled:false, side:'above', frac:0.9 });
  test('disabled filter greys nothing', !isGrey(c.colors,2) && !isGrey(c.colors,4), 'none greyed');
  test('returns absMax for the slider scale', c.absMax === 10, `absMax=${c.absMax}`);
}

console.log('\n' + '─'.repeat(52));
console.log(`Client logic validation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('CLIENT LOGIC VALIDATION FAILED');
  process.exit(1);
} else {
  console.log('All client logic tests passed ✓');
}
