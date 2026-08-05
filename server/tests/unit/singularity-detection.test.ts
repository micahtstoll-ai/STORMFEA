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
 *
 * Issue #257 adds the other half of that invariance. #148 made the decision
 * independent of LENGTH scale; the detector still gated on `peakVal > 50` MPa,
 * a hardcoded "2× yield" for PLA, which made it depend on LOAD scale instead.
 * Measured: an identical field with a 12× concentration ratio was flagged at
 * 51 MPa and silent at 50 — so the same part, same mesh, same geometry gained
 * its warning by scaling the applied force. That is why `singularity` was null
 * on every run of the bolt-constrained Ø5-bore tube (peak 5.5–8.0 MPa), and it
 * silenced BC-edge and sharp-corner singularities alike. The gate is gone; the
 * yield comparison survives as `nearYield`, which changes wording only.
 *
 * #257 also splits the REMEDY by cause: a rigid clamp over part of a surface is
 * singular where the patch stops, and "add a fillet" is useless advice there.
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

// ── Issue #257: invariance in the LOAD dimension ─────────────────────────────
describe("singularity detection is independent of load magnitude (issue #257)", () => {
  /** Same 12× concentration shape at any peak magnitude. */
  const shapeAt = (peak: number) => (gx: number, gy: number): number =>
    gx === CENTER && gy === CENTER ? peak : peak / 12;

  it("classifies IDENTICALLY for the same field scaled in MAGNITUDE", () => {
    // 120 MPa was flagged before this fix; 8 MPa — the Ø5-bore tube's actual
    // peak — was not, despite being the same field times a constant.
    const hi = buildPatch(N, 1.0, shapeAt(120));
    const lo = buildPatch(N, 1.0, shapeAt(8));
    const wHi = detectSingularity(hi.stress, hi.positions);
    const wLo = detectSingularity(lo.stress, lo.positions);

    expect(wHi).not.toBeNull();
    expect(wLo).not.toBeNull();
    expect(wLo!.detected).toBe(wHi!.detected);
    expect(wLo!.confidence).toBe(wHi!.confidence);
    // The ratio is the scale-free quantity, so it must be untouched by the scaling.
    expect(wLo!.concentrationRatio).toBeCloseTo(wHi!.concentrationRatio, 6);
  });

  it("no longer has a cliff at the old hardcoded 50 MPa gate", () => {
    // The exact failure: 50 -> null, 51 -> detected, on one identical shape.
    for (const peak of [8, 20, 40, 50, 51, 120]) {
      const p = buildPatch(N, 1.0, shapeAt(peak));
      expect(detectSingularity(p.stress, p.positions), `peak ${peak} MPa`).not.toBeNull();
    }
  });

  it("reports nearYield as WORDING only, never as suppression", () => {
    const p = buildPatch(N, 1.0, shapeAt(8));
    // Well under yield: still detected, but flagged as not verdict-critical.
    const low = detectSingularity(p.stress, p.positions, { yieldMPa: 50 });
    expect(low).not.toBeNull();
    expect(low!.nearYield).toBe(false);
    // Same field, weaker material: same detection, different wording.
    const high = detectSingularity(p.stress, p.positions, { yieldMPa: 4 });
    expect(high).not.toBeNull();
    expect(high!.nearYield).toBe(true);
    expect(high!.detected).toBe(low!.detected);
    expect(high!.concentrationRatio).toBeCloseTo(low!.concentrationRatio, 6);
  });
});

// ── Issue #263: reporting a measurement vs raising an alarm ───────────────────
describe("the ratio is a measurement; only a conclusive one alarms (issue #263)", () => {
  /** Concentration ratio `r` at the grid centre. */
  const atRatio = (r: number) => (gx: number, gy: number): number =>
    gx === CENTER && gy === CENTER ? 10 * r : 10;

  it("does not report at all below the reporting threshold", () => {
    const p = buildPatch(N, 1.0, atRatio(2.0));
    expect(detectSingularity(p.stress, p.positions)).toBeNull();
  });

  it("REPORTS but does not alarm in the borderline band", () => {
    // The measured cross-plate case: ratio ~3.2 against a 3.0 gate, where which
    // side a given mesh lands on is decided by noise. The payload is available
    // for diagnostics; `detected` stays false so no banner flickers.
    for (const r of [3.2, 4.0, 5.5]) {
      const p = buildPatch(N, 1.0, atRatio(r));
      const w = detectSingularity(p.stress, p.positions);
      expect(w, `ratio ${r}`).not.toBeNull();
      expect(w!.detected, `ratio ${r} must not alarm`).toBe(false);
      expect(w!.concentrationRatio).toBeGreaterThan(3);
    }
  });

  it("alarms once the ratio is conclusive on a single mesh", () => {
    for (const r of [7, 12, 40]) {
      const p = buildPatch(N, 1.0, atRatio(r));
      const w = detectSingularity(p.stress, p.positions);
      expect(w, `ratio ${r}`).not.toBeNull();
      expect(w!.detected, `ratio ${r} should alarm`).toBe(true);
    }
  });

  it("does not flicker across the range that used to straddle the gate", () => {
    // The defect in one assertion: nothing in 3.0–6.0 may alarm, so a part
    // whose ratio wanders inside that band cannot gain and lose its banner.
    const alarms = [3.1, 3.3, 3.6, 4.2, 4.9, 5.4, 5.9]
      .map(r => { const p = buildPatch(N, 1.0, atRatio(r)); return detectSingularity(p.stress, p.positions)!.detected; });
    expect(alarms.every(a => a === false)).toBe(true);
  });

  it("an isolated peak alarms regardless of the band", () => {
    // No neighbours at all is conclusive on one mesh; it is not a ratio the
    // noise can move.
    const { positions, stress } = buildPatch(N, 1.0, spike);
    const w = detectSingularity(stress, positions);
    expect(w!.detected).toBe(true);
  });
});

// ── Issue #257: the remedy must match the CAUSE ───────────────────────────────
describe("singularity cause classification (issue #257)", () => {
  const spikeField = buildPatch(N, 1.0, spike);

  it("defaults to a geometric cause and recommends a fillet", () => {
    const w = detectSingularity(spikeField.stress, spikeField.positions);
    expect(w).not.toBeNull();
    expect(w!.cause).toBe("geometry");
    expect(w!.message).toMatch(/fillet/i);
  });

  it("names the CONSTRAINT when the peak sits on a BC patch rim", () => {
    // A rim node coincident with the peak (grid centre, spacing 1mm).
    const rim = Float64Array.from([CENTER, CENTER, 0]);
    const w = detectSingularity(spikeField.stress, spikeField.positions, { bcRimPoints: rim });
    expect(w).not.toBeNull();
    expect(w!.cause).toBe("constraint-edge");
    // Fillet advice is WRONG here — that was the substance of the complaint.
    expect(w!.message).not.toMatch(/fillet/i);
    expect(w!.message).toMatch(/bolt|clamp|constraint/i);
  });

  it("stays geometric when the BC rim is far from the peak", () => {
    // Same field, rim placed well outside the sampling neighborhood.
    const rim = Float64Array.from([100, 100, 100]);
    const w = detectSingularity(spikeField.stress, spikeField.positions, { bcRimPoints: rim });
    expect(w).not.toBeNull();
    expect(w!.cause).toBe("geometry");
  });

  it("names the LOAD when the peak sits on a loaded rim, and does not blame the bolt", () => {
    const rim = Float64Array.from([CENTER, CENTER, 0]);
    const w = detectSingularity(spikeField.stress, spikeField.positions, { loadRimPoints: rim });
    expect(w).not.toBeNull();
    expect(w!.cause).toBe("load-edge");
    expect(w!.message).not.toMatch(/fillet/i);
    // Telling the user to reconsider their BOLT for a loaded-edge singularity is
    // as wrong as telling them to add a fillet.
    expect(w!.message).not.toMatch(/bolt/i);
    expect(w!.message).toMatch(/load/i);
  });

  it("attributes to the NEAREST rim when both are inside the sampling radius", () => {
    // The Ø5-bore tube case: radius 8.95mm on a part 12mm across puts both rims
    // in range, and a first-match test blamed the constraint for a peak sitting
    // exactly on the loaded node.
    const onPeak = Float64Array.from([CENTER, CENTER, 0]);
    const nearby = Float64Array.from([CENTER + 2, CENTER, 0]);

    const loadWins = detectSingularity(spikeField.stress, spikeField.positions, {
      bcRimPoints: nearby, loadRimPoints: onPeak,
    });
    expect(loadWins!.cause).toBe("load-edge");

    const bcWins = detectSingularity(spikeField.stress, spikeField.positions, {
      bcRimPoints: onPeak, loadRimPoints: nearby,
    });
    expect(bcWins!.cause).toBe("constraint-edge");
  });

  it("breaks an exact tie toward the constraint", () => {
    const same = Float64Array.from([CENTER, CENTER, 0]);
    const w = detectSingularity(spikeField.stress, spikeField.positions, {
      bcRimPoints: same, loadRimPoints: same,
    });
    expect(w!.cause).toBe("constraint-edge");
  });

  it("always explains that the peak does not converge under refinement", () => {
    // The reason the warning exists at all (issue #256): the number moves.
    for (const rim of [null, Float64Array.from([CENTER, CENTER, 0])]) {
      const w = detectSingularity(spikeField.stress, spikeField.positions, { bcRimPoints: rim });
      expect(w!.message).toMatch(/does NOT converge/i);
    }
  });
});

// ── Issue #257: guard against over-firing now the magnitude gate is gone ──────
describe("a convex 90° edge is NOT a singularity (issue #257 over-firing guard)", () => {
  /**
   * Two traction-free faces meeting at a convex 90° edge — the Ø5-bore tube's
   * outer rim. A convex wedge (material angle < 180°) is BOUNDED, not singular:
   * measured, it carries 0.2–0.4% of the error energy and does not grow under
   * refinement. The detector must not flag it. Built as an L in the x–z plane,
   * extruded along y, with the edge at x=EDGE.
   */
  function buildConvexEdge(
    n: number,
    h: number,
    stressAt: (s: number, gy: number) => number,
  ): { positions: Float32Array; stress: Float32Array } {
    // Arc-length parameter s runs up the vertical face, over the edge, and out
    // along the horizontal face, so the surface is a single strip.
    const pointAt = (s: number): [number, number] =>
      s <= n ? [n * h, (n - s) * h] : [(2 * n - s) * h, 0];
    const tris: number[] = [];
    const str: number[] = [];
    const push = (s: number, gy: number): void => {
      const [x, z] = pointAt(s);
      tris.push(x, gy * h, z);
      str.push(stressAt(s, gy));
    };
    for (let gy = 0; gy < n; gy++) {
      for (let s = 0; s < 2 * n; s++) {
        push(s, gy); push(s + 1, gy); push(s, gy + 1);
        push(s + 1, gy); push(s + 1, gy + 1); push(s, gy + 1);
      }
    }
    return { positions: new Float32Array(tris), stress: new Float32Array(str) };
  }

  const EDGE = 4;

  it("does not flag a bounded stress rise over a convex edge", () => {
    // A real convex edge concentrates stress mildly and boundedly. 2× the
    // background at the edge is a concentration, not a singularity.
    const { positions, stress } = buildConvexEdge(EDGE, 1.0, (s) =>
      10 * (1 + Math.exp(-Math.abs(s - EDGE))));
    expect(detectSingularity(stress, positions)).toBeNull();
  });

  it("does not flag it at high absolute stress either", () => {
    // The old gate would have let this through on magnitude alone had the shape
    // qualified; the shape is what must decide, in both directions.
    const { positions, stress } = buildConvexEdge(EDGE, 1.0, (s) =>
      400 * (1 + Math.exp(-Math.abs(s - EDGE))));
    expect(detectSingularity(stress, positions)).toBeNull();
  });
});
