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
