/**
 * cosine-bearing-normalization.test.ts
 * -------------------------------------
 * Verifies the normalization invariant of the cosine-bearing load distribution
 * from PR #42 (analysis.ts lines 1763–1816).
 *
 * The normalization algebra from the code:
 *   weights[i] = max(0, cos(θ_i))
 *   wSum       = Σ weights[i]
 *   wScale     = k / wSum        (k = node count)
 *   w_i        = weights[i] * wScale / k = weights[i] / wSum
 *   applied    = [fx * w_i, fy * w_i, fz * w_i]
 *
 * Invariant: Σ w_i = (1/wSum) Σ weights[i] = wSum/wSum = 1, so total applied
 * force exactly equals [fx, fy, fz] = f.magnitude in the specified direction.
 *
 * Infrastructure note (Phase 2 Batch D audit):
 * No prior test verified this normalization. The algebra is straightforward
 * but the intermediate wScale = k/wSum step with subsequent /k cancellation
 * is non-obvious enough that an explicit check adds value.
 *
 * This file is self-contained — it replicates the normalization logic from
 * analysis.ts in isolation so no production-path refactoring is needed.
 */

import { describe, it, expect } from "vitest";

// ─── Inline replica of the cosine-bearing normalization logic ──────────────────
// This mirrors analysis.ts lines 1781–1815 exactly.
function applyCosineDistribution(
  faceNodePositions: Array<[number, number, number]>,
  holeCenterX: number,
  holeCenterY: number,
  holeCenterZ: number,
  forceDir: [number, number, number],   // unit vector
  magnitude: number,
): Array<[number, number, number]> {
  const [dx, dy, dz] = forceDir;
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
  const fx = dx/len * magnitude;
  const fy = dy/len * magnitude;
  const fz = dz/len * magnitude;

  const k = faceNodePositions.length;
  const weights = faceNodePositions.map(([nx, ny, nz]) => {
    const rx = nx - holeCenterX;
    const ry = ny - holeCenterY;
    const rz = nz - holeCenterZ;
    const dotProduct = rx*(dx/len) + ry*(dy/len) + rz*(dz/len);
    const rMag = Math.sqrt(rx*rx + ry*ry + rz*rz) || 1e-6;
    const cosTheta = dotProduct / rMag;
    return Math.max(0, cosTheta);
  });

  const wSum = weights.reduce((a, b) => a + b, 0);
  if (wSum < 1e-12) {
    // Edge case: no nodes face the force direction — distribute uniformly
    return faceNodePositions.map(() => [fx/k, fy/k, fz/k]);
  }
  const wScale = k / wSum;  // as in analysis.ts line 1807

  return faceNodePositions.map((_, i) => {
    const w = (weights[i]! * wScale) / k;  // = weights[i] / wSum
    return [fx * w, fy * w, fz * w];
  });
}

// ─── Helper: sum the total force components ────────────────────────────────────
function sumForces(forces: Array<[number, number, number]>): [number, number, number] {
  return forces.reduce(
    ([ax, ay, az], [fx, fy, fz]) => [ax+fx, ay+fy, az+fz],
    [0, 0, 0],
  );
}

// ─── Test group 1: Normalization invariant ─────────────────────────────────────
describe("Cosine bearing: total force equals input magnitude", () => {
  // Arrange: 8 nodes on a circle in the XY plane, centered at origin, hole at origin.
  // Force direction: +X. Nodes at angles [0°, 45°, 90°, 135°, 180°, 225°, 270°, 315°].
  // cos(θ) for each: [1, 0.707, 0, -0.707, -1, -0.707, 0, 0.707]
  // Positive half: nodes at 0°, 45°, 315° → weights [1, 0.707, 0.707]
  // Nodes at 90° and 270°: cos=0 → weight=0, clamped to 0
  // Nodes at 135°, 180°, 225°: cos < 0 → weight=0
  const R = 5;  // mm radius
  const angles = [0, 45, 90, 135, 180, 225, 270, 315].map(d => d * Math.PI / 180);
  const circleNodes: Array<[number, number, number]> = angles.map(a => [
    R * Math.cos(a), R * Math.sin(a), 0,
  ]);

  it("circular ring of nodes, force in +X: total force = [F, 0, 0]", () => {
    const F = 500;  // N
    const forces = applyCosineDistribution(circleNodes, 0, 0, 0, [1, 0, 0], F);
    const [Fx, Fy, Fz] = sumForces(forces);
    expect(Fx).toBeCloseTo(F, 6);
    expect(Fy).toBeCloseTo(0, 10);
    expect(Fz).toBeCloseTo(0, 10);
  });

  it("circular ring of nodes, force in +Y: total force = [0, F, 0]", () => {
    const F = 300;
    const forces = applyCosineDistribution(circleNodes, 0, 0, 0, [0, 1, 0], F);
    const [Fx, Fy, Fz] = sumForces(forces);
    expect(Fx).toBeCloseTo(0, 10);
    expect(Fy).toBeCloseTo(F, 6);
    expect(Fz).toBeCloseTo(0, 10);
  });

  it("circular ring, diagonal force [1,1,0]: total force magnitude preserved", () => {
    const F = 400;
    const forces = applyCosineDistribution(circleNodes, 0, 0, 0, [1, 1, 0], F);
    const [Fx, Fy, Fz] = sumForces(forces);
    const totMag = Math.sqrt(Fx*Fx + Fy*Fy + Fz*Fz);
    expect(totMag).toBeCloseTo(F, 6);
  });

  it("all nodes behind the force (cos≤0 for all): wSum=0 falls back to uniform", () => {
    // Force in +X, nodes all at negative-X side (angles 90°–270°)
    const backNodes: Array<[number, number, number]> = [
      [-R, 0, 0], [-R, R, 0], [-R, -R, 0],
    ];
    const F = 100;
    const forces = applyCosineDistribution(backNodes, 0, 0, 0, [1, 0, 0], F);
    const [Fx, Fy, Fz] = sumForces(forces);
    // Falls back to uniform (wSum ≈ 0) — still total force = F
    expect(Math.abs(Fx)).toBeCloseTo(F, 6);
    expect(Fy).toBeCloseTo(0, 10);
    expect(Fz).toBeCloseTo(0, 10);
  });
});

// ─── Test group 2: Distribution shape ────────────────────────────────────────────
describe("Cosine bearing: force concentrated on bearing face", () => {
  const R = 5;
  const angles = [0, 45, 90, 135, 180, 225, 270, 315].map(d => d * Math.PI / 180);
  const circleNodes: Array<[number, number, number]> = angles.map(a => [
    R * Math.cos(a), R * Math.sin(a), 0,
  ]);

  it("node at 0° (directly facing force) receives highest per-node force", () => {
    const F = 500;
    const forces = applyCosineDistribution(circleNodes, 0, 0, 0, [1, 0, 0], F);
    const mags = forces.map(([fx, fy, fz]) => Math.sqrt(fx*fx+fy*fy+fz*fz));
    const maxMag = Math.max(...mags);
    // Node at 0° should have highest force (cos(0°) = 1 = maximum)
    expect(mags[0]!).toBeCloseTo(maxMag, 6);
  });

  it("nodes at 135°, 180°, 225° receive zero force (cos < 0, clamped)", () => {
    const F = 500;
    const forces = applyCosineDistribution(circleNodes, 0, 0, 0, [1, 0, 0], F);
    // Angles 135°, 180°, 225° are at indices 3, 4, 5
    expect(forces[3]![0]).toBeCloseTo(0, 10);
    expect(forces[4]![0]).toBeCloseTo(0, 10);
    expect(forces[5]![0]).toBeCloseTo(0, 10);
  });

  it("uniform distribution (each node = F/N) is recovered when all cos(θ) are equal", () => {
    // If all nodes are at cos(θ) = 1 (all facing the force), distribute uniformly
    const facingNodes: Array<[number, number, number]> = [
      [R, 0, 0], [R, 0.01, 0], [R, -0.01, 0],  // near-coincident with force direction
    ];
    const F = 300;
    const forces = applyCosineDistribution(facingNodes, 0, 0, 0, [1, 0, 0], F);
    const mags = forces.map(([fx]) => Math.abs(fx));
    // All roughly equal (within small angle approximation)
    expect(mags[0]!).toBeCloseTo(mags[1]!, 1);
    expect(mags[0]!).toBeCloseTo(mags[2]!, 1);
  });
});

// ─── Test group 3: wScale intermediate variable consistency ─────────────────────
describe("Cosine bearing: algebraic simplification consistency", () => {
  it("wScale = k/wSum then divide by k is equivalent to weights[i]/wSum", () => {
    // The code uses: w = (weights[i] * wScale) / k where wScale = k/wSum
    // This simplifies to w = weights[i]/wSum. Verify both paths agree.
    const nodePositions: Array<[number, number, number]> = [
      [5, 0, 0], [3.5, 3.5, 0], [0, 5, 0], [-3.5, 3.5, 0],
    ];
    const F = 200;
    const forces = applyCosineDistribution(nodePositions, 0, 0, 0, [1, 0, 0], F);

    // Verify via direct computation
    const dx = 1, dy = 0, dz = 0;
    const weights = nodePositions.map(([nx, ny, nz]) => {
      const rx = nx, ry = ny, rz = nz;
      const dot = rx*dx + ry*dy + rz*dz;
      const rMag = Math.sqrt(rx*rx+ry*ry+rz*rz) || 1e-6;
      return Math.max(0, dot/rMag);
    });
    const wSum = weights.reduce((a,b) => a+b, 0);
    const expected = weights.map(w => [F * w / wSum, 0, 0] as [number,number,number]);

    forces.forEach((f, i) => {
      expect(f[0]).toBeCloseTo(expected[i]![0], 8);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Analytical benchmark against the ACTUAL implementation (issue #63)
// ───────────────────────────────────────────────────────────────────────────────
// The groups above test a replica of the normalization algebra. The groups
// below call computeCosineBearingForces — the real production code, extracted
// (behavior-preserving) from the cosine_bearing branch of analyse() in
// server/analysis.ts — and check it against hand-calculated nodal forces.
// ═══════════════════════════════════════════════════════════════════════════════

import { computeCosineBearingForces } from "../../analysis.js";

/**
 * Build a packed node-coordinate array for a ring of nodes in the XY plane.
 * Two dummy nodes are prepended so faceNodes indices are offset from 0 —
 * this exercises the `nodes[n*3]` indexing of the real implementation.
 */
function buildRing(radius: number, angleDeg: number[]): { nodes: Float64Array; faceNodes: number[] } {
  const DUMMIES = 2;
  const nodes = new Float64Array((angleDeg.length + DUMMIES) * 3);
  nodes.set([999, 999, 999, -999, -999, -999], 0);  // dummy nodes 0 and 1
  const faceNodes: number[] = [];
  // Snap |v| < 1e-9 to exactly 0 so that e.g. cos(90°) is exactly 0 rather
  // than 6.1e-17 — keeps the θ=±90° zero-force check exact.
  const snap = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  for (let i = 0; i < angleDeg.length; i++) {
    const a = (angleDeg[i]! * Math.PI) / 180;
    const n = i + DUMMIES;
    nodes[n*3]   = snap(radius * Math.cos(a));
    nodes[n*3+1] = snap(radius * Math.sin(a));
    nodes[n*3+2] = 0;
    faceNodes.push(n);
  }
  return { nodes, faceNodes };
}

describe("computeCosineBearingForces (actual implementation): hand-calculated ring", () => {
  // ─── Setup ────────────────────────────────────────────────────────────────
  // 8 nodes on a 10 mm circle around a bolt hole centred at the origin,
  // at 45° increments. Applied load: 100 N in +X (the bolt bears on the
  // hole wall at the θ = 0° node).
  //
  // Hand calculation:
  //   weight w(θ) = max(0, cos θ) measured from the +X force direction:
  //     θ =   0°  → cos = 1
  //     θ = ±45°  → cos = √2/2      = 0.7071067812
  //     θ = ±90°  → cos = 0          (edge of bearing contact)
  //     θ = 135°, 180°, 225° → cos < 0 → clamped to 0 (no tension transfer)
  //   wSum = 1 + 2·(√2/2) = 1 + √2 = 2.4142135624
  //   Nodal force magnitudes (all directed along +X):
  //     F(0°)   = 100·1/(1+√2)      = 100·(√2−1)   = 41.4213562373 N
  //     F(±45°) = 100·(√2/2)/(1+√2) = 100·(2−√2)/2 = 29.2893218813 N
  //     F(±90°) and all rear nodes  = 0 N
  //   Vector sum: 41.4213562 + 2×29.2893219 = 100.0000000 N in +X exactly.
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  const { nodes, faceNodes } = buildRing(10, angles);
  const F = 100;
  const { nodalForces, peakNodalForce } = computeCosineBearingForces(
    nodes, faceNodes,
    0, 0, 0,        // hole centre
    1, 0, 0,        // unit force direction (+X)
    F, 0, 0,        // total force components
  );

  it("vector sum of nodal forces equals the applied load [100, 0, 0] N", () => {
    let sx = 0, sy = 0, sz = 0;
    for (const [fx, fy, fz] of nodalForces) { sx += fx; sy += fy; sz += fz; }
    expect(sx).toBeCloseTo(F, 9);
    expect(sy).toBeCloseTo(0, 12);
    expect(sz).toBeCloseTo(0, 12);
  });

  it("contact-point node (θ=0°) carries 100(√2−1) = 41.4213562373 N (the peak)", () => {
    expect(nodalForces[0]![0]).toBeCloseTo(41.4213562373, 8);
    expect(nodalForces[0]![1]).toBe(0);
    expect(nodalForces[0]![2]).toBe(0);
    expect(peakNodalForce).toBeCloseTo(41.4213562373, 8);
  });

  it("θ=±45° nodes carry 100(2−√2)/2 = 29.2893218813 N each", () => {
    expect(nodalForces[1]![0]).toBeCloseTo(29.2893218813, 8);  // +45°
    expect(nodalForces[7]![0]).toBeCloseTo(29.2893218813, 8);  // −45° (315°)
  });

  it("follows the cosine distribution: F(45°)/F(0°) = cos 45° = 0.7071067812", () => {
    expect(nodalForces[1]![0] / nodalForces[0]![0]).toBeCloseTo(Math.SQRT1_2, 10);
  });

  it("nodes at ±90° receive exactly zero force", () => {
    expect(nodalForces[2]![0]).toBe(0);  //  90°
    expect(nodalForces[6]![0]).toBe(0);  // 270°
  });

  it("nodes behind the contact point (135°, 180°, 225°) receive exactly zero force", () => {
    for (const idx of [3, 4, 5]) {
      expect(nodalForces[idx]![0]).toBe(0);
      expect(nodalForces[idx]![1]).toBe(0);
      expect(nodalForces[idx]![2]).toBe(0);
    }
  });
});

describe("computeCosineBearingForces: asymmetric quarter-arc hand calculation", () => {
  // Nodes only at θ = 0°, 30°, 60°, 90° (radius 10 mm), load 100 N in +X.
  //
  // Hand calculation:
  //   weights: cos 0° = 1, cos 30° = √3/2 = 0.8660254038, cos 60° = 0.5,
  //            cos 90° = 0
  //   wSum = 1 + 0.8660254038 + 0.5 + 0 = 2.3660254038
  //   F(0°)  = 100·1/2.3660254038          = 42.2649730810 N
  //   F(30°) = 100·0.8660254038/2.3660254038 = 36.6025403784 N
  //   F(60°) = 100·0.5/2.3660254038        = 21.1324865405 N
  //   F(90°) = 0
  //   Check: 42.2649731 + 36.6025404 + 21.1324865 + 0 = 100.0000000 N ✓
  const { nodes, faceNodes } = buildRing(10, [0, 30, 60, 90]);
  const { nodalForces } = computeCosineBearingForces(
    nodes, faceNodes, 0, 0, 0, 1, 0, 0, 100, 0, 0,
  );

  it("per-node forces match the hand calculation", () => {
    expect(nodalForces[0]![0]).toBeCloseTo(42.2649730810, 8);
    expect(nodalForces[1]![0]).toBeCloseTo(36.6025403784, 8);
    expect(nodalForces[2]![0]).toBeCloseTo(21.1324865405, 8);
    expect(nodalForces[3]![0]).toBe(0);
  });

  it("vector sum still equals the applied load despite the asymmetric node set", () => {
    const sx = nodalForces.reduce((s, f) => s + f[0], 0);
    expect(sx).toBeCloseTo(100, 9);
  });
});

describe("computeCosineBearingForces: off-axis load direction", () => {
  // Full 8-node ring, load 250 N in direction (0.6, 0.8, 0) — already a unit
  // vector (0.36 + 0.64 = 1). Force components: fx = 150 N, fy = 200 N.
  // The force direction points at atan2(0.8, 0.6) = 53.13°, so the nearest
  // ring node is the one at 45° — it must carry the peak nodal force.
  //   cos θ for node at 45°: cos(45° − 53.13°) = cos45·0.6 + sin45·0.8
  //                        = (√2/2)(1.4) = 0.9899494937 (largest weight)
  const angles = [0, 45, 90, 135, 180, 225, 270, 315];
  const { nodes, faceNodes } = buildRing(10, angles);
  const { nodalForces, peakNodalForce } = computeCosineBearingForces(
    nodes, faceNodes, 0, 0, 0, 0.6, 0.8, 0, 150, 200, 0,
  );

  it("vector sum equals the applied load (150, 200, 0) N", () => {
    let sx = 0, sy = 0, sz = 0;
    for (const [fx, fy, fz] of nodalForces) { sx += fx; sy += fy; sz += fz; }
    expect(sx).toBeCloseTo(150, 9);
    expect(sy).toBeCloseTo(200, 9);
    expect(sz).toBeCloseTo(0, 12);
  });

  it("peak nodal force is at the 45° node (closest to the 53.13° load direction)", () => {
    const mags = nodalForces.map(([fx, fy, fz]) => Math.hypot(fx, fy, fz));
    const maxIdx = mags.indexOf(Math.max(...mags));
    expect(maxIdx).toBe(1);
    expect(peakNodalForce).toBeCloseTo(mags[1]!, 12);
  });

  it("every nodal force is parallel to the applied force direction", () => {
    for (const [fx, fy, fz] of nodalForces) {
      if (fx === 0 && fy === 0) continue;   // zero-weight nodes
      expect(fy / fx).toBeCloseTo(200 / 150, 10);
      expect(fz).toBe(0);
    }
  });
});

describe("computeCosineBearingForces: uniform fallback when no node faces the load", () => {
  // Nodes only at θ = 90°, 180°, 270° (radius 10 mm), load 100 N in +X.
  // Every weight is max(0, cos θ) = 0, so wSum = 0. Without the fallback this
  // divides by zero and every nodal force is NaN; with it, the load is
  // distributed uniformly: 100/3 = 33.3333333333 N per node in +X.
  const { nodes, faceNodes } = buildRing(10, [90, 180, 270]);
  const { nodalForces, peakNodalForce } = computeCosineBearingForces(
    nodes, faceNodes, 0, 0, 0, 1, 0, 0, 100, 0, 0,
  );

  it("produces finite, uniform forces of F/N per node", () => {
    for (const [fx, fy, fz] of nodalForces) {
      expect(fx).toBeCloseTo(100 / 3, 9);
      expect(fy).toBe(0);
      expect(fz).toBe(0);
    }
    expect(peakNodalForce).toBeCloseTo(100 / 3, 9);
  });

  it("vector sum still equals the applied load", () => {
    const sx = nodalForces.reduce((s, f) => s + f[0], 0);
    expect(sx).toBeCloseTo(100, 9);
  });
});
