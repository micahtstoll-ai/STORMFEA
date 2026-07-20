/**
 * singularity-detection.test.ts
 * -----------------------------
 * Issue #148: the stress-singularity heuristic used to key on an ABSOLUTE 1mm
 * neighborhood radius and a 3.0× peak/neighborhood ratio. The absolute radius
 * is scale-dependent: on a 5mm part 1mm spanned much of the geometry (false
 * positives), and on a 500mm part 1mm was sub-element (missed entirely). The
 * fix scales the neighborhood radius to the LOCAL element size at the peak
 * (SINGULARITY_NEIGHBORHOOD_FACTOR × median incident edge length), which makes
 * the classification identical for the same geometry at any scale.
 *
 * The core assertion here: the SAME mesh + stress field, uniformly scaled by
 * 100×, must classify identically (detected, ratio, confidence, evidence). It
 * also checks the linear scaling of the local-size helper, the peakLocation
 * payload, and that a smooth (non-singular) field is not flagged.
 */

import { describe, it, expect } from "vitest";
import {
  detectSingularity,
  localEdgeLengthAtPeak,
  SINGULARITY_NEIGHBORHOOD_FACTOR,
} from "../../analysis.js";

// ── Build a small triangulated square patch in the z=0 plane ──────────────────
// A regular (N+1)×(N+1) grid of points spaced `h` mm apart, split into two
// triangles per cell, emitted in DISPLAY-MESH form (9 floats per triangle, 3
// consecutive vertices — shared corners are duplicated per triangle, exactly as
// an STL surface mesh stores them). `stressAt(gx, gy)` supplies the per-grid-
// point von Mises value; every display vertex inherits its grid point's value
// (mirrors the client's coincident-vertex welding).
function buildPatch(
  N: number,
  h: number,
  stressAt: (gx: number, gy: number) => number,
): { positions: Float32Array; stress: Float32Array } {
  const tris: number[] = [];
  const str: number[] = [];
  const push = (gx: number, gy: number): void => {
    tris.push(gx * h, gy * h, 0);
    str.push(stressAt(gx, gy));
  };
  for (let gy = 0; gy < N; gy++) {
    for (let gx = 0; gx < N; gx++) {
      // triangle 1: (gx,gy) (gx+1,gy) (gx,gy+1)
      push(gx, gy); push(gx + 1, gy); push(gx, gy + 1);
      // triangle 2: (gx+1,gy) (gx+1,gy+1) (gx,gy+1)
      push(gx + 1, gy); push(gx + 1, gy + 1); push(gx, gy + 1);
    }
  }
  return { positions: new Float32Array(tris), stress: new Float32Array(str) };
}

// A sharp point spike at the grid centre, everything else at a low background.
// N even so (N/2, N/2) is an interior grid node with a full ring of neighbours.
const N = 8;
const CENTER = N / 2;
const spike = (gx: number, gy: number): number =>
  gx === CENTER && gy === CENTER ? 120 : 10;

describe("scale-invariant singularity detection (issue #148)", () => {
  it("flags the point spike as a singularity at 1× scale", () => {
    const { positions, stress } = buildPatch(N, 1.0, spike);
    const w = detectSingularity(stress, positions);
    expect(w).not.toBeNull();
    expect(w!.detected).toBe(true);
    // 120 vs 10 background → ratio ≈ 12, comfortably > 3 and > 6 (high conf)
    expect(w!.concentrationRatio).toBeGreaterThan(3);
    expect(w!.confidence).toBe("high");
    expect(w!.evidence).toBe("single-mesh-heuristic");
    // radius must be the element-relative one, not a hard 1mm
    expect(w!.neighborhoodRadiusMm).toBeCloseTo(SINGULARITY_NEIGHBORHOOD_FACTOR * w!.localElementSizeMm, 6);
    // peak sits at the grid centre (CENTER, CENTER, 0)
    expect(w!.peakLocation[0]).toBeCloseTo(CENTER, 6);
    expect(w!.peakLocation[1]).toBeCloseTo(CENTER, 6);
    expect(w!.peakLocation[2]).toBeCloseTo(0, 6);
  });

  it("classifies IDENTICALLY for the same geometry scaled 100× (the whole point)", () => {
    const small = buildPatch(N, 1.0, spike);
    const big   = buildPatch(N, 100.0, spike);   // 5mm-ish part vs 500mm-ish part
    const ws = detectSingularity(small.stress, small.positions);
    const wb = detectSingularity(big.stress, big.positions);

    expect(ws).not.toBeNull();
    expect(wb).not.toBeNull();
    // Same decision, same confidence, same evidence class
    expect(wb!.detected).toBe(ws!.detected);
    expect(wb!.confidence).toBe(ws!.confidence);
    expect(wb!.evidence).toBe(ws!.evidence);
    // The dimensionless ratio is invariant; the neighbour COUNT (hence the
    // averaged value) must be identical — that is exactly what the absolute-1mm
    // radius broke.
    expect(wb!.concentrationRatio).toBeCloseTo(ws!.concentrationRatio, 6);
    expect(wb!.stressAt1mmMPa).toBeCloseTo(ws!.stressAt1mmMPa, 6);
    // Geometric quantities scale linearly by 100×.
    expect(wb!.localElementSizeMm).toBeCloseTo(ws!.localElementSizeMm * 100, 4);
    expect(wb!.neighborhoodRadiusMm).toBeCloseTo(ws!.neighborhoodRadiusMm * 100, 4);
    expect(wb!.peakLocation[0]).toBeCloseTo(ws!.peakLocation[0] * 100, 4);
  });

  it("does NOT flag a smooth (linear-gradient) stress field", () => {
    // Gentle ramp: no vertex is >3× its neighbourhood, so no singularity.
    const smooth = (gx: number, gy: number): number => 20 + gx * 2 + gy * 2;
    const { positions, stress } = buildPatch(N, 1.0, smooth);
    expect(detectSingularity(stress, positions)).toBeNull();
  });

  it("localEdgeLengthAtPeak scales linearly and is the local grid pitch", () => {
    const small = buildPatch(N, 1.0, spike);
    const big   = buildPatch(N, 100.0, spike);
    // peak display-vertex index is the same for both (same connectivity/stress)
    let pk = 0, pv = 0;
    for (let i = 0; i < small.stress.length; i++) {
      if (small.stress[i]! > pv) { pv = small.stress[i]!; pk = i; }
    }
    const hSmall = localEdgeLengthAtPeak(small.positions, pk);
    const hBig   = localEdgeLengthAtPeak(big.positions, pk);
    expect(hSmall).toBeGreaterThan(0);
    expect(hBig).toBeCloseTo(hSmall * 100, 4);
    // median incident edge length on a unit grid is 1 (axis edges) — hypotenuse
    // edges are √2, but they are the minority, so the median is 1.0.
    expect(hSmall).toBeCloseTo(1.0, 6);
  });

  it("returns null for trivial (near-zero) stress", () => {
    const { positions, stress } = buildPatch(N, 1.0, () => 0.01);
    expect(detectSingularity(stress, positions)).toBeNull();
  });
});
