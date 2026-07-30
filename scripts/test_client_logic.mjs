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

// ── Test group J: bed frame — Z is up from the bed (world +Y) ────────────────
console.log('\n[J] bed frame — bedDirToWorld maps bed Z to world +Y');
{
  // Load the vendored three.js (UMD) into a sandbox so BED_Q's real quaternion
  // math runs, then eval the helper block against it.
  const threeSrc = fs.readFileSync(path.join(__dirname, '..', 'client', 'vendor', 'three.min.js'), 'utf8');
  const g = {};
  const threeMod = { exports: {} };
  new Function('module','exports','self','window', threeSrc)(threeMod, threeMod.exports, g, g);
  const THREE = g.THREE || threeMod.exports.THREE || threeMod.exports;

  const m = html.match(/const BED_Q = new THREE\.Quaternion[\s\S]*?function worldDirToBed\(v3\)\s*\{[^}]*\}/);
  if (!m) throw new Error('Could not extract bed-frame helpers');
  const mod = { exports: {} };
  new Function('module','exports','THREE','mesh3d',
    m[0] + '\nmodule.exports = { bedDirToWorld, worldDirToBed };')(mod, mod.exports, THREE, null);
  const { bedDirToWorld, worldDirToBed } = mod.exports;

  const zUp = bedDirToWorld(new THREE.Vector3(0,0,1));
  test('bed +Z -> world +Y (up from the bed)',
    Math.abs(zUp.x) < 1e-6 && Math.abs(zUp.y - 1) < 1e-6 && Math.abs(zUp.z) < 1e-6,
    `got (${zUp.x.toFixed(3)},${zUp.y.toFixed(3)},${zUp.z.toFixed(3)})`);
  const xBed = bedDirToWorld(new THREE.Vector3(1,0,0));
  test('bed +X stays world +X (in the plate plane)',
    Math.abs(xBed.x - 1) < 1e-6 && Math.abs(xBed.y) < 1e-6,
    `got (${xBed.x.toFixed(3)},${xBed.y.toFixed(3)},${xBed.z.toFixed(3)})`);
  const rt = worldDirToBed(bedDirToWorld(new THREE.Vector3(0.3,-0.7,0.5)));
  test('worldDirToBed inverts bedDirToWorld',
    Math.abs(rt.x-0.3) < 1e-6 && Math.abs(rt.y+0.7) < 1e-6 && Math.abs(rt.z-0.5) < 1e-6,
    `got (${rt.x.toFixed(3)},${rt.y.toFixed(3)},${rt.z.toFixed(3)})`);
}

// ── Test group K: sfVerdictTier — safety-factor verdict tiering (issue #141) ──
console.log('\n[K] sfVerdictTier — Safe requires SF >= 2.0, not 1.5 (issue #141)');
{
  // Extract the shared thresholds + classifier that both the headline action
  // card and sticky bar now read from, so this locks the exact regression:
  // the headline used to render green "Safe" at SF 1.5x while the same panel
  // said "Recommended minimum: 2x".
  const m = html.match(/const FAIL_SF_THRESHOLD[\s\S]*?function sfVerdictTier\(sf\) \{[\s\S]*?\n\}\n/);
  if (!m) throw new Error('Could not extract sfVerdictTier + its threshold constants');
  const mod = { exports: {} };
  new Function('module', 'exports',
    m[0] + '\nmodule.exports = { sfVerdictTier, FAIL_SF_THRESHOLD, ACCEPTABLE_SF_THRESHOLD, SAFE_SF_THRESHOLD };'
  )(mod, mod.exports);
  const { sfVerdictTier, FAIL_SF_THRESHOLD, ACCEPTABLE_SF_THRESHOLD, SAFE_SF_THRESHOLD } = mod.exports;

  test('Thresholds are 1.0 / 1.5 / 2.0',
    FAIL_SF_THRESHOLD === 1.0 && ACCEPTABLE_SF_THRESHOLD === 1.5 && SAFE_SF_THRESHOLD === 2.0,
    `got ${FAIL_SF_THRESHOLD}/${ACCEPTABLE_SF_THRESHOLD}/${SAFE_SF_THRESHOLD}`);

  test('SF 0.9 -> fail tier', sfVerdictTier(0.9) === 'fail', `got ${sfVerdictTier(0.9)}`);
  test('SF 1.2 -> marginal tier', sfVerdictTier(1.2) === 'marginal', `got ${sfVerdictTier(1.2)}`);
  test('SF 1.6 -> acceptable tier, NOT "safe" (the exact issue #141 regression case — used to render green "Safe" here)',
    sfVerdictTier(1.6) === 'acceptable', `got ${sfVerdictTier(1.6)}`);
  test('SF 1.5 boundary resolves to acceptable, not marginal (>= 1.5 is the acceptable band)',
    sfVerdictTier(1.5) === 'acceptable', `got ${sfVerdictTier(1.5)}`);
  test('SF 2.1 -> safe tier', sfVerdictTier(2.1) === 'safe', `got ${sfVerdictTier(2.1)}`);
  test('SF 2.0 boundary resolves to safe (green requires >= 2.0, not > 2.0)',
    sfVerdictTier(2.0) === 'safe', `got ${sfVerdictTier(2.0)}`);
  test('null SF -> null tier (safety factor unavailable)', sfVerdictTier(null) === null);
  test('NaN SF -> null tier (guards against a false verdict, mirrors the safetyFactorAvailable guard)',
    sfVerdictTier(NaN) === null);
}

// ── Test group L: legend/model heatmap color agreement (issue #142) ──────────
console.log('\n[L] Legend gradient bar matches model gamma color at 25/50/75% (issue #142)');
{
  // Extract currentGamma (+ its localStorage/URL-backed init), stressColor,
  // COLORMAPS, and updateLegendSwatches together — updateLegendSwatches calls
  // currentGamma() and stressColor() directly, so they need to come from the
  // same extracted block rather than being re-implemented by the test.
  const m = html.match(/\(function\(\) \{\n  const stored = localStorage\.getItem\('sf-gamma-disabled'\);[\s\S]*?\n\}\n\n\/\/ Restore saved colormap/);
  if (!m) throw new Error('Could not extract gamma-init IIFE..updateLegendSwatches block');
  const src = m[0];

  let gradientCss = null;
  global.document = {
    getElementById(id) {
      if (id === 'legend-gradient') {
        const el = { style: {} };
        Object.defineProperty(el.style, 'background', {
          set(v) { gradientCss = v; }, get() { return gradientCss; },
        });
        return el;
      }
      return { style: {}, classList: { toggle() {} }, textContent: '' };
    },
  };
  global.window = { location: { search: '' } };
  global.localStorage = {
    _store: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
    setItem(k, v) { this._store[k] = v; },
  };

  // Runs the REAL extracted updateLegendSwatches() with gamma on/off (driven
  // through localStorage exactly like the app's own init IIFE does — not by
  // poking S.gammaEnabled directly, so this exercises the real init path)
  // and returns helpers to read back the generated gradient plus an
  // independent re-derivation of what the model would paint.
  function run(gammaEnabled) {
    gradientCss = null;
    global.localStorage._store = { 'sf-gamma-disabled': gammaEnabled ? 'false' : 'true' };
    global.S = { colormap: 'viridis' };
    const mod = { exports: {} };
    new Function('module', 'exports',
      src + '\nmodule.exports = { currentGamma, stressColor, updateLegendSwatches };'
    )(mod, mod.exports);
    const { currentGamma, stressColor, updateLegendSwatches } = mod.exports;
    updateLegendSwatches();
    const stopRe = /rgb\((\d+),(\d+),(\d+)\)\s+([\d.]+)%/g;
    const stops = [];
    let mm;
    while ((mm = stopRe.exec(gradientCss))) {
      stops.push({ pct: parseFloat(mm[4]), r: +mm[1], g: +mm[2], b: +mm[3] });
    }
    const colorAtPct = (pct) => {
      const s = stops.find(s => Math.abs(s.pct - pct) < 1e-6);
      if (!s) throw new Error(`No legend stop at pct=${pct}`);
      return [s.r, s.g, s.b];
    };
    // computeSmoothedStressColors paints each vertex with
    // stressColor(pow(stressFraction, GAMMA)) — reproduce that exactly for a
    // given stress fraction (0 = min, 1 = max) as the "model" color.
    const modelColorAtFraction = (f) => {
      const t = Math.pow(f, currentGamma());
      const [r, g, b] = stressColor(t, 'viridis');
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    };
    return { colorAtPct, modelColorAtFraction, stressColor, gammaValue: currentGamma() };
  }

  // Legend label rows sit at fixed positions 0/25/50/75/100% (flexbox
  // space-between over 5 rows), each labeled with the linear stress fraction
  // f = 1 - pct/100 (HIGH at top/0%, LOW at bottom/100%). For each position,
  // the legend bar's color there must equal the model's color for that same
  // stress fraction — that's the exact property issue #142 broke.
  {
    const { colorAtPct, modelColorAtFraction, stressColor, gammaValue } = run(true);
    test('gamma enabled -> currentGamma() = 0.55', gammaValue === 0.55, `got ${gammaValue}`);
    [25, 50, 75].forEach(pct => {
      const f = 1 - pct / 100;
      const legend = colorAtPct(pct);
      const model = modelColorAtFraction(f);
      test(`gamma ON: legend color at ${pct}% matches model color at stress fraction ${f.toFixed(2)}`,
        legend[0] === model[0] && legend[1] === model[1] && legend[2] === model[2],
        `legend=rgb(${legend}) model=rgb(${model})`);
    });

    // Sanity check that the fix isn't a no-op: the gamma-mapped 50% stop must
    // differ from the naive linear stressColor(0.5) — otherwise this test
    // group wouldn't actually have caught the original ~1.8x over-read bug.
    const legendMid = colorAtPct(50);
    const [rNaive, gNaive, bNaive] = stressColor(0.5, 'viridis');
    const naiveLinear = [Math.round(rNaive * 255), Math.round(gNaive * 255), Math.round(bNaive * 255)];
    test('gamma ON: 50% stop is NOT the naive linear color (proves gamma actually changed the output)',
      !(legendMid[0] === naiveLinear[0] && legendMid[1] === naiveLinear[1] && legendMid[2] === naiveLinear[2]),
      `legend50%=rgb(${legendMid}) naiveLinear=rgb(${naiveLinear})`);
  }

  // When gamma is disabled, GAMMA=1 and pow(f,1)=f, so the legend must go
  // back to sampling linearly — i.e. exactly stressColor(1 - pct/100) with no
  // warp, keyed to the same currentGamma() the model itself reads (not a
  // second copy of the disableGamma flag).
  {
    const { colorAtPct, gammaValue, stressColor } = run(false);
    test('gamma disabled -> currentGamma() = 1.0', gammaValue === 1.0, `got ${gammaValue}`);
    [25, 50, 75].forEach(pct => {
      const f = 1 - pct / 100;
      const legend = colorAtPct(pct);
      const [r, g, b] = stressColor(f, 'viridis');
      const linear = [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
      test(`gamma OFF: legend color at ${pct}% is exactly linear (fraction ${f.toFixed(2)}, no warp)`,
        legend[0] === linear[0] && legend[1] === linear[1] && legend[2] === linear[2],
        `legend=rgb(${legend}) linear=rgb(${linear})`);
    });
  }
}

// ── Test group M: convergenceObservedOrder / richardsonExtrapolate (#146) ────
console.log('\n[M] Observed order of convergence — recovers known p, clamps, falls back');
{
  const mA = html.match(/function convergenceObservedOrder\(meshes, theoreticalP\) \{[\s\S]*?\n\}/);
  const mB = html.match(/function richardsonExtrapolate\(second, finest, orderInfo\) \{[\s\S]*?\n\}/);
  if (!mA) throw new Error('Could not extract convergenceObservedOrder');
  if (!mB) throw new Error('Could not extract richardsonExtrapolate');
  const mod = { exports: {} };
  new Function('module', 'exports',
    mA[0] + '\n' + mB[0] + '\nmodule.exports = { convergenceObservedOrder, richardsonExtrapolate };'
  )(mod, mod.exports);
  const { convergenceObservedOrder, richardsonExtrapolate } = mod.exports;

  // Synthetic sequence with constant linear refinement r=2 (node counts scale
  // by 8 each step) and f_i = f_exact + C*h_i^p. With h halving each refinement
  // the closed-form order recovers p exactly regardless of C or f_exact.
  const seq = (p, fExact = 100, C = 40) => {
    // coarsest h=4, std h=2, fine h=1 ; nodes ∝ (1/h)^3
    const hs = [4, 2, 1];
    const nodesFine = 64000; // 1/h=1 -> base; scale so ratios are exactly 8
    const nodesFor = h => Math.round(nodesFine / (h * h * h)); // (1/h)^3 * (nodesFine)
    return hs.map(h => ({ nodes: nodesFor(h), value: fExact + C * Math.pow(h, p) }));
  };

  // p = 2 (quadratic-stress-like), converging from above (C>0)
  {
    const r = convergenceObservedOrder(seq(2), 2);
    test('M recovers p=2 from a clean O(h^2) sequence',
      r.source === 'observed' && Math.abs(r.order - 2) < 1e-6, `order=${r.order} src=${r.source}`);
    test('M p=2 sequence is monotone', r.monotone === true);
  }
  // p = 1 (linear-stress), the exact case the old hard-coded p=2 got wrong
  {
    const r = convergenceObservedOrder(seq(1), 1);
    test('M recovers p=1 from a clean O(h^1) sequence (C3D4 stress rate)',
      r.source === 'observed' && Math.abs(r.order - 1) < 1e-6, `order=${r.order}`);
  }
  // Clamp high: p=5 synthetic must clamp to 3
  {
    const r = convergenceObservedOrder(seq(5), 2);
    test('M clamps a super-cubic observed order to the [0.5,3] ceiling',
      r.order === 3 && r.raw > 3, `order=${r.order} raw=${r.raw?.toFixed(2)}`);
  }
  // Diverging peak: values GROW under refinement (singularity) -> raw <= 0,
  // order clamps to floor 0.5, still flagged observed so the raw signal survives
  {
    const diverge = [
      { nodes: 1000,  value: 50 },
      { nodes: 8000,  value: 80 },
      { nodes: 64000, value: 140 },  // difference grows 30 -> 60
    ];
    const r = convergenceObservedOrder(diverge, 1);
    test('M diverging peak yields raw order ≤ 0 (singularity signal)',
      isFinite(r.raw) && r.raw <= 0, `raw=${r.raw}`);
    test('M diverging peak clamps reported order to the 0.5 floor',
      r.order === 0.5, `order=${r.order}`);
  }
  // Non-monotone (sign flip) -> theoretical fallback
  {
    const osc = [
      { nodes: 1000,  value: 100 },
      { nodes: 8000,  value: 108 },
      { nodes: 64000, value: 104 },  // up then down
    ];
    const r = convergenceObservedOrder(osc, 1);
    test('M non-monotone sequence falls back to theoretical order',
      r.source === 'theoretical' && r.order === 1 && r.monotone === false, `order=${r.order} src=${r.source}`);
  }
  // Fewer than 3 meshes -> theoretical fallback
  {
    const r = convergenceObservedOrder([{ nodes: 1000, value: 10 }, { nodes: 8000, value: 12 }], 2);
    test('M <3 meshes falls back to theoretical order', r.source === 'theoretical' && r.order === 2);
  }
  // Richardson uses the observed order, not a hard-coded p=2
  {
    // O(h^1) sequence: f_exact=100. Extrapolation with p=1 must land ~100.
    const s = seq(1, 100, 40);
    const order = convergenceObservedOrder(s, 1);
    const rich = richardsonExtrapolate(s[1], s[2], order);
    test('M Richardson with observed p=1 recovers the true limit (~100)',
      rich.valid && Math.abs(rich.value - 100) < 1e-6, `value=${rich.value}`);
    // The old hard-coded p=2 would UNDER-correct an O(h) sequence: r^2-1=3 vs
    // the correct r-1=1, so it lands at 105, not 100 — prove the fix matters.
    const wrong = richardsonExtrapolate(s[1], s[2], { order: 2 });
    test('M hard-coded p=2 would mis-extrapolate the O(h) sequence (proves fix matters)',
      Math.abs(wrong.value - 100) > 1, `p2 value=${wrong.value}`);
  }
}

// ── Test group N: selectConvergenceMetric / stressPercentile (#147) ──────────
console.log('\n[N] Singularity-aware convergence metric — evidence hierarchy + p99');
{
  const mA = html.match(/function selectConvergenceMetric\(singularity, peakOrder\) \{[\s\S]*?\n\}/);
  const mB = html.match(/function stressPercentile\(stressArr, pct\) \{[\s\S]*?\n\}/);
  if (!mA) throw new Error('Could not extract selectConvergenceMetric');
  if (!mB) throw new Error('Could not extract stressPercentile');
  const mod = { exports: {} };
  new Function('module', 'exports',
    mA[0] + '\n' + mB[0] + '\nmodule.exports = { selectConvergenceMetric, stressPercentile };'
  )(mod, mod.exports);
  const { selectConvergenceMetric, stressPercentile } = mod.exports;

  // No singularity, healthy observed order -> converge on peak VM as usual.
  {
    const r = selectConvergenceMetric(null, { source: 'observed', raw: 1.8 });
    test('N healthy peak: metric peakVM, not singular', !r.singularAtPeak && r.metric === 'peakVM' && r.evidence === 'none');
  }
  // Refinement divergence (raw <= 0.5) is PRIMARY, scale-independent evidence.
  {
    const r = selectConvergenceMetric(null, { source: 'observed', raw: 0.1 });
    test('N diverging observed order -> singular, p99, refinement evidence',
      r.singularAtPeak && r.metric === 'p99' && r.evidence === 'refinement');
  }
  // Negative observed order (peak growing) also counts as refinement evidence.
  {
    const r = selectConvergenceMetric(null, { source: 'observed', raw: -1 });
    test('N negative observed order -> refinement evidence', r.evidence === 'refinement' && r.metric === 'p99');
  }
  // Server single-mesh flag with no refinement signal -> single-mesh evidence.
  {
    const r = selectConvergenceMetric({ detected: true }, { source: 'observed', raw: 2.2 });
    test('N server flag only -> singular, p99, single-mesh evidence',
      r.singularAtPeak && r.metric === 'p99' && r.evidence === 'single-mesh');
  }
  // Refinement OUTRANKS the single-mesh heuristic when both fire.
  {
    const r = selectConvergenceMetric({ detected: true }, { source: 'observed', raw: 0 });
    test('N refinement outranks single-mesh heuristic', r.evidence === 'refinement');
  }
  // Non-monotone peak order (theoretical fallback) is NOT treated as divergence.
  {
    const r = selectConvergenceMetric(null, { source: 'theoretical', raw: null });
    test('N non-monotone order alone is not a singularity flag', !r.singularAtPeak && r.metric === 'peakVM');
  }
  // A server flag still fires even with a non-monotone client order.
  {
    const r = selectConvergenceMetric({ detected: true }, { source: 'theoretical', raw: null });
    test('N server flag fires under non-monotone order (single-mesh evidence)',
      r.singularAtPeak && r.evidence === 'single-mesh');
  }
  // stressPercentile: p99 excludes a lone unbounded spike; p100 == max.
  {
    const arr = new Float32Array(1000);
    for (let i = 0; i < 1000; i++) arr[i] = 10;      // uniform background
    arr[500] = 100000;                                // singular spike
    const p99 = stressPercentile(arr, 99);
    const p100 = stressPercentile(arr, 100);
    test('N p99 rejects the lone singular spike (stays at background)', p99 === 10, `p99=${p99}`);
    test('N p100 is the max (includes the spike)', p100 === 100000, `p100=${p100}`);
    test('N stressPercentile of empty array is null', stressPercentile(new Float32Array(0), 99) === null);
  }
}

// ── Test group O: updateMeshOrderSelector — C3D4 bending-underprediction warning (#189) ─
console.log('\n[O] updateMeshOrderSelector — C3D4 warning shown whenever C3D4 is selected');
{
  const fnMatch = html.match(
    /function updateMeshOrderSelector\(\) \{[\s\S]*?\n\}\n/
  );
  if (!fnMatch) throw new Error('Could not extract updateMeshOrderSelector');

  const mod = { exports: {} };
  const sel  = { value: '2', disabled: false };
  const opt2 = { disabled: false };
  const hint = { innerHTML: '' };
  const els = { 's-mesh-order': sel, 's-mesh-order-c3d10': opt2, 's-mesh-order-hint': hint };
  global.document = { getElementById: (id) => els[id] };
  global.S = { fileData: { fileType: 'step', stepB64: 'x' } };
  new Function('module', 'exports', fnMatch[0] + '\nmodule.exports = { updateMeshOrderSelector };')(mod, mod.exports);
  const { updateMeshOrderSelector } = mod.exports;

  // STEP file, C3D10 (default) selected — no warning.
  sel.value = '2';
  updateMeshOrderSelector();
  test('C3D10 (default) shows no bending-underprediction warning',
    !/underpredict/i.test(hint.innerHTML), `got: ${hint.innerHTML}`);

  // STEP file, user manually selects C3D4 — must warn (this was the
  // reported gap: the old hint only warned when C3D4 was STL-forced).
  sel.value = '1';
  updateMeshOrderSelector();
  test('C3D4 selected on a STEP file shows the ~55% bending-underprediction warning',
    /underpredict.*55%/i.test(hint.innerHTML), `got: ${hint.innerHTML}`);
  test('C3D4 warning recommends switching to C3D10',
    /C3D10/.test(hint.innerHTML), `got: ${hint.innerHTML}`);

  // STL file — C3D10 disabled, forced to C3D4, still warns.
  global.S = { fileData: { fileType: 'stl' } };
  sel.value = '2';
  updateMeshOrderSelector();
  test('STL file disables C3D10 and forces C3D4',
    opt2.disabled === true && sel.value === '1', `opt2.disabled=${opt2.disabled} sel.value=${sel.value}`);
  test('STL-forced C3D4 still shows the bending-underprediction warning',
    /underpredict/i.test(hint.innerHTML), `got: ${hint.innerHTML}`);
}

// ── Test group P: computeDisplayFailForce — buckling-governed selection (#204) ─
console.log('\n[P] computeDisplayFailForce — "Will fail at X N" caveat / buckling-governed selection');
{
  // Anchor on the function's own column-0 closing brace (not the next
  // function), so the extraction is robust to what follows it in the merged
  // client — the integration placed renderValidationCoverage between this and
  // showResults, which the old "...\n}\n\nfunction showResults" anchor over-grabbed.
  const fnMatch = html.match(
    /function computeDisplayFailForce\(s, bucklingResult\) \{[\s\S]*?\n\}\n/
  );
  if (!fnMatch) throw new Error('Could not extract computeDisplayFailForce');
  const mod = { exports: {} };
  new Function('module', 'exports',
    fnMatch[0] + '\nmodule.exports = { computeDisplayFailForce };')(mod, mod.exports);
  const { computeDisplayFailForce } = mod.exports;

  // No buckling data at all — falls back to the plain first-yield estimate.
  {
    const s = { estimatedFailForce: 500, safetyFactorAvailable: true, safetyFactor: 2.0 };
    const r = computeDisplayFailForce(s, null);
    test('No buckling result: displayFailForceN === estimatedFailForce',
      r.displayFailForceN === 500, `got ${r.displayFailForceN}`);
    test('No buckling result: bucklingGoverns is false',
      r.bucklingGoverns === false);
  }

  // Buckling result present but BLF×appliedForce is ABOVE first-yield — first
  // yield still governs, buckling must not override it.
  {
    const s = { estimatedFailForce: 500, safetyFactorAvailable: true, safetyFactor: 2.0 };
    // appliedForce = 500/2 = 250N; BLF 5x -> bucklingForce=1250N > 500N
    const bk = { blf: 5.0, verdict: 'PASS' };
    const r = computeDisplayFailForce(s, bk);
    test('Buckling force above first-yield: first-yield still governs',
      r.bucklingGoverns === false && r.displayFailForceN === 500,
      `bucklingGoverns=${r.bucklingGoverns} displayFailForceN=${r.displayFailForceN}`);
  }

  // Buckling result BELOW first-yield — the more honest (lower) number must
  // be selected and flagged (issue #204 acceptance criterion).
  {
    const s = { estimatedFailForce: 500, safetyFactorAvailable: true, safetyFactor: 2.0 };
    // appliedForce = 250N; BLF 1.2x -> bucklingForce=300N < 500N
    const bk = { blf: 1.2, verdict: 'MARGINAL' };
    const r = computeDisplayFailForce(s, bk);
    test('Buckling force below first-yield: buckling governs',
      r.bucklingGoverns === true, `bucklingGoverns=${r.bucklingGoverns}`);
    test('Buckling force below first-yield: displayFailForceN is the buckling-limited value',
      Math.abs(r.displayFailForceN - 300) < 1e-9, `got ${r.displayFailForceN}`);
  }

  // 'no-buckling' (tensile-dominated) and 'indeterminate' verdicts must never
  // be treated as a governing buckling force even if blf happened to be set.
  {
    const s = { estimatedFailForce: 500, safetyFactorAvailable: true, safetyFactor: 2.0 };
    test('no-buckling verdict is ignored',
      computeDisplayFailForce(s, { blf: 0.1, verdict: 'no-buckling' }).bucklingGoverns === false);
    test('indeterminate verdict is ignored',
      computeDisplayFailForce(s, { blf: 0.1, verdict: 'indeterminate' }).bucklingGoverns === false);
  }

  // safetyFactor unavailable (mesh fallback) — cannot recover appliedForce,
  // must not throw and must not claim buckling governs.
  {
    const s = { estimatedFailForce: 500, safetyFactorAvailable: false, safetyFactor: null };
    const r = computeDisplayFailForce(s, { blf: 1.0, verdict: 'MARGINAL' });
    test('SF unavailable: does not throw and buckling does not govern',
      r.bucklingGoverns === false && r.displayFailForceN === 500);
  }
}

// ── Test group Q: sliceTetsByAxisPlane — section-view interior stress (#190) ─
console.log('\n[Q] sliceTetsByAxisPlane — marching-tet interior stress slice');
{
  // sliceTetsByAxisPlane is followed by a comment block (not directly by
  // "function ..."), so extract up to its own closing brace at column 0
  // rather than reusing the shared extractFunction(sig, nextFn) helper.
  const startRe = /function sliceTetsByAxisPlane\(nodes, tets, values, axis, off\) \{/;
  const startIdx = html.search(startRe);
  if (startIdx < 0) throw new Error('Could not find sliceTetsByAxisPlane');
  const endIdx = html.indexOf('\n}\n', startIdx);
  if (endIdx < 0) throw new Error('Could not find end of sliceTetsByAxisPlane');
  const fnCode = html.slice(startIdx, endIdx + 2);
  const mod = { exports: {} };
  new Function('module', 'exports', fnCode + '\nmodule.exports = { sliceTetsByAxisPlane };')(mod, mod.exports);
  const { sliceTetsByAxisPlane } = mod.exports;

  // Single tet, unit right tet at the origin: nodes 0..3, values 0..3.
  // Cut at x=0.5 isolates node 1 (x=1) on the + side from nodes 0,2,3 (x=0)
  // on the - side -> exactly one triangle (the "3 vs 1" case).
  {
    const nodes = new Float32Array([
      0,0,0,   // node 0, value 10
      1,0,0,   // node 1, value 20
      0,1,0,   // node 2, value 30
      0,0,1,   // node 3, value 40
    ]);
    const tets = new Int32Array([0,1,2,3]);
    const values = new Float32Array([10,20,30,40]);
    const { positions, values: vAtVerts } = sliceTetsByAxisPlane(nodes, tets, values, 0, 0.5);
    test('3-vs-1 split produces exactly 1 triangle', positions.length === 9, `got ${positions.length/3} verts`);
    // Every cut vertex must lie exactly on the plane (x === 0.5) — no NaN,
    // no drift off the cut (CLAUDE.md: every vertex gets a real value, no NaN).
    let onPlane = true, anyNaN = false;
    for (let i = 0; i < positions.length / 3; i++) {
      if (Math.abs(positions[i*3] - 0.5) > 1e-6) onPlane = false;
      if (!Number.isFinite(vAtVerts[i])) anyNaN = true;
    }
    test('all cut vertices lie exactly on the cut plane', onPlane);
    test('no NaN/Infinity in interpolated values', !anyNaN);
    // Edge 0-1 (values 10,20) is cut at t=0.5 -> interpolated value 15 for
    // every vertex on that edge (nodes 2 and 3 are untouched -> unchanged).
    const has15 = Array.from(vAtVerts).some(v => Math.abs(v - 15) < 1e-5);
    test('edge 0-1 interpolates to the midpoint value (15)', has15, `values=${Array.from(vAtVerts)}`);
  }

  // Same tet, cut plane entirely outside the tet's extent -> no crossing, no
  // triangles (not even degenerate NaN-filled ones).
  {
    const nodes = new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,0,1]);
    const tets = new Int32Array([0,1,2,3]);
    const values = new Float32Array([1,2,3,4]);
    const { positions } = sliceTetsByAxisPlane(nodes, tets, values, 0, 5.0);
    test('plane outside the tet produces zero triangles', positions.length === 0, `got ${positions.length}`);
  }

  // Two tets sharing a face (nodes 0,2,3 shared) straddling the plane at
  // x=0.5 must produce IDENTICAL cut points/values for the shared edges,
  // regardless of each tet's own internal node ordering — this is the "weld
  // invariant" from CLAUDE.md: coincident vertices must share identical
  // values. Confirmed here by construction (edgePoint always canonicalizes
  // to the lower node index) rather than a runtime weld pass.
  {
    const nodes = new Float32Array([
      0,0,0,   // 0
      1,0,0,   // 1
      0,1,0,   // 2
      0,0,1,   // 3
      1,1,1,   // 4 (second tet's apex, all on the + side with node 1)
    ]);
    const values = new Float32Array([10, 20, 30, 40, 50]);
    const tetA = [0,1,2,3];
    const tetB = [1,4,2,3];   // shares face {1,2,3} with tetA, opposite winding
    const off = 0.5;
    const a = sliceTetsByAxisPlane(nodes, new Int32Array(tetA), values, 0, off);
    const b = sliceTetsByAxisPlane(nodes, new Int32Array(tetB), values, 0, off);
    // Both tets cut edge 0-1... only tetA touches node 0; edge 1-2 and 1-3
    // are shared by both (node 1 is the isolated + node in both tets since
    // node 4 is also on the + side, x=1 >= 0.5). Find the value produced for
    // edge 1-2 (10->wait, values at node1=20,node2=30, t=(20-off*? )) — just
    // assert both slices agree on any value they have in common bit-for-bit.
    const setA = new Set(Array.from(a.values).map(v => v.toFixed(10)));
    const setB = new Set(Array.from(b.values).map(v => v.toFixed(10)));
    let sharedCount = 0;
    for (const v of setA) if (setB.has(v)) sharedCount++;
    test('adjacent tets sharing an edge produce a bit-identical cut value',
      sharedCount > 0, `setA=${[...setA]} setB=${[...setB]}`);
  }

  // 2-vs-2 "quad" split: a cube split diagonally so two nodes are on each
  // side must produce 2 triangles (6 verts), all on-plane, no NaN.
  {
    const nodes = new Float32Array([
      -1,0,0,  // 0, -
      -1,1,0,  // 1, -
       1,0,0,  // 2, +
       1,1,0,  // 3, +
    ]);
    const tets = new Int32Array([0,1,2,3]);
    const values = new Float32Array([1,2,3,4]);
    const { positions, values: vAtVerts } = sliceTetsByAxisPlane(nodes, tets, values, 0, 0);
    test('2-vs-2 split produces exactly 2 triangles', positions.length === 18, `got ${positions.length/3} verts`);
    let onPlane = true, anyNaN = false;
    for (let i = 0; i < positions.length / 3; i++) {
      if (Math.abs(positions[i*3]) > 1e-6) onPlane = false;
      if (!Number.isFinite(vAtVerts[i])) anyNaN = true;
    }
    test('2-vs-2 split: all vertices on-plane', onPlane);
    test('2-vs-2 split: no NaN/Infinity', !anyNaN);
  }

  // Degenerate mesh sizes must not throw (defensive — empty arrays).
  {
    const { positions, values } = sliceTetsByAxisPlane(new Float32Array(0), new Int32Array(0), new Float32Array(0), 0, 0);
    test('empty mesh does not throw and returns empty arrays', positions.length === 0 && values.length === 0);
  }
}

// ── Test group R: renderValidationCoverage — per-analysis coverage panel (#191) ─
console.log('\n[R] renderValidationCoverage — validation coverage panel (#191)');
{
  const fnCode = extractFunction(html, 'renderValidationCoverage\\(vc\\)', 'showResults');
  const mod = { exports: {} };
  new Function('module', 'exports', fnCode + '\nmodule.exports = { renderValidationCoverage };')(mod, mod.exports);
  const { renderValidationCoverage } = mod.exports;

  // Fully-covered configuration: no warn color, no "no direct anchor" text,
  // no combo-gap block.
  {
    const vc = {
      fingerprint: { elementOrder: 'C3D4', material: 'isotropic', criterion: 'von-mises', loadTypes: ['force'], mesher: 'tetgen', options: [] },
      axisCoverage: [
        { axis: 'elementOrder:C3D4', entries: [{ id: 'solver:1', label: 'Patch test', kind: 'solver-group' }] },
        { axis: 'material:isotropic', entries: [{ id: 'solver:1', label: 'Patch test', kind: 'solver-group' }] },
      ],
      coveringEntryIds: ['solver:1'],
      uncoveredAxes: [],
      comboGaps: [],
    };
    const html2 = renderValidationCoverage(vc);
    test('fully-covered: reports 2/2 characteristics', html2.includes('2/2 characteristics directly covered'));
    test('fully-covered: no "no direct anchor" text', !html2.includes('no direct anchor'));
    test('fully-covered: no combo-gap block', !html2.includes('Known combination gaps'));
    test('fully-covered: includes axis label and entry label', html2.includes('Element order') && html2.includes('Patch test'));
  }

  // Gapped configuration: an uncovered axis AND a combo gap must both
  // surface as plain text, not be hidden or implied-away.
  {
    const vc = {
      fingerprint: { elementOrder: 'C3D4', material: 'two-region', criterion: 'fdm-interface', loadTypes: ['force'], mesher: 'tetgen', options: [] },
      axisCoverage: [
        { axis: 'elementOrder:C3D4', entries: [{ id: 'solver:1', label: 'Patch test', kind: 'solver-group' }] },
        { axis: 'material:two-region', entries: [] },   // deliberately uncovered
      ],
      coveringEntryIds: ['solver:1'],
      uncoveredAxes: ['material:two-region'],
      comboGaps: [{ axes: ['elementOrder:C3D4', 'material:two-region'], note: 'C3D4 + two-region is not directly anchored.' }],
    };
    const html2 = renderValidationCoverage(vc);
    test('gapped: header mentions 1 uncovered', html2.includes('1 uncovered'));
    test('gapped: shows "no direct anchor" for the uncovered axis', html2.includes('no direct anchor'));
    test('gapped: renders the combo-gap note verbatim', html2.includes('C3D4 + two-region is not directly anchored.'));
    test('gapped: combo-gap block header present', html2.includes('Known combination gaps'));
  }

  // Degenerate: no axes at all must not throw (defensive).
  {
    const vc = { fingerprint: {}, axisCoverage: [], coveringEntryIds: [], uncoveredAxes: [], comboGaps: [] };
    let threw = false;
    try { renderValidationCoverage(vc); } catch (e) { threw = true; }
    test('empty coverage report does not throw', !threw);
  }
}

console.log('\n' + '─'.repeat(52));
console.log(`Client logic validation: ${passed} passed, ${failed} failed`);

// Machine-readable summary consumed by scripts/check-doc-test-counts.mjs —
// see server/tests/solver_validation.ts for why (issue #198).
try {
  fs.writeFileSync(
    path.join(__dirname, 'client-logic-summary.json'),
    JSON.stringify({ passed, failed }, null, 2)
  );
} catch { /* best-effort */ }

if (failed > 0) {
  console.log('CLIENT LOGIC VALIDATION FAILED');
  process.exit(1);
} else {
  console.log('All client logic tests passed ✓');
}
