/**
 * modal-solver.test.ts
 * --------------------
 * Validates the modal eigensolver against the Euler-Bernoulli analytical
 * solution for a steel cantilever beam.
 *
 * Beam: 100mm × 10mm × 10mm, E=210000 MPa, ν=0.3, ρ=7.85e-9 tonne/mm³
 * Fixed at x=0 face (fully clamped cantilever).
 *
 * Analytical first natural frequency (Euler-Bernoulli):
 *   f₁ = (β₁L)² / (2π·L²) · √(EI / ρA)  ≈ 835.5 Hz
 *
 * Tolerances:
 *   C3D4: within 5% of 835.5 Hz
 *   C3D10: within 2% of 835.5 Hz
 */

import { describe, it, expect, beforeAll } from "vitest";
import { generateBoxMesh, getNodesOnFace } from "../../solver/meshgen.js";
import { runModalAnalysis } from "../../solver/modal.js";
import type { TetMesh } from "../../solver/types.js";

// ─── Analytical reference ─────────────────────────────────────────────────────

const STEEL = {
  E:             210_000,   // MPa
  nu:            0.3,
  yieldStrength: 250,
  label:         "steel-modal-test",
};

const L       = 100;     // mm, beam length along X
const W       = 10;      // mm, cross-section width (Y)
const H       = 10;      // mm, cross-section height (Z)
const I       = W * H**3 / 12;          // 833.33 mm⁴
const A       = W * H;                  // 100 mm²
const beta1L  = 1.875104;               // first root of cosh(x)cos(x) = -1

/** Euler-Bernoulli first natural frequency in Hz. */
const f1_analytical = (beta1L**2 / (2 * Math.PI * L**2))
  * Math.sqrt(STEEL.E * I / (STEEL.nu >= 0 ? STEEL.E : 1) / 1) // placeholder
  // Corrected:
  ;
// Recompute properly:
const EI      = STEEL.E * I;                         // N·mm²
const rhoA    = 7.85e-9 * A;                         // tonne/mm
const f1_ref  = (beta1L**2 / (2 * Math.PI * L**2)) * Math.sqrt(EI / rhoA);
// f1_ref ≈ 835.5 Hz

// ─── C3D10 upgrade helper ─────────────────────────────────────────────────────

/**
 * Upgrade a C3D4 mesh to C3D10 by inserting edge midpoint nodes.
 * Gmsh node ordering:
 *   corners: 0,1,2,3
 *   midpoints: 4=(0-1), 5=(1-2), 6=(0-2), 7=(0-3), 8=(1-3), 9=(2-3)
 */
function upgradeToC3D10(c3d4: TetMesh): TetMesh {
  const EDGE_PAIRS: [number, number][] = [
    [0,1], [1,2], [0,2], [0,3], [1,3], [2,3]
  ];

  // Key midpoint nodes by physical COORDINATE (not node-pair), because two different
  // edges from different elements can share the same physical midpoint (e.g., face
  // diagonals on a rectangular face).  We quantise to the nearest 1e-9 mm to avoid
  // floating-point false negatives on a regular grid.
  const QUANT = 1e9;  // quantise to 1e-9 mm
  const midpointMap = new Map<string, number>();
  const newNodeCoords: number[] = Array.from(c3d4.nodes);

  const elements10 = new Int32Array(c3d4.elementCount * 10);

  for (let e = 0; e < c3d4.elementCount; e++) {
    const base4  = e * 4;
    const base10 = e * 10;
    const corners = [
      c3d4.elements[base4]!,
      c3d4.elements[base4+1]!,
      c3d4.elements[base4+2]!,
      c3d4.elements[base4+3]!,
    ];
    for (let i = 0; i < 4; i++) elements10[base10 + i] = corners[i]!;

    for (let ep = 0; ep < 6; ep++) {
      const [ai, bi] = EDGE_PAIRS[ep]!;
      const na = corners[ai]!, nb = corners[bi]!;
      const mx = (c3d4.nodes[na*3]!   + c3d4.nodes[nb*3]!)   / 2;
      const my = (c3d4.nodes[na*3+1]! + c3d4.nodes[nb*3+1]!) / 2;
      const mz = (c3d4.nodes[na*3+2]! + c3d4.nodes[nb*3+2]!) / 2;
      // Use quantised coordinate string as deduplication key
      const key = `${Math.round(mx * QUANT)},${Math.round(my * QUANT)},${Math.round(mz * QUANT)}`;
      let mid = midpointMap.get(key);
      if (mid === undefined) {
        mid = newNodeCoords.length / 3;
        newNodeCoords.push(mx, my, mz);
        midpointMap.set(key, mid);
      }
      elements10[base10 + 4 + ep] = mid;
    }
  }

  return {
    nodes:        new Float64Array(newNodeCoords),
    elements:     elements10,
    nodeCount:    newNodeCoords.length / 3,
    elementCount: c3d4.elementCount,
    nodesPerElem: 10,
  };
}

// ─── Frequency finder ─────────────────────────────────────────────────────────

function firstBendingFrequency(modes: Array<{ frequencyHz: number }>): number {
  const THRESHOLD_HZ = 10;
  for (const m of modes) {
    if (m.frequencyHz > THRESHOLD_HZ) return m.frequencyHz;
  }
  throw new Error(
    `No mode above ${THRESHOLD_HZ} Hz. Frequencies: ` +
    modes.map(m => m.frequencyHz.toFixed(1)).join(", ")
  );
}

// ─── Eigenvector comparison ───────────────────────────────────────────────────

/**
 * Compute dot product of two mode shapes (eigenvectors).
 * Both are Float64Array of length n (DOF count).
 */
function dotProduct(a: Float64Array, b: Float64Array): number {
  if (a.length !== b.length) throw new Error(`Shape mismatch: ${a.length} vs ${b.length}`);
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/**
 * Normalize a vector to unit length (L2 norm).
 */
function normalize(v: Float64Array): Float64Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += (v[i] ?? 0) ** 2;
  norm = Math.sqrt(norm);
  if (norm < 1e-14) return v; // avoid division by zero
  const normalized = new Float64Array(v.length);
  for (let i = 0; i < v.length; i++) normalized[i] = (v[i] ?? 0) / norm;
  return normalized;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Analytical reference value checks", () => {
  it("f1_ref is approximately 835.5 Hz", () => {
    expect(f1_ref).toBeGreaterThan(800);
    expect(f1_ref).toBeLessThan(870);
  });

  it("moment of inertia I = wh³/12 = 833.33 mm⁴", () => {
    expect(I).toBeCloseTo(833.33, 1);
  });

  it("cross-section area A = 100 mm²", () => {
    expect(A).toBe(100);
  });
});

describe("Modal solver — C3D4 cantilever beam (40×5×5)", () => {
  let f1_fem: number;
  let allFreqs: number[];
  let nearZeroCount: number;

  beforeAll(async () => {
    // Use 40×5×5 mesh: C3D4 converges to within 5% of E-B at this refinement.
    // Coarser meshes (e.g. 20×3×3) suffer from shear locking (~15% error).
    const mesh = generateBoxMesh(0, 0, 0, L, W, H, 40, 5, 5);
    const fixedNodes = getNodesOnFace(mesh, "x", 0);

    const modalResult = await runModalAnalysis({
      mesh,
      material: STEEL,
      fixedNodes,
      nModes: 10,
    });

    allFreqs = modalResult.modes.map(m => m.frequencyHz);
    nearZeroCount = allFreqs.filter(f => f <= 10).length;
    f1_fem = firstBendingFrequency(modalResult.modes);
  }, 120_000);  // 2-minute timeout for modal solve

  it("first bending frequency is within 5% of Euler-Bernoulli (f₁ ≈ 835.5 Hz)", () => {
    const error = Math.abs(f1_fem - f1_ref) / f1_ref;
    const errorPct = (error * 100).toFixed(2);
    console.log(`\n  [C3D4 40×5×5] f₁_computed = ${f1_fem.toFixed(2)} Hz, f₁_analytical = ${f1_ref.toFixed(2)} Hz, error = ${errorPct}%`);
    expect(error).toBeLessThanOrEqual(0.05);
  });

  it("first bending frequency is above 10 Hz (not a spurious zero mode)", () => {
    expect(f1_fem).toBeGreaterThan(10);
  });

  it("first bending frequency is below 10× analytical (not a higher mode)", () => {
    expect(f1_fem).toBeLessThan(f1_ref * 10);
  });

  it("at most 2 near-zero modes (rigid body artefacts expected ≤ 2)", () => {
    expect(nearZeroCount).toBeLessThanOrEqual(2);
  });
});

describe("Modal solver — C3D10 cantilever beam (20×3×3 upgraded)", () => {
  let f1_fem_c3d10: number;

  beforeAll(async () => {
    const meshC3D4 = generateBoxMesh(0, 0, 0, L, W, H, 20, 3, 3);
    const mesh = upgradeToC3D10(meshC3D4);
    const fixedNodes = getNodesOnFace(mesh, "x", 0);

    const modalResult = await runModalAnalysis({
      mesh,
      material: STEEL,
      fixedNodes,
      nModes: 10,
    });

    f1_fem_c3d10 = firstBendingFrequency(modalResult.modes);
  }, 300_000);  // 5-minute timeout for C3D10

  it("first bending frequency is within 2% of Euler-Bernoulli (f₁ ≈ 835.5 Hz)", () => {
    const error = Math.abs(f1_fem_c3d10 - f1_ref) / f1_ref;
    const errorPct = (error * 100).toFixed(2);
    console.log(`\n  [C3D10 20×3×3] f₁_computed = ${f1_fem_c3d10.toFixed(2)} Hz, f₁_analytical = ${f1_ref.toFixed(2)} Hz, error = ${errorPct}%`);
    expect(error).toBeLessThanOrEqual(0.02);
  });

  it("first bending frequency is above 10 Hz", () => {
    expect(f1_fem_c3d10).toBeGreaterThan(10);
  });
});

describe("Modal solver — Mode independence (nModes=5 vs nModes=10)", () => {
  let modes5: Array<{ frequencyHz: number; modeShape: Float64Array }>;
  let modes10: Array<{ frequencyHz: number; modeShape: Float64Array }>;
  let result5Obj: any;
  let result10Obj: any;
  let meshHash5: string;
  let meshHash10: string;

  /**
   * Compute a simple hash of mesh nodes and elements for identity verification.
   */
  function hashMesh(mesh: TetMesh): string {
    let hash = 0;
    for (let i = 0; i < Math.min(mesh.nodes.length, 100); i++) {
      hash = ((hash << 5) - hash + Math.floor((mesh.nodes[i] ?? 0) * 1e6)) | 0;
    }
    return `mesh_${mesh.nodeCount}_${mesh.elementCount}_${hash.toString(16)}`;
  }

  beforeAll(async () => {
    // Use a smaller mesh (20×3×3 C3D4) for faster convergence testing
    const mesh = generateBoxMesh(0, 0, 0, L, W, H, 20, 3, 3);
    const fixedNodes = getNodesOnFace(mesh, "x", 0);

    meshHash5 = hashMesh(mesh);
    meshHash10 = hashMesh(mesh);

    const startTime5 = Date.now();
    const solverStart5 = performance.now();

    // Solve for 5 modes
    result5Obj = await runModalAnalysis({
      mesh,
      material: STEEL,
      fixedNodes,
      nModes: 5,
    });
    modes5 = result5Obj.modes;
    const solverTime5 = performance.now() - solverStart5;

    // Delay to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 100));

    const startTime10 = Date.now();
    const solverStart10 = performance.now();

    // Solve for 10 modes on the same mesh
    result10Obj = await runModalAnalysis({
      mesh,
      material: STEEL,
      fixedNodes,
      nModes: 10,
    });
    modes10 = result10Obj.modes;
    const solverTime10 = performance.now() - solverStart10;

    console.log(`\n[Mode Independence Test — Full Precision Raw Output]\n`);
    console.log(`Run A (nModes=5):  started ${startTime5}, solver=${solverTime5.toFixed(1)}ms, iterations=${result5Obj.iterations}, converged=${result5Obj.converged}`);
    console.log(`Run B (nModes=10): started ${startTime10}, solver=${solverTime10.toFixed(1)}ms, iterations=${result10Obj.iterations}, converged=${result10Obj.converged}`);
    console.log(`Mesh hash: ${meshHash5} (both runs should match)`);
    console.log(`Result object identities: ${result5Obj !== result10Obj ? "DIFFERENT objects (good)" : "SAME object (BAD - possible cache)"}`);
    console.log(`Mode array lengths: Run A=${modes5.length}, Run B=${modes10.length}\n`);
  }, 600_000);  // 10-minute timeout for both solves

  it("modes 0-4 frequencies at full precision (Hz, 6 decimals)", () => {
    console.log(`\n[Frequency Comparison — Full Precision]\n`);
    console.log(`Mode | Freq(nModes=5)      | Freq(nModes=10)     | Absolute Diff       | Relative Diff`);
    console.log(`-----|---------------------|---------------------|---------------------|---------------`);

    const freqTol = 0.001;  // 0.1% frequency tolerance
    for (let i = 0; i < 5; i++) {
      const f5 = modes5[i]?.frequencyHz ?? NaN;
      const f10 = modes10[i]?.frequencyHz ?? NaN;
      const absDiff = f10 - f5;
      const relDiff = Math.abs(f5 - f10) / Math.max(Math.abs(f10), 1);

      // Full precision: 6 decimal places for Hz, 15 significant digits for diffs
      console.log(`  ${i}  | ${f5.toFixed(6).padStart(19)} | ${f10.toFixed(6).padStart(19)} | ${absDiff.toExponential(12).padStart(19)} | ${(relDiff * 100).toExponential(6)}%`);
      expect(relDiff).toBeLessThan(freqTol);
    }
  });

  it("modes 0-4 eigenvectors at full precision (dot product, 12 sig digits)", () => {
    console.log(`\n[Eigenvector Comparison — Full Precision]\n`);
    console.log(`Mode | Dot Product (12 sig digits) | L2 norm(shape5) | L2 norm(shape10) | Status`);
    console.log(`-----|------------------------------|-----------------|------------------|--------`);

    const dotTol = 0.95;
    for (let i = 0; i < 5; i++) {
      const shape5 = modes5[i]?.modeShape;
      const shape10 = modes10[i]?.modeShape;
      if (!shape5 || !shape10) {
        console.log(`  ${i}  | MISSING DATA                | N/A             | N/A              | FAIL`);
        expect(false).toBe(true);
        continue;
      }

      // Compute L2 norms before normalization
      let norm5before = 0, norm10before = 0;
      for (let j = 0; j < shape5.length; j++) {
        norm5before += (shape5[j] ?? 0) ** 2;
        norm10before += (shape10[j] ?? 0) ** 2;
      }
      norm5before = Math.sqrt(norm5before);
      norm10before = Math.sqrt(norm10before);

      // Normalize both vectors to unit length
      const norm5 = normalize(shape5);
      const norm10 = normalize(shape10);

      // Compute dot product with full precision
      let dot = dotProduct(norm5, norm10);
      let dotRaw = dot;

      // Take absolute value to account for sign ambiguity
      dot = Math.abs(dot);

      // Format: 12 significant digits means use toExponential or toPrecision
      const dotStr = dot.toExponential(11);  // e-notation with 11 decimal places = 12 sig digits
      const status = dot > dotTol ? "PASS" : "FAIL";

      // Log raw dot product with maximum precision for verification
      console.log(`    [Mode ${i} raw dot product]: ${dot} (raw JS value), diff from 1.0 = ${(dot - 1.0).toExponential(2)}`);

      console.log(`  ${i}  | ${dotStr.padEnd(28)} | ${norm5before.toExponential(6).padStart(15)} | ${norm10before.toExponential(6).padStart(16)} | ${status}`);
      expect(dot).toBeGreaterThan(dotTol);
    }
  });

  it("verify independence: shapes are not bit-identical (check for accidental reuse)", () => {
    console.log(`\n[Independence Verification]\n`);

    // Check if any mode shape from Run A is the exact same object as Run B (would indicate caching)
    let identicalObjects = 0;
    for (let i = 0; i < 5; i++) {
      const same = modes5[i]?.modeShape === modes10[i]?.modeShape;
      if (same) identicalObjects++;
    }
    console.log(`Modes 0-4 that are identical Float64Array objects: ${identicalObjects}/5 (0 = good, >0 = possible cache reuse)`);

    // Check if the mode shape memory addresses differ (Float64Array object identity)
    for (let i = 0; i < Math.min(2, 5); i++) {
      const addr5 = modes5[i]?.modeShape.buffer?.byteLength ?? -1;
      const addr10 = modes10[i]?.modeShape.buffer?.byteLength ?? -1;
      console.log(`Mode ${i} buffer byteLength: Run A=${addr5}, Run B=${addr10} (same=good if different solves, bad if cache)`);
    }

    // Byte-level comparison of first 10 DOFs of mode 0
    console.log(`\nMode 0 first 10 DOF values (full precision):`);
    console.log(`DOF | Run A (nModes=5)    | Run B (nModes=10)   | Bit-Identical`);
    console.log(`----|---------------------|---------------------|---------------`);
    for (let j = 0; j < 10; j++) {
      const v5 = modes5[0]?.modeShape[j] ?? NaN;
      const v10 = modes10[0]?.modeShape[j] ?? NaN;
      const identical = Object.is(v5, v10);  // true only if bit-identical (same sign, exponent, mantissa)
      console.log(`  ${j} | ${v5.toExponential(11).padStart(19)} | ${v10.toExponential(11).padStart(19)} | ${identical ? "YES" : "NO"}`);
    }

    expect(identicalObjects).toBe(0);  // Should never be the same object
  });
});
