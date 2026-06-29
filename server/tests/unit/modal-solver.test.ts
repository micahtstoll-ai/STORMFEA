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
    expect(error).toBeLessThanOrEqual(0.02);
  });

  it("first bending frequency is above 10 Hz", () => {
    expect(f1_fem_c3d10).toBeGreaterThan(10);
  });
});
