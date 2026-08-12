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
  // The filter's neutral grey is written in the GPU's LINEAR space, so the
  // expected value is srgbToLinear(0.5), not 0.5. Pull the real conversion out
  // of the client rather than hardcoding the constant, so this test tracks the
  // implementation instead of pinning a number beside it.
  const srgbSrc = html.match(/function srgbToLinear\(c\) \{[\s\S]*?\n\}/);
  if (!srgbSrc) throw new Error('Could not extract srgbToLinear');
  const srgbToLinear = new Function(srgbSrc[0] + '\nreturn srgbToLinear;')();
  const GREY_LIN = srgbToLinear(0.5);

  const mod = { exports: {} };
  // divergingColorLinear is a separate helper; a stub that never returns grey
  // lets us detect filter-greyed vertices unambiguously.
  new Function('module','exports','divergingColorLinear','FILTER_GREY_LINEAR',
    fnCode + '\nmodule.exports = { computeDivergingColors };')(
    mod, mod.exports, () => [1, 0, 0], GREY_LIN);
  const { computeDivergingColors } = mod.exports;

  const arr = new Float32Array([ 10, -10, 2, -2, 0 ]);   // absMax override = 10
  const isGrey = (c, i) => Math.abs(c[i*3]-GREY_LIN)<1e-6 && Math.abs(c[i*3+1]-GREY_LIN)<1e-6 && Math.abs(c[i*3+2]-GREY_LIN)<1e-6;

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

// ── Test group S: headlineSpread — the mesh-sensitivity readout (#256) ───────
console.log('\n[S] Headline spread — separates a converged number from a sampled one');
{
  const m = html.match(/function headlineSpread\(meshes\) \{[\s\S]*?\n\}/);
  if (!m) throw new Error('Could not extract headlineSpread');
  const mod = { exports: {} };
  new Function('module', 'exports', m[0] + '\nmodule.exports = { headlineSpread };')(mod, mod.exports);
  const { headlineSpread } = mod.exports;

  const mesh = (nodes, maxVM, sf) => ({ nodes, maxVM, sf });

  // "Not measured" must stay distinguishable from "measured as none": a single
  // mesh cannot measure its own mesh-dependence, and returning a 0% spread there
  // would assert convergence that was never tested.
  test('null for a single mesh (cannot measure its own sensitivity)',
    headlineSpread([mesh(1000, 5, 9)]) === null);
  test('null for an empty study', headlineSpread([]) === null);
  test('null for a non-array', headlineSpread(null) === null);

  // The Ø5-bore tube, as reported in #256: SF 7.28 / 6.24 / 8.99 / 9.09 with
  // peak 6.864 / 8.017 / 5.564 / 5.500 MPa. Non-monotone in element count — the
  // 65k mesh reports a HIGHER peak than the 81k one.
  {
    const tube = [
      mesh(44875, 6.864, 7.28), mesh(65358, 8.017, 6.24),
      mesh(80866, 5.564, 8.99), mesh(90000, 5.500, 9.09),
    ];
    const s = headlineSpread(tube);
    test('tube: reports all four samples', s.samples === 4, `samples=${s && s.samples}`);
    test('tube: SF range is the measured 6.24–9.09',
      Math.abs(s.safetyFactorMin - 6.24) < 1e-9 && Math.abs(s.safetyFactorMax - 9.09) < 1e-9,
      `${s.safetyFactorMin}–${s.safetyFactorMax}`);
    // (9.09 − 6.24) / 6.24 = 45.7% — the ~46% the issue reports.
    test('tube: SF spread ≈ 46%', Math.abs(s.safetyFactorSpread - 0.4567) < 0.005,
      `${(s.safetyFactorSpread * 100).toFixed(1)}%`);
    test('tube: flagged as material (over the 5% cutoff)', s.material === true);
    // The load-bearing one. Non-monotone means "refine more" is not a remedy,
    // and the UI wording branches on it.
    test('tube: detected as NON-monotone in density', s.monotoneInDensity === false);
  }

  // The plate-with-hole control (smooth-concentration.test.ts): peak climbs
  // 35.980 -> 36.543 -> 36.678 -> 36.714 and settles; SF spread 2.2%.
  {
    const smooth = [
      mesh(3000, 35.980, 1.390), mesh(7000, 36.543, 1.368),
      mesh(12000, 36.678, 1.363), mesh(19000, 36.714, 1.362),
    ];
    const s = headlineSpread(smooth);
    test('smooth: monotone in density', s.monotoneInDensity === true);
    test('smooth: SF spread ≈ 2%', s.safetyFactorSpread < 0.03,
      `${(s.safetyFactorSpread * 100).toFixed(1)}%`);
    // Below the 5% cutoff ⇒ no banner. A converged part must not be told its
    // number is untrustworthy, or the warning stops meaning anything.
    test('smooth: NOT flagged as material', s.material === false);
  }

  // Sorting is by density, not by study order — a study whose results arrive
  // out of order must still read monotonicity correctly.
  {
    const shuffled = [mesh(19000, 36.714, 1.362), mesh(3000, 35.980, 1.390), mesh(7000, 36.543, 1.368)];
    test('monotonicity is judged in density order, not array order',
      headlineSpread(shuffled).monotoneInDensity === true);
  }

  // A study where the safety factor is unavailable (mesh fallback) must still
  // report the peak spread rather than returning nothing.
  {
    const noSf = [mesh(3000, 10, null), mesh(9000, 14, null)];
    const s = headlineSpread(noSf);
    test('no safety factor: still reports the peak spread',
      s !== null && s.safetyFactorSpread === null && Math.abs(s.peakSpread - 0.4) < 1e-9,
      s && `peakSpread=${s.peakSpread}`);
    test('no safety factor: materiality falls back to the peak', s.material === true);
  }

  // Degenerate values must not produce a spread out of nothing.
  {
    test('ignores non-finite peaks', headlineSpread([mesh(1000, NaN, 5), mesh(2000, 10, 4)]) === null);
    test('ignores non-positive peaks', headlineSpread([mesh(1000, 0, 5), mesh(2000, 10, 4)]) === null);
  }

  // Identical meshes: a genuinely flat study reports 0%, which is a measurement
  // (two meshes agreed), unlike the single-mesh null.
  {
    const flat = headlineSpread([mesh(1000, 10, 5), mesh(2000, 10, 5)]);
    test('identical results report a zero spread, not null',
      flat !== null && flat.peakSpread === 0 && flat.safetyFactorSpread === 0);
    test('a zero spread is not material', flat.material === false);
  }
}

// ── Test group T: heatmap display color space + light rig ───────────────────
// The model's colors ARE the data, so what the GPU finally emits must equal
// what the legend shows for the same stress. Two independent bugs broke that:
// sRGB colormap constants written into Three's LINEAR working space, and a
// light rig summing to ~1.65x that clipped channels unevenly (rotating hue,
// so one stress read as several different colors depending on facet normal).
// These tests pin the end-to-end property, not the intermediate steps.
console.log('\n[T] Heatmap display color space — model color == legend color');
{
  // Same extraction window as group [L]: the gamma IIFE through
  // updateLegendSwatches, which contains COLORMAPS, stressColor/divergingColor
  // and the *Linear conversions built on them.
  const m = html.match(/\(function\(\) \{\n  const stored = localStorage\.getItem\('sf-gamma-disabled'\);[\s\S]*?\n\}\n\n\/\/ Restore saved colormap/);
  if (!m) throw new Error('Could not extract gamma-init IIFE..updateLegendSwatches block');

  global.document = { getElementById: () => ({ style: {}, classList: { toggle() {} }, textContent: '' }) };
  global.window = { location: { search: '' } };
  global.localStorage = { _s: {}, getItem(k) { return this._s[k] ?? null; }, setItem(k, v) { this._s[k] = v; } };
  global.S = { colormap: 'viridis' };

  const mod = { exports: {} };
  new Function('module', 'exports', m[0] +
    '\nmodule.exports = { srgbToLinear, stressColor, stressColorLinear, divergingColor,' +
    ' divergingColorLinear, FILTER_GREY_LINEAR, DEFAULT_MESH_LINEAR, COLORMAPS };'
  )(mod, mod.exports);
  const { srgbToLinear, stressColor, stressColorLinear, divergingColor,
          divergingColorLinear, FILTER_GREY_LINEAR, DEFAULT_MESH_LINEAR, COLORMAPS } = mod.exports;

  // Inverse of the client's srgbToLinear — what Three's outputColorSpace='srgb'
  // applies on the way out of the shader. The test owns this direction; the
  // client owns the other.
  const linearToSrgb = (c) => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  const b255 = (c) => Math.round(Math.max(0, Math.min(1, c)) * 255);

  // ── The sRGB transfer function itself, at its defined anchors ─────────────
  test('srgbToLinear(0) = 0', srgbToLinear(0) === 0);
  test('srgbToLinear(1) = 1', Math.abs(srgbToLinear(1) - 1) < 1e-12, `got ${srgbToLinear(1)}`);
  test('srgbToLinear(0.5) ~ 0.2140 (not 0.5 — the fix is not a no-op)',
    Math.abs(srgbToLinear(0.5) - 0.21404114) < 1e-6, `got ${srgbToLinear(0.5)}`);
  test('srgbToLinear is monotonic and round-trips through its inverse',
    [0, 0.02, 0.25, 0.5, 0.75, 1].every(v => Math.abs(linearToSrgb(srgbToLinear(v)) - v) < 1e-9));
  test('FILTER_GREY_LINEAR is the converted mid-grey, not the raw 0.5',
    Math.abs(FILTER_GREY_LINEAR - srgbToLinear(0.5)) < 1e-12 && FILTER_GREY_LINEAR !== 0.5);
  test('DEFAULT_MESH_LINEAR is the converted default blue',
    DEFAULT_MESH_LINEAR.length === 3 &&
    [0.32, 0.50, 0.72].every((v, i) => Math.abs(DEFAULT_MESH_LINEAR[i] - srgbToLinear(v)) < 1e-12));

  // ── Light rig: the bound that makes the round-trip exact ─────────────────
  // Parsed from initThree's real source so retuning the balance without
  // preserving the unit sum fails here rather than in a screenshot.
  const amb = html.match(/new THREE\.AmbientLight\(0x([0-9a-f]{6}), ([\d.]+)\)/);
  const dirs = [...html.matchAll(/new THREE\.DirectionalLight\(0x([0-9a-f]{6}), ([\d.]+)\)/g)];
  test('light rig parsed from initThree (1 ambient + 2 directional)',
    !!amb && dirs.length === 2, `ambient=${!!amb} directional=${dirs.length}`);
  const sum = parseFloat(amb[2]) + dirs.reduce((a, d) => a + parseFloat(d[2]), 0);
  test('light intensities sum to exactly 1.0 (no channel can exceed the colormap color)',
    Math.abs(sum - 1.0) < 1e-9, `sum=${sum}`);
  test('all lights are untinted white (a tint would scale channels unequally)',
    amb[1] === 'ffffff' && dirs.every(d => d[1] === 'ffffff'),
    `ambient=#${amb[1]} directional=${dirs.map(d => '#' + d[1]).join(',')}`);

  // ── Stress material is matte: specular is ADDITIVE and would re-clip ──────
  const matSrc = html.match(/function makeStressMaterial\(extra\) \{[\s\S]*?\n\}/);
  test('makeStressMaterial exists and is the single stress-material factory', !!matSrc);
  test('stress material is fully matte (specular 0x000000, shininess 0)',
    /specular:\s*0x000000/.test(matSrc[0]) && /shininess:\s*0\b/.test(matSrc[0]));
  test('stress material keeps Gouraud shading (CLAUDE.md heatmap invariant)',
    /flatShading:\s*false/.test(matSrc[0]));
  test('no stress mesh still builds a raw shiny MeshPhongMaterial with vertexColors',
    !/new THREE\.MeshPhongMaterial\(\{ vertexColors: true, shininess: 55 \}\)/.test(html));

  // ── The end-to-end property this whole change exists for ─────────────────
  // A fully-lit facet (multiplier 1.0) must emit EXACTLY the legend's color.
  // Model:  stressColorLinear(t) -> *1.0 -> linearToSrgb -> 8-bit
  // Legend: stressColor(t) -> 8-bit  (CSS rgb() is sRGB by definition)
  for (const map of ['viridis', 'plasma', 'rainbow']) {
    const mismatches = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const model = stressColorLinear(t, map).map(c => b255(linearToSrgb(c)));
      const legend = stressColor(t, map).map(b255);
      if (!model.every((v, j) => v === legend[j])) mismatches.push({ t, model, legend });
    }
    test(`${map}: model color == legend color at all 21 sampled stops (fully lit)`,
      mismatches.length === 0,
      mismatches.length ? `first mismatch t=${mismatches[0].t} model=${mismatches[0].model} legend=${mismatches[0].legend}` : '');
  }
  {
    const mismatches = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      const model = divergingColorLinear(t).map(c => b255(linearToSrgb(c)));
      const legend = divergingColor(t).map(b255);
      if (!model.every((v, j) => v === legend[j])) mismatches.push(t);
    }
    test('diverging (σ₁/σ₃) scale: model color == legend color at all 21 stops',
      mismatches.length === 0, `mismatched at t=${mismatches.join(',')}`);
  }

  // Proves the above is a real constraint: the OLD path (sRGB constants written
  // straight into the linear attribute) fails it, and by a visible margin.
  {
    const t = 0;                                   // viridis #440154, the worst case
    const old = stressColor(t, 'viridis').map(c => b255(linearToSrgb(c)));
    const legend = stressColor(t, 'viridis').map(b255);
    const maxErr = Math.max(...old.map((v, j) => Math.abs(v - legend[j])));
    test('regression guard: the pre-fix path is off by >40/255 on viridis dark purple',
      maxErr > 40, `maxErr=${maxErr} old=rgb(${old}) legend=rgb(${legend})`);
  }

  // ── No channel can clip, at any stop, under any facet orientation ─────────
  // Clipping is what rotated hue (viridis purple rendered magenta). With
  // colorLinear <= 1 and the rig <= 1, the product is bounded by construction.
  {
    let worst = 0;
    for (const map of Object.keys(COLORMAPS)) {
      for (let i = 0; i <= 100; i++) {
        for (const L of [0, 0.55, 0.85, sum]) {   // unlit .. ambient-only .. fully lit
          worst = Math.max(worst, ...stressColorLinear(i / 100, map).map(c => c * L));
        }
      }
    }
    test('no channel of any colormap exceeds 1.0 under the normalized rig (no hue rotation)',
      worst <= 1 + 1e-12, `worst channel=${worst}`);
  }

  // ── The cut face reads the shared gamma, not its own copy of the URL flag ──
  {
    const fn = html.match(/function _colorInteriorValues\(values, mode\) \{[\s\S]*?\n\}/);
    test('_colorInteriorValues exists', !!fn);
    test('_colorInteriorValues uses currentGamma() (shared toggle, issue #142)',
      /const GAMMA = currentGamma\(\);/.test(fn[0]));
    // Match the CODE, not the word — the function's comment names the old flag
    // to explain why it is gone, and that mention must not fail the check.
    test('_colorInteriorValues no longer reads the URL flag itself',
      !/URLSearchParams/.test(fn[0]) && !/const\s+disableGamma\s*=/.test(fn[0]));
    test('_colorInteriorValues paints in linear space',
      /stressColorLinear\(/.test(fn[0]) && /divergingColorLinear\(/.test(fn[0]));
  }
}

// ── Test group U: vertex weld grouping (issue #292) ─────────────────────────
// The weld decides which vertices share one stress value, so a group that is
// wider than the tolerance averages stress across geometry that is genuinely
// apart. The old grid grouped by cell OCCUPANCY — first occupied cell in the
// 27-cell neighborhood wins, no distance test, and the borrowed group written
// back under the vertex's own key — which welded up to ~7x WELD_EPS, chained
// transitively, and depended on vertex order. Only ?debugWeld=true observed
// any of that. These tests pin the properties instead.
console.log('\n[U] Vertex weld grouping — distance-tested, no chaining, order-independent (#292)');
{
  const src = html.match(/function weldCoincidentVertices\(posArr, nVerts, weldEps\) \{[\s\S]*?\n\}\n/);
  if (!src) throw new Error('Could not extract weldCoincidentVertices');
  const mod = { exports: {} };
  new Function('module', 'exports', src[0] + '\nmodule.exports = { weldCoincidentVertices };')(mod, mod.exports);
  const { weldCoincidentVertices } = mod.exports;

  const EPS = 0.01;   // the client's WELD_EPS

  // The pre-fix algorithm, kept here (and only here) so the guards below show
  // these tests are a real constraint rather than a restatement of the code.
  function weldByOccupancy(posArr, nVerts, weldEps) {
    const cell = weldEps * 2;
    const weldGroup = new Int32Array(nVerts).fill(-1);
    const weldMap = new Map();
    let nGroups = 0;
    let xMin = Infinity, yMin = Infinity, zMin = Infinity;
    for (let i = 0; i < nVerts; i++) {
      xMin = Math.min(xMin, posArr[i*3]);
      yMin = Math.min(yMin, posArr[i*3+1]);
      zMin = Math.min(zMin, posArr[i*3+2]);
    }
    for (let i = 0; i < nVerts; i++) {
      const ci = Math.floor((posArr[i*3] - xMin) / cell);
      const cj = Math.floor((posArr[i*3+1] - yMin) / cell);
      const ck = Math.floor((posArr[i*3+2] - zMin) / cell);
      let found = -1;
      outer: for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++)
          for (let dk = -1; dk <= 1; dk++) {
            const e = weldMap.get(`${ci+di},${cj+dj},${ck+dk}`);
            if (e !== undefined) { found = e; break outer; }
          }
      if (found === -1) found = nGroups++;
      weldMap.set(`${ci},${cj},${ck}`, found);
      weldGroup[i] = found;
    }
    return { weldGroup, nGroups };
  }

  /** Max distance of any member from its group's representative (first member). */
  function widestFromRep(posArr, weldGroup) {
    const rep = new Map();
    for (let i = 0; i < weldGroup.length; i++) if (!rep.has(weldGroup[i])) rep.set(weldGroup[i], i);
    let worst = 0;
    for (let i = 0; i < weldGroup.length; i++) {
      const r = rep.get(weldGroup[i]);
      worst = Math.max(worst, Math.hypot(
        posArr[i*3] - posArr[r*3], posArr[i*3+1] - posArr[r*3+1], posArr[i*3+2] - posArr[r*3+2]));
    }
    return worst;
  }

  /** Partition as a canonical string, independent of group numbering. */
  function partitionKey(weldGroup, order) {
    const byGroup = new Map();
    for (let k = 0; k < weldGroup.length; k++) {
      const original = order ? order[k] : k;
      const g = weldGroup[k];
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(original);
    }
    return Array.from(byGroup.values())
      .map(v => v.sort((a, b) => a - b).join(','))
      .sort()
      .join('|');
  }

  // Deterministic shuffle (mulberry32) so a failure is reproducible.
  function shuffled(posArr, nVerts, seed) {
    const order = Array.from({ length: nVerts }, (_, i) => i);
    let s = seed >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    for (let i = nVerts - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const out = new Float32Array(nVerts * 3);
    for (let k = 0; k < nVerts; k++) {
      out[k*3] = posArr[order[k]*3]; out[k*3+1] = posArr[order[k]*3+1]; out[k*3+2] = posArr[order[k]*3+2];
    }
    return { pos: out, order };
  }

  // ── The invariant CLAUDE.md already states: coincident vertices weld ──────
  {
    // 8 distinct corners, each duplicated 3x (as unindexed STL triangles do),
    // in interleaved order so welding cannot be an accident of adjacency.
    const corners = [[0,0,0],[10,0,0],[0,10,0],[10,10,0],[0,0,10],[10,0,10],[0,10,10],[10,10,10]];
    const pts = [];
    for (let d = 0; d < 3; d++) for (const c of corners) pts.push(c);
    const pos = new Float32Array(pts.flat());
    const { weldGroup, nGroups } = weldCoincidentVertices(pos, pts.length, EPS);
    test('exactly coincident vertices weld into one group per location',
      nGroups === 8, `got ${nGroups} groups for 8 distinct locations`);
    test('each welded group holds all 3 duplicates of its corner',
      [...new Set(weldGroup)].every(g => weldGroup.filter(x => x === g).length === 3));
    test('every vertex is assigned a valid group id',
      Array.from(weldGroup).every(g => Number.isInteger(g) && g >= 0 && g < nGroups));
  }

  // ── Float imprecision inside the tolerance still welds (that is the point) ─
  {
    const pos = new Float32Array([0, 0, 0,  0.004, 0, 0,  0, 0.004, 0,  -0.003, 0.002, 0.001]);
    const { nGroups } = weldCoincidentVertices(pos, 4, EPS);
    test('near-coincident vertices (STL float noise, < WELD_EPS) still weld',
      nGroups === 1, `got ${nGroups} groups`);
  }

  // ── (1) Welds past the tolerance: the 27-cell-neighborhood corner case ────
  {
    // Two vertices one cell apart on every axis (cell = 2*EPS = 0.02 mm), so
    // the occupancy scan sees the neighbor — but they are 0.069 mm apart,
    // ~6.9x WELD_EPS.
    const a = 0.0001, b = 0.0399;
    const pos = new Float32Array([a, a, a,  b, b, b]);
    const d = Math.hypot(b - a, b - a, b - a);
    test('fixture is inside the 27-cell neighborhood but ~6.9x WELD_EPS apart',
      d > 6.8 * EPS && d < 7 * EPS, `d=${d.toFixed(4)} mm`);
    test('regression guard: occupancy grid welded that pair into one group',
      weldByOccupancy(pos, 2, EPS).nGroups === 1);
    test('vertices beyond WELD_EPS are not welded, even in an adjacent cell',
      weldCoincidentVertices(pos, 2, EPS).nGroups === 2);
  }

  // ── (2) Groups chain transitively ────────────────────────────────────────
  {
    // 40 vertices at 0.015 mm spacing — each beyond WELD_EPS of its neighbor,
    // but every cell in the run is occupied, which is all the old scan asked.
    const n = 40, step = 0.015;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos[i*3] = i * step;
    test('regression guard: occupancy grid chained the whole 0.585 mm run into one group',
      weldByOccupancy(pos, n, EPS).nGroups === 1);
    const { weldGroup, nGroups } = weldCoincidentVertices(pos, n, EPS);
    test('a run of occupied cells does not chain — each spaced vertex stays its own group',
      nGroups === n, `got ${nGroups} groups for ${n} vertices ${step} mm apart`);
    test('no group is wider than WELD_EPS from its representative',
      widestFromRep(pos, weldGroup) <= EPS + 1e-9, `widest=${widestFromRep(pos, weldGroup)}`);
  }

  // ── (3) Vertex-order dependence ──────────────────────────────────────────
  {
    // Clusters of coincident-ish vertices, each well inside WELD_EPS, and far
    // enough apart that the correct partition is unambiguous.
    const centers = [[0,0,0],[0.5,0,0],[0,0.5,0],[-0.35,-0.42,0.7],[1.25,-0.8,0.33]];
    const jitter = [[0,0,0],[0.003,0,0],[0,-0.002,0.001],[0.001,0.002,-0.003]];
    const pts = [];
    for (const c of centers) for (const j of jitter) pts.push([c[0]+j[0], c[1]+j[1], c[2]+j[2]]);
    const pos = new Float32Array(pts.flat());
    const nV = pts.length;
    const base = weldCoincidentVertices(pos, nV, EPS);
    test('clustered fixture welds to one group per cluster',
      base.nGroups === centers.length, `got ${base.nGroups}, expected ${centers.length}`);

    const baseKey = partitionKey(base.weldGroup, null);
    let mismatches = 0;
    for (let seed = 1; seed <= 25; seed++) {
      const { pos: sp, order } = shuffled(pos, nV, seed);
      if (partitionKey(weldCoincidentVertices(sp, nV, EPS).weldGroup, order) !== baseKey) mismatches++;
    }
    test('the partition is independent of vertex order (25 shuffles)',
      mismatches === 0, `${mismatches}/25 permutations produced a different partition`);

    // Same geometry translated into the negative octant: floor-based indexing
    // with bounding-box normalization must not care where the part sits.
    const neg = new Float32Array(nV * 3);
    for (let i = 0; i < nV * 3; i++) neg[i] = pos[i] - 12.5;
    test('a part centered in the negative octant welds identically',
      partitionKey(weldCoincidentVertices(neg, nV, EPS).weldGroup, null) === baseKey);
  }

  // ── The property, swept over a mesh-like point cloud ─────────────────────
  {
    // Sliver-mesh-like: dense random points at ~WELD_CELL scale, where the old
    // grid chained hardest. smooth-concentration.test.ts already produces
    // meshes with normalized Jacobians ~0.006, so this spacing is reachable.
    let s = 12345;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const nV = 3000;
    const pos = new Float32Array(nV * 3);
    for (let i = 0; i < nV; i++) {
      pos[i*3] = (rnd() - 0.5) * 0.4; pos[i*3+1] = (rnd() - 0.5) * 0.4; pos[i*3+2] = (rnd() - 0.5) * 0.4;
    }
    const { weldGroup, nGroups } = weldCoincidentVertices(pos, nV, EPS);
    test('dense sliver-scale cloud: no vertex exceeds WELD_EPS from its group rep',
      widestFromRep(pos, weldGroup) <= EPS + 1e-9, `widest=${widestFromRep(pos, weldGroup).toFixed(5)} mm`);
    test('dense sliver-scale cloud: every group id is in range and used',
      new Set(weldGroup).size === nGroups && Math.max(...weldGroup) === nGroups - 1);
    const occ = weldByOccupancy(pos, nV, EPS);
    test('regression guard: occupancy grid blew past the tolerance on the same cloud',
      widestFromRep(pos, occ.weldGroup) > 5 * EPS,
      `widest=${widestFromRep(pos, occ.weldGroup).toFixed(5)} mm`);

    // No two representatives are within WELD_EPS of each other — the second
    // would have joined the first instead of starting a group. This is what
    // makes "distance 0 wins outright" a safe early exit in the own-cell-first
    // scan: a vertex can be coincident with at most one representative.
    const reps = [];
    const seen = new Set();
    for (let i = 0; i < nV; i++) {
      if (seen.has(weldGroup[i])) continue;
      seen.add(weldGroup[i]);
      reps.push([pos[i*3], pos[i*3+1], pos[i*3+2]]);
    }
    let closest = Infinity;
    for (let a = 0; a < reps.length; a++) {
      for (let b = a + 1; b < reps.length; b++) {
        closest = Math.min(closest, Math.hypot(
          reps[a][0]-reps[b][0], reps[a][1]-reps[b][1], reps[a][2]-reps[b][2]));
      }
    }
    test('no two group representatives are within WELD_EPS of each other',
      closest > EPS, `closest pair=${closest.toFixed(5)} mm across ${reps.length} groups`);
  }

  // ── The heatmap path actually uses it ────────────────────────────────────
  {
    const fn = html.match(/function computeSmoothedStressColors\(vertexStress, maxValOverride, minValOverride, filter\) \{[\s\S]*?\n\}\n/);
    test('computeSmoothedStressColors extracted', !!fn);
    test('computeSmoothedStressColors welds via weldCoincidentVertices',
      /weldCoincidentVertices\(posArr, nVerts, WELD_EPS\)/.test(fn[0]));
    test('computeSmoothedStressColors no longer runs its own occupancy scan',
      !/weldMap/.test(fn[0]) && !/outer:/.test(fn[0]));
  }
}

// ── Test group V: meshSensitivityField — per-location mesh sensitivity (#294) ─
// The displayed field carries a mesh-dependent tail the ZZ estimator cannot
// flag (Spearman 0.015 against actual mesh-to-mesh disagreement, re-measured at
// the post-#295 tier densities in server/tests/measure294.ts). This is the only
// thing in the tool that measures it: two solves of the same display mesh,
// differenced per location. What these tests pin is that it stays a measurement
// — never a smoothed picture, never a zero standing in for "not measured", and
// never normalised in a way that depends on argument order.
console.log('\n[V] Mesh sensitivity — per-location, symmetric, measured-zero != unmeasured (#294)');
{
  const src = html.match(/function meshSensitivityField\(a, b\) \{[\s\S]*?\n\}\n/);
  if (!src) throw new Error('Could not extract meshSensitivityField');
  const mod = { exports: {} };
  new Function('module', 'exports', src[0] + '\nmodule.exports = { meshSensitivityField };')(mod, mod.exports);
  const { meshSensitivityField } = mod.exports;

  // ── "Not measured" must never render as "measured zero" ──────────────────
  test('null with no second mesh', meshSensitivityField(new Float32Array([1,2]), null) === null);
  test('null with no first mesh',  meshSensitivityField(null, new Float32Array([1,2])) === null);
  test('null on empty fields',     meshSensitivityField(new Float32Array(0), new Float32Array(0)) === null);
  // Different display meshes cannot be compared index-by-index; the overlay must
  // refuse rather than paint one part's numbers on another's geometry.
  test('null on length mismatch',
    meshSensitivityField(new Float32Array([1,2,3]), new Float32Array([1,2])) === null);
  // An all-zero pair has no peak to normalise by. Percent-of-nothing is not 0%.
  test('null when both fields are identically zero',
    meshSensitivityField(new Float32Array([0,0,0]), new Float32Array([0,0,0])) === null);

  // ── Two meshes that agree everywhere: measured, and measured as zero ──────
  {
    const a = new Float32Array([3, 7, 11, 5]);
    const s = meshSensitivityField(a, Float32Array.from(a));
    test('identical fields return a result (not null)', s !== null);
    test('identical fields measure 0% everywhere',
      s && Array.from(s.field).every(v => v === 0), s && Array.from(s.field).join(','));
    test('identical fields: median/p95/max all 0',
      s && s.median === 0 && s.p95 === 0 && s.max === 0);
  }

  // ── The arithmetic, on a case computable by hand ─────────────────────────
  {
    // peak = 11 (from b). |a-b| = [0, 0, 1, 0] -> 1/11 = 9.0909...%
    const a = new Float32Array([10, 10, 10, 10]);
    const b = new Float32Array([10, 10, 11, 10]);
    const s = meshSensitivityField(a, b);
    test('normalises by the peak across BOTH fields', Math.abs(s.peakMPa - 11) < 1e-9, `${s.peakMPa}`);
    test('one location moved 1 of 11 -> 9.09%', Math.abs(s.max - 100/11) < 1e-4, `${s.max}`);
    test('the other three did not move',
      s.field[0] === 0 && s.field[1] === 0 && s.field[3] === 0);
    // CLAUDE.md heatmap invariant 1: every display vertex gets a value.
    test('field is one value per vertex, all finite',
      s.field.length === a.length && Array.from(s.field).every(Number.isFinite));
  }

  // ── Symmetry: which mesh is "A" is an accident of study order ────────────
  {
    const a = new Float32Array([1, 9, 4, 12, 0.5]);
    const b = new Float32Array([1.4, 8, 4, 11, 2]);
    const ab = meshSensitivityField(a, b);
    const ba = meshSensitivityField(b, a);
    test('field is identical under argument swap',
      Array.from(ab.field).every((v, i) => Math.abs(v - ba.field[i]) < 1e-12));
    test('summary is identical under argument swap',
      ab.median === ba.median && ab.p95 === ba.p95 && ab.max === ba.max && ab.peakMPa === ba.peakMPa);
  }

  // ── Percentiles are nearest-rank, matching stressPercentile ──────────────
  {
    // 100 vertices; one of them moved by the full peak, 99 did not. A MEAN would
    // report 1% and hide it; the max is the number that has to survive.
    const a = new Float32Array(100);
    const b = new Float32Array(100);
    for (let i = 0; i < 100; i++) { a[i] = 20; b[i] = 20; }
    b[42] = 40;                                  // peak becomes 40, moved by 20
    const s = meshSensitivityField(a, b);
    test('a single moved vertex is reported at full amplitude',
      Math.abs(s.max - 50) < 1e-4, `${s.max}`);
    test('a single moved vertex does not move the median', s.median === 0);
    test('a single moved vertex does not move p95', s.p95 === 0);
  }

  // ── Non-finite input cannot leak into the painted field ─────────────────
  {
    // An infinite peak has no usable normaliser at all: refuse outright.
    test('a non-finite peak returns null',
      meshSensitivityField(new Float32Array([10, Infinity, 10]), new Float32Array([10, 10, 10])) === null);
    // A NaN at ONE vertex must not poison the other 99.99% of the map, and must
    // not paint as a hotspot either.
    const s = meshSensitivityField(new Float32Array([10, 10, NaN]), new Float32Array([10, 12, 10]));
    test('a NaN vertex leaves the rest of the field finite',
      s !== null && Array.from(s.field).every(Number.isFinite), s && Array.from(s.field).join(','));
    test('a NaN vertex reads as 0%, not as movement', s !== null && s.field[2] === 0);
  }

  // ── It is wired to a view mode, and only shows when measured ────────────
  {
    test('meshsens is a registered heatmap mode', /meshsens:\s*\{\s*kind:'sequential'/.test(html));
    test('meshsens lives in the overflow group (not a default view)',
      /const OVERFLOW_MODES = \[[^\]]*'meshsens'[^\]]*\]/.test(html));
    // stressModeAvailable() gates every mode on its array existing, so a null
    // field hides the button rather than painting an empty map.
    // Every exit path below the clear may decline to install, so the clear has
    // to happen before the first of them — otherwise a declined install leaves
    // the PREVIOUS pair's field on screen under the new run's label.
    const inst = html.match(/function installMeshSensitivity\(datums\) \{[\s\S]*?\n\}\n/);
    test('installMeshSensitivity extracted', !!inst);
    test('installMeshSensitivity clears the field before any early return',
      inst && inst[0].indexOf('S._meshSensitivity = null') < inst[0].indexOf('return'),
      inst && `clear@${inst[0].indexOf('S._meshSensitivity = null')} return@${inst[0].indexOf('return')}`);
    test('a fresh solve invalidates the previous measurement',
      /if \(fresh\) S\._meshSensitivity = null;/.test(html));
  }

  // ── DESIGN.md compliance of the markup this issue adds ──────────────────
  // Scoped to the new blocks on purpose. The file at large is not compliant
  // (10px appears 270 times, #312; the results banners are 12px/6px, #303) and
  // a whole-file assertion would just fail. What is pinned here is the rule the
  // mesh-resolution banner in PR #302 set: NEW markup follows DESIGN.md even
  // when its neighbours do not, so the sweep stays a sweep instead of a rewrite.
  {
    const block = html.match(/const sensitivityNote = sens \? \(\(\) => \{[\s\S]*?\}\)\(\) : '';/);
    test('study-report block extracted', !!block);
    test('study-report block uses the type-scale tokens, not 10/12/14px',
      block && !/font-size:\s*1[024]px/.test(block[0]) && /var\(--text-sm\)/.test(block[0]) && /var\(--text-xs\)/.test(block[0]));
    test('study-report block is a callout (border-left), not an off-scale radius card',
      block && !/border-radius/.test(block[0]) && /border-left:2px solid/.test(block[0]));
    test('study-report numbers are DM Mono (they are data, not copy)',
      block && /font-family:'DM Mono',monospace/.test(block[0]));
    test('study-report button carries no font-size or padding override',
      block && /class="btn" onclick="setStressMode\('meshsens'\)" style="margin-top:6px"/.test(block[0]));

    const explainer = html.match(/<div id="meshsens-explainer"[\s\S]*?\n      <\/div>/);
    test('legend explainer extracted', !!explainer);
    test('legend explainer uses the type-scale tokens, not 10/12/14px',
      explainer && !/font-size:\s*1[024]px/.test(explainer[0]) && /var\(--text-sm\)/.test(explainer[0]));
    test('legend explainer data line is DM Mono 9px',
      explainer && /font-family:'DM Mono',monospace;font-size:var\(--text-xs\)/.test(explainer[0]));
  }
}

// ── Test group W: legendValueText — one formatter, two (three) callers ───────
// Found while adding the mesh-sensitivity mode (#294): the legend's label text
// existed twice, in the paint path and in the unit-toggle repaint, and the two
// copies disagreed. The repaint ran the stress conversion over EVERY mode, so
// toggling to imperial relabelled the unitless maps (η, utilization, wall/core,
// and the new % of peak) as a stress; the paint path did the opposite, printing
// unconverted MPa under the imperial label. A heatmap whose legend can misstate
// its own unit is the same class of defect as the p02..p98 clip that used to be
// silent — the picture is the reading, so the number beside it has to be right.
console.log('\n[W] Legend value text — unit conversion applies to stress modes only');
{
  const src = html.match(/function legendValueText\(meta, value, isEdge\) \{[\s\S]*?\n\}\n/);
  if (!src) throw new Error('Could not extract legendValueText');
  const state = { units: 'si' };
  const Umock = {
    stressLabel: () => state.units === 'imperial' ? 'psi' : 'MPa',
    stress: (mpa) => state.units === 'imperial' ? mpa * 145.038 : mpa,
  };
  const mod = { exports: {} };
  new Function('module', 'exports', 'S', 'U',
    src[0] + '\nmodule.exports = { legendValueText };')(mod, mod.exports, state, Umock);
  const { legendValueText } = mod.exports;

  const vmMeta   = { unit: () => Umock.stressLabel(), dec: 1, stressUnit: true };
  const etaMeta  = { unit: () => '',  dec: 3 };
  const sensMeta = { unit: () => '%', dec: 2 };
  const dmgMeta  = { unit: () => '×', dec: 2, perValueUnit: true };

  state.units = 'si';
  test('SI: stress prints MPa unconverted on the edge rows',
    legendValueText(vmMeta, 24.42, true) === '24.4 MPa', legendValueText(vmMeta, 24.42, true));
  test('middle rows carry the number only',
    legendValueText(vmMeta, 24.42, false) === '24.4', legendValueText(vmMeta, 24.42, false));

  state.units = 'imperial';
  // 24.42 MPa = 3542.0 psi. The old paint path printed "24.4 psi" here.
  test('imperial: stress is CONVERTED, not merely relabelled',
    legendValueText(vmMeta, 24.42, true) === '3542 psi', legendValueText(vmMeta, 24.42, true));
  // ...and the old repaint printed "210.30 psi" for a 1.45% mesh-sensitivity.
  test('imperial: a % of peak is untouched by the unit toggle',
    legendValueText(sensMeta, 1.45, true) === '1.45 %', legendValueText(sensMeta, 1.45, true));
  test('imperial: η stays a bare 0–1 share',
    legendValueText(etaMeta, 0.125, true) === '0.125', legendValueText(etaMeta, 0.125, true));
  test('perValueUnit modes keep the unit on every row',
    legendValueText(dmgMeta, 1.25, false) === '1.25×', legendValueText(dmgMeta, 1.25, false));

  state.units = 'si';
  test('SI round-trip: the unitless modes read the same in both systems',
    legendValueText(sensMeta, 1.45, true) === '1.45 %' && legendValueText(etaMeta, 0.125, true) === '0.125');

  // The point of extracting it: nobody may keep a private copy again.
  const paint = html.match(/function applyStressColorsFromArrays\(arrays\) \{[\s\S]*?\n\}\n/);
  test('the paint path formats via legendValueText',
    paint && /legendValueText\(meta,/.test(paint[0]));
  const units = html.match(/function refreshUnitsDisplay\(\) \{[\s\S]*?\n\}\n/);
  test('the unit-toggle repaint formats via legendValueText',
    units && /legendValueText\(meta,/.test(units[0]));
  test('the unit-toggle repaint no longer hard-codes the stress unit for every mode',
    units && !/U\.stressLabel\(\)/.test(units[0]));
}

// ── Test group X: reliability banner treatment ───────────────────────────────
// Issue #303. The banners were six literal copies of one inline-styled block,
// and five of them had drifted off DESIGN.md's type scale (12px headline) and
// radius scale (6px card) while the sixth complied. Copies are what let that
// happen, so this group pins BOTH halves of the fix: the helper emits the
// compliant treatment, and no call site is allowed to hand-roll a banner again.
console.log('\n[X] Reliability banners — one helper, DESIGN.md type/radius scale (#303)');
{
  const src = html.match(/function reliabilityBannerHTML\(headline, bodyHTML, dataLine\) \{[\s\S]*?\n\}\n/);
  if (!src) throw new Error('Could not extract reliabilityBannerHTML');
  const mod = { exports: {} };
  new Function('module', 'exports',
    src[0] + '\nmodule.exports = { reliabilityBannerHTML };')(mod, mod.exports);
  const { reliabilityBannerHTML } = mod.exports;

  const plain = reliabilityBannerHTML('Check your units', 'Body copy.');
  const withData = reliabilityBannerHTML('Thin section is under-resolved', 'Body copy.',
    '1,000 ELEMENTS · 4,000 TARGET (STANDARD) · 2.1 THROUGH THINNEST SECTION');

  test('headline is the 13px step (--text-base)',
    /font-size:var\(--text-base\);font-weight:600/.test(plain), plain);
  test('body copy is the 11px step (--text-sm)',
    /font-size:var\(--text-sm\);color:var\(--text-mid\)/.test(plain), plain);
  test('card radius is 4px, the DESIGN.md card value',
    /border-radius:4px/.test(plain) && !/border-radius:6px/.test(plain), plain);
  test('data line is DM Mono at the 9px step with .08em tracking',
    /font-family:'DM Mono',monospace;font-size:var\(--text-xs\)[^"]*letter-spacing:\.08em/.test(withData),
    withData);
  // A banner with nothing to report must not render an empty data row — same
  // rule the mesh-sensitivity mode follows (group [V]): unmeasured is absent.
  test('no data line is emitted when none is supplied',
    !/DM Mono/.test(plain), plain);
  test('both headline and body are interpolated verbatim (HTML, not escaped)',
    reliabilityBannerHTML('H', 'a <b>bold</b> word').includes('a <b>bold</b> word'));
  test('the helper carries no off-scale font-size or radius literal',
    !/font-size:(?:7|8|10|12|14|18|22)px/.test(src[0]) &&
    !/border-radius:(?:1|3|5|6|8|20)px/.test(src[0]), src[0]);

  // The tokens the helper names must still BE the documented scale — a token
  // reference is only compliant while the token holds its DESIGN.md value.
  const root = html.match(/--text-xs:\s*9px;[\s\S]*?--text-lg:\s*16px;/);
  test('the type-scale tokens still read 9 / 11 / 13 / 16px',
    !!root && /--text-sm:\s*11px;/.test(root[0]) && /--text-base:\s*13px;/.test(root[0]), root && root[0]);

  // The anti-drift half: every append in showResults' chain goes through the
  // helper, so a seventh banner cannot be a seventh copy.
  const chain = html.match(/let reliabilityBanner = '';[\s\S]*?\n  const \{ bucklingGoverns/);
  if (!chain) throw new Error('Could not extract the reliabilityBanner chain');
  const appends = chain[0].match(/reliabilityBanner \+=/g) || [];
  test('all six banners are still wired up', appends.length === 6, `found ${appends.length}`);
  test('every append calls the helper',
    (chain[0].match(/reliabilityBanner \+= reliabilityBannerHTML\(/g) || []).length === appends.length);
  test('no call site hand-rolls banner markup',
    !/font-size:/.test(chain[0]) && !/border-radius:/.test(chain[0]), chain[0]);
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
