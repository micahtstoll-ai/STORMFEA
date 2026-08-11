/**
 * measure294.ts — re-measure the displayed field's mesh-dependent artifact tail
 * at the densities the tool actually ships (issue #294, comment on 50b0881).
 *
 *   npm run build && node dist/tests/measure294.js
 *   MEASURE294_TIERS=coarse,standard node dist/tests/measure294.js
 *
 * WHY THIS EXISTS
 * ---------------
 * #294 measured, on a symmetric cantilever plate at 3,072 C3D10 elements, that
 * two different meshes of the SAME geometry under the SAME load produce nodal
 * fields disagreeing by a median of 0.03% of peak but a p95 of 7.90% and a max
 * of 16.05% — and that the ZZ per-element error estimate does not predict where
 * (Spearman 0.015). Those numbers were taken before #295 changed what a mesh
 * tier promises (coarse 4,000 / standard 12,000 / fine 40,000 elements plus a
 * 4-elements-through-thickness floor). Mesh density is the only lever #294
 * identified, and that lever moved, so the figures needed re-taking in the
 * regime the tool now defaults to.
 *
 * This is an offline measurement script, not a CI test — same role as
 * measure260.ts. It solves up to six times (two independent meshes at each of
 * three tiers) and prints a table; it asserts nothing. The conclusions it
 * produced are recorded in docs/display-field-mesh-sensitivity.md, and the
 * client-side consequence (the MESH SENSITIVITY overlay) is unit-tested in
 * scripts/test_client_logic.mjs group [V].
 *
 * WHAT IT MEASURES
 * ----------------
 * The quantity a user reads: the recovered NODAL von Mises sampled where the
 * display pipeline samples it. server/analysis.ts maps each display-mesh vertex
 * to its NEAREST analysis node (nearestNodeStress), so the probe here does the
 * same — nearest-node lookup at a fixed grid of surface points, which is
 * mesh-independent by construction and therefore comparable between meshes.
 *
 * Mesh A is the structured grid. Mesh B is the SAME grid with its nodes moved:
 * interior corners jittered in all three axes, face corners jittered within
 * their face plane, edge corners along their edge, box corners pinned — so the
 * geometry, the element count and the tier are identical and only node PLACEMENT
 * differs. Midside nodes are recomputed as edge midpoints, keeping every C3D10
 * element straight-sided (no curved-element quadrature error is introduced).
 */
import { runLinearStatic } from "../solver/pipeline.js";
import { generateBoxMeshC3D10 } from "../solver/meshgen.js";
import { vonMisesFromTensor6 } from "../solver/stress.js";
import type { TetMesh, IsotropicMaterial, PointForce } from "../solver/types.js";
import type { FixedNodeSet } from "../solver/boundary.js";

// ─── Fixture: the #294 cantilever plate, verbatim ────────────────────────────
const L = 100, W = 40, T = 8;          // mm
const TIP_LOAD_N = 200;                // transverse (+z) at the free end
const MAT: IsotropicMaterial = { E: 3500, nu: 0.36, yieldStrength: 50, label: "measure294-PLA" };

/**
 * Divisions that land each tier's element budget on this plate. 6 tets per hex,
 * cells kept as close to cubic as integer divisions allow, and nz >= 4 so the
 * mesh clears MIN_ELEMENTS_THROUGH_THICKNESS (#295) — the floor is part of what
 * a tier now promises, so measuring below it would measure a mesh the tool no
 * longer emits.
 */
const TIERS: Record<string, { nx: number; ny: number; nz: number }> = {
  coarse:   { nx: 21, ny:  8, nz: 4 },   //  4,032 elements
  standard: { nx: 32, ny: 13, nz: 4 },   //  9,984 elements
  fine:     { nx: 50, ny: 20, nz: 6 },   // 36,000 elements
};

/**
 * Jitter amplitude as a fraction of the cell size, MEASURE294_AMP to override.
 *
 * Capped by the solver's own mesh-quality hard gate, which is the right cap:
 * a perturbation that produces a sliver produces a mesh STORMFEA refuses to
 * solve, so measuring on it would measure a mesh the tool never shows anyone.
 * At 0.25 the fine tier trips that gate on both seeds tried (normalized
 * Jacobian 0.0150; then 0.0059 and 0.0169, against the 0.02 floor) — with
 * ~36,000 elements a fixed per-node displacement simply gets more chances to
 * make a sliver. 0.15 clears the gate at every tier.
 */
const JITTER_AMP = Number(process.env["MEASURE294_AMP"] ?? 0.15);

/**
 * Base seed for mesh B's node displacement, MEASURE294_SEED to override. Only
 * useful for asking whether a result is a property of the perturbation or of the
 * tier — and for stepping past a seed whose mesh trips the quality gate at a
 * large amplitude, which is a property of that one draw, not of the tier.
 */
const JITTER_SEED = Number(process.env["MEASURE294_SEED"] ?? 0x5f2b);

// ─── Deterministic node jitter ───────────────────────────────────────────────

/** xorshift32 — deterministic, so a rerun reproduces the same mesh B exactly. */
function rng(seed: number): () => number {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;   // (-1, 1)
  };
}

/**
 * Move every node of a structured C3D10 box mesh without changing the geometry
 * it discretizes. A node may move only within the feature it sits on: interior
 * freely, a face within its plane, an edge along itself, a box corner not at
 * all. Midside nodes are then rebuilt as the midpoints of their corner pairs
 * (STORMFEA C3D10 ordering: 4=mid(0,1), 5=mid(1,2), 6=mid(0,2), 7=mid(0,3),
 * 8=mid(1,3), 9=mid(2,3)), so elements stay straight-sided.
 *
 * @param amp jitter amplitude as a fraction of the local cell size.
 */
function jitterMesh(mesh: TetMesh, hx: number, hy: number, hz: number, amp: number, seed: number): TetMesh {
  const rand = rng(seed);
  const nodes = Float64Array.from(mesh.nodes);
  const EPS = 1e-9;
  // Corner nodes come first (generateBoxMeshC3D10 appends midsides after them);
  // a midside is any node that is the midpoint of an element edge, which we
  // rebuild below regardless, so only corners need the on-feature test here.
  const isMid = new Uint8Array(mesh.nodeCount);
  for (let e = 0; e < mesh.elementCount; e++) {
    for (let k = 4; k < 10; k++) isMid[mesh.elements[e * 10 + k] ?? 0] = 1;
  }
  for (let n = 0; n < mesh.nodeCount; n++) {
    if (isMid[n]) continue;
    const x = nodes[n * 3] ?? 0, y = nodes[n * 3 + 1] ?? 0, z = nodes[n * 3 + 2] ?? 0;
    const freeX = x > EPS && x < L - EPS;
    const freeY = y > EPS && y < W - EPS;
    const freeZ = z > EPS && z < T - EPS;
    if (freeX) nodes[n * 3]     = x + amp * hx * rand();
    if (freeY) nodes[n * 3 + 1] = y + amp * hy * rand();
    if (freeZ) nodes[n * 3 + 2] = z + amp * hz * rand();
  }
  // Rebuild midsides from the moved corners.
  const MID: [number, number, number][] = [
    [4, 0, 1], [5, 1, 2], [6, 0, 2], [7, 0, 3], [8, 1, 3], [9, 2, 3],
  ];
  for (let e = 0; e < mesh.elementCount; e++) {
    for (const [m, a, b] of MID) {
      const im = mesh.elements[e * 10 + m] ?? 0;
      const ia = mesh.elements[e * 10 + a] ?? 0;
      const ib = mesh.elements[e * 10 + b] ?? 0;
      for (let c = 0; c < 3; c++) {
        nodes[im * 3 + c] = 0.5 * ((nodes[ia * 3 + c] ?? 0) + (nodes[ib * 3 + c] ?? 0));
      }
    }
  }
  return { ...mesh, nodes };
}

// ─── Solve + probe ───────────────────────────────────────────────────────────

interface Solved {
  mesh: TetMesh;
  /** Recovered nodal von Mises — the field the heatmap paints. */
  nodalVM: Float64Array;
  /** Per-element ZZ error estimate, for the correlation check. */
  errorEstimate: Float32Array | null;
  globalRelativeError: number | null;
  elementCount: number;
  tipDeflectionMm: number;
  solverMs: number;
}

async function solve(mesh: TetMesh): Promise<Solved> {
  const clamp: number[] = [];
  const tipNodes: number[] = [];
  for (let n = 0; n < mesh.nodeCount; n++) {
    const x = mesh.nodes[n * 3] ?? 0;
    if (x < 1e-9) clamp.push(n);
    if (x > L - 1e-9) tipNodes.push(n);
  }
  const constraints: FixedNodeSet[] = [{ nodeIndices: clamp }];
  const per = TIP_LOAD_N / tipNodes.length;
  const forces: PointForce[] = tipNodes.map(n => ({ nodeIndex: n, forceN: [0, 0, per] as const }));

  const result = await runLinearStatic({ mesh, material: MAT, constraints, forces });

  const s6 = result.nodeStress6;
  if (!s6) throw new Error("no nodal stress tensor on the result — nothing to measure");
  const nodalVM = new Float64Array(mesh.nodeCount);
  for (let n = 0; n < mesh.nodeCount; n++) {
    nodalVM[n] = vonMisesFromTensor6(
      s6[n * 6] ?? 0, s6[n * 6 + 1] ?? 0, s6[n * 6 + 2] ?? 0,
      s6[n * 6 + 3] ?? 0, s6[n * 6 + 4] ?? 0, s6[n * 6 + 5] ?? 0,
    );
  }
  let tip = 0;
  for (const n of tipNodes) tip = Math.max(tip, Math.abs(result.displacement[n * 3 + 2] ?? 0));

  return {
    mesh,
    nodalVM,
    errorEstimate: result.errorEstimate ?? null,
    globalRelativeError: result.globalRelativeError ?? null,
    elementCount: mesh.elementCount,
    tipDeflectionMm: tip,
    solverMs: result.solverMs,
  };
}

/**
 * Probe grid on the TOP surface (z = T), clamp band excluded (x < 2T), matching
 * #294. Fixed in space, so the same probe reads both meshes.
 */
function probePoints(nu = 18, nv = 12): Float64Array {
  const x0 = 2 * T, x1 = L - 1;
  const y0 = 1, y1 = W - 1;
  const pts = new Float64Array(nu * nv * 3);
  let i = 0;
  for (let a = 0; a < nu; a++) {
    for (let b = 0; b < nv; b++) {
      pts[i * 3]     = x0 + ((x1 - x0) * a) / (nu - 1);
      pts[i * 3 + 1] = y0 + ((y1 - y0) * b) / (nv - 1);
      pts[i * 3 + 2] = T;
      i++;
    }
  }
  return pts;
}

/** Nearest-node lookup, the same rule server/analysis.ts uses to paint a vertex. */
function sampleNearest(s: Solved, pts: Float64Array): Float64Array {
  const out = new Float64Array(pts.length / 3);
  const { nodes, nodeCount } = s.mesh;
  for (let p = 0; p < out.length; p++) {
    const px = pts[p * 3] ?? 0, py = pts[p * 3 + 1] ?? 0, pz = pts[p * 3 + 2] ?? 0;
    let best = Infinity, bestN = 0;
    for (let n = 0; n < nodeCount; n++) {
      const dx = (nodes[n * 3] ?? 0) - px, dy = (nodes[n * 3 + 1] ?? 0) - py, dz = (nodes[n * 3 + 2] ?? 0) - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) { best = d2; bestN = n; }
    }
    out[p] = s.nodalVM[bestN] ?? 0;
  }
  return out;
}

/** Per-element ZZ error sampled at the same probes (nearest element centroid). */
function sampleError(s: Solved, pts: Float64Array): Float64Array | null {
  if (!s.errorEstimate) return null;
  const { nodes, elements, elementCount } = s.mesh;
  const npe = s.mesh.nodesPerElem;
  const cx = new Float64Array(elementCount * 3);
  for (let e = 0; e < elementCount; e++) {
    let sx = 0, sy = 0, sz = 0;
    for (let k = 0; k < 4; k++) {
      const n = elements[e * npe + k] ?? 0;
      sx += (nodes[n * 3] ?? 0) / 4;
      sy += (nodes[n * 3 + 1] ?? 0) / 4;
      sz += (nodes[n * 3 + 2] ?? 0) / 4;
    }
    cx[e * 3] = sx; cx[e * 3 + 1] = sy; cx[e * 3 + 2] = sz;
  }
  const out = new Float64Array(pts.length / 3);
  for (let p = 0; p < out.length; p++) {
    const px = pts[p * 3] ?? 0, py = pts[p * 3 + 1] ?? 0, pz = pts[p * 3 + 2] ?? 0;
    let best = Infinity, bestE = 0;
    for (let e = 0; e < elementCount; e++) {
      const dx = (cx[e * 3] ?? 0) - px, dy = (cx[e * 3 + 1] ?? 0) - py, dz = (cx[e * 3 + 2] ?? 0) - pz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) { best = d2; bestE = e; }
    }
    out[p] = s.errorEstimate[bestE] ?? 0;
  }
  return out;
}

// ─── Statistics ──────────────────────────────────────────────────────────────

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i] ?? NaN;
}

/** Spearman rank correlation. Ties get their average rank. */
function spearman(a: readonly number[], b: readonly number[]): number {
  const rank = (v: readonly number[]): number[] => {
    const idx = v.map((_, i) => i).sort((i, j) => (v[i] ?? 0) - (v[j] ?? 0));
    const r = new Array<number>(v.length).fill(0);
    let i = 0;
    while (i < idx.length) {
      let j = i;
      while (j + 1 < idx.length && (v[idx[j + 1] ?? 0] ?? 0) === (v[idx[i] ?? 0] ?? 0)) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k] ?? 0] = avg;
      i = j + 1;
    }
    return r;
  };
  const ra = rank(a), rb = rank(b);
  const n = ra.length;
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const x = (ra[i] ?? 0) - ma, y = (rb[i] ?? 0) - mb;
    num += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const want = (process.env["MEASURE294_TIERS"] ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const tiers = Object.keys(TIERS).filter(t => want.length === 0 || want.includes(t));
  const pts = probePoints();

  console.log("measure294 — displayed-field mesh sensitivity at the #295 tier densities");
  console.log(`fixture: cantilever ${L}x${W}x${T} mm, C3D10, ${TIP_LOAD_N} N transverse tip load`);
  console.log(`probes: ${pts.length / 3} on the top surface, clamp band x < ${2 * T} mm excluded`);
  console.log(`node jitter: ${(JITTER_AMP * 100).toFixed(0)}% of cell size\n`);

  const rows: string[] = [];
  for (const tier of tiers) {
    const { nx, ny, nz } = TIERS[tier]!;
    const meshA = generateBoxMeshC3D10(0, 0, 0, L, W, T, nx, ny, nz);
    const meshB = jitterMesh(meshA, L / nx, W / ny, T / nz, JITTER_AMP, JITTER_SEED + nx);

    const t0 = Date.now();
    const A = await solve(meshA);
    const B = await solve(meshB);
    const wall = Date.now() - t0;

    const sA = sampleNearest(A, pts);
    const sB = sampleNearest(B, pts);
    const peak = Math.max(...Array.from(sA), ...Array.from(sB));

    const diffs: number[] = [];
    for (let i = 0; i < sA.length; i++) diffs.push(Math.abs((sA[i] ?? 0) - (sB[i] ?? 0)) / peak * 100);
    const sorted = diffs.slice().sort((x, y) => x - y);

    const errA = sampleError(A, pts);
    const rho = errA ? spearman(Array.from(errA), diffs) : NaN;

    console.log(`── ${tier}: ${nx}x${ny}x${nz} → ${A.elementCount.toLocaleString()} elements, ${nz} through thickness`);
    console.log(`   solve A ${(A.solverMs / 1000).toFixed(1)}s / B ${(B.solverMs / 1000).toFixed(1)}s (wall ${(wall / 1000).toFixed(1)}s)`);
    console.log(`   tip deflection  A ${A.tipDeflectionMm.toFixed(4)} mm   B ${B.tipDeflectionMm.toFixed(4)} mm   ` +
      `(${(Math.abs(A.tipDeflectionMm - B.tipDeflectionMm) / A.tipDeflectionMm * 100).toFixed(3)}% apart)`);
    console.log(`   probe peak VM   ${peak.toFixed(3)} MPa`);
    console.log(`   |A-B| / peak    median ${pct(sorted, 50).toFixed(2)}%   p95 ${pct(sorted, 95).toFixed(2)}%   max ${pct(sorted, 100).toFixed(2)}%`);
    console.log(`   globalRelativeError  A ${A.globalRelativeError != null ? (A.globalRelativeError * 100).toFixed(2) + "%" : "—"}` +
      `   B ${B.globalRelativeError != null ? (B.globalRelativeError * 100).toFixed(2) + "%" : "—"}`);
    console.log(`   Spearman(errorEstimate_A, |A-B|)  ${rho.toFixed(3)}\n`);

    rows.push(`| ${tier} | ${A.elementCount.toLocaleString()} | ${pct(sorted, 50).toFixed(2)}% | ` +
      `${pct(sorted, 95).toFixed(2)}% | ${pct(sorted, 100).toFixed(2)}% | ${rho.toFixed(3)} | ` +
      `${A.globalRelativeError != null ? (A.globalRelativeError * 100).toFixed(1) + "%" : "—"} |`);
  }

  console.log("markdown:");
  console.log("| tier | elements | median | p95 | max | Spearman(eta, |A-B|) | globalRelativeError |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of rows) console.log(r);
}

main().catch(e => { console.error(e); process.exit(1); });
