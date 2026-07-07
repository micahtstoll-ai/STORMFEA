// scripts/verify_tetgen_c3d10.mjs
//
// Verifies the TetGen -o2 (C3D10) midside-node ordering against the actual
// `tetgen` binary on PATH. Two checks:
//
//   1. ORDERING — meshes a box, then geometrically matches each midside node
//      (slots 4..9 of the .ele file) to the corner pair it bisects. Prints the
//      binary's edge order next to what server/solver/element.ts expects
//      ((0-1),(1-2),(0-2),(0-3),(1-3),(2-3)) and the permutation the repo
//      applies (C3D10_REORDER in server/tetgen.ts).
//
//   2. PHYSICS — runs a cantilever bending solve through the repo's own
//      meshWithTetGen() + runLinearStatic() and compares tip deflection to
//      Euler-Bernoulli. A correct C3D10 pipeline lands within ~5% of the
//      analytic value even on a coarse mesh (see validation group [19]);
//      a scrambled midside permutation is spuriously stiff (ratio ~0.5-0.7).
//
// Usage:  npm run build && node scripts/verify_tetgen_c3d10.mjs
// Requires `tetgen` on PATH. Exits 1 on failure so it can gate CI.

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (p) => path.join(__dirname, '..', 'dist', p);

const { meshWithTetGen } = await import(dist('tetgen.js'));
const { runLinearStatic } = await import(dist('solver/pipeline.js'));

// ─── Beam geometry ────────────────────────────────────────────────────────────
const L = 40, W = 4, H = 2; // mm — length x, width y, height z
const BOX_VERTS = [
  [0,0,0],[L,0,0],[L,W,0],[0,W,0],
  [0,0,H],[L,0,H],[L,W,H],[0,W,H],
];
const BOX_QUADS = [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]];

function boxTriangleSoup() {
  const tris = [];
  for (const [a,b,c,d] of BOX_QUADS) {
    tris.push([BOX_VERTS[a],BOX_VERTS[b],BOX_VERTS[c]],[BOX_VERTS[a],BOX_VERTS[c],BOX_VERTS[d]]);
  }
  const arr = new Float32Array(tris.length * 9);
  tris.forEach((t,i) => t.forEach((p,j) => p.forEach((x,k) => arr[i*9+j*3+k] = x)));
  return { arr, count: tris.length };
}

function boxOFF() {
  const faces = [];
  for (const [a,b,c,d] of BOX_QUADS) faces.push([a,b,c],[a,c,d]);
  let s = `OFF\n${BOX_VERTS.length} ${faces.length} 0\n`;
  for (const p of BOX_VERTS) s += p.join(' ') + '\n';
  for (const f of faces) s += '3 ' + f.join(' ') + '\n';
  return s;
}

// ─── Check 1: derive the binary's midside edge order ─────────────────────────
function deriveOrdering() {
  const base = path.join(os.tmpdir(), `verify_o2_${Date.now()}`);
  fs.writeFileSync(base + '.off', boxOFF());
  const r = spawnSync('tetgen', ['-pq1.4a10Q', '-o2', base + '.off'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    throw new Error(`tetgen not runnable: ${r.error?.message ?? r.stderr}`);
  }
  const nodeLines = fs.readFileSync(base + '.1.node', 'utf8').trim().split('\n')
    .filter(l => l.trim() && !l.startsWith('#'));
  const nCount = parseInt(nodeLines[0].split(/\s+/)[0]);
  const firstIdx = parseInt(nodeLines[1].trim().split(/\s+/)[0]);
  const nodes = [];
  for (let i = 0; i < nCount; i++) {
    const p = nodeLines[i+1].trim().split(/\s+/);
    nodes.push([+p[1], +p[2], +p[3]]);
  }
  const eleLines = fs.readFileSync(base + '.1.ele', 'utf8').trim().split('\n')
    .filter(l => l.trim() && !l.startsWith('#'));
  const eCount = Math.min(parseInt(eleLines[0].split(/\s+/)[0]), 50);

  const slotEdge = new Array(6).fill(null); // slot 4..9 → 'a-b'
  for (let e = 0; e < eCount; e++) {
    const p = eleLines[e+1].trim().split(/\s+/).slice(1).map(x => parseInt(x) - firstIdx);
    const corners = p.slice(0, 4).map(i => nodes[i]);
    for (let m = 4; m < 10; m++) {
      const mp = nodes[p[m]];
      for (let a = 0; a < 4; a++) for (let b = a+1; b < 4; b++) {
        const mid = [0,1,2].map(k => (corners[a][k] + corners[b][k]) / 2);
        if (Math.hypot(mid[0]-mp[0], mid[1]-mp[1], mid[2]-mp[2]) < 1e-9) {
          const edge = `${a}-${b}`;
          if (slotEdge[m-4] === null) slotEdge[m-4] = edge;
          else if (slotEdge[m-4] !== edge) {
            throw new Error(`inconsistent midside ordering: slot ${m} is ${slotEdge[m-4]} and ${edge}`);
          }
        }
      }
    }
  }
  return slotEdge;
}

// ─── Check 2: cantilever bending through the repo pipeline ───────────────────
async function cantileverRatio() {
  const { arr, count } = boxTriangleSoup();
  const { mesh } = await meshWithTetGen(arr, count, 2);
  if (mesh.nodesPerElem !== 10) {
    throw new Error(`expected C3D10 mesh, got nodesPerElem=${mesh.nodesPerElem}`);
  }
  const fixed = [], tip = [];
  for (let n = 0; n < mesh.nodeCount; n++) {
    const x = mesh.nodes[n*3];
    if (x < 1e-6) fixed.push(n);
    if (Math.abs(x - L) < 1e-6) tip.push(n);
  }
  const F = 10; // N, applied in -z at the free end
  const forces = tip.map(n => ({ nodeIndex: n, forceN: [0, 0, -F / tip.length] }));
  const E = 3500, nu = 0.36;
  const res = await runLinearStatic({
    mesh,
    material: { kind: 'isotropic', E, nu, yieldStrength: 50, label: 'verify-iso' },
    constraints: [{ nodeIndices: fixed }],
    forces,
  });
  let tipUz = 0;
  for (const n of tip) tipUz = Math.min(tipUz, res.displacement[n*3+2]);
  const I = W * H**3 / 12;
  const dEB = F * L**3 / (3 * E * I);
  return { ratio: Math.abs(tipUz) / dEB, elems: mesh.elementCount, converged: res.converged };
}

// ─── Run ──────────────────────────────────────────────────────────────────────
const EXPECTED = ['0-1', '1-2', '0-2', '0-3', '1-3', '2-3']; // element.ts slots 4..9

let ok = true;
try {
  const derived = deriveOrdering();
  console.log('TetGen -o2 midside slots 4..9 emit edges :', derived.join(', '));
  console.log('element.ts expects slots 4..9 to be edges:', EXPECTED.join(', '));
  // The permutation that fixes it: for each expected edge, which raw slot has it
  const perm = [0, 1, 2, 3, ...EXPECTED.map(e => 4 + derived.indexOf(e))];
  console.log('correct C3D10_REORDER for this binary   :', JSON.stringify(perm));
} catch (e) {
  console.error('ORDERING CHECK SKIPPED/FAILED:', e.message);
  ok = false;
}

try {
  const { ratio, elems, converged } = await cantileverRatio();
  const pass = converged && ratio > 0.85 && ratio < 1.15;
  console.log(`cantilever δ/δ_EB = ${ratio.toFixed(3)} (${elems} C3D10 elems, converged=${converged}) → ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) {
    console.error('FAIL: C3D10-via-TetGen bending is outside 0.85–1.15 of Euler-Bernoulli.');
    console.error('Most likely cause: C3D10_REORDER in server/tetgen.ts does not match this');
    console.error('TetGen binary\'s midside ordering (see the derived permutation above).');
    ok = false;
  }
} catch (e) {
  console.error('PHYSICS CHECK FAILED:', e.message);
  ok = false;
}

process.exit(ok ? 0 : 1);
